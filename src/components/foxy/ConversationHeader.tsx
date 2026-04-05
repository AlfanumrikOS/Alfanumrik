'use client';

/* ═══════════════════════════════════════════════════════════════
   ConversationHeader — Active conversation context bar
   Shows current topic, subject, mode badge, and quick actions
   ═══════════════════════════════════════════════════════════════ */

interface SubjectConfig {
  name: string;
  icon: string;
  color: string;
}

const SUBJECTS: Record<string, SubjectConfig> = {
  math: { name: 'Mathematics', icon: '\u2211', color: '#3B82F6' },
  science: { name: 'Science', icon: '\u269B', color: '#10B981' },
  english: { name: 'English', icon: 'Aa', color: '#8B5CF6' },
  hindi: { name: 'Hindi', icon: '\u0905', color: '#F59E0B' },
  physics: { name: 'Physics', icon: '\u26A1', color: '#EF4444' },
  chemistry: { name: 'Chemistry', icon: '\u2697', color: '#06B6D4' },
  biology: { name: 'Biology', icon: '\u2695', color: '#22C55E' },
  social_studies: { name: 'Social Studies', icon: '\uD83C\uDF0D', color: '#D97706' },
  coding: { name: 'Coding', icon: '\uD83D\uDCBB', color: '#6366F1' },
};

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
  const cfg = SUBJECTS[subject] || SUBJECTS.science;
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
      <button
        onClick={onOpenSidebar}
        className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all active:scale-95"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
        }}
        aria-label={isHi ? '\u091A\u0948\u091F \u0939\u093F\u0938\u094D\u091F\u094D\u0930\u0940' : 'Chat history'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-3)' }}>
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Subject icon */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0"
        style={{
          background: `${cfg.color}12`,
          color: cfg.color,
        }}
      >
        {cfg.icon}
      </div>

      {/* Title and meta */}
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-bold truncate"
          style={{ color: 'var(--text-1)' }}
        >
          {topicTitle
            ? `${chapterNumber ? `Ch ${chapterNumber}: ` : ''}${topicTitle}`
            : title || cfg.name}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded"
            style={{
              background: `${cfg.color}08`,
              color: cfg.color,
            }}
          >
            {modeInfo.icon} {isHi ? modeInfo.hi : modeInfo.en}
          </span>
          <span
            className="text-[9px]"
            style={{ color: 'var(--text-3)' }}
          >
            {messageCount} {isHi ? '\u0938\u0902\u0926\u0947\u0936' : 'msgs'}
          </span>
        </div>
      </div>

      {/* New chat button */}
      <button
        onClick={onNewChat}
        className="shrink-0 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
        style={{
          background: 'var(--surface-2)',
          color: 'var(--text-3)',
          border: '1px solid var(--border)',
        }}
      >
        + {isHi ? '\u0928\u0908 \u091A\u0948\u091F' : 'New Chat'}
      </button>
    </div>
  );
}
