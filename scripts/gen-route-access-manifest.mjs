#!/usr/bin/env node
/**
 * Generate the API route access manifest used by the RCA-02 guard.
 *
 * The manifest is intentionally conservative: route ownership and access are
 * derived from stable path prefixes, while service-role/admin-client usage is
 * detected from source text and must carry a justification until XC-3 removes
 * or narrows those imports.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const API_ROOT = join(REPO_ROOT, 'apps', 'host', 'src', 'app', 'api');
const OUT_PATH = join(REPO_ROOT, 'scripts', 'route-access-manifest.json');

function walkRouteFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkRouteFiles(full));
    } else if (/^route\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function routePathFor(file) {
  const rel = relative(API_ROOT, file).replace(/\\/g, '/');
  return `/api/${rel.replace(/\/route\.tsx?$/, '')}`;
}

function sourceFor(file) {
  return readFileSync(file, 'utf8');
}

function usesServiceRole(source) {
  return /@alfanumrik\/lib\/supabase-admin|\bsupabaseAdmin\b|\bgetSupabaseAdmin\s*\(/.test(source);
}

function accessFor(path, source) {
  if (path === '/api/health' || path === '/api/v1/health') return 'system';
  if (path.startsWith('/api/cron/') || path.startsWith('/api/internal/cron/')) return 'cron';
  if (/webhook|whatsapp/.test(path)) return 'webhook';
  if (path.startsWith('/api/public/v1/')) return path.endsWith('/openapi') ? 'public' : 'public_api';
  if (path.startsWith('/api/feature-flags/')) return 'public';
  if (path.startsWith('/api/alfabot')) return 'public';
  if (path === '/api/school-config' || path.startsWith('/api/school-config/')) return 'public';
  if (path === '/api/tenant/config') return 'public';
  if (path === '/api/client-error' || path === '/api/error-report') return 'public';
  if (path === '/api/schools/trial' || path === '/api/schools/claim-admin') return 'public';
  if (path.startsWith('/api/auth/')) return 'auth';
  if (path.startsWith('/api/oauth/')) return 'oauth';
  if (path.startsWith('/api/school-admin/')) return 'school_admin';
  if (path.startsWith('/api/super-admin/')) return 'super_admin';
  if (path.startsWith('/api/internal/admin/')) return 'internal_admin';
  if (path.startsWith('/api/parent/') || path.startsWith('/api/v2/parent/')) return 'parent';
  if (path.startsWith('/api/teacher/')) return 'teacher';
  if (path.startsWith('/api/student/') || path.startsWith('/api/students/') || path.startsWith('/api/v2/student/')) return 'student';
  if (path.startsWith('/api/support/')) return 'support';
  if (path.startsWith('/api/payments/') || path.startsWith('/api/billing/')) return 'billing';
  if (/\bauthorizePublicApiKey\s*\(/.test(source)) return 'public_api';
  if (/\bauthorizeSchoolAdmin\s*\(/.test(source)) return 'school_admin';
  if (/\bauthorizeAdmin\s*\(|\brequireAdminSecret\s*\(/.test(source)) return 'super_admin';
  return 'auth';
}

function ownerFor(path, access) {
  if (access === 'cron') return 'platform-ops';
  if (access === 'webhook') return 'integrations-backend';
  if (access === 'public_api') return 'public-api-backend';
  if (access === 'school_admin') return 'school-admin-backend';
  if (access === 'super_admin' || access === 'internal_admin') return 'admin-platform';
  if (access === 'parent') return 'parent-portal-backend';
  if (access === 'teacher') return 'teacher-backend';
  if (access === 'student') return 'student-learning-backend';
  if (access === 'billing') return 'billing-backend';
  if (access === 'support') return 'support-backend';
  if (access === 'public') return 'growth-platform';
  if (path.includes('/quiz')) return 'assessment-backend';
  if (path.includes('/foxy') || path.includes('/tutor') || path.includes('/grounding')) return 'ai-learning-backend';
  return 'core-backend';
}

function rationaleFor(access) {
  const phrase = {
    public: 'Public-by-design endpoint; source comments or path semantics document why anonymous access is expected.',
    auth: 'Authenticated user endpoint; route must perform its own session or request authorization before protected work.',
    student: 'Student-owned endpoint; access must derive from the authenticated student/session context.',
    parent: 'Parent portal endpoint; access must derive from guardian session and child-link authorization.',
    teacher: 'Teacher endpoint; access must derive from teacher session and class/student boundary checks.',
    school_admin: 'School-admin endpoint; access must derive from school-admin membership and permission checks.',
    super_admin: 'Super-admin endpoint; access must derive from admin session/RBAC or explicit admin secret.',
    internal_admin: 'Internal platform-admin endpoint; access must derive from internal admin secret/session controls.',
    cron: 'Scheduled system endpoint; access must be protected by cron secret or platform scheduler controls.',
    webhook: 'Webhook endpoint; access must be protected by provider signature, webhook secret, or equivalent verification.',
    public_api: 'Public API endpoint; access must derive from scoped school API keys, never request-supplied tenant IDs.',
    support: 'Support endpoint; access must derive from support session, ticket ownership, or public intake constraints.',
    oauth: 'OAuth endpoint; access must derive from OAuth state/token validation.',
    billing: 'Billing endpoint; access must derive from user/session ownership or provider webhook verification.',
    system: 'System health/config endpoint; public or platform access is intentionally constrained to non-PII status/config data.',
  }[access];
  return phrase;
}

function main() {
  if (!existsSync(API_ROOT)) throw new Error(`missing API root: ${API_ROOT}`);

  const routes = walkRouteFiles(API_ROOT)
    .map((file) => {
      const source = sourceFor(file);
      const path = routePathFor(file);
      const access = accessFor(path, source);
      const entry = {
        path,
        file: relative(REPO_ROOT, file).replace(/\\/g, '/'),
        access,
        owner: ownerFor(path, access),
        rationale: rationaleFor(access),
      };
      if (usesServiceRole(source)) {
        entry.serviceRoleUse =
          'RCA-01/XC-3 compatibility: route imports the service-role/admin client; retain only with route-level authorization and tenant checks until migrated to narrower RLS-scoped access.';
      }
      return entry;
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  mkdirSync(join(REPO_ROOT, 'scripts'), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        source: 'apps/host/src/app/api/**/route.ts(x)',
        routeCount: routes.length,
        routes,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  process.stdout.write(`route access manifest generated with ${routes.length} routes -> ${relative(REPO_ROOT, OUT_PATH)}\n`);
}

main();
