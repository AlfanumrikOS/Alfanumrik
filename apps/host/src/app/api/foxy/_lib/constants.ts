/**
 * /api/foxy — M1 extracted constants, types, and pure helpers.
 *
 * H1 REFACTOR Step 1 (behavior-preserving). These symbols were lifted
 * verbatim out of `src/app/api/foxy/route.ts` (roughly lines 149-436). They
 * are pure values / types / helpers with no dependency on route-local runtime
 * state. The route imports them and uses them identically — zero behavior
 * change. See the route file header for the endpoint's responsibilities.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { AbstainReason } from '@alfanumrik/lib/ai/grounded-client';

// ─── Constants ──────────────────────────────────────────────────────────────

export const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];

// P12 — Grade-spoof hard block (CEO decision D2, 2026-06-15).
// Zod schema validates the body's `grade` field is one of the seven CBSE
// grade strings BEFORE the route resolves studentId or any downstream
// scope/RAG/prompt assembly. Permissive on every other field — the route's
// hand-rolled validators below still cover message/subject/mode/etc. The
// schema's only job is to lock the `grade` shape (P5: grades are strings).
export const FoxyRequestBodySchema = z
  .object({
    grade: z.enum(['6', '7', '8', '9', '10', '11', '12']),
  })
  .passthrough();

// FOX-3 (Cycle 4, assessment-approved): widened to the full documented Foxy mode
// set so the route no longer coerces doubt/homework/explorer down to 'learn'.
// `selectFoxyPromptTemplate` (route.ts) maps these as: learn/explain→teach_v1,
// practice→exam_v1, revise→teach_v1, doubt/homework→doubt_v1 (restores the
// previously-dead branch), explorer→teach_v1 (default). This is a UX/format
// reconciliation only — the FOXY_SAFETY_RAILS (CBSE scope, age-appropriateness,
// grounding) are injected on EVERY path independent of template, so widening the
// whitelist does not relax safety or scope on any newly-valid mode.
export const VALID_MODES = ['learn', 'explain', 'practice', 'revise', 'doubt', 'homework', 'explorer'];

// Phase 2.2: coaching modes — distinct from the UI session mode above.
// 'answer'   → student wants the answer (used when mastery is high).
// 'socratic' → guide via questions (default for mid-mastery, the moat).
// 'review'   → quick recall mode for revision/spaced-repetition entries.
export const VALID_COACH_MODES = ['answer', 'socratic', 'review'] as const;
export type CoachMode = typeof VALID_COACH_MODES[number];

// Reasons for which we refund the quota (the student did not actually get
// served an answer that consumed LLM tokens). Service-side validation errors
// (scope_mismatch, low_similarity, no_supporting_chunks) are NOT refunded:
// the service did run retrieval + possibly Claude on the student's behalf.
export const REFUND_ABSTAIN_REASONS: AbstainReason[] = [
  'upstream_error',
  'circuit_open',
  'chapter_not_ready',
];

export const LEGACY_FALLBACK_ABSTAIN_REASONS: AbstainReason[] = [
  'upstream_error',
  'circuit_open',
];

// Quota per plan per day
export const DAILY_QUOTA: Record<string, number> = {
  free: 10,
  starter: 30,
  pro: 100,
  unlimited: 999999, // effectively unlimited
};
export const DEFAULT_QUOTA = 10;

// Soft upgrade prompts — shown ONLY when quota is near exhaustion (not on errors)
export const UPGRADE_PROMPTS: Record<string, { threshold: number; message: string; messageHi: string; nextPlan: string }> = {
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
export function normalizePlan(raw: string): string {
  return (raw || 'free')
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro')
    .replace(/^ultimate$/, 'unlimited');
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RagSource {
  chunk_id: string;
  subject: string;
  chapter?: string;
  page_number?: number;
  similarity: number;
  content_preview: string;
  media_url?: string | null;
}

export interface DiagramRef {
  url: string;
  title: string;
  pageNumber?: number;
  description: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Cognitive Context Types ────────────────────────────────────────────────

export interface CognitiveContext {
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

export const EMPTY_COGNITIVE_CONTEXT: CognitiveContext = {
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

// ─── Helper: error response ───────────────────────────────────────────────────

export function errorJson(
  message: string,
  message_hi: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json({ success: false, error: message, error_hi: message_hi, ...extra }, { status });
}

// ─── Helper: map foxy mode → event mode ───────────────────────────────────────

/**
 * Map the route's foxy mode (the UI-facing vocabulary) to the
 * ai.foxy_session_started event's mode enum. Pure — exported for tests.
 *
 *   'learn' | 'explain' | 'practice' → 'tutor' (all are tutoring shapes)
 *   'revise'                          → 'revision'
 *   anything else                     → 'tutor' (safe default)
 *
 * The event registry's 'doubt_solve' mode is not produced from the
 * route's `mode` parameter alone — the route has a separate intent
 * classifier (classifyIntent). A future PR may pass that through here.
 */
export function mapFoxyModeToEventMode(
  routeMode: string,
): 'tutor' | 'doubt_solve' | 'revision' {
  if (routeMode === 'revise') return 'revision';
  return 'tutor';
}
