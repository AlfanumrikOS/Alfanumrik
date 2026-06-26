/**
 * GET /api/foxy/suggest-prompts
 *
 * IRT-driven prompt suggestions for Foxy AI Tutor ConversationStarters.
 * Returns personalized chip data based on student mastery (concept_mastery,
 * student_skill_state) and CME next action (quiz_sessions.cme_next_action).
 * Called client-side via SWR on the /foxy page with a 5-minute refresh interval.
 * Zero quota cost — does NOT consume a Foxy chat turn or call Claude.
 *
 * Query params: subject (required), grade (required, P5: string "6".."12")
 *
 * Response shape: PersonalizedSuggestions
 *   { weakTopics, overdueTopics, nextAction, bloomHint }
 *
 * On any error (auth failure, DB error): returns the static fallback shape
 * (empty arrays, null nextAction, 'understand' bloomHint). Never returns a
 * 4xx/5xx — chips gracefully degrade to static when this returns empty data.
 *
 * Auth: foxy.chat permission + requireStudentId.
 * P8:  Uses createSupabaseServerClient() (anon key + cookies → RLS applies).
 *      Also adds explicit student_id filter as belt-and-suspenders.
 * P13: Response body contains topic titles and mastery percentages only —
 *      no student names, emails, IDs, or other PII.
 * P5:  Grade is treated as a string throughout ("6".."12"). Never coerced.
 *
 * RCA-FIX RC-17/RC-18 (2026-06-26): IRT-driven prompt suggestions.
 */

// API Shape note: this endpoint returns PersonalizedSuggestions directly (not
// wrapped in { success, data }) because:
// (a) SWR callers consume the payload directly and null-check for fallback, and
// (b) the error path always returns STATIC_FALLBACK with HTTP 200 — there is no
//     meaningful { success: false } state from the UI perspective.
// See ConversationStarters.tsx: `suggestions ?? undefined` for the null-guard.

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';

export interface PersonalizedSuggestions {
  weakTopics: Array<{ title: string; mastery: number }>;
  overdueTopics: Array<{ title: string; daysOverdue: number }>;
  nextAction: { conceptName: string } | null;
  bloomHint: 'remember' | 'understand' | 'apply' | 'analyze';
}

/** Returned on any error so the UI chip strip never breaks. */
const STATIC_FALLBACK: PersonalizedSuggestions = {
  weakTopics: [],
  overdueTopics: [],
  nextAction: null,
  bloomHint: 'understand',
};

const CACHE_HEADER = 'private, max-age=300';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // ── Auth (P9) ─────────────────────────────────────────────────────────────
    const auth = await authorizeRequest(request, 'foxy.chat', { requireStudentId: true });
    if (!auth.authorized) {
      // Return fallback, not an error — chips must never break the UI.
      return NextResponse.json(STATIC_FALLBACK, {
        headers: { 'Cache-Control': CACHE_HEADER },
      });
    }
    const studentId = auth.studentId;
    if (!studentId) {
      return NextResponse.json(STATIC_FALLBACK, {
        headers: { 'Cache-Control': CACHE_HEADER },
      });
    }

    // ── Query params ──────────────────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get('subject') ?? '';
    const grade = searchParams.get('grade') ?? ''; // P5: string, never coerced

    if (!subject || !grade) {
      return NextResponse.json(STATIC_FALLBACK, {
        headers: { 'Cache-Control': CACHE_HEADER },
      });
    }

    // ── DB client (P8: RLS-respecting server client) ──────────────────────────
    const supabase = await createSupabaseServerClient();

    // ── 3 parallel DB queries ─────────────────────────────────────────────────
    const [weakResult, overdueResult, cmeResult] = await Promise.all([
      // Query A: weak topics — mastery_probability < 0.6, not "not_started"
      supabase
        .from('concept_mastery')
        .select('topic_title, mastery_probability, mastery_level')
        .eq('student_id', studentId) // belt-and-suspenders on top of RLS
        .eq('subject_code', subject)
        .eq('grade', grade)
        .neq('mastery_level', 'not_started')
        .lt('mastery_probability', 0.6)
        .order('mastery_probability', { ascending: true })
        .limit(3),

      // Query B: overdue revision — next_review_date <= now()
      supabase
        .from('concept_mastery')
        .select('topic_title, next_review_date, mastery_probability')
        .eq('student_id', studentId)
        .eq('subject_code', subject)
        .eq('grade', grade)
        .not('next_review_date', 'is', null)
        .lte('next_review_date', new Date().toISOString())
        .order('next_review_date', { ascending: true })
        .limit(3),

      // Query C: CME next action — most recent quiz session for this subject
      supabase
        .from('quiz_sessions')
        .select('cme_next_action')
        .eq('student_id', studentId)
        .eq('subject', subject)
        .not('cme_next_action', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

    // ── Build response payload ────────────────────────────────────────────────

    // Weak topics (P13: topic_title only, no student-identifying data)
    const weakRows = (weakResult.data ?? []) as Array<{
      topic_title: string;
      mastery_probability: number;
    }>;
    const weakTopics = weakRows.map((r) => ({
      title: r.topic_title,
      mastery: r.mastery_probability,
    }));

    // Overdue topics
    const overdueRows = (overdueResult.data ?? []) as Array<{
      topic_title: string;
      next_review_date: string;
      mastery_probability: number;
    }>;
    const overdueTopics = overdueRows.map((r) => {
      const daysOverdue = Math.round(
        (Date.now() - new Date(r.next_review_date).getTime()) / 86400000,
      );
      return { title: r.topic_title, daysOverdue: Math.max(1, daysOverdue) };
    });

    // CME next action
    let nextAction: { conceptName: string } | null = null;
    const cmeRows = (cmeResult.data ?? []) as Array<{ cme_next_action: unknown }>;
    if (cmeRows.length > 0) {
      const cme = cmeRows[0].cme_next_action as Record<string, unknown> | null;
      if (cme && typeof cme.conceptName === 'string' && cme.conceptName.trim()) {
        nextAction = { conceptName: cme.conceptName.trim() };
      }
    }

    // bloomHint — derived from avg mastery across weak + overdue rows
    // These rows represent the student's current challenge zone, so their
    // average mastery accurately reflects where to pitch Bloom's complexity.
    let bloomHint: PersonalizedSuggestions['bloomHint'] = 'understand';
    const allMasteryValues = [
      ...weakRows.map((r) => r.mastery_probability),
      ...overdueRows.map((r) => r.mastery_probability),
    ];
    if (allMasteryValues.length > 0) {
      const avg = allMasteryValues.reduce((a, b) => a + b, 0) / allMasteryValues.length;
      if (avg >= 0.8) bloomHint = 'analyze';
      else if (avg >= 0.65) bloomHint = 'apply';
      else if (avg >= 0.4) bloomHint = 'understand';
      else bloomHint = 'remember';
    }

    const suggestions: PersonalizedSuggestions = {
      weakTopics,
      overdueTopics,
      nextAction,
      bloomHint,
    };

    return NextResponse.json(suggestions, {
      headers: { 'Cache-Control': CACHE_HEADER },
    });
  } catch (err) {
    // Never let this endpoint break the UI. All errors silently fall back to
    // the static chip set. P13: log only the error message, not the request URL
    // or student context.
    logger.error('foxy.suggest-prompts: unhandled error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(STATIC_FALLBACK, {
      headers: { 'Cache-Control': CACHE_HEADER },
    });
  }
}
