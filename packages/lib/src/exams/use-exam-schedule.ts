'use client';

/**
 * useExamSchedule — SWR reader for GET /api/v2/exam-schedule.
 *
 * Returns entries already split into "this week" and "later", with the day
 * label pre-formatted here so the presentational component never formats a
 * date. 404 (flag off) resolves to null, matching useTodayQueue's contract.
 */

import useSWR from 'swr';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import type { ExamScheduleEntry } from './types';

interface ExamScheduleResponse {
  schemaVersion: 1;
  entries: Array<Omit<ExamScheduleEntry, 'dayLabel'>>;
}

async function fetchExamSchedule(): Promise<ExamScheduleResponse | null> {
  const res = await fetch('/api/v2/exam-schedule', {
    credentials: 'same-origin',
    headers: { ...(await authHeader()) },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error('exam_schedule.fetch_failed') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return (body.data ?? body) as ExamScheduleResponse;
}

const DAY_MS = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Pre-format the day label. Single place; presentation never formats dates. */
function dayLabel(entry: Omit<ExamScheduleEntry, 'dayLabel'>, now: Date, isHi: boolean): string {
  const start = new Date(entry.startsOn);
  const end = new Date(entry.endsOn);
  const days = Math.round((startOfDay(start) - startOfDay(now)) / DAY_MS);
  const locale = isHi ? 'hi-IN' : 'en-IN';

  if (entry.startsOn !== entry.endsOn) {
    const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    return fmt.format(start) + ' – ' + fmt.format(end);
  }
  if (days === 0) return isHi ? 'आज' : 'Today';
  if (days === 1) return isHi ? 'कल' : 'Tomorrow';
  if (days > 1 && days <= 6) return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(start);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(start);
}

export function useExamSchedule(studentId: string | null | undefined, isHi: boolean) {
  const swr = useSWR<ExamScheduleResponse | null>(
    studentId ? 'v2/exam-schedule/' + studentId : null,
    fetchExamSchedule,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  const now = new Date();
  const all: ExamScheduleEntry[] = (swr.data?.entries ?? []).map((e) => ({
    ...e,
    dayLabel: dayLabel(e, now, isHi),
    setByInitials: e.setBy && e.source === 'teacher' ? e.setBy.split(/\s+/).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') : undefined,
  }));

  const weekEnd = startOfDay(now) + 7 * DAY_MS;
  const thisWeek = all.filter((e) => new Date(e.startsOn).getTime() < weekEnd);
  const later = all.filter((e) => new Date(e.startsOn).getTime() >= weekEnd);

  return { ...swr, entries: all, thisWeek, later, next: thisWeek[0] ?? all[0] ?? null };
}
