/**
 * Public API v1 — SSRF guard for outbound webhook target URLs (Track A.6).
 * ============================================================================
 * A school admin registers an arbitrary `target_url` for outbound webhooks. That
 * URL is fetched server-side by the dispatcher, so it is a classic SSRF vector:
 * a malicious/compromised admin could point it at an internal address (cloud
 * metadata endpoint, localhost admin port, private RFC1918 host) to make OUR
 * server reach into the private network on their behalf.
 *
 * Defense (MANDATORY — architect condition):
 *   - https ONLY (signed payloads never go in cleartext; the DB CHECK also enforces).
 *   - Block loopback (127.0.0.0/8, ::1), link-local (169.254/16 incl. the
 *     169.254.169.254 cloud-metadata IP, fe80::/10), and ALL RFC1918 / unique-local
 *     private ranges (10/8, 172.16/12, 192.168/16, fc00::/7), plus 0.0.0.0/8 and
 *     CGNAT 100.64/10.
 *   - Block hosts that are bare IPs in those ranges AND obviously-internal
 *     hostnames (localhost, *.local, *.internal).
 *
 * This module is the AUTHORITATIVE Node/Next.js validator used at subscription
 * CREATE time. The Deno dispatcher carries a byte-equivalent copy in
 * `supabase/functions/_shared/ssrf.ts` (Deno cannot import src/lib/*), and
 * re-checks the host IMMEDIATELY BEFORE every send (DNS can change between create
 * and send — rebinding defense). Keep the two in sync.
 */

export interface SsrfVerdict {
  ok: boolean;
  /** Reason the URL was rejected (safe to surface to the admin). */
  reason?: string;
  /** Parsed hostname when the URL parsed (lowercased). */
  host?: string;
}

/** Hostnames that are categorically internal and never valid webhook sinks. */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);

/** Suffixes that denote internal/private DNS namespaces. */
const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost'];

function parseIpv4(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = m.slice(1).map((s) => Number(s));
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return octets;
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private 10/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private 192.168/16
  if (a === 169 && b === 254) return true; // link-local 169.254/16 (incl. metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isBlockedIpv6(rawHost: string): boolean {
  let h = rawHost;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  h = h.toLowerCase();
  if (!h.includes(':')) return false;
  if (h === '::1' || h === '::') return true;
  if (h.startsWith('fe80:') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) {
    return true;
  }
  if (h.startsWith('fc') || h.startsWith('fd')) return true;
  const mapped = h.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    const v4 = parseIpv4(mapped[1]);
    if (v4 && isBlockedIpv4(v4)) return true;
  }
  return false;
}

export function validateWebhookTargetUrl(rawUrl: string): SsrfVerdict {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'target_url is not a valid URL' };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'target_url must use https' };
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    return { ok: false, reason: 'target_url has no host' };
  }

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: 'target_url host is not allowed', host };
  }
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'target_url host is not allowed', host };
  }

  const v4 = parseIpv4(host);
  if (v4 && isBlockedIpv4(v4)) {
    return { ok: false, reason: 'target_url resolves to a private or loopback address', host };
  }

  if (isBlockedIpv6(host) || isBlockedIpv6(url.host)) {
    return { ok: false, reason: 'target_url resolves to a private or loopback address', host };
  }

  return { ok: true, host };
}
