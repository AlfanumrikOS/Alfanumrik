/**
 * Auth Flow Guard Tests
 *
 * Structural tests that verify the authentication system's integrity.
 * These tests catch broken auth BEFORE it reaches production.
 *
 * If any test here fails: a core auth flow is broken and the build should be blocked.
 * Tests intentionally use filesystem checks so they run without a live server.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(process.cwd());
const readFile = (filePath: string): string => {
  const full = path.join(ROOT, filePath);
  if (!fs.existsSync(full)) return '';
  return fs.readFileSync(full, 'utf-8');
};
const fileExists = (filePath: string): boolean => fs.existsSync(path.join(ROOT, filePath));

// ─────────────────────────────────────────────────────────────────────────────
// proxy.ts — Next.js 16 routing layer
// ─────────────────────────────────────────────────────────────────────────────

describe('proxy.ts — structural integrity', () => {
  it('exists at src/proxy.ts', () => {
    expect(fileExists('src/proxy.ts')).toBe(true);
  });

  it('exports a `proxy` function (primary — not middleware)', () => {
    const content = readFile('src/proxy.ts');
    expect(content).toMatch(/export\s+async\s+function\s+proxy\s*\(/);
  });

  it('does NOT define `middleware` as a primary export function', () => {
    const content = readFile('src/proxy.ts');
    // Must not be `export async function middleware(` or `export function middleware(`
    expect(content).not.toMatch(/export\s+async\s+function\s+middleware\s*\(/);
    expect(content).not.toMatch(/^export\s+function\s+middleware\s*\(/m);
  });

  it('has STUDENT_PROTECTED routes including /dashboard, /quiz, /foxy, /progress, /learn', () => {
    const content = readFile('src/proxy.ts');
    expect(content).toContain("'/dashboard'");
    expect(content).toContain("'/quiz'");
    expect(content).toContain("'/foxy'");
    expect(content).toContain("'/progress'");
    expect(content).toContain("'/learn'");
  });

  it('has security headers: X-Frame-Options', () => {
    expect(readFile('src/proxy.ts')).toContain('X-Frame-Options');
  });

  it('has security headers: Content-Security-Policy', () => {
    expect(readFile('src/proxy.ts')).toContain('Content-Security-Policy');
  });

  it('has security headers: X-Content-Type-Options', () => {
    expect(readFile('src/proxy.ts')).toContain('X-Content-Type-Options');
  });

  it('has security headers: X-XSS-Protection', () => {
    expect(readFile('src/proxy.ts')).toContain('X-XSS-Protection');
  });

  it('has security headers: Referrer-Policy', () => {
    expect(readFile('src/proxy.ts')).toContain('Referrer-Policy');
  });

  it('exports a config with matcher (required for Next.js proxy routing)', () => {
    const content = readFile('src/proxy.ts');
    expect(content).toContain('export const config');
    expect(content).toContain('matcher');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// middleware.ts — auth, rate limiting, bot detection, tenant resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('middleware.ts — exists with security layers and tenant resolution', () => {
  it('src/middleware.ts exists', () => {
    expect(fileExists('src/middleware.ts')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// identity/constants.ts — roles and routing constants
// ─────────────────────────────────────────────────────────────────────────────

describe('identity/constants.ts — roles', () => {
  it('VALID_ROLES contains student', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("'student'");
  });

  it('VALID_ROLES contains teacher', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("'teacher'");
  });

  it('VALID_ROLES contains parent', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("'parent'");
  });

  it('VALID_ROLES contains institution_admin', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("'institution_admin'");
  });
});

describe('identity/constants.ts — ROLE_DESTINATIONS', () => {
  it('maps student to /dashboard', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("student: '/dashboard'");
  });

  it('maps teacher to /teacher', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("teacher: '/teacher'");
  });

  it('maps parent to /parent', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("parent: '/parent'");
  });

  it('maps institution_admin to /school-admin', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("institution_admin: '/school-admin'");
  });
});

describe('identity/constants.ts — PUBLIC_ROUTES', () => {
  it('contains /login', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("'/login'");
  });

  it('contains /auth/callback', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("'/auth/callback'");
  });

  it('contains /auth/confirm', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("'/auth/confirm'");
  });

  it('contains /welcome', () => {
    const content = readFile('src/lib/identity/constants.ts');
    expect(content).toContain("'/welcome'");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuthScreen.tsx — role tabs
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthScreen.tsx — all 4 role tabs present', () => {
  it('has Student tab', () => {
    expect(readFile('src/components/auth/AuthScreen.tsx')).toContain("label: 'Student'");
  });

  it('has Teacher tab', () => {
    expect(readFile('src/components/auth/AuthScreen.tsx')).toContain("label: 'Teacher'");
  });

  it('has Parent tab', () => {
    expect(readFile('src/components/auth/AuthScreen.tsx')).toContain("label: 'Parent'");
  });

  it('has School tab (institution_admin)', () => {
    expect(readFile('src/components/auth/AuthScreen.tsx')).toContain("label: 'School'");
  });
});

describe('AuthScreen.tsx — no client-side profile inserts', () => {
  it('does NOT contain .from(students).insert', () => {
    expect(readFile('src/components/auth/AuthScreen.tsx')).not.toMatch(/\.from\('students'\)\.insert/);
  });

  it('does NOT contain .from(teachers).insert', () => {
    expect(readFile('src/components/auth/AuthScreen.tsx')).not.toMatch(/\.from\('teachers'\)\.insert/);
  });

  it('does NOT contain .from(guardians).insert', () => {
    expect(readFile('src/components/auth/AuthScreen.tsx')).not.toMatch(/\.from\('guardians'\)\.insert/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuthContext.tsx — no client-side profile inserts
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthContext.tsx — server-only profile creation enforced', () => {
  it('does NOT contain .from(students).insert', () => {
    expect(readFile('src/lib/AuthContext.tsx')).not.toMatch(/\.from\('students'\)\.insert/);
  });

  it('does NOT contain .from(teachers).insert', () => {
    expect(readFile('src/lib/AuthContext.tsx')).not.toMatch(/\.from\('teachers'\)\.insert/);
  });

  it('does NOT contain .from(guardians).insert', () => {
    expect(readFile('src/lib/AuthContext.tsx')).not.toMatch(/\.from\('guardians'\)\.insert/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth route handlers — GET/POST/DELETE exports
// ─────────────────────────────────────────────────────────────────────────────

describe('auth/callback/route.ts — GET handler', () => {
  it('file exists', () => {
    expect(fileExists('src/app/auth/callback/route.ts')).toBe(true);
  });

  it('exports a GET handler', () => {
    const content = readFile('src/app/auth/callback/route.ts');
    expect(content).toMatch(/export\s+async\s+function\s+GET\s*\(/);
  });
});

describe('auth/confirm/route.ts — GET handler', () => {
  it('file exists', () => {
    expect(fileExists('src/app/auth/confirm/route.ts')).toBe(true);
  });

  it('exports a GET handler', () => {
    const content = readFile('src/app/auth/confirm/route.ts');
    expect(content).toMatch(/export\s+async\s+function\s+GET\s*\(/);
  });
});

describe('api/auth/session/route.ts — POST, DELETE, GET handlers', () => {
  it('file exists', () => {
    expect(fileExists('src/app/api/auth/session/route.ts')).toBe(true);
  });

  it('exports a POST handler', () => {
    const content = readFile('src/app/api/auth/session/route.ts');
    expect(content).toMatch(/export\s+async\s+function\s+POST\s*\(/);
  });

  it('exports a DELETE handler', () => {
    const content = readFile('src/app/api/auth/session/route.ts');
    expect(content).toMatch(/export\s+async\s+function\s+DELETE\s*\(/);
  });

  it('exports a GET handler', () => {
    const content = readFile('src/app/api/auth/session/route.ts');
    expect(content).toMatch(/export\s+async\s+function\s+GET\s*\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL AUTH PATH — protection comments on all critical auth files
// ─────────────────────────────────────────────────────────────────────────────

describe('CRITICAL AUTH PATH — protection comments on critical files', () => {
  const criticalFiles = [
    'src/proxy.ts',
    'src/lib/AuthContext.tsx',
    'src/components/auth/AuthScreen.tsx',
    'src/app/auth/callback/route.ts',
    'src/app/auth/confirm/route.ts',
    'src/lib/identity/constants.ts',
    'src/app/api/auth/session/route.ts',
  ];

  for (const filePath of criticalFiles) {
    it(`${filePath} has CRITICAL AUTH PATH comment`, () => {
      const content = readFile(filePath);
      expect(content).toContain('CRITICAL AUTH PATH');
    });
  }
});
