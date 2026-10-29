-- R02/R03: additive, no backfill and no rewrite of legacy letters.
alter table public.vo_letters
 add column if not exists doc_type text,
 add column if not exists calculation_version text,
 add column if not exists vat_amount numeric,
 add column if not exists total_amount_incl_vat numeric,
 add column if not exists revision integer,
 add column if not exists client_draft_id uuid,
 add column if not exists last_operation_id uuid,
 add column if not exists last_operation_hash text,
 add column if not exists sent_marked_at timestamptz;
alter table public.vo_letter_items
 add column if not exists pricing_snapshot jsonb,
 add column if not exists source_snapshot jsonb,
 add column if not exists source_revision text;
create unique index if not exists vo_letters_project_client_draft_idx on public.vo_letters(project_id,client_draft_id);
create index if not exists vo_letter_items_ledger_item_idx on public.vo_letter_items(ledger_item_id);
alter table public.vo_letter_items drop constraint vo_letter_items_ledger_item_id_fkey;
alter table public.vo_letter_items add constraint vo_letter_items_ledger_item_id_fkey
 foreign key(ledger_item_id) references public.pricing_ledger(id) on delete restrict;

-- Math.round on the existing binary-double calculation, including negative ties.
-- numeric round() would choose a different result for -0.25 * .18.
create or replace function public.letter_money_round(p_value double precision) returns numeric
 language plpgsql immutable strict security invoker set search_path='' as $$
declare v double precision; n double precision;
begin
 if p_value='NaN'::double precision or abs(p_value) > 90071992547409 then
  raise exception using errcode='PT422',message='LETTER_MONEY_INVALID';
 end if;
 v:=p_value*100; n:=floor(v);
 if v-n>=.5 then n:=n+1;end if;
 if abs(n)>9007199254740991 then raise exception using errcode='PT422',message='LETTER_MONEY_UNSAFE';end if;
 return n::numeric/100;
end;$$;

create or replace function public.letter_individual_pricing(p_row jsonb) returns jsonb
 language plpgsql immutable security invoker set search_path='' as $$
declare
 q double precision; price double precision; rate double precision; net numeric; vat numeric; gross numeric;
 evidence jsonb:=coalesce(p_row->'evidence_data','{}'); ev jsonb; scope jsonb; approval jsonb; manual jsonb;
 manual_ok boolean; source_ok boolean; zero_ok boolean; basis text; note text;
 trim_chars constant text:=U&'\0009\000a\000b\000c\000d\0020\00a0\feff\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000';
begin
 q:=nullif(btrim(p_row->>'quantity',trim_chars),'')::double precision;
 price:=nullif(btrim(p_row->>'unit_price_excl_vat',trim_chars),'')::double precision;
 rate:=nullif(btrim(p_row->>'vat_rate',trim_chars),'')::double precision;
 if q is null or q<=0 or q='NaN'::double precision or price is null or price='NaN'::double precision
  or rate is null or rate<0 or rate>1 or rate='NaN'::double precision then
  raise exception using errcode='PT422',message='LETTER_MONEY_INCOMPLETE';
 end if;
 net:=public.letter_money_round(q*price);
 if nullif(btrim(p_row->>'total_price_excl_vat',trim_chars),'') is not null
  and public.letter_money_round(btrim(p_row->>'total_price_excl_vat',trim_chars)::double precision)<>net then
  raise exception using errcode='PT422',message='LETTER_AMOUNT_MISMATCH';
 end if;
 ev:=coalesce(evidence->'pricing_evaluation','{}');scope:=coalesce(ev->'scope_review','{}');
 approval:=coalesce(evidence->'pricing_approval','{}');manual:=coalesce(evidence->'individual_pricing_terms','{}');
 manual_ok:=coalesce(manual->>'version'='individual-pricing-v1' and manual->>'basis'='MANUAL'
  and manual->'includes_adjustments'='true'::jsonb
  and abs((manual->>'quantity')::double precision-q)<.000001
  and abs((manual->>'unit_price_excl_vat')::double precision-price)<.000001
  and abs((manual->>'vat_rate')::double precision-rate)<.000001,false);
 source_ok:=coalesce(scope->>'version'='price-scope-v1' and scope->>'status'='FULL'
  and scope->'requiresReview'='false'::jsonb and scope->'issues'='[]'::jsonb
  and scope->'uncoveredRequirementIds'='[]'::jsonb and jsonb_typeof(scope->'lines')='array'
  and jsonb_array_length(scope->'lines')>0
  and abs((approval->>'quantity')::double precision-q)<.000001
  and public.letter_money_round((approval->>'effective_unit_price_excl_vat')::double precision)=public.letter_money_round(price)
  and public.letter_money_round((approval->>'total_excl_vat')::double precision)=net,false);
 zero_ok:=net=0 and price=0 and jsonb_typeof(evidence->'zero_value_reason')='string'
  and coalesce(btrim(evidence->>'zero_value_reason',trim_chars),'')<>'';
 if ev->'requires_user_answer_before_approval'='true'::jsonb
  or (scope->>'version'='price-scope-v1' and not coalesce(scope->>'status'='FULL'
    and scope->'requiresReview'='false'::jsonb and scope->'issues'='[]'::jsonb
    and scope->'uncoveredRequirementIds'='[]'::jsonb and jsonb_typeof(scope->'lines')='array'
    and jsonb_array_length(scope->'lines')>0,false)) then
  raise exception using errcode='PT422',message='LETTER_SOURCE_NEEDS_REVIEW';
 end if;
 if not (manual_ok or source_ok or zero_ok) then raise exception using errcode='PT422',message='LETTER_TERMS_UNCONFIRMED';end if;
 basis:=case when manual_ok then 'manual' when source_ok then 'source' else 'confirmed-zero' end;
 note:=case when manual_ok then coalesce(nullif(case when jsonb_typeof(manual->'note')='string' then btrim(manual->>'note',trim_chars) else '' end,''),'אושר ידנית: ההנחות והתוספות כבר נכללות במחיר היחידה')
  when source_ok then 'המחיר לאחר ההתאמות שנכללו בבדיקת המקור השמורה' else btrim(evidence->>'zero_value_reason',trim_chars) end;
 vat:=public.letter_money_round(net::double precision*rate);
 gross:=public.letter_money_round(net::double precision+vat::double precision);
 return jsonb_build_object('ledgerItemId',p_row->>'id','quantity',q,'unitPriceExclVat',price,
  'net',net,'vatRate',rate,'vat',vat,'gross',gross,'conditionBasis',basis,'conditionNote',note);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
 raise exception using errcode='PT422',message='LETTER_MONEY_INVALID';
end;$$;

-- Re-check source readability; a historical COMPLETED flag alone is insufficient.
create or replace function public.letter_document_readable(p_doc jsonb) returns boolean
 language plpgsql immutable security invoker set search_path='' as $$
declare
 body text:=coalesce(p_doc->>'extracted_text','');title text:=coalesce(p_doc->>'title','');stem text;
 reading jsonb:=p_doc#>'{parsed_json,source_reading}';pages integer;images integer;
 is_pdf boolean;is_docx boolean;
begin
 body:=btrim(regexp_replace(body,'\[(DOCX_(IMAGE|PART|ISSUE)[^\]\r\n]*|END_DOCX_(IMAGE|PART))\]','','g'));
 body:=btrim(regexp_replace(body,'^[ \t]*--[[:space:]]*[0-9]+[[:space:]]+of[[:space:]]+[0-9]+[[:space:]]*--[ \t]*$','','gin'));
 body:=btrim(regexp_replace(body,'^[ \t]*(page[[:space:]]+)?[0-9]+[[:space:]]+(of|מתוך)[[:space:]]+[0-9]+[ \t]*$','','gin'));
 body:=btrim(regexp_replace(body,'^[ \t]*(עמוד|עמ'')[[:space:]]*[0-9]+([[:space:]]*מתוך[[:space:]]*[0-9]+)?[ \t]*$','','gn'));
 stem:=btrim(regexp_replace(title,'\.[a-z0-9]{1,12}$','','i'));
 if p_doc is null or p_doc->>'deleted_at' is not null or body !~ '[[:alpha:]]{2}'
  or body ~* '^[[:alnum:]_. /-]+\.(pdf|docx?|xlsx?)([[:space:]]+[0-9][0-9./ -]*)?$'
  or body ~ '^[A-Z]{1,8}[.-][A-Z0-9.-]+([[:space:]]+[0-9][0-9./ -]*)?$'
  or coalesce(p_doc->>'ocr_status','') in ('REQUIRES_REVIEW','ERROR','PENDING','PROCESSING')
  or body like '%[Document text was truncated for AI analysis.%'
  or stem ~* '(^|[ _–—(-])(draft|טיוטה)([ _–—()0-9.v-]*)$'
  or array_to_string((string_to_array(body,E'\n'))[1:12],E'\n') ~* '(^|\n)[[:space:]]*(טיוטה|draft)([[:space:]]*[-:–—]?[[:space:]]*(לעיון בלבד|לעיון|בלבד|לבדיקה|לא לביצוע|for review only|for review|only|v?[0-9.]+))*[[:space:]]*(\n|$)'
  or array_to_string((string_to_array(body,E'\n'))[1:12],E'\n') ~* '(^|\n)[[:space:]]*(קטע מתוך|חלק מתוך|fragment (of|from)|excerpt from)[[:space:]]' then return false;end if;
 is_pdf:=(title||' '||coalesce(p_doc->>'storage_path','')||' '||coalesce(p_doc->>'file_url','')) ~* '\.pdf($|[?# ._()0-9-])';
 is_docx:=reading->>'version'='docx-image-coverage-v1' or (title||' '||coalesce(p_doc->>'storage_path','')||' '||coalesce(p_doc->>'file_url','')) ~* '\.docx($|[?# ._()0-9-])';
 if is_pdf then
  pages:=(reading->>'totalPages')::integer;
  if not coalesce(p_doc->>'ocr_status'='COMPLETED' and reading->>'version'='page-coverage-v1'
   and reading->'complete'='true'::jsonb and pages>0 and reading->'unreadablePages'='[]'::jsonb
   and jsonb_typeof(reading->'readPages')='array',false) then return false;end if;
  if (select count(distinct value::integer) from jsonb_array_elements_text(reading->'readPages'))<>pages
   or exists(select 1 from jsonb_array_elements_text(reading->'readPages') where value::integer<1 or value::integer>pages) then return false;end if;
 end if;
 if is_docx then
  images:=(reading->>'expectedImageReferences')::integer;
  if not coalesce(p_doc->>'ocr_status'='COMPLETED' and reading->>'version'='docx-image-coverage-v1'
   and reading->'complete'='true'::jsonb and reading->>'sourceHash' ~ '^[a-fA-F0-9]{64}$'
   and (nullif(p_doc->>'content_hash','') is null or p_doc->>'content_hash'=reading->>'sourceHash')
   and images>=0 and reading->'issues'='[]'::jsonb and jsonb_array_length(reading->'images')=images,false) then return false;end if;
  if (select count(distinct image->>'anchor') from jsonb_array_elements(reading->'images') image)<>images
   or exists(select 1 from jsonb_array_elements(reading->'images') image where not coalesce(
    image->>'part' ~ '^word/.+\.xml$' and starts_with(image->>'anchor',(image->>'part')||'#')
    and length(image->>'mediaName')>0 and image->>'sha256' ~ '^[a-fA-F0-9]{64}$'
    and image->>'status'='READ' and image->'numericReviewRequired'='false'::jsonb
    and image->'reason'='null'::jsonb and (image->>'confidence')::numeric between 65 and 100,false)) then return false;end if;
 end if;
 return true;
exception when others then return false;
end;$$;

-- This helper is invoker-only and checks owner before returning any source.
-- Fingerprints exclude only the sent status, which this workflow changes itself.
create or replace function public.letter_source_state(p_project_id uuid,p_item_id uuid,p_doc_type text) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare
 ledger public.pricing_ledger;finding public.contradictions;doc public.documents;
 evidence jsonb;docs jsonb:='[]';sources jsonb:='[]';entry jsonb;verified boolean:=false;
 pair record;quote text;doc_ok boolean;official boolean:=lower(coalesce(p_doc_type,''))='official_vo';
begin
 if auth.uid() is null or not exists(select 1 from public.projects where id=p_project_id and contractor_id=auth.uid()) then
  raise exception using errcode='42501',message='LETTER_FORBIDDEN';end if;
 select * into ledger from public.pricing_ledger where id=p_item_id and project_id=p_project_id;
 if not found then raise exception using errcode='PT422',message='LETTER_ITEM_INVALID';end if;
 if ledger.contradiction_id is not null then
  select * into finding from public.contradictions where id=ledger.contradiction_id and project_id=p_project_id;
 end if;
 evidence:=coalesce(finding.evidence_data,'{}');
 verified:=coalesce(finding.id is not null and finding.status::text<>'ARCHIVED'
  and finding.source_execution_doc_id is not null and finding.target_contract_doc_id is not null
  and evidence->>'evidence_status'='VERIFIED' and lower(coalesce(evidence->>'comparison_type','')) not like '%missing_data%'
  and coalesce(evidence#>>'{review_disposition,type}','') not in ('INVALID_AUTOMATIC_FINDING','DUPLICATE')
  and evidence#>>'{semantic_assessment,version}'='evidence-relation-v1'
  and evidence#>>'{semantic_assessment,relation}'='INCOMPATIBLE'
  and evidence#>>'{semantic_assessment,resultType}'='CONTRADICTION'
  and evidence#>'{source_verification,contract_quote_matched}'='true'::jsonb
  and evidence#>'{source_verification,work_quote_matched}'='true'::jsonb
  and evidence#>'{source_verification,quality_gate_passed}'='true'::jsonb
  and evidence#>'{source_verification,source_reading_complete}'='true'::jsonb
  and evidence#>'{source_verification,comparison_context_complete}'='true'::jsonb,false);
 for pair in select * from (values(finding.target_contract_doc_id,'contract'),(finding.source_execution_doc_id,'work')) as refs(doc_id,kind) loop
  if pair.doc_id is null then continue;end if;
  select * into doc from public.documents where id=pair.doc_id and project_id=p_project_id and deleted_at is null;
  quote:=nullif(btrim(evidence->>(pair.kind||'_quote')),'');
  doc_ok:=doc.id is not null and quote is not null and position(quote in doc.extracted_text)>0
   and public.letter_document_readable(to_jsonb(doc));
  verified:=verified and coalesce(doc_ok,false);
  docs:=docs||jsonb_build_array(to_jsonb(doc));
  sources:=sources||jsonb_build_array(jsonb_build_object('documentId',doc.id,'title',doc.title,
   'pageLabel',evidence->>(pair.kind||'_page'),'quote',quote,'basis','DOCUMENT',
   'status','REQUIRES_VERIFICATION','manualNote',null));
 end loop;
 if official and (not verified or jsonb_array_length(sources)<>2) then
  raise exception using errcode='PT422',message='LETTER_OFFICIAL_EVIDENCE_UNVERIFIED';end if;
 if verified then select coalesce(jsonb_agg(value||'{"status":"VERIFIED"}'::jsonb),'[]') into sources from jsonb_array_elements(sources);end if;
 if jsonb_array_length(sources)=0 then
  entry:=public.letter_individual_pricing(to_jsonb(ledger));
  sources:=jsonb_build_array(jsonb_build_object('documentId',null,'title',null,'pageLabel',null,'quote',null,
   'basis',case when entry->>'conditionBasis'='source' then 'DOCUMENT' else 'MANUAL' end,
   'status','REQUIRES_VERIFICATION','manualNote',case when entry->>'conditionBasis'='source' then null else entry->>'conditionNote' end));
 end if;
 return jsonb_build_object('sources',sources,'revision',encode(sha256(convert_to(jsonb_build_object(
  'ledger',to_jsonb(ledger)-'type','finding',to_jsonb(finding),'documents',docs)::text,'UTF8')),'hex'));
end;$$;

create or replace function public.preview_letter_draft(p_project_id uuid,p_doc_type text,p_item_ids uuid[]) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare
 ids uuid[];item_id uuid;ledger public.pricing_ledger;money jsonb;source_state jsonb;
 items jsonb:='[]';revisions jsonb:='{}';net numeric:=0;vat numeric:=0;gross numeric:=0;
begin
 perform 1 from public.projects where id=p_project_id and contractor_id=auth.uid() for update;
 if not found or auth.uid() is null then raise exception using errcode='42501',message='LETTER_FORBIDDEN';end if;
 if p_item_ids is null or cardinality(p_item_ids)=0 or array_position(p_item_ids,null) is not null
  or coalesce(p_doc_type,'') not in ('claim','notice','vo_request','response','general','official_vo') then
  raise exception using errcode='PT422',message='LETTER_SELECTION_REQUIRED';end if;
 select array_agg(id order by first_ordinal) into ids from (select id,min(ordinal) first_ordinal from unnest(p_item_ids) with ordinality as requested(id,ordinal) group by id) selected;
 perform 1 from public.pricing_ledger where project_id=p_project_id and id=any(ids) order by id for update;
 if (select count(*) from public.pricing_ledger where project_id=p_project_id and id=any(ids))<>cardinality(ids)
  or exists(select 1 from public.pricing_ledger where id=any(ids) and (type is null or type::text not in ('PENDING_VO','APPROVED_VO')))
  or exists(select 1 from public.pricing_ledger where id=any(ids) and contradiction_id is not null group by contradiction_id having count(*)>1) then
  raise exception using errcode='PT422',message='LETTER_SELECTION_INVALID';end if;
 perform 1 from public.contradictions where project_id=p_project_id and id in(select contradiction_id from public.pricing_ledger where id=any(ids)) order by id for share;
 perform 1 from public.documents where project_id=p_project_id and id in(
  select source_execution_doc_id from public.contradictions where id in(select contradiction_id from public.pricing_ledger where id=any(ids))
  union select target_contract_doc_id from public.contradictions where id in(select contradiction_id from public.pricing_ledger where id=any(ids))) order by id for share;
 foreach item_id in array ids loop
  select * into ledger from public.pricing_ledger where id=item_id and project_id=p_project_id;
  money:=public.letter_individual_pricing(to_jsonb(ledger));source_state:=public.letter_source_state(p_project_id,item_id,p_doc_type);
  items:=items||jsonb_build_array(money||jsonb_build_object('sources',source_state->'sources','description',ledger.description,'itemCode',ledger.item_code,'unit',ledger.unit));
  revisions:=revisions||jsonb_build_object(item_id::text,source_state->>'revision');
  net:=net+(money->>'net')::numeric;vat:=vat+(money->>'vat')::numeric;gross:=gross+(money->>'gross')::numeric;
  if greatest(abs(net),abs(vat),abs(gross))*100>9007199254740991 then raise exception using errcode='PT422',message='LETTER_MONEY_UNSAFE';end if;
 end loop;
 return jsonb_build_object('snapshot',jsonb_build_object('calculationVersion','letter-individual-v1','items',items,
  'totals',jsonb_build_object('net',net,'vat',vat,'gross',gross)),'sourceRevisions',revisions);
end;$$;

create or replace function public.letter_saved_result(p_letter_id uuid) returns jsonb
 language plpgsql stable security invoker set search_path='' as $$
declare letter public.vo_letters;items jsonb;
begin
 select l.* into letter from public.vo_letters l join public.projects p on p.id=l.project_id
  where l.id=p_letter_id and p.contractor_id=auth.uid();
 if not found then raise exception using errcode='42501',message='LETTER_FORBIDDEN';end if;
 select coalesce(jsonb_agg(pricing_snapshot||jsonb_build_object('sources',source_snapshot) order by sort_order),'[]')
  into items from public.vo_letter_items where letter_id=p_letter_id;
 return jsonb_build_object('letterId',letter.id,'status',letter.status,'revision',letter.revision,
  'clientDraftId',letter.client_draft_id,'sentMarkedAt',letter.sent_marked_at,
  'snapshot',jsonb_build_object('calculationVersion',letter.calculation_version,'items',items,
   'totals',jsonb_build_object('net',letter.total_amount_excl_vat,'vat',letter.vat_amount,'gross',letter.total_amount_incl_vat)));
end;$$;

create or replace function public.save_letter_draft(p_project_id uuid,p_client_draft_id uuid,p_expected_revision integer,
 p_operation_id uuid,p_subject text,p_recipient_name text,p_doc_type text,p_content text,p_item_ids uuid[],p_expected_sources jsonb) returns jsonb
 language plpgsql security invoker set search_path='' as $$
<<draft_write>>
declare
 letter public.vo_letters;preview jsonb;request_hash text;item jsonb;ordinal integer:=0;letter_id uuid;
 content text:=p_content;subject text:=p_subject;
 trim_chars constant text:=U&'\0009\000a\000b\000c\000d\0020\00a0\feff\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000';
begin
 perform 1 from public.projects where id=p_project_id and contractor_id=auth.uid() for update;
 if not found or auth.uid() is null then raise exception using errcode='42501',message='LETTER_FORBIDDEN';end if;
 if p_client_draft_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or coalesce(btrim(p_subject,trim_chars),'')='' or coalesce(btrim(p_content,trim_chars),'')='' or coalesce(btrim(p_doc_type),'')=''
  or jsonb_typeof(p_expected_sources) is distinct from 'object' then raise exception using errcode='PT422',message='LETTER_INPUT_INVALID';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_project_id,p_client_draft_id,p_expected_revision,p_subject,p_recipient_name,p_doc_type,p_content,p_item_ids,p_expected_sources)::text,'UTF8')),'hex');
 select * into letter from public.vo_letters where project_id=p_project_id and client_draft_id=p_client_draft_id for update;
 if found then
  if letter.last_operation_id=p_operation_id then
   if letter.last_operation_hash=request_hash then return public.letter_saved_result(letter.id);end if;
   raise exception using errcode='PT409',message='LETTER_OPERATION_CONFLICT';
  end if;
  if letter.status<>'DRAFT' or letter.revision<>p_expected_revision then raise exception using errcode='PT409',message='LETTER_REVISION_CONFLICT';end if;
 elsif p_expected_revision<>0 then raise exception using errcode='PT409',message='LETTER_REVISION_CONFLICT';end if;
 begin preview:=public.preview_letter_draft(p_project_id,p_doc_type,p_item_ids);
 exception when sqlstate 'PT422' then
  if p_expected_sources<>'{}'::jsonb then raise exception using errcode='PT409',message='LETTER_SOURCE_CHANGED';end if;
  raise;
 end;
 if preview->'sourceRevisions' is distinct from p_expected_sources then raise exception using errcode='PT409',message='LETTER_SOURCE_CHANGED';end if;
 if lower(p_doc_type)='official_vo' then
  subject:='דרישה לשינוי — מקורות מאומתים';
  content:='דרישה לשינוי על בסיס המקורות השמורים בלבד'||E'\n';
  for item in select value from jsonb_array_elements(preview#>'{snapshot,items}') loop
   content:=content||coalesce(item->>'description','')||E'\n'||(item->>'net')||' לפני מע״מ; '||(item->>'vat')||' מע״מ; '||(item->>'gross')||' כולל מע״מ'||E'\n';
   content:=content||(select string_agg(coalesce(value->>'title','')||': '||coalesce(value->>'quote',''),E'\n') from jsonb_array_elements(item->'sources'))||E'\n';
  end loop;
 end if;
 if letter.id is null then
  insert into public.vo_letters(project_id,letter_number,subject,recipient_name,status,content,vat_rate,
   doc_type,calculation_version,total_amount_excl_vat,vat_amount,total_amount_incl_vat,revision,client_draft_id,last_operation_id,last_operation_hash)
  values(p_project_id,'VO-'||p_client_draft_id::text,subject,p_recipient_name,'DRAFT',content,.18,
   p_doc_type,'letter-individual-v1',(preview#>>'{snapshot,totals,net}')::numeric,(preview#>>'{snapshot,totals,vat}')::numeric,
   (preview#>>'{snapshot,totals,gross}')::numeric,1,p_client_draft_id,p_operation_id,request_hash) returning id into letter_id;
 else
  letter_id:=letter.id;
  update public.vo_letters set subject=draft_write.subject,recipient_name=p_recipient_name,content=draft_write.content,
   doc_type=p_doc_type,total_amount_excl_vat=(preview#>>'{snapshot,totals,net}')::numeric,vat_amount=(preview#>>'{snapshot,totals,vat}')::numeric,
   total_amount_incl_vat=(preview#>>'{snapshot,totals,gross}')::numeric,revision=revision+1,last_operation_id=p_operation_id,last_operation_hash=request_hash,updated_at=now()
   where id=letter_id;
  delete from public.vo_letter_items where vo_letter_items.letter_id=draft_write.letter_id;
 end if;
 for item in select value from jsonb_array_elements(preview#>'{snapshot,items}') loop
  insert into public.vo_letter_items(letter_id,ledger_item_id,sort_order,pricing_snapshot,source_snapshot,source_revision)
   values(letter_id,(item->>'ledgerItemId')::uuid,ordinal,item-'sources',item->'sources',preview#>>array['sourceRevisions',item->>'ledgerItemId']);
  ordinal:=ordinal+1;
 end loop;
 return public.letter_saved_result(letter_id);
end;$$;

create or replace function public.mark_letter_sent(p_project_id uuid,p_letter_id uuid,p_expected_revision integer,p_operation_id uuid) returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare letter public.vo_letters;request_hash text;ids uuid[];expected jsonb;preview jsonb;saved jsonb;
begin
 perform 1 from public.projects where id=p_project_id and contractor_id=auth.uid() for update;
 if not found or auth.uid() is null then raise exception using errcode='42501',message='LETTER_FORBIDDEN';end if;
 if p_operation_id is null or p_expected_revision is null then raise exception using errcode='PT422',message='LETTER_INPUT_INVALID';end if;
 select * into letter from public.vo_letters where id=p_letter_id and project_id=p_project_id for update;
 if not found then raise exception using errcode='42501',message='LETTER_FORBIDDEN';end if;
 request_hash:=encode(sha256(convert_to(jsonb_build_array('sent',p_project_id,p_letter_id,p_expected_revision)::text,'UTF8')),'hex');
 if letter.last_operation_id=p_operation_id then
  if letter.last_operation_hash=request_hash then return public.letter_saved_result(letter.id);end if;
  raise exception using errcode='PT409',message='LETTER_OPERATION_CONFLICT';end if;
 if letter.status<>'DRAFT' or letter.revision is distinct from p_expected_revision or letter.calculation_version is null then
  raise exception using errcode='PT409',message='LETTER_REVISION_CONFLICT';end if;
 select array_agg(ledger_item_id order by sort_order),jsonb_object_agg(ledger_item_id::text,source_revision)
  into ids,expected from public.vo_letter_items where letter_id=p_letter_id;
 -- Report source changes as conflicts even if the new source is now inadmissible.
 perform 1 from public.pricing_ledger where project_id=p_project_id and id=any(ids) order by id for update;
 if exists(select 1 from public.pricing_ledger where id=any(ids) and type::text='SENT_VO') then
  raise exception using errcode='PT409',message='LETTER_SOURCE_CHANGED';end if;
 begin preview:=public.preview_letter_draft(p_project_id,letter.doc_type,ids);
 exception when sqlstate 'PT422' then raise exception using errcode='PT409',message='LETTER_SOURCE_CHANGED';end;
 saved:=public.letter_saved_result(p_letter_id);
 if preview->'sourceRevisions' is distinct from expected or preview->'snapshot' is distinct from saved->'snapshot' then
  raise exception using errcode='PT409',message='LETTER_SOURCE_CHANGED';end if;
 update public.pricing_ledger set type='SENT_VO' where project_id=p_project_id and id=any(ids);
 update public.vo_letters set status='SENT',sent_marked_at=now(),revision=revision+1,
  last_operation_id=p_operation_id,last_operation_hash=request_hash,updated_at=now() where id=p_letter_id;
 return public.letter_saved_result(p_letter_id);
end;$$;

create or replace function public.letter_write_guard() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.status='SENT' then raise exception using errcode='PT409',message='LETTER_SENT_IMMUTABLE';end if;
 if new.calculation_version is distinct from 'letter-individual-v1' or new.client_draft_id is null
  or new.last_operation_id is null or new.last_operation_hash is null or new.revision is null
  or new.vat_amount is null or new.total_amount_incl_vat is null or new.total_amount_excl_vat is null
  or coalesce(new.doc_type,'') not in ('claim','notice','vo_request','response','general','official_vo')
  or new.status not in ('DRAFT','SENT') or new.revision<1
  or (tg_op='INSERT' and (new.status<>'DRAFT' or new.revision<>1 or new.sent_marked_at is not null))
  or ((new.status='SENT') is distinct from (new.sent_marked_at is not null)) then
  raise exception using errcode='PT422',message='LETTER_NEW_FORMAT_REQUIRED';end if;
 return new;
end;$$;
drop trigger if exists letter_write_guard on public.vo_letters;
create trigger letter_write_guard before insert or update on public.vo_letters for each row execute function public.letter_write_guard();

-- Deferred integrity also protects the invoker's existing direct table grants.
-- Neither a forged header nor incomplete links can commit successfully.
create or replace function public.letter_snapshot_guard() returns trigger
 language plpgsql security invoker set search_path='' as $$
<<snapshot_check>>
declare letter_id uuid;letter public.vo_letters;link public.vo_letter_items;ledger public.pricing_ledger;
 money jsonb;current_source jsonb;net numeric:=0;vat numeric:=0;gross numeric:=0;links integer:=0;
begin
 if tg_table_name='vo_letters' then letter_id:=coalesce(new.id,old.id);
 else letter_id:=coalesce(new.letter_id,old.letter_id);end if;
 select * into letter from public.vo_letters where id=letter_id;
 if not found or letter.calculation_version is null then return null;end if;
 for link in select * from public.vo_letter_items where vo_letter_items.letter_id=snapshot_check.letter_id order by sort_order loop
  links:=links+1;
  select * into ledger from public.pricing_ledger where id=link.ledger_item_id and project_id=letter.project_id;
  if not found or link.pricing_snapshot is null or link.source_snapshot is null or link.source_revision is null
   or (letter.status='SENT' and ledger.type::text<>'SENT_VO')
   or (letter.status='DRAFT' and ledger.type::text not in ('PENDING_VO','APPROVED_VO')) then
   raise exception using errcode='PT422',message='LETTER_SNAPSHOT_INVALID';end if;
  money:=public.letter_individual_pricing(to_jsonb(ledger));
  current_source:=public.letter_source_state(letter.project_id,link.ledger_item_id,letter.doc_type);
  if link.pricing_snapshot is distinct from money||jsonb_build_object('description',ledger.description,'itemCode',ledger.item_code,'unit',ledger.unit)
   or link.source_snapshot is distinct from current_source->'sources' or link.source_revision is distinct from current_source->>'revision' then
   raise exception using errcode='PT422',message='LETTER_SNAPSHOT_INVALID';end if;
  net:=net+(money->>'net')::numeric;vat:=vat+(money->>'vat')::numeric;gross:=gross+(money->>'gross')::numeric;
 end loop;
 if links=0 or net is distinct from letter.total_amount_excl_vat or vat is distinct from letter.vat_amount
  or gross is distinct from letter.total_amount_incl_vat then raise exception using errcode='PT422',message='LETTER_SNAPSHOT_INVALID';end if;
 return null;
end;$$;
drop trigger if exists letter_snapshot_guard on public.vo_letters;
create constraint trigger letter_snapshot_guard after insert or update on public.vo_letters deferrable initially deferred for each row execute function public.letter_snapshot_guard();
drop trigger if exists letter_item_snapshot_guard on public.vo_letter_items;
create constraint trigger letter_item_snapshot_guard after insert or update or delete on public.vo_letter_items deferrable initially deferred for each row execute function public.letter_snapshot_guard();

-- Restrict only this migration's functions. Do not alter other routines or RLS.
revoke all on function public.letter_money_round(double precision),public.letter_individual_pricing(jsonb),public.letter_document_readable(jsonb),
 public.letter_source_state(uuid,uuid,text),public.preview_letter_draft(uuid,text,uuid[]),public.letter_saved_result(uuid),
 public.save_letter_draft(uuid,uuid,integer,uuid,text,text,text,text,uuid[],jsonb),public.mark_letter_sent(uuid,uuid,integer,uuid),
 public.letter_write_guard(),public.letter_snapshot_guard() from public,anon;
grant execute on function public.letter_money_round(double precision),public.letter_individual_pricing(jsonb),public.letter_document_readable(jsonb),
 public.letter_source_state(uuid,uuid,text),public.preview_letter_draft(uuid,text,uuid[]),public.letter_saved_result(uuid),
 public.save_letter_draft(uuid,uuid,integer,uuid,text,text,text,text,uuid[],jsonb),public.mark_letter_sent(uuid,uuid,integer,uuid)
 to authenticated;
