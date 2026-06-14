import { describe, it, expect } from 'vitest';
import { runNaiveBroadPhase } from './naive';
import { createBodies } from '../physics/world';
import { assertWellFormedPairs } from '../test/oracle';

describe('runNaiveBroadPhase', () => {
  it('emits exactly n(n-1)/2 pairs', () => {
    for (const n of [0, 1, 2, 5, 40]) {
      const bodies = createBodies(n, 'uniform');
      const result = runNaiveBroadPhase(bodies);
      expect(result.pairs.count).toBe((n * (n - 1)) / 2 || 0);
    }
  });

  it('emits every pair exactly once, ascending', () => {
    const bodies = createBodies(60, 'mixed');
    const result = runNaiveBroadPhase(bodies);
    expect(assertWellFormedPairs(result)).toBe((60 * 59) / 2);
  });

  it('reports auxiliary checks equal to the pair count', () => {
    const bodies = createBodies(30, 'uniform');
    const result = runNaiveBroadPhase(bodies);
    expect(result.auxiliaryChecks).toBe(result.pairs.count);
  });

  it('does no method-specific bookkeeping', () => {
    const result = runNaiveBroadPhase(createBodies(20, 'uniform'));
    expect(result.orderingSwaps).toBe(0);
    expect(result.bucketEntries).toBe(0);
    expect(result.usedFullSort).toBe(false);
  });
});
