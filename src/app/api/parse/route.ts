import {NextResponse} from 'next/server';
import {requireOwnedDocument} from '@/app/api/_utils/auth';
import {createClient} from '@/utils/supabase/server';
import {readAiRequest} from '@/server/ai/service.server';
import {BusinessAiError,validUuid} from '@/server/ai/contracts';

export async function POST(request: Request) {
    try {
        const client = await createClient(), body = await readAiRequest(request);
        if (!validUuid(body.documentId)) return NextResponse.json({success: false, error: 'documentId is required'}, {status: 400});
        const ownership = await requireOwnedDocument(client, body.documentId, 'id,title');
        if (!ownership.ok) return ownership.response;
        return NextResponse.json({success: false, code: 'LOCAL_FORMAT_UNSUPPORTED', error: 'לפעולה הזאת אין כרגע קורא מקומי מאומת. המסמך לא נשלח לעיבוד ולא השתנה.'}, {status: 422});
    } catch (error) {const known=error instanceof BusinessAiError?error:new BusinessAiError('AI_UNAVAILABLE');return NextResponse.json({success:false,code:known.code,error:known.message},{status:known.status,headers:{'Cache-Control':'no-store'}});}
}
