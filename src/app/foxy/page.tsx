'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/constants';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { BottomNav } from '@/components/ui';
import { LESSON_STEPS, getLessonStepPrompt, getNextLessonStep, type LessonStep, type LessonState } from '@/lib/cognitive-engine';
import { checkDailyUsage, clearUsageCache, type UsageResult } from '@/lib/usage';
import { speak, isVoiceSupported } from '@/lib/voice';
import { ConversationStarters } from '@/components/foxy/ConversationStarters';
import { findSimulation, InlineSimulation } from '@/components/InlineSimulation';
import { ChatBubble, type GroundingStatus, type AbstainReason, type SuggestedAlternative } from '@/components/foxy/ChatBubble';
import { LoadingState } from '@/components/foxy/LoadingState';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { ChatInput } from '@/components/foxy/ChatInput';
import { ConversationManager, generateTitle, SIMPLIFIED_MODES, MODE_MAP, type ConversationSummary } from '@/components/foxy/ConversationManager';
import { ConversationHeader } from '@/components/foxy/ConversationHeader';
import { useSELCheckIn, type MoodState } from '@/components/SELCheckIn';
import { track } from '@/lib/analytics';

// P10 bundle hardening: lazy-load components rendered behind a flag/modal/conditional.
// Cuts /foxy First Load JS by ~70 kB on cold paint. Type/hook imports remain static
// (Next/dynamic only defers the runtime component, not type erasure).
const RichContent = dynamic(
  () => import('@/components/foxy/RichContent').then((m) => ({ default: m.RichContent })),
  { ssr: false, loading: () => null },
);
const UpgradeModal = dynamic(
  () => import('@/components/UpgradeModal').then((m) => ({ default: m.UpgradeModal })),
  { ssr: false },
);
const SELCheckIn = dynamic(() => import('@/components/SELCheckIn'), { ssr: false });

/* ══════════════════════════════════════════════════════════════
   SUBJECT CONFIGURATION
   ══════════════════════════════════════════════════════════════ */

interface SubjectConfig {
  name: string;
  icon: string;
  color: string;
}

// Fallback used only when the subjects service hook hasn't returned yet (first paint)
const FALLBACK_SCIENCE: SubjectConfig = { name: 'Science', icon: '⚛', color: '#10B981' };

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'HI' },
  { code: 'hinglish', label: 'Hing' },
];

const MODES = [
  { id: 'learn', emoji: '📖', label: 'Learn', labelHi: 'सीखो', autoPrompt: (topic: string) => topic ? `Teach me about: ${topic}` : 'Teach me the next concept step by step', autoPromptHi: (topic: string) => topic ? `मुझे सिखाओ: ${topic}` : 'मुझे अगला कॉन्सेप्ट सिखाओ' },
  { id: 'practice', emoji: '✏️', label: 'Practice', labelHi: 'अभ्यास', autoPrompt: (topic: string) => topic ? `Give me 3 practice problems on: ${topic}` : 'Give me practice problems to solve', autoPromptHi: (topic: string) => topic ? `मुझे 3 अभ्यास प्रश्न दो: ${topic}` : 'मुझे अभ्यास प्रश्न दो' },
  { id: 'quiz', emoji: '⚡', label: 'Quiz', labelHi: 'क्विज़', autoPrompt: (topic: string) => topic ? `Quiz me on: ${topic} (5 MCQ questions, board exam pattern)` : 'Quiz me with 5 MCQ questions on this chapter', autoPromptHi: (topic: string) => topic ? `मुझसे क्विज़ लो: ${topic} (5 MCQ प्रश्न, बोर्ड परीक्षा पैटर्न)` : 'मुझसे 5 MCQ प्रश्न पूछो' },
  { id: 'doubt', emoji: '❓', label: 'Doubt', labelHi: 'डाउट', autoPrompt: () => '', autoPromptHi: () => '' },
  { id: 'revision', emoji: '🔄', label: 'Revise', labelHi: 'रिवीज़', autoPrompt: (topic: string) => topic ? `Give me a quick revision summary of: ${topic}` : 'Summarize the key points for revision', autoPromptHi: (topic: string) => topic ? `${topic} का त्वरित पुनरावृत्ति सारांश दो` : 'रिवीज़न के लिए मुख्य बिंदु बताओ' },
  { id: 'notes', emoji: '📝', label: 'Notes', labelHi: 'नोट्स', autoPrompt: (topic: string) => topic ? `Create concise exam notes for: ${topic}` : 'Create exam-ready notes for this chapter', autoPromptHi: (topic: string) => topic ? `${topic} के लिए परीक्षा नोट्स बनाओ` : 'इस अध्याय के परीक्षा नोट्स बनाओ' },
  { id: 'lesson', emoji: '🎓', label: 'Lesson', labelHi: 'पाठ', autoPrompt: () => '', autoPromptHi: () => '' },
];

const FOXY_FACES: Record<string, string> = { idle: '🦊', thinking: '🤔', happy: '😄' };

const MASTERY_COLORS: Record<string, string> = {
  not_started: '#9ca3af', beginner: '#F59E0B', developing: '#3B82F6', proficient: '#8B5CF6', mastered: '#10B981',
};

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
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
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
  const { data: msgs } = await supabase
    .from('foxy_chat_messages')
    .select('role, content, created_at')
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
  const { data: messages } = await supabase
    .from('foxy_chat_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  return {
    id: session.id,
    subject: session.subject,
    chapter: session.chapter,
    messages: (messages ?? []).map((m: any) => ({
      role: m.role,           // 'user' | 'assistant'
      content: m.content,
      ts: m.created_at,
    })),
  };
}

// Calls the NEW Next.js API route (src/app/api/foxy/route.ts), which uses
// the src/lib/ai/ orchestration layer. The legacy foxy-tutor Edge Function
// (supabase/functions/foxy-tutor/) is deprecated — do not revert to it.
async function callFoxyTutor(params: Record<string, any> & { language?: string }) {
  // P7: Hindi-medium students must see Hindi error/paywall copy on critical surfaces.
  const isHi = params.language === 'hi';
  try {
    // Get the current access token — this is the primary auth mechanism.
    // cookies() alone can fail for chunked Supabase JWTs; the Bearer token
    // from the client session is always fresh (auto-refreshed by @supabase/auth).
    let accessToken: string | null = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session?.access_token ?? null;
    } catch { /* proceed without token — cookie fallback in authorizeRequest */ }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    const res = await fetch('/api/foxy', {
      method: 'POST',
      headers,
      credentials: 'include', // also send cookies as secondary fallback
      body: JSON.stringify({
        message:   params.message,
        subject:   params.subject,
        grade:     params.grade,
        chapter:   params.chapter   ?? null,
        board:     params.board     ?? null,
        sessionId: params.session_id ?? null, // map old param name to new
        mode:      params.mode      ?? 'learn',
        // Claude Vision: send image directly for handwriting recognition
        ...(params.image_base64 ? {
          image_base64: params.image_base64,
          image_media_type: params.image_media_type ?? 'image/jpeg',
        } : {}),
      }),
    });

    if (!res.ok) {
      let errBody: Record<string, unknown> | null = null;
      try { errBody = await res.json(); } catch { /* not JSON */ }

      // Log diagnostic info for debugging (never shown to user)
      if (errBody) {
        console.error('[Foxy] API error', {
          status: res.status,
          error: errBody.error,
          diag: errBody._diag,
        });
      }

      if (res.status === 401) {
        return {
          reply: isHi
            ? 'सेशन समाप्त हो गया। कृपया फिर से साइन इन करें।'
            : 'Session expired. Please sign in again.',
          xp_earned: 0,
          session_id: null,
        };
      }
      if (res.status === 403) {
        const errCode = (errBody?.code as string) ?? '';
        if (errCode === 'PERMISSION_DENIED' || errCode === 'NO_ROLES') {
          return {
            reply: isHi
              ? 'फॉक्सी पेड प्लान पर उपलब्ध है। अपग्रेड करें और AI ट्यूटर से चैट करें!'
              : 'Foxy is available on paid plans. Upgrade to chat with your AI tutor!',
            xp_earned: 0,
            session_id: null,
          };
        }
        return {
          reply: isHi
            ? 'पहुँच अस्वीकृत। कृपया सहायता से संपर्क करें।'
            : 'Access denied. Please contact support.',
          xp_earned: 0,
          session_id: null,
        };
      }
      if (res.status === 429) {
        return {
          reply: (errBody?.error as string) || (isHi
            ? 'आज के सारे संदेश इस्तेमाल हो गए। जारी रखने के लिए अपग्रेड करें!'
            : "You've used all your messages for today. Upgrade to continue!"),
          xp_earned: 0,
          session_id: null,
          limitReached: true,
        };
      }
      if (res.status === 503) {
        return {
          reply: isHi
            ? 'फॉक्सी अभी अस्थायी रूप से उपलब्ध नहीं है। एक मिनट बाद कोशिश करें।'
            : 'Foxy is temporarily unavailable. Please try again in a minute.',
          xp_earned: 0,
          session_id: null,
        };
      }
      return {
        reply: isHi
          ? 'कुछ गड़बड़ हो गई। कृपया फिर कोशिश करें।'
          : 'Something went wrong. Please try again.',
        xp_earned: 0,
        session_id: null,
      };
    }

    const data = await res.json();
    return {
      reply:      data.response || (isHi ? 'मुझे इसके बारे में सोचने दो...' : 'Let me think about that...'),
      xp_earned:  0, // new route does not award per-message XP (XP via quiz/study plan)
      session_id: data.sessionId || null,
      quota:      data.quotaRemaining,
      upgradePrompt: data.upgradePrompt || null,
      // Phase 3: grounded-answer response metadata. Undefined when the server
      // is running the legacy pre-3.2 flow; any tutor bubble without this
      // metadata renders as a plain answer (no banner, no card).
      groundingStatus:        data.groundingStatus as GroundingStatus | undefined,
      traceId:                data.traceId as string | undefined,
      abstainReason:          data.abstainReason as AbstainReason | undefined,
      suggestedAlternatives:  data.suggestedAlternatives as SuggestedAlternative[] | undefined,
      // Phase 0 Fix 0.5: analytics-only signals. Distinct from groundingStatus,
      // which is the API-shape branch discriminator. groundedFromChunks is
      // the honest "did the answer actually use the retrieved NCERT chunks"
      // signal; citationsCount is the count of NCERT citations on the
      // grounded-answer service response (0 on abstain or legacy w/out chunks).
      // Default to safe values when the server didn't emit them.
      groundedFromChunks:     typeof data.groundedFromChunks === 'boolean' ? data.groundedFromChunks : false,
      citationsCount:         typeof data.citationsCount === 'number' ? data.citationsCount : 0,
    };
  } catch (err) {
    console.error('[Foxy] Network error:', err);
    return {
      reply: isHi
        ? 'कनेक्शन की समस्या। अपना नेटवर्क जाँचें और फिर कोशिश करें!'
        : 'Connection issue. Check your network and try again!',
      xp_earned: 0,
      session_id: null,
    };
  }
}

/* ══════════════════════════════════════════════════════════════
   STREAMING — Phase 1.1
   ══════════════════════════════════════════════════════════════ */

// Per-user opt-out: localStorage.alfanumrik_foxy_stream = '0'.
// Default: streaming on (when ff_foxy_streaming is also enabled server-side).
function shouldUseStreaming(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = window.localStorage.getItem('alfanumrik_foxy_stream');
    return v !== '0';
  } catch {
    return true;
  }
}

interface StreamingCallbacks {
  onSession?: (sessionId: string) => void;
  onMetadata?: (meta: { groundingStatus: GroundingStatus; traceId?: string; confidence?: number; citationsCount?: number }) => void;
  onText: (delta: string) => void;
  onDone: (info: { tokensUsed: number; latencyMs: number; groundedFromChunks: boolean; citationsCount: number; claudeModel: string }) => void;
  onAbstain?: (info: { abstainReason: AbstainReason; suggestedAlternatives: SuggestedAlternative[]; traceId?: string }) => void;
  onError?: (info: { reason: string; traceId?: string }) => void;
}

/**
 * Stream a Foxy response. POSTs to /api/foxy with stream:true and consumes
 * the SSE response body. Invokes callbacks as events arrive. Returns a
 * promise that resolves when the stream closes (cleanly OR with error).
 *
 * Compatibility:
 *   - If the server doesn't honor `stream:true` (flag off, or service not
 *     deployed yet), the response will be JSON. In that case we fall back to
 *     the non-streaming path internally — caller's onDone is still invoked
 *     once with the full response.
 */
async function callFoxyTutorStream(
  payload: Record<string, any>,
  callbacks: StreamingCallbacks,
): Promise<void> {
  let accessToken: string | null = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    accessToken = session?.access_token ?? null;
  } catch { /* fall back to cookie */ }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch('/api/foxy', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ ...payload, stream: true }),
  });

  if (!res.ok) {
    callbacks.onError?.({ reason: `http-${res.status}` });
    return;
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    // Server didn't honor streaming — parse as regular JSON and fire onDone once.
    try {
      const data = await res.json();
      if (data?.sessionId) callbacks.onSession?.(data.sessionId);
      // P0 fix: when the server returns a hard-abstain in the JSON-fallback
      // path (because ff_foxy_streaming is OFF), we MUST route through
      // onAbstain — not onDone — otherwise the tutor bubble stays empty
      // and the HardAbstainCard never renders.
      if (data?.groundingStatus === 'hard-abstain') {
        callbacks.onAbstain?.({
          abstainReason: (data?.abstainReason || 'upstream_error') as AbstainReason,
          suggestedAlternatives: Array.isArray(data?.suggestedAlternatives) ? data.suggestedAlternatives : [],
          traceId: data?.traceId,
        });
        return;
      }
      if (typeof data?.response === 'string' && data.response.length > 0) {
        callbacks.onText(data.response);
      }
      callbacks.onDone({
        tokensUsed: data?.tokensUsed ?? 0,
        latencyMs: 0,
        groundedFromChunks: data?.groundedFromChunks === true,
        citationsCount: typeof data?.citationsCount === 'number' ? data.citationsCount : 0,
        claudeModel: data?.meta?.claude_model || data?.claudeModel || '',
      });
    } catch {
      callbacks.onError?.({ reason: 'non-stream-parse-failed' });
    }
    return;
  }

  if (!res.body) {
    callbacks.onError?.({ reason: 'empty-body' });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let citationsCount = 0;
  let metadataTraceId: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIdx: number;
    while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIdx);
      buffer = buffer.slice(sepIdx + 2);
      const eventLine = rawEvent.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;
      const eventName = eventLine.slice(7).trim();
      let parsed: any = null;
      try { parsed = JSON.parse(dataLine.slice(6)); } catch { continue; }

      if (eventName === 'session') {
        if (parsed?.sessionId) callbacks.onSession?.(parsed.sessionId);
      } else if (eventName === 'metadata') {
        metadataTraceId = parsed?.traceId;
        if (Array.isArray(parsed?.citations)) citationsCount = parsed.citations.length;
        callbacks.onMetadata?.({
          groundingStatus: (parsed?.groundingStatus || 'grounded') as GroundingStatus,
          traceId: parsed?.traceId,
          confidence: parsed?.confidence,
          citationsCount,
        });
      } else if (eventName === 'text') {
        if (typeof parsed?.delta === 'string') callbacks.onText(parsed.delta);
      } else if (eventName === 'done') {
        callbacks.onDone({
          tokensUsed: typeof parsed?.tokensUsed === 'number' ? parsed.tokensUsed : 0,
          latencyMs: typeof parsed?.latencyMs === 'number' ? parsed.latencyMs : 0,
          groundedFromChunks: parsed?.groundedFromChunks === true,
          citationsCount,
          claudeModel: typeof parsed?.claudeModel === 'string' ? parsed.claudeModel : '',
        });
      } else if (eventName === 'abstain') {
        callbacks.onAbstain?.({
          abstainReason: (parsed?.abstainReason || 'upstream_error') as AbstainReason,
          suggestedAlternatives: Array.isArray(parsed?.suggestedAlternatives) ? parsed.suggestedAlternatives : [],
          traceId: parsed?.traceId || metadataTraceId,
        });
      } else if (eventName === 'error') {
        callbacks.onError?.({
          reason: typeof parsed?.reason === 'string' ? parsed.reason : 'unknown',
          traceId: parsed?.traceId || metadataTraceId,
        });
      }
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   MAIN FOXY PAGE
   ══════════════════════════════════════════════════════════════ */

interface ChatMessage {
  id: number;
  role: 'student' | 'tutor';
  content: string;
  timestamp: string;
  xp?: number;
  feedback?: 'up' | 'down' | null;
  reported?: boolean;
  imageUrl?: string;
  /** Grounding verdict — set only on tutor messages served from the grounded-answer service. */
  groundingStatus?: GroundingStatus;
  /** Server-side trace id — useful for debugging/reporting. */
  traceId?: string;
  /** Abstain reason (only present when groundingStatus === 'hard-abstain'). */
  abstainReason?: AbstainReason;
  /** Suggested alternative chapters (only present when groundingStatus === 'hard-abstain'). */
  suggestedAlternatives?: SuggestedAlternative[];
}

const REPORT_REASONS = [
  { value: 'wrong_answer', label: '❌ Wrong answer', labelHi: '❌ गलत उत्तर' },
  { value: 'wrong_formula', label: '📐 Wrong formula', labelHi: '📐 गलत फॉर्मूला' },
  { value: 'wrong_explanation', label: '📝 Wrong explanation', labelHi: '📝 गलत व्याख्या' },
  { value: 'incomplete', label: '⚠️ Incomplete', labelHi: '⚠️ अधूरा' },
  { value: 'irrelevant', label: '🔀 Off-topic', labelHi: '🔀 विषय से हटकर' },
  { value: 'confusing', label: '😕 Confusing', labelHi: '😕 भ्रमित करने वाला' },
  { value: 'other', label: '💬 Other', labelHi: '💬 अन्य' },
];

export default function FoxyPage() {
  const { student: authStudent, isLoggedIn, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  // Allowed subjects come from the subjects service — respects grade, stream, plan,
  // and the admin-curated master list. Build a lookup table for tab/dropdown rendering.
  const SUBJECTS: Record<string, SubjectConfig> = Object.fromEntries(
    allowedSubjects.map((s) => [s.code, { name: s.name, icon: s.icon, color: s.color } as SubjectConfig]),
  );

  // Core state
  const [student, setStudent] = useState<any>(null);
  const [activeSubject, setActiveSubject] = useState('science');
  const [studentGrade, setStudentGrade] = useState('9');
  const [topics, setTopics] = useState<any[]>([]);
  const [masteryData, setMasteryData] = useState<any[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Monotonic message-id counter. Used in place of `Date.now()` for setMessages
  // pushes so two sequential pushes (e.g. user message + optimistic empty tutor
  // bubble) can never share an id even if the JS clock returns the same ms.
  // P0 (2026-04-28): ID collisions caused setMessages updates targeting the
  // tutor bubble to also flow into the user message, producing the
  // "duplicate render with raw markdown above the Foxy header" symptom.
  const messageIdCounterRef = useRef(0);
  const nextMessageId = useCallback(() => {
    messageIdCounterRef.current += 1;
    // Tag the counter into the lower bits and Date.now() into the upper bits,
    // so ids are still roughly chronological but guaranteed unique within a
    // single page session.
    return Date.now() * 1000 + messageIdCounterRef.current;
  }, []);
  const [collapsedAbove, setCollapsedAbove] = useState<number | null>(null); // index above which messages are collapsed
  const [loading, setLoading] = useState(false);
  const [sessionMode, setSessionMode] = useState('learn');
  const [language, setLanguage] = useState('en');
  const [activeTopic, setActiveTopic] = useState<any>(null);
  const [foxyState, setFoxyState] = useState<'idle' | 'thinking' | 'happy'>('idle');
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [xpGained, setXpGained] = useState(0);
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

  // Error reporting
  const [reportModal, setReportModal] = useState<{ msgId: number; studentMsg: string; foxyMsg: string } | null>(null);
  const [reportReason, setReportReason] = useState('wrong_answer');
  const [reportCorrection, setReportCorrection] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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
    const grade = (authStudent.grade || '9').replace('Grade ', ''); setStudentGrade(grade);
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
  }, [authStudent]);

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
  }, [activeSubject]);

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
  }, []);

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

  // Auto-scroll
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }, [messages, loading]);

  // Send message with usage enforcement
  const sendMessage = useCallback(async (text: string, image?: File | null) => {
    if (!text.trim() && !image) return;
    // Client-side length limit matching server-side MAX_MESSAGE_LENGTH
    if (text.length > 5000) {
      setMessages((p: ChatMessage[]) => [...p, {
        id: nextMessageId(),
        role: 'tutor',
        content: language === 'hi'
          ? 'संदेश बहुत लंबा है! कृपया 5000 अक्षरों से कम रखें।'
          : 'Message too long! Please keep it under 5000 characters.',
        timestamp: new Date().toISOString(),
      }]);
      return;
    }

    // Check chat usage limit
    if (student?.id) {
      const usage = await checkDailyUsage(student.id, 'foxy_chat', student.subscription_plan || 'free');
      setChatUsage(usage);
      if (!usage.allowed) {
        import('@/lib/sounds').then(({ playSound }) => playSound('limit'));
        setShowLimitModal(true);
        return;
      }
      // NOTE: Do NOT call recordUsage here — the server-side edge function
      // increments usage atomically BEFORE processing. Client-side increment
      // caused double-counting (every chat counted twice).
      setChatUsage((prev: UsageResult | null) => prev ? { ...prev, count: prev.count + 1, remaining: Math.max(0, prev.remaining - 1), allowed: prev.count + 1 < prev.limit } : prev);
    }

    // ── Image OCR processing ──
    // When the student attaches a photo of handwritten work, convert to base64
    // and send directly to the Foxy API which passes it to Claude Vision.
    // Claude reads handwriting natively — far better than any OCR service.
    let augmentedMessage = text;
    let imagePreviewUrl: string | undefined;
    let imageBase64: string | undefined;

    if (image) {
      // Create a preview URL to display in the chat bubble
      imagePreviewUrl = URL.createObjectURL(image);

      // Show the student message immediately with the image
      setMessages((p: ChatMessage[]) => [...p, {
        id: nextMessageId(),
        role: 'student',
        content: text || (language === 'hi' ? 'फ़ोटो अपलोड की' : 'Uploaded photo'),
        timestamp: new Date().toISOString(),
        imageUrl: imagePreviewUrl,
      }]);
      setLoading(true); setFoxyState('thinking'); setShowTopicSheet(false);
      setIsProcessingImage(true);

      try {
        // Convert image to base64 for Claude Vision
        const buffer = await image.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        imageBase64 = btoa(binary);
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
    } else {
      // Text-only message — show immediately
      setMessages((p: ChatMessage[]) => [...p, { id: nextMessageId(), role: 'student', content: text, timestamp: new Date().toISOString() }]);
      setLoading(true); setFoxyState('thinking'); setShowTopicSheet(false);
    }

    try {
      const selectedChapterTopics = selectedChapters.length > 0 ? topics.filter((t: any) => selectedChapters.includes(t.id)) : [];
      const chapCtx = selectedChapterTopics.length > 0 ? selectedChapterTopics.map((t: any) => `Ch ${t.chapter_number}: ${t.title}`).join(', ') : null;
      const chapterForSession = activeTopic?.title || (selectedChapterTopics.length === 1 ? selectedChapterTopics[0].title : null);
      const foxyParams: Record<string, any> = { message: augmentedMessage, student_id: student?.id || '', student_name: student?.name || 'Student', grade: studentGrade, subject: activeSubject, language, mode: sessionMode, topic_id: activeTopic?.id || null, topic_title: activeTopic?.title || null, chapter: chapterForSession, session_id: chatSessionId, selected_chapters: chapCtx };
      // Pass image to Claude Vision when student uploads a photo
      if (imageBase64) {
        foxyParams.image_base64 = imageBase64;
        foxyParams.image_media_type = image?.type || 'image/jpeg';
      }
      // Analytics: F16 — see audit 2026-04-27.
      // Fires once per fresh thread (when no chatSessionId exists yet at send time).
      // Subsequent turns reuse the existing session, so this won't double-fire.
      const isFreshSession = !chatSessionId;
      if (isFreshSession) {
        try {
          track('foxy_session_started', {
            subject: activeSubject,
            grade: studentGrade,
            mode: sessionMode,
          });
        } catch { /* analytics is non-critical */ }
      }
      const turnStartedAt = Date.now();

      // ── Phase 1.1: streaming branch ─────────────────────────────────────
      // Streaming is gated by:
      //   (1) shouldUseStreaming() — per-user opt-out via localStorage
      //   (2) ff_foxy_streaming server-side flag (checked in /api/foxy)
      // If either is off, the request still goes through /api/foxy and the
      // route falls back to JSON. callFoxyTutorStream auto-detects content-type
      // and adapts — so the client code below works for both paths.
      if (shouldUseStreaming() && !imageBase64) {
        const tutorBubbleId = nextMessageId();
        // Optimistically add an empty tutor bubble that we'll fill in.
        setMessages((p: ChatMessage[]) => [...p, {
          id: tutorBubbleId,
          role: 'tutor',
          content: '',
          timestamp: new Date().toISOString(),
        }]);

        // Throttle React state updates: collect deltas and flush every ~50ms
        // so we don't trigger 60+ re-renders/sec on a fast token stream.
        let pendingDelta = '';
        let flushScheduled = false;
        const flushDelta = () => {
          if (!pendingDelta) { flushScheduled = false; return; }
          const toAppend = pendingDelta;
          pendingDelta = '';
          flushScheduled = false;
          setMessages((p: ChatMessage[]) => p.map((m) =>
            m.id === tutorBubbleId ? { ...m, content: m.content + toAppend } : m,
          ));
        };
        const scheduleFlush = () => {
          if (flushScheduled) return;
          flushScheduled = true;
          setTimeout(flushDelta, 50);
        };

        let streamGroundingStatus: GroundingStatus | undefined;
        let streamTraceId: string | undefined;
        let streamGotDone = false;

        try {
          await callFoxyTutorStream(foxyParams, {
            onSession: (sid) => {
              if (sid) setChatSessionId(sid);
            },
            onMetadata: (meta) => {
              streamGroundingStatus = meta.groundingStatus;
              streamTraceId = meta.traceId;
              setMessages((p: ChatMessage[]) => p.map((m) =>
                m.id === tutorBubbleId
                  ? { ...m, groundingStatus: meta.groundingStatus, traceId: meta.traceId }
                  : m,
              ));
            },
            onText: (delta) => {
              pendingDelta += delta;
              scheduleFlush();
            },
            onDone: (info) => {
              streamGotDone = true;
              flushDelta(); // ensure last batch is rendered
              try {
                track('foxy_turn_completed', {
                  subject: activeSubject,
                  grade: studentGrade,
                  was_grounded: info.groundedFromChunks === true,
                  citations_count: info.citationsCount,
                  latency_ms: Date.now() - turnStartedAt,
                  streamed: true,
                });
              } catch { /* analytics non-critical */ }
              // P0 defensive guard: if the stream completed with no delta and
              // the bubble is still empty AND we had no abstain signal AND we
              // didn't get a groundedFromChunks=true terminal, fill with a
              // friendly fallback so the user never sees a silent empty bubble.
              setMessages((p: ChatMessage[]) => p.map((m) => {
                if (m.id !== tutorBubbleId) return m;
                if (m.content && m.content.length > 0) return m;
                if (m.groundingStatus === 'hard-abstain') return m; // abstain UI handles its own display
                if (info.groundedFromChunks === true) return m;     // server signaled real grounded answer
                return {
                  ...m,
                  content: language === 'hi'
                    ? 'मैं अभी जवाब नहीं दे सका। फिर से कोशिश करें या दूसरा chapter चुनें।'
                    : "I couldn't generate a response right now. Try rephrasing or pick a different chapter.",
                };
              }));
              setFoxyState('happy'); setTimeout(() => setFoxyState('idle'), 2000);
            },
            onAbstain: (info) => {
              flushDelta();
              setMessages((p: ChatMessage[]) => p.map((m) =>
                m.id === tutorBubbleId
                  ? {
                      ...m,
                      content: '',
                      groundingStatus: 'hard-abstain' as GroundingStatus,
                      abstainReason: info.abstainReason,
                      suggestedAlternatives: info.suggestedAlternatives,
                      traceId: info.traceId,
                    }
                  : m,
              ));
              setFoxyState('idle');
            },
            onError: (info) => {
              void info;
              flushDelta();
              setMessages((p: ChatMessage[]) => p.map((m) =>
                m.id === tutorBubbleId
                  ? {
                      ...m,
                      content: m.content || (language === 'hi'
                        ? 'ओह! कृपया फिर कोशिश करें।'
                        : 'Oops! Please try again.'),
                    }
                  : m,
              ));
              setFoxyState('idle');
            },
          });
        } catch (streamErr) {
          flushDelta();
          console.warn('[foxy] stream error:', streamErr);
          setMessages((p: ChatMessage[]) => p.map((m) =>
            m.id === tutorBubbleId && !m.content
              ? {
                  ...m,
                  content: language === 'hi'
                    ? 'ओह! कृपया फिर कोशिश करें।'
                    : 'Oops! Please try again.',
                }
              : m,
          ));
          setFoxyState('idle');
        }

        void streamGroundingStatus; void streamTraceId; void streamGotDone;

        // Refresh conversation list so new/updated sessions appear
        setTimeout(refreshConversations, 1000);
        setLoading(false);
        return;
      }
      // ── End streaming branch ────────────────────────────────────────────

      const resp = await callFoxyTutor(foxyParams);
      // Server confirmed daily limit reached — show UpgradeModal
      if (resp.limitReached) {
        setMessages((p: ChatMessage[]) => [...p, { id: nextMessageId(), role: 'tutor', content: resp.reply, timestamp: new Date().toISOString() }]);
        setShowLimitModal(true);
        setFoxyState('idle');
        setLoading(false);
        return;
      }
      setMessages((p: ChatMessage[]) => [...p, {
        id: nextMessageId(),
        role: 'tutor',
        content: resp.reply,
        timestamp: new Date().toISOString(),
        xp: resp.xp_earned,
        groundingStatus: resp.groundingStatus,
        traceId: resp.traceId,
        abstainReason: resp.abstainReason,
        suggestedAlternatives: resp.suggestedAlternatives,
      }]);
      // Soft upgrade prompt when quota is near exhaustion (user's choice, not forced)
      if (resp.upgradePrompt) {
        const up = resp.upgradePrompt;
        const promptMsg = language === 'hi' ? up.messageHi : up.message;
        setMessages((p: ChatMessage[]) => [...p, {
          id: nextMessageId(),
          role: 'tutor',
          content: `💡 ${promptMsg}`,
          timestamp: new Date().toISOString(),
        }]);
      }
      if (resp.xp_earned > 0) setXpGained((p: number) => p + resp.xp_earned);
      if (resp.session_id) setChatSessionId(resp.session_id);
      // Analytics: F16 — see audit 2026-04-27.
      // Phase 0 Fix 0.5: was_grounded is derived from resp.groundedFromChunks
      // (the server's honest "answer was actually produced from retrieved
      // NCERT chunks" signal), NOT from the groundingStatus discriminator.
      // Soft-mode answers that fell back to "general CBSE knowledge" return
      // groundingStatus='grounded' but groundedFromChunks=false — previously
      // these inflated the was_grounded metric to ~100% even when Foxy was
      // answering from general knowledge. citations_count uses the actual
      // NCERT citation count from the grounded-answer service (not
      // suggestedAlternatives, which is the abstain-branch redirect list
      // and is always 0 on grounded responses).
      try {
        track('foxy_turn_completed', {
          subject: activeSubject,
          grade: studentGrade,
          was_grounded: resp.groundedFromChunks === true,
          citations_count: typeof resp.citationsCount === 'number' ? resp.citationsCount : 0,
          latency_ms: Date.now() - turnStartedAt,
        });
      } catch { /* analytics is non-critical */ }
      setFoxyState('happy'); setTimeout(() => setFoxyState('idle'), 2000);
      // Auto-speak when voice mode is ON
      if (voiceModeRef.current) {
        speakCancelRef.current?.cancel();
        setIsSpeaking(true);
        speakCancelRef.current = speak(resp.reply, {
          language: voiceLangRef.current,
          rate: 0.9,
          onEnd: () => setIsSpeaking(false),
        });
      }
      // Refresh conversation list so new/updated sessions appear
      setTimeout(refreshConversations, 1000);
    } catch {
      setMessages((p: ChatMessage[]) => [...p, {
        id: nextMessageId(),
        role: 'tutor',
        content: language === 'hi' ? 'ओह! कृपया फिर कोशिश करें।' : 'Oops! Please try again.',
        timestamp: new Date().toISOString(),
      }]);
      setFoxyState('idle');
    }
    setLoading(false);
  }, [student, studentGrade, activeSubject, language, sessionMode, activeTopic, chatSessionId, selectedChapters, topics, refreshConversations, nextMessageId]);

  // Feedback: thumbs up/down
  const handleFeedback = useCallback(async (msgId: number, isUp: boolean) => {
    setMessages((prev: ChatMessage[]) => prev.map((m: ChatMessage) => m.id === msgId ? { ...m, feedback: isUp ? 'up' : 'down' } : m));
    try { await supabase.rpc('track_ai_quality', { p_subject: activeSubject, p_is_thumbs_up: isUp }); } catch {}
  }, [activeSubject]);

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
  }, [reportModal, student, chatSessionId, reportReason, reportCorrection, activeSubject, studentGrade, activeTopic, sessionMode, language]);

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
    return 'Hi! I am Foxy';
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
    return `${cfg.name} — Ch ${activeTopic.chapter_number}: ${activeTopic.title}`;
  };

  if (authLoading || !student) return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center">
      <div className="text-center"><div className="text-5xl animate-float mb-3">{FOXY_FACES.idle}</div><p className="text-sm text-[var(--text-3)]">{language === 'hi' ? 'फॉक्सी लोड हो रहा है...' : 'Loading Foxy...'}</p></div>
    </div>
  );

  return (
    <div className="min-h-dvh flex flex-col pb-nav" style={{ background: 'var(--surface-2)' }}>

      {/* ═══ HEADER ═══ */}
      <header className="sticky top-0 z-30 px-3 py-2.5 flex items-center gap-3" style={{ background: 'linear-gradient(135deg, #1a1a2e, #0f3460)', color: '#fff' }}>
        <button onClick={() => router.push('/dashboard')} className="text-white/60 text-sm">←</button>
        {/* Mobile: open conversation history sidebar */}
        <button
          onClick={() => setConversationSidebarOpen(true)}
          className="lg:hidden w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-95"
          style={{ background: 'rgba(255,255,255,0.1)' }}
          aria-label={language === 'hi' ? '\u091A\u0948\u091F \u0939\u093F\u0938\u094D\u091F\u094D\u0930\u0940' : 'Chat history'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0" style={{ background: 'linear-gradient(135deg, #E8590C, #F59E0B)', animation: foxyState === 'thinking' ? 'pulse 1s infinite' : 'none' }}>
          {FOXY_FACES[foxyState]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate">Foxy <span className="text-[10px] font-semibold opacity-60">{language === 'hi' ? 'AI ट्यूटर' : 'AI Tutor'}</span></div>
          <div className="text-[10px] opacity-50 flex gap-2"><span className="hidden sm:inline">{totalXP + xpGained} XP</span><span className="hidden sm:inline">{streakDays}d streak</span><span>Gr {studentGrade}</span></div>
        </div>
        <div className="flex items-center gap-1.5">
          {LANGS.map(l => <button key={l.code} onClick={() => { if (!isLangLocked) setLanguage(l.code); }} className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-all ${language !== l.code ? 'hidden sm:inline-block' : ''}`} style={{ background: language === l.code ? 'rgba(255,255,255,0.2)' : 'transparent', color: language === l.code ? '#fff' : 'rgba(255,255,255,0.4)', opacity: isLangLocked && language !== l.code ? 0.2 : 1, cursor: isLangLocked ? 'default' : 'pointer' }}>{l.label}</button>)}
          {isLangLocked && <span className="text-[8px] text-white/30">🔒</span>}
          {chatUsage && <span className="hidden sm:inline text-[8px] opacity-40 ml-1" title={language === 'hi' ? 'बचे हुए संदेश' : 'Chat messages remaining'}>💬{chatUsage.remaining}/{chatUsage.limit}</span>}
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
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all active:scale-90"
              style={{
                background: voiceMode ? 'rgba(232,88,28,0.25)' : 'rgba(255,255,255,0.08)',
                border: voiceMode ? '1.5px solid rgba(232,88,28,0.5)' : '1.5px solid rgba(255,255,255,0.1)',
                animation: isSpeaking ? 'pulse 1s infinite' : 'none',
              }}
            >
              {voiceMode ? '🔊' : '🔇'}
            </button>
          )}
        </div>
      </header>

      {/* ═══ SUBJECT TAB BAR — horizontal scrollable pills ═══ */}
      <div
        className="foxy-subject-tabs flex items-center gap-1.5 px-3 py-2"
        style={{
          background: 'var(--surface-1)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {(studentSubs.length > 0 ? studentSubs : allowedSubjects.map((s) => s.code)).map((key: string) => {
          const sub = SUBJECTS[key];
          if (!sub) return null;
          const isActive = activeSubject === key;
          return (
            <button
              key={key}
              onClick={() => {
                if (key !== activeSubject) {
                  switchSubject(key);
                  setShowChapterDD(true);
                }
              }}
              className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97]"
              style={{
                background: isActive ? `${sub.color}15` : 'var(--surface-2)',
                border: isActive ? `1.5px solid ${sub.color}40` : '1.5px solid var(--border)',
                color: isActive ? sub.color : 'var(--text-2)',
              }}
            >
              <span className="text-sm">{sub.icon}</span>
              <span className="whitespace-nowrap">{sub.name.length > 8 ? sub.name.substring(0, 7) + '.' : sub.name}</span>
            </button>
          );
        })}
      </div>

      {/* ═══ CHAPTER SELECTOR + MODE BAR ═══ */}
      <div className="foxy-toolbar" style={{ background: 'var(--surface-1)', borderBottom: '1px solid var(--border)' }}>
        {/* Chapter dropdown */}
        <div className="relative">
          <button onClick={() => { setShowChapterDD(!showChapterDD); setShowSubjectDD(false); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97]" style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', color: 'var(--text-2)' }}>
            <span className="text-sm">{cfg.icon}</span>
            <span>
              {activeTopic
                ? `Ch ${activeTopic.chapter_number}: ${activeTopic.title?.length > 15 ? activeTopic.title.substring(0, 14) + '...' : activeTopic.title}`
                : selectedChapters.length > 0
                  ? `${selectedChapters.length} ${language === 'hi' ? '\u0905\u0927\u094D\u092F\u093E\u092F' : 'Ch'}`
                  : (language === 'hi' ? '\u0905\u0927\u094D\u092F\u093E\u092F \u091A\u0941\u0928\u094B' : 'Select Chapter')}
            </span>
            <span className="text-[10px] ml-0.5 opacity-60">{showChapterDD ? '\u25B2' : '\u25BC'}</span>
          </button>
          {showChapterDD && (
            <div className="absolute top-full left-0 mt-1 z-50 w-[calc(100vw-24px)] sm:w-72 max-h-[50vh] rounded-2xl overflow-hidden shadow-lg flex flex-col" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
              <div className="p-2 px-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-3)]">{cfg.icon} {cfg.name} {language === 'hi' ? '\u0905\u0927\u094D\u092F\u093E\u092F' : 'Chapters'}</span>
                {(selectedChapters.length > 0 || activeTopic) && (
                  <button onClick={() => { setSelectedChapters([]); setActiveTopic(null); }} className="text-[10px] font-semibold" style={{ color: 'var(--orange)' }}>{language === 'hi' ? '\u0938\u092C \u0939\u091F\u093E\u0913' : 'Clear All'}</button>
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
                      <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 text-[10px]" style={{ background: sel ? cfg.color : 'var(--surface-2)', color: sel ? '#fff' : 'var(--text-3)', border: sel ? 'none' : '1.5px solid var(--border)' }}>{sel ? '\u2713' : ''}</div>
                      <div className="flex-1 min-w-0"><div className="text-xs font-semibold truncate" style={{ color: 'var(--text-1)' }}>Ch {topic.chapter_number}: {topic.title}</div></div>
                      <span className="text-[9px] font-bold capitalize px-1.5 py-0.5 rounded" style={{ background: `${lc}15`, color: lc }}>{lvl.replace('_', ' ')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Simplified mode pills */}
        <div className="foxy-mode-bar ml-auto">
          {SIMPLIFIED_MODES.map(m => {
            const backendMode = MODE_MAP[m.id] || m.id;
            const isActive = sessionMode === backendMode || (m.id === 'ask' && (sessionMode === 'learn' || sessionMode === 'doubt'));
            return (
              <button key={m.id} onClick={() => switchMode(m.id)} className="shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1" style={{ background: isActive ? `${cfg.color}15` : 'transparent', color: isActive ? cfg.color : 'var(--text-3)', border: isActive ? `1px solid ${cfg.color}30` : '1px solid transparent' }}>
                <span>{m.icon}</span>
                <span>{language === 'hi' ? m.labelHi : m.label}</span>
              </button>
            );
          })}
          {/* Lesson mode — advanced, shown as small pill */}
          <button onClick={() => switchMode('lesson')} className="shrink-0 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1" style={{ background: sessionMode === 'lesson' ? `${cfg.color}15` : 'transparent', color: sessionMode === 'lesson' ? cfg.color : 'var(--text-3)', border: sessionMode === 'lesson' ? `1px solid ${cfg.color}30` : '1px solid transparent' }}>
            <span>{'\uD83C\uDF93'}</span>
            <span className="hidden sm:inline">{language === 'hi' ? '\u092A\u093E\u0920' : 'Lesson'}</span>
          </button>
        </div>
      </div>

      {/* Close dropdowns */}
      {(showSubjectDD || showChapterDD) && <div className="fixed inset-0 z-40" onClick={() => { setShowSubjectDD(false); setShowChapterDD(false); }} />}

      {/* ═══ CONTEXT BAR — shows active conversation header ═══ */}
      {messages.length > 0 && (
        <ConversationHeader
          title={generateTitle(messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })), activeSubject)}
          subject={activeSubject}
          mode={sessionMode}
          messageCount={messages.length}
          isHi={language === 'hi'}
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
              const stepLabels: Record<string, string> = {
                hook: '🪝 Hook', visualization: '👁 Visual', guided_examples: '📝 Examples',
                active_recall: '🧠 Recall', application: '🔧 Apply', spaced_revision: '🔄 Revise',
              };
              return (
                <div key={step} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full h-1.5 rounded-full" style={{
                    background: isCompleted ? cfg.color : isCurrent ? `${cfg.color}60` : 'var(--surface-2)',
                    transition: 'all 0.3s ease',
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
                style={{ background: `${cfg.color}15`, color: cfg.color, border: `1px solid ${cfg.color}30` }}
              >
                {lessonStep === 'spaced_revision'
                  ? (language === 'hi' ? '✓ पूरा हुआ' : '✓ Complete')
                  : (language === 'hi' ? 'अगला चरण →' : 'Next Step →')}
              </button>
            )}
          </div>
          {/* Predict-before-reveal for active recall step */}
          {showPredictionInput && !predictionSubmitted && (
            <div className="mt-2 p-3 rounded-xl" style={{ background: `${cfg.color}06`, border: `1px solid ${cfg.color}20` }}>
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
            <div className="mt-2 text-[10px] font-semibold" style={{ color: '#16A34A' }}>
              ✓ {language === 'hi' ? 'अनुमान जमा हो गया! Foxy का जवाब देखो।' : 'Prediction submitted! See Foxy\'s answer below.'}
            </div>
          )}
        </div>
      )}

      {/* ═══ MAIN CHAT AREA ═══ */}
      <SectionErrorBoundary section="Foxy Chat">
      <div className="flex-1 flex overflow-hidden relative">
        {/* Conversation Manager Sidebar — desktop: always visible, mobile: slide-over */}
        <ConversationManager
          conversations={conversations.map((c: ConversationSummary) => ({ ...c, isActive: c.id === chatSessionId }))}
          activeConversationId={chatSessionId}
          isHi={language === 'hi'}
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
              <button onClick={() => setSidebarOpen(false)} className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] transition-all hover:opacity-70" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }} title="Collapse">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {topics.map((topic: any) => {
                const mastery = masteryData.find((m: any) => m.topic_tag === topic.title || m.chapter_number === topic.chapter_number);
                const pct = mastery?.mastery_percent || 0;
                const lvl = mastery?.mastery_level || 'not_started';
                const lc = MASTERY_COLORS[lvl] || MASTERY_COLORS.not_started;
                return (
                  <button key={topic.id} onClick={() => { setActiveTopic(topic); setMessages([]); setChatSessionId(null); setCollapsedAbove(null); setTimeout(() => sendMessage(`Teach me about: ${topic.title} (Chapter ${topic.chapter_number})`), 50); }} className="w-full text-left p-2.5 rounded-xl transition-all active:scale-[0.98]" style={{ border: `1px solid ${lc}25`, background: activeTopic?.id === topic.id ? `${lc}10` : 'var(--surface-1)' }}>
                    <div className="text-[11px] font-bold truncate" style={{ color: 'var(--text-1)' }}>Ch {topic.chapter_number}: {topic.title}</div>
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

        {/* Chat column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-3 md:px-5 py-4 pb-32">
            {/* SEL mood check-in — shown once per day at session start */}
            {showSELCheckIn && student && (
              <div className="mb-4 animate-slide-up">
                <SELCheckIn
                  isHi={language === 'hi'}
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
                <div className="text-6xl md:text-7xl mb-4 animate-float">{FOXY_FACES.idle}</div>
                <h2 className="text-xl md:text-2xl font-extrabold mb-2" style={{ fontFamily: 'var(--font-display)', background: `linear-gradient(135deg, #E8590C, ${cfg.color})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{getEmptyStateHeading()}</h2>
                <p className="text-sm text-[var(--text-3)] max-w-sm mx-auto mb-4 leading-relaxed">
                  {getEmptyStateSubtitle()}
                </p>

                {/* Chapter selection nudge when no topic selected */}
                {!activeTopic && !urlContext && (
                  <button
                    onClick={() => setShowChapterDD(true)}
                    className="mb-6 px-5 py-3 rounded-2xl text-sm font-bold transition-all active:scale-[0.97]"
                    style={{
                      background: `${cfg.color}12`,
                      color: cfg.color,
                      border: `1.5px solid ${cfg.color}30`,
                    }}
                  >
                    {cfg.icon} {language === 'hi' ? '\u0905\u0927\u094D\u092F\u093E\u092F \u091A\u0941\u0928\u094B' : 'Select a Chapter to Start'}
                  </button>
                )}

                {/* Context banner — shown when arriving from /learn, /quiz, or
                    knowledge gap (NOT dashboard — dashboard entry uses the
                    Phase 1.2 friendly greeting above, no Start-button banner). */}
                {urlContext && !isDashboardEntry && (
                  <div className="mx-auto max-w-sm mb-6 p-4 rounded-2xl text-left" style={{ background: `${cfg.color}10`, border: `1.5px solid ${cfg.color}30` }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: cfg.color }}>
                      {language === 'hi' ? '📍 इस विषय से शुरू करो' : '📍 Continuing from'}
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">{cfg.icon}</span>
                      <div>
                        <div className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>
                          {cfg.name}
                          {urlContext.topic && <span className="font-normal text-[var(--text-3)]"> · Ch {urlContext.topic}</span>}
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
                  onSelect={sendMessage}
                />

                {activeTopic && (
                  <button onClick={() => setShowChapterDD(true)} className="mt-6 px-5 py-2.5 rounded-xl text-sm font-bold" style={{ background: `${cfg.color}10`, color: cfg.color, border: `1.5px solid ${cfg.color}30` }}>
                    {cfg.icon} {language === 'hi' ? `\u0905\u0928\u094D\u092F ${topics.length} \u0905\u0927\u094D\u092F\u093E\u092F \u0926\u0947\u0916\u094B` : `Browse ${topics.length} Chapters`}
                  </button>
                )}
              </div>
            )}

            {/* Messages — with collapsing for long threads */}
            {messages.length > 10 && collapsedAbove === null && (
              <button
                onClick={() => setCollapsedAbove(messages.length - 6)}
                className="w-full text-center py-2 mb-3 rounded-xl text-[11px] font-semibold transition-all active:scale-[0.98]"
                style={{ background: 'var(--surface-1)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
              >
                ↑ Show only recent messages ({messages.length} total)
              </button>
            )}

            {collapsedAbove !== null && (
              <button
                onClick={() => setCollapsedAbove(null)}
                className="w-full text-center py-2 mb-3 rounded-xl text-[11px] font-semibold transition-all active:scale-[0.98]"
                style={{ background: `${cfg.color}08`, color: cfg.color, border: `1px solid ${cfg.color}20` }}
              >
                ↓ Show all {messages.length} messages
              </button>
            )}

            {/* P0 (2026-04-28) defensive dedup: filter out any messages that
                share an id with an earlier entry. Guards against the
                duplicate-render symptom where the same ChatMessage somehow
                appears twice in the array (or where a stale streaming-bubble
                push lands alongside a fresh one). The structural fix is
                nextMessageId() above, which makes ids monotonically unique;
                this keeps that guarantee even if a future regression breaks
                it. */}
            {(() => {
              const seenIds = new Set<number>();
              return messages.filter((m) => {
                if (seenIds.has(m.id)) return false;
                seenIds.add(m.id);
                return true;
              });
            })().map((msg: ChatMessage, idx: number) => {
              // Skip collapsed messages
              if (collapsedAbove !== null && idx < collapsedAbove) return null;

              return (
                <div key={msg.id}>
                  <ChatBubble
                    role={msg.role}
                    content={msg.role === 'tutor' ? <RichContent content={msg.content} subjectKey={activeSubject} /> : (
                      <div>
                        {msg.imageUrl && (
                          <div className="mb-2 rounded-xl overflow-hidden max-w-[220px]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={msg.imageUrl} alt={language === 'hi' ? 'अपलोड की गई फ़ोटो' : 'Uploaded photo'} className="w-full h-auto rounded-xl" />
                          </div>
                        )}
                        <div className="whitespace-pre-wrap">{msg.content}</div>
                      </div>
                    )}
                    rawContent={msg.content}
                    timestamp={msg.timestamp}
                    studentName={student?.name}
                    xp={msg.xp}
                    feedback={msg.feedback}
                    reported={msg.reported}
                    color={cfg.color}
                    activeSubject={activeSubject}
                    onFeedback={(isUp) => handleFeedback(msg.id, isUp)}
                    onReport={() => openReport(msg.id)}
                    onSpeak={ttsSupported && msg.role === 'tutor' ? () => speakMessage(msg.content) : undefined}
                    groundingStatus={msg.groundingStatus}
                    traceId={msg.traceId}
                    abstainReason={msg.abstainReason}
                    suggestedAlternatives={msg.suggestedAlternatives}
                  />
                  {msg.role === 'tutor' && !msg.reported && (
                    <div className="flex justify-start pl-11 -mt-2 mb-3">
                      <button
                        onClick={() => saveToFlashcard(msg.id, msg.content)}
                        disabled={savedMessageIds.has(msg.id)}
                        className="text-[10px] font-bold px-2.5 py-1 rounded-lg transition-all active:scale-95 disabled:cursor-default"
                        style={{
                          background: savedMessageIds.has(msg.id) ? '#16A34A10' : 'var(--surface-1)',
                          color: savedMessageIds.has(msg.id) ? '#16A34A' : 'var(--text-3)',
                          border: `1px solid ${savedMessageIds.has(msg.id) ? '#16A34A30' : 'var(--border)'}`,
                        }}
                      >
                        {savedMessageIds.has(msg.id)
                          ? (language === 'hi' ? '✓ सेव हो गया' : '✓ Saved')
                          : (language === 'hi' ? '📌 सेव करो' : '📌 Save')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Report Error Modal ── */}
            {reportModal && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) { setReportModal(null); } }}>
                <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[80vh] overflow-y-auto animate-slide-up" style={{ background: 'var(--surface-1)' }}>
                  {!reportSuccess ? (<>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>⚠️ Report Incorrect Answer</h3>
                      <button onClick={() => setReportModal(null)} className="text-lg" style={{ color: 'var(--text-3)' }}>✕</button>
                    </div>

                    {/* What Foxy said */}
                    <div className="mb-4 p-3 rounded-xl text-xs" style={{ background: '#EF444408', border: '1px solid #EF444420' }}>
                      <div className="font-bold text-[10px] uppercase tracking-wider mb-1" style={{ color: '#EF4444' }}>Foxy&apos;s response:</div>
                      <div className="leading-relaxed" style={{ color: 'var(--text-2)', maxHeight: 100, overflow: 'hidden' }}>{reportModal.foxyMsg.substring(0, 300)}{reportModal.foxyMsg.length > 300 ? '...' : ''}</div>
                    </div>

                    {/* Reason */}
                    <div className="mb-3">
                      <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--text-3)' }}>What&apos;s wrong?</label>
                      <div className="flex flex-wrap gap-1.5">
                        {REPORT_REASONS.map(r => (
                          <button key={r.value} onClick={() => setReportReason(r.value)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all" style={{ background: reportReason === r.value ? '#EF444415' : 'var(--surface-2)', color: reportReason === r.value ? '#EF4444' : 'var(--text-3)', border: `1.5px solid ${reportReason === r.value ? '#EF444440' : 'var(--border)'}` }}>
                            {language === 'hi' ? r.labelHi : r.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Student's correction */}
                    <div className="mb-4">
                      <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-3)' }}>{language === 'hi' ? 'सही उत्तर क्या होना चाहिए? (वैकल्पिक)' : 'What should the correct answer be? (optional)'}</label>
                      <textarea
                        value={reportCorrection}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReportCorrection(e.target.value)}
                        placeholder={language === 'hi' ? 'सही उत्तर लिखें...' : 'Type the correct answer here...'}
                        rows={3}
                        className="w-full text-sm rounded-xl px-3 py-2 resize-none outline-none"
                        style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', fontFamily: 'var(--font-body)' }}
                      />
                    </div>

                    {/* Submit */}
                    <div className="flex gap-2">
                      <button onClick={() => setReportModal(null)} className="flex-1 py-2.5 rounded-xl text-xs font-bold" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>{language === 'hi' ? 'रद्द करें' : 'Cancel'}</button>
                      <button onClick={submitReport} disabled={reportSubmitting} className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-50" style={{ background: '#EF4444' }}>
                        {reportSubmitting
                          ? (language === 'hi' ? 'भेजा जा रहा है...' : 'Submitting...')
                          : (language === 'hi' ? '⚠️ रिपोर्ट भेजें' : '⚠️ Submit Report')}
                      </button>
                    </div>
                  </>) : (
                    <div className="text-center py-6">
                      <div className="text-4xl mb-3">✅</div>
                      <h3 className="text-base font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>{language === 'hi' ? 'धन्यवाद!' : 'Thank you!'}</h3>
                      <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
                        {language === 'hi' ? 'आपकी रिपोर्ट दर्ज हो गई है। हम इसकी जाँच करेंगे और सुधार करेंगे।' : 'Your report has been recorded. Our team will review and fix this.'}
                      </p>
                      <button onClick={() => setReportModal(null)} className="px-6 py-2 rounded-xl text-xs font-bold text-white" style={{ background: 'var(--orange)' }}>OK</button>
                    </div>
                  )}
                </div>
              </div>
            )}

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

          {/* Conversation length nudge — after 15+ user messages */}
          {messages.filter((m: ChatMessage) => m.role === 'student').length >= 15 && (
            <div
              className="mx-3 mb-2 p-2.5 rounded-xl text-xs flex items-center justify-between gap-2"
              style={{ background: '#F97316' + '0D', border: '1px solid #F97316' + '25' }}
            >
              <span style={{ color: '#C2410C' }}>
                {language === 'hi'
                  ? '\uD83E\uDD8A \u0928\u0908 \u091A\u0948\u091F \u0936\u0941\u0930\u0942 \u0915\u0930\u094B \u0924\u093E\u0915\u093F Foxy \u092C\u0947\u0939\u0924\u0930 \u091C\u0935\u093E\u092C \u0926\u0947 \u0938\u0915\u0947!'
                  : '\uD83E\uDD8A Start a new chat so Foxy can give better answers!'}
              </span>
              <button
                onClick={handleNewConversation}
                className="shrink-0 px-3 py-1.5 rounded-full text-[10px] font-bold text-white transition-all active:scale-95"
                style={{ background: '#F97316' }}
              >
                {language === 'hi' ? '\u0928\u0908 \u091A\u0948\u091F' : 'New Chat'}
              </button>
            </div>
          )}
          <ChatInput
            onSubmit={sendMessage}
            subjectKey={activeSubject}
            disabled={loading}
            language={language}
            onVoiceSend={voiceMode ? sendMessage : undefined}
          />
        </div>
      </div>

      {/* Mobile topics sheet */}
      {showTopicSheet && (
        <>
          <div className="fixed inset-0 z-40 lg:hidden" style={{ background: 'rgba(0,0,0,0.3)' }} onClick={() => setShowTopicSheet(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl max-h-[75vh] flex flex-col lg:hidden" style={{ background: 'var(--surface-1)', boxShadow: '0 -8px 40px rgba(0,0,0,0.1)' }}>
            <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: 'var(--border)' }} /></div>
            <div className="px-4 pb-2 flex items-center justify-between">
              <span className="text-sm font-bold" style={{ color: cfg.color }}>{cfg.icon} {cfg.name} · Gr {studentGrade}</span>
              <button onClick={() => setShowTopicSheet(false)} className="text-xs text-[var(--text-3)] font-semibold">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
              {topics.map((topic: any) => {
                const mastery = masteryData.find((m: any) => m.topic_tag === topic.title || m.chapter_number === topic.chapter_number);
                const pct = mastery?.mastery_percent || 0;
                const lvl = mastery?.mastery_level || 'not_started';
                const lc = MASTERY_COLORS[lvl] || MASTERY_COLORS.not_started;
                return (
                  <button key={topic.id} onClick={() => { setActiveTopic(topic); setShowTopicSheet(false); sendMessage(`Teach me about: ${topic.title} (Chapter ${topic.chapter_number})`); }} className="w-full text-left p-3.5 rounded-xl flex items-center gap-3 active:scale-[0.98] transition-all" style={{ background: 'var(--surface-2)', border: `1px solid ${lc}20` }}>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: `${lc}15` }}>{cfg.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold truncate" style={{ color: 'var(--text-1)' }}>Ch {topic.chapter_number}: {topic.title}</div>
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

      <BottomNav />
    </div>
  );
}
