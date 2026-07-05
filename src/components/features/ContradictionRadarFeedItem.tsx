import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AlertTriangle,
    Zap,
    Activity,
    CheckCircle2,
    RefreshCw,
    ChevronDown,
    FileText,
    ArrowRightLeft,
    Shield,
    Database,
    Info,
    TrendingUp,
    Gavel,
    FileSearch,
    ShieldAlert,
    Trash2,
    ClipboardList,
} from 'lucide-react';
import type { ContradictionItem } from '@/types';
import { RichText } from '@/components/ui/RichText';
import { getRadarFindingReference } from './contradiction-radar/utils/findingClassification';

type EvidenceRecord = Record<string, unknown>;

interface RichTextEvidenceData {
    contract_quote?: string;
    work_quote?: string;
    contract_title?: string;
    work_title?: string;
    contract_page?: number | string;
    work_page?: number | string;
    contract_url?: string;
    work_url?: string;
    document_pair?: {
        contract_doc_id?: string | null;
        work_doc_id?: string | null;
    };
}
interface ContradictionRadarFeedItemProps {
    item: ContradictionItem;
    idx: number;
    isExpanded: boolean;
    isItemRescanning: boolean;
    isScanning: boolean;
    shouldAnimate: boolean;
    onToggleExpand: (id: string) => void;
    onRescanItem: (id: string, executionDocId?: string) => void;
    onUpdateStatus: (id: string, newStatus: string, item?: ContradictionItem) => Promise<boolean>;
    onDelete: (id: string) => Promise<boolean>;
    onNavigate?: (view: string, params?: Record<string, unknown>) => void;
    onRadarOpenDocument: (documentId?: string | null, pageNum?: number | string | null) => void;
}

function isEvidenceRecord(value: unknown): value is EvidenceRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getEvidenceRecord(value: unknown): EvidenceRecord | undefined {
    return isEvidenceRecord(value) ? value : undefined;
}

function toDisplayText(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
}

function toPageValue(value: unknown): string | number | null {
    return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function toStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .map(toDisplayText)
        .filter((entry): entry is string => Boolean(entry));
}

function toRichTextEvidenceData(evidenceData?: EvidenceRecord): RichTextEvidenceData | undefined {
    if (!evidenceData) return undefined;

    const documentPair = getEvidenceRecord(evidenceData.document_pair);

    return {
        contract_quote: toDisplayText(evidenceData.contract_quote),
        work_quote: toDisplayText(evidenceData.work_quote),
        contract_title: toDisplayText(evidenceData.contract_title),
        work_title: toDisplayText(evidenceData.work_title),
        contract_page: toPageValue(evidenceData.contract_page) ?? undefined,
        work_page: toPageValue(evidenceData.work_page) ?? undefined,
        contract_url: toDisplayText(evidenceData.contract_url),
        work_url: toDisplayText(evidenceData.work_url),
        document_pair: documentPair ? {
            contract_doc_id: toDisplayText(documentPair.contract_doc_id) ?? null,
            work_doc_id: toDisplayText(documentPair.work_doc_id) ?? null,
        } : undefined,
    };
}
function ContradictionRadarFeedItem({
    item: c,
    idx,
    isExpanded,
    isItemRescanning,
    isScanning,
    shouldAnimate,
    onToggleExpand,
    onRescanItem,
    onUpdateStatus,
    onDelete,
    onNavigate,
    onRadarOpenDocument,
}: ContradictionRadarFeedItemProps) {
    const normalizeConfidence = (value: unknown) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
        if (numericValue <= 1) return numericValue;
        if (numericValue <= 100) return numericValue / 100;
        return 1;
    };

    const cleanDisplayText = (text?: string | null) => {
        return String(text || '')
            .replace(/Powered by[^\n.]*/gi, '')
            .replace(/CONFIDENCE:\s*\d+%/gi, '')
            .replace(/CONTRACT[_\s-]*VS[_\s-]*EXECUTION/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    };

    const getCategoryMeta = () => {
        const category = String(c.category || '');
        if (category.includes('סתירה') || c.severity === 'HIGH') {
            return {
                label: 'סתירה מהותית',
                icon: <AlertTriangle className="h-4 w-4 text-red-500" />,
                tone: 'red',
            };
        }
        if (category.includes('שינוי') || category.includes('הנחיה') || c.severity === 'MEDIUM') {
            return {
                label: 'שינוי או חריג',
                icon: <Zap className="h-4 w-4 text-blue-500" />,
                tone: 'blue',
            };
        }
        return {
            label: 'אירוע שטח',
            icon: <Activity className="h-4 w-4 text-emerald-500" />,
            tone: 'emerald',
        };
    };

    const categoryMeta = getCategoryMeta();
    const findingReference = getRadarFindingReference(c);
    const evidenceData = getEvidenceRecord(c.evidence_data);
    const expert = getEvidenceRecord(evidenceData?.expert_strategy);
    const expertOperationalInstructions = getEvidenceRecord(expert?.operational_instructions);
    const expertContractualDiagnostic = getEvidenceRecord(expert?.contractual_diagnostic);
    const missingEvidence = toStringList(evidenceData?.missing_evidence);
    const confidenceRatio = normalizeConfidence(evidenceData?.confidence);
    const comparisonType = String(evidenceData?.comparison_type || '').toLowerCase();
    const hasQuotes = Boolean(evidenceData?.contract_quote && evidenceData?.work_quote);
    const workPage = toPageValue(evidenceData?.work_page);
    const contractPage = toPageValue(evidenceData?.contract_page);
    const clauseReference = toDisplayText(evidenceData?.clause_reference);
    const richTextEvidence = toRichTextEvidenceData(evidenceData);

    const evidenceStatus = (() => {
        if (!hasQuotes) return 'REQUIRES_VERIFICATION';
        if (comparisonType.includes('missing_data') || String(c.category || '').includes('חוסר נתונים')) {
            return 'REQUIRES_VERIFICATION';
        }
        return toDisplayText(evidenceData?.evidence_status) || 'VERIFIED';
    })();

    const recommendationText = cleanDisplayText(
        toDisplayText(c.strategy_advice) ||
        toDisplayText(evidenceData?.next_check) ||
        toDisplayText(expertOperationalInstructions?.site_diary_draft) ||
        ''
    ) || (
        String(c.category || '').includes('אין התאמה ישירה')
            ? 'לא נמצא סעיף ישיר. כדאי למדוד את הכמות בפועל, לשמור תיעוד, ולבדוק אם נדרש חריג נפרד.'
            : String(c.category || '').includes('סתירה')
                ? 'כדאי לתעד מיד את הפער, לבקש הנחיה כתובה, ולשמור בסיס לדרישת תשלום או להארכת זמן.'
                : 'כדאי לתעד את האירוע ביומן העבודה, לשמור מסמכים תומכים, ולבדוק השפעה על עלות או זמן.'
    );

    const legalBasis = cleanDisplayText(
        toDisplayText(expertContractualDiagnostic?.legal_basis) ||
        clauseReference ||
        ''
    ) || 'לא הוצג כאן עדיין סעיף חד-משמעי. אם ההנחיה בשטח סותרת את החוזה, כדאי להציג את הפער בין המסמכים ולדרוש הנחיה כתובה מטעם המזמין.';

    const supervisorArgument = cleanDisplayText(
        toDisplayText(expertContractualDiagnostic?.argument_for_supervisor) ||
        toDisplayText(evidenceData?.risk_reason) ||
        ''
    ) || 'המשמעות לקבלן היא שינוי בפועל לעומת הבסיס החוזי, ולכן יש מקום לבדיקה מסחרית ולבחינת דרישה מסודרת.';

    const verificationMessage = missingEvidence.length > 0
        ? `המערכת זיהתה כאן בעיה אמיתית על בסיס המסמכים שכבר נמצאו. כדי להפוך אותה לדרישה כספית חזקה יותר, כדאי להשלים: ${missingEvidence.join(' | ')}.`
        : 'המערכת זיהתה כאן פער אמיתי בין המסמכים. לפני דרישה כספית סופית כדאי לחזק את התיעוד או את הכמות בפועל.';

    const RowComponent = (shouldAnimate ? motion.div : 'div') as React.ElementType;
    const rowAnimationProps = shouldAnimate
        ? {
            initial: { opacity: 0, x: -20 },
            animate: { opacity: 1, x: 0 },
            transition: { delay: Math.min(idx, 10) * 0.05 },
        }
        : {};

    return (
        <RowComponent
            {...rowAnimationProps}
            className={`group relative bg-[#151C24]/55 border rounded-[2rem] overflow-hidden transition-all duration-300 ${
                isExpanded ? 'border-white/15 bg-white/[0.03] shadow-[0_30px_60px_rgba(0,0,0,0.35)]' : 'border-white/5 hover:border-white/10'
            }`}
        >
            <div className={`absolute top-0 right-0 w-1.5 h-full opacity-25 group-hover:opacity-100 transition-opacity ${
                categoryMeta.tone === 'red' ? 'bg-red-500' : categoryMeta.tone === 'blue' ? 'bg-blue-500' : 'bg-emerald-500'
            }`} />

            <div className="p-6 cursor-pointer" onClick={() => onToggleExpand(c.id)}>
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                    <div className="flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.06] border border-white/15 text-gray-200">
                                <ClipboardList className="h-4 w-4 text-gray-400" />
                                <span className="text-xs font-black tracking-wide">{findingReference}</span>
                            </div>

                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
                                categoryMeta.tone === 'red'
                                    ? 'bg-red-500/10 border-red-500/20 text-red-400'
                                    : categoryMeta.tone === 'blue'
                                        ? 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                                        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                            }`}>
                                {categoryMeta.icon}
                                <span className="text-xs font-bold">{categoryMeta.label}</span>
                            </div>

                            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${
                                evidenceStatus === 'VERIFIED'
                                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                                    : 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                            }`}>
                                <ShieldAlert size={13} />
                                <span className="text-xs font-bold">
                                    {evidenceStatus === 'VERIFIED' ? 'יש בסיס מסמכי ברור' : 'הסתירה קיימת, אבל כדאי לחזק את הבסיס'}
                                </span>
                            </div>

                            {confidenceRatio !== null && (
                                <span className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs font-bold text-gray-300">
                                    ודאות {Math.round(confidenceRatio * 100)}%
                                </span>
                            )}
                        </div>

                        <h3 className="text-2xl font-black text-white leading-tight group-hover:text-blue-300 transition-colors">
                            {cleanDisplayText(c.title)}
                        </h3>

                        <p className="text-base text-gray-300 leading-7 line-clamp-2">
                            {cleanDisplayText(c.description)}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 self-end lg:self-center">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onRescanItem(c.id, c.source_execution_doc_id);
                            }}
                            disabled={isItemRescanning || isScanning}
                            className={`p-2.5 rounded-xl border border-white/10 transition-all ${
                                isItemRescanning ? 'bg-blue-500/20 text-blue-400' : 'bg-white/[0.03] text-gray-500 hover:text-white hover:bg-white/10'
                            }`}
                            title="סריקה מחדש"
                        >
                            <RefreshCw className={`w-4 h-4 ${isItemRescanning ? 'animate-spin' : ''}`} />
                        </button>
                        <div className={`p-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-gray-500 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                            <ChevronDown className="w-4 h-4" />
                        </div>
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="p-6 md:p-8 border-t border-white/5 space-y-8 bg-black/20"
                    >
                        <div className="flex flex-col md:flex-row md:items-center gap-4 p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
                            <div className="flex flex-wrap items-center gap-6">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRadarOpenDocument(c.source_doc?.id, workPage);
                                    }}
                                    className="flex items-center gap-3 group/doc transition-all"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center group-hover/doc:border-blue-500/50 group-hover/doc:bg-blue-500/10 transition-colors">
                                        <FileText className="w-5 h-5 text-gray-400 group-hover/doc:text-blue-400" />
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500 font-bold">מסמך ביצוע</div>
                                        <div className="text-sm text-gray-200 font-bold">{c.source_doc?.title || 'לא נמצא מסמך ביצוע'}</div>
                                    </div>
                                </button>

                                <ArrowRightLeft className="text-gray-600 w-4 h-4 hidden md:block" />

                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRadarOpenDocument(c.target_doc?.id, contractPage);
                                    }}
                                    className="flex items-center gap-3 group/doc transition-all"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center group-hover/doc:border-blue-500/50 group-hover/doc:bg-blue-500/10 transition-colors">
                                        <Shield className="w-5 h-5 text-gray-400 group-hover/doc:text-blue-400" />
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500 font-bold">מסמך חוזי</div>
                                        <div className="text-sm text-gray-200 font-bold">{c.target_doc?.title || 'לא נמצא מסמך חוזי'}</div>
                                    </div>
                                </button>
                            </div>

                            <div className="flex-1" />

                            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                                <button
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        const updated = await onUpdateStatus(c.id, 'MOVED_TO_PRICING', c);
                                        if (updated && onNavigate) {
                                            onNavigate('pricing', {
                                                estimateId: c.id,
                                                entryPoint: 'contradiction-radar',
                                                returnTo: 'radar',
                                                contradictionTitle: cleanDisplayText(c.title),
                                                contradictionSummary: cleanDisplayText(c.description),
                                                sourceDocTitle: c.source_doc?.title || '',
                                                targetDocTitle: c.target_doc?.title || '',
                                            });
                                        }
                                    }}
                                    className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all"
                                >
                                    <Database className="w-4 h-4" />
                                    מעבר לתמחור
                                </button>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Info className="w-5 h-5 text-blue-400" />
                                <span className="text-base text-gray-200 font-bold">למה המערכת סימנה את זה</span>
                            </div>
                            <div className="bg-white/[0.02] p-6 rounded-2xl border border-white/5">
                                <div className="text-base text-gray-200 leading-8">
                                    <RichText text={cleanDisplayText(c.description || '')} evidence={richTextEvidence} onOpen={onRadarOpenDocument} />
                                </div>
                                {evidenceStatus !== 'VERIFIED' && (
                                    <div className="mt-5 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                                        <div className="flex items-center gap-2 text-amber-300 text-sm font-bold mb-2">
                                            <ShieldAlert className="w-4 h-4" />
                                            צריך לחזק את הבסיס לפני דרישה כספית מלאה
                                        </div>
                                        <p className="text-sm text-gray-300 leading-7">{verificationMessage}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white/[0.02] p-5 rounded-2xl border border-white/5 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-blue-300">
                                    <Shield className="w-4 h-4" />
                                    מה נדרש לפי החוזה או הבסיס
                                </div>
                                <p className="text-sm text-gray-200 leading-7">
                                    {cleanDisplayText(toDisplayText(evidenceData?.original_instruction) || toDisplayText(evidenceData?.contract_quote)) || 'לא נמצא עדיין ניסוח חוזי ישיר להצגה במסך.'}
                                </p>
                                {clauseReference && (
                                    <span className="inline-flex px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-blue-200">
                                        {clauseReference}
                                    </span>
                                )}
                            </div>

                            <div className="bg-white/[0.02] p-5 rounded-2xl border border-white/5 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
                                    <FileSearch className="w-4 h-4" />
                                    מה קרה בפועל
                                </div>
                                <p className="text-sm text-gray-200 leading-7">
                                    {cleanDisplayText(toDisplayText(evidenceData?.new_requirement) || toDisplayText(evidenceData?.work_quote)) || 'לא נמצא עדיין ניסוח ביצוע ישיר להצגה במסך.'}
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <div className="bg-blue-500/5 p-5 rounded-2xl border border-blue-500/15 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-blue-300">
                                    <ClipboardList className="w-4 h-4" />
                                    המלצת המערכת לקבלן
                                </div>
                                <p className="text-sm text-gray-100 leading-7">{recommendationText}</p>
                            </div>

                            <div className="bg-emerald-500/5 p-5 rounded-2xl border border-emerald-500/15 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                                    <Gavel className="w-4 h-4" />
                                    בסיס חוזי או מסחרי
                                </div>
                                <p className="text-sm text-gray-100 leading-7">{legalBasis}</p>
                            </div>

                            <div className="bg-amber-500/5 p-5 rounded-2xl border border-amber-500/15 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-amber-300">
                                    <TrendingUp className="w-4 h-4" />
                                    איך להציג את זה למזמין
                                </div>
                                <p className="text-sm text-gray-100 leading-7">{supervisorArgument}</p>
                            </div>
                        </div>

                        {missingEvidence.length > 0 && (
                            <div className="bg-white/[0.02] p-5 rounded-2xl border border-white/5 space-y-3">
                                <div className="text-sm font-bold text-gray-200">מה עוד כדאי לאסוף</div>
                                <div className="flex flex-wrap gap-2">
                                    {missingEvidence.map((missing: string, missingIdx: number) => (
                                        <span key={`missing-${missingIdx}`} className="px-3 py-2 bg-black/30 border border-white/10 rounded-xl text-xs text-gray-300">
                                            {cleanDisplayText(missing)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-6 border-t border-white/5">
                            <div className="text-sm text-gray-500">
                                {findingReference} · נוצר בתאריך {new Date(c.created_at).toLocaleDateString('he-IL')}
                            </div>
                            <div className="flex items-center gap-3">
                                {c.status !== 'RESOLVED' ? (
                                    <button
                                        onClick={() => {
                                            void onUpdateStatus(c.id, 'RESOLVED');
                                        }}
                                        className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-black rounded-xl text-sm font-bold transition-all hover:bg-emerald-400"
                                    >
                                        <CheckCircle2 size={18} />
                                        סמן כטופל
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => {
                                            void onUpdateStatus(c.id, 'OPEN');
                                        }}
                                        className="flex items-center gap-2 px-6 py-3 bg-white/[0.03] border border-white/10 text-gray-300 rounded-xl text-sm font-bold hover:bg-white/[0.05] hover:text-white transition-all"
                                    >
                                        פתח מחדש
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        void onDelete(c.id);
                                    }}
                                    className="p-3 bg-red-500/[0.03] border border-white/5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                                    title="מחיקה"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </RowComponent>
    );
}

export default React.memo(ContradictionRadarFeedItem);
