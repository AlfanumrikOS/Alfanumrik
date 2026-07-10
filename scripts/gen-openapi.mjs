#!/usr/bin/env node
/**
 * OpenAPI generator for the /v2 contract.
 *
 * Reads the Zod OpenAPIRegistry in `packages/lib/src/api/v2/contract.ts`, builds an
 * OpenAPI 3.1 document, and writes it to `openapi/v2.json` with STABLE key
 * ordering (sorted keys) so the artifact diffs cleanly and the CI drift-check
 * (.github/workflows/openapi-contract.yml) is deterministic.
 *
 * Usage:
 *   node scripts/gen-openapi.mjs           # write openapi/v2.json
 *   node scripts/gen-openapi.mjs --check   # exit 1 if openapi/v2.json is stale
 *
 * The contract is a TypeScript module, so we load it through `tsx` (already a
 * dev dependency / used by other scripts via `npx tsx`). Spawning tsx with a
 * tiny ESM loader entry keeps this wrapper plain `.mjs` (no build step) while
 * still importing the .ts single-source-of-truth.
 *
 * Wired as: npm run gen:openapi  (and gen:openapi:check).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, 'openapi');
const outFile = join(outDir, 'v2.json');

const isCheck = process.argv.includes('--check');

// ── Build the spec in a tsx subprocess (it can import the .ts contract) ──
// The subprocess prints the canonical JSON to stdout; we capture + write it
// here so the writing/diffing logic stays in one place.
//
// We spawn `node --import <tsx-esm-loader> gen-openapi.build.ts` rather than the
// `tsx` bin (or `npx tsx`) for two reasons:
//   1. No network: `tsx` is a declared devDependency resolved from node_modules,
//      so CI never reaches out to npx's registry. (Memory pitfall: declare deps.)
//   2. Spaces in the absolute repo path (…/Bharangpur Primary/…) break naive
//      shell-quoted bin invocations on Windows; passing the entry as a discrete
//      argv element to `node` sidesteps all shell parsing.
const tsxEntry = join(__dirname, 'gen-openapi.build.mts');
const require = createRequire(import.meta.url);
// tsx exposes its ESM loader hooks at `tsx/esm` (registerable via --import).
const tsxLoader = pathToFileURL(require.resolve('tsx/esm')).href;

const result = spawnSync(
  process.execPath, // the current `node` binary
  ['--import', tsxLoader, tsxEntry],
  { encoding: 'utf-8', cwd: repoRoot, env: process.env },
);

if (result.error) {
  console.error('Failed to spawn node + tsx loader:', result.error.message);
  process.exit(2);
}
if (result.status !== 0) {
  console.error('OpenAPI build (tsx) failed:');
  console.error(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

// The build entry prints ONLY the JSON document to stdout (logs go to stderr).
const generated = result.stdout.trim() + '\n';

// Sanity: it must parse and look like an OpenAPI 3.1 doc.
let parsed;
try {
  parsed = JSON.parse(generated);
} catch (e) {
  console.error('Generated output is not valid JSON:', e.message);
  console.error(result.stdout.slice(0, 500));
  process.exit(1);
}
if (!parsed.openapi || !String(parsed.openapi).startsWith('3.1')) {
  console.error(`Expected OpenAPI 3.1.x, got openapi=${parsed.openapi}`);
  process.exit(1);
}

if (isCheck) {
  if (!existsSync(outFile)) {
    console.error(`Missing contract artifact: ${outFile}`);
    console.error('Run `npm run gen:openapi` and commit the result.');
    process.exit(1);
  }
  const current = readFileSync(outFile, 'utf-8');
  const norm = (s) => s.replace(/\r\n/g, '\n');
  if (norm(current) === norm(generated)) {
    console.log('openapi/v2.json is up to date.');
    process.exit(0);
  }
  console.error('openapi/v2.json is OUT OF SYNC with the Zod contract.');
  console.error('Run `npm run gen:openapi` locally and commit the result.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, generated, 'utf-8');
const pathCount = Object.keys(parsed.paths || {}).length;
const schemaCount = Object.keys(parsed.components?.schemas || {}).length;
console.log(`Wrote ${outFile} — ${pathCount} path(s), ${schemaCount} schema(s).`);
