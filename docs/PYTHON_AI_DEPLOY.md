# Python AI Services — Deploy Runbook

Owner: architect (infra), ops (operations). Last updated: Phase 0.

This runbook covers everything ops needs to ship `python/services/ai/` (FastAPI on Cloud Run, `asia-south1`). Phase 0 = deploy pipeline + first prod-ready container. No traffic is routed to Cloud Run from production users yet — that comes in Phase 1A via the Edge proxy pattern.

Companion docs:
- Architecture: `docs/PYTHON_AI_ARCHITECTURE.md`
- Long-term vision: `docs/PYTHON_AI_LONG_TERM_VISION.md`
- Pipeline: `.github/workflows/python-ai-deploy.yml`
- Cloud Run manifest: `python/deploy/service.yaml`
- Image: `python/Dockerfile`

---

## 1. GCP project setup (one-time, manual by ops)

These commands run **once per environment**. They cannot live in CI because creating a GCP project requires a Google account that owns the billing record. Replace `<PROJECT_ID>`, `<BILLING_ACCOUNT_ID>`, and `<GITHUB_OWNER>/<REPO>` with real values.

Suggested naming (open question — confirm with CEO before running):
- Production project ID: `alfanumrik-ai-prod` (12 chars; GCP project IDs are 6–30 chars, lowercase + digits + hyphens, must start with a letter)
- Staging project ID: `alfanumrik-ai-staging`
- Same Cloud Run service name (`ai-services`) in both projects — environment is the project boundary.

### 1.1 Create the project and link billing

```bash
PROJECT_ID="alfanumrik-ai-prod"
BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX"   # gcloud billing accounts list
ORG_ID=""                                    # leave blank if no GCP org

gcloud projects create "$PROJECT_ID" \
  --name="Alfanumrik AI Services (prod)" \
  ${ORG_ID:+--organization="$ORG_ID"}

gcloud beta billing projects link "$PROJECT_ID" \
  --billing-account="$BILLING_ACCOUNT_ID"

gcloud config set project "$PROJECT_ID"
```

### 1.2 Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com
```

`iamcredentials` + `sts` are required for Workload Identity Federation. `cloudbuild` is only needed if we ever fall back to `gcloud run deploy --source` — the GHA pipeline builds images itself, so this is precautionary.

### 1.3 Artifact Registry

```bash
gcloud artifacts repositories create ai-services \
  --repository-format=docker \
  --location=asia-south1 \
  --description="Alfanumrik AI service container images"
```

### 1.4 Runtime service account

This account is what the Cloud Run container runs **as**. It needs to read secrets. Invocation permission is granted only to specific callers on the specific Cloud Run service, never project-wide.

```bash
RUNTIME_SA="ai-services-runtime"

gcloud iam service-accounts create "$RUNTIME_SA" \
  --display-name="Cloud Run runtime — ai-services"

RUNTIME_SA_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

### 1.5 Deploy service account

This account is what **GitHub Actions impersonates** to push images and trigger deploys.

```bash
DEPLOY_SA="ai-services-deployer"

gcloud iam service-accounts create "$DEPLOY_SA" \
  --display-name="GitHub Actions deployer — ai-services"

DEPLOY_SA_EMAIL="${DEPLOY_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

# Push to Artifact Registry
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

# Manage Cloud Run services
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role="roles/run.admin"

# Read project IAM so CI can fail if a project-level broad invoker is inherited.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role="roles/browser"

# Permission to "act as" the runtime SA when deploying — without this,
# `gcloud run deploy --service-account=<runtime>` returns
# "PERMISSION_DENIED: iam.serviceAccounts.actAs".
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA_EMAIL" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"
```

The deploy workflow grants the deployer `roles/run.invoker` on `ai-services` so its authenticated smoke tests can run. On every deploy it also re-enables the Cloud Run invoker IAM check, removes service-level `allUsers` and `allAuthenticatedUsers`, and fails if either the service or project IAM policy contains a broad `roles/run.invoker` grant. Do not add project-wide `roles/run.invoker` bindings.

Project IAM inspection does not prove that a folder or organization ancestor lacks an inherited broad grant. An administrator with the required Resource Manager visibility must inspect every parent folder and organization policy and record evidence that neither broad principal has `roles/run.invoker`. Keep `ENABLE_PYTHON_AI_PRODUCTION_DEPLOY` absent/false until that ancestor audit is complete; CI cannot claim full private containment from the service policy alone.

### 1.5a Private invocation contract

The intended private contract requires a trusted server caller to have `roles/run.invoker` on the `ai-services` service, mint a short-lived Google ID token whose audience is the exact Cloud Run service URL, and send it in `X-Serverless-Authorization`. The end user's verified Supabase access token remains in `Authorization`; Cloud Run consumes the former header and leaves the latter for FastAPI authorization. Do not enable deployment or user traffic until the ancestor-IAM audit above confirms there is no inherited broad invoker.

The current browser voice client and Supabase Edge proxy cannot mint this Google identity token with the repository's present credentials. Until a trusted server-side proxy implements this contract, keep `NEXT_PUBLIC_PYTHON_AI_BASE_URL` empty, keep `PYTHON_AI_BASE_URL` unset, and leave the Python-routing feature flags OFF. Browser voice continues to use its Web Speech fallback. Never embed a service-account key or static Google identity token in browser code, Vercel public environment variables, Supabase source, or repository secrets.

### 1.6 Workload Identity Federation for GitHub Actions

This is the security-critical step. **Never create a JSON key for the deploy SA.** WIF lets GitHub Actions present an OIDC token, which GCP exchanges for a short-lived credential.

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
GITHUB_REPO="<GITHUB_OWNER>/<REPO>"           # e.g. alfanumrik/alfanumrik

# 1. Workload Identity Pool (one per environment)
gcloud iam workload-identity-pools create github \
  --location=global \
  --display-name="GitHub Actions"

# 2. OIDC provider inside the pool
gcloud iam workload-identity-pools providers create-oidc github-actions \
  --location=global \
  --workload-identity-pool=github \
  --display-name="GitHub Actions OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner,attribute.ref=assertion.ref,attribute.environment=assertion.environment" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}' && assertion.ref == 'refs/heads/main' && assertion.environment == 'Production'"

# 3. Let the GitHub repo impersonate the deploy SA
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}"

# Print the provider resource — this is what goes into the GitHub secret
echo "WORKLOAD_IDENTITY_PROVIDER value to copy into GitHub secret:"
echo "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github-actions"
```

The `attribute-condition` blocks forks, non-main refs, and jobs outside the protected `Production` environment from impersonating the deploy SA. The capitalization matches the canonical live GitHub Environment name and therefore the OIDC claim exactly. Do not loosen it. If the provider already exists, update it to include the `ref` and `environment` mappings and this condition before enabling deployment.

### 1.7 Secret Manager entries

Same five secrets the existing Supabase Edge Functions use. Source: `python/.env.example`. Use the **same values** as in `supabase secrets list` for the prod Supabase project (`shktyoxqhundlvkiwguu`) — this is a deliberate single-source-of-truth requirement so cost telemetry and AI behavior do not diverge between Edge and Cloud Run during cutover.

```bash
# Anthropic Claude
printf '%s' '<paste sk-ant-... here>' | \
  gcloud secrets create anthropic-api-key --data-file=- --replication-policy=automatic

# OpenAI
printf '%s' '<paste sk-proj-... here>' | \
  gcloud secrets create openai-api-key --data-file=- --replication-policy=automatic

# Supabase service role + URL (prod values)
printf '%s' '<paste service role JWT>' | \
  gcloud secrets create supabase-service-role-key --data-file=- --replication-policy=automatic

printf '%s' 'https://shktyoxqhundlvkiwguu.supabase.co' | \
  gcloud secrets create supabase-url --data-file=- --replication-policy=automatic

# Sentry (optional — leave blank to disable)
printf '%s' '<paste DSN or empty string>' | \
  gcloud secrets create sentry-dsn --data-file=- --replication-policy=automatic
```

To rotate a secret later:

```bash
printf '%s' '<new value>' | gcloud secrets versions add anthropic-api-key --data-file=-
```

The workflow keeps the container image SHA-pinned. A new Cloud Run revision resolves each Secret Manager binding's `latest` version, so redeploy (or run `gcloud run services update ai-services --region=asia-south1`) for a secret rotation to take effect.

---

## 2. GitHub Production environment and secrets

The canonical GitHub Environment is named `Production`, but a read-only audit on 2026-07-11 found **zero protection rules and no deployment-branch policy**. Production delivery must remain disabled. Add an independent required reviewer, enable "prevent self-review" where the plan supports it, and restrict deployment branches to `main`. The build, deploy, and smoke jobs all enter this environment, so the configured approval boundary will cover every job that receives a GCP credential.

The same audit found the GCP identity inputs at repository scope. Move these four values to **environment secrets** under `Production`, verify the workflow can resolve them only after environment approval, then remove the repository-scoped copies:

| Name | Value source | Example |
| --- | --- | --- |
| `GCP_PROJECT_ID` | from step 1.1 | `alfanumrik-ai-prod` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | printed at end of step 1.6 | `projects/123456789/locations/global/workloadIdentityPools/github/providers/github-actions` |
| `GCP_SERVICE_ACCOUNT` | from step 1.5 | `ai-services-deployer@alfanumrik-ai-prod.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | from step 1.4 | `ai-services-runtime@alfanumrik-ai-prod.iam.gserviceaccount.com` |

After environment protections, environment-scoped secrets, the WIF claim condition in step 1.6, and the parent-IAM audit have all been independently verified, set the repository Actions variable `ENABLE_PYTHON_AI_PRODUCTION_DEPLOY=true`. It is absent/false by default, so credentialed build, deploy, and smoke jobs remain skipped while the normal PR/main Python test job still runs. Remove or set the variable to `false` for an immediate deployment freeze; this gate does not replace environment approval, WIF restrictions, or IAM review.

Manual staging delivery is suspended. Do not add `workflow_dispatch` back until staging has a separate GCP project, deploy/runtime service accounts, secrets, GitHub `staging` environment with reviewers and branch restrictions, and a WIF provider conditioned on its exact staging ref and environment. A staging path must be unable to select production credentials or the production service. The current workflow can deploy production only from an explicitly enabled push to `main`.

---

## 2a. Cloud Run service manifest (`python/deploy/service.yaml`)

Cloud Run configuration lives in `python/deploy/service.yaml` — a declarative Knative-on-Cloud-Run service manifest. The deploy workflow renders it (via `envsubst`) and applies with `gcloud run services replace`. **Do not edit deploy posture via CLI flags** — every knob (CPU, memory, concurrency, probes, scaling, env vars, secret bindings) is in the manifest.

### Why declarative

1. **REG-72 — readiness probe wiring.** `gcloud run deploy` does not expose `startupProbe.httpGet.path`. Without the manifest, Cloud Run falls back to a TCP-port-8080 startup probe, which routes traffic to a container that has not yet validated Supabase or provider keys. The manifest pins the probe to `/readyz`.
2. **Audit trail.** Every change to runtime posture shows up in git diff.
3. **GitOps-ready.** Future migration to Config Connector / ACM is a one-line change in the workflow, not a rewrite.

### Probe semantics

| Probe | Endpoint | Period | Failure threshold | What happens on failure |
| --- | --- | --- | --- | --- |
| `startupProbe` | `/readyz` | 5s (after 5s delay) | 10 | Cloud Run does NOT add the instance to the load-balancer pool; revision rollout marks the instance unhealthy. Up to 55s total grace for cold start. |
| `livenessProbe` | `/live` | 30s | 3 | Cloud Run SIGTERMs the container and starts a new one. 90s total grace. Path is `/live` (not `/healthz`) because Cloud Run's frontend intercepts `/healthz` before it reaches the container — confirmed 2026-05-24. |
| (steady-state readiness) | implicit | — | — | Cloud Run gen2 does not re-poll a readiness probe after startup. Clients must retry transient 5xx with backoff. |

**Cold-start behaviour.** With `autoscaling.knative.dev/minScale=0` (default), the first request after a period of inactivity pays a cold-start cost of ~3-8s for the container plus up to 5s for the first startup-probe success. To eliminate cold starts for production traffic, set `minScale=1`. Cost: ~₹600/mo per always-warm instance. Recommendation: keep `minScale=0` until foxy-tutor lands on Python (Phase 3) and the p95-latency budget becomes hostile to cold starts.

### Modifying the manifest

1. Edit `python/deploy/service.yaml`.
2. Validate locally: `python -c "import yaml; yaml.safe_load(open('python/deploy/service.yaml'))"`.
3. Open a PR. The `Render Cloud Run manifest` step in `python-ai-deploy.yml` re-validates with `envsubst` + `yaml.safe_load` before any `gcloud` call runs.
4. On merge, the apply happens automatically; the rendered manifest is printed in the workflow log for audit.

### Manifest variables

The workflow substitutes these tokens before applying:

| Token | Source | Example |
| --- | --- | --- |
| `${IMAGE_TAG}` | reconstructed in the `deploy` job from `build-and-push.outputs.image_sha` + secret `GCP_PROJECT_ID` + the `GCP_REGION`/`ARTIFACT_REPO` constants | `asia-south1-docker.pkg.dev/<project>/ai-services/api:<sha>` |
| `${RUNTIME_SERVICE_ACCOUNT}` | secret `GCP_RUNTIME_SERVICE_ACCOUNT` | `ai-services-runtime@<project>.iam.gserviceaccount.com` |
| `${ENVIRONMENT}` | fixed workflow constant | `production` |
| `${ALLOWED_ORIGINS}` | fixed workflow constant | `https://alfanumrik.com` |

The token whitelist is explicit in `envsubst '...'` so any unintended `${...}` literal in the YAML survives unmodified.

#### Why `IMAGE_TAG` is reconstructed, not passed across jobs

The `build-and-push` job exposes **only** the non-secret short SHA as its cross-job output (`image_sha`), never the full registry URL. The full URL embeds `secrets.GCP_PROJECT_ID`, and GitHub Actions **blanks any cross-job `output` whose value contains a secret**. Previously the build job forwarded the full `image_tag`; the deploy job received an empty string, and `gcloud run services replace` rejected the empty `image:`. The `deploy` job now re-reads `secrets.GCP_PROJECT_ID` locally and rebuilds the identical URL from the SHA + the `GCP_REGION`/`ARTIFACT_REPO` constants — same registry, repo, and tag that were pushed. No GitHub config change is required. (A future durable cleanup is to reclassify `GCP_PROJECT_ID` as a non-secret `vars.*` variable, which would let the full URL cross jobs again; tracked separately.)

---

## 3. First deploy (end-to-end smoke)

1. Make a trivial change inside `python/` on a feature branch.
2. Open a PR. CI runs only the `test` job (ruff + mypy + pytest). Verify it goes green.
3. Confirm the `Production` environment, WIF restrictions, parent-IAM evidence, and explicit enable variable from section 2 are active, then merge to `main`. The workflow runs `test` → `build-and-push` → `deploy` → `post-deploy-smoke`.
4. Confirm the workflow summary shows:
   - Image pushed to `asia-south1-docker.pkg.dev/<PROJECT_ID>/ai-services/api:<sha>`
   - `/live` returned 200
   - `/readyz` returned 200; every non-200 status fails the deployment
5. From an identity with service-scoped `roles/run.invoker`, test the printed URL with a short-lived Google ID token:
   ```bash
   URL="https://ai-services-XXXXXX-as.a.run.app"
   ID_TOKEN="$(gcloud auth print-identity-token --audiences="${URL}")"
   curl --header "X-Serverless-Authorization: Bearer ${ID_TOKEN}" "${URL}/live"
   ```

If the first deploy fails on `iam.serviceAccounts.actAs`, re-check step 1.5 — the deploy SA needs `roles/iam.serviceAccountUser` on the **runtime SA**, not on the project.

---

## 4. Rollback

Cloud Run keeps the previous revision around indefinitely. To revert traffic:

```bash
gcloud run services describe ai-services \
  --region=asia-south1 \
  --format="value(status.traffic)"
# Find the previous revision name, e.g. ai-services-00007-xyz

gcloud run services update-traffic ai-services \
  --region=asia-south1 \
  --to-revisions=ai-services-00007-xyz=100
```

For a fast revert from CI: re-run the previous successful `Python AI Services — CI/CD` workflow run from the Actions tab; it will redeploy that commit's image.

---

## 5. Logs and metrics

```bash
# Tail the last 100 log entries (most recent first)
gcloud run services logs read ai-services \
  --region=asia-south1 \
  --limit=100

# Stream in near-real-time
gcloud run services logs tail ai-services --region=asia-south1
```

Cloud Run UI: `https://console.cloud.google.com/run/detail/asia-south1/ai-services/metrics?project=<PROJECT_ID>` — built-in graphs for request count, latency (p50/p95/p99), instance count, and container CPU/memory.

Structured logs from `structlog` are JSON-formatted; Google Cloud Logging parses them automatically and they become filterable by field (`request_id`, `student_id`, `surface`, etc.).

Sentry events route to the same project as the Next.js app; filter by `tags.service = ai-services` (the FastAPI app sets this in its Sentry init).

---

## 6. Cost expectations

Cloud Run's free tier per **billing account**:
- 2 million requests / month
- 360,000 vCPU-seconds / month
- 180,000 GiB-seconds / month
- Egress: 1 GiB / month to internet (free to GCP services in same region)

At the current `512 MiB, 1 vCPU, concurrency=80` configuration, a request that holds a CPU for ~1.5s consumes ~1.5 vCPU-s and ~0.75 GiB-s. The free tier covers roughly 240 k such requests/day.

Projected load (Phase 1A bridge): bulk-question-gen does the heavy lifting on a nightly cron, ~10 k requests/night. Interactive surfaces (Foxy, NCERT solver) average ~20 k/day. Total ~30 k/day, well inside free tier.

**Estimated cost:**
| Month | Notes | INR |
| --- | --- | --- |
| 1 | Phase 0/1A bridge, low traffic | ~₹0 |
| 6 | Phase 3 cutover (Foxy + NCERT solver moved) | ~₹200–500 |
| 12 | All AI on Cloud Run, growing user base | ~₹800–2,000 |

These exclude provider costs (Anthropic + OpenAI), which are billed separately and unchanged by the runtime move.

Egress charge to watch: every call from Cloud Run → Supabase is internet egress *unless* both sit on the same network. Supabase is hosted outside GCP, so expect a small egress line item once volume grows. At 30 k requests/day with ~5 KiB egress per call that's ~4.4 GiB/month — ~₹15/month after the 1 GiB free allowance.

---

## 7. Region rationale

`asia-south1` (Mumbai) is the only sensible choice:
- Matches Vercel `bom1` (Mumbai) so request flow stays in-region.
- Matches Supabase project region (Singapore is the next-closest; Mumbai is the only India region today). Cross-region Supabase calls add ~50 ms.
- User base is 100% India today.
- Latency from a Mumbai user → Cloud Run Mumbai: ~10–30 ms median.

Do not deploy to `us-central1` "for cheaper egress" — that would add 200+ ms per request, breaking the streaming Foxy UX.

---

## 8. Troubleshooting cheatsheet

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `gcloud run deploy` fails with `iam.serviceAccounts.actAs` | Deploy SA lacks `serviceAccountUser` on runtime SA | Re-run step 1.5 last command |
| Image push fails with `denied: permission "artifactregistry.repositories.uploadArtifacts" denied` | Deploy SA missing `roles/artifactregistry.writer` | Re-run the binding in step 1.5 |
| `/readyz` returns 503 with "provider key missing" | Secret Manager binding missing or runtime SA lacks accessor | Check step 1.4 + 1.7; redeploy |
| Workflow stuck on `Authenticate to GCP` | Wrong provider or repository/ref/environment claim mismatch | Re-check step 1.6 mappings and condition; the job must be a `main` push in the canonical `Production` environment |
| Container OOMs (memory > 512 MiB) | Heavy concurrent vector requests | Bump `--memory=1Gi` in `python-ai-deploy.yml` |
| Cold start > 5 s | Heavy imports at module load | Audit `services/ai/api/main.py` for top-level work; or set `--min-instances=1` (costs ~₹600/mo) |

---

## 9. Open follow-ups (track via issues)

- [ ] Confirm GCP project naming with CEO before running step 1.1.
- [ ] Decide whether to create a separate billing account for AI services or share with the existing Vercel/Supabase billing.
- [ ] Design a separately credentialed and ref-scoped staging delivery path before restoring manual staging deploys.
- [ ] Add Cloud Run uptime check + PagerDuty/Slack alerting before any production traffic is routed.
- [ ] Pin the Python base image to a SHA digest once we cut a release tag.
