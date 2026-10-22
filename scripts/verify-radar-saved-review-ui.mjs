import assert from 'node:assert/strict';
import test from 'node:test';
import { getRadarFindingKind, filterRadarFindings, buildRadarFindingCounts, buildRadarStatusFilterOptions } from '../src/components/features/contradiction-radar/utils/findingClassification.ts';
import { summarizeOpenContradictions } from '../src/components/features/projectOverviewStats.ts';

test('high importance does not turn a change or missing evidence into a contradiction', () => {
  assert.equal(getRadarFindingKind({ category: 'שינוי/חריג', severity: 'HIGH' }), 'VARIATION');
  assert.equal(getRadarFindingKind({ category: 'חוסר נתונים', severity: 'HIGH' }), 'MISSING_INFO');
});

test('a technical exclusion is absent from radar lists and every counter but its record remains intact', () => {
  const retained = { id: 'request', status: 'OPEN', category: 'שינוי/חריג', severity: 'MEDIUM' };
  const excluded = { id: 'wrong-pair', status: 'OPEN', severity: 'HIGH', category: 'סתירה',
    evidence_data: { review_disposition: { type: 'INVALID_AUTOMATIC_FINDING' } } };
  const rows = [retained, excluded];
  assert.deepEqual(filterRadarFindings(rows, 'ALL', 'OPEN'), [retained]);
  assert.equal(buildRadarFindingCounts(rows).all, 1);
  assert.equal(buildRadarStatusFilterOptions(rows)[0].count, 1);
  assert.deepEqual(summarizeOpenContradictions(rows), { openCount: 1, highRiskOpenCount: 0 });
  assert.equal(rows.length, 2);
  assert.equal(excluded.status, 'OPEN');
});
