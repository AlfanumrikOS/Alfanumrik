import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * GUARD — Foxy Math Pipeline flag resolver (ENV > DB > default-false).
 *
 * `isMathPipelineEnabled` resolves whether `ff_foxy_math_pipeline_v1` is on for a
 * request with a STRICT priority order:
 *   1. process.env.FF_FOXY_MATH_PIPELINE_V1 === 'true'  -> ON  (logs "Enabled via ENV")
 *   2. process.env.FF_FOXY_MATH_PIPELINE_V1 === 'false' -> OFF (logs "Disabled")
 *   3. unset / other                                    -> DB flag isFeatureEnabled
 *      ('ff_foxy_math_pipeline_v1') — ON logs "Enabled via DB", OFF logs "Disabled".
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

import { isMathPipelineEnabled } from '@alfanumrik/lib/foxy/math-flag';

const CTX = { role: 'student', userId: 'user-1' };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isMathPipelineEnabled — ENV 'true' wins over the DB flag", () => {
  it("ENV 'true' + DB false -> true, logs 'Enabled via ENV', and NEVER consults the DB", async () => {
    vi.stubEnv('FF_FOXY_MATH_PIPELINE_V1', 'true');
    _isFeatureEnabled.mockResolvedValue(false); // DB says OFF — must be ignored.

    const enabled = await isMathPipelineEnabled(CTX);

    expect(enabled).toBe(true);
    expect(_loggerInfo).toHaveBeenCalledWith('[Math Pipeline] Enabled via ENV');
    // Hard precedence: the DB flag evaluator is never called.
    expect(_isFeatureEnabled).not.toHaveBeenCalled();
  });

  it("ENV 'true' + DB true -> true via ENV (DB still not consulted)", async () => {
    vi.stubEnv('FF_FOXY_MATH_PIPELINE_V1', 'true');
    _isFeatureEnabled.mockResolvedValue(true);

    const enabled = await isMathPipelineEnabled(CTX);

    expect(enabled).toBe(true);
    expect(_loggerInfo).toHaveBeenCalledWith('[Math Pipeline] Enabled via ENV');
    expect(_isFeatureEnabled).not.toHaveBeenCalled();
  });
});

describe("isMathPipelineEnabled — ENV 'false' wins over the DB flag", () => {
  it("ENV 'false' + DB true -> false, logs 'Disabled', and NEVER consults the DB", async () => {
    vi.stubEnv('FF_FOXY_MATH_PIPELINE_V1', 'false');
    _isFeatureEnabled.mockResolvedValue(true); // DB says ON — must be ignored.

    const enabled = await isMathPipelineEnabled(CTX);

    expect(enabled).toBe(false);
    expect(_loggerInfo).toHaveBeenCalledWith('[Math Pipeline] Disabled');
    expect(_isFeatureEnabled).not.toHaveBeenCalled();
  });
});

describe('isMathPipelineEnabled — ENV unset defers to the DB flag', () => {
  it("ENV unset + DB true -> true, logs 'Enabled via DB', consults the DB flag by name", async () => {
    vi.stubEnv('FF_FOXY_MATH_PIPELINE_V1', undefined as unknown as string);
    _isFeatureEnabled.mockResolvedValue(true);

    const enabled = await isMathPipelineEnabled(CTX);

    expect(enabled).toBe(true);
    expect(_loggerInfo).toHaveBeenCalledWith('[Math Pipeline] Enabled via DB');
    expect(_isFeatureEnabled).toHaveBeenCalledWith('ff_foxy_math_pipeline_v1', CTX);
  });

  it("ENV unset + DB false -> false, logs 'Disabled'", async () => {
    vi.stubEnv('FF_FOXY_MATH_PIPELINE_V1', undefined as unknown as string);
    _isFeatureEnabled.mockResolvedValue(false);

    const enabled = await isMathPipelineEnabled(CTX);

    expect(enabled).toBe(false);
    expect(_loggerInfo).toHaveBeenCalledWith('[Math Pipeline] Disabled');
    expect(_isFeatureEnabled).toHaveBeenCalledWith('ff_foxy_math_pipeline_v1', CTX);
  });

  it("ENV set to a non-boolean string ('yes') -> defers to the DB (treated as unset)", async () => {
    vi.stubEnv('FF_FOXY_MATH_PIPELINE_V1', 'yes');
    _isFeatureEnabled.mockResolvedValue(true);

    const enabled = await isMathPipelineEnabled(CTX);

    expect(enabled).toBe(true);
    // 'yes' is not the literal 'true'/'false' → DB is consulted.
    expect(_isFeatureEnabled).toHaveBeenCalledWith('ff_foxy_math_pipeline_v1', CTX);
    expect(_loggerInfo).toHaveBeenCalledWith('[Math Pipeline] Enabled via DB');
  });

  it("ENV set to 'TRUE' (wrong case) -> defers to the DB (strict literal match only)", async () => {
    vi.stubEnv('FF_FOXY_MATH_PIPELINE_V1', 'TRUE');
    _isFeatureEnabled.mockResolvedValue(false);

    const enabled = await isMathPipelineEnabled(CTX);

    expect(enabled).toBe(false);
    expect(_isFeatureEnabled).toHaveBeenCalledTimes(1);
  });
});
