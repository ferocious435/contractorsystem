import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { VAT_RATE } from '@/utils/constants';
import { syncProjectContractBase } from '@/utils/project-contract-base-server';
import { syncContractBoqToLedger } from '@/utils/pricing-ledger-contract-sync';
import {
    getAmountVat,
    getLedgerRowAmount,
    getLedgerRowTotalInclVat,
    getLedgerRowVatAmount,
    getMoneySum,
    getPreferredProjectAmount,
    getVariationOrderAmount,
    isVisibleLedgerRow,
} from '@/utils/project-financials';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const format = searchParams.get('format');

    if (!projectId) {
        return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }

    if (format !== 'csv') {
        return NextResponse.json({ error: 'Unsupported format' }, { status: 400 });
    }

    try {
        const supabase = await createClient();

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: ownedProject, error: ownershipError } = await supabase
            .from('projects')
            .select('id')
            .eq('id', projectId)
            .eq('contractor_id', user.id)
            .maybeSingle();

        if (ownershipError) {
            console.error('Export project error:', ownershipError);
            return NextResponse.json({ error: 'Failed to fetch project data' }, { status: 500 });
        }

        if (!ownedProject) {
            return NextResponse.json({ error: 'Project not found or forbidden' }, { status: 403 });
        }

        await syncProjectContractBase(supabase, projectId);
        await syncContractBoqToLedger(supabase, projectId, { contractorId: user.id });

        const [{ data, error }, { data: project, error: projectError }] = await Promise.all([
            supabase
                .from('pricing_ledger')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: true }),
            supabase
                .from('projects')
                .select('budget')
                .eq('id', projectId)
                .eq('contractor_id', user.id)
                .maybeSingle(),
        ]);

        if (error) {
            console.error('Export error:', error);
            return NextResponse.json({ error: 'Failed to fetch ledger data' }, { status: 500 });
        }

        if (projectError || !project) {
            console.error('Export project error:', projectError);
            return NextResponse.json({ error: 'Failed to fetch project data' }, { status: 500 });
        }

        if (!data || data.length === 0) {
            return new NextResponse('No data found for project', { status: 404 });
        }

        const visibleRows = data.filter(isVisibleLedgerRow);

        const headers = [
            'סוג',
            'סעיף',
            'תיאור',
            'יחידה',
            'כמות',
            'מחיר יחידה ללא מע"מ',
            'סה"כ ללא מע"מ',
            'אחוז רווח',
            'סכום מע"מ',
            'סה"כ כולל מע"מ',
        ];

        const getTypeLabel = (type: string) => {
            switch (type) {
                case 'BASE_CONTRACT':
                    return 'חוזה בסיס';
                case 'APPROVED_VO':
                    return 'חריג מאושר';
                case 'PENDING_VO':
                    return 'חריג לבדיקה';
                case 'SENT_VO':
                    return 'נשלח לדרישה';
                default:
                    return type;
            }
        };

        const rows = visibleRows.map((item) => [
            getTypeLabel(item.type),
            item.item_code || '',
            `"${(item.description || '').replace(/"/g, '""')}"`,
            item.unit || '',
            item.quantity || 0,
            item.unit_price_excl_vat || 0,
            getLedgerRowAmount(item),
            item.markup_percentage || 0,
            getLedgerRowVatAmount(item, VAT_RATE),
            getLedgerRowTotalInclVat(item, VAT_RATE),
        ]);

        const totalBaseExclVat = getPreferredProjectAmount(project?.budget, data);
        const totalVOExclVat = getVariationOrderAmount(visibleRows);
        const grandTotalExclVat = getMoneySum([totalBaseExclVat, totalVOExclVat]);
        const totalBaseVat = getAmountVat(totalBaseExclVat, VAT_RATE);
        const totalVoVat = visibleRows
            .filter((item) => item.type !== 'BASE_CONTRACT')
            .reduce((sum, item) => getMoneySum([sum, getLedgerRowVatAmount(item, VAT_RATE)]), 0);
        const grandTotalVat = getMoneySum([totalBaseVat, totalVoVat]);
        const grandTotalInclVat = getMoneySum([grandTotalExclVat, grandTotalVat]);

        rows.push(['', '', '', '', '', '', '', '', '', '']);
        rows.push(['סה"כ חוזה בסיס ללא מע"מ', '', '', '', '', '', totalBaseExclVat, '', '', '']);
        rows.push(['סה"כ חריגים ושינויים ללא מע"מ', '', '', '', '', '', totalVOExclVat, '', '', '']);
        rows.push(['סה"כ הכל ללא מע"מ', '', '', '', '', '', grandTotalExclVat, '', '', '']);
        rows.push(['סה"כ מע"מ', '', '', '', '', '', '', '', grandTotalVat, '']);
        rows.push(['סה"כ כולל מע"מ', '', '', '', '', '', '', '', '', grandTotalInclVat]);

        const csvContent = [
            headers.join(','),
            ...rows.map((row) => row.join(',')),
        ].join('\n');

        const bom = '\uFEFF';

        return new NextResponse(bom + csvContent, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="ledger_${projectId}.csv"`,
            },
        });
    } catch (err: unknown) {
        console.error('Export API error:', err);
        const message = err instanceof Error ? err.message : 'Export failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
