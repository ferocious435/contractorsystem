"use client";
import {useContradictionRadarState} from './contradiction-radar/hooks/useContradictionRadarState';
import {RadarWorkspaceView} from './contradiction-radar/RadarWorkspaceView';
interface ContradictionRadarProps {projectId:string;projectName?:string;onNavigate?:(view:string,params?:Record<string,unknown>)=>void;}
export default function ContradictionRadar({projectId,projectName,onNavigate}:ContradictionRadarProps){const radar=useContradictionRadarState({projectId,projectName});return <RadarWorkspaceView {...radar} onNavigate={onNavigate}/>;}
