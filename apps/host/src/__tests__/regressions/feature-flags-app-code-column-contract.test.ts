/**
 * feature_flags app-code column contract — static-source canary
 * (feature-flag RCA repair, 2026-07-20; closes the REG-125 gap).
 *
 * REG-125 pinned the SEED shape (migration SQL inserting into nonexistent
 * `name`/`enabled` columns), but nothing guarded APP-CODE reads/writes. The
 * 2026-07 RCA found two live instances of exactly that failure mode:
 *   - apps/host/src/app/api/internal/admin/feature-flags/route.ts ordered by
 *     the nonexistent `name` column (every GET 500'd) and inserted a `name`
 *     key (every POST failed on the live schema);
 *   - supabase/functions/identity/index.ts selected the nonexistent
 *     `target_plans` column, which errored the whole query, so `flags` came
 *     back null and EVERY user resolved with ALL flags OFF.
 *
 * This canary statically extracts every column list used against
 * feature_flags in the three app-code call sites (internal admin route,
 * identity Edge Function, super-admin route) and asserts each column is in
 * the known live column set. A typo'd or removed column becomes a PR-CI
 * failure instead of a silent production outage.
 *
 * Deterministic: static file read + regex extraction, no DB, no network.
 * setup.ts remaps `supabase/...` reads to the repo root.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Known live columns of public.feature_flags (verified against the prod
 * baseline + subsequent migrations, 2026-07-20). If a migration adds a
 * column, extend this set in the same PR.
 */
const LIVE_COLUMNS = new Set([
  'id',
  'flag_name',
  'is_enabled',
  'rollout_percentage',
  'target_grades',
  'description',
  'updated_by',
  'created_at',
  'updated_at',
  'target_institutions',
  'target_roles',
  'target_environments',
  'wave',
  'target_subjects',
  'target_languages',
  'launch_date',
  'metadata',
]);

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

// ─── supabase-js chain extraction (internal admin route) ──────────────

interface ChainUsage {
  selectColumns: string[];
  insertKeys: string[];
  orderTargets: string[];
}

/**
 * For every `.from('feature_flags')` chain (match → next `;`), extract
 * select column lists (skipping bare `*`), insert-object keys, and
 * `.order(...)` targets.
 */
function extractFeatureFlagChains(source: string): ChainUsage {
  const usage: ChainUsage = { selectColumns: [], insertKeys: [], orderTargets: [] };
  const fromRe = /\.from\(\s*['"]feature_flags['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) {
    let end = source.indexOf(';', m.index);
    if (end === -1) end = source.length;
    const segment = source.slice(m.index, end);

    const selRe = /\.select\(\s*['"]([^'"]+)['"]/g;
    let sel: RegExpExecArray | null;
    while ((sel = selRe.exec(segment)) !== null) {
      if (sel[1].trim() === '*') continue;
      usage.selectColumns.push(...sel[1].split(',').map((c) => c.trim()).filter(Boolean));
    }

    const ins = /\.insert\(\s*\{([\s\S]*?)\}\s*\)/.exec(segment);
    if (ins) {
      let key: RegExpExecArray | null;
      const keyRe = /(?:^|[{,])\s*([a-z_][a-z0-9_]*)\s*:/g;
      while ((key = keyRe.exec(ins[1])) !== null) usage.insertKeys.push(key[1]);
    }

    const ordRe = /\.order\(\s*['"]([a-z0-9_]+)['"]/g;
    let ord: RegExpExecArray | null;
    while ((ord = ordRe.exec(segment)) !== null) usage.orderTargets.push(ord[1]);
  }
  return usage;
}

/** PostgREST-URL style: every `select=<col,col,...>` token list in a file. */
function extractPostgrestSelects(source: string): string[] {
  const cols: string[] = [];
  const re = /select=([a-z0-9_,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    cols.push(...m[1].split(',').map((c) => c.trim()).filter(Boolean));
  }
  return cols;
}

const assertAllLive = (cols: string[], context: string) => {
  const unknown = cols.filter((c) => !LIVE_COLUMNS.has(c));
  expect(
    unknown,
    `${context} references column(s) not on the live feature_flags table: ${unknown.join(', ')}`,
  ).toEqual([]);
};

// ─── Internal admin route ─────────────────────────────────────────────

describe('feature_flags column contract — internal admin route', () => {
  const src = read('src/app/api/internal/admin/feature-flags/route.ts');
  const usage = extractFeatureFlagChains(src);

  it('extraction is non-vacuous (insert + order found)', () => {
    expect(usage.insertKeys.length).toBeGreaterThanOrEqual(4);
    expect(usage.orderTargets.length).toBeGreaterThanOrEqual(1);
  });

  it('every insert key is a live column — and includes flag_name + rollout_percentage', () => {
    assertAllLive(usage.insertKeys, 'internal admin route insert');
    expect(usage.insertKeys).toContain('flag_name');
    expect(usage.insertKeys).toContain('rollout_percentage');
    // The pre-repair bug: inserting the nonexistent `name` column.
    expect(usage.insertKeys).not.toContain('name');
  });

  it('orders by flag_name — never by the nonexistent name column', () => {
    assertAllLive(usage.orderTargets, 'internal admin route order');
    expect(usage.orderTargets).toContain('flag_name');
    expect(usage.orderTargets).not.toContain('name');
  });

  it('every explicit select column is a live column', () => {
    assertAllLive(usage.selectColumns, 'internal admin route select');
  });

  it('PATCH allow-list contains only live columns', () => {
    const allowed = /const ALLOWED = \[([^\]]*)\]/.exec(src);
    expect(allowed, 'ALLOWED update allow-list not found').not.toBeNull();
    const cols = [...allowed![1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(cols.length).toBeGreaterThanOrEqual(3);
    assertAllLive(cols, 'internal admin route PATCH allow-list');
  });
});

// ─── identity Edge Function ───────────────────────────────────────────

describe('feature_flags column contract — identity Edge Function', () => {
  const src = read('supabase/functions/identity/index.ts');
  const usage = extractFeatureFlagChains(src);

  it('selects only live columns from feature_flags (non-vacuous)', () => {
    expect(usage.selectColumns.length).toBeGreaterThanOrEqual(4);
    assertAllLive(usage.selectColumns, 'identity feature_flags select');
    expect(usage.selectColumns).toContain('flag_name');
    expect(usage.selectColumns).toContain('rollout_percentage');
  });

  it('the nonexistent target_plans column never comes back', () => {
    // Pre-repair bug: selecting target_plans errored the whole query →
    // flags came back null → every flag resolved OFF for every user.
    expect(usage.selectColumns).not.toContain('target_plans');
    expect(src).not.toMatch(/select\([^)]*target_plans/);
  });
});

// ─── Super-admin route (PostgREST URL style) ──────────────────────────

describe('feature_flags column contract — super-admin route (PostgREST URLs)', () => {
  const src = read('src/app/api/super-admin/feature-flags/route.ts');

  it('every select= token and the fields list are live columns', () => {
    const cols = extractPostgrestSelects(src);
    expect(cols.length).toBeGreaterThanOrEqual(5); // non-vacuous
    assertAllLive(cols, 'super-admin route select=');

    const fields = /const fields = '([^']+)'/.exec(src);
    expect(fields, 'GET fields list not found').not.toBeNull();
    assertAllLive(
      fields![1].split(',').map((c) => c.trim()),
      'super-admin route GET fields',
    );
  });
});
