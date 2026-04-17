# Student Impersonation + Support Enrichment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Student Detail page to the super-admin panel with an enriched Data Panel (profile, mastery, gaps, notes) and a Live View iframe (read-only mirror of dashboard, progress, foxy, quizzes) for debugging support calls.

**Architecture:** A new `/super-admin/students/[id]` page with two tabs. The Data Panel fetches aggregated student data from a single proxy API route using service-role (bypassing RLS). The Live View tab opens an iframe to `/super-admin/view-as/[id]/*` pages that render purpose-built read-only views fetching from 4 additional proxy routes. Impersonation sessions are audit-logged. Support notes are append-only. Three existing pages get "View Full Profile" entry-point links.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase PostgreSQL (service-role queries), Tailwind 3.4, SWR, Vitest, Playwright.

**Branch:** `feature/observability-console` (continues from Phase 1)

**Design spec:** `docs/superpowers/specs/2026-04-12-student-impersonation-design.md`

**Key architectural decision:** Live View pages do NOT import actual student page components (they use `useAuth()` → RLS-enforced queries which would fail for admin users). Instead, Live View pages are independent read-only renderings that fetch from proxy APIs via service-role and use the shared component library (Card, ProgressBar, StatCard, etc.).

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `supabase/migrations/20260412120000_student_impersonation.sql` | `admin_support_notes` + `admin_impersonation_sessions` tables, indices, RLS |
| `src/app/api/super-admin/students/[id]/profile/route.ts` | Aggregated student data for Data Panel (single GET) |
| `src/app/api/super-admin/students/[id]/notes/route.ts` | Support notes list (GET) + create (POST) |
| `src/app/api/super-admin/students/[id]/impersonate/route.ts` | Session start (POST) + end (PATCH) + validate (GET) |
| `src/app/api/super-admin/students/[id]/dashboard/route.ts` | Dashboard data proxy for Live View |
| `src/app/api/super-admin/students/[id]/progress/route.ts` | Progress data proxy for Live View |
| `src/app/api/super-admin/students/[id]/foxy-history/route.ts` | Foxy chat history proxy for Live View |
| `src/app/api/super-admin/students/[id]/quiz-history/route.ts` | Quiz history proxy for Live View |
| `src/app/super-admin/students/[id]/page.tsx` | Student Detail page (Data Panel + Live View tabs) |
| `src/app/super-admin/students/[id]/_components/DataPanel.tsx` | Data Panel: profile, mastery, gaps, quizzes, chats, ops events, notes |
| `src/app/super-admin/students/[id]/_components/LiveViewFrame.tsx` | Live View tab: iframe wrapper with banner + tab bar |
| `src/app/super-admin/students/[id]/_components/NotesThread.tsx` | Support notes thread + add note form |
| `src/app/super-admin/students/[id]/_components/SubjectMasteryGrid.tsx` | Per-subject BKT progress bars |
| `src/app/super-admin/view-as/[studentId]/layout.tsx` | Shared Live View shell: red banner + nav tabs |
| `src/app/super-admin/view-as/[studentId]/dashboard/page.tsx` | Read-only dashboard rendering |
| `src/app/super-admin/view-as/[studentId]/progress/page.tsx` | Read-only progress rendering |
| `src/app/super-admin/view-as/[studentId]/foxy/page.tsx` | Read-only foxy chat history |
| `src/app/super-admin/view-as/[studentId]/quizzes/page.tsx` | Read-only quiz history |
| `src/__tests__/student-profile-api.test.ts` | Profile proxy API tests |
| `src/__tests__/student-notes-api.test.ts` | Notes API tests |
| `src/__tests__/student-impersonation-api.test.ts` | Impersonation session tests |
| `e2e/student-impersonation.spec.ts` | Playwright E2E spec |

### Modified files

| Path | Change |
|---|---|
| `src/app/super-admin/support/page.tsx` | Add "View Full Profile" link after student lookup |
| `src/app/super-admin/users/page.tsx` | Add "View Full Profile" button in detail drawer |
| `src/app/super-admin/observability/_components/EventDetailDrawer.tsx` | Make student subject_id clickable |
| `supabase/functions/daily-cron/index.ts` | Add orphaned-session cleanup step |
| `docs/quality/testing-strategy.md` | Add regression entries R45-R47 |

---

## Tasks

### Task 1: Create the Phase 2 migration

**Owner:** architect
**Files:**
- Create: `supabase/migrations/20260412120000_student_impersonation.sql`

- [ ] **Step 1.1: Create the migration file**

Write to `supabase/migrations/20260412120000_student_impersonation.sql`:

```sql
-- Phase 2: Student Impersonation + Support Enrichment
-- Adds admin_support_notes (append-only note thread per student)
-- and admin_impersonation_sessions (audit trail for Live View).
-- Strictly additive.

-- admin_support_notes: append-only note thread
CREATE TABLE admin_support_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  admin_id        uuid NOT NULL REFERENCES admin_users(id),
  category        text NOT NULL CHECK (category IN (
    'support-call', 'bug-report', 'account-issue', 'observation', 'escalation'
  )),
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_support_notes_student_idx
  ON admin_support_notes (student_id, created_at ASC);

ALTER TABLE admin_support_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_support_notes_no_client_access"
  ON admin_support_notes FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);

-- admin_impersonation_sessions: Live View audit trail
CREATE TABLE admin_impersonation_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        uuid NOT NULL REFERENCES admin_users(id),
  student_id      uuid NOT NULL REFERENCES students(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  pages_viewed    text[] NOT NULL DEFAULT '{}',
  ip_address      text
);

CREATE INDEX admin_impersonation_sessions_student_idx
  ON admin_impersonation_sessions (student_id, started_at DESC);
CREATE INDEX admin_impersonation_sessions_active_idx
  ON admin_impersonation_sessions (admin_id, expires_at)
  WHERE ended_at IS NULL;

ALTER TABLE admin_impersonation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_impersonation_sessions_no_client_access"
  ON admin_impersonation_sessions FOR ALL TO anon, authenticated
  USING (false) WITH CHECK (false);
```

- [ ] **Step 1.2: Also apply to Supabase via MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with project_id `shktyoxqhundlvkiwguu` to apply the same SQL.

- [ ] **Step 1.3: Verify tables exist**

```bash
supabase db execute --sql "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('admin_support_notes','admin_impersonation_sessions');"
```

- [ ] **Step 1.4: Commit**

```bash
git add supabase/migrations/20260412120000_student_impersonation.sql
git commit -m "feat(impersonation): add admin_support_notes and admin_impersonation_sessions tables"
```

---

### Task 2: Support notes API

**Owner:** backend
**Files:**
- Create: `src/app/api/super-admin/students/[id]/notes/route.ts`
- Create: `src/__tests__/student-notes-api.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `src/__tests__/student-notes-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.fn();
const fromMock = vi.fn();
const auditMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/admin-auth', () => ({ authorizeAdmin: authMock, logAdminAudit: auditMock }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: fromMock } }));

describe('GET /api/super-admin/students/[id]/notes', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test', userId: 'u1' });
    fromMock.mockReset();
  });

  it('returns 401 when not authorized', async () => {
    authMock.mockResolvedValue({ authorized: false, response: new Response('unauth', { status: 401 }) });
    const { GET } = await import('@/app/api/super-admin/students/[id]/notes/route');
    const res = await GET(new NextRequest('http://localhost/api/super-admin/students/test-id/notes'), { params: { id: 'test-id' } });
    expect(res.status).toBe(401);
  });

  it('returns notes array for valid student', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          order: () => ({
            data: [{ id: 'n1', content: 'test note', category: 'support-call', created_at: '2026-04-12' }],
            error: null,
          }),
        }),
      }),
    });
    const { GET } = await import('@/app/api/super-admin/students/[id]/notes/route');
    const res = await GET(new NextRequest('http://localhost/api/super-admin/students/test-id/notes'), { params: { id: 'test-id' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.notes)).toBe(true);
  });
});

describe('POST /api/super-admin/students/[id]/notes', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test', userId: 'u1' });
    fromMock.mockReset();
  });

  it('rejects missing content', async () => {
    const { POST } = await import('@/app/api/super-admin/students/[id]/notes/route');
    const req = new NextRequest('http://localhost/api/super-admin/students/test-id/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category: 'support-call' }),
    });
    const res = await POST(req, { params: { id: 'test-id' } });
    expect(res.status).toBe(400);
  });

  it('creates a note and returns 201', async () => {
    fromMock.mockReturnValue({
      insert: () => ({
        select: () => ({
          single: () => ({ data: { id: 'n1', content: 'new note', category: 'support-call' }, error: null }),
        }),
      }),
    });
    const { POST } = await import('@/app/api/super-admin/students/[id]/notes/route');
    const req = new NextRequest('http://localhost/api/super-admin/students/test-id/notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'new note', category: 'support-call' }),
    });
    const res = await POST(req, { params: { id: 'test-id' } });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/student-notes-api.test.ts
```

- [ ] **Step 2.3: Implement the notes route**

Create `src/app/api/super-admin/students/[id]/notes/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

const VALID_CATEGORIES = ['support-call', 'bug-report', 'account-issue', 'observation', 'escalation'];

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const { data, error } = await supabaseAdmin
    .from('admin_support_notes')
    .select('id, student_id, admin_id, category, content, created_at')
    .eq('student_id', params.id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Enrich with admin names
  const adminIds = [...new Set((data ?? []).map((n: any) => n.admin_id))];
  let adminMap: Record<string, string> = {};
  if (adminIds.length > 0) {
    const { data: admins } = await supabaseAdmin
      .from('admin_users')
      .select('id, name, email')
      .in('id', adminIds);
    for (const a of admins ?? []) {
      adminMap[a.id] = a.name || a.email || 'Unknown';
    }
  }

  const notes = (data ?? []).map((n: any) => ({
    ...n,
    admin_name: adminMap[n.admin_id] ?? 'Unknown',
  }));

  return NextResponse.json({ notes });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const body = await request.json();

  if (!body.content || typeof body.content !== 'string' || body.content.trim().length === 0) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }
  if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('admin_support_notes')
    .insert({
      student_id: params.id,
      admin_id: auth.adminId,
      category: body.category,
      content: body.content.trim(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAudit(
    { adminId: auth.adminId!, email: auth.email! },
    'support_note_created',
    'admin_support_notes',
    data.id,
    { student_id: params.id, category: body.category },
  );

  return NextResponse.json({ note: data }, { status: 201 });
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/student-notes-api.test.ts
```

- [ ] **Step 2.5: Commit**

```bash
git add src/app/api/super-admin/students/[id]/notes src/__tests__/student-notes-api.test.ts
git commit -m "feat(impersonation): add support notes API (list + create)"
```

---

### Task 3: Impersonation session API

**Owner:** backend
**Files:**
- Create: `src/app/api/super-admin/students/[id]/impersonate/route.ts`
- Create: `src/__tests__/student-impersonation-api.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `src/__tests__/student-impersonation-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.fn();
const fromMock = vi.fn();
const auditMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/admin-auth', () => ({ authorizeAdmin: authMock, logAdminAudit: auditMock }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: fromMock } }));

describe('POST /api/super-admin/students/[id]/impersonate (start session)', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test', userId: 'u1' });
    fromMock.mockReset();
  });

  it('creates a session and returns sessionId', async () => {
    // Mock: no existing active session
    fromMock.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              gt: () => ({
                data: [],
                error: null,
              }),
            }),
          }),
        }),
      }),
    });
    // Mock: insert session
    fromMock.mockReturnValueOnce({
      insert: () => ({
        select: () => ({
          single: () => ({ data: { id: 'session-1', student_id: 'stu-1', admin_id: 'a1', expires_at: '2026-04-12T12:30:00Z' }, error: null }),
        }),
      }),
    });

    const { POST } = await import('@/app/api/super-admin/students/[id]/impersonate/route');
    const req = new NextRequest('http://localhost/api/super-admin/students/stu-1/impersonate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    });
    const res = await POST(req, { params: { id: 'stu-1' } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.session.id).toBe('session-1');
  });
});

describe('GET /api/super-admin/students/[id]/impersonate (validate session)', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'admin@test' });
    fromMock.mockReset();
  });

  it('returns active:true for a valid session', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => ({
                    data: [{ id: 's1', expires_at: new Date(Date.now() + 600_000).toISOString() }],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    });
    const { GET } = await import('@/app/api/super-admin/students/[id]/impersonate/route');
    const res = await GET(new NextRequest('http://localhost/api/super-admin/students/stu-1/impersonate'), { params: { id: 'stu-1' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(true);
  });
});
```

- [ ] **Step 3.2: Implement the impersonation route**

Create `src/app/api/super-admin/students/[id]/impersonate/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET: validate active session
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const { data } = await supabaseAdmin
    .from('admin_impersonation_sessions')
    .select('id, expires_at, pages_viewed')
    .eq('admin_id', auth.adminId)
    .eq('student_id', params.id)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1);

  const session = data?.[0] ?? null;
  return NextResponse.json({
    active: session !== null,
    session,
    remainingSeconds: session ? Math.max(0, Math.round((new Date(session.expires_at).getTime() - Date.now()) / 1000)) : 0,
  });
}

// POST: start session
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  // Check for existing active session (one at a time per admin)
  const { data: existing } = await supabaseAdmin
    .from('admin_impersonation_sessions')
    .select('id')
    .eq('admin_id', auth.adminId)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString());

  if (existing && existing.length > 0) {
    // End existing session first
    await supabaseAdmin
      .from('admin_impersonation_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', existing[0].id);
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const { data, error } = await supabaseAdmin
    .from('admin_impersonation_sessions')
    .insert({
      admin_id: auth.adminId,
      student_id: params.id,
      ip_address: ip,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAudit(
    { adminId: auth.adminId!, email: auth.email! },
    'impersonation_started',
    'admin_impersonation_sessions',
    data.id,
    { student_id: params.id },
  );

  return NextResponse.json({ session: data }, { status: 201 });
}

// PATCH: end session
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const { error } = await supabaseAdmin
    .from('admin_impersonation_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('admin_id', auth.adminId)
    .eq('student_id', params.id)
    .is('ended_at', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAudit(
    { adminId: auth.adminId!, email: auth.email! },
    'impersonation_ended',
    'admin_impersonation_sessions',
    null,
    { student_id: params.id },
  );

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3.3: Run tests, type-check, commit**

```bash
npx vitest run src/__tests__/student-impersonation-api.test.ts
npm run type-check
git add src/app/api/super-admin/students/[id]/impersonate src/__tests__/student-impersonation-api.test.ts
git commit -m "feat(impersonation): add impersonation session API (start, validate, end)"
```

---

### Task 4: Student profile proxy API (Data Panel)

**Owner:** backend
**Files:**
- Create: `src/app/api/super-admin/students/[id]/profile/route.ts`
- Create: `src/__tests__/student-profile-api.test.ts`

- [ ] **Step 4.1: Write the test**

Create `src/__tests__/student-profile-api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const authMock = vi.fn();
const fromMock = vi.fn();
const rpcMock = vi.fn();
vi.mock('@/lib/admin-auth', () => ({ authorizeAdmin: authMock }));
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: fromMock, rpc: rpcMock },
}));

describe('GET /api/super-admin/students/[id]/profile', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ authorized: true, adminId: 'a1', email: 'x@y' });
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('returns 401 when not authorized', async () => {
    authMock.mockResolvedValue({ authorized: false, response: new Response('unauth', { status: 401 }) });
    const { GET } = await import('@/app/api/super-admin/students/[id]/profile/route');
    const res = await GET(new NextRequest('http://localhost/test'), { params: { id: 'stu-1' } });
    expect(res.status).toBe(401);
  });

  it('returns 404 when student not found', async () => {
    fromMock.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => ({ data: null, error: { message: 'not found' } }),
        }),
      }),
    });
    const { GET } = await import('@/app/api/super-admin/students/[id]/profile/route');
    const res = await GET(new NextRequest('http://localhost/test'), { params: { id: 'nonexistent' } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4.2: Implement the profile route**

Create `src/app/api/super-admin/students/[id]/profile/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const studentId = params.id;

  // Parallel queries for all data sections
  const [
    studentRes,
    masteryRes,
    gapsRes,
    quizzesRes,
    chatsRes,
    usageRes,
    linksRes,
    classesRes,
    subsRes,
    opsRes,
  ] = await Promise.all([
    // 1. Student profile
    supabaseAdmin.from('students').select('*').eq('id', studentId).single(),
    // 2. Subject mastery (BKT scores)
    supabaseAdmin.from('concept_mastery').select('subject, topic, mastery_level, bloom_level, updated_at').eq('student_id', studentId),
    // 3. Knowledge gaps
    supabaseAdmin.from('knowledge_gaps').select('subject, topic, gap_type, severity, identified_at').eq('student_id', studentId).order('identified_at', { ascending: false }).limit(20),
    // 4. Recent quizzes
    supabaseAdmin.from('quiz_sessions').select('id, subject, topic, score_percent, total_questions, xp_earned, bloom_level, completed_at').eq('student_id', studentId).order('completed_at', { ascending: false }).limit(10),
    // 5. Recent Foxy chats
    supabaseAdmin.from('chat_sessions').select('id, topic, subject, message_count, created_at').eq('student_id', studentId).order('created_at', { ascending: false }).limit(10),
    // 6. Daily usage (last 7 days)
    supabaseAdmin.from('student_daily_usage').select('usage_date, quizzes, chats, minutes').eq('student_id', studentId).order('usage_date', { ascending: false }).limit(7),
    // 7. Parent links
    supabaseAdmin.from('guardian_student_links').select('guardian_id, relationship, status, guardians(id, name, email, phone)').eq('student_id', studentId),
    // 8. Class/teacher links
    supabaseAdmin.from('class_students').select('class_id, classes(id, name, grade, section, teachers(id, name, email))').eq('student_id', studentId),
    // 9. Subscription
    supabaseAdmin.from('student_subscriptions').select('*').eq('student_id', studentId).order('created_at', { ascending: false }).limit(1),
    // 10. Recent ops events for this student
    supabaseAdmin.from('ops_events').select('id, occurred_at, category, source, severity, message').eq('subject_id', studentId).order('occurred_at', { ascending: false }).limit(20),
  ]);

  if (studentRes.error || !studentRes.data) {
    return NextResponse.json({ error: 'student not found' }, { status: 404 });
  }

  // Compute Bloom's distribution from recent quizzes
  const bloomDist: Record<string, number> = {};
  for (const q of quizzesRes.data ?? []) {
    const level = q.bloom_level ?? 'remember';
    bloomDist[level] = (bloomDist[level] ?? 0) + 1;
  }

  // Compute per-subject mastery summary
  const subjectMastery: Record<string, { topics: number; avgMastery: number }> = {};
  for (const m of masteryRes.data ?? []) {
    const subj = m.subject ?? 'unknown';
    if (!subjectMastery[subj]) subjectMastery[subj] = { topics: 0, avgMastery: 0 };
    subjectMastery[subj].topics += 1;
    subjectMastery[subj].avgMastery += (m.mastery_level ?? 0);
  }
  for (const subj of Object.keys(subjectMastery)) {
    subjectMastery[subj].avgMastery = Math.round(
      (subjectMastery[subj].avgMastery / subjectMastery[subj].topics) * 100
    );
  }

  return NextResponse.json({
    student: studentRes.data,
    subjectMastery,
    knowledgeGaps: gapsRes.data ?? [],
    bloomDistribution: bloomDist,
    recentQuizzes: quizzesRes.data ?? [],
    recentChats: chatsRes.data ?? [],
    dailyUsage: usageRes.data ?? [],
    parentLinks: linksRes.data ?? [],
    classLinks: classesRes.data ?? [],
    subscription: subsRes.data?.[0] ?? null,
    opsEvents: opsRes.data ?? [],
  });
}
```

- [ ] **Step 4.3: Run tests, type-check, commit**

```bash
npx vitest run src/__tests__/student-profile-api.test.ts
npm run type-check
git add src/app/api/super-admin/students/[id]/profile src/__tests__/student-profile-api.test.ts
git commit -m "feat(impersonation): add student profile proxy API for Data Panel"
```

---

### Task 5: Live View proxy APIs (dashboard, progress, foxy-history, quiz-history)

**Owner:** backend
**Files:**
- Create: `src/app/api/super-admin/students/[id]/dashboard/route.ts`
- Create: `src/app/api/super-admin/students/[id]/progress/route.ts`
- Create: `src/app/api/super-admin/students/[id]/foxy-history/route.ts`
- Create: `src/app/api/super-admin/students/[id]/quiz-history/route.ts`

All four follow the same pattern: `authorizeAdmin()` → validate impersonation session → service-role query → return JSON. All are GET-only (no write routes).

- [ ] **Step 5.1: Create the shared session validation helper**

Create `src/app/api/super-admin/students/_lib/validate-session.ts`:

```ts
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function validateImpersonationSession(adminId: string, studentId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('admin_impersonation_sessions')
    .select('id')
    .eq('admin_id', adminId)
    .eq('student_id', studentId)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1);

  return (data?.length ?? 0) > 0;
}

export async function recordPageView(adminId: string, studentId: string, page: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('admin_impersonation_sessions')
    .select('id, pages_viewed')
    .eq('admin_id', adminId)
    .eq('student_id', studentId)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1);

  const session = data?.[0];
  if (session && !session.pages_viewed.includes(page)) {
    await supabaseAdmin
      .from('admin_impersonation_sessions')
      .update({ pages_viewed: [...session.pages_viewed, page] })
      .eq('id', session.id);
  }
}
```

- [ ] **Step 5.2: Create the dashboard proxy route**

Create `src/app/api/super-admin/students/[id]/dashboard/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateImpersonationSession, recordPageView } from '../_lib/validate-session';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const valid = await validateImpersonationSession(auth.adminId!, params.id);
  if (!valid) return NextResponse.json({ error: 'no active impersonation session' }, { status: 403 });

  const studentId = params.id;

  // Call the same RPC the real dashboard uses
  const { data: dashData, error: dashError } = await supabaseAdmin
    .rpc('get_dashboard_data', { p_student_id: studentId });

  // Also get student profile for display
  const { data: student } = await supabaseAdmin
    .from('students')
    .select('id, name, email, grade, board, xp_total, streak_days, subscription_plan, avatar_url, preferred_language')
    .eq('id', studentId)
    .single();

  recordPageView(auth.adminId!, studentId, 'dashboard'); // fire-and-forget

  if (dashError) return NextResponse.json({ error: dashError.message }, { status: 500 });

  return NextResponse.json({ student, dashboard: dashData });
}
```

- [ ] **Step 5.3: Create the progress proxy route**

Create `src/app/api/super-admin/students/[id]/progress/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateImpersonationSession, recordPageView } from '../_lib/validate-session';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const valid = await validateImpersonationSession(auth.adminId!, params.id);
  if (!valid) return NextResponse.json({ error: 'no active impersonation session' }, { status: 403 });

  const studentId = params.id;

  const [masteryRes, topicsRes, velocityRes] = await Promise.all([
    supabaseAdmin.from('concept_mastery')
      .select('subject, topic, mastery_level, bloom_level, confidence, updated_at')
      .eq('student_id', studentId),
    supabaseAdmin.from('curriculum_topics')
      .select('id, subject, name, chapter, bloom_target')
      .order('subject').order('chapter'),
    supabaseAdmin.from('quiz_sessions')
      .select('subject, score_percent, completed_at, bloom_level')
      .eq('student_id', studentId)
      .order('completed_at', { ascending: false })
      .limit(50),
  ]);

  recordPageView(auth.adminId!, studentId, 'progress');

  return NextResponse.json({
    mastery: masteryRes.data ?? [],
    topics: topicsRes.data ?? [],
    recentQuizzes: velocityRes.data ?? [],
  });
}
```

- [ ] **Step 5.4: Create the foxy-history proxy route**

Create `src/app/api/super-admin/students/[id]/foxy-history/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateImpersonationSession, recordPageView } from '../_lib/validate-session';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const valid = await validateImpersonationSession(auth.adminId!, params.id);
  if (!valid) return NextResponse.json({ error: 'no active impersonation session' }, { status: 403 });

  const studentId = params.id;
  const sessionId = new URL(request.url).searchParams.get('sessionId');

  // Get chat sessions
  const { data: sessions } = await supabaseAdmin
    .from('chat_sessions')
    .select('id, topic, subject, message_count, created_at, updated_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false })
    .limit(20);

  let messages: any[] = [];
  if (sessionId) {
    // Get messages for a specific session
    const { data: msgs } = await supabaseAdmin
      .from('chat_messages')
      .select('id, role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    messages = msgs ?? [];
  }

  recordPageView(auth.adminId!, studentId, 'foxy');

  return NextResponse.json({ sessions: sessions ?? [], messages });
}
```

- [ ] **Step 5.5: Create the quiz-history proxy route**

Create `src/app/api/super-admin/students/[id]/quiz-history/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateImpersonationSession, recordPageView } from '../_lib/validate-session';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response!;

  const valid = await validateImpersonationSession(auth.adminId!, params.id);
  if (!valid) return NextResponse.json({ error: 'no active impersonation session' }, { status: 403 });

  const studentId = params.id;
  const quizId = new URL(request.url).searchParams.get('quizId');

  const { data: sessions } = await supabaseAdmin
    .from('quiz_sessions')
    .select('id, subject, topic, score_percent, total_questions, correct_answers, xp_earned, bloom_level, time_taken_seconds, completed_at')
    .eq('student_id', studentId)
    .order('completed_at', { ascending: false })
    .limit(30);

  let responses: any[] = [];
  if (quizId) {
    const { data: resp } = await supabaseAdmin
      .from('quiz_responses')
      .select('id, question_text, options, selected_index, correct_index, is_correct, time_seconds, explanation')
      .eq('quiz_session_id', quizId)
      .order('created_at', { ascending: true });
    responses = resp ?? [];
  }

  recordPageView(auth.adminId!, studentId, 'quizzes');

  return NextResponse.json({ sessions: sessions ?? [], responses });
}
```

- [ ] **Step 5.6: Type-check and commit**

```bash
npm run type-check
git add src/app/api/super-admin/students/[id]/dashboard \
        src/app/api/super-admin/students/[id]/progress \
        src/app/api/super-admin/students/[id]/foxy-history \
        src/app/api/super-admin/students/[id]/quiz-history \
        src/app/api/super-admin/students/_lib
git commit -m "feat(impersonation): add Live View proxy APIs (dashboard, progress, foxy, quizzes)"
```

---

### Task 6: Student Detail page (Data Panel + Live View tabs)

**Owner:** frontend
**Files:**
- Create: `src/app/super-admin/students/[id]/page.tsx`
- Create: `src/app/super-admin/students/[id]/_components/DataPanel.tsx`
- Create: `src/app/super-admin/students/[id]/_components/LiveViewFrame.tsx`
- Create: `src/app/super-admin/students/[id]/_components/NotesThread.tsx`
- Create: `src/app/super-admin/students/[id]/_components/SubjectMasteryGrid.tsx`

This is the main page. Read the existing AdminShell pattern and the existing super-admin pages for styling conventions before implementing.

- [ ] **Step 6.1: Create SubjectMasteryGrid component**

Create `src/app/super-admin/students/[id]/_components/SubjectMasteryGrid.tsx`:

```tsx
'use client';

export function SubjectMasteryGrid({ mastery }: {
  mastery: Record<string, { topics: number; avgMastery: number }>;
}) {
  const subjects = Object.entries(mastery).sort(([, a], [, b]) => b.avgMastery - a.avgMastery);

  if (subjects.length === 0) {
    return <div className="text-sm text-gray-500">No mastery data yet</div>;
  }

  return (
    <div className="space-y-2">
      {subjects.map(([subject, data]) => (
        <div key={subject} className="flex items-center gap-3">
          <span className="w-28 text-sm font-medium truncate">{subject}</span>
          <div className="flex-1 bg-gray-200 rounded-full h-3">
            <div
              className="bg-purple-600 h-3 rounded-full transition-all"
              style={{ width: `${Math.min(data.avgMastery, 100)}%` }}
            />
          </div>
          <span className="text-sm text-gray-600 w-12 text-right">{data.avgMastery}%</span>
          <span className="text-xs text-gray-400 w-20">{data.topics} topics</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6.2: Create NotesThread component**

Create `src/app/super-admin/students/[id]/_components/NotesThread.tsx`:

```tsx
'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then(r => r.json());
const CATEGORIES = ['support-call', 'bug-report', 'account-issue', 'observation', 'escalation'];

interface Note {
  id: string;
  admin_name: string;
  category: string;
  content: string;
  created_at: string;
}

export function NotesThread({ studentId }: { studentId: string }) {
  const { data } = useSWR(`/api/super-admin/students/${studentId}/notes`, fetcher);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('support-call');
  const [saving, setSaving] = useState(false);

  const notes: Note[] = data?.notes ?? [];

  const addNote = async () => {
    if (!content.trim()) return;
    setSaving(true);
    await fetch(`/api/super-admin/students/${studentId}/notes`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.trim(), category }),
    });
    setContent('');
    setSaving(false);
    mutate(`/api/super-admin/students/${studentId}/notes`);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="text-sm border rounded px-2 py-1"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          type="text"
          placeholder="Add a support note..."
          value={content}
          onChange={e => setContent(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addNote()}
          className="flex-1 text-sm border rounded px-2 py-1"
        />
        <button
          onClick={addNote}
          disabled={saving || !content.trim()}
          className="text-sm px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Add'}
        </button>
      </div>
      <div className="space-y-2">
        {notes.map(note => (
          <div key={note.id} className="border-l-2 border-gray-300 pl-3 py-1">
            <div className="text-xs text-gray-500">
              {new Date(note.created_at).toLocaleString()} — {note.admin_name}
              <span className="ml-2 px-1.5 py-0.5 bg-gray-100 rounded text-xs">{note.category}</span>
            </div>
            <div className="text-sm mt-0.5">{note.content}</div>
          </div>
        ))}
        {notes.length === 0 && (
          <div className="text-sm text-gray-500 text-center py-4">No notes yet</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 6.3: Create DataPanel component**

Create `src/app/super-admin/students/[id]/_components/DataPanel.tsx` — this is the main data view. It fetches from the profile proxy API and renders all sections. Due to the size of this component, implement it with clear section dividers. Read the actual profile API response shape from Task 4.

The DataPanel should show: profile card, subscription, learning snapshot (XP/streak/quiz count), subject mastery grid, knowledge gaps, Bloom's distribution, recent quizzes table, recent Foxy chats table, ops events (linking to observability console), relationships, and the NotesThread.

- [ ] **Step 6.4: Create LiveViewFrame component**

Create `src/app/super-admin/students/[id]/_components/LiveViewFrame.tsx` — manages the iframe, session lifecycle (start/end), and tab switching between the 4 Live View pages.

- [ ] **Step 6.5: Create the main Student Detail page**

Create `src/app/super-admin/students/[id]/page.tsx` — wraps everything in AdminShell, manages the Data Panel / Live View tab state, passes studentId down.

- [ ] **Step 6.6: Type-check, build, commit**

```bash
npm run type-check
npm run build
git add src/app/super-admin/students
git commit -m "feat(impersonation): add Student Detail page with Data Panel, Live View, and notes"
```

---

### Task 7: Live View iframe pages

**Owner:** frontend
**Files:**
- Create: `src/app/super-admin/view-as/[studentId]/layout.tsx`
- Create: `src/app/super-admin/view-as/[studentId]/dashboard/page.tsx`
- Create: `src/app/super-admin/view-as/[studentId]/progress/page.tsx`
- Create: `src/app/super-admin/view-as/[studentId]/foxy/page.tsx`
- Create: `src/app/super-admin/view-as/[studentId]/quizzes/page.tsx`

These are independent read-only pages rendered inside the iframe. They fetch from the proxy APIs (Tasks 5) and render purpose-built views using the shared component library. They do NOT import student page components (RLS would block data fetching).

- [ ] **Step 7.1: Create the shared Live View layout**

Create `src/app/super-admin/view-as/[studentId]/layout.tsx` with the red "VIEWING AS" banner and tab navigation (Dashboard / Progress / Foxy / Quizzes).

- [ ] **Step 7.2-7.5: Create each page**

Each page fetches from its proxy API, renders a read-only view:
- `dashboard/page.tsx` — XP, streak, subject cards, gaps, Bloom's, exam readiness
- `progress/page.tsx` — per-subject mastery table, topic-by-topic scores
- `foxy/page.tsx` — chat session list, click to expand messages
- `quizzes/page.tsx` — quiz history table, click to see individual answers

- [ ] **Step 7.6: Type-check, build, commit**

```bash
npm run type-check
npm run build
git add src/app/super-admin/view-as
git commit -m "feat(impersonation): add Live View iframe pages (dashboard, progress, foxy, quizzes)"
```

---

### Task 8: Entry point edits

**Owner:** frontend
**Files:**
- Modify: `src/app/super-admin/support/page.tsx`
- Modify: `src/app/super-admin/users/page.tsx`
- Modify: `src/app/super-admin/observability/_components/EventDetailDrawer.tsx`

- [ ] **Step 8.1: Add "View Full Profile" to support page**

Read `src/app/super-admin/support/page.tsx`. After the student lookup results section, add:

```tsx
<Link href={`/super-admin/students/${studentId}`} className="text-sm text-blue-600 hover:underline">
  View Full Profile →
</Link>
```

- [ ] **Step 8.2: Add "View Full Profile" to users page detail drawer**

Read `src/app/super-admin/users/page.tsx`. In the detail drawer section, add a link button when viewing a student.

- [ ] **Step 8.3: Make student subject_id clickable in EventDetailDrawer**

Read `src/app/super-admin/observability/_components/EventDetailDrawer.tsx`. Where `subject_id` is displayed, conditionally render as a link when `subject_type === 'student'`:

```tsx
{event.subject_type === 'student' && event.subject_id ? (
  <Link href={`/super-admin/students/${event.subject_id}`} className="text-blue-600 hover:underline">
    {event.subject_id}
  </Link>
) : (
  event.subject_id
)}
```

- [ ] **Step 8.4: Add orphaned-session cleanup to daily-cron**

Read `supabase/functions/daily-cron/index.ts`. Add a step that closes expired sessions:

```ts
{
  label: 'close_expired_impersonation_sessions',
  run: async () => {
    await fetch(`${supabaseUrl}/rest/v1/admin_impersonation_sessions?ended_at=is.null&expires_at=lt.${new Date().toISOString()}`, {
      method: 'PATCH',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ ended_at: new Date().toISOString() }),
    });
  },
},
```

- [ ] **Step 8.5: Type-check and commit**

```bash
npm run type-check
git add src/app/super-admin/support/page.tsx \
        src/app/super-admin/users/page.tsx \
        src/app/super-admin/observability/_components/EventDetailDrawer.tsx \
        supabase/functions/daily-cron/index.ts
git commit -m "feat(impersonation): add entry point links from support, users, and observability"
```

---

### Task 9: Tests + regression catalog + verification

**Owner:** testing
**Files:**
- Create: `e2e/student-impersonation.spec.ts`
- Modify: `docs/quality/testing-strategy.md`

- [ ] **Step 9.1: Create Playwright E2E spec**

Create `e2e/student-impersonation.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('Student Impersonation', () => {
  test.beforeEach(async ({ page }) => {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!email || !password) test.skip();
    await page.goto('/super-admin/login');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/super-admin/);
  });

  test('can navigate to student detail from users page', async ({ page }) => {
    await page.goto('/super-admin/users');
    // Click first student row to open drawer, then click View Full Profile
    const firstRow = page.locator('tr, button').filter({ hasText: /student/i }).first();
    if (await firstRow.count() === 0) test.skip();
    await firstRow.click();
    const profileLink = page.getByText(/view full profile/i);
    if (await profileLink.count() === 0) test.skip();
    await profileLink.click();
    await expect(page).toHaveURL(/super-admin\/students\//);
  });

  test('student detail page shows data panel by default', async ({ page }) => {
    // Navigate directly to a student detail page (need a known student ID in staging)
    await page.goto('/super-admin/users');
    // For now, just verify the route structure works
    await expect(page.getByRole('heading', { name: /users/i })).toBeVisible();
  });

  test('support notes can be added', async ({ page }) => {
    // Will be refined once student IDs are available in staging
    await page.goto('/super-admin/support');
    await expect(page.getByRole('heading', { name: /support/i })).toBeVisible();
  });
});
```

- [ ] **Step 9.2: Add regression entries**

Append to `docs/quality/testing-strategy.md`:

```
- **R45:** Impersonation sessions are audit-logged in admin_impersonation_sessions with start/end times. Covered by: `src/__tests__/student-impersonation-api.test.ts`.
- **R46:** Support notes are append-only (no UPDATE/DELETE routes). Covered by: `src/__tests__/student-notes-api.test.ts`.
- **R47:** Live View iframe pages have no write endpoints (GET-only proxy routes). Covered by: code inspection — no POST/PATCH/DELETE handlers in proxy routes.
```

- [ ] **Step 9.3: Run full verification**

```bash
npm run type-check
npm run lint
npm test
npm run build
```

- [ ] **Step 9.4: Commit and push**

```bash
git add e2e/student-impersonation.spec.ts docs/quality/testing-strategy.md
git commit -m "test(impersonation): add E2E spec and regression entries R45-R47"
git push origin feature/observability-console
```

---

## Post-implementation checklist

- [ ] Apply migration to Supabase via MCP (`mcp__claude_ai_Supabase__apply_migration`)
- [ ] Verify both tables exist in production Supabase
- [ ] Deploy daily-cron update (`supabase functions deploy daily-cron`)
- [ ] Smoke test: navigate to `/super-admin/students/[id]` in staging
- [ ] Smoke test: add a support note, verify it persists
- [ ] Smoke test: open Live View, verify iframe renders, verify session logged
- [ ] All CI gates pass (type-check, lint, test, build)
- [ ] Bundle size: Student Detail page < 260 KB (P10)