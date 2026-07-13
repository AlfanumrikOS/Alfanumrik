#!/usr/bin/env node
/**
 * AI retry-posture parity gate (ADR-006 action item 4).
 *
 * The platform calls Anthropic from TWO runtimes that cannot share code:
 *   - Node (Vercel + AWS Fargate): packages/lib/src/ai/clients/claude.ts
 *   - Deno (Supabase Edge Functions): supabase/functions/_shared/reliability.ts
 *
 * Incident class #4 (Anthropic 500/529 cascades) happens when either side
 * loses its exponential-backoff retry on transient failures. This script is a
 * cheap structural guard: it does NOT prove behavioral equivalence, it proves
 * neither file has silently dropped the retry/backoff/transient-classification
 * markers. If you refactor either file, keep the invariants below true (or
 * update this script IN THE SAME PR with a note on why the invariant moved).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const failures = [];

function mustMatch(label, filePath, checks) {
  let src;
  try {
    src = readFileSync(resolve(filePath), 'utf8');
  } catch {
    failures.push(`${label}: file missing at ${filePath} — retry helper relocated? Update this gate in the same PR.`);
    return;
  }
  for (const { name, pattern } of checks) {
    if (!pattern.test(src)) {
      failures.push(`${label}: missing invariant "${name}" (pattern ${pattern}) in ${filePath}`);
    }
  }
}

mustMatch('node-side (claude.ts)', 'packages/lib/src/ai/clients/claude.ts', [
  { name: 'bounded retry attempts', pattern: /MAX_ATTEMPTS_PER_MODEL\s*=\s*[23456]/ },
  { name: 'exponential backoff', pattern: /BASE_DELAY_MS\s*\*\s*2\s*\*\*/ },
  { name: 'backoff delay cap', pattern: /MAX_DELAY_MS/ },
  { name: 'retries 429', pattern: /status\s*===\s*429/ },
  { name: 'retries 5xx (incl. 529)', pattern: /status\s*>=\s*500/ },
]);

mustMatch('deno-side (reliability.ts)', 'supabase/functions/_shared/reliability.ts', [
  { name: 'transient classification', pattern: /retryable:\s*kind\s*===\s*'rate_limit'\s*\|\|\s*kind\s*===\s*'server_error'/ },
  { name: 'backoff implementation', pattern: /backoffDelay/ },
  { name: 'backoff base delay', pattern: /DEFAULT_BASE_DELAY_MS/ },
  { name: 'backoff delay cap', pattern: /DEFAULT_MAX_DELAY_MS/ },
]);

if (failures.length > 0) {
  console.error('AI retry parity gate FAILED:\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    '\nBoth runtimes must keep exponential-backoff retry on transient Anthropic failures (429/5xx/529).' +
      '\nSee ADR-006 and docs/runbooks (incident class #4: 500/529 cascades).',
  );
  process.exit(1);
}

console.log('AI retry parity gate passed: both Node and Deno Anthropic paths retain backoff-retry invariants.');
