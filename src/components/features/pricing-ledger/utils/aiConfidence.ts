import type { PricingContradictionItem } from '../types';
import {
    formatConfidencePercent,
    getPricingEvidenceConfidenceScore,
    normalizeConfidenceScore,
} from '../../../../utils/pricing-confidence';

export {
    formatConfidencePercent,
    normalizeConfidenceScore,
};

export function getQueueItemConfidenceScore(item: PricingContradictionItem): number | null {
    return getPricingEvidenceConfidenceScore(item);
}
