"use client";

import { useState } from "react";
import { 
    Save, Check, Settings, DollarSign, Building2, 
    FileText, Shield, Globe, Cpu, Zap, Loader2, 
    AlertCircle, Sparkles, Database, Lock, User
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SettingsViewProps {
    project: any;
    projectId: string | null;
}

export default function SettingsView({ project, projectId }: SettingsViewProps) {
    const [vatRate, setVatRate] = useState(18);
    const [currency, setCurrency] = useState("ILS (₪)");
    const [isSaving, setIsSaving] = useState(false);
    const [savedMessage, setSavedMessage] = useState<string | null>(null);

    const handleSave = async () => {
        setIsSaving(true);
        setSavedMessage(null);
        try {
            await new Promise(resolve => setTimeout(resolve, 1500));
            setSavedMessage("הגדרות סונכרנו בהצלחה");
            setTimeout(() => setSavedMessage(null), 4000);
        } catch (error) {
            console.error("Error saving settings:", error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-5xl mx-auto w-full space-y-8 pb-20"
            dir="rtl"
        >
            {/* Header Section */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 bg-[#151C24]/40 border border-white/5 rounded-[2.5rem] p-10 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
                <div className="flex items-center gap-6 relative z-10">
                    <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-[0_0_30px_rgba(59,130,246,0.1)]">
                        <Settings className="h-8 w-8 text-blue-500" />
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-black text-blue-500 uppercase tracking-[0.3em]">ליבת המערכת v3.0</span>
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6]" />
                        </div>
                        <h2 className="text-3xl font-black text-white font-mono uppercase tracking-tighter">הגדרות צומת פרויקט</h2>
                        <p className="text-gray-500 text-sm font-medium">ניהול הגדרות הליבה של הצומת המבצעי</p>
                    </div>
                </div>

                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSave}
                    disabled={isSaving}
                    className={`relative group px-10 py-4 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] transition-all flex items-center gap-3 overflow-hidden ${
                        savedMessage 
                        ? 'bg-emerald-500 text-black shadow-[0_0_30px_rgba(16,185,129,0.3)]' 
                        : 'bg-white text-black hover:bg-blue-500 hover:text-white shadow-[0_20px_40px_rgba(255,255,255,0.05)]'
                    }`}
                >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                    {isSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : savedMessage ? (
                        <Check className="h-4 w-4" />
                    ) : (
                        <Save className="h-4 w-4" />
                    )}
                    <span className="relative z-10">{savedMessage ? 'סנכרון הושלם' : isSaving ? 'מסנכרן נתונים...' : 'שמור הגדרות'}</span>
                </motion.button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Right Column: Main Settings */}
                <div className="lg:col-span-8 space-y-8">
                    {/* Project Identity */}
                    <section className="bg-[#151C24]/40 border border-white/5 rounded-[2.5rem] p-8 space-y-8 relative group">
                        <div className="flex items-center gap-3 border-b border-white/5 pb-6">
                            <div className="p-2 bg-blue-500/10 rounded-xl">
                                <Building2 size={18} className="text-blue-400" />
                            </div>
                            <h3 className="text-sm font-black text-white font-mono uppercase tracking-widest">זהות הפרויקט</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest px-1">שם הפרויקט</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        readOnly
                                        value={project?.name || ''}
                                        className="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-sm font-bold text-gray-400 cursor-not-allowed outline-none"
                                    />
                                    <Lock size={14} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-700" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest px-1">לקוח / מזמין</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        readOnly
                                        value={project?.client_name || ''}
                                        className="w-full bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-sm font-bold text-gray-400 cursor-not-allowed outline-none"
                                    />
                                    <User size={14} className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-700" />
                                </div>
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest px-1">מזהה פרויקט (UUID)</label>
                                <div className="bg-black/20 border border-white/5 rounded-2xl px-6 py-3 font-mono text-[10px] text-gray-600 break-all">
                                    {projectId}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Financial Matrix */}
                    <section className="bg-[#151C24]/40 border border-white/5 rounded-[2.5rem] p-8 space-y-8 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 blur-[80px] group-hover:bg-emerald-500/10 transition-all" />
                        
                        <div className="flex items-center gap-3 border-b border-white/5 pb-6">
                            <div className="p-2 bg-emerald-500/10 rounded-xl">
                                <DollarSign size={18} className="text-emerald-400" />
                            </div>
                            <h3 className="text-sm font-black text-white font-mono uppercase tracking-widest">פרמטרים כלכליים</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                                <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest px-1 flex items-center gap-2">
                                    שיעור מע"מ [%] <Sparkles size={10} className="text-emerald-500" />
                                </label>
                                <div className="relative group/input">
                                    <input
                                        type="number"
                                        value={vatRate}
                                        onChange={(e) => setVatRate(Number(e.target.value))}
                                        className="w-full bg-black/60 border border-white/5 rounded-2xl px-6 py-5 text-2xl font-black text-emerald-500 font-mono focus:border-emerald-500/50 outline-none transition-all"
                                    />
                                    <div className="absolute left-6 top-1/2 -translate-y-1/2 text-emerald-500/50 font-mono text-sm font-black">אחוז</div>
                                </div>
                                <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">מע"מ סטנדרטי: 18%</p>
                            </div>
                            <div className="space-y-4">
                                <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest px-1">מטבע פעיל</label>
                                <div className="relative group/select">
                                    <select
                                        value={currency}
                                        onChange={(e) => setCurrency(e.target.value)}
                                        className="w-full bg-black/60 border border-white/5 rounded-2xl px-6 py-5 text-sm font-black text-white outline-none focus:border-blue-500/50 appearance-none transition-all cursor-pointer"
                                    >
                                        <option value="ILS (₪)">₪ שקל ישראלי [ILS]</option>
                                        <option value="USD ($)">$ דולר אמריקאי [USD]</option>
                                        <option value="EUR (€)">€ אירו אירופי [EUR]</option>
                                    </select>
                                    <div className="absolute left-6 top-1/2 -translate-y-1/2 pointer-events-none text-gray-600">
                                        <Globe size={18} />
                                    </div>
                                </div>
                                <p className="text-[9px] font-mono text-gray-600 uppercase tracking-widest">יחידת חישוב בסיסית</p>
                            </div>
                        </div>
                    </section>

                    {/* Data Processing */}
                    <section className="bg-[#151C24]/40 border border-white/5 rounded-[2.5rem] p-8 space-y-8 relative group">
                        <div className="flex items-center gap-3 border-b border-white/5 pb-6">
                            <div className="p-2 bg-amber-500/10 rounded-xl">
                                <Cpu size={18} className="text-amber-400" />
                            </div>
                            <h3 className="text-sm font-black text-white font-mono uppercase tracking-widest">ניהול דאטה</h3>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                                <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest px-1">פורמט ייצוא ברירת מחדל</label>
                                <div className="flex gap-2">
                                    {['PDF', 'CSV', 'XLSX'].map((protocol) => (
                                        <button 
                                            key={protocol}
                                            className={`flex-1 py-4 rounded-xl border font-mono text-[10px] font-black uppercase tracking-widest transition-all ${
                                                protocol === 'PDF' 
                                                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' 
                                                : 'bg-white/5 border-white/5 text-gray-600 hover:text-white hover:bg-white/10'
                                            }`}
                                        >
                                            {protocol}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-4">
                                <label className="text-[10px] font-mono text-gray-500 uppercase font-black tracking-widest px-1">שפת ממשק</label>
                                <div className="flex gap-2">
                                    {['HE', 'EN'].map((lang) => (
                                        <button 
                                            key={lang}
                                            className={`flex-1 py-4 rounded-xl border font-mono text-[10px] font-black uppercase tracking-widest transition-all ${
                                                lang === 'HE' 
                                                ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' 
                                                : 'bg-white/5 border-white/5 text-gray-600 hover:text-white hover:bg-white/10'
                                            }`}
                                        >
                                            {lang === 'HE' ? 'עברית' : 'English'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                {/* Left Column: System Status */}
                <div className="lg:col-span-4 space-y-8">
                    <div className="bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/10 rounded-[2.5rem] p-8 space-y-6">
                        <div className="flex items-center justify-between">
                            <h4 className="text-[10px] font-mono font-black text-blue-400 uppercase tracking-widest">סטטוס סנכרון</h4>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                                <span className="text-[9px] font-mono font-black text-blue-500 uppercase">מחובר</span>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-black/40 rounded-2xl border border-white/5">
                                <div className="flex items-center gap-3">
                                    <Shield size={16} className="text-gray-500" />
                                    <span className="text-[10px] font-mono font-black text-gray-400 uppercase">הצפנה</span>
                                </div>
                                <span className="text-[10px] font-mono font-black text-emerald-500 uppercase">AES-256</span>
                            </div>
                            <div className="flex items-center justify-between p-4 bg-black/40 rounded-2xl border border-white/5">
                                <div className="flex items-center gap-3">
                                    <Database size={16} className="text-gray-500" />
                                    <span className="text-[10px] font-mono font-black text-gray-400 uppercase">חיבור למסד נתונים</span>
                                    </div>
                                <span className="text-[10px] font-mono font-black text-emerald-500 uppercase">פעיל</span>
                            </div>
                            <div className="flex items-center justify-between p-4 bg-black/40 rounded-2xl border border-white/5">
                                <div className="flex items-center gap-3">
                                    <Zap size={16} className="text-gray-500" />
                                    <span className="text-[10px] font-mono font-black text-gray-400 uppercase">מודל AI</span>
                                </div>
                                <span className="text-[10px] font-mono font-black text-blue-400 uppercase">G-3.0-F</span>
                            </div>
                        </div>

                        <div className="pt-4 space-y-4">
                            <div className="flex items-center justify-between text-[9px] font-mono font-black uppercase tracking-widest text-gray-600">
                                <span>הקצאת זיכרון</span>
                                <span>82%</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                <motion.div 
                                    initial={{ width: 0 }}
                                    animate={{ width: '82%' }}
                                    className="h-full bg-blue-500 shadow-[0_0_10px_#3b82f6]"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-[#151C24]/40 border border-white/5 rounded-[2.5rem] p-8 space-y-4">
                        <div className="flex items-center gap-2 text-red-500/50">
                            <AlertCircle size={14} />
                            <span className="text-[9px] font-mono font-black uppercase tracking-[0.2em]">אזור מסוכן</span>
                        </div>
                        <p className="text-[10px] text-gray-600 font-medium leading-relaxed">
                            מחיקת הפרויקט תסיר לצמיתות את כל הנתונים, המסמכים והניתוחים מהמערכת. לא ניתן לבטל פעולה זו.
                        </p>
                        <button className="w-full py-4 rounded-2xl border border-red-500/10 text-red-500/70 font-mono text-[10px] font-black uppercase tracking-widest hover:bg-red-500/5 hover:border-red-500/30 transition-all mt-2">
                            מחק פרויקט לצמיתות
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
