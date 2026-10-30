import { createHash } from 'node:crypto';
import {validatePricingScope, type PricingScopeContext, type PricingScopeResult} from './pricing-scope-review.ts';

/** Reuse a checked result only for the exact same currently loaded source packet. */
export function cachedPricingScope(value: unknown, signature: string, context: PricingScopeContext): PricingScopeResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const scope = row.scope_review as Partial<PricingScopeResult> | undefined;
    if(row.scope_source_signature!==signature||scope?.version!=='price-scope-v1'||!['requirements','positions','lines','uncoveredRequirementIds','issues'].every(key=>Array.isArray((scope as Record<string,unknown>)[key])))return null;
    try{
        // The saved status is a semantic proposal for unchanged sources. Recheck every
        // citation and all arithmetic; cached numeric values never become authority.
        const checked=validatePricingScope(context,{...scope,positions:scope.positions!.map(position=>({...position,dimensions:Object.fromEntries(['work','material','method','unit','conditions'].map(key=>[key,['FULL','PARTIAL'].includes(position.status)?'MATCH':'UNKNOWN']))}))});
        return ['requirements','positions','lines','totalExclVat','status','requiresReview','uncoveredRequirementIds'].every(key=>JSON.stringify(checked[key as keyof PricingScopeResult])===JSON.stringify(scope[key as keyof PricingScopeResult]))?scope as PricingScopeResult:null;
    }catch{return null;}
}

/** Shared by evaluation cache and approval: a stale source cannot authorise a new amount. */
export function pricingScopeSignature(context: PricingScopeContext) {
    return createHash('sha256').update(JSON.stringify({ version: 'price-scope-v1', query: context.query,
        workQuote: context.workQuote, workSourceIds: [...context.workSourceIds].sort(),
        sources: [...context.sources].sort((a, b) => a.id.localeCompare(b.id)),
        candidates: [...context.candidates].sort((a, b) => a.id.localeCompare(b.id)),
    })).digest('hex');
}
