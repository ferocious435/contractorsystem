import { geminiFlashModel } from '@/lib/gemini';
import { syncProjectContractBase } from '@/utils/project-contract-base-server';
import { syncContractBoqToLedger } from '@/utils/pricing-ledger-contract-sync';
import { isTrustedBaseContractRow } from '@/utils/project-financials';
import { isReferenceDocument } from '@/utils/contract-document-hierarchy';
import {
    DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS,
    normalizePricingEvaluation,
    parseGeminiJsonObject,
} from './evaluation-normalizers';
import {
    buildExpertPrompt,
    buildKeywordPrompt,
    buildPricingPrompt,
} from './evaluation-prompts';
import {
    buildBoqContext,
    buildBoqRawContext,
    buildMatchedItems,
    buildPricelistContext,
    buildPricingEvidenceData,
    buildSourceTrace,
    hasSourceMatches,
} from './evaluation-context';
import { extractPricingKeywords } from './evaluation-keywords';
import {
    appendUniqueParentNotes,
    buildParentItemCodePrefixes,
    buildParentNoteOrFilter,
    filterExternalPricingReferences,
} from './evaluation-pricelists';
import type { SupabaseClient } from '@supabase/supabase-js';

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toRecords = (value: unknown): AnyRecord[] =>
    Array.isArray(value) ? value.filter(isRecord) : [];

const CONTRADICTION_CONTEXT_SELECT_COLUMNS = [
    'id',
    'project_id',
    'title',
    'description',
    'category',
    'severity',
    'status',
    'pricing_status',
    'source_execution_doc_id',
    'target_contract_doc_id',
    'evidence_data',
    'created_at',
].join(', ');

export class PricingEvaluationHttpError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'PricingEvaluationHttpError';
    }
}

export interface AiEstimatorServiceInput {
    contradictionId: string;
    projectId: string;
    contractorId: string;
    expertMode?: boolean;
}

interface AiEstimatorContext {
    contradiction: AnyRecord;
    boqRawContext: string;
    keywords: string[];
}

interface AiEstimatorPriceMatches {
    ledgerMatches: AnyRecord[];
    trustedLedgerMatches: AnyRecord[];
    pricelistMatches: AnyRecord[];
}

export class AiEstimatorService {
    constructor(private readonly supabase: SupabaseClient) {}

    async evaluate(input: AiEstimatorServiceInput) {
        const context = await this.loadContext(input);
        const priceMatches = await this.findPriceMatches(input.projectId, context.keywords);
        const pricingPrompt = this.buildPrompt(context, priceMatches);

        const pricingResult = await geminiFlashModel.generateContent(pricingPrompt);
        const evaluation = this.normalizeResponse(
            pricingResult.response.text(),
            context,
            priceMatches,
        );

        const expertStrategy = await this.buildExpertStrategy(input.expertMode, context.contradiction, evaluation);
        await this.persistPricingEvidence(input.projectId, input.contradictionId, context.contradiction, evaluation, expertStrategy);

        return {
            success: true,
            ...evaluation,
            expert_strategy: expertStrategy,
        };
    }

    private async loadContext({
        contradictionId,
        projectId,
        contractorId,
    }: AiEstimatorServiceInput): Promise<AiEstimatorContext> {
        await syncProjectContractBase(this.supabase, projectId);
        await syncContractBoqToLedger(this.supabase, projectId, { contractorId });

        const { data: contradiction, error: cError } = await this.supabase
            .from('contradictions')
            .select(CONTRADICTION_CONTEXT_SELECT_COLUMNS)
            .eq('id', contradictionId)
            .eq('project_id', projectId)
            .single();

        if (cError || !contradiction) {
            throw new PricingEvaluationHttpError(404, 'Contradiction not found');
        }

        const contradictionRecord = contradiction as unknown as AnyRecord;

        const { data: contractDocs } = await this.supabase
            .from('documents')
            .select('title, parsed_json')
            .eq('project_id', projectId)
            .in('category', ['CONTRACT', 'BOQ', 'SPECS']);

        const boqRawContext = buildBoqRawContext(
            toRecords(contractDocs as unknown).filter((doc) => !isReferenceDocument(doc)),
        );

        const keywordPrompt = buildKeywordPrompt({
            title: contradictionRecord.title,
            description: contradictionRecord.description,
        });
        const keywordResult = await geminiFlashModel.generateContent(keywordPrompt);

        return {
            contradiction: contradictionRecord,
            boqRawContext,
            keywords: extractPricingKeywords(
                keywordResult.response.text(),
                `${contradictionRecord.title || ''} ${contradictionRecord.description || ''}`,
            ),
        };
    }

    private async findPriceMatches(projectId: string, keywords: string[]): Promise<AiEstimatorPriceMatches> {
        const ledgerSearchTerms = keywords.slice(0, 8);
        const ledgerOrConditions = ledgerSearchTerms.map((k: string) => `description.ilike.%${k}%`).join(',');

        const ledgerQuery = this.supabase
            .from('pricing_ledger')
            .select('item_code, description, unit, unit_price_excl_vat, source, type, evidence_data')
            .eq('project_id', projectId)
            .eq('type', 'BASE_CONTRACT')
            .eq('source', 'BOQ');

        const { data: ledgerMatches } = ledgerOrConditions
            ? await ledgerQuery.or(ledgerOrConditions).limit(30)
            : { data: [] };

        const pricelistMatches = await this.findExternalPricelistMatches(projectId, keywords);

        const ledgerMatchRows = toRecords(ledgerMatches as unknown);

        return {
            ledgerMatches: ledgerMatchRows,
            trustedLedgerMatches: ledgerMatchRows.filter(isTrustedBaseContractRow),
            pricelistMatches,
        };
    }

    private async findExternalPricelistMatches(projectId: string, keywords: string[]) {
        let pricelistMatches: AnyRecord[] = [];

        if (keywords.length === 0) {
            return pricelistMatches;
        }

        const searchTerms = keywords.slice(0, 8);
        const orConditions = searchTerms.map((k: string) => `description.ilike.%${k}%`).join(',');

        const { data: matches } = await this.supabase
            .from('pricelist_items')
            .select(`
                id,
                item_code,
                item_type,
                description,
                unit,
                rate,
                pricelists!inner (
                    name,
                    description,
                    source_type,
                    is_global,
                    project_id
                )
            `)
            .or(orConditions)
            .in('item_type', ['ITEM', 'NOTE'])
            .or(`pricelists.is_global.eq.true,pricelists.project_id.eq.${projectId}`)
            .limit(50);

        pricelistMatches = filterExternalPricingReferences(toRecords(matches as unknown));

        const itemMatches = pricelistMatches.filter((m: AnyRecord) => m.item_type === 'ITEM');
        if (itemMatches.length === 0) {
            return pricelistMatches;
        }

        const parentPrefixes = buildParentItemCodePrefixes(itemMatches);

        if (parentPrefixes.size === 0) {
            return pricelistMatches;
        }

        const orPrefixes = buildParentNoteOrFilter(parentPrefixes);
        const { data: parentNotes } = await this.supabase
            .from('pricelist_items')
            .select(`
                id, item_code, item_type, description,
                pricelists!inner (
                    name,
                    description,
                    source_type,
                    is_global,
                    project_id
                )
            `)
            .eq('item_type', 'NOTE')
            .or(orPrefixes)
            .or(`pricelists.is_global.eq.true,pricelists.project_id.eq.${projectId}`)
            .limit(40);

        if (parentNotes) {
            appendUniqueParentNotes(pricelistMatches, toRecords(parentNotes as unknown));
        }

        return pricelistMatches;
    }

    private buildPrompt(context: AiEstimatorContext, priceMatches: AiEstimatorPriceMatches) {
        return buildPricingPrompt({
            contradiction: context.contradiction,
            boqContext: buildBoqContext(priceMatches.trustedLedgerMatches),
            boqRawContext: context.boqRawContext,
            pricelistContext: buildPricelistContext(priceMatches.pricelistMatches),
        });
    }

    private normalizeResponse(
        pricingText: string,
        context: AiEstimatorContext,
        priceMatches: AiEstimatorPriceMatches,
    ) {
        const evaluation = parseGeminiJsonObject(pricingText);
        const sourceMatchesFound = hasSourceMatches(priceMatches.ledgerMatches, priceMatches.pricelistMatches);
        evaluation.source_trace = buildSourceTrace(
            priceMatches.ledgerMatches,
            priceMatches.pricelistMatches,
            context.keywords,
        );
        evaluation.matched_items = buildMatchedItems(priceMatches.ledgerMatches, priceMatches.pricelistMatches);
        normalizePricingEvaluation(evaluation, {
            hasSourceMatches: sourceMatchesFound,
            textFallbacks: DEFAULT_PRICING_EVALUATION_TEXT_FALLBACKS,
        });

        return evaluation;
    }

    private async buildExpertStrategy(
        expertMode: boolean | undefined,
        contradiction: AnyRecord,
        evaluation: AnyRecord,
    ) {
        if (!expertMode) {
            return null;
        }

        const { ENGINEERING_STRATEGY_PROMPT } = await import('@/lib/gemini');
        const expertPrompt = buildExpertPrompt({
            strategyPrompt: ENGINEERING_STRATEGY_PROMPT,
            contradiction,
            evaluation,
        });

        const expertResult = await geminiFlashModel.generateContent(expertPrompt);
        return parseGeminiJsonObject(expertResult.response.text());
    }

    private async persistPricingEvidence(
        projectId: string,
        contradictionId: string,
        contradiction: AnyRecord,
        evaluation: AnyRecord,
        expertStrategy: unknown,
    ) {
        const nextEvidenceData = buildPricingEvidenceData(
            (contradiction.evidence_data || {}) as unknown as AnyRecord,
            evaluation,
            expertStrategy,
        );

        await this.supabase
            .from('contradictions')
            .update({
                evidence_data: nextEvidenceData,
            })
            .eq('id', contradictionId)
            .eq('project_id', projectId);
    }
}
