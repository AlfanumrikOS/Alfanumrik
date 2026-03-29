/**
 * ALFANUMRIK — NCERT Solver Engine
 *
 * Pipeline:
 *   Question → Parser → Concept Retrieval → Solver Router → Solution → Verifier → Output
 *
 * This is NOT a single-prompt answer generator.
 * Each step is independent, verifiable, and grounded in NCERT curriculum.
 */

// ─── Question Parser ─────────────────────────────────────

export type QuestionType = 'mcq' | 'short_answer' | 'long_answer' | 'numerical' | 'word_problem' | 'case_based' | 'grammar' | 'literature' | 'assertion_reasoning';
export type SubjectCategory = 'math' | 'physics' | 'chemistry' | 'biology' | 'science' | 'english' | 'hindi' | 'social_studies' | 'computer_science' | 'economics' | 'accountancy';

export interface ParsedQuestion {
  originalText: string;
  type: QuestionType;
  subject: SubjectCategory;
  grade: string;
  chapter: string | null;
  concepts: string[];
  marks: number;
  expectedDepth: 'brief' | 'moderate' | 'detailed';
  hasNumerical: boolean;
  hasFormula: boolean;
  hasOptions: boolean;
  options: string[];
  language: 'en' | 'hi' | 'hinglish';
}

/**
 * Parse a raw question into structured components.
 * Uses pattern matching + keyword extraction — no LLM needed.
 */
export function parseQuestion(
  text: string,
  subject: string,
  grade: string,
  options?: string[],
  marks?: number,
): ParsedQuestion {
  const lower = text.toLowerCase();

  // Detect question type
  const type = detectQuestionType(lower, options, marks);

  // Detect if numerical
  const hasNumerical = /\d+\s*[\+\-\×\÷\*\/\=]|\bcalculate\b|\bfind the value\b|\bsolve\b|\bcompute\b|\bevaluate\b/i.test(text);
  const hasFormula = /[=><≥≤±√∑∫π]|\\frac|x\^|sinθ|cosθ|\bformula\b/i.test(text);

  // Detect expected depth from marks
  const effectiveMarks = marks || (type === 'mcq' ? 1 : type === 'short_answer' ? 2 : type === 'long_answer' ? 5 : 3);
  const expectedDepth = effectiveMarks <= 1 ? 'brief' : effectiveMarks <= 3 ? 'moderate' : 'detailed';

  // Extract concepts (keywords that match NCERT chapter topics)
  const concepts = extractConcepts(lower, subject);

  // Language detection
  const hindiPattern = /[\u0900-\u097F]/;
  const language = hindiPattern.test(text) ? 'hi' : 'en';

  return {
    originalText: text,
    type,
    subject: subject as SubjectCategory,
    grade,
    chapter: null, // populated by concept retrieval
    concepts,
    marks: effectiveMarks,
    expectedDepth,
    hasNumerical,
    hasFormula,
    hasOptions: !!options && options.length > 0,
    options: options || [],
    language,
  };
}

function detectQuestionType(text: string, options?: string[], marks?: number): QuestionType {
  if (options && options.length >= 3) return 'mcq';
  if (/assertion.*reason|reason.*assertion/i.test(text)) return 'assertion_reasoning';
  if (/case.?study|passage|read the.*passage|comprehension/i.test(text)) return 'case_based';
  if (/grammar|tense|voice|narration|clause|preposition|article/i.test(text)) return 'grammar';
  if (/poem|poet|stanza|character|story|novel|chapter.*summary/i.test(text)) return 'literature';
  if (/calculate|find.*value|solve|compute|evaluate|simplify|prove|show that/i.test(text)) return 'numerical';
  if (/word problem|train.*speed|pipe.*fill|age.*problem|profit.*loss/i.test(text)) return 'word_problem';
  if (marks && marks >= 5) return 'long_answer';
  if (marks && marks <= 2) return 'short_answer';
  return 'short_answer';
}

function extractConcepts(text: string, subject: string): string[] {
  const concepts: string[] = [];

  const CONCEPT_PATTERNS: Record<string, RegExp[]> = {
    math: [
      /linear equation/i, /quadratic/i, /polynomial/i, /trigonometry|sin|cos|tan/i,
      /algebra/i, /geometry/i, /mensuration/i, /statistics/i, /probability/i,
      /fraction/i, /decimal/i, /percentage/i, /ratio|proportion/i, /exponent|power/i,
      /bodmas|order of operations/i, /lcm|hcf|gcd/i, /area|perimeter|volume/i,
      /circle|triangle|rectangle|square/i, /parallel lines|angles/i,
      /coordinate geometry/i, /matrix|determinant/i, /differentiation|derivative/i,
      /integration|integral/i, /sequence|series|ap|gp/i, /sets|union|intersection/i,
      /complex number/i, /binomial/i, /permutation|combination/i, /limit|continuity/i,
    ],
    physics: [
      /force|newton/i, /motion|velocity|acceleration/i, /energy|work|power/i,
      /light|optics|reflection|refraction/i, /electricity|current|resistance|ohm/i,
      /magnetism|magnetic field/i, /wave|sound|frequency/i, /gravitation|gravity/i,
      /thermodynamics|heat|temperature/i, /nuclear|radioactive/i,
    ],
    chemistry: [
      /atom|molecule|element/i, /chemical.?(reaction|equation|bond)/i,
      /acid|base|salt|ph/i, /periodic table|group|period/i,
      /organic|carbon compound/i, /metal|non.?metal/i, /oxidation|reduction/i,
      /mole|avogadro/i, /solution|concentration|molarity/i,
    ],
    biology: [
      /cell|tissue|organ/i, /photosynthesis|respiration/i, /heredity|genetics|dna/i,
      /evolution|natural selection/i, /ecosystem|biodiversity/i,
      /reproduction|pollination/i, /nutrition|digestion/i, /nervous system|brain/i,
    ],
    science: [
      /force|motion/i, /light|sound/i, /acid|base/i, /cell|tissue/i,
      /electricity/i, /chemical/i, /nutrition/i, /reproduction/i,
    ],
  };

  const patterns = CONCEPT_PATTERNS[subject] || CONCEPT_PATTERNS.science || [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) concepts.push(match[0].toLowerCase());
  }

  return Array.from(new Set(concepts));
}

// ─── Solver Router ───────────────────────────────────────

export type SolverType = 'deterministic' | 'rule_based' | 'llm_reasoning' | 'hybrid' | 'retrieval';

export interface SolverRoute {
  solver: SolverType;
  reason: string;
  requiresRAG: boolean;
  requiresVerification: boolean;
  maxResponseTokens: number;
}

/**
 * Route a parsed question to the appropriate solver.
 * Deterministic solvers are preferred over LLM when possible.
 */
export function routeToSolver(parsed: ParsedQuestion): SolverRoute {
  const { type, subject, hasNumerical, hasFormula, expectedDepth } = parsed;

  // MCQ with options: use retrieval + elimination
  if (type === 'mcq') {
    return {
      solver: hasNumerical ? 'hybrid' : 'retrieval',
      reason: 'MCQ: retrieve concept, evaluate each option against NCERT rules',
      requiresRAG: true,
      requiresVerification: true,
      maxResponseTokens: 300,
    };
  }

  // Pure numerical/computation: deterministic solver
  if (type === 'numerical' && ['math', 'physics', 'chemistry', 'accountancy'].includes(subject)) {
    return {
      solver: 'deterministic',
      reason: 'Numerical computation: use step-by-step formula application',
      requiresRAG: true,
      requiresVerification: true,
      maxResponseTokens: 500,
    };
  }

  // Word problems: hybrid (parse → compute → explain)
  if (type === 'word_problem') {
    return {
      solver: 'hybrid',
      reason: 'Word problem: parse context, extract variables, compute, explain',
      requiresRAG: true,
      requiresVerification: true,
      maxResponseTokens: 600,
    };
  }

  // Grammar: rule-based
  if (type === 'grammar') {
    return {
      solver: 'rule_based',
      reason: 'Grammar: apply grammatical rules deterministically',
      requiresRAG: false,
      requiresVerification: true,
      maxResponseTokens: 300,
    };
  }

  // Literature: LLM reasoning with retrieval
  if (type === 'literature') {
    return {
      solver: 'llm_reasoning',
      reason: 'Literature: interpretive reasoning grounded in text',
      requiresRAG: true,
      requiresVerification: false,
      maxResponseTokens: expectedDepth === 'detailed' ? 800 : 400,
    };
  }

  // Case-based: hybrid (extract data + reason)
  if (type === 'case_based') {
    return {
      solver: 'hybrid',
      reason: 'Case-based: extract data from passage, then reason',
      requiresRAG: true,
      requiresVerification: true,
      maxResponseTokens: 600,
    };
  }

  // Long answer: LLM reasoning with structure
  if (type === 'long_answer') {
    return {
      solver: 'llm_reasoning',
      reason: 'Long answer: structured explanation with NCERT concepts',
      requiresRAG: true,
      requiresVerification: false,
      maxResponseTokens: expectedDepth === 'detailed' ? 1000 : 600,
    };
  }

  // Default: rule-based for short answers
  return {
    solver: 'rule_based',
    reason: 'Short answer: direct concept application',
    requiresRAG: true,
    requiresVerification: true,
    maxResponseTokens: 400,
  };
}

// ─── Verification Engine ─────────────────────────────────

export interface VerificationResult {
  passed: boolean;
  confidence: number; // 0-1
  checks: VerificationCheck[];
  issues: string[];
}

interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Verify a solver's answer before presenting to student.
 * Different verification strategies per subject and question type.
 */
export function buildVerificationPrompt(
  parsed: ParsedQuestion,
  proposedAnswer: string,
): string {
  const { type, subject, originalText, options } = parsed;

  const basePrompt = `You are a VERIFICATION ENGINE for CBSE/NCERT answers. Your job is to check if the proposed answer is correct.

QUESTION: ${originalText}
${options.length > 0 ? `OPTIONS: ${options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}` : ''}

PROPOSED ANSWER:
${proposedAnswer}

VERIFY by checking:`;

  if (['math', 'physics', 'chemistry', 'accountancy'].includes(subject) && parsed.hasNumerical) {
    return `${basePrompt}
1. RECOMPUTE: Redo every calculation step independently. Show your work.
2. SUBSTITUTE: Plug the final answer back into the original equation/condition.
3. UNITS: Check if units are correct and consistent.
4. REASONABLENESS: Is the magnitude reasonable for this problem?

Output ONLY valid JSON:
{"passed": boolean, "confidence": 0-1, "correct_answer": "...", "errors_found": ["..."], "recomputed_result": "..."}`;
  }

  if (subject === 'english' && type === 'grammar') {
    return `${basePrompt}
1. RULE: Identify the grammar rule being tested.
2. APPLY: Apply the rule to the given sentence/options.
3. FORMAT: Check answer format matches expected style.

Output ONLY valid JSON:
{"passed": boolean, "confidence": 0-1, "correct_answer": "...", "rule_applied": "...", "errors_found": ["..."]}`;
  }

  if (type === 'mcq') {
    return `${basePrompt}
1. EVALUATE each option against NCERT/CBSE curriculum.
2. ELIMINATE clearly wrong options with reasoning.
3. CONFIRM the selected option is correct.
4. Check for common student mistakes that might make a wrong option look right.

Output ONLY valid JSON:
{"passed": boolean, "confidence": 0-1, "correct_option": "A/B/C/D", "elimination_reasoning": {"A": "...", "B": "...", "C": "...", "D": "..."}, "errors_found": ["..."]}`;
  }

  // Default verification for conceptual answers
  return `${basePrompt}
1. KEY POINTS: Does the answer cover all required NCERT concepts?
2. ACCURACY: Are all facts, dates, definitions correct per NCERT?
3. COMPLETENESS: For ${parsed.marks} marks, is the depth appropriate?
4. COMMON ERRORS: Does it avoid common misconceptions?

Output ONLY valid JSON:
{"passed": boolean, "confidence": 0-1, "missing_points": ["..."], "errors_found": ["..."], "suggested_additions": ["..."]}`;
}

// ─── Solution Builder (LLM Prompt) ───────────────────────

/**
 * Build the solver prompt that generates the actual solution.
 * This is NOT the same as the Foxy chat prompt — it's structured
 * for answer generation, not conversation.
 */
export function buildSolverPrompt(
  parsed: ParsedQuestion,
  route: SolverRoute,
  ragContext: string | null,
  gradeStyle: string,
): string {
  const { type, subject, originalText, marks, options, expectedDepth } = parsed;

  const conceptGround = ragContext
    ? `\nNCERT REFERENCE (use this as your primary source):\n${ragContext}\n`
    : '';

  const marksGuide = marks <= 1
    ? 'Answer in 1-2 sentences only.'
    : marks <= 2
    ? 'Answer in 2-3 sentences with one key concept.'
    : marks <= 3
    ? 'Answer in 3-5 sentences covering the main concept with one example.'
    : 'Provide a detailed answer with definition, explanation, example, and conclusion.';

  const formatRules = type === 'mcq'
    ? `Select the correct option (A/B/C/D). First state the answer, then explain why.
Options: ${options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}`
    : type === 'numerical'
    ? `Show complete step-by-step working:
- Given values
- Formula to use
- Substitution
- Calculation steps
- Final answer with units`
    : type === 'word_problem'
    ? `Solve step by step:
- Identify what is given
- Identify what to find
- Set up the equation/relationship
- Solve
- State the answer in context`
    : '';

  return `You are an NCERT-grounded CBSE answer generator. Solve this question precisely.

QUESTION: ${originalText}
SUBJECT: ${subject} | GRADE: ${parsed.grade} | MARKS: ${marks}
TYPE: ${type}

${formatRules}
${conceptGround}

RULES:
- Follow NCERT textbook definitions and methods EXACTLY.
- ${marksGuide}
- ${gradeStyle}
- Never invent facts. If unsure, state the NCERT-standard answer.
- For math/science: show all calculation steps, never skip.
- For social science: include specific facts, dates, names from NCERT.
- For English: follow CBSE marking scheme format.

OUTPUT FORMAT (JSON):
{
  "answer": "The final answer",
  "steps": ["Step 1: ...", "Step 2: ...", ...],
  "concept": "The NCERT concept used",
  "explanation": "Student-friendly explanation",
  "common_mistake": "A common mistake to avoid",
  "formula_used": "If applicable"
}`;
}

// ─── Grade-Adaptive Explanation Style ─────────────────────

export function getGradeExplanationStyle(grade: string): string {
  const g = parseInt(grade) || 9;
  if (g <= 7) return 'Use very simple language. Give a real-life analogy. Keep it fun and encouraging.';
  if (g <= 9) return 'Use clear language with proper terms. Give one practical example.';
  return 'Use precise academic language. Focus on exam-relevant depth and board marking scheme.';
}

// ─── Confidence Scoring ──────────────────────────────────

export function estimateConfidence(
  route: SolverRoute,
  verificationPassed: boolean,
  ragContextAvailable: boolean,
): number {
  let confidence = 0.5;

  // Solver type affects base confidence
  if (route.solver === 'deterministic') confidence = 0.9;
  else if (route.solver === 'rule_based') confidence = 0.8;
  else if (route.solver === 'hybrid') confidence = 0.75;
  else if (route.solver === 'retrieval') confidence = 0.7;
  else confidence = 0.6; // llm_reasoning

  // RAG context boosts confidence
  if (ragContextAvailable) confidence += 0.1;

  // Verification result
  if (verificationPassed) confidence += 0.1;
  else confidence -= 0.2;

  return Math.max(0, Math.min(1, confidence));
}
