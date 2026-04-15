'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSubjectLookup } from '@/lib/useSubjectLookup';

/* ═══════════════════════════════════════════════════════════════
   ConversationManager — Sidebar with organized chat sessions
   Groups conversations by subject then chapter, supports search
   ═══════════════════════════════════════════════════════════════ */

export interface ConversationSummary {
  id: string;
  title: string;
  subject: string;
  chapter?: string;
  chapterNumber?: number;
  lastMessage: string;
  messageCount: number;
  updatedAt: string;
  isActive: boolean;
}

// Minimal fallback used only by non-hook callers (generateTitle, which runs
// outside the React render tree). Subject display inside components resolves
// icon/color/name via useSubjectLookup() so it reflects the admin-curated list.
const FALLBACK_SUBJECT_NAMES: Record<string, string> = {
  math: 'Mathematics',
  science: 'Science',
  english: 'English',
  hindi: 'Hindi',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  social_studies: 'Social Studies',
  coding: 'Coding',
};

/* ─── Relative time ─── */

function relativeTime(dateStr: string, isHi: boolean): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return isHi ? '\u0905\u092D\u0940' : 'Just now';
  if (mins < 60) return isHi ? `${mins} \u092E\u093F\u0928\u091F \u092A\u0939\u0932\u0947` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return isHi ? `${hrs} \u0918\u0902\u091F\u0947 \u092A\u0939\u0932\u0947` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return isHi ? `${days} \u0926\u093F\u0928 \u092A\u0939\u0932\u0947` : `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', { month: 'short', day: 'numeric' });
}

/* ─── Auto-title from first user message ─── */

export function generateTitle(messages: Array<{ role: string; content: string }>, subject: string): string {
  const firstUserMsg = messages.find(m => m.role === 'student' || m.role === 'user');
  const subjectLabel = FALLBACK_SUBJECT_NAMES[subject] || subject || 'New Chat';
  if (!firstUserMsg) return subjectLabel;
  // Extract meaningful title: strip common prefixes, truncate
  let title = firstUserMsg.content
    .replace(/^(teach me about|explain|help me with|mujhe sikhao|samjhao):\s*/i, '')
    .replace(/\(Chapter \d+\)/i, '')
    .trim();
  if (title.length > 50) title = title.substring(0, 47) + '...';
  return title || subjectLabel;
}

/* ─── Consolidated mode config ─── */

export interface SimplifiedMode {
  id: string;
  label: string;
  labelHi: string;
  icon: string;
  description: string;
  descriptionHi: string;
}

export const SIMPLIFIED_MODES: SimplifiedMode[] = [
  {
    id: 'ask',
    label: 'Ask Foxy',
    labelHi: 'Foxy \u0938\u0947 \u092A\u0942\u091B\u094B',
    icon: '\uD83D\uDCA1',
    description: 'Learn concepts, clear doubts',
    descriptionHi: '\u0915\u0949\u0928\u094D\u0938\u0947\u092A\u094D\u091F \u0938\u0940\u0916\u094B, \u0921\u093E\u0909\u091F \u0915\u094D\u0932\u093F\u092F\u0930 \u0915\u0930\u094B',
  },
  {
    id: 'practice',
    label: 'Practice',
    labelHi: '\u0905\u092D\u094D\u092F\u093E\u0938',
    icon: '\u270F\uFE0F',
    description: 'Problems & quizzes',
    descriptionHi: '\u092A\u094D\u0930\u0936\u094D\u0928 \u0914\u0930 \u0915\u094D\u0935\u093F\u091C\u093C',
  },
  {
    id: 'revise',
    label: 'Revise',
    labelHi: '\u0930\u093F\u0935\u0940\u091C\u093C',
    icon: '\uD83D\uDD04',
    description: 'Summaries & notes',
    descriptionHi: '\u0938\u093E\u0930\u093E\u0902\u0936 \u0914\u0930 \u0928\u094B\u091F\u094D\u0938',
  },
];

// Map simplified modes to the original mode IDs the backend expects
export const MODE_MAP: Record<string, string> = {
  ask: 'learn',      // "Ask Foxy" maps to learn mode (covers learn + doubt)
  practice: 'practice', // "Practice" maps to practice (covers practice + quiz)
  revise: 'revision',   // "Revise" maps to revision (covers revision + notes)
  lesson: 'lesson',     // Lesson stays as-is (advanced)
};

/* ═══════════════════════════════════════════════════════════════
   ConversationManager Component — Subject/Chapter Tree Sidebar
   Groups conversations by subject, then by chapter within each subject
   ═══════════════════════════════════════════════════════════════ */

interface SubjectGroup {
  subject: string;
  chapters: Record<string, ConversationSummary[]>;
}

interface ConversationManagerProps {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  isHi: boolean;
  isOpen: boolean;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
  isLoading: boolean;
}

export function ConversationManager({
  conversations,
  activeConversationId,
  isHi,
  isOpen,
  onSelect,
  onNewChat,
  onClose,
  isLoading,
}: ConversationManagerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSubjects, setCollapsedSubjects] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const lookupSubject = useSubjectLookup();

  // Filter conversations by search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      c =>
        c.title.toLowerCase().includes(q) ||
        c.lastMessage.toLowerCase().includes(q) ||
        c.subject.toLowerCase().includes(q) ||
        (c.chapter || '').toLowerCase().includes(q)
    );
  }, [conversations, searchQuery]);

  // Determine active subject from active conversation
  const activeSubject = useMemo(() => {
    if (!activeConversationId) return null;
    const active = conversations.find(c => c.id === activeConversationId);
    return active?.subject || null;
  }, [conversations, activeConversationId]);

  // Group by subject → chapter
  const subjectGroups = useMemo(() => {
    const subjectMap: Record<string, Record<string, ConversationSummary[]>> = {};
    for (const conv of filtered) {
      const subj = conv.subject || 'science';
      if (!subjectMap[subj]) subjectMap[subj] = {};
      const chapterKey = conv.chapter
        ? (conv.chapterNumber ? `Ch ${conv.chapterNumber}: ${conv.chapter}` : conv.chapter)
        : (isHi ? '\u0938\u093E\u092E\u093E\u0928\u094D\u092F' : 'General');
      if (!subjectMap[subj][chapterKey]) subjectMap[subj][chapterKey] = [];
      subjectMap[subj][chapterKey].push(conv);
    }
    // Sort conversations within each chapter by updatedAt (most recent first)
    for (const subj of Object.keys(subjectMap)) {
      for (const ch of Object.keys(subjectMap[subj])) {
        subjectMap[subj][ch].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      }
    }
    // Build ordered list: active subject first, then rest alphabetically
    const subjects = Object.keys(subjectMap);
    subjects.sort((a, b) => {
      if (a === activeSubject) return -1;
      if (b === activeSubject) return 1;
      return (lookupSubject(a)?.name || FALLBACK_SUBJECT_NAMES[a] || a).localeCompare(
        lookupSubject(b)?.name || FALLBACK_SUBJECT_NAMES[b] || b,
      );
    });
    return subjects.map(s => ({ subject: s, chapters: subjectMap[s] })) as SubjectGroup[];
  }, [filtered, activeSubject, isHi, lookupSubject]);

  // Auto-collapse inactive subjects, expand active subject
  useEffect(() => {
    if (!activeSubject) return;
    setCollapsedSubjects(prev => {
      const next = new Set(prev);
      // Expand active subject
      next.delete(activeSubject);
      // Collapse others that have not been manually toggled
      for (const group of subjectGroups) {
        if (group.subject !== activeSubject && !prev.has(group.subject)) {
          next.add(group.subject);
        }
      }
      return next;
    });
  }, [activeSubject]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSubject = useCallback((subject: string) => {
    setCollapsedSubjects(prev => {
      const next = new Set(prev);
      if (next.has(subject)) next.delete(subject);
      else next.add(subject);
      return next;
    });
  }, []);

  // Focus search on open
  useEffect(() => {
    if (isOpen && searchRef.current) {
      const t = setTimeout(() => searchRef.current?.focus(), 300);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
      if (window.innerWidth < 1024) onClose();
    },
    [onSelect, onClose]
  );

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* New Chat button */}
      <div className="p-3 pb-2">
        <button
          onClick={() => {
            onNewChat();
            if (window.innerWidth < 1024) onClose();
          }}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.97]"
          style={{
            background: 'linear-gradient(135deg, #E8590C, #F59E0B)',
          }}
        >
          <span>+</span>
          <span>{isHi ? '\u0928\u0908 \u091A\u0948\u091F' : 'New Chat'}</span>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          <span className="text-xs text-[var(--text-3)]" aria-hidden="true">
            {'\uD83D\uDD0D'}
          </span>
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            placeholder={isHi ? '\u091A\u0948\u091F \u0916\u094B\u091C\u094B...' : 'Search chats...'}
            className="flex-1 bg-transparent outline-none text-xs"
            style={{ color: 'var(--text-1)' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs"
              style={{ color: 'var(--text-3)' }}
            >
              {'\u2715'}
            </button>
          )}
        </div>
      </div>

      {/* Conversation list — subject/chapter tree */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {isLoading ? (
          <div className="space-y-3 p-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse">
                <div
                  className="h-14 rounded-xl"
                  style={{ background: 'var(--surface-2)' }}
                />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 px-4">
            <div className="text-3xl mb-2">{'\uD83E\uDD8A'}</div>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              {searchQuery
                ? (isHi ? '\u0915\u094B\u0908 \u091A\u0948\u091F \u0928\u0939\u0940\u0902 \u092E\u093F\u0932\u0940' : 'No chats found')
                : (isHi ? '\u0905\u092D\u0940 \u0924\u0915 \u0915\u094B\u0908 \u091A\u0948\u091F \u0928\u0939\u0940\u0902' : 'No conversations yet')}
            </p>
            {!searchQuery && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-3)' }}>
                {isHi
                  ? 'Foxy \u0938\u0947 \u0915\u0941\u091B \u092D\u0940 \u092A\u0942\u091B\u094B!'
                  : 'Start by asking Foxy anything!'}
              </p>
            )}
          </div>
        ) : (
          subjectGroups.map(group => {
            const resolved = lookupSubject(group.subject);
            const subCfg = resolved
              ? { name: resolved.name, icon: resolved.icon, color: resolved.color }
              : undefined;
            const isCollapsed = collapsedSubjects.has(group.subject);
            const totalConvs = Object.values(group.chapters).reduce((sum, c) => sum + c.length, 0);
            const isActiveSubject = group.subject === activeSubject;

            return (
              <div key={group.subject} className="mb-2">
                {/* Subject header */}
                <button
                  onClick={() => toggleSubject(group.subject)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-xl transition-all active:scale-[0.98]"
                  style={{
                    background: isActiveSubject ? `${subCfg?.color || '#E8590C'}08` : 'transparent',
                  }}
                >
                  <div
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-xs shrink-0"
                    style={{
                      background: `${subCfg?.color || '#E8590C'}15`,
                      color: subCfg?.color || '#E8590C',
                    }}
                  >
                    {subCfg?.icon || '\uD83D\uDCDA'}
                  </div>
                  <span
                    className="text-[11px] font-bold flex-1 text-left truncate"
                    style={{ color: isActiveSubject ? subCfg?.color || 'var(--text-1)' : 'var(--text-1)' }}
                  >
                    {subCfg?.name || group.subject}
                  </span>
                  <span className="text-[9px] font-medium" style={{ color: 'var(--text-3)' }}>
                    {totalConvs}
                  </span>
                  <span
                    className="text-[9px] transition-transform"
                    style={{
                      color: 'var(--text-3)',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    }}
                  >
                    {'\u25BC'}
                  </span>
                </button>

                {/* Chapter groups and conversations */}
                {!isCollapsed && (
                  <div className="ml-3 border-l-2 pl-2" style={{ borderColor: `${subCfg?.color || '#E8590C'}20` }}>
                    {Object.entries(group.chapters).map(([chapterKey, convs]) => (
                      <div key={chapterKey} className="mb-1.5">
                        {/* Chapter sub-header */}
                        <div
                          className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 truncate"
                          style={{ color: subCfg?.color || 'var(--text-3)', opacity: 0.7 }}
                        >
                          {chapterKey}
                        </div>
                        {/* Conversations in this chapter */}
                        <div className="space-y-0.5">
                          {convs.map((conv: ConversationSummary) => {
                            const isActive = conv.id === activeConversationId;
                            return (
                              <button
                                key={conv.id}
                                onClick={() => handleSelect(conv.id)}
                                className="w-full text-left px-2 py-2 rounded-lg transition-all active:scale-[0.98]"
                                style={{
                                  background: isActive
                                    ? `${subCfg?.color || '#E8590C'}12`
                                    : 'transparent',
                                  border: isActive
                                    ? `1px solid ${subCfg?.color || '#E8590C'}25`
                                    : '1px solid transparent',
                                }}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="text-[11px] font-semibold truncate flex-1"
                                    style={{
                                      color: isActive
                                        ? subCfg?.color || 'var(--text-1)'
                                        : 'var(--text-1)',
                                    }}
                                  >
                                    {conv.title}
                                  </span>
                                  <span
                                    className="text-[8px] shrink-0"
                                    style={{ color: 'var(--text-3)' }}
                                  >
                                    {relativeTime(conv.updatedAt, isHi)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span
                                    className="text-[10px] truncate flex-1"
                                    style={{ color: 'var(--text-3)' }}
                                  >
                                    {conv.lastMessage || (isHi ? '\u0928\u0908 \u091A\u0948\u091F' : 'New chat')}
                                  </span>
                                  <span
                                    className="text-[8px] font-medium shrink-0 px-1 py-0.5 rounded"
                                    style={{
                                      background: `${subCfg?.color || '#999'}08`,
                                      color: subCfg?.color || 'var(--text-3)',
                                    }}
                                  >
                                    {conv.messageCount} {isHi ? '\u0938\u0902\u0926\u0947\u0936' : 'msgs'}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: persistent sidebar — always visible on lg+ */}
      <div
        className="hidden lg:flex shrink-0 flex-col border-r overflow-hidden"
        style={{
          width: 260,
          background: 'var(--surface-1)',
          borderColor: 'var(--border)',
        }}
      >
        {sidebarContent}
      </div>

      {/* Mobile: slide-over panel */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={onClose}
          />
          <div
            className="fixed top-0 left-0 bottom-0 z-50 w-[280px] lg:hidden animate-slide-right"
            style={{ background: 'var(--surface-1)' }}
          >
            {/* Mobile header */}
            <div
              className="flex items-center justify-between px-3 py-3"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{'\uD83E\uDD8A'}</span>
                <span className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                  {isHi ? '\u091A\u0948\u091F \u0939\u093F\u0938\u094D\u091F\u094D\u0930\u0940' : 'Chat History'}
                </span>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
              >
                {'\u2715'}
              </button>
            </div>
            {sidebarContent}
          </div>
        </>
      )}
    </>
  );
}
