import { describe, it, expect } from 'vitest';
import { runSpatialHashBroadPhase } from './spatialHash';
import { createBodies, updateBodies } from '../physics/world';
import { assertWellFormedPairs, candidateKeys, missedContacts, oracleContactKeys } from '../test/oracle';

describe('runSpatialHashBroadPhase', () => {
  it('never misses a real contact (100% recall)', () => {
    const bodies = createBodies(400, 'uniform');
    // Let bodies move into overlaps so the oracle actually has contacts to miss.
    for (let step = 0; step < 30; step += 1) {
      updateBodies(bodies, 1 / 60, 1);
    }
    const oracle = oracleContactKeys(bodies);
    expect(oracle.size).toBeGreaterThan(0);
    const result = runSpatialHashBroadPhase(bodies, 32);
    expect(missedContacts(oracle, candidateKeys(result, bodies.length))).toBe(0);
  });

  it('keeps 100% recall across cell sizes, including giant multi-cell bodies', () => {
    const bodies = createBodies(500, 'giant');
    for (let step = 0; step < 30; step += 1) {
      updateBodies(bodies, 1 / 60, 1);
    }
    const oracle = oracleContactKeys(bodies);
    for (const cellSize of [16, 32, 64, 128]) {
      const result = runSpatialHashBroadPhase(bodies, cellSize);
      expect(missedContacts(oracle, candidateKeys(result, bodies.length))).toBe(0);
    }
  });

  it('emits each shared-cell pair only once, ascending', () => {
    // Giant bodies span many cells, the case most likely to produce duplicates without deduplication.
    const bodies = createBodies(500, 'giant');
    const result = runSpatialHashBroadPhase(bodies, 24);
    expect(() => assertWellFormedPairs(result)).not.toThrow();
  });

  it('inserts every body into at least one cell', () => {
    const bodies = createBodies(300, 'mixed');
    const result = runSpatialHashBroadPhase(bodies, 32);
    expect(result.bucketEntries).toBeGreaterThanOrEqual(bodies.length);
    expect(result.bucketCount).toBeGreaterThan(0);
    expect(result.maxBucketSize).toBeGreaterThan(0);
  });

  it('charges more multi-cell entries as cell size shrinks', () => {
    const bodies = createBodies(300, 'mixed');
    const coarse = runSpatialHashBroadPhase(bodies, 96);
    const fine = runSpatialHashBroadPhase(bodies, 16);
    expect(fine.bucketEntries).toBeGreaterThan(coarse.bucketEntries);
  });
});
