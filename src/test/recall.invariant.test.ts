import { describe, it, expect } from 'vitest';
import { runNaiveBroadPhase } from '../broadphase/naive';
import { runSpatialHashBroadPhase } from '../broadphase/spatialHash';
import { SweepAndPrune } from '../broadphase/sweepAndPrune';
import { createBodies, updateBodies } from '../physics/world';
import type { ScenarioName } from '../physics/types';
import { candidateKeys, missedContacts, oracleContactKeys } from './oracle';

/**
 * The defining contract of a broad phase: it may over-report, but it must never drop a pair the narrow phase would
 * confirm. This suite is the automated form of the in-app recall audit — it runs every method against the brute-force
 * oracle across every scenario, body count, and several simulated frames, and demands zero missed contacts everywhere.
 */

const SCENARIOS: ScenarioName[] = [
  'uniform',
  'clusters',
  'horizontal',
  'mixed',
  'giant',
  'tunneling',
];
const BODY_COUNTS = [150, 700];
const FRAMES = 24;
const CELL_SIZE = 32;

describe('broad-phase recall invariant', () => {
  for (const scenario of SCENARIOS) {
    for (const count of BODY_COUNTS) {
      it(`loses no contact for ${scenario} with ${count} bodies over ${FRAMES} frames`, () => {
        const bodies = createBodies(count, scenario);
        // Each method that carries state across frames gets its own persistent instance.
        const sweep = new SweepAndPrune();
        let sawContacts = false;

        for (let frame = 0; frame < FRAMES; frame += 1) {
          updateBodies(bodies, 1 / 60, 1);
          const oracle = oracleContactKeys(bodies);
          if (oracle.size > 0) {
            sawContacts = true;
          }

          const naive = candidateKeys(runNaiveBroadPhase(bodies), count);
          expect(missedContacts(oracle, naive)).toBe(0);

          const spatial = candidateKeys(runSpatialHashBroadPhase(bodies, CELL_SIZE), count);
          expect(missedContacts(oracle, spatial)).toBe(0);

          const swept = candidateKeys(sweep.run(bodies), count);
          expect(missedContacts(oracle, swept)).toBe(0);
        }

        // Guards against a vacuous pass: a scenario that never overlaps would prove nothing.
        expect(sawContacts).toBe(true);
      });
    }
  }
});
