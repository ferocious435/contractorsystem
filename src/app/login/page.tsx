import { LoginForm } from './LoginForm'

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

                <LoginForm />


            </div>
        </div>
    )
}
