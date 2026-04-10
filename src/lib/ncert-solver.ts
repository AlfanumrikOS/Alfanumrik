/**
 * ALFANUMRIK — CBSE Solver Engine (Curriculum-Engineered)
 *
 * NOT a prompt router. This is a structured solver with:
 * 1. Syllabus graph lookup (formulas, rules, answer patterns)
 * 2. RAG retrieval (NCERT textbook content)
 * 3. Specialized solver routing (deterministic / rule / LLM)
 * 4. Verification layer (recompute, cross-check, validate)
 * 5. CBSE-format explanation generation
 *
 * Pipeline:
 *   Question → Classify → Syllabus Lookup → RAG Retrieve
 *   → Route Solver → Generate Answer → Verify → Format Output
 */

// ─── Types ───────────────────────────────────────────────

export type QuestionType = 'mcq' | 'short_answer' | 'long_answer' | 'numerical' | 'word_problem' | 'case_based' | 'grammar' | 'literature' | 'assertion_reasoning' | 'diagram_based';
export type SolverType = 'deterministic' | 'rule_based' | 'llm_grounded' | 'hybrid';
export type SubjectCode = 'math' | 'science' | 'physics' | 'chemistry' | 'biology' | 'english' | 'hindi' | 'social_studies' | 'computer_science' | 'economics' | 'accountancy';

export interface ClassifiedQuestion {
  text: string;
  type: QuestionType;
  subject: SubjectCode;
  grade: string;
  marks: number;
  depth: 'brief' | 'moderate' | 'detailed';
  isNumerical: boolean;
  hasFormula: boolean;
  options: string[];
  language: 'en' | 'hi';
  concepts: string[];
}

export interface SyllabusContext {
  concept: string;
  chapterTitle: string;
  chapterNumber: number;
  formulas: Array<{ name: string; expression: string; variables: Record<string, string> }>;
  rules: Array<{ rule: string; when_to_use: string }>;
  keyTerms: string[];
  commonMistakes: string[];
  answerPattern: string;
  bloomLevel: string;
}

export interface SolverResult {
  answer: string;
  steps: string[];
  concept: string;
  explanation: string;
  commonMistake: string;
  formulaUsed: string;
  confidence: number;
  verified: boolean;
  verificationIssues: string[];
  solverType: SolverType;
  questionType: QuestionType;
  marks: number;
  syllabusGrounded: boolean;
}

// ─── Step 1: Question Classifier ─────────────────────────

export function classifyQuestion(
  text: string,
  subject: string,
  grade: string,
  options?: string[],
  marks?: number,
): ClassifiedQuestion {
  const lower = text.toLowerCase();

  const type = detectType(lower, options, marks);
  const isNumerical = /\d+\s*[\+\-\*\/\=]|\bcalculate\b|\bfind\s+(the\s+)?value\b|\bsolve\b|\bcompute\b|\bevaluate\b|\bsimplify\b|\bprove\b/i.test(text);
  const hasFormula = /[=><≥≤±√∑∫π]|x\^|sin|cos|tan|log|\bformula\b/i.test(text);

  const effectiveMarks = marks || (type === 'mcq' ? 1 : type === 'short_answer' ? 2 : type === 'long_answer' ? 5 : 3);
  const depth = effectiveMarks <= 1 ? 'brief' : effectiveMarks <= 3 ? 'moderate' : 'detailed';
  const concepts = extractConcepts(lower, subject);
  const language = /[\u0900-\u097F]/.test(text) ? 'hi' : 'en';

  return {
    text, type,
    subject: subject as SubjectCode,
    grade, marks: effectiveMarks, depth,
    isNumerical, hasFormula,
    options: options || [], language, concepts,
  };
}

function detectType(text: string, options?: string[], marks?: number): QuestionType {
  if (options && options.length >= 3) return 'mcq';
  if (/assertion.*reason|reason.*assertion/i.test(text)) return 'assertion_reasoning';
  if (/case.?study|passage|read the.*passage|comprehension/i.test(text)) return 'case_based';
  if (/draw|diagram|figure|sketch|label/i.test(text)) return 'diagram_based';
  if (/grammar|tense|voice|narration|clause|preposition|article|modal/i.test(text)) return 'grammar';
  if (/poem|poet|stanza|character|story|novel|chapter.*summary|literary/i.test(text)) return 'literature';
  if (/calculate|find.*value|solve|compute|evaluate|simplify|prove|show that|verify/i.test(text)) return 'numerical';
  if (/word problem|train.*speed|pipe.*fill|age.*problem|profit.*loss/i.test(text)) return 'word_problem';
  if (marks && marks >= 5) return 'long_answer';
  if (marks && marks <= 2) return 'short_answer';
  return 'short_answer';
}

function extractConcepts(text: string, subject: string): string[] {
  const concepts: string[] = [];
  const patterns: Record<string, RegExp[]> = {
    math: [/linear equation/i, /quadratic/i, /polynomial/i, /trigonometr/i, /algebra/i, /geometry/i, /mensuration/i, /statistics/i, /probability/i, /fraction/i, /percentage/i, /ratio/i, /exponent/i, /bodmas/i, /hcf|lcm/i, /area|perimeter|volume/i, /circle|triangle|rectangle/i, /coordinate/i, /matrix|determinant/i, /derivative|differentiat/i, /integra/i, /sequence|series|a\.?p\.?|g\.?p\.?/i, /sets/i, /complex number/i, /binomial/i, /permutation|combination/i, /limit/i, /pythagoras/i],
    science: [/force|newton/i, /motion|velocity|acceleration/i, /energy|work|power/i, /light|optic|reflect|refract/i, /electric|current|resistance|ohm/i, /magnet/i, /wave|sound|frequency/i, /gravit/i, /heat|temperature/i, /chemical.*react/i, /acid|base|salt|ph/i, /metal/i, /carbon|organic/i, /cell|tissue/i, /heredit|genetic|dna/i, /evolution/i, /ecosystem|biodiversity/i, /reproduc/i, /nutrition|digest/i],
    physics: [/force|newton/i, /motion|velocity/i, /energy|work|power/i, /light|optic/i, /electric/i, /magnet/i, /wave|sound/i, /gravit/i, /thermodynamic/i, /nuclear/i, /semiconductor/i, /capacitor|inductor/i],
    chemistry: [/atom|molecule/i, /chemical.*bond/i, /acid|base|salt/i, /periodic/i, /organic|carbon/i, /metal/i, /oxidation|reduction/i, /mole|avogadro/i, /solution|concentration/i, /electrochemist/i, /polymer/i],
    biology: [/cell|tissue/i, /photosynth/i, /heredit|genetic/i, /evolution/i, /ecosystem/i, /reproduc/i, /nutrition/i, /nervous/i, /respiration/i, /excretion/i],
    english: [/tense/i, /voice.*active|passive/i, /reported.*speech|direct.*indirect/i, /preposition/i, /article/i, /modal/i, /clause/i, /noun|pronoun|verb|adjective|adverb/i],
    social_studies: [/revolution/i, /constitution/i, /democracy/i, /federalism/i, /nationalism/i, /resource/i, /development/i, /globaliz/i, /agriculture/i, /industry/i],
  };
  const subjectPatterns = patterns[subject] || [];
  for (const p of subjectPatterns) {
    const match = text.match(p);
    if (match) concepts.push(match[0].toLowerCase());
  }
  return Array.from(new Set(concepts));
}

// ─── Step 2: Solver Router ───────────────────────────────

export interface SolverRoute {
  solver: SolverType;
  reason: string;
  requiresVerification: boolean;
  maxTokens: number;
}

export function routeToSolver(q: ClassifiedQuestion): SolverRoute {
  const { type, subject, isNumerical } = q;

  if (type === 'mcq') {
    return { solver: isNumerical ? 'hybrid' : 'llm_grounded', reason: 'MCQ: evaluate each option against NCERT', requiresVerification: true, maxTokens: 400 };
  }
  if (type === 'numerical' && ['math', 'physics', 'chemistry', 'accountancy'].includes(subject)) {
    return { solver: 'deterministic', reason: 'Numerical: step-by-step formula application with verification', requiresVerification: true, maxTokens: 600 };
  }
  if (type === 'word_problem') {
    return { solver: 'hybrid', reason: 'Word problem: parse → extract variables → compute → explain', requiresVerification: true, maxTokens: 600 };
  }
  if (type === 'grammar') {
    return { solver: 'rule_based', reason: 'Grammar: apply grammatical rules deterministically', requiresVerification: true, maxTokens: 300 };
  }
  if (type === 'literature' || type === 'long_answer') {
    return { solver: 'llm_grounded', reason: 'Conceptual answer grounded in NCERT content', requiresVerification: false, maxTokens: q.depth === 'detailed' ? 800 : 500 };
  }
  return { solver: 'rule_based', reason: 'Short concept answer from NCERT', requiresVerification: true, maxTokens: 400 };
}

// ─── Step 3: Solver Prompt Builder ───────────────────────

export function buildSolverPrompt(
  q: ClassifiedQuestion,
  route: SolverRoute,
  syllabus: SyllabusContext | null,
  ragContent: string | null,
): string {
  const marksGuide = q.marks <= 1 ? 'Answer in 1-2 sentences.' : q.marks <= 2 ? '2-3 sentences with key concept.' : q.marks <= 3 ? '3-5 sentences with concept + example.' : 'Detailed answer: definition, explanation, example, diagram description if needed.';
  const gradeStyle = parseInt(q.grade) <= 7 ? 'Simple language, real-life analogies.' : parseInt(q.grade) <= 9 ? 'Clear language, proper NCERT terms.' : 'Precise board-exam language, marking scheme format.';

  let prompt = `SOLVE THIS CBSE QUESTION. You are a curriculum-grounded solver, NOT a chatbot.

QUESTION: ${q.text}
SUBJECT: ${q.subject} | GRADE: ${q.grade} | MARKS: ${q.marks} | TYPE: ${q.type}
${q.options.length > 0 ? `OPTIONS: ${q.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}` : ''}`;

  // Inject syllabus graph context (formulas, rules, answer pattern)
  if (syllabus) {
    prompt += `\n\nCURRICULUM REFERENCE (from CBSE syllabus graph — THIS IS AUTHORITATIVE):
CONCEPT: ${syllabus.concept} | CHAPTER: Ch.${syllabus.chapterNumber} ${syllabus.chapterTitle}`;

    if (syllabus.formulas.length > 0) {
      prompt += `\nFORMULAS TO USE:\n${syllabus.formulas.map(f => `  ${f.name}: ${f.expression}`).join('\n')}`;
    }
    if (syllabus.rules.length > 0) {
      prompt += `\nRULES TO APPLY:\n${syllabus.rules.map(r => `  ${r.rule} (use when: ${r.when_to_use})`).join('\n')}`;
    }
    if (syllabus.commonMistakes.length > 0) {
      prompt += `\nCOMMON MISTAKES TO AVOID:\n${syllabus.commonMistakes.map(m => `  - ${m}`).join('\n')}`;
    }
    if (syllabus.answerPattern) {
      prompt += `\nEXPECTED ANSWER PATTERN: ${syllabus.answerPattern}`;
    }
  }

  // Inject RAG content
  if (ragContent) {
    prompt += `\n\nNCERT TEXTBOOK CONTENT (use as primary source):\n${ragContent}`;
  }

  // Solver-specific instructions
  if (route.solver === 'deterministic') {
    prompt += `\n\nSOLVER MODE: DETERMINISTIC (step-by-step computation)
- Write Given, To Find, Formula, Substitution, Calculation, Answer with units
- Show EVERY intermediate step — do NOT skip any calculation
- VERIFY: substitute your answer back into the original equation
- State the final answer clearly with units`;
  } else if (route.solver === 'rule_based') {
    prompt += `\n\nSOLVER MODE: RULE-BASED
- Identify which rule/definition/theorem applies
- State the rule
- Apply it to this specific question
- Give the answer in CBSE format`;
  } else if (route.solver === 'hybrid') {
    prompt += `\n\nSOLVER MODE: HYBRID (parse + compute + explain)
- Extract all given information
- Identify the mathematical/scientific relationship
- Compute step by step
- Explain the reasoning`;
  }

  prompt += `\n\nFORMAT RULES:
- ${marksGuide}
- ${gradeStyle}
- Follow NCERT methods and terminology ONLY.
- Do NOT use methods not taught in NCERT for this grade.

OUTPUT JSON:
{"answer":"final answer","steps":["Step 1: ...","Step 2: ..."],"concept":"NCERT concept used","explanation":"student-friendly explanation","common_mistake":"what to avoid","formula_used":"if applicable","verification":"how you verified the answer is correct"}`;

  return prompt;
}

// ─── Step 4: Verification Prompt Builder ─────────────────

export function buildVerificationPrompt(q: ClassifiedQuestion, proposedAnswer: string, syllabus: SyllabusContext | null): string {
  let prompt = `VERIFY this CBSE answer for correctness. You are an independent verifier.

QUESTION: ${q.text}
${q.options.length > 0 ? `OPTIONS: ${q.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}` : ''}

PROPOSED ANSWER:
${proposedAnswer}`;

  if (syllabus && syllabus.formulas.length > 0) {
    prompt += `\n\nAUTHORITATIVE FORMULAS:\n${syllabus.formulas.map(f => `${f.name}: ${f.expression}`).join('\n')}`;
  }

  if (['math', 'physics', 'chemistry', 'accountancy'].includes(q.subject) && q.isNumerical) {
    prompt += `\n\nVERIFICATION METHOD:
1. RECOMPUTE every calculation step independently from scratch
2. SUBSTITUTE the final answer back into original equation
3. CHECK units are correct
4. If your recomputation gives a DIFFERENT answer, report it`;
  } else if (q.type === 'mcq') {
    prompt += `\n\nVERIFICATION METHOD:
1. Evaluate EACH option independently against NCERT
2. Eliminate wrong options with reasoning
3. Confirm selected option is correct`;
  } else {
    prompt += `\n\nVERIFICATION METHOD:
1. Check all facts against NCERT curriculum
2. Check key points for completeness (for ${q.marks} marks)
3. Check for common misconceptions`;
  }

  prompt += `\n\nOutput JSON: {"passed":boolean,"confidence":0.0-1.0,"correct_answer":"if different from proposed","errors_found":["..."],"recomputed":"your independent calculation if numerical"}`;

  return prompt;
}

// ─── Step 5: Confidence Scoring ──────────────────────────

export function computeConfidence(
  route: SolverRoute,
  verified: boolean,
  hasSyllabus: boolean,
  hasRAG: boolean,
): number {
  let c = route.solver === 'deterministic' ? 0.85 : route.solver === 'rule_based' ? 0.80 : route.solver === 'hybrid' ? 0.75 : 0.65;
  if (hasSyllabus) c += 0.08; // syllabus graph gives formulas/rules
  if (hasRAG) c += 0.05;      // RAG gives textbook context
  if (verified) c += 0.05;
  else c -= 0.15;
  return Math.max(0, Math.min(1, Math.round(c * 100) / 100));
}

// ─── Step 6: CBSE Explanation Formatter ──────────────────

export function formatCBSEExplanation(
  answer: string,
  steps: string[],
  concept: string,
  q: ClassifiedQuestion,
): string {
  if (q.marks <= 1) {
    return `${answer}${concept ? ` (${concept})` : ''}`;
  }
  if (q.marks <= 2) {
    return steps.length > 0
      ? steps.join(' → ') + `. Answer: ${answer}`
      : `${answer}. Concept: ${concept}`;
  }
  if (q.marks <= 3) {
    const formattedSteps = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    return `${formattedSteps}\n\nTherefore, ${answer}`;
  }
  // 5-mark detailed
  const formattedSteps = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `Concept: ${concept}\n\nSolution:\n${formattedSteps}\n\nAnswer: ${answer}`;
}
