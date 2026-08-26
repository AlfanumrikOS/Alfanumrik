#!/usr/bin/env node
/**
 * gen-mol-matrix.mjs — Foxy North-Star Phase 4 R3 router consolidation.
 *
 * Reads the ONE-place model-id constants from
 *   packages/lib/src/ai/gateway/registry.ts
 * (ANTHROPIC_HAIKU_ID / ANTHROPIC_SONNET_ID / OPENAI_MINI_ID / OPENAI_FULL_ID)
 * and emits the Deno-side MOL BASE_MATRIX to
 *   supabase/functions/_shared/mol/generated-matrix.ts
 *
 * The purpose is R3 in the Foxy alignment plan §1.7: the same model-fallback
 * chain lived hand-authored in TWO places (packages/lib/src/ai/gateway/router.ts
 * for the Node/Next gateway AND supabase/functions/_shared/mol/router.ts for the
 * Deno MOL orchestrator). This script makes the Deno half generated from the TS
 * source of truth, so a model-id rename in registry.ts can never leave the Deno
 * chain stale.
 *
 * ZERO npm dependencies (node:fs / node:path only) — CI can run it with a bare
 * checkout + node, mirroring scripts/foxy-alignment/analyze.mjs and
 * scripts/check-bundle-size.mjs.
 *
 * Usage:
 *   node scripts/gen-mol-matrix.mjs           # write the file
 *   node scripts/gen-mol-matrix.mjs --check   # diff-only (CI drift gate)
 *
 * Owner: ai-engineer (routing authorship). Backend authors the generator
 * (mechanical + independent of route.ts). Architect reviews the seam.
 * Added: 2026-08-05.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = join(ROOT, 'packages/lib/src/ai/gateway/registry.ts');
const OUT_PATH = join(ROOT, 'supabase/functions/_shared/mol/generated-matrix.ts');

const CHECK_MODE = process.argv.includes('--check');

// ── Parse the model-id constants out of registry.ts ─────────────────────────
// Simple regex: `export const NAME_ID = 'value';` — the registry file uses that
// exact shape for all 6 id constants (see registry.ts:25-30). If that shape
// changes, this parser and the parity test in _shared/mol/__tests__/router.test.ts
// must move together.
function parseIds() {
  if (!existsSync(REGISTRY_PATH)) {
    throw new Error(`registry.ts missing at ${REGISTRY_PATH}`);
  }
  const src = readFileSync(REGISTRY_PATH, 'utf8');
  const ids = {};
  const re = /export\s+const\s+([A-Z_]+_ID)\s*=\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) ids[m[1]] = m[2];
  const required = [
    'ANTHROPIC_HAIKU_ID',
    'ANTHROPIC_SONNET_ID',
    'OPENAI_MINI_ID',
    'OPENAI_FULL_ID',
  ];
  for (const k of required) {
    if (!ids[k]) throw new Error(`registry.ts missing export: ${k}`);
  }
  return ids;
}

// ── Task-type -> chain mapping ──────────────────────────────────────────────
// Mirrors the BASE_MATRIX previously hand-authored in
// supabase/functions/_shared/mol/router.ts. Kept intentionally close to the
// gateway policy tokens (LEGACY_FALLBACK_ORDER.haiku/sonnet/auto) so the two
// halves stay comprehensible — but this file is the AUTHORITATIVE Deno chain
// after R3, not the gateway.
//
// The mapping is small on purpose: 9 task_types x 1-2 passes. Any new task_type
// added to TaskType in types.ts must gain an entry here or MOL cannot route it.
function buildMatrix(ids) {
  const HAIKU = ids.ANTHROPIC_HAIKU_ID;
  const SONNET = ids.ANTHROPIC_SONNET_ID;
  const GPT_MINI = ids.OPENAI_MINI_ID;
  const GPT_FULL = ids.OPENAI_FULL_ID;

  // Anthropic primary, OpenAI fallback (CEO directive 2026-08-26).
  const smallChain = [
    { provider: 'anthropic', model: HAIKU },
    { provider: 'openai', model: GPT_MINI },
  ];
  const largeChain = [
    { provider: 'anthropic', model: SONNET },
    { provider: 'anthropic', model: HAIKU },
    { provider: 'openai', model: GPT_FULL },
  ];
  const visionChain = [
    { provider: 'anthropic', model: SONNET },
    { provider: 'openai', model: GPT_FULL },
  ];

  return {
    explanation: [{ role: 'single', chain: smallChain }],
    concept_explanation: [{ role: 'single', chain: smallChain }],
    step_by_step: [{ role: 'single', chain: smallChain }],
    reasoning: [{ role: 'single', chain: largeChain }],
    quiz_generation: [{ role: 'single', chain: smallChain }],
    evaluation: [{ role: 'single', chain: smallChain }],
    doubt_solving: [
      { role: 'reason', chain: largeChain },
      { role: 'simplify', chain: smallChain },
    ],
    ocr_extraction: [{ role: 'vision', chain: visionChain }],
    grounding_check: [{ role: 'single', chain: smallChain }],
  };
}

function emit(matrix, ids) {
  const banner =
`// GENERATED — DO NOT EDIT
// DO NOT MANUALLY MERGE
// Regenerate: \`npm run gen:mol-matrix\`
//
// Source of truth: packages/lib/src/ai/gateway/registry.ts (model-id constants)
// + scripts/gen-mol-matrix.mjs (task-type -> chain mapping).
//
// This file is R3's authoritative Deno-side BASE_MATRIX for the MOL router.
// The parity test in supabase/functions/_shared/mol/__tests__/router.test.ts
// asserts every TaskType's chain matches the gateway intent for that policy.
`;
  const idsBlock =
`// Model ids (mirror of registry.ts — kept as string literals here so this file
// is Deno-consumable without pulling the TS gateway across the runtime boundary).
export const MODEL_IDS = {
  ANTHROPIC_HAIKU_ID: ${JSON.stringify(ids.ANTHROPIC_HAIKU_ID)},
  ANTHROPIC_SONNET_ID: ${JSON.stringify(ids.ANTHROPIC_SONNET_ID)},
  OPENAI_MINI_ID: ${JSON.stringify(ids.OPENAI_MINI_ID)},
  OPENAI_FULL_ID: ${JSON.stringify(ids.OPENAI_FULL_ID)},
} as const;
`;
  const typesImport =
`import type { TaskType } from './types.ts';\nimport type { Pass } from './router.ts';\n`;

  // Emit the matrix as a plain object literal. TaskType keys are strings, and
  // the router imports Pass[] from ./router.ts so no shape drift possible.
  const lines = [];
  lines.push(banner);
  lines.push(typesImport);
  lines.push(idsBlock);
  lines.push('\nexport const GENERATED_BASE_MATRIX: Record<TaskType, Pass[]> = {');
  for (const [task, passes] of Object.entries(matrix)) {
    lines.push(`  ${task}: [`);
    for (const p of passes) {
      lines.push(`    { role: ${JSON.stringify(p.role)}, chain: [`);
      for (const t of p.chain) {
        lines.push(`      { provider: ${JSON.stringify(t.provider)}, model: ${JSON.stringify(t.model)} },`);
      }
      lines.push(`    ] },`);
    }
    lines.push(`  ],`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

function main() {
  const ids = parseIds();
  const matrix = buildMatrix(ids);
  const next = emit(matrix, ids);

  if (CHECK_MODE) {
    if (!existsSync(OUT_PATH)) {
      console.error(`gen-mol-matrix --check: FAIL — output missing: ${OUT_PATH}`);
      console.error('Run `npm run gen:mol-matrix` and commit the result.');
      process.exit(1);
    }
    const current = readFileSync(OUT_PATH, 'utf8');
    if (current !== next) {
      console.error('gen-mol-matrix --check: FAIL — generated matrix differs from on-disk copy.');
      console.error(`  ${OUT_PATH}`);
      console.error('Run `npm run gen:mol-matrix` and commit the result.');
      process.exit(1);
    }
    console.log('gen-mol-matrix --check: OK');
    return;
  }

  writeFileSync(OUT_PATH, next, 'utf8');
  console.log(`gen-mol-matrix: wrote ${OUT_PATH}`);
}

main();
