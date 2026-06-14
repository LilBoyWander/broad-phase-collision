import { describe, it, expect } from 'vitest';
import { SweepAndPrune } from './sweepAndPrune';
import { createBodies, updateBodies } from '../physics/world';
import { assertWellFormedPairs, candidateKeys, missedContacts, oracleContactKeys } from '../test/oracle';

describe('SweepAndPrune', () => {
  it('never misses a real contact (100% recall)', () => {
    const bodies = createBodies(400, 'uniform');
    for (let step = 0; step < 30; step += 1) {
      updateBodies(bodies, 1 / 60, 1);
    }
    const oracle = oracleContactKeys(bodies);
    expect(oracle.size).toBeGreaterThan(0);
    const sweep = new SweepAndPrune();
    const result = sweep.run(bodies);
    expect(missedContacts(oracle, candidateKeys(result, bodies.length))).toBe(0);
  });

  it('keeps 100% recall on horizontal lanes, its weakest axis distribution', () => {
    const bodies = createBodies(500, 'horizontal');
    const sweep = new SweepAndPrune();
    for (let step = 0; step < 30; step += 1) {
      updateBodies(bodies, 1 / 60, 1);
      const oracle = oracleContactKeys(bodies);
      const result = sweep.run(bodies);
      expect(missedContacts(oracle, candidateKeys(result, bodies.length))).toBe(0);
    }
  });

  it('emits well-formed ascending pairs', () => {
    const bodies = createBodies(300, 'clusters');
    const result = new SweepAndPrune().run(bodies);
    expect(() => assertWellFormedPairs(result)).not.toThrow();
  });

  it('does a cold full sort on the first frame, then reuses order via insertion sort', () => {
    const bodies = createBodies(300, 'uniform');
    const sweep = new SweepAndPrune();

    const first = sweep.run(bodies);
    expect(first.usedFullSort).toBe(true);

    // A coherent second frame should reuse the prior ordering instead of re-sorting.
    updateBodies(bodies, 1 / 60, 1);
    const second = sweep.run(bodies);
    expect(second.usedFullSort).toBe(false);
  });

  it('repairs an almost-sorted axis with few swaps when motion is coherent', () => {
    const bodies = createBodies(400, 'uniform');
    const sweep = new SweepAndPrune();
    sweep.run(bodies); // cold start

    updateBodies(bodies, 1 / 60, 1);
    const warm = sweep.run(bodies);
    // Coherence means far fewer swaps than the worst case (~n^2/2).
    expect(warm.orderingSwaps).toBeLessThan((bodies.length * bodies.length) / 4);
  });

  it('forces a fresh full sort after reset()', () => {
    const bodies = createBodies(200, 'uniform');
    const sweep = new SweepAndPrune();
    sweep.run(bodies);
    sweep.reset();
    expect(sweep.run(bodies).usedFullSort).toBe(true);
  });

  it('forces a full sort when the body count changes', () => {
    const sweep = new SweepAndPrune();
    sweep.run(createBodies(200, 'uniform'));
    const grown = sweep.run(createBodies(260, 'uniform'));
    expect(grown.usedFullSort).toBe(true);
  });
});
