import { describe, it, expect } from 'vitest';
import { isPeakHourIST, decideFixBatchSize, FIX_BATCH_PEAK, FIX_BATCH_OFF_PEAK } from '@/lib/qb-fixer/batch';

describe('isPeakHourIST', () => {
  it('returns true at 14:00 IST (08:30 UTC)', () => {
    expect(isPeakHourIST(new Date('2026-05-10T08:30:00Z'))).toBe(true);
  });
  it('returns true at 21:59 IST (16:29 UTC)', () => {
    expect(isPeakHourIST(new Date('2026-05-10T16:29:00Z'))).toBe(true);
  });
  it('returns false at 22:00 IST (16:30 UTC)', () => {
    expect(isPeakHourIST(new Date('2026-05-10T16:30:00Z'))).toBe(false);
  });
  it('returns false at 13:59 IST (08:29 UTC)', () => {
    expect(isPeakHourIST(new Date('2026-05-10T08:29:00Z'))).toBe(false);
  });
});

describe('decideFixBatchSize', () => {
  it('off-peak unthrottled returns 8', () => {
    expect(decideFixBatchSize({ peak: false, throttled: false })).toBe(FIX_BATCH_OFF_PEAK);
    expect(decideFixBatchSize({ peak: false, throttled: false })).toBe(8);
  });
  it('peak unthrottled returns 4', () => {
    expect(decideFixBatchSize({ peak: true, throttled: false })).toBe(FIX_BATCH_PEAK);
    expect(decideFixBatchSize({ peak: true, throttled: false })).toBe(4);
  });
  it('off-peak throttled halves to 4', () => {
    expect(decideFixBatchSize({ peak: false, throttled: true })).toBe(4);
  });
  it('peak throttled halves to 2', () => {
    expect(decideFixBatchSize({ peak: true, throttled: true })).toBe(2);
  });
});
