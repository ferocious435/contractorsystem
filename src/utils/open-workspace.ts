import type { SupabaseClient, User } from '@supabase/supabase-js';

export function workspaceEntryRedirectUrl(request: Pick<Request, 'url' | 'headers'>): URL {
    const url = new URL(request.url);
    const host = request.headers.get('host');
    if (host) url.host = host;
    url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url;
}

export async function signInOpenWorkspace(
    sessionClient: SupabaseClient,
    currentUser: User | null,
    createAdmin: () => SupabaseClient,
): Promise<User> {
    const admin = createAdmin();
    const owners = await admin.from('profiles').select('id').eq('role', 'super_admin').limit(2);
    if (owners.error || owners.data?.length !== 1) {
        throw new Error('Open workspace owner could not be established');
    }
    const ownerId = owners.data[0].id;
    if (currentUser && currentUser.id === ownerId) return currentUser;

    const account = await admin.auth.admin.getUserById(ownerId);
    if (account.error || account.data.user?.id !== ownerId || !account.data.user.email) {
        throw new Error('Open workspace account is unavailable');
    }

    // This admin operation creates a server-only hash and sends no email.
    const generated = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: account.data.user.email,
    });
    const tokenHash = generated.data.properties?.hashed_token;
    if (generated.error || generated.data.user?.id !== ownerId || !tokenHash) {
        throw new Error('Open workspace session is unavailable');
    }

    const verified = await sessionClient.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
    if (verified.error || !verified.data.session || !verified.data.user || verified.data.user.id !== ownerId) {
        throw new Error('Open workspace session could not be established');
    }
    return verified.data.user;
}
