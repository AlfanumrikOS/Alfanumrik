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

## Data Flow: Payment
```
1. Pricing page           → student selects plan
2. frontend               → calls /api/payments/subscribe
3. backend                → creates Razorpay subscription (monthly) or order (yearly)
4. frontend               → opens Razorpay checkout modal
5. Razorpay               → sends webhook to /api/payments/webhook
6. backend                → verifies signature, updates student_subscriptions atomically
7. frontend               → calls /api/payments/verify as backup confirmation
```
**Ownership**: frontend owns steps 1,4,7 (UI). backend owns steps 2,3,5,6 (logic). architect reviews step 6 (security).

## Data Flow: AI Tutoring (Foxy)
```
1. Foxy page              → student sends message
2. frontend               → calls supabase/functions/foxy-tutor
3. ai-engineer            → extracts grade, subject, topic
4. ai-engineer            → RAG: query rag_content_chunks for context
5. ai-engineer            → sends to Claude API with system prompt + context
6. ai-engineer            → streams response back
7. frontend               → renders streamed response
8. backend                → logs interaction, updates usage count
```
**Ownership**: frontend owns steps 1,7. ai-engineer owns steps 2-6. backend owns step 8.

## New Feature Checklist
1. [ ] Identify which role(s) access it
2. [ ] Check if new permission code needed → architect adds to `permissions` table
3. [ ] Design database table/columns → architect writes migration with RLS
4. [ ] Define business rules → assessment if learning-related, backend if payment-related
5. [ ] If AI-powered → ai-engineer designs prompt and RAG retrieval
6. [ ] Add TypeScript types → frontend adds to `src/lib/types.ts`
7. [ ] Add data fetching function → frontend adds to `src/lib/supabase.ts`
8. [ ] Create page → frontend at `src/app/[feature]/page.tsx`
9. [ ] Create components → frontend at `src/components/[feature]/`
10. [ ] Add API route → backend implements, architect reviews auth pattern
11. [ ] Add Hindi translations → frontend
12. [ ] If admin-visible → ops adds to super admin panel
13. [ ] Write tests → testing
14. [ ] Run quality gate → quality

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
