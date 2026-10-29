const reading={version:'page-coverage-v1',complete:true,totalPages:1,readPages:[1],unreadablePages:[]};
export function documentFixture(id,overrides={}){return{id,project_id:'demo-redesign-documents',title:`מסמך_${id}.txt`,category:'CONTRACT',created_at:'2026-10-20T10:00:00Z',ai_status:'PENDING',...overrides};}
export const documentStates=[
  ['PENDING',documentFixture('pending')],
  ['PROCESSING',documentFixture('processing',{ai_status:'PROCESSING',ocr_status:'PROCESSING'})],
  ['TEXT_READ',documentFixture('text',{ocr_status:'COMPLETED',extracted_text:'יש לעצור את העבודה.'})],
  ['SCANNED',documentFixture('scanned',{ai_status:'SCANNED',ocr_status:'COMPLETED',extracted_text:'יש לבצע את העבודה לפי התכנית המאושרת.',parsed_json:{document_type:'הוראה',summary:'הוראת ביצוע שמורה'}})],
  ['VALIDATED',documentFixture('validated',{title:'מסמך_מאושר.pdf',ai_status:'VALIDATED',ocr_status:'COMPLETED',extracted_text:'יש לבצע את העבודה לפי התכנית המאושרת.',parsed_json:{source_reading:reading}})],
  ['VALIDATED_WITH_AI_WARNING',documentFixture('warning',{ai_status:'VALIDATED',ocr_status:'COMPLETED',extracted_text:'הוראה סופית קצרה.',parsed_json:{system_error:'AI_ANALYSIS_FAILED'}})],
  ['AI_INCOMPLETE',documentFixture('error',{ai_status:'ERROR',ocr_status:'COMPLETED',extracted_text:'טקסט המקור נשמר.',parsed_json:{system_error:'AI_ANALYSIS_FAILED'}})],
  ['SOURCE_INCOMPLETE',documentFixture('partial',{title:'מסמך_מאושר_חלקית.pdf',ai_status:'VALIDATED',ocr_status:'REQUIRES_REVIEW',extracted_text:'העמוד הראשון נקרא, העמוד השני לא נקרא.',parsed_json:{source_reading:{...reading,complete:false,totalPages:2,readPages:[1],unreadablePages:[2]}}})],
];
export const completePdfReading=reading;

export function radarFixture(id,overrides={}){return{id,project_id:'demo-radar-redesign',title:`ממצא בדיקה ${id}`,description:'דרישה מהמקור [1] מול תיעוד הביצוע [2].',category:'site event',severity:'MEDIUM',status:'OPEN',pricing_status:'PENDING',created_at:'2026-10-20T10:00:00Z',source_execution_doc_id:'synthetic-work',source_doc:{id:'synthetic-work',title:'פרוטוקול_בדיקה.pdf'},target_doc:{id:'synthetic-contract',title:'חוזה_בדיקה.pdf'},...overrides};}
export const verifiedRadarEvidence={contract_quote:'יש לבצע את העבודה בשיטה א.',work_quote:'יש לבצע את אותה העבודה בשיטה ב.',contract_title:'חוזה_בדיקה.pdf',work_title:'פרוטוקול_בדיקה.pdf',contract_page:7,work_page:2,document_pair:{contract_doc_id:'synthetic-contract',work_doc_id:'synthetic-work'},evidence_status:'VERIFIED',source_verification:{contract_quote_matched:true,work_quote_matched:true,quality_gate_passed:true,source_reading_complete:true,comparison_context_complete:true},semantic_assessment:{version:'evidence-relation-v1',resultType:'CONTRADICTION',relation:'INCOMPATIBLE'}};
export const radarFindings=[
 radarFixture('verified',{category:'contradiction',evidence_data:verifiedRadarEvidence}),
 radarFixture('change',{category:'variation',evidence_data:{...verifiedRadarEvidence,semantic_assessment:{version:'evidence-relation-v1',resultType:'KNOWN_CHANGE'}}}),
 radarFixture('event'),radarFixture('missing',{category:'missing data'}),radarFixture('no-match',{category:'no direct match'}),
 radarFixture('pricing',{status:'MOVED_TO_PRICING',category:'variation'}),radarFixture('closed',{status:'RESOLVED'}),
 radarFixture('technical',{status:'ARCHIVED',title:'EXCLUDED_TECHNICAL_RECORD',evidence_data:{review_disposition:{type:'INVALID_AUTOMATIC_FINDING'}}}),
];

export function ledgerFixture(id,type='PENDING_VO',overrides={}){
 const item={id,project_id:'demo-ledger-redesign',type,source:type==='BASE_CONTRACT'?'BOQ':'CUSTOM_ANALYSIS',item_code:'40.020.0015',description:`תיאור עבודה ${id} · C-CE6070`,unit:'מ׳',quantity:2,unit_price_excl_vat:120,total_price_excl_vat:240,markup_percentage:0,vat_rate:.18,evidence_data:type==='BASE_CONTRACT'?{source:'pricelist_items',pricelist_item_id:'synthetic-boq-item'}:null,...overrides};
 if(!Object.hasOwn(overrides,'evidence_data'))item.evidence_data={...(item.evidence_data||{}),individual_pricing_terms:{version:'individual-pricing-v1',basis:'MANUAL',includes_adjustments:true,quantity:item.quantity,unit_price_excl_vat:item.unit_price_excl_vat,vat_rate:item.vat_rate,note:'תנאי מחיר סינתטיים כלולים במחיר היחידה'}};
 return item;
}
export const ledgerRows=['BASE_CONTRACT','PENDING_VO','APPROVED_VO','SENT_VO'].map((type,index)=>ledgerFixture(`ledger-${index}`,type));

export const letterItems = [
    ledgerFixture('letter-pending','PENDING_VO',{project_id:'demo-letters-redesign',item_type:'ITEM',item_code:'51.03.0110',description:'אספקה ופיזור חומר C · C-CE6070',quantity:2,unit_price_excl_vat:75,total_price_excl_vat:150,governing_notes:['מקור סינתטי A.pdf · עמוד 7 · C-CE6070'],ai_rationale:'נימוק סינתטי לצורך בדיקת הדפסה בלבד.'}),
    ledgerFixture('letter-approved','APPROVED_VO',{project_id:'demo-letters-redesign',item_type:'ITEM',item_code:'51.03.0111',description:'השלמת עבודה סינתטית',quantity:1,unit_price_excl_vat:23.45,total_price_excl_vat:23.45}),
    ledgerFixture('letter-negative','PENDING_VO',{project_id:'demo-letters-redesign',item_type:'ITEM',item_code:'51.03.0112',description:'זיכוי סינתטי',quantity:1,unit_price_excl_vat:-5.01,total_price_excl_vat:-5.01}),
    ledgerFixture('letter-base','BASE_CONTRACT',{project_id:'demo-letters-redesign',item_type:'ITEM',description:'EXCLUDED_BASE_CONTRACT',quantity:1,unit_price_excl_vat:999999,total_price_excl_vat:999999}),
];
export const letterPaperProps = {projectName:'פרויקט סינתטי C-CE6070',recipient:'נמען לבדיקה בלבד',subject:'מכתב בדיקה · C-CE6070',legalText:'טקסט סינתטי לבדיקה בלבד. אין כאן דרישת תשלום אמיתית.\nEND_LETTER_TEXT',items:letterItems};
export const longLetterPaperProps = {...letterPaperProps,legalText:('פסקה ארוכה לצורך בדיקת עימוד בלבד. המידע סינתטי ואינו הוראה או דרישה.\n'.repeat(90))+'END_LONG_LETTER_TEXT',items:Array.from({length:45},(_,index)=>({...letterItems[index%3],id:'long-letter-'+index,item_code:'UI-LETTER-'+String(index+1).padStart(3,'0')}))};

export const letterDraftProject='20000000-0000-4000-8000-000000000001';
export const letterDraftRows=[1,2,3].map(index=>ledgerFixture('30000000-0000-4000-8000-'+String(index).padStart(12,'0'),'PENDING_VO',{
 project_id:letterDraftProject,quantity:1,unit_price_excl_vat:.03,total_price_excl_vat:.03,item_code:'DRAFT-'+index,description:'שורה סינתטית '+index,
}));
export const letterDraftSnapshot={calculationVersion:'letter-individual-v1',totals:{net:.09,vat:.03,gross:.12},items:letterDraftRows.map(row=>({
 ledgerItemId:row.id,quantity:1,unitPriceExclVat:.03,net:.03,vatRate:.18,vat:.01,gross:.04,conditionBasis:'manual',
 conditionNote:'תנאים סינתטיים כלולים',description:row.description,itemCode:row.item_code,unit:row.unit,
 sources:[{documentId:null,title:null,pageLabel:null,quote:null,basis:'MANUAL',status:'REQUIRES_VERIFICATION',manualNote:'אושר ידנית לצורך בדיקה בלבד'}],
}))};
export const letterDraftHeader={id:'70000000-0000-4000-8000-000000000001',project_id:letterDraftProject,
 client_draft_id:'80000000-0000-4000-8000-000000000001',revision:1,status:'DRAFT',doc_type:'general',calculation_version:'letter-individual-v1',
 letter_number:'VO-FROZEN-001',created_at:'2026-10-29T10:11:12Z',updated_at:'2026-10-29T10:11:12Z',sent_marked_at:null,
 subject:'טיוטה סינתטית שמורה',recipient_name:'נמען סינתטי',content:'טקסט שמור לבדיקה בלבד',total_amount_excl_vat:.09,vat_amount:.03,total_amount_incl_vat:.12};
export const letterDraftLinks=letterDraftSnapshot.items.map(({sources,...pricing_snapshot},sort_order)=>({letter_id:letterDraftHeader.id,
 ledger_item_id:pricing_snapshot.ledgerItemId,sort_order,pricing_snapshot,source_snapshot:sources,source_revision:'a'.repeat(64)}));
