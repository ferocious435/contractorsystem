// Exercise the current document workflow. The former source-string checklist is
// retained in verify-document-workflow.mjs; it describes the retired provider path.
import {execFileSync} from 'node:child_process';

const suites=[
    'scripts/verify-codex-documents.mjs',
    'scripts/verify-document-display-status.mjs',
    'scripts/verify-document-source-readiness.mjs',
    'scripts/verify-document-duplicates.mjs',
    'scripts/verify-document-reference-authority.mjs',
    'scripts/verify-document-reference-loader.mjs',
    'scripts/verify-document-page-number.mjs',
    'scripts/verify-reference-page-preview.mjs',
    'scripts/verify-docx-image-reading.mjs',
    'scripts/verify-docx-extraction-route.mjs',
    'scripts/verify-scan-chunk-coverage.mjs',
    'scripts/redesign/verify-documents.mjs',
];
execFileSync(process.execPath,['--import','./scripts/codex-runtime/load-server.mjs','--test','--test-concurrency=1',...suites],{stdio:'inherit',windowsHide:true});
