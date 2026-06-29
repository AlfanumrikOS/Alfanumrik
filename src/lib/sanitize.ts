/**
 * ALFANUMRIK — Input Sanitization
 *
 * Server-side input validation and sanitization for:
 * - API route handlers (Next.js)
 * - Edge functions (Supabase/Deno)
 * - Client-side form inputs (defense in depth)
 *
 * Prevents: XSS, SQL injection, path traversal, oversized payloads
 */

/** Strip HTML tags and dangerous characters from user-provided strings */
export function sanitizeText(input: string, maxLength = 1000): string {
  return input
    .replace(/<[^>]*>/g, '')           // Strip HTML tags
    .replace(/[<>"'`;(){}]/g, '')      // Remove dangerous chars
    .replace(/\\/g, '')                // Remove backslashes
    .trim()
    .slice(0, maxLength);
}

/** Sanitize a filename for storage (alphanumeric + dash + underscore + dot) */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')           // No path traversal via ..
    .slice(0, 255);
}

/** Validate UUID format (v4) */
export function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Validate a parent/guardian link code (a.k.a. student invite code).
 *
 * Codes are server-generated and are always a subset of [A-Z0-9]:
 *   - students.link_code   = upper(substr(md5(...),1,6))            → 6 uppercase hex chars
 *   - students.invite_code = upper(encode(gen_random_bytes(4),hex)) → 8 uppercase hex chars
 *   - generate_parent_link_code() → 6 uppercase hex chars
 *
 * This guard is applied BEFORE the value is interpolated into any PostgREST
 * `.or()` filter (e.g. `invite_code.eq.${code},link_code.eq.${code}`), so a
 * crafted code containing PostgREST control characters (comma, `.`, `(`, `)`,
 * `*`, `:`, quotes, whitespace, `.eq.`) can never reach the query and alter it
 * (PP-2 filter-injection guard). The 4–12 width covers both the 6- and 8-char
 * formats with margin while admitting no PostgREST metacharacter.
 *
 * Pass the value AFTER `.trim().toUpperCase()` normalization (callers already
 * normalize for correctness; this validates for safety).
 *
 * NOTE: an identical twin lives at `supabase/functions/_shared/link-code.ts`
 * for the Deno/Edge runtime — the supabase/ ↔ src/ tree boundary cannot be
 * crossed at deploy time, so the two copies MUST be kept in sync.
 */
export const LINK_CODE_RE = /^[A-Z0-9]{4,12}$/;

export function isValidLinkCode(code: string): boolean {
  return LINK_CODE_RE.test(code);
}

/** Validate grade format (e.g., "6", "7", "8", "9", "10", "11", "12") */
export function isValidGrade(grade: string | number): boolean {
  const g = typeof grade === 'string' ? parseInt(grade, 10) : grade;
  return Number.isInteger(g) && g >= 1 && g <= 12;
}

/** Validate subject code */
const VALID_SUBJECTS = new Set([
  'math', 'science', 'english', 'hindi', 'social_science',
  'physics', 'chemistry', 'biology', 'accountancy',
  'business_studies', 'economics', 'computer_science',
]);

export function isValidSubject(subject: string): boolean {
  return VALID_SUBJECTS.has(subject.toLowerCase());
}

/** Validate and parse pagination parameters */
export function parsePagination(
  page?: string | null,
  pageSize?: string | null,
  maxPageSize = 100,
): { offset: number; limit: number } {
  const p = Math.max(1, parseInt(page || '1', 10) || 1);
  const size = Math.min(maxPageSize, Math.max(1, parseInt(pageSize || '50', 10) || 50));
  return { offset: (p - 1) * size, limit: size };
}

/** Validate API request body — ensure required fields exist and types match */
export function validateBody<T extends Record<string, unknown>>(
  body: unknown,
  schema: Record<keyof T, 'string' | 'number' | 'boolean' | 'object'>,
): { valid: true; data: T } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const record = body as Record<string, unknown>;
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const [field, expectedType] of Object.entries(schema)) {
    if (record[field] === undefined || record[field] === null) {
      missing.push(field);
    } else if (typeof record[field] !== expectedType) {
      invalid.push(`${field} must be ${expectedType}, got ${typeof record[field]}`);
    }
  }

  if (missing.length > 0) {
    return { valid: false, error: `Missing required fields: ${missing.join(', ')}` };
  }
  if (invalid.length > 0) {
    return { valid: false, error: invalid.join('; ') };
  }

  return { valid: true, data: body as T };
}

/** Validate password strength — minimum 8 chars, must include uppercase, lowercase, and digit */
export const PASSWORD_MIN_LENGTH = 8;

export function validatePassword(password: string): { valid: true } | { valid: false; error: string } {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must include a lowercase letter' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must include an uppercase letter' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, error: 'Password must include a number' };
  }
  return { valid: true };
}

/** Rate limit key generator — normalize IP for consistent tracking */
export function normalizeIP(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}
