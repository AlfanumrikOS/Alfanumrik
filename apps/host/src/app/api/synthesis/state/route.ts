/**
 * Pedagogy v2 — Wave 3 Task 5
 * GET /api/synthesis/state
 *
 * Returns the most recent monthly_synthesis_runs row for the authenticated
 * student. Lazy-fills the bilingual summary text via Claude Haiku on the
 * first view (rows are inserted by the monthly-synthesis-builder Edge
 * Function in Task 4 with empty summary_text_en/hi, and this route fills
 * them on demand using the prompt builder from Task 3).
 *
 * Response shape:
 *   { state: 'no_synthesis_yet' }
 *   { state: 'ready', row: SynthesisRow }
 *
 * Server-gated by ff_pedagogy_v2_monthly_synthesis. Returns 404 when off.
 *
 * RLS on monthly_synthesis_runs (Wave 3 Task 1) restricts SELECT to the
 * row's own student. Lazy-fill uses the user-bound supabase client for
 * the SELECT, but switches to supabase-admin (service-role) for the
 * UPDATE so the lazy-fill row write does not require an explicit
 * UPDATE policy on the table.
 */
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { isFeatureEnabled, PEDAGOGY_V2_FLAGS } from '@alfanumrik/lib/feature-flags';
import {
  buildSynthesisSummaryPrompt,
  parseSynthesisSummaryReply,
} from '@alfanumrik/lib/ai/workflows/synthesis-summary';
import type { SynthesisBundle } from '@alfanumrik/lib/learn/monthly-synthesis-orchestrator';
import { callClaude } from '@alfanumrik/lib/ai/clients/claude';
import { logger } from '@alfanumrik/lib/logger';
// Item 4.2 (2026-07-21) — fabrication oracle + word-cap enforcement + template
// fallback + circuit breaker, ALL of which must run before any Claude-generated
// text reaches `monthly_synthesis_runs`. See synthesis-oracle.ts header for the
// full rationale; this route only WIRES the module in — all decision logic
// (reject-vs-regenerate, truncate-vs-reject, circuit-breaker thresholds) lives
// there so it stays unit-testable without booting this route.
import {
  validateSynthesisSummary,
  buildSynthesisFallbackSummary,
  synthesisClaudeCircuitBreaker,
} from '@alfanumrik/lib/ai/validation/synthesis-oracle';

export const dynamic = 'force-dynamic';

interface SynthesisRow {
  id: string;
  synthesisMonth: string;
  bundle: SynthesisBundle;
  summaryTextEn: string;
  summaryTextHi: string;
  // 'flagged' added by item 4.5 (2026-07-21) — the pre-send fabrication gate
  // in /api/synthesis/parent-share writes this instead of sending/dropping a
  // summary that fails a defense-in-depth fabrication re-check.
  parentShareStatus: 'pending' | 'sent' | 'opted_out' | 'failed' | 'suppressed' | 'flagged';
  parentShareSentAt: string | null;
  createdAt: string;
}

export async function GET(_request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  const flagOn = await isFeatureEnabled(PEDAGOGY_V2_FLAGS.MONTHLY_SYNTHESIS, {
    userId,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Look up student name + grade for the prompt builder. students.id is a
  // surrogate uuid distinct from the auth uid — resolve it via auth_user_id
  // (same pattern as /api/dive/state, /api/dive/history, /api/dive/artifact).
  const { data: studentRow } = await supabase
    .from('students')
    .select('id, name, grade')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (!studentRow) {
    return NextResponse.json({ error: 'no_student_profile' }, { status: 404 });
  }
  const studentDbId = (studentRow as { id: string }).id;

  // Latest synthesis row (RLS enforces student_id = self; explicit filter
  // uses the resolved surrogate id, not the auth uid).
  const { data: rowData, error: rowErr } = await supabase
    .from('monthly_synthesis_runs')
    .select('id, synthesis_month, bundle, summary_text_en, summary_text_hi, parent_share_status, parent_share_sent_at, created_at')
    .eq('student_id', studentDbId)
    .order('synthesis_month', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (rowErr) {
    logger.warn('synthesis/state: row fetch failed', { userId, error: rowErr.message });
    return NextResponse.json({ error: 'state_fetch_failed' }, { status: 500 });
  }
  if (!rowData) {
    return NextResponse.json({ state: 'no_synthesis_yet' });
  }

  const row = rowData as {
    id: string;
    synthesis_month: string;
    bundle: SynthesisBundle;
    summary_text_en: string;
    summary_text_hi: string;
    parent_share_status: SynthesisRow['parentShareStatus'];
    parent_share_sent_at: string | null;
    created_at: string;
  };

  let summaryTextEn = row.summary_text_en;
  let summaryTextHi = row.summary_text_hi;

  // Lazy-fill: if the builder Edge Function inserted with empty summaries,
  // generate them now via Claude, run the item-4.2 oracle (fabrication +
  // word-cap) BEFORE persistence, and fall back to a deterministic
  // bundle-only template on ANY failure (circuit open, Claude error, or
  // oracle rejection) so the student/parent is NEVER left with an empty
  // summary. `usedFallback` is tracked only for the warn-log below (P13:
  // counts/categories only, never the generated text or student name).
  if (summaryTextEn.trim().length === 0) {
    const studentNameForPrompt = String(studentRow.name ?? 'Student');
    let usedFallback = false;
    let fallbackReason: 'circuit_open' | 'claude_error' | 'oracle_rejected' | null = null;

    if (!synthesisClaudeCircuitBreaker.canRequest()) {
      usedFallback = true;
      fallbackReason = 'circuit_open';
    } else {
      try {
        const systemPrompt = buildSynthesisSummaryPrompt({
          studentName: studentNameForPrompt,
          studentGrade: String(studentRow.grade ?? ''),
          bundle: row.bundle,
          language: 'both',
        });
        const claudeResp = await callClaude({
          systemPrompt,
          messages: [{ role: 'user', content: 'Generate the bilingual monthly summary as instructed.' }],
          maxTokens: 800,
          temperature: 0.4,
          timeoutMs: 20_000,
        });
        synthesisClaudeCircuitBreaker.recordSuccess();
        const replyText = claudeResp.content ?? '';
        const parsed = parseSynthesisSummaryReply(replyText);

        // Item 4.2 oracle — fabrication check (numbers + chapter/topic names
        // cross-checked against the bundle) THEN word-cap enforcement.
        // Rejects straight to the template fallback (no in-request retry —
        // see the DECISION comment on validateSynthesisSummary for why).
        const verdict = validateSynthesisSummary({
          textEn: parsed.textEn,
          textHi: parsed.textHi,
          bundle: row.bundle,
          studentName: studentNameForPrompt,
          studentGrade: String(studentRow.grade ?? ''),
        });

        if (verdict.ok) {
          summaryTextEn = verdict.textEn;
          summaryTextHi = verdict.textHi;
          if (verdict.wasTruncatedEn || verdict.wasTruncatedHi) {
            logger.info('synthesis/state: oracle truncated over-length summary', {
              rowId: row.id,
              truncatedEn: verdict.wasTruncatedEn,
              truncatedHi: verdict.wasTruncatedHi,
            });
          }
        } else {
          usedFallback = true;
          fallbackReason = 'oracle_rejected';
          // P13: log ONLY the rejection category — never rejectionReason's
          // unbacked numbers/phrases and never the generated text/student name.
          logger.warn('synthesis/state: oracle rejected generated summary', {
            rowId: row.id,
            rejectionCategory: verdict.rejectionCategory,
          });
        }
      } catch (e) {
        synthesisClaudeCircuitBreaker.recordFailure();
        usedFallback = true;
        fallbackReason = 'claude_error';
        logger.warn('synthesis/state: lazy-fill claude call failed', {
          userId, rowId: row.id, error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (usedFallback) {
      const fallback = buildSynthesisFallbackSummary({
        studentName: studentNameForPrompt,
        bundle: row.bundle,
      });
      summaryTextEn = fallback.textEn;
      summaryTextHi = fallback.textHi;
      logger.info('synthesis/state: served template fallback summary', {
        rowId: row.id, reason: fallbackReason,
      });
    }

    // Persist the filled summary (Claude+oracle-approved OR template
    // fallback — either way NEVER empty) via service-role (no UPDATE RLS
    // policy on monthly_synthesis_runs for end users).
    const { error: updateErr } = await supabaseAdmin
      .from('monthly_synthesis_runs')
      .update({
        summary_text_en: summaryTextEn,
        summary_text_hi: summaryTextHi,
      })
      .eq('id', row.id);
    if (updateErr) {
      logger.warn('synthesis/state: lazy-fill update failed', {
        userId, rowId: row.id, error: updateErr.message,
      });
      // Continue — the user still gets the freshly generated/fallback text
      // in this response even if the persistence write failed.
    }
  }

  const result: SynthesisRow = {
    id: row.id,
    synthesisMonth: row.synthesis_month,
    bundle: row.bundle,
    summaryTextEn,
    summaryTextHi,
    parentShareStatus: row.parent_share_status,
    parentShareSentAt: row.parent_share_sent_at,
    createdAt: row.created_at,
  };

  return NextResponse.json({ state: 'ready', row: result }, {
    headers: { 'Cache-Control': 'private, max-age=0, must-revalidate' },
  });
}
