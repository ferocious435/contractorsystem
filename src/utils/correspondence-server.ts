import type {SupabaseClient} from '@supabase/supabase-js';
import {record,validUuid} from '@/server/ai/contracts';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export function createCorrespondenceHandlers(createClient:()=>Promise<SupabaseClient>){
    const run=(operation:(request:Request,client:SupabaseClient,userId:string)=>Promise<Response>)=>async(request:Request)=>{
        try{const client=await createClient(),{data:{user},error}=await client.auth.getUser();
            if(error||!user)return json({success:false,error:'נדרשת כניסה למערכת.'},401);
            return await operation(request,client,user.id);
        }catch(error){const code=record(error)&&typeof error.code==='string'?error.code:'CORRESPONDENCE_FAILED';
            const status=code==='PT409'?409:code==='PT422'?422:code==='PT400'?400:code==='42501'?403:500;
            return json({success:false,code,error:status===409?'המכתב השתנה. יש לפתוח את הגרסה השמורה לפני שמירה נוספת.':status===422?'אחד המקורות השתנה או שקריאתו לא הושלמה. הטקסט נשמר לעריכה.':'הפעולה לא הושלמה. הטקסט נשאר זמין; אפשר לנסות שוב.'},status);
        }
    };
    return {
        get:run(async(request,client,userId)=>{
            const project=new URL(request.url).searchParams.get('projectId');
            if(!validUuid(project))return json({success:false,error:'פרויקט לא תקין.'},400);
            const owner=await client.from('projects').select('id').eq('id',project).eq('contractor_id',userId).maybeSingle();
            if(owner.error)throw owner.error;if(!owner.data)return json({success:false,error:'הפרויקט אינו זמין בחשבון הזה.'},403);
            const letters:unknown[]=[];
            for(let start=0;;start+=1000){const {data,error}=await client.from('project_correspondence').select('*').eq('project_id',project).order('created_at',{ascending:false}).order('id').range(start,start+999);
                if(error)throw error;letters.push(...data??[]);if(!data||data.length<1000)break;}
            return json({success:true,letters});
        }),
        post:run(async(request,client)=>{
            if(Number(request.headers.get('content-length')||0)>600000)return json({success:false,error:'הפנייה ארוכה מדי.'},400);
            const text=await request.text();if(text.length>600000)return json({success:false,error:'הפנייה ארוכה מדי.'},400);
            let body:unknown;try{body=JSON.parse(text);}catch{return json({success:false,error:'פרטי הבקשה אינם תקינים.'},400);}
            if(!record(body))return json({success:false,error:'פרטי הבקשה אינם תקינים.'},400);
            const {data,error}=await client.rpc('write_project_correspondence',{p:body});if(error)throw error;
            return json({success:true,letter:data});
        }),
    };
}
