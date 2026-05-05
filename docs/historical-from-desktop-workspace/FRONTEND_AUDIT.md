# Alfanumrik Frontend Audit Report

**Date:** 2026-04-10  
**Auditor:** Claude Sonnet 4.6 (automated)  
**Codebase root:** `C:\Users\Bharangpur Primary\Desktop\Alfanumrik App`  
**Framework:** Next.js App Router (Edge-compatible)  
**Backend:** Supabase + Razorpay + Vercel Edge Functions

---

## Executive Summary

This is a **partial codebase** — the auth/middleware layer and domain modules are well-built, but the entire frontend UI (pages, layouts, navigation, API routes) is absent. The codebase will **not build or run** in its current state due to missing lib dependencies and no root layout. The auth logic is production-quality. The gap is everything the user actually sees.

| Layer | Status |
|---|---|
| Middleware / RBAC | ✅ Production-ready |
| Auth module (`modules/auth/`) | ✅ Production-ready |
| Payment module (`modules/payments/`) | ✅ Logic correct; Razorpay plans unconfigured |
| Assessment engine (`modules/assessment/`) | ✅ Good |
| **Root layout** | ❌ Missing — app won't render |
| **Login / Signup pages** | ❌ Missing — auth flows break |
| **All role dashboards** | ❌ Missing — every role lands on a 404 |
| **All learning flows** | ❌ Missing |
| **All API routes** | ❌ Missing (except auth callbacks) |
| **Shared lib files** | ❌ Missing — build fails |

---

## 1. Route Inventory

### 1.1 Routes that EXIST

| Route | File | Type | Auth |
|---|---|---|---|
| `/auth/callback` | `src/app/auth/callback/route.ts` | GET handler | Public (validates Supabase code) |
| `/auth/confirm` | `src/app/auth/confirm/route.ts` | GET handler | Public (validates token_hash) |

**Total deployed routes: 2**

### 1.2 Routes referenced in middleware but MISSING

All of the following are defined in `src/middleware.ts` ROLE_REQUIREMENTS (lines 56–86) but have **zero corresponding files**:

| Route Pattern | Required Roles | Expected Pages |
|---|---|---|
| `/` | Public | Landing page |
| `/login` | Public (redirect if authed) | Login page |
| `/signup` | Public (redirect if authed) | Signup page |
| `/auth/reset` | Public | Password reset form |
| `/dashboard` | Any authenticated | Student dashboard |
| `/onboarding` | Any authenticated | Role-specific onboarding |
| `/settings` | Any authenticated | Account settings |
| `/profile` | Any authenticated | Profile view/edit |
| `/learn/**` | student, teacher, admin | Subject → chapter → content |
| `/quiz/**` | student, teacher, admin | Chapter quiz, adaptive quiz |
| `/mock-exam/**` | student, teacher, admin | Full mock exam |
| `/progress/**` | student, guardian, teacher, admin | Learning analytics |
| `/teacher/**` | teacher, admin | Teacher dashboard + class mgmt |
| `/parent/**` | guardian, admin | Parent portal |
| `/guardian/**` | guardian, admin | Guardian alias |
| `/admin/**` | admin | Admin panel |
| `/pricing` | Public | Plan selection |
| `/payment/success` | Any | Razorpay success handler |
| `/payment/failure` | Any | Razorpay failure handler |

### 1.3 API routes referenced but MISSING

| API Route | Called From | Purpose |
|---|---|---|
| `POST /api/auth/bootstrap` | `src/lib/AuthContext.tsx:317`, `src/components/auth/AuthScreen.tsx:181` | Server-side profile creation; **missing route handler breaks all signup flows** |
| `POST /api/student/*` | Middleware line 83 | Student progress, quiz submission |
| `POST /api/teacher/*` | Middleware line 63 | Class management, question creation |
| `POST /api/parent/*` | Middleware line 68 | Child monitoring, link_code validation |
| `POST /api/admin/*` | Middleware line 59 | System administration |
| `POST /api/progress/*` | Middleware line 84 | Progress tracking |
| `POST /api/content/*` | Middleware line 85 | Content delivery |

### 1.4 Middleware route classification gaps

**`src/middleware.ts` — Issues found:**

- **Line 77:** `/dashboard` requires `roles: ['any']` — this works for students but a teacher who lands at `/dashboard` should be redirected to `/teacher/dashboard`. Currently middleware allows it, but no dashboard page exists.
- **Line 191–198:** `getRoleRedirect()` maps `teacher → /teacher/dashboard`, `guardian → /parent/dashboard`, `admin → /admin/dashboard`, `default → /dashboard`. All four destinations are missing pages.
- **Lines 32–44:** PUBLIC_ROUTES includes `/`, `/login`, `/signup` — all three have no page files. Visiting any public URL returns a 404.
- **No `/foxy` route** in ROLE_REQUIREMENTS — referenced in memory as an existing page. If this page exists in a different branch/version, it has no RBAC protection declared.
- **No `/study-plan`, `/review`, `/leaderboard`, `/simulations`, `/exams`, `/scan`, `/notifications`, `/reports` routes** in ROLE_REQUIREMENTS — all referenced as existing pages in project memory but absent from both the file system and the middleware.

---

## 2. Missing Shared Library Files (BUILD-BREAKING)

The following files are **imported by existing code** but **do not exist** in `src/lib/`:

| Missing File | Imported By | Symbols Used |
|---|---|---|
| `src/lib/supabase.ts` | `AuthContext.tsx:4`, `AuthScreen.tsx:4` | `supabase`, `getStudentSnapshot` |
| `src/lib/supabase-server.ts` | `auth/callback/route.ts:24`, `auth/guards.ts:10`, `payments/razorpay.ts:26` | `createSupabaseServerClient` |
| `src/lib/supabase-admin.ts` | `auth/callback/route.ts:83`, `auth/confirm/route.ts:79` | `getSupabaseAdmin` |
| `src/lib/identity.ts` | `auth/callback/route.ts:26`, `auth/confirm/route.ts:15` | `getRoleDestination`, `validateRedirectTarget` |
| `src/lib/swr.tsx` | `AuthContext.tsx:5` | `clearAllCache` |
| `src/lib/sanitize.ts` | `AuthScreen.tsx:6` | `validatePassword` |
| `src/lib/constants.ts` | `AuthScreen.tsx:5` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUBJECT_META` |
| `src/lib/types.ts` | `AuthContext.tsx:6` | `Student`, `StudentSnapshot` |

**Impact:** TypeScript compilation fails entirely. `next build` will error out before a single page is generated. These files must exist (possibly from the old codebase) but have not been included in this repo snapshot.

---

## 3. Auth & Middleware Audit

### 3.1 What works correctly

- **Session validation** (`middleware.ts:252`): Uses `supabase.auth.getUser()` (server-side JWT validation), not `getSession()`. Correct.
- **Role denial on RPC failure** (`middleware.ts:329`): Never silently allows on role check failure. Correct.
- **Admin audit logging** (`middleware.ts:366–369`): Fire-and-forget async write to `audit_logs`. Non-blocking. Correct.
- **Open redirect protection** (`auth/callback/route.ts:158`, `auth/confirm/route.ts:37`): `validateRedirectTarget()` sanitizes all `?next=` params.
- **Role injection protection** (`AuthContext.tsx:146`): `setActiveRole` validates against server-verified roles array. Correct.
- **`isLoggedIn` semantic** (`AuthContext.tsx:469`): Requires a verified profile, not just an auth token. Correct.

### 3.2 Auth issues found

**MEDIUM — `auth/callback/route.ts:101`: `link_code` silently dropped in email-confirmation bootstrap**

When a parent signs up with a link code AND email confirmation is required (no immediate session), the flow is:
1. Signup: `guardians` insert attempted client-side (likely fails — no confirmed session)
2. Fallback: `/api/auth/bootstrap` called — but `link_code` from signup form **is not in `user_metadata`** because `AuthScreen.tsx` only puts `name`, `role`, `phone` into `metaData` (lines 101–116), not `link_code`
3. Email confirmed: `/auth/callback` runs bootstrap with `p_link_code: null` (line 105)
4. **Result:** Guardian account created with no student link. Guardian dashboard shows no children.

Fix: Add `link_code` to `metaData` at signup and read it back in the callback bootstrap.

**LOW — `AuthContext.tsx:360–364`: Last-resort role fallback writes to `roles` state directly from metadata**

```typescript
// src/lib/AuthContext.tsx:360-364
if (roles.length === 0) {
  const fallbackRole = ...
  setRoles([fallbackRole]);
  setActiveRoleState(fallbackRole);
}
```

This uses the `roles` state variable captured in the `fetchUser` closure (created at the start of the function when `roles` is still empty). The check `roles.length === 0` will always be true at this point (since we're in the "no roles found" branch). This is functionally correct but relies on closure behaviour that is fragile. Not a bug in current logic, but worth noting.

**LOW — `AuthContext.tsx:477`: `refreshStudent` is aliased to `fetchUser`**

```typescript
refreshStudent: fetchUser,
```

Callers expecting `refreshStudent` to only reload the student profile will trigger a full auth/role refresh cycle. This causes unnecessary Supabase RPC calls. Should be split into a dedicated student-only reload.

---

## 4. Student Flow Audit

### 4.1 Expected flow
Onboarding → Dashboard → Subject/Chapter selection → Quiz → Results → Learning analytics → Study plan → Voice tutor (Foxy) → Notes → Chat

### 4.2 Issues

**CRITICAL — No student pages exist**

| Expected Page | File | Status |
|---|---|---|
| `/dashboard` | `src/app/dashboard/page.tsx` | ❌ Missing |
| `/onboarding` | `src/app/onboarding/page.tsx` | ❌ Missing |
| `/learn` | `src/app/learn/page.tsx` | ❌ Missing |
| `/learn/[subject]` | `src/app/learn/[subject]/page.tsx` | ❌ Missing |
| `/learn/[subject]/[chapter]` | `src/app/learn/[subject]/[chapter]/page.tsx` | ❌ Missing |
| `/quiz` | `src/app/quiz/page.tsx` | ❌ Missing |
| `/quiz/[sessionId]` | `src/app/quiz/[sessionId]/page.tsx` | ❌ Missing |
| `/quiz/results/[sessionId]` | `src/app/quiz/results/[sessionId]/page.tsx` | ❌ Missing |
| `/mock-exam` | `src/app/mock-exam/page.tsx` | ❌ Missing |
| `/progress` | `src/app/progress/page.tsx` | ❌ Missing |
| `/study-plan` | `src/app/study-plan/page.tsx` | ❌ Missing |
| `/foxy` | `src/app/foxy/page.tsx` | ❌ Missing |
| `/profile` | `src/app/profile/page.tsx` | ❌ Missing |
| `/settings` | `src/app/settings/page.tsx` | ❌ Missing |

The project memory (written 2026-04-04) indicates these pages existed in the previous codebase (`Alfanumrik-main/`). They have not been migrated to this ADR-001 repo snapshot.

**CRITICAL — No navigation component**

Zero nav/sidebar components exist under `src/components/`. Students have no way to move between pages. The memory references `src/components/ui/BottomNavComponent.tsx` — this file is absent.

**HIGH — No post-quiz results page**

`src/modules/assessment/engine.ts` contains quiz logic and returns `QuizResult` types, but there is no page to display results. Students submitting a quiz have nowhere to land.

**HIGH — No chapter-scoped quiz entry**

No UI to pick subject → chapter → start quiz. The assessment engine supports this but has no frontend.

---

## 5. Parent/Guardian Flow Audit

### 5.1 Expected flow
Link code entry (at signup) → Child dashboard → Monthly reports → Progress tracking

### 5.2 Issues

**CRITICAL — No parent pages exist**

| Expected Page | File | Status |
|---|---|---|
| `/parent/dashboard` | `src/app/parent/dashboard/page.tsx` | ❌ Missing |
| `/parent/progress/[studentId]` | Dynamic | ❌ Missing |
| `/parent/reports` | `src/app/parent/reports/page.tsx` | ❌ Missing |

**HIGH — `link_code` lost on email-confirmation signup path**

As documented in §3.2: when email confirmation is required, the guardian's link_code is not persisted to `user_metadata` and is not passed to the bootstrap RPC (`p_link_code: null` at `auth/callback/route.ts:105`). Guardian account is created with no student link.

**HIGH — No `/api/parent/*` route handlers**

The user notes that the parent portal API was recently changed to require `link_code` in data requests instead of just `guardian_id`. Since no API routes exist, this cannot be verified — but the implementation requirement must be enforced when routes are created: every `/api/parent/*` handler must validate `link_code` (not just authenticate the guardian's JWT).

**HIGH — `/guardian` route alias**

Middleware guards `/guardian/**` (line 67) but there are no pages at this path and no redirect from `/guardian` to `/parent`. If Razorpay or email links ever point to `/guardian`, users get a 404.

---

## 6. Teacher Flow Audit

### 6.1 Expected flow
Dashboard → Class management → Student progress → Content tools

### 6.2 Issues

**CRITICAL — No teacher pages exist**

| Expected Page | File | Status |
|---|---|---|
| `/teacher/dashboard` | `src/app/teacher/dashboard/page.tsx` | ❌ Missing |
| `/teacher/classes` | `src/app/teacher/classes/page.tsx` | ❌ Missing |
| `/teacher/students` | `src/app/teacher/students/page.tsx` | ❌ Missing |
| `/teacher/content` | `src/app/teacher/content/page.tsx` | ❌ Missing |

**HIGH — Teacher role leads to 404 on login**

`getRoleRedirect('teacher')` returns `/teacher/dashboard` (`middleware.ts:193`). This page does not exist. Every teacher who logs in sees a 404.

**MEDIUM — Teacher profile has array fields serialized as JSON strings**

`AuthScreen.tsx:114–115` stores `subjects_taught` and `grades_taught` as `JSON.stringify(array)` in `user_metadata`. The callback routes parse these back (`auth/callback/route.ts:90–92`). This is correct but fragile — if a teacher edits their profile or changes subjects post-signup, the metadata will be stale. The source of truth is the DB row; metadata is only used during the one-time bootstrap.

---

## 7. Admin/Super-Admin Flow Audit

### 7.1 Expected flow
Admin panel → User management → Content management → Analytics → Feature flags → RAG management

### 7.2 Issues

**CRITICAL — No admin pages exist**

| Expected Page | File | Status |
|---|---|---|
| `/admin/dashboard` | `src/app/admin/dashboard/page.tsx` | ❌ Missing |
| `/admin/users` | `src/app/admin/users/page.tsx` | ❌ Missing |
| `/admin/content` | `src/app/admin/content/page.tsx` | ❌ Missing |
| `/admin/analytics` | `src/app/admin/analytics/page.tsx` | ❌ Missing |
| `/admin/flags` | `src/app/admin/flags/page.tsx` | ❌ Missing |
| `/admin/rag` | `src/app/admin/rag/page.tsx` | ❌ Missing |

**MEDIUM — Admin audit only fires for GET/POST to `/admin/` paths**

`middleware.ts:366`: `isAdminAuditRoute()` checks path prefix. But if a future admin page makes a client-side Supabase SDK call (bypassing Next.js API routes), the audit log will not capture it. All admin data mutations must go through `/api/admin/*` route handlers that call `logAdminAction()`.

**MEDIUM — No `SUPABASE_SERVICE_ROLE_KEY` guard in audit log**

`middleware.ts:366`: `if (isAdminAuditRoute(pathname) && supabaseServiceKey)` — if `SUPABASE_SERVICE_ROLE_KEY` is not set, audit logs for admin routes are silently skipped with no warning. Should log a warning when service key is missing.

---

## 8. Payment Flow Audit

### 8.1 What works correctly

- **`src/modules/payments/razorpay.ts`**: All prices in INR/paise. ✅
- **Signature verification** (`razorpay.ts:263`): `crypto.timingSafeEqual` — timing-safe HMAC-SHA256. ✅
- **Idempotency keys** (`razorpay.ts:193`): Mandatory on all mutations. ✅
- **Plan fetch from DB** (`razorpay.ts:154`): Always re-validates `is_active = true`. ✅
- **Monthly plan error** (`razorpay.ts:183`): Throws clear error if `razorpay_plan_id_monthly` is NULL. ✅

### 8.2 Payment issues

**CRITICAL — No pricing or payment UI pages**

| Required Page | File | Status |
|---|---|---|
| `/pricing` | `src/app/pricing/page.tsx` | ❌ Missing |
| `/payment/success` | `src/app/payment/success/page.tsx` | ❌ Missing |
| `/payment/failure` | `src/app/payment/failure/page.tsx` | ❌ Missing |
| `/payment/webhook` | `src/app/api/payment/webhook/route.ts` | ❌ Missing |

**CRITICAL — Razorpay yearly plan IDs are NULL**

`razorpay.ts:6–21` documents that `subscription_plans.razorpay_plan_id` is NULL for all plans. Any attempt to create a yearly subscription throws:
```
[Payments] Yearly Razorpay plan ID is not configured for plan "starter"
```
This blocks yearly billing entirely. Required action:
```sql
-- After creating plans in Razorpay dashboard:
UPDATE subscription_plans SET razorpay_plan_id = '<rzp_plan_id>' WHERE plan_code = 'starter';
UPDATE subscription_plans SET razorpay_plan_id = '<rzp_plan_id>' WHERE plan_code = 'pro';
UPDATE subscription_plans SET razorpay_plan_id = '<rzp_plan_id>' WHERE plan_code = 'unlimited';
```

**CRITICAL — No Razorpay webhook handler**

`razorpay.ts` exports `verifyPayment()` and `getSubscription()` but there is no `/api/payment/webhook` route handler. Without a webhook, subscription status changes (payment captured, subscription activated, payment failed, subscription cancelled) from Razorpay are never processed into the `student_subscriptions` table. Subscriptions will never auto-activate.

**HIGH — No subscription activation flow**

Even if a payment completes via Razorpay checkout, no code activates the subscription in the database. The webhook handler must:
1. Verify the Razorpay signature
2. Call `verifyPayment()`
3. Update `student_subscriptions.status = 'active'`
4. Update `payment_history.status = 'captured'`

**HIGH — `createOrder()` returns a subscription ID, not an order ID**

`razorpay.ts:197–211`: The function creates a Razorpay **subscription** (recurring) and returns `.id` as `orderId`. The Razorpay checkout widget for subscriptions requires `subscription_id`, not `order_id`. The UI must pass the correct parameter to `Razorpay()` constructor — this is easy to get wrong when the page is built.

**MEDIUM — Monthly plan IDs likely also NULL**

If `razorpay_plan_id_monthly` is also NULL for all plans (likely, given this is a fresh setup), all monthly billing also fails. Check DB before launch.

**LOW — Price display: verify ₹ symbol used in all UI copy**

Backend stores prices in paise (correct). When the pricing page is built, ensure division by 100 and ₹ symbol are always used. No hardcoded USD or dollar amounts. The type comment in `payments/types.ts:18` (`// e.g. 49900 = ₹499`) is correct guidance.

---

## 9. UX & Structural Issues

### 9.1 Missing Next.js structural files

| File | Impact |
|---|---|
| `src/app/layout.tsx` | **Build-breaking.** No root layout = app cannot render. Must wrap `<AuthProvider>`. |
| `src/app/not-found.tsx` | Default Next.js 404 page. No branded experience. |
| `src/app/error.tsx` | Unhandled errors show framework error page. |
| `src/app/loading.tsx` | No loading skeleton for any route. |
| `src/app/page.tsx` | Landing page (public route `/`) shows 404. |

### 9.2 Navigation

**CRITICAL — Zero navigation components**

`src/components/` contains only `auth/AuthScreen.tsx`. There are no:
- Bottom navigation bar (referenced as `BottomNavComponent.tsx` in memory)
- Desktop sidebar
- Role-specific navigation menus
- Breadcrumbs for deep routes (`/learn/math/chapter-3`)

Students, teachers, and parents who somehow reach a page have no way to navigate elsewhere.

### 9.3 Loading states

No `loading.tsx` files exist at any route level. Next.js App Router uses these for streaming. Without them:
- No loading skeleton during data fetches
- No Suspense boundary wrapping server components
- Users see blank pages during slow DB queries

### 9.4 Error handling

No `error.tsx` files exist. Unhandled errors in any server component or route handler will propagate as a 500 with the Next.js default error UI.

### 9.5 AuthScreen UX issues

**`src/components/auth/AuthScreen.tsx`**

- **Line 61–65:** ROLE_TABS uses emoji (`🎓`, `👩‍🏫`, `👨‍👩‍👧`). May not render consistently on older Android devices or some screen readers.
- **Line 97:** `consentData` checkbox is required but `consentAnalytics` is optional — good DPDP compliance pattern, but the labels and their implications must be clearly shown.
- **No password strength indicator** — `validatePassword()` validates but feedback is only shown on submit error.
- **No "show password" accessible label** — `showPassword` toggle has no `aria-label`.
- **No input `autocomplete` attributes** — `email`, `password`, `name` fields should have `autocomplete="email"`, `autocomplete="current-password"` etc. for password manager and accessibility compliance.

---

## 10. Security Observations

| Check | Status | Detail |
|---|---|---|
| JWT validation | ✅ | `getUser()` used (server-side), not `getSession()` |
| RBAC enforcement | ✅ | Middleware denies on role check failure, never silently allows |
| Role spoofing prevention | ✅ | `setActiveRole` validates against server-verified roles (B11 fix) |
| Open redirect | ✅ | `validateRedirectTarget()` in both callback routes |
| Payment signature | ✅ | Timing-safe HMAC-SHA256 |
| Admin audit trail | ✅ | All admin routes logged to `audit_logs` |
| Bootstrap security | ✅ | Uses admin client for profile creation (bypasses RLS safely) |
| Hardcoded secrets | ✅ | All keys via env vars |
| DPDP consent | ✅ | Captured at signup for data + analytics separately |
| Parental consent | ✅ | Students aged 10–12 require parent email + consent checkbox |
| Webhook verification | ⚠️ | Webhook route missing — no attack surface yet, but must verify signature when built |
| CSRF | N/A | Next.js App Router + cookie-based auth handles this natively |
| XSS | N/A | No pages built yet — must audit when pages are added |

---

## 11. Prioritised Issues

### CRITICAL — Blocks any launch or testing

| # | Issue | File | Line | Fix |
|---|---|---|---|---|
| C1 | Missing lib files (`supabase.ts`, `supabase-server.ts`, `supabase-admin.ts`, `identity.ts`, `swr.tsx`, `sanitize.ts`, `constants.ts`, `types.ts`) — build fails | Multiple | — | Restore from old codebase or implement; these are imports assumed to exist |
| C2 | No `src/app/layout.tsx` — app cannot render | Missing | — | Create root layout wrapping `<AuthProvider>` |
| C3 | No `src/app/page.tsx` — landing page is 404 | Missing | — | Create public landing/welcome page |
| C4 | No `/login` page — auth redirects go to 404 | Missing | — | Create login page using `AuthScreen` component |
| C5 | No `/signup` page — signup links go to 404 | Missing | — | Create signup page using `AuthScreen` component |
| C6 | No `/api/auth/bootstrap` route handler — all signup fallbacks fail silently | Missing | — | Create POST handler using `bootstrap_user_profile` RPC via admin client |
| C7 | No `src/app/dashboard/page.tsx` — student landing after login is 404 | Missing | — | Create student dashboard page |
| C8 | No `/teacher/dashboard` page — teacher landing is 404 | Missing | — | Create teacher dashboard |
| C9 | No `/parent/dashboard` page — parent landing is 404 | Missing | — | Create parent dashboard |
| C10 | No `/admin/dashboard` page — admin landing is 404 | Missing | — | Create admin dashboard |
| C11 | No Razorpay webhook handler — subscriptions never activate | Missing | — | Create `/api/payment/webhook` route with signature verification |
| C12 | Razorpay yearly plan IDs are NULL — yearly billing throws | `razorpay.ts` | 6–21 | Create plans in Razorpay dashboard, run UPDATE SQL |
| C13 | No pricing page — payment flow has no entry point | Missing | — | Create `/pricing` page |
| C14 | No payment success/failure pages — Razorpay has nowhere to redirect | Missing | — | Create `/payment/success` and `/payment/failure` pages |

### HIGH — Should fix before first user pilot

| # | Issue | File | Line | Fix |
|---|---|---|---|---|
| H1 | `link_code` dropped in email-confirmation guardian signup path | `auth/callback/route.ts` | 101–106 | Add `link_code` to signup `user_metadata`; read it back in callback bootstrap |
| H2 | No `/auth/reset` page — password reset redirect broken | Missing | — | Create password reset form page |
| H3 | No navigation components — users cannot navigate between pages | Missing | — | Restore/create `BottomNavComponent` and sidebar |
| H4 | No student learning pages (`/learn`, `/quiz`, `/progress`, etc.) | Missing | — | Implement or migrate from old codebase |
| H5 | No post-quiz results page — students land on 404 after quiz | Missing | — | Create `/quiz/results/[sessionId]` page |
| H6 | No `/api/parent/*` routes — parent data cannot be fetched | Missing | — | Implement; must require `link_code` in every request, not just `guardian_id` |
| H7 | Razorpay monthly plan IDs likely also NULL | DB | — | Verify `razorpay_plan_id_monthly` is set for all plans |
| H8 | `createOrder()` returns subscription_id labelled as orderId — UI must use correct field | `razorpay.ts` | 226 | When building checkout UI, pass `subscription_id` not `order_id` to Razorpay SDK |
| H9 | `/guardian/**` route has no redirect to `/parent/**` | `middleware.ts` | 67 | Add a permanent redirect from `/guardian/*` → `/parent/*` |
| H10 | No `error.tsx` at any level — unhandled errors show framework page | Missing | — | Create `src/app/error.tsx` with branded error UI |

### MEDIUM — Fix soon after first deployment

| # | Issue | File | Line | Fix |
|---|---|---|---|---|
| M1 | No `loading.tsx` at route level — blank pages during data fetches | Missing | — | Add `loading.tsx` with skeleton components at key route levels |
| M2 | No `not-found.tsx` — 404s show default Next.js page | Missing | — | Create branded 404 page |
| M3 | Admin audit silently skipped if `SUPABASE_SERVICE_ROLE_KEY` unset | `middleware.ts` | 366 | Log a warning when service key is missing |
| M4 | `refreshStudent` in AuthContext triggers full auth cycle, not just student data | `AuthContext.tsx` | 477 | Split into dedicated student-only reload function |
| M5 | No `foxy`, `study-plan`, `review`, `leaderboard` routes in middleware ROLE_REQUIREMENTS | `middleware.ts` | 56–86 | Add these routes to ROLE_REQUIREMENTS or confirm they are sub-routes of `/dashboard` |
| M6 | Teacher metadata (`subjects_taught`, `grades_taught`) in `user_metadata` goes stale after DB update | `AuthScreen.tsx` | 114–115 | Document that metadata is only used for initial bootstrap; read-after-update from DB |
| M7 | `consentAnalytics` state stored but never sent to any analytics opt-out endpoint | `AuthScreen.tsx` | 46 | Wire analytics consent to actual analytics SDK toggle |
| M8 | No `autocomplete` attributes on auth form inputs | `AuthScreen.tsx` | 73–125 | Add `autocomplete="email"`, `autocomplete="current-password"` etc. |
| M9 | No ARIA labels on password visibility toggle | `AuthScreen.tsx` | — | Add `aria-label="Show password"` to toggle button |
| M10 | No onboarding flow — new students land on dashboard with no guidance | Missing | — | Create `/onboarding` wizard collecting subject preferences, exam targets |

### LOW — Polish before general availability

| # | Issue | File | Line | Fix |
|---|---|---|---|---|
| L1 | Emoji in role tab labels may not render on all devices | `AuthScreen.tsx` | 61–65 | Use SVG icons instead of emoji |
| L2 | No PWA manifest — suboptimal on mobile | Missing | — | Add `manifest.json`, service worker registration |
| L3 | No `robots.txt` content file — middleware allows the route but file doesn't exist | Missing | — | Create `public/robots.txt` |
| L4 | No `sitemap.xml` — SEO impact | Missing | — | Generate via Next.js `sitemap.ts` |
| L5 | No password strength indicator — only error on submit | `AuthScreen.tsx` | 82 | Add real-time password strength feedback |
| L6 | ESLint import restriction rule (`import/no-restricted-paths`) not yet enforced for module boundaries | ADR-001 doc | — | Add ESLint rule to prevent direct `@/lib/*` imports outside module wrappers |
| L7 | `supabase/functions/foxy-tutor/index.ts` not reviewed in this audit | Edge Function | — | Verify Claude API key handling, rate limiting, prompt injection protection |

---

## 12. Parent Portal API — `link_code` Requirement

The parent portal data API was changed (per user note) to require `link_code` in requests instead of just `guardian_id`. Since no `/api/parent/*` routes exist yet, here is the required pattern for all future parent API implementations:

```typescript
// src/app/api/parent/child-progress/route.ts — TEMPLATE ONLY (not yet created)
import { requireRole } from '@/modules/auth';

export async function GET(request: Request) {
  // 1. Auth guard
  const { userId } = await requireRole('guardian');

  // 2. Require link_code in request — NOT just guardian_id
  const { searchParams } = new URL(request.url);
  const linkCode = searchParams.get('link_code');
  if (!linkCode) {
    return Response.json({ error: 'link_code required' }, { status: 400 });
  }

  // 3. Validate link_code belongs to this guardian (prevents IDOR)
  const supabase = await createSupabaseServerClient();
  const { data: link } = await supabase
    .from('guardian_student_links')
    .select('student_id')
    .eq('guardian_id', userId)        // verified guardian
    .eq('invite_code', linkCode)      // link_code must match
    .eq('status', 'active')
    .single();

  if (!link) {
    return Response.json({ error: 'Invalid link_code' }, { status: 403 });
  }

  // 4. Fetch child data using validated student_id
  // ...
}
```

Every parent API must validate both `guardian_id` (from JWT) AND `link_code` (from request) to prevent a guardian from accessing another student's data by guessing a `student_id`.

---

## 13. Complete File Manifest

### Files that exist (24 total)

```
src/
├── app/
│   └── auth/
│       ├── callback/route.ts          ✅ PKCE auth flow
│       └── confirm/route.ts           ✅ Token hash auth flow
├── components/
│   └── auth/
│       └── AuthScreen.tsx             ✅ Login/signup UI
├── lib/
│   └── AuthContext.tsx                ✅ Auth state + hooks
├── middleware.ts                      ✅ RBAC enforcement
└── modules/
    ├── adaptation/
    │   ├── index.ts                   ✅ Public API
    │   └── types.ts                   ✅ NextAction types
    ├── analytics/
    │   ├── index.ts                   ✅ Public API
    │   └── types.ts                   ✅ Event types
    ├── assessment/
    │   ├── engine.ts                  ✅ Quiz logic, BKT
    │   ├── index.ts                   ✅ Public API
    │   └── types.ts                   ✅ Question types
    ├── auth/
    │   ├── audit.ts                   ✅ Admin audit log
    │   ├── guards.ts                  ✅ requireRole / requireAnyRole
    │   └── index.ts                   ✅ Module boundary exports
    ├── content/
    │   ├── fetchers.ts                ✅ RAG retrieval
    │   ├── index.ts                   ✅ Public API
    │   └── types.ts                   ✅ ContentItem types
    ├── notifications/
    │   ├── index.ts                   ✅ Public API
    │   └── types.ts                   ✅ Notification types
    └── payments/
        ├── index.ts                   ✅ Public API
        ├── razorpay.ts                ✅ Subscription + verification
        └── types.ts                   ✅ Plan / Subscription types

supabase/
├── config.toml                        ✅
└── functions/
    ├── foxy-tutor/index.ts            ✅ Claude API tutor
    ├── ml-adaptation/index.ts        ✅ BKT computation
    └── rag-retrieval/index.ts        ✅ Voyage + pgvector
```

### Files that must be created or restored (minimum viable launch set)

```
src/
├── app/
│   ├── layout.tsx                     ❌ CRITICAL — root layout
│   ├── page.tsx                       ❌ CRITICAL — landing page
│   ├── not-found.tsx                  ❌ MEDIUM
│   ├── error.tsx                      ❌ HIGH
│   ├── loading.tsx                    ❌ MEDIUM
│   ├── login/page.tsx                 ❌ CRITICAL
│   ├── signup/page.tsx                ❌ CRITICAL
│   ├── auth/
│   │   └── reset/page.tsx             ❌ HIGH
│   ├── dashboard/page.tsx             ❌ CRITICAL
│   ├── onboarding/page.tsx            ❌ MEDIUM
│   ├── profile/page.tsx               ❌ HIGH
│   ├── settings/page.tsx              ❌ HIGH
│   ├── learn/
│   │   ├── page.tsx                   ❌ HIGH
│   │   └── [subject]/
│   │       ├── page.tsx               ❌ HIGH
│   │       └── [chapter]/page.tsx     ❌ HIGH
│   ├── quiz/
│   │   ├── page.tsx                   ❌ HIGH
│   │   ├── [sessionId]/page.tsx       ❌ HIGH
│   │   └── results/[sessionId]/page.tsx ❌ HIGH
│   ├── mock-exam/page.tsx             ❌ HIGH
│   ├── progress/page.tsx              ❌ HIGH
│   ├── foxy/page.tsx                  ❌ HIGH
│   ├── study-plan/page.tsx            ❌ HIGH
│   ├── pricing/page.tsx               ❌ CRITICAL
│   ├── payment/
│   │   ├── success/page.tsx           ❌ CRITICAL
│   │   └── failure/page.tsx           ❌ CRITICAL
│   ├── teacher/
│   │   ├── dashboard/page.tsx         ❌ CRITICAL
│   │   ├── classes/page.tsx           ❌ HIGH
│   │   └── students/page.tsx          ❌ HIGH
│   ├── parent/
│   │   ├── dashboard/page.tsx         ❌ CRITICAL
│   │   ├── progress/[studentId]/page.tsx ❌ HIGH
│   │   └── reports/page.tsx           ❌ HIGH
│   ├── admin/
│   │   ├── dashboard/page.tsx         ❌ CRITICAL
│   │   ├── users/page.tsx             ❌ HIGH
│   │   ├── content/page.tsx           ❌ HIGH
│   │   ├── analytics/page.tsx         ❌ HIGH
│   │   ├── flags/page.tsx             ❌ HIGH
│   │   └── rag/page.tsx               ❌ HIGH
│   └── api/
│       ├── auth/
│       │   └── bootstrap/route.ts     ❌ CRITICAL
│       ├── payment/
│       │   └── webhook/route.ts       ❌ CRITICAL
│       ├── student/
│       │   └── [...]/route.ts         ❌ HIGH
│       ├── teacher/
│       │   └── [...]/route.ts         ❌ HIGH
│       ├── parent/
│       │   └── [...]/route.ts         ❌ HIGH (must use link_code)
│       └── admin/
│           └── [...]/route.ts         ❌ HIGH
├── lib/
│   ├── supabase.ts                    ❌ CRITICAL — build fails
│   ├── supabase-server.ts             ❌ CRITICAL — build fails
│   ├── supabase-admin.ts              ❌ CRITICAL — build fails
│   ├── identity.ts                    ❌ CRITICAL — build fails
│   ├── swr.tsx                        ❌ CRITICAL — build fails
│   ├── sanitize.ts                    ❌ CRITICAL — build fails
│   ├── constants.ts                   ❌ CRITICAL — build fails
│   └── types.ts                       ❌ CRITICAL — build fails
└── components/
    └── ui/
        ├── BottomNavComponent.tsx     ❌ HIGH
        ├── Sidebar.tsx                ❌ HIGH
        └── [other shared UI]          ❌ HIGH
```

---

## 14. Recommended Fix Order

1. **Restore missing lib files** from the old `Alfanumrik-main` codebase (or equivalent). These are pre-ADR-001 files that are still required. Until they exist, `next build` produces zero output.

2. **Create root layout and public pages** (`layout.tsx`, `page.tsx`, `login/`, `signup/`). Without these, no user can reach the app at all.

3. **Create `/api/auth/bootstrap` route handler**. This is called as a fallback by both AuthContext and AuthScreen. Without it, users who fail client-side profile creation end up with an auth token but no profile, and are permanently locked out.

4. **Restore navigation components** (`BottomNavComponent`, sidebar). Without navigation, a user who lands on a page cannot move.

5. **Restore student dashboard and learning pages** from old codebase. These are the core product.

6. **Create Razorpay webhook handler** and configure plan IDs in the DB before any payment testing.

7. **Fix `link_code` in guardian signup** (add to `user_metadata`, read in callback bootstrap).

8. **Create teacher, parent, and admin pages** (or restore from old codebase).

9. **Add `error.tsx`, `loading.tsx`, `not-found.tsx`** at app root.

10. **Build and test the pricing → checkout → webhook → subscription activation flow** end-to-end.

---

*Report generated 2026-04-10. Re-audit recommended after pages are restored from old codebase.*
