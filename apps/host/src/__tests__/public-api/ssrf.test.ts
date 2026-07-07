/**
 * Track A.6 — SSRF validator unit tests (`src/lib/public-api/ssrf.ts`).
 * ============================================================================
 * The outbound-webhook `target_url` is fetched server-side by the dispatcher, so
 * it is a classic SSRF vector. `validateWebhookTargetUrl` is the create-time gate
 * (Node) and is byte-mirrored in the Deno dispatcher copy, which re-checks before
 * every send (rebinding defense).
 *
 * These tests pin the architect-required block list:
 *   - non-https (http/ftp/file/etc.) → rejected
 *   - loopback (127.0.0.0/8, ::1, localhost) → rejected
 *   - RFC1918 private (10/8, 172.16/12, 192.168/16) → rejected
 *   - link-local (169.254/16, fe80::/10) → rejected
 *   - unique-local IPv6 (fc00::/7) → rejected
 *   - CGNAT (100.64/10) → rejected
 *   - cloud metadata (169.254.169.254) → rejected
 *   - 0.0.0.0/8, multicast/reserved → rejected
 *   - internal namespaces (*.local, *.internal, *.localhost) → rejected
 *   - normal public https hosts → allowed
 *
 * ALSO asserts the Node copy and the Deno _shared copy stay in sync (the two must
 * agree on every verdict — the dispatcher re-check is only a defense if it is the
 * SAME logic). The Deno file imports nothing local, so we transpile its exported
 * function and compare verdicts.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { validateWebhookTargetUrl } from '@alfanumrik/lib/public-api/ssrf';

describe('Track A.6 SSRF — non-https schemes rejected', () => {
  it.each([
    'http://example.com/webhook',
    'ftp://example.com/x',
    'file:///etc/passwd',
    'gopher://example.com',
    'ws://example.com',
  ])('rejects non-https scheme: %s', (url) => {
    const v = validateWebhookTargetUrl(url);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/https/i);
  });

  it('rejects a malformed URL', () => {
    expect(validateWebhookTargetUrl('not a url').ok).toBe(false);
    expect(validateWebhookTargetUrl('').ok).toBe(false);
  });
});

describe('Track A.6 SSRF — loopback rejected', () => {
  it.each([
    'https://127.0.0.1/hook',
    'https://127.0.0.2/hook',
    'https://127.255.255.254/hook',
    'https://localhost/hook',
    'https://localhost.localdomain/hook',
    'https://[::1]/hook',
  ])('rejects loopback: %s', (url) => {
    expect(validateWebhookTargetUrl(url).ok).toBe(false);
  });
});

describe('Track A.6 SSRF — RFC1918 private ranges rejected', () => {
  it.each([
    // 10.0.0.0/8
    'https://10.0.0.1/hook',
    'https://10.255.255.255/hook',
    // 172.16.0.0/12 (172.16 – 172.31)
    'https://172.16.0.1/hook',
    'https://172.20.10.5/hook',
    'https://172.31.255.255/hook',
    // 192.168.0.0/16
    'https://192.168.0.1/hook',
    'https://192.168.1.100/hook',
  ])('rejects RFC1918: %s', (url) => {
    expect(validateWebhookTargetUrl(url).ok).toBe(false);
  });

  it('does NOT over-block 172.15.x / 172.32.x (outside the /12)', () => {
    // 172.16/12 spans only 172.16–172.31; the neighbours are public.
    expect(validateWebhookTargetUrl('https://172.15.0.1/hook').ok).toBe(true);
    expect(validateWebhookTargetUrl('https://172.32.0.1/hook').ok).toBe(true);
  });
});

describe('Track A.6 SSRF — link-local rejected', () => {
  it.each([
    'https://169.254.0.1/hook',
    'https://169.254.1.1/hook',
    'https://[fe80::1]/hook',
    'https://[fe80::abcd:1234]/hook',
  ])('rejects link-local: %s', (url) => {
    expect(validateWebhookTargetUrl(url).ok).toBe(false);
  });
});

describe('Track A.6 SSRF — cloud metadata endpoint rejected', () => {
  it('rejects the 169.254.169.254 metadata IP', () => {
    expect(validateWebhookTargetUrl('https://169.254.169.254/latest/meta-data/').ok).toBe(false);
  });
});

describe('Track A.6 SSRF — IPv6 unique-local / unspecified rejected', () => {
  it.each([
    'https://[fc00::1]/hook',
    'https://[fd12:3456:789a::1]/hook',
    'https://[::]/hook',
  ])('rejects ULA / unspecified: %s', (url) => {
    expect(validateWebhookTargetUrl(url).ok).toBe(false);
  });
});

describe('Track A.6 SSRF — CGNAT (100.64/10) rejected', () => {
  it.each([
    'https://100.64.0.1/hook',
    'https://100.100.50.1/hook',
    'https://100.127.255.255/hook',
  ])('rejects CGNAT: %s', (url) => {
    expect(validateWebhookTargetUrl(url).ok).toBe(false);
  });

  it('does NOT over-block 100.63.x / 100.128.x (outside the /10)', () => {
    expect(validateWebhookTargetUrl('https://100.63.0.1/hook').ok).toBe(true);
    expect(validateWebhookTargetUrl('https://100.128.0.1/hook').ok).toBe(true);
  });
});

describe('Track A.6 SSRF — 0.0.0.0/8 + multicast/reserved rejected', () => {
  it.each([
    'https://0.0.0.0/hook',
    'https://0.1.2.3/hook',
    'https://224.0.0.1/hook', // multicast
    'https://239.255.255.250/hook',
    'https://255.255.255.255/hook',
  ])('rejects this-network / multicast / reserved: %s', (url) => {
    expect(validateWebhookTargetUrl(url).ok).toBe(false);
  });
});

describe('Track A.6 SSRF — internal hostname namespaces rejected', () => {
  it.each([
    'https://db.internal/hook',
    'https://service.local/hook',
    'https://api.localhost/hook',
  ])('rejects internal namespace: %s', (url) => {
    expect(validateWebhookTargetUrl(url).ok).toBe(false);
  });
});

describe('Track A.6 SSRF — normal public https hosts allowed', () => {
  it.each([
    'https://example.com/webhook',
    'https://hooks.partner.io/alfanumrik',
    'https://api.acme-school-sis.com/v1/events?token=abc',
    'https://8.8.8.8/hook', // public IP literal
    'https://1.1.1.1/hook',
    'https://203.0.113.10/hook', // TEST-NET-3 is not in any blocked range
  ])('allows public host: %s', (url) => {
    const v = validateWebhookTargetUrl(url);
    expect(v.ok).toBe(true);
    expect(v.host).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Node ↔ Deno copy parity. The dispatcher's pre-send SSRF re-check is only a real
// defense if the Deno `_shared/ssrf.ts` agrees with the Node copy on EVERY verdict.
// Deno cannot import src/lib/* (and Vitest cannot import the Deno file's `.ts`
// path under tsc's resolution), so we pin parity at the SOURCE level: the four
// load-bearing functions must be textually identical between the two copies. Any
// divergence (a relaxed range, a missing block) fails here loud.
// ─────────────────────────────────────────────────────────────────────────────
describe('Track A.6 SSRF — Node copy and Deno _shared copy are kept in sync', () => {
  const nodeSrc = readFileSync(resolve(process.cwd(), 'src/lib/public-api/ssrf.ts'), 'utf8');
  const denoSrc = readFileSync(
    resolve(process.cwd(), 'supabase/functions/_shared/ssrf.ts'),
    'utf8',
  );

  /**
   * Extract a function body by name (from `function <name>` to its closing brace
   * at col 0), with `//` line comments stripped and whitespace normalised — so the
   * comparison is on EXECUTABLE logic, not the (intentionally differing) prose.
   */
  function fnBody(src: string, name: string): string {
    const start = src.indexOf(`function ${name}`);
    if (start === -1) return '';
    const nextStarts = ['parseIpv4', 'isBlockedIpv4', 'isBlockedIpv6', 'validateWebhookTargetUrl']
      .filter((n) => n !== name)
      .map((n) => src.indexOf(`function ${n}`, start + 1))
      .filter((idx) => idx !== -1);
    const end = nextStarts.length > 0 ? Math.min(...nextStarts) : src.length;
    const rest = src.slice(start, end);
    return rest
      .replace(/\/\*[\s\S]*?\*\//g, ' ') // drop block comments
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '')) // drop trailing line comments
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  it.each(['parseIpv4', 'isBlockedIpv4', 'isBlockedIpv6', 'validateWebhookTargetUrl'])(
    'the %s implementation is identical in both copies',
    (name) => {
      const node = fnBody(nodeSrc, name);
      const deno = fnBody(denoSrc, name);
      expect(node.length).toBeGreaterThan(0);
      expect(deno).toBe(node);
    },
  );

  it('both copies block the same canonical ranges (spot-check of the literals)', () => {
    for (const src of [nodeSrc, denoSrc]) {
      expect(src).toMatch(/a === 127/); // loopback
      expect(src).toMatch(/a === 10/); // 10/8
      expect(src).toMatch(/a === 172 && b >= 16 && b <= 31/); // 172.16/12
      expect(src).toMatch(/a === 192 && b === 168/); // 192.168/16
      expect(src).toMatch(/a === 169 && b === 254/); // link-local + metadata
      expect(src).toMatch(/a === 100 && b >= 64 && b <= 127/); // CGNAT
      expect(src).toMatch(/protocol !== 'https:'/); // https-only
    }
  });
});
