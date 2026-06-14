import { describe, it, expect } from 'vitest';
import { detectContacts, pairKey, resolveContacts } from './collision';
import { PairBuffer } from '../broadphase/pairBuffer';
import type { Body } from './types';

function makeBody(overrides: Partial<Body>): Body {
  const radius = overrides.radius ?? 10;
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
    inverseMass: mass > 0 ? 1 / mass : 0,
    colorIndex: 0,
    contactFrames: 0,
    ...overrides,
  };
}

function bufferOf(...pairs: Array<[number, number]>): PairBuffer {
  const buffer = new PairBuffer();
  for (const [a, b] of pairs) {
    buffer.push(a, b);
  }
  return buffer;
}

describe('detectContacts', () => {
  it('reports an overlapping candidate with a normal pointing from a to b', () => {
    const bodies = [
      makeBody({ id: 0, x: 0, y: 0, radius: 10 }),
      makeBody({ id: 1, x: 15, y: 0, radius: 10 }),
    ];
    const result = detectContacts(bodies, bufferOf([0, 1]));
    expect(result.contacts).toHaveLength(1);
    const contact = result.contacts[0];
    expect(contact.normalX).toBeCloseTo(1, 6);
    expect(contact.normalY).toBeCloseTo(0, 6);
    expect(contact.penetration).toBeCloseTo(5, 6); // (10 + 10) - 15
  });

  it('drops a candidate whose circles do not overlap (false positive)', () => {
    const bodies = [
      makeBody({ x: 0, y: 0, radius: 5 }),
      makeBody({ x: 100, y: 0, radius: 5 }),
    ];
    expect(detectContacts(bodies, bufferOf([0, 1])).contacts).toHaveLength(0);
  });

  it('treats exactly-touching circles as non-overlapping', () => {
    const bodies = [
      makeBody({ x: 0, y: 0, radius: 10 }),
      makeBody({ x: 20, y: 0, radius: 10 }),
    ];
    expect(detectContacts(bodies, bufferOf([0, 1])).contacts).toHaveLength(0);
  });
});

describe('resolveContacts', () => {
  it('pushes overlapping bodies apart', () => {
    const bodies = [
      makeBody({ x: 0, y: 0, radius: 10 }),
      makeBody({ x: 12, y: 0, radius: 10 }),
    ];
    const before = bodies[1].x - bodies[0].x;
    const contacts = detectContacts(bodies, bufferOf([0, 1])).contacts;
    resolveContacts(bodies, contacts, 0.5);
    const after = bodies[1].x - bodies[0].x;
    expect(after).toBeGreaterThan(before);
  });

  it('applies an impulse only when bodies approach each other', () => {
    const approaching = [
      makeBody({ x: 0, y: 0, radius: 10, velocityX: 50 }),
      makeBody({ x: 15, y: 0, radius: 10, velocityX: -50 }),
    ];
    const contactsA = detectContacts(approaching, bufferOf([0, 1])).contacts;
    expect(resolveContacts(approaching, contactsA, 0.8).impulsesApplied).toBe(1);

    const separating = [
      makeBody({ x: 0, y: 0, radius: 10, velocityX: -50 }),
      makeBody({ x: 15, y: 0, radius: 10, velocityX: 50 }),
    ];
    const contactsB = detectContacts(separating, bufferOf([0, 1])).contacts;
    expect(resolveContacts(separating, contactsB, 0.8).impulsesApplied).toBe(0);
  });

  it('conserves momentum when resolving a head-on impact', () => {
    const bodies = [
      makeBody({ x: 0, y: 0, radius: 10, velocityX: 40, mass: 1 }),
      makeBody({ x: 15, y: 0, radius: 10, velocityX: -40, mass: 1 }),
    ];
    const momentumBefore = bodies[0].mass * bodies[0].velocityX + bodies[1].mass * bodies[1].velocityX;
    const contacts = detectContacts(bodies, bufferOf([0, 1])).contacts;
    resolveContacts(bodies, contacts, 0.8);
    const momentumAfter = bodies[0].mass * bodies[0].velocityX + bodies[1].mass * bodies[1].velocityX;
    expect(momentumAfter).toBeCloseTo(momentumBefore, 6);
  });
});

describe('pairKey', () => {
  it('produces a unique key for each ordered pair', () => {
    const bodyCount = 50;
    const keys = new Set<number>();
    for (let a = 0; a < bodyCount; a += 1) {
      for (let b = a + 1; b < bodyCount; b += 1) {
        keys.add(pairKey(a, b, bodyCount));
      }
    }
    expect(keys.size).toBe((bodyCount * (bodyCount - 1)) / 2);
  });
});
