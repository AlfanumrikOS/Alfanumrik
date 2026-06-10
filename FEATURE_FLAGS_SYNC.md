# Feature Flag Sync — Production to Local Development

This guide explains how to enable production-ready feature flags on your local Supabase instance so you can test the latest UI/UX changes locally before they reach production.

## Problem

When you run `npm run dev`, you're seeing an outdated UI because critical feature flags are **disabled by default** in your local development environment. Your production instance (alfanumrik.com) has 15+ flags **enabled**, which is why the landing page and dashboards look different.

### Version Gap Example
| Aspect | Local (disabled flags) | Production (enabled) |
|---|---|---|
| Landing page | WelcomeV1 (legacy) | WelcomeV2 (modern) |
| Dashboard | Old design | Atlas redesign |
| Home | 5-tab nav | 4-tab adaptive Today |
| Learning | Quiz-only | Pedagogy v2 (Rhythm/Dive/Synthesis) |

## Solution

### Option 1: Run the Migration (Recommended for CI/CD)

Apply the Supabase migration to enable flags in your database:

```bash
# Prerequisites: Supabase local instance running OR staging DB configured
cd d:\Alfa_local\Alfanumrik

# Push migrations to your local instance
supabase db push

# Verify the flags were applied
supabase db shell
# SELECT flag_name, is_enabled FROM feature_flags WHERE is_enabled = true ORDER BY flag_name;
```

**Pros:**
- Version-controlled (part of git history)
- Repeatable across all environments
- CI/CD friendly
- Documented in migration file

**Cons:**
- Requires `supabase` CLI
- One-time setup

---

### Option 2: Run the Setup Script (Quickest for Local Dev)

Run the Node.js script to enable flags directly:

```bash
# Prerequisites: SUPABASE_SERVICE_ROLE_KEY set in .env.local
cd d:\Alfa_local\Alfanumrik

# Check current flag status
npx tsx scripts/sync-production-flags.ts --check

# Apply all production-ready flags
npx tsx scripts/sync-production-flags.ts --apply

# Reset all flags to OFF (rollback)
npx tsx scripts/sync-production-flags.ts --reset --force
```

**Output Example:**
```
🚀 Enabling Production-Ready Flags

  [✓] ff_welcome_v2                    Modern landing page (mobile-first redesign)
  [✓] ff_pedagogy_v2_daily_rhythm      Adaptive Today home + SRS queue
  [✓] ff_pedagogy_v2_weekly_dive       Weekly Curiosity Dive
  [✓] ff_pedagogy_v2_monthly_synthesis Monthly Synthesis + WhatsApp share
  [✓] ff_productive_failure_v1         ZPD problem BEFORE tutorial
  [✓] ff_distractor_micro_explainer_v1 Wrong-answer remediation
  ...
✅ Applied 17 flags
```

**Pros:**
- Instant (runs immediately)
- No CLI required
- Easy to reset/rollback

**Cons:**
- Must set `SUPABASE_SERVICE_ROLE_KEY`
- Not version-controlled (local-only)

---

## Setup Instructions

### Step 1: Ensure Supabase Connection

**For local Supabase:**
```bash
# Start the local Supabase instance
cd d:\Alfa_local\Alfanumrik
supabase start

# Verify connection
supabase status
```

**For staging/production:**
```bash
# Set remote connection
supabase link --project-ref <your-project-ref>
```

### Step 2: Apply Flags

Choose one of the two methods above.

### Step 3: Restart Dev Server

```bash
npm run dev
```

Visit the following URLs to verify production features are now enabled:

- **Landing page:** http://localhost:3000/welcome
  - Now shows "Every exam, prepared" headline (WelcomeV2)
- **Student dashboard:** http://localhost:3000/dashboard
  - Now uses Atlas redesign (if `ff_editorial_atlas_student` is on)
- **Today home:** http://localhost:3000/today
  - Now shows adaptive 4-tab nav (if `ff_today_home_v1` is on)
- **Curiosity Dive:** http://localhost:3000/dive
  - Now reachable (if `ff_pedagogy_v2_weekly_dive` is on)
- **Synthesis:** http://localhost:3000/synthesis
  - Now reachable (if `ff_pedagogy_v2_monthly_synthesis` is on)

---

## Enabled Flags

This setup enables **17 production-ready flags**:

### Landing Page & Marketing
- `ff_welcome_v2` — Modern landing page (mobile-first redesign)

### Pedagogy v2
- `ff_pedagogy_v2_daily_rhythm` — Adaptive Today home + SRS queue
- `ff_pedagogy_v2_weekly_dive` — Weekly Curiosity Dive exploration
- `ff_pedagogy_v2_monthly_synthesis` — Monthly Synthesis + WhatsApp parent share
- `ff_productive_failure_v1` — ZPD problem BEFORE tutorial
- `ff_distractor_micro_explainer_v1` — Wrong-answer remediation

### Editorial Atlas Redesign
- `ff_editorial_atlas_v1` — Master redesign switch
- `ff_editorial_atlas_student` — Student dashboard canary
- `ff_editorial_atlas_parent` — Parent portal canary
- `ff_editorial_atlas_teacher` — Teacher dashboard canary
- `ff_editorial_atlas_school` — School-admin canary

### Consumer Minimalism
- `ff_today_home_v1` — Adaptive Today home + 4-tab nav
- `ff_parent_encourage_v1` — Parent→child cheer button

### Goal-Adaptive Learning
- `ff_goal_profiles` — Super-admin Goal Profile preview
- `ff_goal_aware_foxy` — Persona system prompts + scorecards
- `ff_goal_aware_selection` — Adaptive quiz generation

### Study Menu
- `ff_study_menu_v2` — Sidebar consolidation (Library, Refresh, Exam Sprint)

---

## Environment Scoping

Both the migration and script apply flags only to **development + staging** environments:

```sql
target_environments = ARRAY['development', 'staging']
rollout_percentage = 100
```

**This means:**
- Your **local dev** will have all flags ON ✅
- Your **staging** will have all flags ON ✅
- Your **production** is **completely unchanged** ✅ (not affected)

---

## Rollback

### Using Migration (if applied via `supabase db push`)
1. Create a new migration that disables the flags:
   ```sql
   UPDATE feature_flags SET is_enabled = false WHERE flag_name LIKE 'ff_%';
   ```
2. Or manually toggle flags in the super-admin console

### Using Script
```bash
npx tsx scripts/sync-production-flags.ts --reset --force
```

---

## Troubleshooting

### Error: "SUPABASE_SERVICE_ROLE_KEY not set"
```bash
# Add to .env.local
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc... (your key from Supabase dashboard)
```

### Error: "feature_flags table does not exist"
The table may not exist in a fresh Supabase instance. Run the schema migration first:
```bash
supabase migration up
# or
supabase db push
```

### Flags not taking effect after restart
1. Clear browser cache: `Ctrl+Shift+Delete`
2. Restart dev server: `npm run dev`
3. Check flag status: `npx tsx scripts/sync-production-flags.ts --check`

---

## For CI/CD

To enable production-ready flags in CI environments (Vercel preview deployments), apply the migration as part of your deployment:

```bash
# In your GitHub Actions workflow
supabase db push --remote
```

---

## Questions?

- **How do feature flags work?** See `src/lib/feature-flags.ts`
- **Which flags should I use?** Check `.claude/CLAUDE.md` for flag registry
- **Want to add a new flag?** Create a new migration in `supabase/migrations/`
