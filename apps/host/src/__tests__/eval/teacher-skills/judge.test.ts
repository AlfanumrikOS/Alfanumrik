// src/__tests__/eval/teacher-skills/judge.test.ts
//
// Teacher-skills eval harness — LLM-as-judge tests.
//
// CRITICAL — no live model call: every test injects a FAKE completion fn via
// `judgeArtifact(input, { complete })`, and the callClaude-adapter tests pass
// a FAKE callClaude function directly into `makeCallClaudeCompletion`. There
// is no global fetch stub, no network, no API key — the seam IS the function
// argument (same design as eval/rag relevance-judge tests).
//
// Focus areas per the build spec:
//   - judge JSON-parsing robustness: malformed judge output → null/{ok:false}
//     (downstream REVIEW), never a crash, never a fabricated pass;
//   - the callClaude adapter passes NO model override and maps the seam args
//     onto the house ClaudeRequestOptions shape;
//   - the system prompt keeps the upstream grading rules (M bucket vs
//     artifact) and the strict JSON-array output contract (P12 artifact).

import { describe, it, expect, vi } from 'vitest';

import {
  buildJudgeSystemPrompt,
  buildJudgeUserMessage,
  parseJudgeArray,
  judgeArtifact,
  makeCallClaudeCompletion,
  JUDGE_TEMPERATURE,
  JUDGE_MAX_TOKENS,
  MAX_ARTIFACT_CHARS,
  type JudgeCompletionFn,
  type JudgeCriterion,
  type CallClaudeLike,
} from '../../../../eval/teacher-skills/harness/judge';

const CRITERIA: JudgeCriterion[] = [
  { id: 'QZ-P1', bucket: 'P — Pedagogy', criterion: 'In scope', passRequires: 'CBSE scope' },
  { id: 'QZ-R1', bucket: 'R — Rigor', criterion: 'Distractors', passRequires: 'plausible' },
];

const VALID_RAW = JSON.stringify([
  { id: 'QZ-P1', pass: true, explanation: 'in scope' },
  { id: 'QZ-R1', pass: false, explanation: 'absurd distractor' },
]);

function fakeComplete(raw: string): JudgeCompletionFn {
  return vi.fn(async () => raw);
}

describe('parseJudgeArray (conservative-fail)', () => {
  const IDS = ['QZ-P1', 'QZ-R1'];

  it('parses a valid strict JSON array', () => {
    const r = parseJudgeArray(VALID_RAW, IDS);
    expect(r).toEqual([
      { id: 'QZ-P1', pass: true, explanation: 'in scope' },
      { id: 'QZ-R1', pass: false, explanation: 'absurd distractor' },
    ]);
  });

  it('recovers a ```json fenced array (fence-recovery like the house parsers)', () => {
    const r = parseJudgeArray('```json\n' + VALID_RAW + '\n```', IDS);
    expect(r).toHaveLength(2);
  });

  it('returns null on prose, non-JSON, and empty output', () => {
    expect(parseJudgeArray('The lesson looks great!', IDS)).toBeNull();
    expect(parseJudgeArray('', IDS)).toBeNull();
    expect(parseJudgeArray('{not json', IDS)).toBeNull();
  });

  it('returns null when the root is not an array', () => {
    expect(parseJudgeArray('{"id":"QZ-P1","pass":true}', IDS)).toBeNull();
  });

  it('returns null when an element lacks a string id or boolean pass', () => {
    expect(parseJudgeArray('[{"id":"QZ-P1","pass":"true"}]', IDS)).toBeNull();
    expect(parseJudgeArray('[{"pass":true}]', IDS)).toBeNull();
    expect(parseJudgeArray('[42]', IDS)).toBeNull();
  });

  it('returns null on a hallucinated criterion id (distrust the whole output)', () => {
    expect(parseJudgeArray('[{"id":"MADE-UP","pass":true,"explanation":"x"}]', IDS)).toBeNull();
  });

  it('keeps the FIRST occurrence on duplicate ids and tolerates a missing explanation', () => {
    const r = parseJudgeArray(
      '[{"id":"QZ-P1","pass":true},{"id":"QZ-P1","pass":false,"explanation":"dup"}]',
      IDS,
    );
    expect(r).toEqual([{ id: 'QZ-P1', pass: true, explanation: '' }]);
  });
});

describe('judgeArtifact (never throws)', () => {
  const input = {
    artifactJson: '{"grade":"9"}',
    chatResponse: null,
    criteria: CRITERIA,
    rubricName: 'quiz-generation',
  };

  it('returns judgements on valid output', async () => {
    const r = await judgeArtifact(input, { complete: fakeComplete(VALID_RAW) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.judgements).toHaveLength(2);
  });

  it('malformed judge output → {ok:false} (downstream REVIEW), not a crash', async () => {
    const r = await judgeArtifact(input, { complete: fakeComplete('sorry, cannot judge') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/malformed|valid/i);
  });

  it('a throwing transport → {ok:false}, not a crash', async () => {
    const complete: JudgeCompletionFn = vi.fn(async () => {
      throw new Error('circuit breaker is open');
    });
    const r = await judgeArtifact(input, { complete });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/circuit breaker/);
  });

  it('empty criteria short-circuits without calling the transport', async () => {
    const complete = fakeComplete(VALID_RAW);
    const r = await judgeArtifact({ ...input, criteria: [] }, { complete });
    expect(r.ok).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it('calls the transport with temperature 0 and the judge token cap', async () => {
    const complete = fakeComplete(VALID_RAW);
    await judgeArtifact(input, { complete });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: JUDGE_TEMPERATURE, maxTokens: JUDGE_MAX_TOKENS }),
    );
    expect(JUDGE_TEMPERATURE).toBe(0); // well under the 0.7 factual ceiling (P12)
  });
});

describe('makeCallClaudeCompletion (the ONLY real transport — house callClaude)', () => {
  it('maps the seam args to ClaudeRequestOptions and returns .content', async () => {
    const fakeCallClaude: CallClaudeLike = vi.fn(async () => ({ content: VALID_RAW }));
    const complete = makeCallClaudeCompletion(fakeCallClaude);
    const out = await complete({ system: 'SYS', user: 'USR', temperature: 0, maxTokens: 123 });
    expect(out).toBe(VALID_RAW);
    expect(fakeCallClaude).toHaveBeenCalledTimes(1);
    const opts = (fakeCallClaude as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(opts.systemPrompt).toBe('SYS');
    expect(opts.messages).toEqual([{ role: 'user', content: 'USR' }]);
    expect(opts.temperature).toBe(0);
    expect(opts.maxTokens).toBe(123);
  });

  it('NEVER passes a model override — callClaude default chain decides (user-approval gate)', async () => {
    const fakeCallClaude: CallClaudeLike = vi.fn(async () => ({ content: '[]' }));
    const complete = makeCallClaudeCompletion(fakeCallClaude);
    await complete({ system: 's', user: 'u', temperature: 0, maxTokens: 10 });
    const opts = (fakeCallClaude as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect('model' in opts).toBe(false);
  });
});

describe('prompts (P12 artifacts — pin the load-bearing wording)', () => {
  it('system prompt keeps the upstream grading rules and strict-array contract', () => {
    const sys = buildJudgeSystemPrompt();
    expect(sys).toMatch(/rigorous educational content evaluator/);
    expect(sys).toMatch(/CBSE \(grades 6-12\)/);
    expect(sys).toMatch(/`M` \(Model Scaffolding\) bucket against the chat/);
    expect(sys).toMatch(/valid JSON array/);
    expect(sys).toMatch(/"pass": true\|false/);
    expect(sys).toMatch(/SYNTHETIC evaluation fixture/);
  });

  it('user message carries rubric name, criteria ids, artifact, and optional chat response', () => {
    const msg = buildJudgeUserMessage({
      artifactJson: '{"x":1}',
      chatResponse: 'final reply',
      criteria: CRITERIA,
      rubricName: 'quiz-generation',
    });
    expect(msg).toMatch(/Rubric: quiz-generation/);
    expect(msg).toMatch(/id: QZ-P1/);
    expect(msg).toMatch(/=== ARTIFACT \(JSON\) ===/);
    expect(msg).toMatch(/=== FINAL CHAT RESPONSE ===/);
    const noChat = buildJudgeUserMessage({
      artifactJson: '{}',
      chatResponse: null,
      criteria: CRITERIA,
      rubricName: 'r',
    });
    expect(noChat).not.toMatch(/FINAL CHAT RESPONSE/);
  });

  it('caps the artifact JSON fed to the judge', () => {
    const huge = '"' + 'x'.repeat(MAX_ARTIFACT_CHARS * 2) + '"';
    const msg = buildJudgeUserMessage({
      artifactJson: huge,
      chatResponse: null,
      criteria: CRITERIA,
      rubricName: 'r',
    });
    expect(msg.length).toBeLessThan(huge.length);
  });
});
