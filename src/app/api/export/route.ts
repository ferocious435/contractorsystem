import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

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

        // Check auth
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Fetch data
        const { data, error } = await supabase
            .from('pricing_ledger')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Export error:', error);
            return NextResponse.json({ error: 'Failed to fetch ledger data' }, { status: 500 });
        }

        if (!data || data.length === 0) {
            return new NextResponse('No data found for project', { status: 404 });
        }

        // Build CSV with Hebrew headers (PRD Requirement)
        const headers = [
            'סוג', // Type
            'סעיף', // Item Code
            'תיאור', // Description
            'יחידה', // Unit
            'כמות', // Quantity
            'מחיר יחידה ללא מע"מ', // Unit Price Excl VAT
            'סה"כ ללא מע"מ', // Total Price Excl VAT
            'אחוז רווח', // Markup %
            'סכום מע"מ', // VAT Amount
            'סה"כ כולל מע"מ' // Total Price Incl VAT
        ];

        const getTypeLabel = (type: string) => {
            switch (type) {
                case 'BASE_CONTRACT': return 'חוזה בסיס';
                case 'APPROVED_VO': return 'חריג מאושר';
                case 'PENDING_VO': return 'חריג בהמתנה';
                default: return type;
            }
        };

        const rows = data.map(item => [
            getTypeLabel(item.type),
            item.item_code || '',
            `"${(item.description || '').replace(/"/g, '""')}"`, // escape quotes for CSV
            item.unit || '',
            item.quantity || 0,
            item.unit_price_excl_vat || 0,
            item.total_price_excl_vat || 0,
            item.markup_percentage || 0,
            item.vat_amount || 0,
            item.total_price_incl_vat || 0
        ]);

        const totalBaseExclVat = data.filter(i => i.type === 'BASE_CONTRACT').reduce((sum, i) => sum + Number(i.total_price_excl_vat || 0), 0);
        const totalVOExclVat = data.filter(i => i.type !== 'BASE_CONTRACT').reduce((sum, i) => sum + Number(i.total_price_excl_vat || 0), 0);
        const grandTotalExclVat = totalBaseExclVat + totalVOExclVat;
        const grandTotalVat = data.reduce((sum, i) => sum + Number(i.vat_amount || 0), 0);
        const grandTotalInclVat = data.reduce((sum, i) => sum + Number(i.total_price_incl_vat || 0), 0);

        rows.push(['', '', '', '', '', '', '', '', '', '']); // Empty row separator
        rows.push(['סה"כ חוזה בסיס ללא מע"מ', '', '', '', '', '', totalBaseExclVat, '', '', '']);
        rows.push(['סה"כ חריגים ושינויים ללא מע"מ', '', '', '', '', '', totalVOExclVat, '', '', '']);
        rows.push(['סה"כ הכל ללא מע"מ', '', '', '', '', '', grandTotalExclVat, '', '', '']);
        rows.push(['סה"כ מע"מ', '', '', '', '', '', '', '', grandTotalVat, '']);
        rows.push(['סה"כ כולל מע"מ', '', '', '', '', '', '', '', '', grandTotalInclVat]);

        const csvContent = [
            headers.join(','),
            ...rows.map(r => r.join(','))
        ].join('\n');

        // Include BOM for Excel Hebrew support
        const bom = '\uFEFF';

        return new NextResponse(bom + csvContent, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="ledger_${projectId}.csv"`,
            }
        });
    } catch (err: any) {
        console.error('Export API error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
