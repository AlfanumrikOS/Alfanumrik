import { describe, it, expect } from 'vitest';
import {
  MISSION_CONFIGS,
  TEACH_BACK_FOXY_PRESET_KEY,
  type MissionConfig,
} from '../../play/mission-configs';
import {
  deriveMissionProgress,
  type MissionProgressInputs,
} from '../../play/mission-progress';

const empty: MissionProgressInputs = {
  diveArtifacts: [],
  challengeAttempts: [],
  quizSessions: [],
  foxySessions: [],
};

function findByKind(kind: MissionConfig['kind']): MissionConfig {
  const cfg = MISSION_CONFIGS.find((m) => m.kind === kind);
  if (!cfg) throw new Error(`no fixture for kind=${kind}`);
  return cfg;
}

describe('deriveMissionProgress — empty inputs', () => {
  it('every step is pending when no data exists', () => {
    for (const cfg of MISSION_CONFIGS) {
      const p = deriveMissionProgress(cfg, empty);
      expect(p.missionId).toBe(cfg.id);
      expect(p.steps).toHaveLength(cfg.steps.length);
      expect(p.steps.every((s) => s.done === false)).toBe(true);
      expect(p.allDone).toBe(false);
    }
  });
});

describe('deriveMissionProgress — concept', () => {
  it('completes when chain + quiz attempts meet requiredCount', () => {
    const cfg = findByKind('concept');
    const step = cfg.steps[0];
    if (step.kind !== 'concept') throw new Error('fixture drift');

    // Half from chain, half from quizzes → equals requiredCount.
    const half = Math.ceil(step.requiredCount / 2);
    const rest = step.requiredCount - half;
    const inputs: MissionProgressInputs = {
      ...empty,
      challengeAttempts: Array.from({ length: half }, () => ({
        subject: step.subject,
        chapterNumber: step.chapterNumber,
        chainCompleted: true,
      })),
      quizSessions: Array.from({ length: rest }, () => ({
        subject: step.subject,
        chapterNumber: step.chapterNumber,
        isCompleted: true,
      })),
    };
    const p = deriveMissionProgress(cfg, inputs);
    expect(p.allDone).toBe(true);
  });

  it('ignores non-matching subject/chapter', () => {
    const cfg = findByKind('concept');
    const step = cfg.steps[0];
    if (step.kind !== 'concept') throw new Error('fixture drift');
    const inputs: MissionProgressInputs = {
      ...empty,
      quizSessions: Array.from({ length: step.requiredCount }, () => ({
        subject: 'unrelated_subject',
        chapterNumber: step.chapterNumber,
        isCompleted: true,
      })),
    };
    expect(deriveMissionProgress(cfg, inputs).allDone).toBe(false);
  });
});

describe('deriveMissionProgress — mystery', () => {
  it('completes when a dive_artifact for the phenomenon exists', () => {
    const cfg = findByKind('mystery');
    const step = cfg.steps[0];
    if (step.kind !== 'mystery') throw new Error('fixture drift');
    const inputs: MissionProgressInputs = {
      ...empty,
      diveArtifacts: [{ phenomenonSlug: step.phenomenonSlug, isoWeek: '2026-W31' }],
    };
    expect(deriveMissionProgress(cfg, inputs).allDone).toBe(true);
  });

  it('ignores dive artifacts for other phenomena', () => {
    const cfg = findByKind('mystery');
    const inputs: MissionProgressInputs = {
      ...empty,
      diveArtifacts: [{ phenomenonSlug: 'some_other_slug', isoWeek: '2026-W31' }],
    };
    expect(deriveMissionProgress(cfg, inputs).allDone).toBe(false);
  });
});

describe('deriveMissionProgress — experiment', () => {
  it('completes when the follow-up quiz count is met', () => {
    const cfg = findByKind('experiment');
    const step = cfg.steps[0];
    if (step.kind !== 'experiment') throw new Error('fixture drift');
    const inputs: MissionProgressInputs = {
      ...empty,
      quizSessions: Array.from({ length: step.followupQuizCount }, () => ({
        subject: step.followupQuizSubject,
        chapterNumber: step.followupQuizChapter,
        isCompleted: true,
      })),
    };
    expect(deriveMissionProgress(cfg, inputs).allDone).toBe(true);
  });

  it('does not count incomplete quiz sessions', () => {
    const cfg = findByKind('experiment');
    const step = cfg.steps[0];
    if (step.kind !== 'experiment') throw new Error('fixture drift');
    const inputs: MissionProgressInputs = {
      ...empty,
      quizSessions: Array.from({ length: step.followupQuizCount }, () => ({
        subject: step.followupQuizSubject,
        chapterNumber: step.followupQuizChapter,
        isCompleted: false,
      })),
    };
    expect(deriveMissionProgress(cfg, inputs).allDone).toBe(false);
  });
});

describe('deriveMissionProgress — teach_back', () => {
  it('completes on a matching Foxy session (mode+preset+minTurns)', () => {
    const cfg = findByKind('teach_back');
    const step = cfg.steps[0];
    if (step.kind !== 'teach_back') throw new Error('fixture drift');
    const inputs: MissionProgressInputs = {
      ...empty,
      foxySessions: [
        {
          mode: 'explorer',
          presetKey: TEACH_BACK_FOXY_PRESET_KEY,
          studentTurnCount: step.minStudentTurns,
        },
      ],
    };
    expect(deriveMissionProgress(cfg, inputs).allDone).toBe(true);
  });

  it('rejects sessions with the wrong mode or preset', () => {
    const cfg = findByKind('teach_back');
    const step = cfg.steps[0];
    if (step.kind !== 'teach_back') throw new Error('fixture drift');
    const wrongMode: MissionProgressInputs = {
      ...empty,
      foxySessions: [
        { mode: 'learn', presetKey: TEACH_BACK_FOXY_PRESET_KEY, studentTurnCount: 10 },
      ],
    };
    const wrongPreset: MissionProgressInputs = {
      ...empty,
      foxySessions: [{ mode: 'explorer', presetKey: 'other_preset', studentTurnCount: 10 }],
    };
    const tooFewTurns: MissionProgressInputs = {
      ...empty,
      foxySessions: [
        {
          mode: 'explorer',
          presetKey: TEACH_BACK_FOXY_PRESET_KEY,
          studentTurnCount: Math.max(0, step.minStudentTurns - 1),
        },
      ],
    };
    expect(deriveMissionProgress(cfg, wrongMode).allDone).toBe(false);
    expect(deriveMissionProgress(cfg, wrongPreset).allDone).toBe(false);
    expect(deriveMissionProgress(cfg, tooFewTurns).allDone).toBe(false);
  });
});

describe('deriveMissionProgress — output shape', () => {
  it('stepIndex mirrors config order and kind matches', () => {
    const cfg = MISSION_CONFIGS[0]!;
    const p = deriveMissionProgress(cfg, empty);
    p.steps.forEach((s, i) => {
      expect(s.stepIndex).toBe(i);
      expect(s.kind).toBe(cfg.steps[i]!.kind);
    });
  });
});
