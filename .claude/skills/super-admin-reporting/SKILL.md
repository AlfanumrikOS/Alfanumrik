---
name: super-admin-reporting
description: Ownership boundaries, handoff protocol, and review gates for all super-admin panel and reporting changes.
user-invocable: false
---

# Skill: Super-Admin Reporting

Defines who owns what in the super-admin panel, how changes flow between agents, and what requires review. Reference when any agent touches `src/app/super-admin/`, `src/app/api/super-admin/`, or reporting-related files.

## Ownership Matrix

### Per-Concern Ownership
| Concern | Owner | Why |
|---|---|---|
| Reporting definitions (what metrics exist) | ops | Ops decides what admin visibility is needed |
| Learner KPI definitions (mastery, Bloom's, XP velocity) | assessment | Only assessment can define what "mastery" means |
| Operational KPI thresholds (healthy/degraded) | ops | Ops defines operational health criteria |
| Admin business rules (CMS workflow, user activation) | ops | Admin panel governance is ops territory |
| API data contracts (response shapes, field names) | backend | Backend implements, ops specifies requirements |
| Page implementation (React, layout, interactions) | frontend | Pure UI work |
| Visual hierarchy (prominence, colors, spacing) | frontend | Pure UI work |
| Backend queries (SQL, aggregation, caching) | backend | Backend implements, architect reviews perf |
| Filter/export definitions (what's filterable, export formats) | ops (spec) + backend (impl) + frontend (UI) | Three-agent handoff |
| Alert severity rules (critical/warning/info thresholds) | ops | Ops defines severity; frontend renders |
| RBAC for admin features | architect | Permission model is architect's domain |

### Per-Page Ownership
| Page | UI Owner | Logic Owner | API Route | Data Tables |
|---|---|---|---|---|
| Control room (`/super-admin`) | frontend | ops | `stats`, `observability`, `deploy` | students, teachers, quiz_sessions, deployment_history |
| Users (`/super-admin/users`) | frontend | ops | `users`, `roles` | students, teachers, guardians, user_roles |
| CMS (`/super-admin/cms`) | frontend | ops + assessment (content QA) | `cms` | chapters, topics, question_bank, cms_assets |
| Logs (`/super-admin/logs`) | frontend | ops | `logs`, `reports` | admin_audit_log |
| Flags (`/super-admin/flags`) | frontend | ops | `feature-flags` | feature_flags |
| Institutions (`/super-admin/institutions`) | frontend | ops | `institutions` | schools |
| Diagnostics (`/super-admin/diagnostics`) | frontend | ops | `observability`, `deploy` | task_queue, deployment_history, backup_status |
| Learning (`/super-admin/learning`) | frontend | ops + assessment (metric definitions) | `analytics`, `stats`, `observability` | students, quiz_sessions, chat_sessions |
| Reports (`/super-admin/reports`) | frontend | ops | `reports` | all exportable tables |
| Subscriptions (`/super-admin/subscriptions`) | frontend | ops + backend (payment data) | `analytics`, `users` | students, student_subscriptions |
| Workbench (`/super-admin/workbench`) | frontend | ops | `users`, `institutions`, `content` | all entity tables |

## Executive vs Operational Metrics

### Executive Metrics (user/founder-facing, synthesized by orchestrator)
| Metric | Definition Owner | Data Source |
|---|---|---|
| Revenue: MRR, churn rate, plan distribution | ops + backend | student_subscriptions, Razorpay |
| User growth: DAU/MAU, signup rate | ops | students (created_at, last_active) |
| Learner outcomes: avg score trend, mastery rate | assessment | quiz_sessions, student_learning_profiles |
| AI engagement: chat usage, Foxy retention | ai-engineer + ops | chat_sessions |
| Content coverage: % of CBSE syllabus covered | assessment | question_bank, curriculum_topics |

### Operational Metrics (admin-panel-only, ops-owned)
| Metric | Definition | Threshold |
|---|---|---|
| System health | DB connectivity + queue failures | degraded if failed_jobs > 10 |
| Error rate | Sentry event count per hour | tracked, no auto-alert yet |
| Queue health | Pending + failed tasks in task_queue | failed > 10 = degraded |
| Deployment status | Latest deploy commit, environment, status | manual monitoring |
| Backup status | Last backup completed_at, verified_at | manual monitoring |
| Feature flag state | enabled/total count | informational |
| Content workflow | Draft/review/published counts | informational |

## Handoff Protocol for Super-Admin Changes

### Adding a New Metric or Report
```
1. ops        → defines: metric name, data source, filter criteria, display requirements
2. assessment → validates (if learner metric): is the definition academically correct?
3. architect  → reviews (if new schema needed): table, column, index, RLS
4. backend    → implements: API route or modifies existing, returns data in defined shape
5. frontend   → implements: renders metric in admin panel page
6. testing    → validates: API response shape test + E2E render test
7. quality    → reviews: code quality + review chain completeness
```

### Changing an Existing API Response Shape
```
1. ops or backend → proposes change with reason
2. frontend       → confirms: current page code can handle new shape (or flags UI update needed)
3. backend        → implements API change
4. frontend       → updates page if needed
5. testing        → updates response shape assertions
6. quality        → reviews
```

### Changing an Alert Severity Threshold
```
1. ops      → defines: new threshold and reason (e.g., "degraded if failed > 5 instead of 10")
2. frontend → updates: visual rendering if severity display changes
3. testing  → updates: threshold assertions
4. quality  → reviews
```

### Adding a New Data Export Type
```
1. ops       → defines: what data, what fields, what format
2. architect → reviews: PII exposure check (P13), RLS compliance
3. backend   → implements: new report type in reports API
4. frontend  → adds: download button to reports page
5. testing   → validates: export format and field correctness
6. quality   → reviews
USER APPROVAL REQUIRED: any export containing student PII (names, emails, phone numbers)
```

### Changing CMS Content Workflow
```
1. ops        → proposes: workflow change (e.g., add "needs_revision" status)
2. assessment → reviews: does this affect what students see? content QA impact?
3. architect  → reviews: schema change if new status column or migration needed
4. backend    → implements: API changes for new workflow transitions
5. frontend   → updates: CMS page status controls
6. testing    → validates: workflow transitions work end-to-end
7. quality    → reviews
```

## Review Gates for Super-Admin Changes

| What Changed | Required Reviewers | Why |
|---|---|---|
| New metric or KPI added | assessment (if learner metric), architect (if schema) | Wrong learner metric definition misleads admins |
| API response shape changed | frontend, testing | Frontend page will break if contract changes |
| Severity threshold changed | testing | Assertions must match new thresholds |
| New filter or export | architect (PII review), testing | PII leaks in exports violate P13 |
| CMS workflow rule changed | assessment, testing | Affects what content reaches students |
| Admin RBAC changed | architect, frontend, testing | Permission model is security-critical |
| Report export modified | architect (PII), testing | Compliance concern |
| Subscription override logic | backend, architect | Money-adjacent operation |

## What Requires User Approval

- New data exports containing student PII (names, emails, phone numbers)
- Revenue metric calculation changes (MRR, churn — directly inform business decisions)
- CMS workflow changes that affect what students can see
- Admin RBAC changes (who can access what in admin panel)
