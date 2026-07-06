import { isVerifiedEvidence } from "./letter-evidence";

export type ServerLetterLedgerItem = {
  id?: string | null;
  contradiction_id?: string | null;
  evidence_data?: unknown;
};

export type ServerLetterContradiction = {
  id?: string | null;
  status?: string | null;
  source_execution_doc_id?: string | null;
  target_contract_doc_id?: string | null;
  evidence_data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPricingEvaluation(value: unknown) {
  if (!isRecord(value)) return null;
  const pricingEvaluation = value.pricing_evaluation;
  return isRecord(pricingEvaluation) ? pricingEvaluation : null;
}

export function buildServerBackedLetterEvidence(
  item: ServerLetterLedgerItem,
  contradiction: ServerLetterContradiction | null | undefined,
) {
  const serverEvidence = isRecord(contradiction?.evidence_data) ? contradiction.evidence_data : {};
  const ledgerPricingEvaluation = getPricingEvaluation(item.evidence_data);

  return {
    ...serverEvidence,
    evidence_source: contradiction?.id ? "server_contradiction" : "ledger_draft",
    contradiction_id: contradiction?.id || item.contradiction_id || null,
    source_execution_doc_id: contradiction?.source_execution_doc_id || null,
    target_contract_doc_id: contradiction?.target_contract_doc_id || null,
    pricing_evaluation: isRecord(serverEvidence.pricing_evaluation)
      ? serverEvidence.pricing_evaluation
      : ledgerPricingEvaluation,
  };
}

export function getOfficialLetterEvidenceBlockers(
  item: ServerLetterLedgerItem,
  contradiction: ServerLetterContradiction | null | undefined,
) {
  const blockers: string[] = [];

  if (!item.contradiction_id) {
    blockers.push("missing_contradiction_id");
  }

  if (!contradiction?.id) {
    blockers.push("missing_server_contradiction");
    return blockers;
  }

  if (contradiction.status === "ARCHIVED") {
    blockers.push("archived_contradiction");
  }

  if (!contradiction.source_execution_doc_id) {
    blockers.push("missing_work_document");
  }

  if (!contradiction.target_contract_doc_id) {
    blockers.push("missing_contract_document");
  }

  if (!isVerifiedEvidence(contradiction.evidence_data)) {
    blockers.push("unverified_server_evidence");
  }

  return blockers;
}
