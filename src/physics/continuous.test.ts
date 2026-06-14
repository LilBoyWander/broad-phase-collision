import { describe, it, expect } from 'vitest';
import { resolveTunneling, timeOfImpact } from './continuous';
import { PairBuffer } from '../broadphase/pairBuffer';
import { runSpatialHashBroadPhase } from '../broadphase/spatialHash';
import { detectContacts } from './collision';
import { createBodies, updateBodies } from './world';
import type { Body, Contact } from './types';

function makeBody(overrides: Partial<Body>): Body {
  const radius = overrides.radius ?? 5;
  const mass = overrides.mass ?? Math.PI * radius * radius;
  return {
    id: 0,
    x: 0,
    y: 0,
    previousX: 0,
    previousY: 0,
    velocityX: 0,
    velocityY: 0,
    radius,
    mass,
    inverseMass: 1 / mass,
    colorIndex: 0,
    contactFrames: 0,
    ...overrides,
  };
}

describe('timeOfImpact', () => {
  it('finds the fraction of the frame at which a tunneling pair first touches', () => {
    // A sweeps left-to-right through a stationary B; they first touch at t = 0.4.
    const a = makeBody({ radius: 5, previousX: 0, previousY: 50, x: 100, y: 50 });
    const b = makeBody({ radius: 5, previousX: 50, previousY: 50, x: 50, y: 50 });
    const toi = timeOfImpact(a, b);
    expect(toi).not.toBeNull();
    expect(toi as number).toBeCloseTo(0.4, 6);
  });

  it('solves a symmetric head-on approach', () => {
    const a = makeBody({ radius: 2, previousX: 0, previousY: 0, x: 10, y: 0 });
    const b = makeBody({ radius: 2, previousX: 20, previousY: 0, x: 10, y: 0 });
    expect(timeOfImpact(a, b) as number).toBeCloseTo(0.8, 6);
  });

  it('returns null when paths never come within the radius sum', () => {
    const a = makeBody({ radius: 5, previousX: 0, previousY: 0, x: 100, y: 0 });
    const b = makeBody({ radius: 5, previousX: 0, previousY: 100, x: 100, y: 100 });
    expect(timeOfImpact(a, b)).toBeNull();
  });

  it('returns 0 when the pair already overlaps at the start of the frame', () => {
    const a = makeBody({ radius: 5, previousX: 0, previousY: 0, x: 2, y: 0 });
    const b = makeBody({ radius: 5, previousX: 3, previousY: 0, x: 5, y: 0 });
    expect(timeOfImpact(a, b)).toBe(0);
  });
});

describe('resolveTunneling', () => {
  function tunnelingPair(): Body[] {
    return [
      makeBody({ id: 0, radius: 5, previousX: 0, previousY: 50, x: 100, y: 50 }),
      makeBody({ id: 1, radius: 5, previousX: 50, previousY: 50, x: 50, y: 50 }),
    ];
  }

  it('clamps a tunneling pair back to the moment of contact', () => {
    const bodies = tunnelingPair();
    const pairs = new PairBuffer();
    pairs.push(0, 1);

    const result = resolveTunneling(bodies, pairs, []);
    expect(result.saves).toBe(1);
    expect(result.contacts).toHaveLength(1);
    // The fast body is rewound to t = 0.4 (x = 40) so the centres sit a radius-sum apart instead of past each other.
    expect(bodies[0].x).toBeCloseTo(40, 4);
    const distance = Math.hypot(bodies[1].x - bodies[0].x, bodies[1].y - bodies[0].y);
    expect(distance).toBeCloseTo(10, 4);
  });

  it('ignores pairs the discrete narrow phase already confirmed', () => {
    const bodies = tunnelingPair();
    const pairs = new PairBuffer();
    pairs.push(0, 1);
    const discrete: Contact[] = [
      { a: 0, b: 1, normalX: 1, normalY: 0, penetration: 1, pointX: 0, pointY: 0 },
    ];

    const result = resolveTunneling(bodies, pairs, discrete);
    expect(result.saves).toBe(0);
    expect(bodies[0].x).toBe(100); // untouched
  });

  it('resolves the earliest impact when pair emission order is reversed', () => {
    const bodies = [
      makeBody({ id: 0, radius: 5, previousX: 0, previousY: 50, x: 100, y: 50 }),
      makeBody({ id: 1, radius: 5, previousX: 30, previousY: 50, x: 30, y: 50 }),
      makeBody({ id: 2, radius: 5, previousX: 70, previousY: 50, x: 70, y: 50 }),
    ];
    const pairs = new PairBuffer();
    pairs.push(0, 2);
    pairs.push(0, 1);

    const result = resolveTunneling(bodies, pairs, []);
    expect(result.saves).toBe(1);
    expect(bodies[0].x).toBeCloseTo(20, 4);
    expect(result.contacts[0].b).toBe(1);
  });
});

describe('high-speed crossing scenario', () => {
  it('produces crossings that discrete detection misses and CCD recovers', () => {
    const bodies = createBodies(48, 'tunneling');
    let saves = 0;

    for (let frame = 0; frame < 24; frame += 1) {
      updateBodies(bodies, 1 / 60, 1);
      const broad = runSpatialHashBroadPhase(bodies, 32, true);
      const discrete = detectContacts(bodies, broad.pairs);
      saves += resolveTunneling(bodies, broad.pairs, discrete.contacts).saves;
    }

    expect(saves).toBeGreaterThan(0);
  });
});
