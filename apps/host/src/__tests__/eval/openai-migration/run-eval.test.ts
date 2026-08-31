// apps/host/src/__tests__/eval/openai-migration/run-eval.test.ts
//
// OpenAI-migration validation harness — pure-assembler tests. All LLM deps
// are FAKES (injected) — ZERO network, ZERO live API calls (no
// OPENAI_API_KEY / ANTHROPIC_API_KEY read or required anywhere in this
// file). Mirrors apps/host/src/__tests__/eval/teacher-skills/run-eval.test.ts's
// posture.
//
// checkJsonContract's Foxy-schema/quiz-oracle/quiz-verifier-contract branches
// and runMcqOracleCheck's gateQuizMeMcq/gatePracticeMcqs calls run the REAL
// house validation code (FoxyResponseSchema, runDeterministicChecks,
// quiz-me-oracle-gate.ts) — these are pure/deterministic and require no
// network. The ONLY seam that could ever make a network call (the mcqOracle
// LLM grader) is always an injected fake or `null` in this file.

import { describe, it, expect, vi } from 'vitest';
import type { FoxyResponse, FoxyMcqBlock } from '@alfanumrik/lib/foxy/schema';
import type { LlmGrader } from '@alfanumrik/lib/ai/validation/quiz-oracle';
import {
  runEval,
  verdictFor,
  aggregateResults,
  checkJsonContract,
  checkHindiEnglishCodeSwitch,
  runMcqOracleCheck,
  JSON_CONTRACT_TEMPLATES,
  QUIZ_ORACLE_PASS_RATE_THRESHOLD,
  type EvalSample,
  type CallModelFn,
  type QualityJudgeFn,
  type SafetyRailJudgeFn,
  type SampleResult,
  type JsonContractResult,
} from '../../../../eval/openai-migration/harness/run-eval';

function sample(over: Partial<EvalSample> = {}): EvalSample {
  return {
    id: 's1',
    templateId: 'foxy_tutor_teach_v1',
    systemPrompt: 'sys',
    userMessage: 'What is photosynthesis?',
    grade: '8',
    subject: 'science',
    maxTokens: 512,
    temperature: 0.3,
    citations: [],
    coachMode: null,
    expectHindiAnswer: false,
    expectMcqBlocks: false,
    ...over,
  };
}

const okQuality: QualityJudgeFn = async () => ({
  accuracyScore: 90,
  scaffoldFidelityScore: 90,
  ageAppropriatenessScore: 90,
  cbseScopeScore: 90,
  overallScore: 90,
  judgeModel: 'claude-sonnet-4-5-20250929',
  rubricVersion: 'v2',
  notes: null,
});
const okSafety: SafetyRailJudgeFn = async () => ({ pass: true, score: 90, explanation: 'compliant' });

// ─── Fixture builders (realistic, schema/oracle-valid payloads) ─────────────

const VALID_FOXY_RESPONSE_JSON = JSON.stringify({
  title: 'Photosynthesis',
  subject: 'science',
  blocks: [{ type: 'paragraph', text: 'Photosynthesis is how plants convert sunlight into energy.' }],
});

const VALID_QUIZ_CANDIDATE_JSON = JSON.stringify({
  question_text: 'What is the powerhouse of the cell?',
  options: ['Mitochondria', 'Nucleus', 'Ribosome', 'Golgi body'],
  correct_answer_index: 0,
  explanation: 'Mitochondria produce ATP via cellular respiration, hence called the powerhouse of the cell.',
});

function mcqBlock(over: Partial<FoxyMcqBlock> & { stem: string; explanation: string }): FoxyMcqBlock {
  return {
    type: 'mcq',
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_answer_index: 0,
    ...over,
  };
}

/** A P6/oracle-VALID mcq — passes both FoxyBlockSchema and runDeterministicChecks. */
function validMcq(n: number): FoxyMcqBlock {
  return mcqBlock({
    stem: `Which planet is known as the Red Planet (item ${n})?`,
    options: ['Mars', 'Venus', 'Jupiter', 'Saturn'],
    correct_answer_index: 0,
    explanation: `Mars appears red due to iron oxide on its surface (item ${n}).`,
  });
}

/**
 * A schema-VALID but ORACLE-rejected mcq — the explanation's number (15)
 * contradicts the marked-correct option's number (12), tripping
 * runDeterministicChecks' numeric_inconsistency check. Demonstrates a defect
 * zod's schema alone cannot catch, which is exactly why the mcqOracle
 * dimension exists.
 */
function numericInconsistentMcq(): FoxyMcqBlock {
  return mcqBlock({
    stem: 'What is 6 plus 6 in this arithmetic problem?',
    options: ['10', '11', '12', '13'],
    correct_answer_index: 2,
    explanation: '6 + 6 equals 15 according to this explanation.',
  });
}

function foxyResponseWithBlocks(blocks: FoxyResponse['blocks']): FoxyResponse {
  return { title: 'Quiz', subject: 'general', blocks };
}

function passingFoxySchemaContract(response: FoxyResponse): JsonContractResult {
  return { status: 'pass', error: null, checkKind: 'foxy-schema', failureStage: null, foxyResponse: response };
}

describe('JSON_CONTRACT_TEMPLATES', () => {
  it('excludes exactly ncert_solver_v1 among the 6 harness template ids (raw-markdown by design)', () => {
    expect(JSON_CONTRACT_TEMPLATES.has('ncert_solver_v1')).toBe(false);
    expect(JSON_CONTRACT_TEMPLATES.has('foxy_tutor_teach_v1')).toBe(true);
    expect(JSON_CONTRACT_TEMPLATES.has('foxy_tutor_exam_v1')).toBe(true);
    expect(JSON_CONTRACT_TEMPLATES.has('foxy_tutor_doubt_v1')).toBe(true);
    expect(JSON_CONTRACT_TEMPLATES.has('quiz_question_generator_v1')).toBe(true);
    expect(JSON_CONTRACT_TEMPLATES.has('quiz_answer_verifier_v1')).toBe(true);
    expect(JSON_CONTRACT_TEMPLATES.size).toBe(5);
  });
});

describe('checkJsonContract — ncert_solver_v1 (not applicable)', () => {
  it('skips unconditionally — raw-markdown output never fails this check', () => {
    expect(checkJsonContract('ncert_solver_v1', 'This is plain prose, not JSON at all.')).toEqual({
      status: 'skipped-not-applicable',
      error: null,
      checkKind: 'none',
      failureStage: null,
      foxyResponse: null,
    });
  });
});

describe('checkJsonContract — Foxy templates run FoxyResponseSchema.safeParse (Gap 1)', () => {
  it('passes a real, schema-conformant FoxyResponse and returns the parsed payload for downstream reuse', () => {
    const r = checkJsonContract('foxy_tutor_teach_v1', VALID_FOXY_RESPONSE_JSON);
    expect(r.status).toBe('pass');
    expect(r.checkKind).toBe('foxy-schema');
    expect(r.failureStage).toBeNull();
    expect(r.foxyResponse).toEqual(JSON.parse(VALID_FOXY_RESPONSE_JSON));
  });

  it('recovers fenced JSON (```json ... ```) before parsing', () => {
    const r = checkJsonContract('foxy_tutor_exam_v1', `\`\`\`json\n${VALID_FOXY_RESPONSE_JSON}\n\`\`\``);
    expect(r.status).toBe('pass');
  });

  it('fails at the PARSE stage on malformed JSON, distinctly from a schema failure', () => {
    const r = checkJsonContract('foxy_tutor_exam_v1', 'not json{{');
    expect(r.status).toBe('fail');
    expect(r.checkKind).toBe('foxy-schema');
    expect(r.failureStage).toBe('parse');
    expect(r.error).toBeTruthy();
    expect(r.foxyResponse).toBeNull();
  });

  it('THE GAP-1 REGRESSION: valid-but-schema-nonconforming JSON now fails at the SCHEMA stage instead of reading as a bare-JSON.parse PASS', () => {
    // Syntactically valid JSON (parses fine) but missing required "blocks" —
    // this is exactly the shape that used to read PASS under bare
    // JSON.parse while production would silently fall back to
    // wrapAsParagraph(), losing every structured block.
    const r = checkJsonContract('foxy_tutor_doubt_v1', JSON.stringify({ title: 'T', subject: 'general' }));
    expect(r.status).toBe('fail');
    expect(r.checkKind).toBe('foxy-schema');
    expect(r.failureStage).toBe('schema');
    expect(r.error).toMatch(/blocks/);
    expect(r.foxyResponse).toBeNull();
  });

  it('rejects a math block that violates a superRefine cross-field rule (latex delimiters), proving real schema depth beyond top-level shape', () => {
    const badMath = JSON.stringify({
      title: 'T',
      subject: 'math',
      blocks: [{ type: 'math', latex: '$x^2$' }], // '$' delimiters are forbidden
    });
    const r = checkJsonContract('foxy_tutor_teach_v1', badMath);
    expect(r.status).toBe('fail');
    expect(r.failureStage).toBe('schema');
  });
});

describe('checkJsonContract — quiz_question_generator_v1 runs the REG-54 oracle (Gap 1)', () => {
  it('passes a real, oracle-valid candidate', () => {
    const r = checkJsonContract('quiz_question_generator_v1', VALID_QUIZ_CANDIDATE_JSON);
    expect(r).toEqual({ status: 'pass', error: null, checkKind: 'quiz-oracle', failureStage: null, foxyResponse: null });
  });

  it('fails at the PARSE stage on malformed JSON', () => {
    const r = checkJsonContract('quiz_question_generator_v1', 'not json{{');
    expect(r.status).toBe('fail');
    expect(r.checkKind).toBe('quiz-oracle');
    expect(r.failureStage).toBe('parse');
  });

  it('THE GAP-1 REGRESSION: a P6-violating candidate (only 3 options) now fails at the ORACLE stage instead of reading as a bare-JSON.parse PASS', () => {
    const threeOptions = JSON.stringify({
      question_text: 'What is 2 + 2?',
      options: ['3', '4', '5'],
      correct_answer_index: 1,
      explanation: '2 + 2 = 4.',
    });
    const r = checkJsonContract('quiz_question_generator_v1', threeOptions);
    expect(r.status).toBe('fail');
    expect(r.checkKind).toBe('quiz-oracle');
    expect(r.failureStage).toBe('schema');
    expect(r.error).toMatch(/p6_options_not_4/);
  });

  it('catches a numeric_inconsistency the oracle exists specifically to catch (not a P6 structural defect zod would catch)', () => {
    const inconsistent = JSON.stringify({
      question_text: 'What is 6 + 6?',
      options: ['10', '11', '12', '13'],
      correct_answer_index: 2,
      explanation: '6 + 6 equals 15.',
    });
    const r = checkJsonContract('quiz_question_generator_v1', inconsistent);
    expect(r.status).toBe('fail');
    expect(r.error).toMatch(/numeric_inconsistency/);
  });

  it('treats the {"error":"insufficient_source"} abstain sentinel as skipped-not-applicable, not a fail (mirrors parseDraftJson)', () => {
    const r = checkJsonContract('quiz_question_generator_v1', JSON.stringify({ error: 'insufficient_source' }));
    expect(r).toEqual({ status: 'skipped-not-applicable', error: null, checkKind: 'quiz-oracle', failureStage: null, foxyResponse: null });
  });

  it('forwards grade into the candidate (P5 check) — an invalid grade is caught by the oracle', () => {
    const r = checkJsonContract('quiz_question_generator_v1', VALID_QUIZ_CANDIDATE_JSON, '13');
    expect(r.status).toBe('fail');
    expect(r.error).toMatch(/p5_invalid_grade/);
  });
});

describe('checkJsonContract — quiz_answer_verifier_v1 mirrors parseVerifierJson, NOT the REG-54 oracle (Gap 1)', () => {
  it('passes a real, verifier-shaped response', () => {
    const r = checkJsonContract(
      'quiz_answer_verifier_v1',
      JSON.stringify({ verified: true, reason: 'Supported by chunk 2', correct_option_index: 1, supporting_chunk_ids: [] }),
    );
    expect(r).toEqual({
      status: 'pass',
      error: null,
      checkKind: 'quiz-verifier-contract',
      failureStage: null,
      foxyResponse: null,
    });
  });

  it('fails at the PARSE stage on malformed JSON', () => {
    const r = checkJsonContract('quiz_answer_verifier_v1', 'not json{{');
    expect(r.status).toBe('fail');
    expect(r.checkKind).toBe('quiz-verifier-contract');
    expect(r.failureStage).toBe('parse');
  });

  it('THE GAP-1 REGRESSION: a non-boolean "verified" field now fails at the SCHEMA stage instead of reading as a bare-JSON.parse PASS', () => {
    const r = checkJsonContract('quiz_answer_verifier_v1', JSON.stringify({ verified: 'yes', reason: 'x' }));
    expect(r.status).toBe('fail');
    expect(r.checkKind).toBe('quiz-verifier-contract');
    expect(r.failureStage).toBe('schema');
    expect(r.error).toMatch(/verified/);
  });

  it('is lenient on reason/correct_option_index/supporting_chunk_ids — matches parseVerifierJson exactly (they never fail the parse on their own)', () => {
    // Missing reason, out-of-range correct_option_index, missing supporting_chunk_ids —
    // parseVerifierJson defaults all of these; only `verified` is a hard gate.
    const r = checkJsonContract('quiz_answer_verifier_v1', JSON.stringify({ verified: false, correct_option_index: 99 }));
    expect(r.status).toBe('pass');
  });

  it('does NOT run the REG-54 oracle on this shape — a well-formed CandidateQuestion-shaped payload is NOT what this template ever emits and must not be misread as a verifier PASS/FAIL signal either way; only "verified" gates it', () => {
    // A payload shaped like a quiz candidate (no "verified" key at all) fails
    // — proving this check is really keying off "verified", not silently
    // delegating to runDeterministicChecks (which would fail on a totally
    // different category like p6_text_empty_or_placeholder).
    const r = checkJsonContract('quiz_answer_verifier_v1', VALID_QUIZ_CANDIDATE_JSON);
    expect(r.status).toBe('fail');
    expect(r.error).toMatch(/verified/);
    expect(r.error).not.toMatch(/p6_/);
  });
});

describe('checkHindiEnglishCodeSwitch', () => {
  it('skips when the sample is not tagged expectHindiAnswer, regardless of content', () => {
    const r = checkHindiEnglishCodeSwitch('kya hai yeh', 'English only answer', false);
    expect(r.status).toBe('skipped-not-applicable');
  });

  it('passes when a Devanagari question gets a Devanagari-bearing answer', () => {
    const r = checkHindiEnglishCodeSwitch('प्रकाश संश्लेषण क्या है?', 'यह एक प्रक्रिया है जिसमें पौधे भोजन बनाते हैं।', true);
    expect(r.status).toBe('pass');
  });

  it('passes on Hinglish markers even without Devanagari script', () => {
    const r = checkHindiEnglishCodeSwitch('photosynthesis kya hai?', 'Photosynthesis kaise hota hai, samjhte hain.', true);
    expect(r.status).toBe('pass');
  });

  it('fails when a Hindi/Hinglish question gets a fully English-only answer', () => {
    const r = checkHindiEnglishCodeSwitch('photosynthesis kya hai?', 'Photosynthesis is a process where plants make food using sunlight.', true);
    expect(r.status).toBe('fail');
    expect(r.explanation).toMatch(/P7 bilingual/);
  });

  it('skips (mislabeled fixture) when expectHindiAnswer=true but the question has no detectable Hindi/Hinglish marker', () => {
    const r = checkHindiEnglishCodeSwitch('What is photosynthesis?', 'It is a process.', true);
    expect(r.status).toBe('skipped-not-applicable');
    expect(r.explanation).toMatch(/mislabeled/);
  });
});

describe('QUIZ_ORACLE_PASS_RATE_THRESHOLD', () => {
  it('is 90% — the shared bar across quiz_question_generator_v1 and the mcqOracle dimension', () => {
    expect(QUIZ_ORACLE_PASS_RATE_THRESHOLD).toBe(0.9);
  });
});

describe('runMcqOracleCheck (Gap 2) — real gateQuizMeMcq/gatePracticeMcqs, deterministic-only (llmGrade: null), zero network', () => {
  it('skips when the sample is not tagged expectMcqBlocks, regardless of jsonContract', () => {
    return runMcqOracleCheck({
      expectMcqBlocks: false,
      jsonContract: passingFoxySchemaContract(foxyResponseWithBlocks([validMcq(1)])),
      grade: '8',
      subject: 'science',
      llmGrade: null,
    }).then((r) => {
      expect(r.status).toBe('skipped-not-applicable');
      expect(r.explanation).toMatch(/not tagged expectMcqBlocks/);
    });
  });

  it('skips (never double-counts) when jsonContract itself did not produce a valid FoxyResponse', () => {
    return runMcqOracleCheck({
      expectMcqBlocks: true,
      jsonContract: { status: 'fail', error: 'bad', checkKind: 'foxy-schema', failureStage: 'schema', foxyResponse: null },
      grade: '8',
      subject: 'science',
      llmGrade: null,
    }).then((r) => {
      expect(r.status).toBe('skipped-not-applicable');
      expect(r.explanation).toMatch(/jsonContract did not produce/);
    });
  });

  it('skips when jsonContract is from a non-Foxy template (checkKind !== foxy-schema), even if status is pass', () => {
    return runMcqOracleCheck({
      expectMcqBlocks: true,
      jsonContract: { status: 'pass', error: null, checkKind: 'quiz-oracle', failureStage: null, foxyResponse: null },
      grade: '8',
      subject: 'science',
      llmGrade: null,
    }).then((r) => {
      expect(r.status).toBe('skipped-not-applicable');
    });
  });

  it('FAILS when tagged expectMcqBlocks=true but the model emitted zero mcq blocks (the feature promised mcqs and did not deliver)', async () => {
    const r = await runMcqOracleCheck({
      expectMcqBlocks: true,
      jsonContract: passingFoxySchemaContract(foxyResponseWithBlocks([{ type: 'paragraph', text: 'No mcq here.' }])),
      grade: '8',
      subject: 'science',
      llmGrade: null,
    });
    expect(r.status).toBe('fail');
    expect(r.totalMcqBlocks).toBe(0);
    expect(r.explanation).toMatch(/zero mcq blocks/);
  });

  it('single mcq block ("Quiz me" mode) routes through gateQuizMeMcq and PASSES a real oracle-valid mcq', async () => {
    const r = await runMcqOracleCheck({
      expectMcqBlocks: true,
      jsonContract: passingFoxySchemaContract(foxyResponseWithBlocks([validMcq(1)])),
      grade: '8',
      subject: 'science',
      llmGrade: null,
    });
    expect(r.status).toBe('pass');
    expect(r.totalMcqBlocks).toBe(1);
    expect(r.gated).toBe(1);
    expect(r.kept).toBe(1);
    expect(r.passRate).toBe(1);
    expect(r.llmCalls).toBe(0); // deterministic-only, llmGrade: null
  });

  it('single mcq block ("Quiz me" mode) FAILS a real oracle-invalid mcq (numeric_inconsistency) via the SAME REG-54 oracle production uses', async () => {
    const r = await runMcqOracleCheck({
      expectMcqBlocks: true,
      jsonContract: passingFoxySchemaContract(foxyResponseWithBlocks([numericInconsistentMcq()])),
      grade: '8',
      subject: 'science',
      llmGrade: null,
    });
    expect(r.status).toBe('fail');
    expect(r.kept).toBe(0);
    expect(r.explanation).toMatch(/numeric_inconsistency/);
  });

  it('2+ mcq blocks (real-practice mode) routes through gatePracticeMcqs and PASSES when all gated mcqs are oracle-valid', async () => {
    const r = await runMcqOracleCheck({
      expectMcqBlocks: true,
      jsonContract: passingFoxySchemaContract(foxyResponseWithBlocks([validMcq(1), validMcq(2)])),
      grade: '8',
      subject: 'science',
      llmGrade: null,
    });
    expect(r.status).toBe('pass');
    expect(r.totalMcqBlocks).toBe(2);
    expect(r.gated).toBe(2);
    expect(r.kept).toBe(2);
    expect(r.passRate).toBe(1);
  });

  it('2+ mcq blocks FAILS when the gated pass-rate drops below the shared 90% threshold (2 valid + 1 oracle-rejected = 66.7%)', async () => {
    const r = await runMcqOracleCheck({
      expectMcqBlocks: true,
      jsonContract: passingFoxySchemaContract(
        foxyResponseWithBlocks([validMcq(1), validMcq(2), numericInconsistentMcq()]),
      ),
      grade: '8',
      subject: 'science',
      llmGrade: null,
    });
    expect(r.status).toBe('fail');
    expect(r.totalMcqBlocks).toBe(3);
    expect(r.gated).toBe(3);
    expect(r.kept).toBe(2);
    expect(r.passRate).toBeCloseTo(2 / 3, 5);
    expect(r.passRate!).toBeLessThan(QUIZ_ORACLE_PASS_RATE_THRESHOLD);
  });

  it('wires an injected llmGrade fake end-to-end (proves the seam is real, still zero network) — an LLM mismatch verdict rejects an otherwise P6-valid mcq', async () => {
    const mismatchGrader: LlmGrader = vi.fn(async () => ({
      verdict: 'mismatch',
      reasoning: 'fake grader says the explanation supports a different option',
      suggested_correct_index: 1,
    }));
    const r = await runMcqOracleCheck({
      expectMcqBlocks: true,
      jsonContract: passingFoxySchemaContract(foxyResponseWithBlocks([validMcq(1)])),
      grade: '8',
      subject: 'science',
      llmGrade: mismatchGrader,
    });
    expect(r.status).toBe('fail');
    expect(r.llmCalls).toBe(1);
    expect(mismatchGrader).toHaveBeenCalledTimes(1);
    expect(r.explanation).toMatch(/gateQuizMeMcq/);
  });
});

describe('verdictFor', () => {
  it('PASS requires every dimension (including mcqOracle) to be pass or legitimately skipped', () => {
    expect(verdictFor('pass', 'skipped-not-applicable', 'pass', 'pass', 'skipped-not-applicable')).toBe('PASS');
    expect(verdictFor('pass', 'skipped-not-applicable', 'pass', 'pass', 'pass')).toBe('PASS');
  });

  it('REVIEW on any single fail, including a mcqOracle fail', () => {
    expect(verdictFor('fail', 'skipped-not-applicable', 'pass', 'pass', 'skipped-not-applicable')).toBe('REVIEW');
    expect(verdictFor('pass', 'fail', 'pass', 'pass', 'skipped-not-applicable')).toBe('REVIEW');
    expect(verdictFor('pass', 'skipped-not-applicable', 'fail', 'pass', 'skipped-not-applicable')).toBe('REVIEW');
    expect(verdictFor('pass', 'skipped-not-applicable', 'pass', 'fail', 'skipped-not-applicable')).toBe('REVIEW');
    expect(verdictFor('pass', 'skipped-not-applicable', 'pass', 'pass', 'fail')).toBe('REVIEW');
  });

  it('REVIEW when a dimension was never actually judged — never a silent PASS on an incomplete measurement', () => {
    expect(verdictFor('pass', 'skipped-not-applicable', 'pass', 'not-judged', 'skipped-not-applicable')).toBe('REVIEW');
    expect(verdictFor('pass', 'skipped-not-applicable', 'judge-error', 'pass', 'skipped-not-applicable')).toBe('REVIEW');
    expect(verdictFor('pass', 'skipped-not-applicable', 'call-error', 'call-error', 'skipped-not-applicable')).toBe('REVIEW');
  });
});

describe('runEval — zero network, every dependency injected', () => {
  it('a fully-passing sample verdicts PASS and callModel receives exactly the rendered request shape', async () => {
    const callModel = vi.fn<CallModelFn>(async () => ({ content: VALID_QUIZ_CANDIDATE_JSON, model: 'gpt-4o-mini' }));
    const run = await runEval({
      samples: [sample({ templateId: 'quiz_question_generator_v1' })],
      callModel,
      qualityJudge: okQuality,
      safetyJudge: okSafety,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    expect(run.results[0].verdict).toBe('PASS');
    expect(run.results[0].jsonContract.status).toBe('pass');
    expect(run.results[0].mcqOracle.status).toBe('skipped-not-applicable'); // expectMcqBlocks defaults false
    expect(callModel).toHaveBeenCalledWith({
      systemPrompt: 'sys',
      userMessage: 'What is photosynthesis?',
      maxTokens: 512,
      temperature: 0.3,
    });
  });

  it('a model call failure short-circuits every other check (including mcqOracle) and verdicts REVIEW without invoking the judges', async () => {
    const callModel: CallModelFn = async () => {
      throw new Error('OPENAI_API_KEY not configured');
    };
    const qualityJudge = vi.fn(okQuality);
    const safetyJudge = vi.fn(okSafety);
    const run = await runEval({
      samples: [sample()],
      callModel,
      qualityJudge,
      safetyJudge,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    const r = run.results[0];
    expect(r.verdict).toBe('REVIEW');
    expect(r.callError).toContain('OPENAI_API_KEY');
    expect(r.modelUsed).toBeNull();
    expect(r.mcqOracle.status).toBe('skipped-not-applicable');
    expect(qualityJudge).not.toHaveBeenCalled();
    expect(safetyJudge).not.toHaveBeenCalled();
  });

  it('malformed JSON output on a JSON-contract template fails json_contract at the parse stage and verdicts REVIEW even when quality/safety pass', async () => {
    const callModel: CallModelFn = async () => ({ content: 'not json', model: 'gpt-4o-mini' });
    const run = await runEval({
      samples: [sample({ templateId: 'quiz_answer_verifier_v1' })],
      callModel,
      qualityJudge: okQuality,
      safetyJudge: okSafety,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    expect(run.results[0].jsonContract.status).toBe('fail');
    expect(run.results[0].jsonContract.failureStage).toBe('parse');
    expect(run.results[0].verdict).toBe('REVIEW');
  });

  it('null safetyJudge (--judge off) marks safety_rail not-judged and the sample can never PASS', async () => {
    const callModel: CallModelFn = async () => ({ content: 'plain text answer', model: 'none' });
    const run = await runEval({
      samples: [sample({ templateId: 'ncert_solver_v1' })],
      callModel,
      qualityJudge: async () => null,
      safetyJudge: null,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    expect(run.results[0].safetyRail).toEqual({ status: 'not-judged', judgement: null });
    expect(run.results[0].verdict).toBe('REVIEW');
  });

  it('a null return from the quality judge is judge-error, not a silent pass', async () => {
    const callModel: CallModelFn = async () => ({ content: VALID_QUIZ_CANDIDATE_JSON, model: 'gpt-4o-mini' });
    const run = await runEval({
      samples: [sample({ templateId: 'quiz_question_generator_v1' })],
      callModel,
      qualityJudge: async () => null,
      safetyJudge: okSafety,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    expect(run.results[0].quality).toEqual({ status: 'judge-error', score: null });
    expect(run.results[0].verdict).toBe('REVIEW');
  });

  it('a null return from the safety judge is judge-error, not a silent pass', async () => {
    const callModel: CallModelFn = async () => ({ content: VALID_QUIZ_CANDIDATE_JSON, model: 'gpt-4o-mini' });
    const run = await runEval({
      samples: [sample({ templateId: 'quiz_question_generator_v1' })],
      callModel,
      qualityJudge: okQuality,
      safetyJudge: async () => null,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    expect(run.results[0].safetyRail.status).toBe('judge-error');
    expect(run.results[0].verdict).toBe('REVIEW');
  });

  it('a quality score below threshold fails the quality dimension', async () => {
    const callModel: CallModelFn = async () => ({ content: VALID_QUIZ_CANDIDATE_JSON, model: 'gpt-4o-mini' });
    const lowQuality: QualityJudgeFn = async () => ({
      accuracyScore: 40,
      scaffoldFidelityScore: 40,
      ageAppropriatenessScore: 40,
      cbseScopeScore: 40,
      overallScore: 40,
      judgeModel: 'claude-sonnet-4-5-20250929',
      rubricVersion: 'v2',
      notes: 'weak',
    });
    const run = await runEval({
      samples: [sample({ templateId: 'quiz_question_generator_v1' })],
      callModel,
      qualityJudge: lowQuality,
      safetyJudge: okSafety,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    expect(run.results[0].quality.status).toBe('fail');
    expect(run.results[0].verdict).toBe('REVIEW');
  });

  it('a safety score below threshold fails the safety_rail dimension even when the judge reports pass:true', async () => {
    // Deliberately inconsistent fake (pass:true but score under the caller's
    // threshold) to prove runEval enforces ITS OWN threshold, not just the
    // judge's opinion of itself.
    const callModel: CallModelFn = async () => ({ content: VALID_QUIZ_CANDIDATE_JSON, model: 'gpt-4o-mini' });
    const borderlineSafety: SafetyRailJudgeFn = async () => ({ pass: true, score: 30, explanation: 'borderline' });
    const run = await runEval({
      samples: [sample({ templateId: 'quiz_question_generator_v1' })],
      callModel,
      qualityJudge: okQuality,
      safetyJudge: borderlineSafety,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    expect(run.results[0].safetyRail.status).toBe('fail');
    expect(run.results[0].verdict).toBe('REVIEW');
  });

  it('a thrown judge error is caught as judge-error, never propagated as an unhandled rejection', async () => {
    const callModel: CallModelFn = async () => ({ content: VALID_QUIZ_CANDIDATE_JSON, model: 'gpt-4o-mini' });
    const throwingQuality: QualityJudgeFn = async () => {
      throw new Error('network down');
    };
    const run = await runEval({
      samples: [sample({ templateId: 'quiz_question_generator_v1' })],
      callModel,
      qualityJudge: throwingQuality,
      safetyJudge: okSafety,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    expect(run.results[0].quality.status).toBe('judge-error');
    expect(run.results[0].reasons.join(' ')).toContain('network down');
  });

  it('end-to-end Gap 2: a Foxy sample tagged expectMcqBlocks with a real oracle-valid mcq block PASSES the mcqOracle dimension deterministically (--judge off semantics: mcqLlmGrade null)', async () => {
    const foxyWithMcq = JSON.stringify(foxyResponseWithBlocks([validMcq(1)]));
    const callModel: CallModelFn = async () => ({ content: foxyWithMcq, model: 'gpt-4o-mini' });
    const run = await runEval({
      samples: [sample({ templateId: 'foxy_tutor_teach_v1', expectMcqBlocks: true })],
      callModel,
      qualityJudge: okQuality,
      safetyJudge: okSafety,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    const r = run.results[0];
    expect(r.jsonContract.status).toBe('pass');
    expect(r.mcqOracle.status).toBe('pass');
    expect(r.mcqOracle.totalMcqBlocks).toBe(1);
    expect(r.verdict).toBe('PASS');
  });

  it('end-to-end Gap 2: a Foxy sample tagged expectMcqBlocks that emits NO mcq blocks fails mcqOracle and verdicts REVIEW even though jsonContract/quality/safety all pass', async () => {
    const foxyNoMcq = VALID_FOXY_RESPONSE_JSON;
    const callModel: CallModelFn = async () => ({ content: foxyNoMcq, model: 'gpt-4o-mini' });
    const run = await runEval({
      samples: [sample({ templateId: 'foxy_tutor_teach_v1', expectMcqBlocks: true })],
      callModel,
      qualityJudge: okQuality,
      safetyJudge: okSafety,
      mcqLlmGrade: null,
      qualityPassThreshold: 70,
      safetyPassThreshold: 50,
    });
    const r = run.results[0];
    expect(r.jsonContract.status).toBe('pass');
    expect(r.mcqOracle.status).toBe('fail');
    expect(r.verdict).toBe('REVIEW');
    expect(r.reasons.join(' ')).toMatch(/mcq_oracle/);
  });
});

describe('aggregateResults', () => {
  function result(over: Partial<SampleResult> = {}): SampleResult {
    return {
      sampleId: 'x',
      templateId: 'quiz_question_generator_v1',
      modelUsed: 'gpt-4o-mini',
      callError: null,
      jsonContract: { status: 'pass', error: null, checkKind: 'quiz-oracle', failureStage: null, foxyResponse: null },
      codeSwitch: { status: 'skipped-not-applicable', explanation: '' },
      quality: {
        status: 'pass',
        score: {
          accuracyScore: 90,
          scaffoldFidelityScore: 90,
          ageAppropriatenessScore: 90,
          cbseScopeScore: 90,
          overallScore: 90,
          judgeModel: 'm',
          rubricVersion: 'v2',
          notes: null,
        },
      },
      safetyRail: { status: 'pass', judgement: { pass: true, score: 90, explanation: 'ok' } },
      mcqOracle: { status: 'skipped-not-applicable', totalMcqBlocks: 0, gated: 0, kept: 0, passRate: null, llmCalls: 0, explanation: '' },
      verdict: 'PASS',
      reasons: [],
      ...over,
    };
  }

  it('tallies pass/review counts and per-dimension evaluated/passed correctly across samples', () => {
    const agg = aggregateResults([
      result({ sampleId: 'a' }),
      result({
        sampleId: 'b',
        verdict: 'REVIEW',
        jsonContract: { status: 'fail', error: 'bad', checkKind: 'quiz-oracle', failureStage: 'schema', foxyResponse: null },
      }),
    ]);
    expect(agg.total).toBe(2);
    expect(agg.passed).toBe(1);
    expect(agg.review).toBe(1);
    expect(agg.jsonContract.evaluated).toBe(2);
    expect(agg.jsonContract.passed).toBe(1);
    expect(agg.quality.averageScore).toBe(90);
  });

  it('averageScore is null (not 0) when no sample was ever quality-judged', () => {
    const agg = aggregateResults([result({ quality: { status: 'not-judged', score: null } })]);
    expect(agg.quality.averageScore).toBeNull();
    expect(agg.quality.evaluated).toBe(0);
  });

  it('THE GAP-1 REGRESSION: parseFailures and schemaFailures are counted DISTINCTLY, never conflated into one bucket', () => {
    const agg = aggregateResults([
      result({
        sampleId: 'parse-fail',
        verdict: 'REVIEW',
        jsonContract: { status: 'fail', error: 'bad json', checkKind: 'foxy-schema', failureStage: 'parse', foxyResponse: null },
      }),
      result({
        sampleId: 'schema-fail-1',
        verdict: 'REVIEW',
        jsonContract: { status: 'fail', error: 'missing blocks', checkKind: 'foxy-schema', failureStage: 'schema', foxyResponse: null },
      }),
      result({
        sampleId: 'schema-fail-2',
        verdict: 'REVIEW',
        jsonContract: { status: 'fail', error: 'p6_options_not_4', checkKind: 'quiz-oracle', failureStage: 'schema', foxyResponse: null },
      }),
      result({ sampleId: 'pass' }),
    ]);
    expect(agg.jsonContract.evaluated).toBe(4);
    expect(agg.jsonContract.passed).toBe(1);
    expect(agg.jsonContract.parseFailures).toBe(1);
    expect(agg.jsonContract.schemaFailures).toBe(2);
  });

  it('THE GAP-2 ADDITION: mcqOracle evaluated/passed tallies correctly and excludes skipped samples', () => {
    const agg = aggregateResults([
      result({
        sampleId: 'mcq-pass',
        mcqOracle: { status: 'pass', totalMcqBlocks: 1, gated: 1, kept: 1, passRate: 1, llmCalls: 0, explanation: '' },
      }),
      result({
        sampleId: 'mcq-fail',
        verdict: 'REVIEW',
        mcqOracle: { status: 'fail', totalMcqBlocks: 1, gated: 1, kept: 0, passRate: 0, llmCalls: 0, explanation: '' },
      }),
      result({ sampleId: 'mcq-skipped' }), // default skipped-not-applicable
    ]);
    expect(agg.mcqOracle.evaluated).toBe(2);
    expect(agg.mcqOracle.passed).toBe(1);
  });
});
