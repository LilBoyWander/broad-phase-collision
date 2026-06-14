export interface Body {
  id: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  velocityX: number;
  velocityY: number;
  radius: number;
  mass: number;
  inverseMass: number;
  colorIndex: number;
  contactFrames: number;
}

export interface Contact {
  a: number;
  b: number;
  normalX: number;
  normalY: number;
  penetration: number;
  pointX: number;
  pointY: number;
}

export interface BroadPhaseResult {
  pairs: PairBuffer;
  duration: number;
  auxiliaryChecks: number;
  orderingSwaps: number;
  bucketEntries: number;
  bucketCount: number;
  maxBucketSize: number;
  usedFullSort: boolean;
}

export type BroadPhaseMethod = 'naive' | 'spatial' | 'sweep';
export type ScenarioName = 'uniform' | 'clusters' | 'horizontal' | 'mixed' | 'giant';

export interface PairBuffer {
  readonly count: number;
  clear(): void;
  push(first: number, second: number): void;
  getFirst(index: number): number;
  getSecond(index: number): number;
}
