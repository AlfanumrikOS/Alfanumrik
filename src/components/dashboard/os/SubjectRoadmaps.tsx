'use client';

/**
 * SubjectRoadmaps — per-subject mastery roadmaps for the Alfa OS dashboard
 * (ff_student_os_v1).
 *
 * Phase 3b rebuild: downgraded from the bespoke <SkillTree>/<RoadmapNode> to a
 * Card + row list composed from canonical primitives (MasteryRing / Badge /
 * Card), token-only. Two modes off ONE data read (SWR-deduped):
 *
 *   • glance (default, above the fold) — one READ-ONLY row per SUBJECT:
 *     a small MasteryRing (ACCURACY %, C1) + subject name + band Badge.
 *   • interactive (`interactive`, inside the "More ways to study" disclosure) —
 *     per-CHAPTER rows that deep-link into Foxy (existing URL-context, no new
 *     AI call). Locked/not-started chapters are non-interactive.
 *
 * The headline ring NUMBER is ACCURACY % (accuracyPercent / aggregate) — never
 * BKT probability (assessment C1). The bucket STATUS badge may use BKT-derived
 * bucketing (roadmapStatusForRow), which C1 permits. Bilingual via isHi (P7).
 * Presentation only — no mastery is computed here.
 */

import { useRouter } from 'next/navigation';
import { useMasteryOverview } from '@/lib/swr';
import { Card, MasteryRing, Badge, Skeleton, type Tone } from '@/components/ui/primitives';
import {
  groupBySubject,
  roadmapStatusForRow,
  accuracyPercent,
  aggregateAccuracyPercent,
  type MasteryOverviewRow,
  type RoadmapStatus,
} from '@/lib/dashboard/mastery-buckets';
import { bandForValue, bandLabel } from '@/lib/dashboard/mastery-band-labels';

interface SubjectRoadmapsProps {
  isHi: boolean;
  studentId: string | undefined;
  /** Subject display-name → code map so chapter taps can deep-link Foxy. */
  subjectCodeByName?: Record<string, string>;
  /** Interactive per-chapter mode (rendered inside the disclosure). */
  interactive?: boolean;
}

/* Roadmap bucket → AA-safe tone + non-colour glyph + growth-mindset label. */
const STATUS_CFG: Record<RoadmapStatus, { tone: Tone; glyph: string; en: string; hi: string }> = {
  mastered: { tone: 'success', glyph: '●', en: 'Mastered', hi: 'महारत' },
  learning: { tone: 'warning', glyph: '◐', en: 'Learning', hi: 'सीख रहे' },
  'needs-revision': { tone: 'info', glyph: '↻', en: 'Needs revision', hi: 'दोहराओ' },
  locked: { tone: 'neutral', glyph: '○', en: 'Not started', hi: 'अभी बाकी' },
};

/* Subject-level band → AA-safe tone (gentle: low is neutral, not danger-red). */
const BAND_TONE: Record<'low' | 'mid' | 'high', Tone> = {
  low: 'neutral',
  mid: 'warning',
  high: 'success',
};

export default function SubjectRoadmaps({
  isHi,
  studentId,
  subjectCodeByName,
  interactive = false,
}: SubjectRoadmapsProps) {
  const router = useRouter();
  const { data, isLoading, error } = useMasteryOverview(studentId);

  const rows: MasteryOverviewRow[] = Array.isArray(data) ? (data as MasteryOverviewRow[]) : [];

  const titleText = interactive
    ? isHi
      ? 'अध्याय चुनकर Foxy से अभ्यास करो'
      : 'Pick a chapter to practise with Foxy'
    : isHi
      ? 'विषय रोडमैप'
      : 'Subject roadmaps';

  const heading = (
    <h2 className="mb-3 text-fluid-xs font-bold uppercase tracking-wide text-muted-foreground">
      {titleText}
    </h2>
  );

  if (isLoading && !data) {
    return (
      <section aria-busy="true" aria-label={isHi ? 'रोडमैप लोड हो रहा है' : 'Loading roadmaps'}>
        {heading}
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} radius="lg" className="h-16 w-full" />
          ))}
        </div>
      </section>
    );
  }

  const groups = groupBySubject(rows);

  if (error && !isLoading) {
    return (
      <section aria-label={titleText}>
        {heading}
        <Card variant="flat" className="px-5 py-4">
          <p className="text-fluid-sm text-muted-foreground" role="status">
            {isHi
              ? 'अभी लोड नहीं हो पाया — रीफ़्रेश करके फिर देखो।'
              : "Couldn't load right now — pull to refresh."}
          </p>
        </Card>
      </section>
    );
  }

  if (groups.length === 0) {
    return (
      <section aria-label={titleText}>
        {heading}
        <Card variant="flat" className="px-5 py-4">
          <p className="text-fluid-sm text-muted-foreground">
            {isHi
              ? 'अपना पहला अध्याय शुरू करो — तुम्हारा रोडमैप यहाँ बनेगा।'
              : 'Start your first chapter — your roadmap builds here.'}
          </p>
        </Card>
      </section>
    );
  }

  /* ── Glance mode: one read-only row per subject ── */
  if (!interactive) {
    return (
      <section aria-label={titleText}>
        {heading}
        <Card variant="flat" className="divide-y divide-surface-3">
          {groups.map((g) => {
            const acc = aggregateAccuracyPercent(g.rows);
            const band = bandForValue(acc);
            return (
              <div key={g.subject} className="flex items-center gap-3 px-4 py-3">
                <MasteryRing
                  value={acc}
                  size={48}
                  strokeWidth={5}
                  showLabel={false}
                  bandLabel={(k) => bandLabel(k, isHi)}
                />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span aria-hidden="true" className="text-fluid-lg">{g.icon}</span>
                  <span className="min-w-0 truncate text-fluid-sm font-bold text-foreground">
                    {g.subject}
                  </span>
                </div>
                <Badge tone={BAND_TONE[band]} variant="soft" className="shrink-0">
                  {bandLabel(band, isHi)}
                </Badge>
              </div>
            );
          })}
        </Card>
      </section>
    );
  }

  /* ── Interactive mode: per-chapter rows that deep-link Foxy ── */
  return (
    <section aria-label={titleText}>
      {heading}
      <div className="flex flex-col gap-5">
        {groups.map((g) => {
          // Cap each subject to the most relevant 8 chapters to keep this light.
          const visibleRows = g.rows.slice(0, 8);
          const code = subjectCodeByName?.[g.subject] ?? g.subject.toLowerCase();
          return (
            <div key={g.subject}>
              <div className="mb-2 flex items-center gap-2">
                <span aria-hidden="true" className="text-fluid-lg">{g.icon}</span>
                <span className="text-fluid-sm font-bold text-foreground">{g.subject}</span>
              </div>
              <div className="flex flex-col gap-2">
                {visibleRows.map((row) => {
                  const status = roadmapStatusForRow(row);
                  const cfg = STATUS_CFG[status];
                  const acc = accuracyPercent(row);
                  const label =
                    isHi && row.title_hi
                      ? row.title_hi
                      : row.title || `Chapter ${row.chapter_number ?? ''}`;
                  const locked = status === 'locked';

                  const rowInner = (
                    <div className="flex items-center gap-3 px-4 py-3">
                      <MasteryRing
                        value={acc}
                        size={44}
                        strokeWidth={4}
                        showLabel={false}
                        bandLabel={(k) => bandLabel(k, isHi)}
                      />
                      <span className="min-w-0 flex-1 truncate text-fluid-sm font-semibold text-foreground">
                        {label}
                      </span>
                      <Badge
                        tone={cfg.tone}
                        variant="soft"
                        icon={<span>{cfg.glyph}</span>}
                        className="shrink-0"
                      >
                        {isHi ? cfg.hi : cfg.en}
                      </Badge>
                      {!locked && (
                        <span aria-hidden="true" className="shrink-0 text-muted-foreground">→</span>
                      )}
                    </div>
                  );

                  if (locked) {
                    return (
                      <Card key={row.topic_id} variant="flat">
                        {rowInner}
                      </Card>
                    );
                  }

                  return (
                    <Card
                      key={row.topic_id}
                      variant="interactive"
                      aria-label={
                        isHi
                          ? `${label} — Foxy के साथ अभ्यास करो`
                          : `${label} — practise with Foxy`
                      }
                      onClick={() => {
                        const params = new URLSearchParams({ subject: code, source: 'dashboard' });
                        if (row.chapter_number != null) {
                          params.set('chapter', String(row.chapter_number));
                        }
                        router.push(`/foxy?${params.toString()}`);
                      }}
                    >
                      {rowInner}
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
