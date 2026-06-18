import { sha256Hex } from './request-signature.ts';

export function getRequestId(req: Request): string {
  return req.headers.get('x-request-id') ?? crypto.randomUUID();
}

export function getRequestIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-client-ip') ??
    null
  );
}

export async function hashRequestIp(ip: string | null, salt = ''): Promise<string> {
  if (!ip) return '';
  return sha256Hex(`${salt}:${ip}`);
}

export function getRequestOrigin(req: Request): string | null {
  return req.headers.get('origin');
}

