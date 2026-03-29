# Skill: Alfanumrik Architecture Reference

Use this skill when you need to understand how Alfanumrik's systems connect, where data flows, or how to add a new feature without breaking existing architecture.

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
│  Roles: student, parent, teacher, tutor, admin,     │
│         super_admin                                  │
└─────────────────────────────────────────────────────┘
```

## Data Flow: Quiz Attempt
```
1. QuizSetup.tsx → user picks subject, grade, mode, difficulty
2. quiz/page.tsx → calls getQuizQuestions(subject, grade, count, difficulty)
3. supabase.ts → RPC get_quiz_questions or direct question_bank query
4. quiz/page.tsx → renders questions, tracks answers + time
5. FeedbackOverlay.tsx → shows Foxy reaction per answer (feedback-engine.ts)
6. cognitive-engine.ts → updates cognitive load state, adjusts difficulty
7. User submits → submitQuizResults() in supabase.ts
8. supabase.ts → INSERT quiz_session + CALL atomic_quiz_profile_update() RPC
9. QuizResults.tsx → displays score, XP, error breakdown, Bloom's analysis
```

## Data Flow: Auth
```
1. AuthScreen.tsx → Supabase signUp/signIn
2. Supabase sends confirmation email
3. /auth/callback → PKCE code exchange → session cookie set
4. middleware.ts → refreshes session on every request
5. AuthContext.tsx → fetches user profile, roles, snapshot
6. useRequireAuth() → redirects if not authenticated
7. usePermissions() → client-side permission gating (UI only)
```

## Data Flow: Parent Linking
```
1. Student profile → generates parent link code (generate_parent_link_code RPC)
2. Parent signs up → enters link code
3. guardian_student_links → status: 'pending'
4. Student approves → status: 'approved'
5. Parent can now view child's quiz_sessions, progress, reports via RLS
```

## Client-Side State Shape (AuthContext)
```typescript
{
  authUserId: string | null,
  student: Student | null,         // from students table
  snapshot: StudentSnapshot | null, // aggregated dashboard stats
  teacher: TeacherProfile | null,
  guardian: GuardianProfile | null,
  roles: UserRole[],               // from get_user_role RPC
  activeRole: UserRole,
  language: 'en' | 'hi',
  isHi: boolean,
  isLoggedIn: boolean,
  isLoading: boolean,
}
```

## Adding a New Feature Checklist
1. [ ] Identify which role(s) can access it
2. [ ] Add permission code to `permissions` table (if new permission needed)
3. [ ] Create database table/columns (migration with RLS)
4. [ ] Add TypeScript types to `src/lib/types.ts`
5. [ ] Add data fetching function to `src/lib/supabase.ts`
6. [ ] Create page in `src/app/[feature]/page.tsx`
7. [ ] Create components in `src/components/[feature]/`
8. [ ] Add API route if server-side logic needed (with RBAC check)
9. [ ] Add Hindi translations for all user-facing text
10. [ ] Write tests (unit + smoke)
11. [ ] Run quality gate: type-check, lint, test, build

## Key Database Tables
| Table | Purpose | RLS Pattern |
|---|---|---|
| `students` | Student profiles | Own data only |
| `quiz_sessions` | Quiz history | Student own, parent linked, teacher assigned |
| `student_learning_profiles` | Per-subject progress | Student own |
| `concept_mastery` | Topic mastery tracking | Student own, teacher assigned |
| `bloom_progression` | Bloom's level mastery | Student own |
| `question_bank` | Quiz questions | Public read |
| `guardian_student_links` | Parent-child linking | Both parties |
| `classes` / `class_enrollments` | Teacher classes | Teacher own, student enrolled |
| `student_subscriptions` | Billing | Student own, admin read |
| `roles` / `permissions` / `user_roles` | RBAC | Admin only |
| `audit_logs` | Action logging | Admin only |
| `feature_flags` | Feature toggles | Public read |
