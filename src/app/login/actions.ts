'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'

export async function login(prevState: any, formData: FormData) {
    const supabase = await createClient()

    const email = formData.get('email') as string
    const password = formData.get('password') as string

    console.log(`[Auth:Login] Attempting login for: ${email}`)

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
        console.error('[Auth:Login] Supabase Error:', error.message, 'Code:', error.code, 'Status:', error.status)
        // Return a more user-friendly error but keep the code for us
        if (error.code === 'invalid_credentials') {
            return { error: `Email или пароль неверны. Если вы еще не регистрировались, используйте форму регистрации.` }
        }
        return { error: `${error.message} (Code: ${error.code || error.status})` }
    }

    if (data.user) {
        console.log('[Auth:Login] Success for user:', data.user.id)
        // Check if profile exists
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
        if (!profile) {
            console.warn('[Auth:Login] Profile missing for user, creating one...')
            await supabase.from('profiles').insert({
                id: data.user.id,
                full_name: data.user.user_metadata.full_name || 'User',
                company_name: data.user.user_metadata.company_name || '',
                role: 'contractor'
            })
        }
        
        console.log('[Auth:Login] Redirecting to dashboard...')
        revalidatePath('/', 'layout')
        redirect('/')
    }

    return { error: 'Непредвиденная ошибка при входе' }
}

export async function signup(prevState: any, formData: FormData) {
    const supabase = await createClient()

    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const fullName = formData.get('full_name') as string
    const companyName = formData.get('company_name') as string

    console.log(`[Auth:Signup] Attempting signup for: ${email}`)

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name: fullName,
                company_name: companyName,
            }
        }
    })

    if (error) {
        console.error('[Auth:Signup] Supabase Error:', error.message, 'Code:', error.code)
        return { error: `Ошибка регистрации: ${error.message}` }
    }

    if (data.user) {
        console.log('[Auth:Signup] Success, creating profile manually to be safe...')
        const { error: profileError } = await supabase.from('profiles').insert({
            id: data.user.id,
            full_name: fullName,
            company_name: companyName,
            role: 'contractor'
        })
        if (profileError) console.error('[Auth:Signup] Profile Creation Error:', profileError.message)
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
