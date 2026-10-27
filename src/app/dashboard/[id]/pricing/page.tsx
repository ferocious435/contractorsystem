import { createClient } from '@/utils/supabase/server';
import PricingLedgerUI from '@/components/features/PricingLedgerUI';
import { redirect } from 'next/navigation';
export default async function PricingPage({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = await params;
    const supabase = await createClient();
    // Auth Check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user)
        redirect('/login');
    const { data: project } = await supabase
        .from('projects')
        .select('id')
        .eq('id', id)
        .eq('contractor_id', user.id)
        .maybeSingle();
    if (!project)
        redirect('/login');
    return <div className="titanium-theme ti-pricing-route" dir="rtl"><PricingLedgerUI projectId={id} /></div>;
}
