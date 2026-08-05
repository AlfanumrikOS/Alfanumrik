import { describe, it, expect } from 'vitest';
import {
  MISSION_CONFIGS,
  TEACH_BACK_FOXY_PRESET_KEY,
  getMissionConfig,
  type MissionKind,
} from '../../play/mission-configs';

const KINDS: MissionKind[] = ['concept', 'mystery', 'experiment', 'teach_back'];

describe('MISSION_CONFIGS', () => {
  it('ships at least 2 configs per kind', () => {
    for (const kind of KINDS) {
      const count = MISSION_CONFIGS.filter((m) => m.kind === kind).length;
      expect(count, `missing configs for kind=${kind}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('every config has a bilingual title and non-empty steps', () => {
    for (const cfg of MISSION_CONFIGS) {
      expect(cfg.id.length).toBeGreaterThan(0);
      expect(cfg.title.length).toBeGreaterThan(0);
      expect(cfg.titleHi.length).toBeGreaterThan(0);
      // Hindi contains Devanagari.
      expect(/[ऀ-ॿ]/.test(cfg.titleHi)).toBe(true);
      expect(cfg.steps.length).toBeGreaterThan(0);
    }
  });

  it('all IDs are unique', () => {
    const ids = MISSION_CONFIGS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all steps use the declared kind (mission.kind matches step.kind)', () => {
    for (const cfg of MISSION_CONFIGS) {
      for (const step of cfg.steps) {
        expect(step.kind).toBe(cfg.kind);
      }
    }
  });

  it('teach_back steps reference the exported preset key handshake', () => {
    const teachBacks = MISSION_CONFIGS.filter((m) => m.kind === 'teach_back');
    for (const m of teachBacks) {
      for (const step of m.steps) {
        if (step.kind !== 'teach_back') continue;
        expect(step.foxyPresetKey).toBe(TEACH_BACK_FOXY_PRESET_KEY);
        expect(step.foxyMode).toBe('explorer');
      }
    }
  });
});

describe('getMissionConfig', () => {
  it('returns the matching config', () => {
    const first = MISSION_CONFIGS[0]!;
    expect(getMissionConfig(first.id)?.id).toBe(first.id);
  });

  it('returns null for unknown IDs', () => {
    expect(getMissionConfig('does.not.exist')).toBeNull();
  });
});
