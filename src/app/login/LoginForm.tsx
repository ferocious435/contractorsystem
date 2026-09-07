"use client";

import { useActionState } from 'react'
import { login, sendMagicLink } from './actions'
import { SubmitButton } from './SubmitButton'

const REAL_LOGIN_EMAIL = 'rotem435@gmail.com';

export function LoginForm() {
    const [passwordState, formAction] = useActionState(login, null);
    const [magicLinkState, magicLinkAction] = useActionState(sendMagicLink, null);
    const state = magicLinkState || passwordState;

    return (
        <form action={formAction} className="flex flex-col gap-5" dir="rtl" autoComplete="on">
            {state?.error && (
                <div className="p-3 bg-critical/20 border border-critical/40 text-critical text-sm rounded-lg text-center font-medium">
                    {state.error}
                </div>
            )}
            {state?.notice && (
                <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-sm rounded-lg text-center font-medium">
                    {state.notice}
                </div>
            )}

            <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-right">
                <div className="text-sm font-bold text-white">כניסה לפרויקטים האמיתיים</div>
                <div className="mt-1 text-xs text-gray-400">המערכת תשמור אותך במכשיר הזה אחרי הכניסה הראשונה.</div>
            </div>

            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-300" htmlFor="email">דוא״ל</label>
                <input
                    className="bg-workspace border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors hover:bg-[#1a232e]"
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    defaultValue={REAL_LOGIN_EMAIL}
                    required
                />
            </div>

            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-300" htmlFor="password">סיסמה</label>
                <input
                    className="bg-workspace border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors hover:bg-[#1a232e]"
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                />
            </div>

            <label className="flex items-center justify-end gap-3 text-sm text-gray-300 select-none">
                <span>זכור אותי במכשיר הזה</span>
                <input
                    type="checkbox"
                    name="remember_device"
                    defaultChecked
                    className="h-4 w-4 accent-blue-500"
                />
            </label>

            <SubmitButton className="w-full bg-primary hover:bg-primary/80 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-[0_0_15px_rgba(59,130,246,0.5)] transform hover:-translate-y-0.5">
                כניסה
            </SubmitButton>

            <SubmitButton
                formAction={magicLinkAction}
                formNoValidate
                className="w-full border border-white/15 bg-white/5 hover:bg-white/10 text-gray-200 font-bold py-3 px-4 rounded-lg transition-colors"
            >
                שלחו לי קישור כניסה בדוא״ל
            </SubmitButton>
        </form>
    )
}
