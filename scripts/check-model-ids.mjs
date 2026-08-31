#!/usr/bin/env node
// scripts/check-model-ids.mjs
//
// MODEL-ID LIVENESS CANARY — probes every model id configured in this repo
// against the provider catalogue APIs and fails loudly when one stops
// resolving.
//
// WHY THIS EXISTS
// ---------------
// 2026-08-31 incident. `claude-sonnet-4-20250514` was pinned as Foxy's Sonnet
// tier. Anthropic RETIRED it: the live API answers HTTP 404 `not_found_error`
// and the id is absent from `GET /v1/models`. Nothing in this repo detected
// that. Because `grounded-answer/claude.ts` treats 404 as a retriable
// server_error, every Sonnet-tier request burned a guaranteed-failing round
// trip and then silently degraded to OpenAI — answering students with a model
// the Foxy prompts are not calibrated for. It was found by a manual audit.
//
// The thing that made it undetectable is that a model retirement is an
// EXTERNAL change with no commit to trigger a CI run. Type-check, lint, unit
// tests and the build were all green the whole time and always would be: the
// string is still a valid string. Only a live probe on a schedule can see it.
// That is why this ships with .github/workflows/model-id-canary.yml (daily
// cron), not as a PR gate.
//
// THE ONE DESIGN RULE: DO NOT HARDCODE THE LIST OF IDS
// ----------------------------------------------------
// A hardcoded inventory rots exactly the same way the pins rotted, and it rots
// silently — a new pin added in a new file would simply never be probed, and
// the canary would keep reporting green. So the id set is DISCOVERED from
// source on every run: this script walks the source roots below and extracts
// model-id-shaped string literals with a comment-aware tokenizer. Add a new
// pin anywhere under those roots and it is probed the next morning with no
// change to this file.
//
// WHAT COUNTS AS "CONFIGURED"
// ---------------------------
//   code      — the id appears inside a STRING LITERAL in a non-test source
//               file under SCAN_ROOTS. This is enforced.
//   comment   — the id appears only in a comment (or a Python docstring).
//               Reported, never enforced. This is what keeps the repair
//               comments in registry.ts / grounded-answer/config.ts — which
//               quote the dead sonnet pin by name — from permanently failing
//               the canary they were written to explain.
//   prose     — the id appears inside a string literal that contains
//               whitespace, i.e. a sentence: a log line, an error message, a
//               feature-flag `reason` blurb. A config pin is always the WHOLE
//               literal (or `provider/model`); a model named inside a sentence
//               is documentation. Reported, never enforced. Without this,
//               packages/lib/src/flags/protected-flags.ts naming a model in a
//               flag description would be enough to fail the canary.
//   swept     — the id appears only in tests, vitest harnesses or SQL
//               migrations. Informational only (see THE SWEEP below).
//
// If the tokenizer sees a literal in neither bucket but a raw regex pass does,
// the raw hit is recorded as `code [raw-fallback]`. That is deliberate: a
// tokenizer bug must never make an id DISAPPEAR from the inventory, because a
// disappeared id is a false green. Over-enforcing is recoverable (allowlist
// it); under-enforcing is the incident.
//
// CLASSIFICATION
// --------------
//   ALIVE          present in the provider catalogue (or a per-id GET returns 200)
//   DEAD           absent, and a per-id GET returns 404 — THE FAILURE CONDITION
//   ALLOWLISTED    knowingly-unreachable config; see scripts/model-id-allowlist.json
//   UNPROBEABLE    provider publishes no free catalogue endpoint (Voyage).
//                  Reported every run so it stays visible; never fails.
//
// Allowlisting is deliberately a checked-in file with a REQUIRED per-entry
// reason, not a silent skip. A dead id sitting in dead code is still a landmine
// for whoever revives that code, so it has to be written down, with who/why,
// where a reviewer sees it as a diff hunk.
//
// FAIL CLOSED ON AMBIGUITY
// ------------------------
// A canary that reports green when it could not actually probe is worse than
// no canary, because it manufactures confidence. So a missing API key, an
// unreachable/erroring provider API, a suspiciously small catalogue, or a
// discovery pass that scanned almost nothing all exit 3 (CANNOT VERIFY) — a
// distinct, loud, non-green state that is NOT the same as "a model died".
//
// THE SWEEP (informational, never fails)
// --------------------------------------
// After the enforced pass, the script also scans test files, vitest harnesses
// and SQL migrations for model ids that appear NOWHERE in enforced config, and
// reports their catalogue status. This is how ids like the never-real
// `claude-sonnet-4-6-20251022` surface. Migrations are intentionally NOT
// enforced: they are forward-only immutable history, and a pricing row or
// column DEFAULT naming a since-retired model is correct there — but a column
// DEFAULT still stamps NEW rows with a dead id, which is worth a human's eyes.
// Markdown/docs are excluded entirely; a doc quoting a historical id is normal.
//
// PROVIDER ENDPOINTS — ALL READ-ONLY AND FREE. NEVER USE COMPLETIONS.
//   anthropic  GET https://api.anthropic.com/v1/models?limit=1000   (paginated)
//              GET https://api.anthropic.com/v1/models/{id}         (miss confirm)
//              headers: x-api-key, anthropic-version: 2023-06-01
//   openai     GET https://api.openai.com/v1/models
//              GET https://api.openai.com/v1/models/{id}            (miss confirm)
//              headers: Authorization: Bearer
//   gemini     GET https://generativelanguage.googleapis.com/v1beta/models
//              (only probed when GEMINI_API_KEY is set; otherwise the Gemini
//              ids must be allowlisted, which they are — registry.ts marks
//              them `configured: false`)
// The list-then-confirm shape matters: Anthropic's catalogue lists concrete
// dated ids, so an undated ALIAS (e.g. 'claude-sonnet-4-5') is absent from the
// list while still resolving. Declaring that DEAD off the list alone would be
// a false alarm. The per-id GET is what tells a retired id apart from an alias.
//
// Usage:
//   node scripts/check-model-ids.mjs              # canary (CI + local)
//   node scripts/check-model-ids.mjs --verbose    # every reference, not a sample
//   node scripts/check-model-ids.mjs --no-sweep   # skip the test/migration sweep
//   node scripts/check-model-ids.mjs --json       # machine-readable report on stdout
//                                                 # (human report goes to stderr)
//   node scripts/check-model-ids.mjs --provider=anthropic|openai
//                                                 # probe ONE provider only.
//   node scripts/check-model-ids.mjs --inject-dead=<id>
//                                                 # self-test: pretend <id> is
//                                                 # configured. Proves the
//                                                 # canary bites without
//                                                 # editing real config.
//
// --provider — SCOPED RUNS, AND WHY THEY CANNOT MANUFACTURE A GREEN
// -----------------------------------------------------------------
// A GitHub Actions JOB can declare exactly ONE `environment:`. In this repo
// ANTHROPIC_API_KEY and OPENAI_API_KEY live in two DIFFERENT environments
// (each environment is, confusingly, named after the secret it holds), and
// neither key exists at repo level. So no single job can ever see both keys,
// and the canary workflow has to run one job per provider. `--provider` is
// what makes that split safe.
//
// The one hazard of scoping a checker is that the un-checked half quietly
// reports as fine. Three rules prevent that here:
//
//   1. DISCOVERY IS NEVER SCOPED. The whole tree is still walked and every id
//      of every provider is still inventoried, so MIN_FILES_SCANNED /
//      MIN_IDS_DISCOVERED bite exactly as hard in a scoped run as in a full
//      one. Only the PROBING narrows.
//   2. An out-of-scope id is stamped NOT-PROBED, never ALIVE. NOT-PROBED is a
//      distinct status from both ALIVE and UNPROBEABLE, it is printed for
//      every such id, and the final PASS line names the scope and counts what
//      it did not look at. A scoped pass says "anthropic is fine", never
//      "everything is fine".
//   3. A scope with ZERO enforced ids exits 3, not 0. A scoped run that probes
//      nothing is vacuous, and a vacuous green is the exact failure mode this
//      whole script exists to prevent.
//
// Fail-closed is unchanged inside a scope: the scoped provider's key missing,
// rejected, or its catalogue implausible is still exit 3.
//
// Exit codes:
//   0  every enforced id resolves.
//   1  at least one enforced, non-allowlisted id is DEAD.
//   2  configuration error (unreadable/malformed allowlist, bad argument).
//   3  COULD NOT VERIFY — missing key, provider unreachable, vacuous discovery.
//      Distinct from 1 on purpose: "we don't know" is not "a model died", and
//      neither one is green.
//
// Owner: ops. Model/provider changes themselves are ai-engineer + user
// approval (P12); this script only observes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts', 'model-id-allowlist.json');

// ─── Scan configuration ─────────────────────────────────────────────────────

/** Roots holding non-test source that can pin a model id. */
const SCAN_ROOTS = [
  'apps/host/src',
  'packages/lib/src',
  'packages/ui/src',
  'supabase/functions',
  'python/services',
  'scripts',
  'eval',
  'mobile/lib',
  'agents',
];

/** Extra roots scanned ONLY for the informational sweep. */
const SWEEP_ROOTS = ['supabase/migrations', 'python/tests', 'e2e'];

const CODE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs', '.js', '.jsx', '.py', '.dart']);
const SWEEP_EXT = new Set([...CODE_EXT, '.sql']);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '__pycache__',
  '.venv', 'venv', '.turbo', 'graphify-out', '_archive', '_legacy',
]);

/**
 * This file. Excluded from its own scan: the header above quotes every dead id
 * in the 2026-08-31 incident by name to explain itself, and the allowlist
 * quotes them again with reasons. Scanning them would make the canary
 * permanently red at the documentation that exists to describe it.
 */
const SELF_EXCLUDE = new Set(['scripts/check-model-ids.mjs', 'scripts/model-id-allowlist.json']);

/** Test-ish paths are swept, not enforced. */
function isTestPath(rel) {
  return (
    /(^|\/)__tests__\//.test(rel) ||
    /(^|\/)__vitest__\//.test(rel) ||
    /(^|\/)tests?\//.test(rel) ||
    /\.(test|spec)\.[a-z]+$/.test(rel) ||
    /\.vitest-harness\.[a-z]+$/.test(rel) ||
    /(^|\/)e2e\//.test(rel) ||
    /(^|\/)fixtures?\//.test(rel) ||
    /(^|\/)cassettes\//.test(rel)
  );
}

// Vacuity floors. A config typo, a moved directory or a bad glob must not be
// able to produce a triumphant green over an empty scan. Same posture as
// check-ai-boundary.mjs's MIN_FILES_LINTED.
const MIN_FILES_SCANNED = 300;
const MIN_IDS_DISCOVERED = 6;
const MIN_CATALOGUE_SIZE = { anthropic: 3, openai: 10, gemini: 3 };

const HTTP_TIMEOUT_MS = 20_000;

// ─── Model-id recognition ───────────────────────────────────────────────────

const FILE_EXT_TAIL = /\.(md|mdx|ts|tsx|js|mjs|cjs|json|sql|py|txt|ya?ml|html|css|png|svg|sh)$/;

/**
 * Near-misses: strings that look like a model family but are NOT concrete model
 * ids — e.g. `family: 'claude-haiku'` / `family: 'gemini-1.5'` in
 * packages/lib/src/ai/gateway/registry.ts. Probing those would produce a
 * guaranteed 404 and a permanently-red canary crying wolf.
 *
 * They are collected and PRINTED rather than dropped in silence: a shape
 * heuristic that quietly discards a string is the same failure mode as a
 * hardcoded list, just better disguised. If a real pin ever lands in here, it
 * is visible in the run output on day one.
 */
const nearMisses = new Map(); // raw -> Set<`file:line`>

/**
 * Provider for a bare id, or null when the string is not a concrete model id.
 * This is the ONLY place the id→provider mapping lives.
 *
 * The `-<digit>` requirement on claude/gemini is what separates a concrete id
 * from a family label. Every Anthropic id carries a version number
 * (claude-3-opus-…, claude-haiku-4-5-…, claude-sonnet-4-6); a bare
 * `claude-haiku` never addresses a model.
 */
function providerOf(id) {
  if (FILE_EXT_TAIL.test(id)) return null; // 'voyage-outage.md', 'claude-outage.md'
  if (/^claude-/.test(id)) return /-\d/.test(id) ? 'anthropic' : null;
  if (/^gemini-/.test(id)) return /^gemini-[\d.]+-[a-z]/.test(id) ? 'gemini' : null;
  if (/^(gpt-\d|chatgpt-|text-embedding-|davinci|babbage|whisper-|tts-|dall-e)/.test(id)) return 'openai';
  if (/^o[1345](-(mini|preview|pro|deep-research))?$/.test(id)) return 'openai';
  // Voyage ids always carry a version digit (voyage-3, rerank-2, rerank-2.5,
  // voyage-large-2-instruct). The digit requirement is what stops identifier-
  // shaped strings like 'rerank-fallback' / 'voyage-error' from being probed.
  if (/^(voyage|rerank)-[a-z0-9.-]*\d/.test(id)) return 'voyage';
  return null;
}

/** True for a string that looks model-ish but failed providerOf — worth showing. */
function isNearMiss(raw) {
  return (
    !FILE_EXT_TAIL.test(raw) &&
    raw.length <= 48 &&
    /^(claude|gemini|gpt|voyage|rerank)-[a-z0-9][a-z0-9.-]*$/.test(raw) &&
    providerOf(raw) === null
  );
}

/** Providers with a free, read-only catalogue endpoint. */
const PROBEABLE = new Set(['anthropic', 'openai', 'gemini']);

/** Full-string-literal form, with an optional `provider/` prefix (PRICING keys). */
const LITERAL_RE = /^(?:(anthropic|openai|gemini|google|voyage|voyageai)\/)?([a-z][a-z0-9][a-z0-9._-]*)$/;

/** Loose form used inside comments and as the raw-fallback safety net. */
const LOOSE_RE =
  /(?:\b(anthropic|openai|gemini|voyage)\/)?\b(claude-[a-z0-9][a-z0-9._-]*|gpt-[a-z0-9][a-z0-9._-]*|gemini-[a-z0-9][a-z0-9._-]*|text-embedding-[a-z0-9][a-z0-9._-]*|voyage-[a-z0-9][a-z0-9._-]*|rerank-[a-z0-9][a-z0-9._-]*|o[1345]-(?:mini|preview|pro))\b/g;

/** Normalise a candidate to `{ id, provider }`, or null if it is not a model id. */
function normalise(raw) {
  const m = LITERAL_RE.exec(raw);
  if (!m) return null;
  const prefix = m[1];
  const id = m[2].replace(/[._-]+$/, '');
  const provider = providerOf(id);
  if (!provider) return null;
  if (prefix && prefix !== 'google' && prefix !== 'voyageai' && prefix !== provider) {
    // Prefix disagrees with the id shape — report under the id's own family.
    return { id, provider };
  }
  return { id, provider };
}

// ─── Comment-aware tokenizer ────────────────────────────────────────────────
//
// Emits { text, line, kind } where kind is 'code' (string literal) or
// 'comment' (line/block comment, or Python triple-quoted docstring). Written
// by hand rather than pulled from a parser because it has to cover TS, JS,
// Python, Dart and SQL uniformly, and because a full parse would choke on the
// Deno-flavoured .ts files under supabase/functions.

function langOf(ext) {
  if (ext === '.py') return 'py';
  if (ext === '.sql') return 'sql';
  return 'c'; // TS/JS/TSX/Dart all share C-family comment + string syntax
}

/** True when a `/` at position i starts a regex literal rather than division. */
function looksLikeRegexStart(src, i) {
  for (let j = i - 1; j >= 0; j--) {
    const c = src[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
    if ('(,=:[!&|?{};+-*%~^<>'.includes(c)) return true;
    if (/[a-zA-Z0-9_$)\]'"`]/.test(c)) {
      // `return /re/` and `typeof x === 'y' ? /re/ : ...` — check for keywords.
      const tail = src.slice(Math.max(0, j - 10), j + 1);
      return /\b(return|typeof|case|in|of|delete|void|new|do|else|yield|await)$/.test(tail);
    }
    return false;
  }
  return true; // start of file
}

function tokenize(src, lang) {
  const out = [];
  let line = 1;
  let i = 0;
  const n = src.length;

  const push = (text, startLine, kind) => {
    if (text) out.push({ text, line: startLine, kind });
  };

  while (i < n) {
    const c = src[i];

    if (c === '\n') { line++; i++; continue; }

    // ── comments ──
    if (lang === 'py' && c === '#') {
      const start = line; let buf = '';
      while (i < n && src[i] !== '\n') { buf += src[i]; i++; }
      push(buf, start, 'comment');
      continue;
    }
    if (lang === 'sql' && c === '-' && src[i + 1] === '-') {
      const start = line; let buf = '';
      while (i < n && src[i] !== '\n') { buf += src[i]; i++; }
      push(buf, start, 'comment');
      continue;
    }
    if ((lang === 'c' || lang === 'sql') && c === '/' && src[i + 1] === '/') {
      const start = line; let buf = '';
      while (i < n && src[i] !== '\n') { buf += src[i]; i++; }
      push(buf, start, 'comment');
      continue;
    }
    if ((lang === 'c' || lang === 'sql') && c === '/' && src[i + 1] === '*') {
      const start = line; let buf = ''; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        buf += src[i]; i++;
      }
      i += 2;
      push(buf, start, 'comment');
      continue;
    }

    // ── Python triple-quoted (docstring): treated as comment. A routing pin
    //    has never lived inside one, and the raw-fallback pass below still
    //    surfaces the id if that assumption is ever wrong. ──
    if (lang === 'py' && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
      const q = src.slice(i, i + 3);
      const start = line; let buf = ''; i += 3;
      while (i < n && !src.startsWith(q, i)) {
        if (src[i] === '\n') line++;
        buf += src[i]; i++;
      }
      i += 3;
      push(buf, start, 'comment');
      continue;
    }

    // ── string literals ──
    if (c === "'" || c === '"' || (lang === 'c' && c === '`')) {
      const quote = c;
      const start = line; let buf = ''; i++;
      while (i < n) {
        if (src[i] === '\\') { buf += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (lang === 'sql' && quote === "'" && src[i] === "'" && src[i + 1] === "'") {
          buf += "''"; i += 2; continue; // SQL escaped quote
        }
        if (src[i] === quote) { i++; break; }
        if (src[i] === '\n') { line++; }
        buf += src[i]; i++;
      }
      push(buf, start, 'code');
      continue;
    }

    // ── regex literal: skip, so `/['"]/` cannot open a phantom string ──
    if (lang === 'c' && c === '/' && looksLikeRegexStart(src, i)) {
      i++;
      let inClass = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { i++; break; }
        i++;
      }
      continue;
    }

    i++;
  }
  return out;
}

// ─── Discovery ──────────────────────────────────────────────────────────────

function* walk(absRoot) {
  if (!fs.existsSync(absRoot)) return;
  const stack = [absRoot];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(abs);
      } else if (e.isFile()) {
        yield abs;
      }
    }
  }
}

const relPosix = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join('/');

/**
 * @returns {{ ids: Map<string, {provider: string, refs: Array<{file:string,line:number,kind:string,note?:string}>}>, files: number }}
 */
function discover(roots, extSet, { enforcedOnly }) {
  /** @type {Map<string, {provider: string, refs: any[]}>} */
  const ids = new Map();
  let files = 0;

  const record = (id, provider, file, line, kind, note) => {
    let entry = ids.get(id);
    if (!entry) { entry = { provider, refs: [] }; ids.set(id, entry); }
    entry.refs.push({ file, line, kind, ...(note ? { note } : {}) });
  };

  for (const root of roots) {
    for (const abs of walk(path.join(REPO_ROOT, root))) {
      const ext = path.extname(abs);
      if (!extSet.has(ext)) continue;
      const rel = relPosix(abs);
      if (SELF_EXCLUDE.has(rel)) continue;
      const testish = isTestPath(rel);
      if (enforcedOnly && testish) continue;
      if (!enforcedOnly && !testish && ext !== '.sql') continue; // sweep = tests + SQL only

      let src;
      try { src = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      files++;
      if (!/claude-|gpt-|gemini-|voyage-|rerank-|text-embedding-|\bo[1345]\b/.test(src)) continue;

      const tokens = tokenize(src, langOf(ext));
      const seen = new Set(); // `${line}::${id}` — for the raw-fallback diff

      for (const t of tokens) {
        if (t.kind === 'code') {
          if (t.text.includes('${')) continue;
          const raw = t.text.trim();
          const hit = normalise(raw);
          if (hit) {
            record(hit.id, hit.provider, rel, t.line, 'code');
            seen.add(`${t.line}::${hit.id}`);
            continue;
          }
          if (enforcedOnly && isNearMiss(raw)) {
            if (!nearMisses.has(raw)) nearMisses.set(raw, new Set());
            nearMisses.get(raw).add(`${rel}:${t.line}`);
            continue;
          }
          // A model id embedded INSIDE a sentence — a log line, an error
          // message, a feature-flag `reason` blurb — is prose, not a pin. A
          // config pin is always the whole literal (or `provider/model`). Left
          // unclassified it would be enforced, so a flag description that
          // merely NAMES a retired model would turn the canary red for no
          // reason. Recorded and printed, never enforced.
          if (/\s/.test(raw)) {
            LOOSE_RE.lastIndex = 0;
            let pm;
            while ((pm = LOOSE_RE.exec(raw)) !== null) {
              const id = pm[2].replace(/[._-]+$/, '');
              const provider = providerOf(id);
              if (!provider) continue;
              const proseLine = t.line + (raw.slice(0, pm.index).match(/\n/g)?.length ?? 0);
              record(id, provider, rel, proseLine, 'prose');
              seen.add(`${proseLine}::${id}`);
            }
          }
        } else {
          LOOSE_RE.lastIndex = 0;
          let m;
          while ((m = LOOSE_RE.exec(t.text)) !== null) {
            const id = m[2].replace(/[._-]+$/, '');
            const provider = providerOf(id);
            if (!provider) continue;
            const commentLine = t.line + (t.text.slice(0, m.index).match(/\n/g)?.length ?? 0);
            record(id, provider, rel, commentLine, 'comment');
            seen.add(`${commentLine}::${id}`);
          }
        }
      }

      // Raw-fallback safety net: anything the tokenizer never emitted at all.
      // A tokenizer bug must not make an id vanish from the inventory.
      const lines = src.split('\n');
      for (let li = 0; li < lines.length; li++) {
        LOOSE_RE.lastIndex = 0;
        let m;
        while ((m = LOOSE_RE.exec(lines[li])) !== null) {
          const id = m[2].replace(/[._-]+$/, '');
          const provider = providerOf(id);
          if (!provider) continue;
          if (seen.has(`${li + 1}::${id}`)) continue;
          record(id, provider, rel, li + 1, 'code', 'raw-fallback');
        }
      }
    }
  }

  return { ids, files };
}

// ─── Provider probes ────────────────────────────────────────────────────────

class Unverifiable extends Error {}

async function httpJson(url, headers) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function anthropicCatalogue(key) {
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  const ids = new Set();
  let url = 'https://api.anthropic.com/v1/models?limit=1000';
  for (let page = 0; page < 10; page++) {
    const { status, body } = await httpJson(url, headers);
    if (status === 401 || status === 403) {
      throw new Unverifiable(`Anthropic rejected the key (HTTP ${status}). Cannot probe.`);
    }
    if (status !== 200 || !body || !Array.isArray(body.data)) {
      throw new Unverifiable(`Anthropic GET /v1/models returned HTTP ${status}. Cannot probe.`);
    }
    for (const m of body.data) if (m && typeof m.id === 'string') ids.add(m.id);
    if (!body.has_more || !body.last_id) break;
    url = `https://api.anthropic.com/v1/models?limit=1000&after_id=${encodeURIComponent(body.last_id)}`;
  }
  return ids;
}

async function anthropicConfirm(key, id) {
  const { status } = await httpJson(`https://api.anthropic.com/v1/models/${encodeURIComponent(id)}`, {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  });
  if (status === 200) return 'ALIVE';
  if (status === 404) return 'DEAD';
  throw new Unverifiable(`Anthropic GET /v1/models/${id} returned HTTP ${status}.`);
}

async function openaiCatalogue(key) {
  const { status, body } = await httpJson('https://api.openai.com/v1/models', {
    Authorization: `Bearer ${key}`,
  });
  if (status === 401 || status === 403) {
    throw new Unverifiable(`OpenAI rejected the key (HTTP ${status}). Cannot probe.`);
  }
  if (status !== 200 || !body || !Array.isArray(body.data)) {
    throw new Unverifiable(`OpenAI GET /v1/models returned HTTP ${status}. Cannot probe.`);
  }
  return new Set(body.data.map((m) => m && m.id).filter((x) => typeof x === 'string'));
}

async function openaiConfirm(key, id) {
  const { status } = await httpJson(`https://api.openai.com/v1/models/${encodeURIComponent(id)}`, {
    Authorization: `Bearer ${key}`,
  });
  if (status === 200) return 'ALIVE';
  if (status === 404) return 'DEAD';
  throw new Unverifiable(`OpenAI GET /v1/models/${id} returned HTTP ${status}.`);
}

async function geminiCatalogue(key) {
  const { status, body } = await httpJson(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1000`,
    {},
  );
  if (status !== 200 || !body || !Array.isArray(body.models)) {
    throw new Unverifiable(`Gemini GET /v1beta/models returned HTTP ${status}. Cannot probe.`);
  }
  return new Set(body.models.map((m) => String(m.name || '').replace(/^models\//, '')));
}

// ─── Allowlist ──────────────────────────────────────────────────────────────

function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    console.error(`::error::Allowlist missing: ${relPosix(ALLOWLIST_PATH)}`);
    console.error('Without it the canary cannot tell a knowingly-dormant id from a live dead pin.');
    process.exit(2);
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8')); } catch (err) {
    console.error(`::error::Allowlist is not valid JSON: ${err.message}`);
    process.exit(2);
  }
  if (!parsed || !Array.isArray(parsed.allow)) {
    console.error('::error::Allowlist is malformed (expected an `allow` array).');
    process.exit(2);
  }
  const map = new Map();
  for (const e of parsed.allow) {
    if (!e || typeof e.id !== 'string' || typeof e.reason !== 'string' || e.reason.trim().length < 20) {
      console.error(
        `::error::Allowlist entry ${JSON.stringify(e && e.id)} needs a non-empty \`reason\` of >=20 chars. ` +
          'An unexplained allowlist entry is indistinguishable from a silent skip.',
      );
      process.exit(2);
    }
    map.set(e.id, e);
  }
  return map;
}

// ─── Reporting helpers ──────────────────────────────────────────────────────

const SAMPLE_REFS = 6;

function formatRefs(refs, showAll) {
  const codeFirst = [...refs].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'code' ? -1 : 1));
  const shown = showAll ? codeFirst : codeFirst.slice(0, SAMPLE_REFS);
  const lines = shown.map(
    (r) => `        ${r.file}:${r.line}  [${r.kind}${r.note ? ` ${r.note}` : ''}]`,
  );
  if (!showAll && codeFirst.length > shown.length) {
    lines.push(`        … +${codeFirst.length - shown.length} more reference(s) (--verbose for all)`);
  }
  return lines;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function loadDotEnv() {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(REPO_ROOT, name);
    if (!fs.existsSync(p)) continue;
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      if (process.env[k] !== undefined) continue; // real env always wins
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[k] = v;
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const VERBOSE = argv.includes('--verbose');
  const JSON_OUT = argv.includes('--json');
  // --json must produce a PARSEABLE document on stdout. Left alone, the human
  // report interleaves with the payload and `JSON.parse` chokes — a flag
  // documented as machine-readable that no machine can read is worse than no
  // flag. In JSON mode every human line goes to stderr (still visible, still
  // useful in CI logs) and stdout carries the payload and nothing else.
  if (JSON_OUT) {
    console.log = (...a) => process.stderr.write(`${a.join(' ')}
`);
  }
  const SWEEP = !argv.includes('--no-sweep');
  const injectArg = argv.find((a) => a.startsWith('--inject-dead='));
  const INJECT = injectArg ? injectArg.slice('--inject-dead='.length) : null;
  const providerArg = argv.find((a) => a.startsWith('--provider='));
  const SCOPE = providerArg ? providerArg.slice('--provider='.length) : null;
  for (const a of argv) {
    if (!/^--(verbose|json|no-sweep|provider=.+|inject-dead=.+)$/.test(a)) {
      console.error(`::error::Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  // A typo'd scope must not silently probe nothing and exit 0. Restricted to
  // the two providers that actually have a live catalogue endpoint AND a key
  // in CI; gemini/voyage stay inventoried-never-enforced either way.
  const SCOPABLE = new Set(['anthropic', 'openai']);
  if (SCOPE !== null && !SCOPABLE.has(SCOPE)) {
    console.error(
      `::error::--provider=${SCOPE} is not a scopable provider. Expected one of: ${[...SCOPABLE].join(', ')}.`,
    );
    process.exit(2);
  }
  // `inScope` is the ONLY place scoping is decided. Unscoped runs answer true
  // for everything, so the full-run behaviour below is byte-identical to
  // before this flag existed.
  const inScope = (provider) => SCOPE === null || provider === SCOPE;

  loadDotEnv();

  // ── 1. discover ──
  const { ids: configured, files: filesScanned } = discover(SCAN_ROOTS, CODE_EXT, { enforcedOnly: true });

  if (INJECT) {
    const provider = providerOf(INJECT);
    if (!provider) {
      console.error(`::error::--inject-dead=${INJECT} is not a recognised model-id shape.`);
      process.exit(2);
    }
    // A self-test whose injected id belongs to an unscoped provider would be
    // stamped NOT-PROBED and the run would exit 0 — i.e. the one command whose
    // entire job is to prove the canary bites would report that it does not.
    // Refuse the combination rather than answer it wrongly.
    if (!inScope(provider)) {
      console.error(
        `::error::--inject-dead=${INJECT} is a ${provider} id but this run is scoped to --provider=${SCOPE}. ` +
          'The injected id would be NOT-PROBED and the self-test would falsely pass. ' +
          `Re-run with --provider=${provider}, or without --provider.`,
      );
      process.exit(2);
    }
    configured.set(INJECT, {
      provider,
      refs: [{ file: '<--inject-dead self-test>', line: 0, kind: 'code', note: 'injected' }],
    });
    console.log(`::warning::SELF-TEST MODE — injected '${INJECT}' into the configured set as if it were pinned in source.`);
  }

  console.log('Model-id canary — discovery');
  console.log(`  roots:     ${SCAN_ROOTS.join(', ')}`);
  console.log(`  scanned:   ${filesScanned} source file(s)`);
  console.log(`  discovered:${String(configured.size).padStart(3)} distinct model id(s)`);
  console.log(
    SCOPE === null
      ? '  scope:     ALL providers (unscoped run)'
      : `  scope:     ${SCOPE} ONLY — ids of every other provider are NOT PROBED in this run ` +
          'and are reported NOT-PROBED, never ALIVE. Discovery above is NOT scoped.',
  );
  if (nearMisses.size > 0) {
    console.log('');
    console.log('  Model-ish strings NOT probed — a family label, or an id with no version number.');
    console.log('  Listed so the exclusion is never silent; an id missing its version is itself a smell:');
    for (const [raw, where] of [...nearMisses].sort()) {
      console.log(`    '${raw}'  ${[...where].slice(0, 3).join(', ')}${where.size > 3 ? ` (+${where.size - 3})` : ''}`);
    }
    console.log('    If any line above is actually a pinned model id, providerOf() in this script is wrong.');
  }
  console.log('');

  if (filesScanned < MIN_FILES_SCANNED) {
    console.error(
      `::error::Discovery scanned only ${filesScanned} files (floor: ${MIN_FILES_SCANNED}). It did not see the ` +
        'real source tree, so a green result would be vacuous. Failing CLOSED. Check SCAN_ROOTS in ' +
        `${relPosix(fileURLToPath(import.meta.url))}.`,
    );
    process.exit(3);
  }
  if (configured.size < MIN_IDS_DISCOVERED) {
    console.error(
      `::error::Discovery found only ${configured.size} model id(s) (floor: ${MIN_IDS_DISCOVERED}). The extractor ` +
        'is broken or the repo moved. Failing CLOSED rather than reporting a vacuous pass.',
    );
    process.exit(3);
  }

  const allowlist = readAllowlist();

  // ── 2. partition ──
  /** @type {Map<string, string[]>} provider -> ids */
  const byProvider = new Map();
  const codeIds = [];      // >=1 string-literal reference: enforced (unless allowlisted)
  const commentOnly = [];  // referenced only in comments: reported, never enforced
  for (const [id, entry] of configured) {
    (entry.refs.some((r) => r.kind === 'code') ? codeIds : commentOnly).push(id);
    if (!byProvider.has(entry.provider)) byProvider.set(entry.provider, []);
    byProvider.get(entry.provider).push(id);
  }

  // A provider is REQUIRED only when an id that could actually fail the run
  // belongs to it. An allowlisted id cannot fail the run, so a missing Gemini
  // key must not turn a healthy Anthropic/OpenAI check into "cannot verify".
  const probeProviders = new Set(
    codeIds
      .filter((id) => !allowlist.has(id))
      .map((id) => configured.get(id).provider)
      .filter((p) => PROBEABLE.has(p))
      .filter(inScope),
  );
  // Also probe providers that only appear in comment-only / allowlisted ids, so
  // the report can state their status too — but never let a missing key for one
  // of THOSE providers fail the run.
  const reportProviders = new Set(
    [...configured.values()].map((e) => e.provider).filter((p) => PROBEABLE.has(p)).filter(inScope),
  );

  // VACUITY FLOOR FOR SCOPED RUNS. Discovery's floors (above) prove the tree was
  // seen; this proves the SCOPE has something at stake. `--provider=openai` in a
  // repo with no enforced OpenAI pin would otherwise probe nothing, find no dead
  // ids, and exit 0 — a green check whose green means nothing. That is the same
  // manufactured-confidence failure MIN_IDS_DISCOVERED exists to stop, so it
  // gets the same answer: fail closed.
  // Providers that have at least one id which COULD fail a run, regardless of
  // this run's scope. Used below to name the coverage handoff explicitly: the
  // split only holds if some job scopes to each of these. A provider in this
  // set that no job ever scopes to has NO canary coverage anywhere — which is
  // a false green spread across two files instead of one, so it gets named in
  // the output rather than left to be inferred from the workflow.
  const enforcedProviders = new Set(
    codeIds
      .filter((id) => !allowlist.has(id))
      .map((id) => configured.get(id).provider)
      .filter((p) => PROBEABLE.has(p)),
  );
  const handoffProviders = [...enforcedProviders].filter((p) => !inScope(p)).sort();

  if (SCOPE !== null && probeProviders.size === 0) {
    console.error(
      `::error::--provider=${SCOPE} matched 0 enforced model id(s). This run would probe nothing and ` +
        'exit green without checking anything. Failing CLOSED. Either the scope is wrong, or every ' +
        `${SCOPE} id is now allowlisted/comment-only — in which case drop this job rather than let it ` +
        'stand as a green check that verifies nothing.',
    );
    process.exit(3);
  }

  const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };

  // ── 3. probe ──
  const catalogues = new Map();
  const unverifiable = [];
  console.log('Model-id canary — provider catalogues');
  for (const provider of [...reportProviders].sort()) {
    const envName = KEY_ENV[provider];
    const key = process.env[envName];
    const required = probeProviders.has(provider);
    if (!key) {
      const msg = `${envName} is not set — cannot probe ${provider}.`;
      console.log(`  ${provider.padEnd(10)} key: MISSING (${envName})`);
      if (required) unverifiable.push(msg);
      continue;
    }
    try {
      const set =
        provider === 'anthropic' ? await anthropicCatalogue(key)
        : provider === 'openai' ? await openaiCatalogue(key)
        : await geminiCatalogue(key);
      if (set.size < (MIN_CATALOGUE_SIZE[provider] ?? 1)) {
        throw new Unverifiable(
          `${provider} catalogue returned only ${set.size} model(s) (floor: ${MIN_CATALOGUE_SIZE[provider]}). ` +
            'That is not a plausible catalogue; treating it as unverified.',
        );
      }
      catalogues.set(provider, set);
      console.log(`  ${provider.padEnd(10)} key: present   catalogue: ${set.size} model(s)`);
    } catch (err) {
      const detail = err instanceof Unverifiable ? err.message : `${provider} probe failed: ${err.message}`;
      console.log(`  ${provider.padEnd(10)} key: present   catalogue: UNAVAILABLE`);
      if (required) unverifiable.push(detail);
      else console.log(`             (not required this run) ${detail}`);
    }
  }
  console.log('');

  if (unverifiable.length > 0) {
    console.error('::error::COULD NOT VERIFY — the canary was unable to probe a provider it needed.');
    for (const u of unverifiable) console.error(`    ${u}`);
    console.error('');
    console.error('This is NOT a green result and NOT the same as "a model died". Exit 3.');
    console.error('If this fired in CI: the required secret probably does not resolve for this job.');
    console.error('See the secret notes in .github/workflows/model-id-canary.yml.');
    process.exit(3);
  }

  // ── 4. classify ──
  const statuses = new Map(); // id -> 'ALIVE' | 'DEAD' | 'UNPROBEABLE'
  const confirmFailures = [];
  for (const [id, entry] of configured) {
    const { provider } = entry;
    if (!PROBEABLE.has(provider)) { statuses.set(id, 'UNPROBEABLE'); continue; }
    // Out of scope for THIS run. Deliberately its own status, not ALIVE and not
    // UNPROBEABLE: "nobody looked" must never read as "we looked and it was
    // fine", and it is also not the permanent no-catalogue-endpoint condition
    // that UNPROBEABLE means for Voyage. In an unscoped run this branch is
    // unreachable, so full-run output is unchanged.
    if (!inScope(provider)) { statuses.set(id, 'NOT-PROBED'); continue; }
    const cat = catalogues.get(provider);
    if (!cat) { statuses.set(id, 'UNPROBEABLE'); continue; }
    if (cat.has(id)) { statuses.set(id, 'ALIVE'); continue; }
    // Absent from the list. Confirm per-id before calling it dead: an undated
    // alias resolves on the retrieve endpoint while never appearing in the list.
    try {
      const verdict =
        provider === 'anthropic' ? await anthropicConfirm(process.env.ANTHROPIC_API_KEY, id)
        : provider === 'openai' ? await openaiConfirm(process.env.OPENAI_API_KEY, id)
        : 'DEAD';
      statuses.set(id, verdict);
    } catch (err) {
      statuses.set(id, 'UNKNOWN');
      if (entry.refs.some((r) => r.kind === 'code') && !allowlist.has(id)) {
        confirmFailures.push(`${id} (${provider}): ${err.message}`);
      }
    }
  }

  if (confirmFailures.length > 0) {
    console.error('::error::COULD NOT VERIFY — per-id confirmation failed for an enforced id.');
    for (const c of confirmFailures) console.error(`    ${c}`);
    process.exit(3);
  }

  // ── 5. report ──
  const dead = [];
  const allowlistedDead = [];
  const unprobeable = [];
  const notProbed = [];

  const order = (id) => {
    const s = statuses.get(id);
    return s === 'DEAD' ? 0 : s === 'UNPROBEABLE' ? 3 : s === 'NOT-PROBED' ? 2 : 1;
  };
  const sorted = [...configured.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b));

  console.log('Model-id canary — configured inventory');
  console.log('');
  for (const id of sorted) {
    const entry = configured.get(id);
    const status = statuses.get(id);
    const isCode = entry.refs.some((r) => r.kind === 'code');
    const allow = allowlist.get(id);

    let label;
    if (!isCode) label = `${status} / mention-only`;
    else if (allow) label = `${status} / ALLOWLISTED`;
    else label = status;

    if (status === 'DEAD' && isCode) (allow ? allowlistedDead : dead).push(id);
    if (status === 'UNPROBEABLE') unprobeable.push(id);
    if (status === 'NOT-PROBED') notProbed.push(id);

    const marker = status === 'DEAD' && isCode && !allow ? '!!' : '  ';
    console.log(`${marker} ${label.padEnd(26)} ${entry.provider.padEnd(10)} ${id}  (${entry.refs.length} ref(s))`);
    const showAll = VERBOSE || (status === 'DEAD' && isCode);
    for (const l of formatRefs(entry.refs, showAll)) console.log(l);
    if (allow) console.log(`        allowlisted: ${allow.reason}`);
    console.log('');
  }

  if (notProbed.length > 0) {
    console.log(`NOTE — ${notProbed.length} id(s) above are NOT-PROBED: this run is scoped to --provider=${SCOPE},`);
    console.log('       and they belong to another provider. Their liveness is UNKNOWN in this run — it is');
    console.log('       NOT "fine". They are covered by that provider\'s own scoped job; if that job is not');
    console.log('       running or is red, these ids have no coverage at all. See the job split in');
    console.log('       .github/workflows/model-id-canary.yml and docs/runbooks/model-id-canary.md.');
    if (handoffProviders.length > 0) {
      console.log('');
      console.log(`       COVERAGE HANDOFF — enforced (fail-capable) ids exist for: ${handoffProviders.join(', ')}.`);
      console.log('       Each of those providers MUST have its own scoped job. If one does not, its pins');
      console.log('       are checked by nothing and no run anywhere will ever go red for them.');
    }
    console.log('');
  }

  if (unprobeable.length > 0) {
    console.log('NOTE — UNPROBEABLE ids above belong to a provider that publishes no free catalogue');
    console.log('       endpoint (Voyage). They are inventoried so they stay visible, but this canary');
    console.log('       cannot vouch for them. Verifying those is a separate, unclosed gap; see');
    console.log('       docs/runbooks/model-id-canary.md.');
    console.log('');
  }

  // stale allowlist entries — a ratchet hint, mirroring check-ai-boundary.mjs
  const stale = [...allowlist.keys()].filter((id) => !configured.has(id));
  if (stale.length > 0) {
    console.log('Ratchet opportunity (not a failure) — allowlisted ids no longer referenced anywhere:');
    for (const id of stale) console.log(`    ${id}  — delete this entry from ${relPosix(ALLOWLIST_PATH)}`);
    console.log('');
  }
  const revived = [...allowlist.keys()].filter((id) => configured.has(id) && statuses.get(id) === 'ALIVE');
  if (revived.length > 0) {
    console.log('FYI — allowlisted ids that currently resolve fine (the allowlist is not needed for them today):');
    for (const id of revived) console.log(`    ${id}`);
    console.log('');
  }

  // ── 6. informational sweep ──
  if (SWEEP) {
    const { ids: swept } = discover([...SCAN_ROOTS, ...SWEEP_ROOTS], SWEEP_EXT, { enforcedOnly: false });
    // Show an id when it is unknown to the enforced inventory, OR when it IS
    // known but does not resolve — a retired id that also sits in a SQL column
    // DEFAULT is stamping every new row with a dead label, and that is invisible
    // if the sweep only reports ids it has never seen before.
    const extras = [...swept.keys()].filter(
      (id) => !configured.has(id) || statuses.get(id) === 'DEAD' || statuses.get(id) === 'UNKNOWN',
    );
    if (extras.length > 0) {
      console.log('Sweep — model ids in tests / vitest harnesses / SQL migrations (never enforced)');
      console.log('        Migrations are forward-only immutable history, so a retired id in a pricing');
      console.log('        row is CORRECT there. A retired id in a column DEFAULT is not: it stamps');
      console.log('        every NEW row with a dead label. An id absent from the catalogue was either');
      console.log('        retired or never real — both are worth a human look.');
      console.log('');
      for (const id of extras.sort()) {
        const entry = swept.get(id);
        const cat = catalogues.get(entry.provider);
        const status = !PROBEABLE.has(entry.provider)
          ? 'UNPROBEABLE'
          : !inScope(entry.provider) ? 'NOT-PROBED'
          : !cat ? 'UNPROBEABLE'
          : cat.has(id) ? 'IN-CATALOGUE' : 'NOT-IN-CATALOGUE';
        const known = configured.has(id) ? '  [also in enforced config]' : '';
        console.log(`   ${status.padEnd(18)} ${entry.provider.padEnd(10)} ${id}  (${entry.refs.length} ref(s))${known}`);
        for (const l of formatRefs(entry.refs, VERBOSE)) console.log(l);
      }
      console.log('');
    }
  }

  // ── 7. verdict ──
  if (JSON_OUT) {
    const payload = {
      generated: new Date().toISOString(),
      filesScanned,
      // `scope` is null on a full run. A consumer that aggregates two scoped
      // runs MUST read this: a payload whose scope is 'anthropic' says nothing
      // about any OpenAI id in it, and each such id carries status
      // 'NOT-PROBED' to say so per-id as well.
      scope: SCOPE,
      ids: [...configured.entries()].map(([id, e]) => ({
        id,
        provider: e.provider,
        status: statuses.get(id),
        // `enforced` describes the id's standing in config. In a scoped run an
        // enforced id can still be NOT-PROBED — enforced does not imply checked.
        enforced: e.refs.some((r) => r.kind === 'code') && !allowlist.has(id),
        probed: statuses.get(id) !== 'NOT-PROBED',
        allowlisted: allowlist.has(id),
        refs: e.refs,
      })),
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
  }

  if (dead.length > 0) {
    console.error(`::error::${dead.length} configured model id(s) NO LONGER RESOLVE at the provider:`);
    for (const id of dead) {
      const e = configured.get(id);
      console.error(`    ${e.provider}/${id}`);
      for (const r of e.refs.filter((x) => x.kind === 'code')) {
        console.error(`        ${r.file}:${r.line}`);
      }
    }
    console.error('');
    console.error('Every request routed to one of these burns a guaranteed-failing round trip and then');
    console.error('silently degrades to whatever the next fallback rung is — which is exactly the');
    console.error('2026-08-31 Foxy Sonnet incident. Repin to a verified-available model.');
    console.error('Repinning a LIVE path is a P12 / model-approval change: ai-engineer implements,');
    console.error('assessment reviews, user approves. Runbook: docs/runbooks/model-id-canary.md');
    console.error('');
    console.error('If an id is knowingly-unreachable dead config, add it to');
    console.error(`${relPosix(ALLOWLIST_PATH)} with a per-entry reason — not a silent skip.`);
    process.exit(1);
  }

  if (allowlistedDead.length > 0) {
    console.log(`::warning::${allowlistedDead.length} allowlisted id(s) are DEAD at the provider:`);
    for (const id of allowlistedDead) {
      console.log(`    ${id} — ${allowlist.get(id).reason}`);
    }
    console.log('  Not a failure, by explicit decision. It IS a landmine for whoever revives that code.');
    console.log('');
  }

  if (SCOPE === null) {
    console.log('Model-id canary: PASS — every enforced model id resolves at its provider.');
  } else {
    // Never print the unqualified PASS line on a scoped run. Someone reading a
    // log tail must not be able to mistake "anthropic is fine" for "everything
    // is fine" — the scope and the un-probed count are part of the verdict.
    console.log(
      `Model-id canary: PASS (scope: ${SCOPE}) — every enforced ${SCOPE} model id resolves at its provider. ` +
        `${notProbed.length} id(s) belonging to other providers were NOT PROBED in this run and are NOT ` +
        'covered by this result.',
    );
  }
}

main().catch((err) => {
  console.error(`::error::Model-id canary crashed: ${err && err.stack ? err.stack : err}`);
  console.error('A crash is NOT a pass. Exit 3 (could not verify).');
  process.exit(3);
});
