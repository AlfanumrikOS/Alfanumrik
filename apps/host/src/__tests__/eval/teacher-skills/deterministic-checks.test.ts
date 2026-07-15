// src/__tests__/eval/teacher-skills/deterministic-checks.test.ts
//
// Teacher-skills eval harness — deterministic pre-checks (REG-54 oracle
// pattern). Verifies the QZ-* checks MIRROR the quiz-oracle P6/P5 semantics,
// that every check catches its planted violation in the DELIBERATELY-FAILING
// shipped fixture, and that the good fixture passes clean. Pure/offline: no
// DB, no LLM, no network.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  DETERMINISTIC_REGISTRY,
  quizChecks,
  foxyChecks,
  lessonPlanningChecks,
} from '../../../../eval/teacher-skills/harness/deterministic-checks';

// House convention: 4-up asset path, remapped by the setup.ts fs shim.
const FIXTURES_DIR = resolve(__dirname, '../../../../eval/teacher-skills/fixtures');

function loadFixtureArtifact(rel: string): unknown {
  const doc = JSON.parse(readFileSync(resolve(FIXTURES_DIR, rel), 'utf-8')) as {
    artifact: unknown;
  };
  return doc.artifact;
}

const goodQuiz = loadFixtureArtifact('quiz-generation/good.json');
const badQuiz = loadFixtureArtifact('quiz-generation/bad.json');
const goodFoxy = loadFixtureArtifact('foxy-explanation/good.json');
const badFoxy = loadFixtureArtifact('foxy-explanation/bad.json');
const goodLesson = loadFixtureArtifact('lesson-plan/good.json');
const badLesson = loadFixtureArtifact('lesson-plan/bad.json');

const QUIZ_CHECK_IDS = ['QZ-P6a', 'QZ-P6b', 'QZ-P6c', 'QZ-P6d', 'QZ-P6e', 'QZ-P6f', 'QZ-P5'];

describe('quiz-generation deterministic checks (P6/P5 oracle mirror)', () => {
  it('registry exposes exactly the QZ deterministic criteria', () => {
    expect(Object.keys(quizChecks).sort()).toEqual([...QUIZ_CHECK_IDS].sort());
  });

  it('the GOOD shipped fixture passes every deterministic check', () => {
    for (const id of QUIZ_CHECK_IDS) {
      const r = quizChecks[id](goodQuiz);
      expect(r.pass, `${id}: ${r.explanation}`).toBe(true);
    }
  });

  it('the BAD shipped fixture is caught by EVERY deterministic check (each planted violation found)', () => {
    for (const id of QUIZ_CHECK_IDS) {
      const r = quizChecks[id](badQuiz);
      expect(r.pass, `${id} should fail on the bad fixture`).toBe(false);
      expect(r.explanation.length).toBeGreaterThan(0);
    }
  });

  it('QZ-P6a rejects template residue {{ and [BLANK]', () => {
    const q = (t: string) => ({ grade: '9', questions: [{ question_text: t, options: ['a', 'b', 'c', 'd'], correct_answer_index: 0, explanation: 'e' }] });
    expect(quizChecks['QZ-P6a'](q('What is {{topic}}?')).pass).toBe(false);
    expect(quizChecks['QZ-P6a'](q('Fill [BLANK] here')).pass).toBe(false);
    expect(quizChecks['QZ-P6a'](q('A real question?')).pass).toBe(true);
  });

  it('QZ-P6c distinctness is case-insensitive after trimming (oracle parity)', () => {
    const base = { grade: '9', questions: [{ question_text: 'q', options: ['Alpha', ' alpha ', 'b', 'c'], correct_answer_index: 0, explanation: 'e' }] };
    expect(quizChecks['QZ-P6c'](base).pass).toBe(false);
  });

  it('QZ-P6d rejects non-integer and out-of-range indices', () => {
    const q = (idx: unknown) => ({ grade: '9', questions: [{ question_text: 'q', options: ['a', 'b', 'c', 'd'], correct_answer_index: idx, explanation: 'e' }] });
    expect(quizChecks['QZ-P6d'](q(4)).pass).toBe(false);
    expect(quizChecks['QZ-P6d'](q(-1)).pass).toBe(false);
    expect(quizChecks['QZ-P6d'](q(1.5)).pass).toBe(false);
    expect(quizChecks['QZ-P6d'](q('0')).pass).toBe(false);
    expect(quizChecks['QZ-P6d'](q(3)).pass).toBe(true);
  });

  it('QZ-P6f enforces the CANONICAL string difficulty enum easy|medium|hard (A3) and Bloom six', () => {
    const q = (difficulty: unknown, bloom: unknown) => ({ grade: '9', questions: [{ question_text: 'q', options: ['a', 'b', 'c', 'd'], correct_answer_index: 0, explanation: 'e', difficulty, bloom_level: bloom }] });
    expect(quizChecks['QZ-P6f'](q(3, 'apply')).pass).toBe(false); // legacy integer difficulty rejected
    expect(quizChecks['QZ-P6f'](q('hard', 'memorize')).pass).toBe(false);
    expect(quizChecks['QZ-P6f'](q('Hard', 'Apply')).pass).toBe(true); // case-insensitive
    expect(quizChecks['QZ-P6f'](q(undefined, undefined)).pass).toBe(true); // presence-optional
  });

  it('QZ-P5 rejects integer grades and out-of-band strings (P5)', () => {
    const batch = (grade: unknown) => ({ grade, questions: [{ question_text: 'q', options: ['a', 'b', 'c', 'd'], correct_answer_index: 0, explanation: 'e' }] });
    expect(quizChecks['QZ-P5'](batch(9)).pass).toBe(false);
    expect(quizChecks['QZ-P5'](batch('5')).pass).toBe(false);
    expect(quizChecks['QZ-P5'](batch('13')).pass).toBe(false);
    expect(quizChecks['QZ-P5'](batch('12')).pass).toBe(true);
  });

  it('malformed artifacts fail closed with an explanation (never throw)', () => {
    for (const id of QUIZ_CHECK_IDS) {
      for (const junk of [null, 42, 'str', {}, { questions: 'nope' }, { questions: [] }]) {
        const r = quizChecks[id](junk);
        expect(r.pass).toBe(false);
        expect(r.explanation.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('foxy-explanation deterministic checks', () => {
  it('FX-O2 passes the good fixture and catches the planted email/phone in the bad fixture (P13)', () => {
    expect(foxyChecks['FX-O2'](goodFoxy).pass).toBe(true);
    const r = foxyChecks['FX-O2'](badFoxy);
    expect(r.pass).toBe(false);
    expect(r.explanation).toMatch(/email|phone/);
  });

  it('FX-O2 catches an Indian mobile pattern on its own', () => {
    expect(foxyChecks['FX-O2']({ response: { text: 'call me on +91 98765 43210'.replace(/ /g, '') } }).pass).toBe(false);
    expect(foxyChecks['FX-O2']({ response: { text: 'the answer is 340 metres per second' } }).pass).toBe(true);
  });
});

describe('lesson-planning deterministic checks (Alfanumrik A1/A2a)', () => {
  it('A1 (P7 bilingual readiness): good fixture has *_hi, bad fixture does not', () => {
    expect(lessonPlanningChecks['A1'](goodLesson).pass).toBe(true);
    const r = lessonPlanningChecks['A1'](badLesson);
    expect(r.pass).toBe(false);
    expect(r.explanation).toMatch(/_hi/);
  });

  it('A2a (P5 grade string): good fixture "8" passes, bad fixture integer 8 fails', () => {
    expect(lessonPlanningChecks['A2a'](goodLesson).pass).toBe(true);
    const r = lessonPlanningChecks['A2a'](badLesson);
    expect(r.pass).toBe(false);
    expect(r.explanation).toMatch(/P5/);
  });

  it('A2a finds grade at top level, meta.grade, and shared.grade', () => {
    expect(lessonPlanningChecks['A2a']({ grade: '6' }).pass).toBe(true);
    expect(lessonPlanningChecks['A2a']({ meta: { grade: '12' } }).pass).toBe(true);
    expect(lessonPlanningChecks['A2a']({ shared: { grade: '10' } }).pass).toBe(true);
    expect(lessonPlanningChecks['A2a']({}).pass).toBe(false);
  });
});

describe('registry wiring', () => {
  it('maps each rubric name to its check set', () => {
    expect(DETERMINISTIC_REGISTRY['quiz-generation']).toBe(quizChecks);
    expect(DETERMINISTIC_REGISTRY['foxy-explanation']).toBe(foxyChecks);
    expect(DETERMINISTIC_REGISTRY['ncert-lesson-planning']).toBe(lessonPlanningChecks);
  });
});
