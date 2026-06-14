import type { Body, BroadPhaseResult } from '../physics/types';
import { PairBuffer } from './pairBuffer';

interface Interval {
  bodyIndex: number;
  min: number;
  max: number;
}

/**
 * One-axis sweep and prune keeps interval order between frames.
 *
 * Insertion sort is inexpensive when motion is coherent, but the X-axis can become a poor discriminator when many
 * bodies overlap horizontally. A secondary Y-AABB test removes candidates before the exact circle narrow phase.
 */
export class SweepAndPrune {
  private readonly intervals: Interval[] = [];
  private readonly pairs = new PairBuffer();

  run(bodies: Body[]): BroadPhaseResult {
    const startedAt = performance.now();
    const usedFullSort = this.syncIntervals(bodies);
    this.pairs.clear();

    let swaps = 0;
    for (let index = 1; index < this.intervals.length; index += 1) {
      const current = this.intervals[index];
      let insertionIndex = index;
      while (
        insertionIndex > 0 &&
        this.intervals[insertionIndex - 1].min > current.min
      ) {
        this.intervals[insertionIndex] = this.intervals[insertionIndex - 1];
        insertionIndex -= 1;
        swaps += 1;
      }
      this.intervals[insertionIndex] = current;
    }

    let overlapChecks = 0;
    for (let first = 0; first < this.intervals.length; first += 1) {
      const firstInterval = this.intervals[first];
      const firstBody = bodies[firstInterval.bodyIndex];

      for (let second = first + 1; second < this.intervals.length; second += 1) {
        const secondInterval = this.intervals[second];
        if (secondInterval.min > firstInterval.max) {
          break;
        }

        overlapChecks += 1;
        const secondBody = bodies[secondInterval.bodyIndex];
        if (
          firstBody.y + firstBody.radius >= secondBody.y - secondBody.radius &&
          firstBody.y - firstBody.radius <= secondBody.y + secondBody.radius
        ) {
          this.pairs.push(
            Math.min(firstInterval.bodyIndex, secondInterval.bodyIndex),
            Math.max(firstInterval.bodyIndex, secondInterval.bodyIndex),
          );
        }
      }
    }

    return {
      pairs: this.pairs,
      duration: performance.now() - startedAt,
      auxiliaryChecks: overlapChecks,
      orderingSwaps: swaps,
      bucketEntries: 0,
      bucketCount: 0,
      maxBucketSize: 0,
      usedFullSort,
    };
  }

  reset(): void {
    this.intervals.length = 0;
  }

  private syncIntervals(bodies: Body[]): boolean {
    if (this.intervals.length !== bodies.length) {
      this.intervals.length = 0;
      for (let index = 0; index < bodies.length; index += 1) {
        this.intervals.push({
          bodyIndex: index,
          min: bodies[index].x - bodies[index].radius,
          max: bodies[index].x + bodies[index].radius,
        });
      }
      this.intervals.sort((first, second) => first.min - second.min);
      return true;
    }

    for (const interval of this.intervals) {
      const body = bodies[interval.bodyIndex];
      interval.min = body.x - body.radius;
      interval.max = body.x + body.radius;
    }
    return false;
  }
}
