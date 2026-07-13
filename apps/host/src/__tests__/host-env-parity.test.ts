import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENV_DEFINITIONS } from '@alfanumrik/lib/env-validation';

/**
 * DUAL-HOST ENV PARITY (Vercel ⟷ AWS ECS Fargate) — testing-strategy gap 6.
 *
 * WHY THIS EXISTS
 * ===============
 * Alfanumrik runs two live compute hosts against the same Supabase project
 * (operating instructions §3a). Vercel injects env vars from its dashboard;
 * AWS Fargate requires each one DECLARED in aws/task-definition.json
 * (environment or secrets). The classic dual-host divergence: a new REQUIRED
 * server env var is added to the app's validation schema and set on Vercel,
 * but nobody updates the AWS task-def — so the AWS host boots missing it and
 * the failure only shows for requests that host served. "A fix shipped to one
 * host does nothing if the report came from the other."
 *
 * THE INVARIANT PINNED
 * ====================
 * Every REQUIRED, server-side (non-NEXT_PUBLIC_) var in the canonical
 * `ENV_DEFINITIONS` schema must be declared in the AWS task definition. This
 * runs in the normal unit lane (no network) and imports the REAL ENV_DEFINITIONS
 * so it cannot drift from the app's own source of truth.
 *
 * SCOPE NOTES
 * ===========
 *  - NEXT_PUBLIC_* vars are inlined at BUILD time (into the Next bundle), not
 *    injected as runtime container env, so they are validated at build and
 *    excluded from the runtime task-def comparison here (reported informationally).
 *  - Direction is app-schema ⊆ AWS-declared. The reverse (AWS declares many
 *    Edge-Function/runtime secrets not in ENV_DEFINITIONS — ANTHROPIC_API_KEY,
 *    CRON_SECRET, VOYAGE_API_KEY, …) is NOT failed here: ENV_DEFINITIONS is a
 *    known-incomplete subset (see the documented gap in the last test). Vercel
 *    dashboard values live outside the repo and can't be asserted from CI.
 */

function resolveRepo(rel: string): string | null {
  for (const c of [resolve(process.cwd(), rel), resolve(process.cwd(), '..', rel), resolve(process.cwd(), '..', '..', rel)]) {
    if (existsSync(c)) return c;
  }
  return null;
}

const TASK_DEF_PATH = resolveRepo('aws/task-definition.json');

function awsDeclaredEnvNames(): Set<string> {
  const raw = readFileSync(TASK_DEF_PATH!, 'utf8');
  const def = JSON.parse(raw) as {
    containerDefinitions?: Array<{
      environment?: Array<{ name: string }>;
      secrets?: Array<{ name: string }>;
    }>;
  };
  const names = new Set<string>();
  for (const c of def.containerDefinitions ?? []) {
    for (const e of c.environment ?? []) names.add(e.name);
    for (const s of c.secrets ?? []) names.add(s.name);
  }
  return names;
}

describe('dual-host env parity (Vercel ⟷ AWS)', () => {
  it('precondition: aws/task-definition.json resolves and declares env', () => {
    expect(TASK_DEF_PATH, 'could not locate aws/task-definition.json from cwd').not.toBeNull();
    expect(awsDeclaredEnvNames().size).toBeGreaterThan(0);
  });

  it('every REQUIRED server (non-NEXT_PUBLIC) env var is declared in the AWS task definition', () => {
    const aws = awsDeclaredEnvNames();
    const requiredServer = ENV_DEFINITIONS.filter(
      (d) => d.required && !d.name.startsWith('NEXT_PUBLIC_'),
    ).map((d) => d.name);

    // Non-vacuity: the schema must actually contain required server vars.
    expect(requiredServer.length).toBeGreaterThan(0);

    const missingOnAws = requiredServer.filter((name) => !aws.has(name));
    expect(
      missingOnAws,
      `Required server env var(s) missing from aws/task-definition.json — the AWS host would boot without them ` +
        `while Vercel has them (dual-host divergence, §3a). Add to the task-def's secrets/environment: ${missingOnAws.join(', ')}`,
    ).toEqual([]);
  });

  it('DOCUMENTED GAP: ENV_DEFINITIONS is a known-incomplete manifest (informational, non-failing)', () => {
    // The AWS task-def declares runtime/Edge secrets the validation schema does
    // NOT list (e.g. ANTHROPIC_API_KEY, CRON_SECRET, VOYAGE_API_KEY). This test
    // records that gap without failing: extending ENV_DEFINITIONS to cover them
    // is a separate hardening (so a missing ANTHROPIC_API_KEY is caught at boot,
    // not at first Foxy call). Kept visible so the gap isn't forgotten.
    const aws = awsDeclaredEnvNames();
    const known = new Set(ENV_DEFINITIONS.map((d) => d.name));
    const awsOnly = [...aws].filter((n) => !known.has(n)).sort();
    // Assert the shape of the gap, not its emptiness — this documents reality.
    expect(Array.isArray(awsOnly)).toBe(true);
    if (awsOnly.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[host-env-parity] ${awsOnly.length} AWS-declared secret(s) not in ENV_DEFINITIONS ` +
          `(candidates for boot-time validation): ${awsOnly.join(', ')}`,
      );
    }
  });
});
