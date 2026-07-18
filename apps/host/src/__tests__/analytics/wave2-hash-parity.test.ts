/**
 * REG-271 (part a) — client↔server distinct-id HASH PARITY (the anti-0%-funnel pin).
 *
 * The B2C funnel stitches a browser-emitted step (`signup_complete`,
 * `identify`) to a server-emitted step (`email_verified`, `quiz_graded`) by
 * keying BOTH on the SAME PostHog distinct id. The browser derives that id with
 * Web-Crypto (`hashUserIdForAnalytics` in packages/lib/src/posthog-client.ts);
 * the server derives it with Node-crypto (`hashDistinctId` in
 * packages/lib/src/posthog/server.ts). If these two ever diverge — a different
 * algorithm, a different byte slice, a salt, upper vs lower hex — the client and
 * server events land on TWO different persons and the whole funnel silently
 * reads 0%. Nothing else in the codebase would fail; it fails silently in
 * PostHog. This test is the tripwire.
 *
 * Contract pinned (architect, load-bearing):
 *   SHA-256 over the utf-8 UUID → first 8 bytes → 16 lowercase hex chars,
 *   UNSALTED, byte-identical across the Node-crypto ↔ Web-Crypto boundary.
 *
 * Pure test: exercises the REAL functions, no mocks, no network. `crypto.subtle`
 * is available in the jsdom test env (see lib/posthog-client.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { hashDistinctId } from '@alfanumrik/lib/posthog/server';
import { hashUserIdForAnalytics } from '@alfanumrik/lib/posthog-client';

// A spread of realistic Supabase auth UUIDs + a couple of edge shapes.
const FIXTURES = [
  '11111111-1111-4111-8111-111111111111',
  '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  '00000000-0000-4000-8000-000000000000',
  'ffffffff-ffff-4fff-bfff-ffffffffffff',
  // Non-UUID inputs still must agree (the hash doesn't care about shape).
  'user-uuid-123',
  'alice@example.com',
];

describe('REG-271a — hashDistinctId (server) byte-matches hashUserIdForAnalytics (client)', () => {
  it.each(FIXTURES)('server and client hash agree exactly for %s', async (id) => {
    const server = hashDistinctId(id);
    const client = await hashUserIdForAnalytics(id);

    // Both non-null, both the 16-lowercase-hex prefix, and byte-identical.
    expect(client).not.toBeNull();
    expect(server).toMatch(/^[0-9a-f]{16}$/);
    expect(client).toMatch(/^[0-9a-f]{16}$/);
    expect(server).toBe(client);
  });

  it('pins the exact digest for a fixed UUID (absolute anchor — catches an identical-drift on BOTH sides)', async () => {
    // Precomputed: sha256("11111111-1111-4111-8111-111111111111") first 8 bytes.
    // If BOTH implementations changed in lockstep, the per-fixture equality
    // tests above would still pass; this hardcoded anchor would not.
    const EXPECTED = 'bd7662a5eeb41614';
    expect(hashDistinctId('11111111-1111-4111-8111-111111111111')).toBe(EXPECTED);
    expect(await hashUserIdForAnalytics('11111111-1111-4111-8111-111111111111')).toBe(EXPECTED);
  });

  it('is UNSALTED — server hash equals a bare SHA-256(utf8).slice(0,16), no prefix/suffix', async () => {
    // Independent recomputation via node:crypto with NO salt. If a salt were
    // ever introduced on the server side, this diverges.
    const { createHash } = await import('node:crypto');
    for (const id of FIXTURES) {
      const bare = createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 16);
      expect(hashDistinctId(id)).toBe(bare);
    }
  });

  it('is deterministic and collision-distinct across fixtures (16 distinct ids)', () => {
    const hashes = FIXTURES.map((id) => hashDistinctId(id));
    // Deterministic: recompute → identical.
    expect(FIXTURES.map((id) => hashDistinctId(id))).toEqual(hashes);
    // Distinct inputs → distinct hashes (no accidental truncation collisions).
    expect(new Set(hashes).size).toBe(FIXTURES.length);
  });
});
