import type { Body, Contact, PairBuffer } from './types';

export interface NarrowPhaseResult {
  contacts: Contact[];
  duration: number;
}

export interface ResponseResult {
  duration: number;
  impulsesApplied: number;
}

/** Exact circle-circle narrow phase for candidates emitted by the selected broad phase. */
export function detectContacts(bodies: Body[], pairs: PairBuffer): NarrowPhaseResult {
  const startedAt = performance.now();
  const contacts: Contact[] = [];

  for (let pairIndex = 0; pairIndex < pairs.count; pairIndex += 1) {
    const firstIndex = pairs.getFirst(pairIndex);
    const secondIndex = pairs.getSecond(pairIndex);
    const first = bodies[firstIndex];
    const second = bodies[secondIndex];
    const deltaX = second.x - first.x;
    const deltaY = second.y - first.y;
    const radiusSum = first.radius + second.radius;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;

    if (distanceSquared >= radiusSum * radiusSum) {
      continue;
    }

    const distance = Math.sqrt(distanceSquared);
    const normalX = distance > 0.0001 ? deltaX / distance : 1;
    const normalY = distance > 0.0001 ? deltaY / distance : 0;
    contacts.push({
      a: firstIndex,
      b: secondIndex,
      normalX,
      normalY,
      penetration: radiusSum - distance,
      pointX: first.x + normalX * first.radius,
      pointY: first.y + normalY * first.radius,
    });
  }

  return {
    contacts,
    duration: performance.now() - startedAt,
  };
}

/**
 * Separates overlapping circles and applies a restitution impulse.
 *
 * Position correction is weighted by inverse mass so large bodies move less than small bodies. The response timing is
 * measured independently rather than inferred from narrow-phase cost.
 */
export function resolveContacts(
  bodies: Body[],
  contacts: Contact[],
  restitution: number,
): ResponseResult {
  const startedAt = performance.now();
  let impulsesApplied = 0;

  for (const contact of contacts) {
    const first = bodies[contact.a];
    const second = bodies[contact.b];
    const inverseMassSum = first.inverseMass + second.inverseMass;
    if (inverseMassSum <= 0) {
      continue;
    }

    const correctionMagnitude = Math.max(contact.penetration - 0.02, 0) * 0.82 / inverseMassSum;
    const correctionX = correctionMagnitude * contact.normalX;
    const correctionY = correctionMagnitude * contact.normalY;
    first.x -= correctionX * first.inverseMass;
    first.y -= correctionY * first.inverseMass;
    second.x += correctionX * second.inverseMass;
    second.y += correctionY * second.inverseMass;

    const relativeVelocityX = second.velocityX - first.velocityX;
    const relativeVelocityY = second.velocityY - first.velocityY;
    const velocityAlongNormal =
      relativeVelocityX * contact.normalX + relativeVelocityY * contact.normalY;
    if (velocityAlongNormal >= 0) {
      continue;
    }

    const impulseMagnitude =
      (-(1 + restitution) * velocityAlongNormal) / inverseMassSum;
    const impulseX = impulseMagnitude * contact.normalX;
    const impulseY = impulseMagnitude * contact.normalY;

    first.velocityX -= impulseX * first.inverseMass;
    first.velocityY -= impulseY * first.inverseMass;
    second.velocityX += impulseX * second.inverseMass;
    second.velocityY += impulseY * second.inverseMass;
    first.contactFrames = 4;
    second.contactFrames = 4;
    impulsesApplied += 1;
  }

  return {
    duration: performance.now() - startedAt,
    impulsesApplied,
  };
}

export function pairKey(first: number, second: number, bodyCount: number): number {
  return first * bodyCount + second;
}
