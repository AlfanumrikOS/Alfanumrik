/**
 * ALFANUMRIK -- Comprehensive Environment Variable Validation
 *
 * Validates all required environment variables grouped by service.
 * Returns a validation result (does NOT throw) for flexible error handling.
 *
 * Usage:
 *   import { validateEnv } from '@/lib/env-validation';
 *   const result = validateEnv();
 *   if (!result.valid) {
 *     console.error('Missing env vars:', result.missing);
 *   }
 *
 * SECURITY: SUPABASE_SERVICE_ROLE_KEY must NEVER appear in a NEXT_PUBLIC_ variable.
 */

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Environment variable definitions grouped by service.
 * Each entry specifies the variable name, whether it is required,
 * and which service group it belongs to.
 */
export interface EnvVarDefinition {
  name: string;
  required: boolean;
  group: string;
}

export const ENV_DEFINITIONS: EnvVarDefinition[] = [
  // Supabase
  { name: 'NEXT_PUBLIC_SUPABASE_URL', required: true, group: 'Supabase' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', required: true, group: 'Supabase' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true, group: 'Supabase' },

  // Razorpay
  { name: 'RAZORPAY_KEY_ID', required: true, group: 'Razorpay' },
  { name: 'RAZORPAY_KEY_SECRET', required: true, group: 'Razorpay' },
  { name: 'RAZORPAY_WEBHOOK_SECRET', required: true, group: 'Razorpay' },

  // Redis (optional -- in-memory fallback exists)
  { name: 'UPSTASH_REDIS_REST_URL', required: false, group: 'Redis' },
  { name: 'UPSTASH_REDIS_REST_TOKEN', required: false, group: 'Redis' },

  // Sentry (optional)
  { name: 'NEXT_PUBLIC_SENTRY_DSN', required: false, group: 'Sentry' },

  // Admin
  { name: 'SUPER_ADMIN_SECRET', required: true, group: 'Admin' },
];

/**
 * Validates all environment variables defined in ENV_DEFINITIONS.
 *
 * - Required vars that are missing are added to `missing` and cause `valid: false`.
 * - Optional vars that are missing are added to `warnings`.
 * - Does NOT throw; returns a structured result for the caller to handle.
 *
 * @param envSource - Object to read env vars from (defaults to process.env).
 *                    Useful for testing without mutating process.env.
 */
export function validateEnv(
  envSource: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const def of ENV_DEFINITIONS) {
    const value = envSource[def.name];
    const isSet = value !== undefined && value !== '';

    if (!isSet) {
      if (def.required) {
        missing.push(def.name);
      } else {
        warnings.push(
          `${def.name} (${def.group}) is not set -- using fallback or disabled`,
        );
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Returns environment variable definitions grouped by service name.
 */
export function getEnvGroups(): Record<string, EnvVarDefinition[]> {
  const groups: Record<string, EnvVarDefinition[]> = {};
  for (const def of ENV_DEFINITIONS) {
    if (!groups[def.group]) {
      groups[def.group] = [];
    }
    groups[def.group].push(def);
  }
  return groups;
}
