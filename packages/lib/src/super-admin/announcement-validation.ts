// src/lib/super-admin/announcement-validation.ts
// Input validation for /api/super-admin/announcements (POST) and
// /api/super-admin/announcements/[id] (PATCH).
// Extracted from the route modules so it can be unit-tested without mocking
// supabase-admin or rbac — same pattern as misconception-validation.ts.

export const MAX_TITLE_LEN = 200;
export const MAX_CONTENT_LEN = 5000;

export interface CreateAnnouncementPayload {
  title: string;
  content: string;
  target_grades: string[];
  target_subjects: string[];
  expires_at: string | null;
}

export interface UpdateAnnouncementPayload {
  title?: string;
  content?: string;
  target_grades?: string[];
  target_subjects?: string[];
  expires_at?: string | null;
  is_active?: boolean;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

function isValidExpiresAt(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

export function validateCreatePayload(body: unknown): CreateAnnouncementPayload | string {
  if (typeof body !== 'object' || body === null) return 'invalid_body';
  const b = body as Record<string, unknown>;

  if (typeof b.title !== 'string' || b.title.trim().length === 0) return 'title_required';
  if (b.title.trim().length > MAX_TITLE_LEN) return 'title_too_long';

  if (typeof b.content !== 'string' || b.content.trim().length === 0) return 'content_required';
  if (b.content.trim().length > MAX_CONTENT_LEN) return 'content_too_long';

  // Grades are strings per this repo's own invariant (P5) — never integers.
  if (b.target_grades !== undefined && !isStringArray(b.target_grades)) {
    return 'target_grades_invalid';
  }
  if (b.target_subjects !== undefined && !isStringArray(b.target_subjects)) {
    return 'target_subjects_invalid';
  }
  if (b.expires_at !== undefined && b.expires_at !== null && !isValidExpiresAt(b.expires_at)) {
    return 'expires_at_invalid';
  }

  return {
    title: b.title.trim().slice(0, MAX_TITLE_LEN),
    content: b.content.trim().slice(0, MAX_CONTENT_LEN),
    target_grades: (b.target_grades as string[] | undefined) ?? [],
    target_subjects: (b.target_subjects as string[] | undefined) ?? [],
    expires_at: (b.expires_at as string | null | undefined) ?? null,
  };
}

export function validateUpdatePayload(body: unknown): UpdateAnnouncementPayload | string {
  if (typeof body !== 'object' || body === null) return 'invalid_body';
  const b = body as Record<string, unknown>;
  const out: UpdateAnnouncementPayload = {};

  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.trim().length === 0) return 'title_invalid';
    if (b.title.trim().length > MAX_TITLE_LEN) return 'title_too_long';
    out.title = b.title.trim().slice(0, MAX_TITLE_LEN);
  }
  if (b.content !== undefined) {
    if (typeof b.content !== 'string' || b.content.trim().length === 0) return 'content_invalid';
    if (b.content.trim().length > MAX_CONTENT_LEN) return 'content_too_long';
    out.content = b.content.trim().slice(0, MAX_CONTENT_LEN);
  }
  if (b.target_grades !== undefined) {
    if (!isStringArray(b.target_grades)) return 'target_grades_invalid';
    out.target_grades = b.target_grades;
  }
  if (b.target_subjects !== undefined) {
    if (!isStringArray(b.target_subjects)) return 'target_subjects_invalid';
    out.target_subjects = b.target_subjects;
  }
  if (b.expires_at !== undefined) {
    if (b.expires_at !== null && !isValidExpiresAt(b.expires_at)) return 'expires_at_invalid';
    out.expires_at = b.expires_at as string | null;
  }
  if (b.is_active !== undefined) {
    if (typeof b.is_active !== 'boolean') return 'is_active_invalid';
    out.is_active = b.is_active;
  }

  if (Object.keys(out).length === 0) return 'no_fields_to_update';
  return out;
}
