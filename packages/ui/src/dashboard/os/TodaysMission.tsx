'use client';

/**
 * TodaysMission — the PRIMARY hero of the Alfa OS dashboard (ff_student_os_v1).
 *
 * Rebuilt on canonical primitives (Phase 3a, DD-16): a single dominant action.
 * Card(elevated) shell + Button variant="primary" size="lg" fullWidth as the
 * ONE "do this now", with at most two visually-subordinate ghost-Button rows
 * beneath it. The former PremiumCard/GlowButton bespoke shells and the
 * --orange→--accent-warm per-component override are GONE — the cosmic-light
 * surface now pins --btn-primary-* warm, so Button owns its own AA on-accent
 * (white-on-burnt-orange) pairing.
 *
 * Data contract UNCHANGED: still reads the learner-loop queue from
 * `/api/v2/today` via useTodayQueue. `estMinutes` are presentation badges, not
 * timing/scoring values (P1/P2 untouched — nothing is recomputed here).
 *
 * A WHY line under the hero title verbalises `primary.reason` (bilingual) so
 * the student understands *why* this is next. States: loading→Skeleton;
 * cold-start / empty→EmptyState-style card; error→Alert + retry. Bilingual (P7).
 */

import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useTodayQueue } from '@alfanumrik/lib/today/use-today-queue';
import { todayIcon } from '@alfanumrik/lib/today/icon-map';
import { todayCopy, deepLinkToHref } from '@alfanumrik/lib/today/copy';
import { ALWAYS_NATIVE_SCRIPT } from '@alfanumrik/lib/today/render';
import {
  Card,
  CardBody,
  Button,
  Badge,
  Alert,
  EmptyState,
  Skeleton,
} from '@alfanumrik/ui/ui/primitives';
import type { CurriculumTopic } from '@alfanumrik/lib/types';
import type { TodayQueueItem } from '@alfanumrik/lib/today/types';

interface TodaysMissionProps {
  isHi: boolean;
  studentName: string;
  grade: string | null | undefined;
  subjectCode: string;
  todaysTopic: CurriculumTopic | undefined;
}

function capitalize(s: string | null | undefined): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Hindi / Sanskrit always render in native Devanagari (culturally correct in
 *  Indian education regardless of UI language). Single source: render.ts. */
function displaySubjectName(code: string): string {
  return ALWAYS_NATIVE_SCRIPT[code.toLowerCase()] ?? capitalize(code);
}

/** Build the " · Chapter Title" subtitle suffix (Hindi title when available). */
function chapterSuffix(item: TodayQueueItem, isHi: boolean): string {
  const title = isHi ? (item.chapterTitleHi ?? item.chapterTitle) : item.chapterTitle;
  return title ? ` · ${title}` : '';
}

/** Interpolation bag shared by the label/subtitle copy keys. */
function copyVars(item: TodayQueueItem, isHi: boolean, subjectCode: string): Record<string, string> {
  return {
    subject: displaySubjectName((item.meta?.subjectCode as string) ?? subjectCode),
    chapterTitle: chapterSuffix(item, isHi),
    dueCount: String(item.meta?.dueCount ?? ''),
    days: String(item.meta?.daysSinceLastTouch ?? ''),
    progress: String(Math.round(((item.meta?.progressPct as number) ?? 0) * 100)),
    chapter: String(item.meta?.chapterNumber ?? ''),
    n: String(item.estMinutes),
  };
}

/**
 * The WHY line — verbalise the resolver's `reason` so the student understands
 * why this action is next. Bilingual (P7). Returns null for unknown reasons so
 * the hero degrades gracefully (no line rather than a raw reason string).
 */
function whyLine(item: TodayQueueItem, isHi: boolean): string | null {
  const n = String(item.meta?.daysSinceLastTouch ?? '');
  const dueCount = String(item.meta?.dueCount ?? '');
  const pct = String(Math.round(((item.meta?.progressPct as number) ?? 0) * 100));

  switch (item.reason) {
    case 'decay_above_threshold':
      return isHi
        ? `यह आपने ${n} दिन पहले सीखा था — एक झटपट दोहराव इसे पक्का रखेगा।`
        : `You learned this ${n} days ago — a quick refresh keeps it locked in.`;
    case 'reviews_stacking':
      return isHi
        ? `${dueCount} दोहराव तैयार हैं — जब तक ताज़ा हैं, निपटा लो।`
        : `${dueCount} reviews are ready — clear them while they're fresh.`;
    case 'todays_zpd':
      return isHi
        ? 'तुम्हारे स्तर के लिए बिलकुल सही — आगे बढ़ने का सटीक मौका।'
        : 'Pitched just right for your level — the sweet spot to grow.';
    case 'teacher_assigned':
      return isHi ? 'तुम्हारे शिक्षक ने यह तुम्हारे लिए चुना है।' : 'Your teacher picked this for you.';
    case 'weakest_topic_practice':
      return isHi
        ? 'तुम्हारा सबसे कम सटीकता वाला अध्याय — सुधरने की सबसे ज़्यादा गुंजाइश।'
        : 'Your lowest-accuracy chapter — biggest room to climb.';
    case 'in_progress_lesson':
      return isHi ? `तुम ${pct}% पूरा कर चुके हो — अब मज़बूती से खत्म करो।` : `You're ${pct}% through — finish strong.`;
    case 'no_signals_yet':
      return isHi ? 'चलो तुम्हारा शुरुआती बिंदु ढूंढें (10 मिनट)।' : "Let's find your starting point (10 min).";
    default:
      return null;
  }
}

export default function TodaysMission({
  isHi,
  // studentName is part of the stable prop contract (parent passes student.name)
  // but the greeting now lives in the dashboard header rail, so it is unused here.
  grade,
  subjectCode,
  todaysTopic,
}: TodaysMissionProps) {
  const router = useRouter();
  const { student } = useAuth();
  const {
    data: queueData,
    isLoading: queueLoading,
    error: queueError,
    mutate: retryQueue,
  } = useTodayQueue(student?.id);

  const hasQueueItems = !!queueData && queueData.queue.length > 0;
  const isColdStart = hasQueueItems && queueData!.primary.type === 'cold_start_diagnostic';
  const showEmptyState = !queueLoading && !hasQueueItems;

  const beginLesson = () => {
    if (todaysTopic) {
      router.push(`/learn/${subjectCode}/${todaysTopic.chapter_number ?? 1}`);
    } else {
      router.push('/learn');
    }
  };

  const eyebrow = (
    <Badge tone="warning" variant="soft" icon={<span aria-hidden="true">●</span>}>
      {isHi ? 'आज का मिशन' : "Today's mission"}
      {grade ? (isHi ? ` · कक्षा ${grade}` : ` · Class ${grade}`) : ''}
    </Badge>
  );

  return (
    <Card variant="elevated" className="os-mission">
      <CardBody
        className="flex flex-col gap-3 p-5 md:p-6"
        aria-label={isHi ? 'आज का मिशन' : "Today's mission"}
      >
        <div>{eyebrow}</div>

        {/* ── Loading ─────────────────────────────────────────────── */}
        {queueLoading && (
          <div
            className="flex flex-col gap-3"
            aria-busy="true"
            aria-label={isHi ? 'लोड हो रहा है' : 'Loading'}
          >
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" radius="sm" />
            <Skeleton className="h-14 w-full" radius="lg" />
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────── */}
        {!queueLoading && queueError && !hasQueueItems && (
          <Alert
            data-testid="mission-empty-state"
            tone="warning"
            title={isHi ? 'अभी योजना लोड नहीं हो पाई' : "Couldn't load your plan"}
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => retryQueue()}
                data-testid="mission-empty-retry"
              >
                {isHi ? 'फिर से कोशिश करें' : 'Try again'}
              </Button>
            }
          >
            {isHi ? 'एक पल में फिर से कोशिश करते हैं।' : "Let's try again in a moment."}
          </Alert>
        )}

        {/* ── Cold-start diagnostic (dominant onboarding card) ─────── */}
        {isColdStart && (
          <EmptyState
            compact
            icon={<span aria-hidden="true">🧭</span>}
            title={isHi ? 'अपना डायग्नोस्टिक शुरू करें' : 'Start your diagnostic'}
            description={
              isHi
                ? '10 मिनट · Foxy आपकी पर्सनलाइज्ड स्टडी प्लान बनाएगा'
                : '10 min · Foxy will personalise your study plan'
            }
            action={
              <Button
                variant="primary"
                size="lg"
                onClick={() => router.push(deepLinkToHref(queueData!.primary.deepLink))}
                trailingIcon={<span aria-hidden="true">→</span>}
                data-testid="mission-primary-action"
              >
                {isHi ? 'शुरू करें' : 'Begin diagnostic'}
              </Button>
            }
          />
        )}

        {/* ── Normal queue: ONE hero action + WHY + ≤2 subordinate ── */}
        {hasQueueItems && !isColdStart && (
          <>
            <h1
              className="text-fluid-2xl font-bold leading-tight text-foreground"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              {todayCopy(queueData!.primary.labelKey, isHi)}
            </h1>

            <p className="text-fluid-sm text-muted-foreground">
              {todayCopy(
                queueData!.primary.subtitleKey,
                isHi,
                copyVars(queueData!.primary, isHi, subjectCode),
              )}
            </p>

            {whyLine(queueData!.primary, isHi) && (
              <p className="text-fluid-sm font-medium text-foreground">
                {whyLine(queueData!.primary, isHi)}
              </p>
            )}

            {/* THE single primary action */}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={() => router.push(deepLinkToHref(queueData!.primary.deepLink))}
              leadingIcon={<span aria-hidden="true">{todayIcon(queueData!.primary.iconHint)}</span>}
              trailingIcon={<span aria-hidden="true">→</span>}
              data-testid="mission-primary-action"
            >
              {isHi
                ? `शुरू करें · ~${queueData!.primary.estMinutes} मिनट`
                : `Start · ~${queueData!.primary.estMinutes} min`}
            </Button>

            {/* Up to two visually-subordinate secondary actions */}
            {queueData!.queue.slice(1, 3).map((item) => (
              <Button
                key={item.rank}
                variant="ghost"
                fullWidth
                className="justify-between border border-surface-3"
                onClick={() => router.push(deepLinkToHref(item.deepLink))}
                leadingIcon={<span aria-hidden="true">{todayIcon(item.iconHint)}</span>}
                trailingIcon={
                  <span className="shrink-0 text-fluid-xs text-muted-foreground">
                    ~{item.estMinutes}m
                  </span>
                }
              >
                <span className="block min-w-0 truncate text-left">
                  {todayCopy(item.labelKey, isHi)}
                </span>
              </Button>
            ))}
          </>
        )}

        {/* ── Empty (no queue, no error): getting-ready + pick a lesson ── */}
        {showEmptyState && !queueError && (
          <div data-testid="mission-empty-state">
            <EmptyState
              compact
              icon={<span aria-hidden="true">🦊</span>}
              title={
                isHi ? 'तुम्हारा सीखने का रास्ता तैयार हो रहा है' : 'Your learning path is getting ready'
              }
              description={isHi ? 'शुरू करने के लिए एक पाठ चुनो।' : 'Pick a lesson to begin.'}
              action={
                <Button
                  variant="primary"
                  size="lg"
                  onClick={beginLesson}
                  trailingIcon={<span aria-hidden="true">→</span>}
                  data-testid="mission-empty-cta"
                >
                  {isHi ? 'पाठ चुनो' : 'Pick a lesson'}
                </Button>
              }
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
