# Onboarding Fix Deployment — 2026-04-08

## What was fixed

| Bug | File | Status |
|-----|------|--------|
| B1: Grade stored as "Grade 9" instead of "9" | handle_new_user trigger + AuthScreen.tsx | ✅ DB migrated + code fixed |
| B2: Bootstrap fallback skipped when email confirmation required | AuthScreen.tsx | ✅ Fixed |
| B3: 3 ghost users with no profiles | DB data migration | ✅ All repaired |
| B4: Teacher fields missing from auth metadata + bootstrap | AuthScreen.tsx + callback/route.ts + confirm/route.ts | ✅ Fixed |
| B5: Guardian role stored as "parent" in user_roles | sync_user_roles_on_insert trigger + roles table | ✅ DB migrated |
| B7: isLoggedIn true for profileless auth users | AuthContext.tsx | ✅ Fixed |
| B8: No onboarding_state written by DB trigger | handle_new_user trigger | ✅ DB migrated |
| B9: pendingEmail lost on page refresh, resend breaks | AuthScreen.tsx | ✅ Fixed |
| B10: Auto-create profile bypasses RLS/triggers | AuthContext.tsx | ✅ Fixed |
| B11: setActiveRole uses stale roles closure | AuthContext.tsx | ✅ Fixed |

**DB migrations applied live** (already in production — no action needed):
- `fix_handle_new_user_grade_and_onboarding_state`
- `fix_handle_new_user_intended_role_column`
- `fix_sync_user_roles_guardian_parent_rename`
- `repair_three_ghost_users_profiles`

---

## Steps to deploy code changes

### 1. Apply the patch (from repo root)

```bash
cd /path/to/Alfanumrik
git apply onboarding_fixes.patch
```

If `git apply` fails due to whitespace or line-ending issues, use the individual files instead (see step 2).

### 2. Alternative: copy files directly

The fixed files are in this folder at their proper paths. Copy each one:

```bash
cp "src/components/auth/AuthScreen.tsx"  <repo>/src/components/auth/AuthScreen.tsx
cp "src/app/auth/callback/route.ts"      <repo>/src/app/auth/callback/route.ts
cp "src/app/auth/confirm/route.ts"       <repo>/src/app/auth/confirm/route.ts
cp "src/lib/AuthContext.tsx"             <repo>/src/lib/AuthContext.tsx
```

### 3. Commit

```bash
git add src/components/auth/AuthScreen.tsx \
        src/app/auth/callback/route.ts \
        src/app/auth/confirm/route.ts \
        src/lib/AuthContext.tsx

git commit -m "fix(auth): repair 10 onboarding breakpoints (B1-B11)

- B1: Remove 'Grade ' prefix from student grade stored in DB/metadata
- B2: Remove session guard from bootstrap fallback (null during email confirm)
- B4: Add teacher fields (school, subjects, grades) to signup metadata
      and parse them in callback/confirm bootstrap calls
- B5 (DB): Rename 'parent' role to 'guardian' in roles table + trigger
- B7: isLoggedIn now requires verified profile, not just auth token
- B8 (DB): handle_new_user trigger now writes onboarding_state on INSERT
- B9: Persist pendingEmail to sessionStorage; resend reads from it
- B10: AuthContext fallback auto-create now routes through /api/auth/bootstrap
- B11: setActiveRole wrapped in useCallback to prevent stale closure"
```

### 4. Push + verify Vercel deployment

```bash
git push origin main
```

Watch the Vercel deployment log. The build should pass with no new TypeScript errors.

---

## Post-deploy smoke test checklist

### Student signup (happy path)
- [ ] Sign up as student, grade 9 — email confirmation sent
- [ ] Click confirmation link — lands on student dashboard
- [ ] Check Supabase: `students.grade = '9'` (not 'Grade 9')
- [ ] Check: `onboarding_state.step = 'completed'`
- [ ] Check: `user_roles` row with role name = 'student'

### Teacher signup
- [ ] Sign up as teacher, pick 2 subjects + 2 grades + school name
- [ ] Click confirmation link — bootstrap call creates teacher row with subjects/grades
- [ ] Check: `teachers.subjects_taught` is populated array (not null)

### Parent/Guardian signup
- [ ] Sign up as parent — `user_roles` now gets 'guardian' role (not 'parent')
- [ ] `useAuth().roles` includes 'guardian'

### Email verification resend
- [ ] Reach check-email screen, refresh page, click resend — should work (reads sessionStorage)

### Returning user
- [ ] Log in as any repaired ghost user (spriyanka.sharma12@gmail.com) — dashboard loads
- [ ] `isLoggedIn` is true only after profile is confirmed

### Forgot password
- [ ] Request reset, click email link — lands on /auth/reset with valid session

---

## Rollback

The DB migrations are safe to leave in place. The code changes are backward-compatible.

To revert code only:
```bash
git revert HEAD
git push origin main
```
