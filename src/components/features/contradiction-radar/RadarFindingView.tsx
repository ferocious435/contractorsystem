"use client";

import type { ReactNode } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import type { ContradictionItem } from '@/types';
import { Button } from '@/components/ui/titanium/Button';
import { BidiText } from '@/components/ui/titanium/BidiText';
import { StatusChip } from '@/components/ui/titanium/StatusChip';
import { getRadarFindingKind,getRadarFindingReference } from './utils/findingClassification';
import { getEvidenceDisplayStatus,evidenceStatusLabel } from './utils/evidenceVerification';

export interface RadarFindingViewProps {
  item:ContradictionItem; idx:number; isExpanded:boolean; isItemRescanning:boolean; isScanning:boolean; aiAvailable:boolean; shouldAnimate:boolean;
  onToggleExpand(id:string):void; onRescanItem(id:string,executionDocId?:string):void;
  onUpdateStatus(id:string,newStatus:string,item?:ContradictionItem):Promise<boolean>; onDelete(id:string,confirmed?:boolean):Promise<boolean>;
  onNavigate?(view:string,params?:Record<string,unknown>):void; onRadarOpenDocument(documentId?:string|null,page?:number|string|null):void; children?:ReactNode;
}
export function cleanRadarDisplayText(text?:string|null) {return String(text||'').replace(/Powered by[^\n.]*/gi,'').replace(/CONFIDENCE:\s*\d+%/gi,'').replace(/CONTRACT[_\s-]*VS[_\s-]*EXECUTION/gi,'').replace(/\s{2,}/g,' ').trim();}
export async function moveFindingToPricing(item:ContradictionItem,onUpdateStatus:RadarFindingViewProps['onUpdateStatus'],onNavigate?:RadarFindingViewProps['onNavigate']) {
  const updated=await onUpdateStatus(item.id,'MOVED_TO_PRICING',item);
  if(updated && onNavigate)onNavigate('pricing',{estimateId:item.id,entryPoint:'contradiction-radar',returnTo:'radar',contradictionTitle:cleanRadarDisplayText(item.title),contradictionSummary:cleanRadarDisplayText(item.description),sourceDocTitle:item.source_doc?.title||'',targetDocTitle:item.target_doc?.title||''});
  return updated;
}
const kindLabels={CONTRADICTION:'סתירה מהותית',VARIATION:'שינוי או חריג',MISSING_INFO:'חוסר נתונים',NO_DIRECT_MATCH:'אין התאמה ישירה',SITE_EVENT:'אירוע שטח'};
export function RadarFindingView({item,isExpanded,isItemRescanning,isScanning,aiAvailable,onToggleExpand,onRescanItem,children}:RadarFindingViewProps) {
  const evidenceStatus=getEvidenceDisplayStatus(item.evidence_data),kind=getRadarFindingKind(item),detailsId=`radar-details-${item.id}`;
  const repeatedCount=Array.isArray(item.evidence_data?.repeated_history)?item.evidence_data.repeated_history.length:0;
  return <article className="ti-radar-finding" data-evidence-status={evidenceStatus} data-expanded={isExpanded || undefined}>
    <header className="ti-radar-finding__header"><div className="ti-radar-finding__main"><div className="ti-radar-finding__chips"><StatusChip tone="neutral"><BidiText kind="code" value={getRadarFindingReference(item)}/></StatusChip><StatusChip tone={kind==='MISSING_INFO'?'warning':'info'}>{kindLabels[kind]}</StatusChip><StatusChip tone={evidenceStatus==='SOURCE_VERIFIED'?'success':'warning'}>{evidenceStatusLabel(evidenceStatus)}</StatusChip></div>
      {repeatedCount>1&&<StatusChip tone="info">חזר ב־{repeatedCount} פרוטוקולים</StatusChip>}<h2 className="ti-section-title"><button className="ti-radar-expand" type="button" aria-expanded={isExpanded} aria-controls={detailsId} onClick={()=>onToggleExpand(item.id)}>{cleanRadarDisplayText(item.title)}<ChevronDown size={18} aria-hidden="true"/></button></h2><p className="ti-radar-finding__summary">{cleanRadarDisplayText(item.description)}</p>
    </div><Button onClick={()=>onRescanItem(item.id,item.source_execution_doc_id)} disabled={isScanning||!aiAvailable} pending={isItemRescanning} busyLabel="בודק מחדש…" disabledReason={!aiAvailable?'שירות הניתוח אינו זמין. המקורות והממצאים השמורים נשארים נגישים.':undefined}><RefreshCw size={16} aria-hidden="true"/>בדיקה מחדש</Button></header>
    <div id={detailsId} hidden={!isExpanded} className="ti-radar-finding__details">{isExpanded && children}</div>
  </article>;
}
