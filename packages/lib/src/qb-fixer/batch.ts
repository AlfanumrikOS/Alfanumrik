/**
 * Batch sizing helpers for the QB fix-failed-questions cron.
 *
 * Sizes are bounded by Vercel's 300s function maxDuration. Each row's agent
 * budget is up to 60s, so a sweep can do at most ~5 rows safely. We pick 4
 * peak / 8 off-peak with the cron firing every 15 min — gives 4*4=16 rows/hr
 * peak, 8*4=32 rows/hr off-peak. Plenty for clearing a backlog of failed
 * questions over a few days.
 */

const IST_PEAK_START_HOUR = 14;
const IST_PEAK_END_HOUR = 22;

export const FIX_BATCH_OFF_PEAK = 8;
export const FIX_BATCH_PEAK = 4;

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
