import { createClient } from '@/utils/supabase/server';
import PricingClient from '@/components/pricing/PricingClient';
import { Calculator } from 'lucide-react';
import { redirect } from 'next/navigation';

export default async function PricingPage({ params }: { params: { id: string } }) {
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
        .eq('project_id', params.id)
        .eq('pricing_status', 'PENDING')
        .order('created_at', { ascending: false });

    // Fetch initial Ledger (Priced items)
    const { data: ledgerData } = await supabase
        .from('pricing_ledger')
        .select('*')
        .eq('project_id', params.id)
        .order('created_at', { ascending: true });

    return (
        <div className="p-8 pb-0 pt-6 flex-1 flex flex-col max-w-[1600px] w-full mx-auto" dir="rtl">
            <header className="mb-6 flex justify-between items-end shrink-0">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
                        <Calculator className="w-8 h-8 text-primary" />
                        תמחור
                    </h1>
                    <p className="text-gray-400 text-sm mt-2 max-w-3xl">
                        כאן מתרגמים את סתירות הרדאר לכסף. המערכת מחשבת מחירים ממחירוני חוזה/דקל, או מסייעת בניתוח מחיר ידני. כל הסכומים כאן הם לפני מע"מ.
                    </p>
                </div>
            </header>

            {/* Client App Container */}
            <PricingClient
                projectId={params.id}
                initialQueue={queueData || []}
                initialLedger={ledgerData || []}
            />
        </div>
    );
}
