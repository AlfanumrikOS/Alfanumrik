# Database Schema Reference

Last updated: 2026-04-02

## Overview

Alfanumrik uses Supabase Postgres with 82 total tables across 196 migrations.
The database includes 142+ RPCs and 212+ indexes. Row Level Security (RLS) is
enabled on all tables.

This document covers the 25 foundational tables defined in the core schema
migration (`supabase/migrations/_legacy/000_core_schema.sql`). Later migrations
add admin, payment, CMS, feature flag, and operational tables.

## Core Schema Tables (000_core_schema.sql)

### Identity and Access

| # | Table | Key Columns | Purpose |
|---|---|---|---|
| 1 | `schools` | id, name, code, board, city, state, is_active | School directory (CBSE default) |
| 2 | `students` | id, auth_user_id, name, grade (TEXT), board, subscription_plan, xp_total, school_id | Primary learner record |
| 3 | `teachers` | id, auth_user_id, name, email, subjects_taught, grades_taught, school_id | Educator record |
| 4 | `guardians` | id, auth_user_id, name, relationship, daily_report_enabled | Parent/guardian record |
| 5 | `guardian_student_links` | guardian_id, student_id, permission_level, status, is_verified | Parent-student mapping with approval workflow |

### Classroom Structure

| # | Table | Key Columns | Purpose |
|---|---|---|---|
| 6 | `classes` | id, school_id, grade (TEXT), section, subject, class_code | Class/section within a school |
| 7 | `class_students` | class_id, student_id, roll_number, is_active | Student enrollment in classes |
| 8 | `class_teachers` | class_id, teacher_id, role | Teacher assignment to classes |

### Curriculum and Content

| # | Table | Key Columns | Purpose |
|---|---|---|---|
| 9 | `subjects` | id, code (UNIQUE), name, name_hi, display_order | Subject catalog with Hindi translations |
| 14 | `question_bank` | id, subject, grade, topic, question_text, options (JSONB), correct_answer_index, explanation, difficulty, bloom_level | MCQ question pool for quizzes |

### Learning Progress

| # | Table | Key Columns | Purpose |
|---|---|---|---|
| 10 | `student_learning_profiles` | student_id, subject (UNIQUE pair), xp, level, streak_days, total_sessions | Per-subject learner state |
| 11 | `concept_mastery` | student_id, topic_id (UNIQUE pair), mastery_probability, p_know/p_learn/p_guess/p_slip | BKT + SM2 spaced repetition parameters |
| 12 | `topic_mastery` | student_id, subject, topic (UNIQUE triple), mastery_level, total_attempts | Topic-level mastery tracking |
| 23 | `daily_activity` | student_id, activity_date, subject (UNIQUE triple), xp_earned, time_minutes | Daily engagement metrics |

### Quiz Engine

| # | Table | Key Columns | Purpose |
|---|---|---|---|
| 15 | `quiz_sessions` | id, student_id, subject, grade, total_questions, correct_answers, score_percent, time_taken_seconds | Quiz attempt record |
| 16 | `quiz_responses` | quiz_session_id, student_id, question_id, selected_option, is_correct, time_spent_seconds | Per-question response |

### AI and Chat

| # | Table | Key Columns | Purpose |
|---|---|---|---|
| 13 | `chat_sessions` | id, student_id, subject, grade, messages (JSONB), message_count | Foxy tutor conversation history |

### Study Planning

| # | Table | Key Columns | Purpose |
|---|---|---|---|
| 17 | `study_plans` | id, student_id, subject, plan_type, progress_percent, ai_reasoning | AI-generated study plans |
| 18 | `study_plan_tasks` | plan_id, student_id, day_number, task_type, duration_minutes, xp_reward, status | Individual tasks within plans |
| 19 | `spaced_repetition_cards` | student_id, subject, ease_factor, interval_days, next_review_date | SM2 flashcard review queue |

### Gamification

| # | Table | Key Columns | Purpose |
|---|---|---|---|
| 20 | `competitions` | id, title, subject, grade, competition_type, status, entry_fee_xp, prize_pool_xp | Quiz competitions |
| 21 | `competition_participants` | competition_id, student_id (UNIQUE pair), score, rank | Competition enrollment and results |

### Engagement

| # | Table | Key Columns | Purpose |
|---|---|---|---|
| 22 | `notifications` | recipient_type, recipient_id, type, title, body, body_hi, is_read | In-app notifications (bilingual) |
| 24 | `student_simulation_progress` | student_id, simulation_id, subject, score, best_score, attempts | Interactive simulation tracking |
| 25 | `classroom_poll_responses` | poll_id, student_id, answer | Live classroom polling |

## RLS Status

All 25 core tables have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in the core
migration. RLS policies are defined in subsequent migrations (001-005 and later).

**admin_users note**: RLS on the `admin_users` table was temporarily disabled
during an earlier migration but was re-enabled in migration `20260328070000`.
The service role key exposure issue referenced in that fix has also been resolved.

## Tables Added in Later Migrations

The remaining ~57 tables (beyond the 25 core tables) are created across 196
migrations and include:

- `admin_users`, `admin_audit_log` -- super admin authentication and audit trail
- `student_subscriptions`, `payment_events` -- Razorpay payment tracking
- `feature_flags` -- runtime feature flag management
- `task_queue` -- background job processing
- `chapters`, `topics`, `cms_assets` -- CMS content hierarchy
- `user_roles`, `role_permissions` -- RBAC tables (6 roles, 71 permissions)
- `backup_status`, `deployment_history` -- operational metadata
- Various analytics, badge, achievement, and reporting tables

## Key Design Patterns

- **UUIDs everywhere**: All primary keys use `uuid-ossp` or `pgcrypto` generation.
- **Soft deletes**: Core entity tables include `deleted_at TIMESTAMPTZ`.
- **Grade as TEXT**: Grades stored as strings ("6" through "12"), never integers.
- **Bilingual columns**: User-facing text has `_hi` suffix columns for Hindi.
- **Temporal tracking**: All tables include `created_at`; most include `updated_at`.
- **Composite uniqueness**: Learning tables use multi-column UNIQUE constraints
  (e.g., student_id + subject, student_id + topic_id).

## Scale

| Metric | Count |
|---|---|
| Total tables | 82 |
| RLS-enabled tables | 82 (100%) |
| RLS policies | 148+ |
| RPCs | 142+ |
| Indexes | 212+ |
| Migrations | 196 |
