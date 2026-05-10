import { describe, it, expect, vi, beforeEach } from 'vitest';

const callClaudeMock = vi.fn();
const startRunMock = vi.fn(async (..._args: unknown[]) => 'run-1');
const persistStepMock = vi.fn(async (..._args: unknown[]) => undefined);
const finalizeRunMock = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock('@/lib/ai/clients/claude', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
}));
vi.mock('@/lib/ai/agents/trace', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/agents/trace')>('@/lib/ai/agents/trace');
  return {
    ...actual,
    startRun: (...a: unknown[]) => startRunMock(...a),
    persistStep: (...a: unknown[]) => persistStepMock(...a),
    finalizeRun: (...a: unknown[]) => finalizeRunMock(...a),
  };
});

const callGroundedAnswerMock = vi.fn();
vi.mock('@/lib/ai/grounded-client', () => ({
  callGroundedAnswer: (...args: unknown[]) => callGroundedAnswerMock(...args),
}));

const validateCandidateMock = vi.fn();
vi.mock('@/lib/ai/validation/quiz-oracle', () => ({
  validateCandidate: (...args: unknown[]) => validateCandidateMock(...args),
}));

const fromMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t) },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn() }));

import { runFixFailedQuestions } from '@/lib/ai/agents/agents/fix-failed-questions';

const Q1 = {
  id: 'q1', question_text: 'What is 2+2?', options: ['3','4','5','6'],
  correct_answer_index: 0, explanation: 'Because.',
  grade: '6', subject: 'mathematics', chapter_number: 1, chapter_title: 'Numbers',
  verifier_failure_reason: 'correct answer is option B (index 1)',
};

const FIXED = {
  question: 'What is 2+2?', options: ['3','4','5','6'],
  correct_answer_index: 1, explanation: 'Two plus two equals four.',
};

function mockBankSelect() {
  return { select: () => ({ eq: () => ({ single: async () => ({ data: Q1, error: null }) }) }) };
}
function mockBankFull() {
  return {
    select: () => ({ eq: () => ({ single: async () => ({ data: Q1, error: null }) }) }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  };
}
function mockHistoryInsert() {
  return { insert: async () => ({ error: null }) };
}

beforeEach(() => {
  callClaudeMock.mockReset();
  callGroundedAnswerMock.mockReset();
  validateCandidateMock.mockReset();
  fromMock.mockReset();
  startRunMock.mockClear();
  persistStepMock.mockClear();
  finalizeRunMock.mockClear();

  fromMock.mockImplementation((t: string) => {
    if (t === 'question_bank') return mockBankFull();
    if (t === 'question_bank_fix_history') return mockHistoryInsert();
    throw new Error('unexpected ' + t);
  });

  validateCandidateMock.mockResolvedValue({ ok: true, llm_calls: 0 });
});

function tu(name: string, input: unknown, id = `tu-${Math.random().toString(36).slice(2, 8)}`) {
  return { type: 'tool_use', id, name, input };
}
function llmResp(blocks: unknown[], stop = 'tool_use') {
  return {
    content: '',
    contentBlocks: blocks,
    stopReason: stop,
    model: 'claude-haiku-4-5-20251001',
    tokensUsed: 200, inputTokens: 150, outputTokens: 50, latencyMs: 100,
  };
}
function groundedSuccess(answerJson: string) {
  return {
    grounded: true,
    answer: answerJson,
    citations: [], confidence: 0.9, trace_id: 't1',
    meta: { claude_model: 'haiku', tokens_used: 100, latency_ms: 200 },
  };
}
function groundedAbstain(reason: string) {
  return {
    grounded: false,
    abstain_reason: reason,
    suggested_alternatives: [],
    trace_id: 't1',
    meta: { latency_ms: 50 },
  };
}

describe('runFixFailedQuestions — canonical paths', () => {
  it('index_correction: read → regen → re_verify → commit', async () => {
    callGroundedAnswerMock
      // regenerate_question — generator returns question_text key
      .mockResolvedValueOnce(groundedSuccess(JSON.stringify({
        question_text: FIXED.question,
        options: FIXED.options,
        correct_answer_index: FIXED.correct_answer_index,
        explanation: FIXED.explanation,
      })))
      // re_verify
      .mockResolvedValueOnce(groundedSuccess(JSON.stringify({
        verified: true, correct_option_index: 1, supporting_chunk_ids: [], reason: 'OK',
      })));

    callClaudeMock
      .mockResolvedValueOnce(llmResp([tu('read_failed_question', { question_id: 'q1' })]))
      .mockResolvedValueOnce(llmResp([tu('regenerate_question', { question_id: 'q1', fix_strategy: 'index_correction', hint: '1' })]))
      .mockResolvedValueOnce(llmResp([tu('re_verify', { question_id: 'q1', candidate: FIXED })]))
      .mockResolvedValueOnce(llmResp([tu('commit_fix', { question_id: 'q1', fixed_question: FIXED, fix_strategy: 'index_correction' })]))
      .mockResolvedValueOnce({ ...llmResp([{ type: 'text', text: 'Done.' }], 'end_turn'), content: 'Done.' });

    const result = await runFixFailedQuestions({ question_id: 'q1' });
    expect(result.status).toBe('success');
    const stepTypes = persistStepMock.mock.calls.map((c) => ((c as unknown[])[0] as { stepType: string }).stepType);
    expect(stepTypes.filter((s) => s === 'tool_call')).toHaveLength(4);
  });

  it('out-of-scope short-circuit: read → mark_unfixable', async () => {
    const Q1OutOfScope = { ...Q1, verifier_failure_reason: 'no chunks for chapter' };
    fromMock.mockImplementation((t: string) => {
      if (t === 'question_bank') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: Q1OutOfScope, error: null }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (t === 'question_bank_fix_history') return mockHistoryInsert();
      throw new Error('unexpected ' + t);
    });

    callClaudeMock
      .mockResolvedValueOnce(llmResp([tu('read_failed_question', { question_id: 'q1' })]))
      .mockResolvedValueOnce(llmResp([tu('mark_unfixable', { question_id: 'q1', reason: 'no chunks for chapter' })]))
      .mockResolvedValueOnce({ ...llmResp([{ type: 'text', text: 'Marked.' }], 'end_turn'), content: 'Marked.' });

    const result = await runFixFailedQuestions({ question_id: 'q1' });
    expect(result.status).toBe('success');
    const toolCalls = persistStepMock.mock.calls
      .map((c) => ((c as unknown[])[0] as { tool?: { name: string } }))
      .filter((s) => s.tool)
      .map((s) => s.tool!.name);
    expect(toolCalls).toEqual(['read_failed_question', 'mark_unfixable']);
  });

  it('full_regen with one retry: read → regen → re_verify(fail) → regen → re_verify(pass) → commit', async () => {
    callGroundedAnswerMock
      .mockResolvedValueOnce(groundedSuccess(JSON.stringify({
        question_text: FIXED.question, options: FIXED.options,
        correct_answer_index: FIXED.correct_answer_index, explanation: FIXED.explanation,
      })))
      .mockResolvedValueOnce(groundedSuccess(JSON.stringify({
        verified: false, correct_option_index: 2, supporting_chunk_ids: [], reason: 'index off',
      })))
      .mockResolvedValueOnce(groundedSuccess(JSON.stringify({
        question_text: FIXED.question, options: FIXED.options,
        correct_answer_index: FIXED.correct_answer_index, explanation: FIXED.explanation,
      })))
      .mockResolvedValueOnce(groundedSuccess(JSON.stringify({
        verified: true, correct_option_index: 1, supporting_chunk_ids: [], reason: 'OK',
      })));

    callClaudeMock
      .mockResolvedValueOnce(llmResp([tu('read_failed_question', { question_id: 'q1' })]))
      .mockResolvedValueOnce(llmResp([tu('regenerate_question', { question_id: 'q1', fix_strategy: 'full_regen' })]))
      .mockResolvedValueOnce(llmResp([tu('re_verify', { question_id: 'q1', candidate: FIXED })]))
      .mockResolvedValueOnce(llmResp([tu('regenerate_question', { question_id: 'q1', fix_strategy: 'full_regen', hint: 'verifier said index 2' })]))
      .mockResolvedValueOnce(llmResp([tu('re_verify', { question_id: 'q1', candidate: FIXED })]))
      .mockResolvedValueOnce(llmResp([tu('commit_fix', { question_id: 'q1', fixed_question: FIXED, fix_strategy: 'full_regen' })]))
      .mockResolvedValueOnce({ ...llmResp([{ type: 'text', text: 'Fixed.' }], 'end_turn'), content: 'Fixed.' });

    const result = await runFixFailedQuestions({ question_id: 'q1' });
    expect(result.status).toBe('success');
  });

  it('budget exceeded: maxSteps trip throws BudgetExceeded', async () => {
    const { BudgetExceeded } = await import('@/lib/ai/agents/types');
    callClaudeMock.mockResolvedValue(llmResp([tu('read_failed_question', { question_id: 'q1' })]));
    callGroundedAnswerMock.mockResolvedValue(groundedAbstain('upstream_error'));

    await expect(
      runFixFailedQuestions({ question_id: 'q1' }),
    ).rejects.toBeInstanceOf(BudgetExceeded);
  });

  it('commit_fix without re_verify is rejected at handler layer', async () => {
    callGroundedAnswerMock
      .mockResolvedValueOnce(groundedSuccess(JSON.stringify({
        question_text: FIXED.question, options: FIXED.options,
        correct_answer_index: FIXED.correct_answer_index, explanation: FIXED.explanation,
      })));
    callClaudeMock
      .mockResolvedValueOnce(llmResp([tu('read_failed_question', { question_id: 'q1' })]))
      .mockResolvedValueOnce(llmResp([tu('regenerate_question', { question_id: 'q1', fix_strategy: 'index_correction' })]))
      .mockResolvedValueOnce(llmResp([tu('commit_fix', { question_id: 'q1', fixed_question: FIXED, fix_strategy: 'index_correction' })]))
      .mockResolvedValueOnce({ ...llmResp([{ type: 'text', text: 'Tried.' }], 'end_turn'), content: 'Tried.' });

    const result = await runFixFailedQuestions({ question_id: 'q1' });
    expect(result.status).toBe('success');
    const errorSteps = persistStepMock.mock.calls
      .map((c) => ((c as unknown[])[0] as { tool?: { error: string | null } }))
      .filter((s) => s.tool && s.tool.error);
    expect(errorSteps.some((s) => /precondition|re_verify/i.test(s.tool!.error!))).toBe(true);
  });
});
