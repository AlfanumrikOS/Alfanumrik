#!/usr/bin/env -S npx tsx
/**
 * RCA-20 live readiness evidence verifier.
 *
 * This does not run live gates. It verifies the operator-collected evidence
 * bundle that proves those live gates were run for a specific release target.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type LiveReadinessGateStatus = 'pass' | 'fail' | 'not_run' | 'accepted_risk';

export interface LiveReadinessManifestGate {
  id: string;
  label: string;
  rcaItems: string[];
  requiredForBroadLaunch: boolean;
  command: string;
  evidence: string[];
  allowAcceptedRisk?: boolean;
}

export interface LiveReadinessEvidenceManifest {
  generatedAt: string;
  source: string;
  maxEvidenceAgeHours?: number;
  gates: LiveReadinessManifestGate[];
}

export interface LiveReadinessEvidenceGate {
  id: string;
  status: LiveReadinessGateStatus;
  executedAt: string;
  command: string;
  evidence: string[];
  approvalRef?: string;
  notes?: string;
}

export interface LiveReadinessEvidenceBundle {
  releaseCandidate: string;
  targetEnvironment: string;
  collectedAt: string;
  gates: LiveReadinessEvidenceGate[];
}

export interface LiveReadinessEvidenceFailure {
  gateId: string;
  reason: string;
}

export interface LiveReadinessEvidenceComparison {
  ok: boolean;
  checked: number;
  failures: LiveReadinessEvidenceFailure[];
}

export interface LiveReadinessCompareOptions {
  evidenceExists?: (relativePath: string) => boolean;
  now?: Date;
}

export interface LiveReadinessTemplateOptions {
  releaseCandidate?: string;
  targetEnvironment?: string;
  collectedAt?: string;
}

const MANIFEST_REL = 'scripts/live-readiness-evidence-manifest.json';

function repoPath(rel: string): string {
  for (const candidate of [
    resolve(process.cwd(), rel),
    resolve(process.cwd(), '..', rel),
    resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return resolve(process.cwd(), rel);
}

function defaultEvidenceExists(relativePath: string): boolean {
  return existsSync(repoPath(relativePath));
}

function ageHours(executedAt: string, now: Date): number | null {
  const timestamp = new Date(executedAt).getTime();
  if (Number.isNaN(timestamp)) return null;
  return (now.getTime() - timestamp) / (60 * 60 * 1000);
}

function commandMatches(expected: string, actual: string): boolean {
  const expectedTokens = expected
    .split(/\s+/)
    .filter((token) => token.length > 0 && !token.includes('<') && !token.includes('='));
  return expectedTokens.every((token) => actual.includes(token));
}

export function compareLiveReadinessEvidence(
  manifest: LiveReadinessEvidenceManifest,
  bundle: LiveReadinessEvidenceBundle,
  options: LiveReadinessCompareOptions = {},
): LiveReadinessEvidenceComparison {
  const evidenceExists = options.evidenceExists ?? defaultEvidenceExists;
  const now = options.now ?? new Date();
  const maxAgeHours = manifest.maxEvidenceAgeHours;
  const bundleByGate = new Map(bundle.gates.map((gate) => [gate.id, gate]));
  const failures: LiveReadinessEvidenceFailure[] = [];

  for (const gate of manifest.gates.filter((entry) => entry.requiredForBroadLaunch)) {
    const evidence = bundleByGate.get(gate.id);
    if (!evidence) {
      failures.push({ gateId: gate.id, reason: 'missing evidence entry' });
      continue;
    }

    if (evidence.status === 'accepted_risk') {
      if (!gate.allowAcceptedRisk) {
        failures.push({ gateId: gate.id, reason: 'accepted_risk is not allowed for this gate' });
      }
      if (!evidence.approvalRef?.trim()) {
        failures.push({ gateId: gate.id, reason: 'accepted_risk requires approvalRef' });
      }
    } else if (evidence.status !== 'pass') {
      failures.push({ gateId: gate.id, reason: `status is ${evidence.status}, expected pass` });
    }

    if (maxAgeHours !== undefined) {
      const age = ageHours(evidence.executedAt, now);
      if (age === null) {
        failures.push({ gateId: gate.id, reason: `invalid executedAt timestamp: ${evidence.executedAt}` });
      } else if (age < 0) {
        failures.push({ gateId: gate.id, reason: `executedAt is in the future: ${evidence.executedAt}` });
      } else if (age > maxAgeHours) {
        failures.push({
          gateId: gate.id,
          reason: `evidence is ${age.toFixed(1)}h old, exceeding maxEvidenceAgeHours=${maxAgeHours}`,
        });
      }
    }

    if (!evidence.evidence || evidence.evidence.length === 0) {
      failures.push({ gateId: gate.id, reason: 'missing evidence paths' });
    } else {
      for (const evidencePath of evidence.evidence) {
        if (!evidenceExists(evidencePath)) {
          failures.push({ gateId: gate.id, reason: `evidence path does not exist: ${evidencePath}` });
        }
      }
    }

    if (!commandMatches(gate.command, evidence.command)) {
      failures.push({ gateId: gate.id, reason: 'evidence command does not match manifest command' });
    }
  }

  return {
    ok: failures.length === 0,
    checked: manifest.gates.filter((entry) => entry.requiredForBroadLaunch).length,
    failures,
  };
}

export function createLiveReadinessEvidenceTemplate(
  manifest: LiveReadinessEvidenceManifest,
  options: LiveReadinessTemplateOptions = {},
): LiveReadinessEvidenceBundle {
  return {
    releaseCandidate: options.releaseCandidate ?? '<release candidate id>',
    targetEnvironment: options.targetEnvironment ?? '<target environment>',
    collectedAt: options.collectedAt ?? '<ISO timestamp after collecting all live evidence>',
    gates: manifest.gates
      .filter((gate) => gate.requiredForBroadLaunch)
      .map((gate) => {
        const entry: LiveReadinessEvidenceGate = {
          id: gate.id,
          status: 'not_run',
          executedAt: '<ISO timestamp after running the gate>',
          command: gate.command,
          evidence: gate.evidence.map((_, index) => `<path-to-evidence-${index + 1}>`),
          notes: gate.evidence.join('; '),
        };
        if (gate.allowAcceptedRisk) {
          entry.approvalRef = '<approval reference required for accepted_risk>';
        }
        return entry;
      }),
  };
}

function readManifest(): LiveReadinessEvidenceManifest {
  return JSON.parse(readFileSync(repoPath(MANIFEST_REL), 'utf8')) as LiveReadinessEvidenceManifest;
}

function argValue(prefix: string): string | undefined {
  const match = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return match?.slice(prefix.length + 1);
}

function formatComparison(comparison: LiveReadinessEvidenceComparison): string {
  const lines = ['RCA-20 live readiness evidence', '==============================', ''];
  if (comparison.ok) {
    lines.push(`[PASS] ${comparison.checked}/${comparison.checked} broad-launch live gates have acceptable evidence`);
  } else {
    for (const failure of comparison.failures) {
      lines.push(`[FAIL] ${failure.gateId}: ${failure.reason}`);
    }
    lines.push('', `Summary: ${comparison.checked - new Set(comparison.failures.map((failure) => failure.gateId)).size}/${comparison.checked} gates passed.`);
  }
  return lines.join('\n');
}

function main(): void {
  const manifest = readManifest();
  if (process.argv.includes('--print-template')) {
    const template = createLiveReadinessEvidenceTemplate(manifest, {
      releaseCandidate: argValue('--release-candidate'),
      targetEnvironment: argValue('--target-environment'),
      collectedAt: argValue('--collected-at'),
    });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(template, null, 2));
    return;
  }

  const input = argValue('--input');
  if (!input) {
    throw new Error(
      'Missing --input=<evidence-bundle.json>. Use --print-template to create a bundle skeleton, collect operator live-gate evidence, then verify it with this script.',
    );
  }

  const bundle = JSON.parse(readFileSync(resolve(process.cwd(), input), 'utf8')) as LiveReadinessEvidenceBundle;
  const comparison = compareLiveReadinessEvidence(manifest, bundle);
  // eslint-disable-next-line no-console
  console.log(formatComparison(comparison));
  process.exit(comparison.ok ? 0 : 1);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
