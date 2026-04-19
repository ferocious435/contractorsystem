import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { contradictionText } = await req.json();

        // Mock AI calculation delay
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Generate some mock estimated amounts based on text length to make it look dynamic
        const baseAmount = Math.floor(Math.random() * 5000) + 1000;
        const aiExplanation = `According to standard Israeli construction rates (Dekel), the contradiction involving "${contradictionText?.substring(0, 30)}..." implies additional labor and materials. We estimate ~2 work days plus materials.`;

        return NextResponse.json({
            estimated_amount: baseAmount,
            ai_explanation: aiExplanation,
        });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
