import assert from 'node:assert/strict';
import test from 'node:test';

let overviewModule = null;
try {
    overviewModule = await import('../src/components/features/projectOverviewStats.ts');
} catch {
    // The first run should fail clearly until the overview helper exists.
}

test('dashboard counts only open findings and high severity risks', () => {
    assert.ok(overviewModule, 'project overview helper must exist');
    assert.deepEqual(overviewModule.summarizeOpenContradictions([
        { status: 'OPEN', severity: 'HIGH' },
        { status: 'OPEN', severity: 'MEDIUM' },
        { status: 'ARCHIVED', severity: 'HIGH' },
        { status: 'MOVED_TO_PRICING', severity: 'HIGH' },
    ]), {
        openCount: 2,
        highRiskOpenCount: 1,
    });
});
