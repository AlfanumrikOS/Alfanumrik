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

/** Rate limit key generator — normalize IP for consistent tracking */
export function normalizeIP(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown';
}
