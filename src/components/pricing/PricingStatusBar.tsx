"use client";
import { VAT_RATE } from '@/utils/constants';
import { useAiReadiness } from '@/hooks/useAiReadiness';
import { BidiText } from '@/components/ui/titanium/BidiText';
export default function PricingStatusBar({ projectId }: {
    projectId: string;
}) { const status = useAiReadiness(); return <footer className="ti-pricing-status" data-project-id={projectId}><span>סכומי הטבלה ללא מע״מ · מע״מ <BidiText kind="percent" value={(VAT_RATE * 100).toFixed(2) + '%'}/> בנפרד</span><span>חיבור העוזר: {status === null ? 'בודק זמינות…' : status.available ? 'זמין' : 'אינו זמין כרגע'}</span></footer>; }
