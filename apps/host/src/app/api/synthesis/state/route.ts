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

export const dynamic = 'force-dynamic';

interface SynthesisRow {
  id: string;
  synthesisMonth: string;
  bundle: SynthesisBundle;
  summaryTextEn: string;
  summaryTextHi: string;
  parentShareStatus: 'pending' | 'sent' | 'opted_out' | 'failed' | 'suppressed';
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
  // generate them now via Claude + persist via the admin client.
  if (summaryTextEn.trim().length === 0) {
    try {
      const systemPrompt = buildSynthesisSummaryPrompt({
        studentName: String(studentRow.name ?? 'Student'),
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
      const replyText = claudeResp.content ?? '';
      const parsed = parseSynthesisSummaryReply(replyText);
      summaryTextEn = parsed.textEn;
      summaryTextHi = parsed.textHi;

      // Persist the filled summary via service-role (no UPDATE RLS policy
      // on monthly_synthesis_runs for end users).
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
        // Continue — the user still gets the freshly generated text in this response.
      }
    } catch (e) {
      logger.warn('synthesis/state: lazy-fill claude call failed', {
        userId, rowId: row.id, error: e instanceof Error ? e.message : String(e),
      });
      // Surface a soft fallback so the page still renders the bundle without crashing.
      summaryTextEn = '';
      summaryTextHi = '';
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
