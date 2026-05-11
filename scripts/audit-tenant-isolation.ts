/**
 * ALFANUMRIK — Tenant Isolation Static Audit (Phase A diagnostic)
 *
 * Walks every `src/app/api/**\/route.ts` file and grades it on three
 * heuristic invariants for multi-tenant safety:
 *
 *   1. AUTHENTICATION   — does the route assert who is calling?
 *      (calls authorizeRequest / requireAuth / getServerSession /
 *       checks Supabase cookies / school admin secret / etc.)
 *
 *   2. TENANT SCOPING   — does the route filter DB reads/writes by
 *      tenant context? (.eq('school_id', …), .match({ school_id }),
 *      tenantFromHeaders, x-school-id usage, RLS-via-anon-key)
 *
 *   3. PUBLIC-BY-DESIGN — is the route flagged as deliberately public?
 *      (e.g. `/api/health`, `/api/school-config`, `/api/tenant/config`)
 *
 * Routes are placed into one of four buckets:
 *
 *   ✅ SAFE              — has auth + tenant scoping (or is public-by-design)
 *   🟡 REVIEW            — has auth but no obvious tenant scoping;
 *                          could be safe (RLS-trusted, single-tenant data)
 *                          or could be a leak. Flag for human review.
 *   🟠 NO_TENANT_SCOPING — has auth but performs DB ops without any
 *                          tenant-aware filter visible in the route file.
 *   🔴 NO_AUTH           — no auth assertion AND not flagged public.
 *                          Highest priority to investigate.
 *
 * IMPORTANT — this is a HEURISTIC. False positives + false negatives
 * are expected:
 *   - A route that does its auth check inside a helper imported from
 *     elsewhere will look "no_auth" even if it's safe.
 *   - A route that filters by school_id inside an RPC call (not visible
 *     in the route source) will look "no_tenant_scoping".
 *   - A route that's safe because RLS on the underlying table forces
 *     scoping at the DB layer will look "no_tenant_scoping" too.
 * Use the report as a triage queue, not a verdict.
 *
 * Run:
 *   npx tsx scripts/audit-tenant-isolation.ts
 *   npx tsx scripts/audit-tenant-isolation.ts --json     # machine-readable
 *   npx tsx scripts/audit-tenant-isolation.ts --out docs/audits/<file>.md
 *
 * Default output path: docs/audits/<YYYY-MM-DD>-tenant-isolation.md
 *
 * No env vars required. No DB access. Pure source-code static scan.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

// ─── CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const outIdx = args.indexOf('--out');
const customOut = outIdx >= 0 ? args[outIdx + 1] : null;

// ─── Roots & patterns ───────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..');
const API_ROOT = path.join(REPO_ROOT, 'src', 'app', 'api');

const AUTH_PATTERNS: ReadonlyArray<RegExp> = [
  // Direct auth helper calls
  /\bauthorizeRequest\s*\(/,
  /\bauthorizeAdmin\s*\(/,
  /\bauthorizeSchoolAdmin\s*\(/,
  /\bauthorizeSchoolApi\s*\(/,
  /\bauthorizeSuperAdmin\s*\(/,
  /\brequireAuth\s*\(/,
  /\bgetServerSession\s*\(/,
  /\bgetSchoolAdmin\s*\(/,
  /\brequireSchoolAdmin\s*\(/,
  /\brequireSuperAdmin\s*\(/,
  /\brequireAdminSecret\s*\(/,
  /\bauthenticateApiKey\s*\(/,
  /\bvalidateAdminSecret\s*\(/,
  /\bverifyCronSecret\s*\(/,
  /\bauthenticateRequest\s*\(/,
  /\bvalidateApiKey\s*\(/,
  /\bgetParentSession\s*\(/,
  /\bgetTeacherSession\s*\(/,
  // Supabase auth — multiple call shapes the codebase uses
  /\bcreateSupabaseServerClient\s*\(/,
  /\bsupabase[A-Za-z]*\.auth\.getUser\s*\(/,
  /\bsupabase[A-Za-z]*\.auth\.getSession\s*\(/,
  /\.auth\.getUser\s*\(\s*\)/,        // bare .auth.getUser()
  // Header / cookie / secret signatures
  /\bx-admin-secret\b/,
  /\bx-cron-secret\b/,
  /\bx-api-key\b/i,
  /\bCRON_SECRET\b/,
  /\bSUPER_ADMIN_SECRET\b/,
  /sb-[a-z-]+-auth-token/,            // Supabase cookie sniff
  /Authorization['"]?\s*\)/,           // headers.get('Authorization')
  /Bearer\s+\$\{?[A-Z]/,               // Bearer token construction
  // Razorpay webhook signature verification (auth-equivalent for that surface)
  /\bverifyRazorpaySignature\s*\(/,
  /\brazorpay-signature\b/i,
  // OAuth flows
  /\bvalidateOAuthToken\s*\(/,
  /\bvalidateOAuthCallback\s*\(/,
];

const TENANT_SCOPING_PATTERNS: ReadonlyArray<RegExp> = [
  /\.eq\s*\(\s*['"]school_id['"]/,
  /\.eq\s*\(\s*['"]tenant_id['"]/,
  /\.match\s*\(\s*\{\s*school_id\b/,
  /\bx-school-id\b/,
  /\btenantFromHeaders\s*\(/,
  /\bresolveSchool\s*\(/,
  /\bschoolIdFromContext\b/,
  // Indirect: authorizeSchoolAdmin / authorizeSchoolApi return auth.schoolId,
  // and using that downstream is the canonical tenant-scoping pattern.
  /\bauth\.schoolId\b/,
  /\bauth\.studentId\b/,
  /\bauth\.tenantId\b/,
];

/**
 * Module imports that strongly imply auth + (often) tenant scoping. If a route
 * imports any of these, we treat it as "auth present" — the helper itself is
 * the auth boundary, even if the call shape doesn't match the regex set.
 */
const AUTH_VIA_IMPORT: ReadonlyArray<RegExp> = [
  // Match both @/lib/<helper> AND relative paths like ../../../../lib/<helper>.
  // The trailing `['"]` anchors the end so we don't match `lib/rbac-types`.
  /from\s+['"](?:@\/|(?:\.\.\/)+)lib\/rbac['"]/,
  /from\s+['"](?:@\/|(?:\.\.\/)+)lib\/school-admin-auth['"]/,
  /from\s+['"](?:@\/|(?:\.\.\/)+)lib\/school-api-auth['"]/,
  /from\s+['"](?:@\/|(?:\.\.\/)+)lib\/admin-auth['"]/,
  /from\s+['"](?:@\/|(?:\.\.\/)+)lib\/admin-session['"]/,
  /from\s+['"](?:@\/|(?:\.\.\/)+)lib\/oauth-manager['"]/,
  /from\s+['"](?:@\/|(?:\.\.\/)+)lib\/api-key-manager['"]/,
];

const PUBLIC_BY_DESIGN: ReadonlyArray<string> = [
  // Health probes / public config endpoints. Path is the segment under /api.
  '/api/v1/health',
  '/api/school-config',
  '/api/tenant/config',
  '/api/error-report',
  '/api/client-error',
  '/api/oauth',                       // OAuth callback, validated by upstream
  '/api/schools/trial',               // B2B lead-gen signup; rate-limited by IP
];

// ─── Auto-classifiers ──────────────────────────────────────────────────
//
// The naive "auth + tenant scoping" heuristic massively over-reports REVIEW
// for routes that ARE properly scoped — they just don't fit the pattern set:
//
//   - Cron routes (/api/cron/*) operate on the WHOLE platform under
//     CRON_SECRET. There's no per-tenant scope to check.
//   - Super-admin / internal-admin routes (/api/super-admin/*,
//     /api/internal/admin/*) are PLATFORM-level by design — they fan out
//     across all tenants, gated by an admin secret + RBAC.
//   - Auth routes (/api/auth/*) are SESSION-level — the user's identity
//     IS the scope; there's no school_id to filter by because the request
//     is the user describing THEMSELVES.
//
// These three "intentional" buckets get re-classified as ✅ SAFE with a
// label so reviewers can focus on the truly ambiguous routes.
//
// Each classifier requires BOTH the path prefix AND a confirming auth
// signal (e.g. CRON_SECRET, requireAdminSecret, .auth.getUser()) to avoid
// false positives if someone accidentally drops an unauthenticated route
// under one of these prefixes.

interface AutoClassifier {
  /** Required path prefix on the route's URL. */
  pathPrefix: string;
  /** Human-readable bucket label, surfaced in the report. */
  label: string;
  /** At least ONE of these auth signals must be present in the route source
   *  for the classifier to apply. Belt-and-braces against accidental
   *  mis-prefixing of an unauthenticated route. */
  requiredAuthSignal: ReadonlyArray<RegExp>;
  /** Why this prefix is auto-classified — surfaced in the report so a
   *  reviewer can see WHY their route was bucketed as SAFE. */
  reason: string;
}

const AUTO_CLASSIFIERS: ReadonlyArray<AutoClassifier> = [
  {
    pathPrefix: '/api/cron/',
    label: 'SYSTEM (cron)',
    requiredAuthSignal: [/\bCRON_SECRET\b/, /\bx-cron-secret\b/, /\bverifyCronSecret\s*\(/],
    reason: 'Cron route gated by CRON_SECRET. Operates platform-wide; no per-tenant scope expected.',
  },
  {
    pathPrefix: '/api/internal/admin/',
    label: 'PLATFORM (internal admin)',
    requiredAuthSignal: [/\brequireAdminSecret\s*\(/, /\bx-admin-secret\b/, /\bSUPER_ADMIN_SECRET\b/],
    reason: 'Internal admin route gated by SUPER_ADMIN_SECRET. Fans out across all tenants by design.',
  },
  {
    pathPrefix: '/api/super-admin/',
    label: 'PLATFORM (super-admin)',
    requiredAuthSignal: [
      /\bauthorizeAdmin\s*\(/,
      /\brequireAdminSecret\s*\(/,
      /\bx-admin-secret\b/,
      /from\s+['"](?:@\/|(?:\.\.\/)+)lib\/admin-auth['"]/,
    ],
    reason: 'Super-admin route gated by admin session + RBAC. Operates across all tenants by design.',
  },
  {
    pathPrefix: '/api/auth/',
    label: 'SESSION (auth)',
    requiredAuthSignal: [
      /\bcreateSupabaseServerClient\s*\(/,
      /\.auth\.getUser\s*\(/,
      /\.auth\.getSession\s*\(/,
      /\bauthorizeRequest\s*\(/,
      /sb-[a-z-]+-auth-token/,
    ],
    reason: 'Auth route — the user\'s session IS the scope. Tenant scoping happens via session-derived claims, not URL params.',
  },
];

// ─── Explicit per-route waivers ────────────────────────────────────────
//
// Routes whose tenant-safety has been human-verified but which the
// heuristics don't catch — usually because the scoping happens inside
// an imported helper or via RPC. Each entry MUST include a `reason`
// explaining what the reviewer checked. Use sparingly — prefer to
// extend AUTH_VIA_IMPORT or AUTO_CLASSIFIERS when a class of routes
// shares a pattern.

interface RouteWaiver {
  routePath: string;
  reason: string;
}

const EXPLICIT_WAIVERS: ReadonlyArray<RouteWaiver> = [
  // Add per-route waivers here as the team triages the REVIEW queue.
  // Format:
  //   { routePath: '/api/foo/bar', reason: 'Scoping happens in <helper>; verified by <name> on <date>.' },
];

// ─── Bucket types ───────────────────────────────────────────────────────

export type Bucket = 'SAFE' | 'REVIEW' | 'NO_TENANT_SCOPING' | 'NO_AUTH';

export interface RouteFinding {
  routePath: string;          // /api/foo/bar
  filePath: string;           // absolute path
  methods: string[];          // ['GET', 'POST', ...]
  bucket: Bucket;
  hasAuth: boolean;
  hasTenantScoping: boolean;
  isPublicByDesign: boolean;
  /** When non-null, the route was auto-classified into a sub-bucket
   *  (e.g. "SYSTEM (cron)", "PLATFORM (super-admin)") so reviewers can
   *  see WHY a SAFE verdict was reached. */
  autoLabel: string | null;
  authMatches: string[];
  tenantMatches: string[];
  reason: string;
}

// ─── Walker ─────────────────────────────────────────────────────────────

async function walkRoutes(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkRoutes(full)));
    } else if (entry.isFile() && entry.name === 'route.ts') {
      out.push(full);
    }
  }
  return out;
}

function routePathFromFile(filePath: string): string {
  // Convert .../src/app/api/foo/bar/route.ts → /api/foo/bar
  const rel = path.relative(API_ROOT, filePath);
  const dir = path.dirname(rel).replace(/\\/g, '/');
  return dir === '.' ? '/api' : `/api/${dir}`;
}

const HTTP_METHOD_RE = /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g;

function extractMethods(src: string): string[] {
  const methods = new Set<string>();
  for (const m of src.matchAll(HTTP_METHOD_RE)) methods.add(m[1]);
  return [...methods];
}

function listMatches(src: string, patterns: ReadonlyArray<RegExp>): string[] {
  const hits = new Set<string>();
  for (const p of patterns) {
    const m = src.match(p);
    if (m) hits.add(m[0]);
  }
  return [...hits];
}

function categorize(
  routePath: string,
  src: string,
  hasAuth: boolean,
  hasTenantScoping: boolean,
): { bucket: Bucket; reason: string; isPublicByDesign: boolean; autoLabel: string | null } {
  const isPublicByDesign = PUBLIC_BY_DESIGN.some(p => routePath === p || routePath.startsWith(`${p}/`));
  if (isPublicByDesign) {
    return {
      bucket: 'SAFE',
      reason: 'Public-by-design endpoint (allowlisted in audit script).',
      isPublicByDesign: true,
      autoLabel: 'PUBLIC',
    };
  }

  // Per-route human-verified waiver (highest precedence over heuristics).
  const waiver = EXPLICIT_WAIVERS.find(w => w.routePath === routePath);
  if (waiver) {
    return {
      bucket: 'SAFE',
      reason: `Explicit waiver: ${waiver.reason}`,
      isPublicByDesign: false,
      autoLabel: 'WAIVER',
    };
  }

  if (hasAuth && hasTenantScoping) {
    return {
      bucket: 'SAFE',
      reason: 'Has auth + tenant scoping.',
      isPublicByDesign: false,
      autoLabel: null,
    };
  }

  // Auto-classifiers: cron / admin / auth routes that are SAFE-by-design
  // even though they don't show a school_id filter. Each requires the path
  // prefix AND a confirming auth signal.
  for (const cls of AUTO_CLASSIFIERS) {
    if (!routePath.startsWith(cls.pathPrefix)) continue;
    const hasSignal = cls.requiredAuthSignal.some(rx => rx.test(src));
    if (!hasSignal) continue; // prefix matched but auth signal missing → fall through (suspicious!)
    return {
      bucket: 'SAFE',
      reason: cls.reason,
      isPublicByDesign: false,
      autoLabel: cls.label,
    };
  }

  if (hasAuth && !hasTenantScoping) {
    return {
      bucket: 'REVIEW',
      reason:
        'Has auth but no obvious tenant scoping in this file. Could be safe (RLS-trusted, single-tenant data, helper-imported scoping) — review needed.',
      isPublicByDesign: false,
      autoLabel: null,
    };
  }
  if (!hasAuth && hasTenantScoping) {
    return {
      bucket: 'NO_AUTH',
      reason: 'Tenant scoping present but no auth assertion. Caller could pass any school_id.',
      isPublicByDesign: false,
      autoLabel: null,
    };
  }
  return {
    bucket: 'NO_AUTH',
    reason: 'No auth assertion AND no tenant scoping detected.',
    isPublicByDesign: false,
    autoLabel: null,
  };
}

export async function audit(): Promise<RouteFinding[]> {
  const files = await walkRoutes(API_ROOT);
  const findings: RouteFinding[] = [];

  for (const filePath of files) {
    const src = await fs.readFile(filePath, 'utf8');
    const methods = extractMethods(src);
    const authMatches = listMatches(src, AUTH_PATTERNS);
    const importMatches = listMatches(src, AUTH_VIA_IMPORT);
    const tenantMatches = listMatches(src, TENANT_SCOPING_PATTERNS);
    const routePath = routePathFromFile(filePath);
    const hasAuth = authMatches.length > 0 || importMatches.length > 0;
    const hasTenantScoping = tenantMatches.length > 0;
    // Surface the import-derived signals alongside direct call matches so a
    // human reviewing the report can see WHY the route was deemed authed.
    const allAuthSignals = [...authMatches, ...importMatches.map(s => `import:${s}`)];
    const { bucket, reason, isPublicByDesign, autoLabel } = categorize(
      routePath, src, hasAuth, hasTenantScoping,
    );

    findings.push({
      routePath,
      filePath,
      methods,
      bucket,
      hasAuth,
      hasTenantScoping,
      isPublicByDesign,
      autoLabel,
      authMatches: allAuthSignals,
      tenantMatches,
      reason,
    });
  }

  findings.sort((a, b) => a.routePath.localeCompare(b.routePath));
  return findings;
}

// ─── Reporters ──────────────────────────────────────────────────────────

function summarize(findings: RouteFinding[]): Record<Bucket, number> {
  const out: Record<Bucket, number> = {
    SAFE: 0, REVIEW: 0, NO_TENANT_SCOPING: 0, NO_AUTH: 0,
  };
  for (const f of findings) out[f.bucket]++;
  return out;
}

function bucketIcon(b: Bucket): string {
  return b === 'SAFE' ? '✅' : b === 'REVIEW' ? '🟡' : b === 'NO_TENANT_SCOPING' ? '🟠' : '🔴';
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultOutPath(): string {
  return path.join(REPO_ROOT, 'docs', 'audits', `${todayISO()}-tenant-isolation.md`);
}

function summarizeSafeByLabel(findings: RouteFinding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) {
    if (f.bucket !== 'SAFE') continue;
    const k = f.autoLabel ?? 'AUTH+SCOPING';
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function renderMarkdown(findings: RouteFinding[]): string {
  const totals = summarize(findings);
  const safeByLabel = summarizeSafeByLabel(findings);
  const lines: string[] = [];
  lines.push(`# Tenant Isolation Audit — ${todayISO()}`);
  lines.push('');
  lines.push(`Generated by \`scripts/audit-tenant-isolation.ts\`. Static heuristic. **Use as a triage queue, not a verdict** — see the script header for known false-positive/negative cases.`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Bucket | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| ✅ SAFE | ${totals.SAFE} |`);
  lines.push(`| 🟡 REVIEW (auth, no obvious tenant filter) | ${totals.REVIEW} |`);
  lines.push(`| 🔴 NO_AUTH (high priority) | ${totals.NO_AUTH} |`);
  lines.push('');
  lines.push(`Total routes scanned: **${findings.length}**.`);
  lines.push('');
  // Sub-breakdown of SAFE so reviewers see what was auto-classified vs
  // what genuinely matched the auth+scoping pattern.
  const safeKeys = Object.keys(safeByLabel).sort();
  if (safeKeys.length > 0) {
    lines.push('### ✅ SAFE — breakdown');
    lines.push('');
    lines.push('| Sub-bucket | Count | Why auto-classified |');
    lines.push('|---|---|---|');
    for (const key of safeKeys) {
      const why =
        key === 'AUTH+SCOPING' ? 'Has auth + matching tenant-scoping pattern.' :
        key === 'PUBLIC' ? 'On the public-by-design allowlist.' :
        key === 'WAIVER' ? 'Explicit per-route waiver (see EXPLICIT_WAIVERS in script).' :
        AUTO_CLASSIFIERS.find(c => c.label === key)?.reason ?? '—';
      lines.push(`| ${key} | ${safeByLabel[key]} | ${why} |`);
    }
    lines.push('');
  }

  // High-priority section first.
  const noAuth = findings.filter(f => f.bucket === 'NO_AUTH');
  if (noAuth.length > 0) {
    lines.push('## 🔴 NO_AUTH — High priority');
    lines.push('');
    lines.push('Routes with no auth assertion detected and not flagged public-by-design. Review first.');
    lines.push('');
    for (const f of noAuth) renderRoute(lines, f);
  }

  const review = findings.filter(f => f.bucket === 'REVIEW');
  if (review.length > 0) {
    lines.push('## 🟡 REVIEW — Has auth, no obvious tenant scoping');
    lines.push('');
    lines.push('Auth is present but no `eq("school_id", …)` / `tenantFromHeaders` / `x-school-id` patterns matched. Could be safe (RLS-trusted, single-tenant data, scoping inside an imported helper). Review needed.');
    lines.push('');
    for (const f of review) renderRoute(lines, f);
  }

  const safe = findings.filter(f => f.bucket === 'SAFE');
  if (safe.length > 0) {
    lines.push('## ✅ SAFE');
    lines.push('');
    lines.push('Either has auth + tenant scoping, or is on the public-by-design allowlist.');
    lines.push('');
    for (const f of safe) renderRoute(lines, f);
  }

  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push('See `scripts/audit-tenant-isolation.ts` header. The patterns below were checked:');
  lines.push('');
  lines.push('**Auth:** ' + AUTH_PATTERNS.map(r => `\`${r.source}\``).join(', '));
  lines.push('');
  lines.push('**Tenant scoping:** ' + TENANT_SCOPING_PATTERNS.map(r => `\`${r.source}\``).join(', '));
  lines.push('');
  lines.push('**Public-by-design allowlist:** ' + PUBLIC_BY_DESIGN.map(p => `\`${p}\``).join(', '));
  lines.push('');
  lines.push('**Auto-classifiers (path-prefix + auth-signal):**');
  lines.push('');
  for (const cls of AUTO_CLASSIFIERS) {
    lines.push(`- \`${cls.pathPrefix}\` → \`${cls.label}\` — ${cls.reason}`);
  }
  lines.push('');
  if (EXPLICIT_WAIVERS.length > 0) {
    lines.push('**Explicit per-route waivers:**');
    lines.push('');
    for (const w of EXPLICIT_WAIVERS) {
      lines.push(`- \`${w.routePath}\` — ${w.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderRoute(lines: string[], f: RouteFinding): void {
  const rel = path.relative(REPO_ROOT, f.filePath).replace(/\\/g, '/');
  const methods = f.methods.length > 0 ? f.methods.join('/') : '(no exports detected)';
  const labelSuffix = f.autoLabel ? ` _[${f.autoLabel}]_` : '';
  lines.push(`### ${bucketIcon(f.bucket)} \`${f.routePath}\` — ${methods}${labelSuffix}`);
  lines.push('');
  lines.push(`- **File:** \`${rel}\``);
  lines.push(`- **Auth signals:** ${f.authMatches.length > 0 ? f.authMatches.map(s => `\`${s}\``).join(', ') : '_none_'}`);
  lines.push(`- **Tenant signals:** ${f.tenantMatches.length > 0 ? f.tenantMatches.map(s => `\`${s}\``).join(', ') : '_none_'}`);
  lines.push(`- **Reason:** ${f.reason}`);
  lines.push('');
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const findings = await audit();

  if (jsonOutput) {
    process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), findings }, null, 2));
    return;
  }

  const md = renderMarkdown(findings);
  const outPath = customOut ? path.resolve(customOut) : defaultOutPath();

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, md, 'utf8');

  const totals = summarize(findings);
  const safeByLabel = summarizeSafeByLabel(findings);
  const safeBreakdown = Object.keys(safeByLabel).sort()
    .map(k => `    - ${k}: ${safeByLabel[k]}`)
    .join('\n');
  const summary =
    `Tenant isolation audit written to ${path.relative(REPO_ROOT, outPath)}\n` +
    `  ✅ SAFE:   ${totals.SAFE}\n` +
    (safeBreakdown ? safeBreakdown + '\n' : '') +
    `  🟡 REVIEW: ${totals.REVIEW}\n` +
    `  🔴 NO_AUTH: ${totals.NO_AUTH}\n` +
    `  Total: ${findings.length} routes scanned.`;
  process.stdout.write(summary + '\n');

  // Exit non-zero if any NO_AUTH findings — useful for CI gating later.
  if (totals.NO_AUTH > 0 && process.env.AUDIT_FAIL_ON_NO_AUTH === '1') {
    process.exit(1);
  }
}

// Only execute the CLI when invoked directly (e.g. `npx tsx scripts/...`).
// When this module is imported (by eval/tenant-isolation/run.ts and tests),
// the `audit()` function is the entry point — the CLI main() must not run
// as an import side effect.
if (require.main === module) {
  main().catch(err => {
    // eslint-disable-next-line no-console
    console.error('audit-tenant-isolation: fatal error', err);
    process.exit(2);
  });
}
