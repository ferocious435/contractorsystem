import assert from 'node:assert/strict';
import test from 'node:test';

const reviewModule = await import('../src/utils/contradiction-review.ts');

test('review correction preserves source quotes and records the manual verdict', () => {
  const update = reviewModule.buildContradictionReviewUpdate(
    { contract_quote: 'contract source', work_quote: 'work source', confidence: 0.95 },
    {
      title: 'Possible approval delay',
      description: 'The sources do not prove a contract contradiction.',
      category: 'אירוע שטח',
      severity: 'LOW',
      strategyAdvice: 'Request a dated written decision.',
      verdict: 'REFRAMED_NOT_CONTRACT_CONTRADICTION',
      comparisonType: 'site_event',
      missingEvidence: ['Approval submission date', 'Supervisor response'],
    },
    '2026-09-07T10:00:00.000Z',
  );

  assert.equal(update.severity, 'LOW');
  assert.equal(update.evidence_data.contract_quote, 'contract source');
  assert.equal(update.evidence_data.work_quote, 'work source');
  assert.equal(update.evidence_data.evidence_status, 'REQUIRES_VERIFICATION');
  assert.equal(update.evidence_data.confidence, null);
  assert.equal(update.evidence_data.manual_review.verdict, 'REFRAMED_NOT_CONTRACT_CONTRADICTION');
});
test('review correction rejects unsupported severity', () => {
  assert.throws(() => reviewModule.buildContradictionReviewUpdate({}, {
    title: 'Title',
    description: 'Description',
    category: 'Category',
    severity: 'CRITICAL',
    strategyAdvice: 'Advice',
    verdict: 'REQUIRES_REVIEW',
    comparisonType: 'missing_data',
  }), /Unsupported review severity/);
});
