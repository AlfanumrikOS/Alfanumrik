# Feature Inventory — School Admin

Target users: school/institution administrators (B2B tenant owners). Multi-tenant
isolation, RBAC, branding, billing. Routes confirmed under `src/app/school-admin/` on
2026-06-28. DB tables / APIs best-effort — **to be verified per cycle**.

---

### Dashboard / Overview
- **Business purpose:** institution home; tenant-wide KPIs and health.
- **Key files:** `src/app/school-admin/page.tsx`.
- **DB tables (best-effort):** `schools`, `classes`, `teachers`, `students`.
- **APIs:** `/api/school-admin/overview`.
- **Status:** partial — tenant-scoped aggregates; empty-tenant state to verify.
- **Known gaps:** cross-tenant isolation on every aggregate.

### Students
- **Business purpose:** manage all students in the institution.
- **Key files:** `src/app/school-admin/students/page.tsx`.
- **DB tables (best-effort):** `students`, `class_enrollments`.
- **APIs:** `/api/school-admin/students`.
- **Status:** partial — PII scope + tenant boundary (P13) to verify.
- **Known gaps:** bulk operations; export PII gate.

### Teachers / Staff
- **Business purpose:** manage teaching staff and roles.
- **Key files:** `src/app/school-admin/teachers/page.tsx`, `src/app/school-admin/staff/page.tsx`.
- **DB tables (best-effort):** `teachers`, staff/role tables.
- **APIs:** `/api/school-admin/staff`.
- **Status:** partial — role assignment within tenant to verify.
- **Known gaps:** invite flow; deactivation.

### Classes / Enroll / Invite codes
- **Business purpose:** create classes, enroll students, distribute invite codes.
- **Key files:** `src/app/school-admin/classes/page.tsx`, `.../enroll/page.tsx`, `.../invite-codes/page.tsx`, `.../setup/page.tsx`.
- **DB tables (best-effort):** `classes`, `class_enrollments`, invite-code tables.
- **APIs:** `/api/school-admin/classes`, `/api/school-admin/classes/enrollments`, `/api/schools/setup/classes`, `/api/schools/enroll`.
- **Status:** partial — enrollment atomicity and code redemption to verify.
- **Known gaps:** duplicate enrollment; code expiry.

### Reports (mastery / bloom / depth)
- **Business purpose:** institution-level learning analytics.
- **Key files:** `src/app/school-admin/reports/page.tsx`, `src/app/school-admin/reports-depth/page.tsx`.
- **DB tables (best-effort):** `quiz_sessions`, `student_learning_profiles`.
- **APIs:** `/api/school-admin/reports/mastery`, `.../reports/bloom`, `.../reports/export`.
- **Status:** partial — learner-metric definitions need assessment sign-off.
- **Known gaps:** export PII (P13); large-tenant performance (P10/infra).

### Branding
- **Business purpose:** white-label tenant branding.
- **Key files:** `src/app/school-admin/branding/page.tsx`.
- **DB tables (best-effort):** `tenant_config` / branding tables.
- **APIs:** `/api/school-admin/branding`, `/api/school-config`, `/api/school-config/manifest`.
- **Status:** partial — manifest/theming application to verify.
- **Known gaps:** asset validation; tenant override scope.

### RBAC
- **Business purpose:** tenant-scoped role/permission management.
- **Key files:** `src/app/school-admin/rbac/page.tsx`.
- **DB tables (best-effort):** role/permission/grant tables.
- **APIs:** `/api/school-admin/rbac`.
- **Status:** partial — architect-owned permission model; changes need architect review.
- **Known gaps:** privilege-escalation guard; audit of grant changes.

### Billing / Invoices / Contracts
- **Business purpose:** B2B billing, invoices, contracts.
- **Key files:** `src/app/school-admin/billing/page.tsx`.
- **DB tables (best-effort):** `invoices`, `contracts`, subscription tables.
- **APIs:** `/api/school-admin/invoices`, `/api/school-admin/contracts`, `/api/schools/trial`.
- **Status:** partial — coordinate with Payments cycle (rank 2).
- **Known gaps:** invoice generation accuracy; trial-to-paid transition.

### Modules / Module-access / Tenant-config
- **Business purpose:** enable/disable platform modules per tenant.
- **Key files:** `src/app/school-admin/modules/page.tsx`.
- **DB tables (best-effort):** `tenant_config`, module-access tables.
- **APIs:** `/api/school-admin/modules`, `/api/school-admin/tenant-config`.
- **Status:** partial — module gating vs feature flags overlap to verify.
- **Known gaps:** interaction with global feature flags.

### Audit log / API keys / AI config / Announcements / Exams / Content / Parents (to verify)
- `audit-log/`, `api-keys/`, `ai-config/`, `ai-assistant/`, `announcements/`, `exams/`, `content/`, `parents/`.
- **APIs:** `/api/school-admin/audit-log`, `/api/school-admin/api-keys`, `/api/school-admin/data-export`.
- **Status:** to verify — confirm tenant scoping, PII on data-export, audit completeness.
