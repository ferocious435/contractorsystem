import React, { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Activity, Shield, Zap, Cpu } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { generateContradictionPDF } from '@/utils/contradictionPdfGenerator';
import { ArrowRight } from 'lucide-react';
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
    const [isClearing, setIsClearing] = useState(false);
    const [isFromCache, setIsFromCache] = useState(false);
    const [progress, setProgress] = useState(0);
    const [rescanningIds, setRescanningIds] = useState<Set<string>>(new Set());
    const [currentStep, setCurrentStep] = useState<string | null>(null);
    const [foundCount, setFoundCount] = useState(0);
    const [projectDocuments, setProjectDocuments] = useState<any[]>([]);
    const [resolvedProjectName, setResolvedProjectName] = useState<string>(projectName || 'פרויקט');
    const [selectedDocs, setSelectedDocs] = useState<{contractId?: string, workId?: string}>({});

    const radarOpenDocument = (url?: string | null, page?: number | string | null) => {
        if (!url) return;
        const anchor = page ? `#page=${page}` : '';
        window.open(`${url}${anchor}`, '_blank');
    };

    useEffect(() => {
        fetchContradictions();
        fetchDocuments();

        // טעינת שם הפרויקט אם לא הועבר ב-props
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
                filter: `project_id=eq.${projectId}`
            }, (payload) => {
                setContradictions(prev => [payload.new as ContradictionItem, ...prev]);
                setFoundCount(prev => prev + 1);
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
                // בחירה אוטומטית של מסמכים אם לא נבחרו
                const contract = data.find(d => d.category === 'CONTRACT');
                const work = data.find(d => d.category === 'EXECUTION');
                setSelectedDocs({ contractId: contract?.id, workId: work?.id });
                
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
        } catch (err: any) {
            console.error('Error fetching contradictions:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const scanProject = async (force = false) => {
        setIsScanning(true);
        setProgress(0);
        setFoundCount(0);
        setIsFromCache(false);

        const contracts = projectDocuments.filter(d => d.category === 'CONTRACT');
        const executions = projectDocuments.filter(d => d.category === 'EXECUTION');

        const baseSteps = [
            { msg: 'אתחול סריקה...', p: 5 },
            { msg: 'טעינת מסמכי פרויקט...', p: 10 },
        ];
        
        const comparisonSteps = contracts.flatMap(c => executions.map(e => ({
            msg: `השוואה: ${c.title} ↔ ${e.title}`,
            p: 0 // מחושב דינמית
        })));
        
        const finalSteps = [
            { msg: 'ניתוח ממצאים הנדסי...', p: 85 },
            { msg: 'יצירת דוח מסכם...', p: 100 }
        ];

        const steps = [...baseSteps, ...comparisonSteps, ...finalSteps];

        let stepIdx = 0;
        const progressInterval = setInterval(() => {
            if (stepIdx < steps.length) {
                const step = steps[stepIdx];
                setCurrentStep(step.msg);
                
                // חישוב אחוז יעד
                let targetP = step.p;
                if (targetP === 0) {
                    // אם זה שלב השוואה, נפרוס בין 10% ל-80%
                    const compIdx = stepIdx - baseSteps.length;
                    targetP = 10 + Math.round((compIdx / comparisonSteps.length) * 70);
                }
                
                setProgress(prev => {
                    if (prev < targetP) return prev + (targetP - prev) * 0.2;
                    return prev;
                });
                
                stepIdx++;
            }
        }, comparisonSteps.length > 5 ? 500 : 1000);

        try {
            const response = await fetch('/api/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    projectId,
                    force
                })
            });

            const data = await response.json();
            clearInterval(progressInterval);
            
            if (data.success) {
                // עדכון רשימת מסמכים במידה ועיבוד ה-OCR הסתיים
                const { data: freshDocs } = await supabase
                    .from('documents')
                    .select('id, title, category, ai_status, extracted_text')
                    .eq('project_id', projectId);
                if (freshDocs) setProjectDocuments(freshDocs);
                
                // עדכון רשימת הסתירות
                await fetchContradictions();

                setCurrentStep(`סריקה הושלמה: נמצאו ${data.found || 0} סתירות חדשות`);
                setProgress(100);
            } else {
                setCurrentStep(data.message || 'שגיאת סריקה');
            }
        } catch (err) {
            if (progressInterval) clearInterval(progressInterval);
            console.error('Scan error:', err);
            setCurrentStep('שגיאת תקשורת עם השרת');
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
                    workDocId: workDocId
                })
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
            // 1. Update contradiction status
            const { error: statusError } = await supabase
                .from('contradictions')
                .update({ status: newStatus })
                .eq('id', id);

            if (statusError) throw statusError;

            // Financial rows are created only after the user approves a real estimate.
            // Moving a finding to pricing should not create a zero-price ledger item.
            if (newStatus === 'MOVED_TO_PRICING' && contradiction) {
                console.log('[Radar] Finding moved to pricing queue:', id);
            }

            setContradictions(prev => prev.map(c => c.id === id ? { ...c, status: newStatus } : c));
        } catch (err) {
            console.error('[Radar] updateStatus error:', err);
        }
    };

    const deleteContradiction = async (id: string) => {
        if (!confirm('האם אתה בטוח שברצונך למחוק תוצאה זו?')) return;
        
        try {
            const { error } = await supabase
                .from('contradictions')
                .delete()
                .eq('id', id);

            if (error) throw error;
            setContradictions(prev => prev.filter(c => c.id !== id));
        } catch (err) {
            console.error('Error deleting:', err);
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
                <div className="flex items-center justify-between mb-8">
                    <h3 className="text-xl font-black text-white font-mono tracking-widest uppercase">
                        ממצאי השוואה מול מסמכי ביצוע
                    </h3>
                    <div className="flex items-center gap-3">
                        <div className="px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-[9px] font-mono text-red-500 font-black uppercase">
                            {contradictions.filter(c => c.category?.includes('סתירה') || c.severity === 'HIGH').length} סתירות
                        </div>
                        <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-lg text-[9px] font-mono text-gray-500 font-black">
                            סה"כ {contradictions.length} תוצאות
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex flex-col items-center justify-center py-32 gap-6 opacity-20">
                        <div className="p-10 border-2 border-dashed border-white/10 rounded-[3rem]">
                            <Activity size={48} className="text-white animate-spin" />
                        </div>
                        <span className="text-[12px] font-mono uppercase tracking-[0.5em] font-black animate-pulse">סנכרון מטריצת נתונים...</span>
                    </div>
                ) : contradictions.length === 0 ? (
                    <div className="bg-[#151C24]/30 border border-dashed border-white/5 rounded-[2.5rem] py-32 flex flex-col items-center gap-6">
                        <div className="p-8 bg-white/[0.02] rounded-full">
                            <Shield className="w-12 h-12 text-gray-800" />
                        </div>
                        <div className="flex flex-col items-center gap-2">
                            <span className="text-lg font-black text-gray-700 uppercase tracking-widest font-mono">לא נמצאו סתירות</span>
                            <span className="text-[10px] text-gray-800 uppercase tracking-[0.2em] font-black">אין ממצאים פתוחים כרגע. אם נוספו מסמכים, יש להריץ סנכרון חכם לפני קביעה סופית.</span>
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

            {/* Branding Footer */}
            <div className="pt-10 pb-6 flex flex-col items-center gap-4 border-t border-white/5">
                <div className="flex items-center gap-3">
                    <Zap className="w-4 h-4 text-blue-400 animate-pulse" />
                    <span className="text-[10px] font-mono text-gray-500 font-black uppercase tracking-[0.4em]">אינטליגנציה הנדסית</span>
                </div>
                <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2">
                        <Cpu className="w-3 h-3 text-blue-500/50" />
                        <span className="text-[11px] font-mono text-gray-400 font-black tracking-widest uppercase">מופעל על ידי Gemini 3.5 Flash</span>
                    </div>
                    <div className="h-3 w-px bg-white/10" />
                    <div className="flex items-center gap-2">
                        <Activity className="w-3 h-3 text-emerald-500/50" />
                        <span className="text-[11px] font-mono text-gray-400 font-black tracking-widest uppercase">מערכת סריקה חכמה</span>
                    </div>
                </div>
                <p className="text-[9px] font-mono text-gray-700 uppercase tracking-widest font-black text-center max-w-md leading-relaxed">
                    מערכת זו משתמשת במודלי בינה מלאכותית מתקדמים לניתוח מסחרי. כל הממצאים דורשים אישור אנושי לפני קבלת החלטות סופיות.
                </p>
            </div>
        </div>
    );
}
