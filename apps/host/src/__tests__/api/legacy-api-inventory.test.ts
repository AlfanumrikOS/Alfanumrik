import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface LegacyApiEntry {
  id: string;
  surface: 'rpc' | 'api_route' | 'client_direct_rpc';
  name: string;
  owner: string;
  risk: string;
  status: 'active_compat' | 'cutover_pending' | 'deprecated' | 'blocked';
  deprecationCondition: string;
  plannedAction: string;
  evidence: string[];
}

describe('legacy API inventory (RCA-22)', () => {
  it('tracks quiz legacy RPC/API surfaces with deprecation conditions and evidence', () => {
    expect(existsSync(repoPath('scripts/legacy-api-inventory.json'))).toBe(true);

    const inventory = JSON.parse(
      readFileSync(repoPath('scripts/legacy-api-inventory.json'), 'utf8'),
    ) as { entries: LegacyApiEntry[] };

    const byName = new Map(inventory.entries.map((entry) => [entry.name, entry]));
    for (const required of [
      'submit_quiz_results',
      'submit_quiz_results_safe',
      'submit_quiz_results_rpc',
      'client_direct_submit_quiz_results_v2',
    ]) {
      expect(byName.has(required), `${required} missing from legacy inventory`).toBe(true);
    }

    for (const entry of inventory.entries) {
      expect(entry.id).toMatch(/^RCA-22-/);
      expect(entry.owner).toMatch(/\S/);
      expect(entry.risk).toMatch(/\S/);
      expect(entry.deprecationCondition).toMatch(/\S/);
      expect(entry.plannedAction).toMatch(/\S/);
      expect(entry.evidence.length).toBeGreaterThan(0);

      for (const evidencePath of entry.evidence) {
        expect(existsSync(repoPath(evidencePath)), `${entry.name} evidence missing: ${evidencePath}`).toBe(true);
      }
    }
  });
});
