import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { calculateFixedVirtualWindow } from "../src/utils/virtual-window.mjs";

const root = process.cwd();

function readProjectFile(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(relativePath, expected, message) {
  const source = readProjectFile(relativePath);
  assert(
    source.includes(expected),
    `${message}\nMissing in ${relativePath}: ${expected}`
  );
}

function assertNotIncludes(relativePath, forbidden, message) {
  const source = readProjectFile(relativePath);
  assert(
    !source.includes(forbidden),
    `${message}\nForbidden in ${relativePath}: ${forbidden}`
  );
}

function assertRegex(relativePath, pattern, message) {
  const source = readProjectFile(relativePath);
  assert(
    pattern.test(source),
    `${message}\nPattern missing in ${relativePath}: ${pattern}`
  );
}

function assertNoUserFacingMojibake(relativePath) {
  const source = readProjectFile(relativePath);
  const literalNewlineMarker = "`r" + "`n";
  const mojibakePattern = /[\u0080-\u009F\uFFFD]|\u05D2[\u00A0-\u00FF\u2018-\u2122]|(?:\u05F3[\u00A0-\u00FF\u2018-\u2122]){2,}|\?{4,}/;
  assert(
    !mojibakePattern.test(source) && !source.includes(literalNewlineMarker),
    `${relativePath}: user-facing Hebrew must not contain mojibake or literal newline markers`
  );
}

function collectSourceFiles(relativeDir) {
  const absoluteDir = join(root, relativeDir);
  const files = [];
  for (const entry of readdirSync(absoluteDir)) {
    const absolutePath = join(absoluteDir, entry);
    const relativePath = `${relativeDir}/${entry}`;
    const stat = statSync(absolutePath);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(relativePath));
      continue;
    }
    if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry)) {
      files.push(relativePath);
    }
  }
  return files;
}

assertIncludes(
  "package.json",
  "\"verify:boq-scale\": \"node scripts/verify-enterprise-boq-scale.mjs\"",
  "enterprise BOQ scale verification must be available as an npm script"
);

assertIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "confidence_score?: AiConfidenceScore | null",
  "pricing ledger and queue types must expose explicit AI confidence scores"
);
assertIncludes(
  "src/components/features/pricing-ledger/types.ts",
  "ai_metadata?: PricingAiContradictionMetadata | null",
  "pricing ledger and queue types must expose structured AI metadata"
);
assertIncludes(
  "src/types/index.ts",
  "confidence_score?: number | null",
  "shared ledger item type must expose AI confidence for cross-feature consumers"
);
assertIncludes(
  "src/types/index.ts",
  "ai_metadata?: JsonObject | null",
  "shared ledger item type must expose AI metadata for cross-feature consumers"
);


[...collectSourceFiles("src"), ...collectSourceFiles("scripts")].forEach(assertNoUserFacingMojibake);

assertIncludes(
  "src/components/pricing/PrintableLetter.tsx",
  "\u05D4\u05D3\u05E4\u05E1 \u05DE\u05DB\u05EA\u05D1 \u05D3\u05E8\u05D9\u05E9\u05D4",
  "printable VO letter must keep readable Hebrew print text"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "\u05D7\u05E8\u05D9\u05D2 \u05DC\u05D1\u05D3\u05D9\u05E7\u05D4",
  "pricing ledger table must keep readable Hebrew VO status text"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "\u05D4\u05EA\u05D5\u05E8 \u05E0\u05E7\u05D9",
  "pending pricing queue empty state must keep readable Hebrew text"
);
assertIncludes(
  "src/app/dashboard/[id]/documents/page.tsx",
  ".eq('contractor_id', user.id)",
  "documents page must explicitly deny projects that do not belong to the signed-in contractor"
);
assertIncludes(
  "src/app/dashboard/[id]/documents/page.tsx",
  "if (!project) return redirect('/login');",
  "documents page must redirect when project ownership cannot be proven"
);
assertIncludes(
  "src/app/api/_utils/auth.ts",
  '.eq("projects.contractor_id", auth.user.id)',
  "shared document ownership helper must scope documents through the owning project contractor"
);
assertIncludes(
  "src/app/api/documents/signed-url/route.ts",
  "requireOwnedDocument<SignedUrlDocument>",
  "signed document URLs must be created only after document ownership is proven"
);
assertIncludes(
  "src/app/api/documents/process/route.ts",
  "requireOwnedDocument<Record<string, unknown>>(supabase, documentId, '*')",
  "document processing must require ownership before sending content for analysis"
);
assertIncludes(
  "src/app/api/documents/process/route.ts",
  "downloadDocumentBuffer(supabase, doc)",
  "document processing must download private storage objects through Supabase storage"
);
assertNotIncludes(
  "src/app/api/documents/process/route.ts",
  "fetch(doc.file_url)",
  "document processing must not fetch documents through public file URLs"
);
assertIncludes(
  "src/app/api/documents/delete/route.ts",
  "requireOwnedDocument<OwnedDocumentForDelete>",
  "document deletion must require ownership before removing files or rows"
);
assertIncludes(
  "supabase/migrations/20260702000000_harden_profiles_and_document_storage.sql",
  "SET public = false",
  "document storage migration must make the documents bucket private"
);
assertIncludes(
  "supabase/migrations/20260702000000_harden_profiles_and_document_storage.sql",
  "DROP POLICY IF EXISTS \"Public Access to Documents\"",
  "document storage migration must remove old public document access"
);
assertIncludes(
  "supabase/migrations/20260702000000_harden_profiles_and_document_storage.sql",
  "CREATE POLICY \"Users can read own document objects\"",
  "document storage migration must create owner-scoped read policy"
);
assertIncludes(
  "src/utils/pricing-confidence.ts",
  "export const AI_BULK_APPROVE_CONFIDENCE_THRESHOLD = 0.9",
  "smart bulk approval threshold must be centralized at Confidence > 90%"
);
assertIncludes(
  "src/components/features/pricing-ledger/constants.ts",
  "AI_BULK_APPROVE_CONFIDENCE_THRESHOLD as SHARED_AI_BULK_APPROVE_CONFIDENCE_THRESHOLD",
  "pricing-ledger constants must reuse the shared AI confidence threshold"
);

assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "queueConfidencePercentById",
  "queue panel must render per-item AI confidence"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "selectedHighConfidenceQueueIds",
  "queue panel must show the selected high-confidence approval set"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "onBulkApprove(selectedIds)",
  "queue panel smart approval must route selected rows through the bulk approval action"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "bulkApproveInFlightRef",
  "queue panel must guard against duplicate smart bulk approval clicks"
);
assertIncludes(
  "src/components/features/pricing-ledger/components/QueuePanel.tsx",
  "getConfidencePercent={getConfidencePercent}",
  "queue panel must pass confidence rendering into the queue table"
);

assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "const handleBulkApprove = useCallback",
  "pricing ledger state hook must own smart bulk approval logic"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "bulkApproveOperationRef",
  "smart bulk approval must protect UI state from stale async results"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "normalizePricingQueueIds(ids)",
  "smart bulk approval must normalize selected queue ids before processing"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "score !== null && score > AI_BULK_APPROVE_CONFIDENCE_THRESHOLD",
  "client-side smart approval must stage only Confidence > 90%"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "previewHighConfidenceQueueItems(projectId, clientEligibleIds)",
  "client-side smart approval must be backed by a server-side confidence preview"
);
assertIncludes(
  "src/components/features/pricing-ledger/hooks/usePricingLedgerState.ts",
  "superseded: true",
  "smart bulk approval must report superseded/stale operations"
);

assertIncludes(
  "src/components/features/pricing-ledger/api/pricingLedgerApi.ts",
  "fetch('/api/pricing/bulk-confidence-preview'",
  "pricing ledger API client must use the dedicated confidence preview endpoint"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "supabase.auth.getUser()",
  "confidence preview endpoint must require an authenticated user"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  ".eq('contractor_id', user.id)",
  "confidence preview endpoint must scope project access to the authenticated contractor"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/route.ts",
  "normalizePricingQueueIds(Array.isArray(ids) ? ids : [])",
  "confidence preview endpoint must normalize ids before database access"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".select('id, evidence_data')",
  "confidence preview service must fetch only the evidence needed for preview"
);
assertIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  "return score !== null && score > AI_BULK_APPROVE_CONFIDENCE_THRESHOLD",
  "confidence preview service must enforce Confidence > 90% server-side"
);
assertNotIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".insert(",
  "confidence preview service must remain read-only and avoid ledger mutations"
);
assertNotIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".update(",
  "confidence preview service must remain read-only and avoid status mutations"
);
assertNotIncludes(
  "src/app/api/pricing/bulk-confidence-preview/bulk-confidence-preview-service.ts",
  ".delete(",
  "confidence preview service must remain read-only and avoid destructive queue changes"
);

assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const VIRTUALIZATION_THRESHOLD = 500",
  "ledger table must virtualize massive BOQ row sets at 500+ rows"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const LedgerRowShell = React.memo",
  "ledger table rows must be isolated behind React.memo"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "calculateFixedVirtualWindow({",
  "ledger table virtualization must use the shared tested fixed-window calculator"
);
assertIncludes(
  "src/utils/virtual-window.mjs",
  "export function calculateFixedVirtualWindow",
  "fixed virtual window calculator must be isolated for behavioral verification"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "function useLatestCallback",
  "ledger table must stabilize parent action callbacks before passing them to memoized rows"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "const stableToggleSelectItem = useLatestCallback(toggleSelectItem)",
  "ledger table selection handlers must remain stable for zero-lag row memoization"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "prev.approveVO === next.approveVO",
  "display ledger row memoization must compare stable action handlers"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "requestAnimationFrame",
  "ledger table scroll handling must avoid synchronous scroll-state churn"
);
assertIncludes(
  "src/components/pricing/PricingLedgerTable.tsx",
  "export default React.memo(PricingLedgerTable)",
  "ledger table component must be memoized"
);

assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const QUEUE_ROW_VIRTUALIZATION_THRESHOLD = 500",
  "pending queue must virtualize massive contradiction queues at 500+ rows"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "const PendingQueueRow = React.memo",
  "pending queue rows must be isolated behind React.memo"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "prev.onToggleSelection === next.onToggleSelection",
  "pending queue row memoization must compare stable selection handlers"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "prev.confidencePercent === next.confidencePercent",
  "pending queue row memoization must rerender only when confidence display changes"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "requestAnimationFrame",
  "pending queue scroll handling must avoid synchronous scroll-state churn"
);
assertIncludes(
  "src/components/pricing/PendingQueueTable.tsx",
  "export default React.memo(PendingQueueTable)",
  "pending queue component must be memoized"
);

assertRegex(
  "src/components/features/PricingLedgerUI.tsx",
  /usePricingLedgerState\(/,
  "pricing ledger UI facade must use the modular state/action/derived hook"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "const queueConfidence = useMemo(() => ({",
  "pricing ledger UI facade must memoize derived confidence state for QueuePanel"
);
assertIncludes(
  "src/components/features/PricingLedgerUI.tsx",
  "confidence={queueConfidence}",
  "pricing ledger UI facade must pass derived confidence state into QueuePanel"
);

const firstWindow = calculateFixedVirtualWindow({
  itemCount: 1000,
  scrollTop: 0,
  viewportHeight: 800,
  rowHeight: 80,
  overscan: 8,
  fallbackVisibleRows: 12,
});
assert(firstWindow.startIndex === 0, "fixed virtual window must start at zero for top scroll");
assert(firstWindow.endIndex === 26, "fixed virtual window must include viewport rows plus overscan at top");
assert(firstWindow.topPadding === 0, "fixed virtual window top padding must be zero at top scroll");
assert(firstWindow.bottomPadding === 77920, "fixed virtual window bottom padding must preserve full scroll height");

const midWindow = calculateFixedVirtualWindow({
  itemCount: 1000,
  scrollTop: 40000,
  viewportHeight: 800,
  rowHeight: 80,
  overscan: 8,
  fallbackVisibleRows: 12,
});
assert(midWindow.startIndex === 492, "fixed virtual window must overscan before the visible scroll row");
assert(midWindow.endIndex === 518, "fixed virtual window must retain a bounded non-empty row window");
assert(midWindow.topPadding === 39360, "fixed virtual window top padding must match skipped rows");
assert(midWindow.bottomPadding === 38560, "fixed virtual window bottom padding must match remaining rows");

const tinyViewportWindow = calculateFixedVirtualWindow({
  itemCount: 1000,
  scrollTop: 0,
  viewportHeight: 0,
  rowHeight: 80,
  overscan: 8,
  fallbackVisibleRows: 12,
});
assert(tinyViewportWindow.endIndex > tinyViewportWindow.startIndex, "fixed virtual window must never produce an empty window for massive ledgers");

console.log("Enterprise BOQ scale and AI automation invariants verified.");
