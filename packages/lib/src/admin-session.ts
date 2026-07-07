/**
 * Admin session helpers — browser/client only.
 * These are safe to import in client components.
 * Server-side auth (requireAdminSecret, logAdminAction) lives in admin-auth.ts.
 */

const SESSION_KEY = 'alfa_admin_secret';

export function getAdminSecretFromSession(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(SESSION_KEY) || '';
}

export function setAdminSecretInSession(secret: string): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(SESSION_KEY, secret);
}

export function clearAdminSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_KEY);
}

export function adminHeaders(secret: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-admin-secret': secret,
  };
}
