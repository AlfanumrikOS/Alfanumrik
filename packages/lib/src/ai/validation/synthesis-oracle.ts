// packages/lib/src/ai/validation/synthesis-oracle.ts
//
// Item 4.2 (2026-07-21) — Monthly Synthesis parent-summary fabrication oracle.
//
// Mirrors the SPIRIT of the AI quiz-generator validation oracle
// (`packages/lib/src/ai/validation/quiz-oracle.ts`, REG-54): cheap,
// deterministic, pure-TS checks run BEFORE anything reaches persistence or a
// parent's WhatsApp. No LLM call is needed for this oracle (unlike
// quiz-oracle's optional LLM-grader pass) — fabrication here means "a number
// or a chapter/topic name appears in the generated text that has no basis in
// the SynthesisBundle it was generated from", which is checkable
// deterministically against the bundle's own JSON.
//
// This module owns FOUR responsibilities (item 4.2):
//   1. Fabrication check — numbers (language-agnostic, EN + HI/Devanagari)
//      and chapter/topic name mentions, cross-checked against the bundle.
//   2. Word-cap enforcement — hard sentence-boundary-aware truncation, not
//      just trusting the prompt's "~300 words" instruction.
//   3. Template-only fallback — a deterministic, bundle-only bilingual
//      summary used whenever the oracle rejects or the Claude call fails.
//   4. Circuit breaker — same pattern as
//      `supabase/functions/parent-report-generator/index.ts` (module-scoped
//      failure counter, OPEN after N failures, HALF-OPEN probe after a
//      reset window) so repeated Claude failures degrade to the template
//      fallback instead of hammering a failing API.
//
// P11 (no fabrication) / P13 (no PII in logs): rejection reasons returned by
// this module are COUNTS AND CATEGORIES ONLY — never the raw mentioned
// numbers/phrases verbatim in a form the caller would log unredacted, and
// never the student's name. Callers (e.g. `/api/synthesis/state`) must log
// only `rejectionCategory` + counts, never `unbackedNumbers`/`unbackedPhrases`
// content, to stay P13-clean end to end.
//
// Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md §5.3
// Owner: ai-engineer. Reviewer: assessment (fabrication/quality bar correctness).

import type { SynthesisBundle } from '../../learn/monthly-synthesis-orchestrator';

// ─────────────────────────────────────────────────────────────────────────
// 1. Fabrication check — numbers
// ─────────────────────────────────────────────────────────────────────────

// Devanagari digits (०..९) map 1:1 to ASCII (0..9). CBSE Hindi-medium
// content mixes both numeral systems freely (mirrors quiz-oracle.ts's
// `normaliseDigits`) — without this, a Hindi summary stating "५ अध्याय"
// would never be recognised as the number 5.
function normaliseDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0966 + 0x30));
}

const NUMERIC_TOKEN_RE = /\d+(?:\.\d+)?/g;

/** Extract every numeric token in `text` (integers + decimals, EN + Devanagari digits). */
export function extractNumbers(text: string): number[] {
  if (!text) return [];
  const normalised = normaliseDigits(text);
  const matches = normalised.match(NUMERIC_TOKEN_RE);
  if (!matches) return [];
  const out: number[] = [];
  for (const m of matches) {
    const n = Number(m);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Extra, non-bundle facts that are legitimate direct context handed to Claude
 * alongside the bundle (see `buildSynthesisSummaryPrompt`'s
 * `Student: {name} (Grade {grade})` line) and therefore must be citable
 * without being flagged as fabrication, even though they do not live
 * anywhere inside `SynthesisBundle` itself. */
export interface AllowedNumberContext {
  /** P5: grade is a string '6'..'12'. Only the EXACT parsed value is
   * allowlisted — this is not a blanket allowance for small numbers. */
  studentGrade?: string;
}

/**
 * Recursively harvest every number that appears ANYWHERE in the bundle —
 * including inside string fields (e.g. a chapter title "Chapter 5: Motion"
 * legitimises the number 5). Walking the whole object (rather than hand-
 * listing numeric fields) makes the allowlist robust to the bundle shape
 * evolving without this oracle silently going stale.
 *
 * `weeklyArtifactIds` is DELIBERATELY EXCLUDED from this walk: in production
 * those are opaque Postgres UUID primary keys (see
 * `supabase/functions/monthly-synthesis-builder/index.ts`'s
 * `.map((r) => r.id)`), not human-authored text. Treating a hex substring
 * inside a UUID as a "backed" number (e.g. `550e8400-...` legitimising
 * "8400") would let a coincidentally-matching hallucinated number slip
 * through undetected — that's a real fabrication false negative, not a
 * feature. The prompt does cite the artifact COUNT ("{artifactCount} weekly
 * artifacts..."), so that count is added explicitly below instead of being
 * derived by walking the id strings.
 *
 * Also derives the rounded-percent form of any fractional value (e.g.
 * `targetDifficulty: 0.55` legitimises "55%", which is exactly how the
 * prompt builder itself renders it — see `buildSynthesisSummaryPrompt`'s
 * `mockLine`), the year/month components of `monthLabel` ('YYYY-MM'), and
 * (via `context.studentGrade`) the student's grade, which the prompt hands
 * Claude as direct context even though it is not part of the bundle.
 */
export function collectAllowedNumbers(
  bundle: SynthesisBundle,
  context?: AllowedNumberContext,
): Set<number> {
  const allowed = new Set<number>();

  const visit = (val: unknown): void => {
    if (val === null || val === undefined) return;
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) return;
      allowed.add(val);
      if (!Number.isInteger(val)) allowed.add(Math.round(val * 100));
      return;
    }
    if (typeof val === 'string') {
      for (const n of extractNumbers(val)) allowed.add(n);
      return;
    }
    if (Array.isArray(val)) {
      for (const v of val) visit(v);
      return;
    }
    if (typeof val === 'object') {
      for (const v of Object.values(val as Record<string, unknown>)) visit(v);
    }
  };

  // Walk everything EXCEPT weeklyArtifactIds (see comment above) — destructure
  // it out so a stray future field addition can't accidentally re-include it.
  const { weeklyArtifactIds, ...bundleWithoutArtifactIds } = bundle ?? ({} as SynthesisBundle);
  visit(bundleWithoutArtifactIds);
  allowed.add(Array.isArray(weeklyArtifactIds) ? weeklyArtifactIds.length : 0);

  const monthMatch = /^(\d{4})-(\d{2})$/.exec(bundle?.monthLabel ?? '');
  if (monthMatch) {
    allowed.add(Number(monthMatch[1]));
    allowed.add(Number(monthMatch[2]));
  }

  if (context?.studentGrade) {
    const grade = Number(context.studentGrade);
    if (Number.isFinite(grade)) allowed.add(grade);
  }

  return allowed;
}

export interface NumberFabricationResult {
  ok: boolean;
  /** P13-safe: category/count description only, never raw quoted text. */
  reason?: string;
  /** Distinct unbacked numbers found (capped at 10). Callers must NOT log this array verbatim if it could ever carry PII-adjacent content — for numbers this is safe, but keep it out of student-facing/log surfaces regardless per the module-level P13 note above. */
  unbackedNumbers?: number[];
}

/**
 * Check whether `text` mentions any number with no basis anywhere in the
 * bundle. Conservative by design (see `collectAllowedNumbers`) — a legitimate
 * bundle-derived number in any form (raw, string-embedded, rounded-percent,
 * or a month/year component) is always allowed. Anything else — including
 * generic-sounding "practice 10-15 minutes daily" advice numbers a model
 * might invent — is flagged, because an unbacked number in a report that
 * reads as personalised-and-factual is exactly the fabrication risk P11
 * exists to catch.
 */
export function checkNumberFabrication(
  text: string,
  bundle: SynthesisBundle,
  context?: AllowedNumberContext,
): NumberFabricationResult {
  if (!text || !text.trim()) return { ok: true };
  const mentioned = extractNumbers(text);
  if (mentioned.length === 0) return { ok: true };

  const allowed = collectAllowedNumbers(bundle, context);
  const unbacked = Array.from(new Set(mentioned.filter((n) => !allowed.has(n))));
  if (unbacked.length === 0) return { ok: true };

  return {
    ok: false,
    reason: `summary mentions ${unbacked.length} number(s) with no basis in the synthesis bundle`,
    unbackedNumbers: unbacked.slice(0, 10),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 1b. Fabrication check — chapter/topic names
// ─────────────────────────────────────────────────────────────────────────
//
// SCOPE DECISION (documented, not a TBD): full proper-noun / named-entity
// extraction over free English prose is false-positive-prone (CBSE, NCERT,
// WhatsApp, Alfanumrik, Foxy, India, subject names, etc. are all legitimate
// capitalised terms that never appear in the bundle). Rather than maintain a
// brittle, ever-growing stopword allowlist, this check targets the SPECIFIC,
// high-precision pattern that actually indicates a named-reference
// fabrication risk: text that explicitly cites "chapter/topic <name>" or
// quotes a phrase, which is how a hallucinated chapter name would concretely
// show up in a parent-facing summary. This is a heuristic defense-in-depth
// layer, not exhaustive NLP — it is backed up by (a) the prompt's own
// CRITICAL — DO NOT FABRICATE instruction, (b) item 4.5's independent
// pre-send gate, and (c) the deterministic template fallback whenever this
// check (or the number check) rejects.
//
// Devanagari/Hindi text has no capitalisation signal, so this check runs on
// the English text only — the numeric-fabrication check above is the
// language-agnostic layer that also covers the Hindi text.

// Requires a Title-Case word (or run of Title-Case words) immediately after
// "chapter"/"topic" — a genuine named reference ("chapter Motion", "topic
// Photosynthesis and Respiration"). This deliberately does NOT match generic
// prose use of the word ("3 topics and improved on 5 more, ..." — the word
// right after "topics" is lowercase "and", so nothing matches). Requiring
// capitalisation is what keeps this a high-precision, low-false-positive
// check instead of firing on every ordinary sentence containing the word
// "topic"/"chapter".
const TOPIC_MENTION_RE =
  /\b(?:[Cc]hapter|[Tt]opic)s?\b[\s:]+["'“”]?([A-Z][A-Za-z0-9&\-']*(?:\s+[A-Z][A-Za-z0-9&\-']*){0,4})/g;
const QUOTED_PHRASE_RE = /["“']([A-Za-z][A-Za-z0-9 ,&\-']{2,60})["”']/g;

/** Extract candidate chapter/topic name mentions from English summary text. */
export function extractCandidateTopicPhrases(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const re of [new RegExp(TOPIC_MENTION_RE), new RegExp(QUOTED_PHRASE_RE)]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const phrase = m[1]?.trim();
      if (phrase) out.add(phrase);
    }
  }
  return Array.from(out);
}

function tokenizeSimple(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

// Connector/filler words excluded from the overlap comparison ONLY (never
// from extraction). Without this, a fabricated phrase like "Thermodynamics
// and Nuclear Physics" would false-positive as "backed" merely because it
// shares the word "and" with a legitimate bundle chapter title like "Force
// and Laws of Motion" — the shared token carries zero topical signal.
const OVERLAP_STOPWORDS = new Set([
  'and', 'or', 'of', 'the', 'a', 'an', 'in', 'on', 'for', 'with', 'to', 'this',
  'that', 'this month', 'month', 'months', 'chapter', 'chapters', 'topic', 'topics',
]);

function tokenizeForOverlap(s: string): Set<string> {
  const tokens = tokenizeSimple(s);
  for (const stop of OVERLAP_STOPWORDS) tokens.delete(stop);
  return tokens;
}

export interface TopicFabricationResult {
  ok: boolean;
  reason?: string;
  unbackedPhrases?: string[];
}

/**
 * Check whether the English summary text names a chapter/topic (or quotes a
 * phrase) with no word-level overlap against anything actually in the
 * bundle (chapters touched this month + chapter-mock chapters + the
 * student's own name, which is a legitimate non-fabricated mention).
 *
 * Deliberately LOW-PRECISION-TOLERANT in the other direction: ANY shared
 * token between a candidate phrase and a corpus entry counts as "backed" —
 * we would rather miss a subtle fabrication than reject good, specific,
 * personalised content on a false positive (rejection means losing
 * personalisation entirely, since the fallback is a generic template).
 */
export function checkTopicFabrication(
  text: string,
  bundle: SynthesisBundle,
  studentName?: string,
): TopicFabricationResult {
  const candidates = extractCandidateTopicPhrases(text);
  if (candidates.length === 0) return { ok: true };

  // Defensive: bundle is persisted JSONB and may be a partial/legacy shape
  // (or a test fixture) that predates a field — never let a malformed bundle
  // crash the oracle. Optional-chain every nested access.
  const corpus = [
    ...(bundle?.masteryDelta?.chaptersTouched ?? []),
    ...(bundle?.chapterMockSummary?.chapters ?? []),
    ...(studentName ? [studentName] : []),
  ];

  if (corpus.length === 0) {
    // No chapters/topics exist in the bundle at all (a light month) — any
    // specific chapter/topic citation is unbacked by construction.
    return {
      ok: false,
      reason: `summary references ${candidates.length} chapter/topic name(s) but the bundle has no chapters touched this month`,
      unbackedPhrases: candidates.slice(0, 10),
    };
  }

  const corpusTokenSets = corpus.map(tokenizeForOverlap);
  const unbacked = candidates.filter((c) => {
    const cTokens = tokenizeForOverlap(c);
    // If the candidate is ALL stopwords/filler once stripped, there is no
    // substantive claim left to check — do not flag it.
    if (cTokens.size === 0) return false;
    return !corpusTokenSets.some((ct) => {
      for (const t of cTokens) if (ct.has(t)) return true;
      return false;
    });
  });

  if (unbacked.length === 0) return { ok: true };
  return {
    ok: false,
    reason: `summary mentions ${unbacked.length} chapter/topic name(s) with no basis in the synthesis bundle`,
    unbackedPhrases: unbacked.slice(0, 10),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Word-cap enforcement
// ─────────────────────────────────────────────────────────────────────────

/** Prompt-instructed soft cap (`buildSynthesisSummaryPrompt`: "Aim for ~300 words total"). */
export const SYNTHESIS_WORD_CAP = 300;
/** Tolerance before we hard-truncate — the prompt says "~300", so a small overshoot is expected model behavior, not a violation. */
export const SYNTHESIS_WORD_CAP_TOLERANCE_RATIO = 0.2;
/** capWords * (1 + tolerance) — 360 words. Anything at or under this passes through untouched. */
export const SYNTHESIS_WORD_CAP_HARD_CEILING = Math.round(
  SYNTHESIS_WORD_CAP * (1 + SYNTHESIS_WORD_CAP_TOLERANCE_RATIO),
);

export function countWords(text: string): number {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// Sentence-ending punctuation: English '.', '!', '?' plus the Hindi purna
// viram '।' (U+0964) and double danda '॥' (U+0965).
const SENTENCE_END_RE = /[.!?।॥]/;

/**
 * DECISION (truncate, not reject — see item 4.2 point 2): a hard word-cap
 * overshoot is a FORMAT problem, not a content-safety problem — cutting
 * length cannot introduce a fabrication, and truncating a genuinely
 * personalised summary preserves far more value for the parent than
 * discarding it entirely for the generic template. We truncate to the LAST
 * full sentence at or before the cap so the cut always lands cleanly (never
 * mid-sentence). If no sentence boundary exists early enough to leave a
 * useful excerpt (< 40% of the cap), we hard-cut at the cap itself rather
 * than keep searching — better a plain word-cut than an unbounded blob.
 */
export function enforceWordCap(
  text: string,
  capWords: number = SYNTHESIS_WORD_CAP,
  toleranceRatio: number = SYNTHESIS_WORD_CAP_TOLERANCE_RATIO,
): { text: string; wasTruncated: boolean } {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { text: trimmed, wasTruncated: false };

  const words = trimmed.split(/\s+/);
  const hardCeiling = Math.round(capWords * (1 + toleranceRatio));
  if (words.length <= hardCeiling) return { text: trimmed, wasTruncated: false };

  const windowText = words.slice(0, capWords).join(' ');
  const minAcceptableIdx = Math.floor(windowText.length * 0.4);
  let lastEnd = -1;
  for (let i = windowText.length - 1; i >= 0; i--) {
    if (SENTENCE_END_RE.test(windowText[i])) {
      lastEnd = i;
      break;
    }
  }

  if (lastEnd >= minAcceptableIdx) {
    return { text: windowText.slice(0, lastEnd + 1).trim(), wasTruncated: true };
  }
  return { text: windowText.trim(), wasTruncated: true };
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Combined oracle entry point
// ─────────────────────────────────────────────────────────────────────────

export type SynthesisOracleRejectionCategory = 'fabricated_number' | 'fabricated_topic';

export interface SynthesisOracleInput {
  textEn: string;
  textHi: string;
  bundle: SynthesisBundle;
  studentName?: string;
  /** P5: string '6'..'12'. Threaded into the number-fabrication allowlist
   * because `buildSynthesisSummaryPrompt` hands Claude the grade as direct
   * context ("Student: {name} (Grade {grade})") even though it is not part
   * of `SynthesisBundle` — see `collectAllowedNumbers`. */
  studentGrade?: string;
}

export interface SynthesisOracleResult {
  ok: boolean;
  /** Present (post word-cap enforcement) only when ok === true. */
  textEn: string;
  textHi: string;
  wasTruncatedEn: boolean;
  wasTruncatedHi: boolean;
  rejectionCategory?: SynthesisOracleRejectionCategory;
  /** P13-safe: category/count description only. */
  rejectionReason?: string;
}

/**
 * DECISION (reject, not regenerate — see item 4.2 point 1): unlike
 * quiz-generator's async, background content-authoring oracle (which can
 * afford a same-flow retry because nobody is waiting synchronously on it),
 * this oracle runs inline inside a user-facing GET request
 * (`/api/synthesis/state`'s lazy-fill) that ALREADY has a 20s Claude
 * timeout budget. Attempting an in-request regeneration would double the
 * worst-case latency for a first-time viewer and risks the serverless
 * function's own duration limit for what is, at best, a coin-flip on
 * whether a second Claude call avoids the same failure mode. Rejecting
 * straight to the deterministic template is faster, safer, and always
 * bundle-accurate — the parent/student still gets a correct, if less
 * personalised, summary immediately. (Nothing prevents a FUTURE background
 * job from re-attempting generation for a fallback-served row — this
 * decision only governs the synchronous request path.)
 *
 * Runs fabrication checks BEFORE word-cap truncation (truncation must never
 * hide or introduce a fabrication signal — we validate the full generated
 * text, then trim). If either language fails a fabrication check, the WHOLE
 * result is rejected (both languages fall back together) so the parent
 * never sees a personalised EN paired with a generic HI, or vice versa.
 */
export function validateSynthesisSummary(input: SynthesisOracleInput): SynthesisOracleResult {
  const { textEn, textHi, bundle, studentName, studentGrade } = input;
  const numberContext: AllowedNumberContext = { studentGrade };

  const numEn = checkNumberFabrication(textEn, bundle, numberContext);
  if (!numEn.ok) {
    return rejectResult('fabricated_number', numEn.reason!);
  }
  const numHi = checkNumberFabrication(textHi, bundle, numberContext);
  if (!numHi.ok) {
    return rejectResult('fabricated_number', numHi.reason!);
  }

  const topicEn = checkTopicFabrication(textEn, bundle, studentName);
  if (!topicEn.ok) {
    return rejectResult('fabricated_topic', topicEn.reason!);
  }
  // Hindi topic-name check intentionally skipped — see the scope-decision
  // comment above `checkTopicFabrication` (no capitalisation signal in
  // Devanagari; the numeric check above already covers Hindi).

  const capEn = enforceWordCap(textEn);
  const capHi = enforceWordCap(textHi);

  return {
    ok: true,
    textEn: capEn.text,
    textHi: capHi.text,
    wasTruncatedEn: capEn.wasTruncated,
    wasTruncatedHi: capHi.wasTruncated,
  };
}

function rejectResult(
  category: SynthesisOracleRejectionCategory,
  reason: string,
): SynthesisOracleResult {
  return {
    ok: false,
    textEn: '',
    textHi: '',
    wasTruncatedEn: false,
    wasTruncatedHi: false,
    rejectionCategory: category,
    rejectionReason: reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Template-only fallback (never leave the student/parent with nothing)
// ─────────────────────────────────────────────────────────────────────────
//
// parent-report-generator's `buildFallbackReport` is shaped for the WEEKLY
// cadence (WeeklyStats: quizzes_completed / avg_score / streak / xp) and
// returns a structured { highlights, concerns, suggestion } object — not a
// bilingual prose paragraph. The monthly SynthesisBundle carries entirely
// different fields (masteryDelta / weeklyArtifactIds / chapterMockSummary),
// so reusing that function's SHAPE isn't possible; this builds a new,
// equally deterministic bilingual bundle-only template, in the same
// spirit (warm, honest, specific, never silent about a zero/empty field).

export interface SynthesisFallbackParams {
  studentName: string;
  bundle: SynthesisBundle;
}

export function buildSynthesisFallbackSummary(
  params: SynthesisFallbackParams,
): { textEn: string; textHi: string } {
  const { studentName, bundle } = params;
  // Defensive: bundle is persisted JSONB and may be a partial/legacy shape —
  // never let a malformed bundle crash the ONE path that must never fail.
  const md = bundle?.masteryDelta ?? {
    chaptersTouched: [] as string[],
    topicsMastered: 0,
    topicsImproved: 0,
    topicsRegressed: 0,
  };
  const artifactCount = bundle?.weeklyArtifactIds?.length ?? 0;
  const monthLabel = bundle?.monthLabel ?? 'this month';
  const chapterMockSummary = bundle?.chapterMockSummary ?? null;
  const name = studentName || 'Your child';

  const enLines: string[] = [];
  const hiLines: string[] = [];

  enLines.push(`${name}'s progress summary for ${monthLabel}.`);
  hiLines.push(`${monthLabel} के लिए ${name} की प्रगति रिपोर्ट।`);

  if (md.chaptersTouched.length > 0) {
    const shown = md.chaptersTouched.slice(0, 5);
    const more = md.chaptersTouched.length > 5 ? ', and more' : '';
    enLines.push(
      `This month, ${name} studied ${md.chaptersTouched.length} chapter${md.chaptersTouched.length === 1 ? '' : 's'}: ${shown.join(', ')}${more}.`,
    );
    hiLines.push(
      `इस महीने ${name} ने ${md.chaptersTouched.length} अध्याय पढ़े: ${shown.join(', ')}${md.chaptersTouched.length > 5 ? ' और अधिक' : ''}।`,
    );
  } else {
    enLines.push('This was a lighter month — no chapters are recorded as studied yet.');
    hiLines.push('यह महीना अपेक्षाकृत हल्का रहा — अभी तक कोई अध्याय दर्ज नहीं हुआ।');
  }

  enLines.push(`Topics newly mastered: ${md.topicsMastered}. Topics improved: ${md.topicsImproved}.`);
  hiLines.push(`नई महारत हासिल किए गए विषय: ${md.topicsMastered}। सुधार हुए विषय: ${md.topicsImproved}।`);

  if (artifactCount > 0) {
    enLines.push(
      `${name} completed ${artifactCount} weekly Curiosity Dive artifact${artifactCount === 1 ? '' : 's'} this month.`,
    );
    hiLines.push(`${name} ने इस महीने ${artifactCount} साप्ताहिक Curiosity Dive artifact पूरे किए।`);
  }

  if (chapterMockSummary) {
    enLines.push(
      `A ${chapterMockSummary.totalQuestions}-question chapter mock covering ${chapterMockSummary.chapters.join(', ')} is available for practice.`,
    );
    hiLines.push(
      `अभ्यास के लिए ${chapterMockSummary.chapters.join(', ')} पर आधारित ${chapterMockSummary.totalQuestions} प्रश्नों वाला chapter mock उपलब्ध है।`,
    );
  }

  enLines.push('Keep up the consistent effort!');
  hiLines.push('लगातार मेहनत जारी रखें!');

  return { textEn: enLines.join(' '), textHi: hiLines.join(' ') };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. Circuit breaker (same pattern as parent-report-generator/index.ts)
// ─────────────────────────────────────────────────────────────────────────

export const SYNTHESIS_CB_FAILURE_THRESHOLD = 5;
export const SYNTHESIS_CB_RESET_TIMEOUT_MS = 60_000;

export type SynthesisCircuitState = 'closed' | 'open' | 'half-open';

export interface SynthesisCircuitBreakerSnapshot {
  failures: number;
  lastFailureAt: number;
  state: SynthesisCircuitState;
}

export interface SynthesisCircuitBreaker {
  canRequest(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
  /** Observability/testing only. */
  getState(): SynthesisCircuitBreakerSnapshot;
}

/**
 * Factory (not a bare module-level object) so tests can construct an
 * isolated breaker instead of sharing/mutating global state across test
 * files. `synthesisClaudeCircuitBreaker` below is the actual singleton the
 * route imports — this mirrors parent-report-generator/index.ts's
 * `circuitBreaker` object exactly (FAILURE_THRESHOLD=5, RESET_TIMEOUT=60s,
 * closed → open after N failures → half-open single probe after the reset
 * window → closed on success / re-open on probe failure).
 */
export function createSynthesisCircuitBreaker(opts?: {
  failureThreshold?: number;
  resetTimeoutMs?: number;
}): SynthesisCircuitBreaker {
  const failureThreshold = opts?.failureThreshold ?? SYNTHESIS_CB_FAILURE_THRESHOLD;
  const resetTimeoutMs = opts?.resetTimeoutMs ?? SYNTHESIS_CB_RESET_TIMEOUT_MS;

  let failures = 0;
  let lastFailureAt = 0;
  let state: SynthesisCircuitState = 'closed';

  return {
    canRequest(): boolean {
      if (state === 'closed') return true;
      if (state === 'open') {
        if (Date.now() - lastFailureAt > resetTimeoutMs) {
          state = 'half-open';
          return true;
        }
        return false;
      }
      // half-open: exactly one probe is allowed through per open→half-open
      // transition; it already happened above. Further calls wait for
      // recordSuccess()/recordFailure() to resolve the probe.
      return false;
    },
    recordSuccess(): void {
      failures = 0;
      state = 'closed';
    },
    recordFailure(): void {
      failures++;
      lastFailureAt = Date.now();
      if (failures >= failureThreshold) state = 'open';
    },
    getState(): SynthesisCircuitBreakerSnapshot {
      return { failures, lastFailureAt, state };
    },
  };
}

/**
 * Module-level singleton used by `/api/synthesis/state`. On Vercel
 * serverless this persists across warm invocations of the same instance —
 * best-effort, not distributed/shared across instances, exactly like every
 * other in-memory circuit-breaker/rate-limiter already in this codebase
 * (parent-report-generator's `circuitBreaker` + `reportRateMap`, the
 * various in-memory maps in quiz-generator, etc.).
 */
export const synthesisClaudeCircuitBreaker: SynthesisCircuitBreaker = createSynthesisCircuitBreaker();
