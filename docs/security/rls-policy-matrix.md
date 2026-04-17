# RLS Policy Matrix

Last verified: 2026-04-02
Source: 265 migration files in `supabase/migrations/`, 440+ `CREATE POLICY` statements across 265 files

## Overview

Alfanumrik uses Supabase Postgres Row Level Security (RLS) as the primary data access boundary. RLS is enabled on all tables. The policy count referenced in the codebase is "440+ policies" -- the actual count from migration files is approximately 440+ `CREATE POLICY` statements (some are DROP + re-CREATE for the same policy name).

Product invariant P8 states: "Client code never bypasses RLS. `supabase-admin.ts` is server-only. Every new table gets RLS + policies in the same migration."

## Tables with RLS Enabled

### Core User Tables (from `000_core_schema.sql`)
| Table | RLS Enabled | Policy Pattern |
|-------|------------|----------------|
| `schools` | Yes | Public read for authenticated users; admin write |
| `students` | Yes | Own data via `auth_user_id`; guardian linked; teacher assigned |
| `teachers` | Yes | Own data via `auth_user_id`; admin access |
| `guardians` | Yes | Own data via `auth_user_id` |
| `guardian_student_links` | Yes | Own guardian record; linked student |
| `classes` | Yes | Teacher assigned; admin access |
| `class_students` | Yes | Student own; teacher assigned |
| `class_teachers` | Yes | Teacher own; admin access |
| `subjects` | Yes | Public read for authenticated users |

### Learning Data Tables (from `000_core_schema.sql`)
| Table | RLS Enabled | Policy Pattern |
|-------|------------|----------------|
| `student_learning_profiles` | Yes | Own `student_id`; guardian linked; teacher assigned |
| `concept_mastery` | Yes | Own; guardian linked; teacher assigned |
| `topic_mastery` | Yes | Own; guardian linked; teacher assigned |
| `chat_sessions` | Yes | Own `student_id` |
| `question_bank` | Yes | Public read for all authenticated users |
| `quiz_sessions` | Yes | Own; guardian linked; teacher assigned |
| `quiz_responses` | Yes | Own via quiz_session |
| `study_plans` | Yes | Own; guardian linked; teacher assigned |
| `study_plan_tasks` | Yes | Via study_plan ownership |
| `spaced_repetition_cards` | Yes | Own; guardian linked; teacher assigned |
| `daily_activity` | Yes | Own |
| `student_simulation_progress` | Yes | Own; guardian linked; teacher assigned |
| `notifications` | Yes | Own `auth_user_id` |
| `competitions` | Yes | Public read |
| `competition_participants` | Yes | Own |
| `classroom_poll_responses` | Yes | Own student; teacher of class |

### Cognitive Engine Tables (from `alfanumrik_v2_cognitive_learning_system_corrected.sql`)
| Table | RLS Enabled | Policy Pattern |
|-------|------------|----------------|
| `bloom_progression` | Yes | Own `student_id` |
| `cognitive_session_metrics` | Yes | Own |
| `learning_velocity` | Yes | Own |
| `knowledge_gaps` | Yes | Own |
| `question_responses` | Yes | Own |
| `cbse_board_papers` | Yes | Public read |

### Exam and Assessment Tables (from `exam_centric_personalization_engine.sql`)
| Table | RLS Enabled | Policy Pattern |
|-------|------------|----------------|
| `exam_configs` | Yes | Own student |
| `exam_chapters` | Yes | Via exam_config ownership |
| `image_uploads` | Yes | Own student; teacher assigned |
| `monthly_reports` | Yes | Own; guardian linked |
| `smart_nudges` | Yes | Own student |
| `exam_simulations` | Yes | Own student |
| `learner_clusters` | Yes | Service role only |
| `student_cluster_assignments` | Yes | Own student |

### RBAC System Tables (from `production_rbac_system.sql`)
| Table | RLS Enabled | Policy Pattern |
|-------|------------|----------------|
| `permissions` | Yes | Service role read; authenticated read |
| `roles` | Yes | Service role read; authenticated read |
| `role_permissions` | Yes | Service role read; authenticated read |
| `user_roles` | Yes | Own `auth_user_id` read; service role write |
| `audit_logs` | Yes | Service role only (read + write) |
| `resource_access_rules` | Yes | Authenticated read |
| `api_keys` | Yes | Service role only |
| `admin_users` | Yes | Service role; own read |

### Platform Operations Tables (from `platform_ops_tables.sql`)
| Table | RLS Enabled | Policy Pattern |
|-------|------------|----------------|
| `deployment_history` | Yes | Service role only |
| `backup_status` | Yes | Service role only |
| `cms_assets` | Yes | Service role for write; authenticated read |

### AI and Content Tables
| Table | RLS Enabled | Policy Pattern |
|-------|------------|----------------|
| `ai_tutor_logs` | Yes | Own student |
| `student_daily_usage` | Yes | Own student |
| `teacher_student_notes` | Yes | Teacher own; student read own |
| `cms_item_versions` | Yes | Service role write; authenticated read |
| `solver_results` | Yes | Own student |
| `solver_accuracy` | Yes | Service role only |
| `ncert_formulas` | Yes | Public read |
| `cbse_syllabus_graph` | Yes | Public read |
| `content_media` | Yes | Authenticated read; service role write |
| `student_scans` | Yes | Own student |
| `foxy_scan_queries` | Yes | Own student |

### Identity and Billing Tables
| Table | RLS Enabled | Policy Pattern |
|-------|------------|----------------|
| `user_active_sessions` | Yes | Own `auth_user_id` |
| `identity_events` | Yes | Service role only |
| `subscription_events` | Yes | Service role only |
| `parent_login_attempts` | Yes | Service role only |

### Other Tables
| Table | RLS Enabled | Policy Pattern |
|-------|------------|----------------|
| `task_queue` | Yes | Service role only |
| `app_config` | Yes | Authenticated read; service role write |
| `cme_concept_state` | Yes | Own student |
| `cme_revision_schedule` | Yes | Own student |
| `cme_error_log` | Yes | Service role only |
| `cme_exam_readiness` | Yes | Own student |
| `cme_action_log` | Yes | Service role only |
| `experiment_observations` | Yes | Own student |

## Common Policy Patterns

### 1. Student Own Data
```sql
CREATE POLICY "table_select_own" ON table_name
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );
```

### 2. Guardian Linked Access
```sql
CREATE POLICY "table_select_guardian" ON table_name
  FOR SELECT USING (is_guardian_of(student_id));
```
Uses the `is_guardian_of()` function which checks `guardian_student_links` for an approved link.

### 3. Teacher Assigned Access
```sql
CREATE POLICY "table_select_teacher" ON table_name
  FOR SELECT USING (is_teacher_of(student_id));
```
Uses the `is_teacher_of()` function which checks class assignment via `class_students` and `class_teachers`.

### 4. Service Role Only
```sql
CREATE POLICY "table_service_role" ON table_name
  FOR ALL USING (auth.role() = 'service_role');
```
Used for system tables (audit_logs, task_queue, deployment_history, etc.).

### 5. Public Read
```sql
CREATE POLICY "table_select_all" ON table_name
  FOR SELECT USING (auth.role() = 'authenticated');
```
Used for reference data (question_bank, subjects, competitions, cbse_board_papers).

## Helper Functions

| Function | Purpose |
|----------|---------|
| `is_guardian_of(student_id)` | Returns true if `auth.uid()` is a guardian linked to the student |
| `is_teacher_of(student_id)` | Returns true if `auth.uid()` is a teacher assigned to a class containing the student |
| `get_user_role()` | Returns the role name for `auth.uid()` |
| `check_resource_access(resource_type, resource_id)` | General-purpose access check using `resource_access_rules` table |

## Known Gaps and Aspirational Items

| Gap | Description | Risk |
|-----|-------------|------|
| Demo account isolation | No RLS policies differentiate demo from production accounts | Low -- demo accounts are few and admin-created |
| Curriculum content tables | Some curriculum tables (`curriculum_topics`, `chapters`) may rely on public read without granular per-school scoping | Low -- content is shared across all users |
| `admin_audit_log` vs `audit_logs` | Two audit log tables exist (`audit_logs` for RBAC, `admin_audit_log` for admin panel). Both have RLS but use different access patterns | Medium -- consolidation would simplify |
| Cross-institution isolation | No RLS policies scope data by `school_id` for institution-level isolation | Medium -- relevant when multiple schools use the platform |

## Service Role Usage

The `supabase-admin.ts` client uses the `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS. It is only imported in:
- Server-side API routes
- Edge Functions
- Never in client components (enforced by P8)

Super admin API routes use `supabaseAdminHeaders()` from `admin-auth.ts` which passes the service role key directly in fetch headers.
