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
import { UNLIMITED_USAGE_SENTINEL } from '@alfanumrik/lib/usage-sentinel';

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
export const VALID_MODES = ['learn', 'explain', 'practice', 'revise', 'doubt', 'homework', 'explorer', 'olympiad', 'lesson'];

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

// Sentinel that mirrors the DB's "unlimited" cap. `get_plan_limit()` maps a
// `subscription_plans.foxy_chats_per_day = -1` (unlimited) to 999999, so any
// plan whose returned limit is >= this value is treated as effectively
// uncapped by the Node layer (no "messages left" countdown pressure, no upsell).
//
// SINGLE SOURCE: the literal `999999` lives in exactly ONE place across all
// layers — the dependency-free `@alfanumrik/lib/usage-sentinel` leaf. We alias
// it here as `UNLIMITED_QUOTA` so every existing route/quota importer keeps
// working unchanged, while the value can never drift from the DB-mirroring leaf
// that `packages/lib/src/usage.ts` and the entitlements catalog also consume.
//
// NOTE: enforcement + the effective per-plan cap live ENTIRELY in the DB
// (`check_and_record_usage` → `get_plan_limit` → subscription_plans). There is
// deliberately NO Node-side per-plan quota table here anymore — a stale local
// copy is exactly what made `remaining` wrong and implied a false authority.
export const UNLIMITED_QUOTA = UNLIMITED_USAGE_SENTINEL;

// Soft upgrade prompts — shown ONLY when quota is near exhaustion (not on errors).
//
// Only the finite FREE tier can surface a nudge. The paid plans (starter / pro /
// unlimited) are all UNLIMITED for Foxy chats (subscription_plans.foxy_chats_
// per_day = -1 → UNLIMITED_QUOTA), so there is nothing to upsell and no key is
// present for them — an absent key means "never prompt". `showAtRemaining` is the
// number of chats remaining (post-turn) at or below which the nudge appears; it
// is expressed in absolute `remaining` terms so it is robust to the exact free
// cap (5, 10, …) without re-deriving a limit here. P7: EN + Hindi.
export const UPGRADE_PROMPTS: Record<string, { showAtRemaining: number; message: string; messageHi: string; nextPlan: string }> = {
  free: {
    showAtRemaining: 2, // nudge when 2 or fewer Foxy chats remain today
    message: 'You have {remaining} Foxy messages left today. Upgrade to Starter for unlimited daily chats!',
    messageHi: 'आज आपके {remaining} Foxy मैसेज बाकी हैं। Starter प्लान लें और असीमित चैट पाएं!',
    nextPlan: 'starter',
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
