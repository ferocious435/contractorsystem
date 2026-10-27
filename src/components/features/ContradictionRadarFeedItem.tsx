import React from 'react';
import { RadarIssueHistory } from './contradiction-radar/RadarIssueHistory';
import { RadarLinkedRecords } from './contradiction-radar/RadarLinkedRecords';
import { RadarFindingAssessment } from './contradiction-radar/RadarFindingAssessment';
import {RadarFindingView,moveFindingToPricing,cleanRadarDisplayText} from './contradiction-radar/RadarFindingView';
import {Dialog} from '@/components/ui/titanium/Dialog';
import {Button} from '@/components/ui/titanium/Button';
import {Feedback} from '@/components/ui/titanium/Feedback';
import {
    CheckCircle2,
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
import { getEvidenceDisplayStatus } from './contradiction-radar/utils/evidenceVerification';

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
    aiAvailable: boolean;
    shouldAnimate: boolean;
    onToggleExpand: (id: string) => void;
    onRescanItem: (id: string, executionDocId?: string) => void;
    onUpdateStatus: (id: string, newStatus: string, item?: ContradictionItem) => Promise<boolean>;
    onDelete: (id: string, confirmed?: boolean) => Promise<boolean>;
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

function toRecordList(value: unknown): EvidenceRecord[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isEvidenceRecord);
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
    aiAvailable,
    shouldAnimate,
    onToggleExpand,
    onRescanItem,
    onUpdateStatus,
    onDelete,
    onNavigate,
    onRadarOpenDocument,
}: ContradictionRadarFeedItemProps) {
    const cleanDisplayText = cleanRadarDisplayText;
    const [actionError,setActionError] = React.useState<string | null>(null);
    const [updating,setUpdating] = React.useState(false);
    const [deleteOpen,setDeleteOpen] = React.useState(false);
    const [deleting,setDeleting] = React.useState(false);
    const updateStatusInView = async (id:string,status:string,item?:ContradictionItem) => {
        setActionError(null);setUpdating(true);
        try { const updated = await onUpdateStatus(id,status,item);if(!updated)setActionError('השינוי לא נשמר. הממצא נשאר במצבו הקודם.');return updated; }
        catch {setActionError('השינוי לא נשמר. אפשר לנסות שוב.');return false;}
        finally {setUpdating(false);}
    };
    const findingReference = getRadarFindingReference(c);
    const evidenceData = getEvidenceRecord(c.evidence_data);
    const expert = getEvidenceRecord(evidenceData?.expert_strategy);
    const expertOperationalInstructions = getEvidenceRecord(expert?.operational_instructions);
    const expertContractualDiagnostic = getEvidenceRecord(expert?.contractual_diagnostic);
    const missingEvidence = toStringList(evidenceData?.missing_evidence);
    const completionDeadlineReview = getEvidenceRecord(evidenceData?.completion_deadline_review);
    const completionDeadlineReferences = [...toRecordList(completionDeadlineReview?.agreementSources), ...toRecordList(completionDeadlineReview?.references)];
    const workPage = toPageValue(evidenceData?.work_page);
    const contractPage = toPageValue(evidenceData?.contract_page);
    const clauseReference = toDisplayText(evidenceData?.clause_reference);
    const richTextEvidence = toRichTextEvidenceData(evidenceData);
    const contractReferenceAuthority = getEvidenceRecord(evidenceData?.contract_reference_authority);
    const incorporationChain = toRecordList(contractReferenceAuthority?.chain);
    const supportAnalysis = getEvidenceRecord(evidenceData?.support_analysis);
    const supportReferences = toRecordList(supportAnalysis?.reference_evidence);
    const supportPrices = toRecordList(supportAnalysis?.price_evidence);
    const supportStatus = toDisplayText(supportAnalysis?.status);
    const impactSummary = cleanDisplayText(toDisplayText(supportAnalysis?.impact_summary));
    const repeatedHistory = toRecordList(evidenceData?.repeated_history);

    const evidenceStatus = getEvidenceDisplayStatus(evidenceData);

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
        ? `כדי לבדוק את הממצא צריך להשלים: ${missingEvidence.join(' | ')}.`
        : 'יש לבדוק את משמעות הדרישות, תחולתן והקשר בין המקורות לפני פעולה כספית. מציאת מובאות לבדה אינה מוכיחה סתירה.';

    return <RadarFindingView item={c} idx={idx} isExpanded={isExpanded} isItemRescanning={isItemRescanning} isScanning={isScanning} aiAvailable={aiAvailable} shouldAnimate={shouldAnimate} onToggleExpand={onToggleExpand} onRescanItem={onRescanItem} onUpdateStatus={onUpdateStatus} onDelete={onDelete} onNavigate={onNavigate} onRadarOpenDocument={onRadarOpenDocument}>
        {actionError && !deleteOpen && <Feedback tone="danger">{actionError}</Feedback>}
                                <div className="flex flex-col md:flex-row md:items-center gap-4 p-5 bg-white/[0.02] border border-white/5 rounded-2xl">
                            <div className="flex flex-wrap items-center gap-6">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRadarOpenDocument(c.source_doc?.id, workPage);
                                    }}
                                    disabled={!c.source_doc?.id} className="flex items-center gap-3 group/doc transition-all"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center group-hover/doc:border-blue-500/50 group-hover/doc:bg-blue-500/10 transition-colors">
                                        <FileText className="w-5 h-5 text-gray-400 group-hover/doc:text-blue-400" />
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500 font-bold">מסמך ביצוע</div>
                                        <div className="text-sm text-gray-200 font-bold">{c.source_doc?.title || 'לא נמצא מסמך ביצוע'}</div><span className="ti-meta">{workPage ? 'עמוד '+workPage : 'עמוד לא אומת'}</span>
                                    </div>
                                </button>

                                <ArrowRightLeft className="text-gray-600 w-4 h-4 hidden md:block" />

                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRadarOpenDocument(c.target_doc?.id || richTextEvidence?.document_pair?.contract_doc_id, contractPage);
                                    }}
                                    className="flex items-center gap-3 group/doc transition-all"
                                >
                                    <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/5 flex items-center justify-center group-hover/doc:border-blue-500/50 group-hover/doc:bg-blue-500/10 transition-colors">
                                        <Shield className="w-5 h-5 text-gray-400 group-hover/doc:text-blue-400" />
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-gray-500 font-bold">מסמך חוזי</div>
                                        <div className="text-sm text-gray-200 font-bold">{c.target_doc?.title || richTextEvidence?.contract_title || 'לא נמצא מסמך חוזי'}</div><span className="ti-meta">{contractPage ? 'עמוד '+contractPage : 'עמוד לא אומת'}</span>
                                    </div>
                                </button>
                            </div>

                            <div className="flex-1" />

                            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                                <button
                                    onClick={async (e) => {
                                        e.stopPropagation();
                                        await moveFindingToPricing(c,updateStatusInView,onNavigate);
                                    }}
                                    disabled={updating}
                                    className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm font-bold text-emerald-400 hover:bg-emerald-500/20 transition-all"
                                >
                                    <Database className="w-4 h-4" />
                                    מעבר לתמחור
                                </button>
                            </div>
                        </div>

                        {repeatedHistory.length > 1 && (
                            <div className="bg-violet-500/[0.05] p-5 rounded-2xl border border-violet-500/20 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-violet-300">
                                    <ClipboardList className="w-4 h-4" />
                                    היסטוריית הנושא בפרוטוקולים
                                </div>
                                <p className="text-sm text-gray-300 leading-7">
                                    הכרטיס מציג את העדכון האחרון. הנושא הופיע גם בפרוטוקולים הבאים:
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {repeatedHistory.map((entry, index) => {
                                        const documentId = toDisplayText(entry.source_document_id);
                                        const documentTitle = toDisplayText(entry.source_document_title) || 'פרוטוקול';
                                        const documentDate = toDisplayText(entry.document_date);
                                        return (
                                            <button
                                                key={`${documentId || 'protocol'}-${documentDate || index}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onRadarOpenDocument(documentId, null);
                                                }}
                                                disabled={!documentId}
                                                className="px-3 py-2 rounded-xl bg-black/20 border border-white/10 text-xs text-gray-200 hover:border-violet-400/40 hover:text-white disabled:cursor-default disabled:opacity-60 transition-colors"
                                            >
                                                {documentDate ? `${documentDate} · ` : ''}{documentTitle}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="flex items-center gap-3">
                                <Info className="w-5 h-5 text-blue-400" />
                                <span className="text-base text-gray-200 font-bold">למה המערכת סימנה את זה</span>
                            </div>
                            <div className="bg-white/[0.02] p-6 rounded-2xl border border-white/5">
                                <div className="text-base text-gray-200 leading-8">
                                    <RichText text={cleanDisplayText(c.description || '')} evidence={richTextEvidence} onOpen={onRadarOpenDocument} />
                                </div>
                                {evidenceStatus !== 'SOURCE_VERIFIED' && (
                                    <div className="mt-5 p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                                        <div className="flex items-center gap-2 text-amber-300 text-sm font-bold mb-2">
                                            <ShieldAlert className="w-4 h-4" />
                                            נדרשת בדיקה מול מסמכי המקור
                                        </div>
                                        <p className="text-sm text-gray-300 leading-7">{verificationMessage}</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="ti-radar-quotes grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white/[0.02] p-5 rounded-2xl border border-white/5 space-y-3">
                                <div className="flex items-center gap-2 text-sm font-bold text-blue-300">
                                    <Shield className="w-4 h-4" />
                                    ציטוט מהחוזה או מהבסיס
                                </div>
                                <p className="text-sm text-gray-200 leading-7">
                                    {cleanDisplayText(toDisplayText(evidenceData?.contract_quote) || toDisplayText(evidenceData?.original_instruction)) || 'לא נמצא עדיין ציטוט חוזי ישיר להצגה במסך.'}
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
                                    ציטוט ממסמך הביצוע
                                </div>
                                <p className="text-sm text-gray-200 leading-7">
                                    {cleanDisplayText(toDisplayText(evidenceData?.work_quote) || toDisplayText(evidenceData?.new_requirement)) || 'לא נמצא עדיין ציטוט ישיר ממסמך הביצוע.'}
                                </p>
                            </div>
                        </div>

                        <RadarFindingAssessment value={evidenceData} />
                        <RadarIssueHistory value={evidenceData?.issue_history} openDocument={onRadarOpenDocument} />
                        <RadarLinkedRecords projectId={c.project_id} findingId={c.id} value={evidenceData?.issue_reconciliation}
                            openDocument={onRadarOpenDocument} />

                        {completionDeadlineReferences.length > 0 && (
                            <div className="p-5 rounded-2xl border border-amber-400/20 bg-amber-500/5 space-y-3">
                                <h4 className="text-sm font-bold text-amber-200">מקורות שנבדקו למועד ההשלמה</h4>
                                {completionDeadlineReferences.map((source, index) => {
                                    const anchor = getEvidenceRecord(source.anchor);
                                    return <details key={`completion-source-${index}`} className="text-sm text-gray-300">
                                        <summary className="cursor-pointer">{toDisplayText(source.title)} · {toDisplayText(source.date)} · {source.scope === 'PROJECT' ? 'הפרויקט כולו' : source.scope === 'WATER_AND_SEWER' ? 'עבודות מים וביוב' : 'היקף לא מפורש'}</summary>
                                        <p className="mt-2 leading-7">{toDisplayText(anchor?.quote)}</p>
                                        <button className="text-blue-300 text-xs mt-2" onClick={() => onRadarOpenDocument(toDisplayText(source.documentId), toPageValue(anchor?.page))}>פתח מסמך מקור</button>
                                    </details>;
                                })}
                            </div>
                        )}

                        {supportAnalysis && (
                            <div className="bg-white/[0.02] p-5 rounded-2xl border border-white/5 space-y-4">
                                <div className="flex items-center gap-2 text-sm font-bold text-violet-300">
                                    <Database className="w-4 h-4" />
                                    בדיקת השפעה ומקורות נוספים
                                </div>
                                {supportStatus === 'ERROR' ? (
                                    <p className="text-sm text-amber-300">בדיקת המקורות הנוספים לא הושלמה ודורשת ניסיון נוסף.</p>
                                ) : (
                                    <>
                                        {impactSummary && <p className="text-sm text-gray-100 leading-7">{impactSummary}</p>}
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                            <div className="bg-black/20 border border-white/5 rounded-xl p-4 space-y-2">
                                                <div className="text-xs font-bold text-gray-400">חוזה מדף, הספר הכחול או תקן</div>
                                                {supportReferences.length === 0 ? (
                                                    <div className="text-xs text-gray-500">לא נמצא קטע נוסף שרלוונטי ישירות לממצא.</div>
                                                ) : supportReferences.map((reference, index) => (
                                                    <div key={`support-reference-${index}`} className="text-xs text-gray-300 leading-6">
                                                        <div className="font-bold text-gray-100">
                                                            {toDisplayText(reference.title) || 'מקור נוסף'}
                                                            {reference.page ? ` · עמוד ${toDisplayText(reference.page)}` : ''}
                                                        </div>
                                                        <div>{cleanDisplayText(toDisplayText(reference.quote))}</div>
                                                        <div className="text-gray-500">
                                                            {reference.applicability === 'CONFIRMED'
                                                                ? 'המקור מקושר למסמכי הפרויקט'
                                                                : reference.applicability === 'NEEDS_REVIEW'
                                                                    ? 'צריך לבדוק אם המקור מחייב בפרויקט'
                                                                    : 'מקור עזר; לא הוכח שהוא מחייב בפרויקט'}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="bg-black/20 border border-white/5 rounded-xl p-4 space-y-2">
                                                <div className="text-xs font-bold text-gray-400">בדיקת מחיר</div>
                                                {supportPrices.length === 0 ? (
                                                    <div className="text-xs text-gray-500">לא נמצאה התאמת מחיר ישירה. סדר הבדיקה נשאר: כתב הכמויות תחילה, אחריו מחירון מתאים.</div>
                                                ) : supportPrices.map((price, index) => (
                                                    <div key={`support-price-${index}`} className="text-xs text-gray-300 leading-6">
                                                        <div className="font-bold text-gray-100">
                                                            {toDisplayText(price.pricelist_name) || 'מחירון'}
                                                            {price.item_code ? ` · ${toDisplayText(price.item_code)}` : ''}
                                                        </div>
                                                        <div>{cleanDisplayText(toDisplayText(price.description))}</div>
                                                        {price.unit_price_excl_vat !== null && price.unit_price_excl_vat !== undefined && (
                                                            <div className="text-gray-500">מחיר יחידה לפני מע״מ: {toDisplayText(price.unit_price_excl_vat)} {toDisplayText(price.unit) || ''}</div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {incorporationChain.length > 0 && (
                            <div className="rounded-xl border border-white/10 p-4 space-y-3 text-xs text-gray-300 leading-6">
                                <div className="font-bold text-gray-100">שרשרת ההפניות למסמך</div>
                                {incorporationChain.map((link, index) => (
                                    <div key={`incorporation-${index}`}>
                                        <button className="text-blue-300 underline" onClick={(event) => {
                                            event.stopPropagation();
                                            onRadarOpenDocument(toDisplayText(link.sourceDocumentId), toPageValue(link.sourcePage));
                                        }}>{toDisplayText(link.sourceTitle)}</button>
                                        <span> ← {toDisplayText(link.targetTitle)}</span>
                                        <p>{toDisplayText(link.quote)}</p>
                                    </div>
                                ))}
                            </div>
                        )}

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
                                            void updateStatusInView(c.id, 'RESOLVED');
                                        }}
                                        disabled={updating} className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-black rounded-xl text-sm font-bold transition-all hover:bg-emerald-400"
                                    >
                                        <CheckCircle2 size={18} />
                                        סמן כטופל
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => {
                                            void updateStatusInView(c.id, 'OPEN');
                                        }}
                                        disabled={updating} className="flex items-center gap-2 px-6 py-3 bg-white/[0.03] border border-white/10 text-gray-300 rounded-xl text-sm font-bold hover:bg-white/[0.05] hover:text-white transition-all"
                                    >
                                        פתח מחדש
                                    </button>
                                )}
                                <button
                                    onClick={() => {
                                        setActionError(null);setDeleteOpen(true);
                                    }}
                                    className="p-3 bg-red-500/[0.03] border border-white/5 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                                    title="מחיקה" aria-label="מחיקת ממצא"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>

        <Dialog open={deleteOpen} labelledBy={'radar-delete-'+c.id} onClose={()=>{if(!deleting)setDeleteOpen(false);}}><h2 id={'radar-delete-'+c.id} className="ti-section-title">מחיקת ממצא</h2>{actionError && <Feedback tone="danger">{actionError}</Feedback>}<p className="ti-copy">האם למחוק את הממצא ״{cleanDisplayText(c.title)}״?</p><div className="ti-actions"><Button onClick={()=>setDeleteOpen(false)} disabled={deleting}>ביטול</Button><Button variant="danger" pending={deleting} busyLabel="מוחק…" onClick={async()=>{setDeleting(true);try{const deleted=await onDelete(c.id,true);if(deleted)setDeleteOpen(false);else setActionError('המחיקה לא הושלמה. הממצא נשמר.');}catch{setActionError('המחיקה לא הושלמה. הממצא נשמר.');}finally{setDeleting(false);}}}>מחיקת הממצא</Button></div></Dialog>
    </RadarFindingView>;
}

export default React.memo(ContradictionRadarFeedItem);
