"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Save, Check, Settings, DollarSign, Building2, FileText } from "lucide-react";

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
            // In a future iteration, persist to Supabase project_settings table
            // For now, simulate save
            await new Promise(resolve => setTimeout(resolve, 600));
            setSavedMessage("ההגדרות נשמרו בהצלחה");
            setTimeout(() => setSavedMessage(null), 3000);
        } catch (error) {
            console.error("Error saving settings:", error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="bg-workspace/50 p-8 rounded-2xl border border-border-subtle mt-4 max-w-4xl mx-auto w-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center">
                        <Settings className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-white">הגדרות פרויקט</h2>
                        <p className="text-sm text-gray-400">ניהול הגדרות ופרמטרים כלכליים</p>
                    </div>
                </div>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all shadow-lg shadow-primary/20"
                >
                    {isSaving ? (
                        <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : savedMessage ? (
                        <Check className="h-4 w-4" />
                    ) : (
                        <Save className="h-4 w-4" />
                    )}
                    {savedMessage || "שמור הגדרות"}
                </button>
            </div>

            {/* Success toast */}
            {savedMessage && (
                <div className="mb-6 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm flex items-center gap-2 animate-pulse">
                    <Check className="h-4 w-4" />
                    {savedMessage}
                </div>
            )}

            <div className="space-y-6">
                {/* Project Details Section */}
                <div className="p-6 border border-border-subtle rounded-xl bg-background/50">
                    <div className="flex items-center gap-2 mb-5">
                        <Building2 className="h-5 w-5 text-blue-400" />
                        <h3 className="text-lg font-semibold text-gray-200">פרטי פרויקט</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1.5">שם הפרויקט</label>
                            <input
                                type="text"
                                readOnly
                                value={project?.name || ''}
                                className="w-full bg-workspace border border-border-subtle rounded-lg px-4 py-2.5 text-gray-300 cursor-not-allowed focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">לא ניתן לערוך דרך ההגדרות</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1.5">לקוח</label>
                            <input
                                type="text"
                                readOnly
                                value={project?.client_name || ''}
                                className="w-full bg-workspace border border-border-subtle rounded-lg px-4 py-2.5 text-gray-300 cursor-not-allowed focus:outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">לא ניתן לערוך דרך ההגדרות</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1.5">מספר פרויקט</label>
                            <input
                                type="text"
                                readOnly
                                value={projectId || ''}
                                className="w-full bg-workspace border border-border-subtle rounded-lg px-4 py-2.5 text-gray-500 text-xs cursor-not-allowed focus:outline-none font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1.5">סטטוס</label>
                            <div className="flex items-center gap-2 bg-workspace border border-border-subtle rounded-lg px-4 py-2.5">
                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-green-400 text-sm font-medium">פעיל</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Economic Settings Section */}
                <div className="p-6 border border-border-subtle rounded-xl bg-background/50">
                    <div className="flex items-center gap-2 mb-5">
                        <DollarSign className="h-5 w-5 text-emerald-400" />
                        <h3 className="text-lg font-semibold text-gray-200">הגדרות כלכליות</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1.5">מע"מ (%)</label>
                            <input
                                type="number"
                                value={vatRate}
                                onChange={(e) => setVatRate(Number(e.target.value))}
                                min={0}
                                max={100}
                                step={0.5}
                                className="w-full bg-workspace border border-border-subtle hover:border-primary/40 focus:border-primary rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                            />
                            <p className="text-xs text-gray-500 mt-1">שיעור מע"מ נוכחי בישראל: 18%</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1.5">מטבע ברירת מחדל</label>
                            <select
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value)}
                                className="w-full bg-workspace border border-border-subtle hover:border-primary/40 focus:border-primary rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all appearance-none cursor-pointer"
                            >
                                <option value="ILS (₪)">₪ שקל ישראלי (ILS)</option>
                                <option value="USD ($)">$ דולר אמריקאי (USD)</option>
                                <option value="EUR (€)">€ אירו (EUR)</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Document Settings Section */}
                <div className="p-6 border border-border-subtle rounded-xl bg-background/50">
                    <div className="flex items-center gap-2 mb-5">
                        <FileText className="h-5 w-5 text-amber-400" />
                        <h3 className="text-lg font-semibold text-gray-200">הגדרות מסמכים</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1.5">פורמט ייצוא ברירת מחדל</label>
                            <select
                                className="w-full bg-workspace border border-border-subtle hover:border-primary/40 focus:border-primary rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all appearance-none cursor-pointer"
                            >
                                <option value="csv">CSV</option>
                                <option value="pdf">PDF</option>
                                <option value="xlsx">Excel (XLSX)</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1.5">שפת ייצוא</label>
                            <select
                                className="w-full bg-workspace border border-border-subtle hover:border-primary/40 focus:border-primary rounded-lg px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all appearance-none cursor-pointer"
                            >
                                <option value="he">עברית</option>
                                <option value="en">English</option>
                                <option value="ar">عربي</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
