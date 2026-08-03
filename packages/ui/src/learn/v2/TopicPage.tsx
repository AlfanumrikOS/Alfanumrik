'use client';

/**
 * TopicPage — screen 06 "Topic" (`ff_learn_topic_v2`).
 *
 * PRESENTATIONAL ONLY. Fetches nothing — every value is a prop, every write
 * is a callback. The container is the existing chapter page,
 * `apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx`, which
 * already fetches topics/questions/diagrams/chapter-meta for its legacy
 * concept walkthrough. There is no dedicated `/learn/[subject]/[chapter]/
 * [topic]` route in this codebase (SCREENS.md's spec assumed one; verified
 * there isn't) — this component is an ADDITIVE render branch inserted
 * before the legacy walkthrough inside that same page, gated by
 * `ff_learn_topic_v2`. The legacy render (tabs, per-concept Quick Check,
 * Teacher's Blackboard, quiz/report phases) is completely untouched below
 * the flag branch.
 *
 * House design system only: CSS custom properties (--orange, --surface-*,
 * --text-*, --border, --font-display), matching
 * packages/ui/src/today/v2/TodayHomeV2.tsx and
 * packages/ui/src/profile/v2/ProfileScreen.tsx. Legacy "Wonder Blocks"
 * primitives (`@alfanumrik/ui/ui`) are used — the same import both of
 * those reference builds use — not the canonical `ui/primitives` set and
 * NOT the handoff's `tokens/student-v2.ts` (a design-system decision made
 * earlier this session, applied consistently across all three v2 screens).
 *
 * ── Citation integrity rule (non-negotiable, SCREENS.md §06) ──
 * Every body of NCERT/AI-derived text must carry a citation of chapter +
 * page. The container sources this from data the chapter page already
 * loads — `topic.ncert_page_range` (nullable) and the `chapters` row's
 * title (`chapterMeta`) — no new content or citation source was invented.
 * Degrade path (never fabricate):
 *   - `citation` prop is `null` (no chapter identity at all) → the
 *     explanation body is not rendered.
 *   - `citation.pageRange` is `null` (chapter known, page not yet curated)
 *     → the citation still renders, but the page slot honestly reads
 *     "page unavailable" instead of a guessed number.
 *   - Explanation text present but no citation → an "uncited" notice
 *     replaces the body; the text itself is never shown as if authoritative.
 * The "the bit people miss" callout is NOT NCERT/AI-derived — it is the
 * existing static, human-authored `getTeacherInsights()` lookup already in
 * the legacy page (exam-mistake tips keyed by topic title), so it does not
 * carry a citation and is labelled as a tip, never implied to be an NCERT
 * quote.
 *
 * ── Ask Foxy / Practice targets ──
 * Both reuse the chapter page's own existing, already-shipped mechanisms
 * (passed down as callbacks — this component does not know the URLs):
 *   - Ask Foxy  → the page's existing `askFoxy()` →
 *     `/foxy?subject=...&mode=doubt&topic=...`
 *   - Practice  → the page's existing quiz-launch CTA target →
 *     `/quiz?subject=...&chapter=...`
 * Screens 09 (Foxy v2) and 07 (Practice v2) are explicitly out of scope
 * here per the build order (07 is "build last" — the only surface that
 * writes mastery/XP).
 *
 * ── Keep offline ──
 * Wired by the container to the real `keepChapter()` from
 * `packages/lib/src/offline/store.ts` (already shipped, `ff_offline_v2`).
 * This component only renders the button when `offlineEnabled` is true and
 * calls back via `onKeepOffline` — no IndexedDB access happens here.
 */

import { Card, Button, ProgressBar, Skeleton, EmptyState } from '@alfanumrik/ui/ui';

export interface TopicPageCitation {
  chapterNumber: number;
  /** Chapter title, already language-resolved by the caller. Null when the
   *  `chapters` row hasn't loaded — the chapter number alone (always real,
   *  taken from the route) still satisfies "chapter" in "chapter + page". */
  chapterTitle: string | null;
  /** NCERT page range for this specific topic. Null = not yet curated —
   *  rendered honestly as "page unavailable", never guessed. */
  pageRange: string | null;
}

export interface TopicPageDiagram {
  imageUrl: string;
  altText: string | null;
  caption: string | null;
  captionHi: string | null;
}

export interface TopicPageTopic {
  id: string;
  /** Already language-resolved by the caller (isHi ? title_hi : title). */
  title: string;
  /** Already language-resolved by the caller. Null/empty = no explanation
   *  text available at all (distinct from "has text but no citation"). */
  explanation: string | null;
}

export interface TopicPageProps {
  isHi: boolean;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  subjectName: string;
  subjectIcon?: string;
  subjectColor?: string;
  chapterNumber: number;
  /** 0-based index of the current topic within the chapter. */
  topicIndex: number;
  topicCount: number;
  topic: TopicPageTopic | null;
  /** Null = no chapter identity available at all; see citation rule above. */
  citation: TopicPageCitation | null;
  diagram: TopicPageDiagram | null;
  /** "The bit people miss" — curated tip text, or null if none matched. */
  calloutText: string | null;
  onBack: () => void;
  onPrevTopic: (() => void) | null;
  onNextTopic: (() => void) | null;
  onAskFoxy: () => void;
  onPractice: () => void;
  /** Whether ff_offline_v2 is on — hides the Keep offline row entirely when false. */
  offlineEnabled: boolean;
  isOfflineKept: boolean;
  offlineBusy: boolean;
  onKeepOffline: () => void;
}

function CitationLine({ citation, isHi }: { citation: TopicPageCitation; isHi: boolean }) {
  const pageKnown = Boolean(citation.pageRange);
  const pageLabel = pageKnown
    ? (isHi ? `पृष्ठ ${citation.pageRange}` : `p. ${citation.pageRange}`)
    : (isHi ? 'पृष्ठ अनुपलब्ध' : 'page unavailable');

  return (
    <p
      data-testid="topic-v2-citation"
      className="text-[11px] font-semibold flex flex-wrap items-center gap-1"
      style={{ color: 'var(--text-3)' }}
    >
      <span aria-hidden="true">📖</span>
      <span>
        {isHi ? `अध्याय ${citation.chapterNumber}` : `Chapter ${citation.chapterNumber}`}
        {citation.chapterTitle ? `: ${citation.chapterTitle}` : ''}
      </span>
      <span aria-hidden="true">·</span>
      <span style={{ color: pageKnown ? 'var(--text-3)' : 'var(--orange)' }}>{pageLabel}</span>
    </p>
  );
}

export default function TopicPage({
  isHi,
  loading,
  error,
  onRetry,
  subjectName,
  subjectIcon,
  subjectColor,
  chapterNumber,
  topicIndex,
  topicCount,
  topic,
  citation,
  diagram,
  calloutText,
  onBack,
  onPrevTopic,
  onNextTopic,
  onAskFoxy,
  onPractice,
  offlineEnabled,
  isOfflineKept,
  offlineBusy,
  onKeepOffline,
}: TopicPageProps) {
  if (loading) {
    return (
      <main className="app-container py-6 pb-nav" data-testid="topic-v2-loading">
        <Skeleton height={24} width="50%" className="mb-4" />
        <Skeleton height={180} rounded="rounded-2xl" className="mb-4" />
        <Skeleton height={120} rounded="rounded-2xl" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="app-container py-6 pb-nav" data-testid="topic-v2-error">
        <EmptyState
          icon="😕"
          title={isHi ? 'अभी लोड नहीं हो पाया' : "Couldn't load this right now"}
          description={isHi ? 'थोड़ी देर में फिर कोशिश करें।' : 'Please try again in a moment.'}
          action={
            <Button variant="soft" onClick={onRetry}>
              {isHi ? 'फिर कोशिश करें' : 'Retry'}
            </Button>
          }
        />
      </main>
    );
  }

  if (!topic) {
    return (
      <main className="app-container py-6 pb-nav" data-testid="topic-v2-empty">
        <EmptyState
          icon="📚"
          title={isHi ? 'यह विषय उपलब्ध नहीं है' : 'This topic is not available'}
          action={
            <Button onClick={onBack}>{isHi ? '← वापस' : '← Back'}</Button>
          }
        />
      </main>
    );
  }

  const explanationParagraphs = (topic.explanation ?? '')
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const hasExplanationText = explanationParagraphs.length > 0;
  // Integrity rule: only render the body when we have a real citation.
  const showExplanationCard = citation !== null && hasExplanationText;
  // Text exists but couldn't be cited — degrade to an honest notice, never
  // render it as if it were authoritative.
  const showUncitedNotice = !showExplanationCard && hasExplanationText;
  const hasDiagram = Boolean(diagram && diagram.imageUrl);
  const hasNothingToShow = !hasDiagram && !showExplanationCard && !showUncitedNotice && !calloutText;

  const progressPct = topicCount > 0 ? ((topicIndex + 1) / topicCount) * 100 : 0;

  return (
    <div className="mesh-bg min-h-dvh" data-testid="topic-v2-page">
      <header className="app-container pt-4 pb-2" style={{ background: 'var(--surface-1)' }}>
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            onClick={onBack}
            aria-label={isHi ? 'वापस' : 'Back'}
            className="flex items-center justify-center rounded-full flex-shrink-0"
            style={{ width: 44, height: 44, color: 'var(--text-3)' }}
            data-testid="topic-v2-back"
          >
            <span aria-hidden="true" style={{ fontSize: 20 }}>&larr;</span>
          </button>
          {subjectIcon && <span aria-hidden="true">{subjectIcon}</span>}
          <span
            className="text-sm font-semibold truncate"
            style={{ color: subjectColor ?? 'var(--orange)' }}
          >
            {subjectName} · {isHi ? `अध्याय ${chapterNumber}` : `Chapter ${chapterNumber}`}
          </span>
          <span
            className="ml-auto text-xs font-medium flex-shrink-0"
            style={{ color: 'var(--text-3)' }}
            data-testid="topic-v2-counter"
          >
            {topicIndex + 1}/{topicCount}
          </span>
        </div>
        <ProgressBar value={progressPct} color={subjectColor} height={5} />
      </header>

      <main className="app-container py-4 pb-nav flex flex-col gap-4">
        <h1
          className="text-lg font-bold leading-snug"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
          data-testid="topic-v2-title"
        >
          {topic.title}
        </h1>

        {hasDiagram && diagram && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: '1px solid var(--border)' }}
            data-testid="topic-v2-diagram"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={diagram.imageUrl}
              alt={diagram.altText || topic.title}
              className="w-full object-contain max-h-56"
              style={{ background: 'var(--surface-2)' }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            {(diagram.caption || diagram.captionHi) && (
              <p className="text-[11px] px-3 py-2 text-center" style={{ color: 'var(--text-3)' }}>
                {isHi && diagram.captionHi ? diagram.captionHi : diagram.caption}
              </p>
            )}
          </div>
        )}

        {showExplanationCard && citation && (
          <Card className="!p-5 flex flex-col gap-3">
            <CitationLine citation={citation} isHi={isHi} />
            <div className="flex flex-col gap-3">
              {explanationParagraphs.map((paragraph, i) => (
                <p
                  key={i}
                  className="text-sm leading-relaxed"
                  style={{ color: 'var(--text-2)' }}
                  data-testid="topic-v2-explanation"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </Card>
        )}

        {showUncitedNotice && (
          <p
            className="text-xs italic px-1"
            style={{ color: 'var(--text-3)' }}
            data-testid="topic-v2-uncited-notice"
          >
            {isHi
              ? 'इस विषय के लिए अभी कोई सत्यापित (अध्याय + पृष्ठ) स्रोत उपलब्ध नहीं है, इसलिए व्याख्या नहीं दिखाई जा रही।'
              : "A verified chapter + page source for this explanation isn't available yet, so it isn't shown."}
          </p>
        )}

        {calloutText && (
          <div
            className="rounded-2xl p-4"
            style={{
              background: 'rgb(var(--orange-rgb, 232 88 28) / 0.06)',
              border: '1px solid rgb(var(--orange-rgb, 232 88 28) / 0.2)',
            }}
            data-testid="topic-v2-callout"
          >
            <p
              className="text-[11px] font-extrabold uppercase tracking-wider mb-1"
              style={{ color: 'var(--orange)' }}
            >
              {isHi ? '💡 अक्सर छूट जाने वाली बात' : '💡 The bit people miss'}
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
              {calloutText}
            </p>
          </div>
        )}

        {hasNothingToShow && (
          <EmptyState
            icon="🦊"
            title={isHi ? 'इस विषय के लिए अभी कुछ खास नहीं है' : 'Nothing prepared for this topic yet'}
            description={isHi ? 'Foxy से पूछो या सीधे अभ्यास करो।' : 'Ask Foxy or jump straight into practice.'}
          />
        )}

        {(onPrevTopic || onNextTopic) && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrevTopic ?? undefined}
              disabled={!onPrevTopic}
              className="flex-1 rounded-xl text-xs font-bold disabled:opacity-40"
              style={{
                minHeight: 44,
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
              }}
              data-testid="topic-v2-prev"
            >
              {isHi ? '← पिछला विषय' : '← Previous topic'}
            </button>
            <button
              type="button"
              onClick={onNextTopic ?? undefined}
              disabled={!onNextTopic}
              className="flex-1 rounded-xl text-xs font-bold disabled:opacity-40"
              style={{
                minHeight: 44,
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
              }}
              data-testid="topic-v2-next"
            >
              {isHi ? 'अगला विषय →' : 'Next topic →'}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2 mt-1">
          <Button fullWidth color={subjectColor} onClick={onPractice} data-testid="topic-v2-practice">
            ⚡ {isHi ? 'अभ्यास करो' : 'Practice'}
          </Button>
          <Button
            fullWidth
            variant="soft"
            color={subjectColor}
            onClick={onAskFoxy}
            data-testid="topic-v2-ask-foxy"
          >
            🦊 {isHi ? 'Foxy से पूछो' : 'Ask Foxy'}
          </Button>
          {offlineEnabled && (
            <button
              type="button"
              onClick={onKeepOffline}
              disabled={offlineBusy || isOfflineKept}
              className="w-full rounded-xl text-xs font-bold disabled:opacity-60"
              style={{
                minHeight: 44,
                background: 'var(--surface-2)',
                color: 'var(--text-2)',
                border: '1px solid var(--border)',
              }}
              data-testid="topic-v2-keep-offline"
            >
              {isOfflineKept
                ? isHi
                  ? '✓ ऑफ़लाइन सहेजा गया'
                  : '✓ Kept offline'
                : offlineBusy
                  ? isHi
                    ? 'सहेजा जा रहा है...'
                    : 'Saving...'
                  : isHi
                    ? '⬇ ऑफ़लाइन सहेजो'
                    : '⬇ Keep offline'}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
