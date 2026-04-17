/**
 * /api/foxy — Foxy AI Tutor Chat Endpoint
 *
 * Architecture:
 *  1. RBAC auth guard (foxy.chat permission)
 *  2. Daily quota enforcement (foxy_chats_used in student_daily_usage)
 *  3. Session continuity (foxy_sessions table)
 *  4. Cognitive context loading — concept_mastery, knowledge_gaps, cme_error_log, CME next-action
 *  5. RAG retrieval — Voyage voyage-3 embedding → match_rag_chunks RPC
 *  6. Context-aware response — Claude claude-haiku-4-5-20251001 (fallback: claude-sonnet-4-20250514)
 *  7. Persist turn to foxy_chat_messages + cognitive action logging
 *  8. Audit log
 *
 * POST /api/foxy
 * Body: { message, subject, grade, chapter?, board?, sessionId?, mode? }
 * Response: { response, sources, sessionId, quotaRemaining, tokensUsed }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { classifyIntent, routeIntent } from '@/lib/ai';
import { validateSubjectWrite } from '@/lib/subjects';

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const VALID_MODES = ['learn', 'explain', 'practice', 'revise'];
const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_TURNS = 6;       // last 6 turns = 12 messages for context
const RAG_MATCH_COUNT = 5;
const RAG_MIN_QUALITY = 0.4;
const SESSION_IDLE_MINUTES = 30;

// Quota per plan per day
const DAILY_QUOTA: Record<string, number> = {
  free: 10,
  starter: 30,
  pro: 100,
  unlimited: 999999, // effectively unlimited
};
const DEFAULT_QUOTA = 10;

// API timeout per plan (milliseconds) — paying students get more patience
// Free: 8s (budget), Starter: 15s (good), Pro: 25s (premium), Unlimited: 30s (max)
const VOYAGE_TIMEOUT: Record<string, number> = {
  free: 8000,
  starter: 15000,
  pro: 25000,
  unlimited: 30000,
};
const CLAUDE_TIMEOUT: Record<string, number> = {
  free: 15000,
  starter: 30000,
  pro: 45000,
  unlimited: 60000,
};
const DEFAULT_VOYAGE_TIMEOUT = 8000;
const DEFAULT_CLAUDE_TIMEOUT = 15000;

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
}

const EMPTY_COGNITIVE_CONTEXT: CognitiveContext = {
  weakTopics: [],
  strongTopics: [],
  knowledgeGaps: [],
  revisionDue: [],
  recentErrors: [],
  nextAction: null,
  masteryLevel: 'medium',
};

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
  // If client provided a sessionId, verify it belongs to this student and is still active
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
      // Touch last_active_at
      await supabaseAdmin
        .from('foxy_sessions')
        .update({ last_active_at: new Date().toISOString() })
        .eq('id', providedSessionId);
      return providedSessionId;
    }
    // Session expired or not found — fall through to create new
  }

  // Create a new session
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
    .limit(MAX_HISTORY_TURNS * 2); // 2 messages per turn

  if (!messages || messages.length === 0) return [];
  // Reverse so oldest first (correct for Claude messages array)
  return (messages as ChatMessage[]).reverse();
}

// ─── Helper: load cognitive context from CME tables ─────────────────────────

async function loadCognitiveContext(
  studentId: string,
  subject: string,
  grade: string,
): Promise<CognitiveContext> {
  try {
    // Resolve subject code → subject UUID for filtering
    const { data: subjectRow } = await supabaseAdmin
      .from('subjects')
      .select('id')
      .ilike('code', subject)
      .maybeSingle();
    const subjectId = subjectRow?.id ?? null;

    // All queries run in parallel for < 100ms latency budget
    const [masteryRes, gapsRes, revisionRes, errorsRes, cmeStateRes] = await Promise.all([
      // concept_mastery: weak and strong topics for this subject
      supabaseAdmin
        .from('concept_mastery')
        .select('mastery_probability, mastery_level, attempts, topic_id, curriculum_topics(title, subject_id)')
        .eq('student_id', studentId)
        .order('mastery_probability', { ascending: true })
        .limit(30),

      // knowledge_gaps: active prerequisite gaps
      supabaseAdmin
        .from('knowledge_gaps')
        .select('topic_id, prerequisite_topic_id, gap_type, is_resolved, description, curriculum_topics!knowledge_gaps_topic_id_fkey(title), prereq:curriculum_topics!knowledge_gaps_prerequisite_topic_id_fkey(title)')
        .eq('student_id', studentId)
        .eq('is_resolved', false)
        .limit(5),

      // concept_mastery: concepts due for spaced repetition review
      supabaseAdmin
        .from('concept_mastery')
        .select('mastery_probability, next_review_date, topic_id, curriculum_topics(title)')
        .eq('student_id', studentId)
        .not('next_review_date', 'is', null)
        .lte('next_review_date', new Date().toISOString().split('T')[0])
        .order('next_review_date', { ascending: true })
        .limit(5),

      // cme_error_log: recent error patterns (last 30 days)
      supabaseAdmin
        .from('cme_error_log')
        .select('error_type')
        .eq('student_id', studentId)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),

      // cme_concept_state: for CME next-action computation (read mastery_mean for overall level)
      supabaseAdmin
        .from('cme_concept_state')
        .select('concept_id, mastery_mean, current_retention')
        .eq('student_id', studentId)
        .limit(50),
    ]);

    // Filter mastery results by subject
    const subjectMastery = (masteryRes.data ?? []).filter((m: any) => {
      if (!subjectId) return true; // no subject filter if subject not found
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

    // Knowledge gaps
    const knowledgeGaps = (gapsRes.data ?? []).map((g: any) => ({
      target: g.curriculum_topics?.title ?? g.description ?? '',
      prerequisite: g.prereq?.title ?? '',
      gapType: g.gap_type ?? '',
    }));

    // Revision due
    const revisionDue = (revisionRes.data ?? []).map((r: any) => ({
      title: r.curriculum_topics?.title ?? 'Unknown',
      lastReviewed: r.next_review_date ?? '',
      mastery: Math.round((r.mastery_probability ?? 0) * 100),
    }));

    // Error pattern counts
    const errorCounts: Record<string, number> = {};
    for (const e of errorsRes.data ?? []) {
      errorCounts[e.error_type] = (errorCounts[e.error_type] || 0) + 1;
    }
    const recentErrors = Object.entries(errorCounts)
      .map(([errorType, count]) => ({ errorType, count }))
      .sort((a, b) => b.count - a.count);

    // Overall mastery level for this subject
    const avgMastery = subjectMastery.length > 0
      ? subjectMastery.reduce((s: number, m: any) => s + (m.mastery_probability ?? 0), 0) / subjectMastery.length
      : 0.5;
    const masteryLevel: CognitiveContext['masteryLevel'] =
      avgMastery < 0.4 ? 'low' : avgMastery < 0.7 ? 'medium' : 'high';

    // Call CME for next-best-action (non-blocking — uses Edge Function)
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
            signal: AbortSignal.timeout(3000), // 3s hard timeout for CME call
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

    return { weakTopics, strongTopics, knowledgeGaps, revisionDue, recentErrors, nextAction, masteryLevel };
  } catch (err) {
    // Return empty context on failure — Foxy still works, just without cognitive awareness
    logger.warn('foxy_cognitive_context_failed', {
      error: err instanceof Error ? err.message : String(err),
      studentId,
    });
    return EMPTY_COGNITIVE_CONTEXT;
  }
}

// ─── Helper: build cognitive prompt section from CME data ───────────────────

function buildCognitivePromptSection(ctx: CognitiveContext): string {
  // If no cognitive data loaded, return empty string (no noise in prompt)
  if (
    ctx.weakTopics.length === 0 &&
    ctx.strongTopics.length === 0 &&
    ctx.knowledgeGaps.length === 0 &&
    ctx.revisionDue.length === 0 &&
    ctx.recentErrors.length === 0 &&
    !ctx.nextAction
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

  if (ctx.recentErrors.length > 0) {
    sections.push('\nRECENT ERROR PATTERNS (address these misconceptions proactively):');
    for (const e of ctx.recentErrors) {
      sections.push(`- ${e.errorType} errors: ${e.count} times in last 30 days`);
    }
  }

  if (ctx.nextAction) {
    sections.push(`\nRECOMMENDED ACTION: ${ctx.nextAction.actionType.toUpperCase()}`);
    sections.push(`Concept: ${ctx.nextAction.conceptName}`);
    sections.push(`Reason: ${ctx.nextAction.reason}`);
  }

  // Cognitive load instructions based on overall mastery level
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

// ─── Helper: check and increment daily quota (atomic via RPC) ────────────────

async function checkAndIncrementQuota(
  studentId: string,
  plan: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const normalizedPlan = normalizePlan(plan);
  const limit = DAILY_QUOTA[normalizedPlan] ?? DEFAULT_QUOTA;
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // Single atomic DB transaction — avoids TOCTOU race between check and increment
  const { data: rows, error } = await supabaseAdmin.rpc('check_and_record_usage', {
    p_student_id: studentId,
    p_feature: 'foxy_chat',
    p_limit: limit,
    p_usage_date: today,
  });

  if (error) {
    // Fail closed: deny if usage tracking fails
    logger.error('foxy_quota_check_failed', { error: error.message, studentId });
    return { allowed: false, remaining: 0 };
  }

  const row = rows?.[0];
  if (!row?.allowed) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: Math.max(0, limit - (row.current_count ?? 0)) };
}

// ─── Helper: generate Voyage embedding ───────────────────────────────────────

async function generateEmbedding(text: string, timeoutMs: number = 15000): Promise<number[] | null> {
  if (!process.env.VOYAGE_API_KEY) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'voyage-3',
        input: [text],
        output_dimension: 1024,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      logger.warn('foxy_voyage_http_error', { status: res.status, timeoutMs });
      return null;
    }
    const body = await res.json();
    return body?.data?.[0]?.embedding ?? null;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    logger.warn('foxy_voyage_embedding_failed', {
      error: err instanceof Error ? err.message : String(err),
      isTimeout,
      timeoutMs,
    });
    if (isTimeout) {
      // Timeout is NOT acceptable for paying users — retry once with extended timeout
      try {
        const retryRes = await fetch('https://api.voyageai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'voyage-3',
            input: [text],
            output_dimension: 1024,
          }),
          signal: AbortSignal.timeout(timeoutMs * 2), // double the timeout for retry
        });
        if (retryRes.ok) {
          const retryBody = await retryRes.json();
          return retryBody?.data?.[0]?.embedding ?? null;
        }
      } catch {
        // Second attempt also failed — fall through to null
      }
    }
    return null;
  }
}

// ─── Helper: call Claude ──────────────────────────────────────────────────────

// Model preference order: try Haiku first (fast, cheap, confirmed working in
// existing Edge Functions), then fall back to Sonnet if Haiku is unavailable.
const CLAUDE_MODELS = [
  'claude-haiku-4-5-20251001',   // fast, cheap — used by all other Edge Functions
  'claude-sonnet-4-20250514',    // fallback — more capable but slower
];

async function callClaude(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
  imageData?: { base64: string; mediaType: string } | null,
): Promise<{ content: string; tokensUsed: number; model: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const keyPrefix = apiKey.slice(0, 12);

  // Build the user message content — with optional image for Claude Vision
  let userContent: any;
  if (imageData?.base64) {
    // Claude Vision: multi-modal message with image + text
    userContent = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageData.mediaType || 'image/jpeg',
          data: imageData.base64,
        },
      },
      {
        type: 'text',
        text: userMessage,
      },
    ];
  } else {
    userContent = userMessage;
  }

  const messages = [
    ...history,
    { role: 'user' as const, content: userContent },
  ];

  let lastError = 'Claude API unavailable';

  for (const model of CLAUDE_MODELS) {
    logger.info('foxy_claude_attempt', { keyPrefix, model });

    // 30-second hard timeout per attempt
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        }),
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        lastError = `Claude API error ${res.status} [${model}]: ${errBody.slice(0, 300)}`;
        logger.error('foxy_claude_http_error', {
          httpStatus: res.status,
          errorBody: errBody.slice(0, 500),
          keyPrefix,
          model,
        });

        // Persist to audit_logs so admin can query via Supabase (non-fatal)
        try {
          await supabaseAdmin.from('audit_logs').insert({
            auth_user_id: null,
            action: 'foxy.diag.claude_error',
            resource_type: 'diagnostic',
            details: {
              httpStatus: res.status,
              errorBody: errBody.slice(0, 500),
              keyPrefix,
              model,
            },
          });
        } catch { /* non-fatal */ }

        // Auth errors (401/403) won't be fixed by trying a different model — stop immediately
        if (res.status === 401 || res.status === 403) {
          throw new Error(lastError);
        }
        // For 404 (model not found) or 529 (overloaded), try the next model
        continue;
      }

      const data = await res.json();
      const content = data?.content?.[0]?.text ?? '';
      const tokensUsed = (data?.usage?.input_tokens ?? 0) + (data?.usage?.output_tokens ?? 0);
      return { content, tokensUsed, model };

    } catch (fetchErr) {
      clearTimeout(timer);
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        lastError = `Claude API timeout after 30s [${model}]`;
        logger.error('foxy_claude_timeout', { model, keyPrefix });
        continue; // try next model
      }
      // Re-throw network errors and intentional throws (e.g. 401/403)
      throw fetchErr;
    }
  }

  logger.error('foxy_claude_all_models_failed', {
    modelsAttempted: CLAUDE_MODELS,
    lastError,
  });
  throw new Error(lastError);
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

// ─── Build system prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(
  subject: string,
  grade: string,
  board: string,
  chapter: string | null,
  mode: string,
  ragChunks: Array<{ content: string; chapter?: string; page_number?: number; media_url?: string | null; media_description?: string | null }>,
  academicGoal?: string | null,
  cognitiveCtx?: CognitiveContext | null,
): string {
  const contextSection =
    ragChunks.length > 0
      ? `\n\n## NCERT Reference Material\n${ragChunks
          .map((c, i) => {
            let entry = `[${i + 1}] ${c.chapter ? `Chapter: ${c.chapter}` : ''}${c.page_number ? ` (p.${c.page_number})` : ''}\n${c.content}`;
            if (c.media_url) {
              const desc = c.media_description || `NCERT ${c.chapter || subject}`;
              entry += `\n[Diagram available: ${desc}${c.page_number ? ` - see attached figure from NCERT page ${c.page_number}` : ''}]`;
            }
            return entry;
          })
          .join('\n\n')}`
      : '';

  const cognitiveSection = cognitiveCtx
    ? buildCognitivePromptSection(cognitiveCtx)
    : '';

  const modeInstruction: Record<string, string> = {
    learn: 'Explain concepts clearly and build understanding step by step.',
    explain: 'Give a detailed explanation with examples from everyday Indian life.',
    practice: 'Ask follow-up questions to test understanding. If the student answers, evaluate and give feedback.',
    revise: 'Provide a concise revision summary with key points and formulas.',
  };

  return `You are Foxy, a friendly AI tutor for Indian CBSE students. You are helping a Grade ${grade} student with ${subject}${chapter ? `, Chapter: ${chapter}` : ''} (Board: ${board}).

## Your Persona
- Warm, encouraging, and patient — like a knowledgeable elder sibling
- Use simple English; occasionally mix in Hindi words (e.g., "Bilkul sahi!" = "Absolutely correct!")
- Relate examples to Indian daily life, festivals, and familiar contexts
- Never give the answer outright for practice questions — guide the student to think
- Keep responses concise (3–5 sentences for explanations, numbered steps for processes)
- If a question is off-topic or inappropriate, gently redirect to the subject

## Mode: ${mode.toUpperCase()}
${modeInstruction[mode] ?? modeInstruction.learn}

## Important Rules
- Only teach from CBSE ${board} Grade ${grade} ${subject} syllabus
- If you cite information, it must come from the Reference Material below
- Never invent facts, formulas, or historical dates
- If the student seems frustrated, be extra encouraging

## Formatting Rules
- Use standard markdown: **bold** for key terms, *italic* for emphasis
- Use LaTeX for math: inline $x^2$ and block $$\\frac{a}{b}$$
- Use markdown tables for structured data (place values, comparisons, element properties)
- Use numbered lists for steps and procedures
- Use bullet lists for properties and features
- Use > blockquote for NCERT textbook excerpts or important definitions
- Use \`code\` for short formulas and \`\`\`code blocks\`\`\` for multi-line formulas/equations
- Do NOT use ASCII art or Unicode block characters for diagrams
- Keep responses concise and well-structured with clear headings
${academicGoal ? `\n## Student's Academic Goal: ${GOAL_PROMPT_MAP[academicGoal] ?? academicGoal}\n` : ''}${cognitiveSection ? `\n${cognitiveSection}\n` : ''}${contextSection}`;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
  // TOP-LEVEL SAFETY NET — no unhandled exception can crash Foxy.
  // Individual sections have their own try-catches, but gaps between them
  // previously caused invisible 500 errors ("Something went wrong").
  // This catch-all ensures: (1) error is LOGGED, (2) student gets 503 not 500.
  try {
  return await handleFoxyPost(request);
  } catch (topLevelErr) {
    const diagMsg = topLevelErr instanceof Error ? topLevelErr.message : String(topLevelErr);
    console.error('[FOXY CRITICAL] Unhandled exception in POST handler:', diagMsg);
    // Log to ops_events so it's visible in the Observability Console
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
  // 0. Config validation — fail fast with clear diagnostic
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.error('foxy_config_missing', { variable: 'ANTHROPIC_API_KEY' });
    return errorJson(
      'Foxy is not configured. Please contact support.',
      'Foxy configure nahi hai. Support se sampark karein.',
      503,
      { _diag: 'ANTHROPIC_API_KEY is not set in environment' },
    );
  }

  // 1. Auth
  const auth = await authorizeRequest(request, 'foxy.chat', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;

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

  // Claude Vision: optional image for handwriting recognition
  const imageBase64 = typeof body.image_base64 === 'string' ? body.image_base64 : null;
  const imageMediaType = typeof body.image_media_type === 'string' ? body.image_media_type : 'image/jpeg';
  const imageData = imageBase64 ? { base64: imageBase64, mediaType: imageMediaType } : null;

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

  // 4. Resolve student ID and plan
  const studentId = auth.studentId!;

  // Subject governance: reject before any subject-keyed retrieval / context load.
  {
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

  // 6b. Intent Router (feature-flagged)
  // When enabled, classifies the student's intent and routes through the
  // unified AI layer (src/lib/ai/) for structured workflows, output validation,
  // and tracing. Falls back to the existing inline flow on any error.
  const useIntentRouter = await isFeatureEnabled('ai_intent_router', {
    role: 'student',
    userId: auth.userId!,
  });

  if (useIntentRouter) {
    try {
      const history = await loadHistory(resolvedSessionId);

      const classification = await classifyIntent(message, subject, grade, mode);
      logger.info('foxy_intent_classified', {
        intent: classification.intent,
        confidence: classification.confidence,
        studentId,
      });

      const result = await routeIntent(classification.intent, message, {
        subject,
        grade,
        board,
        chapter,
        mode,
        history,
        academicGoal,
        studentId,
        sessionId: resolvedSessionId,
      });

      // Persist conversation turns
      const now = new Date().toISOString();
      const sources = result.sources.map((c) => ({
        chunk_id: c.id,
        subject: c.subject,
        chapter: c.chapter,
        page_number: c.pageNumber,
        similarity: c.similarity,
        content_preview: c.content.slice(0, 150),
        media_url: c.mediaUrl || null,
      }));

      const routerDiagrams: DiagramRef[] = result.sources
        .filter((c) => c.mediaUrl)
        .map((c) => ({
          url: c.mediaUrl!,
          title: c.chapter || subject,
          pageNumber: c.pageNumber,
          description: c.mediaDescription || `NCERT ${subject} ${c.chapter || ''}`.trim(),
        }));

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
          content: result.response,
          sources: sources.length > 0 ? sources : null,
          tokens_used: result.tokensUsed,
          created_at: new Date(Date.now() + 1).toISOString(),
        },
      ]);

      logAudit(auth.userId!, {
        action: 'foxy.chat',
        resourceType: 'foxy_sessions',
        resourceId: resolvedSessionId,
        details: {
          subject, grade, chapter, mode,
          intent: classification.intent,
          confidence: classification.confidence,
          tokensUsed: result.tokensUsed,
          model: result.model,
          traceId: result.traceId,
          ragChunksFound: result.sources.length,
          router: true,
        },
      });

      return NextResponse.json({
        success: true,
        response: result.response,
        sources: sources,
        diagrams: routerDiagrams,
        sessionId: resolvedSessionId,
        quotaRemaining: remaining,
        tokensUsed: result.tokensUsed,
        intent: classification.intent,
      });
    } catch (routerErr) {
      // Intent router failed — fall through to existing inline flow
      logger.warn('foxy_intent_router_fallback', {
        error: routerErr instanceof Error ? routerErr.message : String(routerErr),
        studentId,
      });
    }
  }

  // ─── Existing inline flow (default, or fallback from intent router) ────────

  // 7. Load cognitive context + generate embedding in parallel
  // Timeouts are plan-aware: paying students get longer timeouts + automatic retry
  const voyageTimeout = VOYAGE_TIMEOUT[plan] ?? DEFAULT_VOYAGE_TIMEOUT;
  const embeddingQuery = `${subject} grade ${grade}${chapter ? ` chapter ${chapter}` : ''}: ${message}`;
  let embedding: number[] | null = null;
  let cognitiveCtx: CognitiveContext = EMPTY_COGNITIVE_CONTEXT;
  try {
    const [emb, ctx] = await Promise.all([
      generateEmbedding(embeddingQuery, voyageTimeout),
      loadCognitiveContext(studentId, subject, grade),
    ]);
    embedding = emb;
    cognitiveCtx = ctx;
  } catch (embErr) {
    logger.warn('foxy_embedding_or_cognitive_failed', {
      error: embErr instanceof Error ? embErr.message : String(embErr),
      studentId, subject, grade, plan, voyageTimeout,
    });
    // Non-fatal: RAG falls back to text search, cognitive context empty
  }

  // 8. RAG retrieval via match_rag_chunks RPC
  let ragChunks: Array<{
    id: string;
    content: string;
    subject: string;
    chapter?: string;
    page_number?: number;
    similarity: number;
    media_url?: string | null;
    media_description?: string | null;
  }> = [];

  try {
    // NCERT-pinned RPC: hardcoded source='ncert_2025' so non-NCERT chunks
    // can never reach the student. subject is the snake_case code from
    // get_available_subjects (matches rag_content_chunks.subject_code 1:1).
    // p_chapter is split into number-vs-title for the new RPC contract.
    const chapterArg: string | null = chapter ?? null;
    const chapterNum: number | null =
      chapterArg && /^\d+$/.test(chapterArg) ? parseInt(chapterArg, 10) : null;
    const chapterTitle: string | null =
      chapterArg && chapterNum === null ? chapterArg : null;
    void board; // board is no longer relevant — NCERT only

    const { data: chunks, error: ragError } = await supabaseAdmin.rpc('match_rag_chunks_ncert', {
      query_text:        embeddingQuery,
      p_subject_code:    subject,
      p_grade:           grade,
      match_count:       RAG_MATCH_COUNT,
      p_chapter_number:  chapterNum,
      p_chapter_title:   chapterTitle,
      p_min_quality:     RAG_MIN_QUALITY,
      query_embedding:   embedding,
    });

    if (ragError) {
      logger.warn('foxy_rag_retrieval_failed', {
        error: ragError.message,
        subject,
        grade,
        chapter,
      });
    } else if (chunks) {
      // Normalize new-RPC field names → existing consumer shape.
      // Old RPC returned `chapter` (text); new returns `chapter_title` + `chapter_number`.
      ragChunks = (chunks as Array<Record<string, unknown>>).map((c) => ({
        id: String(c.id ?? ''),
        content: String(c.content ?? ''),
        subject: subject,
        chapter:
          c.chapter_title != null
            ? String(c.chapter_title)
            : c.chapter_number != null
              ? `Chapter ${c.chapter_number}`
              : undefined,
        page_number: typeof c.page_number === 'number' ? c.page_number : undefined,
        similarity: typeof c.similarity === 'number' ? c.similarity : 0,
      }));
    }
  } catch (ragErr) {
    logger.warn('foxy_rag_rpc_exception', {
      error: ragErr instanceof Error ? ragErr.message : String(ragErr),
    });
    // Non-fatal: proceed with no context
  }

  // 9. Load conversation history for multi-turn context (non-fatal)
  let history: ChatMessage[] = [];
  try {
    history = await loadHistory(resolvedSessionId);
  } catch (histErr) {
    console.warn('[foxy] history load failed:', histErr instanceof Error ? histErr.message : String(histErr));
  }

  // 10. Build system prompt with RAG context + cognitive context
  const systemPrompt = buildSystemPrompt(
    subject, grade, board, chapter, mode, ragChunks, academicGoal, cognitiveCtx,
  );

  // 11. Call Claude
  let assistantResponse: string;
  let tokensUsed = 0;
  try {
    const result = await callClaude(systemPrompt, history, message, imageData);
    assistantResponse = result.content;
    tokensUsed = result.tokensUsed;
    logger.info('foxy_claude_ok', {
      model: result.model,
      tokensUsed,
      cognitiveContextLoaded: cognitiveCtx.weakTopics.length > 0 || cognitiveCtx.nextAction !== null,
      masteryLevel: cognitiveCtx.masteryLevel,
    });
  } catch (claudeErr) {
    logger.error('foxy_claude_api_failed', {
      error: claudeErr instanceof Error ? claudeErr : new Error(String(claudeErr)),
      studentId,
      subject,
      grade,
    });
    // Decrement quota since we couldn't serve the response — best-effort
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data: row } = await supabaseAdmin
        .from('student_daily_usage')
        .select('usage_count')
        .eq('student_id', studentId)
        .eq('feature', 'foxy_chat')
        .eq('usage_date', today)
        .single();
      if (row && typeof row.usage_count === 'number' && row.usage_count > 0) {
        await supabaseAdmin
          .from('student_daily_usage')
          .update({ usage_count: row.usage_count - 1, updated_at: new Date().toISOString() })
          .eq('student_id', studentId)
          .eq('feature', 'foxy_chat')
          .eq('usage_date', today);
      }
    } catch { /* Non-fatal */ }
    // TEMPORARY DIAGNOSTIC: expose exact error so admin can identify root cause
    const diagMsg = claudeErr instanceof Error ? claudeErr.message : String(claudeErr);
    return errorJson(
      'Foxy is temporarily unavailable. Please try again in a moment.',
      'Foxy abhi available nahi hai. Thodi der mein dobara try karein.',
      503,
      { _diag: diagMsg.slice(0, 300) },
    );
  }

  // 12. Build sources and diagrams arrays
  const now = new Date().toISOString();
  const sources: RagSource[] = ragChunks.map((c) => ({
    chunk_id: c.id,
    subject: c.subject,
    chapter: c.chapter,
    page_number: c.page_number,
    similarity: c.similarity,
    content_preview: c.content.slice(0, 150),
    media_url: c.media_url || null,
  }));

  const diagrams: DiagramRef[] = ragChunks
    .filter((c) => c.media_url)
    .map((c) => ({
      url: c.media_url!,
      title: c.chapter || subject,
      pageNumber: c.page_number,
      description: c.media_description || `NCERT ${subject} ${c.chapter || ''}`.trim(),
    }));

  // 12b. Persist both turns to foxy_chat_messages (non-fatal — response already generated)
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
        content: assistantResponse,
        sources: sources.length > 0 ? sources : null,
        tokens_used: tokensUsed,
        created_at: new Date(Date.now() + 1).toISOString(), // ensure ordering
      },
    ]);
  } catch (saveErr) {
    // Message save failure must NOT crash the route — the response is already ready
    console.warn('[foxy] message save failed:', saveErr instanceof Error ? saveErr.message : String(saveErr));
  }

  // 13. Post-response cognitive logging (fire-and-forget — non-blocking)
  if (cognitiveCtx.nextAction) {
    Promise.resolve(
      supabaseAdmin
        .from('cme_action_log')
        .insert({
          student_id: studentId,
          action_type: cognitiveCtx.nextAction.actionType,
          concept_id: null, // concept_id is UUID; conceptName may be a title string
          reason: cognitiveCtx.nextAction.reason,
          was_followed: true,
          outcome: 'foxy_responded',
        }),
    ).catch((err: unknown) => {
      console.warn('[foxy] cognitive action log failed:', err instanceof Error ? err.message : String(err));
    }); // fire-and-forget
  }

  // Update foxy_sessions with cognitive tracking metadata
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
  }); // fire-and-forget

  // 14. Audit log
  logAudit(auth.userId!, {
    action: 'foxy.chat',
    resourceType: 'foxy_sessions',
    resourceId: resolvedSessionId,
    details: {
      subject, grade, chapter, mode, tokensUsed,
      ragChunksFound: ragChunks.length,
      cognitiveContextLoaded: true,
      masteryLevel: cognitiveCtx.masteryLevel,
      weakTopicCount: cognitiveCtx.weakTopics.length,
      knowledgeGapCount: cognitiveCtx.knowledgeGaps.length,
      revisionDueCount: cognitiveCtx.revisionDue.length,
      cmeAction: cognitiveCtx.nextAction?.actionType ?? null,
    },
  });

  // 15. Build soft upgrade prompt if quota near exhaustion
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

  // 16. Return response
  return NextResponse.json({
    success: true,
    response: assistantResponse,
    sources,
    diagrams,
    sessionId: resolvedSessionId,
    quotaRemaining: remaining,
    tokensUsed,
    ...(upgradePrompt ? { upgradePrompt } : {}),
  });
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

  // Verify session belongs to this student
  const { data: session } = await supabaseAdmin
    .from('foxy_sessions')
    .select('id, subject, grade, chapter, mode, created_at')
    .eq('id', sessionId)
    .eq('student_id', studentId)
    .single();

  if (!session) {
    return errorJson('Session not found.', 'Session nahi mila.', 404);
  }

  const { data: messages } = await supabaseAdmin
    .from('foxy_chat_messages')
    .select('id, role, content, sources, tokens_used, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  return NextResponse.json({
    success: true,
    session,
    messages: messages ?? [],
  });
}
