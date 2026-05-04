import { createClient } from '@/utils/supabase/server';
import PricingClient from '@/components/pricing/PricingClient';
import { Calculator } from 'lucide-react';
import { redirect } from 'next/navigation';

export default async function PricingPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await createClient();

    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    // Fetch initial Queue (Pending Contradictions)
    const { data: queueData } = await supabase
        .from('contradictions')
        .select(`
            *,
            source_execution_doc:source_execution_doc_id(id, title),
            target_contract_doc:target_contract_doc_id(id, title)
        `)
        .eq('project_id', id)
        .eq('pricing_status', 'PENDING')
        .order('created_at', { ascending: false });

    // Fetch initial Ledger (Priced items)
    const { data: ledgerData } = await supabase
        .from('pricing_ledger')
        .select('*')
        .eq('project_id', id)
        .order('created_at', { ascending: true });

    return (
        <div className="p-8 pb-0 pt-6 flex-1 flex flex-col max-w-[1600px] w-full mx-auto relative overflow-hidden" dir="rtl">
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none"></div>
            
            <header className="mb-8 flex justify-between items-end shrink-0 relative z-10">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <div className="w-1.5 h-1.5 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                        <span className="text-[10px] font-mono font-bold text-emerald-500 uppercase tracking-[0.2em]">מסוף_פיננסי_v4.1</span>
                    </div>
                    <h1 className="text-4xl font-black text-white tracking-tighter flex items-center gap-3 font-mono uppercase">
                        ספר_תמחור
                        <span className="text-gray-600 font-sans text-xl font-light">/ תמחור וניהול חריגים</span>
                    </h1>
                    <p className="text-gray-400 text-sm mt-3 max-w-3xl leading-relaxed">
                        מערכת אימות פיננסית מבוססת <span className="text-emerald-500/80 font-mono">Gemini 3 Flash</span>. 
                        כאן מתבצע ניתוח הנדסי של סתירות חוזיות ותרגומן לערך כספי (V.O). 
                        <span className="block mt-1 text-[11px] text-gray-500 uppercase font-mono tracking-wider">הערה: כל הסכומים אינם כוללים מע"מ (18%)</span>
                    </p>
                </div>
                
                <div className="flex gap-4 mb-1">
                    <div className="px-4 py-2 border border-white/5 bg-white/5 rounded-sm flex flex-col items-end">
                        <span className="text-[9px] text-gray-500 uppercase font-mono">סטטוס</span>
                        <span className="text-xs font-bold text-emerald-500 flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                            מערכת_מוכנה
                        </span>
                    </div>
                </div>
            </header>

            {/* Client App Container */}
            <div className="flex-1 min-h-0 relative z-10">
                <PricingClient
                    projectId={id}
                    initialQueue={queueData || []}
                    initialLedger={ledgerData || []}
                />
            </div>
        </div>

    );
}
