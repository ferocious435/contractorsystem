import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, loadInput, inspectInput, serializableReport } from './radar-point-1-3-harness.mjs';

if (!process.argv[2] || !process.argv[3]) {
  throw new Error('Usage: node --experimental-strip-types scripts/audit-radar-point-1-3.mjs <saved-snapshot.json> <local-report.json>');
}
const outputPath = path.resolve(process.argv[3]);
const localAuditRoot = path.join(root, 'data', 'point1-audit');
const relative = path.relative(localAuditRoot, outputPath);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('Reports may only be saved inside data/point1-audit');
}
const loaded = loadInput(process.argv[2]);
const report = serializableReport(loaded, inspectInput(loaded));
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  report: fileURLToPath(new URL(`../data/point1-audit/${relative.replaceAll('\\', '/')}`, import.meta.url)),
  checked: report.cases.length,
  passedDesiredResult: report.cases.filter(row => row.expectedResultReached).length,
  failedDesiredResult: report.cases.filter(row => !row.expectedResultReached).length,
  actualGateAccepted: report.cases.filter(row => row.quality.accepted).length,
  actualGateVerified: report.cases.filter(row => row.quality.evidenceStatus === 'VERIFIED').length,
  oldMtmQuoteFound: report.history.oldPricedMtm.quoteFound,
  currentDecemberRepeatEntries: report.history.existingDecemberRepeatHistory.length,
  actualMtmClosure: report.history.actualResolution,
  networkAttempts: report.networkAttempts.length,
}, null, 2));
