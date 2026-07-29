/**
 * Lesson Generation Agent — grounded-generation ORCHESTRATOR (GenAI Phase 5b).
 *
 * Spec: docs/superpowers/specs/2026-07-24-lesson-generation-agent-design.md §3
 *
 * This is the impure orchestration layer that sits ON TOP of the pure planning
 * core (`./lesson-plan.ts`, `./types.ts`, assessment-owned). It turns a
 * `LessonRequest` + narrow `LessonMemoryInput` into `LessonNotes` by:
 *
 *   1. planLesson(request, memory)          — pure HOW decision (assessment core)
 *   2. build ONE GroundedRequest            — caller='lesson', strict, cache none
 *   3. callGroundedAnswer(...) exactly ONCE — single RAG retrieval (REG-50 spirit)
 *   4. abstain ladder                       — grounded=false OR confidence < 0.75
 *   5. parse the structured JSON answer     — into LessonSection[] + citations
 *   6. node-side safety backstop            — screenStudentFacingText on EVERY
 *                                             EN + Hindi field (defense-in-depth
 *                                             over the Edge Function's own screen)
 *
 * ── HARD RULES (product invariants) ──────────────────────────────────────────
 *  - Grounded path ONLY. No direct Claude/Voyage call — everything flows through
 *    `callGroundedAnswer` (AI-boundary rule `no-direct-ai-calls`).              [P12]
 *  - `mode:'strict'` + abstain on low confidence — no ungrounded prose reaches a
 *    student. Thresholds are IMPORTED from grounding-config, never hardcoded.    [P12]
 *  - `cache_scope:'none'` — lesson notes are per-student personalized, so shared
 *    caching is prohibited (spec §5).
 *  - Node-side `screenStudentFacingText` on every rendered EN/Hindi field.       [P12]
 *  - Bilingual — every section carries EN + Hindi (enforced at parse time).      [P7]
 *  - Grades are STRING "6".."12".                                                [P5]
 *  - No PII in logs — category/metadata only, never student text or ids.         [P13]
 *  - Writes NOTHING — no mastery/progression writes (mayWriteMastery:false).
 *  - Fail-soft — a generation failure returns an abstain, NEVER throws / 500s.
 */
import {
  STRICT_CONFIDENCE_ABSTAIN_THRESHOLD,
  RAG_MATCH_COUNT,
} from '../grounding-config';
import {
  callGroundedAnswer as defaultCallGroundedAnswer,
  type GroundedRequest,
  type GroundedResponse,
  type Citation,
  type AbstainReason,
  type SuggestedAlternative,
} from '../ai/grounded-client';
import {
  screenStudentFacingText as defaultScreen,
  type OutputScreenResult,
} from '../ai/validation/output-screen';
import { BLOOM_ORDER, type BloomLevel } from '../cognitive-engine';
import { logger } from '../logger';
import { planLesson, renderAdaptationCodes } from './lesson-plan';
import type {
  LessonRequest,
  LessonMemoryInput,
  LessonNotes,
  LessonSection,
  LessonSectionKind,
  LessonMeta,
  LessonPlan,
  LessonDepth,
} from './types';

// ─── Generation constants (not thresholds — no mastery math here) ─────────────

/** Token budget scales with depth (JSON multi-section notes are token-heavy). */
const LESSON_MAX_TOKENS_BY_DEPTH: Record<LessonDepth, number> = {
  brief: 1800,
  standard: 2800,
  deep: 3600,
};

/**
 * Low temperature — this is factual, NCERT-grounded content. Well under the
 * P12 rejection line (never > 0.7 for factual answers). Strict mode keeps the
 * caller-supplied temperature, so this actually reaches Claude.
 */
const LESSON_TEMPERATURE = 0.2;

/** Upstream (Voyage + Claude) budget the Edge Function enforces internally. */
const LESSON_TIMEOUT_MS = 55_000;

/**
 * Transport hop timeout for `callGroundedAnswer`. Must exceed `timeout_ms` so
 * the service can return its own abstain payload before we give up (the client
 * default of 2000ms would abort a real generation mid-flight).
 */
const LESSON_HOP_TIMEOUT_MS = 60_000;

const VALID_SECTION_KINDS: ReadonlySet<LessonSectionKind> = new Set<LessonSectionKind>([
  'hook',
  'core_concepts',
  'misconception_callouts',
  'active_recall',
  'application',
  'revision_summary',
]);

// ─── Injectable dependencies (testing fakes the grounded call + the screen) ───

export interface GenerateLessonDeps {
  /** The sanctioned grounded-answer client. Faked in tests. */
  callGroundedAnswer: (
    request: GroundedRequest,
    options?: { hopTimeoutMs?: number },
  ) => Promise<GroundedResponse>;
  /** The deterministic node-side safety screen. Faked in tests. */
  screen: (
    text: string,
    context?: { grade?: string; subject?: string },
  ) => OutputScreenResult;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate personalized, NCERT-grounded, bilingual lesson notes for one chapter.
 *
 * NEVER throws — every failure path (upstream error, low confidence, parse
 * failure, all-sections-screened-out) returns a safe abstain envelope. The
 * caller (an API route) treats an abstain as a normal 200 response, not a 500.
 *
 * @param request Caller-supplied WHAT + presentation hints (grade STRING, P5).
 * @param memory  Narrow adaptation signals (adapted upstream from StudentMemory).
 * @param deps    Optional injected fakes (testing). Defaults to the real client.
 */
export async function generateLessonNotes(
  request: LessonRequest,
  memory: LessonMemoryInput,
  deps: Partial<GenerateLessonDeps> = {},
): Promise<LessonNotes> {
  const call = deps.callGroundedAnswer ?? defaultCallGroundedAnswer;
  const screen = deps.screen ?? defaultScreen;

  try {
    // 1. Pure HOW decision (assessment core). Deterministic, never throws on
    //    well-formed input; the outer try/catch is the last-resort backstop.
    const plan = planLesson(request, memory);
    const adaptationApplied = renderAdaptationCodes(plan);

    // 2. ONE grounded request.
    const groundedRequest = buildGroundedRequest(request, memory, plan);

    // 3. ONE grounded call (single RAG retrieval — REG-50 spirit).
    const response = await call(groundedRequest, { hopTimeoutMs: LESSON_HOP_TIMEOUT_MS });

    // 4a. Abstain ladder — grounded === false (no_chunks / low_similarity /
    //     scope_mismatch / chapter_not_ready / upstream_error / circuit_open).
    if (!response.grounded) {
      logLesson('lesson.abstain', {
        stage: 'grounded_false',
        reason: response.abstain_reason,
        trace_id: response.trace_id,
      });
      return buildAbstain(
        response.abstain_reason,
        response.suggested_alternatives,
        adaptationApplied,
        { traceId: response.trace_id, latency: response.meta.latency_ms },
      );
    }

    const meta: LessonMeta = {
      traceId: response.trace_id,
      model: response.meta.claude_model,
      tokens: response.meta.tokens_used,
      latency: response.meta.latency_ms,
      confidence: response.confidence,
    };

    // 4b. Abstain ladder — grounded === true but confidence below the STRICT
    //     abstain threshold (imported, never hardcoded).
    if (
      typeof response.confidence !== 'number' ||
      response.confidence < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD
    ) {
      logLesson('lesson.abstain', {
        stage: 'low_confidence',
        confidence: response.confidence,
        trace_id: response.trace_id,
      });
      // grounded=true carries no suggested_alternatives — return empty list.
      return buildAbstain('low_similarity', [], adaptationApplied, meta);
    }

    // 5. Parse the structured JSON answer into grounded sections. (The Edge
    //    Function only populates `structured` for caller='foxy', so the lesson
    //    JSON rides in `answer` and we parse it here.)
    const parsedSections = parseLessonSections(response.answer, response.citations, plan);
    if (parsedSections.length === 0) {
      logLesson('lesson.abstain', {
        stage: 'parse_empty',
        trace_id: response.trace_id,
      });
      return buildAbstain('no_supporting_chunks', [], adaptationApplied, meta);
    }

    // 6. NODE-SIDE SAFETY BACKSTOP (defense-in-depth over the Edge Function's
    //    own internal output screen). Screen EVERY EN + Hindi field of EVERY
    //    section; drop any unsafe section and log CATEGORY-ONLY (P13 — no text).
    const safeSections: LessonSection[] = [];
    for (const section of parsedSections) {
      const screenResult = screenSection(section, request, screen);
      if (!screenResult.safe) {
        logLesson('lesson.section_screened_out', {
          kind: section.kind,
          categories: screenResult.categories,
          trace_id: response.trace_id,
        });
        continue;
      }
      safeSections.push(section);
    }

    // If the safety backstop dropped every section, the whole lesson abstains.
    if (safeSections.length === 0) {
      logLesson('lesson.abstain', {
        stage: 'all_sections_unsafe',
        trace_id: response.trace_id,
      });
      return buildAbstain('upstream_error', [], adaptationApplied, meta);
    }

    return {
      abstained: false,
      sections: safeSections,
      adaptationApplied,
      citationsAll: dedupeCitations(safeSections.flatMap((s) => s.citations)),
      meta,
    };
  } catch (err) {
    // FAIL-SOFT: never throw into the caller — a generation failure is an
    // abstain, not a 500. Log category/message only (P13 — no student text).
    logLesson('lesson.generate_error', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    return buildAbstain('upstream_error', [], [], {});
  }
}

// ─── Request assembly ─────────────────────────────────────────────────────────

function buildGroundedRequest(
  request: LessonRequest,
  memory: LessonMemoryInput,
  plan: LessonPlan,
): GroundedRequest {
  return {
    caller: 'lesson',
    student_id: request.studentId,
    // Per-student personalization is present -> shared caching is prohibited.
    cache_scope: 'none',
    query: buildRetrievalQuery(request),
    scope: {
      board: 'CBSE',
      grade: request.grade,
      subject_code: request.subject,
      chapter_number: request.chapter.chapterNumber,
      chapter_title: request.chapter.chapterTitle,
    },
    mode: 'strict',
    generation: {
      model_preference: 'auto',
      max_tokens: LESSON_MAX_TOKENS_BY_DEPTH[plan.depth] ?? LESSON_MAX_TOKENS_BY_DEPTH.standard,
      temperature: LESSON_TEMPERATURE,
      system_prompt_template: 'lesson_notes_v1',
      template_variables: buildTemplateVariables(request, memory, plan),
    },
    retrieval: { match_count: RAG_MATCH_COUNT },
    timeout_ms: LESSON_TIMEOUT_MS,
  };
}

/**
 * The retrieval query embedded for RAG. Scope already pins grade/subject/chapter,
 * so this query mainly RANKS the within-chapter chunks toward lesson-note content.
 * PII-free (chapter title + subject/grade only).
 */
function buildRetrievalQuery(request: LessonRequest): string {
  const title =
    typeof request.chapter.chapterTitle === 'string' && request.chapter.chapterTitle.trim().length > 0
      ? request.chapter.chapterTitle.trim()
      : `Chapter ${request.chapter.chapterNumber}`;
  return `Key concepts, definitions, worked examples, and revision summary for ${title} in CBSE Grade ${request.grade} ${request.subject}.`;
}

/**
 * The `template_variables` the `lesson_notes_v1` prompt reads. All values are
 * strings (the grounded contract). PII-free: mastery band, plan enums, and
 * misconception LABELS + remediation seeds (curriculum text, not student PII).
 * grade/subject/board/chapter_suffix are omitted here — the grounded-answer
 * pipeline computes those service-side from `scope` and they win on collision.
 */
function buildTemplateVariables(
  request: LessonRequest,
  memory: LessonMemoryInput,
  plan: LessonPlan,
): Record<string, string> {
  const misconceptionList =
    memory.recentMisconceptions
      .map((m) => `${m.label} (remediation seed: ${m.remediationText})`)
      .filter((s) => s.trim().length > 0)
      .join('; ') || 'none';

  return {
    language: request.language,
    mastery_band: memory.masteryLevel,
    depth: plan.depth,
    scaffolding_level: plan.scaffoldingLevel,
    persona_tone: plan.personaTone,
    bloom_anchor: plan.bloomCeiling,
    misconception_list: misconceptionList,
    emphasis_topics: plan.emphasisTopics.join(', ') || 'none',
    section_plan: plan.sectionKinds.join(', '),
  };
}

// ─── Structured-answer parsing ────────────────────────────────────────────────

/**
 * Parse the model's strict-JSON answer into grounded `LessonSection[]`.
 * Tolerant + defensive: malformed sections are DROPPED (never fabricated), a
 * section with no groundable citation is dropped, and bloomLevel is clamped to
 * the plan's ceiling. Returns [] when nothing parseable/groundable remains.
 */
function parseLessonSections(
  answer: string,
  citations: Citation[],
  plan: LessonPlan,
): LessonSection[] {
  const parsed = tolerantJsonParse(answer);
  if (!parsed || typeof parsed !== 'object') return [];

  const rawSections = (parsed as { sections?: unknown }).sections;
  if (!Array.isArray(rawSections)) return [];

  const out: LessonSection[] = [];
  for (const raw of rawSections) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;

    const kind = r.kind;
    if (typeof kind !== 'string' || !VALID_SECTION_KINDS.has(kind as LessonSectionKind)) continue;

    const headingEn = asNonEmptyString(r.headingEn);
    const headingHi = asNonEmptyString(r.headingHi);
    const bodyEn = asNonEmptyString(r.bodyEn);
    const bodyHi = asNonEmptyString(r.bodyHi);
    // Bilingual (P7): every human-readable field must be populated, else drop.
    if (!headingEn || !headingHi || !bodyEn || !bodyHi) continue;

    const bloomLevel = isBloomLevel(r.bloomLevel)
      ? clampBloom(r.bloomLevel, plan.bloomCeiling)
      : plan.bloomCeiling;

    // Grounded: attach the retrieved citation(s) the model pointed at; a section
    // that can be tied to NO retrieved chunk is ungroundable -> dropped.
    const sectionCitations = resolveSectionCitations(r.supportingCitationIndexes, citations);
    if (sectionCitations.length === 0) continue;

    out.push({
      kind: kind as LessonSectionKind,
      headingEn,
      headingHi,
      bodyEn,
      bodyHi,
      citations: sectionCitations,
      bloomLevel,
    });
  }
  return out;
}

/**
 * Map the model's `supportingCitationIndexes` ([n] values) onto the actual
 * retrieved `Citation` objects. Falls back to the FULL retrieved set when the
 * model gave no valid index — the sections come from a SINGLE retrieval, so any
 * retrieved chunk is a legitimate grounding for the lesson. Returns [] only when
 * the grounded call itself returned zero citations.
 */
function resolveSectionCitations(rawIndexes: unknown, citations: Citation[]): Citation[] {
  if (citations.length === 0) return [];

  const byIndex = new Map<number, Citation>();
  for (const c of citations) byIndex.set(c.index, c);

  const picked: Citation[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawIndexes)) {
    for (const idx of rawIndexes) {
      const n = typeof idx === 'number' ? idx : Number(idx);
      if (!Number.isFinite(n)) continue;
      const c = byIndex.get(n);
      if (c && !seen.has(c.chunk_id)) {
        seen.add(c.chunk_id);
        picked.push(c);
      }
    }
  }

  return picked.length > 0 ? picked : dedupeCitations(citations);
}

// ─── Node-side safety backstop ────────────────────────────────────────────────

/**
 * Screen every EN + Hindi field of a section. `safe:false` if ANY field is
 * unsafe. Categories are de-duped across fields (telemetry only — no text).
 */
function screenSection(
  section: LessonSection,
  request: LessonRequest,
  screen: GenerateLessonDeps['screen'],
): OutputScreenResult {
  const fields = [section.headingEn, section.headingHi, section.bodyEn, section.bodyHi];
  const categories = new Set<string>();
  let safe = true;
  for (const field of fields) {
    const result = screen(field, { grade: request.grade, subject: request.subject });
    if (!result.safe) {
      safe = false;
      for (const category of result.categories) categories.add(category);
    }
  }
  return { safe, categories: [...categories] };
}

// ─── Small pure helpers ───────────────────────────────────────────────────────

function tolerantJsonParse(text: string): unknown {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to brace-slice recovery */
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      /* give up */
    }
  }
  return null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isBloomLevel(value: unknown): value is BloomLevel {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BLOOM_ORDER, value);
}

function clampBloom(level: BloomLevel, ceiling: BloomLevel): BloomLevel {
  return BLOOM_ORDER[level] <= BLOOM_ORDER[ceiling] ? level : ceiling;
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of citations) {
    if (seen.has(c.chunk_id)) continue;
    seen.add(c.chunk_id);
    out.push(c);
  }
  return out;
}

/** Bilingual (P7) safe abstain copy. Reused for every whole-lesson abstain. */
const ABSTAIN_MESSAGE_EN =
  "Lesson notes for this chapter aren't ready yet. Try one of the suggested chapters below, or check back soon.";
const ABSTAIN_MESSAGE_HI =
  'इस chapter के lesson notes अभी तैयार नहीं हैं। नीचे सुझाए गए किसी chapter को आज़माएँ, या थोड़ी देर बाद दोबारा देखें।';

function buildAbstain(
  reason: AbstainReason,
  suggestedAlternatives: SuggestedAlternative[],
  adaptationApplied: string[],
  meta: LessonMeta,
): LessonNotes {
  return {
    abstained: true,
    abstain: {
      reason,
      // grounded=false surfaces the service's suggested_alternatives (ready
      // chapters); every post-grounding abstain path passes [].
      suggestedAlternatives,
      messageEn: ABSTAIN_MESSAGE_EN,
      messageHi: ABSTAIN_MESSAGE_HI,
    },
    sections: [],
    adaptationApplied,
    citationsAll: [],
    meta,
  };
}

/** PII-free structured log. Never throws — logging must not break generation. */
function logLesson(event: string, data: Record<string, unknown>): void {
  try {
    logger.info(event, data);
  } catch {
    /* swallow — telemetry must never affect the student-facing path */
  }
}
