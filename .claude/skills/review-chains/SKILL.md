---
name: review-chains
description: Mandatory downstream review requirements by change type. Used by orchestrator to validate Gate 5 and by quality to reject incomplete reviews.
user-invocable: false
---

# Skill: Review Chains

When a critical file is modified, specific downstream agents MUST review before the task can be marked complete. The PostToolUse hook (`review-chain.sh`) injects reminders automatically. This skill defines the complete matrix for orchestrator validation and quality enforcement.

## Review Chain Matrix

### 1. Grading Logic Changes
**Trigger files**: `src/lib/xp-rules.ts`, `src/lib/exam-engine.ts`, score formula in `src/lib/supabase.ts`
**Making agent**: assessment
| Reviewer | What They Check |
|---|---|
| testing | Update XP calculation assertions, score rounding tests, daily cap tests |
| ai-engineer | cme-engine mastery thresholds still reference correct XP_RULES values |
| frontend | QuizResults.tsx, ProgressSnapshot.tsx use submission response values not recalculated |
| backend | `atomic_quiz_profile_update()` RPC level formula `FLOOR(xp/500)+1` matches XP_PER_LEVEL |

### 2. XP / Mastery Constant Changes
**Trigger files**: `src/lib/xp-rules.ts` (XP_RULES, XP_PER_LEVEL, LEVEL_NAMES, XP_REWARDS)
**Making agent**: assessment
| Reviewer | What They Check |
|---|---|
| testing | All XP assertion values updated to match new constants |
| ai-engineer | cme-engine references correct mastery thresholds |
| backend | Postgres RPC `atomic_quiz_profile_update` level formula in sync |
| frontend | Level names displayed via `LEVEL_NAMES` constant, not hardcoded |

### 3. Learner-State Rule Changes
**Trigger files**: `src/lib/cognitive-engine.ts`, `src/lib/feedback-engine.ts`
**Making agent**: assessment
| Reviewer | What They Check |
|---|---|
| ai-engineer | cme-engine implements updated ZPD/fatigue/Bloom rules |
| frontend | Progress page renders updated metrics correctly |
| testing | Cognitive threshold tests updated |

### 4. LLM / AI Tutor Behavior Changes
**Trigger files**: `supabase/functions/foxy-tutor/`, `supabase/functions/ncert-solver/`
**Making agent**: ai-engineer
| Reviewer | What They Check |
|---|---|
| assessment | Responses stay within CBSE curriculum scope, age-appropriate for grades 6-12 |
| testing | AI regression tests updated |

### 5. RAG / Retrieval Changes
**Trigger files**: RAG retrieval code in AI functions, `supabase/functions/_shared/`
**Making agent**: ai-engineer
| Reviewer | What They Check |
|---|---|
| assessment | Retrieval returns correct NCERT content for grade/subject, no cross-grade leakage |
| testing | RAG retrieval tests updated |

### 6. Quiz Generation Changes
**Trigger files**: `supabase/functions/quiz-generator/`
**Making agent**: ai-engineer
| Reviewer | What They Check |
|---|---|
| assessment | Difficulty/Bloom distribution matches exam preset targets in exam-engine.ts |
| testing | Question selection tests updated |

### 7. RBAC / Auth Changes
**Trigger files**: `src/lib/rbac.ts`, `src/middleware.ts`, `src/lib/admin-auth.ts`, role/permission migrations
**Making agent**: architect
| Reviewer | What They Check |
|---|---|
| backend | API routes use correct new/updated permission codes in `authorizeRequest()` |
| frontend | `usePermissions()` UI gating reflects new permissions |
| ops | Admin panel access patterns unbroken |
| testing | RBAC regression tests updated for new roles/permissions |

### 8. Payment Flow Changes
**Trigger files**: `src/lib/razorpay.ts`, `src/app/api/payments/*`
**Making agent**: backend
| Reviewer | What They Check |
|---|---|
| architect | Webhook signature verification still intact (P11) |
| testing | Payment regression tests updated |

### 9. Reporting Schema Changes
**Trigger files**: `src/app/api/super-admin/analytics/`, `stats/`, `reports/`
**Making agent**: ops
| Reviewer | What They Check |
|---|---|
| frontend | Super-admin dashboard pages render updated data shapes |
| architect | DB schema supports new reporting queries (if needed) |

### 10. Deployment Config Changes
**Trigger files**: `vercel.json`, `.github/workflows/*`, `next.config.js`
**Making agent**: architect
| Reviewer | What They Check |
|---|---|
| ops | Operational runbooks in docs/ match updated procedures |
| testing | CI pipeline still passes, no test infrastructure broken |

### 11. Anti-Cheat Threshold Changes
**Trigger files**: `src/app/quiz/page.tsx` (client checks), server-side verification migration
**Making agent**: assessment (rules) + architect (migration)
| Reviewer | What They Check |
|---|---|
| backend | Server-side `server_side_quiz_verification` thresholds match client-side |
| testing | Anti-cheat regression tests updated with new thresholds |

### 12. Notification Type Changes
**Trigger files**: `supabase/functions/daily-cron/`, notification type constants
**Making agent**: backend
| Reviewer | What They Check |
|---|---|
| frontend | Notification list page can render new types |
| ops | Monitoring covers new notification types |

## Orchestrator Validation Protocol

At Gate 5, the orchestrator must:

1. List all files modified in the task
2. For each file, check the matrix above for required reviewers
3. Verify each required reviewer was actually invoked and produced an output
4. If any required reviewer is missing → FAIL Gate 5, list missing reviews as blockers

**Gate 5 status format**:
```
### Gate 5: Review Chain Validation
Files modified: [list]
Review chains triggered:
  - [chain name]: [reviewer1] ✓ | [reviewer2] ✗ MISSING
Status: PASS (all chains complete) | FAIL (missing: [list])
```

## Quality Verification

Quality agent must check at final review:
- Did the orchestrator's status report include Gate 5 results?
- Are all review chains marked complete?
- If any chain is incomplete → REJECT with reason: "Review chain incomplete: [chain name] missing [reviewer]"

## What Counts as a Completed Review

A review is complete when the downstream agent:
1. Was invoked (spawned by orchestrator or called via handoff)
2. Read the changed files
3. Produced structured output in their agent format (e.g., "Assessment Review: ...")
4. Gave a verdict: APPROVE, APPROVE WITH CONDITIONS, or REJECT

A review is NOT complete if:
- The agent was never invoked
- The agent was invoked but did not read the changed files
- The agent produced no structured output
- The agent's verdict was REJECT and the issue was not addressed
