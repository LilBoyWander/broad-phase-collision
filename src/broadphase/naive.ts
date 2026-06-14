import type { Body, BroadPhaseResult } from '../physics/types';
import { PairBuffer } from './pairBuffer';

const pairs = new PairBuffer();

/**
 * Brute force is both a baseline and the correctness oracle: every unique body pair becomes a candidate.
 */
export function runNaiveBroadPhase(bodies: Body[]): BroadPhaseResult {
  const startedAt = performance.now();
  pairs.clear();

  for (let first = 0; first < bodies.length; first += 1) {
    for (let second = first + 1; second < bodies.length; second += 1) {
      pairs.push(first, second);
    }
  }

  return {
    pairs,
    duration: performance.now() - startedAt,
    auxiliaryChecks: pairs.count,
    bucketCount: 0,
    maxBucketSize: 0,
  };
}
