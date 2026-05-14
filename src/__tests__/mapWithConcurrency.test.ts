import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../lib/supabase';

describe('mapWithConcurrency', () => {
  it('processes items with concurrency and preserves results order', async () => {
    const items = [1, 2, 3, 4, 5];
    const worker = async (n: number) => {
      await new Promise(r => setTimeout(r, 10 * n));
      return n * 2;
    };
    const results = await mapWithConcurrency(items, worker, 2);
    expect(results.length).toBe(items.length);
    // All ok
    expect(results.every(r => r.ok)).toBe(true);
    // Values correspond to doubling
    expect(results.map(r => r.value)).toEqual([2, 4, 6, 8, 10]);
  });

  it('captures worker errors and reports ok=false for failed items', async () => {
    const items = [1, 2, 3];
    const worker = async (n: number) => {
      if (n === 2) throw new Error('boom');
      return n;
    };
    const results = await mapWithConcurrency(items, worker, 2);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[2].ok).toBe(true);
  });
});
