/**
 * REGRESSION — shadow confidence v2 STATIC source pins.
 *
 * These are the invariants that cannot be proven by calling a function,
 * because they are properties of the SOURCE TREE:
 *
 *   (1) `confidence_v2` is NEVER compared to a threshold, anywhere. It is
 *       recorded and nothing else. The strict-mode abstain gate in
 *       pipeline.ts still reads the v1 `confidence`. The moment a comparison
 *       operator appears next to confidence_v2, the column stops being shadow
 *       data and starts being an ungated behaviour change.
 *   (2) NULL is never coerced to 0 at the SOURCE-CODE hops that the
 *       behavioural tests cannot reach: `mapNcertRow` (RPC row → chunk),
 *       `adaptChunk` (unified chunk → grounded-answer chunk), and the two
 *       `topCosineSimilarity` stamps.
 *   (5) The `match_rag_chunks_ncert` OVERLOAD COUNT stays at 2, and the live
 *       overload keeps `p_min_similarity` + `p_quality_score_gate`.
 *       PostgREST resolves overloads by argument NAME; a third overload
 *       re-opens the production defect fixed in PR #1394, where the caller
 *       silently bound a stale floor-less overload. Nothing in CI failed when
 *       that happened. This test is that missing failure.
 *
 * Location-resolved (fileURLToPath), NOT cwd-resolved — a cwd-relative scan
 * silently narrows to a handful of files and passes while proving nothing.
 * Every scan below asserts a MINIMUM file count for exactly that reason.
 *
 * P12 (AI safety / grounding honesty).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Repo root, resolved from THIS FILE's location ───────────────────────────
// NOTE: `supabase/…` is a USELESS marker here. `src/__tests__/setup.ts` patches
// fs.existsSync to transparently remap `apps/host/supabase/**` onto the repo
// root, so probing for `supabase/migrations` "succeeds" at apps/host and the
// walk stops one level too early — which is precisely how a scan silently
// narrows from 2400 files to 208. `packages/` and `apps/` are NOT in that
// shim's remap set, so they are honest markers.
function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (
    !(
      fs.existsSync(path.join(dir, 'packages', 'lib', 'src')) &&
      fs.existsSync(path.join(dir, 'apps', 'host', 'src'))
    ) &&
    path.dirname(dir) !== dir
  ) {
    dir = path.dirname(dir);
  }
  return dir;
}

const ROOT = repoRoot();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/**
 * Strip `//` and block comments so explanatory prose cannot trip a scan,
 * WITHOUT touching string literals.
 *
 * A naive line-comment regex eats the double slash in
 * `'https://api.voyageai.com/v1/rerank'`, unbalances the quotes, and then a
 * naive string-stripper devours most of the file — which makes every
 * `not.toMatch` pass vacuously. This is a real quote-aware scanner for exactly
 * that reason. Newlines are preserved so line-anchored regexes still behave.
 */
function codeOnly(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const skipped = src.slice(i, end === -1 ? src.length : end + 2);
      out += skipped.replace(/[^\n]/g, ' ');
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const SCAN_DIRS = [
  'supabase/functions',
  'packages/lib/src',
  'packages/ui/src',
  'apps/host/src',
  'mobile/lib',
  'eval',
  'scripts',
];
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '__tests__',
  '__vitest__',
  '_archive',
  '.next',
  'dist',
]);
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.dart']);

function walkCodeFiles(): string[] {
  const out: string[] = [];
  const stack = SCAN_DIRS.map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d));
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(entry.name)) continue;
        stack.push(path.join(dir, entry.name));
      } else if (CODE_EXT.has(path.extname(entry.name))) {
        out.push(path.join(dir, entry.name));
      }
    }
  }
  return out;
}

// The four production modules that legitimately touch the shadow values.
const SHADOW_TOUCHING_FILES = [
  'supabase/functions/grounded-answer/confidence-v2.ts',
  'supabase/functions/grounded-answer/pipeline.ts',
  'supabase/functions/grounded-answer/pipeline-stream.ts',
  'supabase/functions/grounded-answer/trace.ts',
];

describe('REGRESSION — confidence_v2 is shadow-only: never compared to a threshold', () => {
  const ALL_FILES = walkCodeFiles();

  it('the scan actually covers the tree (guards against a silently-narrowed glob)', () => {
    // A cwd-relative or mis-rooted scan collapses to a handful of files and
    // then "passes" while proving nothing. Actual at time of writing: ~2400
    // across the six roots. 1500 is a deliberately loose floor.
    expect(ROOT.endsWith(`apps${path.sep}host`)).toBe(false);
    expect(ALL_FILES.length).toBeGreaterThan(1500);
    for (const rel of SHADOW_TOUCHING_FILES) {
      expect(ALL_FILES).toContain(path.join(ROOT, rel));
    }
  });

  // Any relational or equality operator adjacent to the shadow identifier.
  // Assignment (`=`) and the object-literal colon are deliberately NOT matched
  // — recording is the whole point.
  const COMPARISONS = [
    /confidence_?[vV]2(?:_?[sS]ource)?\s*(?:<=|>=|===|!==|==|!=|<|>)/,
    /(?:<=|>=|===|!==|==|!=|<|>)\s*(?:\w+\.)*confidence_?[vV]2\b/,
    // Ternary/guard shapes that turn the value into a decision.
    /confidence_?[vV]2\s*\?\?[^\n]*\?/,
  ];

  it('the comparison detector actually detects (meta-pin against a dead regex)', () => {
    const violations = [
      'if (confidence_v2 < STRICT_CONFIDENCE_ABSTAIN_THRESHOLD) return abstain();',
      'if (ctx.confidenceV2 >= 0.5) {}',
      'const bad = shadowV2.confidence_v2 > threshold;',
      "if (confidenceV2Source === 'rerank') {}",
      'return abstain if 0.4 > ctx.confidenceV2;',
      'const g = confidence_v2 ?? 0 < 0.5 ? 1 : 2;',
    ];
    for (const v of violations) {
      expect(COMPARISONS.some((re) => re.test(v))).toBe(true);
    }
    // And it must NOT flag the legitimate record-only shapes actually in use.
    const allowed = [
      'confidence_v2: ctx.confidenceV2 ?? null,',
      'ctx.confidenceV2 = shadowV2.confidence_v2;',
      'confidence_v2: computeConfidence({',
      'confidence_v2?: number | null;',
    ];
    for (const a of allowed) {
      expect(COMPARISONS.some((re) => re.test(a))).toBe(false);
    }
  });

  it('no production file compares confidence_v2 / confidenceV2 to anything', () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const raw = fs.readFileSync(file, 'utf-8');
      if (!/confidence_?[vV]2/.test(raw)) continue;
      const code = codeOnly(raw);
      for (const re of COMPARISONS) {
        if (re.test(code)) offenders.push(`${path.relative(ROOT, file)} :: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only the four known modules reference the shadow identifier at all', () => {
    const mentioning = ALL_FILES.filter((f) =>
      /confidence_?[vV]2/.test(fs.readFileSync(f, 'utf-8')),
    )
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .sort();
    // A NEW consumer is not automatically wrong — but it must be reviewed
    // against invariant (1) before this list grows.
    expect(mentioning).toEqual([...SHADOW_TOUCHING_FILES].sort());
  });

  it('the comment stripper preserved the code (guards a vacuous not.toMatch)', () => {
    const raw = read('supabase/functions/_shared/reranking.ts');
    const code = codeOnly(raw);
    expect(code.length).toBeGreaterThan(raw.length * 0.4);
    expect(code).toContain("const RERANK_ENDPOINT = 'https://api.voyageai.com/v1/rerank'");
    expect(code).toContain('function identityResult(');
    // Prose IS gone.
    expect(code).not.toContain('NEVER coerce it to 0');
  });

  it('the strict-mode abstain gate still reads the v1 confidence', () => {
    const code = codeOnly(read('supabase/functions/grounded-answer/pipeline.ts'));
    // The one gate that can suppress an answer. It must name the bare v1
    // `confidence`, and the threshold constant, with no v2 anywhere in it.
    const gate =
      /request\.mode\s*===\s*'strict'\s*&&\s*confidence\s*<\s*STRICT_CONFIDENCE_ABSTAIN_THRESHOLD/;
    expect(code).toMatch(gate);
    const gateLine = code.split('\n').find((l) => gate.test(l)) ?? '';
    expect(gateLine).not.toMatch(/confidence_?[vV]2/);
  });

  it('STRICT_CONFIDENCE_ABSTAIN_THRESHOLD is compared against exactly one identifier: confidence', () => {
    for (const rel of SHADOW_TOUCHING_FILES) {
      const code = codeOnly(read(rel));
      const uses = [...code.matchAll(/(\w+)\s*<\s*STRICT_CONFIDENCE_ABSTAIN_THRESHOLD/g)].map(
        (m) => m[1],
      );
      for (const id of uses) expect(id).toBe('confidence');
    }
  });

  it('the SSE metadata frame carries only the v1 confidence (wire shape unchanged)', () => {
    const code = codeOnly(read('supabase/functions/grounded-answer/pipeline-stream.ts'));
    const frame = code.match(/kind:\s*'metadata'\s*,[\s\S]{0,400}?\};/);
    expect(frame).not.toBeNull();
    expect(frame?.[0]).toMatch(/confidence:\s*plannedConfidence/);
    expect(frame?.[0]).not.toMatch(/confidence_?[vV]2/);
    expect(frame?.[0]).not.toMatch(/top_?[cC]osine/);
  });

  it('both trace-write sites stamp all three shadow fields', () => {
    for (const rel of [
      'supabase/functions/grounded-answer/pipeline.ts',
      'supabase/functions/grounded-answer/pipeline-stream.ts',
    ]) {
      const code = codeOnly(read(rel));
      expect(code).toMatch(/confidence_v2:\s*ctx\.confidenceV2\s*\?\?\s*null/);
      expect(code).toMatch(/confidence_v2_source:\s*ctx\.confidenceV2Source\s*\?\?\s*null/);
      expect(code).toMatch(/top_cosine_similarity:\s*ctx\.topCosineSimilarity\s*\?\?\s*null/);
    }
  });

  it('computeConfidenceV2 delegates to the UNMODIFIED v1 computeConfidence', () => {
    const code = codeOnly(read('supabase/functions/grounded-answer/confidence-v2.ts'));
    expect(code).toMatch(/import\s*\{\s*computeConfidence\s*\}\s*from/);
    expect(code).toMatch(/confidence_v2:\s*computeConfidence\(/);
    // No second formula, no private weights, no private threshold.
    expect(code).not.toMatch(/0\.4\s*\*/);
    expect(code).not.toMatch(/THRESHOLD/);
  });
});

describe('REGRESSION — NULL is never coerced to 0 (source hops)', () => {
  it('mapNcertRow maps a missing cosine to null, NOT to the 0 used for similarity', () => {
    const code = codeOnly(read('supabase/functions/_shared/rag/retrieve.ts'));
    // The two adjacent statements must stay DELIBERATELY different.
    expect(code).toMatch(
      /const\s+sim\s*=\s*typeof\s+row\.similarity\s*===\s*'number'\s*\?\s*row\.similarity\s*:\s*0;/,
    );
    const cos = code.match(/const\s+cos\s*=[\s\S]*?;/);
    expect(cos).not.toBeNull();
    expect(cos?.[0]).toMatch(/Number\.isFinite\(row\.cosine_similarity\)/);
    expect(cos?.[0]).toMatch(/:\s*null;/);
    expect(cos?.[0]).not.toMatch(/:\s*0\s*;/);
  });

  it('the RetrievalChunk contract types both shadow signals as nullable', () => {
    const code = codeOnly(read('supabase/functions/_shared/rag/retrieve.ts'));
    expect(code).toMatch(/cosineSimilarity:\s*number\s*\|\s*null;/);
    expect(code).toMatch(/rerankScore:\s*number\s*\|\s*null;/);
  });

  it('adaptChunk passes both signals through with ?? null (never ?? 0)', () => {
    const code = codeOnly(read('supabase/functions/grounded-answer/retrieval.ts'));
    expect(code).toMatch(/cosine_similarity:\s*c\.cosineSimilarity\s*\?\?\s*null,/);
    expect(code).toMatch(/rerank_score:\s*c\.rerankScore\s*\?\?\s*null,/);
    expect(code).not.toMatch(/cosineSimilarity\s*\?\?\s*0/);
    expect(code).not.toMatch(/rerankScore\s*\?\?\s*0/);
  });

  it('both topCosineSimilarity stamps fall back to null, never 0', () => {
    for (const rel of [
      'supabase/functions/grounded-answer/pipeline.ts',
      'supabase/functions/grounded-answer/pipeline-stream.ts',
    ]) {
      const code = codeOnly(read(rel));
      const stamp = code.match(/ctx\.topCosineSimilarity\s*=[\s\S]*?;/);
      expect(stamp).not.toBeNull();
      expect(stamp?.[0]).toMatch(/:\s*null;/);
      expect(stamp?.[0]).not.toMatch(/:\s*0\s*;/);
    }
  });

  it('the rerank-score stamp uses ?? null on both pipelines and the unified module', () => {
    for (const rel of [
      'supabase/functions/grounded-answer/pipeline.ts',
      'supabase/functions/grounded-answer/pipeline-stream.ts',
      'supabase/functions/_shared/rag/retrieve.ts',
    ]) {
      const code = codeOnly(read(rel));
      expect(code).toMatch(/rr\.rankedScores\[pos\]\s*\?\?\s*null/);
      expect(code).not.toMatch(/rr\.rankedScores\[pos\]\s*\?\?\s*0/);
    }
  });

  it('the identity/fall-through rerank paths fill nulls, never zeros', () => {
    for (const rel of [
      'supabase/functions/_shared/reranking.ts',
      'supabase/functions/_shared/rag/retrieve.ts',
    ]) {
      const code = codeOnly(read(rel));
      expect(code).toMatch(/rankedScores:\s*\w*\.?\w*\.?map\(\(\)\s*=>\s*null\)/);
      expect(code).not.toMatch(/rankedScores:[^\n]*map\(\(\)\s*=>\s*0\)/);
    }
  });

  it('the DB column is nullable with no DEFAULT 0 and no NOT NULL', () => {
    const sql = read('supabase/migrations/20260727130100_grounded_traces_shadow_confidence_v2.sql');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS confidence_v2\s+numeric\(5,4\),/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS top_cosine_similarity\s+numeric\(5,4\)/);
    expect(sql).not.toMatch(/confidence_v2[^\n]*NOT NULL/i);
    expect(sql).not.toMatch(/confidence_v2[^\n]*DEFAULT\s+0/i);
    expect(sql).not.toMatch(/top_cosine_similarity[^\n]*DEFAULT\s+0/i);
    // NULL must remain a legal source stamp ("abstained before retrieval").
    expect(sql).toMatch(/confidence_v2_source IS NULL/);
    expect(sql).toMatch(/confidence_v2_source IN \('rerank', 'cosine', 'none'\)/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Invariant (5): overload count. Architect flagged that NOTHING in CI fails
// if a future migration adds a third `match_rag_chunks_ncert` overload — the
// migration's own post-flight assertion only fires when that migration runs,
// which is exactly when it is too late to catch it in review.
// ───────────────────────────────────────────────────────────────────────────

interface FnDef {
  file: string;
  argNames: string[];
  returnsTable: string;
}

function parseNcertOverloads(): FnDef[] {
  const migDir = path.join(ROOT, 'supabase', 'migrations');
  const files = fs
    .readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const defs: FnDef[] = [];
  const CREATE_RE =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?public"?\."?match_rag_chunks_ncert"?\s*\(([\s\S]*?)\)\s*RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*\n/gi;
  for (const f of files) {
    const src = fs.readFileSync(path.join(migDir, f), 'utf-8');
    if (!src.includes('match_rag_chunks_ncert')) continue;
    for (const m of src.matchAll(CREATE_RE)) {
      const argNames = m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?/)?.[1] ?? '').toLowerCase());
      defs.push({ file: f, argNames, returnsTable: m[2] });
    }
  }
  return defs;
}

describe('REGRESSION — match_rag_chunks_ncert overload count stays at 2', () => {
  const defs = parseNcertOverloads();

  it('the migration scan found the known definitions (guards a broken parser)', () => {
    expect(defs.length).toBeGreaterThanOrEqual(3); // baseline + rca_final + 20260727130000
    expect(defs.map((d) => d.file)).toContain('00000000000000_baseline_from_prod.sql');
    expect(defs.map((d) => d.file)).toContain(
      '20260727130000_rag_ncert_expose_cosine_similarity.sql',
    );
  });

  it('exactly TWO distinct input signatures exist across the whole migration chain', () => {
    // PostgREST binds by argument NAME, so the argument-name tuple IS the
    // overload identity. A third distinct tuple re-opens PR #1394.
    const signatures = new Set(defs.map((d) => d.argNames.join(',')));
    expect([...signatures].sort()).toEqual(
      [
        // (1) 10-arg BASELINE — floor-less, unused, but MUST survive: two
        //     migrations REVOKE on it by exact argument list with no IF EXISTS.
        'query_text,p_subject_code,p_grade,match_count,p_chapter_number,p_chapter_title,p_concept,p_content_type,p_min_quality,query_embedding',
        // (2) 11-arg LIVE — the one retrieve.ts binds to.
        'query_text,p_subject_code,p_grade,match_count,p_chapter_number,p_chapter_title,p_concept,p_content_type,p_quality_score_gate,p_min_similarity,query_embedding',
      ].sort(),
    );
    expect(signatures.size).toBe(2);
  });

  it('the LIVE overload keeps both discriminators (p_min_similarity + p_quality_score_gate)', () => {
    const live = defs.filter((d) => d.argNames.includes('p_min_similarity'));
    expect(live.length).toBeGreaterThan(0);
    for (const d of live) {
      expect(d.argNames).toContain('p_quality_score_gate');
      expect(d.argNames).not.toContain('p_min_quality');
      expect(d.argNames).toHaveLength(11);
    }
    // The most recent definition of the live overload is the one that wins.
    const newest = live[live.length - 1];
    expect(newest.file).toBe('20260727130000_rag_ncert_expose_cosine_similarity.sql');
  });

  it('cosine_similarity is APPENDED LAST to the live RETURNS TABLE (positional consumers safe)', () => {
    const live = defs.filter((d) => d.argNames.includes('p_min_similarity'));
    const newest = live[live.length - 1];
    const cols = newest.returnsTable
      .split(',')
      .map((s) => (s.trim().match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?/)?.[1] ?? '').toLowerCase());
    expect(cols[cols.length - 1]).toBe('cosine_similarity');
    expect(cols.filter((c) => c === 'cosine_similarity')).toHaveLength(1);
    // `similarity` (the RRF ordering statistic) keeps its original position.
    expect(cols.indexOf('similarity')).toBe(5);
  });

  it('no migration DROPs the 10-arg baseline overload (REVOKE replay would break)', () => {
    const migDir = path.join(ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql'));
    const DROP_RE =
      /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:"?public"?\.)?"?match_rag_chunks_ncert"?\s*\(([\s\S]*?)\)/gi;
    let dropsSeen = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(migDir, f), 'utf-8');
      if (!src.includes('match_rag_chunks_ncert')) continue;
      for (const m of src.matchAll(DROP_RE)) {
        dropsSeen += 1;
        const argCount = m[1].split(',').map((s) => s.trim()).filter(Boolean).length;
        // 11 = the live overload only. A 10-arg DROP would remove the baseline
        // overload that 20260516040000 / 20260516050000 REVOKE without IF EXISTS.
        expect({ file: f, argCount }).toEqual({ file: f, argCount: 11 });
      }
    }
    expect(dropsSeen).toBeGreaterThan(0);
  });

  it('the cosine migration keeps its own post-flight overload-count abort', () => {
    const sql = read('supabase/migrations/20260727130000_rag_ncert_expose_cosine_similarity.sql');
    expect(sql).toMatch(/IF v_total > 2 THEN/);
    expect(sql).toMatch(/RAISE EXCEPTION/);
    expect(sql).toMatch(/'p_min_similarity' = ANY \(COALESCE\(p\.proargnames/);
    expect(sql).toMatch(/IF v_live <> 1 THEN/);
    expect(sql).toMatch(/pg_get_function_result\(p\.oid\) LIKE '%cosine_similarity%'/);
  });

  it('the cosine column is OUTPUT-ONLY — it filters and orders nothing', () => {
    const sql = read('supabase/migrations/20260727130000_rag_ncert_expose_cosine_similarity.sql');
    const body = sql.slice(sql.indexOf('AS $fn$'), sql.indexOf('$fn$;'));
    // No predicate and no ordering may name the exposed alias.
    expect(body).not.toMatch(/WHERE[^\n]*\bcos_sim\b/i);
    expect(body).not.toMatch(/ORDER BY[^\n]*\bcos_sim\b/i);
    expect(body).not.toMatch(/ORDER BY[^\n]*cosine_similarity/i);
    expect(body).not.toMatch(/HAVING[^\n]*cos(ine)?_sim/i);
    // The vector-CTE floor still gates on the raw expression, unchanged.
    expect(body).toMatch(/1 - \(c\.embedding <=> query_embedding\) >= p_min_similarity/);
  });
});
