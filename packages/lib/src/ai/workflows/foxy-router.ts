/**
 * Foxy Intent Router
 *
 * Classifies student messages into intents (keyword-first, LLM-fallback)
 * and routes them to the appropriate workflow.
 *
 * Owner: ai-engineer
 * Review: assessment (intent accuracy, curriculum scope), testing
 */

import type { FoxyIntent, IntentClassification, ChatMessage, WorkflowResult } from '../types';
import { getAIConfig } from '../config';
import { callClaude } from '../clients/claude';
import { callReasoningModel } from '../clients/reasoning-cascade';
import { callModel, GATEWAY_FLAG } from '../gateway';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { TraceLogger, logTrace } from '../tracing/trace-logger';
import { runExplainWorkflow } from './explain';
import { runDoubtWorkflow } from './doubt-solve';
import { runQuizGenerateWorkflow } from './quiz-generate';
import { runRevisionWorkflow } from './revision';

// ─── Keyword Patterns ──────────────────────────────────────────────────────

const GREETING_PATTERNS = /^(hi|hello|hey|namaste|howdy|good\s*(morning|afternoon|evening)|sup|yo)\b/i;

const OFF_TOPIC_PATTERNS = /\b(porn|sex|nude|naked|drug|alcohol|gambling|kill\s+yourself|suicide|self[- ]?harm|weapon|bomb|gun)\b/i;

// Broader quiz-intent patterns. Catches natural phrasings like:
//   "Provide me 5 questions from this chapter to practice"
//   "I want to solve some hard problems"
//   "Ask me a few MCQs"
//   "Generate 10 practice questions"
//   "Give some tricky questions to solve"
//   "Questions from this chapter"
// Designed to be permissive on the request verb + noun while still requiring
// at least one of: "questions", "problems", "MCQs", "quiz", "test".
// Exported because /api/foxy/route.ts also uses it to auto-swap the request
// mode to 'practice' when the student's message matches quiz intent — without
// that swap, the foxy_tutor_v1 template emits the STEP CARDS shape (intro
// paragraph then stops) for non-practice modes, leaving the student with no
// actual MCQs.
export const QUIZ_PATTERNS = /\b(?:quiz|mcqs?|mock\s+test|test\s+me\b|(?:give|provide|share|send|show|generate|create|make|prepare|set|ask)\s+(?:me\s+)?(?:some\s+|a\s+few\s+|a\s+|\d+\s+)?(?:practice\s+|tricky\s+|hard\s+|difficult\s+|easy\s+|sample\s+|board[- ]?level\s+)?(?:questions?|problems?|mcqs?|tests?|quizz?es?)|(?:i\s+(?:want|need|would\s+like|wanna))\s+(?:to\s+)?(?:solve\s+|attempt\s+|practice\s+)?(?:some\s+|a\s+few\s+|\d+\s+)?(?:practice\s+|tricky\s+|hard\s+|tough\s+|difficult\s+|easy\s+)?(?:questions?|problems?|mcqs?)|practice\s+(?:questions?|problems?|mcqs?)|(?:\d+\s+|some\s+|few\s+|a\s+few\s+)?(?:practice\s+|tricky\s+|hard\s+|difficult\s+|easy\s+|sample\s+)?(?:questions?|problems?|mcqs?)\s+(?:from|on|about|for|to\s+practice|to\s+solve|to\s+attempt|for\s+practice|for\s+exam|for\s+test))\b/i;

const REVISION_PATTERNS = /\b(revis(e|ion)|summary|summarize|summarise|recap|key\s+points|quick\s+review|notes)\b/i;

const DOUBT_PATTERNS = /\b(doubt|confused|don'?t\s+understand|explain\s+why|what\s+does|how\s+does|why\s+does|difference\s+between|what\s+is|what\s+are|clear\s+my\s+doubt)\b/i;

// ─── Mode-to-Intent Defaults ──────────────────────────────────────────────

const MODE_DEFAULT_INTENT: Record<string, FoxyIntent> = {
  learn: 'explain',
  explain: 'explain',
  practice: 'explain',
  revise: 'revision',
  doubt: 'doubt',
  homework: 'explain',
};

// ─── Intent Classification ─────────────────────────────────────────────────

/**
 * Classify a student message into a FoxyIntent.
 *
 * Strategy:
 * 1. Keyword-based fast classification (no LLM cost)
 * 2. If high confidence (>0.8), return immediately
 * 3. Otherwise, call Claude for nuanced classification
 * 4. On any error, fall back to mode-based default
 */
export async function classifyIntent(
  message: string,
  subject: string,
  grade: string,
  mode: string,
): Promise<IntentClassification> {
  const trimmed = message.trim();

  // 1. Keyword-based fast classification
  const keywordResult = classifyByKeyword(trimmed, mode);
  if (keywordResult.confidence > 0.8) {
    return keywordResult;
  }

  // 2. LLM-based classification
  try {
    return await classifyWithLLM(trimmed, subject, grade, mode);
  } catch {
    // 3. Fallback to mode-based default
    return {
      intent: MODE_DEFAULT_INTENT[mode] ?? 'explain',
      confidence: 0.3,
      reasoning: 'Fallback to mode default due to classification error',
    };
  }
}

function classifyByKeyword(message: string, mode: string): IntentClassification {
  if (OFF_TOPIC_PATTERNS.test(message)) {
    return { intent: 'off_topic', confidence: 0.95, reasoning: 'Off-topic keyword detected' };
  }
  if (GREETING_PATTERNS.test(message)) {
    return { intent: 'greeting', confidence: 0.9, reasoning: 'Greeting keyword detected' };
  }
  if (QUIZ_PATTERNS.test(message) && mode !== 'doubt') {
    return { intent: 'quiz', confidence: 0.85, reasoning: 'Quiz request keyword detected' };
  }
  if (REVISION_PATTERNS.test(message)) {
    return { intent: 'revision', confidence: 0.85, reasoning: 'Revision keyword detected' };
  }
  if (DOUBT_PATTERNS.test(message)) {
    return { intent: 'doubt', confidence: 0.75, reasoning: 'Doubt keyword detected' };
  }

  // Low-confidence fallback to mode default
  return {
    intent: MODE_DEFAULT_INTENT[mode] ?? 'explain',
    confidence: 0.4,
    reasoning: 'No strong keyword match, using mode default',
  };
}

async function classifyWithLLM(
  message: string,
  subject: string,
  grade: string,
  mode: string,
): Promise<IntentClassification> {
  const systemPrompt = `You are a student message classifier for a Grade ${grade} ${subject} tutoring app. Classify the student's message into exactly one intent.

Valid intents: explain, doubt, quiz, revision, homework, greeting, off_topic, unknown

Return ONLY valid JSON (no markdown):
{"intent":"...","confidence":0.X,"reasoning":"...","topic":"...","concept":"..."}

Rules:
- explain: student wants to learn or understand a concept
- doubt: student has a specific question or confusion ("what is X", "how does Y work")
- quiz: student wants practice questions, problems, MCQs, a test, or anything to attempt/solve
- revision: student wants a summary, recap, key points, or review
- homework: student wants help with homework (not a direct answer)
- greeting: casual greeting or smalltalk
- off_topic: not related to academics or inappropriate
- unknown: cannot determine

CRITICAL: any message asking for questions/problems/MCQs to practice or solve is QUIZ, even if the student uses verbs like "provide", "share", "send", "ask me", "I want", "I need", or specifies a count like "5 questions". Word order doesn't matter — "5 questions to practice" and "practice questions" are both QUIZ.

Examples:
- "Provide me 5 questions from this chapter to practice." → quiz
- "I want to solve some hard problems" → quiz
- "Ask me a few MCQs on Newton's laws" → quiz
- "Generate 10 questions for me" → quiz
- "Give some tricky questions to solve" → quiz
- "Questions from this chapter" → quiz
- "Test me on chapter 3" → quiz
- "Can you explain photosynthesis?" → explain
- "What is the difference between mitosis and meiosis?" → doubt
- "I don't understand why ice floats" → doubt
- "Summarize chapter 3 for me" → revision
- "Help me with my homework on fractions" → homework

Current mode: ${mode}`;

  // Model Gateway proof consumer (Phase 1): this LLM intent classifier is a
  // non-student-facing, non-grading path.
  //   - Flag OFF: byte-identical to before — direct callClaude with the legacy
  //     Haiku→Sonnet fallback only (no OpenAI tier).
  //   - Flag ON: routes through the gateway `default` policy, which resolves to
  //     the grounded-answer `auto` chain (Haiku→Sonnet→gpt-4o-mini→gpt-4o). So
  //     relative to THIS consumer's prior legacy path, the flag-ON path extends
  //     the fallback tail: on a double-Claude-tier outage the classifier now
  //     gains an OpenAI fallback (whereas before it would have thrown after
  //     Sonnet). Anthropic is still primary; ordering within Claude is unchanged.
  // Either way the throw-on-failure contract is preserved — classifyIntent()
  // catches and falls back to the mode default. Does NOT touch grounded Foxy
  // generation, quiz, XP, or P1–P6.
  const useGateway = await isFeatureEnabled(GATEWAY_FLAG);

  let content: string;
  if (useGateway) {
    const result = await callModel(
      {
        systemPrompt,
        messages: [{ role: 'user', content: message }],
        maxTokens: 128,
        temperature: 0.1,
      },
      { policy: 'default' },
    );
    if (!result.ok) {
      throw new Error(result.error ?? 'Model gateway classification failed');
    }
    content = result.content;
  } else {
    const response = await callClaude({
      systemPrompt,
      messages: [{ role: 'user', content: message }],
      maxTokens: 128,
      temperature: 0.1,
    });
    content = response.content;
  }

  // Parse response JSON
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON object in classification response');
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    intent?: string;
    confidence?: number;
    reasoning?: string;
    topic?: string;
    concept?: string;
  };

  const validIntents: FoxyIntent[] = [
    'explain', 'doubt', 'quiz', 'revision', 'homework', 'greeting', 'off_topic', 'unknown',
  ];
  const intent: FoxyIntent = validIntents.includes(parsed.intent as FoxyIntent)
    ? (parsed.intent as FoxyIntent)
    : 'unknown';

  return {
    intent,
    confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'LLM classification',
    extractedTopic: typeof parsed.topic === 'string' ? parsed.topic : undefined,
    extractedConcept: typeof parsed.concept === 'string' ? parsed.concept : undefined,
  };
}

// ─── Math-Solve Classifier (Part 1C — Foxy Math Pipeline) ───────────────────
//
// Detects whether a message is a MATH_SOLVE query: a STEM (math / physics /
// chemistry / ...) query with a CONCRETE instance to compute and a single
// determinable answer. This is the trigger for the 3-agent math pipeline
// (gated by ff_foxy_math_pipeline_v1 in the route — this function does NOT
// read the flag; the route gates the call).
//
// Binding contract (from assessment):
//   - "add 1/2 + 3/4"            -> math_solve  (concrete operands + operator)
//   - "explain how to add fractions" -> NOT      (conceptual, no concrete instance)
//   - "prove that ..." / under-specified / conceptual -> NOT
//   - low confidence             -> FAIL OPEN to the grounded path (isMathSolve: false)
//
// Strategy (cheap-first, identical philosophy to classifyByKeyword):
//   1. A hard NEGATIVE gate: conceptual / prove / how-to phrasings short-circuit
//      to NOT math_solve regardless of any numbers present.
//   2. A deterministic POSITIVE signal: a concrete arithmetic expression, an
//      equation to solve, or an imperative compute verb paired with a numeric
//      instance (reuses the SOLVE_RE-style seed).
//   3. Only when the deterministic signal is AMBIGUOUS (a compute verb present
//      but no clear concrete instance) do we fall back to a tiny Haiku classify.
//      Any error or low confidence there fails open to NOT math_solve.

// STEM subjects the math pipeline applies to. Non-STEM subjects always fail
// open (the grounded path owns English / SST / etc.). When subject is unknown
// or general we still allow detection by message shape.
const STEM_SUBJECT_RE = /\b(math|maths|mathematics|physics|chemistry|chem|science|accountancy|accounts|economics|statistics)\b/i;

// Hard negative: conceptual / how-to / proof phrasings are NOT math_solve even
// when numbers appear ("explain how to add 1/2 and 3/4 in general" is teaching,
// not a concrete solve). Checked FIRST so it dominates.
const MATH_CONCEPTUAL_RE = /\b(explain|what\s+is|what\s+are|why|how\s+(?:do|does|can|to)|define|definition\s+of|describe|prove\s+that|derive(?:\s+the)?\s+(?:formula|expression|relation)|in\s+general|concept\s+of|meaning\s+of)\b/i;

// Positive signal A — a concrete arithmetic expression: two numbers (incl.
// fractions / decimals) joined by an operator, e.g. "1/2 + 3/4", "12 * 4",
// "25 - 7", "3.5 / 2".
const ARITHMETIC_EXPR_RE = /(?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*[+\-*/×÷·]\s*(?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+)/;

// Positive signal B — an equation with an unknown to solve, e.g.
// "x^2 - 5x + 6 = 0", "2x + 3 = 7", "solve 3y = 9".
const EQUATION_RE = /[a-z]\s*(?:\^?\d+)?[^=]*=[^=]*\d/i;

// Positive signal C — an imperative compute verb (SOLVE_RE seed) AND at least
// one numeric token, e.g. "find the value of x when 2x = 8", "calculate the
// area of a circle of radius 7".
const COMPUTE_VERB_RE = /\b(calculate|compute|solve|simplify|evaluate|factorise|factorize|find\s+the\s+(?:value|sum|product|difference|area|volume|speed|distance|force|root|roots)|how\s+many)\b/i;
const HAS_NUMBER_RE = /\d/;

// Positive signal D — a fully-specified STEM word problem where the compute
// verb and the concrete number(s) appear in EITHER order, e.g.
//   "A train travels 240 km in 4 hours. Find the average speed."  (verb last)
//   "Calculate the area of a circle of radius 7"                   (verb first)
// COMPUTE_VERB_RE only catches the verb when it is glued to a specific noun
// ("find the speed") which misses "find the AVERAGE speed" and any verb that
// trails the numbers. This broader verb gate is a STANDALONE word (no required
// trailing noun) so word order does not matter. It is ONLY consulted when the
// subject is a KNOWN STEM-calc subject (not merely "not clearly non-STEM"), so
// unknown/general-subject prose with an incidental number cannot reach it.
const STEM_COMPUTE_VERB_RE =
  /\b(find|calculate|solve|evaluate|compute|determine|simplify|work\s+out)\b/i;

// A "real quantity" number — used to reject the over-trigger case where the
// ONLY number in the message is a 4-digit year ("find India's population in
// 2011") or a chapter/class/exercise reference ("solve chapter 3"). We require
// at least one number that is NOT one of those reference forms. Fractions,
// decimals, and bare integers (240, 7, 4) all qualify as real quantities.
const YEAR_RE = /\b(1[5-9]\d{2}|20\d{2})\b/g;
const CHAPTER_REF_RE = /\b(?:chapter|chap|ch|class|grade|exercise|ex|q(?:uestion)?|page|pg|unit|lesson)\.?\s*#?\s*\d+\b/gi;

export interface MathSolveClassification {
  isMathSolve: boolean;
  topic?: string;
  chapter?: string;
  difficulty?: string;
}

/**
 * True when `message` contains at least one number that is a real quantity —
 * i.e. NOT solely a 4-digit year or a chapter/class/exercise reference. Strips
 * the reference forms first, then checks whether any digit survives. This is
 * the guardrail that keeps "find India's population in 2011" and "solve chapter
 * 3" out of the deterministic STEM word-problem branch while letting "240 km",
 * "radius 7", and "1/2" through unchanged.
 */
function hasRealQuantity(message: string): boolean {
  const stripped = message.replace(CHAPTER_REF_RE, ' ').replace(YEAR_RE, ' ');
  return HAS_NUMBER_RE.test(stripped);
}

/**
 * Classify whether `message` is a concrete math-solve query.
 *
 * Pure-deterministic for the common cases; falls back to a tiny Haiku classify
 * ONLY when a compute verb is present but no concrete instance is detectable.
 * Fails open (isMathSolve: false) on any uncertainty or error — the grounded
 * path is always the safe default (P12).
 *
 * Does NOT mutate or call classifyIntent — fully independent and additive.
 */
export async function classifyMathSolve(
  message: string,
  subject: string,
  grade: string,
): Promise<MathSolveClassification> {
  const trimmed = (message ?? '').trim();
  if (!trimmed) return { isMathSolve: false };

  // Subject gate: a clearly non-STEM subject never enters the math pipeline.
  // Unknown / general / empty subject is allowed through to shape detection.
  const subjectKnownStem = STEM_SUBJECT_RE.test(subject ?? '');
  const subjectClearlyNonStem =
    !!(subject ?? '').trim() &&
    !subjectKnownStem &&
    /\b(english|hindi|sanskrit|social|sst|history|geography|civics|political|literature)\b/i.test(
      subject,
    );
  if (subjectClearlyNonStem) return { isMathSolve: false };

  // 1. Hard negative gate (conceptual / how-to / prove) dominates.
  //    EXCEPTION: a bare arithmetic expression like "add 1/2 + 3/4" can contain
  //    no conceptual keyword, so the negative gate only fires when there is NOT
  //    also a standalone concrete arithmetic expression / equation. This lets
  //    "find x: x^2 = 9" pass while "explain how to solve x^2 = 9" is blocked.
  const hasArithmetic = ARITHMETIC_EXPR_RE.test(trimmed);
  const hasEquation = EQUATION_RE.test(trimmed);
  const conceptual = MATH_CONCEPTUAL_RE.test(trimmed);
  if (conceptual && !hasArithmetic && !hasEquation) {
    return { isMathSolve: false };
  }

  // 2. Deterministic positive signal.
  if (hasArithmetic || hasEquation) {
    return {
      isMathSolve: true,
      difficulty: undefined,
    };
  }

  // 2b. Fully-specified STEM word problem (order-independent): a KNOWN STEM-calc
  //     subject + a compute/solve verb anywhere + a concrete real-quantity
  //     number anywhere. This catches the canonical CBSE word problem
  //     "A train travels 240 km in 4 hours. Find the average speed." (verb after
  //     the numbers) which the noun-glued COMPUTE_VERB_RE below misses. Gated on
  //     a KNOWN STEM subject (not just "not clearly non-STEM") and on a real
  //     quantity (not a bare year / chapter ref) so it never over-triggers on
  //     unknown-subject prose. Deterministic — no Claude call.
  if (
    subjectKnownStem &&
    STEM_COMPUTE_VERB_RE.test(trimmed) &&
    hasRealQuantity(trimmed)
  ) {
    return { isMathSolve: true };
  }

  const hasComputeVerb = COMPUTE_VERB_RE.test(trimmed);
  const hasNumber = HAS_NUMBER_RE.test(trimmed);
  if (hasComputeVerb && hasNumber) {
    // Compute verb + a concrete number = a concrete instance. math_solve.
    return { isMathSolve: true };
  }

  // 3. Ambiguous: a compute verb but NO concrete number, e.g. "find the value
  //    of x" with the equation in an earlier turn, or "solve this". Only here
  //    do we spend a tiny Haiku classify. Fail open on any error/low-confidence.
  if (hasComputeVerb) {
    try {
      return await classifyMathSolveWithLLM(trimmed, subject, grade);
    } catch {
      return { isMathSolve: false };
    }
  }

  // No signal at all -> grounded path.
  return { isMathSolve: false };
}

async function classifyMathSolveWithLLM(
  message: string,
  subject: string,
  grade: string,
): Promise<MathSolveClassification> {
  const systemPrompt = `You decide whether a Grade ${grade} ${subject} student's message is a MATH_SOLVE query.

MATH_SOLVE = a STEM (math/physics/chemistry/etc.) query with a CONCRETE instance to compute and a single determinable answer.
NOT MATH_SOLVE = conceptual ("explain how to add fractions"), under-specified, a request to prove something, or a definition/why/how-to question.

Examples:
- "add 1/2 + 3/4" -> math_solve
- "solve x^2 - 5x + 6 = 0" -> math_solve
- "explain how to add fractions" -> NOT
- "prove that root 2 is irrational" -> NOT
- "what is a quadratic equation" -> NOT

Return ONLY JSON (no markdown):
{"isMathSolve": true|false, "topic": "...", "difficulty": "easy"|"medium"|"hard"}
If unsure, return {"isMathSolve": false}.`;

  // Ambiguous-branch classify routes through the reasoning cascade at the base
  // tier (gpt-4o-mini), with cross-provider AVAILABILITY fallback toward Claude
  // Haiku. jsonMode requests a strict JSON object from the OpenAI tiers; the
  // prompt also instructs JSON so the Haiku last-resort tier behaves identically.
  const response = await callReasoningModel(
    {
      systemPrompt,
      messages: [{ role: 'user', content: message }],
      maxTokens: 96,
      temperature: 0.1,
      jsonMode: true,
    },
    { startTier: 'base' },
  );

  const jsonMatch = response.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { isMathSolve: false };

  let parsed: {
    isMathSolve?: unknown;
    topic?: unknown;
    chapter?: unknown;
    difficulty?: unknown;
  };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { isMathSolve: false };
  }

  // Fail open: only true when the model is explicitly true.
  if (parsed.isMathSolve !== true) return { isMathSolve: false };

  const difficulty =
    parsed.difficulty === 'easy' ||
    parsed.difficulty === 'medium' ||
    parsed.difficulty === 'hard'
      ? parsed.difficulty
      : undefined;

  return {
    isMathSolve: true,
    topic: typeof parsed.topic === 'string' ? parsed.topic : undefined,
    chapter: typeof parsed.chapter === 'string' ? parsed.chapter : undefined,
    difficulty,
  };
}

// ─── Intent Routing ────────────────────────────────────────────────────────

/**
 * Route a classified intent to the appropriate workflow.
 *
 * Greeting, off_topic, and unknown are handled inline without RAG.
 * All other intents are delegated to their dedicated workflow.
 */
export async function routeIntent(
  intent: FoxyIntent,
  message: string,
  params: {
    subject: string;
    grade: string;
    board: string;
    chapter?: string | null;
    mode: string;
    history: ChatMessage[];
    academicGoal?: string | null;
    studentId?: string;
    sessionId?: string;
    // White-label tenant overrides — forwarded to the explain workflow
    // (the only intent that consumes them today; doubt/quiz/revision use
    // separate prompt paths). Optional; absent → legacy behaviour.
    tenantPersonality?: 'warm_mentor' | 'rigorous_coach' | 'formal_examiner' | 'playful_buddy';
    tenantTone?: 'formal' | 'neutral' | 'casual';
    tenantPedagogy?: 'socratic' | 'direct_instruction' | 'worked_example';
  },
): Promise<WorkflowResult> {
  switch (intent) {
    case 'explain':
    case 'homework':
      return runExplainWorkflow(message, params);

    case 'doubt':
      return runDoubtWorkflow(message, params);

    case 'quiz':
      return runQuizGenerateWorkflow(message, params);

    case 'revision':
      return runRevisionWorkflow(message, params);

    case 'greeting':
    case 'off_topic':
    case 'unknown':
      return handleInlineIntent(intent, message, params);
  }
}

async function handleInlineIntent(
  intent: FoxyIntent,
  _message: string,
  params: {
    subject: string;
    grade: string;
    board: string;
    studentId?: string;
    sessionId?: string;
  },
): Promise<WorkflowResult> {
  const config = getAIConfig();
  const trace = new TraceLogger('inline-response', params.studentId, params.sessionId);

  const responses: Record<string, string> = {
    greeting: `Hey there! I'm Foxy, your ${params.subject} buddy for Class ${params.grade}. What would you like to learn today?`,
    off_topic: `That's outside what I can help with! I'm here for your ${params.subject} studies. Ask me anything about your ${params.board} syllabus!`,
    unknown: `I'm not sure what you mean, but I'm here to help with ${params.subject}! Could you rephrase your question?`,
  };

  const traceResult = trace.finish();
  if (config.enableTracing) {
    logTrace({ ...traceResult, intent });
  }

  return {
    response: responses[intent] ?? responses.unknown,
    intent,
    sources: [],
    tokensUsed: 0,
    model: 'none',
    latencyMs: 0,
    traceId: traceResult.traceId,
    metadata: { inline: true },
  };
}
