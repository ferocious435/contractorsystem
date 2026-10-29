import { createClient } from '@/utils/supabase/server';
import { createLetterHttpHandlers } from '@/utils/letter-persistence-server';

export const POST = createLetterHttpHandlers({ createClient }).preview;
