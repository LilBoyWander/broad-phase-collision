import type { PairBuffer as PairBufferContract } from '../physics/types';

/**
 * Flat reusable pair storage avoids allocating one JavaScript object for every candidate.
 *
 * Brute force can emit millions of pairs, so representation cost would otherwise overwhelm the algorithm being
 * measured.
 */
export class PairBuffer implements PairBufferContract {
  private values = new Int32Array(2048);
  private pairCount = 0;

  get count(): number {
    return this.pairCount;
  }

  clear(): void {
    this.pairCount = 0;
  }

  push(first: number, second: number): void {
    const offset = this.pairCount * 2;
    this.ensureCapacity(offset + 2);
    this.values[offset] = first;
    this.values[offset + 1] = second;
    this.pairCount += 1;
  }

  getFirst(index: number): number {
    return this.values[index * 2];
  }

  getSecond(index: number): number {
    return this.values[index * 2 + 1];
  }

  private ensureCapacity(requiredLength: number): void {
    if (requiredLength <= this.values.length) {
      return;
    }

    let nextLength = this.values.length;
    while (nextLength < requiredLength) {
      nextLength *= 2;
    }

    const next = new Int32Array(nextLength);
    next.set(this.values);
    this.values = next;
  }
}
