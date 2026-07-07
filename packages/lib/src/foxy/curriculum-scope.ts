/**
 * ALFANUMRIK — Foxy Math Pipeline: server-side CURRICULUM SCOPE validator.
 *
 * Runs BEFORE any solver/verifier LLM call inside the math pipeline. Decides
 * whether a detected math-solve query is in-scope for the student's enrolled
 * grade + the SELECTED chapter, using a LAYERED, DETERMINISTIC-FIRST cascade:
 *
 *   T1  Grade authenticity (CEO decision D2)
 *       The ENROLLED grade (SELECT grade FROM students WHERE id = studentId) is
 *       authoritative. A client-claimed `requestGrade` that disagrees is an
 *       anti-abuse signal -> grade_mismatch. All downstream checks use the
 *       server-fetched enrolled grade, NEVER the message content or the claim.
 *
 *   T2  Subject allowed (reuses validateSubjectWrite — grade/stream/plan gate).
 *
 *   T3  Chapter (CEO decision D3 = STRICT selected-chapter only)
 *       A chapter MUST be selected. The selected chapter must exist for
 *       (subject, enrolledGrade) AND be marked is_in_scope=true in cbse_syllabus.
 *
 *   T4  Domain/topic alignment to the SELECTED chapter
 *       (a) DETERMINISTIC out-of-grade math-domain lexicon — catches
 *           "integrate x^2", "laplace transform", "matrix determinant" with NO
 *           LLM when the domain's min grade exceeds the enrolled grade.
 *       (b) Constrained classify — only if T1-T3 + T4a all pass and the topic
 *           still cannot be confirmed deterministically: ask the model whether
 *           the problem belongs to one of THIS chapter's curriculum_topics.
 *           FAIL-CLOSED: any error/parse-fail/non-true -> out of scope.
 *
 * Product invariants:
 *   P5  grades are strings ("6".."12") — never coerced to int.
 *   P7  every out-of-scope reason carries bilingual EN + Hindi (Devanagari)
 *       message + suggested action.
 *   P12 AI safety / fail-closed — the only LLM step (T4b) defaults to
 *       out-of-scope on ANY uncertainty; deterministic layers run first.
 *   P13 no PII in any log line.
 *   P8  all DB reads go through the caller-supplied supabaseAdmin (server-only).
 *
 * Anti-abuse: scope decisions are anchored to the SERVER-fetched enrolled
 * grade. A student cannot widen their scope by claiming another grade in the
 * request body or by phrasing the problem as a higher-grade topic.
 *
 * Server-only. Owner: backend. Reviewer: assessment (curriculum-scope rules),
 * architect (RLS/data boundary).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@alfanumrik/lib/logger';
import { validateSubjectWrite } from '@alfanumrik/lib/subjects';
import { callReasoningModel } from '@alfanumrik/lib/ai/clients/reasoning-cascade';
import { parseFoxyChapterNumber } from '@alfanumrik/lib/foxy/chapter-parser';

export type CurriculumScopeReason =
  | 'grade_mismatch'
  | 'subject_not_allowed'
  | 'no_chapter'
  | 'chapter_not_in_scope'
  | 'out_of_grade_domain'
  | 'topic_not_in_chapter';

export interface CurriculumScopeInput {
  studentId: string;
  requestGrade: string;
  subject: string;
  chapter: string | null;
  problem: string;
}

export interface CurriculumScopeResult {
  inScope: boolean;
  enrolledGrade: string | null;
  reason?: CurriculumScopeReason;
  messageEn?: string;
  messageHi?: string;
  suggestedActionEn?: string;
  suggestedActionHi?: string;
}

// ─── Bilingual out-of-scope messages (P7) ────────────────────────────────────
//
// Keyed by reason. EN + Hindi (Devanagari). suggestedAction is the actionable
// next step the student can take. Technical terms (CBSE, NCERT) are not
// translated (P7 exception).
const SCOPE_MESSAGES: Record<
  CurriculumScopeReason,
  {
    messageEn: string;
    messageHi: string;
    suggestedActionEn: string;
    suggestedActionHi: string;
  }
> = {
  grade_mismatch: {
    messageEn:
      'This question is for a different class than the one you are enrolled in.',
    messageHi:
      'यह सवाल आपकी कक्षा से अलग कक्षा का है जिसमें आप नामांकित हैं।',
    suggestedActionEn:
      'Ask a question from your own class to continue.',
    suggestedActionHi:
      'जारी रखने के लिए अपनी ही कक्षा का सवाल पूछें।',
  },
  subject_not_allowed: {
    messageEn:
      'This subject is not available in your current class or plan.',
    messageHi:
      'यह विषय आपकी मौजूदा कक्षा या प्लान में उपलब्ध नहीं है।',
    suggestedActionEn:
      'Pick an available subject to continue.',
    suggestedActionHi:
      'जारी रखने के लिए उपलब्ध विषय चुनें।',
  },
  no_chapter: {
    messageEn:
      'Please select a chapter first so I can help you with the right topic.',
    messageHi:
      'कृपया पहले एक अध्याय चुनें ताकि मैं सही विषय में आपकी मदद कर सकूँ।',
    suggestedActionEn:
      'Select a chapter from your class, then ask again.',
    suggestedActionHi:
      'अपनी कक्षा का एक अध्याय चुनें, फिर दोबारा पूछें।',
  },
  chapter_not_in_scope: {
    messageEn:
      'This chapter is not part of your current CBSE syllabus.',
    messageHi:
      'यह अध्याय आपके मौजूदा CBSE पाठ्यक्रम का हिस्सा नहीं है।',
    suggestedActionEn:
      'Switch to a chapter from your class syllabus to continue.',
    suggestedActionHi:
      'जारी रखने के लिए अपनी कक्षा के पाठ्यक्रम का अध्याय चुनें।',
  },
  out_of_grade_domain: {
    messageEn:
      'This topic belongs to a higher class than the one you are in.',
    messageHi:
      'यह विषय आपकी कक्षा से ऊँची कक्षा का है।',
    suggestedActionEn:
      'Ask a question from your own class to continue.',
    suggestedActionHi:
      'जारी रखने के लिए अपनी ही कक्षा का सवाल पूछें।',
  },
  topic_not_in_chapter: {
    messageEn:
      'This question is outside the currently selected chapter.',
    messageHi:
      'यह सवाल अभी चुने हुए अध्याय के बाहर का है।',
    suggestedActionEn:
      'Switch to the relevant chapter or class to continue.',
    suggestedActionHi:
      'जारी रखने के लिए संबंधित अध्याय या कक्षा पर जाएँ।',
  },
};

/** Build an out-of-scope result with the bilingual copy for `reason`. */
function outOfScope(
  enrolledGrade: string | null,
  reason: CurriculumScopeReason,
): CurriculumScopeResult {
  const copy = SCOPE_MESSAGES[reason];
  return {
    inScope: false,
    enrolledGrade,
    reason,
    messageEn: copy.messageEn,
    messageHi: copy.messageHi,
    suggestedActionEn: copy.suggestedActionEn,
    suggestedActionHi: copy.suggestedActionHi,
  };
}

// ─── T4a: deterministic out-of-grade math-domain lexicon ─────────────────────
//
// Each entry maps a regex of higher-grade math-domain keywords to the MINIMUM
// CBSE grade (as a number, for comparison only) at which the domain is in
// scope. If the problem text matches a domain whose min grade exceeds the
// enrolled grade, the problem is out of grade with NO LLM call.
//
// Tuned per CBSE: calculus / matrices / determinants / complex numbers /
// Laplace / Fourier are Class 11-12 (or beyond CBSE entirely). Logarithms first
// appear in Class 9-10 depending on the board treatment; we gate at 9 so a
// Class 6-8 student asking "log base 2 of 8" is caught, while not blocking
// Class 9+ legitimately. The lexicon is intentionally conservative — a miss
// here falls through to T4b (the fail-closed classify), so a false-negative is
// safe; a false-positive (over-blocking) is the only risk we tune against.
const OUT_OF_GRADE_MATH_DOMAINS: Array<{ pattern: RegExp; minGrade: number }> = [
  // Calculus (Class 11-12)
  { pattern: /\b(integral|integrate|integration|antiderivative)\b/i, minGrade: 11 },
  { pattern: /\b(derivative|differentiate|differentiation|d\/dx)\b/i, minGrade: 11 },
  { pattern: /\bcalculus\b/i, minGrade: 11 },
  { pattern: /\blimit\s+as\b/i, minGrade: 11 },
  // Matrices & determinants (Class 12)
  { pattern: /\b(matrix|matrices|determinant|determinants)\b/i, minGrade: 11 },
  { pattern: /\beigen(value|vector)s?\b/i, minGrade: 11 },
  // Vectors / 3D geometry (Class 11-12)
  { pattern: /\bvector\s+(product|algebra)\b/i, minGrade: 11 },
  { pattern: /\b(dot\s+product|cross\s+product)\b/i, minGrade: 11 },
  // Complex numbers (Class 11)
  { pattern: /\bcomplex\s+number/i, minGrade: 11 },
  { pattern: /\biota\b/i, minGrade: 11 },
  // Transforms (beyond CBSE school — gate at 11+ to block school grades)
  { pattern: /\blaplace\s+transform/i, minGrade: 11 },
  { pattern: /\bfourier\s+(transform|series)/i, minGrade: 11 },
  // Trigonometry beyond ratios (Class 11 — inverse / identities-heavy)
  { pattern: /\binverse\s+trigonometr/i, minGrade: 11 },
  // Probability distributions / permutations-combinations (Class 11)
  { pattern: /\b(permutation|combination)s?\b/i, minGrade: 11 },
  { pattern: /\b(binomial|poisson|normal)\s+distribution/i, minGrade: 11 },
  // Logarithms first appear in CBSE NCERT Class 11 — gate blocks grades 6-10, allows 11-12.
  { pattern: /\b(logarithm|logarithms)\b/i, minGrade: 11 },
];

/**
 * Deterministic out-of-grade check. Returns the matched reason ('out_of_grade')
 * if the problem references a domain whose min grade exceeds enrolledGrade.
 * Pure (no I/O). enrolledGrade is parsed only for the numeric comparison; the
 * canonical grade stays a string (P5).
 */
function matchesOutOfGradeDomain(problem: string, enrolledGrade: string): boolean {
  const gradeNum = parseInt(enrolledGrade, 10);
  if (!Number.isFinite(gradeNum)) return false; // can't compare — let T4b decide
  for (const { pattern, minGrade } of OUT_OF_GRADE_MATH_DOMAINS) {
    if (pattern.test(problem) && minGrade > gradeNum) {
      return true;
    }
  }
  return false;
}

// ─── T4b: constrained classify (fail-closed) ─────────────────────────────────

const CLASSIFY_MAX_TOKENS = 64;
const CLASSIFY_TEMPERATURE = 0;
const CLASSIFY_TIMEOUT_MS = 8_000;
// Model selection is owned by the reasoning cascade (CEO decision D1:
// gpt-4o-mini -> gpt-4o -> Haiku), so no per-call model id is pinned here.

/**
 * Ask the model whether the problem belongs to one of THIS chapter's topics.
 * STRICT JSON, fail-closed: any API error / parse failure / non-true answer
 * resolves to `false` (out of scope). Never throws (P12).
 */
async function classifyTopicInChapter(
  problem: string,
  grade: string,
  subject: string,
  topicTitles: string[],
): Promise<boolean> {
  // No topics to anchor against -> we cannot confirm; fail closed.
  if (topicTitles.length === 0) return false;

  const topicList = topicTitles.map((t) => `- ${t}`).join('\n');
  const systemPrompt =
    'You are a strict CBSE curriculum-scope classifier. You decide ONLY whether a ' +
    "math problem belongs to one of a chapter's listed topics. Return ONLY a JSON " +
    'object {"inScope": true} or {"inScope": false}. No prose, no markdown, no commentary.';
  const userMessage = `Grade ${grade} ${subject} chapter topics:
${topicList}

Problem:
${problem}

Does this problem belong to ONE of the listed topics? Return ONLY {"inScope": true} or {"inScope": false}.`;

  let rawText = '';
  try {
    // CEO decision D1: all reasonings flow through the cascade
    // (gpt-4o-mini -> gpt-4o -> Haiku). Start at the cheapest tier; the cascade
    // advances on availability failures and surfaces a throw only if ALL tiers
    // are down — which the surrounding catch turns into fail-closed (P12).
    const response = await callReasoningModel(
      {
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: CLASSIFY_MAX_TOKENS,
        temperature: CLASSIFY_TEMPERATURE,
        timeoutMs: CLASSIFY_TIMEOUT_MS,
        jsonMode: true,
      },
      { startTier: 'base' },
    );
    rawText = response.content ?? '';
  } catch {
    // Cascade exhausted (all tiers down) / parse-fail upstream -> fail closed (P12).
    return false;
  }

  // Parse strictly: pull the first {...} object, require inScope === true.
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return false;
  try {
    const parsed = JSON.parse(match[0]) as { inScope?: unknown };
    return parsed.inScope === true;
  } catch {
    return false;
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Validation mode.
 *
 *   'full'        — the original, complete cascade: T1 (grade authenticity) +
 *                   T2 (subject) + T3 (chapter strict) + T4a (out-of-grade math
 *                   lexicon) + T4b (LLM classify against chapter topics). This is
 *                   the DEFAULT so EVERY existing caller is byte-identical. The
 *                   math-solve branch keeps using this.
 *
 *   'grade_only'  — the STEM-only HARD pre-gate (CEO Decision A): run ONLY the
 *                   layers that establish a TRULY out-of-grade topic —
 *                   T1 (enrolled-grade authenticity) + T2 (subject) +
 *                   T4a (deterministic out-of-grade math lexicon). SKIP T3
 *                   (chapter) and T4b (LLM classify) ENTIRELY — NO LLM call is
 *                   ever made, and an in-grade DIFFERENT-chapter query is NOT
 *                   blocked here (that stays a SOFT redirect downstream).
 *                   Reachable reasons: grade_mismatch, subject_not_allowed,
 *                   out_of_grade_domain.
 */
export type CurriculumScopeMode = 'grade_only' | 'full';

export async function validateCurriculumScope(
  input: CurriculumScopeInput,
  deps: { supabaseAdmin: SupabaseClient },
  mode: CurriculumScopeMode = 'full',
): Promise<CurriculumScopeResult> {
  const { supabaseAdmin } = deps;

  // ── T1: Grade authenticity (CEO decision D2) ──────────────────────────────
  // The ENROLLED grade is authoritative. Fetch it server-side; never trust the
  // client-claimed requestGrade for any downstream decision.
  let enrolledGrade: string | null = null;
  try {
    const { data: studentRow } = await supabaseAdmin
      .from('students')
      .select('grade')
      .eq('id', input.studentId)
      .maybeSingle();
    enrolledGrade =
      typeof studentRow?.grade === 'string' ? studentRow.grade : null;
  } catch {
    // DB read failure -> fail closed: we cannot establish the enrolled grade.
    enrolledGrade = null;
  }

  // No enrolled grade => cannot authenticate. Fail closed as grade_mismatch.
  if (!enrolledGrade) {
    logger.info('foxy.curriculum_scope.deny', { reason: 'grade_mismatch' });
    return outOfScope(null, 'grade_mismatch');
  }

  // Anti-abuse: a claimed grade that disagrees with the enrolled grade is a
  // hard deny (a student cannot claim another grade). String compare (P5).
  if (input.requestGrade !== enrolledGrade) {
    logger.info('foxy.curriculum_scope.deny', { reason: 'grade_mismatch' });
    return outOfScope(enrolledGrade, 'grade_mismatch');
  }

  // ── T2: Subject allowed (grade/stream/plan gate) ──────────────────────────
  let subjectOk = false;
  try {
    const subjectCheck = await validateSubjectWrite(input.studentId, input.subject, {
      supabase: supabaseAdmin,
    });
    subjectOk = subjectCheck.ok;
  } catch {
    subjectOk = false; // fail closed on any governance read error.
  }
  if (!subjectOk) {
    logger.info('foxy.curriculum_scope.deny', { reason: 'subject_not_allowed' });
    return outOfScope(enrolledGrade, 'subject_not_allowed');
  }

  // ── 'grade_only' mode: HARD out-of-grade pre-gate (CEO Decision A) ─────────
  // Run ONLY the out-of-grade math lexicon (T4a) here and STOP. SKIP T3 (chapter)
  // and T4b (LLM classify) entirely — NO LLM call, and an in-grade DIFFERENT-
  // chapter query is NOT blocked (it stays a SOFT redirect downstream). This
  // lets the route apply a truly-out-of-grade HARD block on CONCEPTUAL queries
  // (which never reach the math-solve branch) without the strict chapter gate.
  if (mode === 'grade_only') {
    if (matchesOutOfGradeDomain(input.problem, enrolledGrade)) {
      logger.info('foxy.curriculum_scope.deny', { reason: 'out_of_grade_domain' });
      return outOfScope(enrolledGrade, 'out_of_grade_domain');
    }
    // In-grade (no out-of-grade-domain match) — in scope for the pre-gate.
    return { inScope: true, enrolledGrade };
  }

  // ── T3: Chapter (CEO decision D3 = STRICT selected-chapter only) ──────────
  const chapter = (input.chapter ?? '').trim();
  if (!chapter) {
    logger.info('foxy.curriculum_scope.deny', { reason: 'no_chapter' });
    return outOfScope(enrolledGrade, 'no_chapter');
  }

  // Resolve the subject id + the chapter's chapter_number for (subject,
  // enrolledGrade). The chapter param may be a number ("3") or a title.
  let subjectId: string | null = null;
  try {
    const { data: subjectRow } = await supabaseAdmin
      .from('subjects')
      .select('id, code')
      .ilike('code', input.subject)
      .maybeSingle();
    subjectId = (subjectRow?.id as string | undefined) ?? null;
  } catch {
    subjectId = null;
  }

  const chapterNum = parseFoxyChapterNumber(chapter);

  // Resolve the chapter row for (subject, enrolledGrade) to get a chapter_number
  // we can check against cbse_syllabus.is_in_scope. Match by chapter_number when
  // numeric, else by title.
  let resolvedChapterNumber: number | null = chapterNum;
  if (subjectId) {
    try {
      let chQuery = supabaseAdmin
        .from('chapters')
        .select('chapter_number')
        .eq('subject_id', subjectId)
        .eq('grade', enrolledGrade);
      if (chapterNum !== null) {
        chQuery = chQuery.eq('chapter_number', chapterNum);
      } else {
        chQuery = chQuery.ilike('title', chapter);
      }
      const { data: chRow } = await chQuery.limit(1).maybeSingle();
      if (chRow && typeof chRow.chapter_number === 'number') {
        resolvedChapterNumber = chRow.chapter_number;
      } else if (chapterNum === null) {
        // Title given but no chapter row matched for this grade/subject.
        resolvedChapterNumber = null;
      }
    } catch {
      // Non-fatal — fall through to the cbse_syllabus check with chapterNum.
    }
  }

  // The chapter must exist for (grade, subject_code, chapter_number) AND be in
  // scope (cbse_syllabus.is_in_scope = true). Mirror of the grounded-answer
  // coverage precedent, reimplemented server-side with supabaseAdmin.
  let chapterInScope = false;
  if (resolvedChapterNumber !== null) {
    try {
      const { data: syllabusRow } = await supabaseAdmin
        .from('cbse_syllabus')
        .select('is_in_scope')
        .eq('grade', enrolledGrade)
        .eq('subject_code', input.subject)
        .eq('chapter_number', resolvedChapterNumber)
        .maybeSingle();
      chapterInScope = syllabusRow?.is_in_scope === true;
    } catch {
      chapterInScope = false; // fail closed.
    }
  }

  if (!chapterInScope) {
    logger.info('foxy.curriculum_scope.deny', { reason: 'chapter_not_in_scope' });
    return outOfScope(enrolledGrade, 'chapter_not_in_scope');
  }

  // ── T4a: deterministic out-of-grade math-domain lexicon (NO LLM) ──────────
  if (matchesOutOfGradeDomain(input.problem, enrolledGrade)) {
    logger.info('foxy.curriculum_scope.deny', { reason: 'out_of_grade_domain' });
    return outOfScope(enrolledGrade, 'out_of_grade_domain');
  }

  // ── T4b: constrained classify against THIS chapter's topics (fail-closed) ──
  // Load the ordered topic titles for (subject, enrolledGrade, chapter_number).
  let topicTitles: string[] = [];
  if (subjectId && resolvedChapterNumber !== null) {
    try {
      const { data: topicRows } = await supabaseAdmin
        .from('curriculum_topics')
        .select('title')
        .eq('subject_id', subjectId)
        .eq('grade', enrolledGrade)
        .eq('chapter_number', resolvedChapterNumber)
        .eq('is_active', true)
        .order('display_order', { ascending: true })
        .limit(50);
      topicTitles = ((topicRows ?? []) as Array<{ title: string | null }>)
        .map((r) => (typeof r.title === 'string' ? r.title.trim() : ''))
        .filter((t) => t.length > 0);
    } catch {
      topicTitles = [];
    }
  }

  const topicConfirmed = await classifyTopicInChapter(
    input.problem,
    enrolledGrade,
    input.subject,
    topicTitles,
  );

  if (!topicConfirmed) {
    logger.info('foxy.curriculum_scope.deny', { reason: 'topic_not_in_chapter' });
    return outOfScope(enrolledGrade, 'topic_not_in_chapter');
  }

  // All layers passed — in scope.
  return { inScope: true, enrolledGrade };
}
