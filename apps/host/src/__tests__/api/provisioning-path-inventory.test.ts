import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoPath(rel: string): string {
  const fromHost = resolve(process.cwd(), '..', '..', rel);
  if (existsSync(fromHost)) return fromHost;
  return resolve(process.cwd(), rel);
}

interface ProvisioningPathEntry {
  id: string;
  surface: 'super_admin' | 'public_claim' | 'school_admin';
  route: string;
  owner: string;
  authGate: string;
  canonicalHelper: string;
  writes: string[];
  risk: string;
  status: 'canonical' | 'repair' | 'compat' | 'adjacent';
  ao3FollowUp: string;
  evidence: string[];
}

describe('provisioning path inventory (RCA-10 / AO-3)', () => {
  it('tracks institution-admin and school provisioning paths with auth gates and canonicalization notes', () => {
    expect(existsSync(repoPath('scripts/provisioning-path-inventory.json'))).toBe(true);

    const inventory = JSON.parse(
      readFileSync(repoPath('scripts/provisioning-path-inventory.json'), 'utf8'),
    ) as { entries: ProvisioningPathEntry[] };

    const required = [
      'super-admin-school-provision',
      'super-admin-bulk-onboard',
      'super-admin-admin-repair',
      'public-school-trial',
      'public-school-claim-admin',
      'school-admin-staff-invite',
      'school-admin-invite-codes',
    ];
    const ids = new Set(inventory.entries.map((entry) => entry.id));
    for (const id of required) {
      expect(ids.has(id), `${id} missing from provisioning path inventory`).toBe(true);
    }

    for (const entry of inventory.entries) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.owner).toMatch(/\S/);
      expect(entry.authGate).toMatch(/\S/);
      expect(entry.canonicalHelper).toMatch(/\S/);
      expect(entry.risk).toMatch(/\S/);
      expect(entry.ao3FollowUp).toMatch(/\S/);
      expect(entry.writes.length).toBeGreaterThan(0);
      expect(existsSync(repoPath(entry.route)), `${entry.id} route missing: ${entry.route}`).toBe(true);

      const routeSource = readFileSync(repoPath(entry.route), 'utf8');
      for (const snippet of entry.evidence) {
        expect(routeSource, `${entry.id} missing evidence: ${snippet}`).toContain(snippet);
      }
    }
  });
});
