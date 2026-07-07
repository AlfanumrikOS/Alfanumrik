'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { track } from '@alfanumrik/lib/analytics';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import {
  buildStarters,
  type MasteryHints,
  type StarterConfig,
  type StarterIntent,
} from '@alfanumrik/lib/foxy/starter-intents';
import type { PersonalizedSuggestions } from '@/app/api/foxy/suggest-prompts/route';

/* ─────────────────────────────────────────────────────────────
   ConversationStarters — Smart topic-aware conversation prompts
   Shows contextual starter chips based on subject + mastery.

   P0 fix (2026-05-04): chips now carry an explicit `intent` so
   the parent can dispatch correctly (route to /quiz, route to
   /stem-centre, send a constrained-prompt to Foxy, etc.) instead
   of leaking the chip *label* as a literal user message — which
   forced the server to keyword-match and silently dropped client
   context. See `src/lib/foxy/starter-intents.ts` for the registry.
   ───────────────────────────────────────────────────────────── */

// Re-export for callers that already imported StarterConfig from this file.
// New callers should import from @alfanumrik/lib/foxy/starter-intents directly.
export type { StarterConfig, StarterIntent } from '@alfanumrik/lib/foxy/starter-intents';

interface ConversationStartersProps {
  subject: string;
  language: string;
  topicTitle?: string;
  /** True when a chapter/topic has already been explored in this session.
   *  Drives whether the "Explain last topic" chip is shown. Defaults to
   *  false so a brand-new chat doesn't show the chip with no context. */
  hasLastTopic?: boolean;
  onSelect: (text: string, intent: StarterIntent) => void;
  /** When true, renders in a condensed chip strip (first 3 chips only,
   *  no "More" toggle, smaller styling) for use after conversation starts. */
  compact?: boolean;
}

/** Hick's Law: show only 3 primary starters to reduce decision time.
 *  Additional starters are behind a "More" toggle for progressive disclosure. */
const PRIMARY_COUNT = 3;

export function ConversationStarters({
  subject,
  language,
  topicTitle,
  hasLastTopic = false,
  onSelect,
  compact = false,
}: ConversationStartersProps) {
  const [showMore, setShowMore] = useState(false);

  // ── IRT-driven personalisation (RCA-FIX RC-17/RC-18, 2026-06-26) ──────────
  // Fetch mastery hints from the suggest-prompts endpoint. Grade comes from
  // AuthContext (student?.grade is already the cleaned string e.g. "9"). The
  // key is null when grade is not yet available — SWR skips the fetch.
  // refreshInterval: 5 min (matches Cache-Control: private, max-age=300).
  // On any network/server error the hook returns undefined → falls back to
  // static chips unchanged (P8 / zero regression risk for new students).
  const { student } = useAuth();
  const grade = student?.grade ?? null;

  const swrKey = subject && grade
    ? `/api/foxy/suggest-prompts?subject=${subject}&grade=${grade}`
    : null;

  const { data: suggestions } = useSWR<PersonalizedSuggestions | undefined>(
    swrKey,
    async (url: string): Promise<PersonalizedSuggestions | undefined> => {
      const r = await fetch(url);
      if (!r.ok) return undefined;
      return r.json() as Promise<PersonalizedSuggestions>;
    },
    { refreshInterval: 300_000, revalidateOnFocus: false },
  );

  // Map PersonalizedSuggestions → MasteryHints (same shape, explicit cast)
  const masteryHints: MasteryHints | undefined = suggestions ?? undefined;

  const starters = useMemo(
    () => buildStarters({ subject, topicTitle, hasLastTopic, masteryHints }),
    // masteryHints is a new object reference when SWR resolves, so including it
    // in deps is correct — useMemo only re-derives when data actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject, topicTitle, hasLastTopic, suggestions],
  );

  // Compact mode: always show exactly 3 chips, no "More" toggle.
  const visible = compact
    ? starters.slice(0, PRIMARY_COUNT)
    : (showMore ? starters : starters.slice(0, PRIMARY_COUNT));
  const hasMore = !compact && starters.length > PRIMARY_COUNT;

  return (
    <div className="foxy-starters" role="group" aria-label="Conversation starters">
      {visible.map((s, i) => {
        const label = language === 'hi' ? s.textHi : s.text;
        return (
          <button
            key={`${s.intent}-${i}`}
            onClick={() => {
              // Telemetry (P13: no PII — only intent code, label, has-topic flag,
              // topic id, subject). User asked us to measure which chips drive value.
              try {
                track('foxy_starter_clicked', {
                  intent: s.intent,
                  text: s.text,
                  has_topic: !!topicTitle,
                  subject: subject || null,
                });
              } catch { /* analytics non-critical */ }
              onSelect(label, s.intent);
            }}
            className={`foxy-starter-chip animate-slide-up shrink-0${compact ? ' text-xs py-1 px-2' : ''}`}
            style={{ animationDelay: compact ? undefined : `${i * 60}ms` }}
            aria-label={label}
          >
            <span className="mr-1" aria-hidden="true">{s.icon}</span>
            {label}
          </button>
        );
      })}
      {hasMore && (
        <button
          onClick={() => setShowMore((v) => !v)}
          className="foxy-starter-chip animate-slide-up foxy-starter-more"
          style={{ animationDelay: `${visible.length * 60}ms` }}
          aria-expanded={showMore}
          aria-label={showMore ? 'Show fewer suggestions' : 'Show more suggestions'}
        >
          {showMore
            ? (language === 'hi' ? 'कम दिखाओ ▲' : 'Less ▲')
            : (language === 'hi' ? 'और सुझाव ▼' : 'More ▼')}
        </button>
      )}
    </div>
  );
}
