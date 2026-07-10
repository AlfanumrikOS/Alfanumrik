import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReleaseGatePlan } from '../../../../scripts/product-readiness-release-gate';
import {
  compareLiveReadinessEvidence,
  createLiveReadinessEvidenceTemplate,
  type LiveReadinessEvidenceBundle,
  type LiveReadinessEvidenceManifest,
} from '../../../../scripts/verify-live-readiness-evidence';

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

describe('live readiness evidence manifest', () => {
  it('tracks every operator-owned release gate from the RCA-20 runner', () => {
    const manifestPath = repoPath('scripts/live-readiness-evidence-manifest.json');
    expect(existsSync(manifestPath), 'missing scripts/live-readiness-evidence-manifest.json').toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LiveReadinessEvidenceManifest;
    const operatorStepIds = buildReleaseGatePlan().operatorSteps.map((step) => step.id).sort();
    const manifestGateIds = manifest.gates.map((gate) => gate.id).sort();

    expect(manifestGateIds).toEqual(operatorStepIds);
    expect(manifest.gates.every((gate) => gate.requiredForBroadLaunch)).toBe(true);
    expect(manifest.gates.every((gate) => gate.evidence.length > 0)).toBe(true);
    expect(manifest.gates.every((gate) => gate.rcaItems.length > 0)).toBe(true);
  });

  it('passes only when every broad-launch live gate has acceptable evidence', () => {
    const manifest: LiveReadinessEvidenceManifest = {
      generatedAt: '2026-07-09',
      source: 'test manifest',
      gates: [
        {
          id: 'tenant-isolation-live',
          label: 'Live tenant isolation smoke',
          rcaItems: ['RCA-19', 'RCA-20'],
          requiredForBroadLaunch: true,
          command: 'npx tsx scripts/verify-live-tenant-isolation-smoke.ts',
          evidence: ['tenant isolation pass output'],
        },
        {
          id: 'historical-xp-target-db',
          label: 'Historical XP product decision',
          rcaItems: ['RCA-06'],
          requiredForBroadLaunch: true,
          command: 'run scripts/historical-xp-inflation-quantification.sql',
          evidence: ['CEO clamp/backfill decision'],
          allowAcceptedRisk: true,
        },
      ],
    };
    const bundle: LiveReadinessEvidenceBundle = {
      releaseCandidate: 'RC-2026-07-09',
      targetEnvironment: 'staging',
      collectedAt: '2026-07-09T12:00:00.000Z',
      gates: [
        {
          id: 'tenant-isolation-live',
          status: 'pass',
          executedAt: '2026-07-09T11:00:00.000Z',
          command: 'LIVE_TENANT_SMOKE_BASE_URL=https://staging.example npx tsx scripts/verify-live-tenant-isolation-smoke.ts',
          evidence: ['docs/audit/tenant-smoke.md'],
        },
        {
          id: 'historical-xp-target-db',
          status: 'accepted_risk',
          executedAt: '2026-07-09T11:30:00.000Z',
          command: 'run scripts/historical-xp-inflation-quantification.sql',
          evidence: ['docs/audit/historical-xp.md'],
          approvalRef: 'CEO-APPROVAL-2026-07-09',
        },
      ],
    };

    const result = compareLiveReadinessEvidence(manifest, bundle, {
      evidenceExists: () => true,
      now: new Date('2026-07-09T13:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
    expect(result.failures).toEqual([]);
  });

  it('generates an operator-fillable evidence bundle template from the manifest', () => {
    const manifestPath = repoPath('scripts/live-readiness-evidence-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LiveReadinessEvidenceManifest;

    const template = createLiveReadinessEvidenceTemplate(manifest, {
      releaseCandidate: 'RC-2026-07-09',
      targetEnvironment: 'production',
      collectedAt: '2026-07-09T12:00:00.000Z',
    });

    expect(template.releaseCandidate).toBe('RC-2026-07-09');
    expect(template.targetEnvironment).toBe('production');
    expect(template.collectedAt).toBe('2026-07-09T12:00:00.000Z');
    expect(template.gates).toHaveLength(manifest.gates.length);

    const templateByGate = new Map(template.gates.map((gate) => [gate.id, gate]));
    for (const gate of manifest.gates) {
      const entry = templateByGate.get(gate.id);
      expect(entry, `${gate.id} missing from template`).toBeDefined();
      expect(entry?.status).toBe('not_run');
      expect(entry?.executedAt).toBe('<ISO timestamp after running the gate>');
      expect(entry?.command).toBe(gate.command);
      expect(entry?.evidence).toEqual(gate.evidence.map((_, index) => `<path-to-evidence-${index + 1}>`));
      if (gate.allowAcceptedRisk) {
        expect(entry?.approvalRef).toBe('<approval reference required for accepted_risk>');
      } else {
        expect(entry).not.toHaveProperty('approvalRef');
      }
    }
  });

  it('fails on missing, failed, stale, unapproved, or evidence-less live gates', () => {
    const manifest: LiveReadinessEvidenceManifest = {
      generatedAt: '2026-07-09',
      source: 'test manifest',
      maxEvidenceAgeHours: 24,
      gates: [
        {
          id: 'tenant-isolation-live',
          label: 'Live tenant isolation smoke',
          rcaItems: ['RCA-19', 'RCA-20'],
          requiredForBroadLaunch: true,
          command: 'npx tsx scripts/verify-live-tenant-isolation-smoke.ts',
          evidence: ['tenant isolation pass output'],
        },
        {
          id: 'feature-flags-production',
          label: 'Production feature flag DB comparison',
          rcaItems: ['RCA-24'],
          requiredForBroadLaunch: true,
          command: 'npx tsx scripts/verify-feature-flag-matrix.ts --env=production',
          evidence: ['feature flag JSON output'],
        },
        {
          id: 'historical-xp-target-db',
          label: 'Historical XP product decision',
          rcaItems: ['RCA-06'],
          requiredForBroadLaunch: true,
          command: 'run scripts/historical-xp-inflation-quantification.sql',
          evidence: ['CEO clamp/backfill decision'],
          allowAcceptedRisk: true,
        },
      ],
    };
    const bundle: LiveReadinessEvidenceBundle = {
      releaseCandidate: 'RC-2026-07-09',
      targetEnvironment: 'production',
      collectedAt: '2026-07-09T12:00:00.000Z',
      gates: [
        {
          id: 'tenant-isolation-live',
          status: 'pass',
          executedAt: '2026-07-07T11:00:00.000Z',
          command: 'npx tsx scripts/verify-live-tenant-isolation-smoke.ts',
          evidence: ['docs/audit/missing.md'],
        },
        {
          id: 'feature-flags-production',
          status: 'fail',
          executedAt: '2026-07-09T11:00:00.000Z',
          command: 'npx tsx scripts/verify-feature-flag-matrix.ts --env=production',
          evidence: [],
        },
        {
          id: 'historical-xp-target-db',
          status: 'accepted_risk',
          executedAt: '2026-07-09T11:00:00.000Z',
          command: 'run scripts/historical-xp-inflation-quantification.sql',
          evidence: ['docs/audit/historical-xp.md'],
        },
      ],
    };

    const result = compareLiveReadinessEvidence(manifest, bundle, {
      evidenceExists: (rel) => rel === 'docs/audit/historical-xp.md',
      now: new Date('2026-07-09T13:00:00.000Z'),
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        gateId: 'tenant-isolation-live',
        reason: 'evidence is 50.0h old, exceeding maxEvidenceAgeHours=24',
      },
      {
        gateId: 'tenant-isolation-live',
        reason: 'evidence path does not exist: docs/audit/missing.md',
      },
      {
        gateId: 'feature-flags-production',
        reason: 'status is fail, expected pass',
      },
      {
        gateId: 'feature-flags-production',
        reason: 'missing evidence paths',
      },
      {
        gateId: 'historical-xp-target-db',
        reason: 'accepted_risk requires approvalRef',
      },
    ]);
  });
});
