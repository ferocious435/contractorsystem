import { VAT_RATE } from '@/utils/constants';
import type {
    EditablePricingLedgerRowType,
    PricingEstimationData,
    PricingLedgerRowType,
    PricingLedgerSource,
    PricingLedgerStatusUpdate,
} from './types';

export const PRICING_LEDGER_VAT_RATE = VAT_RATE;

export const SELECTABLE_VARIATION_ORDER_TYPES = ['PENDING_VO', 'APPROVED_VO'] as const satisfies readonly PricingLedgerRowType[];

export const EDITABLE_LEDGER_TYPES = [
    { value: 'PENDING_VO', label: 'חריג לבדיקה' },
    { value: 'APPROVED_VO', label: 'חריג מאושר' },
] as const satisfies ReadonlyArray<{ value: EditablePricingLedgerRowType; label: string }>;

export const LEDGER_ROW_TYPES = [
    { value: 'BASE_CONTRACT', label: 'חוזה בסיס' },
    { value: 'PENDING_VO', label: 'חריג לבדיקה' },
    { value: 'APPROVED_VO', label: 'חריג מאושר' },
    { value: 'SENT_VO', label: 'נשלח לדרישה' },
] as const satisfies ReadonlyArray<{ value: PricingLedgerRowType; label: string }>;

export const LEDGER_STATUS_UPDATES = [
    'PENDING_VO',
    'APPROVED_VO',
    'SENT_VO',
] as const satisfies readonly PricingLedgerStatusUpdate[];

export const LEDGER_SOURCES = [
    'BOQ',
    'DEKEL',
    'CONTRACTOR',
    'CUSTOM_ANALYSIS',
] as const satisfies readonly PricingLedgerSource[];

export const PENDING_QUEUE_STATUSES = ['OPEN', 'MOVED_TO_PRICING', 'PENDING'] as const;

export const DEFAULT_LEDGER_SOURCE = 'CUSTOM_ANALYSIS' satisfies PricingLedgerSource;

export const DEFAULT_NEW_LEDGER_ITEM = {
    type: 'PENDING_VO',
    source: DEFAULT_LEDGER_SOURCE,
    item_code: '',
    description: '',
    unit: "יח'",
    quantity: 1,
    unit_price_excl_vat: 0,
    markup_percentage: 0,
} as const satisfies PricingEstimationData;

export const PRICING_LEDGER_COLUMNS = [
    { id: 'selection', label: '', widthClassName: 'w-16', align: 'center' },
    { id: 'type', label: 'סוג שורה', widthClassName: 'w-36', align: 'right' },
    { id: 'item_code', label: 'קוד סעיף', widthClassName: 'w-28', align: 'right' },
    { id: 'description', label: 'תיאור העבודה', widthClassName: '', align: 'right' },
    { id: 'unit', label: 'יחידה', widthClassName: 'w-20', align: 'center' },
    { id: 'quantity', label: 'כמות', widthClassName: 'w-24', align: 'center' },
    { id: 'unit_price_excl_vat', label: 'מחיר יחידה', widthClassName: 'w-32', align: 'left' },
    { id: 'total_price_excl_vat', label: 'סה"כ ללא מע"מ', widthClassName: 'w-40', align: 'left' },
    { id: 'actions', label: 'פעולות', widthClassName: 'w-36', align: 'center' },
] as const;

export const PRICING_LEDGER_STAT_CARDS = [
    {
        id: 'base_contract',
        label: 'חוזה בסיס',
        valueKey: 'totalBaseExclVat',
        color: 'gray',
        sub: 'חוזה מקורי (לפני מע"מ)',
    },
    {
        id: 'variation_orders',
        label: 'שינויים וחריגים',
        valueKey: 'totalVOExclVat',
        color: 'blue',
        sub: 'פקודות שינויים (V.O)',
    },
    {
        id: 'vat',
        label: `מע"מ (${(VAT_RATE * 100).toFixed(0)}%)`,
        valueKey: 'grandTotalVat',
        color: 'emerald',
        sub: 'חישוב מע"מ סטטוטורי',
    },
    {
        id: 'grand_total',
        label: 'סה"כ כולל מע"מ',
        valueKey: 'grandTotalInclVat',
        color: 'primary',
        sub: 'סה"כ לתשלום סופי',
        highlight: true,
    },
] as const;

export const TYPE_BADGE_STYLES = {
    BASE_CONTRACT: {
        label: 'חוזה בסיס',
        className: 'bg-slate-500/10 border-slate-400/20 text-slate-300',
    },
    APPROVED_VO: {
        label: 'חריג מאושר',
        className: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
    },
    SENT_VO: {
        label: 'נשלח לדרישה',
        className: 'bg-sky-500/10 border-sky-500/20 text-sky-300',
    },
    PENDING_VO: {
        label: 'חריג לבדיקה',
        className: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    },
} as const satisfies Record<PricingLedgerRowType, { label: string; className: string }>;

export const SEVERITY_STYLES = {
    HIGH: {
        label: 'סיכון קריטי',
        className: 'bg-red-500/10 border-red-500/20 text-red-500',
        dotClassName: 'bg-red-500 shadow-[0_0_8px_#ef4444]',
    },
    MEDIUM: {
        label: 'השפעה בינונית',
        className: 'bg-amber-500/10 border-amber-500/20 text-amber-500',
        dotClassName: 'bg-amber-500 shadow-[0_0_8px_#f59e0b]',
    },
    LOW: {
        label: 'תיעוד סטנדרטי',
        className: 'bg-blue-500/5 border-white/5 text-gray-500',
        dotClassName: 'bg-gray-600',
    },
} as const;

export const CURRENCY_FORMAT_OPTIONS = {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
} as const satisfies Intl.NumberFormatOptions;

export const FOCUSED_PRICING_RETURN_VIEW = 'radar';
