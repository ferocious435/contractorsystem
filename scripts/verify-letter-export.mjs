import './redesign/load-ui.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
import {letterDraftRows} from './redesign/fixtures.mjs';
const api=await import('../src/utils/letter-export.ts').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const csv=(rows,...args)=>{assert.equal(typeof api.buildLedgerCsv,'function','Shared ledger CSV is missing');return api.buildLedgerCsv(rows,...args);};
test('CSV keeps separate individually rounded totals and escapes comma, quotes and newlines',()=>{
 const rows=letterDraftRows.map((row,index)=>index?row:{...row,description:'טקסט, "מצוטט"\nשורה נוספת'}),text=csv(rows);
 assert.ok(text.includes('0.12'));assert.ok(text.includes('0.09'));assert.ok(text.includes('0.03'));assert.ok(text.includes('"טקסט, ""מצוטט""\nשורה נוספת"'));
});
test('CSV retains a traced base contract separately and never turns an unknown VO price into zero',()=>{
 const base={id:'base',type:'BASE_CONTRACT',source:'BOQ',quantity:1,unit_price_excl_vat:100,vat_rate:.18,evidence_data:{source:'pricelist_items',pricelist_item_id:'synthetic-boq'}};
 const text=csv([base,...letterDraftRows,{...letterDraftRows[0],id:'unknown',unit_price_excl_vat:null,description:'UNKNOWN_PRICE'}],999);
 assert.ok(text.includes('100.00'));assert.ok(text.includes('118.00'));assert.ok(text.includes('118.12'));assert.ok(!text.includes('999.00'));
 assert.ok(text.includes('דורש בדיקה'));assert.ok(text.includes('UNKNOWN_PRICE'));assert.ok(text.includes('0.12'));
});
test('export totals cannot silently count duplicate or alternative rows twice',()=>{
 const repeated=csv([letterDraftRows[0],letterDraftRows[0]]);assert.ok(repeated.includes('0.04'));assert.ok(!repeated.includes('0.08'));
 const alternatives=csv(letterDraftRows.slice(0,2).map(row=>({...row,contradiction_id:'same-finding'})));assert.ok(alternatives.includes('חלופות'));assert.ok(!alternatives.includes('0.08'));
});
registerHooks({load(url,context,next){if(url.endsWith('/src/utils/supabase/server.ts'))return {format:'module',shortCircuit:true,source:'export async function createClient(){return globalThis.__letterExportClient;}'};return next(url,context);}});
const {GET}=await import('../src/app/api/export/route.ts');
test('the actual export route reads only and emits the same CSV builder result',async()=>{
 const calls=[];const base={id:'base',type:'BASE_CONTRACT',source:'BOQ',quantity:1,unit_price_excl_vat:100,vat_rate:.18,evidence_data:{source:'pricelist_items',pricelist_item_id:'synthetic-boq'}};
 const rows=[base,...letterDraftRows];
 globalThis.__letterExportClient={auth:{getUser:async()=>({data:{user:{id:'synthetic-owner'}}})},
  rpc(){throw Error('Unexpected synchronization');},from(table){calls.push(table);if(!['projects','pricing_ledger'].includes(table))throw Error('Unexpected read/write synchronization');
   const q={select(){return q;},eq(){return q;},order(){return q;},maybeSingle(){return q;},
    insert(){throw Error('WRITE_IN_READ');},update(){throw Error('WRITE_IN_READ');},upsert(){throw Error('WRITE_IN_READ');},delete(){throw Error('WRITE_IN_READ');},
    then(resolve,reject){return Promise.resolve({data:table==='projects'?{id:'project',budget:999}:rows,error:null}).then(resolve,reject);}};return q;}};
 const response=await GET(new Request('http://localhost/api/export?projectId=project&format=csv'));assert.equal(response.status,200);
 assert.equal((await response.text()).replace(/^\uFEFF/,''),csv(rows,999).replace(/^\uFEFF/,''));assert.ok(calls.every(table=>['projects','pricing_ledger'].includes(table)));
});
