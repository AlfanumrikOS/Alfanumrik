# Product Improvement Command Center -- Agent Roles

Last updated: 2026-04-04

This document defines the responsibilities, trigger conditions, output format, and escalation rules for each agent that operates within the Product Improvement Command Center.

---

## Product and UX Agent

### Responsibilities

- Detect and report UX friction points across the student, parent, and teacher portals
- Identify navigation problems, confusing flows, and accessibility issues
- Propose copy improvements, layout changes, and onboarding flow fixes
- Monitor bounce rates and session abandonment patterns

### Trigger Conditions

- High bounce rate on a specific page (above 60% within a 7-day window)
- Onboarding funnel drop-off exceeds 40% at any step
- User reports related to "confusing" or "cannot find" themes in support tickets
- Accessibility audit failures (missing alt text, insufficient contrast, keyboard navigation gaps)
- Session recordings or heatmap data indicating dead clicks or rage clicks

### Output Format

Issues created by this agent use the following conventions:

- **Category**: `onboarding` or `ux`
- **Severity guidelines**:
  - critical: Core flow completely broken (cannot start quiz, cannot log in)
  - high: Major flow disrupted for a significant user segment
  - medium: Friction in secondary flows, affects some users
  - low: Cosmetic issues, minor copy improvements
- **Evidence JSONB**: Should include `{ bounce_rate, page_url, affected_users_count, session_sample_ids }`
- **Assigned agent**: `product_ux`

### Escalation Rules

- Critical UX issues that prevent core user actions (login, quiz start, payment) escalate immediately to the founder
- If a UX issue reveals a backend or data problem (broken API, missing data), reassign to the appropriate agent and add a cross-reference note
- Onboarding issues that affect new user activation rates above 20% drop escalate to founder within 24 hours

---

## Learning Intelligence Agent

### Responsibilities

- Monitor academic accuracy of the question bank and quiz system
- Detect syllabus alignment drift (questions referencing topics not in the CBSE curriculum)
- Identify answer key errors flagged by high wrong-answer rates
- Track Bloom's taxonomy distribution to ensure balanced cognitive rigor
- Monitor mastery stagnation patterns across student cohorts

### Trigger Conditions

- Question wrong-answer rate exceeds 70% with at least 10 attempts (possible answer key error)
- Content coverage drops below 80% for any active subject-grade combination
- Bloom's taxonomy distribution skews more than 60% toward a single level (typically Remember)
- Mastery stagnation: more than 30% of active students show no mastery progression over 14 days
- Syllabus drift: questions reference topics not present in the `chapter_topics` table
- Quiz difficulty calibration: average score for a difficulty level deviates more than 15 points from the expected range

### Learning Monitors

The following monitors run via `/api/super-admin/improvement/learning-quality`:

| Monitor | Data Source | Threshold |
|---|---|---|
| `syllabus_drift` | `question_bank` vs `chapter_topics` | Any orphaned topic reference triggers a medium-severity issue |
| `answer_key_accuracy` | `quiz_responses` aggregated by `question_id` | Wrong rate > 70% with >= 10 attempts triggers a high-severity issue |
| `quiz_difficulty` | `quiz_sessions.score_percent` grouped by difficulty | Avg score deviation > 15 points from expected range |
| `mastery_stagnation` | `concept_mastery` records not updated in 14+ days | > 30% of active students stagnant triggers a medium-severity issue |

### Output Format

- **Category**: `learning` or `quiz`
- **Severity guidelines**:
  - critical: Wrong answer key on a high-frequency question (affecting grading accuracy, P1 violation)
  - high: Significant content gap in a major subject, or Bloom's distribution severely skewed
  - medium: Mastery stagnation in a student cohort, minor content gaps
  - low: Bloom's distribution slightly unbalanced, minor syllabus alignment issues
- **Evidence JSONB**: Should include `{ question_ids, subject, grade, metric_name, current_value, threshold, student_count }`
- **Assigned agent**: `learning_intelligence`

### Escalation Rules

- Answer key errors affecting grading accuracy (P1) are critical and escalate immediately to the founder and the assessment agent
- Content gaps in exam-critical subjects (Mathematics, Science for grades 10 and 12) escalate as high severity
- Mastery stagnation issues require assessment agent sign-off before any recommendation is generated (assessment owns learner metric definitions)
- Any issue that could affect the score formula (P1) or XP economy (P2) must be reviewed by the assessment agent before action

---

## Data and Feedback Agent

### Responsibilities

- Process raw signals from product events, usage patterns, and user feedback
- Detect engagement anomalies and usage pattern shifts
- Identify drop-off points in user journeys
- Gather evidence for issues detected by other agents
- Correlate multiple weak signals into actionable issues

### Trigger Conditions

- Daily active users drop more than 20% compared to the 7-day rolling average
- Quiz completion rate drops below 60% for any grade-subject combination
- Session duration anomaly: average session length changes by more than 30% week-over-week
- Support ticket volume spikes more than 3x above the 30-day average
- Payment failure rate exceeds 5% of attempted transactions
- Feature usage drops to zero for a previously active feature

### Output Format

- **Category**: `performance` or `admin`
- **Severity guidelines**:
  - critical: Platform-wide engagement collapse (DAU drops > 50%)
  - high: Significant engagement drop in a major segment, payment failure spike
  - medium: Moderate engagement anomaly, localized drop-off
  - low: Minor usage pattern shift, informational signal
- **Evidence JSONB**: Should include `{ metric_name, current_value, baseline_value, change_percent, time_window, affected_segment }`
- **Assigned agent**: `data_feedback`

### Escalation Rules

- Platform-wide engagement drops escalate immediately to the founder
- Payment failure spikes escalate to the backend agent and architect for investigation
- If a data signal correlates with a recent deployment, flag the deployment in the evidence and notify the ops agent
- Engagement anomalies in exam periods (board exam months: February, March, October, November) should be contextualized before escalation, as they may reflect normal seasonal patterns

---

## Backend and Infrastructure Agent

### Responsibilities

- Monitor API performance, error rates, and database health
- Detect latency regressions, timeout patterns, and resource exhaustion
- Identify data integrity issues (orphaned records, constraint violations)
- Propose performance optimizations and infrastructure fixes

### Trigger Conditions

- API endpoint p95 latency exceeds 2 seconds
- Error rate for any API route exceeds 1% of requests over a 1-hour window
- Database connection pool utilization exceeds 80%
- Supabase Edge Function cold start time exceeds 3 seconds
- Task queue failed jobs exceed 10 (matches existing health check threshold)
- Memory or CPU usage anomaly on Vercel functions
- Webhook processing failures (Razorpay, email)

### Output Format

- **Category**: `performance` or `payment`
- **Severity guidelines**:
  - critical: API completely down, database unreachable, payment processing halted
  - high: Major API latency regression affecting user experience, data integrity violation
  - medium: Moderate latency increase, elevated error rate, queue backlog
  - low: Minor performance optimization opportunity, non-critical timeout
- **Evidence JSONB**: Should include `{ endpoint, p95_latency_ms, error_rate, error_sample, time_window, affected_users_count }`
- **Assigned agent**: `backend_infrastructure`

### Escalation Rules

- Complete API outage or database unreachability escalates immediately to the founder and architect
- Payment processing failures escalate immediately to the founder and backend agent
- Data integrity violations that affect student records or scores escalate to the assessment agent (P1 concern)
- Infrastructure issues that could cause data loss escalate to the architect immediately

---

## QA and Testing Agent

### Responsibilities

- Run QA gate validation before any execution is deployed
- Prevent regressions by ensuring all tests pass
- Validate that type-check, lint, test suite, and production build all succeed
- Report test coverage gaps relevant to the change being deployed

### Gate Checks

The QA gate runs four sequential checks via `src/lib/improvement-qa-gate.ts`:

| Check | Command | Pass Condition |
|---|---|---|
| Type check | `npm run type-check` | Exit code 0 |
| Lint | `npm run lint` | Exit code 0 |
| Tests | `npm test` | All tests pass |
| Build | `npm run build` | Exit code 0, bundle within limits |

Bundle size limits (from release gates):
- Shared JS: < 160 kB
- Individual page: < 260 kB
- Middleware: < 120 kB

### Output Format

QA gate results are stored in `improvement_executions.test_results` as JSONB:

```json
{
  "passed": true,
  "type_check": { "passed": true, "output": "...", "duration_ms": 12000 },
  "lint": { "passed": true, "output": "...", "duration_ms": 5000 },
  "tests": { "passed": true, "total": 175, "passed_count": 175, "failed_count": 0, "output": "...", "duration_ms": 30000 },
  "build": { "passed": true, "output": "...", "duration_ms": 45000 },
  "bundle_size": { "passed": true, "details": "..." },
  "ran_at": "2026-04-04T10:00:00Z"
}
```

### Escalation Rules

- QA gate failure blocks the execution from advancing to `approved` status -- no exceptions
- If tests fail due to a flaky test (not related to the change), the QA agent flags it as a separate issue rather than bypassing the gate
- If the build fails due to bundle size limits, the execution is failed and a recommendation for bundle optimization is suggested
- Repeated QA gate failures on the same execution (3+ attempts) escalate to the founder for manual review

---

## Deployment and DevOps Agent

### Responsibilities

- Manage the staging, deployment, and rollback lifecycle for executions
- Handle different execution types appropriately (config_change, content_fix, code_patch, manual)
- Monitor post-deploy health during the 15-minute observation window
- Execute rollbacks when health degrades

### Execution Type Handling

| Type | Staging Behavior | Deploy Behavior |
|---|---|---|
| `config_change` | Feature flag toggle or config update via Supabase admin client | Applied immediately, verified via health check |
| `content_fix` | Content metadata update via Supabase admin client | Applied immediately, verified via content validation |
| `code_patch` | Manual branch creation required. Agent provides instructions. | Git commit recorded, Vercel deployment triggered |
| `manual` | Manual action required. Agent provides instructions. | Founder confirms completion manually |

### Output Format

Deployment records include:
- `deploy_commit`: Git commit hash (for code_patch type)
- `staging_url`: Vercel preview URL or production URL
- `completed_at`: Timestamp of successful deployment
- `rolled_back_at`: Timestamp if rollback occurred
- `rollback_reason`: Free-text explanation

### Escalation Rules

- Failed deployments that cannot be retried escalate to the founder
- Post-deploy health degradation detected within the 15-minute window triggers an immediate alert
- Rollback of a payment-related change requires founder confirmation before execution
- Any deployment affecting authentication or authorization requires architect review before proceeding

---

## Audit and Compliance Agent

### Responsibilities

- Maintain audit trail integrity for all Command Center actions
- Detect unauthorized or anomalous admin actions
- Monitor RLS policy compliance
- Ensure all mutations are properly logged to `admin_audit_log`

### Trigger Conditions

- Admin action performed outside normal operating hours (configurable)
- Bulk status changes on issues or recommendations (more than 10 in a 5-minute window)
- Execution deployed without a preceding QA gate pass
- Direct database modification detected (bypassing the API layer)
- Admin user accessing data outside their usual patterns
- Audit log gaps (expected entries missing)

### Output Format

- **Category**: `admin`
- **Severity guidelines**:
  - critical: Evidence of unauthorized access or data tampering
  - high: Audit log gap, execution deployed without QA gate
  - medium: Unusual access pattern, bulk operations outside normal workflow
  - low: Minor compliance observation, informational
- **Evidence JSONB**: Should include `{ admin_email, action, entity_type, entity_id, timestamp, anomaly_type, baseline_pattern }`
- **Assigned agent**: `audit_compliance`

### Escalation Rules

- Unauthorized access patterns escalate immediately to the architect and founder (per rejection conditions in ops agent rules)
- Audit log gaps or missing entries escalate to the architect for investigation
- Any evidence of RLS bypass escalates immediately to the architect
- Compliance issues that could affect student data privacy (P13) escalate to the architect and founder
