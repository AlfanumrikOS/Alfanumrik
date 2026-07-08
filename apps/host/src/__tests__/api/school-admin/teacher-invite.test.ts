/**
 * Tests for POST /api/school-admin/teachers - P2 teacher invite lifecycle
 * P13: response body never contains email or auth_user_id
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// Hoisted mocks — use vi.fn() inline, not external variables
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: vi.fn(),
}));
vi.mock('@alfanumrik/lib/audit', () => ({ logSchoolAudit: vi.fn() }));
vi.mock('@alfanumrik/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { POST } from '@/app/api/school-admin/teachers/route';

// ─── helpers ─────────────────────────────────────────────────────────────────
function makeAuthPassed() {
  vi.mocked(authorizeSchoolAdmin).mockResolvedValue({
    authorized: true, schoolId: 'school-1', userId: 'admin-1', errorResponse: undefined,
  } as any);
}

function makeAuthFailed() {
  vi.mocked(authorizeSchoolAdmin).mockResolvedValue({
    authorized: false,
    errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }),
  } as any);
}

function stubSupabase(inviteResult: any, teacherInsertId = 'tch-uuid-1') {
  const mockInviteUserByEmail = vi.fn().mockResolvedValue(inviteResult);
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: (table: string) => {
      if (table === 'teachers') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }),
          insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: teacherInsertId }, error: null }) }) }),
        };
      }
      // school_invite_codes
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    },
    auth: { admin: { inviteUserByEmail: mockInviteUserByEmail } },
  } as any);
  return { mockInviteUserByEmail };
}

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/school-admin/teachers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── tests ───────────────────────────────────────────────────────────────────
describe('POST /api/school-admin/teachers', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('Auth gate', () => {
    it('returns 403 when not authorized', async () => {
      makeAuthFailed();
      const res = await POST(makeReq({ name: 'Priya', email: 'p@s.in' }));
      expect(res.status).toBe(403);
    });

    it('does not call DB when auth fails', async () => {
      makeAuthFailed();
      await POST(makeReq({ name: 'Priya', email: 'p@s.in' }));
      expect(getSupabaseAdmin).not.toHaveBeenCalled();
    });
  });

  describe('Input validation', () => {
    it('returns 400 when name is missing', async () => {
      makeAuthPassed();
      stubSupabase({ error: null });
      const res = await POST(makeReq({ email: 'p@s.in' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when email is invalid', async () => {
      makeAuthPassed();
      stubSupabase({ error: null });
      const res = await POST(makeReq({ name: 'Priya', email: 'not-an-email' }));
      expect(res.status).toBe(400);
    });
  });

  describe('Happy path', () => {
    it('returns 201 with invite_sent=true on success', async () => {
      makeAuthPassed();
      stubSupabase({ error: null });
      const res = await POST(makeReq({ name: 'Priya Sharma', email: 'priya@school.in' }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.invite_sent).toBe(true);
    });

    it('invite code matches TCH-XXXXXXXX pattern', async () => {
      makeAuthPassed();
      stubSupabase({ error: null });
      const res = await POST(makeReq({ name: 'Priya', email: 'priya@school.in' }));
      const body = await res.json();
      expect(body.data.invite_code).toMatch(/^TCH-[A-Z0-9]{8}$/);
    });

    it('does not include warn field on happy path', async () => {
      makeAuthPassed();
      stubSupabase({ error: null });
      const res = await POST(makeReq({ name: 'Priya', email: 'priya@school.in' }));
      const body = await res.json();
      expect(body.data.warn).toBeUndefined();
    });
  });

  describe('Email degradation (P15: teacher row survives email failure)', () => {
    it('returns 201 (not 500) when inviteUserByEmail throws', async () => {
      makeAuthPassed();
      const { mockInviteUserByEmail } = stubSupabase({ error: null });
      mockInviteUserByEmail.mockRejectedValue(new Error('SMTP timeout'));
      const res = await POST(makeReq({ name: 'Priya', email: 'priya@school.in' }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.invite_sent).toBe(false);
      expect(body.data.warn).toBe('invite_email_failed');
    });

    it('sets warn=email_already_registered on 422 Supabase error', async () => {
      makeAuthPassed();
      const { mockInviteUserByEmail } = stubSupabase({ error: null });
      mockInviteUserByEmail.mockResolvedValue({
        error: { message: '422: User already registered', status: 422 },
      });
      const res = await POST(makeReq({ name: 'Priya', email: 'priya@school.in' }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.warn).toBe('email_already_registered');
    });
  });

  describe('P13: response shape', () => {
    it('response body does not contain email', async () => {
      makeAuthPassed();
      stubSupabase({ error: null });
      const res = await POST(makeReq({ name: 'Priya', email: 'priya@school.example.in' }));
      const body = await res.json();
      expect(body.data).not.toHaveProperty('email');
      expect(body.data).not.toHaveProperty('auth_user_id');
    });

    it('response body contains only allowed fields', async () => {
      makeAuthPassed();
      stubSupabase({ error: null });
      const res = await POST(makeReq({ name: 'Priya', email: 'priya@school.in' }));
      const body = await res.json();
      const allowed = new Set(['teacher_id', 'invite_code', 'invite_link', 'invite_sent', 'warn']);
      for (const key of Object.keys(body.data)) {
        expect(allowed.has(key), `unexpected field "${key}" in response`).toBe(true);
      }
    });
  });
});
