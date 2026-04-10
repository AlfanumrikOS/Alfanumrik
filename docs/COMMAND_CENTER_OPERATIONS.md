# Product Improvement Command Center -- Operations Manual

Last updated: 2026-04-04

## System Architecture

### Data Flow

```
Product Events (user actions, errors, metrics)
         |
         v
  Issue Detection Engine           Manual Reports (founder, agents)
  (src/lib/issue-detector.ts)              |
         |                                 |
         +---------- merge ---------------+
                       |
                       v
             improvement_issues
             (status: open)
                       |
                       v
            Recommendation Engine
            (agent analysis, AI suggestions)
                       |
                       v
          improvement_recommendations
          (status: proposed)
                       |
                       v
               Founder Approval
          (approve / reject in UI)
                       |
                       v
          improvement_executions
          (status: pending)
                       |
                       v
                   Staging
         /api/super-admin/improvement/staging
         (config_change, content_fix, code_patch, manual)
                       |
                       v
                   QA Gate
         /api/super-admin/improvement/qa-gate
         (type-check, lint, test, build)
                       |
                       v
                Deploy to Production
         /api/super-admin/improvement/deploy
         (records commit, resolves issue)
                       |
                       v
          Post-Deploy Health Monitoring
          (15-minute observation window)
```

### Database Tables

#### improvement_issues

Stores detected and manually reported product issues.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| source | TEXT | `auto_detect`, `user_report`, `data_signal`, `manual` |
| category | TEXT | `onboarding`, `ux`, `learning`, `quiz`, `rag`, `performance`, `admin`, `payment`, `mobile` |
| title | TEXT | Short issue summary |
| description | TEXT | Detailed description |
| severity | TEXT | `critical`, `high`, `medium`, `low` |
| status | TEXT | `open`, `investigating`, `recommendation_pending`, `in_progress`, `resolved`, `wont_fix` |
| evidence | JSONB | Supporting data (metrics, screenshots, logs) |
| affected_users_count | INTEGER | Estimated number of affected users |
| recurrence_count | INTEGER | How many times this issue has been detected |
| assigned_agent | TEXT | Agent responsible for investigation |
| detected_at | TIMESTAMPTZ | When the issue was first detected |
| resolved_at | TIMESTAMPTZ | When the issue was resolved (null if open) |
| created_by | TEXT | Admin email who created the issue |
| updated_at | TIMESTAMPTZ | Last modification timestamp |

RLS: Admin-only read/write. Service role for automated detection inserts.

#### improvement_recommendations

Proposed fixes linked to issues. One issue can have multiple recommendations.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| issue_id | UUID | FK to improvement_issues (CASCADE delete) |
| recommendation | TEXT | What to do, in detail |
| impact_estimate | TEXT | `high`, `medium`, `low` |
| effort_estimate | TEXT | `hours`, `days`, `weeks` |
| risk_level | TEXT | `low`, `medium`, `high` |
| affected_files | TEXT[] | Source files that would be changed |
| agent_owner | TEXT | Which agent owns this recommendation |
| status | TEXT | `proposed`, `approved`, `rejected`, `executing`, `completed`, `rolled_back` |
| approved_by | TEXT | Admin email who approved |
| approved_at | TIMESTAMPTZ | When approval was granted |
| created_at | TIMESTAMPTZ | Creation timestamp |
| updated_at | TIMESTAMPTZ | Last modification timestamp |

RLS: Admin-only read/write.

#### improvement_executions

Tracks the staging, testing, deployment, and rollback of each recommendation.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| recommendation_id | UUID | FK to improvement_recommendations (CASCADE delete) |
| execution_type | TEXT | `code_patch`, `config_change`, `content_fix`, `manual` |
| status | TEXT | `pending`, `staging`, `testing`, `approved`, `deployed`, `rolled_back`, `failed` |
| test_results | JSONB | QA gate output (type-check, lint, test, build results) |
| staging_url | TEXT | Vercel preview or staging environment URL |
| deploy_commit | TEXT | Git commit hash of the deployed change |
| started_at | TIMESTAMPTZ | When execution began |
| completed_at | TIMESTAMPTZ | When deployed successfully |
| rolled_back_at | TIMESTAMPTZ | When rolled back (if applicable) |
| rollback_reason | TEXT | Why the rollback was performed |
| created_at | TIMESTAMPTZ | Creation timestamp |

RLS: Admin-only read/write.

#### product_events

Browser-side and server-side analytics events persisted to the database for issue detection analysis. 30-day retention enforced by daily-cron cleanup.

| Column | Type | Description |
|---|---|---|
| id | UUID | Primary key |
| event_type | TEXT | Event identifier (e.g., `quiz_abandoned`, `page_error`) |
| student_id | UUID | Optional FK to students |
| category | TEXT | Event category for grouping |
| payload | JSONB | Event-specific data |
| session_id | TEXT | Browser session identifier |
| page_url | TEXT | Page where the event occurred |
| created_at | TIMESTAMPTZ | Event timestamp |

RLS: Authenticated users can INSERT. Admin-only SELECT.

### API Routes

All routes require admin session authentication via `authorizeAdmin()`. All mutations are logged to `admin_audit_log`.

| Route | Methods | Purpose |
|---|---|---|
| `/api/super-admin/improvement` | GET, POST, PATCH | CRUD for issues, recommendations, and executions. GET supports `?action=issues\|recommendations\|executions\|dashboard`. POST/PATCH use `?action=issue\|recommendation\|execution`. |
| `/api/super-admin/improvement/learning-quality` | GET | Learning quality monitors: quiz accuracy by subject, content coverage gaps, mastery progression trends, Bloom's taxonomy distribution. |
| `/api/super-admin/improvement/qa-gate` | POST | Triggers the QA gate (type-check, lint, test, build) for an execution. Body: `{ execution_id }`. Transitions execution through `testing` to `approved` or `failed`. |
| `/api/super-admin/improvement/staging` | GET, POST | Stage a recommendation for deployment. POST body: `{ execution_id }`. GET: `?execution_id=xxx`. Handles config_change, content_fix, code_patch, manual types differently. |
| `/api/super-admin/improvement/deploy` | GET, POST, PATCH | GET: list deployments. POST: deploy an approved execution (`{ execution_id, deploy_commit }`). PATCH: rollback a deployed execution (`{ execution_id, rollback_reason }`). |

### Feature Flags

All flags are stored in the `feature_flags` table and managed via the super-admin Feature Flags page (`/super-admin/flags`).

| Flag Name | Default | Purpose |
|---|---|---|
| `improvement_mode` | ON | Master toggle for the entire improvement system. When OFF, the Command Center is fully disabled. The operating mode (observe/suggest/controlled_act) is configured within the Command Center settings, not via this flag. |
| `improvement_auto_detect` | ON | Enables automated issue detection. Detectors run periodically and create issues in the `improvement_issues` table. |
| `improvement_recommendations` | ON | Enables recommendation generation for detected issues. When OFF, issues are created but no recommendations are proposed. |
| `improvement_auto_stage` | OFF | Enables auto-staging for low-risk recommendations in Controlled Act mode. When OFF, all recommendations require manual staging even in Controlled Act mode. |

### UI Entry Point

The Command Center page is at `/super-admin/command-center` (`src/app/super-admin/command-center/page.tsx`). It is accessible from the super-admin sidebar navigation.

---

## Mode Definitions

The improvement system operates in one of three modes. The mode determines how far the pipeline progresses without founder intervention.

### Observe

**Detection runs. Issues are created. Learning monitors are active. NO recommendations are generated. NO actions are taken.**

- Automated detectors (quiz quality, content gaps, engagement anomalies) run on schedule
- Detected issues appear in the Command Center Issues tab
- Learning quality monitors report metrics (quiz accuracy, mastery progression, Bloom's distribution)
- The founder reviews issues manually and decides next steps
- No recommendations are proposed by the system
- No executions are created
- Use this mode during initial deployment or when you want full manual control

### Suggest (DEFAULT)

**Detection runs. Recommendations are generated. All actions require manual founder approval.**

- Everything from Observe mode, plus:
- For each detected issue, the system generates one or more recommendations
- Recommendations appear in the Command Center Recommendations tab with impact, effort, and risk estimates
- The founder reviews each recommendation and clicks Approve or Reject
- Approved recommendations enter the execution pipeline only after explicit approval
- No automation beyond detection and recommendation generation
- This is the default mode and the recommended starting point

### Controlled Act

**Low-risk recommendations auto-stage after 24 hours if not rejected. Medium and high risk always require approval. High-risk domains are blocked from auto-actions.**

- Everything from Suggest mode, plus:
- Low-risk recommendations (risk_level = 'low') with execution types `config_change` or `content_fix` auto-stage after a 24-hour waiting period, unless the founder explicitly rejects them during that window
- Medium-risk recommendations always require manual approval
- High-risk recommendations always require manual approval
- The following domains are BLOCKED from any auto-action regardless of risk level:
  - Authentication and authorization changes
  - Payment flow changes
  - Database schema changes
  - Grading and scoring formula changes
- Requires explicit founder opt-in (cannot be enabled by other admin users)
- The `improvement_auto_stage` feature flag must also be ON for auto-staging to function

---

## Escalation Paths

### Critical Issue Detected

1. Automated detector or learning monitor identifies a critical-severity issue
2. Issue is created in `improvement_issues` with severity = `critical`
3. Command Center dashboard highlights the critical issue count
4. Founder reviews the issue in the Issues tab
5. If the issue affects production stability, founder can immediately toggle the relevant feature flag OFF via `/super-admin/flags`

### QA Gate Failure

1. An execution transitions to `testing` status when the QA gate is triggered
2. The QA gate runs type-check, lint, test suite, and production build
3. If any check fails, the execution status becomes `failed`
4. Detailed failure output is stored in `test_results` JSONB
5. Founder investigates the failure in the Pipeline tab
6. The parent recommendation remains in `executing` status for retry or alternative approach

### Post-Deploy Health Degradation

1. After deployment, the system enters a 15-minute monitoring window
2. If the health check endpoint (`/api/v1/health`) reports degraded status, the Command Center displays a warning
3. If Sentry error rate spikes above baseline, the Command Center displays an alert
4. Founder decides whether to rollback via the Pipeline tab
5. Rollback reverses the execution status and reopens the parent issue

### Learning Monitor Threshold Breach

1. Learning quality monitors run via `/api/super-admin/improvement/learning-quality`
2. If quiz accuracy drops below threshold, content coverage gaps widen, or mastery stagnation increases, the system detects the breach
3. An issue is auto-created in `improvement_issues` with category = `learning` or `quiz`
4. The issue appears in both the Learning tab and the Issues tab
5. Founder investigates by cross-referencing with the Learning Analytics page (`/super-admin/learning`)

---

## SLO Definitions

| Metric | Target | Measurement |
|---|---|---|
| Issue detection latency | < 1 hour from event to issue creation | Time between `product_events.created_at` for the triggering event and `improvement_issues.detected_at` |
| QA gate execution | < 10 minutes | Time from QA gate POST request to response. Includes type-check, lint, test suite, and build. |
| Staging deployment | < 5 minutes for config/content changes | Time from staging POST request to execution status reaching `staging`. Code patches are excluded (they require manual branch creation). |
| Post-deploy health check | 15-minute monitoring window | Duration of active health monitoring after a deploy POST completes. Alerts surface within this window if degradation occurs. |
| Command Center page load | < 3 seconds | Time to interactive for the `/super-admin/command-center` page, including dashboard data fetch. Measured on a standard broadband connection. |

---

## Audit Trail

Every mutation in the Command Center system is logged to `admin_audit_log` via `logAdminAudit()`. The following actions are recorded:

| Action | Description |
|---|---|
| `create_improvement_issue` | New issue created (manual or auto-detected) |
| `update_improvement_issue` | Issue status, severity, or assignment changed |
| `create_improvement_recommendation` | New recommendation proposed for an issue |
| `update_improvement_recommendation` | Recommendation approved, rejected, or status changed |
| `create_improvement_execution` | New execution created from an approved recommendation |
| `update_improvement_execution` | Execution status changed (staging, testing, etc.) |
| `stage_execution` | Execution moved to staging environment |
| `qa_gate_passed` | QA gate checks all passed |
| `qa_gate_failed` | One or more QA gate checks failed |
| `qa_gate_error` | QA gate encountered an internal error |
| `improvement_deployed` | Execution deployed to production |
| `improvement_rolled_back` | Deployed execution rolled back |

All audit entries include: admin email, IP address, entity type, entity ID, and a details JSONB payload with the specifics of the action.
