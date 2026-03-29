---
name: architecture
description: System layers, data flows, database tables, and new feature checklist for the Alfanumrik codebase.
user-invocable: false
---

# Skill: Alfanumrik Architecture Reference

Reference for system structure, data flows, and the checklist for adding new features.

## System Layers
```
┌─────────────────────────────────────────────────────┐
│  FRONTEND (Next.js 14 App Router)                   │
│  src/app/*/page.tsx → src/components/ → src/lib/    │
│  State: AuthContext + SWR                           │
│  Styling: Tailwind 3.4                              │
├─────────────────────────────────────────────────────┤
│  MIDDLEWARE (src/middleware.ts)                      │
│  Session refresh → Headers → Bot block → Rate limit │
│  → Super admin gate → API auth → Page protection    │
├─────────────────────────────────────────────────────┤
│  API LAYER (src/app/api/)                           │
│  /api/v1/* → RBAC check → business logic → DB      │
│  /api/payments/* → Razorpay integration             │
│  /api/super-admin/* → admin secret + service role   │
├─────────────────────────────────────────────────────┤
│  EDGE FUNCTIONS (supabase/functions/)               │
│  foxy-tutor, quiz-generator, cme-engine, scan-ocr   │
│  ncert-solver, daily-cron, queue-consumer            │
├─────────────────────────────────────────────────────┤
│  DATABASE (Supabase Postgres)                       │
│  160+ migrations, RLS on all tables, RPCs           │
│  6 roles, 71 permissions, 148+ RLS policies         │
└─────────────────────────────────────────────────────┘
```

## Data Flow: Quiz Attempt
```
1. QuizSetup.tsx          → user picks subject, grade, mode, difficulty
2. quiz/page.tsx          → calls getQuizQuestions(subject, grade, count, difficulty)
3. supabase.ts            → RPC get_quiz_questions or direct question_bank query
4. quiz/page.tsx          → renders questions, tracks answers in state + time via useRef
5. FeedbackOverlay.tsx    → shows Foxy reaction per answer (feedback-engine.ts)
6. cognitive-engine.ts    → updates cognitive load state, may adjust difficulty
7. quiz/page.tsx          → user finishes → calls submitQuizResults()
8. supabase.ts            → INSERT quiz_session + CALL atomic_quiz_profile_update() RPC
9. QuizResults.tsx        → displays score_percent + xp_earned from submission response
```
**Ownership**: fullstack owns steps 1,2,4,5,9 (UI). assessment owns steps 3,6,7,8 (logic). cto owns the RPC and database.

## Data Flow: Auth
```
1. AuthScreen.tsx         → Supabase signUp/signIn
2. Supabase               → sends confirmation email
3. /auth/callback         → PKCE code exchange → session cookie set
4. middleware.ts           → refreshes session on every request
5. AuthContext.tsx         → fetches user profile, roles, snapshot
6. useRequireAuth()        → redirects if not authenticated
7. usePermissions()        → client-side permission gating (UI only)
```
**Ownership**: cto owns steps 3,4,7 (auth infrastructure). fullstack owns steps 1,5,6 (UI).

## Data Flow: Parent Linking
```
1. Student profile        → generates code via generate_parent_link_code() RPC
2. Parent signs up        → enters link code
3. guardian_student_links  → status: 'pending'
4. Student approves       → status: 'approved'
5. Parent RLS policies    → can now read child's quiz_sessions, progress
```
**Ownership**: cto owns RLS and RPC. fullstack owns profile UI.

## Client State Shape (AuthContext)
```typescript
{
  authUserId: string | null,
  student: Student | null,
  snapshot: StudentSnapshot | null,
  teacher: TeacherProfile | null,
  guardian: GuardianProfile | null,
  roles: UserRole[],
  activeRole: UserRole,
  language: 'en' | 'hi',
  isHi: boolean,
  isLoggedIn: boolean,
  isLoading: boolean,
}
```

## New Feature Checklist
1. [ ] Identify which role(s) access it
2. [ ] Check if new permission code needed → cto adds to `permissions` table
3. [ ] Design database table/columns → cto writes migration with RLS
4. [ ] Define business rules (calculations, thresholds) → assessment if learning-related
5. [ ] Add TypeScript types → fullstack adds to `src/lib/types.ts`
6. [ ] Add data fetching function → fullstack adds to `src/lib/supabase.ts`
7. [ ] Create page → fullstack at `src/app/[feature]/page.tsx`
8. [ ] Create components → fullstack at `src/components/[feature]/`
9. [ ] Add API route if needed → fullstack implements, cto reviews auth pattern
10. [ ] Add Hindi translations → fullstack
11. [ ] Write tests → testing agent
12. [ ] Run quality gate → quality agent

## Key Database Tables
| Table | Purpose | RLS Owner Pattern |
|---|---|---|
| `students` | Student profiles | Own row only |
| `quiz_sessions` | Quiz history | Student own, parent linked, teacher assigned |
| `student_learning_profiles` | Per-subject XP and progress | Student own |
| `concept_mastery` | Topic mastery + spaced repetition | Student own, teacher assigned |
| `bloom_progression` | Bloom's level mastery per topic | Student own |
| `question_bank` | Quiz questions | Public read |
| `guardian_student_links` | Parent-child linking | Both parties |
| `classes` / `class_enrollments` | Teacher classes | Teacher own, student enrolled |
| `student_subscriptions` | Razorpay billing | Student own, admin via service role |
| `roles` / `permissions` / `user_roles` | RBAC | Admin only |
| `audit_logs` | Action logging | Admin only |
| `feature_flags` | Feature toggles | Public read |
| `cognitive_session_metrics` | ZPD, fatigue, difficulty data | Student own |
