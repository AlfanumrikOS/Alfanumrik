# API Route Catalog

Auto-generated catalog of all 151 API routes.

## Summary

| Domain | Routes | Auth Pattern |
|---|---|---|
| super-admin | 61 | authorizeAdmin (session) |
| school-admin | 17 | authorizeSchoolAdmin |
| v1 (public) | 13 | authenticateApiKey |
| internal | 13 | authorizeRequest |
| student | 8 | authorizeRequest |
| payments | 7 | authorizeRequest / webhook |
| schools | 6 | mixed |
| auth | 4 | none (public) |
| parent | 3 | authorizeRequest |
| teacher | 2 | authorizeRequest |
| cron | 2 | verifyCronSecret |
| other | 15 | varies |

## Full Route Table

| Path | Methods | Auth |
|---|---|---|
| /auth/bootstrap | POST | none |
| /auth/onboarding-status | GET | none |
| /auth/repair | POST | authorizeRequest |
| /auth/session | POST,DELETE,GET | none |
| /client-error | POST | none |
| /concept-engine | GET | authorizeRequest |
| /cron/evaluate-alerts | POST | verifyCronSecret |
| /cron/school-operations | POST | verifyCronSecret |
| /diagnostic/complete | POST | authorizeRequest |
| /diagnostic/start | POST | authorizeRequest |
| /embedding | POST | none |
| /error-report | POST | none |
| /exam/chapters | POST | authorizeRequest |
| /foxy | POST,GET | authorizeRequest |
| /internal/admin/ai-monitor | GET | none |
| /internal/admin/bulk-action | POST | none |
| /internal/admin/command-center | GET | none |
| /internal/admin/content | GET,POST,PATCH,DELETE | none |
| /internal/admin/feature-flags | GET,POST,PATCH | none |
| /internal/admin/logs | GET | none |
| /internal/admin/reports | GET | none |
| /internal/admin/revenue | GET | none |
| /internal/admin/schools | GET,POST | none |
| /internal/admin/stats | GET | none |
| /internal/admin/support | GET,PATCH | none |
| /internal/admin/users | GET,PATCH | none |
| /internal/admin/users/[id] | GET,PATCH | none |
| /notifications/whatsapp | POST | authorizeAdmin |
| /parent/approve-link | POST | none |
| /parent/profile | PATCH | none |
| /parent/report | POST | authorizeRequest |
| /payments/cancel | POST | none |
| /payments/create-order | POST | none |
| /payments/setup-plans | POST | none |
| /payments/status | GET | none |
| /payments/subscribe | POST | none |
| /payments/verify | POST | none |
| /payments/webhook | POST | none |
| /quiz | GET,POST | authorizeRequest |
| /quiz/ncert-questions | GET | authorizeRequest |
| /scan-solve | POST | authorizeRequest |
| /school-admin/analytics | GET | authorizeSchoolAdmin |
| /school-admin/announcements | GET,POST,PATCH,DELETE | authorizeSchoolAdmin |
| /school-admin/api-keys | GET,POST,DELETE | authorizeSchoolAdmin |
| /school-admin/audit-log | GET | authorizeSchoolAdmin |
| /school-admin/branding | GET,PUT | authorizeSchoolAdmin |
| /school-admin/classes | GET,POST,PATCH | authorizeSchoolAdmin |
| /school-admin/classes/enrollments | GET,POST,DELETE | authorizeSchoolAdmin |
| /school-admin/content | GET,POST,PATCH,DELETE | authorizeSchoolAdmin |
| /school-admin/data-export | POST | authorizeSchoolAdmin |
| /school-admin/exams | GET,POST,PATCH,DELETE | authorizeSchoolAdmin |
| /school-admin/invite-codes | GET,POST,DELETE | authorizeSchoolAdmin |
| /school-admin/invoices | GET | authorizeSchoolAdmin |
| /school-admin/parents | GET,POST | authorizeSchoolAdmin |
| /school-admin/reports | GET | authorizeSchoolAdmin |
| /school-admin/students | GET,PATCH | authorizeSchoolAdmin |
| /school-admin/subscription | GET | authorizeSchoolAdmin |
| /school-admin/teachers | GET,POST,PATCH | authorizeSchoolAdmin |
| /school-config | GET | authorizeRequest |
| /school-config/manifest | GET | authorizeRequest |
| /schools/enroll | POST | authorizeRequest |
| /schools/join | POST | none |
| /schools/setup/classes | POST | authorizeRequest |
| /schools/setup/invite-codes | POST | authorizeRequest |
| /schools/setup/profile | POST | authorizeRequest |
| /schools/trial | POST | none |
| /student/exam-simulation | POST | authorizeRequest |
| /student/foxy-interaction | POST | authorizeRequest |
| /student/preferences | PATCH | authorizeRequest |
| /student/profile | PATCH | authorizeRequest |
| /student/scan-upload | POST | authorizeRequest |
| /student/stem-observation | POST | authorizeRequest |
| /student/study-plan | PATCH | authorizeRequest |
| /student/subjects | GET | none |
| /super-admin/alerts | GET,POST,PATCH,DELETE | authorizeAdmin |
| /super-admin/analytics | GET | authorizeAdmin |
| /super-admin/analytics-v2 | GET | authorizeAdmin |
| /super-admin/analytics-v2/b2b | GET | authorizeAdmin |
| /super-admin/bulk-actions/notify | POST | authorizeAdmin |
| /super-admin/bulk-actions/plan-change | POST | authorizeAdmin |
| /super-admin/bulk-actions/resend-invites | POST | authorizeAdmin |
| /super-admin/bulk-actions/suspend-restore | POST | authorizeAdmin |
| /super-admin/bulk-upload | POST,GET | authorizeAdmin |
| /super-admin/cms | GET,POST,PATCH | authorizeAdmin |
| /super-admin/content | GET,POST,PATCH,DELETE | authorizeAdmin |
| /super-admin/content-coverage | GET | authorizeAdmin |
| /super-admin/db-performance | GET | authorizeAdmin |
| /super-admin/demo-accounts | GET,POST,PUT,DELETE | authorizeAdmin |
| /super-admin/deploy | GET | authorizeAdmin |
| /super-admin/feature-flags | GET,POST,PATCH,DELETE | authorizeAdmin |
| /super-admin/improvement | GET,POST,PATCH | authorizeAdmin |
| /super-admin/improvement/deploy | GET,POST,PATCH | authorizeAdmin |
| /super-admin/improvement/learning-monitors | GET,POST | authorizeAdmin |
| /super-admin/improvement/learning-quality | GET | authorizeAdmin |
| /super-admin/improvement/qa-gate | POST | authorizeAdmin |
| /super-admin/improvement/staging | GET,POST | authorizeAdmin |
| /super-admin/institutions | GET,POST,PATCH | authorizeAdmin |
| /super-admin/institutions/billing | GET,PATCH | authorizeAdmin |
| /super-admin/institutions/health | GET | authorizeAdmin |
| /super-admin/institutions/provision | POST | authorizeAdmin |
| /super-admin/invoices | GET,POST,PATCH | authorizeAdmin |
| /super-admin/logs | GET | authorizeAdmin |
| /super-admin/observability | GET | authorizeAdmin |
| /super-admin/observability/channels | GET,POST | authorizeAdmin |
| /super-admin/observability/channels/[id] | GET,PATCH,DELETE | authorizeAdmin |
| /super-admin/observability/channels/[id]/test | POST | authorizeAdmin |
| /super-admin/observability/events | GET | authorizeAdmin |
| /super-admin/observability/events/[id] | GET | authorizeAdmin |
| /super-admin/observability/export | GET | authorizeAdmin |
| /super-admin/observability/rules | GET,POST | authorizeAdmin |
| /super-admin/observability/rules/[id] | GET,PATCH,DELETE | authorizeAdmin |
| /super-admin/observability/rules/[id]/test | POST | authorizeAdmin |
| /super-admin/observability/snapshot | GET | authorizeAdmin |
| /super-admin/payment-ops/reconcile | POST | authorizeAdmin |
| /super-admin/payment-ops/stats | GET | authorizeAdmin |
| /super-admin/payment-ops/stuck | GET | authorizeAdmin |
| /super-admin/platform-ops | GET,POST | authorizeAdmin |
| /super-admin/reports | GET | authorizeAdmin |
| /super-admin/roles | GET,POST,DELETE | authorizeAdmin |
| /super-admin/seat-usage | GET,POST | authorizeAdmin |
| /super-admin/sessions | GET,POST | authorizeAdmin |
| /super-admin/sla | GET | authorizeAdmin |
| /super-admin/stats | GET | authorizeAdmin |
| /super-admin/strategic-reports/bloom-by-grade | GET | authorizeAdmin |
| /super-admin/strategic-reports/cohort-retention | GET | authorizeAdmin |
| /super-admin/students/[id]/dashboard | GET | authorizeAdmin |
| /super-admin/students/[id]/foxy-history | GET | authorizeAdmin |
| /super-admin/students/[id]/impersonate | GET,POST,PATCH | authorizeAdmin |
| /super-admin/students/[id]/notes | GET,POST | authorizeAdmin |
| /super-admin/students/[id]/profile | GET | authorizeAdmin |
| /super-admin/students/[id]/progress | GET | authorizeAdmin |
| /super-admin/students/[id]/quiz-history | GET | authorizeAdmin |
| /super-admin/support | GET,POST | authorizeAdmin |
| /super-admin/test-accounts | POST | authorizeAdmin |
| /super-admin/users | GET,PATCH | authorizeAdmin |
| /support/ticket | POST | none |
| /teacher/profile | PATCH | none |
| /teacher/subjects | GET | authorizeRequest |
| /v1/admin/audit-logs | GET | authorizeRequest |
| /v1/admin/roles | GET,POST,PATCH | authorizeRequest |
| /v1/child/[id]/progress | GET | authorizeRequest |
| /v1/child/[id]/report | GET | authorizeRequest |
| /v1/class/[id]/analytics | GET | authorizeRequest |
| /v1/exam/create | POST | authorizeRequest |
| /v1/health | GET | none |
| /v1/leaderboard | GET | authorizeRequest |
| /v1/performance | GET | authorizeRequest |
| /v1/school/reports | GET | authenticateApiKey |
| /v1/school/students | GET | authenticateApiKey |
| /v1/study-plan | GET | authorizeRequest |
| /v1/upload-assignment | POST | authorizeRequest |

_Generated 2026-04-16. See each route.ts for full details._
