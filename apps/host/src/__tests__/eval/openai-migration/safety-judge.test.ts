// apps/host/src/__tests__/eval/openai-migration/safety-judge.test.ts
//
// OpenAI-migration harness — additive safety-rail judge tests. The ONLY
// external dependency (FOXY_SAFETY_RAILS, a plain string constant — not a
// transport) is imported for real so the prompt is proven to embed the LIVE
// rails text; the LLM completion itself is ALWAYS an injected fake in this
// file — ZERO network, ZERO live API calls, no ANTHROPIC_API_KEY required.

import { describe, it, expect } from 'vitest';
import { FOXY_SAFETY_RAILS } from '@alfanumrik/lib/foxy/prompt-sections';
import {
  buildSafetyJudgeSystemPrompt,
  buildSafetyJudgeUserMessage,
  parseSafetyJudgeJson,
  judgeSafetyRail,
  makeCallClaudeCompletion,
  SAFETY_PASS_FLOOR,
  type CallClaudeLike,
} from '../../../../eval/openai-migration/harness/safety-judge';

describe('buildSafetyJudgeSystemPrompt', () => {
  it('embeds the REAL, LIVE FOXY_SAFETY_RAILS text verbatim — never a hand-copied paraphrase that could drift', () => {
    const prompt = buildSafetyJudgeSystemPrompt();
    expect(prompt).toContain(FOXY_SAFETY_RAILS);
  });

  it('frames the check as safety-only, distinct from the separate quality judge', () => {
    const prompt = buildSafetyJudgeSystemPrompt();
    expect(prompt.toLowerCase()).toContain('safety-rail compliance');
  });

  it('demands a strict JSON-only response shape', () => {
    const prompt = buildSafetyJudgeSystemPrompt();
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"explanation"');
    expect(prompt).toMatch(/no (prose|markdown fences|commentary)/i);
  });
});

describe('buildSafetyJudgeUserMessage', () => {
  it('includes both the question and the answer verbatim', () => {
    const msg = buildSafetyJudgeUserMessage({ question: 'UNIQUE_Q_TOKEN', answer: 'UNIQUE_A_TOKEN' });
    expect(msg).toContain('UNIQUE_Q_TOKEN');
    expect(msg).toContain('UNIQUE_A_TOKEN');
  });
});

describe('parseSafetyJudgeJson', () => {
  it('parses a well-formed object', () => {
    expect(parseSafetyJudgeJson('{"score": 85, "explanation": "fine"}')).toEqual({ score: 85, explanation: 'fine' });
  });

  it('recovers fenced JSON (```json ... ```)', () => {
    expect(parseSafetyJudgeJson('```json\n{"score": 60, "explanation": "ok"}\n```')).toEqual({
      score: 60,
      explanation: 'ok',
    });
  });

  it('clamps out-of-range scores into 0..100', () => {
    expect(parseSafetyJudgeJson('{"score": 150, "explanation": "x"}')).toEqual({ score: 100, explanation: 'x' });
    expect(parseSafetyJudgeJson('{"score": -20, "explanation": "x"}')).toEqual({ score: 0, explanation: 'x' });
  });

  it('returns null on malformed (non-JSON) output', () => {
    expect(parseSafetyJudgeJson('not json')).toBeNull();
  });

  it('returns null when score is missing or non-numeric', () => {
    expect(parseSafetyJudgeJson('{"explanation": "x"}')).toBeNull();
    expect(parseSafetyJudgeJson('{"score": "high", "explanation": "x"}')).toBeNull();
  });

  it('returns null on an empty string', () => {
    expect(parseSafetyJudgeJson('')).toBeNull();
  });
});

describe('judgeSafetyRail', () => {
  it('returns pass:true when the injected judge scores at/above the floor', async () => {
    const complete = async () => '{"score": 80, "explanation": "compliant"}';
    const r = await judgeSafetyRail({ question: 'q', answer: 'a' }, { complete });
    expect(r).toEqual({ pass: true, score: 80, explanation: 'compliant' });
  });

  it('returns pass:false when the injected judge scores below the floor', async () => {
    const complete = async () => `{"score": ${SAFETY_PASS_FLOOR - 1}, "explanation": "off-topic, no redirect"}`;
    const r = await judgeSafetyRail({ question: 'q', answer: 'a' }, { complete });
    expect(r?.pass).toBe(false);
  });

  it('returns pass:true at exactly the floor score (inclusive boundary)', async () => {
    const complete = async () => `{"score": ${SAFETY_PASS_FLOOR}, "explanation": "borderline"}`;
    const r = await judgeSafetyRail({ question: 'q', answer: 'a' }, { complete });
    expect(r?.pass).toBe(true);
  });

  it('returns null (never throws) when the completion fn rejects', async () => {
    const complete = async () => {
      throw new Error('network down');
    };
    const r = await judgeSafetyRail({ question: 'q', answer: 'a' }, { complete });
    expect(r).toBeNull();
  });

  it('returns null on malformed judge output rather than fabricating a pass', async () => {
    const complete = async () => 'not json';
    const r = await judgeSafetyRail({ question: 'q', answer: 'a' }, { complete });
    expect(r).toBeNull();
  });
});

describe('makeCallClaudeCompletion', () => {
  it('adapts a callClaude-shaped fn into the completion seam without passing a model override', async () => {
    let capturedArgs: Parameters<CallClaudeLike>[0] | null = null;
    const fakeCallClaude: CallClaudeLike = async (args) => {
      capturedArgs = args;
      return { content: 'raw text' };
    };
    const complete = makeCallClaudeCompletion(fakeCallClaude);
    const out = await complete({ system: 'sys', user: 'usr', temperature: 0, maxTokens: 300 });

    expect(out).toBe('raw text');
    expect(capturedArgs).toMatchObject({
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'usr' }],
      temperature: 0,
      maxTokens: 300,
    });
    // No model override — callClaude's own configured default chain applies
    // (model changes need user approval, per the module's header comment).
    expect(capturedArgs).not.toHaveProperty('model');
  });
});
