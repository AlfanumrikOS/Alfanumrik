# Alfanumrik B2B White-Label Platform — Production Design Spec

**Date:** 2026-04-16
**Author:** Orchestrator + CEO brainstorm
**Status:** Approved for implementation
**Target:** 10,000 students, parents, teachers across B2C + B2B schools

---

## 1. Executive Summary

Transform Alfanumrik from a B2C learning platform into a production-grade B2B white-label SaaS serving schools at scale. Schools get a fully branded experience (custom domains, logos, colors), a self-sufficient admin portal, and per-student seat licensing with negotiable pricing. The platform supports 10,000 concurrent users across multiple tenants while maintaining all existing product invariants (P1-P15).

### Key Decisions

| Decision | Choice |
|---|---|
| B2B billing model | Per-student seat licensing, same plans (Free/Pro/Premium), negotiable bulk rates |
| White-label depth | Enterprise — custom domains (`learn.dps.com`), full branding removal |
| Data isolation | Shared tables + Postgres session variable (`app.current_school_id`) for RLS tenant scoping |
| School admin features | Tier 3 — Full autonomy: content upload, exam scheduling, parent comms, API access |
| Rollout strategy | 3 phases over 12-16 weeks |
| B2C/B2B coexistence | Separate entry points (`app.alfanumrik.com` vs `school.alfanumrik.com`), shared backend |
| Super admin scope | Full ops center — school CRM, B2B analytics, SLA monitoring, alerting |
| Mobile strategy | Phase 1: PWA-only for B2B. Phase 2: tenant-aware single Flutter app |

---

## 2. Architecture

### 2.1 Tenant Resolution Flow

```
Request arrives
  |
  v
Middleware extracts hostname
  |
  ├─ app.alfanumrik.com     → school_id = NULL (B2C, existing behavior)
  ├─ {slug}.alfanumrik.com  → lookup schools WHERE slug = '{slug}' AND is_active = true
  └─ learn.dps.com          → lookup schools WHERE custom_domain = 'learn.dps.com' AND domain_verified = true
  |
  v
Cache school record in Redis (5min TTL)
  |
  v
Set Postgres session variable: SET LOCAL app.current_school_id = '{school_id}'
  |
  v
Inject headers: x-school-id, x-school-slug, x-school-plan
  |
  v
Apply school's feature flags (existing target_institutions support)
  |
  v
Route to app (branded via SchoolThemeContext)
```

### 2.2 Data Isolation Model

**Approach:** Shared tables with RLS policies checking `current_setting('app.current_school_id')`.

**Helper function (new migration):**
```sql
CREATE OR REPLACE FUNCTION current_school_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_school_id', true), '')::UUID;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;
```

**RLS policy pattern for tenant-scoped tables:**
```sql
-- Students can only see data from their own school (or no school for B2C)
CREATE POLICY "tenant_isolation" ON students
  FOR ALL TO authenticated
  USING (
    school_id IS NOT DISTINCT FROM current_school_id()
  );
```

**Super admin** bypasses via service role (existing pattern, no change needed).

**B2C students** have `school_id IS NULL`. When no session variable is set (B2C request), `current_school_id()` returns NULL, matching `school_id IS NULL` via `IS NOT DISTINCT FROM`.

### 2.3 System Architecture Diagram

```
                    DNS / Vercel Edge
  ┌──────────────────────────────────────────────────┐
  │ app.alfanumrik.com      → null tenant (B2C)      │
  │ *.alfanumrik.com        → school by slug          │
  │ custom domains          → school by custom_domain │
  └─────────────────────┬────────────────────────────┘
                        v
  ┌─────────────────────────────────────────────────┐
  │  Middleware (src/middleware.ts)                   │
  │  - Tenant resolution + caching                   │
  │  - Session variable injection                    │
  │  - Auth validation (existing)                    │
  │  - Rate limiting: distributed Redis (upgraded)   │
  │  - Feature flags: institution-aware (existing)   │
  └────────┬──────────┬──────────┬──────────────────┘
           v          v          v
    ┌──────────┐ ┌──────────┐ ┌───────────┐
    │ Student  │ │  School  │ │   Super   │
    │ Portal   │ │  Admin   │ │   Admin   │
    │(branded) │ │ Portal   │ │ Ops Center│
    │/dashboard│ │/school/* │ │/super-    │
    │/foxy     │ │          │ │ admin/*   │
    │/learn    │ │Teachers  │ │           │
    │/exams    │ │Students  │ │School CRM │
    │/progress │ │Reports   │ │Analytics  │
    └──────────┘ │Content   │ │Alerts/SLA │
                 │Exams     │ │Billing    │
                 │Parents   │ └───────────┘
                 │API Keys  │
                 └──────────┘
           │          │          │
           v          v          v
  ┌─────────────────────────────────────────────────┐
  │  Supabase Postgres (shared tables)               │
  │  RLS: check current_setting('app.current_       │
  │        school_id') on tenant-scoped tables       │
  │  + existing user-level RLS unchanged             │
  └─────────────────────────────────────────────────┘
           │
           v
  ┌─────────────────────────────────────────────────┐
  │  Supabase Edge Functions (29 existing + new)     │
  │  - Tenant context passed via x-school-id header  │
  │  - AI functions: per-school usage budgets         │
  │  - school-health-check (new)                     │
  └─────────────────────────────────────────────────┘
```

---

## 3. Phase 1: Foundation (Weeks 1-6)

**Goal:** Onboard 2-3 pilot schools, 500-1000 students.

### 3.1 Multi-Tenant Infrastructure

#### 3.1.1 Tenant Resolution Middleware

**File:** `src/middleware.ts` (extend existing)
**New file:** `src/lib/tenant.ts`

Responsibilities:
- Extract hostname from request
- Look up school by `slug` (for `*.alfanumrik.com`) or `custom_domain` (for custom domains)
- Cache school record in Redis with 5min TTL (key: `tenant:{hostname}`)
- If no school found and not `app.alfanumrik.com`, return 404 branded error page
- If school found but `is_active = false`, return 403 "School suspended" page
- Set `x-school-id`, `x-school-slug`, `x-school-plan` response headers
- Pass school context to Supabase via session variable

**Tenant context type:**
```typescript
interface TenantContext {
  schoolId: string | null;       // null = B2C
  schoolSlug: string | null;
  schoolName: string | null;
  plan: 'trial' | 'free' | 'pro' | 'premium';
  branding: {
    logoUrl: string | null;
    primaryColor: string;        // default: '#7C3AED'
    secondaryColor: string;      // default: '#F97316'
    tagline: string | null;
    faviconUrl: string | null;
  };
}
```

#### 3.1.2 Postgres Session Variable Injection

**Mechanism:** After resolving the tenant, the middleware (or API route helper) calls:
```sql
SELECT set_config('app.current_school_id', '{school_id}', true);
```
The `true` parameter means "local to this transaction" — no cross-request leakage.

**Implementation:** New helper in `src/lib/supabase-server.ts`:
```typescript
export async function withTenantContext(schoolId: string | null) {
  const supabase = createServerClient();
  if (schoolId) {
    await supabase.rpc('set_tenant_context', { p_school_id: schoolId });
  }
  return supabase;
}
```

**New RPC (migration):**
```sql
CREATE OR REPLACE FUNCTION set_tenant_context(p_school_id UUID)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_school_id', p_school_id::text, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

#### 3.1.3 RLS Migration

**New migration:** `YYYYMMDD_tenant_rls_policies.sql`

Tables that need `school_id` tenant scoping added to RLS:
- `students` (already has `school_id` column)
- `quiz_results` (denormalize: add `school_id` column, backfilled from `students.school_id` via the student FK; denormalization chosen over joins because RLS policies with cross-table joins are slow and create circular dependency risks)
- `student_progress` (denormalize: add `school_id` column, same rationale)
- `leaderboard` views (school-scoped variant using materialized view or RPC)
- `question_bank` (global questions have `school_id IS NULL`; school-specific questions use `school_questions` table instead — see Phase 2)

Pattern for each table:
```sql
-- Drop existing permissive policy, replace with tenant-aware version
DROP POLICY IF EXISTS "students_own_data" ON students;
CREATE POLICY "students_tenant_and_own_data" ON students
  FOR ALL TO authenticated
  USING (
    -- B2C: school_id is null, current_school_id() is null → match
    -- B2B: school_id matches current tenant
    school_id IS NOT DISTINCT FROM current_school_id()
    AND (
      -- Students see own data, teachers/admins see all in school
      auth.uid() = user_id
      OR EXISTS (SELECT 1 FROM user_roles ur
                 JOIN roles r ON ur.role_id = r.id
                 WHERE ur.user_id = auth.uid()
                 AND r.name IN ('teacher', 'institution_admin', 'admin', 'super_admin'))
    )
  );
```

#### 3.1.4 RBAC: institution_admin Role

**New migration:** `YYYYMMDD_institution_admin_role.sql`

```sql
INSERT INTO roles (name, display_name, description, hierarchy_level)
VALUES ('institution_admin', 'School Administrator', 'Manages a single school', 35)
ON CONFLICT (name) DO NOTHING;
```

Hierarchy: student (10) < parent (20) < teacher (30) < **institution_admin (35)** < tutor (40) < admin (50) < super_admin (60)

**Existing helper:** `get_admin_school_id()` function already exists (migration 20260412) — returns the caller's `school_id` from the `teachers` table. Used in RLS policies for institution_admin access. The institution_admin accesses students/teachers via service-role API routes with RBAC enforcement, avoiding RLS policy conflicts (documented in migration comments).

**15 new permissions:**

| Permission Code | Description |
|---|---|
| `school.manage_teachers` | Invite, edit, deactivate teachers |
| `school.manage_students` | Invite, edit, deactivate students |
| `school.view_analytics` | View school dashboard and reports |
| `school.manage_branding` | Update logo, colors, tagline |
| `school.invite_students` | Generate and manage invite codes |
| `school.invite_teachers` | Send teacher invitations |
| `school.manage_billing` | View subscription, seat usage |
| `school.manage_classes` | Create/edit class sections (Phase 2) |
| `school.manage_content` | Upload school-specific questions (Phase 2) |
| `school.manage_exams` | Schedule school assessments (Phase 2) |
| `school.manage_announcements` | Send school notifications (Phase 2) |
| `school.manage_api_keys` | Generate ERP integration keys (Phase 2) |
| `school.view_parent_comms` | View parent-student links (Phase 2) |
| `school.export_reports` | Export academic reports (Phase 2) |
| `school.manage_settings` | School-level configuration (Phase 2) |

**Code change:** `src/lib/rbac.ts`
```typescript
export type RoleName = 'student' | 'parent' | 'teacher' | 'institution_admin' | 'tutor' | 'admin' | 'super_admin';
```

### 3.2 White-Label Branding Engine

#### 3.2.1 Theme Provider

**New file:** `src/lib/school-theme.ts`

```typescript
interface SchoolTheme {
  schoolId: string | null;
  schoolName: string | null;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  tagline: string | null;
  showPoweredBy: boolean; // true unless enterprise tier
}
```

**New component:** `src/components/SchoolThemeProvider.tsx`
- Wraps `_app` or `layout.tsx`
- Reads tenant context from server-injected props (or cookie)
- Sets CSS custom properties on `<html>` element:
  - `--color-primary` → school's primary_color
  - `--color-secondary` → school's secondary_color
- Updates Tailwind config to reference these CSS variables
- Renders school logo in header if available
- Renders "Powered by Alfanumrik" in footer (configurable)

#### 3.2.2 Custom Domain Support

**Vercel configuration:**
- Wildcard domain `*.alfanumrik.com` on Vercel project
- Custom domains added programmatically via Vercel Domains API

**New API route:** `src/app/api/school/domain/route.ts`
- POST: School admin submits custom domain → generate verification token → store in `schools.domain_verification_token`
- GET: Check verification status (DNS TXT record lookup)
- PUT: Once verified, set `domain_verified = true`, add domain to Vercel via API
- DELETE: Remove custom domain

**Migration additions to `schools` table:**
```sql
ALTER TABLE schools ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN DEFAULT false;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS domain_verification_token TEXT;
```

### 3.3 School Admin Portal

**New route group:** `src/app/school/`

#### Pages (Phase 1 — 6 pages)

| Page | Route | Features |
|---|---|---|
| Layout | `/school/layout.tsx` | Branded sidebar shell, school logo, navigation |
| Dashboard | `/school/dashboard/` | Student count, active users, avg scores, quiz completion, seat usage gauge |
| Teachers | `/school/teachers/` | Table with invite/edit/deactivate, subject/class assignment |
| Students | `/school/students/` | Table with bulk invite (CSV + codes), roster, seat usage, deactivate |
| Subscription | `/school/subscription/` | Plan display, seat count, billing history, upgrade contact |
| Branding | `/school/branding/` | Logo upload, color pickers, tagline editor, custom domain setup wizard |

#### API Routes (Phase 1 — 6 routes)

| Route | Methods | Purpose |
|---|---|---|
| `/api/school/teachers` | GET, POST, PATCH | Teacher CRUD for this school |
| `/api/school/students` | GET, POST, PATCH, DELETE | Student CRUD + bulk invite |
| `/api/school/invite-codes` | GET, POST, DELETE | Generate/revoke join codes |
| `/api/school/analytics` | GET | School-scoped metrics |
| `/api/school/branding` | GET, PUT | Read/update school branding |
| `/api/school/domain` | GET, POST, PUT, DELETE | Custom domain lifecycle |

All routes enforce `authorizeRequest(request, 'school.*')` and verify the requesting user's `school_id` matches the tenant context.

### 3.4 Infrastructure Hardening

#### 3.4.1 Distributed Rate Limiting

**File:** `src/lib/rate-limiter.ts` (upgrade)

Replace in-memory Map with Upstash Redis sliding window:
```typescript
export async function checkDistributedRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return checkRateLimit(localStore, key, limit, windowMs); // fallback

  const window = Math.floor(Date.now() / windowMs);
  const redisKey = `rl:${key}:${window}`;
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, Math.ceil(windowMs / 1000));

  return {
    allowed: count <= limit,
    retryAfterMs: count > limit ? windowMs - (Date.now() % windowMs) : 0,
  };
}
```

Per-school configurable limits stored in `school_subscriptions.settings`:
```json
{
  "rate_limits": {
    "api_requests_per_minute": 1000,
    "quiz_submissions_per_minute": 200,
    "ai_requests_per_hour": 500
  }
}
```

#### 3.4.2 Cache Tenant Awareness

**File:** `src/lib/cache.ts` (extend)

Add tenant-scoped cache key generation:
```typescript
export function tenantCacheKey(schoolId: string | null, dataKey: string): string {
  return schoolId ? `t:${schoolId}:${dataKey}` : `g:${dataKey}`;
}
```

Phase 1: In-memory cache is sufficient for 1K students.
Phase 2: Migrate to Upstash Redis with same key pattern.

#### 3.4.3 Monitoring Enhancements

- Add `school_id` and `school_slug` tags to all Sentry error reports
- New Edge Function: `school-health-check/index.ts` — hourly cron that checks each active school's student activity and flags anomalies
- Super admin alerts page (Phase 2 full build, Phase 1 basic version)

### 3.5 B2B Onboarding Flow

#### School Provisioning (Super Admin Action)

1. Super admin creates school record via `/api/super-admin/institutions` (existing route, extended)
2. System generates slug from school name (existing migration logic)
3. Super admin creates `school_subscription` with negotiated pricing
4. System generates admin invite email → sends to principal/IT admin
5. Admin clicks link → creates account → assigned `institution_admin` role → auto-linked to school
6. Admin sees onboarding wizard: upload logo, set colors, invite first teacher

#### Student Onboarding (Two Paths)

**Path A — Invite Code:**
1. School admin generates invite code on `/school/students/`
2. Code has format: `DPS-2026-XXXX` (school prefix + year + random)
3. Student visits signup page → enters invite code → profile auto-linked to school
4. Existing P15 onboarding integrity maintained — 3-layer failsafe still applies

**Path B — CSV Bulk Upload:**
1. School admin uploads CSV (name, email, grade, section) on `/school/students/`
2. System validates CSV: required fields, grade format (string "6"-"12"), email format
3. System creates pending invites in `school_invite_codes` (table already exists, migration 20260412) with role='student'
4. Batch email sent via `send-auth-email` Edge Function
5. Students click verification link → complete signup → auto-linked to school

Both paths use the existing `send-auth-email` Edge Function (P15 rule 1: must return HTTP 200 on all code paths).

---

## 4. Phase 2: Operational Maturity (Weeks 7-12)

**Goal:** Scale to 5,000 students, schools self-sufficient.

### 4.1 School Admin Tier 2 Features

#### 4.1.1 Class/Section Management

**New page:** `src/app/school/classes/page.tsx`
**New table:** `school_classes`

```sql
CREATE TABLE school_classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,  -- "6" through "12" (P5: string grades)
  section TEXT NOT NULL, -- "A", "B", "C", etc.
  academic_year TEXT NOT NULL DEFAULT '2026-27',
  teacher_id UUID REFERENCES teachers(user_id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE school_class_members (
  class_id UUID REFERENCES school_classes(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (class_id, student_id)
);
```

Features:
- Create class sections (6-A, 7-B, etc.)
- Assign students to sections (drag-and-drop or bulk)
- Assign class teacher
- View class-level analytics

#### 4.1.2 Academic Reports

**New page:** `src/app/school/reports/page.tsx`

Reports available:
- **Per-class performance**: Avg score, quiz completion rate, Bloom's taxonomy distribution
- **Per-student drilldown**: Individual student progress over time, topic mastery
- **Subject gap analysis**: Which topics have lowest scores across the school
- **Teacher effectiveness**: Engagement rates per teacher's assigned classes
- **Export**: PDF and CSV via existing `export-report` Edge Function

#### 4.1.3 Announcements

**New page:** `src/app/school/announcements/page.tsx`
**New table:** `school_announcements`

```sql
CREATE TABLE school_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_grades TEXT[], -- null = all grades
  target_classes UUID[], -- null = all classes
  created_by UUID NOT NULL REFERENCES auth.users(id),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Delivery via existing notification infrastructure + `daily-cron` Edge Function.

### 4.2 School Admin Tier 3 Features

#### 4.2.1 Custom Content

**New page:** `src/app/school/content/page.tsx`
**New table:** `school_questions`

```sql
CREATE TABLE school_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  topic TEXT NOT NULL,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL, -- array of 4 strings
  correct_answer_index INT NOT NULL CHECK (correct_answer_index BETWEEN 0 AND 3),
  explanation TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  bloom_level TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  approved BOOLEAN DEFAULT false, -- requires review before serving
  created_at TIMESTAMPTZ DEFAULT now()
);
```

All questions must pass P6 (Question Quality) validation before being approved.
School questions are only served to that school's students.
Questions appear alongside global question_bank questions in quizzes.

#### 4.2.2 Exam Scheduling

**New page:** `src/app/school/exams/page.tsx`
**New table:** `school_exams`

```sql
CREATE TABLE school_exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  grade TEXT NOT NULL,
  target_classes UUID[], -- null = all classes in that grade
  question_count INT NOT NULL DEFAULT 20,
  duration_minutes INT NOT NULL DEFAULT 30,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  exam_preset TEXT, -- links to exam-engine.ts presets
  created_by UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('draft', 'scheduled', 'active', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Integrates with existing `exam-engine.ts` for timing presets and question selection.

#### 4.2.3 Parent Communication Portal

**New page:** `src/app/school/parents/page.tsx`

Features:
- View all parent-student links for this school
- Send bulk messages via WhatsApp (`whatsapp-notify` Edge Function) or email (`send-email`)
- Templates: progress report summary, exam reminder, attendance alert
- Delivery status tracking

#### 4.2.4 API Keys for ERP/SIS Integration

**New page:** `src/app/school/api/page.tsx`
**New table:** `school_api_keys`

```sql
CREATE TABLE school_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL, -- SHA-256 hash, never store plaintext
  name TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}', -- e.g., ['students.read', 'reports.read']
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**New public API:** `src/app/api/v1/school/`
- `students/route.ts` — Read-only student list for this school
- `reports/route.ts` — Read-only academic reports
- `attendance/route.ts` — Placeholder for future attendance sync
- Authenticated via API key in `Authorization: Bearer school_key_xxx` header
- Scoped to the school that owns the key

### 4.3 Super Admin Ops Center Overhaul

#### 4.3.1 School CRM

**Overhaul:** `src/app/super-admin/institutions/page.tsx`

New features:
- **Pipeline view**: Lead → Trial → Active → At-risk → Churned
- **Health score** (composite): engagement (30%) + seat utilization (25%) + payment status (25%) + support tickets (20%)
- **One-click provisioning wizard**: Name → Slug → Plan → Admin invite → Done
- **Billing management**: Adjust seats, change per-seat pricing, apply credits, extend trial
- **Impersonation**: "View as school admin" (extends existing `view-as` functionality)
- **Activity timeline**: Recent actions for each school

#### 4.3.2 B2B Analytics Dashboard

**New page:** `src/app/super-admin/analytics-b2b/page.tsx`

Metrics:
- School comparison: engagement rate, avg score, quiz completion, seat utilization
- Revenue: MRR, ARR, per-school revenue, average revenue per student
- Cohort analysis: schools by onboarding month, plan tier, geography
- Churn prediction: schools with 3+ weeks of declining engagement flagged
- Growth: new schools this month, student growth rate

#### 4.3.3 SLA and Alerting

**New page:** `src/app/super-admin/alerts/page.tsx`

Configurable alert rules:
- Error rate > threshold per school
- School engagement drops > X% week-over-week
- Payment failures for any school
- AI usage approaching budget limit
- Seat utilization > 90% (upsell opportunity)

**New page:** `src/app/super-admin/sla/page.tsx`

SLA metrics:
- Platform uptime (target: 99.9%)
- API response time P50/P95/P99
- Quiz submission latency
- AI tutor response time
- Per-school availability

### 4.4 Infrastructure Scale-Up

#### 4.4.1 Redis Cache Migration

Migrate `src/lib/cache.ts` hot paths to Upstash Redis:
- Tenant-aware keys: `t:{school_id}:{data_key}` for school-scoped data
- Global keys: `g:{data_key}` for shared data (curriculum, subjects)
- Same TTL strategy as current in-memory cache
- Fallback to in-memory if Redis unavailable (existing pattern)

#### 4.4.2 Database Optimization

New composite indexes for multi-tenant query patterns:
```sql
CREATE INDEX idx_students_school_grade ON students (school_id, grade) WHERE school_id IS NOT NULL;
CREATE INDEX idx_quiz_results_school ON quiz_results (school_id, created_at) WHERE school_id IS NOT NULL;
CREATE INDEX idx_student_progress_school ON student_progress (school_id, subject);
```

#### 4.4.3 Background Job Queue

Extend `queue-consumer` Edge Function to handle:
- Bulk student invite processing (CSV import)
- School report generation (PDF export)
- School content import and validation
- Announcement delivery batching

### 4.5 Mobile Tenant Awareness

**Phase 2 mobile changes (Flutter):**
- After login, fetch user's `school_id` from profile
- If school_id present, fetch school branding (colors, logo)
- Apply `ThemeData` dynamically based on school colors
- Show school name in app bar
- Feature gating based on school's subscription plan
- Same Play Store listing — single app, multi-tenant

---

## 5. Phase 3: Full Production (Weeks 13-16)

**Goal:** 10,000 students, all features live, self-service onboarding.

### 5.1 Load Testing and Hardening

- **Tool**: k6 or Artillery against staging environment
- **Scenarios**: 10K concurrent users, 2K simultaneous quiz submissions, 500 AI tutor requests/min
- **Bottleneck targets**: Quiz submission under load, leaderboard recalculation, AI tutor concurrent requests
- **Claude API management**: Per-school token budgets, queue overflow handling to prevent 429s
- **Database**: Enable `pg_stat_statements`, slow query alerts (>500ms), index optimization pass

### 5.2 Business Operations Automation

#### 5.2.1 Automated Invoicing

**New table:** `school_invoices`
```sql
CREATE TABLE school_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  seats_used INT NOT NULL,
  amount_inr NUMERIC NOT NULL,
  status TEXT DEFAULT 'generated' CHECK (status IN ('generated', 'sent', 'paid', 'overdue')),
  pdf_url TEXT,
  razorpay_invoice_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Monthly cron job (extend `daily-cron`):
1. For each active school subscription: count active students in period
2. Calculate: `seats_used * price_per_seat_monthly`
3. Generate PDF invoice
4. Email to `schools.billing_email`
5. Create Razorpay invoice for payment collection

#### 5.2.2 Seat Usage Tracking

Daily snapshot cron:
- Count active students per school
- Store in `school_subscription_usage` time-series table
- Alert school admin when approaching seat limit (80%, 90%, 100%)
- Alert super admin for upsell opportunities

#### 5.2.3 Contract Management

- Subscription renewal dates tracked in `school_subscriptions.current_period_end`
- Auto-reminder emails: 30 days, 14 days, 7 days before expiry
- Grace period: 14 days after expiry before access restricted
- Super admin override: extend/pause any school

### 5.3 Compliance and Security

#### 5.3.1 Audit Log

**New table:** `school_audit_log`
```sql
CREATE TABLE school_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL, -- e.g., 'teacher.invited', 'student.deactivated', 'branding.updated'
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_log_school_time ON school_audit_log (school_id, created_at DESC);
```

All school admin actions automatically logged via middleware wrapper.

#### 5.3.2 Data Export and Retention

- School requests data export → API generates ZIP containing:
  - Student roster (CSV)
  - Quiz results (CSV)
  - Progress reports (CSV)
  - AI tutor conversation summaries (anonymized)
- School churns → 90-day data retention → automated purge
- Purge logged in audit trail

#### 5.3.3 Security Documentation

For enterprise sales and school procurement:
- Data residency: Mumbai region (Supabase bom1 + Vercel bom1)
- Encryption: At rest (Supabase default) + in transit (TLS 1.3)
- Access control: RLS + RBAC + tenant isolation documented
- Incident response: Documented in `docs/incident-response.md`
- No PII in logs (P13 enforced by logger)

### 5.4 Self-Service School Onboarding

**New page:** `src/app/schools/page.tsx` (public landing page)

Flow:
1. School visits `alfanumrik.com/schools` → pricing page with per-seat calculator
2. Clicks "Start Free Trial" → signup form (school name, board, principal email)
3. System auto-creates: school record, slug, 30-day trial subscription (50 seats)
4. Admin receives verification email → creates account → onboarding wizard
5. No super admin intervention needed for standard trial → paid conversion

---

## 6. New Database Tables Summary

| Table | Purpose | Phase | RLS |
|---|---|---|---|
| `school_subscriptions` | Seat-based billing per school | Exists | Admin-only (deny all, service role bypasses) |
| `school_invite_codes` | **Already exists** (migration 20260412) — join codes for student/teacher onboarding | Exists | Admin-only (deny all, service role bypasses) |
| `school_classes` | Class/section management | 2 | School-scoped |
| `school_class_members` | Student-class assignments | 2 | School-scoped |
| `school_exams` | Scheduled assessments | 2 | School-scoped |
| `school_announcements` | School notifications | 2 | School-scoped |
| `school_questions` | School-uploaded custom content | 2 | School-scoped |
| `school_api_keys` | ERP/SIS integration keys | 2 | Admin-only |
| `school_audit_log` | Admin action audit trail | 3 | School-scoped (read-only for institution_admin) |
| `school_invoices` | Billing invoices | 3 | Admin-only |

---

## 7. New RBAC Permissions

| Permission Code | Role | Phase |
|---|---|---|
| `school.manage_teachers` | institution_admin | 1 |
| `school.manage_students` | institution_admin | 1 |
| `school.view_analytics` | institution_admin | 1 |
| `school.manage_branding` | institution_admin | 1 |
| `school.invite_students` | institution_admin | 1 |
| `school.invite_teachers` | institution_admin | 1 |
| `school.manage_billing` | institution_admin | 1 |
| `school.manage_classes` | institution_admin | 2 |
| `school.manage_content` | institution_admin | 2 |
| `school.manage_exams` | institution_admin | 2 |
| `school.manage_announcements` | institution_admin | 2 |
| `school.manage_api_keys` | institution_admin | 2 |
| `school.view_parent_comms` | institution_admin | 2 |
| `school.export_reports` | institution_admin | 2 |
| `school.manage_settings` | institution_admin | 2 |

---

## 8. Agent Decomposition

| Agent | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| **architect** | Tenant middleware, RLS migration, RBAC migration, session var injection, custom domain Vercel API | Composite indexes, Redis cache migration, connection tuning | Load test infra, audit log schema, data retention policies |
| **frontend** | School admin portal (6 pages), SchoolThemeProvider, branded layout, invite code onboarding UI | Tier 2+3 school pages (7 pages), super admin CRM overhaul, B2B analytics dashboards | Self-service school signup page, invoice viewer |
| **backend** | School API routes (6 routes), invite code system, CSV bulk import, school provisioning API | Announcement delivery, exam scheduling API, API key management, parent comms API | Automated invoicing cron, seat tracking, contract renewal emails |
| **assessment** | Validate school-scoped questions meet P6, verify scoring isolation per tenant | Custom content upload validation, exam preset integration with exam-engine.ts | Question bank per-school gap analysis |
| **ai-engineer** | Tenant-aware Foxy (inject school context into prompts), per-school usage limits in Edge Functions | School-scoped RAG if school uploads own content | Per-school Claude API budget management, token quota enforcement |
| **mobile** | None (PWA-only for B2B) | Tenant-aware Flutter: dynamic theming, school header, feature gating by plan | Load test mobile API paths |
| **ops** | School CRM basics in super admin, Sentry school tags, basic alerting | Full analytics overhaul, SLA dashboard, school health scoring, runbook updates | SOC 2 documentation, self-service monitoring, incident response docs |
| **testing** | Tenant isolation unit tests, RLS policy tests, school admin E2E, onboarding E2E with invite codes | Multi-school concurrent tests, exam scheduling tests, report export tests | Load test suite (k6), data retention tests, security penetration tests |
| **quality** | Type-check, lint, build gates, bundle budget (P10), bilingual audit (P7) | Same + all new pages reviewed for invariant compliance | Final production readiness audit |

---

## 9. Product Invariant Impact Assessment

| Invariant | Impact | Mitigation |
|---|---|---|
| **P1: Score Accuracy** | No change — formula unchanged | Verify school-scoped quiz results use same formula |
| **P2: XP Economy** | No change — XP rules unchanged | Verify school leaderboard uses same XP constants |
| **P3: Anti-Cheat** | No change — same checks apply per school | Test anti-cheat works with school_exams |
| **P4: Atomic Quiz** | No change — same RPC | Verify tenant context doesn't interfere with RPC |
| **P5: Grade Format** | Risk: school CSV import could introduce integer grades | CSV validator must enforce string grades |
| **P6: Question Quality** | Risk: school-uploaded questions could be low quality | Validation gate on school_questions before approval |
| **P7: Bilingual** | New pages (school admin) must support Hindi/English | All school admin pages use isHi context |
| **P8: RLS Boundary** | Major change: tenant-aware RLS added | Thorough testing of all RLS policies per tenant |
| **P9: RBAC** | New role + 15 permissions added | Test authorizeRequest with institution_admin |
| **P10: Bundle Budget** | New pages must stay within limits | SchoolThemeProvider must be lightweight (<5kB) |
| **P11: Payment Integrity** | New school billing path | Same Razorpay verification pattern for school subscriptions |
| **P12: AI Safety** | School context injected into prompts | Verify school context doesn't bypass safety filters |
| **P13: Data Privacy** | New school_id in Sentry tags (not PII) | Verify no student PII in school-level logs |
| **P14: Review Chains** | Many chains triggered by this work | Orchestrator tracks all chain requirements |
| **P15: Onboarding** | New invite code + CSV paths | Both paths use existing send-auth-email, maintain 3-layer failsafe |

---

## 10. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Tenant context leakage (student sees another school's data) | Critical | RLS policy tests per tenant, session var is transaction-local |
| Custom domain DNS propagation delay confuses school admins | Medium | Clear UI showing verification status, retry mechanism |
| School CSV bulk import with malformed data | Medium | Strict validation, preview before commit, error report |
| Redis unavailability breaks tenant resolution | High | Graceful fallback to direct DB query (slower but functional) |
| School admin accidentally deactivates all students | Medium | Confirmation dialog, audit log, super admin undo capability |
| Razorpay B2B invoice API differences from B2C subscription API | Medium | Spike/research Razorpay B2B features before Phase 3 |
| Bundle size increase from theme provider + school admin pages | Low | Lazy-load school admin portal, theme provider < 5kB |
| 10K concurrent quiz submissions overwhelm DB | High | Load test in Phase 3, connection pooling, queue if needed |

---

## 11. Success Criteria

### Phase 1 (Week 6)
- [ ] 2-3 pilot schools onboarded with branded subdomains
- [ ] School admin can manage teachers and students
- [ ] Tenant isolation verified: School A cannot see School B's data
- [ ] B2C users unaffected (zero regression)
- [ ] All existing tests pass + new tenant isolation tests

### Phase 2 (Week 12)
- [ ] 5,000 students active across all schools
- [ ] Schools generating their own reports
- [ ] At least 1 school using custom domain
- [ ] Super admin CRM tracking school health scores
- [ ] SLA dashboard showing 99.9% uptime

### Phase 3 (Week 16)
- [ ] 10,000 students active
- [ ] Load test passing at 10K concurrent
- [ ] Automated invoicing working for all schools
- [ ] Self-service trial signup functional
- [ ] Security documentation ready for enterprise procurement