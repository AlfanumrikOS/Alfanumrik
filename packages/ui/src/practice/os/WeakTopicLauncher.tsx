'use client';

/**
 * WeakTopicLauncher — surfaces the student's weakest STARTED topics for the
 * Alfa OS Practice Center (ff_practice_os_v1, Tier 1+ / presentation-only) and
 * deep-links each one into the EXISTING /quiz engine.
 *
 * Pure presentation over the existing `useMasteryOverview` (get_mastery_overview
 * RPC). It re-presents engine-decided per-topic mastery — it does NOT define
 * what "mastery" means (assessment owns get_mastery_overview) and computes no
 * score/XP. "Started" = mastery_level is neither not_started nor mastered; rows
 * are ordered weakest-first by the engine's mastery_probability (via the shared
 * masteryPercent helper).
 *
 * Visually mirrors the learn/os WeakSpotPathway pattern (a small remediation
 * list) but is a SELF-CONTAINED local component — it does NOT import any
 * learn/os files.
 *
 * Each "Practise" CTA deep-links to /quiz with the scoping params /quiz already
 * reads (verified in src/app/quiz/page.tsx): `subject` and `chapter`. /quiz has
 * no `difficulty` param, so difficulty is left to the quiz setup screen. Rows
 * with no usable chapter_number fall back to a subject-only deep-link.
 *
 * ?subject= MUST be a canonical subject CODE. get_mastery_overview returns the
 * display NAME (`subjects.name`, e.g. "Mathematics"), but every consumer in
 * /quiz does `allowedSubjects.find(s => s.code === selectedSubject)` — a name
 * matches nothing, and the page then silently falls back to the FIRST allowed
 * subject, landing the student on the wrong subject entirely. So the name is
 * resolved through `subjectCodeForName` (live allowed-subjects map first,
 * canonical static map second) and the param is OMITTED when it cannot be
 * resolved. Omitting is strictly safer than sending a name: no param means
 * "let the student pick", a bogus param means "silently pick the wrong one".
 * Same pattern as dashboard/os/SubjectRoadmaps.
 *
 * States: loading (skeleton), error (visually DISTINCT from empty), empty
 * (nothing weak yet → encouraging zero-state, NOT an error).
 */

import { useMasteryOverview } from '@alfanumrik/lib/swr';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { Skeleton } from '@alfanumrik/ui/ui';
import {
  masteryPercent,
  subjectCodeForName,
  subjectCodeMapFromAllowed,
  type MasteryOverviewRow,
} from '@alfanumrik/lib/dashboard/mastery-buckets';

interface WeakTopicLauncherProps {
  studentId: string | undefined;
  isHi: boolean;
}

const MAX_ROWS = 4;

/** Weakest-first list of started, not-yet-mastered topics (pure re-shaping). */
function weakestStarted(rows: MasteryOverviewRow[]): MasteryOverviewRow[] {
  return rows
    .filter((r) => r.mastery_level !== 'not_started' && r.mastery_level !== 'mastered')
    .sort((a, b) => masteryPercent(a) - masteryPercent(b))
    .slice(0, MAX_ROWS);
}

/**
 * Deep link into the existing /quiz engine, scoped where params are supported.
 *
 * `row.subject` is a display NAME; /quiz matches on CODE. Resolve, and OMIT
 * `subject` entirely when it cannot be resolved — never emit the raw name.
 * `chapter` is only meaningful alongside a subject, so it rides the same gate.
 */
export function quizHref(
  row: MasteryOverviewRow,
  subjectCodeByName?: Record<string, string>,
): string {
  const code = subjectCodeForName(row.subject, subjectCodeByName);
  if (!code) return '/quiz';
  const chapter = typeof row.chapter_number === 'number' && row.chapter_number > 0
    ? row.chapter_number
    : null;
  const subject = encodeURIComponent(code);
  return chapter ? `/quiz?subject=${subject}&chapter=${chapter}` : `/quiz?subject=${subject}`;
}

export default function WeakTopicLauncher({ studentId, isHi }: WeakTopicLauncherProps) {
  const { data, isLoading, error } = useMasteryOverview(studentId);
  // Authoritative name → code map for the deep links (SWR-deduped with every
  // other useAllowedSubjects consumer on the page).
  const { subjects: allowedSubjects } = useAllowedSubjects();
  const subjectCodeByName = subjectCodeMapFromAllowed(allowedSubjects);

  const rows: MasteryOverviewRow[] = Array.isArray(data) ? (data as MasteryOverviewRow[]) : [];
  const weak = weakestStarted(rows);

  const heading = (
    <h2
      className="text-sm font-bold uppercase tracking-wider mb-3"
      style={{ color: 'var(--text-3)' }}
    >
      {isHi ? 'कमज़ोर विषय' : 'Weak topics'}
    </h2>
  );

  if (isLoading && !data) {
    return (
      <section aria-busy="true" aria-label={isHi ? 'कमज़ोर विषय लोड हो रहे हैं' : 'Loading weak topics'}>
        {heading}
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} height={72} rounded="rounded-2xl" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section aria-label={isHi ? 'कमज़ोर विषय' : 'Weak topics'}>
      {heading}

      {error && !data ? (
        /* ERROR — visually distinct from empty: orange text + solid border. */
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--orange)' }}
          role="status"
        >
          {isHi
            ? 'कमज़ोर विषय अभी लोड नहीं हो पाए।'
            : "Couldn't load weak topics right now."}
        </div>
      ) : weak.length === 0 ? (
        /* EMPTY — distinct from error: muted text + dashed border. */
        <div
          className="rounded-2xl p-4 text-center text-sm"
          style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)', color: 'var(--text-3)' }}
        >
          {isHi
            ? 'अभी कोई कमज़ोर विषय नहीं — कुछ अभ्यास करके यहाँ देखो।'
            : 'No weak topics yet — practise a bit and they’ll show here.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {weak.map((row) => {
            const pct = masteryPercent(row);
            const title = (isHi && row.title_hi) || row.title || (isHi ? 'विषय' : 'Topic');
            return (
              <li key={row.topic_id}>
                <a
                  href={quizHref(row, subjectCodeByName)}
                  className="group flex items-center justify-between gap-3 rounded-2xl px-4 py-3 transition-transform duration-150 motion-safe:hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  style={{
                    minHeight: 48,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-1)',
                  }}
                  aria-label={
                    isHi
                      ? `${title} — महारत ${pct} प्रतिशत — अभ्यास करो`
                      : `${title} — ${pct} percent mastered — practise`
                  }
                >
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold truncate">{title}</span>
                    <span
                      className="text-xs mt-0.5 flex items-center gap-1"
                      style={{ color: 'var(--text-3)' }}
                    >
                      {/* number + glyph, never colour alone */}
                      <span aria-hidden="true">◑</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {isHi ? `${pct}% महारत` : `${pct}% mastered`}
                      </span>
                      {row.subject && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{row.subject}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-xs font-bold flex items-center gap-1"
                    style={{ color: 'var(--orange, #E8581C)' }}
                  >
                    {isHi ? 'अभ्यास' : 'Practise'}
                    <span
                      aria-hidden="true"
                      className="transition-transform duration-150 motion-safe:group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
