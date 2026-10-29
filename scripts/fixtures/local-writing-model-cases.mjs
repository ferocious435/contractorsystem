// Synthetic inputs only. No connection, credentials or working project data.
export async function localWritingModelCases() {
 const {letterDraftProject,letterDraftRows,letterDraftSnapshot}=await import('../redesign/fixtures.mjs');
 const {summarizeIndividualPricing}=await import('../../src/utils/individual-pricing.ts');
 const source={documentId:'40000000-0000-4000-8000-000000000001',title:'הנחיית תיעוד סינתטית.txt',pageLabel:null,
  quote:'יש לתעד את בדיקת הצינור ביומן לפני כיסוי התעלה.',basis:'DOCUMENT',status:'VERIFIED',manualNote:null};
 const snapshot=structuredClone(letterDraftSnapshot);snapshot.items[0].sources=[source];
 const letter={payload:{projectId:letterDraftProject,letterType:'general',recipient:'מפקח סינתטי',subject:'בקשת הנחיה בכתב לתיעוד לפני כיסוי תעלה',
  keyPoints:'לבקש תיאום בדיקה והנחיה בכתב. המקור דורש תיעוד; אין להסיק שכבר בוצעה בדיקה או שאושר תשלום.',tone:'professional',itemIds:snapshot.items.map(item=>item.ledgerItemId)},
  projectName:'פרויקט מקומי סינתטי לבדיקת תיעוד',preview:{snapshot,sourceRevisions:Object.fromEntries(snapshot.items.map(item=>[item.ledgerItemId,'a'.repeat(64)]))}};
 const consultant={context:{project:{id:letterDraftProject,name:'פרויקט מקומי סינתטי לבדיקת תיעוד'},sources:[{...source,sourceId:'S1'}],
  unverified:[{documentId:'40000000-0000-4000-8000-000000000002',reason:'המסמך הסינתטי אינו קריא במלואו: עמוד נוסף דורש בדיקה.'},
   {documentId:'40000000-0000-4000-8000-000000000003',reason:'המקור מסומן כטיוטה ואין אישור נפרד.'}],
  money:{scope:'PROJECT',baseNet:100,variations:summarizeIndividualPricing(letterDraftRows)},omittedCount:1},
  messages:[{role:'user',content:'איך לתעד את בדיקת הצינור לפני הכיסוי, ומה עדיין לא אומת?'}]};
 return {letter,consultant,source};
}
