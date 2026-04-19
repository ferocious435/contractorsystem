import { logout } from '@/app/login/actions';

interface TopBarProps {
    title?: string;
}

export function TopBar({ title }: TopBarProps) {
    return (
        <header className="h-16 flex items-center justify-between px-8 bg-workspace border-b border-border-subtle shadow-md z-0">
            <div className="flex items-center gap-4">
                {title && (
                    <>
                        <span className="text-sm font-medium text-gray-300">פרויקט:</span>
                        <span className="text-base font-bold text-white tracking-wide">
                            {title}
                        </span>
                        <span className="mx-3 text-border-subtle">|</span>
                    </>
                )}
                <span className="text-xs font-bold uppercase tracking-wider text-success flex items-center gap-2 bg-success/10 px-3 py-1.5 rounded border border-success/20">
                    <span className="w-2 h-2 rounded-full bg-success animate-pulse shadow-[0_0_8px_rgba(0,208,132,0.8)]"></span>
                    Live Sync
                </span>
            </div>

            <div className="flex items-center gap-4">
                <div className="px-4 py-1.5 rounded bg-secondary border border-border-subtle text-sm font-medium shadow-inner">
                    <span className="text-gray-300">רמת סיכון: </span>
                    <span className="text-warning font-bold drop-shadow-sm">בינונית</span>
                </div>
                <div className="w-9 h-9 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center text-sm font-bold text-primary shadow-[0_0_10px_rgba(59,130,246,0.5)]">
                    אק
                </div>
                <form action={logout} className="m-0 p-0">
                    <button type="submit" className="text-xs font-medium text-gray-400 hover:text-white transition-colors bg-secondary px-3 py-1.5 rounded border border-border-subtle">
                        התנתק
                    </button>
                </form>
            </div>
        </header>
    );
}
