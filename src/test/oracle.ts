import { pairKey } from '../physics/collision';
import type { Body, BroadPhaseResult } from '../physics/types';

/**
 * Shared test utilities that reproduce the application's correctness oracle.
 *
 * The brute-force pair set is the ground truth every broad phase is measured against: a broad phase is allowed to
 * over-report, but it must never drop a pair the exact narrow phase would confirm. These helpers encode that contract
 * so individual test files can assert it directly.
 */

/** Every unique ordered pair `(first, second)` whose circles overlap in the current frame, keyed for set membership. */
export function oracleContactKeys(bodies: Body[]): Set<number> {
  const keys = new Set<number>();
  for (let first = 0; first < bodies.length; first += 1) {
    for (let second = first + 1; second < bodies.length; second += 1) {
      const a = bodies[first];
      const b = bodies[second];
      const deltaX = b.x - a.x;
      const deltaY = b.y - a.y;
      const radiusSum = a.radius + b.radius;
      if (deltaX * deltaX + deltaY * deltaY < radiusSum * radiusSum) {
        keys.add(pairKey(first, second, bodies.length));
      }
    }
  }
  return keys;
}

/** The set of candidate pairs a broad phase emitted, keyed identically to the oracle. */
export function candidateKeys(result: BroadPhaseResult, bodyCount: number): Set<number> {
  const keys = new Set<number>();
  for (let index = 0; index < result.pairs.count; index += 1) {
    keys.add(pairKey(result.pairs.getFirst(index), result.pairs.getSecond(index), bodyCount));
  }
  return keys;
}

/** Number of true contacts the broad phase failed to propose. A correct broad phase always returns 0. */
export function missedContacts(oracle: Set<number>, candidates: Set<number>): number {
  let missed = 0;
  for (const key of oracle) {
    if (!candidates.has(key)) {
      missed += 1;
    }
  }
  return missed;
}

/** Asserts every emitted pair is unique and stored in ascending `(first < second)` order. Returns the pair count. */
export function assertWellFormedPairs(result: BroadPhaseResult): number {
  const seen = new Set<number>();
  for (let index = 0; index < result.pairs.count; index += 1) {
    const first = result.pairs.getFirst(index);
    const second = result.pairs.getSecond(index);
    if (first >= second) {
      throw new Error(`Pair ${index} is not ascending: (${first}, ${second}).`);
    }
    const key = first * 1_000_000 + second;
    if (seen.has(key)) {
      throw new Error(`Duplicate pair emitted: (${first}, ${second}).`);
    }
    seen.add(key);
  }
  return result.pairs.count;
}
