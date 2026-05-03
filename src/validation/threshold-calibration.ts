/**
 * Validation Threshold Calibration — Age-Weighted Scoring
 *
 * Problem: Current validation thresholds (75/60/45) treat all items the same,
 * regardless of whether they have eBay sales history or are brand new listings.
 * New items (< 7 days tracked) get penalized because velocity data is missing,
 * even when momentum signals are strong.
 *
 * Solution: Weighted scoring that adjusts momentum vs. velocity emphasis based
 * on item age (days tracked):
 *   - New items (< 7 days):   70% momentum + 30% velocity
 *   - Established (>= 7 days): 30% momentum + 70% velocity
 *   - Smooth transition between 0-14 days
 *
 * Velocity thresholds by tier: 5 (buy) / 10 (watch) / 20 (skip)
 * Momentum thresholds by tier: 75 (buy) / 60 (watch) / 45 (skip)
 */

import type { ValidationRunRequest } from './types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const NEW_ITEM_THRESHOLD_DAYS = 7;        // < 7 days = new item
const WEIGHT_TRANSITION_END = 14;         // full transition completes at day 14

// Momentum thresholds (out of 100)
const MOMENTUM_THRESHOLDS = {
  buy: 75,
  watch: 60,
  skip: 45,
};

// Velocity thresholds (total sold units across day1-day5)
const VELOCITY_THRESHOLDS = {
  buy: 5,
  watch: 10,
  skip: 20,
};

// Default weights for new vs established
const NEW_ITEM_WEIGHTS = {
  momentum: 0.7,
  velocity: 0.3,
};

const ESTABLISHED_ITEM_WEIGHTS = {
  momentum: 0.3,
  velocity: 0.7,
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface ScoringWeights {
  momentum: number;
  velocity: number;
}

export interface EffectiveThresholds {
  momentumBuy: number;
  momentumWatch: number;
  velocityBuy: number;
  velocityWatch: number;
}

export interface WeightedScoreResult {
  // Composite score (0-100)
  compositeScore: number;

  // Component scores
  momentumScore: number | null;
  velocityScore: number | null;

  // Threshold classification
  classification: 'BUY' | 'WATCH' | 'SKIP';
  momentumClassification: 'BUY' | 'WATCH' | 'SKIP';
  velocityClassification: 'BUY' | 'WATCH' | 'SKIP';

  // Weights used
  weights: ScoringWeights;
  daysTracked: number | null;
  isNewItem: boolean;

  // Effective thresholds (adjusted by weights)
  effectiveThresholds: EffectiveThresholds;

  // Reasoning
  reasoning: string[];
}

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Calculate scoring weights based on item age (days tracked).
 *
 * Days 0-6:  70% momentum / 30% velocity (new item weights)
 * Days 7-14: Linear transition from new → established weights
 * Days 14+:  30% momentum / 70% velocity (established item weights)
 */
export function calculateAgeAwareWeights(
  daysTracked: number | null
): { weights: ScoringWeights; isNewItem: boolean } {
  if (daysTracked === null || daysTracked < 0) {
    return {
      weights: { ...NEW_ITEM_WEIGHTS },
      isNewItem: true,
    };
  }

  if (daysTracked >= WEIGHT_TRANSITION_END) {
    return {
      weights: { ...ESTABLISHED_ITEM_WEIGHTS },
      isNewItem: false,
    };
  }

  if (daysTracked < NEW_ITEM_THRESHOLD_DAYS) {
    return {
      weights: { ...NEW_ITEM_WEIGHTS },
      isNewItem: true,
    };
  }

  // Linear interpolation between NEW_ITEM_THRESHOLD_DAYS and WEIGHT_TRANSITION_END
  const progress = (daysTracked - NEW_ITEM_THRESHOLD_DAYS) / (WEIGHT_TRANSITION_END - NEW_ITEM_THRESHOLD_DAYS);
  const momentumWeight = NEW_ITEM_WEIGHTS.momentum +
    (ESTABLISHED_ITEM_WEIGHTS.momentum - NEW_ITEM_WEIGHTS.momentum) * progress;
  const velocityWeight = 1 - momentumWeight;

  return {
    weights: {
      momentum: Math.round(momentumWeight * 100) / 100,
      velocity: Math.round(velocityWeight * 100) / 100,
    },
    isNewItem: daysTracked < NEW_ITEM_THRESHOLD_DAYS,
  };
}

/**
 * Calculate effective thresholds adjusted by the current weights.
 *
 * When momentum weight is high (new items), the momentum threshold effectively
 * matters more, so we lower the velocity bar proportionally, and vice versa.
 *
 * The formula scales thresholds by the inverse of their weight:
 *   effective_momentum_threshold = momentum_threshold * (1 - momentum_weight + momentum_weight * 0.5)
 *   effective_velocity_threshold = velocity_threshold * (1 - velocity_weight + velocity_weight * 0.5)
 *
 * This gives ~25% leeway on the dominant signal while keeping the threshold meaningful.
 */
export function calculateEffectiveThresholds(
  weights: ScoringWeights
): EffectiveThresholds {
  const momentumScale = 1 - weights.momentum + weights.momentum * 0.5;
  const velocityScale = 1 - weights.velocity + weights.velocity * 0.5;

  return {
    momentumBuy: Math.round(MOMENTUM_THRESHOLDS.buy * momentumScale * 10) / 10,
    momentumWatch: Math.round(MOMENTUM_THRESHOLDS.watch * momentumScale * 10) / 10,
    velocityBuy: Math.round(VELOCITY_THRESHOLDS.buy * velocityScale * 10) / 10,
    velocityWatch: Math.round(VELOCITY_THRESHOLDS.watch * velocityScale * 10) / 10,
  };
}

/**
 * Classify a momentum score against effective thresholds.
 */
function classifyMomentum(
  score: number | null,
  thresholds: EffectiveThresholds
): 'BUY' | 'WATCH' | 'SKIP' {
  if (score === null) return 'SKIP';
  if (score >= thresholds.momentumBuy) return 'BUY';
  if (score >= thresholds.momentumWatch) return 'WATCH';
  return 'SKIP';
}

/**
 * Classify velocity (total sold units) against effective thresholds.
 */
function classifyVelocity(
  score: number | null,
  thresholds: EffectiveThresholds
): 'BUY' | 'WATCH' | 'SKIP' {
  if (score === null) return 'WATCH'; // No velocity data = neutral, not automatic skip
  if (score >= thresholds.velocityBuy) return 'BUY';
  if (score >= thresholds.velocityWatch) return 'WATCH';
  return 'SKIP';
}

/**
 * Extract momentum score from request validation context.
 * Uses artist momentum score from the request's currentMetrics or item data.
 */
function extractMomentumScore(request: ValidationRunRequest): number | null {
  // Check if currentMetrics has a momentum field (may be added by Airtable formula)
  const metrics = request.validation.currentMetrics;

  // Check artist-tier or momentum from the request
  // The momentum score comes from Artist/Group table, not directly in currentMetrics
  // It would be available as part of the artistTier context
  return null; // Fallback — populated by caller if available
}

/**
 * Calculate total velocity (sold units) from current metrics.
 */
function extractVelocityScore(request: ValidationRunRequest): number | null {
  const m = request.validation.currentMetrics;
  const day1 = m.day1Sold ?? 0;
  const day2 = m.day2Sold ?? 0;
  const day3 = m.day3Sold ?? 0;
  const day4 = m.day4Sold ?? 0;
  const day5 = m.day5Sold ?? 0;
  const total = day1 + day2 + day3 + day4 + day5;
  return total > 0 ? total : null;
}

/**
 * Map classification to a 0-100 composite score.
 */
function classificationToScore(classification: 'BUY' | 'WATCH' | 'SKIP'): number {
  switch (classification) {
    case 'BUY': return 80;
    case 'WATCH': return 50;
    case 'SKIP': return 20;
  }
}

/**
 * Main weighted scoring function.
 *
 * Takes the validation request, optional external momentum score, and computes
 * an age-aware weighted composite score with buy/watch/skip classification.
 */
export function computeWeightedValidationScore(
  request: ValidationRunRequest,
  momentumScoreOverride?: number | null
): WeightedScoreResult {
  const daysTracked = request.validation.currentMetrics.daysTracked;
  const { weights, isNewItem } = calculateAgeAwareWeights(daysTracked);
  const thresholds = calculateEffectiveThresholds(weights);

  const momentumScore = momentumScoreOverride ?? extractMomentumScore(request);
  const velocityScore = extractVelocityScore(request);

  const momentumClass = classifyMomentum(momentumScore, thresholds);
  const velocityClass = classifyVelocity(velocityScore, thresholds);

  // Composite: weighted combination of component scores
  const momentumComponent = classificationToScore(momentumClass);
  const velocityComponent = classificationToScore(velocityClass);
  const compositeScore = Math.round(
    momentumComponent * weights.momentum + velocityComponent * weights.velocity
  );

  // Final classification: most restrictive (unless either is BUY)
  // If either component says BUY, composite is at least WATCH
  // If both say BUY, composite is BUY
  let classification: 'BUY' | 'WATCH' | 'SKIP';
  if (momentumClass === 'BUY' && velocityClass === 'BUY') {
    classification = 'BUY';
  } else if (momentumClass === 'BUY' || velocityClass === 'BUY') {
    classification = 'WATCH'; // One strong signal + one neutral = watch
  } else if (momentumClass === 'SKIP' && velocityClass === 'SKIP') {
    classification = 'SKIP';
  } else {
    classification = 'WATCH'; // Mixed signals = watch
  }

  // Override: if composite score is high enough, upgrade to BUY
  if (compositeScore >= 70 && classification === 'WATCH') {
    classification = 'BUY';
  }

  // Build reasoning
  const reasoning: string[] = [];
  reasoning.push(
    `Item age: ${daysTracked !== null ? `${daysTracked} days` : 'unknown'}, ` +
    `type: ${isNewItem ? 'new' : 'established'}`
  );
  reasoning.push(
    `Weights: momentum ${Math.round(weights.momentum * 100)}%, ` +
    `velocity ${Math.round(weights.velocity * 100)}%`
  );
  reasoning.push(
    `Effective thresholds — momentum BUY/Watch: ${thresholds.momentumBuy}/${thresholds.momentumWatch}, ` +
    `velocity BUY/Watch: ${thresholds.velocityBuy}/${thresholds.velocityWatch}`
  );
  if (momentumScore !== null) {
    reasoning.push(
      `Momentum: ${momentumScore}/100 → ${momentumClass}`
    );
  } else {
    reasoning.push('Momentum: no data → treated as SKIP (neutral for new items)');
  }
  if (velocityScore !== null) {
    reasoning.push(
      `Velocity: ${velocityScore} units sold (day1-day5) → ${velocityClass}`
    );
  } else {
    reasoning.push('Velocity: no sales data → treated as neutral (WATCH)');
  }
  reasoning.push(`Composite score: ${compositeScore}/100 → ${classification}`);

  return {
    compositeScore,
    momentumScore,
    velocityScore,
    classification,
    momentumClassification: momentumClass,
    velocityClassification: velocityClass,
    weights,
    daysTracked,
    isNewItem,
    effectiveThresholds: thresholds,
    reasoning,
  };
}

/**
 * Convenience: check if the request qualifies for age-aware calibration.
 */
export function shouldApplyAgeAwareCalibration(request: ValidationRunRequest): boolean {
  // Apply when the item is in a watchable/tracking state
  return (
    request.validation.autoCheckEnabled === true &&
    request.validation.buyDecision === 'Watching' &&
    request.validation.automationStatus === 'Watching'
  );
}

// ── Batch calibration for analysis ───────────────────────────────────────────

export interface CalibrationComparison {
  itemLabel: string;
  daysTracked: number | null;
  momentumScore: number | null;
  velocityScore: number | null;

  // Old scoring (flat thresholds: 75/60/45)
  oldMomentumClass: 'BUY' | 'WATCH' | 'SKIP';
  oldVelocityClass: 'BUY' | 'WATCH' | 'SKIP';
  oldCompositeScore: number;
  oldClassification: 'BUY' | 'WATCH' | 'SKIP';

  // New scoring (age-weighted)
  newCompositeScore: number;
  newClassification: 'BUY' | 'WATCH' | 'SKIP';
  newWeights: ScoringWeights;
  isNewItem: boolean;
  effectiveThresholds: EffectiveThresholds;

  // Delta
  classificationChanged: boolean;
  scoreDelta: number;
}

/**
 * Compare old flat scoring vs new age-weighted scoring for analysis.
 */
export function calibrateAndCompare(
  itemLabel: string,
  daysTracked: number | null,
  momentumScore: number | null,
  velocityScore: number | null
): CalibrationComparison {
  // Old scoring: flat thresholds, 50/50 weight
  const oldThresholds = {
    momentumBuy: MOMENTUM_THRESHOLDS.buy,
    momentumWatch: MOMENTUM_THRESHOLDS.watch,
    velocityBuy: VELOCITY_THRESHOLDS.buy,
    velocityWatch: VELOCITY_THRESHOLDS.watch,
  };
  const oldMomentumClass = classifyMomentum(momentumScore, oldThresholds);
  const oldVelocityClass = classifyVelocity(velocityScore, oldThresholds);
  const oldMomentumComp = classificationToScore(oldMomentumClass);
  const oldVelocityComp = classificationToScore(oldVelocityClass);
  const oldCompositeScore = Math.round((oldMomentumComp + oldVelocityComp) / 2);

  let oldClassification: 'BUY' | 'WATCH' | 'SKIP';
  if (oldMomentumClass === 'BUY' && oldVelocityClass === 'BUY') oldClassification = 'BUY';
  else if (oldMomentumClass === 'BUY' || oldVelocityClass === 'BUY') oldClassification = 'WATCH';
  else if (oldMomentumClass === 'SKIP' && oldVelocityClass === 'SKIP') oldClassification = 'SKIP';
  else oldClassification = 'WATCH';
  if (oldCompositeScore >= 70 && oldClassification === 'WATCH') oldClassification = 'BUY';

  // New scoring: age-weighted
  const { weights, isNewItem } = calculateAgeAwareWeights(daysTracked);
  const effectiveThresholds = calculateEffectiveThresholds(weights);
  const newMomentumClass = classifyMomentum(momentumScore, effectiveThresholds);
  const newVelocityClass = classifyVelocity(velocityScore, effectiveThresholds);
  const newMomentumComp = classificationToScore(newMomentumClass);
  const newVelocityComp = classificationToScore(newVelocityClass);
  const newCompositeScore = Math.round(
    newMomentumComp * weights.momentum + newVelocityComp * weights.velocity
  );

  let newClassification: 'BUY' | 'WATCH' | 'SKIP';
  if (newMomentumClass === 'BUY' && newVelocityClass === 'BUY') newClassification = 'BUY';
  else if (newMomentumClass === 'BUY' || newVelocityClass === 'BUY') newClassification = 'WATCH';
  else if (newMomentumClass === 'SKIP' && newVelocityClass === 'SKIP') newClassification = 'SKIP';
  else newClassification = 'WATCH';
  if (newCompositeScore >= 70 && newClassification === 'WATCH') newClassification = 'BUY';

  return {
    itemLabel,
    daysTracked,
    momentumScore,
    velocityScore,
    oldMomentumClass,
    oldVelocityClass,
    oldCompositeScore,
    oldClassification,
    newCompositeScore,
    newClassification,
    newWeights: weights,
    isNewItem,
    effectiveThresholds,
    classificationChanged: oldClassification !== newClassification,
    scoreDelta: newCompositeScore - oldCompositeScore,
  };
}
