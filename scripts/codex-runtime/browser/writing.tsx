import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import SmartLetterGenerator from '@/components/features/SmartLetterGenerator';
import AIConsultant from '@/components/features/AIConsultant';
const project='20000000-0000-4000-8000-000000000001';
function Harness(){const [view,setView]=useState('letter');return <><aside style={{padding:16,background:'#fff1aa',color:'#181818'}}><strong>Проверочный стенд — только вымышленные данные. Ответ модели заменён фикстурой.</strong><nav><button onClick={()=>setView('letter')}>Проверка письма</button><button onClick={()=>setView('consultant')}>Проверка консультанта</button><button onClick={()=>void fetch('/fixture/release',{method:'POST'})}>Завершить вымышленный ответ</button></nav></aside>{view==='letter'?<SmartLetterGenerator projectId={project} initialSelectedItems={[1,2,3].map(index=>'30000000-0000-4000-8000-'+String(index).padStart(12,'0'))}/>:<AIConsultant projectId={project}/>}</>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
