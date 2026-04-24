import { login, signup } from './actions'
import { SubmitButton } from './SubmitButton'

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ errorMessage?: string }>
}) {
    const { errorMessage } = await searchParams;

    return (
        <div className="flex h-screen w-full bg-background items-center justify-center p-4">
            <div className="w-full max-w-md glass-panel p-8 rounded-2xl border border-border-subtle shadow-[0_12px_40px_rgba(0,0,0,0.5)]">

                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-bold tracking-wider text-primary mb-2 drop-shadow-md">
                        קבלן<span className="text-white">PRO</span>
                    </h1>
                    <p className="text-gray-400 text-sm">התחבר או הירשם כדי לגשת למערכת</p>
                </div>

                {errorMessage && (
                    <div className="mb-6 p-3 bg-critical/20 border border-critical/40 text-critical text-sm rounded-lg text-center font-medium">
                        {errorMessage}
                    </div>
                )}

                <form className="flex flex-col gap-5">
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

                    {/* Registration Extra Fields (only visible optionally or handled on signup click) */}
                    <div className="flex flex-col gap-2 border-t border-border-subtle pt-5 mt-2">
                        <p className="text-xs text-gray-500 mb-2">שדות להרשמה חדשה בלבד:</p>
                        <label className="text-sm font-medium text-gray-300" htmlFor="full_name">שם מלא</label>
                        <input
                            className="bg-workspace border border-border-subtle rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-primary transition-colors hover:bg-[#1a232e]"
                            id="full_name"
                            name="full_name"
                            type="text"
                            placeholder="ישראל ישראלי"
                        />

                        <label className="text-sm font-medium text-gray-300 mt-2" htmlFor="company_name">שם חברה</label>
                        <input
                            className="bg-workspace border border-border-subtle rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-primary transition-colors hover:bg-[#1a232e]"
                            id="company_name"
                            name="company_name"
                            type="text"
                            placeholder="ישראלי בע״מ"
                        />
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 mt-4">
                        <SubmitButton
                            formAction={login}
                            className="flex-1 bg-primary hover:bg-primary/80 text-white font-bold py-3 px-4 rounded-lg transition-colors shadow-[0_0_15px_rgba(59,130,246,0.5)] transform hover:-translate-y-0.5"
                        >
                            התחבר
                        </SubmitButton>
                        <SubmitButton
                            formAction={signup}
                            className="flex-1 bg-workspace hover:bg-secondary border border-border-subtle text-gray-300 font-medium py-3 px-4 rounded-lg transition-colors transform hover:-translate-y-0.5"
                        >
                            הירשם
                        </SubmitButton>
                    </div>
                </form>

            </div>
        </div>
    )
}
