/**
 * Parent session helpers — HMAC-signed sessionStorage payload for the
 * link-code (anonymous) parent auth mode. Also includes progressive
 * lockout helpers for brute-force protection on the login form.
 *
 * Extracted from `src/app/parent/page.tsx` so the ParentShell and any
 * other parent route can import without circular deps.
 *
 * Behavior must match the original inline implementation exactly —
 * the HMAC nonce, payload shape, TTL, and lockout thresholds are all
 * load-bearing for existing sessions.
 */

// ============================================================
// INTERFACES
// ============================================================
export interface ParentSession {
  id: string;
  name: string;
}

export interface StudentSession {
  id: string;
  name: string;
  grade: string;
}

// Session expiry: 4 hours in milliseconds
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
export const SESSION_KEY = 'alfanumrik_parent_session';

// ============================================================
// HMAC SESSION HELPERS
// Uses Web Crypto API — all processing is client-side only.
// The "secret" here is a per-session nonce stored alongside the
// payload, so the goal is tamper detection (integrity), not
// confidentiality. Data lives in sessionStorage (tab-scoped).
// ============================================================

async function hmacSign(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function storeParentSession(guardian: Record<string, unknown>, student: Record<string, unknown>) {
  const nonce = crypto.randomUUID();
  const issuedAt = Date.now();
  // Only store non-sensitive identifying fields
  const safeGuardian = { id: guardian.id, name: guardian.name };
  const safeStudent = { id: student.id, name: student.name, grade: student.grade };
  const payload = JSON.stringify({ guardian: safeGuardian, student: safeStudent, issuedAt });
  const hmac = await hmacSign(payload, nonce);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ payload, hmac, nonce }));
}

export async function loadParentSession(): Promise<{ guardian: ParentSession; student: StudentSession } | null> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { payload, hmac, nonce } = JSON.parse(raw);
    if (!payload || !hmac || !nonce) return null;

    // Verify integrity
    const expected = await hmacSign(payload, nonce);
    if (expected !== hmac) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }

    const { guardian, student, issuedAt } = JSON.parse(payload);

    // Check expiry
    if (Date.now() - issuedAt > SESSION_TTL_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }

    return { guardian, student };
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function clearParentSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

// ============================================================
// LOCKOUT HELPERS
// Brute-force protection for parent login.
// Tuition centers try to brute-force link codes to monitor students
// they don't own. Progressive lockout: 3 -> 5 -> 15 -> 60 min.
// ============================================================
export const LOCKOUT_KEY = 'alf_parent_lockout';
export const MAX_ATTEMPTS_BEFORE_LOCKOUT = 3;
export const LOCKOUT_DURATIONS = [3 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]; // 3m, 5m, 15m, 1h

export function getLockoutState(): { attempts: number; lockedUntil: number; lockoutLevel: number } {
  try {
    const raw = sessionStorage.getItem(LOCKOUT_KEY);
    if (!raw) return { attempts: 0, lockedUntil: 0, lockoutLevel: 0 };
    return JSON.parse(raw);
  } catch { return { attempts: 0, lockedUntil: 0, lockoutLevel: 0 }; }
}

export function recordFailedAttempt(): string | null {
  const state = getLockoutState();
  state.attempts++;
  if (state.attempts >= MAX_ATTEMPTS_BEFORE_LOCKOUT) {
    const duration = LOCKOUT_DURATIONS[Math.min(state.lockoutLevel, LOCKOUT_DURATIONS.length - 1)];
    state.lockedUntil = Date.now() + duration;
    state.lockoutLevel++;
    state.attempts = 0;
    sessionStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
    const minutes = Math.ceil(duration / 60_000);
    return `Too many failed attempts. Locked for ${minutes} minute${minutes > 1 ? 's' : ''}.`;
  }
  sessionStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
  return null;
}

export function clearLockoutAttempts() {
  sessionStorage.removeItem(LOCKOUT_KEY);
}

export function isLockedOut(): { locked: boolean; message: string } {
  const state = getLockoutState();
  if (state.lockedUntil > Date.now()) {
    const remaining = Math.ceil((state.lockedUntil - Date.now()) / 60_000);
    return { locked: true, message: `Account locked. Try again in ${remaining} minute${remaining > 1 ? 's' : ''}.` };
  }
  return { locked: false, message: '' };
}
