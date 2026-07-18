const encoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(text: string): Uint8Array {
  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Canonicalize a request path so the verifier (Supabase Edge/Deno) and the
 * signer (Vercel/Node, packages/lib/src/security/internal-caller-signing.ts)
 * always HMAC over the SAME string. Byte-identical to the Node twin.
 *
 * On a DEPLOYED edge function Supabase strips the `/functions/v1` prefix, so the
 * verifier's `new URL(req.url).pathname` is `/alfabot-answer` while the Node
 * signer hardcodes `/functions/v1/alfabot-answer`. Applying this on BOTH sides
 * converges every environment onto the bare function path:
 *   - deployed edge: `/alfabot-answer`              -> `/alfabot-answer`
 *   - local / tests: `/functions/v1/alfabot-answer` -> `/alfabot-answer`
 *
 * The transform is total and idempotent, so it is safe to apply centrally here
 * (covers resolveSecurityPrincipal in auth.ts AND verifyInternalCronRequest in
 * internal-cron-auth.ts, both of which build the canonical through this fn).
 */
export function canonicalizeInternalPath(path: string): string {
  let p = path.split('#')[0].split('?')[0];
  p = p.replace(/^\/functions\/v1(?=\/)/, '');
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

export function buildCanonicalInternalRequest(args: {
  method: string;
  path: string;
  requestId: string;
  timestamp: string;
  bodyHash: string;
  caller: string;
}): string {
  return [
    args.method.toUpperCase(),
    canonicalizeInternalPath(args.path),
    args.requestId,
    args.timestamp,
    args.bodyHash,
    args.caller,
  ].join('\n');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signHmac(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return new Uint8Array(sig);
}

export async function signInternalRequest(secret: string, payload: string): Promise<string> {
  return base64UrlEncode(await signHmac(secret, payload));
}

export async function verifyInternalRequestSignature(
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  try {
    const decoded = base64UrlDecode(signature);
    const signatureBytes: Uint8Array<ArrayBuffer> = new Uint8Array(decoded.length);
    signatureBytes.set(decoded);
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(payload),
    );
  } catch {
    return false;
  }
}
