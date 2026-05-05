'use client';

import { useMemo, useState } from 'react';
import { track } from '@/lib/analytics';
import {
  buildStarters,
  type StarterConfig,
  type StarterIntent,
} from '@/lib/foxy/starter-intents';

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
// New callers should import from @/lib/foxy/starter-intents directly.
export type { StarterConfig, StarterIntent } from '@/lib/foxy/starter-intents';

interface ConversationStartersProps {
  subject: string;
  language: string;
  topicTitle?: string;
  /** True when a chapter/topic has already been explored in this session.
   *  Drives whether the "Explain last topic" chip is shown. Defaults to
   *  false so a brand-new chat doesn't show the chip with no context. */
  hasLastTopic?: boolean;
  onSelect: (text: string, intent: StarterIntent) => void;
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
}: ConversationStartersProps) {
  const [showMore, setShowMore] = useState(false);

  const starters = useMemo(
    () => buildStarters({ subject, topicTitle, hasLastTopic }),
    [subject, topicTitle, hasLastTopic],
  );

  const visible = showMore ? starters : starters.slice(0, PRIMARY_COUNT);
  const hasMore = starters.length > PRIMARY_COUNT;

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
            className="foxy-starter-chip animate-slide-up"
            style={{ animationDelay: `${i * 60}ms` }}
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
