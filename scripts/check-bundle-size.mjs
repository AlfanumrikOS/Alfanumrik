#!/usr/bin/env node
/**
 * Bundle size checker — Turbopack-compatible.
 *
 * Enforces P10 budget from .claude/CLAUDE.md:
 *   - Shared JS gzip:   160 kB
 *   - Per-page gzip:    260 kB
 *   - Middleware gzip:  120 kB
 *
 * Why this exists:
 *   Next 16 + Turbopack emits .next/server/middleware.js as a ~221-byte stub
 *   that `require()`s the real chunk(s) under .next/server/chunks/. The old
 *   CI `wc -c` check on the stub always passed → P10 was a false green.
 *   Turbopack also no longer prints a "First Load JS" table after build, so
 *   shared and per-page budgets went unverified.
 *
 * Strategy:
 *   - Middleware: parse .next/server/middleware.js for `R.c("...")` references,
 *     sum gzipped size of each referenced chunk.
 *   - Shared JS:  read .next/build-manifest.json `rootMainFiles` + `polyfillFiles`,
 *     sum gzipped size. These are always loaded on first paint.
 *   - Per-page:   walk .next/server/app/** /page_client-reference-manifest.js,
 *     extract unique /_next/static/chunks/*.js paths, sum gzipped.
 *     Page cost = (page-specific chunks) ∪ (shared). We report page-specific
 *     cost (page chunks only, ex-shared) against the 260 kB cap.
 *
 * Exit code: 0 on pass, 1 on any violation.
 *
 * Caps are hardcoded here intentionally — single source of truth referenced
 * by CI. If P10 changes in .claude/CLAUDE.md, update these constants too.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative, sep } from 'node:path';

// ─── Caps (P10 in .claude/CLAUDE.md) ──────────────────────────────────────
const CAP_SHARED_KB = 160;
const CAP_PAGE_KB = 260;
const CAP_MIDDLEWARE_KB = 120;

const ROOT = process.cwd();
const NEXT_DIR = join(ROOT, '.next');
const STATIC_CHUNKS = join(NEXT_DIR, 'static', 'chunks');
const SERVER_DIR = join(NEXT_DIR, 'server');
const SERVER_CHUNKS = join(SERVER_DIR, 'chunks');

// ─── Helpers ──────────────────────────────────────────────────────────────
const gzKb = (buf) => Math.round((gzipSync(buf).length / 1024) * 10) / 10;
const kb = (n) => `${n.toFixed(1)} kB`;

function readIfExists(p) {
  try {
    return readFileSync(p);
  } catch {
    return null;
  }
}

function walk(dir, matcher, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, matcher, out);
    else if (matcher(full)) out.push(full);
  }
  return out;
}

// ─── 1. Middleware (real chunks, not stub) ────────────────────────────────
function measureMiddleware() {
  const stubPath = join(SERVER_DIR, 'middleware.js');
  const stub = readIfExists(stubPath);
  if (!stub) return { chunks: [], totalKb: 0, note: 'middleware.js not found' };

  const stubStr = stub.toString('utf8');
  // Match both R.c("...") chunk loads and direct module references.
  const re = /R\.c\(\s*"([^"]+)"\s*\)/g;
  const refs = [];
  let m;
  while ((m = re.exec(stubStr)) !== null) refs.push(m[1]);

  // Paths in the stub are relative to .next/ (e.g. "server/chunks/[root...].js")
  // — resolve to absolute.
  const resolved = refs.map((r) => join(NEXT_DIR, r));
  const rows = [];
  let total = 0;
  for (const p of resolved) {
    const buf = readIfExists(p);
    if (!buf) {
      rows.push({ file: relative(NEXT_DIR, p), kb: 0, missing: true });
      continue;
    }
    const size = gzKb(buf);
    rows.push({ file: relative(NEXT_DIR, p), kb: size });
    total += size;
  }

  // If no chunks found, the stub itself is the measure (degenerate case).
  if (rows.length === 0) {
    total = gzKb(stub);
    rows.push({ file: 'middleware.js (stub)', kb: total });
  }

  return { chunks: rows, totalKb: Math.round(total * 10) / 10 };
}

// ─── 2. Shared JS (rootMainFiles + polyfillFiles) ─────────────────────────
function measureShared() {
  const manifestPath = join(NEXT_DIR, 'build-manifest.json');
  const raw = readIfExists(manifestPath);
  if (!raw) return { files: [], totalKb: 0, note: 'build-manifest.json missing' };
  const manifest = JSON.parse(raw.toString('utf8'));
  const files = [
    ...(manifest.rootMainFiles || []),
    ...(manifest.polyfillFiles || []),
  ];
  const rows = [];
  let total = 0;
  for (const rel of files) {
    const abs = join(NEXT_DIR, rel);
    const buf = readIfExists(abs);
    if (!buf) {
      rows.push({ file: rel, kb: 0, missing: true });
      continue;
    }
    const size = gzKb(buf);
    rows.push({ file: rel, kb: size });
    total += size;
  }
  return { files: rows, totalKb: Math.round(total * 10) / 10, sharedSet: new Set(files) };
}

// ─── 3. Per-page client chunks ────────────────────────────────────────────
function measurePages(sharedSet) {
  const appDir = join(SERVER_DIR, 'app');
  if (!existsSync(appDir)) return { pages: [] };
  const manifests = walk(appDir, (f) => f.endsWith('page_client-reference-manifest.js'));

  const pages = [];
  for (const mf of manifests) {
    const raw = readIfExists(mf);
    if (!raw) continue;
    const text = raw.toString('utf8');
    // Extract all "/_next/static/chunks/xxx.js" references.
    const chunkRe = /\/_next\/static\/chunks\/([^"'\s]+\.js)/g;
    const seen = new Set();
    let m;
    while ((m = chunkRe.exec(text)) !== null) seen.add(`static/chunks/${m[1]}`);

    // Route path from manifest file location.
    // e.g. .next/server/app/dashboard/page_client-reference-manifest.js → /dashboard
    const rel = relative(appDir, mf).split(sep);
    rel.pop(); // drop "page_client-reference-manifest.js"
    const route = '/' + rel.join('/').replace(/\/page$/, '');

    // Page-specific cost = chunks referenced by this page, minus shared-set.
    let pageOnly = 0;
    let pageTotal = 0;
    for (const rel of seen) {
      const abs = join(NEXT_DIR, rel);
      const buf = readIfExists(abs);
      if (!buf) continue;
      const size = gzKb(buf);
      pageTotal += size;
      if (!sharedSet.has(rel)) pageOnly += size;
    }
    pages.push({
      route: route || '/',
      pageOnlyKb: Math.round(pageOnly * 10) / 10,
      pageTotalKb: Math.round(pageTotal * 10) / 10,
    });
  }
  pages.sort((a, b) => b.pageOnlyKb - a.pageOnlyKb);
  return { pages };
}

// ─── Report + Verdict ─────────────────────────────────────────────────────
function main() {
  if (!existsSync(NEXT_DIR)) {
    console.error('ERROR: .next/ not found. Run `npm run build` first.');
    process.exit(2);
  }

  const mw = measureMiddleware();
  const shared = measureShared();
  const { pages } = measurePages(shared.sharedSet || new Set());

  const violations = [];

  console.log('━━━ Bundle Size Report (gzipped) ━━━');
  console.log();
  console.log('Shared JS (rootMain + polyfills)');
  for (const r of shared.files) {
    console.log(`  ${r.missing ? '[MISSING]' : '         '} ${kb(r.kb)}  ${r.file}`);
  }
  const sharedVerdict = shared.totalKb > CAP_SHARED_KB ? 'OVER' : 'PASS';
  console.log(`  TOTAL: ${kb(shared.totalKb)} / ${CAP_SHARED_KB} kB — ${sharedVerdict}`);
  if (sharedVerdict === 'OVER') violations.push(`Shared JS ${kb(shared.totalKb)} > ${CAP_SHARED_KB} kB`);
  console.log();

  console.log('Middleware (real chunks referenced by stub)');
  for (const r of mw.chunks) {
    console.log(`  ${r.missing ? '[MISSING]' : '         '} ${kb(r.kb)}  ${r.file}`);
  }
  const mwVerdict = mw.totalKb > CAP_MIDDLEWARE_KB ? 'OVER' : 'PASS';
  console.log(`  TOTAL: ${kb(mw.totalKb)} / ${CAP_MIDDLEWARE_KB} kB — ${mwVerdict}`);
  if (mwVerdict === 'OVER') violations.push(`Middleware ${kb(mw.totalKb)} > ${CAP_MIDDLEWARE_KB} kB`);
  console.log();

  console.log(`Per-page bundles (page-specific cost, excluding shared; cap ${CAP_PAGE_KB} kB)`);
  console.log('  Top 15 heaviest:');
  for (const p of pages.slice(0, 15)) {
    const verdict = p.pageOnlyKb > CAP_PAGE_KB ? 'OVER' : 'ok  ';
    console.log(`  [${verdict}] ${kb(p.pageOnlyKb).padStart(9)}  ${p.route}`);
  }
  const overPages = pages.filter((p) => p.pageOnlyKb > CAP_PAGE_KB);
  if (overPages.length > 0) {
    for (const p of overPages) {
      violations.push(`Page ${p.route}: ${kb(p.pageOnlyKb)} > ${CAP_PAGE_KB} kB`);
    }
  }
  console.log(`  (${pages.length} pages measured, ${overPages.length} over cap)`);
  console.log();

  if (violations.length > 0) {
    console.log('━━━ VIOLATIONS (P10) ━━━');
    for (const v of violations) console.log(`  FAIL: ${v}`);
    console.log();
    console.log('See P10 in .claude/CLAUDE.md. Run `npm run analyze` to investigate.');
    process.exit(1);
  }

  console.log('All bundles within P10 budget.');
  process.exit(0);
}

main();
