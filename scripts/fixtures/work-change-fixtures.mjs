import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// These are synthetic program checks, not model-quality scores or real project cases.
export const finding = () => ({ id: 'change', project_id: 'project', title: 'שינוי שיטת ביצוע ברחוב הרימון',
  status: 'OPEN', description: 'החלפת דחיקת צנרת בשיטת קידוח אופקי', source_execution_doc_id: 'primary',
  target_contract_doc_id: 'contract', evidence_data: { work_quote: 'ברחוב הרימון יוחלף קו GRP בשיטת קידוח אופקי.' } });
export const document = (id, text, extra = {}) => ({ id, project_id: 'project', title: `${id}.txt`,
  category: 'EXECUTION', doc_type: 'letter', extracted_text: text, ocr_status: 'COMPLETED', parsed_json: {},
  storage_path: `${id}.txt`, storage_bucket: 'documents', file_url: null, content_hash: null,
  extracted_text_hash: null, processed_at: null, deleted_at: null, ...extra });
export const sourceDocuments = () => [
  document('primary', 'ברחוב הרימון יוחלף קו GRP בשיטת קידוח אופקי. ראו סעיפים 62.04.0012 ו-62.04.0013 בכתב הכמויות.'),
  document('proposal', 'הצעת מחיר לקידוח אופקי ברחוב הרימון. אורך קידוח 80 מטר. מחיר כולל 240000 ש"ח ללא מע"מ.'),
  document('protocol', 'תאריך: 12.03.2025\nקידוח אופקי ברחוב הרימון: הוחלט לבדוק את ההצעה. טרם סוכם המחיר.'),
  document('boq', '62.04.0012 דחיקת צנרת GRP. הכמות 100 מטר, מחיר 2000 ש"ח למטר ללא מע"מ.', { category: 'CONTRACT', doc_type: 'boq' }),
  document('contract', 'חוזה הפרויקט: שינוי שיטת העבודה מחייב אישור; הצעת מחיר אינה אישור לתוספת.', { category: 'CONTRACT', doc_type: 'contract' }),
  document('unrelated', 'עבודות צבע במשרדים ברחוב התאנה. הוחלט לבדוק הצעה אחרת.'),
  document('other-project', 'קידוח אופקי ברחוב הרימון.', { project_id: 'another' }),
  document('deleted', 'קידוח אופקי ברחוב הרימון.', { deleted_at: '2025-01-01' }),
];

export function financialScenario() {
  const item=finding();item.target_contract_doc_id='old';
  const change='ברחוב הרימון הוצע לשנות את שיטת הביצוע מדחיקת צנרת GRP לשיטת קידוח אופקי בצינורות PP.';
  item.evidence_data.work_quote=change;
  return {finding:item,documents:[
    document('primary',change+'\nראו סעיפים 62.04.0012-62.04.0016 בכתב הכמויות. התשלום כפוף לתנאים שיאושרו.'),
    document('old','כתב הכמויות המקורי\n'
      +'62.04.0012 דחיקת צנרת GRP מתוך פיר, אספקת צינורות בנפרד.\nמטר 100 75 7500\n'
      +'62.04.0014 אספקה בלבד של צינורות GRP.\nמטר 100 40 4000\n'
      +'62.04.0016 פיר דחיקה מבטון.\nיחידות 2 1000 2000\n'
      +'סה"כ כללי 13,500.00\nמע"מ 17% 2,295.00\nסה"כ כולל מע"מ 15,795.00',{category:'CONTRACT'}),
    document('offer','קידוח אופקי ברחוב הרימון. בפנייה צוין אומדן של 12,000 ₪ ללא מע"מ. מבוקש סך 14,000 ₪ ללא מע"מ.\n'
      +'הצעת מחיר לחלופה\nהנחה של 15% לביצוע ואספקה; הנחה של 5% לפירים.\n'
      +'71.02.0002 קידוח אופקי ומשיכת צינורות PP, אספקה בנפרד.\nמטר 80 90 7200\n'
      +'71.02.0004 אספקה בלבד של צינורות PP. המחיר ליחידת צינור באורך 0.5 מטר.\nיחידות 160 30 4800\n'
      +'71.02.0006 ביצוע פיר קידוח מבטון.\nיחידות 3 1000 3000\n'
      +'סה"כ עלות 13,050.00\n17% מע"מ בשיעור 2,218.50\nסה"כ כולל מע"מ 15,268.50\n'
      +'הערות\nההצעה מתייחסת לקרקע ללא סלע.\nעל אחריות וחשבון מזמין העבודה:\nדרכי גישה, הסדרי תנועה ואספקת מים.\nמאשר כתב הכמויות'),
    document('designer','קידוח אופקי ברחוב הרימון: שכר טרחה לתכנון 2000 ₪ ללא מע"מ.'),
  ]};
}

export const storageModuleUrl = 'data:text/javascript,' + encodeURIComponent(`
 let entries={}, callback=null; export const calls=[];
 export function reset(values={}, onDownload=null){entries=values;callback=onDownload;calls.length=0;}
 export async function downloadDocumentBuffer(_client, document){calls.push(document.id);if(callback)callback(document);const value=entries[document.id];if(value instanceof Error)throw value;if(!value)throw Error('Fixture storage unavailable');return Buffer.from(value);}
`);
export function registerWorkChangeModules(overrides = {}) {
  return registerHooks({ resolve(specifier, context, next) {
    if (overrides[specifier]) return { url: overrides[specifier], shortCircuit: true };
    if (specifier.startsWith('@/')) return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    try { return next(specifier, context); }
    catch(error) {
      if(error.code==='ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/u.test(specifier)) {
        try { return next(`${specifier}.ts`,context); }
        catch(extensionError) { if(extensionError.code==='ERR_MODULE_NOT_FOUND') return next(`${specifier}.tsx`,context); throw extensionError; }
      }
      throw error;
    }
  } });
}

// Only DB I/O is replaced. Strict table/column guards catch accidental financial writes.
export function workChangeDatabase({ documents = sourceDocuments(), contradictions = [finding()], projects = [{id:'project',contractor_id:'owner'}] } = {}) {
  const tables = structuredClone({ documents, contradictions, projects }); const writes = [], reads = [];
  return { tables, writes, reads, auth:{async getUser(){return{data:{user:{id:'owner'}},error:null};}}, from(table) {
    assert.ok(Object.hasOwn(tables,table), `Unexpected table ${table}`);
    const filters=[]; let columns='*', mutation=null, one=false, bounds=[0,Infinity];
    const q={
      select(value='*'){columns=value;reads.push({table,columns});return q;},
      eq(key,value){filters.push(row=>row[key]===value);return q;}, neq(key,value){filters.push(row=>row[key]!==value);return q;},
      is(key,value){filters.push(row=>row[key]==value);return q;}, in(key,values){filters.push(row=>values.includes(row[key]));return q;},
      order(){return q;}, range(start,end){bounds=[start,end];return q;}, limit(count){bounds[1]=count-1;return q;},
      single(){one=true;return q;}, maybeSingle(){one=true;return q;},
      update(value){
        const allowed=table==='documents'?['extracted_text','ocr_status','content_hash','extracted_text_hash','parsed_json','processed_at']:table==='contradictions'?['evidence_data']:[];
        assert.ok(Object.keys(value).every(key=>allowed.includes(key)),`Unexpected mutation columns for ${table}`);
        mutation=structuredClone(value);return q;
      },
      insert(){throw Error('Unexpected insert');}, upsert(){throw Error('Unexpected upsert');}, delete(){throw Error('Unexpected delete');},
      then(resolve,reject){return Promise.resolve().then(()=>{
        const rows=tables[table].filter(row=>filters.every(filter=>filter(row))).slice(bounds[0],bounds[1]+1);
        if(mutation){writes.push({table,ids:rows.map(row=>row.id),value:structuredClone(mutation)});rows.forEach(row=>Object.assign(row,structuredClone(mutation)));}
        const data=rows.map(row=>columns==='*'?structuredClone(row):Object.fromEntries(columns.split(',').map(key=>[key.trim(),structuredClone(row[key.trim()]??null)])));
        return{data:one?data[0]??null:data,error:null};
      }).then(resolve,reject);},
    };return q;
  } };
}
