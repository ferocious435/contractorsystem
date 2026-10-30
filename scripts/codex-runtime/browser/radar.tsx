import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import LocalAiCheckClient from '@/app/local-ai-check/LocalAiCheckClient';
import {useContradictionRadarState} from '@/components/features/contradiction-radar/hooks/useContradictionRadarState';
import {RadarWorkspaceView} from '@/components/features/contradiction-radar/RadarWorkspaceView';
function Radar(){return <RadarWorkspaceView {...useContradictionRadarState({projectId:'30000000-0000-4000-8000-000000000003',projectName:'פרויקט סינתטי'})}/>;}
function Harness(){const [view,setView]=useState('preview');return <><aside style={{padding:16,background:'#fff1aa',color:'#181818'}}><strong>Проверочный стенд — только вымышленные данные. Ответ модели заменён фикстурой.</strong><nav><button onClick={()=>{location.hash='preview';setView('preview');}}>Проверка одной карточки</button><button onClick={()=>{location.hash='radar';setView('radar');}}>Проверка радара</button><button onClick={()=>void fetch('/fixture/release',{method:'POST'})}>Завершить вымышленный ответ</button><a href="/fixture/stats" target="_blank" rel="noreferrer">Состояние вымышленного стенда</a></nav></aside>{view==='preview'?<LocalAiCheckClient findingRef="C-500000"/>:<Radar/>}</>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
