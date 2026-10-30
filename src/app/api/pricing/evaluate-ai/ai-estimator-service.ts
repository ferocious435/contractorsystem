import type { SupabaseClient } from '@supabase/supabase-js';
import { canAutomaticallyPriceFinding } from '@/utils/radar-review-disposition';
import { loadPricingScopeContext } from '@/utils/pricing-scope-sources-server';
import { reviewPricingScope, PricingScopeLocalError } from '@/utils/pricing-scope-review-server';
import { buildPricingScopeEvaluation } from '@/utils/pricing-scope-evaluation';
import { generateComparisonText, getComparisonAiIdentity } from '@/server/ai/comparison.server';
import type { PricingScopeResult } from '@/utils/pricing-scope-review';
import { cachedPricingScope, pricingScopeSignature } from '@/utils/pricing-scope-signature';
import { DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS, normalizePricingEvaluation } from './evaluation-normalizers';
import { buildPricingEvidenceData } from './evaluation-context';
import type { AiExecutionContext } from '@/server/ai/contracts';

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};

export class PricingEvaluationHttpError extends Error {
    readonly status: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'PricingEvaluationHttpError'; }
}
export interface AiEstimatorServiceInput { contradictionId: string; projectId: string; contractorId: string; expertMode?: boolean; execution: AiExecutionContext }

export class AiEstimatorService {
    private readonly supabase: SupabaseClient;
    constructor(supabase: SupabaseClient) { this.supabase = supabase; }

    async evaluate(input: AiEstimatorServiceInput) {
        const { execution } = input;
        getComparisonAiIdentity(execution);
        const { data, error } = await this.supabase.from('contradictions').select('id, project_id, title, description, status, evidence_data')
            .eq('id', input.contradictionId).eq('project_id', input.projectId).single();
        if (error || !data) throw new PricingEvaluationHttpError(404, 'Contradiction not found');
        const finding = data as Row;
        if (!canAutomaticallyPriceFinding(finding)) throw new PricingEvaluationHttpError(409,
            'הממצא הוחרג מהבדיקה או נסגר. החישובים הקודמים זמינים בהיסטוריית הנושא.');
        const context = await loadPricingScopeContext({ supabase: this.supabase, projectId: input.projectId, findingId: input.contradictionId });
        const signature = pricingScopeSignature(context);
        const evidence = object(finding.evidence_data), previous = object(evidence.pricing_evaluation);
        const cachedScope = cachedPricingScope(previous, signature, context);
        const supportScope = cachedPricingScope(evidence.support_analysis, signature, context);
        let review: PricingScopeResult;
        const cached = Boolean(cachedScope);
        try {
            review = cachedScope || supportScope || await reviewPricingScope(context, execution);
        } catch (cause) {
            if (cause instanceof PricingScopeLocalError) throw new PricingEvaluationHttpError(503, cause.message);
            throw cause;
        }
        const evaluation = buildPricingScopeEvaluation(context, review);
        evaluation.scope_source_signature = signature;
        evaluation.suggested_description = finding.title || evaluation.suggested_description;
        normalizePricingEvaluation(evaluation, { hasSourceMatches: review.lines.some(line => line.unitPriceExclVat.value !== null),
            textFallbacks: DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS });
        let expertStrategy: unknown = cached ? previous.expert_strategy || evidence.expert_strategy || null : null;
        if (input.expertMode && !expertStrategy) {
            try {
                const result = await generateComparisonText(`Explain only the checked scope and missing evidence in Hebrew. Do not change money or claim entitlement without a source. Give practical next steps. Return JSON with technical_foundation, professional_argument, site_diary_instruction.
Work: ${String(finding.title || '')}
Checked explanation: ${String(evaluation.ai_rationale || '')}
Coverage: ${review.status}; still uncovered: ${review.uncoveredRequirementIds.join(', ')}.
Verified quotes (evidence only): ${JSON.stringify(review.positions.map(position => ({ item: position.itemCode, quotes: position.evidence })))}.`, execution, {responseFormat:{ type: 'object', additionalProperties: false, required: ['technical_foundation', 'professional_argument', 'site_diary_instruction'],
                        properties: { technical_foundation: { type: 'string' }, professional_argument: { type: 'string' }, site_diary_instruction: { type: 'string' } } }});
                expertStrategy = JSON.parse(result);
            } catch (cause) { throw new PricingEvaluationHttpError(503, cause instanceof Error ? cause.message : 'Local explanation unavailable'); }
        }
        if (!cached || (input.expertMode && !evidence.expert_strategy)) {
            const nextEvidence = buildPricingEvidenceData(evidence, evaluation, expertStrategy);
            const saved = await this.supabase.from('contradictions').update({ evidence_data: nextEvidence })
                .eq('id', input.contradictionId).eq('project_id', input.projectId);
            if (saved.error) throw saved.error;
        }
        return { success: true, ...evaluation, expert_strategy: expertStrategy };
    }
}
