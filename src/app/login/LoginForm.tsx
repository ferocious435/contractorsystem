"use client";

import { useActionState, useState } from 'react'
import { login, signup } from './actions'
import { SubmitButton } from './SubmitButton'

export function LoginForm() {
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [state, formAction] = useActionState(
        mode === 'login' ? login : signup,
        null
    );

    return (
        <form action={formAction} className="flex flex-col gap-5">
            {state?.error && (
                <div className="p-3 bg-critical/20 border border-critical/40 text-critical text-sm rounded-lg text-center font-medium">
                    {state.error}
                </div>
            )}

            <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-300" htmlFor="email">דוא״ל</label>
                <input
                    className="bg-workspace border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors hover:bg-[#1a232e]"
                    id="email"
                    name="email"
                    type="email"
                    placeholder="example@contractor.com"
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
                    required
                />
            </div>

            {mode === 'signup' && (
                <div className="flex flex-col gap-2 border-t border-border-subtle pt-5 mt-2 animate-in fade-in slide-in-from-top-2">
                    <p className="text-xs text-gray-500 mb-2">שדות להרשמה חדשה בלבד:</p>
                    <label className="text-sm font-medium text-gray-300" htmlFor="full_name">שם מלא</label>
                    <input
                        className="bg-workspace border border-border-subtle rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-primary transition-colors hover:bg-[#1a232e]"
                        id="full_name"
                        name="full_name"
                        type="text"
                        placeholder="ישראל ישראלי"
                        required={mode === 'signup'}
                    />

                    <label className="text-sm font-medium text-gray-300 mt-2" htmlFor="company_name">שם חברה</label>
                    <input
                        className="bg-workspace border border-border-subtle rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-primary transition-colors hover:bg-[#1a232e]"
                        id="company_name"
                        name="company_name"
                        type="text"
                        placeholder="ישראלי בע״מ"
                        required={mode === 'signup'}
                    />
                </div>
            )}

            <div className="flex flex-col gap-3 mt-4">
                <SubmitButton
                    className="w-full bg-primary hover:bg-primary/80 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-[0_0_15px_rgba(59,130,246,0.5)] transform hover:-translate-y-0.5"
                >
                    {mode === 'login' ? 'התחבר' : 'צור חשבון חדש'}
                </SubmitButton>
                
                <button
                    type="button"
                    onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                    className="text-xs text-gray-500 hover:text-primary transition-colors text-center"
                >
                    {mode === 'login' ? 'עדיין אין לך חשבון? הירשם כאן' : 'כבר יש לך חשבון? התחבר כאן'}
                </button>
            </div>
        </form>
    )
}
