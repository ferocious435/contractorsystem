import {NextRequest,NextResponse} from 'next/server';
import {requireOwnedProject,requireUser} from '@/app/api/_utils/auth';
import {createClient} from '@/utils/supabase/server';
import {createOwnedAiJob,getAiJobService,readAiRequest} from '@/server/ai/service.server';
import {loadProjectScanState} from '@/server/ai/radar-service.server';
import {reviewSavedRadarFindings} from '@/utils/radar-saved-finding-review-server';
import {refreshSavedIssueHistories} from '@/utils/radar-issue-history-server';
import {reconcileSavedIssueRecords} from '@/utils/scan-finding-retention';
import {BusinessAiError,record} from '@/server/ai/contracts';
export const maxDuration=600;
export const dynamic='force-dynamic';
function failure(error:unknown){const known=error instanceof BusinessAiError?error:new BusinessAiError('AI_UNAVAILABLE');return NextResponse.json({success:false,error:known.message,code:known.code},{status:known.status});}
export async function GET(req:NextRequest){try{
    const params=new URL(req.url).searchParams,projectId=params.get('projectId'),workDocId=params.get('workDocId');if(!projectId)return NextResponse.json({error:'projectId is required'},{status:400});
    const client=await createClient(),ownership=await requireOwnedProject(client,projectId);if(!ownership.ok)return ownership.response;
    const status=await loadProjectScanState(client,projectId,workDocId);
    const jobsResponse=await getAiJobService().list(new Request(new URL('/api/ai/jobs?'+new URLSearchParams({projectId,kind:'scan',...(workDocId?{clientContextId:workDocId}:{})}),req.url),{headers:req.headers}));
    const saved=jobsResponse.ok?await jobsResponse.json():null;
    const job=saved?.jobs?.[0]||null,active=job?.state==='QUEUED'||job?.state==='RUNNING';
    const stopped=['FAILED','CANCELLED','INTERRUPTED'].includes(job?.state);
    return NextResponse.json({success:true,...status,job,active:Boolean(active),...(active?{status:job.state,currentStep:'העוזר בודק את המסמכים…'}:stopped?{status:job.state,errorMessage:job.error?.message||'הבדיקה לא הושלמה. אפשר לנסות שוב.'}:{})});
}catch(error){return failure(error);}}
export async function POST(req:NextRequest){try{
    const supabase=await createClient(),auth=await requireUser(supabase);if(!auth.ok)return auth.response;
    const body=await readAiRequest(req),{projectId,force=false,workDocId=null,background=false,retrySkipped=false}=body;
    if(typeof projectId!=='string')return NextResponse.json({error:'projectId is required'},{status:400});
    const ownership=await requireOwnedProject(supabase,projectId);if(!ownership.ok)return ownership.response;
    const retryDocumentId=typeof body.retryDocumentId==='string'?body.retryDocumentId:null;
        if (body.reconcileSavedOnly === true && body.revalidateSavedOnly !== true) {
            return NextResponse.json({ success: false, error: 'Reconciliation requires saved-evidence mode' }, { status: 400 });
        }

        if (body.revalidateSavedOnly === true) {
            if (background || force || retrySkipped) {
                return NextResponse.json({ success: false, error: 'Saved-evidence review cannot run together with scanning' }, { status: 409 });
            }
            if (body.reconcileSavedOnly === true) {
                if (typeof body.issueId !== 'string' || !body.issueId || workDocId || retryDocumentId || body.issueHistoryOnly) {
                    return NextResponse.json({ success: false, error: 'A single saved issue is required for reconciliation' }, { status: 400 });
                }
                const reconciliation = await reconcileSavedIssueRecords(supabase, projectId, { seedId: body.issueId, apply: body.apply === true });
                return NextResponse.json({ success: true, ...reconciliation, scanned: 0 });
            }
            if (body.issueHistoryOnly === true) {
                const history = await refreshSavedIssueHistories(supabase, projectId);
                return NextResponse.json({ success: true, historyUpdated: history.updated, scanned: 0,
                    message: `היסטוריית MTM ובסיס הדרישות נבדקו מול המסמכים השמורים. סריקה חדשה לא הופעלה. עודכנו ${history.updated} כרטיסים.` });
            }
            if (workDocId || retryDocumentId) return NextResponse.json({ success: false, error: 'Saved review accepts finding IDs only' }, { status: 400 });
            const review = await reviewSavedRadarFindings(supabase, projectId, {
                findingIds: body.findingIds as string[]|undefined, apply: body.apply === true, reviewToken: body.reviewToken as string|undefined,
            });
            return NextResponse.json({ success: true, ...review, scanned: 0,
                message: body.apply === true
                    ? `הבדיקה עודכנה: ${review.confirmed} סתירות מבוססות, ${review.requiresReview} שאלות לבירור ו־${review.excluded} השוואות טכניות שהוחרגו. המסמכים, החישובים וההיסטוריה נשמרו.`
                    : 'תוצאות הבדיקה מוכנות; הנתונים טרם שונו.' });
        }


    if(!record(body))throw new BusinessAiError('AI_INPUT_INVALID',undefined,400);
    return createOwnedAiJob(req,'scan',body);
}catch(error){return failure(error);}}
