/**
 * Content Generation Agent — grounded-generation ORCHESTRATOR (GenAI Phase 5c).
 *
 * Spec: docs/superpowers/specs/2026-07-24-content-generation-agent-design.md §3
 *
 * This is the impure orchestration layer that sits ON TOP of the pure planning
 * core (`./diagram-plan.ts`, `./types.ts`, assessment-owned). It turns a
 * `DiagramRequest` + narrow `DiagramMemoryInput` into a single validated
 * `DiagramSpec` by:
 *
 *   1. planDiagram(request, memory)          — pure HOW decision (assessment core)
 *   2. build ONE GroundedRequest            — caller='content', strict, cache none
 *   3. callGroundedAnswer(...) exactly ONCE — single RAG retrieval (REG-50 spirit)
 *   4. abstain ladder                       — grounded=false OR confidence < 0.75
 *   5. parse the structured JSON answer     — into { mermaidCode, title/caption, cites }
 *   6. SAFETY GATE 1 (structure/injection)  — validateMermaidCode + v1-kind header
 *   7. SAFETY GATE 2 (age/toxicity)         — screenStudentFacingText on EVERY
 *                                             student-facing field AND the whole
 *                                             mermaidCode string (node labels are
 *                                             user-facing text)
 *
 * ── HARD RULES (product invariants) ──────────────────────────────────────────
 *  - Grounded path ONLY. No direct Claude/Voyage call — everything flows through
 *    `callGroundedAnswer` (AI-boundary rule `no-direct-ai-calls`).              [P12]
 *  - `mode:'strict'` + abstain on low confidence — no ungrounded diagram reaches
 *    a student. Thresholds are IMPORTED from grounding-config, never hardcoded.  [P12]
 *  - TWO safety gates, in order: (1) validateMermaidCode (REUSED verbatim from
 *    foxy/schema — injection/grammar gate) + v1-kind header; (2) node-side
 *    screenStudentFacingText on title/caption AND the whole mermaidCode. Either
 *    failing → whole-diagram abstain. NO raw-SVG fallback, NO re-prompt.         [P12]
 *  - `cache_scope:'none'` — the diagram is per-student personalized (mastery band
 *    → node budget, learning style → density), so shared caching is prohibited
 *    (spec §4).
 *  - Bilingual — titleEn/Hi + captionEn/Hi always both populated.               [P7]
 *  - Grades are STRING "6".."12".                                               [P5]
 *  - No PII in logs — category/metadata only, never student text or ids.        [P13]
 *  - Writes NOTHING — no mastery/progression writes (mayWriteMastery:false). This
 *    module touches NO mastery table (scanned by conformance invariant (e)).
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
import { validateMermaidCode } from '../foxy/schema';
import { logger } from '../logger';
import { planDiagram } from './diagram-plan';
import type {
  DiagramRequest,
  DiagramMemoryInput,
  DiagramSpec,
  DiagramPlan,
  DiagramKind,
  DiagramMeta,
} from './types';

// ─── Generation constants (not thresholds — no mastery math here) ─────────────

/**
 * Token budget for ONE small diagram (a Mermaid string + 4 short strings). Well
 * under the lesson agent's multi-section budget — a diagram is a single compact
 * artifact (spec §3.2 sizes it "small").
 */
const DIAGRAM_MAX_TOKENS = 1200;

/**
 * Low temperature — this is factual, NCERT-grounded structure. Well under the
 * P12 rejection line (never > 0.7 for factual answers).
 */
const DIAGRAM_TEMPERATURE = 0.2;

/** Upstream (Voyage + Claude) budget the Edge Function enforces internally. */
const DIAGRAM_TIMEOUT_MS = 55_000;

/**
 * Transport hop timeout for `callGroundedAnswer`. Must exceed `timeout_ms` so
 * the service can return its own abstain payload before we give up (the client
 * default of 2000ms would abort a real generation mid-flight).
 */
const DIAGRAM_HOP_TIMEOUT_MS = 60_000;

/** Safe default kind for abstain envelopes when no plan exists (outer catch). */
const DEFAULT_DIAGRAM_KIND: DiagramKind = 'mindmap';

/**
 * The v1 Mermaid header tokens accepted by Gate 1's kind check (spec §2.1 / §3.6).
 * Deliberately narrower than `MERMAID_ALLOWED_HEADERS` — `flowchart`/`graph` both
 * map to the `flowchart` kind; anything else abstains even though
 * `validateMermaidCode` would allow more headers.
 */
const V1_HEADER_TO_KIND: Readonly<Record<string, DiagramKind>> = {
  flowchart: 'flowchart',
  graph: 'flowchart',
  mindmap: 'mindmap',
  timeline: 'timeline',
};

// ─── Injectable dependencies (testing fakes the grounded call + the screen) ───

export interface GenerateDiagramDeps {
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
 * Generate ONE personalized, NCERT-grounded, bilingual Mermaid diagram spec for
 * one chapter.
 *
 * NEVER throws — every failure path (upstream error, low confidence, parse
 * failure, Gate 1 injection/kind failure, Gate 2 toxicity failure) returns a
 * safe abstain envelope. The caller (an API route) treats an abstain as a normal
 * 200 response, not a 500. There is NO raw-SVG / raster fallback — abstain is the
 * only failure mode (spec §3.4).
 *
 * @param request Caller-supplied WHAT + presentation hints (grade STRING, P5).
 * @param memory  Narrow adaptation signals (adapted upstream from StudentMemory).
 * @param deps    Optional injected fakes (testing). Defaults to the real client.
 */
export async function generateDiagram(
  request: DiagramRequest,
  memory: DiagramMemoryInput,
  deps: Partial<GenerateDiagramDeps> = {},
): Promise<DiagramSpec> {
  const call = deps.callGroundedAnswer ?? defaultCallGroundedAnswer;
  const screen = deps.screen ?? defaultScreen;

  try {
    // 1. Pure HOW decision (assessment core). Deterministic, never throws on
    //    well-formed input; the outer try/catch is the last-resort backstop.
    const plan = planDiagram(request, memory);

    // 2. ONE grounded request.
    const groundedRequest = buildGroundedRequest(request, memory, plan);

    // 3. ONE grounded call (single RAG retrieval — REG-50 spirit).
    const response = await call(groundedRequest, { hopTimeoutMs: DIAGRAM_HOP_TIMEOUT_MS });

    // 4a. Abstain ladder — grounded === false (no_chunks / low_similarity /
    //     scope_mismatch / chapter_not_ready / upstream_error / circuit_open).
    if (!response.grounded) {
      logDiagram('diagram.abstain', {
        stage: 'grounded_false',
        reason: response.abstain_reason,
        trace_id: response.trace_id,
      });
      return buildAbstain(
        response.abstain_reason,
        response.suggested_alternatives,
        plan.diagramKind,
        { traceId: response.trace_id, latency: response.meta.latency_ms },
      );
    }

    const meta: DiagramMeta = {
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
      logDiagram('diagram.abstain', {
        stage: 'low_confidence',
        confidence: response.confidence,
        trace_id: response.trace_id,
      });
      // grounded=true carries no suggested_alternatives — return empty list.
      return buildAbstain('low_similarity', [], plan.diagramKind, meta);
    }

    // 5. Parse the structured JSON answer. (The Edge Function only populates
    //    `structured` for caller='foxy', so the diagram JSON rides in `answer`
    //    and we parse it here.)
    const parsed = parseDiagramPayload(response.answer);
    if (!parsed) {
      logDiagram('diagram.abstain', {
        stage: 'parse_empty',
        trace_id: response.trace_id,
      });
      return buildAbstain('no_supporting_chunks', [], plan.diagramKind, meta);
    }

    // 6. SAFETY GATE 1 (structure/injection). validateMermaidCode is REUSED
    //    verbatim from foxy/schema — allowlisted header, no <script>/javascript:/
    //    click/%%{init}, <= FOXY_MAX_MERMAID_CODE_LEN. Then enforce the v1-kind
    //    constraint on the first header token. Either failing → ABSTAIN. NO
    //    raw-SVG fallback, NO re-prompt (spec §3.4).
    const mermaidError = validateMermaidCode(parsed.mermaidCode);
    if (mermaidError !== null) {
      logDiagram('diagram.abstain', {
        stage: 'gate1_mermaid_invalid',
        trace_id: response.trace_id,
      });
      return buildAbstain('upstream_error', [], plan.diagramKind, meta);
    }
    const emittedKind = resolveV1Kind(parsed.mermaidCode);
    if (emittedKind === null) {
      logDiagram('diagram.abstain', {
        stage: 'gate1_kind_out_of_v1_set',
        trace_id: response.trace_id,
      });
      return buildAbstain('upstream_error', [], plan.diagramKind, meta);
    }

    // 7. SAFETY GATE 2 (age/toxicity). Screen titleEn/Hi, captionEn/Hi AND the
    //    whole mermaidCode string (its node labels are student-facing text). Any
    //    unsafe field → ABSTAIN. Log CATEGORY-ONLY (P13 — never the text).
    const screenResult = screenAllFields(parsed, request, screen);
    if (!screenResult.safe) {
      logDiagram('diagram.abstain', {
        stage: 'gate2_unsafe',
        categories: screenResult.categories,
        trace_id: response.trace_id,
      });
      return buildAbstain('upstream_error', [], plan.diagramKind, meta);
    }

    // Grounded provenance: resolve the model's citation indexes onto the actual
    // retrieved chunks. A diagram with NO groundable citation is ungrounded.
    const citations = resolveCitations(parsed.supportingCitationIndexes, response.citations);
    if (citations.length === 0) {
      logDiagram('diagram.abstain', {
        stage: 'no_citations',
        trace_id: response.trace_id,
      });
      return buildAbstain('no_supporting_chunks', [], plan.diagramKind, meta);
    }

    return {
      abstained: false,
      mermaidCode: parsed.mermaidCode,
      diagramKind: emittedKind,
      titleEn: parsed.titleEn,
      titleHi: parsed.titleHi,
      captionEn: parsed.captionEn,
      captionHi: parsed.captionHi,
      citations,
      meta,
    };
  } catch (err) {
    // FAIL-SOFT: never throw into the caller — a generation failure is an
    // abstain, not a 500. Log category/message only (P13 — no student text).
    logDiagram('diagram.generate_error', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    return buildAbstain('upstream_error', [], DEFAULT_DIAGRAM_KIND, {});
  }
}

// ─── Request assembly ─────────────────────────────────────────────────────────

function buildGroundedRequest(
  request: DiagramRequest,
  memory: DiagramMemoryInput,
  plan: DiagramPlan,
): GroundedRequest {
  return {
    caller: 'content',
    student_id: request.studentId,
    // Per-student personalization is present -> shared caching is prohibited.
    cache_scope: 'none',
    query: buildRetrievalQuery(request, plan),
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
      max_tokens: DIAGRAM_MAX_TOKENS,
      temperature: DIAGRAM_TEMPERATURE,
      system_prompt_template: 'diagram_spec_v1',
      template_variables: buildTemplateVariables(request, memory, plan),
    },
    retrieval: { match_count: RAG_MATCH_COUNT },
    timeout_ms: DIAGRAM_TIMEOUT_MS,
  };
}

/**
 * The retrieval query embedded for RAG. Scope already pins grade/subject/chapter,
 * so this query mainly RANKS the within-chapter chunks toward the structural
 * content the chosen diagram kind depicts. PII-free (chapter title + subject/
 * grade + diagram kind only).
 */
function buildRetrievalQuery(request: DiagramRequest, plan: DiagramPlan): string {
  const title =
    typeof request.chapter.chapterTitle === 'string' && request.chapter.chapterTitle.trim().length > 0
      ? request.chapter.chapterTitle.trim()
      : `Chapter ${request.chapter.chapterNumber}`;
  return `Key concepts, steps, relationships, and structure to draw a ${plan.diagramKind} diagram of ${title} in CBSE Grade ${request.grade} ${request.subject}.`;
}

/**
 * The `template_variables` the `diagram_spec_v1` prompt reads (spec §3.1). All
 * values are strings (the grounded contract). PII-free: diagram kind, node
 * budget, learning-style enum, language. grade/subject/board/chapter_suffix are
 * omitted here — the grounded-answer pipeline computes those service-side from
 * `scope` and they win on collision (same convention the lesson agent uses).
 */
function buildTemplateVariables(
  request: DiagramRequest,
  memory: DiagramMemoryInput,
  plan: DiagramPlan,
): Record<string, string> {
  return {
    diagram_kind: plan.diagramKind,
    max_nodes: String(plan.maxNodes),
    learning_style: normalizeLearningStyle(memory.preferences.learningStyle),
    language: request.language,
  };
}

/** Learning style → a lean, PII-free enum-ish token for the prompt. */
function normalizeLearningStyle(style: string | null | undefined): string {
  const v = (style ?? '').trim().toLowerCase();
  return v.length > 0 ? v : 'unspecified';
}

// ─── Structured-answer parsing ────────────────────────────────────────────────

interface ParsedDiagram {
  mermaidCode: string;
  titleEn: string;
  titleHi: string;
  captionEn: string;
  captionHi: string;
  supportingCitationIndexes: unknown;
}

/**
 * Parse the model's strict-JSON answer into the raw diagram payload. Tolerant +
 * defensive: a malformed object, an `{"error": ...}` insufficient-source signal,
 * or any missing/empty required string field returns null (→ abstain). Never
 * fabricates fields.
 */
function parseDiagramPayload(answer: string): ParsedDiagram | null {
  const parsed = tolerantJsonParse(answer);
  if (!parsed || typeof parsed !== 'object') return null;
  const r = parsed as Record<string, unknown>;

  // The prompt returns {"error":"insufficient_source"} when it cannot ground a
  // diagram — treat as a parse-empty abstain.
  if (typeof r.error === 'string') return null;

  const mermaidCode = asNonEmptyString(r.mermaidCode);
  const titleEn = asNonEmptyString(r.titleEn);
  const titleHi = asNonEmptyString(r.titleHi);
  const captionEn = asNonEmptyString(r.captionEn);
  const captionHi = asNonEmptyString(r.captionHi);
  // Bilingual (P7): every human-readable field + the code must be populated.
  if (!mermaidCode || !titleEn || !titleHi || !captionEn || !captionHi) return null;

  return {
    mermaidCode,
    titleEn,
    titleHi,
    captionEn,
    captionHi,
    supportingCitationIndexes: r.supportingCitationIndexes,
  };
}

/**
 * Map the model's `supportingCitationIndexes` ([n] values) onto the actual
 * retrieved `Citation` objects. Falls back to the FULL retrieved set when the
 * model gave no valid index — the diagram comes from a SINGLE retrieval, so any
 * retrieved chunk is a legitimate grounding. Returns [] only when the grounded
 * call itself returned zero citations.
 */
function resolveCitations(rawIndexes: unknown, citations: Citation[]): Citation[] {
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

// ─── Safety gates ─────────────────────────────────────────────────────────────

/**
 * Gate 1 helper — map the first header token of the mermaid code onto a v1 kind.
 * Returns null when the header is outside the v1 set (spec §2.1 / §3.6). Assumes
 * `validateMermaidCode` already passed (non-empty, allowlisted header).
 */
function resolveV1Kind(mermaidCode: string): DiagramKind | null {
  const firstToken = (mermaidCode.trim().match(/^\S+/) ?? [''])[0];
  return V1_HEADER_TO_KIND[firstToken] ?? null;
}

/**
 * Gate 2 helper — screen every student-facing field AND the whole mermaidCode
 * string (its node labels are user-facing text). `safe:false` if ANY field is
 * unsafe. Categories are de-duped across fields (telemetry only — no text).
 */
function screenAllFields(
  parsed: ParsedDiagram,
  request: DiagramRequest,
  screen: GenerateDiagramDeps['screen'],
): OutputScreenResult {
  const fields = [
    parsed.titleEn,
    parsed.titleHi,
    parsed.captionEn,
    parsed.captionHi,
    parsed.mermaidCode,
  ];
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

/** Bilingual (P7) safe abstain copy. Reused for every whole-diagram abstain. */
const ABSTAIN_MESSAGE_EN =
  "A diagram for this chapter isn't ready yet. Try one of the suggested chapters below, or check back soon.";
const ABSTAIN_MESSAGE_HI =
  'इस chapter के लिए diagram अभी तैयार नहीं है। नीचे सुझाए गए किसी chapter को आज़माएँ, या थोड़ी देर बाद दोबारा देखें।';

function buildAbstain(
  reason: AbstainReason,
  suggestedAlternatives: SuggestedAlternative[],
  diagramKind: DiagramKind,
  meta: DiagramMeta,
): DiagramSpec {
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
    mermaidCode: '',
    diagramKind,
    titleEn: '',
    titleHi: '',
    captionEn: '',
    captionHi: '',
    citations: [],
    meta,
  };
}

/** PII-free structured log. Never throws — logging must not break generation. */
function logDiagram(event: string, data: Record<string, unknown>): void {
  try {
    logger.info(event, data);
  } catch {
    /* swallow — telemetry must never affect the student-facing path */
  }
}
