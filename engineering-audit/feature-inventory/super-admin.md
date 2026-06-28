# Feature Inventory — Super Admin

Target users: Alfanumrik internal operators (ops domain). Requires admin-secret /
service-role auth (P9). Must never leak PII (P13); flag changes must be audited.
The admin surface has grown well beyond the 12-page ops charter — ~70+ pages under
`src/app/super-admin/` on 2026-06-28. DB tables / APIs best-effort — **verify per cycle**.

---

### Control room / Command center
- **Business purpose:** top-level operational dashboard (stats, deploy, backups, audit).
- **Key files:** `src/app/super-admin/page.tsx`, `src/app/super-admin/command-center/page.tsx`.
- **DB tables (best-effort):** `students`, `teachers`, `quiz_sessions`, `deployment_history`, `backup_status`.
- **APIs:** `/api/super-admin/stats`, `/api/internal/admin/stats`, `/api/internal/admin/command-center`, `/api/super-admin/deploy`.
- **Status:** partial — admin auth gate on every route to verify.
- **Known gaps:** stat freshness; degraded-state surfacing.

### Login / Auth
- **Business purpose:** super-admin authentication gate.
- **Key files:** `src/app/super-admin/login/page.tsx`, `src/lib/admin-auth.ts`.
- **APIs:** admin auth / secret validation.
- **Status:** partial — `SUPER_ADMIN_SECRET` enforcement on all admin routes (P9) to verify.
- **Known gaps:** session handling; brute-force protection.

### Users / Roles / RBAC
- **Business purpose:** manage all platform users and roles.
- **Key files:** `src/app/super-admin/rbac/page.tsx`, view-as student subpages, `src/app/super-admin/students/[id]/page.tsx`.
- **DB tables (best-effort):** `students`, `teachers`, `guardians`, `user_roles`.
- **APIs:** `/api/internal/admin/users`, `/api/internal/admin/users/[id]`.
- **Status:** partial — role-change audit + architect review needed.
- **Known gaps:** privilege elevation guard (REG-119 area); PII in user lists.

### Institutions / Schools intelligence
- **Business purpose:** manage schools; B2B intelligence (geography, revenue, per-school).
- **Key files:** `src/app/super-admin/intelligence/schools/page.tsx`, `.../schools/[id]/page.tsx`, `.../geography/page.tsx`, `.../revenue/page.tsx`.
- **DB tables (best-effort):** `schools`, subscription/revenue tables.
- **APIs:** `/api/internal/admin/schools`, `/api/internal/admin/revenue`.
- **Status:** partial — revenue metric definitions (ops+backend) to verify.
- **Known gaps:** MRR/churn calculation correctness (user-approval-gated).

### Content / CMS / Subjects
- **Business purpose:** content management, subject/grade mapping, plan-access.
- **Key files:** `src/app/super-admin/content/page.tsx`, `src/app/super-admin/cms/page.tsx`, `src/app/super-admin/subjects/*`.
- **DB tables (best-effort):** `chapters`, `topics`, `question_bank`, `cms_assets`.
- **APIs:** `/api/internal/admin/content`, `/api/super-admin/cms`.
- **Status:** partial — CMS publish must pass assessment content QA.
- **Known gaps:** content workflow statuses; educational-accuracy gate.

### Grounding / AI quality / Foxy quality / Oracle / Marking integrity
- **Business purpose:** AI grounding health, coverage, traces, verification queue, marking-authenticity forensics.
- **Key files:** `src/app/super-admin/grounding/*`, `src/app/super-admin/foxy-quality/page.tsx`, `src/app/super-admin/oracle-health/page.tsx`, `src/app/super-admin/marking-integrity/page.tsx`, `src/app/super-admin/misconceptions/page.tsx`.
- **DB tables (best-effort):** `marking_audit_last_30d` (view), RAG/trace tables.
- **APIs:** `/api/internal/admin/ai-monitor`, foxy-quality cron.
- **Status:** partial — ai-engineer + assessment co-owned; verify service-role-only reads.
- **Known gaps:** PII in traces (P13); forensic view access scope.

### Feature flags
- **Business purpose:** global feature-flag control.
- **Key files:** flags page (under super-admin/internal), `src/lib/feature-flags.ts`.
- **DB tables (best-effort):** `feature_flags`.
- **APIs:** `/api/super-admin/feature-flags`, `/api/internal/admin/feature-flags`, `/api/feature-flags/check`.
- **Status:** partial — **every flag change must be audited** (rejection condition).
- **Known gaps:** audit-trail completeness; role/env/institution targeting UI.

### Analytics / Intelligence
- **Business purpose:** engagement, revenue, retention analytics.
- **Key files:** `src/app/super-admin/analytics/page.tsx`, `.../analytics-b2b/page.tsx`, `src/app/super-admin/intelligence/page.tsx`.
- **DB tables (best-effort):** aggregates over `students`, `quiz_sessions`, subscriptions.
- **APIs:** `/api/super-admin/analytics`, `/api/internal/admin/reports`.
- **Status:** partial — **analytics responses must contain no PII (P13)**.
- **Known gaps:** redaction on every metric payload; export gates.

### Observability / Health / SLA / Alerts
- **Business purpose:** system health, alert rules/channels, SLA tracking.
- **Key files:** `src/app/super-admin/observability/*`, `src/app/super-admin/health/page.tsx`, `src/app/super-admin/sla/page.tsx`, `src/app/super-admin/alerts/page.tsx`, `src/app/super-admin/diagnostics/page.tsx`.
- **DB tables (best-effort):** `task_queue`, `deployment_history`, alert rule/channel tables.
- **APIs:** `/api/super-admin/observability`, `/api/v1/health`, `/api/cron/evaluate-alerts`.
- **Status:** partial — **health endpoint must always return status** (rejection condition).
- **Known gaps:** degraded-state thresholds (ops-owned); alert dedupe.

### Support
- **Business purpose:** support ticket management.
- **Key files:** `src/app/super-admin/support/page.tsx`, `src/app/support/*`.
- **DB tables (best-effort):** support ticket tables.
- **APIs:** `/api/super-admin/support`, `/api/internal/admin/support`.
- **Status:** partial — must not expose student PII to unauthorized roles.
- **Known gaps:** ticket→bug routing; resolution-time metric.

### Other admin surfaces (to verify)
- `alfabot/`, `subscribers/`, `invoices/`, `bulk-actions/`, `bulk-upload/`,
  `goal-profiles/`, `module-overrides/`, `mol-shadow/`, `oauth-apps/`,
  `readiness-rubric/`, `demo/`, `view-as/[studentId]/*`.
- **Status:** to verify — confirm live vs experimental, auth gate, PII boundaries.
