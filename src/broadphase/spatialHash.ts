import type { Body, BroadPhaseResult } from '../physics/types';
import { PairBuffer } from './pairBuffer';

const pairs = new PairBuffer();

/**
 * Every circle is inserted into all cells touched by its AABB.
 *
 * This keeps the method correct for mixed body sizes. The pair set removes duplicates created when two bodies share
 * more than one cell; giant bodies make that bookkeeping cost visible, which is one of this case study's key lessons.
 */
export function runSpatialHashBroadPhase(bodies: Body[], cellSize: number): BroadPhaseResult {
  const startedAt = performance.now();
  const buckets = new Map<number, number[]>();
  const columns = Math.ceil(960 / cellSize) + 2;
  pairs.clear();

  for (let index = 0; index < bodies.length; index += 1) {
    const body = bodies[index];
    const minColumn = Math.floor((body.x - body.radius) / cellSize);
    const maxColumn = Math.floor((body.x + body.radius) / cellSize);
    const minRow = Math.floor((body.y - body.radius) / cellSize);
    const maxRow = Math.floor((body.y + body.radius) / cellSize);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const key = (row + 1) * columns + column + 1;
        let bucket = buckets.get(key);
        if (!bucket) {
          bucket = [];
          buckets.set(key, bucket);
        }
        bucket.push(index);
      }
    }
  }

  const seen = new Set<number>();
  let auxiliaryChecks = 0;
  let maxBucketSize = 0;

  for (const bucket of buckets.values()) {
    maxBucketSize = Math.max(maxBucketSize, bucket.length);
    for (let first = 0; first < bucket.length; first += 1) {
      for (let second = first + 1; second < bucket.length; second += 1) {
        auxiliaryChecks += 1;
        const a = bucket[first];
        const b = bucket[second];
        const low = Math.min(a, b);
        const high = Math.max(a, b);
        const key = low * bodies.length + high;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push(low, high);
        }
      }
    }
  }

  return {
    pairs,
    duration: performance.now() - startedAt,
    auxiliaryChecks,
    bucketCount: buckets.size,
    maxBucketSize,
  };
}
