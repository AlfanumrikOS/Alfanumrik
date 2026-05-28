Set-Location "$PSScriptRoot"

Write-Host "`n[Alfanumrik Deploy] Starting..." -ForegroundColor Cyan

# Verify we're in the right repo
if (-not (Test-Path ".git")) {
    Write-Host "ERROR: Not a git repo. Run this from the Alfanumrik App folder." -ForegroundColor Red
    exit 1
}

Write-Host "[1/4] Installing dependencies (posthog-js)..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed" -ForegroundColor Red; exit 1 }

Write-Host "[2/4] Running TypeScript type-checking..." -ForegroundColor Yellow
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Write-Host "TypeScript errors found. Fix before deploying." -ForegroundColor Red; exit 1 }

Write-Host "[3/4] Committing all fixes..." -ForegroundColor Yellow
git add -A
git status

git commit -m "fix: apply all audit fixes for production launch

- C-01: Fix quiz score display (XP -> score_percent) in tracker + parent reports
- C-02: Fix pricing Family/School plan 1099 (was 1499 Unlimited) in PricingCards + plans
- A-01: BKT mastery backfill migration via question_bank join
- A-02: Wire PostHog EU (PostHogProvider, analytics, AuthContext identify/reset)
- A-03: Gate quiz questions to is_verified=true only
- A-04: Fix getFeatureFlagsSimple rollout_percentage bypass
- A-05: Add vercel.json cron + /api/cron/daily route (00:30 IST)
- A-06: Silence AuthApiError noise on homepage (stale JWT)
- A-08: Fix 461 permissive RLS policies scoped to service_role
- C-03: Tombstone 12 verify_jwt:false orphan Edge Functions (HTTP 410)"

if ($LASTEXITCODE -ne 0) { Write-Host "Nothing to commit or git error." -ForegroundColor Yellow }

Write-Host "[4/4] Pushing to origin (triggers Vercel deploy)..." -ForegroundColor Yellow
git push origin HEAD
if ($LASTEXITCODE -ne 0) { Write-Host "Push failed. Check git remote." -ForegroundColor Red; exit 1 }

Write-Host "`n[Alfanumrik Deploy] Push complete. Vercel build starting..." -ForegroundColor Green
Write-Host "Monitor at: https://vercel.com/pradeep-sharmas-projects-3dc48378/alfanumrik" -ForegroundColor Cyan

Read-Host "`nPress Enter to close"
