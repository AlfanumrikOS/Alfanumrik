import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

type BatchStatus =
  | 'migrate_first'
  | 'partially_migrated_scoped_rpc'
  | 'partially_migrated_rls_scoped'
  | 'migrated_scoped_rpc'
  | 'migrated_rls_scoped'
  | 'already_rls_scoped'
  | 'service_role_exception';
type MigrationTarget = 'rls_scoped_client' | 'canonical_domain_helper' | 'service_role_exception';

interface RouteAccessEntry {
  path: string;
  file: string;
  serviceRoleUse?: string;
}

interface Xc3BatchEntry {
  id: string;
  route: string;
  file: string;
  sensitivity: 'critical' | 'high';
  status: BatchStatus;
  migrationTarget: MigrationTarget;
  owner: string;
  rationale: string;
  evidence: string[];
}

interface Xc3BatchManifest {
  rcaItem: 'RCA-01';
  totalAdminClientRoutesPinned: number;
  objective: string;
  entries: Xc3BatchEntry[];
}

interface AdminClientAllowlist {
  count: number;
  routes: string[];
}

const repoRoot = path.resolve(__dirname, '../../../..');
const repoPath = (relativePath: string) => path.join(repoRoot, relativePath);

const requiredIds = [
  'parent-child-export',
  'parent-child-erasure',
  'parent-child-erasure-status',
  'parent-report',
  'school-admin-students',
  'teacher-join-class',
  'super-admin-reports',
  'parent-child-chat-rls-pattern',
  'parent-invite-link-consent-messages',
] as const;

function usesServiceRole(source: string): boolean {
  return /@alfanumrik\/lib\/supabase-admin|\bsupabaseAdmin\b|\bgetSupabaseAdmin\s*\(/.test(source);
}

describe('XC-3 service-role migration batch manifest (RCA-01)', () => {
  it('prioritizes high-sensitivity service-role routes and pins the RLS-scoped pattern', () => {
    const manifestPath = repoPath('scripts/xc3-service-role-migration-batch.json');
    expect(existsSync(manifestPath), 'missing scripts/xc3-service-role-migration-batch.json').toBe(true);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Xc3BatchManifest;
    const allowlist = JSON.parse(
      readFileSync(repoPath('scripts/admin-client-allowlist.json'), 'utf8'),
    ) as AdminClientAllowlist;
    const accessManifest = JSON.parse(
      readFileSync(repoPath('scripts/route-access-manifest.json'), 'utf8'),
    ) as { routes: RouteAccessEntry[] };

    expect(manifest.rcaItem).toBe('RCA-01');
    expect(manifest.totalAdminClientRoutesPinned).toBe(allowlist.count);
    expect(manifest.objective).toContain('high-sensitivity');

    const ids = manifest.entries.map((entry) => entry.id).sort();
    expect(ids).toEqual([...requiredIds].sort());

    const routeAccessByPath = new Map(accessManifest.routes.map((entry) => [entry.path, entry]));

    for (const entry of manifest.entries) {
      const routeAccess = routeAccessByPath.get(entry.route);
      expect(routeAccess, `${entry.route} missing from route access manifest`).toBeDefined();
      expect(routeAccess?.file).toBe(entry.file);
      expect(entry.owner).toMatch(/\S/);
      expect(entry.rationale).toMatch(/\S/);
      expect(['critical', 'high']).toContain(entry.sensitivity);

      const sourcePath = repoPath(entry.file);
      expect(existsSync(sourcePath), `${entry.id} source file does not exist`).toBe(true);
    const source = readFileSync(sourcePath, 'utf8');
    for (const snippet of entry.evidence) {
      expect(source, `${entry.id} missing evidence: ${snippet}`).toContain(snippet);
    }

      if (entry.status === 'migrate_first') {
        expect(
          routeAccess?.serviceRoleUse,
          `${entry.route} is a migration candidate but lacks service-role justification`,
        ).toMatch(/\S/);
        expect(usesServiceRole(source), `${entry.route} should currently use service-role`).toBe(true);
        expect(entry.migrationTarget).not.toBe('service_role_exception');
      }

      if (entry.status === 'partially_migrated_scoped_rpc') {
        expect(
          routeAccess?.serviceRoleUse,
          `${entry.route} is still a partial migration and must keep its service-role exception documented`,
        ).toMatch(/\S/);
        expect(usesServiceRole(source), `${entry.route} still uses service-role for a documented side effect`).toBe(true);
        expect(entry.migrationTarget).toBe('canonical_domain_helper');
      }

      if (entry.status === 'partially_migrated_rls_scoped') {
        expect(
          routeAccess?.serviceRoleUse,
          `${entry.route} is still a partial migration and must keep its service-role exception documented`,
        ).toMatch(/\S/);
        expect(usesServiceRole(source), `${entry.route} still uses service-role for unmigrated branches`).toBe(true);
        expect(entry.migrationTarget).toBe('rls_scoped_client');
      }

      if (entry.status === 'migrated_scoped_rpc') {
        expect(
          routeAccess?.serviceRoleUse,
          `${entry.route} is migrated and should not keep a service-role exception`,
        ).toBeUndefined();
        expect(usesServiceRole(source), `${entry.route} should not use route-level service-role`).toBe(false);
        expect(entry.migrationTarget).toBe('canonical_domain_helper');
      }

      if (entry.status === 'migrated_rls_scoped') {
        expect(
          routeAccess?.serviceRoleUse,
          `${entry.route} is migrated and should not keep a service-role exception`,
        ).toBeUndefined();
        expect(usesServiceRole(source), `${entry.route} should not use route-level service-role`).toBe(false);
        expect(entry.migrationTarget).toBe('rls_scoped_client');
      }

      if (entry.status === 'already_rls_scoped') {
        expect(usesServiceRole(source), `${entry.route} should be an RLS-scoped pattern`).toBe(false);
        expect(entry.migrationTarget).toBe('rls_scoped_client');
      }
    }
  });
});
