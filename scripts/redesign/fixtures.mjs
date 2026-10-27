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
