'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';

// Mobile-first responsive shell (2026-05-19, Phase 2 — followup #1 of PR #867).
// Wraps the existing Foxy chat chrome in a CSS-Grid shell with safe-area-inset
// support, scroll-compacting header, and one-handed mode. The header bag
// (dark gradient header + subject tabs + toolbar + conversation/lesson rows)
// moves into AppShell.header; the chat area + ChatInput remain as children.
// See src/components/responsive/AppShell.tsx + src/app/dashboard/page.tsx
// (the reference migration) for the pattern.
import { AppShell } from '@alfanumrik/ui/responsive';
import { LESSON_STEPS, getLessonStepPrompt, getNextLessonStep, type LessonStep, type LessonState } from '@alfanumrik/lib/cognitive-engine';
import { checkDailyUsage, clearUsageCache, isUnlimitedUsage, type UsageResult } from '@alfanumrik/lib/usage';
import { speak, isVoiceSupported } from '@alfanumrik/lib/voice';
import { usePythonVoiceEnabled } from '@alfanumrik/lib/voice-feature-flag';
import { adoptVoiceReplyLanguage } from '@alfanumrik/lib/voice-reply-language';
const ConversationStarters = dynamic(() => import('@alfanumrik/ui/foxy/ConversationStarters').then(m => ({ default: m.ConversationStarters })), { ssr: false });
import type { StarterIntent } from '@alfanumrik/lib/foxy/starter-intents';
import { findSimulation } from '@alfanumrik/ui/InlineSimulation';
const InlineSimulation = dynamic(() => import('@alfanumrik/ui/InlineSimulation').then(m => ({ default: m.InlineSimulation })), { ssr: false });
const LoadingState = dynamic(() => import('@alfanumrik/ui/foxy/LoadingState').then(m => ({ default: m.LoadingState })), { ssr: false });
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';
import { generateTitle, MODE_MAP, type ConversationSummary } from '@alfanumrik/ui/foxy/ConversationManager.utils';
const ConversationManager = dynamic(() => import('@alfanumrik/ui/foxy/ConversationManager').then(m => ({ default: m.ConversationManager })), { ssr: false });
const ConversationHeader = dynamic(() => import('@alfanumrik/ui/foxy/ConversationHeader').then(m => ({ default: m.ConversationHeader })), { ssr: false });
import { useSELCheckIn, type MoodState } from '@alfanumrik/ui/SELCheckIn';
import { track } from '@alfanumrik/lib/analytics';
import { normalizeEnrolledGrade } from '@alfanumrik/lib/foxy-scope';
import {
  LANGS,
  MODES,
  FOXY_FACES,
  MASTERY_COLORS,
  FALLBACK_SCIENCE,
} from './_lib/foxy-constants';
import type { SubjectConfig, ChatMessage } from './_lib/foxy-types';
import { useFoxyChat } from './_hooks/useFoxyChat';
import type { CoachDirective } from './_hooks/useFoxyChat';
import type { LearningActionType } from '@alfanumrik/ui/foxy/ChatBubble';
import { useFoxyOsFlag } from '@alfanumrik/lib/use-foxy-os-flag';
import { useFoxyLearningActionsFlag } from '@alfanumrik/lib/use-foxy-learning-actions-flag';
import { useKeyboardInset } from '@alfanumrik/lib/foxy/use-keyboard-inset';
import { useCosmicLightSurface } from '@alfanumrik/lib/use-cosmic-light-surface';
import type { MasterySuggestion } from '@alfanumrik/ui/foxy/MasteryAwareness';
import { SIMPLIFIED_MODES } from '@alfanumrik/ui/foxy/ConversationManager';
import StudentV3Gate from '../(student)/_components/StudentV3Gate';
import { useExperiencePresence } from '@alfanumrik/ui/v3/foundations/ExperiencePresence';

// Alfa OS flagship redesign — the Foxy ContextPanel third pane (ff_student_os_v1).
// Lazy-loaded so it is fetched ONLY when the flag resolves ON; when OFF the
// chunk is never requested and the layout is byte-identical to today (P10).
const ContextPanel = dynamic(
  () => import('@alfanumrik/ui/foxy/ContextPanel'),
  { ssr: false, loading: () => null },
);

// Foxy OS mobile redesign (ff_foxy_os_v1) — compact top bar + Study sheet,
// rendered ONLY when the flag resolves ON *and* viewport is <lg. Lazy-loaded
// so the OFF path (and every >=lg viewport) fetches zero new chunks (P10);
// when OFF the legacy 5-row header is byte-identical to today.
const FoxyTopBar = dynamic(
  () => import('@alfanumrik/ui/foxy/mobile/FoxyTopBar').then((m) => ({ default: m.FoxyTopBar })),
  { ssr: false, loading: () => null },
);
const FoxyStudySheet = dynamic(
  () => import('@alfanumrik/ui/foxy/mobile/FoxyStudySheet').then((m) => ({ default: m.FoxyStudySheet })),
  { ssr: false, loading: () => null },
);
// Foxy OS mobile redesign Phase 3 — Tools bottom sheet (language / voice /
// progress / history / context). Lazy-loaded behind the same flag+breakpoint
// gate so the OFF path / >=lg fetch zero new chunks (P10).
const FoxyToolsSheet = dynamic(
  () => import('@alfanumrik/ui/foxy/mobile/FoxyToolsSheet').then((m) => ({ default: m.FoxyToolsSheet })),
  { ssr: false, loading: () => null },
);

// P10 bundle hardening: lazy-load components rendered behind a flag/modal/conditional.
// Cuts /foxy First Load JS by ~70 kB on cold paint.
//
// MOVED to ./_components/MessageList.tsx during the Plan 4 decomposition:
//   - dynamic(RichContent)            — markdown / legacy renderer
//   - dynamic(FoxyStructuredRenderer) — KaTeX-heavy structured renderer
//   - synchronous StructuredRenderBoundary
//   - isFoxyResponse / recoverFoxyResponseFromText / denormalizeFoxyResponse
// MessageList encapsulates the choice between the two renderers per-message.
const UpgradeModal = dynamic(
  () => import('@alfanumrik/ui/UpgradeModal').then((m) => ({ default: m.UpgradeModal })),
  { ssr: false },
);
const MessageList = dynamic(
  () => import('./_components/MessageList').then((m) => ({ default: m.MessageList })),
  { ssr: false, loading: () => null }
);
const SELCheckIn = dynamic(() => import('@alfanumrik/ui/SELCheckIn'), { ssr: false });
import { MessageInput } from './_components/MessageInput';
import { ReportDialog } from './_components/ReportDialog';
import { LanguagePicker, ModePicker } from './_components/FoxySettings';

/* ══════════════════════════════════════════════════════════════
   SUBJECT CONFIGURATION

   Constants (`LANGS`, `MODES`, `FOXY_FACES`, `MASTERY_COLORS`,
   `FALLBACK_SCIENCE`, `REPORT_REASONS`) and types (`SubjectConfig`,
   `StreamingCallbacks`, `ChatMessage`) live in `./_lib/foxy-constants`
   and `./_lib/foxy-types` respectively — see imports at the top of
   this file.
   ══════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════
   API HELPERS — uses shared Supabase client, no hardcoded creds
   ══════════════════════════════════════════════════════════════ */

async function fetchTopics(subjectCode: string, grade: string): Promise<any[]> {
  const { data: subjectRow } = await supabase.from('subjects').select('id').eq('code', subjectCode).eq('is_active', true).single();
  let query = supabase.from('curriculum_topics').select('*').is('parent_topic_id', null).eq('is_active', true).order('chapter_number').order('display_order').limit(80);
  query = query.or(`grade.eq.Grade ${grade},grade.eq.${grade}`);
  if (subjectRow?.id) query = query.eq('subject_id', subjectRow.id);
  const { data } = await query;
  return data ?? [];
}

async function fetchMastery(studentId: string, subject: string): Promise<any[]> {
  const { data } = await supabase.from('topic_mastery').select('*').eq('student_id', studentId).eq('subject', subject).order('updated_at', { ascending: false }).limit(50);
  return data ?? [];
}

async function fetchRecentSession(
  studentId: string,
  subject: string
): Promise<{ sessionId: string; messages: ChatMessage[] } | null> {
  const cutoff = new Date(Date.now() - 240 * 60 * 1000).toISOString(); // RCA-FIX: aligned with server SESSION_IDLE_MINUTES = 240
  const { data: sessions } = await supabase
    .from('foxy_sessions')
    .select('id')
    .eq('student_id', studentId)
    .eq('subject', subject)
    .gte('last_active_at', cutoff)
    .order('last_active_at', { ascending: false })
    .limit(1);
  if (!sessions || sessions.length === 0) return null;
  const sessionId = sessions[0].id;
  // Phase 2 (structured rendering): pull the `structured` JSONB column so
  // historical assistant turns can render via FoxyStructuredRenderer when the
  // row was persisted post-migration. NULL on legacy rows; the bubble falls
  // back to the markdown renderer in that case (see ChatBubble's renderer
  // choice).
  const { data: msgs } = await supabase
    .from('foxy_chat_messages')
    .select('id, role, content, structured, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (!msgs || msgs.length === 0) return null;
  return {
    sessionId,
    messages: msgs.map((m: any, i: number) => ({
      id: Date.now() + i,
      role: (m.role === 'assistant' ? 'tutor' : 'student') as 'tutor' | 'student',
      content: m.content,
      timestamp: m.created_at || new Date().toISOString(),
      structured: (m.structured as FoxyResponse | null | undefined) ?? undefined,
      // B'-5 Phase 2: capture DB UUID for resumed-session 👍/👎 wiring.
      persistedMessageId: m.role === 'assistant' && typeof m.id === 'string' ? m.id : undefined,
    })),
  };
}

async function fetchAllConversations(studentId: string): Promise<ConversationSummary[]> {
  // Step 1: get recent sessions ordered by activity
  const { data: sessions } = await supabase
    .from('foxy_sessions')
    .select('id, subject, chapter, last_active_at')
    .eq('student_id', studentId)
    .order('last_active_at', { ascending: false })
    .limit(30);
  if (!sessions || sessions.length === 0) return [];

  // Step 2: batch-fetch messages for all sessions in a single query
  const sessionIds = sessions.map((s: any) => s.id);
  const { data: allMsgs } = await supabase
    .from('foxy_chat_messages')
    .select('session_id, role, content, created_at')
    .in('session_id', sessionIds)
    .order('created_at', { ascending: true });

  // Step 3: group messages by session
  const msgsBySession: Record<string, Array<{ role: string; content: string; created_at: string }>> = {};
  for (const msg of (allMsgs ?? [])) {
    if (!msgsBySession[(msg as any).session_id]) msgsBySession[(msg as any).session_id] = [];
    msgsBySession[(msg as any).session_id].push(msg as any);
  }

  // Step 4: build summaries for sessions that have at least 1 message
  return sessions
    .filter((s: any) => msgsBySession[s.id]?.length > 0)
    .map((s: any) => {
      const msgs = msgsBySession[s.id] || [];
      const lastMsg = msgs[msgs.length - 1];
      return {
        id: s.id,
        title: generateTitle(msgs, s.subject),
        subject: s.subject || 'science',
        chapter: s.chapter || undefined,
        chapterNumber: undefined,
        lastMessage: lastMsg?.content?.substring(0, 80) || '',
        messageCount: msgs.length,
        updatedAt: s.last_active_at || new Date().toISOString(),
        isActive: false,
      };
    });
}

async function fetchConversationById(sessionId: string) {
  const { data: session } = await supabase
    .from('foxy_sessions')
    .select('id, subject, chapter, mode')
    .eq('id', sessionId)
    .single();
  if (!session) return null;
  // Phase 2 (structured rendering): include `structured` so resumed sessions
  // can render historical assistant turns via FoxyStructuredRenderer.
  const { data: messages } = await supabase
    .from('foxy_chat_messages')
    .select('id, role, content, structured, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  return {
    id: session.id,
    subject: session.subject,
    chapter: session.chapter,
    messages: (messages ?? []).map((m: any) => ({
      // B'-5 Phase 2: pass through the DB UUID so the consumer
      // (selectConversation) can stamp persistedMessageId on assistant rows.
      id: m.id,
      role: m.role,           // 'user' | 'assistant'
      content: m.content,
      structured: (m.structured as FoxyResponse | null | undefined) ?? undefined,
      ts: m.created_at,
    })),
  };
}

// MOVED to ./_hooks/useFoxyChat.ts: callFoxyTutor (JSON branch),
// callFoxyTutorStream (SSE branch with JSON-fallback), and shouldUseStreaming
// (per-user opt-out). The hook now exposes the protocol via sendMessage().

/* ══════════════════════════════════════════════════════════════
   MAIN FOXY PAGE
   ══════════════════════════════════════════════════════════════ */

function FoxyExperience() {
  const { active: experienceV3 } = useExperiencePresence();
  const { student: authStudent, isLoggedIn, isLoading: authLoading } = useAuth();
  const router = useRouter();
  // 2026-05-18: render BOTH unlocked and locked subjects in the tab bar so
  // students can see their full stream lineup and get an upgrade prompt
  // on a locked tap (instead of locked subjects being invisible). The
  // server already gates writes via validateSubjectWrite — this is a
  // visibility change only, not a permission change.
  const { subjects: allowedSubjects, unlocked: unlockedSubjects } = useAllowedSubjects();

  // Lookup table for tab/dropdown rendering — keep `unlocked` semantics for
  // any code path that should only see usable subjects (e.g. the legacy
  // dropdown). Tab bar reads from `allowedSubjects` (full list).
  const SUBJECTS = useMemo<Record<string, SubjectConfig>>(
    () => Object.fromEntries(
      unlockedSubjects.map((s) => [s.code, { name: s.name, icon: s.icon, color: s.color } as SubjectConfig]),
    ),
    [unlockedSubjects],
  );

  // Full lookup (incl. locked) for the tab bar.
  const ALL_SUBJECTS_BY_CODE = useMemo<Record<string, typeof allowedSubjects[number]>>(
    () => Object.fromEntries(allowedSubjects.map((s) => [s.code, s])),
    [allowedSubjects],
  );

  // Tracks which locked subject the student tapped, so we can show the
  // upgrade modal. Null = modal closed.
  const [lockedTapped, setLockedTapped] = useState<typeof allowedSubjects[number] | null>(null);

  // Core state
  const [student, setStudent] = useState<any>(null);
  const [activeSubject, setActiveSubject] = useState('science');
  const [studentGrade, setStudentGrade] = useState('9');
  const [topics, setTopics] = useState<any[]>([]);
  const [masteryData, setMasteryData] = useState<any[]>([]);

  // Chat state — `messages`, `chatSessionId`, `loading`, `xpGained`, the
  // monotonic `nextMessageId` counter, and the streaming-aware `sendMessage`
  // all live inside `useFoxyChat`. Cross-cutting reactions (foxy face,
  // voice TTS, daily-usage modal, conversation list refresh) are dispatched
  // via the optional `SendMessageHooks` callbacks passed at each call site.
  const {
    messages,
    setMessages,
    loading,
    setLoading,
    chatSessionId,
    setChatSessionId,
    xpGained,
    setXpGained,
    nextMessageId,
    sendMessage: sendMessageCore,
    recordLearningAction,
    submitQuizAnswer,
  } = useFoxyChat();

  // Phase 1 post-answer learning actions (ff_foxy_learning_actions_v1). When
  // OFF, ChatBubble renders the legacy QA-tester bar byte-identically to today.
  const learningActionsEnabled = useFoxyLearningActionsFlag();
  // Local-id set of messages the student tapped "Got it" on (drives the
  // collapsed confirmation micro-CTA in the new bar). Distinct from
  // savedMessageIds (which drives the "Saved" state).
  const [gotItMessageIds, setGotItMessageIds] = useState<Set<number>>(new Set());

  const [collapsedAbove, setCollapsedAbove] = useState<number | null>(null); // index above which messages are collapsed
  const [sessionMode, setSessionMode] = useState('learn');
  const [language, setLanguage] = useState('en');
  // Bilingual helper — kept as a derived const so the existing `language === 'hi'`
  // ternaries continue to work, while new copy can use `isHi` for clarity.
  // Task 8 (P7 fix) — Plan 4.
  const isHi = language === 'hi';
  const [activeTopic, setActiveTopic] = useState<any>(null);
  const [foxyState, setFoxyState] = useState<'idle' | 'thinking' | 'happy'>('idle');
  const [totalXP, setTotalXP] = useState(0);
  const [streakDays, setStreakDays] = useState(0);

  // Conversation sessions state
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [conversationSidebarOpen, setConversationSidebarOpen] = useState(false);

  // UI state
  const [showSubjectDD, setShowSubjectDD] = useState(false);
  const [showChapterDD, setShowChapterDD] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [studentSubs, setStudentSubs] = useState<string[]>([]);
  const [showTopicSheet, setShowTopicSheet] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false); // Collapsed by default (Hick's Law — reduce initial choices)

  // Alfa OS flagship redesign (ff_student_os_v1) — when ON, render the 3-pane
  // workspace (conversations rail | chat | ContextPanel). Defaults OFF → the
  // layout is byte-identical to today. The mobile sheet state controls the
  // ContextPanel bottom-sheet on phones.
  // ff_student_os_v1 is always-on; no flag hook needed.
  const osEnabled = true;
  const [contextSheetOpen, setContextSheetOpen] = useState(false);
  // Activate Cosmic-LIGHT + student palette only while the OS workspace is on.
  // Passing `false` makes this a no-op so the OFF path is unaffected.
  useCosmicLightSurface(osEnabled);

  // Foxy OS mobile redesign (ff_foxy_os_v1) — when ON *and* viewport is <lg,
  // the legacy 5-row header is replaced by FoxyTopBar + FoxyStudySheet.
  // Defaults OFF → byte-identical to today on every viewport. The >=lg
  // experience is never touched (the new surface is mobile-only).
  const foxyOsEnabled = useFoxyOsFlag();
  const [foxyOsMobile, setFoxyOsMobile] = useState(false);
  const [studySheetOpen, setStudySheetOpen] = useState(false);
  // Phase 3 — Tools sheet (language / voice / progress / history / context).
  const [toolsSheetOpen, setToolsSheetOpen] = useState(false);
  // Track the <lg breakpoint with matchMedia so the new surface is rendered
  // ONLY on phones. The OFF path never enters this effect's render branch.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 1023px)'); // < Tailwind lg (1024px)
    const apply = () => setFoxyOsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  // The new mobile surface renders only when the flag is ON and we are <lg.
  const useFoxyOsHeader = foxyOsEnabled && foxyOsMobile;

  // Phase 2 — keyboard-aware composer. Publishes the soft-keyboard inset to the
  // `--kb-inset` CSS var so the `.foxy-os` composer rides above the keyboard
  // and the message thread shrinks. Gated by `useFoxyOsHeader` so the hook is
  // inert (keeps `--kb-inset` at 0px) on the OFF path and on every >=lg
  // viewport — those render exactly as today. `keyboardOpen` re-fires the
  // existing auto-scroll-to-bottom effect so the latest message stays visible.
  const keyboardOpen = useKeyboardInset({ enabled: useFoxyOsHeader });

  // Error reporting
  const [reportModal, setReportModal] = useState<{ msgId: number; studentMsg: string; foxyMsg: string } | null>(null);
  const [reportReason, setReportReason] = useState('wrong_answer');
  const [reportCorrection, setReportCorrection] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMessagesLengthRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 150; // px near bottom
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // Usage enforcement
  const [chatUsage, setChatUsage] = useState<UsageResult | null>(null);
  const [showLimitModal, setShowLimitModal] = useState(false);

  // Context-aware entry — URL params from /learn, /quiz results, knowledge gap links,
  // /dashboard CTAs (Phase 1.2 auto-fill: subject + grade + source=dashboard).
  const [urlContext, setUrlContext] = useState<{ subject?: string; grade?: string; topic?: string; mode?: string; source?: string } | null>(null);
  // Tracks whether the URL-context auto-fill has been applied. The effect must
  // wait for allowedSubjects to load before validating the subject param, but
  // it must only apply once per page load (otherwise switching subjects later
  // re-triggers and clobbers the user's manual choice).
  const urlContextAppliedRef = useRef(false);
  const promptSentRef = useRef(false);

  // Save-to-flashcard — tracks which message IDs have been saved
  const [savedMessageIds, setSavedMessageIds] = useState<Set<number>>(new Set());

  // Image upload — OCR processing indicator
  const [isProcessingImage, setIsProcessingImage] = useState(false);

  // SEL mood check-in — shown once per day at session start
  const { shouldShow: shouldShowSEL, markShown: markSELShown } = useSELCheckIn(student?.id);
  const [showSELCheckIn, setShowSELCheckIn] = useState(false);
  const [sessionMood, setSessionMood] = useState<MoodState | null>(null);

  // ── Voice mode ─────────────────────────────────────────────
  // voiceMode: when ON, every Foxy reply is auto-spoken via TTS
  const [voiceMode, setVoiceMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Ref keeps voiceMode + language current inside sendMessage without extra deps
  const voiceModeRef = useRef(false);
  const voiceLangRef = useRef('en');
  const speakCancelRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);
  useEffect(() => { voiceLangRef.current = language; }, [language]);

  // Voice 2 — per-student Cloud Run TTS routing for the auto-speak path.
  // When the flag is on for this student, speak() forwards to the Python
  // Azure neural TTS endpoint; otherwise the browser speechSynthesis runs
  // unchanged. On any Python failure speak() falls back internally — see
  // REG-77 + docs/PYTHON_AI_VOICE_2_FRONTEND.md.
  const pythonVoiceEnabled = usePythonVoiceEnabled(student?.id ?? null);
  const pythonVoiceEnabledRef = useRef(false);
  useEffect(() => { pythonVoiceEnabledRef.current = pythonVoiceEnabled; }, [pythonVoiceEnabled]);
  const getJwtRef = useRef<(() => Promise<string | null>) | null>(null);
  if (!getJwtRef.current) {
    getJwtRef.current = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      } catch {
        return null;
      }
    };
  }

  // Load persisted preference
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('foxy_voice_mode');
    if (saved === 'on') setVoiceMode(true);
  }, []);

  const toggleVoiceMode = () => {
    setVoiceMode(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') localStorage.setItem('foxy_voice_mode', next ? 'on' : 'off');
      if (!next) {
        // Turning off — cancel any ongoing speech
        speakCancelRef.current?.cancel();
        setIsSpeaking(false);
      }
      return next;
    });
  };

  const speakMessage = (text: string) => {
    speakCancelRef.current?.cancel();
    setIsSpeaking(true);
    speakCancelRef.current = speak(text, {
      language: voiceLangRef.current,
      rate: 0.9,
      // Voice 2 — opt into Python TTS when the flag is on. The fallback to
      // Web Speech is automatic inside speak() on any failure (REG-77).
      pythonEnabled: pythonVoiceEnabledRef.current,
      getJwt: getJwtRef.current ?? undefined,
      onEnd: () => setIsSpeaking(false),
    });
  };

  // Cancel speech on unmount
  useEffect(() => {
    return () => { speakCancelRef.current?.cancel(); };
  }, []);

  const { tts: ttsSupported } = isVoiceSupported();
  // ─────────────────────────────────────────────────────────────

  // Show SEL check-in when the Foxy page first loads (after auth resolves)
  useEffect(() => {
    if (student?.id && shouldShowSEL && messages.length === 0) {
      setShowSELCheckIn(true);
    }
  }, [student?.id, shouldShowSEL, messages.length]);

  function handleMoodSelected(mood: MoodState) {
    setSessionMood(mood);
    setShowSELCheckIn(false);
    markSELShown();
    // Adjust Foxy mode based on mood (tired/stressed → easier content)
    if (mood === 'tired' || mood === 'stressed') {
      setSessionMode('revision'); // Lighter mode for fatigued students
    } else if (mood === 'great') {
      setSessionMode('learn'); // Challenge mode for energized students
    }
  }

  function handleSELSkip() {
    setShowSELCheckIn(false);
    markSELShown();
  }

  // Lesson flow state
  const [lessonStep, setLessonStep] = useState<LessonStep>('hook');
  const [lessonStepsCompleted, setLessonStepsCompleted] = useState<LessonStep[]>([]);
  const [lessonPrediction, setLessonPrediction] = useState('');
  const [showPredictionInput, setShowPredictionInput] = useState(false);
  const [predictionSubmitted, setPredictionSubmitted] = useState(false);

  useEffect(() => { if (!authLoading && !isLoggedIn) router.replace('/login'); }, [authLoading, isLoggedIn, router]);

  // If the student has no explicit subject selection, fall back to the full list of
  // allowed subjects (grade + plan aware). Also narrows selections to allowed codes.
  useEffect(() => {
    if (allowedSubjects.length === 0) return;
    const allowedCodes = new Set(allowedSubjects.map((s) => s.code));
    setStudentSubs((prev) => {
      if (prev.length === 0) return allowedSubjects.map((s) => s.code);
      const filtered = prev.filter((c) => allowedCodes.has(c));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [allowedSubjects]);

  // Fetch usage stats on mount and after student loads
  useEffect(() => {
    if (!student?.id) return;
    const plan = student.subscription_plan || 'free';
    checkDailyUsage(student.id, 'foxy_chat', plan).then(setChatUsage);
  }, [student?.id, student?.subscription_plan]);

  // Init student data
  useEffect(() => {
    if (!authStudent) return;
    setStudent(authStudent); setTotalXP(authStudent.xp_total || 0); setStreakDays(authStudent.streak_days || 0);
    const grade = normalizeEnrolledGrade(authStudent.grade) ?? '9';
    setStudentGrade(grade);
    setLanguage(authStudent.preferred_language || 'en');
    const saved = typeof window !== 'undefined' ? localStorage.getItem('alfanumrik_subject') : null;
    const subjectKey = saved || authStudent.preferred_subject || 'science';
    setActiveSubject(subjectKey);
    // Prefer the student's own selected_subjects; otherwise leave empty and let the
    // allowedSubjects sync effect below populate once the service hook resolves.
    setStudentSubs((authStudent.selected_subjects as string[] | undefined) ?? []);
    (async () => {
      const recent = await fetchRecentSession(authStudent.id, subjectKey);
      if (recent) {
        setChatSessionId(recent.sessionId);
        setMessages(recent.messages);
      }
    })();
  }, [authStudent, setChatSessionId, setMessages]);

  // Load conversation list
  useEffect(() => {
    if (!authStudent?.id) return;
    setConversationsLoading(true);
    fetchAllConversations(authStudent.id).then(convs => {
      setConversations(convs);
      setConversationsLoading(false);
    });
  }, [authStudent?.id]);

  // Select a conversation from the sidebar
  const selectConversation = useCallback(async (sessionId: string) => {
    const session = await fetchConversationById(sessionId);
    if (!session) return;
    setChatSessionId(session.id);
    const subject = session.subject || activeSubject;
    if (subject && SUBJECTS[subject]) {
      setActiveSubject(subject);
      if (typeof window !== 'undefined') localStorage.setItem('alfanumrik_subject', subject);
    }
    setMessages(
      (session.messages || []).map((m: any, i: number) => ({
        id: Date.now() + i,
        role: (m.role === 'assistant' ? 'tutor' : 'student') as 'tutor' | 'student',
        content: m.content,
        timestamp: m.ts || m.created_at || new Date().toISOString(),
        xp: m.meta?.xp || 0,
        structured: (m.structured as FoxyResponse | undefined) ?? undefined,
        // B'-5 Phase 2: capture the DB UUID for historical assistant turns so
        // 👍/👎 on a resumed conversation also wires to /api/foxy/feedback.
        // GET /api/foxy?sessionId=... returns `id` per row.
        persistedMessageId: m.role === 'assistant' && typeof m.id === 'string' ? m.id : undefined,
      }))
    );
    setActiveTopic(null);
    setSelectedChapters([]);
    setCollapsedAbove(null);
    setLessonStep('hook');
    setLessonStepsCompleted([]);
    setXpGained(0);
    // Update active state in conversation list
    setConversations((prev: ConversationSummary[]) =>
      prev.map((c: ConversationSummary) => ({ ...c, isActive: c.id === sessionId }))
    );
  }, [activeSubject, SUBJECTS, setChatSessionId, setMessages, setXpGained]);

  // Start a new conversation — clears chat and updates list
  const handleNewConversation = useCallback(() => {
    setMessages([]);
    setChatSessionId(null);
    setActiveTopic(null);
    setSelectedChapters([]);
    setCollapsedAbove(null);
    setLessonStep('hook');
    setLessonStepsCompleted([]);
    setXpGained(0);
    setConversations((prev: ConversationSummary[]) => prev.map((c: ConversationSummary) => ({ ...c, isActive: false })));
  }, [setChatSessionId, setMessages, setXpGained]);

  // Refresh conversation list after a message is sent (debounced)
  const refreshConversations = useCallback(() => {
    if (!student?.id) return;
    fetchAllConversations(student.id).then(convs => {
      setConversations(
        convs.map(c => ({
          ...c,
          isActive: c.id === chatSessionId,
        }))
      );
    });
  }, [student?.id, chatSessionId]);

  // Apply URL context (subject, chapter, mode, grade, source) — runs after student
  // loads AND allowedSubjects resolves, so subject validation can use the real
  // entitlement set (grade + plan + stream). Applies at most once per page load.
  useEffect(() => {
    if (!student) return;
    if (typeof window === 'undefined') return;
    if (urlContextAppliedRef.current) return;
    // Wait for allowedSubjects to populate so subject validation is honest.
    // If the student happens to have zero allowed subjects (rare edge case —
    // legacy/drift), proceed anyway after a tick so we don't deadlock.
    if (allowedSubjects.length === 0) return;

    const params = new URLSearchParams(window.location.search);
    const subjectParam = params.get('subject');
    const chapterParam = params.get('chapter');
    const modeParam = params.get('mode');
    const topicParam = params.get('topic');
    const gradeParam = params.get('grade');
    const sourceParam = params.get('source');
    if (!subjectParam && !modeParam && !topicParam && !chapterParam && !gradeParam) {
      urlContextAppliedRef.current = true;
      return;
    }

    // Validate subject param against the student's actual allowed-subjects set.
    // If the student isn't entitled to the requested subject (e.g. commerce
    // stream getting `?subject=science`), fall back to the first allowed one —
    // never silently land on a subject the dropdown can't show.
    const allowedCodes = new Set(allowedSubjects.map((s) => s.code));
    let validatedSubject: string | undefined;
    if (subjectParam && allowedCodes.has(subjectParam)) {
      validatedSubject = subjectParam;
    } else if (subjectParam && allowedSubjects.length > 0) {
      validatedSubject = allowedSubjects[0].code;
    }

    const ctx: { subject?: string; grade?: string; topic?: string; mode?: string; source?: string } = {};
    if (validatedSubject) ctx.subject = validatedSubject;
    if (gradeParam) ctx.grade = gradeParam;
    if (topicParam) ctx.topic = topicParam;
    if (chapterParam) ctx.topic = chapterParam;
    if (modeParam) ctx.mode = modeParam;
    if (sourceParam) ctx.source = sourceParam;
    setUrlContext(ctx);
    if (validatedSubject) switchSubject(validatedSubject);
    if (modeParam) setSessionMode(modeParam);
    urlContextAppliedRef.current = true;
  }, [student, allowedSubjects]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load topics on subject/grade change
  useEffect(() => {
    (async () => {
      setTopics(await fetchTopics(activeSubject, studentGrade));
      if (student?.id) setMasteryData(await fetchMastery(student.id, activeSubject));
    })();
  }, [activeSubject, studentGrade, student?.id]);

  // Smart auto-scroll. Pin to the bottom during streaming only if the user was already
  // near the bottom. Always scroll to bottom on new student message or initial load.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const len = messages.length;
    const prevLen = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = len;

    const lastMessage = messages[len - 1];
    const lastIsStudent = lastMessage?.role === 'student';

    // Phase 2: when the soft keyboard opens (keyboardOpen flips true) the
    // viewport shrinks, so re-pin to the bottom if the user was already near it
    // — keeps the latest message above the composer. `len === prevLen` here
    // (the effect re-ran from the keyboardOpen dep, not a new message), so we
    // reuse the same scroll mechanism without duplicating it.
    const keyboardJustOpened = keyboardOpen && len === prevLen;

    const shouldScroll =
      lastIsStudent ||
      isNearBottomRef.current ||
      (prevLen === 0 && len > 0) ||
      keyboardJustOpened;

    if (shouldScroll) {
      requestAnimationFrame(() => {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: loading && !lastIsStudent ? 'auto' : 'smooth',
        });
      });
    }
  }, [messages, loading, keyboardOpen]);

  // Send message — thin wrapper over the streaming-aware sendMessage from
  // useFoxyChat. Owns the page-side cross-cutting concerns (foxy face,
  // usage modal, conversation refresh, voice TTS, image OCR base64) that
  // the hook deliberately does not know about.
  //
  // Behavior preserved verbatim from the pre-decomposition page.tsx:
  //   - Daily-usage check before send (chat plan limit -> UpgradeModal)
  //   - Optimistic local usage decrement (server increments authoritatively)
  //   - Image -> base64 conversion (Claude Vision handwriting path)
  //   - Foxy face thinking->happy->idle animation
  //   - foxy_session_started + foxy_turn_completed analytics
  //   - Auto-speak on tutor reply when voice mode is ON
  //   - Conversation list refresh after a successful send
  //   - showTopicSheet auto-close on send
  const sendMessage = useCallback(async (
    text: string,
    image?: File | null,
    extraParams?: { intent?: string; coachDirective?: CoachDirective },
  ) => {
    if (!text.trim() && !image) return;

    // Check chat usage limit before bothering the streaming API.
    if (student?.id) {
      const usage = await checkDailyUsage(student.id, 'foxy_chat', student.subscription_plan || 'free');
      setChatUsage(usage);
      if (!usage.allowed) {
        import('@alfanumrik/lib/sounds').then(({ playSound }) => playSound('limit'));
        setShowLimitModal(true);
        return;
      }
      // NOTE: do NOT call recordUsage here — server increments atomically.
      setChatUsage((prev: UsageResult | null) => prev ? { ...prev, count: prev.count + 1, remaining: Math.max(0, prev.remaining - 1), allowed: prev.count + 1 < prev.limit } : prev);
    }

    // ── Image OCR processing ──
    // When the student attaches a photo of handwritten work, convert to
    // base64 and send directly to the Foxy API which passes it to Claude
    // Vision. Claude reads handwriting natively.
    let augmentedMessage = text;
    let imageBase64: string | undefined;
    let imageMediaType: string | undefined;
    if (image) {
      setIsProcessingImage(true);
      try {
        const buffer = await image.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        imageBase64 = btoa(binary);
        imageMediaType = image.type || 'image/jpeg';
        augmentedMessage = text || (language === 'hi'
          ? 'मेरा लिखा हुआ उत्तर देखो और जाँचो।'
          : 'Please look at my handwritten answer and check it.');
      } catch (err) {
        console.warn('[foxy] Image base64 conversion failed:', err);
        augmentedMessage = text || (language === 'hi'
          ? 'मैं अपना लिखा हुआ उत्तर दिखाना चाहता था।'
          : 'I wanted to share my handwritten answer.');
      } finally {
        setIsProcessingImage(false);
      }
    }

    setShowTopicSheet(false);
    setFoxyState('thinking');

    const selectedChapterTopics = selectedChapters.length > 0 ? topics.filter((t: any) => selectedChapters.includes(t.id)) : [];
    const chapCtx = selectedChapterTopics.length > 0 ? selectedChapterTopics.map((t: any) => `Ch ${t.chapter_number}: ${t.title}`).join(', ') : null;
    const chapterForSession = activeTopic?.title || (selectedChapterTopics.length === 1 ? selectedChapterTopics[0].title : null);

    // Analytics: F16 — fires once per fresh thread.
    const isFreshSession = !chatSessionId;
    if (isFreshSession) {
      try {
        track('foxy_session_started', { subject: activeSubject, grade: studentGrade, mode: sessionMode });
      } catch { /* analytics non-critical */ }
    }
    const turnStartedAt = Date.now();

    await sendMessageCore(
      {
        message: text,
        augmentedMessage,
        imageFile: image ?? null,
        imageBase64,
        imageMediaType,
        studentId: student?.id || '',
        studentName: student?.name || 'Student',
        grade: studentGrade,
        subject: activeSubject,
        language,
        mode: sessionMode,
        topicId: activeTopic?.id || null,
        topicTitle: activeTopic?.title || null,
        chapter: chapterForSession,
        selectedChapters: chapCtx,
        intent: extraParams?.intent,
        coachDirective: extraParams?.coachDirective,
      },
      {
        onLimitReached: () => {
          setShowLimitModal(true);
          setFoxyState('idle');
        },
        onComplete: ({ usedStreaming, groundedFromChunks, citationsCount }) => {
          // Always finalize the foxy face animation when the turn ends.
          setFoxyState('happy');
          setTimeout(() => setFoxyState('idle'), 2000);
          try {
            track('foxy_turn_completed', {
              subject: activeSubject,
              grade: studentGrade,
              was_grounded: groundedFromChunks === true,
              citations_count: typeof citationsCount === 'number' ? citationsCount : 0,
              latency_ms: Date.now() - turnStartedAt,
              streamed: usedStreaming,
            });
          } catch { /* analytics non-critical */ }
          setTimeout(refreshConversations, 1000);
        },
        onTutorReplyAdded: ({ reply }) => {
          // Auto-speak when voice mode is ON (JSON branch only — streaming
          // branch does not auto-speak partial deltas).
          if (voiceModeRef.current) {
            speakCancelRef.current?.cancel();
            setIsSpeaking(true);
            speakCancelRef.current = speak(reply, {
              language: voiceLangRef.current,
              rate: 0.9,
              // Voice 2 — opt into Python TTS when the flag is on; fallback
              // to Web Speech is automatic inside speak() on any failure.
              pythonEnabled: pythonVoiceEnabledRef.current,
              getJwt: getJwtRef.current ?? undefined,
              onEnd: () => setIsSpeaking(false),
            });
          }
        },
      },
    );
  }, [student, studentGrade, activeSubject, language, sessionMode, activeTopic, chatSessionId, selectedChapters, topics, refreshConversations, sendMessageCore]);

  // Auto-send prompt parameter if provided in URL (e.g. from Lesson Blackboard doubts)
  useEffect(() => {
    if (!student || promptSentRef.current) return;
    if (typeof window === 'undefined') return;
    
    const params = new URLSearchParams(window.location.search);
    const promptParam = params.get('prompt');
    if (promptParam) {
      promptSentRef.current = true;
      const t = setTimeout(() => {
        sendMessage(promptParam);
      }, 1000);
      return () => clearTimeout(t);
    }
  }, [student, sendMessage]);


  /**
   * P0 chip-action fix (2026-05-04). Dispatches Foxy starter-chip clicks
   * to the right destination based on the explicit `intent` payload.
   * Previously every chip leaked its label as a literal user message and
   * the API had to keyword-match (which silently dropped /quiz routing,
   * leaked unconstrained "Formula sheet" prompts to Claude — P12 risk —
   * and sent "Explain last topic" with no context). See
   * `src/lib/foxy/starter-intents.ts` for the registry.
   *
   * Backward compatible: if `intent` is empty/unknown, falls through to
   * the legacy send-text-as-message behavior.
   */
  const handleStarterClick = useCallback((text: string, intent: StarterIntent) => {
    // P0.1: experiment → simulation deeplink (only if a matching sim exists
    // for the current topic; otherwise fall through to Foxy so the student
    // still gets an answer instead of a dead chip).
    if (intent === 'experiment' && activeTopic) {
      const sim = findSimulation(activeTopic.title || '');
      if (sim) {
        try {
          track('simulation_opened', { simulation_id: sim.id, title: sim.title });
        } catch { /* analytics non-critical */ }
        router.push(`/stem-centre?lab=${sim.id}&from=foxy`);
        return;
      }
      // No matching sim → fall through to Foxy.
    }

    // P0.2: quiz → /quiz route. This preserves P4 (atomic_quiz_profile_update
    // RPC) and REG-54 (validation oracle gate). Routing through Foxy chat
    // would bypass both. Requires an active topic so the quiz has a scope.
    if (intent === 'quiz') {
      if (activeTopic?.id) {
        router.push(`/quiz?topic=${activeTopic.id}&source=foxy`);
        return;
      }
      // No active topic → send a Foxy prompt asking student to pick a chapter.
      sendMessage(
        language === 'hi'
          ? 'क्विज़ शुरू करने से पहले एक अध्याय चुनें।'
          : 'Pick a chapter first, then I can quiz you on it.',
      );
      return;
    }

    // P0.3: formulas — guard P12 hallucination. NEVER send a bare "Formula
    // sheet" prompt; Claude will invent formulas not in NCERT. Send a
    // strictly-grounded prompt that forces abstention if no source is found.
    // Long-term fix: a `formula_bank` table + dedicated route. Stopgap below.
    if (intent === 'formulas') {
      const scope = activeTopic?.title || SUBJECTS[activeSubject]?.name || '';
      const constrained = language === 'hi'
        ? `कृपया NCERT अध्याय ${scope ? `"${scope}"` : ''} में दिए गए सूत्रों की सूची बनाओ। हर सूत्र के साथ NCERT पाठ का स्रोत बताओ। यदि अध्याय में कोई सूत्र नहीं है तो स्पष्ट रूप से कहो — कोई सूत्र अपने आप मत बनाओ।`
        : `Using ONLY the NCERT chapter content for ${scope || 'this subject'}, list the key formulas with their exact textbook source. If no formulas appear in the chapter, say so explicitly — DO NOT invent any formula.`;
      sendMessage(constrained, null, { intent: 'formulas' });
      return;
    }

    // P0.4 / P0.5: weak_areas + study_today — tag the request so /api/foxy
    // can fetch topic_mastery rows server-side and inject them as context.
    if (intent === 'weak_areas' || intent === 'study_today') {
      sendMessage(text, null, { intent });
      return;
    }

    // explain_last, teach, real_world, diagram → default pass-through.
    sendMessage(text);
  }, [activeTopic, activeSubject, language, router, sendMessage, SUBJECTS]);

  // Feedback: thumbs up/down.
  // B'-5 Phase 2: dual-write — call the new per-message feedback endpoint
  // (closes the loop for resolveCoachMode's mode-switch signal) AND keep the
  // legacy aggregate counter (preserves the existing super-admin analytics
  // dashboards that read `track_ai_quality` rows). The new endpoint is the
  // load-bearing one; the aggregate counter is removed in a follow-up once
  // dashboards migrate to `foxy_message_feedback`.
  const handleFeedback = useCallback(async (msgId: number, isUp: boolean) => {
    let persistedMessageId: string | undefined;
    setMessages((prev: ChatMessage[]) => prev.map((m: ChatMessage) => {
      if (m.id !== msgId) return m;
      persistedMessageId = m.persistedMessageId;
      return { ...m, feedback: isUp ? 'up' : 'down' };
    }));
    if (persistedMessageId) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token ?? null;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
        await fetch('/api/foxy/feedback', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ messageId: persistedMessageId, isUp }),
        });
      } catch {
        // Non-critical: optimistic UI already updated. The aggregate counter
        // call below still bumps so legacy analytics keep functioning.
      }
    }
    try { await supabase.rpc('track_ai_quality', { p_subject: activeSubject, p_is_thumbs_up: isUp }); } catch {}
  }, [activeSubject, setMessages]);

  // Open report modal
  const openReport = useCallback((msgId: number) => {
    const foxyMsg = messages.find((m: ChatMessage) => m.id === msgId);
    const idx = messages.findIndex((m: ChatMessage) => m.id === msgId);
    const studentMsg = idx > 0 ? messages.slice(0, idx).reverse().find((m: ChatMessage) => m.role === 'student') : null;
    if (!foxyMsg) return;
    setReportModal({ msgId, studentMsg: studentMsg?.content || '', foxyMsg: foxyMsg.content });
    setReportReason('wrong_answer'); setReportCorrection(''); setReportSuccess(false);
  }, [messages]);

  // Save tutor message to spaced repetition / flashcard deck
  const saveToFlashcard = useCallback(async (msgId: number, content: string) => {
    if (!student?.id) return;
    setSavedMessageIds((prev: Set<number>) => new Set(prev).add(msgId));
    try {
      const res = await fetch('/api/student/foxy-interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_flashcard',
          subject: activeSubject,
          topic: activeTopic?.title || null,
          question: `Review: ${activeSubject}${activeTopic ? ` — ${activeTopic.title}` : ''}`,
          answer: content,
        }),
      });
      if (!res.ok) throw new Error('save_flashcard failed');
    } catch {
      // Non-critical — undo optimistic update
      setSavedMessageIds((prev: Set<number>) => { const s = new Set(prev); s.delete(msgId); return s; });
    }
  }, [student?.id, activeSubject, activeTopic]);

  // ── Phase 1 learning actions (ff_foxy_learning_actions_v1) ──────────────────
  // Dispatches a learning-action chip tap from the new ChatBubble bar:
  //   - records non-evidential telemetry via /api/foxy/learning-action (the
  //     persisted DB uuid is the only valid messageId; tap is a no-op without it)
  //   - re-teach/quiz actions RE-SEND the SAME prior student question with a
  //     coachDirective so a fresh, directive-shaped Foxy bubble appears.
  //   - save reflects saved state; got_it collapses the row into a micro-CTA.
  // Self-reports never mutate mastery/XP — that contract is enforced server-side.
  const handleLearningAction = useCallback(async (msg: ChatMessage, action: LearningActionType) => {
    const persistedMessageId = msg.persistedMessageId;
    // Without the persisted DB uuid the server cannot record/own-check the
    // action. Telemetry is skipped; the re-teach/quiz UX below still works since
    // it only re-sends the prior question.
    const subjectCode = activeSubject || null;
    const chapterNumber =
      typeof activeTopic?.chapter_number === 'number' ? activeTopic.chapter_number : null;

    // Map the chip → telemetry actionType (1:1) and re-send directive.
    if (persistedMessageId) {
      void recordLearningAction({
        messageId: persistedMessageId,
        actionType: action,
        sessionId: chatSessionId,
        subjectCode: action === 'save' ? subjectCode : null,
        chapterNumber: action === 'save' ? chapterNumber : null,
      });
    }

    if (action === 'got_it') {
      setGotItMessageIds((prev: Set<number>) => new Set(prev).add(msg.id));
      return;
    }

    if (action === 'save') {
      // Optimistic saved state; reuses the same set the bar reads. The server
      // (learning-action route) owns the student_bookmarks insert.
      setSavedMessageIds((prev: Set<number>) => new Set(prev).add(msg.id));
      return;
    }

    if (action === 'explain_simpler' || action === 'show_example' || action === 'quiz_me') {
      // Find the student question this answer responded to — the nearest
      // preceding 'student' bubble (same lookup shape as openReport).
      const idx = messages.findIndex((m: ChatMessage) => m.id === msg.id);
      const priorStudent = idx > 0
        ? messages.slice(0, idx).reverse().find((m: ChatMessage) => m.role === 'student')
        : null;
      const question = priorStudent?.content?.trim();
      if (!question) {
        // No prior question to re-teach (e.g. an opening Foxy bubble). Nudge the
        // student to ask, bilingual — never silently no-op.
        sendMessage(
          language === 'hi'
            ? 'किस सवाल पर मदद चाहिए? नीचे लिखो।'
            : 'Which question should I help with? Type it below.',
        );
        return;
      }
      const directive: CoachDirective =
        action === 'explain_simpler' ? 'simplify'
        : action === 'show_example' ? 'example'
        : 'quiz_me';
      sendMessage(question, null, { coachDirective: directive });
    }
  }, [messages, recordLearningAction, sendMessage, chatSessionId, activeSubject, activeTopic, language]);

  // Submit report
  const submitReport = useCallback(async () => {
    if (!reportModal) return;
    setReportSubmitting(true);
    try {
      const res = await fetch('/api/student/foxy-interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'report_response',
          session_id: chatSessionId,
          student_message: reportModal.studentMsg,
          foxy_response: reportModal.foxyMsg,
          report_reason: reportReason,
          student_correction: reportCorrection || null,
          subject: activeSubject,
          grade: studentGrade,
          topic_title: activeTopic?.title || null,
          session_mode: sessionMode,
          language,
        }),
      });
      if (!res.ok) throw new Error('report_response failed');
      setMessages((prev: ChatMessage[]) => prev.map((m: ChatMessage) => m.id === reportModal.msgId ? { ...m, reported: true, feedback: 'down' } : m));
      setReportSuccess(true);
    } catch {}
    setReportSubmitting(false);
  }, [reportModal, chatSessionId, reportReason, reportCorrection, activeSubject, studentGrade, activeTopic, sessionMode, language, setMessages]);

  const switchSubject = (key: string) => {
    setActiveSubject(key); setActiveTopic(null); setSelectedChapters([]); setShowSubjectDD(false); setCollapsedAbove(null);
    if (typeof window !== 'undefined') localStorage.setItem('alfanumrik_subject', key);
    if (key === 'hindi') setLanguage('hi');
    else if (key === 'english') setLanguage('en');
    // Try to resume most recent active session for this subject (within 30 min)
    setMessages([]); setChatSessionId(null);
    if (student?.id) {
      fetchRecentSession(student.id, key).then(result => {
        if (result) {
          setChatSessionId(result.sessionId);
          setMessages(result.messages);
        }
      });
    }
  };

  // Start a fresh topic session — delegates to handleNewConversation
  const startNewTopic = handleNewConversation;

  // Language toggle lock for language subjects
  const isLangLocked = activeSubject === 'hindi' || activeSubject === 'english';

  // Mode switch with auto-prompt — supports both simplified and legacy mode IDs
  const switchMode = useCallback((modeId: string) => {
    // Map simplified mode to backend mode
    const backendMode = MODE_MAP[modeId] || modeId;
    setSessionMode(backendMode);
    const mode = MODES.find(m => m.id === backendMode);
    if (!mode) return;
    // Doubt/ask mode: let user type their own question
    if (backendMode === 'doubt' || modeId === 'ask') return;
    // Lesson mode: start lesson flow
    if (backendMode === 'lesson') {
      setLessonStep('hook');
      setLessonStepsCompleted([]);
      setPredictionSubmitted(false);
      setShowPredictionInput(false);
      const topicName = activeTopic?.title || '';
      if (topicName) {
        const prompt = getLessonStepPrompt('hook', topicName, language);
        sendMessage(prompt);
      }
      return;
    }
    // Auto-send a contextual prompt
    const topicName = activeTopic?.title || '';
    const prompt = language === 'hi' ? mode.autoPromptHi(topicName) : mode.autoPrompt(topicName);
    if (prompt) sendMessage(prompt);
  }, [activeTopic, language, sendMessage]);

  // Alfa OS — apply a mastery-aware suggestion from the ContextPanel.
  // This routes ENTIRELY through the existing mode/prompt mechanism: it sets
  // the session mode and dispatches the mode's standard autoPrompt/autoPromptHi
  // via sendMessage. No new AI call, no new prompt path, no change to the
  // structured-render envelope or scope-lock (P12 / REG-55 preserved).
  const applyMasterySuggestion = useCallback((s: MasterySuggestion) => {
    const backendMode = MODE_MAP[s.kind] || s.kind; // 'practice' | 'revise'
    setSessionMode(backendMode);
    const mode = MODES.find((m) => m.id === backendMode);
    const topicName = s.topicTitle || activeTopic?.title || '';
    const prompt = mode
      ? (language === 'hi' ? mode.autoPromptHi(topicName) : mode.autoPrompt(topicName))
      : '';
    if (prompt) sendMessage(prompt);
    setContextSheetOpen(false);
  }, [activeTopic, language, sendMessage]);

  // Advance lesson step
  const advanceLessonStep = useCallback(() => {
    const state: LessonState = {
      currentStep: lessonStep,
      stepsCompleted: lessonStepsCompleted,
      recallScore: null,
      applicationScore: null,
    };
    const next = getNextLessonStep(state);
    if (next === 'complete') {
      setSessionMode('learn');
      return;
    }
    setLessonStepsCompleted((prev: LessonStep[]) => [...prev, lessonStep]);
    setLessonStep(next);
    setPredictionSubmitted(false);
    setShowPredictionInput(next === 'active_recall');
    const topicName = activeTopic?.title || '';
    if (topicName) {
      const prompt = getLessonStepPrompt(next, topicName, language);
      sendMessage(prompt);
    }
  }, [lessonStep, lessonStepsCompleted, activeTopic, language, sendMessage]);

  const cfg = SUBJECTS[activeSubject] || SUBJECTS.science || FALLBACK_SCIENCE;

  // Phase 1.2: when entering Foxy from /dashboard with subject+grade pre-filled,
  // show a friendlier "Hi! Ready to study Class X Y?" greeting instead of the
  // generic "Hi! I am Foxy" + chapter nudge. This removes friction for first-time
  // students who can't yet make domain decisions like "which chapter".
  const isDashboardEntry =
    urlContext?.source === 'dashboard' && !!urlContext?.subject && !activeTopic;
  const dashboardEntryGrade = urlContext?.grade || studentGrade;

  const getEmptyStateHeading = (): string => {
    if (isDashboardEntry) {
      return language === 'hi'
        ? `नमस्ते! कक्षा ${dashboardEntryGrade} ${cfg.name} पढ़ने के लिए तैयार?`
        : `Hi! Ready to study Class ${dashboardEntryGrade} ${cfg.name}?`;
    }
    return language === 'hi' ? 'नमस्ते! मैं फॉक्सी हूँ' : 'Hi! I am Foxy';
  };

  const getEmptyStateSubtitle = (): string => {
    if (isDashboardEntry) {
      return language === 'hi'
        ? 'कुछ भी पूछो — सवाल, डाउट, या कोई कॉन्सेप्ट समझाने के लिए कहो। \u{1F98A}'
        : 'Ask me anything — a question, a doubt, or just type a topic to learn. \u{1F98A}';
    }
    if (!activeTopic) {
      return language === 'hi'
        ? 'नीचे से अध्याय चुनो या सीधे टाइप करो!'
        : 'Select a chapter below or just start typing!';
    }
    return language === 'hi'
      ? `${cfg.name} — अध्याय ${activeTopic.chapter_number}: ${activeTopic.title}`
      : `${cfg.name} — Ch ${activeTopic.chapter_number}: ${activeTopic.title}`;
  };

  if (authLoading || !student) return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center">
      <div className="text-center"><div className="text-5xl animate-float mb-3">{FOXY_FACES.idle}</div><p className="text-sm text-[var(--text-3)]">{isHi ? 'फॉक्सी लोड हो रहा है...' : 'Loading Foxy...'}</p></div>
    </div>
  );

  // ─── Header bag — passed into AppShell.header ─────────────────────────
  // The Foxy sticky chrome was four/five stacked rows (top header, subject
  // tab pills, chapter+mode toolbar, optional ConversationHeader, optional
  // lesson-step progress). Pre-AppShell they were sticky siblings inside
  // a flex-column body. With AppShell they become the single sticky header
  // slot — AppShell.header is itself position:sticky with backdrop-filter,
  // and each row keeps an opaque inline background so the AppShell scrim
  // never bleeds through. Behavior is verbatim: no copy, mode, or logic
  // changes.
  const foxyHeaderContent = (
    <>
      {/* ═══ HEADER ═══ */}
      {/* `sticky top-0` is dropped — AppShell.header is itself position:sticky. */}
      <div className="foxy-header-premium px-3 py-2.5 flex items-center gap-3" style={{ color: '#fff' }}>
        <button onClick={() => router.push('/dashboard')} className="text-white/60 text-sm p-2 rounded-lg" aria-label={isHi ? 'वापस जाएं' : 'Go back'}>←</button>
        {/* Mobile: open conversation history sidebar */}
        <button
          onClick={() => setConversationSidebarOpen(true)}
          className="lg:hidden w-10 h-10 rounded-lg flex items-center justify-center transition-all active:scale-95"
          style={{ background: 'rgba(255,255,255,0.1)' }}
          aria-label={isHi ? 'चैट हिस्ट्री' : 'Chat history'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <div className="foxy-avatar-warm w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0" style={{ animation: foxyState === 'thinking' ? 'pulse 1s infinite' : 'none' }}>
          {FOXY_FACES[foxyState]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate">Foxy <span className="text-[10px] font-semibold opacity-60">{isHi ? 'AI ट्यूटर' : 'AI Tutor'}</span></div>
          <div className="text-xs opacity-70 flex gap-2"><span className="hidden sm:inline">{totalXP + xpGained} XP</span><span className="hidden sm:inline">{isHi ? `${streakDays} दिन` : `${streakDays}d streak`}</span><span>{isHi ? `कक्षा ${studentGrade}` : `Gr ${studentGrade}`}</span></div>
        </div>
        <div className="flex items-center gap-1.5">
          {/* Language pills — extracted to ./_components/FoxySettings.tsx */}
          <LanguagePicker language={language} isLocked={isLangLocked} onLanguageChange={setLanguage} />
          {chatUsage && (
            <span
              className="hidden sm:inline text-[8px] opacity-40 ml-1"
              title={language === 'hi' ? 'बचे हुए संदेश' : 'Chat messages remaining'}
            >
              💬{isUnlimitedUsage(chatUsage.limit)
                ? (language === 'hi' ? 'असीमित' : 'Unlimited')
                : `${chatUsage.remaining}/${chatUsage.limit}`}
            </span>
          )}
          {/* Alfa OS — open the mobile ContextPanel bottom sheet. Mobile-only
              (lg:hidden), and rendered only when ff_student_os_v1 is ON so the
              OFF header is byte-identical. */}
          {osEnabled && (
            <button
              onClick={() => setContextSheetOpen(true)}
              className="lg:hidden w-10 h-10 rounded-lg flex items-center justify-center text-sm transition-all active:scale-90"
              style={{ background: 'rgba(255,255,255,0.08)', border: '1.5px solid rgba(255,255,255,0.1)' }}
              aria-label={isHi ? 'संदर्भ पैनल खोलें' : 'Open context panel'}
              title={isHi ? 'तुम्हारा संदर्भ' : 'Your context'}
            >
              🧭
            </button>
          )}
          {/* Voice mode toggle — hidden on browsers without TTS */}
          {ttsSupported && (
            <button
              onClick={toggleVoiceMode}
              title={language === 'hi'
                ? (voiceMode ? 'वॉइस मोड चालू — म्यूट करने के लिए क्लिक करें' : 'वॉइस मोड बंद — ऑटो-स्पीक चालू करने के लिए क्लिक करें')
                : (voiceMode ? 'Voice mode ON — click to mute' : 'Voice mode OFF — click to enable auto-speak')}
              aria-label={language === 'hi'
                ? (voiceMode ? 'वॉइस मोड बंद करें' : 'वॉइस मोड चालू करें')
                : (voiceMode ? 'Disable voice mode' : 'Enable voice mode')}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-sm transition-all active:scale-90"
              style={{
                background: voiceMode ? 'rgb(var(--accent-warm-rgb) / 0.25)' : 'rgba(255,255,255,0.08)',
                border: voiceMode ? '1.5px solid rgb(var(--accent-warm-rgb) / 0.5)' : '1.5px solid rgba(255,255,255,0.1)',
                animation: isSpeaking ? 'pulse 1s infinite' : 'none',
              }}
            >
              {voiceMode ? '🔊' : '🔇'}
            </button>
          )}
        </div>
      </div>

      {/* ═══ SUBJECT TAB BAR — horizontal scrollable pills ═══ */}
      <div
        className="foxy-subject-tabs flex items-center gap-1.5 px-3 py-2"
        style={{
          background: 'var(--surface-1)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {(() => {
          // Build the visible tab list.
          //  - If the student curated `selected_subjects`, honour that list.
          //  - Otherwise show the full stream lineup (locked + unlocked).
          //
          // Each entry resolves to a Subject (with isLocked) via the full
          // lookup so locked subjects stay visible — they render with a
          // lock badge and tapping them opens the upgrade modal instead
          // of switching subject (server would 422 anyway).
          const visible = (studentSubs.length > 0 ? studentSubs : allowedSubjects.map((s) => s.code))
            .map((code) => ALL_SUBJECTS_BY_CODE[code])
            .filter(Boolean);

          return visible.map((sub) => {
            const isActive = activeSubject === sub.code;
            const handleClick = () => {
              if (sub.isLocked) {
                setLockedTapped(sub);
                return;
              }
              if (sub.code !== activeSubject) {
                switchSubject(sub.code);
                setShowChapterDD(true);
              }
            };
            return (
              <button
                key={sub.code}
                onClick={handleClick}
                aria-label={sub.isLocked ? `${sub.name} (locked — tap to upgrade)` : sub.name}
                title={sub.isLocked ? (isHi ? 'अपग्रेड करें' : 'Upgrade to unlock') : sub.name}
                className={`foxy-pill shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold ${isActive ? 'foxy-pill-active' : ''}`}
                style={{
                  ['--pill-tint' as string]: sub.color,
                  background: isActive ? `color-mix(in srgb, ${sub.color} 16%, var(--surface-1))` : 'var(--surface-2)',
                  border: isActive ? `2px solid color-mix(in srgb, ${sub.color} 55%, transparent)` : '1.5px solid var(--border)',
                  color: isActive ? sub.color : 'var(--text-2)',
                  fontWeight: isActive ? 700 : 600,
                  opacity: sub.isLocked ? 0.55 : 1,
                }}
              >
                <span className="text-sm">{sub.icon}</span>
                {/* Show the full subject name — the tab bar is overflow-x-auto so
                    names scroll naturally. CSS truncation at max-w keeps very long
                    names tidy without the JS substring hack that made "Mathematics"
                    appear as "Mathema." */}
                <span className="whitespace-nowrap max-w-[96px] truncate">{sub.name}</span>
                {sub.isLocked && (
                  <span aria-hidden="true" className="text-[10px] leading-none">🔒</span>
                )}
              </button>
            );
          });
        })()}
      </div>

      {/* ═══ CHAPTER SELECTOR + MODE BAR ═══ */}
      <div className="foxy-toolbar" style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
        {/* Chapter dropdown */}
        <div className="relative">
          <button onClick={() => { setShowChapterDD(!showChapterDD); setShowSubjectDD(false); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97]" style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-2)' }}>
            <span className="text-sm">{cfg.icon}</span>
            <span>
              {activeTopic
                ? `${language === 'hi' ? 'अध्याय' : 'Ch'} ${activeTopic.chapter_number}: ${activeTopic.title?.length > 15 ? activeTopic.title.substring(0, 14) + '...' : activeTopic.title}`
                : selectedChapters.length > 0
                  ? `${selectedChapters.length} ${language === 'hi' ? 'अध्याय' : 'Ch'}`
                  : (language === 'hi' ? 'अध्याय चुनो' : 'Select Chapter')}
            </span>
            <span className="text-[10px] ml-0.5 opacity-60">{showChapterDD ? '▲' : '▼'}</span>
          </button>
          {showChapterDD && (
            <div className="absolute top-full left-0 mt-1 z-50 w-[calc(100vw-24px)] sm:w-72 max-h-[50vh] rounded-2xl overflow-hidden shadow-lg flex flex-col" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <div className="p-2 px-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">{cfg.icon} {cfg.name} {language === 'hi' ? 'अध्याय' : 'Chapters'}</span>
                {(selectedChapters.length > 0 || activeTopic) && (
                  <button onClick={() => { setSelectedChapters([]); setActiveTopic(null); }} className="text-[10px] font-semibold" style={{ color: 'var(--orange)' }}>{language === 'hi' ? 'सब हटाओ' : 'Clear All'}</button>
                )}
              </div>
              <div className="flex-1 overflow-y-auto">
                {topics.map((topic: any) => {
                  const sel = selectedChapters.includes(topic.id) || activeTopic?.id === topic.id;
                  const mastery = masteryData.find((m: any) => m.topic_tag === topic.title || m.chapter_number === topic.chapter_number);
                  const lvl = mastery?.mastery_level || 'not_started';
                  const lc = MASTERY_COLORS[lvl] || MASTERY_COLORS.not_started;
                  return (
                    <button
                      key={topic.id}
                      onClick={() => {
                        // RCA-FIX CRITICAL-UX-3: Confirm before clearing active conversation
                        if (messages.length > 0) {
                          // TODO(ux-debt): Replace window.confirm with native Dialog component for
                          // mobile-friendly confirmation (back gesture dismissal). Tracked by quality review 2026-06-26.
                          const confirmed = window.confirm(
                            isHi
                              ? 'नया chapter शुरू करने से यह conversation साफ हो जाएगी। क्या आप sure हैं?'
                              : 'Switching chapter will clear your current conversation. Continue?'
                          );
                          if (!confirmed) return;
                        }
                        setActiveTopic(topic);
                        setSelectedChapters([topic.id]);
                        setMessages([]);
                        setChatSessionId(null);
                        setCollapsedAbove(null);
                        setShowChapterDD(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-all"
                      style={{ background: sel ? `${cfg.color}06` : 'transparent', borderBottom: '1px solid var(--border)' }}
                    >
                      <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[10px]" style={{ background: sel ? cfg.color : 'var(--surface-2)', color: sel ? '#fff' : 'var(--text-3)', border: sel ? 'none' : '1.5px solid var(--border)' }}>{sel ? '✓' : ''}</div>
                      <div className="flex-1 min-w-0"><div className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>{language === 'hi' ? 'अध्याय' : 'Ch'} {topic.chapter_number}: {topic.title}</div></div>
                      <span className="text-[9px] font-bold capitalize px-1.5 py-0.5 rounded" style={{ background: `${lc}15`, color: lc }}>{lvl.replace('_', ' ')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Simplified mode pills — extracted to ./_components/FoxySettings.tsx */}
        <ModePicker sessionMode={sessionMode} color={cfg.color} isHi={isHi} onSwitchMode={switchMode} />
      </div>

      {/* ═══ CONTEXT BAR — shows active conversation header ═══ */}
      {messages.length > 0 && (
        <ConversationHeader
          title={generateTitle(messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })), activeSubject)}
          subject={activeSubject}
          mode={sessionMode}
          messageCount={messages.length}
          isHi={isHi}
          onNewChat={handleNewConversation}
          onOpenSidebar={() => setConversationSidebarOpen(true)}
          topicTitle={activeTopic?.title}
          chapterNumber={activeTopic?.chapter_number}
        />
      )}

      {/* ═══ LESSON STEP PROGRESS BAR ═══ */}
      {sessionMode === 'lesson' && (
        <div className="px-3 py-2" style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-1 mb-1.5">
            {LESSON_STEPS.map((step, idx) => {
              const isCompleted = lessonStepsCompleted.includes(step);
              const isCurrent = step === lessonStep;
              const stepLabels: Record<string, string> = language === 'hi'
                ? {
                    hook: '🪝 शुरुआत', visualization: '👁 दृश्य', guided_examples: '📝 उदाहरण',
                    active_recall: '🧠 याद', application: '🔧 प्रयोग', spaced_revision: '🔄 रिवीज़न',
                  }
                : {
                    hook: '🪝 Hook', visualization: '👁 Visual', guided_examples: '📝 Examples',
                    active_recall: '🧠 Recall', application: '🔧 Apply', spaced_revision: '🔄 Revise',
                  };
              return (
                <div key={step} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="foxy-step-seg w-full h-1.5 rounded-full" style={{
                    background: isCompleted ? cfg.color : isCurrent ? `color-mix(in srgb, ${cfg.color} 55%, transparent)` : 'var(--surface-2)',
                    boxShadow: isCurrent ? `0 0 8px color-mix(in srgb, ${cfg.color} 45%, transparent)` : 'none',
                  }} />
                  <span className="text-[8px] font-bold truncate" style={{
                    color: isCompleted ? cfg.color : isCurrent ? cfg.color : 'var(--text-3)',
                  }}>{stepLabels[step] || step}</span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>
              {language === 'hi' ? 'पाठ प्रगति' : 'Lesson Progress'}: {lessonStepsCompleted.length + 1}/{LESSON_STEPS.length}
            </span>
            {!loading && messages.length > 0 && (
              <button
                onClick={advanceLessonStep}
                className="px-3 py-1 rounded-lg text-[10px] font-bold transition-all active:scale-95"
                style={{ background: `color-mix(in srgb, ${cfg.color} 14%, transparent)`, color: cfg.color, border: `1px solid color-mix(in srgb, ${cfg.color} 30%, transparent)` }}
              >
                {lessonStep === 'spaced_revision'
                  ? (language === 'hi' ? '✓ पूरा हुआ' : '✓ Complete')
                  : (language === 'hi' ? 'अगला चरण →' : 'Next Step →')}
              </button>
            )}
          </div>
          {/* Predict-before-reveal for active recall step */}
          {showPredictionInput && !predictionSubmitted && (
            <div className="mt-2 p-3 rounded-xl" style={{ background: `color-mix(in srgb, ${cfg.color} 6%, var(--surface-1))`, border: `1px solid color-mix(in srgb, ${cfg.color} 22%, transparent)` }}>
              <p className="text-xs font-semibold mb-1.5" style={{ color: cfg.color }}>
                🧠 {language === 'hi' ? 'पहले अपना अनुमान लिखो:' : 'Write your prediction first:'}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={lessonPrediction}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLessonPrediction(e.target.value)}
                  placeholder={language === 'hi' ? 'तुम्हारा अनुमान...' : 'Your prediction...'}
                  className="flex-1 text-sm rounded-lg px-3 py-2 outline-none"
                  style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
                />
                <button
                  onClick={() => {
                    if (lessonPrediction.trim()) {
                      setPredictionSubmitted(true);
                      sendMessage(`My prediction: ${lessonPrediction.trim()}`);
                      setLessonPrediction('');
                    }
                  }}
                  disabled={!lessonPrediction.trim()}
                  className="px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                  style={{ background: cfg.color }}
                >
                  {language === 'hi' ? 'भेजो' : 'Submit'}
                </button>
              </div>
            </div>
          )}
          {showPredictionInput && predictionSubmitted && (
            <div className="mt-2 text-[10px] font-semibold" style={{ color: 'var(--green)' }}>
              ✓ {language === 'hi' ? 'अनुमान जमा हो गया! Foxy का जवाब देखो।' : 'Prediction submitted! See Foxy\'s answer below.'}
            </div>
          )}
        </div>
      )}
    </>
  );

  // ─── Foxy OS mobile header (ff_foxy_os_v1, <lg only) ──────────────────
  // Replaces the 5-row legacy header with a single compact bar + Study sheet.
  // Built entirely from existing state/handlers — no logic is duplicated.
  // Rendered ONLY when `useFoxyOsHeader` (flag ON && <lg); the OFF path and
  // every >=lg viewport keep `foxyHeaderContent` byte-identical.
  const foxyOsChapterLabel = activeTopic
    ? `${language === 'hi' ? 'अध्याय' : 'Ch'} ${activeTopic.chapter_number}: ${activeTopic.title?.length > 18 ? activeTopic.title.substring(0, 17) + '…' : activeTopic.title}`
    : null;

  const foxyOsSubjects = (studentSubs.length > 0 ? studentSubs : allowedSubjects.map((s) => s.code))
    .map((code) => ALL_SUBJECTS_BY_CODE[code])
    .filter(Boolean)
    .map((sub) => ({ code: sub.code, name: sub.name, icon: sub.icon, color: sub.color, isLocked: sub.isLocked }));

  const foxyOsTopics = topics.map((topic: any) => {
    const mastery = masteryData.find((m: any) => m.topic_tag === topic.title || m.chapter_number === topic.chapter_number);
    const lvl = mastery?.mastery_level || 'not_started';
    return {
      id: topic.id,
      title: topic.title,
      chapter_number: topic.chapter_number,
      masteryPercent: mastery?.mastery_percent ?? 0,
      masteryColor: MASTERY_COLORS[lvl] || MASTERY_COLORS.not_started,
    };
  });

  const foxyOsHeaderContent = (
    <FoxyTopBar
      isHi={isHi}
      foxyFace={FOXY_FACES[foxyState]}
      thinking={foxyState === 'thinking'}
      subjectName={cfg.name}
      subjectColor={cfg.color}
      subjectIcon={cfg.icon}
      chapterLabel={foxyOsChapterLabel}
      onBack={() => router.push('/dashboard')}
      onOpenStudy={() => setStudySheetOpen(true)}
      onOpenTools={() => setToolsSheetOpen(true)}
    />
  );

  // ─── Main content — chat + ChatInput + modals ─────────────────────────
  // The chat column needs `h-full flex flex-col min-h-0` so the scroll
  // area can flex within AppShell's content grid row (which is `1fr`
  // inside `grid-template-rows: auto 1fr auto`). The legacy `pb-32` chat
  // clearance is dropped — AppShell.content already pads --shell-nav-h +
  // safe-area-inset on the bottom. AppShell is rendered with `bleed` so
  // the content column has no side padding, no rail-column reservation,
  // and no 1240px max-width cap at desktop — Foxy's three internal
  // columns (ConversationManager + topic sidebar + chat) need the full
  // viewport width like before PR #870. The wrapper still nulls the
  // top fluid gutter so the inline subject toolbar sits flush under the
  // sticky header; bottom padding is preserved by AppShell so BottomNav
  // (fixed at bottom:0) never overlaps the ChatInput composer.
  const foxyMainContent = (
    <div
      className="h-full flex flex-col min-h-0"
      style={{
        // Null AppShell.content's default top fluid gutter so the inline
        // subject toolbar sits flush under the sticky header. Side gutters
        // are already zero via `bleed` — see globals.css data-bleed rules.
        // Bottom is intentionally NOT negated — AppShell's bottom padding
        // reserves clearance for the fixed BottomNav so the ChatInput
        // composer renders directly above it without overlap.
        marginTop: 'calc(var(--space-fluid-4) * -1)',
        background: 'var(--surface-2)',
      }}
    >

      {/* Upgrade modal — surfaces when a student taps a locked subject tab.
          Server still 422s on writes for locked subjects, this just makes
          the gate friendlier and points at /pricing. */}
      {lockedTapped && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="upgrade-modal-title"
          className="fixed inset-0 z-[95] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setLockedTapped(null); }}
        >
          <div
            className="w-full max-w-sm rounded-3xl p-6 shadow-2xl"
            style={{ background: 'var(--warm-cream, #FFF9F0)', border: '1px solid var(--border)' }}
          >
            <div className="text-center mb-4">
              <div className="text-4xl mb-2" aria-hidden="true">{lockedTapped.icon}</div>
              <h2 id="upgrade-modal-title" className="font-bold text-xl" style={{ color: 'var(--text-1)' }}>
                {isHi
                  ? `${lockedTapped.nameHi} अनलॉक करें`
                  : `Unlock ${lockedTapped.name}`}
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-2)' }}>
                {isHi
                  ? `${lockedTapped.nameHi} एक पेड प्लान में उपलब्ध है। अभी मुफ्त प्लान में मैथ्स, अंग्रेज़ी और हिंदी मिलते हैं।`
                  : `${lockedTapped.name} is part of our paid plans. Your free plan includes Math, English and Hindi.`}
              </p>
            </div>
            <div className="flex flex-col gap-2 mt-5">
              <button
                onClick={() => {
                  setLockedTapped(null);
                  router.push('/pricing');
                }}
                className="w-full px-4 py-3 rounded-2xl font-bold text-sm text-white"
                style={{ background: lockedTapped.color }}
              >
                {isHi ? 'प्लान देखें' : 'View plans'}
              </button>
              <button
                onClick={() => setLockedTapped(null)}
                className="w-full px-4 py-2 rounded-2xl font-semibold text-xs"
                style={{ background: 'transparent', color: 'var(--text-3)' }}
              >
                {isHi ? 'बाद में' : 'Maybe later'}
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Close-dropdowns scrim: clicking anywhere outside the open
          chapter/subject dropdown closes it. Lives in children (not the
          header bag) because it is a full-viewport fixed overlay. */}
      {(showSubjectDD || showChapterDD) && <div className="fixed inset-0 z-40" onClick={() => { setShowSubjectDD(false); setShowChapterDD(false); }} />}

      {/* ═══ MAIN CHAT AREA ═══ */}
      <SectionErrorBoundary section="Foxy Chat">
      <div className="flex-1 flex overflow-hidden relative">
        {/* Conversation Manager Sidebar — desktop: always visible, mobile: slide-over */}
        <ConversationManager
          conversations={conversations.map((c: ConversationSummary) => ({ ...c, isActive: c.id === chatSessionId }))}
          activeConversationId={chatSessionId}
          isHi={isHi}
          isOpen={conversationSidebarOpen}
          onSelect={selectConversation}
          onNewChat={handleNewConversation}
          onClose={() => setConversationSidebarOpen(false)}
          isLoading={conversationsLoading}
        />

        {/* Desktop topic sidebar — chapters/mastery */}
        <div className="hidden xl:flex shrink-0 relative" style={{ width: sidebarOpen ? 240 : 0, transition: 'width 0.3s ease' }}>
          <div className="flex flex-col overflow-hidden border-r" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', width: 240, position: 'absolute', top: 0, bottom: 0, left: 0, transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform 0.3s ease' }}>
            <div className="p-3 text-xs font-bold flex items-center justify-between" style={{ color: cfg.color, borderBottom: '1px solid var(--border)' }}>
              <span>{cfg.icon} {language === 'hi' ? 'अध्याय' : 'Chapters'} ({topics.length})</span>
              <button onClick={() => setSidebarOpen(false)} className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] transition-all hover:opacity-70" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }} title={language === 'hi' ? 'बंद करो' : 'Collapse'}>×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {topics.map((topic: any) => {
                const mastery = masteryData.find((m: any) => m.topic_tag === topic.title || m.chapter_number === topic.chapter_number);
                const pct = mastery?.mastery_percent || 0;
                const lvl = mastery?.mastery_level || 'not_started';
                const lc = MASTERY_COLORS[lvl] || MASTERY_COLORS.not_started;
                return (
                  <button key={topic.id} onClick={() => {
                    // RCA-FIX CRITICAL-UX-3: Confirm before clearing active conversation
                    if (messages.length > 0) {
                      // TODO(ux-debt): Replace window.confirm with native Dialog component for
                      // mobile-friendly confirmation (back gesture dismissal). Tracked by quality review 2026-06-26.
                      const confirmed = window.confirm(
                        isHi
                          ? 'नया chapter शुरू करने से यह conversation साफ हो जाएगी। क्या आप sure हैं?'
                          : 'Switching chapter will clear your current conversation. Continue?'
                      );
                      if (!confirmed) return;
                    }
                    setActiveTopic(topic); setMessages([]); setChatSessionId(null); setCollapsedAbove(null); setTimeout(() => sendMessage(language === 'hi' ? `मुझे सिखाओ: ${topic.title} (अध्याय ${topic.chapter_number})` : `Teach me about: ${topic.title} (Chapter ${topic.chapter_number})`), 50);
                  }} className="w-full text-left p-2.5 rounded-xl transition-all active:scale-[0.98]" style={{ border: `1px solid ${lc}25`, background: activeTopic?.id === topic.id ? `${lc}10` : 'var(--surface-1)' }}>
                    <div className="text-[11px] font-bold truncate" style={{ color: 'var(--text-1)' }}>{language === 'hi' ? 'अध्याय' : 'Ch'} {topic.chapter_number}: {topic.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-14 h-1.5 rounded-full" style={{ background: 'var(--surface-2)' }}><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: lc }} /></div>
                      <span className="text-[9px] font-bold capitalize" style={{ color: lc }}>{lvl.replace('_', ' ')}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {!sidebarOpen && <button onClick={() => setSidebarOpen(true)} className="hidden xl:flex shrink-0 w-8 items-center justify-center border-r cursor-pointer transition-all hover:bg-[var(--surface-2)]" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }} title={language === 'hi' ? 'अध्याय दिखाओ' : 'Show chapters'}><span className="text-[10px]" style={{ color: 'var(--text-3)' }}>»</span></button>}

        {/* Chat column — `foxy-chat-column` is an inert CSS hook (no rule
            targets it outside `.foxy-os`); under `.foxy-os` it gets
            `min-height:0` so the scroll area shrinks when the keyboard opens
            and the composer stays visible (Phase 2). */}
        <div className="foxy-chat-column flex-1 flex flex-col min-w-0">
          {/* `pb-32` removed — AppShell.app-shell-content already reserves
              --shell-nav-h + safe-area-inset bottom space for the fixed
              BottomNav. Adding pb-32 here would overpad the scroll area
              and leave an awkward gap above the ChatInput. */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-3 md:px-5 py-4"
            // Promote the chat scroll region to its own compositing layer as
            // defense-in-depth against residual scroll flicker on Chromium.
            style={{ transform: 'translateZ(0)' }}
            // Phase 3 a11y (flag-ON mobile only) — announce settled AI turns to
            // screen readers. `aria-busy` is raised while a reply is streaming
            // so the SR waits for the turn to settle instead of being spammed
            // token-by-token; it drops to false when streaming ends and the
            // newly-added (aria-relevant="additions") message is announced.
            // ONLY the container ARIA changes — the REG-55 structured-render
            // DOM/markup inside MessageList is untouched. Gated by
            // useFoxyOsHeader so the OFF path / desktop are byte-identical.
            {...(useFoxyOsHeader
              ? {
                  role: 'log' as const,
                  'aria-live': 'polite' as const,
                  'aria-relevant': 'additions' as const,
                  'aria-busy': loading,
                  'aria-label': isHi ? 'Foxy के साथ बातचीत' : 'Conversation with Foxy',
                }
              : {})}
          >
            {/* SEL mood check-in — shown once per day at session start */}
            {showSELCheckIn && student && (
              <div className="mb-4 animate-slide-up">
                <SELCheckIn
                  isHi={isHi}
                  studentId={student.id}
                  onMoodSelected={handleMoodSelected}
                  onSkip={handleSELSkip}
                />
              </div>
            )}

            {/* Inline simulation — shows when active topic matches a simulation */}
            {activeTopic && (() => {
              const sim = findSimulation(activeTopic.title || '');
              return sim ? (
                <InlineSimulation
                  simulationId={sim.id}
                  title={sim.title}
                  emoji={sim.emoji}
                  tip={sim.tip}
                  color={cfg.color}
                />
              ) : null;
            })()}

            {/* Empty state with ConversationStarters */}
            {messages.length === 0 && (
              <div className="text-center py-12 md:py-20 animate-slide-up">
                <div className="foxy-hero-mascot text-6xl md:text-7xl mb-4">{FOXY_FACES.idle}</div>
                <h2 className="text-2xl md:text-2xl font-extrabold mb-2" style={{ fontFamily: 'var(--font-display)', background: `linear-gradient(135deg, var(--accent-warm), ${cfg?.color || 'var(--purple)'})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', color: 'var(--accent-warm)' }}>{getEmptyStateHeading()}</h2>
                <p className="text-sm text-[var(--text-3)] max-w-sm mx-auto mb-4 leading-relaxed">
                  {getEmptyStateSubtitle()}
                </p>

                {/* Chapter selection nudge when no topic selected */}
                {!activeTopic && !urlContext && (
                  <button
                    onClick={() => setShowChapterDD(true)}
                    className="mb-6 px-5 py-3 rounded-2xl text-sm font-bold transition-all active:scale-[0.97]"
                    style={{
                      background: `color-mix(in srgb, ${cfg.color} 12%, var(--surface-1))`,
                      color: cfg.color,
                      border: `1.5px solid color-mix(in srgb, ${cfg.color} 30%, transparent)`,
                    }}
                  >
                    {cfg.icon} {language === 'hi' ? '\u0905\u0927\u094D\u092F\u093E\u092F \u091A\u0941\u0928\u094B' : 'Select a Chapter to Start'}
                  </button>
                )}

                {/* Context banner — shown when arriving from /learn, /quiz, or
                    knowledge gap (NOT dashboard — dashboard entry uses the
                    Phase 1.2 friendly greeting above, no Start-button banner). */}
                {urlContext && !isDashboardEntry && (
                  <div className="mx-auto max-w-sm mb-6 p-4 rounded-2xl text-left" style={{ background: `color-mix(in srgb, ${cfg.color} 10%, var(--surface-1))`, border: `1.5px solid color-mix(in srgb, ${cfg.color} 30%, transparent)` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: cfg.color }}>
                      {language === 'hi' ? '📍 इस विषय से शुरू करो' : '📍 Continuing from'}
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">{cfg.icon}</span>
                      <div>
                        <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                          {cfg.name}
                          {urlContext.topic && <span className="font-normal text-[var(--text-3)]"> · {language === 'hi' ? 'अध्याय' : 'Ch'} {urlContext.topic}</span>}
                        </div>
                        {urlContext.mode && (
                          <div className="text-[11px]" style={{ color: cfg.color }}>
                            {MODES.find(m => m.id === urlContext.mode)?.emoji}{' '}
                            {language === 'hi'
                              ? MODES.find(m => m.id === urlContext.mode)?.labelHi
                              : MODES.find(m => m.id === urlContext.mode)?.label}
                            {language === 'hi' ? ' मोड' : ' mode'}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => {
                          const modeId = urlContext.mode || 'learn';
                          const mode = MODES.find(m => m.id === modeId) || MODES[0];
                          const topicName = activeTopic?.title || '';
                          const prompt = language === 'hi' ? mode.autoPromptHi(topicName) : mode.autoPrompt(topicName);
                          if (prompt) sendMessage(prompt);
                          else sendMessage(language === 'hi' ? `${cfg.name} के बारे में मुझे सिखाओ` : `Teach me about ${cfg.name}`);
                        }}
                        className="px-4 py-2 rounded-xl text-xs font-bold text-white transition-all active:scale-95"
                        style={{ background: cfg.color }}
                      >
                        {MODES.find(m => m.id === (urlContext.mode || 'learn'))?.emoji}{' '}
                        {language === 'hi' ? 'शुरू करो' : 'Start'}
                      </button>
                      <button
                        onClick={() => setUrlContext(null)}
                        className="px-4 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
                      >
                        {language === 'hi' ? 'बदलो' : 'Change'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Smart conversation starters */}
                <ConversationStarters
                  subject={activeSubject}
                  language={language}
                  topicTitle={activeTopic?.title}
                  hasLastTopic={!!activeTopic || messages.length > 0}
                  onSelect={handleStarterClick}
                />

                {activeTopic && (
                  <button onClick={() => setShowChapterDD(true)} className="mt-6 px-5 py-2.5 rounded-xl text-sm font-bold" style={{ background: `color-mix(in srgb, ${cfg.color} 10%, var(--surface-1))`, color: cfg.color, border: `1.5px solid color-mix(in srgb, ${cfg.color} 30%, transparent)` }}>
                    {cfg.icon} {language === 'hi' ? `\u0905\u0928\u094D\u092F ${topics.length} \u0905\u0927\u094D\u092F\u093E\u092F \u0926\u0947\u0916\u094B` : `Browse ${topics.length} Chapters`}
                  </button>
                )}
              </div>
            )}

            {/* Messages — with collapsing, dedup, structured-vs-legacy renderer choice,
                Save-to-flashcard button. All extracted to ./_components/MessageList.tsx. */}
            <MessageList
              messages={messages}
              collapsedAbove={collapsedAbove}
              onSetCollapsedAbove={setCollapsedAbove}
              activeSubject={activeSubject}
              cfgColor={cfg.color}
              studentName={student?.name}
              isHi={isHi}
              ttsSupported={ttsSupported}
              savedMessageIds={savedMessageIds}
              onFeedback={handleFeedback}
              onReport={openReport}
              onSaveFlashcard={saveToFlashcard}
              onSpeak={ttsSupported ? speakMessage : undefined}
              learningActionsEnabled={learningActionsEnabled}
              onLearningAction={handleLearningAction}
              gotItMessageIds={gotItMessageIds}
              onSubmitQuizAnswer={submitQuizAnswer}
            />

            {/* Report-error modal — extracted to ./_components/ReportDialog.tsx */}
            <ReportDialog
              open={!!reportModal}
              foxyMsg={reportModal?.foxyMsg ?? ''}
              reason={reportReason}
              correction={reportCorrection}
              submitting={reportSubmitting}
              success={reportSuccess}
              isHi={isHi}
              onReasonChange={setReportReason}
              onCorrectionChange={setReportCorrection}
              onSubmit={submitReport}
              onClose={() => setReportModal(null)}
            />

            {/* Thinking — honest elapsed timer, no fake stages */}
            {loading && (
              <LoadingState
                primaryLabel={
                  isProcessingImage
                    ? (language === 'hi' ? '📷 फ़ोटो पढ़ रहे हैं' : '📷 Reading your handwriting')
                    : undefined
                }
              />
            )}
            <div ref={endRef} />
          </div>

          {/* Compact starter chips — always visible after conversation starts so
              students retain prompt guidance after the empty state disappears.
              Uses compact=true: 3 chips only, no "More" toggle, smaller styling. */}
          {messages.length > 0 && (
            <div className="px-4 py-2 flex gap-2 flex-wrap border-t" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
              <ConversationStarters
                subject={activeSubject}
                language={language}
                topicTitle={activeTopic?.title}
                hasLastTopic={true}
                onSelect={handleStarterClick}
                compact={true}
              />
            </div>
          )}

          {/* Composer + long-conversation nudge — extracted to ./_components/MessageInput.tsx */}
          <MessageInput
            messages={messages}
            language={language}
            isHi={isHi}
            loading={loading}
            voiceMode={voiceMode}
            activeSubject={activeSubject}
            onSend={sendMessage}
            onNewConversation={handleNewConversation}
            onDetectedLanguage={(detected) => {
              // Voice 3: adapt Foxy's spoken reply to the language the student
              // actually spoke. Helper guards against 'unknown' so we never feed
              // an unsynthesizable language to the Azure TTS endpoint.
              voiceLangRef.current = adoptVoiceReplyLanguage(detected, voiceLangRef.current);
            }}
          />
        </div>

        {/* Alfa OS — third pane (ContextPanel). Desktop: a right rail flanking
            the chat column. Mobile: a bottom sheet (controlled by
            contextSheetOpen). Rendered ONLY when ff_student_os_v1 is ON, so the
            OFF layout is byte-identical. The chat column above is untouched. */}
        {osEnabled && (
          <ContextPanel
            isHi={isHi}
            studentId={student?.id}
            activeSubjectName={cfg.name}
            activeSubjectIcon={cfg.icon}
            activeSubject={activeSubject}
            onSuggest={applyMasterySuggestion}
            sheetOpen={contextSheetOpen}
            onSheetClose={() => setContextSheetOpen(false)}
          />
        )}
      </div>

      {/* Mobile topics sheet */}
      {showTopicSheet && (
        <>
          <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={() => setShowTopicSheet(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl max-h-[75vh] flex flex-col lg:hidden" style={{ background: 'var(--surface-1)', boxShadow: '0 -8px 40px rgba(0,0,0,0.1)' }}>
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} /></div>
            <div className="px-4 pb-2 flex items-center justify-between">
              <span className="text-sm font-bold" style={{ color: cfg.color }}>{cfg.icon} {cfg.name} · {language === 'hi' ? `कक्षा ${studentGrade}` : `Gr ${studentGrade}`}</span>
              <button onClick={() => setShowTopicSheet(false)} className="text-xs text-[var(--text-3)] font-semibold">{language === 'hi' ? 'बंद करो' : 'Close'}</button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
              {topics.map((topic: any) => {
                const mastery = masteryData.find((m: any) => m.topic_tag === topic.title || m.chapter_number === topic.chapter_number);
                const pct = mastery?.mastery_percent || 0;
                const lvl = mastery?.mastery_level || 'not_started';
                const lc = MASTERY_COLORS[lvl] || MASTERY_COLORS.not_started;
                return (
                  <button key={topic.id} onClick={() => { setActiveTopic(topic); setShowTopicSheet(false); sendMessage(language === 'hi' ? `मुझे सिखाओ: ${topic.title} (अध्याय ${topic.chapter_number})` : `Teach me about: ${topic.title} (Chapter ${topic.chapter_number})`); }} className="w-full text-left p-3.5 rounded-xl flex items-center gap-3 active:scale-[0.98] transition-all" style={{ background: 'var(--surface-2)', border: `1px solid ${lc}20` }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: `${lc}15` }}>{cfg.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>{language === 'hi' ? 'अध्याय' : 'Ch'} {topic.chapter_number}: {topic.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full" style={{ background: 'var(--border)' }}><div className="h-full rounded-full" style={{ width: `${pct}%`, background: lc }} /></div>
                        <span className="text-[10px] font-bold capitalize shrink-0" style={{ color: lc }}>{pct}%</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}


      {/* ═══ FOXY OS — Study bottom sheet (ff_foxy_os_v1, <lg only) ═══ */}
      {/* Rendered ONLY when the flag is ON and viewport is <lg, so the OFF
          path / >=lg are byte-identical. All actions call existing handlers. */}
      {useFoxyOsHeader && (
        <FoxyStudySheet
          open={studySheetOpen}
          onClose={() => setStudySheetOpen(false)}
          isHi={isHi}
          subjects={foxyOsSubjects}
          activeSubjectCode={activeSubject}
          onSelectSubject={(code) => { switchSubject(code); setStudySheetOpen(false); }}
          onLockedSubject={(code) => {
            const sub = ALL_SUBJECTS_BY_CODE[code];
            if (sub) setLockedTapped(sub);
            setStudySheetOpen(false);
          }}
          topics={foxyOsTopics}
          activeTopicId={activeTopic?.id ?? null}
          onSelectTopic={(topicId) => {
            const topic = topics.find((t: any) => t.id === topicId);
            if (topic) {
              setActiveTopic(topic);
              setSelectedChapters([topic.id]);
              setMessages([]);
              setChatSessionId(null);
              setCollapsedAbove(null);
            }
            setStudySheetOpen(false);
          }}
          modes={SIMPLIFIED_MODES.map((m) => ({ id: m.id, label: m.label, labelHi: m.labelHi, icon: m.icon }))}
          sessionMode={sessionMode}
          resolveBackendMode={(id) => MODE_MAP[id] || id}
          subjectColor={cfg.color}
          onSelectMode={(id) => { switchMode(id); setStudySheetOpen(false); }}
          onStartQuiz={() => {
            // Preserve P4 quiz routing — route to /quiz with the active topic.
            if (activeTopic?.id) {
              router.push(`/quiz?topic=${activeTopic.id}&source=foxy`);
            } else {
              sendMessage(
                isHi
                  ? 'क्विज़ शुरू करने से पहले एक अध्याय चुनें।'
                  : 'Pick a chapter first, then I can quiz you on it.',
              );
            }
            setStudySheetOpen(false);
          }}
          lesson={
            sessionMode === 'lesson'
              ? {
                  stepLabels: LESSON_STEPS.map((step) => {
                    const stepLabels: Record<string, string> = language === 'hi'
                      ? { hook: 'शुरुआत', visualization: 'दृश्य', guided_examples: 'उदाहरण', active_recall: 'याद', application: 'प्रयोग', spaced_revision: 'रिवीज़न' }
                      : { hook: 'Hook', visualization: 'Visual', guided_examples: 'Examples', active_recall: 'Recall', application: 'Apply', spaced_revision: 'Revise' };
                    return stepLabels[step] || step;
                  }),
                  currentIndex: Math.max(0, LESSON_STEPS.indexOf(lessonStep)),
                  canAdvance: !loading && messages.length > 0,
                  isFinalStep: lessonStep === 'spaced_revision',
                  onNext: () => { advanceLessonStep(); },
                }
              : null
          }
        />
      )}

      {/* ═══ FOXY OS — Tools bottom sheet (ff_foxy_os_v1, <lg only) ═══ */}
      {/* Phase 3. Rendered ONLY when the flag is ON and viewport is <lg, so the
          OFF path / >=lg are byte-identical. Every action calls an EXISTING
          page handler — no logic moves in. The "Your context" entry is only
          wired when ff_student_os_v1 (osEnabled) is ON, because that is the
          only flag that mounts the ContextPanel surface; otherwise it is
          omitted (the sheet never invents a context surface). */}
      {useFoxyOsHeader && (
        <FoxyToolsSheet
          open={toolsSheetOpen}
          onClose={() => setToolsSheetOpen(false)}
          isHi={isHi}
          languages={LANGS}
          activeLanguage={language}
          languageLocked={isLangLocked}
          onSelectLanguage={(code) => setLanguage(code)}
          voiceSupported={ttsSupported}
          voiceOn={voiceMode}
          onToggleVoice={toggleVoiceMode}
          xpTotal={totalXP + xpGained}
          streakDays={streakDays}
          studentGrade={studentGrade}
          usageRemaining={chatUsage?.remaining ?? null}
          usageLimit={chatUsage?.limit ?? null}
          usageUnlimited={isUnlimitedUsage(chatUsage?.limit)}
          onOpenHistory={() => {
            setToolsSheetOpen(false);
            setConversationSidebarOpen(true);
          }}
          onOpenContext={
            osEnabled
              ? () => {
                  setToolsSheetOpen(false);
                  setContextSheetOpen(true);
                }
              : undefined
          }
        />
      )}

      {/* ═══ UPGRADE MODAL (replaces old limit modal) ═══ */}
      <UpgradeModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        feature="chat"
        currentLimit={chatUsage?.limit || 5}
        onUpgradeSuccess={() => {
          // Clear usage cache so new plan limits take effect immediately
          clearUsageCache();
          if (student?.id) {
            checkDailyUsage(student.id, 'foxy_chat', student.subscription_plan || 'free').then(setChatUsage);
          }
        }}
      />
      </SectionErrorBoundary>
    </div>
  );

  return (
    <AppShell
      contentAs={experienceV3 ? 'div' : 'main'}
      className={`foxy-shell${useFoxyOsHeader ? ' foxy-os' : ''}`}
      variant="mobile"
      header={useFoxyOsHeader ? foxyOsHeaderContent : foxyHeaderContent}
      
      // One-handed mode toggle stays off on Foxy — the chat composer needs
      // the full viewport vertical reach, and pulling content down would
      // hide message context above the input on small phones. AppShell's
      // toggle is the default-on affordance for editorial surfaces (dashboard,
      // learn) where the toggle is helpful.
      oneHandToggle={false}
      // Full-bleed: Foxy's internal layout has its own three-column structure
      // (ConversationManager sidebar at lg+, desktop topic sidebar at xl+,
      // chat column). AppShell's tablet-width rail-column reservation and
      // 1024px content cap would clip the leftmost sidebar off-screen and
      // squeeze the chat. `bleed` drops both so Foxy paints edge-to-edge
      // like before the AppShell migration (PR #870).
      bleed
    >
      {foxyMainContent}
    </AppShell>
  );
}

export default function FoxyPage() {
  return <StudentV3Gate legacy={<FoxyExperience />} v3={<FoxyExperience />} withShell />;
}
