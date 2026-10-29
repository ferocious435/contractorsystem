import { createClient } from '@/utils/supabase/server';
import { createLetterHttpHandlers } from '@/utils/letter-persistence-server';

const handlers = createLetterHttpHandlers({ createClient });
export const POST = handlers.save;
export const DELETE = handlers.delete;
