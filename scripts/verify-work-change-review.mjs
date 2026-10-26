import test from 'node:test';
import assert from 'node:assert/strict';
import { finding, document, registerWorkChangeModules } from './fixtures/work-change-fixtures.mjs';
const hook=registerWorkChangeModules();
const {buildWorkChangePacket}=await import('../src/utils/work-change-sources.ts');
const {validateWorkChangeReview}=await import('../src/utils/work-change-review.ts');
hook.deregister();
const baseline='דחיקת צנרת ברחוב הרימון: 100 מטר. מחיר כולל 200000 ש"ח ללא מע"מ.';
const proposal='קידוח אופקי ברחוב הרימון: 80 מטר. מחיר כולל 240000 ש"ח ללא מע"מ.';
const design='קידוח אופקי ברחוב הרימון: עדכון תכנון, שכר טרחה 12000 ש"ח ללא מע"מ.';
function packet(extra={}){return buildWorkChangePacket(finding(),[
 document('primary','ברחוב הרימון יוחלף קו GRP בשיטת קידוח אופקי.'),
 document('old',baseline,{category:'CONTRACT'}),document('offer',proposal),document('designer',design),
 ...Object.values(extra),
]);}
const drafts=()=>({facts:[
 {sourceId:'old',kind:'BASELINE_WORK',quote:baseline,quantity:100,unit:'מטר',amountExclVat:200000},
 {sourceId:'offer',kind:'PROPOSED_WORK',quote:proposal,quantity:80,unit:'מטר',amountExclVat:240000},
 {sourceId:'designer',kind:'DESIGN_FEE',quote:design,quantity:null,unit:'',amountExclVat:12000},
],comparisons:[{baselineId:'F1',proposalId:'F2',composition:'SAME'}]});

test('different quantities do not produce a confirmed technology surcharge',()=>{
 const result=validateWorkChangeReview(packet(),drafts());
 assert.equal(result.comparisons[0].status,'NOT_COMPARABLE');
 assert.equal(result.comparisons[0].arithmeticDeltaExclVat,null);
 assert.ok(result.comparisons[0].issues.includes('quantity_differs'));
});
test('design fees stay separate from execution amounts',()=>{
 const result=validateWorkChangeReview(packet(),drafts());
 assert.equal(result.facts.filter(fact=>fact.kind==='DESIGN_FEE')[0].amountExclVat,12000);
 assert.equal(result.comparisons.length,1);assert.equal(result.comparisons[0].proposalId,'F2');
});
test('forged quotes and unknown document IDs cannot become source-backed facts',()=>{
 const input=drafts();input.facts.push({sourceId:'offer',kind:'CLAIM_TOTAL',quote:'מחיר כולל 999999 ש"ח ללא מע"מ.',amountExclVat:999999});
 input.facts.push({sourceId:'missing',kind:'CLAIM_TOTAL',quote:proposal,amountExclVat:240000});
 const result=validateWorkChangeReview(packet(),input);
 assert.equal(result.facts.length,3);assert.ok(result.limitations.includes('fact_quote_unverified'));
});
test('an invented number inside an otherwise real quote remains unknown',()=>{
 const input=drafts();input.facts[1].amountExclVat=999999;
 const result=validateWorkChangeReview(packet(),input);
 assert.equal(result.facts[1].amountExclVat,null);assert.ok(result.facts[1].issues.includes('amount_unverified'));
});
test('incomplete OCR is visible and never confirms the observed financial number',()=>{
 const p=packet();const source=p.sources.find(source=>source.id==='offer');
 source.title='offer.docx';source.storage_path='offer.docx';source.readiness={...source.readiness,canCompare:false,extractionComplete:false,status:'EXTRACTION_INCOMPLETE'};
 const result=validateWorkChangeReview(p,drafts());
 assert.equal(result.facts[1].observedAmount,240000);assert.equal(result.facts[1].amountExclVat,null);
 assert.equal(result.facts[1].confirmed,false);assert.ok(result.requiresReview);
});
test('a draft quote does not become binding because it has a later date',()=>{
 const p=packet();const source=p.sources.find(source=>source.id==='offer');
 source.readiness={...source.readiness,status:'DRAFT',canCompare:false,documentStatus:'DRAFT'};
 const result=validateWorkChangeReview(p,drafts());
 assert.equal(result.facts[1].confirmed,false);assert.equal(result.facts[1].amountExclVat,null);
});
test('same quantities and unit permit arithmetic while entitlement stays unconfirmed',()=>{
 const p=packet(),input=drafts();const source=p.sources.find(source=>source.id==='offer');
 source.extracted_text=proposal.replace('80','100');input.facts[1].quote=source.extracted_text;input.facts[1].quantity=100;
 const result=validateWorkChangeReview(p,input);
 assert.equal(result.comparisons[0].status,'ARITHMETIC_ONLY');assert.equal(result.comparisons[0].arithmeticDeltaExclVat,40000);
 assert.equal(result.paymentEntitlementConfirmed,false);
});
test('source text including VAT is not silently treated as an ex-VAT amount',()=>{
 const p=packet(),input=drafts();const source=p.sources.find(source=>source.id==='offer');
 source.extracted_text=proposal.replace('ללא מע"מ','כולל מע"מ');input.facts[1].quote=source.extracted_text;
 const result=validateWorkChangeReview(p,input);
 assert.equal(result.facts[1].amountExclVat,null);assert.ok(result.facts[1].issues.includes('vat_basis_unverified'));
});
test('an absent explicit quantity stays null rather than becoming one',()=>{
 const p=packet(),input=drafts();const source=p.sources.find(source=>source.id==='offer');
 source.extracted_text='קידוח אופקי ברחוב הרימון. מחיר כולל 240000 ש"ח ללא מע"מ.';input.facts[1].quote=source.extracted_text;input.facts[1].quantity=null;
 const result=validateWorkChangeReview(p,input);assert.equal(result.facts[1].quantity,null);
 assert.equal(result.comparisons[0].arithmeticDeltaExclVat,null);
});
test('a printed unit price does not become a source-backed line total',()=>{
 const p=packet(),input=drafts();const source=p.sources.find(source=>source.id==='old');
 source.extracted_text='דחיקת צנרת ברחוב הרימון: 100 מטר במחיר 2000 ש"ח למטר, ללא מע"מ.';
 input.facts[0].quote=source.extracted_text;input.facts[0].amountExclVat=2000;
 const result=validateWorkChangeReview(p,input);
 assert.equal(result.facts[0].amountExclVat,null);assert.ok(result.facts[0].issues.includes('unit_price_not_total'));
});

test('separate rows sharing one source excerpt retain their different quantities and totals',()=>{
 const p=packet();const source=p.sources.find(source=>source.id==='old');
 source.extracted_text='דחיקת צנרת ברחוב הרימון: 100 מטר. מחיר כולל 200000 ש"ח ללא מע"מ.\nשוחות ברחוב הרימון: 4 יחידות. מחיר כולל 60000 ש"ח ללא מע"מ.';
 const row={sourceId:'old',kind:'BASELINE_WORK',quote:source.extracted_text};
 const result=validateWorkChangeReview(p,{facts:[
  {...row,quantity:100,unit:'מטר',amountExclVat:200000},
  {...row,quantity:4,unit:'יחידות',amountExclVat:60000},
  {...row,quantity:4,unit:'יחידות',amountExclVat:60000},
 ],comparisons:[]});
 const rows=result.facts.filter(fact=>fact.sourceId==='old');
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(fact=>[fact.quantity,fact.amountExclVat]),[[100,200000],[4,60000]]);
});

test('a diameter or item number elsewhere in a quote is not the paid quantity',()=>{
 const p=packet(),input=drafts();const source=p.sources.find(source=>source.id==='old');
 source.extracted_text='דחיקת צנרת בקוטר 361 מ"מ ברחוב הרימון: 100 מטר. מחיר כולל 200000 ש"ח ללא מע"מ.';
 input.facts[0].quote=source.extracted_text;input.facts[0].quantity=361;
 const result=validateWorkChangeReview(p,input);
 assert.equal(result.facts[0].quantity,null);assert.equal(result.facts[0].confirmed,false);
});

test('an arbitrary word is not accepted as a measurement unit',()=>{
 const p=packet(),input=drafts();input.facts[0].unit='דחיקת';input.facts[0].quantity=100;
 const result=validateWorkChangeReview(p,input);
 assert.equal(result.facts[0].unit,null);assert.equal(result.facts[0].quantity,null);
});

test('execution without a planning statement is not displayed as a designer fee',()=>{
 const p=packet(),input=drafts();input.facts[0].kind='DESIGN_FEE';
 const result=validateWorkChangeReview(p,input);
 assert.equal(result.facts.filter(fact=>fact.sourceId==='old').length,0);
 assert.ok(result.limitations.includes('fact_kind_unverified'));
});

test('a source amount stated plus VAT is explicitly an ex-VAT amount',()=>{
 const p=packet(),input=drafts();const source=p.sources.find(source=>source.id==='designer');
 source.extracted_text=design.replace('ללא מע"מ','+ מע\'\'מ');input.facts[2].quote=source.extracted_text;
 const result=validateWorkChangeReview(p,input);assert.equal(result.facts.find(fact=>fact.kind==='DESIGN_FEE').amountExclVat,12000);
});

test('table columns preserve quantity, unit price and line total without model guesses',()=>{
 const p=packet();const source=p.sources.find(source=>source.id==='offer');
 source.extracted_text='קידוח אופקי ברחוב הרימון.\nסעיף תאור יחידה כמות מחיר סה"כ\n71.02.0008 קידוח\nמטר\t80\t3000\t240000\nהמחירים ללא מע"מ.';
 source.selection.source_anchors=[{documentId:source.id,start:0,end:source.extracted_text.length,quote:source.extracted_text,page:null}];
 const result=validateWorkChangeReview(p,{facts:[],comparisons:[]});
 assert.equal(result.tableRows.length,1);
 assert.deepEqual([result.tableRows[0].itemCode,result.tableRows[0].quantity,result.tableRows[0].unitPrice,result.tableRows[0].total],['71.02.0008',80,3000,240000]);
 assert.equal(result.tableRows[0].arithmeticVerified,true);
});

test('reverse table layout and incomplete reading remain explicit',()=>{
 const p=packet();const source=p.sources.find(source=>source.id==='old');
 source.extracted_text='71.02.0008 דחיקת צנרת\n200000 2000 100 מ\tט\tר\nמחירים ללא מע"מ.';
 source.selection.source_anchors=[{documentId:source.id,start:0,end:source.extracted_text.length,quote:source.extracted_text,page:null}];
 source.readiness={...source.readiness,canCompare:false};
 const result=validateWorkChangeReview(p,{facts:[],comparisons:[]});
 assert.deepEqual([result.tableRows[0].quantity,result.tableRows[0].unitPrice,result.tableRows[0].total],[100,2000,200000]);
 assert.equal(result.tableRows[0].requiresReview,true);assert.equal(result.paymentEntitlementConfirmed,false);
});

test('an explicitly labelled designer fee is retained even when the local draft misses it',()=>{
 const p=packet();const result=validateWorkChangeReview(p,{facts:[],comparisons:[]});
 const fee=result.facts.find(fact=>fact.sourceId==='designer'&&fact.kind==='DESIGN_FEE');
 assert.ok(fee);assert.equal(fee.amountExclVat,12000);
 assert.equal(result.comparisons.length,0);
});

test('repeated item codes stay ambiguous rather than silently choosing a structure',()=>{
 const p=packet();const source=p.sources.find(source=>source.id==='old');
 source.extracted_text='71.02.0008 שוחות\n200000 2000 100 מטר\n71.02.0008 שוחות במבנה אחר\n240000 3000 80 מטר';
 source.selection.source_anchors=[{documentId:source.id,start:0,end:source.extracted_text.length,quote:source.extracted_text,page:null}];
 const result=validateWorkChangeReview(p,{facts:[],comparisons:[]});
 assert.equal(result.tableRows.length,2);assert.ok(result.tableRows.every(row=>row.ambiguousItemCode&&row.requiresReview));
});
