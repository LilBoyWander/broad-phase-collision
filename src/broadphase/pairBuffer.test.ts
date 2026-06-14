import { describe, it, expect } from 'vitest';
import { PairBuffer } from './pairBuffer';

describe('PairBuffer', () => {
  it('starts empty', () => {
    const buffer = new PairBuffer();
    expect(buffer.count).toBe(0);
  });

  it('stores and returns pushed pairs', () => {
    const buffer = new PairBuffer();
    buffer.push(3, 9);
    buffer.push(0, 1);
    expect(buffer.count).toBe(2);
    expect(buffer.getFirst(0)).toBe(3);
    expect(buffer.getSecond(0)).toBe(9);
    expect(buffer.getFirst(1)).toBe(0);
    expect(buffer.getSecond(1)).toBe(1);
  });

  it('clears without reallocating semantics', () => {
    const buffer = new PairBuffer();
    buffer.push(1, 2);
    buffer.clear();
    expect(buffer.count).toBe(0);
    buffer.push(5, 6);
    expect(buffer.count).toBe(1);
    expect(buffer.getFirst(0)).toBe(5);
    expect(buffer.getSecond(0)).toBe(6);
  });

  it('grows past its initial capacity without corrupting earlier entries', () => {
    // Initial backing store holds 1024 pairs (2048 int32 slots); push well beyond it.
    const buffer = new PairBuffer();
    const total = 5000;
    for (let i = 0; i < total; i += 1) {
      buffer.push(i, i + 1);
    }
    expect(buffer.count).toBe(total);
    expect(buffer.getFirst(0)).toBe(0);
    expect(buffer.getSecond(0)).toBe(1);
    expect(buffer.getFirst(total - 1)).toBe(total - 1);
    expect(buffer.getSecond(total - 1)).toBe(total);
    // Spot-check an interior entry that lived through at least one reallocation.
    expect(buffer.getFirst(2049)).toBe(2049);
    expect(buffer.getSecond(2049)).toBe(2050);
  });
});
