/**
 * Batch sizing helpers for the QB fix-failed-questions cron.
 *
 * Mirrors the structure of supabase/functions/verify-question-bank/shared.ts
 * but with smaller batch sizes because each fix is N×LLM calls vs. 1.
 */

const IST_PEAK_START_HOUR = 14;
const IST_PEAK_END_HOUR = 22;

export const FIX_BATCH_OFF_PEAK = 50;
export const FIX_BATCH_PEAK = 20;

export function isPeakHourIST(now: Date): boolean {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istTotalMinutes = (utcMinutes + 330) % (24 * 60);
  const istHour = Math.floor(istTotalMinutes / 60);
  return istHour >= IST_PEAK_START_HOUR && istHour < IST_PEAK_END_HOUR;
}

export function decideFixBatchSize(input: { peak: boolean; throttled: boolean }): number {
  const base = input.peak ? FIX_BATCH_PEAK : FIX_BATCH_OFF_PEAK;
  return input.throttled ? Math.floor(base / 2) : base;
}
