'use client';

import { useSubjectLookup } from '@/lib/useSubjectLookup';
import { Button, IconButton } from '@/components/ui/primitives';

/* ═══════════════════════════════════════════════════════════════
   ConversationHeader — Active conversation context bar
   Shows current topic, subject, mode badge, and quick actions
   ═══════════════════════════════════════════════════════════════ */

// Fallback for the brief first-paint window before useAllowedSubjects resolves.
// Colour is intentionally omitted \u2014 the context badge is now driven by the
// brand token (var(--primary) via color-mix), not a per-subject hex.
const FALLBACK_SUBJECT = { name: 'Science', icon: '\u269B' };

interface ConversationHeaderProps {
  title: string;
  subject: string;
  mode: string;
  messageCount: number;
  isHi: boolean;
  onNewChat: () => void;
  onOpenSidebar: () => void;
  topicTitle?: string;
  chapterNumber?: number;
}

const MODE_LABELS: Record<string, { en: string; hi: string; icon: string }> = {
  ask: { en: 'Ask Foxy', hi: 'Foxy \u0938\u0947 \u092A\u0942\u091B\u094B', icon: '\uD83D\uDCA1' },
  learn: { en: 'Learn', hi: '\u0938\u0940\u0916\u094B', icon: '\uD83D\uDCD6' },
  practice: { en: 'Practice', hi: '\u0905\u092D\u094D\u092F\u093E\u0938', icon: '\u270F\uFE0F' },
  quiz: { en: 'Quiz', hi: '\u0915\u094D\u0935\u093F\u091C\u093C', icon: '\u26A1' },
  doubt: { en: 'Doubt', hi: '\u0921\u093E\u0909\u091F', icon: '\u2753' },
  revision: { en: 'Revise', hi: '\u0930\u093F\u0935\u0940\u091C\u093C', icon: '\uD83D\uDD04' },
  revise: { en: 'Revise', hi: '\u0930\u093F\u0935\u0940\u091C\u093C', icon: '\uD83D\uDD04' },
  notes: { en: 'Notes', hi: '\u0928\u094B\u091F\u094D\u0938', icon: '\uD83D\uDCDD' },
  lesson: { en: 'Lesson', hi: '\u092A\u093E\u0920', icon: '\uD83C\uDF93' },
};

export function ConversationHeader({
  title,
  subject,
  mode,
  messageCount,
  isHi,
  onNewChat,
  onOpenSidebar,
  topicTitle,
  chapterNumber,
}: ConversationHeaderProps) {
  const lookupSubject = useSubjectLookup();
  const resolved = lookupSubject(subject);
  const cfg = resolved
    ? { name: resolved.name, icon: resolved.icon }
    : FALLBACK_SUBJECT;
  const modeInfo = MODE_LABELS[mode] || MODE_LABELS.ask;

  return (
    <div
      className="px-3 py-2 flex items-center gap-2"
      style={{
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {/* Sidebar toggle (mobile) */}
      <IconButton
        label={isHi ? '\u091A\u0948\u091F \u0939\u093F\u0938\u094D\u091F\u094D\u0930\u0940' : 'Chat history'}
        variant="secondary"
        size="sm"
        onClick={onOpenSidebar}
        className="lg:hidden"
        icon={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        }
      />

      {/* Persistent context badge — subject > chapter > mode. Brand-tinted
          surface (color-mix on var(--primary)); ink text guarantees AA. */}
      <div
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl shrink-0 max-w-[55%] sm:max-w-none border"
        style={{
          background: 'color-mix(in srgb, var(--primary) 8%, var(--surface-1))',
          borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)',
        }}
      >
        <span className="text-xs shrink-0" aria-hidden="true">{cfg.icon}</span>
        <span
          className="text-[10px] font-bold truncate"
          style={{ color: 'var(--text-1)' }}
        >
          {cfg.name}
        </span>
        {(topicTitle || chapterNumber) && (
          <>
            <span className="text-[9px] shrink-0" style={{ color: 'var(--text-3)' }} aria-hidden="true">&gt;</span>
            <span
              className="text-[10px] font-semibold truncate"
              style={{ color: 'var(--text-1)' }}
            >
              {chapterNumber ? `Ch.${chapterNumber}` : ''}{chapterNumber && topicTitle ? ': ' : ''}{topicTitle || ''}
            </span>
          </>
        )}
        <span className="text-[9px] shrink-0 mx-0.5" style={{ color: 'var(--text-3)' }} aria-hidden="true">|</span>
        <span
          className="text-[9px] font-bold shrink-0"
          style={{ color: 'var(--primary)' }}
        >
          {modeInfo.icon} {isHi ? modeInfo.hi : modeInfo.en}
        </span>
      </div>

      {/* Message count + title */}
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-bold truncate"
          style={{ color: 'var(--text-1)' }}
        >
          {title || cfg.name}
        </div>
        <span
          className="text-[9px]"
          style={{ color: 'var(--text-3)' }}
        >
          {messageCount} {isHi ? '\u0938\u0902\u0926\u0947\u0936' : 'msgs'}
        </span>
      </div>

      {/* New chat button */}
      <Button
        variant="secondary"
        size="sm"
        onClick={onNewChat}
        className="shrink-0"
        leadingIcon={<span aria-hidden="true">+</span>}
      >
        {isHi ? '\u0928\u0908 \u091A\u0948\u091F' : 'New Chat'}
      </Button>
    </div>
  );
}
