# Product Improvement Command Center -- Runbook

Last updated: 2026-04-04

Step-by-step procedures for operating the Product Improvement Command Center. All actions are performed through the Command Center UI at `/super-admin/command-center` unless otherwise noted.

---

## How to Triage a New Issue

1. Open the Command Center and navigate to the **Issues** tab.
2. Review the issue list. New issues appear at the top, sorted by `detected_at` descending.
3. Click on an issue row to open the detail drawer.
4. Review the issue fields:
   - **Title**: One-line summary of the problem.
   - **Description**: Detailed explanation of what was detected.
   - **Evidence**: JSON payload with supporting data (metrics, affected question IDs, page URLs, etc.).
   - **Source**: How the issue was created (`auto_detect`, `user_report`, `data_signal`, `manual`).
   - **Affected users**: Estimated count of impacted users.
5. Assess the severity:
   - **Critical**: Production is broken. Core user flow (login, quiz, payment) is non-functional.
   - **High**: Significant impact on a major user segment. Wrong answer keys, payment failures, major latency regression.
   - **Medium**: Affects some users or a secondary flow. Content gaps, moderate engagement drops, minor performance issues.
   - **Low**: Cosmetic issues, minor copy improvements, informational observations.
6. If the auto-assigned severity is incorrect, update it via the detail drawer.
7. Assign the issue to the appropriate agent (see `COMMAND_CENTER_AGENT_ROLES.md` for agent responsibilities):
   - UX/navigation problems: `product_ux`
   - Quiz accuracy, content, syllabus: `learning_intelligence`
   - Engagement anomalies, data signals: `data_feedback`
   - API latency, errors, infrastructure: `backend_infrastructure`
   - Compliance, audit: `audit_compliance`
8. Change the issue status to `investigating`.
9. If the issue is critical, consider immediate mitigation (feature flag toggle, Vercel rollback) before formal investigation.

---

## How to Approve or Reject a Recommendation

1. Open the Command Center and navigate to the **Recommendations** tab.
2. Recommendations are listed with their parent issue title, impact estimate, effort estimate, risk level, and current status.
3. Click on a recommendation row to open the detail drawer.
4. Review the following fields:
   - **Recommendation text**: Detailed description of the proposed fix.
   - **Impact estimate**: `high`, `medium`, or `low` -- expected benefit.
   - **Effort estimate**: `hours`, `days`, or `weeks` -- implementation time.
   - **Risk level**: `low`, `medium`, or `high` -- risk of the change causing problems.
   - **Affected files**: List of source files that would be changed.
   - **Agent owner**: Which agent proposed this recommendation.
5. For **low-risk** and **medium-risk** recommendations:
   - Verify the recommendation addresses the root cause of the parent issue.
   - Check that the affected files list is reasonable and does not include sensitive areas (auth, payments, grading).
   - Click **Approve** to move the recommendation to `approved` status and enter the execution pipeline.
6. For **high-risk** recommendations:
   - Verify that a mitigation plan exists in the recommendation text.
   - Review the affected files list carefully. High-risk changes touching authentication (`src/lib/admin-auth.ts`, `src/middleware.ts`), payments (`src/lib/razorpay.ts`, `src/app/api/payments/`), or grading (`src/lib/xp-rules.ts`, `src/lib/exam-engine.ts`) require extra scrutiny.
   - Consider whether the change requires architect review before approval.
   - Click **Approve** only after confirming all preconditions are met.
7. To **reject** a recommendation:
   - Click **Reject** in the detail drawer.
   - The recommendation is archived with status `rejected`.
   - The parent issue remains open for alternative approaches.
   - A new recommendation can be created for the same issue.

---

## How to Stage and Test a Fix

1. After a recommendation is approved, navigate to the **Pipeline** tab.
2. Create an execution for the approved recommendation:
   - Select the recommendation from the list.
   - Choose the execution type:
     - `config_change`: Feature flag toggle or configuration update.
     - `content_fix`: Question bank correction, topic metadata update.
     - `code_patch`: Source code change requiring a branch and PR.
     - `manual`: Requires human intervention outside the system.
   - The execution is created with status `pending`.
3. Click **Stage** on the pending execution:
   - For `config_change`: The system applies the configuration change via the Supabase admin client. The staging URL points to the current environment where the change can be verified.
   - For `content_fix`: The system applies the content update via the Supabase admin client. Verify the change in the CMS page or question bank.
   - For `code_patch`: The system cannot auto-apply code changes. It provides instructions:
     1. Create a feature branch from main.
     2. Implement the recommended code changes.
     3. Push and create a PR for review.
     4. Once the PR is deployed to a preview environment, update the execution with the staging URL.
   - For `manual`: The system marks the execution as staging and provides instructions for the manual action required.
4. The execution status moves to `staging`.
5. Review the staging URL in the Pipeline tab (if available) to verify the change.
6. When ready, click **Run QA Gate**:
   - The system runs type-check, lint, test suite, and production build.
   - Execution status transitions to `testing` during the gate run.
   - QA gate takes up to 10 minutes to complete.
   - If all checks pass: execution status becomes `approved`.
   - If any check fails: execution status becomes `failed`. Review `test_results` for details.
7. If the QA gate fails:
   - Open the execution detail drawer to see the failure output.
   - Identify whether the failure is related to the change or a pre-existing issue.
   - Fix the issue and retry staging, or reject the recommendation and propose an alternative.

---

## How to Deploy to Production

1. Navigate to the **Pipeline** tab and confirm the execution has status `approved`.
2. Verify the QA gate results show all checks passed:
   - Type check: passed
   - Lint: passed
   - Tests: passed (check test count matches expected)
   - Build: passed (check bundle sizes are within limits)
3. Click **Deploy**.
4. For code patches: provide the deploy commit hash in the dialog.
5. The system records the deployment:
   - Execution status becomes `deployed`.
   - `completed_at` timestamp is set.
   - `deploy_commit` is stored (if provided).
   - Parent recommendation status becomes `completed`.
   - Parent issue status becomes `resolved` with `resolved_at` timestamp.
6. The deployment is logged to `admin_audit_log` with action `improvement_deployed`.
7. Monitor the health check for 15 minutes post-deploy:
   - Watch the Command Center dashboard for health status changes.
   - Check `/api/v1/health` for system health.
   - Monitor Sentry for error rate spikes.
   - Check Vercel Analytics for latency changes.
8. If health remains stable after 15 minutes, the deployment is considered successful.

---

## How to Rollback a Bad Deploy

1. Open the Command Center and navigate to the **Pipeline** tab.
2. Find the deployed execution that needs to be rolled back.
3. Click **Rollback**.
4. Enter a rollback reason in the dialog (required). Be specific about what went wrong.
5. The system processes the rollback:
   - For `config_change`: The previous configuration value should be restored. Check the evidence JSONB for the prior state and restore it manually via the Feature Flags page or Supabase admin client.
   - For `content_fix`: Revert the content change via the CMS page or Supabase admin client. The original values are in the evidence JSONB.
   - For `code_patch`: Revert the commit (`git revert <commit>`), push, and trigger a redeploy via Vercel.
   - For `manual`: Reverse the manual action that was performed.
6. The system updates the records:
   - Execution status becomes `rolled_back`.
   - `rolled_back_at` timestamp is set.
   - `rollback_reason` is stored.
   - Parent recommendation status reverts to `approved` (available for retry or alternative approach).
   - Parent issue status reverts to `in_progress` with `resolved_at` cleared.
7. The rollback is logged to `admin_audit_log` with action `improvement_rolled_back`.
8. After rollback, assess whether to:
   - Retry with a modified approach (create a new execution for the same recommendation).
   - Reject the recommendation and propose an alternative.
   - Escalate to a different agent for investigation.

---

## How to Investigate a Learning Quality Alert

1. Open the Command Center and navigate to the **Learning** tab.
2. Review the learning quality monitor results:
   - **Quiz accuracy**: Overall average and per-subject breakdown. Look for subjects with average scores significantly below or above the expected range.
   - **Content coverage**: Percentage of CBSE topics with questions. Review the gaps list for missing topics.
   - **Mastery progression**: Counts of students improving, stagnant, and declining. High stagnation counts warrant investigation.
   - **Bloom's distribution**: Question count by Bloom's level. Severe skew toward a single level indicates a content quality issue.
3. Click on a breached monitor to see details.
4. Cross-reference with the **Issues** tab. Auto-created issues from learning monitors will have source = `auto_detect` and category = `learning` or `quiz`.
5. Common investigations:

### Syllabus Drift

- Go to the content coverage section of the Learning tab.
- Review the gaps list for topics that appear in `chapter_topics` but have no questions in `question_bank`.
- Check if the topic was recently added to the curriculum but questions have not been created yet.
- Cross-reference with the CMS page (`/super-admin/cms`) to see if questions are in draft status.
- Resolution: Create questions for the missing topics via the CMS, or flag the topic for assessment agent review.

### Answer Key Mismatch

- Identify the flagged questions from the issue evidence (question IDs and wrong-answer rates).
- Open the CMS page and search for the flagged questions.
- Review the correct answer index, options, and explanation.
- Verify against the NCERT textbook or CBSE curriculum source material.
- If the answer key is wrong: fix it in the CMS and create a content_fix execution to update the question bank.
- If the question is ambiguous: rewrite the question and options for clarity.

### Mastery Stagnation

- Review the mastery progression counts in the Learning tab.
- Check which student cohorts are stagnant (filter by grade and subject if available).
- Cross-reference with quiz completion rates: are stagnant students simply not taking quizzes?
- Check if the adaptive difficulty is working correctly: are students being served questions matched to their level?
- Resolution may involve: adjusting difficulty calibration, creating additional practice questions at lower difficulty, or investigating whether the mastery algorithm thresholds need adjustment (requires assessment agent sign-off).

### XP Inflation

- Check the XP velocity metrics for anomalous patterns.
- Look for students earning XP at rates significantly above the theoretical maximum (daily cap: 200 XP).
- Cross-reference with anti-cheat checks (P3): minimum 3s per question, varied answer patterns, response count matching question count.
- If exploit patterns are found: escalate to the architect and assessment agents immediately.
- Resolution requires assessment agent ownership (XP economy is P2).

---

## How to Change the Improvement Mode

1. Open the Command Center and navigate to the **Settings** tab (or the mode selector in the dashboard).
2. The current mode is displayed: Observe, Suggest, or Controlled Act.
3. Select the desired mode:
   - **Observe**: Detection only. No recommendations generated. Safest option.
   - **Suggest**: Detection plus recommendations. All actions require manual approval. Default and recommended.
   - **Controlled Act**: Low-risk auto-staging enabled. Requires explicit opt-in.
4. The mode change takes effect immediately.
5. The change is logged to `admin_audit_log`.
6. Important constraints:
   - **Controlled Act** mode cannot be set by non-founder admin users. It requires explicit founder opt-in.
   - Switching from Controlled Act to a lower mode (Suggest or Observe) takes effect immediately and stops all auto-staging.
   - Switching to Controlled Act also requires the `improvement_auto_stage` feature flag to be ON for auto-staging to function.
7. After changing the mode, verify the expected behavior:
   - In Observe: check that the Recommendations tab is empty or not generating new entries.
   - In Suggest: check that recommendations are being generated but not auto-staged.
   - In Controlled Act: check that low-risk config/content recommendations show a 24-hour auto-stage countdown.

---

## Emergency Procedures

When something goes wrong, use these procedures to quickly contain the situation. Each step is independent and can be taken in any order depending on the severity.

### 1. Disable the Entire Improvement System

- Navigate to `/super-admin/flags` (Feature Flags page).
- Find the `improvement_mode` flag.
- Toggle it to **OFF**.
- Effect: The entire Command Center system is disabled. No detection, no recommendations, no executions. Existing in-progress executions are frozen but not rolled back.
- Use when: The improvement system itself is causing problems (runaway issue creation, incorrect auto-actions).

### 2. Stop Automated Detection

- Navigate to `/super-admin/flags`.
- Find the `improvement_auto_detect` flag.
- Toggle it to **OFF**.
- Effect: Automated detectors stop running. No new auto-detected issues are created. Manual issue creation still works. Existing issues and recommendations are unaffected.
- Use when: Detectors are creating false positive issues or overloading the system.

### 3. Stop Recommendation Generation

- Navigate to `/super-admin/flags`.
- Find the `improvement_recommendations` flag.
- Toggle it to **OFF**.
- Effect: No new recommendations are generated for detected issues. Issues continue to be created (if auto-detect is on). Existing recommendations are unaffected.
- Use when: Recommendations are incorrect or inappropriate.

### 4. Stop Auto-Staging (Controlled Act Safety Valve)

- Navigate to `/super-admin/flags`.
- Find the `improvement_auto_stage` flag.
- Toggle it to **OFF**.
- Effect: Auto-staging for low-risk recommendations stops immediately. All recommendations revert to requiring manual approval. This is the safety valve for Controlled Act mode.
- Use when: Auto-staged changes are causing problems, or you want to temporarily pause Controlled Act automation without changing the mode.

### 5. Manual Override of Any Execution

- Navigate to the **Pipeline** tab in the Command Center.
- Find the execution you want to override.
- Use the PATCH API directly if the UI does not support the desired status transition:
  ```
  PATCH /api/super-admin/improvement?action=execution
  Body: { "id": "<execution_id>", "updates": { "status": "failed" } }
  ```
- Valid manual override statuses: `failed`, `rolled_back`.
- For `rolled_back`, also provide `rollback_reason` in the updates.
- Use when: An execution is stuck in an intermediate state, or needs to be forcefully terminated.

### 6. Data Preservation Guarantee

- All actions in the Command Center are logged to `admin_audit_log`.
- No issue, recommendation, or execution is ever hard-deleted through the UI or API.
- Status transitions preserve the full history in the audit log.
- Even during emergency flag toggles, no data is lost.
- If you need to understand what happened: query `admin_audit_log` filtered by `entity_type IN ('improvement_issue', 'improvement_recommendation', 'improvement_execution')`.
- The Logs page (`/super-admin/logs`) provides a searchable interface over the audit log.

### Recovery After Emergency

After using emergency procedures, follow these steps to resume normal operations:

1. Investigate the root cause using the audit log and issue evidence.
2. Fix the underlying problem (false positive detector, incorrect recommendation logic, etc.).
3. Re-enable feature flags one at a time, starting with `improvement_mode`.
4. Monitor the Command Center dashboard for 30 minutes after re-enabling.
5. If operating in Controlled Act mode, re-enable `improvement_auto_stage` last, after confirming all other components are functioning correctly.
