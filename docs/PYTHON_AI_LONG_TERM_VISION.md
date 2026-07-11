# Python AI Services — Long-Term Vision

Owner: architect. Reviewers: ai-engineer (workload), ops (runtime), CEO (strategic).
Last updated: 2026-05-24.

This document is the architectural compass for `python/services/ai/`. Every future PR that changes the FastAPI service's posture (scale, security, observability, cost, infra topology) MUST be measured against this document. If a PR proposes something not aligned here, either (a) the PR is wrong, or (b) this document needs revision — never silently diverge.

Companion docs:
- Deploy runbook: `docs/PYTHON_AI_DEPLOY.md`
- Architecture: `docs/PYTHON_AI_ARCHITECTURE.md`
- Operations: `docs/PYTHON_AI_OPERATIONS.md`
- Cloud Run manifest: `python/deploy/service.yaml`

---

## 1. Scale Projections

Numbers below are **defensible estimates with a stated source**. Where we lack data, we say "estimate — confirm with ops". Volume numbers exclude provider (Anthropic + OpenAI) costs, which are tracked separately in `mol_request_logs.inr_cost` and scale with calls.

### Today (Phase 1A baseline — 2026-05-24)

| Metric | Value | Source |
| --- | --- | --- |
| Active functions on Python | 1 (bulk-question-gen, dual-running with TS via proxy) | `supabase/functions/bulk-question-gen/index.ts:32-91` proxy gate |
| Calls/month | ~50 k (bulk-question-gen is admin-triggered nightly cron + manual reseed) | mol_request_logs aggregated across May 2026 |
| p95 latency | ~12 s (single batch of 20 questions) | mol_request_logs.latency_ms percentile |
| Concurrent connections | ~5-10 peak | Cloud Run autoscale metrics (estimate, confirm post-rollout) |
| Cloud Run cost | ₹0 (free tier) | Vercel-billing-account derived; 50 k requests is well under the 2 M/mo free tier |

### 6 months (Phase 3 cutover — Q4 2026)

Trigger: foxy-tutor + ncert-solver + quiz-generator have landed on Python via the same proxy pattern. CEO direction: maintain 100% feature parity during cutover.

| Metric | Value | Derivation |
| --- | --- | --- |
| Active functions on Python | 4 (bulk-question-gen + foxy-tutor + ncert-solver + quiz-generator) | Migration order from `.claude/CLAUDE.md` AI Edge Function table |
| Calls/month | ~1.5 M | Foxy current avg: 1.2 sessions/student/day × 4 AI calls/session × ~10 k DAU × 30 days = ~1.44 M (mol_request_logs May 2026 grouped by `surface='foxy'`) |
| p95 latency | ~3 s (Foxy synchronous), ~15 s (quiz-generator batch) | Current TS Edge Function metrics |
| Concurrent connections | 80-200 peak (Phase 3 trigger threshold) | Foxy traffic 2x peak load × concurrency=80 → 2 instances minimum |
| Cloud Run runtime cost | ~₹400-800/mo | 1.5 M requests × ~1.5 vCPU-s × ~₹0.0003/vCPU-s = ~₹680; egress ~₹50; minScale=0 keeps idle cost zero |

### 12 months (full cutover + organic growth — H1 2027)

Trigger: all 29 Edge Functions ported OR replaced by Python service. Organic growth from CEO national-rollout effort.

| Metric | Value | Derivation |
| --- | --- | --- |
| Calls/month | ~5 M | 1.5 M (Phase 3 baseline) × 3.3x growth (assume 3x student-base growth + organic AI-feature usage uptick) — estimate, confirm with ops |
| Data egress | ~25 GiB/mo | 5 M requests × ~5 KiB egress to Supabase = 25 GiB; first 1 GiB free |
| Storage | unchanged on Python side | Stateless service; storage growth lives in Supabase Postgres (mol_request_logs ~120 bytes/row × 5 M = 600 MB/mo) |
| Cloud Run runtime cost | ~₹1,500-3,000/mo | Linear with calls; egress ~₹350/mo |
| Concurrent connections | 200-600 peak | Phase 3 split-into-multiple-services trigger fires here |

### 24 months (national rollout — H1 2028)

Trigger: CEO's stated 1M+ students national rollout direction (`MEMORY.md → user_pradeep.md`). Conservative assumption: 1M students with 40% MAU and average usage similar to today.

| Metric | Value | Derivation |
| --- | --- | --- |
| Calls/month | ~50 M | 400 k MAU × 4 AI calls/session × 1 session/day × 30 days = 48 M |
| Data egress | ~250 GiB/mo | Linear with calls |
| GPU compute (if embeddings move off OpenAI) | 1-2 L4 GPU instances | Sentence-transformers `all-MiniLM-L6-v2` model on L4 GPU: ~3000 embeddings/sec; 50 M embeddings/mo ~ 200 GPU-hours = ~₹20 k/mo. Compare: OpenAI `text-embedding-3-small` at $0.020/1M tokens × 50 M × ~50 tokens/embedding = $50/mo = ~₹4 k/mo[^embed-cost]. **Decision: stay on OpenAI embeddings until volume crosses ~500 M/mo OR latency/cost ratio shifts.** |
| Cloud Run runtime cost | ~₹15,000-30,000/mo | 50 M requests; egress ~₹3,500/mo; minScale=2-3 (always-warm to absorb burst) |
| Concurrent connections | 1,000-3,000 peak | Phase 5 dedicated-infra evaluation trigger fires here |

**Note**: provider costs (Anthropic + OpenAI) scale with calls and at 50 M/mo would dominate runtime cost by 5-10x. The Cloud Run cost numbers above are runtime-only.

[^embed-cost]: This ₹4 k/mo number covers embedding calls **only** (50 M embeddings/mo at the 24-month projection); Anthropic TEXT-inference costs are tracked separately in `mol_request_logs.inr_cost` and not captured in this row. The "500 M/mo" volume trigger in the decision line above maps to ~₹40-50 k/mo embedding spend at the same per-token rate, which is the same threshold §9 Q3 references as "₹50 k/mo embedding bill". Both wordings are reconciled: §1 expresses the trigger in call volume, §9 Q3 in INR — and they describe the same Phase 5 crossover point.

---

## 2. Architecture Evolution Path

### Phase 1 (now — bulk-question-gen on Python)

**Topology**: single Cloud Run service `ai-services` with multiple routes under `/v1/*`.

```
Edge Function (TS) ──(proxy gate)──> Cloud Run /v1/bulk-question-gen
                  └─(fallback)────> TS legacy path
```

**Rationale**: one service is the right starting point — simpler deploy, simpler observability, and bulk-question-gen alone does not warrant a service split. The proxy gate makes per-function cutover atomic.

### Phase 3 trigger (foxy-tutor lands AND concurrent connections cross ~80)

When the second high-volume function lands (foxy-tutor) AND we observe a sustained concurrent-connections value at or above 80 (the `containerConcurrency` limit in `python/deploy/service.yaml`), **split into per-function services**.

**Recommended split:**

| Service | Routes | Rationale |
| --- | --- | --- |
| `ai-services-foxy` | `/v1/foxy/*` | Streaming response, lowest latency budget, needs `minScale=1` to eliminate cold start |
| `ai-services-quiz` | `/v1/bulk-question-gen`, `/v1/quiz-generator`, `/v1/grade` | Batch workload, tolerates cold start, can stay `minScale=0` |
| `ai-services-cognitive` | `/v1/cme-engine`, `/v1/cognitive-engine` | Higher memory ceiling (~1 GiB) for vector ops |
| `ai-services-admin` | `/v1/embed-*`, `/v1/extract-*`, `/v1/generate-*` | Admin-tier traffic; lower CPU/memory; concurrency=200 |

**What we gain by splitting:**
- **Independent scaling**: Foxy at `minScale=2` doesn't force quiz workloads to pay always-warm cost.
- **Blast-radius isolation**: a memory leak in cognitive-engine doesn't OOM Foxy instances.
- **Function-specific tuning**: streaming responses (Foxy) need different timeouts than batch (quiz). Today both share `timeoutSeconds=300`.
- **Independent rollouts**: a regression in admin endpoints doesn't block a Foxy hotfix.

**Cost of splitting:** 4 services × ~₹100/mo base overhead = ~₹400/mo (negligible vs. the variable cost of compute).

**Trigger metrics (concrete):**
- Concurrent connections sustained ≥ 80 for any 5-minute window in production for 3 consecutive days (Cloud Monitoring metric `run.googleapis.com/container/instance_count`).
- OR foxy-tutor p95 latency > 3 s for 1 hour (cold-start cause confirmed via Cloud Trace).

### Phase 5+ trigger (daily call volume > ~3M, evaluate dedicated infra)

When daily call volume crosses ~3 M (~90 M/month, between Phase 3 cutover and national-rollout projection), evaluate moving high-volume Foxy traffic to GKE Autopilot or specialized GPU instances.

**What to evaluate:**

| Option | Pros | Cons | Cost at 3M/day |
| --- | --- | --- | --- |
| **Stay on Cloud Run** | Zero ops; auto-scale; existing pipeline | Per-request pricing accumulates; cold-start cost; no GPU support | ~₹30-50 k/mo |
| **GKE Autopilot** | Predictable cost; node autoscaling; can run sidecar tasks (sentence-transformers GPU) | Requires ops to manage manifests; cluster overhead | ~₹25-40 k/mo + ops time |
| **Cloud Run + GPU sidecar** | Embeddings move off OpenAI saving ~₹50 k/mo; Cloud Run still serves orchestration | Two runtimes to monitor; Cloud Run cannot directly call GPU sidecars at low latency | ~₹35-45 k/mo all-in |

**Decision: stay on Cloud Run until BOTH (a) call volume crosses 3 M/day AND (b) OpenAI embedding bill crosses ₹50 k/mo.** The Cloud Run pricing is competitive up to that point, and moving runtimes is a 4-6 week project.

### API gateway question

**Recommendation: NOT YET.**

Today the Supabase Edge proxy IS the API gateway — it owns auth (Supabase JWT verification), rate limiting (Upstash Redis), feature-flag-gated cutover, and request-ID propagation. Adding a second gateway (Google Cloud API Gateway, Apigee, Kong) would duplicate these responsibilities.

**Trigger to revisit:** when we have **4 or more** Cloud Run services AND cross-cutting concerns become unmanageable in the Edge proxy (e.g. centralized OpenTelemetry trace stitching, per-tenant rate limits at the gateway layer). That maps to Phase 3+.

---

## 3. Robustness Must-Haves

Categorized by **NOW** (this PR or already-shipped), **PHASE 2** (next 1-2 weeks), **PHASE 3-5** (later phases). Each row has a trigger or a "why now".

| # | Concern | Status | When | Why this priority |
| --- | --- | --- | --- | --- |
| 1 | Health + readiness probes | NOW (this PR) | — | REG-72 fix; Cloud Run gates traffic on this |
| 2 | Stateless service design | NOW (already) | — | Cloud Run requires; no per-instance state |
| 3 | Graceful shutdown (SIGTERM via tini) | NOW (already, Dockerfile) | — | In-flight requests finish on revision swap |
| 4 | Per-request timeouts (300s ceiling) | NOW (already) | — | Defense against pathological prompts |
| 5 | Retry with exponential backoff for provider calls | PHASE 2 (scaffolding shipped in this PR) | Next 1-2 weeks | Anthropic + OpenAI both rate-limit; jittered retries avoid thundering herd |
| 6 | Idempotency keys for write operations | PHASE 2 (scaffolding shipped in this PR) | Next 1-2 weeks | bulk-question-gen could insert duplicates if client retries |
| 7 | Per-instance circuit breaker | NOW (already, handler.py) | — | Works at current scale |
| 8 | Distributed circuit breaker (Redis) | PHASE 4 | When max-instances cross 10 | Per-instance state diverges at scale; one instance's "circuit closed" doesn't help another's |
| 9 | Per-instance LRU cache | NOW (already, partial) | — | Works at current scale |
| 10 | Distributed cache (Redis) | PHASE 4 | When cold-start cache-miss rate > 15% (mol_request_logs cache-hit telemetry) | Otherwise we pay for provider re-calls every cold start |
| 11 | Inbound rate limiting | PHASE 2 | Next 1-2 weeks | Admin endpoints especially — prevent burst-DOS from compromised admin creds |
| 12 | Outbound rate limiting (provider quota) | PHASE 3 | When foxy-tutor adds volume | Avoid hitting Anthropic/OpenAI rate-limits |
| 13 | Per-tenant cost caps | PHASE 5 | White-label SaaS scaling | Per-school billing requirement |
| 14 | Daily org-level INR budget cap | PHASE 2 (scaffolding shipped in this PR) | Next 1-2 weeks | Runaway loops or compromised credentials |
| 15 | OpenTelemetry distributed tracing | PHASE 2 | Next 1-2 weeks | Debugging multi-hop requests becomes essential at scale |
| 16 | Multi-region deploy (DR) | PHASE 5 | When single-region outage = revenue loss | asia-southeast1 (Singapore) standby |
| 17 | Blue/green deploys with traffic splitting | PHASE 3 | When student-facing is on Python | Cloud Run supports natively; we just need to USE it |
| 18 | Secret rotation strategy | PHASE 4 | Enterprise security audit | Secret Manager versions + automated rotation |
| 19 | Async job queue (Pub/Sub / Cloud Tasks) | PHASE 5 | Bulk operations > 60s | Currently bulk-question-gen blocks HTTP for ~30-60s |

### NOW + PHASE 2 implementation notes

**Item 5 — Retry with exponential backoff.** `python/services/ai/shared/retry.py` ships in this PR. Built on `tenacity` (the de-facto Python retry lib; no behavioral lock-in — same API as TS's `p-retry`). Decorator-based so adoption is one-line per provider call. Default config: 3 attempts, 0.5s base, 8s ceiling, exponential with full jitter. Per-call override via decorator args. Tests cover happy path, retry-on-retryable, no-retry-on-non-retryable, max-attempts exhaustion.

**Item 6 — Idempotency keys.** `python/services/ai/shared/idempotency.py` ships in this PR. Reads `Idempotency-Key` header, hashes with `tenant_id` to namespace per-tenant, stores in in-memory `dict` (Phase 4 swaps for Redis). On replay, the wrapped handler returns the cached response. Tests cover happy path, replay detection, namespace isolation, missing-header passthrough.

**Item 14 — Daily INR budget guard.** `python/services/ai/shared/budget_guard.py` ships in this PR. Async function `check_daily_budget(scope='org', cap_inr=5000)` queries `mol_request_logs` for today's `sum(inr_cost)` and returns False (block) when over cap. Default cap from env `DAILY_AI_BUDGET_INR_CAP=5000`. Tests cover under-budget, over-budget, Supabase-unreachable (fail-open with logged warning), scope-isolation (org vs tenant).

**Item 11 — Inbound rate limiting.** Phase 2 follow-up — recommend `slowapi` (Starlette-native) backed by Redis (when shared) or in-memory dict (per-instance Phase 2 floor). Apply at the FastAPI middleware layer with per-route limits keyed by `(student_id, route)`.

**Item 15 — OpenTelemetry tracing.** Phase 2 follow-up — add `opentelemetry-instrumentation-fastapi` + `opentelemetry-exporter-gcp-trace`. Trace stitching joins Supabase Edge proxy `X-Request-Id` to Cloud Run handler spans. Critical for diagnosing slow requests in production once cutover hits 100% traffic.

---

## 4. Observability Roadmap

| Phase | Today | Phase 2 add | Phase 4 add |
| --- | --- | --- | --- |
| Logs | structlog → Cloud Logging (JSON, auto-parsed) | — | log-based metric for cost/PII regression alerts |
| Errors | Sentry (`@sentry/python`) | — | per-task error budget tracking |
| Cost | `mol_request_logs.inr_cost`; super-admin MoL dashboard | cost forecasting (predict month-end spend); daily budget guard (this PR shipped scaffolding) | per-tenant cost dashboard; reserved-capacity recommendation engine |
| Latency | Cloud Run built-in (p50/p95/p99) | OpenTelemetry FastAPI instrumentation → Cloud Trace; per-task latency metric | SLI/SLO definitions (e.g. 99.5% of foxy-tutor < 3s p95); burn-rate alerts |
| Health | `/live` + `/readyz` (REG-72) | synthetic-monitor probe from outside GCP (Pingdom or similar) | end-to-end synthetic from student-app POV |
| Traces | (none) | OpenTelemetry-distributed-trace stitching across Supabase Edge → Cloud Run | sampling strategy (1% prod, 100% staging) |

---

## 5. Security Roadmap

| Phase | Today | Phase 2 add | Phase 4 add | Phase 5 add |
| --- | --- | --- | --- | --- |
| Auth | Workload Identity Federation (no JSON keys); Secret Manager runtime injection | per-request signing for service-to-service calls (HMAC with rotating shared secret) | Secret Manager version pinning + automated rotation | — |
| Authorization | Service-account least-privilege (runtime SA has ONLY `secretmanager.secretAccessor`) | — | OWASP API Top 10 audit | SOC 2 readiness assessment |
| Data | PII redaction in logs + Sentry; CBSE-scope + age-appropriateness filters in prompts | audit log of every flag flip + admin action (Python service writes to `audit_logs` table) | per-tenant data isolation verification across services | SOC 2 readiness (if enterprise customers demand) |
| Network | Cloud Run egress to public internet (Supabase, Anthropic, OpenAI); internet-routable ingress protected by Cloud Run Invoker IAM plus Supabase user auth | egress restriction to known hosts via Cloud Armor | mutual-TLS to Supabase via private VPC peering (if Supabase supports it) | — |
| Secrets | Secret Manager `:latest` pull on revision start | — | version pinning + 90-day rotation schedule | quarterly key rotation; HSM-backed for compliance |

---

## 6. Cost Control Roadmap

| Phase | Today | Phase 2 add | Phase 3 add | Phase 5 add |
| --- | --- | --- | --- | --- |
| Per-request | `mol_request_logs.inr_cost`; per-task `max_tokens` ceiling | per-request budget warning (log if single call > ₹2) | per-tenant `max_tokens` based on plan | reserved capacity for high-volume tenants |
| Per-org | (none) | daily org-level budget hard cap; auto-disable when exceeded (scaffolding this PR) | — | budget forecasting alerts when projected month > target |
| Per-tenant | (none) | — | per-tenant budget caps for white-label SaaS | enterprise-tier reserved capacity |
| Provider | OpenAI primary for cost savings (cme-engine, embeddings) | — | dynamic routing — Claude for high-mastery students, OpenAI for low-mastery (cost arbitrage with quality floor) | dedicated Anthropic enterprise contract if volume warrants |

---

## 7. Migration Strategy (TS → Python)

The Phase 1 pattern (proxy gate + per-function cutover) is the canonical migration approach. **Do not deviate** without explicit architect review.

### Per-function cutover steps

1. **Port the function** to `python/services/ai/business/<function-name>/` with the same Pydantic request/response models as the TS handler.
2. **Add the FastAPI route** in `python/services/ai/api/v1/<function-name>.py`.
3. **Add the proxy gate** in the TS Edge Function — call `pythonAiProxy.tryForward(req)` first; fall back to TS legacy path on any rejection.
4. **Add the catalog entry** in `.claude/regression-catalog.md` pinning request/response parity (REG-73 pattern).
5. **Ramp** via the `metadata.rollout_pct` feature flag — 1% → 10% → 50% → 100% with 24h soak at each step.
6. **Decommission** the TS code only after 30 days at 100% Python traffic with zero regressions.

### Cutover order priority (by volume × risk)

| Order | Function | Why this order |
| --- | --- | --- |
| 1 | bulk-question-gen | DONE (Phase 1) — lowest risk (admin-only, batch), validates the pattern |
| 1a | voice/transcribe (Whisper STT) | DELIVERED 2026-05-24 (Phase 2 — Voice 1a). NEW capability, not a TS port — student-facing speech-to-text via OpenAI Whisper at `POST /v1/voice/transcribe`. Returns transcript + detected_language + duration_seconds + cost_inr. Daily org budget cap via `check_daily_budget`. PII-safe ops_events telemetry. Coverage: 86-100% across new files. Voice 1b (TTS via Azure Indian accent), Voice 2 (frontend wiring in `src/lib/voice.ts`), and Voice 3 (adaptive language end-to-end) follow in successive PRs. |
| 2 | generate-answers | DELIVERED 2026-05-24 (Phase 2). TS Edge Function `verification_state` posture flips to `'pending'` on the Python path so admin verification queues catch every Python-port answer. Auth: `x-admin-key` constant-time check (mirrors TS shared-secret posture; distinct from bulk-question-gen's Supabase user JWT + admin_users lookup). MoL routing: `task_type='explanation'` with `preferred_provider='openai'`. Daily org INR budget guard runs before the LLM call. PII-safe ops_events `quiz.answer_generated` + `quiz.answer_generation_failed` rows on every per-question outcome. Phase 2.1 follow-up: wire RAG retrieval into the Python handler (currently uses the "no NCERT reference material" prompt branch — see generate_answers/handler.py rag_context note). Coverage on new files: 71-100% (avg ~85%). Edge proxy + `ff_python_generate_answers_v1` flag shipped 2026-05-24 (default OFF, `rollout_pct=0`). Awaiting Cloud Run setup + `PYTHON_AI_BASE_URL` env wiring before first 10% ramp. |
| 3 | foxy-tutor | Highest impact (student-facing); streaming responses; biggest test of the proxy |
| 4 | ncert-solver | Lower volume than Foxy but same shape (RAG + LLM); validates Phase 3 split |
| 5 | quiz-generator | Quality-critical (REG-54 oracle gate); needs careful parity testing |
| 6 | cme-engine | Cognitive engine; highest memory footprint; service split (Phase 3) target |
| 7-29 | Remaining non-AI Edge Functions | Low risk, can batch-port once Phases 1-6 are stable |

### Phase 6 decommission rules

1. Function has been at 100% Python traffic for ≥ 30 days.
2. Zero P0/P1 regressions in that 30-day window.
3. mol_request_logs shows Python and TS rows are byte-for-byte identical in `usd_cost`/`inr_cost`/`prompt_tokens`/`completion_tokens` shape.
4. Architect-signed migration ticket linking the three above.
5. Delete TS code in a single PR (no partial deletion — atomic so revert is one click).

---

## 8. Key Decisions LOCKED IN

These are **decided** and not up for revisit without explicit CEO sign-off.

| Decision | Locked by | Trade-offs |
| --- | --- | --- |
| Cloud Run + FastAPI + Python 3.12 | CEO directive (TS→Python rewrite approval) | Alternatives (Cloud Functions gen2, GKE, App Engine) ruled out for cold-start + operational-overhead reasons |
| asia-south1 single region for now | architect (matches Vercel `bom1` + Supabase ap-south-1) | DR is Phase 5 — single-region outage = ~hours of degraded service until Edge proxy falls back to TS path |
| Workload Identity Federation, no JSON keys | architect (security default) | Locked — never create a JSON SA key for deploy or runtime |
| Stable URLs via Edge proxy during transition | architect (cutover safety) | TS Edge Function URLs remain the public contract; Cloud Run URLs are internal-only |
| mol_request_logs row shape unchanged across runtimes | ai-engineer (dashboard preservation) | Adding a column requires a migration AND both runtimes to write it; no one-sided field additions |
| Pydantic `extra='forbid'` on request models | architect (REG-73 contract enforcement) | Strict-mode rejection means TS + Python must update together; opt-in to loose schemas requires explicit waiver |
| Cloud Run service manifest declarative (not CLI flags) | architect (REG-72 fix, this PR) | All runtime posture in `python/deploy/service.yaml`; flag changes require git PR |

---

## 9. Open Questions for CEO

These need a decision before Phase 4/5 work begins. Each has an architect recommendation but the call is the CEO's.

### Q1: Multi-region DR (asia-southeast1 Singapore standby) — YES/NO?

- **Cost**: ~₹500-1,500/mo extra (idle standby) + 2x revision-replication overhead
- **Risk if NO**: asia-south1 zone failure = ~hours of degraded service until Edge proxy fully falls back to TS legacy paths
- **Risk if YES**: ops complexity (2 regions to monitor + maintain)
- **Architect recommendation**: NO for now. Trigger to revisit: Cloud Run asia-south1 has a multi-hour outage in production OR enterprise customer contracts require multi-region SLA.

### Q2: Distributed cache — Memorystore (GCP) vs Upstash Redis (existing vendor)?

- **Memorystore basic-1GB**: ~₹3,000/mo; GCP-native; no egress cost from Cloud Run
- **Upstash Redis pay-as-you-go**: ~₹500-2,000/mo; existing vendor (already used for Next.js rate-limit); cross-cloud egress overhead (~50-100ms vs Memorystore's <5ms)
- **Architect recommendation**: Upstash for Phase 4. Existing operational footprint, half the cost. Switch to Memorystore only if intra-VPC latency becomes a measurable user-facing problem.

### Q3: Embeddings self-hosting vs OpenAI?

- **Self-hosted sentence-transformers on L4 GPU**: ~₹20 k/mo per GPU instance; one-time engineering cost; full control over model versioning; cold-start kills batch processing
- **OpenAI text-embedding-3-small**: $0.020/1M tokens; current ~₹4 k/mo; no infra; provider lock
- **Architect recommendation**: STAY on OpenAI until embedding bill crosses ~₹50 k/mo OR latency becomes a feature blocker. The crossover is ~Phase 5 (24-month projection); see §1's 24-month embedding-cost footnote for the volume↔INR mapping (₹50 k/mo ≈ 500 M embeddings/mo at current OpenAI pricing).

### Q4: Per-tenant cost caps — implement now or wait?

- **NOW**: ~3 days engineering; requires `tenant_id` plumbing in every Python handler + Supabase Edge Function
- **WAIT for first enterprise customer**: zero work now; ~1-2 week scramble when first enterprise sales signal lands
- **Architect recommendation**: WAIT. The scaffolding (org-level budget guard) shipped in this PR is the precondition; per-tenant extension is a 3-day follow-up once a customer signals.

### Q5: SOC 2 readiness — pursue now or wait for enterprise signal?

- **NOW**: 12-month effort; ~₹15-25 lakhs in consulting + audit fees; locks engineering velocity into compliance work
- **WAIT for enterprise signal**: ~2-3 week sales delay when a customer asks; loss of one or two enterprise deals worst case
- **Architect recommendation**: WAIT until at least one enterprise prospect explicitly cites SOC 2 as a blocker. Document SOC 2 readiness gaps in `docs/security-compliance.md` so the scramble is bounded when it comes.

---

## 10. Anti-Patterns to AVOID

These are mistakes we have caught ourselves about to make, or have seen at peer companies, or are well-documented in cloud-architecture literature. **PRs that walk into any of these MUST be rejected on review.**

1. **Premature optimization.** Do not add Redis until per-instance cache becomes a real bottleneck (cache-miss rate > 15% in mol_request_logs telemetry). Do not add a distributed circuit breaker until per-instance is provably insufficient.

2. **Over-engineering for hypothetical scale.** Do not split into microservices until concurrency forces it (≥80 sustained per instance for 3 days). Do not introduce an API gateway until we have 4+ Cloud Run services with cross-cutting concerns.

3. **Vendor lock-in beyond necessary.** Avoid GCP-specific APIs in business code. Use OpenTelemetry, not Cloud Trace SDK directly. Use standard Python libs (httpx, structlog), not GCP-specific clients. The Cloud Run + Secret Manager + Cloud Logging surface is the locked-in cost we accept; everything above that is portable.

4. **Custom infrastructure when managed services exist.** Use Cloud Run, not custom Kubernetes. Use Secret Manager, not Vault on a VM. Use Cloud Logging, not self-hosted ELK. The cost of managed services is dwarfed by the cost of ops time.

5. **Synchronous bulk operations longer than 30s.** Long blocking HTTP requests are bad — they trigger client timeouts, can't be retried safely, and tie up Cloud Run concurrency slots. Phase 5 moves bulk-question-gen to async queue (Pub/Sub or Cloud Tasks).

6. **Silent failure paths.** Every error must be logged with `structlog` AND classified (retryable / not retryable / circuit-breaker-eligible). Swallowing exceptions is only acceptable in observability code (telemetry must never break the user request) and even then must log.

7. **Touching `quiz-generator-v2/`.** It does not exist on disk. Constitution corrected 2026-05-04. Any reference is a documentation bug.

8. **Bypassing the proxy gate.** Never call a Cloud Run URL directly from client code. The TS Edge Function URLs are the public contract; Cloud Run URLs are internal-only.

9. **Changing P1-P13 product invariants in Python without parity in TS.** Any change to scoring, XP, anti-cheat, atomic submission, grade format, question quality, bilingual UI, RLS, RBAC, bundle budget, payment integrity, AI safety, or data privacy MUST land in both runtimes simultaneously.

10. **Editing this document without architect + ai-engineer + ops sign-off.** This document is a contract. Drift between document and reality is the bug, not the document.

---

## Appendix: Trigger Cheatsheet

| Trigger | Action |
| --- | --- |
| Concurrent connections sustained ≥ 80 for 3 days | Split into per-function services (Phase 3) |
| Daily call volume > 3 M | Evaluate GKE Autopilot / GPU sidecar (Phase 5) |
| Cache-miss rate > 15% (mol_request_logs telemetry) | Add Redis distributed cache (Phase 4) |
| Max-instances cross 10 | Add Redis distributed circuit breaker (Phase 4) |
| Cloud Run asia-south1 multi-hour outage | Stand up asia-southeast1 standby (Phase 5) |
| OpenAI embedding bill > ₹50 k/mo | Evaluate self-hosted sentence-transformers (Phase 5) |
| First enterprise prospect cites SOC 2 | Begin SOC 2 readiness work |
| First enterprise prospect requires per-tenant cost caps | Extend org-level budget guard to per-tenant |
| 4+ Cloud Run services with shared cross-cutting concerns | Evaluate API gateway (Phase 5+) |
| bulk-question-gen synchronous duration > 60s consistently | Move to async Pub/Sub / Cloud Tasks (Phase 5) |
