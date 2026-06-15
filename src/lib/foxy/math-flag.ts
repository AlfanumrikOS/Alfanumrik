/**
 * ALFANUMRIK — Foxy Math Pipeline: ENV>DB>default-false flag resolver.
 *
 * Resolves whether the Foxy 3-agent math-correctness pipeline
 * (`ff_foxy_math_pipeline_v1`) is enabled for a given request, with a strict
 * priority order:
 *
 *   1. process.env.FF_FOXY_MATH_PIPELINE_V1 === 'true'  -> ON  (ENV override)
 *   2. process.env.FF_FOXY_MATH_PIPELINE_V1 === 'false' -> OFF (ENV override)
 *   3. unset / any other value                          -> fall back to the DB
 *      feature flag (`ff_foxy_math_pipeline_v1`), which itself defaults OFF when
 *      absent from the `feature_flags` table.
 *
 * Why an ENV override layered over the existing DB flag: the DB flag stays the
 * authoritative rollout control (super-admin console + per-user rollout), but a
 * deploy-time ENV switch lets us flip the math pipeline on/off for an entire
 * environment (e.g. localhost dev, a canary deploy) without touching the DB.
 * The DB flag remains the fallback when the ENV var is unset.
 *
 * P13: no PII is ever logged here — only the enable/disable decision + its
 * source. The (role, userId) context is forwarded to the DB flag evaluator for
 * deterministic per-user rollout but never appears in a log line.
 *
 * Server-only (reads process.env + the service-role DB flag loader). Owner:
 * backend. Reviewer: ops (flag operational behavior).
 */

import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';

/**
 * The DB feature-flag name that backs the math pipeline. Kept in sync with
 * FOXY_MATH_PIPELINE_FLAGS.V1 in src/lib/feature-flags.ts and the seed
 * migration 20260619000800_seed_ff_foxy_math_pipeline_v1.sql.
 */
const DB_FLAG_NAME = 'ff_foxy_math_pipeline_v1';

/**
 * The deploy-time ENV override variable. When set to the literal string
 * 'true' or 'false', it WINS over the DB flag. Any other value (including
 * unset) defers to the DB flag.
 */
const ENV_VAR_NAME = 'FF_FOXY_MATH_PIPELINE_V1';

/**
 * Resolve whether the Foxy math pipeline is enabled for this request.
 *
 * Priority: ENV ('true'|'false') > DB flag (`ff_foxy_math_pipeline_v1`) >
 * default false. Never throws — a DB-evaluation failure inside isFeatureEnabled
 * already resolves to false (the flag's documented default).
 *
 * @param ctx - role/userId forwarded to the DB flag evaluator for deterministic
 *              per-user rollout. NOT logged (P13).
 */
export async function isMathPipelineEnabled(ctx: {
  role?: string;
  userId?: string;
}): Promise<boolean> {
  const envValue = process.env[ENV_VAR_NAME];

  if (envValue === 'true') {
    logger.info('[Math Pipeline] Enabled via ENV');
    return true;
  }

  if (envValue === 'false') {
    logger.info('[Math Pipeline] Disabled');
    return false;
  }

  // ENV unset / any other value -> defer to the DB flag (the existing
  // authoritative rollout control). isFeatureEnabled returns false for an
  // absent/disabled flag, so default-false is preserved.
  const dbEnabled = await isFeatureEnabled(DB_FLAG_NAME, ctx);
  if (dbEnabled) {
    logger.info('[Math Pipeline] Enabled via DB');
  } else {
    logger.info('[Math Pipeline] Disabled');
  }
  return dbEnabled;
}

/**
 * The DB feature-flag name that backs the Foxy curriculum guard (the STEM-only
 * HARD out-of-grade pre-gate, CEO Decision A). SEPARATE from the math-pipeline
 * flag so it can ramp independently. Owned by the architect in src/lib/
 * feature-flags.ts + the seed migration.
 */
const CURRICULUM_GUARD_DB_FLAG_NAME = 'ff_foxy_curriculum_guard_v1';

/**
 * The deploy-time ENV override variable for the curriculum guard. When set to
 * the literal string 'true' or 'false', it WINS over the DB flag. Any other
 * value (including unset) defers to the DB flag.
 */
const CURRICULUM_GUARD_ENV_VAR_NAME = 'FF_FOXY_CURRICULUM_GUARD_V1';

/**
 * Resolve whether the Foxy curriculum guard (STEM-only HARD out-of-grade
 * pre-gate) is enabled for this request.
 *
 * Mirrors isMathPipelineEnabled EXACTLY but for the SEPARATE
 * `ff_foxy_curriculum_guard_v1` flag. Priority: ENV ('true'|'false') > DB flag >
 * default false. Never throws — a DB-evaluation failure inside isFeatureEnabled
 * already resolves to false (the flag's documented default).
 *
 * @param ctx - role/userId forwarded to the DB flag evaluator for deterministic
 *              per-user rollout. NOT logged (P13).
 */
export async function isCurriculumGuardEnabled(ctx: {
  role?: string;
  userId?: string;
}): Promise<boolean> {
  const envValue = process.env[CURRICULUM_GUARD_ENV_VAR_NAME];

  if (envValue === 'true') {
    logger.info('[Curriculum Guard] Enabled via ENV');
    return true;
  }

  if (envValue === 'false') {
    logger.info('[Curriculum Guard] Disabled');
    return false;
  }

  // ENV unset / any other value -> defer to the DB flag (the authoritative
  // rollout control). isFeatureEnabled returns false for an absent/disabled
  // flag, so default-false is preserved.
  const dbEnabled = await isFeatureEnabled(CURRICULUM_GUARD_DB_FLAG_NAME, ctx);
  if (dbEnabled) {
    logger.info('[Curriculum Guard] Enabled via DB');
  } else {
    logger.info('[Curriculum Guard] Disabled');
  }
  return dbEnabled;
}
