import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GUARD — Foxy CURRICULUM GUARD flag resolver (ENV > DB > default-false).
 *
 * `isCurriculumGuardEnabled` resolves whether the STEM-only HARD out-of-grade
 * pre-gate (`ff_foxy_curriculum_guard_v1`, CEO Decision A) is on for a request
 * with a STRICT priority order — mirrors isMathPipelineEnabled EXACTLY but for
 * the SEPARATE curriculum-guard flag (so it can ramp independently):
 *   1. process.env.FF_FOXY_CURRICULUM_GUARD_V1 === 'true'  -> ON  (logs "[Curriculum Guard] Enabled via ENV")
 *   2. process.env.FF_FOXY_CURRICULUM_GUARD_V1 === 'false' -> OFF (logs "[Curriculum Guard] Disabled")
 *   3. unset / other                                       -> DB flag isFeatureEnabled
 *      ('ff_foxy_curriculum_guard_v1') — ON logs "[Curriculum Guard] Enabled via DB",
 *      OFF logs "[Curriculum Guard] Disabled".
 *
 * We mock ONLY the boundary collaborators (isFeatureEnabled + logger) and stub the
 * ENV var via vi.stubEnv. The DB layer must NOT be consulted when the ENV override
 * is present (a hard precedence assertion).
 */

const _isFeatureEnabled = vi.fn();
const _loggerInfo = vi.fn();

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: (...a: unknown[]) => _loggerInfo(...a), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isCurriculumGuardEnabled } from '@alfanumrik/lib/foxy/math-flag';

const CTX = { role: 'student', userId: 'user-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isCurriculumGuardEnabled — ENV 'true' wins over the DB flag", () => {
  it("ENV 'true' + DB false -> true, logs 'Enabled via ENV', and NEVER consults the DB", async () => {
    vi.stubEnv('FF_FOXY_CURRICULUM_GUARD_V1', 'true');
    _isFeatureEnabled.mockResolvedValue(false); // DB says OFF — must be ignored.

    const enabled = await isCurriculumGuardEnabled(CTX);

    expect(enabled).toBe(true);
    expect(_loggerInfo).toHaveBeenCalledWith('[Curriculum Guard] Enabled via ENV');
    // Hard precedence: the DB flag evaluator is never called.
    expect(_isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("ENV 'true' + DB true -> true via ENV (DB still not consulted)", async () => {
    vi.stubEnv('FF_FOXY_CURRICULUM_GUARD_V1', 'true');
    _isFeatureEnabled.mockResolvedValue(true);

    const enabled = await isCurriculumGuardEnabled(CTX);

    expect(enabled).toBe(true);
    expect(_loggerInfo).toHaveBeenCalledWith('[Curriculum Guard] Enabled via ENV');
    expect(_isFeatureEnabled).not.toHaveBeenCalled();
  });
});

describe("isCurriculumGuardEnabled — ENV 'false' wins over the DB flag", () => {
  it("ENV 'false' + DB true -> false, logs 'Disabled', and NEVER consults the DB", async () => {
    vi.stubEnv('FF_FOXY_CURRICULUM_GUARD_V1', 'false');
    _isFeatureEnabled.mockResolvedValue(true); // DB says ON — must be ignored.

    const enabled = await isCurriculumGuardEnabled(CTX);

    expect(enabled).toBe(false);
    expect(_loggerInfo).toHaveBeenCalledWith('[Curriculum Guard] Disabled');
    expect(_isFeatureEnabled).not.toHaveBeenCalled();
  });
});

describe('isCurriculumGuardEnabled — ENV unset defers to the DB flag', () => {
  it("ENV unset + DB true -> true, logs 'Enabled via DB', consults the DB flag by name", async () => {
    vi.stubEnv('FF_FOXY_CURRICULUM_GUARD_V1', undefined as unknown as string);
    _isFeatureEnabled.mockResolvedValue(true);

    const enabled = await isCurriculumGuardEnabled(CTX);

    expect(enabled).toBe(true);
    expect(_loggerInfo).toHaveBeenCalledWith('[Curriculum Guard] Enabled via DB');
    expect(_isFeatureEnabled).toHaveBeenCalledWith('ff_foxy_curriculum_guard_v1', CTX);
  });

  it("ENV unset + DB false -> false, logs 'Disabled'", async () => {
    vi.stubEnv('FF_FOXY_CURRICULUM_GUARD_V1', undefined as unknown as string);
    _isFeatureEnabled.mockResolvedValue(false);

    const enabled = await isCurriculumGuardEnabled(CTX);

    expect(enabled).toBe(false);
    expect(_loggerInfo).toHaveBeenCalledWith('[Curriculum Guard] Disabled');
    expect(_isFeatureEnabled).toHaveBeenCalledWith('ff_foxy_curriculum_guard_v1', CTX);
  });

  it("ENV set to a non-boolean string ('yes') -> defers to the DB (treated as unset)", async () => {
    vi.stubEnv('FF_FOXY_CURRICULUM_GUARD_V1', 'yes');
    _isFeatureEnabled.mockResolvedValue(true);

    const enabled = await isCurriculumGuardEnabled(CTX);

    expect(enabled).toBe(true);
    // 'yes' is not the literal 'true'/'false' → DB is consulted.
    expect(_isFeatureEnabled).toHaveBeenCalledWith('ff_foxy_curriculum_guard_v1', CTX);
    expect(_loggerInfo).toHaveBeenCalledWith('[Curriculum Guard] Enabled via DB');
  });

  it("ENV set to 'TRUE' (wrong case) -> defers to the DB (strict literal match only)", async () => {
    vi.stubEnv('FF_FOXY_CURRICULUM_GUARD_V1', 'TRUE');
    _isFeatureEnabled.mockResolvedValue(false);

    const enabled = await isCurriculumGuardEnabled(CTX);

    expect(enabled).toBe(false);
    expect(_isFeatureEnabled).toHaveBeenCalledTimes(1);
  });
});

// ─── Independence from the math-pipeline flag (separate flag, separate ramp) ───

describe('isCurriculumGuardEnabled — uses ITS OWN flag, independent of the math pipeline', () => {
  it("reads ff_foxy_curriculum_guard_v1 (NOT ff_foxy_math_pipeline_v1) from the DB", async () => {
    vi.stubEnv('FF_FOXY_CURRICULUM_GUARD_V1', undefined as unknown as string);
    _isFeatureEnabled.mockResolvedValue(true);

    await isCurriculumGuardEnabled(CTX);

    const flagsRead = _isFeatureEnabled.mock.calls.map((c) => c[0]);
    expect(flagsRead).toContain('ff_foxy_curriculum_guard_v1');
    expect(flagsRead).not.toContain('ff_foxy_math_pipeline_v1');
  });
});
