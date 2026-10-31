import {createClient} from '@/utils/supabase/server';
import {createCorrespondenceHandlers} from '@/utils/correspondence-server';
const handlers=createCorrespondenceHandlers(createClient);
export const GET=handlers.get;
export const POST=handlers.post;
