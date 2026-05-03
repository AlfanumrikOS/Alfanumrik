/**
 * /api/foxy — Foxy AI Tutor Chat Endpoint
 *
 * Responsibilities that STAY in this route:
 *  1. RBAC auth guard (foxy.chat permission)
 *  2. Subject governance (validateSubjectWrite)
 *  3. Daily quota enforcement (atomic RPC + refund on upstream failures)
 *  4. Session continuity (foxy_sessions table)
 *  5. Cognitive context loading (CME tables) — not an AI concern
 *  6. Multi-turn history load (foxy_chat_messages)
 *  7. Persist turn to foxy_chat_messages + cognitive action logging
 *  8. Audit log
 *  9. Upgrade prompt computation
 *
 * Responsibilities that moved to supabase/functions/grounded-answer/ (Phase 2):
 *  - Voyage embedding generation
 *  - match_rag_chunks_ncert RPC
 *  - Claude call with model fallback
 *  - System prompt template resolution (foxy_tutor_v1)
 *  - Circuit breaker / cache / timeouts for Voyage+Claude
 *
 * This route shells out to that service via callGroundedAnswer(). The inline
 * legacy flow is preserved behind `ff_grounded_ai_foxy` as a kill switch for
 * the Phase 3 rollout window.
 *
 * POST /api/foxy
 * Body: { message, subject, grade, chapter?, board?, sessionId?, mode? }
 * Response (success):
 *   { success, response, sessionId, quotaRemaining, tokensUsed,
 *     confidence?, groundingStatus, traceId, upgradePrompt?,
 *     structured? }
 *   NOTE (Phase 0): NCERT `sources` and `diagrams` are intentionally NOT
 *   exposed on the wire. Retrieval still happens server-side, citations
 *   are injected into the system prompt, and `sources` is still persisted
 *   to foxy_chat_messages.sources for analytics/debug — but never echoed
 *   to the client.
 *
 *   `structured` (FoxyResponse, see src/lib/foxy/schema.ts) is the new
 *   block-shape rendering of the answer. Present ONLY when the upstream
 *   grounded-answer service returned a valid structured payload AND it
 *   passed defense-in-depth validation at this API boundary. If absent
 *   (legacy fallback path, kill-switch path, malformed upstream payload,
 *   or upstream that hasn't shipped structured yet) the client falls
 *   back to the legacy `response` string. The `response` (denormalized
 *   text) is ALWAYS populated so old clients keep working.
 * Response (abstain / hard-abstain):
 *   { success: true, response: '', groundingStatus: 'hard-abstain',
 *     abstainReason, suggestedAlternatives, traceId }
 *
 * GET /api/foxy?sessionId=<uuid>
 * Response:
 *   { success: true, session, messages: Array<{
 *       id, role, content, structured, tokens_used, created_at }> }
 *   `structured` (FoxyResponse|null) is the persisted block-shape rendering
 *   for assistant rows. NULL for user rows (DB CHECK constraint) and for
 *   legacy assistant rows persisted before the structured-output migration;
 *   the chat page falls back to `content` in that case.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { validateSubjectWrite } from '@/lib/subjects';
import { callGroundedAnswer, callGroundedAnswerStream, type GroundedRequest, type Citation, type SuggestedAlternative, type AbstainReason } from '@/lib/ai/grounded-client';
import { PER_PLAN_TIMEOUT_MS, SOFT_CONFIDENCE_BANNER_THRESHOLD } from '@/lib/grounding-config';
import { classifyIntent, routeIntent } from '@/lib/ai';
import { FoxyResponseSchema, type FoxyResponse } from '@/lib/foxy/schema';
import { denormalizeFoxyResponse } from '@/lib/foxy/denormalize';

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_MODES = ['learn', 'explain', 'practice', 'revise'];
// Phase 2.2: coaching modes — distinct from the UI session mode above.
// 'answer'   → student wants the answer (used when mastery is high).
// 'socratic' → guide via questions (default for mid-mastery, the moat).
// 'review'   → quick recall mode for revision/spaced-repetition entries.
const VALID_COACH_MODES = ['answer', 'socratic', 'review'] as const;
type CoachMode = typeof VALID_COACH_MODES[number];
const MAX_MESSAGE_LENGTH = 1000;
// Phase 2.4: bumped from 6 → 20 turns. Anthropic prompt caching
// (cache_control: ephemeral) is applied to the system prompt + first ~10
// turns so input cost stays roughly flat despite the longer history.
const MAX_HISTORY_TURNS = 20;
const RAG_MATCH_COUNT = 5;
const SESSION_IDLE_MINUTES = 30;

// Reasons for which we refund the quota (the student did not actually get
// served an answer that consumed LLM tokens). Service-side validation errors
// (scope_mismatch, low_similarity, no_supporting_chunks) are NOT refunded:
// the service did run retrieval + possibly Claude on the student's behalf.
const REFUND_ABSTAIN_REASONS: AbstainReason[] = [
  'upstream_error',
  'circuit_open',
  'chapter_not_ready',
];

// Quota per plan per day
const DAILY_QUOTA: Record<string, number> = {
  free: 10,
  starter: 30,
  pro: 100,
  unlimited: 999999, // effectively unlimited
};
const DEFAULT_QUOTA = 10;

// Soft upgrade prompts — shown ONLY when quota is near exhaustion (not on errors)
const UPGRADE_PROMPTS: Record<string, { threshold: number; message: string; messageHi: string; nextPlan: string }> = {
  free: {
    threshold: 8, // show when 8/10 used (2 remaining)
    message: 'You have {remaining} messages left today. Upgrade to Starter for 30 daily messages!',
    messageHi: 'आज {remaining} मैसेज बाकी हैं। Starter प्लान लो और 30 रोज़ पाओ!',
    nextPlan: 'starter',
  },
  starter: {
    threshold: 25, // show when 25/30 used (5 remaining)
    message: 'You have {remaining} messages left today. Upgrade to Pro for 100 daily messages!',
    messageHi: 'आज {remaining} मैसेज बाकी हैं। Pro प्लान लो और 100 रोज़ पाओ!',
    nextPlan: 'pro',
  },
  pro: {
    threshold: 90, // show when 90/100 used (10 remaining)
    message: 'You have {remaining} messages left today. Upgrade to Unlimited for unlimited messages!',
    messageHi: 'आज {remaining} मैसेज बाकी हैं। Unlimited प्लान लो!',
    nextPlan: 'unlimited',
  },
  unlimited: {
    threshold: 999999, // never show
    message: '',
    messageHi: '',
    nextPlan: '',
  },
};

// Normalize raw plan codes from the DB to canonical keys.
// Handles legacy aliases (basic→starter, premium→pro, ultimate→unlimited)
// and strips monthly/yearly billing-cycle suffixes.
function normalizePlan(raw: string): string {
  return (raw || 'free')
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro')
    .replace(/^ultimate$/, 'unlimited');
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface RagSource {
  chunk_id: string;
  subject: string;
  chapter?: string;
  page_number?: number;
  similarity: number;
  content_preview: string;
  media_url?: string | null;
}

interface DiagramRef {
  url: string;
  title: string;
  pageNumber?: number;
  description: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Cognitive Context Types ────────────────────────────────────────────────

interface CognitiveContext {
  weakTopics: Array<{ title: string; mastery: number; attempts: number }>;
  strongTopics: Array<{ title: string; mastery: number }>;
  knowledgeGaps: Array<{ target: string; prerequisite: string; gapType: string }>;
  revisionDue: Array<{ title: string; lastReviewed: string; mastery: number }>;
  recentErrors: Array<{ errorType: string; count: number }>;
  nextAction: { actionType: string; conceptName: string; reason: string } | null;
  masteryLevel: 'low' | 'medium' | 'high';
  // Phase 2: per-LO BKT mastery (finer-grained than topic mastery).
  // Top 10 weakest LOs (lowest p_know) for the student in this chapter/subject.
  loSkills: Array<{ loCode: string; loStatement: string; pKnow: number; pSlip: number; theta: number }>;
  // Phase 2: curated misconceptions observed in this student's recent (30d)
  // wrong-answer patterns. Top 3 by occurrence count.
  recentMisconceptions: Array<{ code: string; label: string; count: number; remediationText: string }>;
}

const EMPTY_COGNITIVE_CONTEXT: CognitiveContext = {
  weakTopics: [],
  strongTopics: [],
  knowledgeGaps: [],
  revisionDue: [],
  recentErrors: [],
  nextAction: null,
  masteryLevel: 'medium',
  loSkills: [],
  recentMisconceptions: [],
};

// ─── Helper: structured-payload extraction (defense-in-depth) ───────────────
//
// The grounded-answer Edge Function may include a `structured` field on
// successful responses (a `FoxyResponse` per src/lib/foxy/schema.ts). The
// service-side already validates the payload, but we re-validate at this API
// boundary because the JSONB column we are about to write is trusted by every
// downstream reader (renderer, analytics, parent portal). A bug on the Edge
// Function side must NOT poison the database.
//
// Behavior:
//   - upstream returned no `structured` field          → returns null (legacy path)
//   - upstream returned a valid FoxyResponse           → returns the parsed value
//   - upstream returned a malformed `structured` field → returns null AND logs
//     `foxy.structured.invalid_payload` so ops can detect Edge Function drift.
//
// The route never throws on a bad structured payload — the legacy `response`
// (string) is always populated so the student still sees an answer.
function extractValidatedStructured(
  upstream: unknown,
  ctx: { traceId: string; studentId: string; subject: string; grade: string },
): FoxyResponse | null {
  // Read defensively: until grounded-client.ts adds the field to its type,
  // TypeScript doesn't know about it. The runtime shape is what matters.
  const candidate = (upstream as { structured?: unknown } | null | undefined)
    ?.structured;
  if (candidate === undefined || candidate === null) {
    return null; // legacy / pre-structured upstream — not an error
  }
  const parsed = FoxyResponseSchema.safeParse(candidate);
  if (!parsed.success) {
    // P12 defense-in-depth: never write malformed JSON into the JSONB column.
    // We log the issue but continue — the legacy `response` string still
    // populates `content`, so the student turn is preserved.
    logger.error('foxy.structured.invalid_payload', {
      traceId: ctx.traceId,
      // Intentionally NOT logging studentId at error-level (P13). Subject +
      // grade are non-PII context for ops triage.
      subject: ctx.subject,
      grade: ctx.grade,
      // First 3 issues only, to bound log size.
      issueCount: parsed.error.issues.length,
      issuePreview: parsed.error.issues.slice(0, 3).map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
    return null;
  }
  return parsed.data;
}

// ─── Helper: error response ───────────────────────────────────────────────────

function errorJson(
  message: string,
  message_hi: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ success: false, error: message, error_hi: message_hi, ...extra }, { status });
}

// ─── Helper: get or create session ───────────────────────────────────────────

async function resolveSession(
  studentId: string,
  subject: string,
  grade: string,
  chapter: string | null,
  mode: string,
  providedSessionId: string | null,
): Promise<string> {
  if (providedSessionId) {
    const cutoff = new Date(Date.now() - SESSION_IDLE_MINUTES * 60 * 1000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from('foxy_sessions')
      .select('id')
      .eq('id', providedSessionId)
      .eq('student_id', studentId)
      .gte('last_active_at', cutoff)
      .single();

    if (existing) {
      await supabaseAdmin
        .from('foxy_sessions')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', providedSessionId);
      return providedSessionId;
    }
  }

  const { data: newSession, error } = await supabaseAdmin
    .from('foxy_sessions')
    .insert({
      student_id: studentId,
      subject,
      grade,
      chapter: chapter || null,
      mode,
      last_active_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !newSession) {
    throw new Error(`Failed to create Foxy session: ${error?.message}`);
  }
  return newSession.id;
}

// ─── Helper: load recent conversation history ─────────────────────────────────

async function loadHistory(sessionId: string): Promise<ChatMessage[]> {
  const { data: messages } = await supabaseAdmin
    .from('foxy_chat_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_TURNS * 2);

  if (!messages || messages.length === 0) return [];
  return (messages as ChatMessage[]).reverse();
}

// ─── Helper: load prior-session context (Task 1.3) ───────────────────────────
// Last 6-10 messages from PRIOR sessions on the same (student, subject,
// chapter) tuple. We exclude the current session so we don't double-count
// turns the student is actively in. Returns at most PRIOR_SESSION_MSG_LIMIT
// turn snippets (a snippet is a [user → assistant] pair compressed to
// content previews, 200 chars each).
//
// Phase 1.3 cheap-path: no Haiku summarization. We inject the raw last few
// turns as `[previous: …]` snippets in the prompt template. If this proves
// too noisy, Phase 2 can add a Haiku summary step here.
const PRIOR_SESSION_MSG_LIMIT = 10;
const PRIOR_SESSION_LOOKBACK_DAYS = 30;

interface PriorSessionTurn {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

async function loadPriorSessionContext(
  studentId: string,
  subject: string,
  grade: string,
  currentSessionId: string,
  chapter: string | null,
): Promise<PriorSessionTurn[]> {
  void grade; // session-row scoping (subject + chapter) is sufficient for now
  try {
    // Find prior session ids for this student / subject / chapter (if known).
    // We look back 30 days so we don't drag in stale sessions from months ago.
    const lookbackIso = new Date(
      Date.now() - PRIOR_SESSION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    let sessionsQuery = supabaseAdmin
      .from('foxy_sessions')
      .select('id')
      .eq('student_id', studentId)
      .eq('subject', subject)
      .gte('last_active_at', lookbackIso)
      .neq('id', currentSessionId)
      .order('last_active_at', { ascending: false })
      .limit(3);
    if (chapter) sessionsQuery = sessionsQuery.eq('chapter', chapter);

    const { data: priorSessions } = await sessionsQuery;
    if (!priorSessions || priorSessions.length === 0) return [];

    const priorSessionIds = priorSessions.map((s: any) => s.id);

    const { data: priorMessages } = await supabaseAdmin
      .from('foxy_chat_messages')
      .select('role, content, created_at')
      .in('session_id', priorSessionIds)
      .order('created_at', { ascending: false })
      .limit(PRIOR_SESSION_MSG_LIMIT);

    if (!priorMessages || priorMessages.length === 0) return [];
    // Reverse to chronological order so the prompt reads forward in time.
    return (priorMessages as PriorSessionTurn[]).reverse();
  } catch (err) {
    logger.warn('foxy_prior_session_context_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
      subject,
    });
    return [];
  }
}

/**
 * Format prior-session turns into a prompt section. Each turn is truncated to
 * 200 chars to keep the prompt bounded. Empty array → empty string (template
 * handles missing cleanly).
 */
function buildPriorSessionPromptSection(turns: PriorSessionTurn[]): string {
  if (turns.length === 0) return '';
  const lines = turns.map((t) => {
    const speaker = t.role === 'user' ? 'Student' : 'Foxy';
    const content = (t.content ?? '').slice(0, 200).replace(/\s+/g, ' ').trim();
    return `[previous · ${speaker}] ${content}`;
  });
  return [
    '## PREVIOUS CONVERSATION (recent prior sessions on this subject/chapter)',
    'Use this only as context — do not address the previous turns directly. The student\'s current question is in the user message.',
    ...lines,
  ].join('\n');
}

// ─── Helper: load cognitive context from CME tables ─────────────────────────

async function loadCognitiveContext(
  studentId: string,
  subject: string,
  grade: string,
  chapter: string | null = null,
): Promise<CognitiveContext> {
  void grade; // reserved for future grade-scoped mastery lookups
  try {
    const { data: subjectRow } = await supabaseAdmin
      .from('subjects')
      .select('id')
      .ilike('code', subject)
      .maybeSingle();
    const subjectId = subjectRow?.id ?? null;

    // Resolve chapter id when caller passed a chapter (number or title) so we
    // can scope the per-LO skill query down to that chapter; otherwise fall
    // back to the subject-wide weakest LOs.
    let chapterId: string | null = null;
    if (chapter && subjectId) {
      try {
        const chapterNum = /^\d+$/.test(chapter) ? parseInt(chapter, 10) : null;
        let chQuery = supabaseAdmin
          .from('chapters')
          .select('id')
          .eq('subject_id', subjectId)
          .eq('grade', grade);
        if (chapterNum !== null) {
          chQuery = chQuery.eq('chapter_number', chapterNum);
        } else {
          chQuery = chQuery.ilike('title', chapter);
        }
        const { data: chRow } = await chQuery.limit(1).maybeSingle();
        chapterId = chRow?.id ?? null;
      } catch {
        // Non-fatal — fall back to subject-wide LO scope.
      }
    }

    const [masteryRes, gapsRes, revisionRes, errorsRes, loSkillsRes, misconceptionsRes] = await Promise.all([
      supabaseAdmin
        .from('concept_mastery')
        .select('mastery_probability, mastery_level, attempts, topic_id, curriculum_topics(title, subject_id)')
        .eq('student_id', studentId)
        .order('mastery_probability', { ascending: true })
        .limit(30),

      supabaseAdmin
        .from('knowledge_gaps')
        .select('topic_id, prerequisite_topic_id, gap_type, is_resolved, description, curriculum_topics!knowledge_gaps_topic_id_fkey(title), prereq:curriculum_topics!knowledge_gaps_prerequisite_topic_id_fkey(title)')
        .eq('student_id', studentId)
        .eq('is_resolved', false)
        .limit(5),

      supabaseAdmin
        .from('concept_mastery')
        .select('mastery_probability, next_review_date, topic_id, curriculum_topics(title)')
        .eq('student_id', studentId)
        .not('next_review_date', 'is', null)
        .lte('next_review_date', new Date().toISOString().split('T')[0])
        .order('next_review_date', { ascending: true })
        .limit(5),

      supabaseAdmin
        .from('cme_error_log')
        .select('error_type')
        .eq('student_id', studentId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),

      // Phase 2: per-LO BKT skill state (top 10 weakest by p_know). Joined to
      // learning_objectives so we can render the LO statement + chapter scope.
      // chapter_id filter is applied client-side after the join because the
      // PostgREST !inner join requires the filter on the joined alias.
      (() => {
        let q = supabaseAdmin
          .from('student_skill_state')
          .select('p_know, p_slip, theta, learning_objectives!inner(code, statement, chapter_id, chapters!inner(subject_id))')
          .eq('student_id', studentId)
          .order('p_know', { ascending: true })
          .limit(50);
        if (chapterId) {
          q = q.eq('learning_objectives.chapter_id', chapterId);
        } else if (subjectId) {
          q = q.eq('learning_objectives.chapters.subject_id', subjectId);
        }
        return q;
      })(),

      // Phase 2: recent (30d) wrong-answer misconceptions for this student.
      // Join quiz_responses → question_misconceptions on
      // (question_id, distractor_index = selected_option). Filter is_correct=false.
      // We pull both the misconception code/label and the remediation text
      // from the wrong_answer_remediations cache (best-effort).
      supabaseAdmin
        .from('quiz_responses')
        .select('question_id, selected_option, is_correct, created_at, question_misconceptions!inner(misconception_code, misconception_label, distractor_index, remediation_chunk_id)')
        .eq('student_id', studentId)
        .eq('is_correct', false)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(200),
    ]);

    const subjectMastery = (masteryRes.data ?? []).filter((m: any) => {
      if (!subjectId) return true;
      return m.curriculum_topics?.subject_id === subjectId;
    });

    const weakTopics = subjectMastery
      .filter((m: any) => (m.mastery_probability ?? 0) < 0.6)
      .slice(0, 5)
      .map((m: any) => ({
        title: m.curriculum_topics?.title ?? 'Unknown topic',
        mastery: Math.round((m.mastery_probability ?? 0) * 100),
        attempts: m.attempts ?? 0,
      }));

    const strongTopics = subjectMastery
      .filter((m: any) => (m.mastery_probability ?? 0) >= 0.8)
      .slice(-3)
      .map((m: any) => ({
        title: m.curriculum_topics?.title ?? 'Unknown topic',
        mastery: Math.round((m.mastery_probability ?? 0) * 100),
      }));

    const knowledgeGaps = (gapsRes.data ?? []).map((g: any) => ({
      target: g.curriculum_topics?.title ?? g.description ?? '',
      prerequisite: g.prereq?.title ?? '',
      gapType: g.gap_type ?? '',
    }));

    const revisionDue = (revisionRes.data ?? []).map((r: any) => ({
      title: r.curriculum_topics?.title ?? 'Unknown',
      lastReviewed: r.next_review_date ?? '',
      mastery: Math.round((r.mastery_probability ?? 0) * 100),
    }));

    const errorCounts: Record<string, number> = {};
    for (const e of errorsRes.data ?? []) {
      errorCounts[e.error_type] = (errorCounts[e.error_type] || 0) + 1;
    }
    const recentErrors = Object.entries(errorCounts)
      .map(([errorType, count]) => ({ errorType, count }))
      .sort((a, b) => b.count - a.count);

    // Phase 2: Process per-LO skill state — keep at most 10 weakest LOs.
    // The PostgREST !inner join filter on chapters.subject_id may not narrow
    // perfectly when chapterId is null (PostgREST sometimes ignores nested
    // filters silently); we double-filter client-side as a defense.
    // PostgREST returns nested joins as either an object (when the FK is
    // unique) or an array (when ambiguous). We normalize both shapes.
    type LoSkillRow = {
      p_know: number | string | null;
      p_slip: number | string | null;
      theta: number | string | null;
      learning_objectives:
        | {
            code: string;
            statement: string;
            chapter_id: string;
            chapters: { subject_id: string } | Array<{ subject_id: string }> | null;
          }
        | Array<{
            code: string;
            statement: string;
            chapter_id: string;
            chapters: { subject_id: string } | Array<{ subject_id: string }> | null;
          }>
        | null;
    };
    const loSkillsRaw = (loSkillsRes.data ?? []) as unknown as LoSkillRow[];
    const loSkills = loSkillsRaw
      .map((row) => {
        const lo = Array.isArray(row.learning_objectives)
          ? row.learning_objectives[0]
          : row.learning_objectives;
        if (!lo) return null;
        const chap = Array.isArray(lo.chapters) ? lo.chapters[0] : lo.chapters;
        return {
          row,
          loCode: lo.code,
          loStatement: lo.statement,
          chapterIdForRow: lo.chapter_id,
          subjectIdForRow: chap?.subject_id ?? null,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .filter((entry) => {
        if (chapterId) return entry.chapterIdForRow === chapterId;
        if (subjectId) return entry.subjectIdForRow === subjectId;
        return true;
      })
      .slice(0, 10)
      .map((entry) => ({
        loCode: entry.loCode,
        loStatement: entry.loStatement,
        pKnow: Number(entry.row.p_know ?? 0),
        pSlip: Number(entry.row.p_slip ?? 0),
        theta: Number(entry.row.theta ?? 0),
      }));

    // Phase 2: Process recent misconceptions — keep ones where the student's
    // selected_option matches the curated distractor_index, group by code,
    // count occurrences, take top 3, then enrich with cached remediation text.
    type MisconceptionJoinRow = {
      question_id: string;
      selected_option: number | null;
      question_misconceptions:
        | {
            misconception_code: string;
            misconception_label: string;
            distractor_index: number;
            remediation_chunk_id: string | null;
          }
        | Array<{
            misconception_code: string;
            misconception_label: string;
            distractor_index: number;
            remediation_chunk_id: string | null;
          }>
        | null;
    };
    const misconceptionRaw = (misconceptionsRes.data ?? []) as unknown as MisconceptionJoinRow[];
    const misconceptionAgg: Record<string, { code: string; label: string; count: number; questionIds: Set<string> }> = {};
    for (const row of misconceptionRaw) {
      const qm = Array.isArray(row.question_misconceptions)
        ? row.question_misconceptions
        : (row.question_misconceptions ? [row.question_misconceptions] : []);
      for (const m of qm) {
        if (m.distractor_index !== row.selected_option) continue;
        if (!misconceptionAgg[m.misconception_code]) {
          misconceptionAgg[m.misconception_code] = {
            code: m.misconception_code,
            label: m.misconception_label,
            count: 0,
            questionIds: new Set<string>(),
          };
        }
        misconceptionAgg[m.misconception_code].count += 1;
        misconceptionAgg[m.misconception_code].questionIds.add(row.question_id);
      }
    }
    const topMisconceptions = Object.values(misconceptionAgg)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // Enrich with remediation text. Best-effort lookup against the
    // wrong_answer_remediations cache for the question_ids that produced each
    // misconception. If no cached remediation exists, leave the field empty
    // (the prompt template handles empty gracefully).
    const recentMisconceptions: CognitiveContext['recentMisconceptions'] = [];
    for (const m of topMisconceptions) {
      let remediationText = '';
      try {
        const qIds = Array.from(m.questionIds);
        if (qIds.length > 0) {
          const { data: remRows } = await supabaseAdmin
            .from('wrong_answer_remediations')
            .select('remediation_text')
            .in('question_id', qIds)
            .limit(1);
          remediationText = remRows?.[0]?.remediation_text ?? '';
        }
      } catch {
        // non-fatal — empty remediation is acceptable
      }
      recentMisconceptions.push({
        code: m.code,
        label: m.label,
        count: m.count,
        remediationText: remediationText.slice(0, 200),
      });
    }

    // P13: do not log misconception code/label paired with student_id. Only
    // log a redacted preview (counts only, no codes/labels) for ops.
    if (recentMisconceptions.length > 0) {
      logger.info('foxy_misconception_context_loaded', {
        // intentionally NO studentId in this log line
        misconceptionCount: recentMisconceptions.length,
        topCount: recentMisconceptions[0]?.count ?? 0,
      });
    }

    const avgMastery = subjectMastery.length > 0
      ? subjectMastery.reduce((s: number, m: any) => s + (m.mastery_probability ?? 0), 0) / subjectMastery.length
      : 0.5;
    const masteryLevel: CognitiveContext['masteryLevel'] =
      avgMastery < 0.4 ? 'low' : avgMastery < 0.7 ? 'medium' : 'high';

    // CME next-action (non-blocking)
    let nextAction: CognitiveContext['nextAction'] = null;
    if (subjectId) {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && serviceKey) {
          const cmeRes = await fetch(`${supabaseUrl}/functions/v1/cme-engine`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'get_next_action',
              student_id: studentId,
              subject_id: subjectId,
            }),
            signal: AbortSignal.timeout(3000),
          });
          if (cmeRes.ok) {
            const cmeData = await cmeRes.json();
            if (cmeData.type) {
              nextAction = {
                actionType: cmeData.type,
                conceptName: cmeData.title ?? cmeData.concept_id ?? '',
                reason: cmeData.reason ?? '',
              };
            }
          }
        }
      } catch {
        // CME failure is non-fatal — Foxy still works without next-action
      }
    }

    return {
      weakTopics,
      strongTopics,
      knowledgeGaps,
      revisionDue,
      recentErrors,
      nextAction,
      masteryLevel,
      loSkills,
      recentMisconceptions,
    };
  } catch (err) {
    logger.warn('foxy_cognitive_context_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
    });
    return EMPTY_COGNITIVE_CONTEXT;
  }
}

// ─── Helper: pKnow → directive sentence (per-LO bucket) ─────────────────────
//
// Replaces flat percentage labels like "P(know)=42%" with directive sentences
// keyed on three pKnow buckets. The model received numbers but didn't know
// what to DO with them; directives say HOW to open the explanation.
//   pKnow < 0.5         → weak     (analogy/worked example BEFORE definition)
//   0.5 ≤ pKnow < 0.75  → partial  (1-sentence recap, then advance)
//   pKnow ≥ 0.75        → strong   (skip basics, go to challenge/transfer)
function buildLoDirective(lo: {
  loCode: string;
  loStatement: string;
  pKnow: number;
}): string {
  const pct = Math.round(lo.pKnow * 100);
  const label = `[${lo.loCode}] ${lo.loStatement}`;
  if (lo.pKnow < 0.5) {
    return `${label} is weak (mastery ${pct}%) — open the explanation with a concrete real-world analogy or worked example BEFORE introducing the formal definition.`;
  }
  if (lo.pKnow < 0.75) {
    return `${label} is partial (mastery ${pct}%) — quick recap (1 sentence), then advance to application.`;
  }
  return `${label} is strong (mastery ${pct}%) — skip basics, go straight to challenge or transfer task.`;
}

// ─── Helper: compose recentErrors + recentMisconceptions ────────────────────
//
// Audit finding: RECENT_ERROR_PATTERNS (generic counts) and KNOWN_MISCONCEPTIONS
// (curated ontology) were two separate signals that didn't compose. The
// MISCONCEPTION_REPAIR pedagogy rule fires on a 3+ generic-error count, but
// the curated label/remediation lives in a different section. Compose them:
// when the top curated misconception has count ≥ 2 (a real overlap, not a
// one-off), emit a SINGLE binary directive the model can act on directly.
// Otherwise return empty so the legacy generic-counts block can render.
function composeMisconceptionDirective(
  recentErrors: CognitiveContext['recentErrors'],
  misconceptions: CognitiveContext['recentMisconceptions'],
): string {
  if (misconceptions.length === 0) return '';
  const top = misconceptions[0];
  if (!top || top.count < 2) return '';
  // Defense-in-depth: cap remediation snippet (the curated section already
  // truncates at 400 chars, but the directive line stays terse).
  let fix = '';
  if (top.remediationText) {
    const cleaned = top.remediationText.replace(/\s+/g, ' ').trim();
    fix = ` — ${cleaned.length > 200 ? `${cleaned.slice(0, 199)}…` : cleaned}`;
  }
  // Suppress the generic counts block when we have curated overlap so the
  // model sees ONE directive instead of two competing signals. Caller decides
  // to skip the legacy block when this returns non-empty.
  void recentErrors;
  return `MISCONCEPTION TO TARGET: ${top.label}${fix}`;
}

// ─── Helper: build cognitive prompt section from CME data ───────────────────

function buildCognitivePromptSection(ctx: CognitiveContext): string {
  if (
    ctx.weakTopics.length === 0 &&
    ctx.strongTopics.length === 0 &&
    ctx.knowledgeGaps.length === 0 &&
    ctx.revisionDue.length === 0 &&
    ctx.recentErrors.length === 0 &&
    !ctx.nextAction &&
    ctx.loSkills.length === 0
  ) {
    return '';
  }

  const sections: string[] = [];

  sections.push('=== STUDENT LEARNING STATE (from Cognitive Mastery Engine) ===');

  if (ctx.weakTopics.length > 0) {
    sections.push('\nWEAK TOPICS (explain more carefully, use simpler language):');
    for (const t of ctx.weakTopics) {
      sections.push(`- ${t.title}: ${t.mastery}% mastery (${t.attempts} attempts)`);
    }
  }

  if (ctx.strongTopics.length > 0) {
    sections.push('\nSTRONG TOPICS (can reference as foundations, challenge with harder questions):');
    for (const t of ctx.strongTopics) {
      sections.push(`- ${t.title}: ${t.mastery}% mastery`);
    }
  }

  if (ctx.knowledgeGaps.length > 0) {
    sections.push('\nKNOWLEDGE GAPS (address prerequisites before advancing):');
    for (const g of ctx.knowledgeGaps) {
      sections.push(`- Missing: "${g.prerequisite}" needed for "${g.target}" (${g.gapType})`);
    }
  }

  if (ctx.revisionDue.length > 0) {
    sections.push('\nCONCEPTS DUE FOR REVISION (ask a quick recall question before teaching new content):');
    for (const r of ctx.revisionDue) {
      sections.push(`- ${r.title}: ${r.mastery}% mastery, overdue for review`);
    }
  }

  // Compose recentErrors + recentMisconceptions into a single binary
  // directive when curated misconception data overlaps with generic error
  // counts. This makes the MISCONCEPTION_REPAIR pedagogy rule fire on real
  // curated signals (label + remediation) rather than generic error_type
  // strings. Threshold: top curated misconception count >= 2 = fire.
  const composedMc = composeMisconceptionDirective(
    ctx.recentErrors,
    ctx.recentMisconceptions,
  );
  if (composedMc) {
    sections.push(`\n${composedMc}`);
  } else if (ctx.recentErrors.length > 0) {
    // Fall back to legacy generic error counts only when no curated overlap.
    sections.push('\nRECENT ERROR PATTERNS (address these misconceptions proactively):');
    for (const e of ctx.recentErrors) {
      sections.push(`- ${e.errorType} errors: ${e.count} times in last 30 days`);
    }
  }

  // Phase 2: per-LO BKT mastery — finer-grained than topic mastery above.
  // Render as DIRECTIVE sentences keyed on pKnow buckets, not raw labels.
  // The flat percentage label "P(know)=42%" was descriptive but not
  // actionable. Bucketed directives tell Foxy HOW to open the explanation.
  if (ctx.loSkills.length > 0) {
    sections.push('\nLEARNING OBJECTIVE MASTERY (directive — open the explanation accordingly):');
    for (const lo of ctx.loSkills) {
      sections.push(`- ${buildLoDirective(lo)}`);
    }
  }

  if (ctx.nextAction) {
    sections.push(`\nRECOMMENDED ACTION: ${ctx.nextAction.actionType.toUpperCase()}`);
    sections.push(`Concept: ${ctx.nextAction.conceptName}`);
    sections.push(`Reason: ${ctx.nextAction.reason}`);
  }

  sections.push('\n=== COGNITIVE LOAD INSTRUCTIONS ===');
  if (ctx.masteryLevel === 'low') {
    sections.push('Student is STRUGGLING. Instructions:');
    sections.push('- Use simple, clear language. One idea per paragraph.');
    sections.push('- Give a worked example BEFORE asking the student to try.');
    sections.push('- Break multi-step problems into individual steps.');
    sections.push('- Maximum 3-4 sentences per explanation block.');
    sections.push('- Use analogies from daily life familiar to Indian students.');
    sections.push('- After explaining, ask ONE simple check-for-understanding question.');
  } else if (ctx.masteryLevel === 'medium') {
    sections.push('Student is PROGRESSING. Instructions:');
    sections.push('- Standard explanation with examples.');
    sections.push('- Ask check-for-understanding questions to verify comprehension.');
    sections.push('- Build on their strong topics when explaining new concepts.');
    sections.push('- Introduce "why" questions to deepen understanding.');
  } else {
    sections.push('Student is PROFICIENT. Instructions:');
    sections.push('- Challenge with higher-order questions (analyze, evaluate, create).');
    sections.push('- Connect concepts across chapters.');
    sections.push('- Encourage independent reasoning before giving answers.');
    sections.push('- Ask "what if" and "why not" questions.');
    sections.push('- Suggest CBSE board-level application problems.');
  }

  return sections.join('\n');
}

// ─── Helper: build curated misconception prompt section ────────────────────
//
// Renders the top-3 curated misconceptions observed in this student's recent
// (30 day) wrong-answer patterns. Used to fire MISCONCEPTION_REPAIR in the
// Foxy pedagogy decision tree (foxy_tutor_v1) — without this data the branch
// never triggers because cme_error_log only has generic error_type strings.
//
// Empty input → empty string (no heading printed). The template renders the
// `{{misconception_section}}` placeholder as empty so there's no orphan
// header. P13: NEVER pair misconception code/label with student_id in logs.
// P12 prompt-bloat guard: cap rendered remediation text at 400 chars. Curated
// remediations in `wrong_answer_remediations` are 150-300 chars by policy; 400
// is a 33% safety margin. Without this cap, a 5000-char curator entry in a
// 3-misconception section would add ~15k tokens to every Foxy request.
const REMEDIATION_MAX_CHARS = 400;

function buildMisconceptionPromptSection(
  misconceptions: CognitiveContext['recentMisconceptions'],
): string {
  if (misconceptions.length === 0) return '';
  const lines: string[] = [
    "KNOWN MISCONCEPTIONS (curated, observed in this student's recent quizzes):",
  ];
  for (const m of misconceptions) {
    let remediation = '';
    if (m.remediationText) {
      const cleaned = m.remediationText.replace(/\s+/g, ' ').trim();
      const truncated =
        cleaned.length > REMEDIATION_MAX_CHARS
          ? `${cleaned.slice(0, REMEDIATION_MAX_CHARS - 1)}…`
          : cleaned;
      remediation = ` — fix: ${truncated}`;
    }
    lines.push(
      `- [${m.code}] ${m.label} (seen ${m.count}x in last 30 days)${remediation}`,
    );
  }
  return lines.join('\n');
}

// ─── Academic goal → prompt instruction mapping ──────────────────────────────
const GOAL_PROMPT_MAP: Record<string, string> = {
  board_topper: 'Board Topper (90%+). Teach with depth, cover edge cases, use HOTS-style questioning, and push for thorough understanding.',
  school_topper: 'School Topper. Focus on strong conceptual clarity and application-based questions beyond rote learning.',
  pass_comfortably: 'Pass Comfortably. Keep explanations simple and confidence-building. Focus on frequently-tested topics and basic numericals.',
  competitive_exam: 'Competitive Exam Prep (JEE/NEET/Olympiad). Go beyond NCERT where relevant, include tricky problems and conceptual depth.',
  olympiad: 'Olympiad Preparation. Challenge with advanced reasoning, logical puzzles, and problems that require creative thinking.',
  improve_basics: 'Improve Basics. Be extra patient, use analogies and visuals, break complex topics into tiny steps, and reinforce fundamentals.',
};

function buildAcademicGoalSection(goal: string | null): string {
  if (!goal) return '';
  const instruction = GOAL_PROMPT_MAP[goal] ?? goal;
  return `\n## Student's Academic Goal: ${instruction}\n`;
}

// ─── Coaching-mode resolver (Phase 2.2) ──────────────────────────────────────
//
// Decides the per-turn coaching shape from the explicit request param (if any)
// + the student's current mastery level. Default policy:
//   mastery 'low'    → 'socratic'  (scaffold prerequisites)
//   mastery 'medium' → 'socratic'  (the moat — ask, don't tell)
//   mastery 'high'   → 'answer'    (concise answer + stretch question)
// 'review' must be requested explicitly (used by spaced-repetition surface).
function resolveCoachMode(
  requested: CoachMode | null,
  masteryLevel: CognitiveContext['masteryLevel'],
): CoachMode {
  if (requested) return requested;
  if (masteryLevel === 'high') return 'answer';
  return 'socratic';
}

const COACH_MODE_INSTRUCTIONS: Record<CoachMode, string> = {
  answer:
    "Student appears confident. Answer the question concisely (3-5 sentences max) and end with ONE stretch question that is one Bloom's level higher than the original.",
  socratic:
    "Use Socratic scaffolding. Break the answer into 2-3 guided sub-questions, ask the student to attempt each, and only give the full explanation if they remain stuck after two scaffolds.",
  review:
    "Treat this as a quick recall check. Ask the student to state the key idea in their own words first; only confirm or correct after they answer.",
};

// ─── System-prompt safety rails (P12 AI Safety, P7 Bilingual) ────────────────
//
// These rails mirror the server-authoritative `foxy_tutor_v1` template stored
// in the grounded-answer Edge Function. We reproduce them here so that:
//   (a) the safety contract is visible in the Next.js route for audit tooling
//       (adaptive-layer-health.test.ts asserts these literals are present),
//   (b) the legacy intent-router fallback receives the same rails as the
//       grounded-answer path via template_variables.foxy_safety_rails,
//   (c) any future inline LLM call path (disabled today) still has the rails
//       pre-rendered and ready to inject.
//
// DO NOT weaken these rails without an assessment-agent review — the CBSE
// scope, off-topic redirect, and Hindi-English mixing guidance are
// curriculum-correctness + age-appropriateness invariants.
const FOXY_SAFETY_RAILS = `
You are Foxy, a friendly CBSE tutor. Safety rails you must follow:

1. Scope: Only teach from CBSE NCERT material for the student's grade and subject.
   If a question is outside CBSE scope, gently redirect to the subject and
   suggest a related CBSE topic the student can explore.
2. Age appropriateness: Students are in grades 6-12. Use language they
   understand. Avoid adult topics, violence, or anything unsuitable for minors.
3. Bilingual style: Respond in the same language the student wrote. If the
   student mixes Hindi words with English (Hinglish) you may mix too, but keep
   technical terms (CBSE, XP, Bloom's, photosynthesis, etc.) in English.
4. Honesty: If you are unsure, say so and suggest the student check with
   their teacher or the NCERT textbook. Do not fabricate facts.
5. Grounding: Prefer the retrieved NCERT chunks as the source of truth. When
   you cite a fact, reference the chapter it came from.
`.trim();

/**
 * Compose the full system prompt for Foxy. Used as a template_variable for
 * the grounded-answer service and as the base prompt for the legacy intent
 * router. Deterministic — safe to call outside of a request lifecycle.
 */
function buildSystemPrompt(params: {
  grade: string;
  subject: string;
  chapter: string | null;
  mode: string;
  academicGoal: string | null;
  cognitiveCtx: CognitiveContext;
}): string {
  const { grade, subject, chapter, mode, academicGoal, cognitiveCtx } = params;
  const chapterLine = chapter ? `Chapter: ${chapter}\n` : '';
  return [
    `You are Foxy, an AI tutor for a Class ${grade} CBSE student studying ${subject}.`,
    chapterLine ? chapterLine : null,
    `Current mode: ${mode}.`,
    FOXY_SAFETY_RAILS,
    buildAcademicGoalSection(academicGoal),
    buildCognitivePromptSection(cognitiveCtx),
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

// ─── Helper: check and increment daily quota (atomic via RPC) ────────────────

async function checkAndIncrementQuota(
  studentId: string,
  plan: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const normalizedPlan = normalizePlan(plan);
  const limit = DAILY_QUOTA[normalizedPlan] ?? DEFAULT_QUOTA;
  const today = new Date().toISOString().split('T')[0];

  const { data: rows, error } = await supabaseAdmin.rpc('check_and_record_usage', {
    p_student_id: studentId,
    p_feature: 'foxy_chat',
    p_limit: limit,
    p_usage_date: today,
  });

  if (error) {
    logger.error('foxy_quota_check_failed', { error: error.message, studentId });
    return { allowed: false, remaining: 0 };
  }

  const row = rows?.[0];
  if (!row?.allowed) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: Math.max(0, limit - (row.current_count ?? 0)) };
}

/**
 * Refund one foxy_chat usage count on the student's daily usage row. Called
 * after an upstream failure (circuit open, grounded-answer service down,
 * chapter not yet ingested) so the student doesn't "lose" a message to an
 * error they didn't cause. Best-effort — a DB failure here is logged but
 * doesn't propagate.
 */
async function refundQuota(studentId: string, feature: string): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: row } = await supabaseAdmin
      .from('student_daily_usage')
      .select('usage_count')
      .eq('student_id', studentId)
      .eq('feature', feature)
      .eq('usage_date', today)
      .single();
    if (row && typeof row.usage_count === 'number' && row.usage_count > 0) {
      await supabaseAdmin
        .from('student_daily_usage')
        .update({ usage_count: row.usage_count - 1, updated_at: new Date().toISOString() })
        .eq('student_id', studentId)
        .eq('feature', feature)
        .eq('usage_date', today);
    }
  } catch (err) {
    logger.warn('foxy_quota_refund_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
      feature,
    });
  }
}

// ─── Legacy-flow delegate (kill-switch path) ────────────────────────────────
//
// When `ff_grounded_ai_foxy` is OFF we still want a working Foxy. The inline
// Voyage+Claude pipeline has been deleted from this route; the fallback now
// delegates to the existing intent-router workflow (src/lib/ai/) which is
// independent of the grounded-answer service and has been the production path
// behind `ai_intent_router` for several weeks. If ops need to roll back
// further than the intent router (e.g., if the AI layer itself breaks), the
// foxy-tutor Edge Function can be re-invoked via the mobile/Flutter code path
// until Phase 4 deletion lands.

async function runLegacyFoxyFlow(params: {
  studentId: string;
  resolvedSessionId: string;
  message: string;
  subject: string;
  grade: string;
  chapter: string | null;
  board: string;
  mode: string;
  academicGoal: string | null;
  history: ChatMessage[];
}): Promise<{
  response: string;
  sources: RagSource[];
  diagrams: DiagramRef[];
  tokensUsed: number;
  model: string;
  traceId: string;
  intent: string;
}> {
  const classification = await classifyIntent(params.message, params.subject, params.grade, params.mode);
  const result = await routeIntent(classification.intent, params.message, {
    subject: params.subject,
    grade: params.grade,
    board: params.board,
    chapter: params.chapter,
    mode: params.mode,
    history: params.history,
    academicGoal: params.academicGoal,
    studentId: params.studentId,
    sessionId: params.resolvedSessionId,
  });

  const sources: RagSource[] = result.sources.map((c) => ({
    chunk_id: c.id,
    subject: c.subject,
    chapter: c.chapter,
    page_number: c.pageNumber,
    similarity: c.similarity,
    content_preview: c.content.slice(0, 150),
    media_url: c.mediaUrl || null,
  }));

  const diagrams: DiagramRef[] = result.sources
    .filter((c) => c.mediaUrl)
    .map((c) => ({
      url: c.mediaUrl!,
      title: c.chapter || params.subject,
      pageNumber: c.pageNumber,
      description: c.mediaDescription || `NCERT ${params.subject} ${c.chapter || ''}`.trim(),
    }));

  return {
    response: result.response,
    sources,
    diagrams,
    tokensUsed: result.tokensUsed,
    model: result.model,
    traceId: result.traceId,
    intent: classification.intent,
  };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // TOP-LEVEL SAFETY NET — no unhandled exception can crash Foxy.
  try {
    return await handleFoxyPost(request);
  } catch (topLevelErr) {
    const diagMsg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    console.error('[FOXY CRITICAL] Unhandled exception in POST handler:', diagMsg);
    try {
      const { logOpsEvent } = await import('@/lib/ops-events');
      await logOpsEvent({
        category: 'ai',
        source: 'foxy-route',
        severity: 'critical',
        message: `Foxy unhandled crash: ${diagMsg.slice(0, 200)}`,
        context: { stack: topLevelErr instanceof Error ? topLevelErr.stack?.slice(0, 500) : undefined },
      });
    } catch { /* even ops logging failed — nothing more we can do */ }
    return errorJson(
      'Foxy encountered an error. Please try again.',
      'Foxy mein error aaya. Dobara try karein.',
      503,
      { _diag: diagMsg.slice(0, 300) },
    );
  }
}

async function handleFoxyPost(request: NextRequest): Promise<Response> {
  // 1. Auth
  const auth = await authorizeRequest(request, 'foxy.chat', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  // 1b. Global AI kill switch (ai_usage_global)
  // Seeded by 20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql with
  // default true. Flip OFF in the super-admin console to halt ALL Claude
  // calls (foxy/ncert-solver/quiz-gen/scan-solve) without redeploying.
  // 503 + Retry-After=60 lets the client retry once the switch flips back on.
  if (!(await isFeatureEnabled('ai_usage_global'))) {
    logger.warn('foxy: ai_usage_global kill switch active');
    return new NextResponse(
      JSON.stringify({
        success: false,
        error: 'Foxy is temporarily unavailable. Please try again in a minute.',
        error_hi: 'Foxy abhi available nahi hai. Kripya thodi der baad try karein.',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } },
    );
  }

  // 2. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return errorJson('Invalid request body.', 'Request body galat hai.', 400);
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const grade = typeof body.grade === 'string' ? body.grade.trim() : '';
  const chapter = typeof body.chapter === 'string' ? body.chapter.trim() || null : null;
  const board = typeof body.board === 'string' ? body.board.trim() || 'CBSE' : 'CBSE';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() || null : null;
  const mode = typeof body.mode === 'string' && VALID_MODES.includes(body.mode) ? body.mode : 'learn';
  // Phase 2.2: optional coaching mode. If the client passes one, we honor
  // it. Otherwise we pick a default later, after mastery is known
  // (mastery < 0.6 → 'socratic', else → 'answer').
  const requestedCoachMode: CoachMode | null =
    typeof body.coachMode === 'string' && (VALID_COACH_MODES as readonly string[]).includes(body.coachMode)
      ? (body.coachMode as CoachMode)
      : null;
  // Phase 1.1: optional `stream:true` body param. Default false to preserve
  // backward compatibility with mobile, ncert-solver, and any non-Foxy callers.
  // The streaming path is gated by `ff_foxy_streaming` (DB feature flag).
  const wantsStream = body.stream === true;

  // 3. Validate inputs
  if (!message) {
    return errorJson('Message is required.', 'Message likhna zaroori hai.', 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorJson(
      `Message too long (max ${MAX_MESSAGE_LENGTH} characters).`,
      `Message bahut lamba hai (max ${MAX_MESSAGE_LENGTH} characters).`,
      400,
    );
  }
  if (!subject) {
    return errorJson('Subject is required.', 'Subject batana zaroori hai.', 400);
  }
  if (!grade || !VALID_GRADES.includes(grade)) {
    return errorJson('Valid grade (6–12) is required.', 'Grade 6 se 12 ke beech hona chahiye.', 400);
  }

  // 4. Resolve student ID and validate subject governance
  //
  // Subject governance (422) MUST run before the config/env validation (503)
  // below: a denied subject is a product-contract denial that is true
  // regardless of whether our backend is fully wired, and surfacing 503
  // instead of 422 would leak infra state to the client and flip the
  // C4/C5 governance regression catalog entries.
  const studentId = auth.studentId!;

  try {
    const subjectValidation = await validateSubjectWrite(studentId, subject, {
      supabase: supabaseAdmin,
    });
    if (!subjectValidation.ok) {
      return NextResponse.json(
        {
          error: subjectValidation.error.code,
          subject: subjectValidation.error.subject,
          reason: subjectValidation.error.reason,
          allowed: subjectValidation.error.allowed,
        },
        { status: 422 },
      );
    }
  } catch (govErr) {
    logger.warn('foxy_subject_governance_unavailable', {
      error: govErr instanceof Error ? govErr.message : String(govErr),
      subject,
      studentId,
      note: 'Proceeding without subject governance — migrations may not be applied',
    });
  }

  // 4a. Config validation — fail fast with clear diagnostic.
  // ANTHROPIC_API_KEY lives on the Edge Function side now, but the service-role
  // key MUST be set for callGroundedAnswer() to auth against the Edge Function.
  // Runs AFTER subject governance (see note above).
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    logger.error('foxy_config_missing', {
      variable: !process.env.SUPABASE_SERVICE_ROLE_KEY
        ? 'SUPABASE_SERVICE_ROLE_KEY'
        : 'NEXT_PUBLIC_SUPABASE_URL',
    });
    return errorJson(
      'Foxy is not configured. Please contact support.',
      'Foxy configure nahi hai. Support se sampark karein.',
      503,
      { _diag: 'Supabase env vars not set' },
    );
  }

  let plan = 'free';
  let academicGoal: string | null = null;
  try {
    const { data: studentRow } = await supabaseAdmin
      .from('students')
      .select('subscription_plan, account_status, academic_goal')
      .eq('id', studentId)
      .single();
    if (studentRow?.subscription_plan) plan = normalizePlan(studentRow.subscription_plan);
    if (studentRow?.academic_goal) academicGoal = studentRow.academic_goal;
    if (studentRow?.account_status === 'suspended') {
      return errorJson('Your account is suspended.', 'Aapka account suspend hai.', 403);
    }
  } catch { /* Non-fatal — use default free plan */ }

  // 5. Quota check
  const { allowed, remaining } = await checkAndIncrementQuota(studentId, plan);
  if (!allowed) {
    return errorJson(
      'Daily Foxy chat limit reached. Upgrade your plan or try again tomorrow.',
      'Aaj ke Foxy chats khatam ho gaye. Kal dobara try karein ya plan upgrade karein.',
      429,
      { quotaRemaining: 0 },
    );
  }

  // 6. Resolve or create session
  let resolvedSessionId: string;
  try {
    resolvedSessionId = await resolveSession(studentId, subject, grade, chapter, mode, sessionId);
  } catch (err) {
    logger.error('foxy_session_create_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      studentId,
    });
    return errorJson(
      'Failed to start chat session. Please try again.',
      'Chat session shuru nahi ho paya. Dobara try karein.',
      500,
    );
  }

  // 7. Load cognitive context + history + prior-session context (parallel, non-fatal on failure)
  let cognitiveCtx: CognitiveContext = EMPTY_COGNITIVE_CONTEXT;
  let history: ChatMessage[] = [];
  let priorSessionTurns: PriorSessionTurn[] = [];
  try {
    const [ctx, hist, prior] = await Promise.all([
      loadCognitiveContext(studentId, subject, grade, chapter),
      loadHistory(resolvedSessionId),
      loadPriorSessionContext(studentId, subject, grade, resolvedSessionId, chapter),
    ]);
    cognitiveCtx = ctx;
    history = hist;
    priorSessionTurns = prior;
  } catch (ctxErr) {
    logger.warn('foxy_context_load_failed', {
      error: ctxErr instanceof Error ? ctxErr.message : String(ctxErr),
      studentId,
    });
  }

  // 8. Feature-flag gated: use grounded-answer service OR legacy inline flow.
  // `ff_grounded_ai_foxy` is the Phase 3 kill switch. When OFF we fall back to
  // the existing intent-router (src/lib/ai/workflows/*) which has been the
  // production path behind `ai_intent_router` and is independent of the new
  // Edge Function.
  const useGroundedService = await isFeatureEnabled('ff_grounded_ai_foxy', {
    role: 'student',
    userId: auth.userId!,
  });

  if (!useGroundedService) {
    // ─── Legacy flow (kill-switch path) ────────────────────────────────────
    try {
      const legacy = await runLegacyFoxyFlow({
        studentId,
        resolvedSessionId,
        message,
        subject,
        grade,
        chapter,
        board,
        mode,
        academicGoal,
        history,
      });

      // Persist turns (non-fatal)
      const now = new Date().toISOString();
      try {
        await supabaseAdmin.from('foxy_chat_messages').insert([
          {
            session_id: resolvedSessionId,
            student_id: studentId,
            role: 'user',
            content: message,
            sources: null,
            tokens_used: null,
            created_at: now,
          },
          {
            session_id: resolvedSessionId,
            student_id: studentId,
            role: 'assistant',
            content: legacy.response,
            sources: legacy.sources.length > 0 ? legacy.sources : null,
            tokens_used: legacy.tokensUsed,
            created_at: new Date(Date.now() + 1).toISOString(),
          },
        ]);
      } catch (saveErr) {
        console.warn('[foxy] legacy message save failed:', saveErr instanceof Error ? saveErr.message : String(saveErr));
      }

      logAudit(auth.userId!, {
        action: 'foxy.chat',
        resourceType: 'foxy_sessions',
        resourceId: resolvedSessionId,
        details: {
          subject, grade, chapter, mode,
          intent: legacy.intent,
          tokensUsed: legacy.tokensUsed,
          model: legacy.model,
          traceId: legacy.traceId,
          ragChunksFound: legacy.sources.length,
          flow: 'legacy-intent-router',
        },
      });

      // Phase 0: NCERT surfaces (sources, diagrams) are intentionally NOT
      // returned to the client. Retrieval still happens server-side and
      // citations are still injected into the system prompt for grounding,
      // but the student-facing wire shape no longer exposes the raw chunks.
      // Server-side persistence to foxy_chat_messages.sources is preserved
      // above for analytics and debug.
      //
      // Phase 0 Fix 0.5: legacy intent-router path. groundedFromChunks is
      // approximated as `sources.length > 0` — the legacy path doesn't run
      // the soft-mode escape detection, so this is a conservative proxy
      // ("we retrieved chunks AND the LLM produced a response").
      return NextResponse.json({
        success: true,
        response: legacy.response,
        sessionId: resolvedSessionId,
        quotaRemaining: remaining,
        tokensUsed: legacy.tokensUsed,
        groundingStatus: 'grounded' as const,
        groundedFromChunks: legacy.sources.length > 0,
        citationsCount: legacy.sources.length,
        traceId: legacy.traceId,
      });
    } catch (legacyErr) {
      logger.error('foxy_legacy_flow_failed', {
        error: legacyErr instanceof Error ? legacyErr : new Error(String(legacyErr)),
        studentId,
      });
      // Refund quota — student didn't get a usable answer.
      await refundQuota(studentId, 'foxy_chat');
      return errorJson(
        'Foxy is temporarily unavailable. Please try again in a moment.',
        'Foxy abhi available nahi hai. Thodi der mein dobara try karein.',
        503,
      );
    }
  }

  // ─── Grounded-answer service path (default) ──────────────────────────────
  const chapterNum: number | null =
    chapter && /^\d+$/.test(chapter) ? parseInt(chapter, 10) : null;
  const chapterTitle: string | null =
    chapter && chapterNum === null ? chapter : null;

  // Compose the safety-railed system prompt. The grounded-answer service has
  // its own template, but we pass ours as `foxy_safety_rails` so the final
  // rendered prompt includes the Next.js-side rails for defense-in-depth.
  const foxySystemPrompt = buildSystemPrompt({
    grade,
    subject,
    chapter,
    mode,
    academicGoal,
    cognitiveCtx,
  });

  // Phase 2.2: resolve the coaching mode from explicit request + mastery.
  const coachMode = resolveCoachMode(requestedCoachMode, cognitiveCtx.masteryLevel);

  const groundedRequest: GroundedRequest = {
    caller: 'foxy',
    student_id: studentId,
    query: message,
    scope: {
      board: 'CBSE',
      grade,
      subject_code: subject,
      chapter_number: chapterNum,
      chapter_title: chapterTitle,
    },
    mode: 'soft',
    generation: {
      model_preference: 'auto',
      max_tokens: 1024,
      temperature: 0.3,
      system_prompt_template: 'foxy_tutor_v1',
      template_variables: {
        grade,
        subject,
        chapter: chapter ?? '',
        mode,
        // Phase 2.2: coaching mode and its instruction line, consumed by
        // the rewritten foxy_tutor_v1 template.
        coach_mode: coachMode.toUpperCase(),
        coach_mode_instruction: COACH_MODE_INSTRUCTIONS[coachMode],
        academic_goal_section: buildAcademicGoalSection(academicGoal),
        cognitive_context_section: buildCognitivePromptSection(cognitiveCtx),
        // Phase 2: curated misconception ontology — fires the
        // MISCONCEPTION_REPAIR branch in foxy_tutor_v1 with real data.
        // Empty string when no misconceptions observed (template-safe).
        misconception_section: buildMisconceptionPromptSection(cognitiveCtx.recentMisconceptions),
        // Task 1.3: cross-session memory. Empty string when no prior sessions
        // (template handles missing variables as empty by design).
        previous_session_context: buildPriorSessionPromptSection(priorSessionTurns),
        foxy_safety_rails: FOXY_SAFETY_RAILS,
        foxy_system_prompt: foxySystemPrompt,
        history_messages: JSON.stringify(history),
        board,
      },
    },
    retrieval: { match_count: RAG_MATCH_COUNT },
    timeout_ms: PER_PLAN_TIMEOUT_MS[plan] ?? 20000,
  };

  // Hop timeout = service timeout + 2s buffer so we let the service return its
  // own abstain payload rather than giving up at the transport layer.
  const hopTimeoutMs = (PER_PLAN_TIMEOUT_MS[plan] ?? 20000) + 2000;

  // ─── Phase 1.1: streaming branch (opt-in via body.stream + ff_foxy_streaming) ──
  if (wantsStream) {
    const streamingEnabled = await isFeatureEnabled('ff_foxy_streaming', {
      role: 'student',
      userId: auth.userId!,
    });
    if (streamingEnabled) {
      // The streaming pipeline writes to foxy_chat_messages once the stream
      // completes (server side, after capturing full text). Quota was already
      // incremented in step 5 above; if the stream fails BEFORE done arrives
      // we refund it. If the stream succeeds we keep the deduction.
      return await handleStreamingFoxyTurn({
        groundedRequest,
        hopTimeoutMs,
        studentId,
        userId: auth.userId!,
        resolvedSessionId,
        message,
        subject,
        grade,
        chapter,
        mode,
        cognitiveCtx,
      });
    }
    // Streaming requested but flag off → silently fall through to blocking.
  }

  // Single retrieval: grounded-answer service handles embed+RRF+rerank. Audit 2026-04-27 F11.
  const grounded = await callGroundedAnswer(groundedRequest, { hopTimeoutMs });

  // ─── Handle abstain ──────────────────────────────────────────────────────
  if (!grounded.grounded) {
    if (REFUND_ABSTAIN_REASONS.includes(grounded.abstain_reason)) {
      await refundQuota(studentId, 'foxy_chat');
    }

    logger.info('foxy_grounded_abstain', {
      studentId,
      subject,
      grade,
      chapter,
      abstainReason: grounded.abstain_reason,
      traceId: grounded.trace_id,
      latencyMs: grounded.meta.latency_ms,
    });

    logAudit(auth.userId!, {
      action: 'foxy.chat.abstain',
      resourceType: 'foxy_sessions',
      resourceId: resolvedSessionId,
      details: {
        subject, grade, chapter, mode,
        abstainReason: grounded.abstain_reason,
        traceId: grounded.trace_id,
      },
    });

    const suggestedAlternatives: SuggestedAlternative[] = grounded.suggested_alternatives;

    // Compute a fresh quotaRemaining (if we refunded, the student gets the
    // message back; otherwise the existing `remaining` value is still correct
    // since check_and_record_usage returned post-increment count).
    const effectiveRemaining = REFUND_ABSTAIN_REASONS.includes(grounded.abstain_reason)
      ? remaining + 1
      : remaining;

    // Phase 0: do NOT echo sources/diagrams to the client.
    return NextResponse.json({
      success: true,
      response: '',
      sessionId: resolvedSessionId,
      quotaRemaining: effectiveRemaining,
      tokensUsed: 0,
      groundingStatus: 'hard-abstain' as const,
      abstainReason: grounded.abstain_reason,
      suggestedAlternatives,
      traceId: grounded.trace_id,
    });
  }

  // ─── Grounded response — normalize + persist ─────────────────────────────
  // Any answer reaching here came through the grounded-answer pipeline with
  // NCERT chunks retrieved via Voyage RAG and (in strict mode) verified by
  // the grounding-check stage. Low-confidence cases already abstain inside
  // the pipeline (returning hard-abstain). So if grounded.grounded === true
  // here, the answer IS curriculum-grounded by definition — never surface
  // the "unverified curriculum" banner because it confuses students about
  // the source of their answer when the source is in fact NCERT.
  const isUnverified = false;
  void SOFT_CONFIDENCE_BANNER_THRESHOLD; // intentionally unused — see note

  // Convert Citation[] → RagSource[] for backward-compat with existing clients.
  const sources: RagSource[] = grounded.citations.map((c: Citation) => ({
    chunk_id: c.chunk_id,
    subject,
    chapter: c.chapter_title || (c.chapter_number ? `Chapter ${c.chapter_number}` : undefined),
    page_number: c.page_number ?? undefined,
    similarity: c.similarity,
    content_preview: c.excerpt.slice(0, 150),
    media_url: c.media_url,
  }));

  const diagrams: DiagramRef[] = grounded.citations
    .filter((c: Citation) => c.media_url)
    .map((c: Citation) => ({
      url: c.media_url!,
      title: c.chapter_title || subject,
      pageNumber: c.page_number ?? undefined,
      description: `NCERT ${subject} ${c.chapter_title || ''}`.trim(),
    }));

  // ─── Extract + validate structured payload (defense-in-depth) ──────────
  // The grounded-answer service may return a structured FoxyResponse alongside
  // the plain `answer` string. We validate at the API boundary so the JSONB
  // column we are about to write cannot be poisoned by an upstream bug. If
  // validation fails the helper returns null and logs once; the legacy
  // `answer` string is still persisted in `content` so the turn is preserved.
  const structured = extractValidatedStructured(grounded, {
    traceId: grounded.trace_id,
    studentId,
    subject,
    grade,
  });

  // When `structured` is present, the canonical assistant text is the
  // denormalized rendering (title + blocks → flat string with `$$ ... $$`
  // wrappers around math). When absent (legacy/kill-switch/malformed), keep
  // the existing behavior of storing the raw `answer` string.
  const assistantContent = structured
    ? denormalizeFoxyResponse(structured)
    : grounded.answer;

  // Persist both turns (non-fatal — response already generated)
  const now = new Date().toISOString();
  try {
    await supabaseAdmin.from('foxy_chat_messages').insert([
      {
        session_id: resolvedSessionId,
        student_id: studentId,
        role: 'user',
        content: message,
        sources: null,
        tokens_used: null,
        created_at: now,
      },
      {
        session_id: resolvedSessionId,
        student_id: studentId,
        role: 'assistant',
        content: assistantContent,
        // CHECK constraint `structured_role_check` permits structured only on
        // assistant rows; the column is nullable so legacy/fallback writes
        // explicitly null. Migration: 20260430010000_foxy_chat_messages_add_structured.
        structured: structured ?? null,
        sources: sources.length > 0 ? sources : null,
        tokens_used: grounded.meta.tokens_used,
        created_at: new Date(Date.now() + 1).toISOString(),
      },
    ]);
  } catch (saveErr) {
    console.warn('[foxy] message save failed:', saveErr instanceof Error ? saveErr.message : String(saveErr));
  }

  // Post-response cognitive logging (fire-and-forget)
  if (cognitiveCtx.nextAction) {
    Promise.resolve(
      supabaseAdmin
        .from('cme_action_log')
        .insert({
          student_id: studentId,
          action_type: cognitiveCtx.nextAction.actionType,
          concept_id: null,
          reason: cognitiveCtx.nextAction.reason,
          was_followed: true,
          outcome: 'foxy_responded',
        }),
    ).catch((err: unknown) => {
      console.warn('[foxy] cognitive action log failed:', err instanceof Error ? err.message : String(err));
    });
  }

  Promise.resolve(
    supabaseAdmin
      .from('foxy_sessions')
      .update({
        cognitive_context_loaded: true,
        last_cme_action: cognitiveCtx.nextAction?.actionType ?? null,
      })
      .eq('id', resolvedSessionId),
  ).catch((err: unknown) => {
    console.warn('[foxy] session cognitive update failed:', err instanceof Error ? err.message : String(err));
  });

  logAudit(auth.userId!, {
    action: 'foxy.chat',
    resourceType: 'foxy_sessions',
    resourceId: resolvedSessionId,
    details: {
      subject, grade, chapter, mode,
      tokensUsed: grounded.meta.tokens_used,
      model: grounded.meta.claude_model,
      traceId: grounded.trace_id,
      confidence: grounded.confidence,
      ragChunksFound: grounded.citations.length,
      cognitiveContextLoaded: true,
      masteryLevel: cognitiveCtx.masteryLevel,
      weakTopicCount: cognitiveCtx.weakTopics.length,
      knowledgeGapCount: cognitiveCtx.knowledgeGaps.length,
      revisionDueCount: cognitiveCtx.revisionDue.length,
      cmeAction: cognitiveCtx.nextAction?.actionType ?? null,
      flow: 'grounded-answer',
      // Adoption telemetry for the structured-rendering rollout. `true` only
      // when the upstream returned a structured payload AND it passed the
      // boundary validation. Helps ops measure (a) Edge Function rollout
      // progress and (b) malformed-payload rate (gap between
      // upstream-presence and persisted-presence).
      structured_present: structured !== null,
    },
  });

  // Build soft upgrade prompt if quota near exhaustion
  const limit = DAILY_QUOTA[plan] ?? DEFAULT_QUOTA;
  const upgradeConfig = UPGRADE_PROMPTS[plan];
  let upgradePrompt: { message: string; messageHi: string; nextPlan: string; remaining: number } | null = null;
  if (upgradeConfig && typeof remaining === 'number' && remaining <= (limit - upgradeConfig.threshold)) {
    upgradePrompt = {
      message: upgradeConfig.message.replace('{remaining}', String(remaining)),
      messageHi: upgradeConfig.messageHi.replace('{remaining}', String(remaining)),
      nextPlan: upgradeConfig.nextPlan,
      remaining,
    };
  }

  // Phase 0: NCERT surfaces (sources, diagrams) are NOT echoed to the client.
  // Server-side persistence and grounding still use them; this strip only
  // affects the wire shape so the student UI never displays raw NCERT
  // citations. `sources` is still computed above and saved to
  // foxy_chat_messages.sources for analytics/debug.
  void diagrams;

  // Phase 0 Fix 0.5: surface groundedFromChunks + citationsCount so the
  // client analytics layer can emit honest `was_grounded` telemetry.
  // Default to `false` if the service didn't include the field (e.g. an old
  // cached response from before Fix 0.5 shipped) — conservative: don't claim
  // grounding we can't prove.
  const groundedFromChunks =
    grounded.groundedFromChunks === true ? true : false;
  const citationsCount = grounded.citations.length;

  return NextResponse.json({
    success: true,
    // `response` stays as the legacy plain string for backward compat. New
    // clients should prefer `structured` when present and fall back to
    // `response` only when `structured` is absent (legacy/kill-switch/
    // upstream-without-structured/malformed-payload paths).
    response: grounded.answer,
    sessionId: resolvedSessionId,
    quotaRemaining: remaining,
    tokensUsed: grounded.meta.tokens_used,
    confidence: grounded.confidence,
    groundingStatus: isUnverified ? ('unverified' as const) : ('grounded' as const),
    groundedFromChunks,
    citationsCount,
    traceId: grounded.trace_id,
    ...(upgradePrompt ? { upgradePrompt } : {}),
    // Only include `structured` when the helper produced a validated payload.
    // Omitting (vs. including null) keeps the wire shape backward-compatible
    // with clients that haven't been updated to read this field yet.
    ...(structured ? { structured } : {}),
  });
}

// ─── Streaming turn handler (Phase 1.1) ─────────────────────────────────────
//
// Pipes the upstream SSE stream from the grounded-answer Edge Function to the
// browser, while taking a side-channel tap so we can:
//   1. Persist the full assistant turn to foxy_chat_messages on `done`
//   2. Refund quota on `error` or premature stream end
//   3. Emit logAudit + analytics on completion
//
// Wire shape — each SSE event has a named `event:` and a JSON payload:
//   metadata → {groundingStatus, citations, traceId, confidence}  (once)
//   text     → {delta}                                             (N times)
//   done     → {tokensUsed, latencyMs, groundedFromChunks, claudeModel, answerLength}
//   abstain  → {abstainReason, suggestedAlternatives, traceId, latencyMs}
//   error    → {reason, traceId, latencyMs}
//
// We add ONE additional event we synthesize in this layer (so the browser
// has everything it needs without a follow-up REST call):
//   session  → {sessionId}                                         (first frame)
async function handleStreamingFoxyTurn(params: {
  groundedRequest: GroundedRequest;
  hopTimeoutMs: number;
  studentId: string;
  userId: string;
  resolvedSessionId: string;
  message: string;
  subject: string;
  grade: string;
  chapter: string | null;
  mode: string;
  cognitiveCtx: CognitiveContext;
}): Promise<Response> {
  const upstream = await callGroundedAnswerStream(params.groundedRequest, {
    hopTimeoutMs: params.hopTimeoutMs,
  });

  if (!upstream.ok) {
    // Hop failed (service down, network error, config). Refund quota and
    // surface a synthetic error event so the client can render the same
    // UI as a streamed error.
    await refundQuota(params.studentId, 'foxy_chat');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (eventName: string, payload: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        };
        send('session', { sessionId: params.resolvedSessionId });
        send('error', {
          reason: upstream.reason,
          traceId: 'pending',
          latencyMs: 0,
        });
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: streamingHeaders(),
    });
  }

  if (!upstream.response.body) {
    await refundQuota(params.studentId, 'foxy_chat');
    return new Response('upstream returned no body', { status: 502 });
  }

  // Transform stream that:
  //  (a) re-emits each frame to the client byte-for-byte (low-latency)
  //  (b) parses each frame so we can capture full text + done payload
  let accumulatedText = '';
  let parseBuffer = '';
  let doneSeen = false;
  let errorSeen = false;
  let lastTraceId = 'pending';
  let lastTokensUsed = 0;
  let lastClaudeModel = '';
  let lastGroundedFromChunks = false;
  let lastCitations: Citation[] = [];
  // Synthesize a leading `session` event so the client knows the sessionId
  // up front (Edge Function doesn't know it).
  const encoder = new TextEncoder();
  const sessionFrame = encoder.encode(
    `event: session\ndata: ${JSON.stringify({ sessionId: params.resolvedSessionId })}\n\n`,
  );

  const finalizeOnError = async () => {
    if (errorSeen || doneSeen) return; // already handled
    await refundQuota(params.studentId, 'foxy_chat');
  };

  const persistOnDone = async () => {
    try {
      const now = new Date().toISOString();
      await supabaseAdmin.from('foxy_chat_messages').insert([
        {
          session_id: params.resolvedSessionId,
          student_id: params.studentId,
          role: 'user',
          content: params.message,
          sources: null,
          tokens_used: null,
          created_at: now,
        },
        {
          session_id: params.resolvedSessionId,
          student_id: params.studentId,
          role: 'assistant',
          content: accumulatedText,
          sources: lastCitations.length > 0
            ? lastCitations.map((c) => ({
                chunk_id: c.chunk_id,
                subject: params.subject,
                chapter: c.chapter_title || (c.chapter_number ? `Chapter ${c.chapter_number}` : undefined),
                page_number: c.page_number ?? undefined,
                similarity: c.similarity,
                content_preview: c.excerpt.slice(0, 150),
                media_url: c.media_url,
              }))
            : null,
          tokens_used: lastTokensUsed,
          created_at: new Date(Date.now() + 1).toISOString(),
        },
      ]);
    } catch (err) {
      console.warn('[foxy] streaming message save failed:', err instanceof Error ? err.message : String(err));
    }

    try {
      logAudit(params.userId, {
        action: 'foxy.chat',
        resourceType: 'foxy_sessions',
        resourceId: params.resolvedSessionId,
        details: {
          subject: params.subject,
          grade: params.grade,
          chapter: params.chapter,
          mode: params.mode,
          tokensUsed: lastTokensUsed,
          model: lastClaudeModel,
          traceId: lastTraceId,
          ragChunksFound: lastCitations.length,
          masteryLevel: params.cognitiveCtx.masteryLevel,
          flow: 'grounded-answer-stream',
          groundedFromChunks: lastGroundedFromChunks,
        },
      });
    } catch { /* audit log is non-critical */ }
  };

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      controller.enqueue(sessionFrame);
    },
    transform(chunk, controller) {
      // Re-emit verbatim to client (preserves exact SSE formatting).
      controller.enqueue(chunk);
      // Parse for our side-channel tracking.
      parseBuffer += new TextDecoder().decode(chunk);
      let sepIdx: number;
      while ((sepIdx = parseBuffer.indexOf('\n\n')) !== -1) {
        const rawEvent = parseBuffer.slice(0, sepIdx);
        parseBuffer = parseBuffer.slice(sepIdx + 2);
        const eventLine = rawEvent.split('\n').find((l) => l.startsWith('event: '));
        const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
        if (!eventLine || !dataLine) continue;
        const eventName = eventLine.slice(7).trim();
        let payload: any = null;
        try {
          payload = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        if (eventName === 'metadata') {
          if (payload?.traceId) lastTraceId = payload.traceId;
          if (Array.isArray(payload?.citations)) lastCitations = payload.citations;
        } else if (eventName === 'text') {
          if (typeof payload?.delta === 'string') accumulatedText += payload.delta;
        } else if (eventName === 'done') {
          doneSeen = true;
          if (typeof payload?.tokensUsed === 'number') lastTokensUsed = payload.tokensUsed;
          if (typeof payload?.claudeModel === 'string') lastClaudeModel = payload.claudeModel;
          if (typeof payload?.groundedFromChunks === 'boolean') {
            lastGroundedFromChunks = payload.groundedFromChunks;
          }
        } else if (eventName === 'abstain') {
          // Abstain → refund based on the same policy as the blocking path
          if (
            payload?.abstainReason &&
            REFUND_ABSTAIN_REASONS.includes(payload.abstainReason as AbstainReason)
          ) {
            // Fire-and-forget — we're inside transform(), can't await
            void refundQuota(params.studentId, 'foxy_chat');
          }
          errorSeen = true; // treat as terminal (not a `done`)
          if (payload?.traceId) lastTraceId = payload.traceId;
        } else if (eventName === 'error') {
          errorSeen = true;
          if (payload?.traceId) lastTraceId = payload.traceId;
        }
      }
    },
    async flush() {
      if (doneSeen) {
        // Persist on completion (fire-and-forget — stream already closed for client).
        void persistOnDone();
      } else {
        // Stream closed without a `done` event → refund (defensive).
        await finalizeOnError();
      }
    },
  });

  // Pipe upstream → transform → response
  const responseStream = upstream.response.body.pipeThrough(transform);

  return new Response(responseStream, {
    status: 200,
    headers: streamingHeaders(),
  });
}

function streamingHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

// ─── GET: fetch chat history for a session ────────────────────────────────────

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorizeRequest(request, 'foxy.chat', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    return errorJson('sessionId is required.', 'sessionId dena zaroori hai.', 400);
  }

  const studentId = auth.studentId!;

  const { data: session } = await supabaseAdmin
    .from('foxy_sessions')
    .select('id, subject, grade, chapter, mode, created_at')
    .eq('id', sessionId)
    .eq('student_id', studentId)
    .single();

  if (!session) {
    return errorJson('Session not found.', 'Session nahi mila.', 404);
  }

  // Phase 0: do NOT return persisted `sources` to the client. The column
  // remains populated server-side for analytics/debug, but the GET handler
  // intentionally excludes it from the SELECT so it cannot leak.
  //
  // Phase 2 (structured rendering): include the `structured` JSONB column so
  // the chat page can re-render historical assistant turns with the structured
  // renderer on session resume. NULL for legacy assistant rows persisted
  // before the structured-output migration; the renderer falls back to
  // `content` (TEXT) in that case. User rows are NULL by DB CHECK constraint
  // (`structured_role_check` in migration 20260430010000).
  const { data: messages } = await supabaseAdmin
    .from('foxy_chat_messages')
    .select('id, role, content, structured, tokens_used, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    success: true,
    session,
    messages: messages ?? [],
  });
}