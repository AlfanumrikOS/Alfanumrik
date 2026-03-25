# Load Testing — Alfanumrik

## Quick Start

```bash
# Install k6
brew install k6  # macOS
# or: sudo apt install k6  # Ubuntu
# or: choco install k6     # Windows

# Run against staging
k6 run tests/load/k6-load-test.js

# Run with Supabase (to test AI chat)
k6 run \
  -e BASE_URL=https://alfanumrik.vercel.app \
  -e SUPABASE_URL=https://your-project.supabase.co \
  -e SUPABASE_ANON_KEY=your-anon-key \
  tests/load/k6-load-test.js

# Quick smoke test (50 users, 1 minute)
k6 run --vus 50 --duration 1m tests/load/k6-load-test.js
```

## SLA Targets

| Metric | Target | Notes |
|--------|--------|-------|
| p95 latency | < 3s | All endpoints |
| p99 latency | < 5s | All endpoints |
| Error rate | < 5% | HTTP 4xx/5xx |
| Dashboard p95 | < 2s | Page loads |
| AI Chat p95 | < 8s | Includes model inference |

## Scaling Validation

| VUs | Expected | Status |
|-----|----------|--------|
| 500 | Baseline | Run first |
| 2,000 | Normal load | Should pass all SLAs |
| 5,000 | Target capacity | Must pass all SLAs |
| 10,000 | Stress test | May degrade gracefully |
