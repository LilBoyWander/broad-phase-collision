import { pairKey } from './collision';
import type { Body, Contact, PairBuffer } from './types';

export interface ContinuousResult {
  /** Extra contacts produced for pairs that crossed mid-frame and the discrete narrow phase would have missed. */
  contacts: Contact[];
  /** How many tunneling pairs were caught and clamped this frame. */
  saves: number;
  duration: number;
}

/**
 * Conservative swept circle-circle test across a single frame.
 *
 * Each body travels from `(previousX, previousY)` to `(x, y)`. Working in the relative frame of body `b`, body `a`
 * moves along a straight segment; the pair touches when the distance between centres first equals the radius sum.
 * Solving `|start + t · relativeMotion|² = radiusSum²` for the earliest `t ∈ [0, 1]` yields the time of impact, or
 * `null` when the circles never touch during the frame. This is what discrete, end-of-frame testing cannot see.
 */
export function timeOfImpact(a: Body, b: Body): number | null {
  const startX = a.previousX - b.previousX;
  const startY = a.previousY - b.previousY;
  const relativeX = a.x - a.previousX - (b.x - b.previousX);
  const relativeY = a.y - a.previousY - (b.y - b.previousY);
  const radiusSum = a.radius + b.radius;

  const c = startX * startX + startY * startY - radiusSum * radiusSum;
  if (c <= 0) {
    return 0; // Already overlapping at the start of the frame.
  }
  const quadraticA = relativeX * relativeX + relativeY * relativeY;
  if (quadraticA <= 1e-12) {
    return null; // No relative motion and not overlapping: they cannot meet this frame.
  }
  const quadraticB = 2 * (startX * relativeX + startY * relativeY);
  const discriminant = quadraticB * quadraticB - 4 * quadraticA * c;
  if (discriminant < 0) {
    return null;
  }
  const impact = (-quadraticB - Math.sqrt(discriminant)) / (2 * quadraticA);
  if (impact < 0 || impact > 1) {
    return null;
  }
  return impact;
}

/**
 * Catches pairs that passed through each other between frames and snaps them back to their moment of contact.
 *
 * Only candidate pairs the discrete narrow phase did not already confirm are considered. Each body is clamped at most
 * once per frame so resolutions cannot fight one another. The returned contacts are fed to the same impulse solver,
 * so a tunneling pair bounces instead of crossing.
 */
export function resolveTunneling(
  bodies: Body[],
  pairs: PairBuffer,
  discreteContacts: Contact[],
): ContinuousResult {
  const startedAt = performance.now();
  const contacts: Contact[] = [];
  const clamped = new Set<number>();
  const alreadyContacting = new Set<number>();
  const impacts: Array<{ firstIndex: number; secondIndex: number; time: number }> = [];
  for (const contact of discreteContacts) {
    alreadyContacting.add(pairKey(contact.a, contact.b, bodies.length));
  }

  for (let index = 0; index < pairs.count; index += 1) {
    const firstIndex = pairs.getFirst(index);
    const secondIndex = pairs.getSecond(index);
    if (alreadyContacting.has(pairKey(firstIndex, secondIndex, bodies.length))) {
      continue;
    }

    const first = bodies[firstIndex];
    const second = bodies[secondIndex];
    const impact = timeOfImpact(first, second);
    if (impact === null) {
      continue;
    }
    impacts.push({ firstIndex, secondIndex, time: impact });
  }

  // Candidate order is an implementation detail. Resolve chronologically so a body crossing multiple objects is
  // clamped to its earliest impact rather than whichever pair happened to be emitted first.
  impacts.sort((first, second) => first.time - second.time);
  for (const impact of impacts) {
    const { firstIndex, secondIndex, time } = impact;
    if (clamped.has(firstIndex) || clamped.has(secondIndex)) {
      continue;
    }

    const first = bodies[firstIndex];
    const second = bodies[secondIndex];
    first.x = first.previousX + (first.x - first.previousX) * time;
    first.y = first.previousY + (first.y - first.previousY) * time;
    second.x = second.previousX + (second.x - second.previousX) * time;
    second.y = second.previousY + (second.y - second.previousY) * time;
    clamped.add(firstIndex);
    clamped.add(secondIndex);

    const deltaX = second.x - first.x;
    const deltaY = second.y - first.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 0.0001;
    const normalX = deltaX / distance;
    const normalY = deltaY / distance;
    contacts.push({
      a: firstIndex,
      b: secondIndex,
      normalX,
      normalY,
      penetration: Math.max(0, first.radius + second.radius - distance),
      pointX: first.x + normalX * first.radius,
      pointY: first.y + normalY * first.radius,
    });
  }

  return { contacts, saves: contacts.length, duration: performance.now() - startedAt };
}
