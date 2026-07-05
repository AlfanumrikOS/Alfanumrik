'use client';

/**
 * MasterySnapshot — the glanceable mastery panel of the Alfa OS dashboard
 * (ff_student_os_v1).
 *
 * Phase 3b rebuild: composed entirely from canonical primitives
 * (Card / MasteryRing / ProgressBar / Badge / EmptyState / Alert / Skeleton),
 * token-only. Structure:
 *   1. Headline MasteryRing — ACCURACY % (assessment C1), never BKT.
 *   2. Segmented distribution — one ProgressBar + count Badge per bucket,
 *      composed from primitives (no bespoke strip).
 *
 * The demoted "Review now →" CTA has been REMOVED — the review action lives in
 * the hero (TodaysMission) and the "More ways to study" disclosure, keeping a
 * single primary action above the fold.
 *
 * Presentation only — no scoring/XP/mastery formula is computed here. Every
 * number comes from `useMasteryOverview` (the get_mastery_overview RPC).
 * Bilingual via isHi (P7). Colour is never the sole signal — every bucket
 * carries an icon glyph + text label + numeric count (WCAG 1.4.1).
 */

import { useRouter } from 'next/navigation';
import { useMasteryOverview } from '@/lib/swr';
import {
  Card,
  Badge,
  ProgressBar,
  MasteryRing,
  EmptyState,
  Alert,
  Button,
  Skeleton,
  type Tone,
} from '@/components/ui/primitives';
import {
  countBuckets,
  aggregateAccuracyPercent,
  type MasteryOverviewRow,
  type BucketCounts,
} from '@/lib/dashboard/mastery-buckets';
import { bandLabel } from '@/lib/dashboard/mastery-band-labels';

interface MasterySnapshotProps {
  isHi: boolean;
  studentId: string | undefined;
}

interface BucketDef {
  key: keyof BucketCounts;
  glyph: string;
  labelEn: string;
  labelHi: string;
  tone: Tone;
}

/* Bucket → AA-safe tone + non-colour glyph. mastered=success, learning=warning
   (gold), needsRevision=info (teal). Every bucket also carries a text label +
   numeric count so colour is never the sole carrier of meaning. */
const BUCKETS: BucketDef[] = [
  { key: 'mastered', glyph: '●', labelEn: 'Mastered', labelHi: 'महारत हासिल', tone: 'success' },
  { key: 'learning', glyph: '◐', labelEn: 'Learning', labelHi: 'सीख रहे हैं', tone: 'warning' },
  { key: 'needsRevision', glyph: '↻', labelEn: 'Needs revision', labelHi: 'दोहराना ज़रूरी', tone: 'info' },
];

export default function MasterySnapshot({ isHi, studentId }: MasterySnapshotProps) {
  const router = useRouter();
  const { data, isLoading, error } = useMasteryOverview(studentId);

  const rows: MasteryOverviewRow[] = Array.isArray(data) ? (data as MasteryOverviewRow[]) : [];
  const counts = countBuckets(rows);
  const total = counts.mastered + counts.learning + counts.needsRevision;

  const heading = (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="text-fluid-xs font-bold uppercase tracking-wide text-muted-foreground">
        {isHi ? 'महारत' : 'Mastery'}
      </h2>
      {total > 0 && (
        <Badge tone="neutral" variant="soft">
          <span className="tabular-nums">{total}</span>
          <span className="ms-1">{isHi ? 'विषय' : 'topics'}</span>
        </Badge>
      )}
    </div>
  );

  /* ── Loading ── */
  if (isLoading && !data) {
    return (
      <Card
        variant="elevated"
        className="os-reveal-card px-5 py-4"
        style={{ ['--reveal-i' as string]: '1' }}
        aria-busy="true"
        aria-label={isHi ? 'महारत लोड हो रही है' : 'Loading mastery'}
      >
        {heading}
        <div className="flex items-center gap-4">
          <Skeleton radius="full" className="h-20 w-20 shrink-0" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      variant="elevated"
      className="os-reveal-card px-5 py-4"
      style={{ ['--reveal-i' as string]: '1' }}
      aria-label={isHi ? 'महारत का सारांश' : 'Mastery snapshot'}
    >
      {heading}

      {error && !isLoading ? (
        <Alert tone="danger">
          {isHi ? 'लोड नहीं हो पाया — रीफ़्रेश करें।' : "Couldn't load — try refreshing."}
        </Alert>
      ) : total === 0 ? (
        <EmptyState
          compact
          icon={<span>🎯</span>}
          title={isHi ? 'अभी तक कोई क्विज़ नहीं' : 'No quizzes yet'}
          description={
            isHi
              ? 'पहली क्विज़ दो और अपनी महारत यहाँ देखो।'
              : 'Take a quiz to see your mastery here.'
          }
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => router.push('/quiz')}
              trailingIcon={<span>→</span>}
            >
              {isHi ? 'क्विज़ शुरू करें' : 'Start a quiz'}
            </Button>
          }
        />
      ) : (
        <>
          {/* Headline accuracy ring — ACCURACY % (C1), NOT BKT probability. The
              ring value is aggregateAccuracyPercent(rows) = round(Σcorrect /
              Σattempts * 100), reconciling with quiz results (P1). */}
          <div className="mb-4 flex items-center gap-4">
            <MasteryRing
              value={aggregateAccuracyPercent(rows)}
              size={84}
              strokeWidth={7}
              bandLabel={(k) => bandLabel(k, isHi)}
            />
            <p className="text-fluid-sm text-muted-foreground">
              {isHi ? 'कुल सटीकता — सभी विषयों में' : 'Overall accuracy across your topics'}
            </p>
          </div>

          {/* Segmented distribution — one count Badge + ProgressBar share per
              bucket (composed from primitives, no bespoke strip). */}
          <div className="flex flex-col gap-3">
            {BUCKETS.map((b) => {
              const value = counts[b.key];
              const share = total > 0 ? Math.round((value / total) * 100) : 0;
              const label = isHi ? b.labelHi : b.labelEn;
              return (
                <div key={b.key} className="flex items-center gap-3">
                  <Badge
                    tone={b.tone}
                    variant="soft"
                    icon={<span>{b.glyph}</span>}
                    className="shrink-0 tabular-nums"
                  >
                    {value}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between text-fluid-xs font-semibold text-muted-foreground">
                      <span className="min-w-0 truncate">{label}</span>
                      <span className="tabular-nums">{share}%</span>
                    </div>
                    <ProgressBar
                      value={share}
                      tone={b.tone}
                      size="sm"
                      ariaLabel={`${label}: ${value} ${isHi ? 'विषय' : 'topics'} (${share}%)`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}
