import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildRadarStatusFilterOptions,
    filterRadarFindings,
} from '../src/components/features/contradiction-radar/utils/findingClassification.ts';

const findings = [
    { id: 'open', status: 'OPEN', severity: 'HIGH', category: 'contradiction' },
    { id: 'pricing', status: 'MOVED_TO_PRICING', severity: 'MEDIUM', category: 'variation' },
    { id: 'archived', status: 'ARCHIVED', severity: 'LOW', category: 'site event' },
];

test('radar defaults can show only current open findings', () => {
    const result = filterRadarFindings(findings, 'ALL', 'OPEN');
    assert.deepEqual(result.map((item) => item.id), ['open']);
});

test('radar exposes separate status counters', () => {
    assert.deepEqual(buildRadarStatusFilterOptions(findings), [
        { id: 'OPEN', label: 'פתוחים', count: 1 },
        { id: 'MOVED_TO_PRICING', label: 'הועברו לתמחור', count: 1 },
        { id: 'ARCHIVED', label: 'ארכיון', count: 1 },
    ]);
});
