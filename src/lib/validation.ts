/**
 * ALFANUMRIK -- Centralized Validation Utilities
 *
 * Consolidates input validation patterns used across API routes.
 * Complements src/lib/sanitize.ts (which handles sanitization/stripping).
 * This module focuses on type-safe validation with type guards.
 *
 * Product invariant compliance:
 *   P5: Grade format -- grades are strings "6" through "12", never integers.
 *   P11: Payment integrity -- plan codes validated against known set.
 */

import { GRADES } from './constants';

// ── UUID Validation ──────────────────────────────────────

/** Matches any valid UUID (v1-v5), case-insensitive */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Type guard: returns true if `id` is a string matching UUID format */
export function isValidUUID(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

// ── Grade Validation (P5) ────────────────────────────────

/** Valid CBSE grades: string "6" through "12" */
const VALID_GRADES = new Set<string>(GRADES);

/**
 * Type guard: returns true if `grade` is a string and one of "6"-"12".
 * Rejects integers (P5: grades are always strings).
 * Rejects prefixed forms like "Grade 9".
 */
export function isValidGrade(grade: unknown): grade is string {
  return typeof grade === 'string' && VALID_GRADES.has(grade);
}

// ── Plan Code Validation ─────────────────────────────────

const VALID_PLAN_CODES = new Set(['free', 'starter', 'pro', 'unlimited']);

/** Type guard: returns true if `code` is a recognized subscription plan code */
export function isValidPlanCode(code: unknown): code is string {
  return typeof code === 'string' && VALID_PLAN_CODES.has(code);
}

// ── Safe Identifier ──────────────────────────────────────

/** Matches alphanumeric strings with hyphens and underscores, 1-128 chars */
const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Type guard: returns true if `id` is a safe identifier string.
 * Blocks SQL injection, path traversal, and special characters.
 */
export function isSafeIdentifier(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID_REGEX.test(id);
}

// ── Email Validation ─────────────────────────────────────

/** Basic email format: local@domain.tld */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Type guard: returns true if `email` is a string matching basic email format */
export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length <= 254 && EMAIL_REGEX.test(email);
}

// ── Text Sanitization ────────────────────────────────────

/**
 * Strip HTML tags and trim whitespace. Does NOT remove special characters
 * beyond tags (use sanitize.ts sanitizeText for aggressive stripping).
 */
export function sanitizeText(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}
