import test from 'node:test';
import assert from 'node:assert/strict';
import {financialScenario,registerWorkChangeModules} from './fixtures/work-change-fixtures.mjs';
const hook=registerWorkChangeModules();
const {buildWorkChangePacket}=await import('../src/utils/work-change-sources.ts');
const {validateWorkChangeReview}=await import('../src/utils/work-change-review.ts');
hook.deregister();
function setup(){const data=financialScenario();return buildWorkChangePacket(data.finding,data.documents);}
const draft=()=>({facts:[],comparisons:[],scopeComparisons:[
 {component:'METHOD_WORK',baselineIds:['T1'],proposalIds:['T4'],basisIds:['R1'],composition:'DIFFERENT'},
 {component:'MATERIAL_SUPPLY',baselineIds:['T2'],proposalIds:['T5'],basisIds:['R1'],composition:'DIFFERENT'},
 {component:'SHAFT',baselineIds:['T3'],proposalIds:['T6'],basisIds:['R1'],composition:'DIFFERENT'},
]});

test('the product lists measured-scope and price-basis gaps rather than returning an unexplained unknown total',()=>{
 const result=validateWorkChangeReview(setup(),draft()).financialReadiness;
 assert.ok(result,'A concrete financial-readiness result is required');
 assert.equal(result.deltaExclVat,null);assert.equal(result.paymentEntitlementConfirmed,false);
 assert.deepEqual(result.quantities[0].baseline.map(q=>[q.value,q.unit]),[[100,'m']]);
 assert.deepEqual(result.quantities[0].proposal.map(q=>[q.value,q.unit]),[[80,'m']]);
 assert.ok(result.confirmations.some(item=>item.code==='MEASURED_SCOPE'));
 assert.ok(result.confirmations.some(item=>item.code==='PRICE_BASIS_AND_APPROVAL'));
 assert.ok(result.confirmations.some(item=>item.code==='INCLUSIONS_AND_RESPONSIBILITIES'));
 assert.ok(result.confirmations.some(item=>item.code==='PRICE_ADJUSTMENTS'));
});

test('a quoted pre-VAT total is established from its VAT breakdown without treating it as an approved payment',()=>{
 const result=validateWorkChangeReview(setup(),draft()).financialReadiness;
 const quoted=result?.sourceTotals.find(total=>total.sourceId==='offer');
 assert.ok(quoted);assert.equal(quoted.netExclVat,13050);assert.equal(quoted.observedVat,2218.5);
 assert.equal(quoted.observedGross,15268.5);assert.equal(quoted.derivedVatPercent,17);
 assert.equal(quoted.arithmeticVerified,true);
 assert.ok(result.confirmations.some(item=>item.code==='HISTORICAL_VAT_RATE'));
 assert.equal(result.deltaExclVat,null);
});

test('reported letter amounts are retained separately from the explicit quotation total',()=>{
 const result=validateWorkChangeReview(setup(),draft()).financialReadiness;
 assert.ok(result?.mentions.some(item=>item.value===12000));
 assert.ok(result.mentions.some(item=>item.value===14000));
 assert.equal(result.sourceTotals.find(total=>total.sourceId==='offer').netExclVat,13050);
 assert.ok(result.terms.some(item=>item.evidence.quote.includes('דרכי גישה')));
 assert.ok(result.adjustments.some(item=>item.percent===15));
 assert.ok(result.adjustments.some(item=>item.percent===5));
});

test('a supplied per-piece pipe length supports a dimensional observation, never a new paid unit or surcharge',()=>{
 const result=validateWorkChangeReview(setup(),draft()).financialReadiness;
 const supply=result?.quantities.find(item=>item.component==='MATERIAL_SUPPLY');
 assert.ok(supply);assert.equal(supply.proposal[0].value,160);assert.equal(supply.proposal[0].unit,'pcs');
 assert.equal(supply.proposal[0].derivedLengthM,80);
 assert.equal(supply.proposal[0].lengthPerPieceM,0.5);
 assert.ok(supply.proposal[0].evidence.some(anchor=>anchor.quote.includes('0.5 מטר')));
 assert.equal(result.deltaExclVat,null);
});

test('diameter and drilling depth do not become the length of one supplied pipe',()=>{
 const packet=setup(),source=packet.sources.find(source=>source.id==='offer');
 source.extracted_text=source.extracted_text.replace('המחיר ליחידת צינור באורך 0.5 מטר.','צינור בקוטר 354 מ"מ, קידוח בעומק 6 מטר.');
 const result=validateWorkChangeReview(packet,draft()).financialReadiness;
 assert.equal(result?.quantities.find(item=>item.component==='MATERIAL_SUPPLY').proposal[0].derivedLengthM,null);
});

test('a bad VAT equation remains an observed amount and cannot supply a confirmed net quotation total',()=>{
 const packet=setup(),source=packet.sources.find(source=>source.id==='offer');
 source.extracted_text=source.extracted_text.replace('15,268.50','15,268.51');
 const result=validateWorkChangeReview(packet,draft()).financialReadiness;
 const total=result?.sourceTotals.find(item=>item.sourceId==='offer');
 assert.ok(total);assert.equal(total.netExclVat,null);assert.equal(total.observedNet,13050);
 assert.equal(total.arithmeticVerified,false);
});

test('incomplete reading cannot validate a quotation amount or a quantity',()=>{
 const packet=setup(),source=packet.sources.find(source=>source.id==='offer');
 source.readiness={...source.readiness,canCompare:false,extractionComplete:false};
 const result=validateWorkChangeReview(packet,draft()).financialReadiness;
 assert.equal(result?.sourceTotals.find(item=>item.sourceId==='offer').netExclVat,null);
 assert.equal(result.quantities[0].proposal[0].value,null);
 assert.equal(result.quantities[0].proposal[0].observedValue,80);
});

test('the source VAT amount can prove the net/gross split without silently correcting a reversed printed rate',()=>{
 const packet=setup(),source=packet.sources.find(source=>source.id==='old');
 source.extracted_text=source.extracted_text.replace('מע"מ 17%','%71 מע"מ');
 const result=validateWorkChangeReview(packet,draft()).financialReadiness;
 const total=result?.sourceTotals.find(item=>item.sourceId==='old');
 assert.ok(total);assert.equal(total.netExclVat,13500);assert.equal(total.derivedVatPercent,17);
 assert.equal(total.printedVatPercent,71);assert.ok(total.issues.includes('printed_vat_rate_unverified'));
});

test('all financial statements and quantity subtotals retain exact source ranges',()=>{
 const packet=setup(),result=validateWorkChangeReview(packet,draft()).financialReadiness;
 assert.ok(result);
 const evidence=[...result.sourceTotals.flatMap(item=>item.evidence),...result.mentions.flatMap(item=>item.evidence),
  ...result.terms.map(item=>item.evidence),...result.adjustments.map(item=>item.evidence),
  ...result.quantities.flatMap(item=>[...item.baseline,...item.proposal].flatMap(q=>q.evidence))];
 for(const anchor of evidence){const source=packet.sources.find(source=>source.id===anchor.documentId);assert.ok(source);assert.equal(source.extracted_text.slice(anchor.start,anchor.end),anchor.quote);}
});

test('multiple original sources do not produce a summed duplicate project quantity',()=>{
 const packet=setup(),old=packet.sources.find(source=>source.id==='old');
 packet.sources.push({...old,id:'copy',title:'Another BOQ copy',selection:structuredClone(old.selection)});
 // Its distinct source range is intentionally retained; no cross-file subtotal is allowed.
 packet.sources.at(-1).selection.source_anchors=packet.sources.at(-1).selection.source_anchors.map(anchor=>({...anchor,documentId:'copy'}));
 const input=draft();
 // The copied source follows the original sources and the offer; retain both distinct source subtotals.
 input.scopeComparisons[0].baselineIds=['T1','T7'];input.scopeComparisons[0].proposalIds=['T4'];
 const result=validateWorkChangeReview(packet,input).financialReadiness;
 assert.ok(result);assert.equal(result.quantities.find(q=>q.component==='METHOD_WORK').baseline.length,2);
 assert.deepEqual(result.quantities.find(q=>q.component==='METHOD_WORK').baseline.map(q=>q.value),[100,100]);
});

test('RTL layout can put an explicit per-pipe length before its label',()=>{
 const packet=setup(),source=packet.sources.find(source=>source.id==='offer');
 source.extracted_text=source.extracted_text.replace('המחיר ליחידת צינור באורך 0.5 מטר.','מ\' 0.5 הינו ליחידת צינור באורך');
 const result=validateWorkChangeReview(packet,draft()).financialReadiness;
 assert.equal(result.quantities.find(item=>item.component==='MATERIAL_SUPPLY').proposal[0].derivedLengthM,80);
});

test('a reverse VAT footer keeps a monetary amount before percent glyphs separate from the printed rate',()=>{
 const packet=setup(),source=packet.sources.find(source=>source.id==='old');
 source.extracted_text=source.extracted_text.replace('סה"כ כללי 13,500.00\nמע"מ 17% 2,295.00\nסה"כ כולל מע"מ 15,795.00',
  '13,500.00 ס\tה\t"\tכ\tכ\tל\tל\tי\n2,295.00 %\t7\t1\tמ\tע\t"\tמ\n15,795.00 ס\tה\t"\tכ\tכ\tו\tל\tל\tמ\tע\t"\tמ');
 const total=validateWorkChangeReview(packet,draft()).financialReadiness.sourceTotals.find(item=>item.sourceId==='old');
 assert.ok(total);assert.equal(total.netExclVat,13500);assert.equal(total.printedVatPercent,71);
 assert.equal(total.observedVat,2295);assert.equal(total.derivedVatPercent,17);
});

test('negative source totals and ambiguous currency notation never turn into positive verified amounts',()=>{
 const packet=setup(),source=packet.sources.find(source=>source.id==='offer');
 source.extracted_text=source.extracted_text.replace('13,050.00','-13,050.00').replace('2,218.50','-2,218.50').replace('15,268.50','-15,268.50')
  .replace('12,000 ₪','-12,000 ₪').replace('14,000 ₪','14.000,00 ₪');
 const result=validateWorkChangeReview(packet,draft()).financialReadiness;
 assert.equal(result.sourceTotals.some(total=>total.sourceId==='offer'&&total.netExclVat!==null),false);
 assert.equal(result.mentions.some(item=>item.sourceId==='offer'&&[12000,14].includes(item.value)),false);
});
