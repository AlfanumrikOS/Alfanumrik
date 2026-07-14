// packages/lib/src/foxy/perception.ts
//
// Foxy Perception (Phase 1C, 2026-07-15) — the per-turn "sensor".
//
// Turns each Foxy tutoring turn into structured, PII-free signal:
//   topic (resolved to a chapter_concepts uuid), Bloom level, misconception
//   code, struggle signal, and learner intent.
//
// Per the locked architecture the LLM classification runs ONLY on the Python
// MOL service (POST /v1/classify) — this module is a PURE ORCHESTRATOR around
// that call: it builds a compact classification body, forwards it via
// callPythonMol, parses + validates the returned JSON into a TurnClassification
// (Bloom LOWERCASE), and resolves the topic label to a topicId using the
// EXISTING chapter_concepts resolver. It never calls an LLM itself.
//
// Contract (fail-safe everywhere):
//   * Returns null on ANY failure — empty PYTHON_AI_BASE_URL (client returns
//     null), a down/absent service, a non-2xx, an unparseable body, or a
//     validation miss. A caller (the Foxy route) fires this forget-and-forget,
//     so a null result simply means "no observation emitted this turn".
//   * NEVER throws.
//
// P12: classification is internal (age-appropriate CBSE scope enforced by the
//   Python classifier's prompt + the model). This module publishes NOTHING to
//   students.
// P13: the returned TurnClassification carries CODES / IDs / ENUMS ONLY — never
//   the student's message text, name, email, or phone. The raw turn text is
//   sent to the Python classifier (same internal trust boundary as the tutor
//   LLM call) but is NEVER placed on the returned object, and callers map it
//   1:1 onto the `learner.turn_classified` event payload (codes/ids/enums only).
//   `misconceptionCode` is validated against the same ontology regex the
//   misconception curator uses, so a hallucinated free-text label is dropped.
//
// BINDING learner-state contract (assessment-issued): this is OBSERVABILITY
// ONLY. No caller may consume a TurnClassification to write any mastery / p_know
// / error surface. See the learner.turn_classified registry header.
//
// Owner: ai-engineer. Reviewers: assessment (classification semantics +
//   curriculum scope + Bloom/misconception mapping), testing.

import type { SupabaseClient } from '@supabase/supabase-js';
import { callPythonMol } from '@alfanumrik/lib/ai/clients/python-mol';
import { resolveLeadConceptId } from '@alfanumrik/lib/foxy/evidential-quiz';
import { parseFoxyChapterNumber } from '@alfanumrik/lib/foxy/chapter-parser';
import { MISCONCEPTION_CODE_REGEX } from '@alfanumrik/lib/super-admin/misconception-validation';
import { BLOOM_LEVELS, type BloomLevel } from '@alfanumrik/lib/cognitive-engine';

/** Struggle signals — MIRRORS the learner.turn_classified registry enum
 * (learner.struggle_observed's signalType plus 'none' for a clean turn). The
 * registry is the source of truth; this local copy exists only so the parser
 * can coerce a model label into the allowed set without a registry import
 * (which would drag Zod + the whole event union into this pure module). */
export const STRUGGLE_SIGNALS = [
  'none',
  'repeated_hint',
  'repeated_wrong',
  'explicit_confusion',
  'long_idle',
  'give_up',
] as const;
export type StruggleSignal = (typeof STRUGGLE_SIGNALS)[number];

const MAX_INTENT_LEN = 64;
const DEFAULT_INTENT = 'unknown';
const CLASSIFY_ENDPOINT = '/v1/classify';

/**
 * The PII-free, validated read of one Foxy turn. Fields map 1:1 onto the
 * derived fields of the `learner.turn_classified` event payload; the caller
 * supplies the envelope + studentId/foxySessionId/messageId/subjectCode/grade
 * (which it already holds) and never has to re-derive anything.
 */
export interface TurnClassification {
  /** chapter_concepts.id resolved from the classifier's topic label, or null.
   * Bound ONLY when the classifier's topic_label ACTUALLY matches a concept
   * (exact or substring title match, scoped to grade+subject+chapter). A null
   * label, a no-match, no chapter scope, or a cross-grade/cross-subject topic
   * all degrade to null — we never fall back to the chapter's first concept
   * here (that would systematically over-represent concept #1 in the
   * learner.turn_classified analytics this field feeds). NOTE: the GRADED
   * evidential-quiz path KEEPS the first-concept fallback; the degrade-to-null
   * rule is perception-only. */
  topicId: string | null;
  /** Positive chapter number, or null when the turn isn't chapter-bound. */
  chapterNumber: number | null;
  /** Bloom's taxonomy verb — canonical LOWERCASE, or null for a non-graded-
   * cognition moment (greeting / pure doubt). */
  bloomLevel: BloomLevel | null;
  /** Short curated misconception code (ontology regex validated), or null. */
  misconceptionCode: string | null;
  /** Observed struggle signal; 'none' for a clean turn. */
  struggleSignal: StruggleSignal;
  /** Short intent label (bounded code, never message text). */
  intent: string;
}

export interface ClassifyTurnInput {
  /** students.id PK (UUID). */
  studentId: string;
  /** P5 — grade string "6".."12". */
  grade: string;
  /** CBSE subject code / name. */
  subject: string;
  /** Free-form chapter (a number, "Chapter N", or a title), or null. */
  chapter: string | null;
  /** The student's message this turn. Sent to the Python classifier ONLY;
   * NEVER placed on the returned object or any event/log (P13). */
  studentMessage: string;
  /** Foxy's answer this turn. Same P13 handling as studentMessage. */
  foxyAnswer: string;
  /** The caller's forwarded bearer JWT (student token). Null → the Python auth
   * rejects and classifyTurn returns null (correct fail-safe). */
  authToken: string | null;
  /** RLS-scoped or service-role client used ONLY for the chapter_concepts
   * topic-label → topicId resolution (reuses resolveLeadConceptId). */
  supabase: Pick<SupabaseClient, 'from'>;
  /** Test/override seam forwarded to callPythonMol. */
  baseUrlOverride?: string;
  /** Test/override seam forwarded to callPythonMol. */
  timeoutMs?: number;
}

/** Shape the Python /v1/classify endpoint returns (snake_case). Everything is
 * optional/loose here because we defensively validate each field ourselves —
 * we never trust the model output shape. */
interface RawClassification {
  topic_label?: unknown;
  bloom_level?: unknown;
  misconception_code?: unknown;
  struggle_signal?: unknown;
  intent?: unknown;
}

// The four coerce* helpers below are the TS half of a cross-language contract:
// they MUST reject/accept exactly the same shapes as the Python `_coerce` in
// python/services/ai/business/foxy_perception/classifier.py (defence-in-depth —
// both layers validate). They are exported ONLY so the coercion-parity test can
// pin them 1:1 against the Python side against drift; nothing else consumes them
// directly. Keeping them exported does not change runtime behaviour.
export function coerceBloom(v: unknown): BloomLevel | null {
  if (typeof v !== 'string') return null;
  const lower = v.trim().toLowerCase();
  return (BLOOM_LEVELS as readonly string[]).includes(lower) ? (lower as BloomLevel) : null;
}

export function coerceMisconception(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = v.trim();
  if (code === '' || code.toLowerCase() === 'none' || code.toLowerCase() === 'null') return null;
  // Reuse the ontology regex the misconception curator enforces so a
  // hallucinated free-text label is dropped rather than emitted.
  return MISCONCEPTION_CODE_REGEX.test(code) ? code : null;
}

export function coerceStruggle(v: unknown): StruggleSignal {
  if (typeof v !== 'string') return 'none';
  const s = v.trim().toLowerCase();
  return (STRUGGLE_SIGNALS as readonly string[]).includes(s) ? (s as StruggleSignal) : 'none';
}

export function coerceIntent(v: unknown): string {
  if (typeof v !== 'string') return DEFAULT_INTENT;
  const t = v.trim().toLowerCase().replace(/\s+/g, '_');
  if (t === '') return DEFAULT_INTENT;
  return t.slice(0, MAX_INTENT_LEN);
}

/**
 * Classify one Foxy turn. Returns a validated, PII-free TurnClassification, or
 * null on ANY failure. Pure orchestration — the LLM work happens in Python.
 */
export async function classifyTurn(input: ClassifyTurnInput): Promise<TurnClassification | null> {
  try {
    const chapterNumber = parseFoxyChapterNumber(input.chapter);

    // 1. Build the compact classification body. The student message + Foxy
    //    answer are the classifier's evidence; grade/subject/chapter scope it.
    const body = {
      student_id: input.studentId,
      grade: input.grade,
      subject: input.subject,
      chapter_number: chapterNumber,
      student_message: input.studentMessage,
      foxy_answer: input.foxyAnswer,
    };

    // 2. Call the Python MOL service. Returns null when the service is dark
    //    (empty PYTHON_AI_BASE_URL), down, slow, or non-2xx.
    const raw = await callPythonMol({
      endpointPath: CLASSIFY_ENDPOINT,
      authToken: input.authToken,
      body,
      baseUrlOverride: input.baseUrlOverride,
      timeoutMs: input.timeoutMs,
    });
    if (raw === null) return null;

    // 3. Parse + validate. Never trust the shape.
    let parsed: RawClassification;
    try {
      const j = JSON.parse(raw);
      if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
      parsed = j as RawClassification;
    } catch {
      return null;
    }

    const bloomLevel = coerceBloom(parsed.bloom_level);
    const misconceptionCode = coerceMisconception(parsed.misconception_code);
    const struggleSignal = coerceStruggle(parsed.struggle_signal);
    const intent = coerceIntent(parsed.intent);

    // 4. Resolve the classifier's topic LABEL to a chapter_concepts.id using
    //    the EXISTING resolver (no duplication). We bind topicId ONLY on a REAL
    //    title match (resolved.match === 'title_match'); a first-concept fallback
    //    degrades to null. This is the perception-only rule: turn_classified
    //    feeds analytics/reports, and silently binding concept #1 on every
    //    no-match/null-label turn would systematically over-represent each
    //    chapter's first concept. (The graded evidential-quiz path deliberately
    //    KEEPS the fallback — see resolveLeadConceptId's ConceptMatchKind doc.)
    //    A title match needs BOTH a scoping chapter AND a label, so we only pay
    //    for the lookup when both are present; every other case is null.
    let topicId: string | null = null;
    const topicLabel =
      typeof parsed.topic_label === 'string' && parsed.topic_label.trim() !== ''
        ? parsed.topic_label.trim()
        : null;
    if (topicLabel !== null && chapterNumber !== null) {
      try {
        const resolved = await resolveLeadConceptId(input.supabase, {
          subject: input.subject,
          grade: input.grade,
          chapter: input.chapter,
          leadConceptTitle: topicLabel,
        });
        topicId = resolved.ok && resolved.match === 'title_match' ? resolved.concept.id : null;
      } catch {
        topicId = null;
      }
    }

    return {
      topicId,
      chapterNumber,
      bloomLevel,
      misconceptionCode,
      struggleSignal,
      intent,
    };
  } catch {
    // Absolute backstop — a bad classification is a silent no-op, never a throw.
    return null;
  }
}
