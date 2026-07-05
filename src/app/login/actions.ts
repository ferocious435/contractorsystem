'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { LOCAL_ACCESS_COOKIE } from '@/utils/local-access'
import type { SupabaseClient } from '@supabase/supabase-js'

type AuthFormState = {
    error?: string;
    notice?: string;
} | null;

type AuthUserForProfile = {
    id: string;
    user_metadata?: {
        full_name?: string;
        company_name?: string;
    };
};

type AuthErrorDetails = {
    message: string;
    code: string;
    status?: number;
};

function getAuthErrorDetails(error: unknown): AuthErrorDetails {
    if (!error || typeof error !== 'object') {
        return { message: '', code: '' };
    }

    const maybeError = error as { message?: unknown; status?: unknown; code?: unknown };
    return {
        message: typeof maybeError.message === 'string' ? maybeError.message : '',
        code: typeof maybeError.code === 'string' ? maybeError.code : '',
        status: typeof maybeError.status === 'number' ? maybeError.status : undefined,
    };
}

function logAuthError(scope: string, error: unknown) {
    const details = getAuthErrorDetails(error);
    console.error(scope, details.message || 'Unknown auth error', 'Code:', details.code || 'unknown', 'Status:', details.status ?? 'unknown');
}

function firstHeaderValue(value: string | null) {
    return value?.split(',')[0]?.trim() || '';
}

function shouldUseHttpForHost(host: string) {
    return host.startsWith('localhost') || host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

async function getRequestSiteUrl() {
    const headerStore = await headers();
    const host = firstHeaderValue(headerStore.get('x-forwarded-host')) || firstHeaderValue(headerStore.get('host'));

    if (host) {
        const proto = firstHeaderValue(headerStore.get('x-forwarded-proto')) || (shouldUseHttpForHost(host) ? 'http' : 'https');
        return proto + '://' + host;
    }

    return process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001';
}
async function ensureUserProfile(
    user: AuthUserForProfile,
    supabase: SupabaseClient,
    fallback?: { fullName?: string; companyName?: string }
) {
    const fullName = fallback?.fullName || user.user_metadata?.full_name || 'Contractor';
    const companyName = fallback?.companyName || user.user_metadata?.company_name || null;

    const profilePayload = {
        id: user.id,
        full_name: fullName,
        company_name: companyName,
        role: 'contractor',
    };

    const { data: existingProfile, error: lookupError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle();

    if (!lookupError && existingProfile) return;

    if (!lookupError) {
        const { error: userInsertError } = await supabase
            .from('profiles')
            .insert(profilePayload);

        if (!userInsertError) return;
        console.warn('[Auth] User-scoped profile insert failed, trying admin fallback:', userInsertError.message);
    } else {
        console.warn('[Auth] User-scoped profile lookup failed, trying admin fallback:', lookupError.message);
    }

    try {
        const supabaseAdmin = createAdminClient();
        const { data: adminProfile, error: adminLookupError } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .maybeSingle();

        if (adminLookupError) {
            console.warn('[Auth] Admin profile lookup failed:', adminLookupError.message);
            return;
        }

        if (adminProfile) return;

        const { error: adminInsertError } = await supabaseAdmin
            .from('profiles')
            .insert(profilePayload);

        if (adminInsertError) {
            console.warn('[Auth] Admin profile insert failed:', adminInsertError.message);
        }
    } catch (error) {
        const details = getAuthErrorDetails(error);
        console.warn('[Auth] Profile setup skipped:', details.message || 'Admin client unavailable');
    }
}


function isAuthServiceUnavailable(error: unknown) {
    const details = getAuthErrorDetails(error);
    const message = details.message.toLowerCase();
    const code = details.code.toLowerCase();

    return (
        details.status === 0 ||
        code.includes('fetch') ||
        message.includes('fetch failed') ||
        message.includes('network') ||
        message.includes('enotfound')
    );
}

function authServiceUnavailableMessage() {
    return 'מערכת ההזדהות לא זמינה כרגע. זה לא אומר שהסיסמה שגויה. נסה שוב אחרי חיבור Supabase תקין.';
}
export async function login(prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
    const supabase = await createClient()

    const email = String(formData.get('email') || '')
    const password = String(formData.get('password') || '')

    const { data, error } = await supabase.auth.signInWithPassword({ email, password }).catch((error: unknown) => ({
        data: null,
        error,
    }))

    if (error) {
        const details = getAuthErrorDetails(error);
        logAuthError('[Auth:Login] Supabase Error:', error)
        if (isAuthServiceUnavailable(error)) {
            return { error: authServiceUnavailableMessage() }
        }
        if (
            details.code === 'invalid_credentials' ||
            details.message.toLowerCase().includes('invalid login credentials') ||
            details.message.toLowerCase().includes('invalid credentials')
        ) {
            return { error: 'Email או סיסמה שגויים. אם עדיין אין חשבון, עבור להרשמה.' }
        }
        return { error: 'לא ניתן להתחבר כרגע. נסה שוב בעוד רגע.' }
    }

    if (data?.user) {
        await ensureUserProfile(data.user, supabase)
        const cookieStore = await cookies()
        cookieStore.delete(LOCAL_ACCESS_COOKIE)
        revalidatePath('/', 'layout')
        redirect('/')
    }

    return { error: 'אירעה שגיאה לא צפויה בכניסה.' }
}


export async function sendMagicLink(prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
    const supabase = await createClient()
    const email = String(formData.get('email') || '').trim()

    if (!email) {
        return { error: 'הכנס כתובת דוא"ל כדי לקבל קישור כניסה.' }
    }
    const siteUrl = await getRequestSiteUrl();

    const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
            shouldCreateUser: false,
            emailRedirectTo: `${siteUrl}/auth/callback`,
        },
    }).catch((error: unknown) => ({ error }))

    if (error) {
        logAuthError('[Auth:MagicLink] Supabase Error:', error)
        if (isAuthServiceUnavailable(error)) {
            return { error: authServiceUnavailableMessage() }
        }
        return { error: 'לא ניתן לשלוח קישור כניסה כרגע. בדוק את הדוא"ל ונסה שוב.' }
    }

    return { notice: 'שלחנו קישור כניסה לדוא"ל. פתח אותו מהמכשיר הזה כדי להיכנס בלי סיסמה.' }
}
export async function signup(prevState: AuthFormState, formData: FormData): Promise<AuthFormState> {
    const supabase = await createClient()

    const email = String(formData.get('email') || '')
    const password = String(formData.get('password') || '')
    const fullName = String(formData.get('full_name') || '').trim()
    const companyName = String(formData.get('company_name') || '').trim()

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: fullName,
                company_name: companyName,
            }
        }
    }).catch((error: unknown) => ({
        data: null,
        error,
    }))

    if (error) {
        logAuthError('[Auth:Signup] Supabase Error:', error)
        if (isAuthServiceUnavailable(error)) {
            return { error: authServiceUnavailableMessage() }
        }
        return { error: 'לא ניתן ליצור חשבון כרגע. בדוק את הפרטים ונסה שוב.' }
    }

    if (data?.user) {
        await ensureUserProfile(data.user, supabase, { fullName, companyName })
    }

    if (!data?.session) {
        return { notice: 'החשבון נוצר. בדוק את תיבת הדואר ואשר את ההרשמה לפני הכניסה.' }
    }

    revalidatePath('/', 'layout')
    redirect('/')
}

export async function logout() {
    const supabase = await createClient()
    await supabase.auth.signOut()

    revalidatePath('/', 'layout')
    redirect('/login')
}
