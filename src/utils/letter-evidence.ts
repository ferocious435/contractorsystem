export type LetterEvidenceRecord = Record<string, unknown> & {
  document_title?: string | number | null;
  page?: string | number | null;
  comparison_type?: string | null;
  evidence_status?: string | null;
  contract_title?: string | number | null;
  contract_quote?: string | number | null;
  contract_page?: string | number | null;
  work_title?: string | number | null;
  work_quote?: string | number | null;
  work_page?: string | number | null;
  pricing_evaluation?: Record<string, unknown> | null;
  missing_evidence?: string[] | null;
};

function isEvidenceRecord(value: unknown): value is LetterEvidenceRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatEvidenceValue(value: unknown, fallback = "not specified") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

export function isVerifiedEvidence(evidenceData: unknown) {
  if (Array.isArray(evidenceData)) {
    return evidenceData.length > 0;
  }

  if (!isEvidenceRecord(evidenceData)) {
    return false;
  }

  const comparisonType = String(evidenceData.comparison_type || "").toLowerCase();
  if (comparisonType.includes("missing_data")) {
    return false;
  }

  return evidenceData.evidence_status === "VERIFIED" || Boolean(evidenceData.contract_quote && evidenceData.work_quote);
}

export function formatEvidenceForLetter(evidenceData: unknown) {
  if (Array.isArray(evidenceData) && evidenceData.length > 0) {
    return evidenceData
      .filter(isEvidenceRecord)
      .map((ev) => `- ${formatEvidenceValue(ev.document_title, "document")} (page ${formatEvidenceValue(ev.page, "?")})`)
      .join("\n");
  }

  if (!isEvidenceRecord(evidenceData)) {
    return "- No structured evidence was recorded. Manual verification is required.";
  }

  const lines: string[] = [];
  const evidenceStatus = isVerifiedEvidence(evidenceData) ? "VERIFIED" : "REQUIRES_VERIFICATION";
  lines.push(`- Evidence status: ${evidenceStatus}`);

  if (evidenceData.contract_title || evidenceData.contract_quote) {
    lines.push(`- Contract/BOQ: ${formatEvidenceValue(evidenceData.contract_title, "contract document")}${evidenceData.contract_page ? `, page ${evidenceData.contract_page}` : ""}`);
    if (evidenceData.contract_quote) lines.push(`  Contract quote: "${evidenceData.contract_quote}"`);
  }

  if (evidenceData.work_title || evidenceData.work_quote) {
    lines.push(`- Work/source: ${formatEvidenceValue(evidenceData.work_title, "work document")}${evidenceData.work_page ? `, page ${evidenceData.work_page}` : ""}`);
    if (evidenceData.work_quote) lines.push(`  Work quote: "${evidenceData.work_quote}"`);
  }

  const pricingEvaluation = isEvidenceRecord(evidenceData.pricing_evaluation) ? evidenceData.pricing_evaluation : null;
  if (pricingEvaluation) {
    lines.push(`- Pricing match: ${formatEvidenceValue(pricingEvaluation.match_quality)} / source: ${formatEvidenceValue(pricingEvaluation.source)}`);
    if (pricingEvaluation.quantity_basis) {
      lines.push(`- Quantity basis: ${pricingEvaluation.quantity_basis}`);
    }
    if (pricingEvaluation.quantity_review_required) {
      lines.push("- Quantity warning: manual quantity review is required");
    }
    if (pricingEvaluation.ancillary_scope && pricingEvaluation.ancillary_scope !== "NONE") {
      lines.push(`- Ancillary scope: ${pricingEvaluation.ancillary_scope}`);
    }
  }

  const missingEvidence = Array.isArray(evidenceData.missing_evidence)
    ? evidenceData.missing_evidence.filter((item): item is string => typeof item === "string")
    : [];

  if (missingEvidence.length > 0) {
    lines.push(`- Missing evidence: ${missingEvidence.join(", ")}`);
  }

  return lines.join("\n");
}
