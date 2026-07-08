'use client';

/**
 * PracticeHistory — the recent completed-sessions list for the Alfa OS Practice
 * Center (ff_practice_os_v1, Tier 1+ / presentation-only).
 *
 * Reads `sessions` from GET /api/practice/history (backend-owned). Each row
 * shows the subject + topic, the date, and `scorePercent`.
 *
 * IMPORTANT: `scorePercent` here is a REAL PAST QUIZ SCORE (server-computed,
 * unlike the qualitative "readiness %" on other OS surfaces). It is rendered
 * VERBATIM from the server — never recomputed (no (correct/total) math here;
 * that would violate the P1 single-source-of-truth). It is clearly LABELLED as
 * a past quiz score, and the score is encoded number + glyph (never colour
 * alone).
 *
 * States: loading (skeleton), error (visually DISTINCT from empty), empty
 * (no sessions yet → encouraging zero-state, NOT an error).
 */

import { Skeleton } from '@alfanumrik/ui/ui';
import type { PracticeSession } from './usePracticeHistory';

interface PracticeHistoryProps {
  sessions: PracticeSession[];
  isLoading: boolean;
  error: unknown;
  isHi: boolean;
}

const MAX_ROWS = 8;

/** Short, locale-aware date. Falls back gracefully on an unparseable value. */
function formatDate(iso: string, isHi: boolean): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Glyph banding for a past quiz score (number stays primary; glyph reinforces). */
function scoreGlyph(score: number): string {
  if (score >= 80) return '★';
  if (score >= 50) return '◑';
  return '○';
}

export default function PracticeHistory({ sessions, isLoading, error, isHi }: PracticeHistoryProps) {
  const heading = (
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-3)' }}
    >
      {isHi ? 'हाल के सत्र' : 'Recent sessions'}
    </h2>
  );

  if (isLoading && sessions.length === 0) {
    return (
      <section aria-busy="true" aria-label={isHi ? 'हाल के सत्र लोड हो रहे हैं' : 'Loading recent sessions'}>
        {heading}
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={60} rounded="rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  const rows = sessions.slice(0, MAX_ROWS);

  return (
    <section aria-label={isHi ? 'हाल के अभ्यास सत्र' : 'Recent practice sessions'}>
      {heading}

      {error && sessions.length === 0 ? (
        /* ERROR — distinct from empty: orange text + solid border. */
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi
            ? 'तुम्हारा अभ्यास इतिहास अभी लोड नहीं हो पाया।'
            : "Couldn't load your practice history right now."}
        </div>
      ) : rows.length === 0 ? (
        /* EMPTY — distinct from error: muted text + dashed border. */
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          {isHi
            ? 'अभी कोई अभ्यास सत्र नहीं — अपना पहला क्विज़ दो!'
            : 'No practice sessions yet — take your first quiz!'}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((s) => {
            const title = s.topicTitle || s.subject;
            const date = formatDate(s.completedAt, isHi);
            const glyph = scoreGlyph(s.scorePercent);
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                    {title}
                  </span>
                  <span className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-3)' }}>
                    <span className="truncate">{s.subject}</span>
                    {date && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{date}</span>
                      </>
                    )}
                  </span>
                </span>

                {/* Past quiz score — verbatim from server, labelled, number + glyph. */}
                <span
                  className="shrink-0 flex flex-col items-end"
                  aria-label={
                    isHi
                      ? `पिछले क्विज़ का स्कोर ${s.scorePercent} प्रतिशत`
                      : `Past quiz score ${s.scorePercent} percent`
                  }
                >
                  <span className="flex items-center gap-1">
                    <span aria-hidden="true" style={{ color: 'var(--text-3)' }}>
                      {glyph}
                    </span>
                    <span
                      className="text-base font-extrabold"
                      style={{
                        color: 'var(--text-1)',
                        fontVariantNumeric: 'tabular-nums',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {s.scorePercent}%
                    </span>
                  </span>
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'क्विज़ स्कोर' : 'quiz score'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
