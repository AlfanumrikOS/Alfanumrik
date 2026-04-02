/**
 * ALFANUMRIK -- Centralized Validation Utilities
 *
 * Consolidates input validation patterns used across API routes.
 * Complements src/lib/sanitize.ts (which handles sanitization/stripping).
 * This module provides both type guards (legacy) and Zod schemas (preferred).
 *
 * Product invariant compliance:
 *   P5: Grade format -- grades are strings "6" through "12", never integers.
 *   P11: Payment integrity -- plan codes validated against known set.
 */

import { z } from 'zod';
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

// ══════════════════════════════════════════════════════════
// Zod Schemas — structured validation for API route inputs
// ══════════════════════════════════════════════════════════

// ── Common Validators ───────────────────────────────────

/** Zod: valid UUID string */
export const zUuid = z.string().uuid();

/** Zod: grade string "6" through "12" (P5) */
export const zGrade = z.string().regex(
  /^(6|7|8|9|10|11|12)$/,
  'Grade must be a string from "6" through "12"',
);

/** Zod: email address */
export const zEmail = z.string().email();

/** Zod: subscription plan code */
export const zPlanCode = z.enum(['free', 'starter', 'pro', 'unlimited']);

/** Zod: billing cycle */
export const zBillingCycle = z.enum(['monthly', 'yearly']);

// ── Quiz Submission (P1, P3, P4) ────────────────────────

export const quizAnswerSchema = z.object({
  questionId: zUuid,
  selectedIndex: z.number().int().min(0).max(3),
  isCorrect: z.boolean(),
  timeTaken: z.number().min(0).optional(),
});

export const quizSubmissionSchema = z
  .object({
    quizSessionId: zUuid.optional(),
    studentId: zUuid,
    subject: z.string().min(1).max(100),
    grade: zGrade,
    totalQuestions: z.number().int().min(1).max(100),
    correctAnswers: z.number().int().min(0),
    answers: z.array(quizAnswerSchema),
    duration: z.number().min(0),
    mode: z.enum(['practice', 'exam', 'review']).optional(),
  })
  .refine((data) => data.correctAnswers <= data.totalQuestions, {
    message: 'correctAnswers cannot exceed totalQuestions',
  });

// ── Payment (P11) ───────────────────────────────────────

export const paymentSubscribeSchema = z.object({
  plan_code: zPlanCode,
  billing_cycle: zBillingCycle,
});

export const paymentVerifySchema = z.object({
  razorpay_payment_id: z.string().min(1).startsWith('pay_'),
  razorpay_signature: z.string().min(1),
  razorpay_order_id: z.string().optional(),
  razorpay_subscription_id: z.string().optional(),
  plan_code: zPlanCode,
  billing_cycle: zBillingCycle,
  type: z.enum(['subscription', 'order']).optional(),
});

export const paymentCancelSchema = z.object({
  immediate: z.boolean().optional().default(false),
  reason: z.string().max(500).optional(),
});

// ── Feature Flag ────────────────────────────────────────

export const featureFlagSchema = z.object({
  flag_name: z.string().min(1).max(100).regex(/^[a-z_]+$/, 'Flag name must be lowercase with underscores only'),
  is_enabled: z.boolean(),
  target_roles: z.array(z.string()).nullable().optional(),
  target_environments: z.array(z.string()).nullable().optional(),
  target_institutions: z.array(zUuid).nullable().optional(),
  rollout_percentage: z.number().int().min(0).max(100).nullable().optional(),
});

// ── Admin User Mutation ─────────────────────────────────

export const adminUserUpdateSchema = z.object({
  userId: zUuid,
  action: z.enum(['activate', 'deactivate', 'update_role', 'reset_password']),
  role: z.string().optional(),
  reason: z.string().max(500).optional(),
});

// ── Contact Form ────────────────────────────────────────

export const contactFormSchema = z.object({
  name: z.string().min(1).max(200),
  email: zEmail,
  message: z.string().min(10).max(5000),
  type: z.enum(['general', 'support', 'sales', 'school']).optional(),
});

// ── Error Report ────────────────────────────────────────

export const errorReportSchema = z.object({
  message: z.string().max(2000),
  stack: z.string().max(10000).optional(),
  url: z.string().url().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
  componentStack: z.string().max(5000).optional(),
});

// ── Helper: validate request body with typed result ─────

/**
 * Validate an unknown request body against a Zod schema.
 * Returns either the parsed data or a 400 Response with structured error details.
 *
 * Usage in API routes:
 * ```ts
 * const result = validateBody(paymentSubscribeSchema, body);
 * if (!result.success) return result.error;
 * const { plan_code, billing_cycle } = result.data;
 * ```
 */
export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): { success: true; data: T } | { success: false; error: Response } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: new Response(
      JSON.stringify({
        success: false,
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    ),
  };
}
