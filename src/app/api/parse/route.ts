import {NextResponse} from 'next/server';
import {requireOwnedDocument} from '@/app/api/_utils/auth';
import {createClient} from '@/utils/supabase/server';
import {isLocalUuid, localRequestBody, localWritingFailure} from '@/utils/local-project-context-server';

export async function POST(request: Request) {
    try {
        const client = await createClient(), body = await localRequestBody(request);
        if (!isLocalUuid(body.documentId)) return NextResponse.json({success: false, error: 'documentId is required'}, {status: 400});
        const ownership = await requireOwnedDocument(client, body.documentId, 'id,title');
        if (!ownership.ok) return ownership.response;
        return NextResponse.json({success: false, code: 'LOCAL_FORMAT_UNSUPPORTED', error: 'לפעולה הזאת אין כרגע קורא מקומי מאומת. המסמך לא נשלח לעיבוד ולא השתנה.'}, {status: 422});
    } catch (error) {return localWritingFailure(error);}
}
