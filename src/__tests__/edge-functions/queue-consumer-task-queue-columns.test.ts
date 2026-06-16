/**
 * Static source-parse regression — queue-consumer Edge Function task_queue
 * column contract.
 *
 * Background (column-contract repair, 2026-06-16):
 *   The live `task_queue` table (baseline `00000000000000_baseline_from_prod.sql:14324`)
 *   has EXACTLY these columns:
 *     id, queue_name, payload, status, attempts, max_attempts,
 *     created_at, processing_at, completed_at, error
 *   It has NO `last_error`, NO `retry_after`, and NO `updated_at` column.
 *
 *   The pre-fix queue-consumer wrote `updated_at` on the claim UPDATE and
 *   `last_error` + `retry_after` on the failure UPDATE. supabase-js does NOT
 *   throw on a write to a non-existent column — it returns the error in the
 *   result object, which was unchecked. So every `task_queue` UPDATE silently
 *   failed: rows never left `pending`, `attempts` never advanced toward the
 *   `< 3` dead-letter threshold, and a poison task looped forever, starving the
 *   queue and re-running BKT / notification / AI side-effects on every cron
 *   invocation. ("tasks silently loop / never dead-letter.")
 *
 *   The fix maps every `task_queue` UPDATE to the REAL columns
 *   (`processing_at` / `completed_at` / `error`) and now checks the returned
 *   error (logs claim failures, throws on the claim UPDATE so the cron retries).
 *
 * This test pins that fix STATICALLY (no Deno execution, no live DB). The
 * Edge Function lives in Deno-land (imports from https://esm.sh, uses
 * Deno.serve) so it cannot be loaded under Vitest — we use the same static
 * source-inspection pattern as the rest of `src/__tests__/edge-functions/`
 * (readFileSync + resolve from repo root), mirroring
 * `src/__tests__/purchase-streak-freeze-coin-source.test.ts`.
 *
 * IMPORTANT scoping note: the SAME file also drains the `domain_events` outbox,
 * whose schema DOES have a `last_error` column and a `retry_count` field. A
 * naive whole-file `not.toContain('last_error')` would FALSE-FAIL on that
 * legitimate `domain_events` UPDATE. The failure-branch `task_queue` UPDATE also
 * folds a backoff timestamp into the `error` text via a local `retryAfter`
 * variable and a `suggested_retry_after=` token. So every column assertion below
 * is scoped to the OBJECT-LITERAL KEYS of the `.from('task_queue').update({...})`
 * payloads only — never the surrounding prose, comments, or string values.
 *
 * If anyone re-introduces a phantom `task_queue` column write, this fails at CI
 * time instead of silently looping poison tasks in production.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FN_PATH = resolve(
  process.cwd(),
  'supabase/functions/queue-consumer/index.ts',
);

const src = readFileSync(FN_PATH, 'utf8');

// ── Live task_queue schema (single source of truth) ──
// baseline_from_prod.sql:14324 — the ONLY columns that exist on task_queue.
const TASK_QUEUE_COLUMNS = [
  'id',
  'queue_name',
  'payload',
  'status',
  'attempts',
  'max_attempts',
  'created_at',
  'processing_at',
  'completed_at',
  'error',
] as const;

// Columns the pre-fix code wrote that DO NOT exist on task_queue. Writing any
// of these makes the whole UPDATE silently no-op (supabase-js returns the
// error rather than throwing).
const PHANTOM_TASK_QUEUE_COLUMNS = ['last_error', 'retry_after', 'updated_at'] as const;

/**
 * Extract the object-literal payload of every `.from('<table>').update({ ... })`
 * call. Returns the brace-delimited bodies (without the outer braces) so the
 * caller can inspect just the column KEYS that get written to that table —
 * isolated from updates to other tables and from comment/string prose.
 *
 * The matcher walks `.from('<table>')` → the next `.update(` → the balanced
 * `{ ... }` immediately inside it, so chained `.eq(...)`/`.in(...)` after the
 * payload are excluded.
 */
function extractUpdatePayloads(source: string, table: string): string[] {
  const payloads: string[] = [];
  // Match `.from('<table>')` (single or double quotes), then find the first
  // `.update(` after it.
  const fromRe = new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(source)) !== null) {
    const after = source.slice(m.index + m[0].length);
    const updIdx = after.indexOf('.update(');
    if (updIdx === -1) continue;
    // Find the first `{` after `.update(` and balance braces from there.
    const openIdx = after.indexOf('{', updIdx);
    if (openIdx === -1) continue;
    let depth = 0;
    let end = -1;
    for (let i = openIdx; i < after.length; i++) {
      const ch = after[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) continue;
    payloads.push(after.slice(openIdx + 1, end));
  }
  return payloads;
}

const extractTaskQueueUpdatePayloads = (source: string): string[] =>
  extractUpdatePayloads(source, 'task_queue');

/**
 * Parse the top-level object-literal keys from a brace body. Handles the shape
 * `key: value,` / `key,` (shorthand) at depth 0 relative to the body. Nested
 * objects/arrays are skipped via depth tracking so we only collect the
 * column-name keys actually written to task_queue.
 */
function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;
  let expectKey = true;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      i++;
      continue;
    }
    if (ch === ',') {
      expectKey = true;
      i++;
      continue;
    }
    if (depth === 0 && expectKey) {
      const keyMatch = /^[ \t\r\n]*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/.exec(body.slice(i));
      if (keyMatch) {
        keys.push(keyMatch[1]);
        expectKey = false;
        i += keyMatch[0].length;
        continue;
      }
      // Not at a key boundary yet (whitespace / template literal etc.).
    }
    i++;
  }
  return keys;
}

describe('queue-consumer Edge Function — file shape', () => {
  it('exists at supabase/functions/queue-consumer/index.ts', () => {
    expect(existsSync(FN_PATH)).toBe(true);
  });

  it('uses Deno.serve (Edge Function runtime contract)', () => {
    expect(src).toMatch(/Deno\.serve\s*\(/);
  });

  it('writes to the task_queue table at least twice (claim + terminal updates)', () => {
    const payloads = extractTaskQueueUpdatePayloads(src);
    // claim → processing, success → completed, failure → failed/pending = 3.
    expect(payloads.length).toBeGreaterThanOrEqual(2);
  });
});

describe('queue-consumer — task_queue UPDATE column contract (poison-loop / never-dead-letter regression)', () => {
  const payloads = extractTaskQueueUpdatePayloads(src);
  const allKeys = Array.from(new Set(payloads.flatMap(topLevelKeys)));

  it('every task_queue UPDATE key is a REAL task_queue column', () => {
    // Guard: we actually parsed payloads (else the test is vacuously green).
    expect(payloads.length).toBeGreaterThan(0);
    expect(allKeys.length).toBeGreaterThan(0);

    for (const key of allKeys) {
      expect(
        TASK_QUEUE_COLUMNS as readonly string[],
        `task_queue UPDATE writes column "${key}" which is NOT in the live schema ` +
          `(baseline_from_prod.sql:14324). Allowed: ${TASK_QUEUE_COLUMNS.join(', ')}`,
      ).toContain(key);
    }
  });

  it('does NOT write any phantom column (last_error / retry_after / updated_at) to task_queue', () => {
    for (const phantom of PHANTOM_TASK_QUEUE_COLUMNS) {
      expect(
        allKeys,
        `task_queue UPDATE must never write the non-existent column "${phantom}" — ` +
          `a write to it silently no-ops the whole UPDATE, so rows never leave ` +
          `"pending" and poison tasks loop forever instead of dead-lettering.`,
      ).not.toContain(phantom);
    }
  });

  it('DOES use the real lifecycle columns processing_at / completed_at / error', () => {
    expect(allKeys, 'claim UPDATE must stamp processing_at').toContain('processing_at');
    expect(allKeys, 'success UPDATE must stamp completed_at').toContain('completed_at');
    expect(allKeys, 'failure UPDATE must record the failure message in error').toContain('error');
  });

  it('advances status + attempts through the real columns (retry/dead-letter control)', () => {
    // status is written on every transition; attempts advances on failure so
    // the `attempts < 3` claim filter can eventually dead-letter a poison task.
    expect(allKeys).toContain('status');
    expect(allKeys).toContain('attempts');
  });
});

describe('queue-consumer — domain_events UPDATE is NOT mistaken for task_queue', () => {
  it('does not falsely flag the domain_events outbox last_error write', () => {
    // The domain_events table legitimately HAS last_error + retry_count. This
    // assertion documents WHY the column checks above are scoped to task_queue
    // payloads and not a whole-file substring search: a global
    // not.toContain('last_error') would false-fail on this legitimate write.
    const domainEventsKeys = Array.from(
      new Set(extractUpdatePayloads(src, 'domain_events').flatMap(topLevelKeys)),
    );
    // domain_events DOES carry last_error — confirms the file uses it for the
    // RIGHT table, and that our scoping correctly excludes it from task_queue.
    expect(domainEventsKeys).toContain('last_error');
    // ...and the scoped task_queue extractor must NOT pick up that key.
    const taskQueueKeys = Array.from(
      new Set(extractTaskQueueUpdatePayloads(src).flatMap(topLevelKeys)),
    );
    expect(taskQueueKeys).not.toContain('last_error');
  });
});
