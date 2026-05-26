import React, { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Activity, Shield, Zap, ArrowRight } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { generateContradictionPDF } from '@/utils/contradictionPdfGenerator';
import ContradictionRadarHeader from './ContradictionRadarHeader';
import ContradictionRadarFeedItem from './ContradictionRadarFeedItem';
import { ContradictionItem } from '@/types';

interface ContradictionRadarProps {
    projectId: string;
    projectName?: string;
    onNavigate?: (view: string, params?: any) => void;
}

export default function ContradictionRadar({ projectId, projectName, onNavigate }: ContradictionRadarProps) {
    const supabase = createClient();
    const [contradictions, setContradictions] = useState<ContradictionItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [rescanningIds, setRescanningIds] = useState<Set<string>>(new Set());
    const [currentStep, setCurrentStep] = useState<string | null>(null);
    const [projectDocuments, setProjectDocuments] = useState<any[]>([]);
    const [resolvedProjectName, setResolvedProjectName] = useState<string>(projectName || 'פרויקט');

    const radarOpenDocument = (url?: string | null, page?: number | string | null) => {
        if (!url) return;
        const anchor = page ? `#page=${page}` : '';
        window.open(`${url}${anchor}`, '_blank');
    };

    useEffect(() => {
        fetchContradictions();
        fetchDocuments();

        if (!projectName) {
            supabase.from('projects').select('name').eq('id', projectId).single().then(({ data }) => {
                if (data?.name) setResolvedProjectName(data.name);
            });
        }

        const channel = supabase
            .channel(`public:contradictions:project_id=eq.${projectId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'contradictions',
                filter: `project_id=eq.${projectId}`,
            }, () => {
                fetchContradictions();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [projectId]);

    const fetchDocuments = async () => {
        try {
            const { data, error } = await supabase
                .from('documents')
                .select('id, title, category, ai_status')
                .eq('project_id', projectId);

            if (!error && data) {
                setProjectDocuments(data);
                const contract = data.find(d => d.category === 'CONTRACT');
                if (contract?.title && !projectName) {
                    setResolvedProjectName(contract.title.replace(/\.pdf$/i, ''));
                }
            }
        } catch (err) {
            console.error('Error fetching docs:', err);
        }
    };

    const fetchContradictions = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('contradictions')
                .select(`
                    *,
                    source_doc: documents!contradictions_source_execution_doc_id_fkey(title, file_url),
                    target_doc: documents!contradictions_target_contract_doc_id_fkey(title, file_url)
                `)
                .eq('project_id', projectId)
                .order('severity', { ascending: false })
                .order('created_at', { ascending: false });

            if (error) throw error;
            setContradictions(data || []);
        } catch (err) {
            console.error('Error fetching contradictions:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const scanProject = async (force = false) => {
        setIsScanning(true);
        setProgress(0);

        const baseSteps = [
            { msg: 'מתחיל בדיקה', p: 10 },
            { msg: 'טוען מסמכי חוזה וביצוע', p: 25 },
            { msg: 'משווה בין המסמכים', p: 60 },
            { msg: 'מארגן ממצאים לתצוגה', p: 90 },
        ];

        let stepIdx = 0;
        const progressInterval = setInterval(() => {
            if (stepIdx < baseSteps.length) {
                const step = baseSteps[stepIdx];
                setCurrentStep(step.msg);
                setProgress(step.p);
                stepIdx++;
            }
        }, 1000);

        try {
            const response = await fetch('/api/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId, force }),
            });

            const data = await response.json();
            clearInterval(progressInterval);

            if (data.success) {
                await fetchDocuments();
                await fetchContradictions();
                setCurrentStep(`הבדיקה הושלמה: נמצאו ${data.found || 0} ממצאים`);
                setProgress(100);
            } else {
                setCurrentStep(data.message || 'אירעה שגיאה במהלך הבדיקה');
            }
        } catch (err) {
            clearInterval(progressInterval);
            console.error('Scan error:', err);
            setCurrentStep('אירעה שגיאת תקשורת');
        } finally {
            setIsScanning(false);
            setTimeout(() => {
                setProgress(0);
                setCurrentStep(null);
            }, 5000);
        }
    };

    const rescanItem = async (id: string, workDocId?: string) => {
        setRescanningIds(prev => new Set(prev).add(id));
        try {
            const response = await fetch('/api/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    projectId,
                    force: false,
                    workDocId,
                }),
            });

            const data = await response.json();
            if (data.success) {
                await fetchContradictions();
            }
        } catch (err) {
            console.error('Rescan error:', err);
        } finally {
            setRescanningIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const updateStatus = async (id: string, newStatus: string, contradiction?: ContradictionItem) => {
        try {
            const { error } = await supabase
                .from('contradictions')
                .update({ status: newStatus })
                .eq('id', id);

            if (error) throw error;

            if (newStatus === 'MOVED_TO_PRICING' && contradiction) {
                console.log('[Radar] Finding moved to pricing queue:', id);
            }

            setContradictions(prev => prev.map(item => item.id === id ? { ...item, status: newStatus } : item));
        } catch (err) {
            console.error('[Radar] updateStatus error:', err);
        }
    };

    const deleteContradiction = async (id: string) => {
        if (!confirm('האם למחוק את הממצא הזה?')) return;

        try {
            const { error } = await supabase
                .from('contradictions')
                .delete()
                .eq('id', id);

            if (error) throw error;
            setContradictions(prev => prev.filter(item => item.id !== id));
        } catch (err) {
            console.error('Error deleting contradiction:', err);
        }
    };

    const handleExportPDF = () => {
        if (contradictions.length > 0) {
            generateContradictionPDF({ contradictions, projectName: resolvedProjectName });
        }
    };

    return (
        <div className="flex flex-col gap-10 p-2" dir="rtl">
            {onNavigate && (
                <div className="flex items-center -mb-6">
                    <button
                        onClick={() => onNavigate('projects')}
                        className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors group"
                    >
                        <ArrowRight className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                        <span className="text-sm font-bold">חזרה לרשימת פרויקטים</span>
                    </button>
                </div>
            )}

            <ContradictionRadarHeader
                isScanning={isScanning}
                progress={progress}
                currentStep={currentStep}
                contractDocsCount={projectDocuments.filter(d => d.category === 'CONTRACT').length}
                executionDocsCount={projectDocuments.filter(d => d.category === 'EXECUTION').length}
                hasContradictions={contradictions.length > 0}
                projectName={resolvedProjectName}
                scanProject={scanProject}
                onExportPDF={handleExportPDF}
            />

            <div className="flex flex-col gap-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <h3 className="text-2xl font-black text-white">ממצאים מול מסמכי הביצוע</h3>
                    <div className="flex items-center gap-3">
                        <div className="px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 font-bold">
                            {contradictions.filter(c => c.category?.includes('סתירה') || c.severity === 'HIGH').length} סתירות
                        </div>
                        <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-gray-400 font-bold">
                            סה"כ {contradictions.length} ממצאים
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-28 gap-5 opacity-30">
                        <div className="p-8 border-2 border-dashed border-white/10 rounded-[2.5rem]">
                            <Activity size={42} className="text-white animate-spin" />
                        </div>
                        <span className="text-sm text-gray-500 font-bold">טוען ממצאים מהמערכת...</span>
                    </div>
                ) : contradictions.length === 0 ? (
                    <div className="bg-[#151C24]/30 border border-dashed border-white/5 rounded-[2.5rem] py-24 flex flex-col items-center gap-5">
                        <div className="p-8 bg-white/[0.02] rounded-full">
                            <Shield className="w-12 h-12 text-gray-700" />
                        </div>
                        <div className="flex flex-col items-center gap-2 text-center px-6">
                            <span className="text-xl font-black text-gray-300">לא נמצאו כרגע סתירות פתוחות</span>
                            <span className="text-sm text-gray-500 max-w-xl">אם נוספו מסמכים חדשים, כדאי להריץ שוב בדיקה כדי לראות אם עלו פערים חדשים בין החוזה לביצוע.</span>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4">
                        <AnimatePresence mode="popLayout">
                            {contradictions.map((c, idx) => (
                                <ContradictionRadarFeedItem
                                    key={c.id}
                                    item={c}
                                    idx={idx}
                                    isExpanded={expandedId === c.id}
                                    isItemRescanning={rescanningIds.has(c.id)}
                                    isScanning={isScanning}
                                    onToggleExpand={(id) => setExpandedId(prev => prev === id ? null : id)}
                                    onRescanItem={rescanItem}
                                    onUpdateStatus={updateStatus}
                                    onDelete={deleteContradiction}
                                    onNavigate={onNavigate}
                                    onRadarOpenDocument={radarOpenDocument}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>

            <div className="pt-8 pb-4 flex flex-col items-center gap-3 border-t border-white/5">
                <div className="flex items-center gap-3">
                    <Zap className="w-4 h-4 text-blue-400 animate-pulse" />
                    <span className="text-sm text-gray-400 font-bold">בדיקת פערים בין החוזה לביצוע</span>
                </div>
                <p className="text-sm text-gray-500 text-center max-w-2xl leading-relaxed">
                    המערכת נועדה לעזור לקבלן להבין מה לא מסתדר, למה זה חשוב, ואיזה צעד כדאי לעשות עכשיו כדי לשמור על זמן, כסף ותיעוד.
                </p>
            </div>
        </div>
    );
}
