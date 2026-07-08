/**
 * Contract test — AlfaBot SSE event-name parity across 3 surfaces.
 *
 * Pins the SSE event-name contract:
 *   - producer: supabase/functions/alfabot-answer/stream-response.ts
 *     emits `event: token`, `event: citation`, `event: done`
 *   - pass-through: src/app/api/alfabot/route.ts pipes upstream frames
 *     verbatim, parses `token`+`done` to bookkeep accumulated text,
 *     appends `event: meta` before final `event: done`
 *   - consumer: src/lib/alfabot/client.ts parses `token | citation | meta |
 *     done | error` (plus `abstain` as a soft-alias for `error`).
 *
 * DRIFT DETECTED (2026-05-19, this contract test surfaces it for the
 * orchestrator + frontend/backend reviewers):
 *
 *   When PR 2 (route) and PR 3 (widget) shipped, the Next route's
 *   pipe-through (route.ts:1151) used `eventName === 'text'` and the client
 *   lib (client.ts:135) used `event === 'text'`. The Edge Function emits
 *   `event: token` per the producer contract above. Result:
 *     - Token deltas are EMITTED downstream verbatim (so the client lib's
 *       OWN parser receives `event: token`).
 *     - But the route's token-accumulator (used for the `meta` frame body
 *       it appends before `done`) silently never matches, leaving
 *       `accumulatedText = ''` whenever the upstream doesn't also send a
 *       `response` field in its `done` payload.
 *     - The client lib's onToken/onDone path silently never fires on token
 *       events emitted directly by the Edge Function, falling back only to
 *       the `meta`/`done` frames that the Next route appends.
 *
 * This file documents the drift and asserts ON THE EXPECTED contract via
 * the shared module `src/lib/alfabot/sse-events.ts`. Three of the four
 * assertions PASS today (the producer + the meta event). One assertion is
 * marked with `it.fails(...)` and a TODO to clearly surface that the Next
 * route + client lib still spell `token` as `text`.
 *
 * Owner: testing.
 * Review chain: backend (route owner), ai-engineer (Edge Function owner),
 * frontend (client lib owner).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALFABOT_SSE_EVENTS,
  ALFABOT_SSE_EVENT_NAMES,
} from '@alfanumrik/lib/alfabot/sse-events';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function readSource(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

describe('AlfaBot SSE event-name contract', () => {
  // ─── 1. Shared module exports the canonical names ───────────────────────

  it('exports the canonical 5-event set in src/lib/alfabot/sse-events.ts', () => {
    expect(ALFABOT_SSE_EVENTS.TOKEN).toBe('token');
    expect(ALFABOT_SSE_EVENTS.CITATION).toBe('citation');
    expect(ALFABOT_SSE_EVENTS.META).toBe('meta');
    expect(ALFABOT_SSE_EVENTS.DONE).toBe('done');
    expect(ALFABOT_SSE_EVENTS.ERROR).toBe('error');
    // Array form for parser allowlists.
    expect(ALFABOT_SSE_EVENT_NAMES).toEqual([
      'token',
      'citation',
      'meta',
      'done',
      'error',
    ]);
  });

  // ─── 2. Edge Function emits the canonical names ─────────────────────────
  //
  // We do a static-source inspection on `stream-response.ts` so the test
  // does not import Deno code into vitest. Looking for the literal frame
  // construction `event: <name>`.

  it('producer (Edge Function stream-response.ts) emits token + citation + done', () => {
    const src = readSource('supabase/functions/alfabot-answer/stream-response.ts');
    // The send() helper builds frames as `event: ${event}\ndata: ...`.
    // We assert on the call sites: send('token', ...), send('citation', ...),
    // send('done', ...).
    expect(src).toMatch(/send\(\s*['"]token['"]/);
    expect(src).toMatch(/send\(\s*['"]citation['"]/);
    expect(src).toMatch(/send\(\s*['"]done['"]/);
    // Negative: the producer must NOT emit 'text' frames (drift detector).
    expect(src).not.toMatch(/send\(\s*['"]text['"]/);
  });

  // ─── 3. Next route appends `meta` and recognises `done` ─────────────────

  it('pass-through (Next route) appends a meta frame and parses done', () => {
    const src = readSource('src/app/api/alfabot/route.ts');
    // The route appends its own meta frame in the template literal
    // `event: ${ALFABOT_SSE_EVENTS.META}\ndata: ...`. We accept either the
    // literal form (legacy) or the constants form (post-harmonization).
    expect(
      src.includes('`event: meta\\ndata:') ||
        src.includes('`event: ${ALFABOT_SSE_EVENTS.META}\\ndata:'),
    ).toBe(true);
    // The route checks for 'done' in its pipe-through transform. Accept
    // either string-literal or constant-identifier shape.
    expect(src).toMatch(
      /eventName\s*===\s*(?:['"]done['"]|ALFABOT_SSE_EVENTS\.DONE)/,
    );
    // It MUST also import from the canonical module — that's the whole
    // point of the harmonization.
    expect(src).toMatch(
      /from\s+['"]@\/lib\/alfabot\/sse-events['"]/,
    );
  });

  // ─── 4. Client lib recognises the canonical names ───────────────────────

  it('consumer (client.ts) recognises meta + done + error/abstain frames', () => {
    const src = readSource('src/lib/alfabot/client.ts');
    expect(src).toMatch(
      /event\s*===\s*(?:['"]meta['"]|ALFABOT_SSE_EVENTS\.META)/,
    );
    expect(src).toMatch(
      /event\s*===\s*(?:['"]done['"]|ALFABOT_SSE_EVENTS\.DONE)/,
    );
    // Error and abstain are alternative terminal frame names.
    expect(src).toMatch(
      /event\s*===\s*(?:['"]error['"]|ALFABOT_SSE_EVENTS\.ERROR)/,
    );
    // It MUST also import from the canonical module.
    expect(src).toMatch(/from\s+['"]\.\/sse-events['"]/);
  });

  // ─── 5. DRIFT SURFACE — Next route + client lib still spell `token` as `text` ──
  //
  // This is the load-bearing assertion: when the drift is fixed (either by
  // importing from sse-events.ts or by hard-coding 'token'), this test flips
  // to passing. Until then, it documents the bug.
  //
  // The drift is NON-FATAL today because:
  //   - The Edge Function's `done` frame includes a `response` field, so the
  //     route's accumulator-fallback (`if (!accumulatedText) accumulatedText
  //     = payload.response`) recovers the final text before the route appends
  //     its meta frame.
  //   - Re-emit is verbatim (controller.enqueue(chunk) on line 1130), so the
  //     client still sees the upstream `token` frames AND mishandles them at
  //     line 135 — but it ALSO falls back to the `done` frame's `response`
  //     field via the mergeMeta() path.
  //
  // Both surfaces work TODAY by accident. This test pins the contract so a
  // future change that removes the `response` fallback doesn't silently lose
  // token streaming.

  it(
    'Next route + client lib use "token" not "text" (drift fixed via sse-events.ts)',
    () => {
      // Drift fixed: both surfaces now import ALFABOT_SSE_EVENTS from the
      // canonical module at src/lib/alfabot/sse-events.ts and recognise
      // `event: token` (the producer's spelling) instead of the legacy
      // `event: text`. This test asserts the bug-fix has landed and pins
      // it against regression. Documented in REG-67-adjacent catalog entry.
      const routeSrc = readSource('src/app/api/alfabot/route.ts');
      const clientSrc = readSource('src/lib/alfabot/client.ts');
      // Negative assertion: 'text' must NOT appear as an SSE event-name
      // match in either consumer. We look for the exact `=== 'text'` shape
      // because the route's pipe-through and the client parser both used it.
      expect(routeSrc).not.toMatch(/eventName\s*===\s*['"]text['"]/);
      expect(clientSrc).not.toMatch(/event\s*===\s*['"]text['"]/);
      // Positive assertion: both surfaces now use the canonical TOKEN
      // constant (or the literal 'token') for the token-delta branch.
      expect(routeSrc).toMatch(
        /eventName\s*===\s*(?:['"]token['"]|ALFABOT_SSE_EVENTS\.TOKEN)/,
      );
      expect(clientSrc).toMatch(
        /event\s*===\s*(?:['"]token['"]|ALFABOT_SSE_EVENTS\.TOKEN)/,
      );
    },
  );

  // ─── 6. CITATION event is currently UNHANDLED downstream ────────────────
  //
  // The Edge Function emits `event: citation` once before the first token
  // (when KB sources are used). Neither the Next route nor the client lib
  // does anything with it today — they pass it through verbatim, and no
  // UI surface consumes it. This is OK for now because `sourcesUsed` count
  // is also carried in the `done` envelope's `sourcesUsed` field. But the
  // contract test surfaces it so the next change to either surface knows.

  it('citation event is in the canonical list but not yet consumed by client', () => {
    const clientSrc = readSource('src/lib/alfabot/client.ts');
    // We do NOT assert that the client consumes 'citation' — it's a forward
    // hook for a future enrichment. Just assert it's part of the canonical
    // event-name set so it cannot be removed without test failure.
    expect(ALFABOT_SSE_EVENT_NAMES).toContain('citation');
    expect(clientSrc).toContain("'event:'"); // SSE parser is present
  });
});
