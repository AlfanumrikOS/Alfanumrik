# commit_p3_p4.ps1
# Run this script from PowerShell to commit all P3+P4 changes.
# Double-click or right-click → "Run with PowerShell"

$ErrorActionPreference = "Stop"

# ─── Locate the git repo ───────────────────────────────────────────────────
$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path   # Desktop\Alfanumrik App
$candidates = @(
    "$workspace\Alfanumrik-main",
    "$workspace",
    "$env:USERPROFILE\Desktop\Alfanumrik App\Alfanumrik-main",
    "$env:USERPROFILE\Desktop\Alfanumrik-main"
)

$repoRoot = $null
foreach ($c in $candidates) {
    if (Test-Path "$c\.git") { $repoRoot = $c; break }
}

if (-not $repoRoot) {
    Write-Error "Could not find a git repo. Edit `$candidates in this script to point at your repo root."
    exit 1
}

Write-Host "Git repo found at: $repoRoot" -ForegroundColor Cyan

# ─── Paths ─────────────────────────────────────────────────────────────────
$srcMigrations = "$workspace\supabase\migrations"
$dstMigrations = "$repoRoot\supabase\migrations"
$srcFoxy       = "$workspace\supabase\functions\foxy-tutor\index.ts"
$dstFoxy       = "$repoRoot\supabase\functions\foxy-tutor\index.ts"

# ─── Copy migration files ──────────────────────────────────────────────────
$migrations = @(
    "20260408000001_irt_proxy_calibration_from_difficulty_bloom.sql",
    "20260408000002_fix_security_definer_view_and_rls_initplan.sql",
    "20260408000003_fix_search_path_on_secdef_functions.sql",
    "20260408000004_fix_service_role_rls_policies.sql",
    "20260408000005_drop_redundant_unused_indexes.sql",
    "20260408000006_irt_theta_estimation_rpc_and_trigger.sql",
    "20260408000007_covering_indexes_for_unindexed_foreign_keys.sql",
    "20260408000008_affective_state_computation_pipeline.sql",
    "20260408000009_drop_old_check_and_record_usage_overload.sql"
)

if (-not (Test-Path $dstMigrations)) { New-Item -ItemType Directory -Path $dstMigrations | Out-Null }

$copied = 0
foreach ($m in $migrations) {
    $src = "$srcMigrations\$m"
    $dst = "$dstMigrations\$m"
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
        Write-Host "  Copied: $m" -ForegroundColor Green
        $copied++
    } else {
        Write-Warning "  Missing (skipped): $src"
    }
}

# ─── Copy foxy-tutor v32 ───────────────────────────────────────────────────
if (Test-Path $srcFoxy) {
    $foxyDir = Split-Path -Parent $dstFoxy
    if (-not (Test-Path $foxyDir)) { New-Item -ItemType Directory -Path $foxyDir | Out-Null }
    Copy-Item $srcFoxy $dstFoxy -Force
    Write-Host "  Copied: supabase/functions/foxy-tutor/index.ts (v32)" -ForegroundColor Green
} else {
    Write-Warning "  foxy-tutor/index.ts not found at $srcFoxy — skipping"
}

# ─── Git add + commit ─────────────────────────────────────────────────────
Set-Location $repoRoot

git add supabase/migrations/20260408000001_irt_proxy_calibration_from_difficulty_bloom.sql
git add supabase/migrations/20260408000002_fix_security_definer_view_and_rls_initplan.sql
git add supabase/migrations/20260408000003_fix_search_path_on_secdef_functions.sql
git add supabase/migrations/20260408000004_fix_service_role_rls_policies.sql
git add supabase/migrations/20260408000005_drop_redundant_unused_indexes.sql
git add supabase/migrations/20260408000006_irt_theta_estimation_rpc_and_trigger.sql
git add supabase/migrations/20260408000007_covering_indexes_for_unindexed_foreign_keys.sql
git add supabase/migrations/20260408000008_affective_state_computation_pipeline.sql
git add supabase/migrations/20260408000009_drop_old_check_and_record_usage_overload.sql
git add supabase/functions/foxy-tutor/index.ts

$commitMsg = @"
feat(p3-p4): DB hardening, IRT theta, affective state, quota fix

P3 Security & Performance:
- Proxy-calibrate irt_difficulty from difficulty+bloom for all 2,599 questions
- Drop SECURITY DEFINER from admin view; fix RLS initplan on 3 tables
- Set search_path=public on 52 SECURITY DEFINER functions
- Scope 37 service-role RLS policies to service_role role only
- Drop 9 zero-scan redundant indexes

P4 Platform Hardening:
- IRT theta estimation: Newton-Raphson Rasch MLE trigger on quiz_responses
  → real-time theta/SE upsert to student_learning_profiles + adaptive_profile
- 31 covering indexes for unindexed foreign keys (Supabase advisor fix)
- Affective state pipeline: ZPD, flow probability, fatigue, boredom_floor,
  frustration_ceiling via trigger on quiz_sessions.is_completed
- Drop old check_and_record_usage overload (client-supplied limit — SECURITY FIX)
- foxy-tutor v32: remove p_limit from quota RPC, fix used_count column name

All migrations applied to production Supabase. foxy-tutor v32 deployed.
"@

git commit -m $commitMsg

Write-Host "`n✅ Commit complete!" -ForegroundColor Green
Write-Host "Copied $copied migration file(s)." -ForegroundColor Cyan
git log --oneline -3
