import { createHash } from 'node:crypto';
import type { PricingScopeContext, PricingScopeResult } from './pricing-scope-review.ts';

/** Reuse a checked result only for the exact same currently loaded source packet. */
export function cachedPricingScope(value: unknown, signature: string): PricingScopeResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const scope = row.scope_review as Partial<PricingScopeResult> | undefined;
    return row.scope_source_signature === signature && scope?.version === 'price-scope-v1'
        && ['requirements', 'positions', 'lines', 'uncoveredRequirementIds', 'issues'].every(key => Array.isArray((scope as Record<string, unknown>)[key]))
        ? scope as PricingScopeResult : null;
}

/** Shared by evaluation cache and approval: a stale source cannot authorise a new amount. */
export function pricingScopeSignature(context: PricingScopeContext) {
    return createHash('sha256').update(JSON.stringify({ version: 'price-scope-v1', query: context.query,
        workQuote: context.workQuote, workSourceIds: [...context.workSourceIds].sort(),
        sources: [...context.sources].sort((a, b) => a.id.localeCompare(b.id)),
        candidates: [...context.candidates].sort((a, b) => a.id.localeCompare(b.id)),
    })).digest('hex');
}
