import { describe, it, expect } from 'vitest';
import { runSpatialHashBroadPhase } from './spatialHash';
import { SweepAndPrune } from './sweepAndPrune';
import type { Body } from '../physics/types';

/**
 * Continuous detection widens each body's broad-phase bounds to span its whole frame of motion. These tests pin the
 * payoff: a fast body that has already moved past a stationary one shares no cell or interval under discrete bounds,
 * but its swept bounds still propose the pair so the time-of-impact test can catch the crossing.
 */

function movingBody(previousX: number, x: number): Body {
  const radius = 5;
  return {
    id: 0,
    x,
    y: 50,
    previousX,
    previousY: 50,
    velocityX: 0,
    velocityY: 0,
    radius,
    mass: 1,
    inverseMass: 1,
    colorIndex: 0,
    contactFrames: 0,
  };
}

describe('swept broad-phase bounds', () => {
  it('spatial hash proposes a crossed pair only with swept bounds', () => {
    const bodies = [movingBody(10, 200), movingBody(100, 100)];
    expect(runSpatialHashBroadPhase(bodies, 32, false).pairs.count).toBe(0);
    expect(runSpatialHashBroadPhase(bodies, 32, true).pairs.count).toBe(1);
  });

  it('sweep and prune proposes a crossed pair only with swept bounds', () => {
    const bodies = [movingBody(10, 200), movingBody(100, 100)];
    expect(new SweepAndPrune().run(bodies, false).pairs.count).toBe(0);
    expect(new SweepAndPrune().run(bodies, true).pairs.count).toBe(1);
  });
});
