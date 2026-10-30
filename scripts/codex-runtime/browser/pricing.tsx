import React from 'react';
import {createRoot} from 'react-dom/client';
import AIEstimatorModal from '@/components/pricing/AIEstimatorModal';
import WorkChangeReviewPanel from '@/components/pricing/WorkChangeReviewPanel';
import type {ContradictionItem} from '@/types';
const projectId='30000000-0000-4000-8000-000000000003',findingId='50000000-0000-4000-8000-000000000001';
function Fixture(){const [view,setView]=React.useState<'pricing'|'work_change'|null>('pricing');return <main><p>Вымышленный пример. Настоящие документы и деньги не изменяются.</p><nav><button onClick={()=>setView('pricing')}>Расценка</button><button onClick={()=>setView('work_change')}>Изменение работ</button><button onClick={()=>void fetch('/fixture/release',{method:'POST'})}>Завершить учебный ответ</button></nav>{view==='pricing'&&<AIEstimatorModal contradiction={{id:findingId,project_id:projectId,title:'אספקה ופיזור חומר מילוי',description:'דוגמה סינתטית בלבד'} as ContradictionItem} onClose={()=>setView(null)} onApprove={async()=>{throw Error('Real financial writes are forbidden in this fixture');}}/>}{view==='work_change'&&<WorkChangeReviewPanel findingId={findingId} projectId={projectId} onClose={()=>setView(null)}/>}</main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
