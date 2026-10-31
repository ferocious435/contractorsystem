// Behavior of the current program; source spelling is not financial correctness.
// The former architecture/string assertions are retained in Git history and the
// delivery audit. These suites exercise arithmetic, unknowns, alternatives,
// evidence guards, saved snapshots, exports and failed pricing responses.
import {execFileSync} from 'node:child_process';
const files=[
 'scripts/verify-letter-financials.mjs','scripts/redesign/verify-individual-pricing.mjs',
 'scripts/verify-pricing-scope.mjs','scripts/verify-pricing-scope-measurements.mjs',
 'scripts/verify-work-change-financial-readiness.mjs','scripts/verify-radar-financial-guards.mjs',
 'scripts/verify-letter-export.mjs','scripts/verify-local-pricing-api.mjs','scripts/verify-codex-writing.mjs',
 'scripts/verify-overview-financials.mjs','scripts/redesign/verify-overview.mjs',
];
execFileSync(process.execPath,['--import','./scripts/codex-runtime/load-server.mjs','--test',...files],{stdio:'inherit'});
