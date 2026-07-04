/**
 * SSRF guard for outbound webhook target URLs — Deno copy (Track A.6).
 * ============================================================================
 * Deno cannot import src/lib/*, so this is a byte-EQUIVALENT copy of
 * src/lib/public-api/ssrf.ts. The webhook-dispatcher Edge Function re-checks the
 * target host IMMEDIATELY BEFORE every send (DNS-rebinding defense — the host
 * passed the create-time gate but may now resolve into a private range).
 *
 * Blocks: non-https; loopback (127/8, ::1); link-local (169.254/16 incl. the
 * 169.254.169.254 cloud-metadata IP, fe80::/10); RFC1918 / unique-local private
 * ranges (10/8, 172.16/12, 192.168/16, fc00::/7); 0.0.0.0/8; CGNAT 100.64/10;
 * multicast/reserved; and obviously-internal hostnames (localhost, *.local,
 * *.internal). Keep in sync with the Node copy.
 */

export interface SsrfVerdict {
  ok: boolean;
  reason?: string;
  host?: string;
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain']);
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
