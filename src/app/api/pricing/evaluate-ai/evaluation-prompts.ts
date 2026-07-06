import { CONTRACT_DOCUMENT_HIERARCHY_GUIDE } from '@/utils/contract-document-hierarchy';

export interface KeywordPromptInput {
    title: unknown;
    description: unknown;
}

export interface PricingPromptInput {
    contradiction: {
        title?: unknown;
        description?: unknown;
        evidence_data?: unknown;
    };
    boqContext: string;
    boqRawContext: string;
    pricelistContext: string;
}

export interface ExpertPromptInput {
    strategyPrompt: string;
    contradiction: {
        title?: unknown;
        evidence_data?: unknown;
    };
    evaluation: {
        suggested_unit_price_excl_vat?: unknown;
        suggested_unit?: unknown;
        ai_rationale?: unknown;
    };
}

export function buildKeywordPrompt({ title, description }: KeywordPromptInput) {
    return `
        Извлеки 3-5 ключевых технических терминов на иврите из следующего строительного противоречия.
        Фокусируйся на материалах, видах работ или инженерных терминах.
        Заголовок: ${title}
        Описание: ${description}
        Верни ТОЛЬКО список слов через запятую.

        `;
}

export function buildPricingPrompt({ contradiction, boqContext, boqRawContext, pricelistContext }: PricingPromptInput) {
    return `
        Senior Israeli Construction Claims Expert and Estimator (תמחירן ומומחה תביעות בכיר).
        Your goal is to analyze a construction contradiction and build a high-impact financial and commercial justification for a Variation Order (V.O.).

        CONTRADICTION:
        Title: ${contradiction.title}
        Description: ${contradiction.description}
        Evidence Trace: ${JSON.stringify(contradiction.evidence_data)}

        1. STRATEGIC CONTEXT (Highest Priority - Contractual Baseline):
        ${boqContext}

        RAW BOQ DATA:
        ${boqRawContext}

        2. PROJECT PRICE REFERENCES (official pricelists, plus quote evidence only as last resort):
        ${pricelistContext}

        DOCUMENT HIERARCHY / NAVIGATION RULES:
        ${CONTRACT_DOCUMENT_HIERARCHY_GUIDE}

        STRICT GUIDELINES:
        1. COMMERICIAL DEFENSE: If the work required is a "Material Change" (שינוי יסודי) or "Extra Work" (עבודה נוספת) not covered by the original scope, you MUST justify why contract prices might not apply (e.g., small quantity, urgent timing, specialized equipment).
        2. RISK ANALYSIS: Identify potential "Hidden Traps" (מלכודות) such as secondary impacts on other trades, logistics overhead, or sequence disruption.
        3. VAT COMPLIANCE: All prices MUST be EXCLUDING VAT (לפני מע"מ).
        4. CONTRACTUAL PRICING HIERARCHY:
           - [1 כתב כמויות / BOQ]: Always use first if a direct or defensible related contract item exists.
           - [2 מחירון משרד השיכון]: Use only if it appears in the project documents or the provided pricelist context.
           - [3 דקל]: Use only if it appears in the project documents or the provided pricelist context.
           - [4 הצעות מחיר]: Use supplier/contractor quotes only as supporting evidence or a last-resort fallback after BOQ, Ministry Housing, and Dekel do not provide a usable item. Never rank a quote above an official contract or pricelist source unless a specific contract clause explicitly says so.
           - [5 טיוטת תמחור לעריכה]: If no source item exists, build an editable draft from the contradiction and project documents. This is not a market price and must not be presented as final.
        5. ZERO MATCH: If no direct source item exists in the provided context, you should STILL build the best editable draft estimate you can from the contradiction, BOQ/spec context, execution implications, standards, and documented project logic. Use source=CUSTOM_ANALYSIS, lower confidence, and clearly mark what is source-backed versus AI inference. Ask clarifying questions only when a missing physical or measurable parameter can materially change the amount.
        6. EVIDENCE: Separate verified source evidence from AI inference. If anything is missing, describe only what affects the final amount or final approval, not what is needed to recognize the contradiction itself.
        6A. DOCUMENT PRECEDENCE: When documents conflict, explain which document family controls the pricing direction, whether the documents complement each other, or whether a supervisor/manager decision is required. Do not let an execution protocol, supplier quote, or site document override a contract/BOQ/spec source unless a written approval or change order proves it.
        7. USER FRICTION: Do not ask the user about approvals, meeting protocols, or budget authorizations as clarifying questions unless the amount itself cannot be computed without them. Put those items in needed_documents instead.
        8. QUANTITY LOGIC:
           - Prefer strongest quantity source: explicit quantity > derived quantity > estimated quantity.
           - For m2 work, use explicit area first. If no explicit area but reliable length and width exist, derive area. If neither exists, mark quantity as estimated and ask only the minimum question needed.
           - For linear work, use explicit or clearly confirmed line length. Do not silently trust 1 meter as final quantity.
           - For count-based work, use explicit or clearly confirmed count. Do not silently trust 1 item as final quantity.
           - Use quantity_basis: EXPLICIT, DERIVED, ESTIMATED, or LUMP_SUM.
        9. ANCILLARY WORKS:
           - Supporting works may be suggested, but do not automatically bake them into the final amount unless they are clearly documented or inseparable from the core work.
           - If supporting works are only likely or context-based, mark them as suggestion/review, not as confirmed scope.
           - Use ancillary_scope: NONE, SUGGEST_ONLY, REVIEW_ONLY, or BLOCKED_AUTO_INCLUDE.
        10. PRICING BREAKDOWN:
           - Do not return a naked total. Always return pricing_breakdown rows.
           - Each row must explain whether it came from BOQ, Ministry Housing, Dekel, quote, or an editable inferred line.
           - For demolition/reinstallation cases, consider separate rows such as dismantling, measurement/marking, reinstallation, fittings/connectors, testing, and disposal only when the evidence supports them or they are explicitly marked as inference.
           - If a row is invented because no official item exists, use item_code="DRAFT-..." and source="CUSTOM_ANALYSIS", with is_inference=true.
           - suggested_unit_price_excl_vat must be the effective unit price before contractor markup, derived from the breakdown.
        11. QUESTIONS VS PRICE:
           - If questions affect only final verification, you may provide a draft price but set requires_user_answer_before_approval=true.
           - If a missing answer can materially change quantity by more than 15%, do not present the price as final. Mark quantity_basis="ESTIMATED", quantity_review_required=true, and requires_user_answer_before_approval=true.
        12. LANGUAGE: All output text (Rationale, Description, Notes) MUST be in professional Hebrew.

        OUTPUT FORMAT (JSON ONLY):
        {
            "match_found": boolean,
            "source": "BOQ" | "HOUSING_MINISTRY" | "DEKEL" | "CONTRACTOR" | "CUSTOM_ANALYSIS",
            "confidence": number,
            "match_quality": "DIRECT" | "PARTIAL" | "ZERO_MATCH",
            "suggested_unit_price_excl_vat": number,
            "suggested_unit": "string (Hebrew)",
            "suggested_quantity": number,
            "item_code": "string",
            "ai_rationale": "Deep Hebrew justification including contractual basis",
            "suggested_description": "Professional Hebrew description for the invoice/letter",
            "governing_notes": ["Hebrew strings regarding measurements, inclusions, or risks"],
            "document_precedence_assessment": "Hebrew string explaining which document/source controls or what approval decision is still required",
            "source_basis": ["Hebrew strings naming the exact BOQ/pricelist/quote/inference basis used for the price"],
            "pricing_breakdown": [
                {
                    "item_code": "string",
                    "source": "BOQ" | "HOUSING_MINISTRY" | "DEKEL" | "CONTRACTOR" | "CUSTOM_ANALYSIS",
                    "source_name": "string",
                    "description": "Hebrew work-line description",
                    "unit": "string",
                    "quantity": number,
                    "unit_price_excl_vat": number,
                    "amount_excl_vat": number,
                    "basis": "Hebrew explanation of the source or assumption",
                    "is_inference": boolean
                }
            ],
            "needed_documents": ["Hebrew strings naming only documents or approvals that materially affect the final amount or final approval"],
            "zero_match_reason": "Hebrew explanation when match_quality is ZERO_MATCH",
            "questions": ["Targeted Hebrew questions only when a missing parameter truly changes the amount"],
            "quantity_basis": "EXPLICIT" | "DERIVED" | "ESTIMATED" | "LUMP_SUM",
            "quantity_review_required": boolean,
            "requires_user_answer_before_approval": boolean,
            "ancillary_scope": "NONE" | "SUGGEST_ONLY" | "REVIEW_ONLY" | "BLOCKED_AUTO_INCLUDE",
            "ancillary_notes": ["Hebrew notes about supporting works that must stay suggestion/review unless confirmed"]
        }

        `;
}

export function buildExpertPrompt({ strategyPrompt, contradiction, evaluation }: ExpertPromptInput) {
    return `
            ${strategyPrompt}

            DIAGNOSTIC FOCUS:
            1. MATERIAL CHANGE: Argue why this is NOT "Contract Work" (עבודות חוזיות) based on technical complexity.
            2. LOGISTICS & RISKS: Detail the "Work Interruption" (עיכובים) or "Disruption" (חוסר יעילות) from an engineering perspective.
            3. DOCUMENTARY LINK: Use the evidence trace ${JSON.stringify(contradiction.evidence_data)} to build an objective "Technical Evidence Chain".
            4. FINAL STAND: Maintain professional, neutral, and firm expert tone.

            CONTEXT:
            Title: ${contradiction.title}
            Suggested Price: ${evaluation.suggested_unit_price_excl_vat} ${evaluation.suggested_unit}
            Rationale: ${evaluation.ai_rationale}

            `;
}
