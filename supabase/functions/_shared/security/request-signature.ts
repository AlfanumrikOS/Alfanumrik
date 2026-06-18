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
    args.path,
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
