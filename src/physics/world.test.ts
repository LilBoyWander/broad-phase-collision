import { describe, it, expect } from 'vitest';
import { createBodies, createBody, updateBodies, WORLD_BOUNDS } from './world';
import type { ScenarioName } from './types';

const SCENARIOS: ScenarioName[] = [
  'uniform',
  'clusters',
  'horizontal',
  'mixed',
  'giant',
  'tunneling',
];

describe('createBodies', () => {
  it('is deterministic for the same count and scenario', () => {
    const a = createBodies(200, 'mixed');
    const b = createBodies(200, 'mixed');
    expect(a.map((body) => [body.x, body.y, body.radius])).toEqual(
      b.map((body) => [body.x, body.y, body.radius]),
    );
  });

  it('produces exactly the requested count for every scenario', () => {
    for (const scenario of SCENARIOS) {
      expect(createBodies(123, scenario)).toHaveLength(123);
    }
  });

  it('keeps every body inside the world with consistent mass', () => {
    for (const scenario of SCENARIOS) {
      for (const body of createBodies(300, scenario)) {
        expect(body.radius).toBeGreaterThan(0);
        expect(body.x).toBeGreaterThanOrEqual(body.radius);
        expect(body.x).toBeLessThanOrEqual(WORLD_BOUNDS.width - body.radius);
        expect(body.y).toBeGreaterThanOrEqual(body.radius);
        expect(body.y).toBeLessThanOrEqual(WORLD_BOUNDS.height - body.radius);
        expect(body.inverseMass).toBeCloseTo(1 / body.mass, 9);
      }
    }
  });
});

describe('updateBodies', () => {
  it('keeps bodies within bounds across many steps', () => {
    const bodies = createBodies(400, 'uniform');
    for (let step = 0; step < 120; step += 1) {
      updateBodies(bodies, 1 / 60, 1.5);
    }
    for (const body of bodies) {
      expect(body.x).toBeGreaterThanOrEqual(body.radius - 1e-6);
      expect(body.x).toBeLessThanOrEqual(WORLD_BOUNDS.width - body.radius + 1e-6);
      expect(body.y).toBeGreaterThanOrEqual(body.radius - 1e-6);
      expect(body.y).toBeLessThanOrEqual(WORLD_BOUNDS.height - body.radius + 1e-6);
    }
  });

  it('reflects velocity off a wall instead of escaping', () => {
    const bodies = createBodies(1, 'uniform');
    const body = bodies[0];
    body.x = body.radius + 0.5;
    body.velocityX = -200;
    updateBodies(bodies, 1 / 60, 1);
    expect(body.x).toBeGreaterThanOrEqual(body.radius);
    expect(body.velocityX).toBeGreaterThan(0);
  });

  it('records the previous position for motion ticks', () => {
    const bodies = createBodies(1, 'uniform');
    const body = bodies[0];
    body.x = 480;
    body.y = 300;
    body.velocityX = 60;
    body.velocityY = 0;
    updateBodies(bodies, 1 / 60, 1);
    expect(body.previousX).toBe(480);
    expect(body.x).toBeGreaterThan(480);
  });

  it('keeps static user geometry fixed', () => {
    const body = createBody({
      id: 1,
      x: 200,
      y: 150,
      radius: 18,
      velocityX: 400,
      isStatic: true,
      isUserCreated: true,
    });
    updateBodies([body], 1 / 30, 2);
    expect(body.x).toBe(200);
    expect(body.y).toBe(150);
    expect(body.inverseMass).toBe(0);
    expect(body.velocityX).toBe(0);
  });
});

describe('tunneling scenario', () => {
  it('creates opposing high-speed pairs on separate lanes', () => {
    const bodies = createBodies(48, 'tunneling');
    expect(bodies[0].velocityX).toBeGreaterThan(800);
    expect(bodies[1].velocityX).toBeLessThan(-800);
    expect(bodies[0].y).toBe(bodies[1].y);
    expect(bodies[2].y).toBeGreaterThan(bodies[0].y);
  });
});
