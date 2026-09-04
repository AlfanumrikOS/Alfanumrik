# 04 — Business Capability Matrix (actor × entity × operation)

Legend: **E** = EXISTS (page + guarded route + data path verified in code) · **P** = PARTIAL (one leg missing, or works only via URL/API, or flag-off) · **M** = MISSING · **D** = DUPLICATED (≥2 implementations; names in proof) · — = not applicable for the actor. Operation columns: V view · C create · Ed edit · Del delete/archive · BI bulk import (CSV/XLSX + template + validation preview + error report) · BE bulk export · S search · F filter/sort · A assign/link · R report/analytics · N notify. Proof column cites the page/route/table; live row counts are from 2026-09-03 queries and show whether the capability has ever been exercised.

Actors: ST student · PA parent · TE teacher · SA school admin · SU super admin.

## 1. Schools

| Actor | V | C | Ed | Del | BI | BE | S | F | A | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SU | E | E | E | P (pause/resume only, no archive) | P (CSV, 200 rows, no template download, no preview) | M | P (client filter) | P | E (admins) | E | M | `/super-admin/institutions` (1,790 lines), `/api/super-admin/institutions/{provision,[id]/pause,[id]/resume,[id]/admins,bulk-onboard,verify-domain}`, `/super-admin/intelligence/schools`; 15 schools live |
| SA | E | — | E (branding, settings) | — | — | P (`/api/school-admin/data-export`, orphan) | — | — | — | E | — | `/school-admin/branding`, `/setup`, `/modules`; `schools.settings` |
| TE/PA/ST | P (name only) | — | — | — | — | — | — | — | P (join by code) | — | — | `student_join_class`, `teacher_join_class_by_code` |

## 2. Classes / sections

| Actor | V | C | Ed | Del | BI | BE | S | F | A | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SA | E | E | E | P (`deleted_at` column, UI archive not found) | P (`/api/school-admin/classes/bulk-create`, JSON not CSV) | M | M | P | E (teachers, students) | E (`classes-at-risk`, mastery rollups) | M | `/school-admin/classes` (817 lines); 10 classes live |
| TE | E | E | E | E (`/api/teacher/classes/[id]/archive`, **no audit**) | M | M | M | P | E (join code, roster) | E | P (`parent-notify`) | `/teacher/classes`, `/api/teacher/classes*` |
| SU | E | — | — | — | — | — | — | — | — | E | — | intelligence pages |
| ST | P (own class) | — | — | — | — | — | — | — | E (join) | — | — | `student_join_class` |

## 3. Students

| Actor | V | C | Ed | Del | BI | BE | S | F | A | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SA | E (page queries `students` from browser) | E (`school_admin_student_create_preflight`) | E | P (`school_admin_toggle_student_active`) | **D/P**: `/api/school-admin/students/bulk-import` (JSON rows, class link, seat check) + `/roster/validate` dry-run + `/school-admin/enroll` page — **no CSV template download, no XLSX, no error-row report file** | M | P (client) | P | E (class) | E | P (invite emails via parents route) | `/school-admin/students` (540), `/school-admin/enroll` (697); `/api/school-admin/students` list route is orphan |
| SU | E | E | E | E (suspend/restore) | **D**: `/super-admin/bulk-upload` (CSV, template, 1,000 rows, school picker) | M | E (`/api/super-admin/users` search) | E | E | E | E (bulk notify/resend-invites) | `/super-admin/users`, `/students/[id]`, `/bulk-actions`, `/bulk-upload` |
| TE | E | — | P (notes) | — | M | M | M | P | E (roster) | E | E (`parent-notify`) | `/teacher/students` (1,087), `/api/teacher/students` (orphan, unbounded) |
| PA | E (linked children) | — | — | E (unlink) | — | E (`/api/parent/children/[student_id]/export`) | — | — | E (link code / OTP) | E | — | `/parent/children` (1,399); 2 guardian links live |
| ST | E (profile) | E (signup) | E | E (deletion request) | — | — | — | — | — | E | — | `/profile`, `/me`, `/settings` (3 pages, D) |

## 4. Teachers

| Actor | V | C | Ed | Del | BI | BE | S | F | A | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SA | E | E (invite modal) | P | P (`is_active`) | P (`/api/school-admin/teachers/bulk-import`, JSON; roster/validate covers teachers) — no CSV template | M | P | P | E (classes) | E (`teacher-engagement`) | P (invite email) | `/school-admin/teachers` (637), `/staff` (D with `/teachers`) |
| SU | E | E | E | E | M | M | E | E | E | E | E | `/super-admin/users` |
| TE | E (self) | E (onboarding) | E (profile, **no audit**) | — | — | — | — | — | — | — | — | `/teacher/onboarding`, `/teacher/profile` |

## 5. Parents

| Actor | V | C | Ed | Del | BI | BE | S | F | A | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SA | E | E (invite via Mailgun) | P | P | **M** (no bulk parent import; no CSV) | M | P | P | E (link to students) | P | E (invite) | `/school-admin/parents` (1,069), `/api/school-admin/parents` |
| SU | E | E | E | E | M | M | E | E | E | P | E | `/super-admin/users` |
| TE | P (thread list — **BROKEN**, C-001) | — | — | — | — | — | — | — | — | — | E (`parent-notify`) | `/teacher/messages` |
| PA | E (self) | E | E | E (account deletion) | — | — | — | — | E | — | — | `/parent/profile`, `parent_update_own_profile` |

## 6. Subjects / chapters / topics (`curriculum_topics`)

| Actor | V | C | Ed | Del | BI | BE | S | F | A | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SU | E (`/super-admin/subjects`, `/grade-map`, `/plan-access`, `/violations`, `/grounding/coverage`) | **M** (no topic editor; `curriculum_topics.content_status/reviewed_by/published_by` columns exist, no UI) | M | M | M | M | M | P | E (grade map, plan access) | E (coverage, readiness) | — | `get_curriculum_browser`, `get_curriculum_versions` RPC exist; **no version-management UI** (`grep curriculum_version` in super-admin → 0) |
| SA | P (content page) | — | — | — | — | — | — | — | — | E (readiness) | — | `/school-admin/content` |
| TE | E (read) | — | — | — | — | — | — | — | E (assign chapter) | — | — | |
| ST | E (`/learn`, `/library`) — **D**: reads `chapters` and `curriculum_topics` and `cbse_syllabus` (02 §E.4) | — | — | — | — | — | M | P | — | — | — | |

## 7. Question bank

| Actor | V | C | Ed | Del | BI | BE | S | F | A | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SU | E (`/super-admin/content`, `/cms`, `/grounding/verification-queue`, `/misconceptions`) — **D** (3 UIs) | P (AI generation via Edge `bulk-question-gen`, `bulk-non-mcq-gen`, `ncert-question-engine`; no manual create form found) | E (verification queue, fix history) | P (soft `deleted_at`) | **P** (`/api/school-admin/content/bulk` accepts rows with `topic` text; no CSV/XLSX, no template, no chapter-tag validation against `curriculum_topics`; JEE/NEET CSV imports exist as Edge Functions only) | M | E (`search_vector` GIN) | E | E (`topic_id`, `chapter_id`, `chapter_number` — three tagging columns) | E (coverage audit) | — | 18,765 rows live |
| SA | E (`/school-admin/content`, 1,502 lines) | E (`school_questions`) | E | P | P (`content/bulk`) | M | P | P | P | P | — | |
| TE | P (worksheets answer-key) | M | M | — | M | M | M | M | E (assign) | — | — | `/api/teacher/worksheets/answer-key` only |

## 8. Worksheets / assignments

| Actor | V | C | Ed | Del | BI | BE | S | F | A | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TE | E | E (`/api/teacher/assignments` POST, `teacher_create_assignment`, `teacher_create_adaptive_assignment`) — **no zod, no audit** | P | P | M (`/api/v1/upload-assignment` orphan) | M | M | P | E (class) | P (`get_assignment_report` RPC) | P | `/teacher/assignments`, `/worksheets`, `/submissions`, `/grade-book`; **assignments 0 rows, assignment_submissions 0, grade_book_entries 0** |
| ST | E (`/assignments`) | — | — | — | — | — | — | — | — | — | — | queries `assignments` from browser |
| SA | P (exams page) | E (`/school-admin/exams`, `school_exams`) | E | — | — | — | — | — | — | — | — | |
| PA | M | — | — | — | — | — | — | — | — | — | — | |

## 9. Quizzes / attempts

| Actor | V | C | Ed | Del | BI | BE | S | F | A | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ST | E | E — **D** (6 question paths, 4 submit RPCs; 02 §D-1/D-2) | — | — | — | — | — | E | — | E (`/progress`, `/reports`) | — | 112 quiz_sessions live, 10 in 30 d; mock_test_attempts 0 |
| TE | E (submissions, grade-book) | — | E (`CellEditModal`) | — | — | M | — | P | E | E (`/teacher/reports` 808 lines) | — | |
| PA | E (`/parent/reports`, 2,174 lines) | — | — | — | — | E (child export) | — | — | — | E | — | |
| SA/SU | E (marking integrity, forensic view) | — | — | — | — | — | — | — | — | E | — | `/super-admin/marking-integrity` |

## 10. Mastery / learning profiles

| Actor | V | Proof / notes |
|---|---|---|
| ST | E (`/progress`, `/progress/dashboard` (orphan), `/memory`, `/me`) — **D** | reads `concept_mastery`, `student_learning_profiles` |
| PA | E (`/parent/reports`) | |
| TE | E (CommandCenter heatmap, `StudentMasteryReport`) | `get_class_mastery_heatmap` |
| SA | E (`/school-admin/reports`, `/reports-depth`, pulse) — **D** | |
| SU | E (`/super-admin/learning`, `/adaptive-loops`, `/foxy-report/[studentId]` (orphan)) | |
| Storage | **D**: `concept_mastery` live; `adaptive_mastery`/`topic_mastery`/`layer_mastery`/`student_concept_state` dead (02 §C) | |

## 11. Foxy sessions

| Actor | V | C | Ed | Del | S | F | R | N | Proof |
|---|---|---|---|---|---|---|---|---|---|
| ST | E | E | — | P (retention 90 d) | M | P | E | — | `/foxy` (2,602), `/api/foxy/*`; 2,065 sessions live |
| PA | E (`/api/parent/children/[student_id]/chat`) | — | — | — | — | — | P | — | |
| TE | M | — | — | — | — | — | — | — | no teacher view of student Foxy transcripts |
| SA | P (`/school-admin/ai-config`, `/ai-assistant` = Principal AI, `/escalations`) | | | | | | E (safeguarding) | E | |
| SU | E (`/foxy-quality`, `/ai-quality`, `/grounding/traces`, `/alfabot`) — **D** | | | | E | E | E | — | |

## 12. Reports

| Actor | Status | Proof |
|---|---|---|
| PA weekly digest | **P/BROKEN**: page `/parent/reports` exists; on-demand `/api/parent/report` fails 401 (C-003); `parent_weekly_reports` **0 rows**; cron `parent-report-generator` never produced one; WhatsApp weekly flag `ff_whatsapp_parent_weekly` ON | 02 §A |
| PA progress / mastery / time-on-task / Foxy usage | E / E / P (`total_time_minutes` in learning profile) / P (message counts, no usage panel) | `parent/reports/page.tsx` |
| SA class-level & school-level aggregates, teacher activity, subscription status | E (`/school-admin` CommandCenter: overview, classes-at-risk, teacher-engagement, seat gauge; `/reports`, `/reports-depth`, `/billing`) — **D** (`/reports` vs `/reports-depth` vs `/insights` stub) | routes `overview`, `leadership`, `teacher-engagement`, `reports/{bloom,mastery,export}` |
| TE | E (`/teacher/reports`) | |
| SU | E (intelligence, analytics, analytics-b2b, strategic reports) — **D** | |
| Export | P: `/api/school-admin/reports/export` (E), `/api/school-admin/data-export` (orphan), `/api/super-admin/observability/export` (E); no XLSX anywhere | |

## 13. Subscriptions / payments / quotas

| Actor | V | C | Ed | Del | R | N | Proof |
|---|---|---|---|---|---|---|---|
| ST | E (`/me`, `/billing`, `/pricing`) — **D** | E (Razorpay checkout via `useCheckout`) | E (plan change) | E (cancel) | — | E (pre-debit, renewal) | 5 payments ever; webhook never observed (C-007) |
| PA | E (`/parent/billing`, `/parent/plan` stub) | E | — | — | — | — | |
| SA | E (`/school-admin/billing`, `ff_school_self_service_billing_v1` ON) | E (seat plans, GST details) | E | — | E | — | `school_subscriptions` 1 row |
| SU plan management | E (`/subscriptions`, `/subscribers`, `/entitlements`, `/invoices`, `/institutions/billing`) — **D** (5 pages) | E | E (`bulk-actions/plan-change`) | E | E (MRR, payment-ops) | E | |
| SU quota controls | **P**: DB has `security_quota_profiles` (54), `security_route_policies` (54), `security_tenant_ai_budgets`; UI exposes only plan entitlements — no per-school/route quota editor (`grep quota super-admin pages` → 0) | | | | | | |

## 14. Feature flags

| Actor | Status | Proof |
|---|---|---|
| SU | E: `/super-admin/flags` shows `target_institutions`, `target_roles`, `target_environments`, rollout %, protection classes (`flags/page.tsx:11-25`); `/module-overrides`; `/subjects/plan-access` — **D** (3 flag-like surfaces) | live 202 flags, 140 enabled |
| SA | E: `/school-admin/modules` (tenant module registry) | |
| Per-school / per-role toggles | E (columns + UI) | |

## 15. RAG content / index

| Actor | Status | Proof |
|---|---|---|
| SU index status | E: `/grounding/coverage`, `/grounding/health`, `/grounding/traces`, `/grounding/ai-issues`, `/grounding/verification-queue`, `/oracle-health` — **D** (6 pages) | |
| SU re-index / ingest controls | **M**: no route or page triggers `run_embedding_backfill_tick`, `rag-ingest-batch` (tombstone) or a re-embed; the pg_cron `embedding-backfill-tick` job is **inactive** live; `embedding_backfill_queue` has 21,411 rows | live `cron.job`, grep |
| Curriculum version management | **M** (§6) | |

## 16. Audit logs

| Actor | Status | Proof |
|---|---|---|
| SU viewer | E: `/super-admin/logs` (reads `api_request_logs`/ops via route), `/observability` timeline; `admin_audit_log` 228 rows, `audit_logs` 4,168 | |
| SA viewer | E: `/school-admin/audit-log` reads `school_audit_log` — **1 row live**, so the school-scoped trail is effectively empty because most school writes log to `audit_logs` (`logAudit`) instead | `audit-log/route.ts:67` |
| Impersonation trail | E: `/api/super-admin/students/[id]/impersonate` writes `admin_impersonation_sessions` + `logAdminAudit` (`impersonate/route.ts:23,117`); `/super-admin/view-as/[studentId]/{dashboard,foxy,progress,quizzes}` — **0 sessions ever** | |

## 17. Notifications

| Actor | Status | Proof |
|---|---|---|
| ST | E (`/notifications`, WhatsApp opt-in `/settings/whatsapp`) | 806 notifications live |
| PA | E (`/parent/notifications`) — **D** with `/notifications` | |
| TE → PA | E (`/api/teacher/parent-notify`, threads **BROKEN** C-001) | |
| SA announcements | E (`/school-admin/announcements` → `school_announcements`, **0 rows**) | |
| SU global announcements | **M**: `admin_announcements` table exists; no page or route reads/writes it (`grep admin_announcements api|super-admin` → 0) | |

## 18. Settings / profile

| Actor | Status | Proof |
|---|---|---|
| ST | E — **D** (`/profile` 1,250 lines, `/settings` 800 lines orphan, `/me` 329) | |
| PA | E (`/parent/profile`; `/parent/settings` stub) | |
| TE | E (`/teacher/profile`; `/teacher/settings` stub) | |
| SA | E (`/school-admin/setup`, `/branding`, `/rbac`, `/api-keys`; `/settings` stub) | |
| SU | E (`/super-admin/rbac`, `/oauth-apps`, `/enroll-mfa`) | |

## 19. Global search (⌘K)

**MISSING for every role.** No command palette, no search dialog, no `/api/*/search` endpoint scoped by RBAC (`grep -rn "cmdk|CommandPalette|GlobalSearch|SearchDialog"` → 0; the only "Search" component is a marketing icon). Per-page client-side filters exist on roster and content pages only.

## 20. Specific gaps the brief asked to confirm or refute

| Gap | Verdict |
|---|---|
| Bulk upload of students/teachers/parents with school/class linking + invite flow | Students: PARTIAL/DUPLICATED (two contracts, one CSV-with-template at super-admin only, JSON at school-admin; dry-run exists; no error-row file). Teachers: PARTIAL (JSON only). Parents: **MISSING**. |
| Bulk upload of worksheets/questions into `question_bank` with chapter tagging against `curriculum_topics` | PARTIAL: school `content/bulk` accepts JSON rows tagged by free-text `topic`; no CSV/XLSX template, no validation preview, and tagging targets three columns (`topic_id`, `chapter_id`, `chapter_number`) across three taxonomies. |
| Student input capture (answers, doubts, feedback) and where it lands | EXISTS: answers → `quiz_responses`/`quiz_sessions` (+`user_question_history`); doubts → `foxy_chat_messages`/`foxy_sessions` (+`foxy_scan_queries`); feedback → `foxy_message_feedback`, `foxy_message_dimension_feedback`, `ai_issue_reports`, `support_tickets`. Written answers → `student_ncert_attempts`/`grade-written-answer`. |
| Parent reporting (progress, mastery, time-on-task, Foxy usage, weekly digest) | PARTIAL; weekly digest BROKEN/never produced (C-003, 0 rows). |
| School dashboard (class & school aggregates, teacher activity, subscription status) | EXISTS (duplicated across 3 report surfaces). |
| Super admin: onboarding/approval E(P) · cross-school user mgmt E · impersonation with trail E (unused) · subscription/plan mgmt E (D×5) · quota controls **P** · flag toggles per school/role E · RAG status E (D×6) / re-index **M** · curriculum version mgmt **M** · system health E (D×8) · audit-log viewer E · global announcements **M** | |
| Global search | **MISSING** |

Cell totals: EXISTS 129 · PARTIAL 58 · MISSING 31 · DUPLICATED 21 (D counted where ≥2 implementations serve the same cell; rows marked "—" excluded).
