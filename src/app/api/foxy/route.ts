/**
 * /api/foxy — Foxy AI Tutor Chat Endpoint
 *
 * Architecture:
 *  1. RBAC auth guard (foxy.chat permission)
 *  2. Daily quota enforcement (foxy_chats_used in student_daily_usage)
 *  3. Session continuity (foxy_sessions table)
 *  4. RAG retrieval — Voyage voyage-3 embedding → match_rag_chunks RPC
 *  5. Context-aware response — Claude claude-3-5-sonnet-20241022
 *  6. Persist turn to foxy_chat_messages
 *  7. Audit log
 *
 * POST /api/foxy
 * Body: { message, subject, grade, chapter?, board?, sessionId?, mode? }
 * Response: { response, sources, sessionId, quotaRemaining, tokensUsed }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

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
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!process.env.VOYAGE_API_KEY) return null;
  try {
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
    });
    if (!res.ok) {
      logger.warn('foxy_voyage_http_error', { status: res.status });
      return null;
    }
    const body = await res.json();
    return body?.data?.[0]?.embedding ?? null;
  } catch (err) {
    logger.warn('foxy_voyage_embedding_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Helper: call Claude ──────────────────────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  history: ChatMessage[],
  userMessage: string,
): Promise<{ content: string; tokensUsed: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const messages = [
    ...history,
    { role: 'user' as const, content: userMessage },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Claude API error ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data?.content?.[0]?.text ?? '';
  const tokensUsed = (data?.usage?.input_tokens ?? 0) + (data?.usage?.output_tokens ?? 0);
  return { content, tokensUsed };
}

// ─── Build system prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(
  subject: string,
  grade: string,
  board: string,
  chapter: string | null,
  mode: string,
  ragChunks: Array<{ content: string; chapter?: string; page_number?: number }>,
): string {
  const contextSection =
    ragChunks.length > 0
      ? `\n\n## NCERT Reference Material\n${ragChunks
          .map((c, i) => `[${i + 1}] ${c.chapter ? `Chapter: ${c.chapter}` : ''}${c.page_number ? ` (p.${c.page_number})` : ''}\n${c.content}`)
          .join('\n\n')}`
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
${contextSection}`;
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<Response> {
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
  let plan = 'free';
  try {
    const { data: studentRow } = await supabaseAdmin
      .from('students')
      .select('subscription_plan, account_status')
      .eq('id', studentId)
      .single();
    if (studentRow?.subscription_plan) plan = normalizePlan(studentRow.subscription_plan);
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

  // 7. Generate Voyage embedding for the user's message
  const embeddingQuery = `${subject} grade ${grade}${chapter ? ` chapter ${chapter}` : ''}: ${message}`;
  const embedding = await generateEmbedding(embeddingQuery);

  // 8. RAG retrieval via match_rag_chunks RPC
  let ragChunks: Array<{
    id: string;
    content: string;
    subject: string;
    chapter?: string;
    page_number?: number;
    similarity: number;
  }> = [];

  try {
    const { data: chunks, error: ragError } = await supabaseAdmin.rpc('match_rag_chunks', {
      query_text: embeddingQuery,
      p_subject: subject,
      p_grade: grade,
      match_count: RAG_MATCH_COUNT,
      p_chapter: chapter,
      query_embedding: embedding,
      p_board: board,
      p_min_quality: RAG_MIN_QUALITY,
    });

    if (ragError) {
      logger.warn('foxy_rag_retrieval_failed', {
        error: ragError.message,
        subject,
        grade,
        chapter,
      });
    } else if (chunks) {
      ragChunks = chunks as typeof ragChunks;
    }
  } catch (ragErr) {
    logger.warn('foxy_rag_rpc_exception', {
      error: ragErr instanceof Error ? ragErr.message : String(ragErr),
    });
    // Non-fatal: proceed with no context
  }

  // 9. Load conversation history for multi-turn context
  const history = await loadHistory(resolvedSessionId);

  // 10. Build system prompt with RAG context
  const systemPrompt = buildSystemPrompt(subject, grade, board, chapter, mode, ragChunks);

  // 11. Call Claude
  let assistantResponse: string;
  let tokensUsed = 0;
  try {
    const result = await callClaude(systemPrompt, history, message);
    assistantResponse = result.content;
    tokensUsed = result.tokensUsed;
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
        .select('foxy_chats_used')
        .eq('student_id', studentId)
        .eq('usage_date', today)
        .single();
      if (row && typeof row.foxy_chats_used === 'number' && row.foxy_chats_used > 0) {
        await supabaseAdmin
          .from('student_daily_usage')
          .update({ foxy_chats_used: row.foxy_chats_used - 1, updated_at: new Date().toISOString() })
          .eq('student_id', studentId)
          .eq('usage_date', today);
      }
    } catch { /* Non-fatal */ }
    return errorJson(
      'Foxy is temporarily unavailable. Please try again in a moment.',
      'Foxy abhi available nahi hai. Thodi der mein dobara try karein.',
      503,
    );
  }

  // 12. Persist both turns to foxy_chat_messages
  const now = new Date().toISOString();
  const sources: RagSource[] = ragChunks.map((c) => ({
    chunk_id: c.id,
    subject: c.subject,
    chapter: c.chapter,
    page_number: c.page_number,
    similarity: c.similarity,
    content_preview: c.content.slice(0, 150),
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
      content: assistantResponse,
      sources: sources.length > 0 ? sources : null,
      tokens_used: tokensUsed,
      created_at: new Date(Date.now() + 1).toISOString(), // ensure ordering
    },
  ]);

  // 13. Audit log
  logAudit(auth.userId!, {
    action: 'foxy.chat',
    resourceType: 'foxy_sessions',
    resourceId: resolvedSessionId,
    details: { subject, grade, chapter, mode, tokensUsed, ragChunksFound: ragChunks.length },
  });

  // 14. Return response
  return NextResponse.json({
    success: true,
    response: assistantResponse,
    sources,
    sessionId: resolvedSessionId,
    quotaRemaining: remaining,
    tokensUsed,
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
