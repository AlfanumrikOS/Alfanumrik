# Quick Start: Enable Production Features Locally

## TL;DR

Your local dev is showing outdated UI because feature flags are **disabled**. Enable them with one command:

```bash
npm run flags:sync
npm run dev
```

Done! You'll now see the production UI (WelcomeV2, Atlas redesign, Pedagogy v2 features).

---

## Available Commands

```bash
# Check which flags are enabled/disabled
npm run flags:check

# Enable all production-ready flags (RECOMMENDED)
npm run flags:sync

# Disable all flags (rollback)
npm run flags:reset

# Manual control with detailed options
npx tsx scripts/sync-production-flags.ts --check
npx tsx scripts/sync-production-flags.ts --apply
npx tsx scripts/sync-production-flags.ts --reset --force
```

---

## What Gets Enabled (17 Flags)

| Flag | Feature |
|------|---------|
| `ff_welcome_v2` | Modern landing page ("Every exam, prepared") |
| `ff_editorial_atlas_v1` | New visual design (student/parent/teacher/school) |
| `ff_today_home_v1` | Adaptive Today home + 4-tab nav |
| `ff_pedagogy_v2_daily_rhythm` | Daily SRS queue |
| `ff_pedagogy_v2_weekly_dive` | Curiosity Dive (/dive) |
| `ff_pedagogy_v2_monthly_synthesis` | Synthesis + parent share (/synthesis) |
| `ff_distractor_micro_explainer_v1` | Wrong-answer remediation |
| `ff_productive_failure_v1` | ZPD-first learning |
| `ff_goal_aware_foxy` | Goal-aware Foxy tutor |
| `ff_goal_aware_selection` | Adaptive quiz generation |
| `ff_parent_encourage_v1` | Parent cheer button |
| `ff_study_menu_v2` | Sidebar: Library/Refresh/Exam Sprint |
| +4 more Atlas canaries... | Per-role feature gates |

---

## Where to See Changes

After running `npm run flags:sync`:

- **Landing page**: http://localhost:3000/welcome ← Shows WelcomeV2
- **Dashboard**: http://localhost:3000/dashboard ← Atlas redesign
- **Home**: http://localhost:3000/today ← New 4-tab layout
- **Dive**: http://localhost:3000/dive ← Curiosity exploration
- **Synthesis**: http://localhost:3000/synthesis ← Monthly summary
- **Foxy**: http://localhost:3000/foxy ← Goal-aware prompts

---

## Troubleshooting

**Q: "SUPABASE_SERVICE_ROLE_KEY not set"**
- Add to `.env.local`: `SUPABASE_SERVICE_ROLE_KEY=<your_key>`

**Q: "feature_flags table does not exist"**
- Run migrations: `supabase db push`

**Q: Changes don't appear after restart**
- Clear browser cache (Ctrl+Shift+Delete)
- Restart dev server: `npm run dev`

**Q: How do I disable just one flag?**
- Use the super-admin console: `/super-admin/flags`
- Or SQL: `UPDATE feature_flags SET is_enabled=false WHERE flag_name='ff_name';`

---

## How It Works

```
Local Supabase Instance
├─ feature_flags table
│  ├─ ff_welcome_v2 → true  ✓
│  ├─ ff_editorial_atlas_v1 → true ✓
│  └─ ... 15 more ...
│
App Startup
└─ src/lib/feature-flags.ts reads flags from Supabase
   └─ src/app/welcome/page.tsx: `ff_welcome_v2` ? WelcomeV2 : WelcomeV1
   └─ src/components/dashboard/Dashboard.tsx: `ff_editorial_atlas_v1` ? AtlasDesign : LegacyDesign
   └─ ... routes/components check other flags ...
```

When a flag is `true`, the feature is rendered. When `false`, it falls back to the legacy version.

---

## Production is Unaffected

- Flags are scoped to `['development', 'staging']` only
- Your production instance (alfanumrik.com) remains completely unchanged ✅
- This is a **local-only** sync

---

## See Also

- Full docs: [FEATURE_FLAGS_SYNC.md](./FEATURE_FLAGS_SYNC.md)
- Flag registry: [src/lib/feature-flags.ts](./src/lib/feature-flags.ts)
- Feature flag system: [.claude/CLAUDE.md](./.claude/CLAUDE.md)
