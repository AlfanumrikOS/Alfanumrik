import { describe, it, expect, vi, afterEach } from 'vitest';
import { BudgetTracker } from '@/lib/ai/agents/budget';
import { BudgetExceeded } from '@/lib/ai/agents/types';

afterEach(() => vi.useRealTimers());

describe('BudgetTracker', () => {
  it('counts steps and throws when maxSteps exceeded', () => {
    const t = new BudgetTracker({ maxSteps: 2, maxTotalTokens: 1000, maxWallMs: 1000 });
    t.incrementStep(); // 1
    t.incrementStep(); // 2 — at limit, OK
    expect(() => t.incrementStep()).toThrow(BudgetExceeded);
  });

  it('sums input + output tokens and throws when maxTotalTokens exceeded', () => {
    const t = new BudgetTracker({ maxSteps: 100, maxTotalTokens: 100, maxWallMs: 1000 });
    t.recordTokens(40, 30); // 70 total
    t.assertTokens(); // OK
    t.recordTokens(20, 20); // 110 total
    expect(() => t.assertTokens()).toThrow(BudgetExceeded);
  });

  it('throws on wall time exceeded', () => {
    vi.useFakeTimers();
    const t = new BudgetTracker({ maxSteps: 100, maxTotalTokens: 1000, maxWallMs: 100 });
    vi.advanceTimersByTime(99);
    t.assertWallTime(); // OK
    vi.advanceTimersByTime(2);
    expect(() => t.assertWallTime()).toThrow(BudgetExceeded);
  });

  it('exposes current usage snapshot', () => {
    const t = new BudgetTracker({ maxSteps: 10, maxTotalTokens: 1000, maxWallMs: 5000 });
    t.incrementStep();
    t.recordTokens(100, 50);
    const u = t.snapshot();
    expect(u.steps).toBe(1);
    expect(u.tokensInput).toBe(100);
    expect(u.tokensOutput).toBe(50);
  });
});
