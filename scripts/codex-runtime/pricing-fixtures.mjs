import {pricingDatabase,sourceTables} from '../fixtures/pricing-scope-database.mjs';
import {ownerId} from './fixtures.mjs';
import {projectId} from './queue-fixtures.mjs';
export const pricingIds={finding:'50000000-0000-4000-8000-000000000001',work:'40000000-0000-4000-8000-000000000002',contract:'40000000-0000-4000-8000-000000000001'};
export function pricingRows(){
 const map={p:projectId,owner:ownerId,...pricingIds,dekel:'80000000-0000-4000-8000-000000000001',housing:'80000000-0000-4000-8000-000000000002','fill-price':'81000000-0000-4000-8000-000000000001','same-book-section-note':'81000000-0000-4000-8000-000000000002','neighbour-note':'81000000-0000-4000-8000-000000000003','other-book-note':'81000000-0000-4000-8000-000000000004'};
 const rows=JSON.parse(JSON.stringify(sourceTables()),(_key,value)=>typeof value==='string'&&map[value]?map[value]:value);
 for(const table of Object.keys(rows))for(const row of rows[table])row.xmin='3';
 return {projects:[{id:projectId,contractor_id:ownerId}],vo_letters:[],vo_letter_items:[],document_scan_state:[],...rows};
}
export const pricingReadClient=(rows=pricingRows())=>pricingDatabase(rows);
export function applyPricingEffects(rows,prepared){for(const effect of prepared.effects){const table=effect.type==='SCAN_FINDING'?'contradictions':effect.type==='DOCUMENT_ANALYSIS'?'documents':effect.type==='SCAN_STATE'?'document_scan_state':'pricing_ledger';let row=rows[table].find(item=>item.id===effect.targetId);if(!row){row={id:effect.targetId,project_id:projectId,xmin:'10'};rows[table].push(row);}Object.assign(row,structuredClone(effect.data));}}
