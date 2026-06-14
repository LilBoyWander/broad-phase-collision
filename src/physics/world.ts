import type { Body, ScenarioName } from './types';

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 600;

function createRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

interface BodyOptions {
  id: number;
  x: number;
  y: number;
  radius: number;
  velocityX?: number;
  velocityY?: number;
  colorIndex?: number;
  isStatic?: boolean;
  isUserCreated?: boolean;
}

export function createBody(options: BodyOptions): Body {
  const radius = Math.max(2, Math.min(80, options.radius));
  const x = Math.max(radius, Math.min(WORLD_WIDTH - radius, options.x));
  const y = Math.max(radius, Math.min(WORLD_HEIGHT - radius, options.y));
  const mass = options.isStatic ? Number.POSITIVE_INFINITY : Math.PI * radius * radius;
  return {
    id: options.id,
    x,
    y,
    previousX: x,
    previousY: y,
    velocityX: options.isStatic ? 0 : options.velocityX ?? 0,
    velocityY: options.isStatic ? 0 : options.velocityY ?? 0,
    radius,
    mass,
    inverseMass: options.isStatic ? 0 : 1 / mass,
    colorIndex: options.colorIndex ?? 0,
    contactFrames: 0,
    isStatic: options.isStatic,
    isUserCreated: options.isUserCreated,
  };
}

/**
 * Generates repeatable distributions that expose different broad-phase strengths and weaknesses.
 */
export function createBodies(count: number, scenario: ScenarioName): Body[] {
  const random = createRandom(3000 + count * 17 + scenario.length * 131);
  const bodies: Body[] = [];
  const clusterCenters = [
    { x: WORLD_WIDTH * 0.24, y: WORLD_HEIGHT * 0.28 },
    { x: WORLD_WIDTH * 0.72, y: WORLD_HEIGHT * 0.3 },
    { x: WORLD_WIDTH * 0.48, y: WORLD_HEIGHT * 0.72 },
  ];

  for (let index = 0; index < count; index += 1) {
    let radius = 4 + random() * 3.5;
    let x = radius + random() * (WORLD_WIDTH - radius * 2);
    let y = radius + random() * (WORLD_HEIGHT - radius * 2);
    let velocityX = (random() - 0.5) * 86;
    let velocityY = (random() - 0.5) * 86;

    if (scenario === 'clusters') {
      const center = clusterCenters[index % clusterCenters.length];
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * 105;
      x = center.x + Math.cos(angle) * distance;
      y = center.y + Math.sin(angle) * distance;
    } else if (scenario === 'horizontal') {
      const lane = index % 8;
      y = 48 + lane * 69 + (random() - 0.5) * 18;
      velocityX = (random() < 0.5 ? -1 : 1) * (40 + random() * 55);
      velocityY = (random() - 0.5) * 8;
    } else if (scenario === 'mixed') {
      radius = random() < 0.16 ? 18 + random() * 18 : 4 + random() * 6;
      x = radius + random() * (WORLD_WIDTH - radius * 2);
      y = radius + random() * (WORLD_HEIGHT - radius * 2);
    } else if (scenario === 'giant' && index < Math.max(2, Math.floor(count * 0.012))) {
      radius = 46 + random() * 28;
      x = radius + random() * (WORLD_WIDTH - radius * 2);
      y = radius + random() * (WORLD_HEIGHT - radius * 2);
      velocityX *= 0.28;
      velocityY *= 0.28;
    } else if (scenario === 'tunneling') {
      const pairCount = Math.max(1, Math.ceil(count / 2));
      const pairIndex = Math.floor(index / 2);
      const laneProgress = pairCount === 1 ? 0.5 : pairIndex / (pairCount - 1);
      radius = 5;
      y = 28 + laneProgress * (WORLD_HEIGHT - 56);
      x = index % 2 === 0 ? 180 : WORLD_WIDTH - 180;
      velocityX = index % 2 === 0 ? 880 : -880;
      velocityY = 0;
    }

    x = Math.max(radius, Math.min(WORLD_WIDTH - radius, x));
    y = Math.max(radius, Math.min(WORLD_HEIGHT - radius, y));
    bodies.push(createBody({
      id: index,
      x,
      y,
      velocityX,
      velocityY,
      radius,
      colorIndex: Math.floor(random() * 3),
    }));
  }

  return bodies;
}

export function updateBodies(
  bodies: Body[],
  deltaTime: number,
  speedMultiplier: number,
): void {
  for (const body of bodies) {
    body.previousX = body.x;
    body.previousY = body.y;
    if (body.isStatic || body.inverseMass === 0) {
      body.velocityX = 0;
      body.velocityY = 0;
      body.contactFrames = Math.max(0, body.contactFrames - 1);
      continue;
    }
    body.x += body.velocityX * deltaTime * speedMultiplier;
    body.y += body.velocityY * deltaTime * speedMultiplier;

    if (body.x < body.radius) {
      body.x = body.radius;
      body.velocityX = Math.abs(body.velocityX);
    } else if (body.x > WORLD_WIDTH - body.radius) {
      body.x = WORLD_WIDTH - body.radius;
      body.velocityX = -Math.abs(body.velocityX);
    }

    if (body.y < body.radius) {
      body.y = body.radius;
      body.velocityY = Math.abs(body.velocityY);
    } else if (body.y > WORLD_HEIGHT - body.radius) {
      body.y = WORLD_HEIGHT - body.radius;
      body.velocityY = -Math.abs(body.velocityY);
    }

    body.contactFrames = Math.max(0, body.contactFrames - 1);
  }
}

export const WORLD_BOUNDS = {
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
};
