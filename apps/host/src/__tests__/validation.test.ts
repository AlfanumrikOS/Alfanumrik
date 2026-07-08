import { describe, it, expect } from 'vitest';
import {
  UUID_REGEX,
  isValidUUID,
  isValidGrade,
  isValidPlanCode,
  isSafeIdentifier,
  isValidEmail,
  sanitizeText,
  zUuid,
  zGrade,
  zPlanCode,
  zBillingCycle,
  quizSubmissionSchema,
  paymentSubscribeSchema,
  featureFlagSchema,
  errorReportSchema,
  contactFormSchema,
  adminUserUpdateSchema,
  validateBody,
} from '../lib/validation';

// ── isValidUUID ──────────────────────────────────────────

describe('isValidUUID', () => {
  it('accepts a valid v4 UUID', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts uppercase UUID', () => {
    expect(isValidUUID('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('accepts mixed-case UUID', () => {
    expect(isValidUUID('550e8400-E29B-41d4-A716-446655440000')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidUUID(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidUUID(undefined)).toBe(false);
  });

  it('rejects a number', () => {
    expect(isValidUUID(12345)).toBe(false);
  });

  it('rejects a UUID without hyphens', () => {
    expect(isValidUUID('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('rejects a short string', () => {
    expect(isValidUUID('550e8400-e29b')).toBe(false);
  });

  it('rejects a string with invalid characters', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-44665544ZZZZ')).toBe(false);
  });

  it('rejects SQL injection in UUID field', () => {
    expect(isValidUUID("'; DROP TABLE students; --")).toBe(false);
  });

  it('UUID_REGEX matches the same values as isValidUUID', () => {
    const valid = '550e8400-e29b-41d4-a716-446655440000';
    expect(UUID_REGEX.test(valid)).toBe(true);
    expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
  });
});

// ── isValidGrade (P5: grades must be strings "6"-"12") ───

describe('isValidGrade', () => {
  it('accepts "6" through "12"', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      expect(isValidGrade(g)).toBe(true);
    }
  });

  it('rejects integer 6 (P5: must be string)', () => {
    expect(isValidGrade(6)).toBe(false);
  });

  it('rejects integer 12 (P5: must be string)', () => {
    expect(isValidGrade(12)).toBe(false);
  });

  it('rejects "5" (below range)', () => {
    expect(isValidGrade('5')).toBe(false);
  });

  it('rejects "13" (above range)', () => {
    expect(isValidGrade('13')).toBe(false);
  });

  it('rejects "0"', () => {
    expect(isValidGrade('0')).toBe(false);
  });

  it('rejects "Grade 9" (prefixed form)', () => {
    expect(isValidGrade('Grade 9')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidGrade('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidGrade(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidGrade(undefined)).toBe(false);
  });

  it('rejects "1" (primary school, not CBSE 6-12)', () => {
    expect(isValidGrade('1')).toBe(false);
  });
});

// ── isValidPlanCode ──────────────────────────────────────

describe('isValidPlanCode', () => {
  it('accepts "free"', () => {
    expect(isValidPlanCode('free')).toBe(true);
  });

  it('accepts "starter"', () => {
    expect(isValidPlanCode('starter')).toBe(true);
  });

  it('accepts "pro"', () => {
    expect(isValidPlanCode('pro')).toBe(true);
  });

  it('accepts "unlimited"', () => {
    expect(isValidPlanCode('unlimited')).toBe(true);
  });

  it('rejects "premium" (not a valid plan)', () => {
    expect(isValidPlanCode('premium')).toBe(false);
  });

  it('rejects "Free" (case-sensitive)', () => {
    expect(isValidPlanCode('Free')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidPlanCode('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidPlanCode(null)).toBe(false);
  });

  it('rejects number 0', () => {
    expect(isValidPlanCode(0)).toBe(false);
  });
});

// ── isSafeIdentifier ────────────────────────────────────

describe('isSafeIdentifier', () => {
  it('accepts alphanumeric string', () => {
    expect(isSafeIdentifier('student123')).toBe(true);
  });

  it('accepts string with hyphens', () => {
    expect(isSafeIdentifier('my-identifier')).toBe(true);
  });

  it('accepts string with underscores', () => {
    expect(isSafeIdentifier('my_identifier')).toBe(true);
  });

  it('accepts single character', () => {
    expect(isSafeIdentifier('a')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isSafeIdentifier('')).toBe(false);
  });

  it('rejects SQL injection string', () => {
    expect(isSafeIdentifier("'; DROP TABLE students; --")).toBe(false);
  });

  it('rejects string with spaces', () => {
    expect(isSafeIdentifier('hello world')).toBe(false);
  });

  it('rejects string with dots (path traversal)', () => {
    expect(isSafeIdentifier('../etc/passwd')).toBe(false);
  });

  it('rejects string with angle brackets (XSS)', () => {
    expect(isSafeIdentifier('<script>alert(1)</script>')).toBe(false);
  });

  it('rejects null', () => {
    expect(isSafeIdentifier(null)).toBe(false);
  });

  it('rejects string longer than 128 characters', () => {
    expect(isSafeIdentifier('a'.repeat(129))).toBe(false);
  });

  it('accepts string of exactly 128 characters', () => {
    expect(isSafeIdentifier('a'.repeat(128))).toBe(true);
  });
});

// ── isValidEmail ─────────────────────────────────────────

describe('isValidEmail', () => {
  it('accepts a standard email', () => {
    expect(isValidEmail('student@example.com')).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(isValidEmail('user@mail.example.co.in')).toBe(true);
  });

  it('accepts email with plus addressing', () => {
    expect(isValidEmail('user+tag@example.com')).toBe(true);
  });

  it('rejects missing @ sign', () => {
    expect(isValidEmail('userexample.com')).toBe(false);
  });

  it('rejects missing domain', () => {
    expect(isValidEmail('user@')).toBe(false);
  });

  it('rejects missing TLD', () => {
    expect(isValidEmail('user@example')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidEmail(null)).toBe(false);
  });

  it('rejects number', () => {
    expect(isValidEmail(42)).toBe(false);
  });

  it('rejects email exceeding 254 characters', () => {
    const longEmail = 'a'.repeat(250) + '@b.com'; // 256 chars total
    expect(isValidEmail(longEmail)).toBe(false);
  });
});

// ── sanitizeText ─────────────────────────────────────────

describe('sanitizeText', () => {
  it('strips HTML tags', () => {
    expect(sanitizeText('<b>bold</b>')).toBe('bold');
  });

  it('strips script tags', () => {
    expect(sanitizeText('<script>alert("xss")</script>')).toBe('alert("xss")');
  });

  it('strips nested tags', () => {
    expect(sanitizeText('<div><p>hello</p></div>')).toBe('hello');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeText('  hello world  ')).toBe('hello world');
  });

  it('returns empty string for tags-only input', () => {
    expect(sanitizeText('<br/><hr/>')).toBe('');
  });

  it('preserves plain text', () => {
    expect(sanitizeText('Hello, World!')).toBe('Hello, World!');
  });

  it('preserves Hindi text', () => {
    expect(sanitizeText('  नमस्ते दुनिया  ')).toBe('नमस्ते दुनिया');
  });

  it('handles empty string', () => {
    expect(sanitizeText('')).toBe('');
  });

  it('strips img tags with attributes', () => {
    expect(sanitizeText('<img src="x" onerror="alert(1)">')).toBe('');
  });
});

// ══════════════════════════════════════════════════════════
// Zod Schema Tests
// ══════════════════════════════════════════════════════════

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '660e8400-e29b-41d4-a716-446655440001';

// ── zUuid ───────────────────────────────────────────────

describe('zUuid', () => {
  it('accepts a valid UUID', () => {
    expect(zUuid.safeParse(VALID_UUID).success).toBe(true);
  });

  it('rejects empty string', () => {
    expect(zUuid.safeParse('').success).toBe(false);
  });

  it('rejects random string', () => {
    expect(zUuid.safeParse('not-a-uuid').success).toBe(false);
  });

  it('rejects number', () => {
    expect(zUuid.safeParse(12345).success).toBe(false);
  });

  it('rejects null', () => {
    expect(zUuid.safeParse(null).success).toBe(false);
  });

  it('rejects UUID without hyphens', () => {
    expect(zUuid.safeParse('550e8400e29b41d4a716446655440000').success).toBe(false);
  });
});

// ── zGrade (P5) ─────────────────────────────────────────

describe('zGrade', () => {
  it('accepts all valid grades "6" through "12"', () => {
    for (const g of ['6', '7', '8', '9', '10', '11', '12']) {
      expect(zGrade.safeParse(g).success).toBe(true);
    }
  });

  it('rejects integer 6 (P5: must be string)', () => {
    expect(zGrade.safeParse(6).success).toBe(false);
  });

  it('rejects "5" below range', () => {
    expect(zGrade.safeParse('5').success).toBe(false);
  });

  it('rejects "13" above range', () => {
    expect(zGrade.safeParse('13').success).toBe(false);
  });

  it('rejects "0"', () => {
    expect(zGrade.safeParse('0').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(zGrade.safeParse('').success).toBe(false);
  });

  it('rejects "Grade 9" prefixed form', () => {
    expect(zGrade.safeParse('Grade 9').success).toBe(false);
  });

  it('rejects " 7" with leading space', () => {
    expect(zGrade.safeParse(' 7').success).toBe(false);
  });
});

// ── zPlanCode ───────────────────────────────────────────

describe('zPlanCode', () => {
  it('accepts all valid plan codes', () => {
    for (const code of ['free', 'starter', 'pro', 'unlimited']) {
      expect(zPlanCode.safeParse(code).success).toBe(true);
    }
  });

  it('rejects "school" (not a valid plan code)', () => {
    expect(zPlanCode.safeParse('school').success).toBe(false);
  });

  it('rejects "Free" (case-sensitive)', () => {
    expect(zPlanCode.safeParse('Free').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(zPlanCode.safeParse('').success).toBe(false);
  });
});

// ── zBillingCycle ───────────────────────────────────────

describe('zBillingCycle', () => {
  it('accepts "monthly"', () => {
    expect(zBillingCycle.safeParse('monthly').success).toBe(true);
  });

  it('accepts "yearly"', () => {
    expect(zBillingCycle.safeParse('yearly').success).toBe(true);
  });

  it('rejects "annual"', () => {
    expect(zBillingCycle.safeParse('annual').success).toBe(false);
  });
});

// ── quizSubmissionSchema ────────────────────────────────

describe('quizSubmissionSchema', () => {
  const validSubmission = {
    studentId: VALID_UUID,
    subject: 'Mathematics',
    grade: '10',
    totalQuestions: 10,
    correctAnswers: 7,
    answers: [
      { questionId: VALID_UUID, selectedIndex: 2, isCorrect: true },
      { questionId: VALID_UUID_2, selectedIndex: 0, isCorrect: false },
    ],
    duration: 120,
  };

  it('accepts a valid quiz submission', () => {
    expect(quizSubmissionSchema.safeParse(validSubmission).success).toBe(true);
  });

  it('accepts with optional fields', () => {
    const full = {
      ...validSubmission,
      quizSessionId: VALID_UUID,
      mode: 'exam' as const,
    };
    expect(quizSubmissionSchema.safeParse(full).success).toBe(true);
  });

  it('accepts answer with optional timeTaken', () => {
    const withTime = {
      ...validSubmission,
      answers: [
        { questionId: VALID_UUID, selectedIndex: 1, isCorrect: true, timeTaken: 5.2 },
      ],
    };
    expect(quizSubmissionSchema.safeParse(withTime).success).toBe(true);
  });

  it('rejects correctAnswers > totalQuestions', () => {
    const bad = { ...validSubmission, correctAnswers: 11, totalQuestions: 10 };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects negative correctAnswers', () => {
    const bad = { ...validSubmission, correctAnswers: -1 };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects totalQuestions = 0', () => {
    const bad = { ...validSubmission, totalQuestions: 0 };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects totalQuestions > 100', () => {
    const bad = { ...validSubmission, totalQuestions: 101 };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects selectedIndex > 3', () => {
    const bad = {
      ...validSubmission,
      answers: [{ questionId: VALID_UUID, selectedIndex: 4, isCorrect: false }],
    };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects selectedIndex < 0', () => {
    const bad = {
      ...validSubmission,
      answers: [{ questionId: VALID_UUID, selectedIndex: -1, isCorrect: false }],
    };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects negative duration', () => {
    const bad = { ...validSubmission, duration: -5 };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects empty subject', () => {
    const bad = { ...validSubmission, subject: '' };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects subject exceeding max length', () => {
    const bad = { ...validSubmission, subject: 'x'.repeat(101) };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects invalid grade "5" (P5)', () => {
    const bad = { ...validSubmission, grade: '5' };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects integer grade (P5)', () => {
    const bad = { ...validSubmission, grade: 10 };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects invalid mode', () => {
    const bad = { ...validSubmission, mode: 'speed' };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects missing studentId', () => {
    const { studentId, ...rest } = validSubmission;
    expect(quizSubmissionSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-integer totalQuestions', () => {
    const bad = { ...validSubmission, totalQuestions: 5.5 };
    expect(quizSubmissionSchema.safeParse(bad).success).toBe(false);
  });
});

// ── paymentSubscribeSchema (P11) ────────────────────────

describe('paymentSubscribeSchema', () => {
  it('accepts valid plan_code + billing_cycle', () => {
    expect(paymentSubscribeSchema.safeParse({ plan_code: 'pro', billing_cycle: 'monthly' }).success).toBe(true);
  });

  it('accepts yearly billing', () => {
    expect(paymentSubscribeSchema.safeParse({ plan_code: 'starter', billing_cycle: 'yearly' }).success).toBe(true);
  });

  it('rejects missing plan_code', () => {
    expect(paymentSubscribeSchema.safeParse({ billing_cycle: 'monthly' }).success).toBe(false);
  });

  it('rejects missing billing_cycle', () => {
    expect(paymentSubscribeSchema.safeParse({ plan_code: 'pro' }).success).toBe(false);
  });

  it('rejects invalid plan_code', () => {
    expect(paymentSubscribeSchema.safeParse({ plan_code: 'premium', billing_cycle: 'monthly' }).success).toBe(false);
  });

  it('rejects invalid billing_cycle', () => {
    expect(paymentSubscribeSchema.safeParse({ plan_code: 'pro', billing_cycle: 'weekly' }).success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(paymentSubscribeSchema.safeParse({}).success).toBe(false);
  });

  it('rejects null', () => {
    expect(paymentSubscribeSchema.safeParse(null).success).toBe(false);
  });
});

// ── featureFlagSchema ───────────────────────────────────

describe('featureFlagSchema', () => {
  it('accepts minimal valid flag', () => {
    expect(featureFlagSchema.safeParse({ flag_name: 'enable_quiz', is_enabled: true }).success).toBe(true);
  });

  it('accepts flag with all optional fields', () => {
    const full = {
      flag_name: 'beta_feature',
      is_enabled: false,
      target_roles: ['student', 'teacher'],
      target_environments: ['staging'],
      target_institutions: [VALID_UUID],
      rollout_percentage: 50,
    };
    expect(featureFlagSchema.safeParse(full).success).toBe(true);
  });

  it('accepts nullable optional fields set to null', () => {
    const withNulls = {
      flag_name: 'test_flag',
      is_enabled: true,
      target_roles: null,
      rollout_percentage: null,
    };
    expect(featureFlagSchema.safeParse(withNulls).success).toBe(true);
  });

  it('rejects flag_name with uppercase', () => {
    expect(featureFlagSchema.safeParse({ flag_name: 'Enable_Quiz', is_enabled: true }).success).toBe(false);
  });

  it('rejects flag_name with spaces', () => {
    expect(featureFlagSchema.safeParse({ flag_name: 'enable quiz', is_enabled: true }).success).toBe(false);
  });

  it('rejects empty flag_name', () => {
    expect(featureFlagSchema.safeParse({ flag_name: '', is_enabled: true }).success).toBe(false);
  });

  it('rejects flag_name exceeding 100 chars', () => {
    expect(featureFlagSchema.safeParse({ flag_name: 'a'.repeat(101), is_enabled: true }).success).toBe(false);
  });

  it('rejects rollout_percentage > 100', () => {
    expect(featureFlagSchema.safeParse({ flag_name: 'test', is_enabled: true, rollout_percentage: 101 }).success).toBe(false);
  });

  it('rejects rollout_percentage < 0', () => {
    expect(featureFlagSchema.safeParse({ flag_name: 'test', is_enabled: true, rollout_percentage: -1 }).success).toBe(false);
  });

  it('rejects non-integer rollout_percentage', () => {
    expect(featureFlagSchema.safeParse({ flag_name: 'test', is_enabled: true, rollout_percentage: 33.3 }).success).toBe(false);
  });

  it('rejects missing is_enabled', () => {
    expect(featureFlagSchema.safeParse({ flag_name: 'test' }).success).toBe(false);
  });
});

// ── adminUserUpdateSchema ───────────────────────────────

describe('adminUserUpdateSchema', () => {
  it('accepts valid activate action', () => {
    expect(adminUserUpdateSchema.safeParse({ userId: VALID_UUID, action: 'activate' }).success).toBe(true);
  });

  it('accepts with optional role and reason', () => {
    const data = { userId: VALID_UUID, action: 'update_role', role: 'teacher', reason: 'Promoted' };
    expect(adminUserUpdateSchema.safeParse(data).success).toBe(true);
  });

  it('rejects invalid action', () => {
    expect(adminUserUpdateSchema.safeParse({ userId: VALID_UUID, action: 'delete' }).success).toBe(false);
  });

  it('rejects invalid userId', () => {
    expect(adminUserUpdateSchema.safeParse({ userId: 'bad', action: 'activate' }).success).toBe(false);
  });

  it('rejects reason exceeding 500 chars', () => {
    const data = { userId: VALID_UUID, action: 'deactivate', reason: 'x'.repeat(501) };
    expect(adminUserUpdateSchema.safeParse(data).success).toBe(false);
  });
});

// ── contactFormSchema ───────────────────────────────────

describe('contactFormSchema', () => {
  it('accepts valid contact form', () => {
    const data = { name: 'Priya', email: 'priya@example.com', message: 'I need help with my account.' };
    expect(contactFormSchema.safeParse(data).success).toBe(true);
  });

  it('accepts with optional type', () => {
    const data = { name: 'Aman', email: 'aman@school.in', message: 'Interested in school plan.', type: 'school' };
    expect(contactFormSchema.safeParse(data).success).toBe(true);
  });

  it('rejects empty name', () => {
    expect(contactFormSchema.safeParse({ name: '', email: 'a@b.com', message: 'hello world' }).success).toBe(false);
  });

  it('rejects message under 10 chars', () => {
    expect(contactFormSchema.safeParse({ name: 'A', email: 'a@b.com', message: 'short' }).success).toBe(false);
  });

  it('rejects message over 5000 chars', () => {
    expect(contactFormSchema.safeParse({ name: 'A', email: 'a@b.com', message: 'x'.repeat(5001) }).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(contactFormSchema.safeParse({ name: 'A', email: 'not-email', message: 'hello world!!' }).success).toBe(false);
  });

  it('rejects invalid type', () => {
    expect(contactFormSchema.safeParse({ name: 'A', email: 'a@b.com', message: 'hello world!!', type: 'complaint' }).success).toBe(false);
  });
});

// ── errorReportSchema ───────────────────────────────────

describe('errorReportSchema', () => {
  it('accepts minimal error report', () => {
    expect(errorReportSchema.safeParse({ message: 'Something went wrong' }).success).toBe(true);
  });

  it('accepts full error report', () => {
    const data = {
      message: 'TypeError: Cannot read property',
      stack: 'at Object.<anonymous>',
      url: 'https://alfanumrik.com/quiz',
      userAgent: 'Mozilla/5.0',
      componentStack: 'in QuizPage',
    };
    expect(errorReportSchema.safeParse(data).success).toBe(true);
  });

  it('rejects message over 2000 chars', () => {
    expect(errorReportSchema.safeParse({ message: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('rejects stack over 10000 chars', () => {
    expect(errorReportSchema.safeParse({ message: 'err', stack: 'x'.repeat(10001) }).success).toBe(false);
  });

  it('rejects invalid url format', () => {
    expect(errorReportSchema.safeParse({ message: 'err', url: 'not-a-url' }).success).toBe(false);
  });

  it('rejects null body', () => {
    expect(errorReportSchema.safeParse(null).success).toBe(false);
  });

  it('rejects number as message', () => {
    expect(errorReportSchema.safeParse({ message: 42 }).success).toBe(false);
  });
});

// ── validateBody helper ─────────────────────────────────

describe('validateBody', () => {
  it('returns success with parsed data for valid input', () => {
    const result = validateBody(paymentSubscribeSchema, { plan_code: 'pro', billing_cycle: 'yearly' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plan_code).toBe('pro');
      expect(result.data.billing_cycle).toBe('yearly');
    }
  });

  it('returns error Response with status 400 for invalid input', () => {
    const result = validateBody(paymentSubscribeSchema, { plan_code: 'invalid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(Response);
      expect(result.error.status).toBe(400);
    }
  });

  it('error Response body contains structured error details', async () => {
    const result = validateBody(paymentSubscribeSchema, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      const body = await result.error.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Validation failed');
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
      expect(body.details[0]).toHaveProperty('path');
      expect(body.details[0]).toHaveProperty('message');
    }
  });

  it('error Response has Content-Type application/json', () => {
    const result = validateBody(paymentSubscribeSchema, null);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.headers.get('Content-Type')).toBe('application/json');
    }
  });

  it('works with quizSubmissionSchema refinement errors', () => {
    const bad = {
      studentId: VALID_UUID,
      subject: 'Math',
      grade: '10',
      totalQuestions: 5,
      correctAnswers: 10,
      answers: [],
      duration: 60,
    };
    const result = validateBody(quizSubmissionSchema, bad);
    expect(result.success).toBe(false);
  });
});
