# Feature Inventory — Parent

Target users: parents/guardians of enrolled students. Dual-auth + DPDP-sensitive
(consent, export, erasure). Routes confirmed under `src/app/parent/` on 2026-06-28.
DB tables / APIs best-effort — **to be verified per cycle**.

---

### Parent portal home
- **Business purpose:** parent landing; overview of linked children and recent activity.
- **Key files:** `src/app/parent/page.tsx`, `src/app/parent/profile/page.tsx`.
- **DB tables (best-effort):** `guardians`, `parent_student_links`, `students`.
- **APIs:** `/api/parent/profile`.
- **Status:** partial — first-run (no linked child) empty-state to verify.
- **Known gaps:** parent↔child link boundary (P8/P13) enforcement on every read.

### Children (link + manage)
- **Business purpose:** link to a child via code/OTP; manage linked children.
- **Key files:** `src/app/parent/children/page.tsx`.
- **DB tables (best-effort):** `parent_student_links`, link-code/OTP tables.
- **APIs:** `/api/parent/link-code/request-otp`, `/api/parent/link-code/redeem`, `/api/parent/approve-link`.
- **Status:** partial — REG-117 pins approve-link boundary; verify revoke/unlink path.
- **Known gaps:** abuse/rate-limit on OTP; stale link cleanup.

### Reports
- **Business purpose:** child progress reports for parents.
- **Key files:** `src/app/parent/reports/page.tsx`.
- **DB tables (best-effort):** `quiz_sessions`, `student_learning_profiles`.
- **APIs:** `/api/parent/report`.
- **Status:** partial — report only renders for linked, consented children (verify).
- **Known gaps:** PII scope (P13); empty-data month.

### Messages
- **Business purpose:** parent↔teacher/school messaging threads.
- **Key files:** `src/app/parent/messages/page.tsx`.
- **DB tables (best-effort):** message thread + message tables.
- **APIs:** `/api/parent/messages`, `/api/parent/messages/threads`, `/api/parent/messages/threads/[id]/messages`.
- **Status:** partial — thread authorization boundary to verify.
- **Known gaps:** unread counts; notification linkage.

### Billing
- **Business purpose:** parent-side subscription/billing view (Razorpay, P11).
- **Key files:** `src/app/parent/billing/page.tsx`.
- **DB tables (best-effort):** `student_subscriptions`, `payment_webhook_events`.
- **APIs:** `/api/parent/billing`, `/api/payments/status`, `/api/payments/cancel`.
- **Status:** partial — coordinate with Payments cycle (rank 2); verify cancel flow.
- **Known gaps:** invoice display; failed-payment messaging.

### Consent (DPDP)
- **Business purpose:** record/withdraw consent for minor's data processing.
- **Key files:** `src/app/parent/consent/page.tsx`.
- **DB tables (best-effort):** `consent` / `parent_consent` tables.
- **APIs:** `/api/parent/consent`.
- **Status:** partial — DPDP compliance critical; verify consent gates downstream data.
- **Known gaps:** consent withdrawal propagation; audit trail.

### Data rights — export / erasure (DPDP)
- **Business purpose:** export a child's data; request erasure.
- **Key files:** child data-rights API routes (no dedicated page yet — verify).
- **DB tables (best-effort):** export/erasure request tables.
- **APIs:** `/api/parent/children/[student_id]/export`, `.../request-erasure`, `.../erasure-status`.
- **Status:** partial — compliance-critical; verify auth + PII scoping on export.
- **Known gaps:** erasure SLA/status surfacing in UI; account-purge cron linkage.

### Notifications
- **Business purpose:** parent notification feed.
- **Key files:** `src/app/parent/notifications/page.tsx`.
- **APIs:** `/api/parent/notifications`, `.../[id]/read`, `.../mark-all-read`.
- **Status:** partial — bilingual (P7) notification shape to verify.
- **Known gaps:** empty-state; mark-all behavior.

### Attendance / Calendar / Support (to verify)
- `src/app/parent/attendance/page.tsx`, `src/app/parent/calendar/page.tsx`, `src/app/parent/support/page.tsx`.
- **Status:** to verify — confirm data source (B2B-only?), empty-states, support routing.
