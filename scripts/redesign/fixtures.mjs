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
