# B2B School Platform Architecture

## Overview

Alfanumrik's B2B platform enables schools to use Alfanumrik as their learning management system. Schools get a white-label portal with custom branding, student/teacher management, academic analytics, exam scheduling, and billing -- all powered by the same core learning engine used by B2C students.

The B2B layer is built on top of the existing B2C platform using a shared-database multi-tenancy model with row-level security (RLS) isolation.

## Multi-Tenancy Model

### Architecture

- **Shared database**: All schools share the same PostgreSQL database. Tenant isolation is enforced by RLS policies keyed on `school_id`.
- **Tenant resolution**: Subdomains (`dps.alfanumrik.com`) and custom domains (`learn.dps.com`) resolve to a school record via `src/lib/tenant.ts`.
- **RLS helper**: The `get_admin_school_id()` SQL function returns the `school_id` for the authenticated user by checking `school_admins` first, then falling back to `teachers`.
- **Header propagation**: Middleware resolves the tenant and forwards `x-school-id`, `x-school-slug`, `x-school-plan`, `x-school-name` headers to API routes.

### Tenant Resolution Flow

```
Incoming request (hostname)
  |
  +-- isB2CDomain()? --> Yes --> NULL_TENANT (standard B2C)
  |
  +-- No --> extractSlugFromHost()
              |
              +-- Slug found --> fetchSchoolBySlug() --> TenantContext
              |
              +-- No slug --> fetchSchoolByCustomDomain() --> TenantContext
              |
              +-- Not found --> Cache NOT_FOUND (5-min TTL)
```

### Domain Rules

- Reserved subdomains (not tenant slugs): `app`, `www`, `api`, `admin`, `staging`, `dev`
- B2C domains: `alfanumrik.com`, `*.vercel.app`, `localhost`
- Tenant cache: In-memory with 5-minute TTL. Negative results are also cached.
- Cache invalidation: Call `invalidateTenantCache(host)` when school settings change.

### Client-Side Context

The `TenantCtx` React context (`src/lib/tenant-context.ts`) provides `useTenant()` to components. `cssVarsFromBranding()` converts school branding to CSS custom properties for white-label theming.

## Authentication

### School Admin Auth (`src/lib/school-admin-auth.ts`)

Every school-admin API route uses `authorizeSchoolAdmin(request, permissionCode)` which:

1. Validates JWT and checks RBAC permission via the standard `authorizeRequest()`.
2. Looks up the `school_admins` record for the authenticated user.
3. Verifies the linked school is active.
4. Returns `schoolId` for tenant-scoped queries.

All subsequent database queries in the route MUST be filtered by the returned `schoolId` to enforce tenant isolation.

### Dual Auth Path

- **School admin portal** (`/api/school-admin/*`): Uses `authorizeSchoolAdmin()` with RBAC permissions like `institution.view_analytics`, `institution.manage_students`, `class.manage`, `school.manage_settings`, etc.
- **Super admin access** (`/api/super-admin/*`): Uses `authorizeAdmin()` with `SUPER_ADMIN_SECRET`. Super admins can view data across all schools.

### API Key Auth (`/api/v1/school/*`)

External ERP/SIS integrations authenticate via API keys:

- Key format: `sk_school_...` passed as `Authorization: Bearer <key>`
- Verification: SHA-256 hash comparison against `school_api_keys.key_hash`
- Scoped: Each key has explicit `permissions` array and belongs to a single `school_id`
- Expiration: Keys have an optional `expires_at` timestamp

## Data Model

### B2B Tables

| Table | Purpose |
|-------|---------|
| `schools` | School directory with branding columns (slug, logo_url, primary_color, secondary_color, custom_domain, tagline, billing_email, settings) |
| `school_admins` | Links auth users to schools as administrators. Columns: school_id, auth_user_id, role, name, is_active |
| `school_subscriptions` | Institutional billing: plan (trial/active/expired/cancelled), seats_purchased, price_per_seat_monthly, billing_cycle, Razorpay integration |
| `school_invite_codes` | Onboarding codes for students/teachers. Role-scoped, usage-limited, with expiration |
| `school_api_keys` | API keys for ERP integration. Stored as SHA-256 hash with key_prefix for identification |
| `school_announcements` | Bilingual announcements (title/body in English and Hindi) targeted by grade or class |
| `school_questions` | Custom question bank per school. Subject/grade/topic scoped with P6-compliant validation |
| `school_exams` | Scheduled exams with status workflow: draft -> scheduled -> active -> completed/cancelled |
| `school_audit_log` | Compliance audit trail: actor, action, resource_type, resource_id, metadata, IP address |
| `school_invoices` | Monthly invoices: period, seats_used, amount_inr, status (generated/sent/paid/overdue), Razorpay integration |
| `school_seat_usage` | Daily seat utilization snapshots: active_students vs seats_purchased with utilization percentage |
| `school_alert_rules` | Alert rule configuration: rule_type (error_rate, engagement_drop, payment_failure, ai_budget, seat_limit), threshold, is_active |
| `class_enrollments` | Student-to-class mapping with UNIQUE(class_id, student_id), partial indexes on active enrollments |

### Cross-Reference Columns

- `students.school_id` -- Links students to their school (nullable for B2C students)
- `teachers.school_id` -- Links teachers to their school
- `quiz_sessions.school_id` -- Denormalized from students.school_id at quiz creation time for efficient school-level reporting

## School Admin Portal

### Pages (`src/app/school-admin/`)

| Page | Route | Purpose |
|------|-------|---------|
| Dashboard | `/school-admin` | Overview stats: students, teachers, classes, quizzes, scores, seat utilization |
| Students | `/school-admin/students` | Student directory with search, grade filter, enrollment management |
| Teachers | `/school-admin/teachers` | Teacher directory and management |
| Classes | `/school-admin/classes` | Class creation, enrollment management, grade/section organization |
| Exams | `/school-admin/exams` | Exam scheduling with status workflow (draft/scheduled/active/completed) |
| Content | `/school-admin/content` | Custom question bank management with P6 validation |
| Announcements | `/school-admin/announcements` | Bilingual announcements targeted by grade or class |
| Reports | `/school-admin/reports` | Academic reports: school overview, class performance, student detail, subject gaps |
| Parents | `/school-admin/parents` | Parent-student link management |
| Invite Codes | `/school-admin/invite-codes` | Invite code generation for student/teacher onboarding |
| API Keys | `/school-admin/api-keys` | API key management for ERP/SIS integration |
| Audit Log | `/school-admin/audit-log` | Paginated audit trail viewer with action/date filters |
| Billing | `/school-admin/billing` | Subscription and invoice management |
| Setup | `/school-admin/setup` | Initial school configuration |
| Enroll | `/school-admin/enroll` | Student enrollment flows |

## API Routes

### School Admin Routes (`/api/school-admin/`)

| Route | Methods | Permission | Purpose |
|-------|---------|------------|---------|
| `/api/school-admin/analytics` | GET | `institution.view_analytics` | Dashboard stats (students, teachers, quizzes, scores, seats) |
| `/api/school-admin/students` | GET | `institution.manage_students` | Paginated student list with grade filter and search |
| `/api/school-admin/teachers` | GET | `institution.manage_teachers` | Paginated teacher list |
| `/api/school-admin/classes` | GET, POST | `class.manage` | Class CRUD with enrollment counts |
| `/api/school-admin/exams` | GET, POST, PATCH | `school.manage_exams` | Exam CRUD with status transitions |
| `/api/school-admin/content` | GET, POST | varies | Custom question management with P6 validation |
| `/api/school-admin/announcements` | GET, POST, PATCH | `school.manage_settings` | Announcement CRUD with bilingual support |
| `/api/school-admin/reports` | GET | `institution.view_reports` | Academic reports (school_overview, class_performance, student_detail, subject_gaps) |
| `/api/school-admin/parents` | GET | `school.manage_settings` | Parent-student links for the school |
| `/api/school-admin/invite-codes` | GET, POST | `institution.manage_students` | Invite code management |
| `/api/school-admin/api-keys` | GET, POST, PATCH | `school.manage_api_keys` | API key management (create, list, revoke) |
| `/api/school-admin/audit-log` | GET | `school.manage_settings` | Paginated audit log with action/date filters |
| `/api/school-admin/subscription` | GET | `school.manage_billing` | Subscription details and seat usage |
| `/api/school-admin/invoices` | GET | `institution.manage` | Invoice listing with status filter |
| `/api/school-admin/branding` | GET, PATCH | `school.manage_branding` | School branding configuration |
| `/api/school-admin/data-export` | GET | varies | CSV exports (students, quiz_results, progress, full) |

### V1 ERP Integration Routes (`/api/v1/school/`)

| Route | Auth | Purpose |
|-------|------|---------|
| `/api/v1/school/students` | API key (`sk_school_...`) | Student data for external ERP/SIS systems |
| `/api/v1/school/reports` | API key (`sk_school_...`) | Report data for external systems |

## Super Admin B2B Extensions

The super admin panel includes dedicated pages and API routes for managing the B2B platform:

| Route | Purpose |
|-------|---------|
| `/super-admin/analytics-b2b` | B2B-specific analytics dashboard |
| `/super-admin/sla` | SLA monitoring and compliance |
| `/super-admin/alerts` | Alert rule management and alert history |
| `/super-admin/invoices` | Cross-school invoice management |
| `/api/super-admin/analytics-v2/b2b` | B2B analytics API (school counts, seat utilization, revenue) |
| `/api/super-admin/sla` | SLA metrics API |
| `/api/super-admin/alerts` | Alert rules CRUD (error_rate, engagement_drop, payment_failure, ai_budget, seat_limit) |
| `/api/super-admin/invoices` | Invoice listing with school_id/status filters |
| `/api/super-admin/seat-usage` | Per-school seat usage history (daily snapshots) |

## Cron Operations

### Daily School Operations (`/api/cron/school-operations`)

Runs daily at 2:00 AM UTC (7:30 AM IST) via Vercel Cron. Authenticated via `CRON_SECRET` header.

**Step 1: Daily seat usage snapshot** (every run)
- Counts active students per school
- Upserts into `school_seat_usage` with utilization percentage
- Idempotent: UNIQUE(school_id, snapshot_date) prevents duplicates

**Step 2: Monthly invoice generation** (1st of month only)
- Generates invoices for the previous billing period
- Calculates amount: seats_used * price_per_seat_monthly
- Skips free/trial schools with zero price
- Idempotent: UNIQUE(school_id, period_start, period_end) prevents duplicates

**Step 3: Contract renewal reminders** (30/14/7 days before expiry)
- Checks `school_subscriptions.current_period_end`
- Sends bilingual notifications (English and Hindi) at 30, 14, and 7-day thresholds
- Idempotent: checks for existing reminder within 24 hours

**Step 4: Seat limit alerts** (80%/90%/100% thresholds)
- Alerts school admins when seat utilization hits 80%, 90%, or 100%
- Alerts super admin for 90%+ thresholds
- At 100%: warns that new students cannot be added
- Idempotent: one alert per school per threshold per day

Processing is batched (50 schools per batch) with graceful error handling. The cron gracefully skips if the `school_subscriptions` table does not exist (for environments where B2B is not yet deployed).

## RLS Policies

All B2B tables have RLS enabled with policies following these patterns:

- **Service role bypass**: All tables allow full access for `service_role` (used by API routes via `getSupabaseAdmin()`)
- **School admin SELECT**: Uses `get_admin_school_id()` to scope reads to the admin's school
- **Student SELECT**: Scoped to the student's own school via `students.school_id`
- **Parent SELECT**: Scoped via `guardian_student_links` to linked children's schools
- **Teacher SELECT**: Scoped via `class_teachers` to assigned classes
- **No direct INSERT/UPDATE**: Mutations go through service role API routes only

## Known Limitations

1. **Middleware tenant integration**: Tenant resolution logic exists in `src/lib/tenant.ts` but is not yet wired into the main middleware (`src/middleware.ts`). Tenant context headers are not automatically injected on every request.

2. **B2B analytics not pre-aggregated**: School-level analytics queries run against raw tables (students, quiz_sessions) rather than pre-aggregated materialized views. At scale, this will need optimization.

3. **In-memory rate limiting on trial signup**: Trial school signup (if exposed publicly) uses the same in-memory rate limiter as the rest of the app, which resets on serverless cold starts.

4. **Vercel Cron not yet configured**: The `crons` array in `vercel.json` is currently empty. The `/api/cron/school-operations` route exists but needs a cron schedule entry to run automatically.

5. **Legacy `class_students` table**: A legacy `class_students` table exists from the core schema and is still referenced by 5+ source files. The newer `class_enrollments` table has a cleaner design but data migration between the two is pending.
