#!/usr/bin/env node
/**
 * Auth Flow Guard — Pre-deploy Check
 *
 * Runs before every production build. Blocks deployment if core auth files are broken.
 * Add this to CI/CD: node scripts/auth-guard.js && next build
 *
 * Checks:
 *   1. src/middleware.ts must NOT exist (Next.js 16 uses proxy.ts only)
 *   2. src/proxy.ts MUST exist and export `proxy` function
 *   3. src/app/login/page.tsx must exist
 *   4. src/app/auth/callback/route.ts must exist
 *   5. src/app/auth/confirm/route.ts must exist
 *   6. AuthScreen.tsx must NOT have client-side profile inserts
 *   7. AuthContext.tsx must NOT have client-side profile inserts
 *   8. src/app/api/auth/session/route.ts must exist
 *   9. AuthScreen.tsx must have all 4 role tabs (Student, Teacher, Parent, School)
 *  10. proxy.ts must have security headers
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const errors = [];

console.log('🔒 Auth Flow Guard — Pre-deploy Check');
console.log('');

function read(filePath) {
  const full = path.join(ROOT, filePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf-8');
}

function exists(filePath) {
  return fs.existsSync(path.join(ROOT, filePath));
}

function fail(msg) {
  errors.push(msg);
  console.error(msg);
}

// ── Check 1: middleware.ts must NOT exist ─────────────────────────────────────
if (exists('src/middleware.ts')) {
  fail('❌ FATAL: src/middleware.ts exists! Next.js 16 only allows proxy.ts. Delete it.');
}

// ── Check 2: proxy.ts MUST exist and export proxy function ───────────────────
const proxyContent = read('src/proxy.ts');
if (proxyContent === null) {
  fail('❌ FATAL: src/proxy.ts is missing! This is the Next.js 16 routing layer.');
} else {
  if (!proxyContent.match(/export\s+async\s+function\s+proxy\s*\(/)) {
    fail('❌ FATAL: src/proxy.ts does not export a `proxy` function. Auth routing is broken.');
  }
  if (!proxyContent.includes('X-Frame-Options')) {
    fail('❌ FATAL: src/proxy.ts is missing security headers (X-Frame-Options). XSS protection broken.');
  }
}

// ── Check 3: Login page must exist ───────────────────────────────────────────
if (!exists('src/app/login/page.tsx')) {
  fail('❌ FATAL: src/app/login/page.tsx is missing! Users cannot log in.');
}

// ── Check 4: Auth callback must exist ────────────────────────────────────────
if (!exists('src/app/auth/callback/route.ts')) {
  fail('❌ FATAL: src/app/auth/callback/route.ts is missing! Email verification is broken.');
}

// ── Check 5: Auth confirm must exist ─────────────────────────────────────────
if (!exists('src/app/auth/confirm/route.ts')) {
  fail('❌ FATAL: src/app/auth/confirm/route.ts is missing! Token-hash email flows are broken.');
}

// ── Check 6: No client-side profile inserts in AuthScreen ────────────────────
const authScreenContent = read('src/components/auth/AuthScreen.tsx');
if (authScreenContent !== null) {
  const clientInsertPattern = /\.from\('students'\)\.insert|\.from\('teachers'\)\.insert|\.from\('guardians'\)\.insert/;
  if (clientInsertPattern.test(authScreenContent)) {
    fail('❌ FATAL: AuthScreen.tsx has client-side profile inserts. This bypasses RLS — violates P8.');
  }
}

// ── Check 7: No client-side profile inserts in AuthContext ───────────────────
const authContextContent = read('src/lib/AuthContext.tsx');
if (authContextContent !== null) {
  const clientInsertPattern = /\.from\('students'\)\.insert|\.from\('teachers'\)\.insert|\.from\('guardians'\)\.insert/;
  if (clientInsertPattern.test(authContextContent)) {
    fail('❌ FATAL: AuthContext.tsx has client-side profile inserts. This bypasses RLS — violates P8.');
  }
}

// ── Check 8: Session API must exist ──────────────────────────────────────────
if (!exists('src/app/api/auth/session/route.ts')) {
  fail('❌ FATAL: src/app/api/auth/session/route.ts is missing! Session management is broken.');
}

// ── Check 9: All 4 role tabs in AuthScreen ────────────────────────────────────
if (authScreenContent !== null) {
  for (const role of ['Student', 'Teacher', 'Parent', 'School']) {
    if (!authScreenContent.includes(`label: '${role}'`)) {
      fail(`❌ FATAL: AuthScreen.tsx is missing the ${role} role tab.`);
    }
  }
}

// ── Check 10: identity/constants.ts has all 4 roles ──────────────────────────
const identityContent = read('src/lib/identity/constants.ts');
if (identityContent !== null) {
  for (const role of ['student', 'teacher', 'parent', 'institution_admin']) {
    if (!identityContent.includes(`'${role}'`)) {
      fail(`❌ FATAL: identity/constants.ts is missing role: ${role}`);
    }
  }
}

// ── Result ────────────────────────────────────────────────────────────────────
console.log('');
if (errors.length > 0) {
  console.error(`\n🚨 Auth Flow Guard FAILED — ${errors.length} critical issue(s) found.\n`);
  console.error('Fix all issues above before deploying.\n');
  process.exit(1);
}

console.log('✅ Auth Flow Guard — All checks passed. Safe to deploy.\n');
