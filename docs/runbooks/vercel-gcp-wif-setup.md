# Vercel → Cloud Run keyless auth (Workload Identity Federation) — GCP setup

> **REVIEW — DO NOT RUN until the CEO greenlights the supervised window.**
> Every command below is `gcloud` against the **live** `alfanumrik-ai-prod`
> project. Nothing here is executed by CI. Run each block by hand, in order,
> during the agreed window, and paste the readback output back into the PR /
> incident thread. Owner: architect. Reviewers: ops, backend.

## What this wires up

Keyless authentication for the Node **Foxy perception** client
(`packages/lib/src/ai/clients/python-mol.ts`) calling the Invoker-IAM-enforced
Cloud Run service `ai-services` (asia-south1). No JSON service-account key ever
touches Vercel. At runtime the client:

1. reads the request-scoped Vercel OIDC token (`getVercelOidcToken()`),
2. exchanges it at Google STS via Workload Identity Federation and impersonates
   the `vercel-cloudrun-invoker` service account,
3. calls `iamcredentials … :generateIdToken` (aud = the Cloud Run service URL),
4. sends that ID token as `X-Serverless-Authorization: Bearer <idToken>` (the
   student JWT stays in `Authorization`).

We create **two separate pools** — one for Vercel **production** deployments,
one for **preview/staging** — so the two environments never share a trust
boundary and can be ramped/rotated independently.

## Prerequisites

- `gcloud` authenticated as an `alfanumrik-ai-prod` **owner** (or a principal
  with `roles/iam.workloadIdentityPoolAdmin`, `roles/iam.serviceAccountAdmin`,
  and `roles/run.admin`).
- The Cloud Run service `ai-services` already exists in `asia-south1`
  (service URL `https://ai-services-518404877846.asia-south1.run.app`).
- Confirm the exact Vercel claims before running (these are pinned assumptions):
  - Issuer (Team mode): `https://oidc.vercel.com/pradeep-sharmas-projects-3dc48378`
  - `owner` claim (team slug): `pradeep-sharmas-projects-3dc48378`
  - `project` claim: `alfanumrik` — **CONFIRM** in the Vercel dashboard
    (Project → Settings → Environment Variables → OIDC, or decode a live token)
    that the `project` claim value is exactly `alfanumrik` and not the `prj_…`
    ID. If it is the ID, substitute it in the two attribute-conditions below.
  - Default audience (Team mode): `https://vercel.com/pradeep-sharmas-projects-3dc48378`
    — **CONFIRM** against a live token's `aud` claim before pinning
    `--allowed-audiences`.

## Step 0 — shared variables + enable APIs

```bash
# ── Shared shell variables (re-export in each new shell before pasting) ──
export PROJECT_ID="alfanumrik-ai-prod"
export REGION="asia-south1"
export SERVICE="ai-services"
export SA_NAME="vercel-cloudrun-invoker"
export SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

export VERCEL_ISSUER="https://oidc.vercel.com/pradeep-sharmas-projects-3dc48378"
export VERCEL_TEAM_SLUG="pradeep-sharmas-projects-3dc48378"
export VERCEL_PROJECT="alfanumrik"
export VERCEL_DEFAULT_AUDIENCE="https://vercel.com/pradeep-sharmas-projects-3dc48378"

# Pool / provider IDs (two independent pools).
export POOL_PROD="vercel-prod"
export PROVIDER_PROD="vercel-prod-oidc"
export POOL_STAGING="vercel-staging"
export PROVIDER_STAGING="vercel-staging-oidc"

# Resolve the numeric project number (expected: 518404877846 — the number
# embedded in the Cloud Run service URL). Used to build STS principals.
export PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" \
  --format='value(projectNumber)')"
echo "PROJECT_NUMBER=${PROJECT_NUMBER}   # expect 518404877846"

# Enable the APIs the exchange + mint depend on (idempotent).
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  run.googleapis.com \
  --project="${PROJECT_ID}"
```

## Step 1 — service account

```bash
# Idempotent-ish: re-running `create` errors if it exists; that is fine — the
# SA only needs to be created once. Do NOT delete/recreate to "retry".
gcloud iam service-accounts create "${SA_NAME}" \
  --project="${PROJECT_ID}" \
  --display-name="Vercel -> Cloud Run invoker (keyless WIF)" \
  --description="Impersonated by Vercel OIDC to mint Cloud Run ID tokens for ai-services. No JSON key."
```

## Step 2 — PRODUCTION pool + OIDC provider

```bash
gcloud iam workload-identity-pools create "${POOL_PROD}" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="Vercel production" \
  --description="Vercel OIDC (environment=production) -> ai-services invoker"

gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_PROD}" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="${POOL_PROD}" \
  --display-name="Vercel prod OIDC" \
  --issuer-uri="${VERCEL_ISSUER}" \
  --allowed-audiences="${VERCEL_DEFAULT_AUDIENCE}" \
  --attribute-mapping="google.subject=assertion.sub" \
  --attribute-condition="assertion.owner=='pradeep-sharmas-projects-3dc48378' && assertion.project=='alfanumrik' && assertion.environment=='production'"
```

## Step 3 — STAGING (preview) pool + OIDC provider

Same issuer + audience; the ONLY difference is `environment=='preview'`.

```bash
gcloud iam workload-identity-pools create "${POOL_STAGING}" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --display-name="Vercel staging" \
  --description="Vercel OIDC (environment=preview) -> ai-services invoker"

gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_STAGING}" \
  --project="${PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="${POOL_STAGING}" \
  --display-name="Vercel staging OIDC" \
  --issuer-uri="${VERCEL_ISSUER}" \
  --allowed-audiences="${VERCEL_DEFAULT_AUDIENCE}" \
  --attribute-mapping="google.subject=assertion.sub" \
  --attribute-condition="assertion.owner=='pradeep-sharmas-projects-3dc48378' && assertion.project=='alfanumrik' && assertion.environment=='preview'"
```

## Step 4 — bind the production subject principal to the SA

`google.subject` maps from `assertion.sub`, whose value for a Vercel production
deployment is
`owner:pradeep-sharmas-projects-3dc48378:project:alfanumrik:environment:production`.
Bind exactly that subject (NOT a wildcard) so only production can impersonate.

```bash
export PRINCIPAL_PROD="principal://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_PROD}/subject/owner:pradeep-sharmas-projects-3dc48378:project:alfanumrik:environment:production"

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${PRINCIPAL_PROD}"
```

> Staging binding is DEFERRED (the AWS/staging invoker path is not being armed
> in this window). When staging is armed, bind the analogous preview subject
> `…/workloadIdentityPools/${POOL_STAGING}/subject/owner:…:project:alfanumrik:environment:preview`
> with the same `roles/iam.workloadIdentityUser` role.

## Step 5 — grant the SA `run.invoker` on ai-services

```bash
gcloud run services add-iam-policy-binding "${SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/run.invoker"
```

## Step 6 — grant the SA `serviceAccountTokenCreator` on ITSELF

Required for the explicit `generateIdToken` second hop: after impersonation the
client holds the SA's own access token and asks the SA to mint an ID token for
itself. That self-mint needs the SA to be a token creator on its own resource.

```bash
gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --member="serviceAccount:${SA_EMAIL}"
```

## Step 7 — READBACK / VERIFY (safe, read-only)

```bash
# 7a. Project number (audience sanity — must match the run.app URL).
gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)'

# 7b. Both pools exist and are ACTIVE (state:ACTIVE, no deletion pending).
gcloud iam workload-identity-pools describe "${POOL_PROD}" \
  --project="${PROJECT_ID}" --location="global" \
  --format='value(name,state)'
gcloud iam workload-identity-pools describe "${POOL_STAGING}" \
  --project="${PROJECT_ID}" --location="global" \
  --format='value(name,state)'

# 7c. Providers carry the right issuer + attribute-condition (prod=production,
#     staging=preview). Eyeball the condition + issuerUri in the output.
gcloud iam workload-identity-pools providers describe "${PROVIDER_PROD}" \
  --project="${PROJECT_ID}" --location="global" \
  --workload-identity-pool="${POOL_PROD}" \
  --format='yaml(oidc.issuerUri,attributeMapping,attributeCondition,oidc.allowedAudiences,state)'
gcloud iam workload-identity-pools providers describe "${PROVIDER_STAGING}" \
  --project="${PROJECT_ID}" --location="global" \
  --workload-identity-pool="${POOL_STAGING}" \
  --format='yaml(oidc.issuerUri,attributeMapping,attributeCondition,oidc.allowedAudiences,state)'

# 7d. SA IAM policy shows BOTH bindings:
#     - roles/iam.workloadIdentityUser  -> members includes PRINCIPAL_PROD
#     - roles/iam.serviceAccountTokenCreator -> members includes serviceAccount:${SA_EMAIL}
gcloud iam service-accounts get-iam-policy "${SA_EMAIL}" \
  --project="${PROJECT_ID}" --format=json

# 7e. Cloud Run IAM policy shows roles/run.invoker -> serviceAccount:${SA_EMAIL}
#     (and NO allUsers / allAuthenticatedUsers — the deploy workflow enforces
#     this too, but confirm here).
gcloud run services get-iam-policy "${SERVICE}" \
  --project="${PROJECT_ID}" --region="${REGION}" --format=json

# 7f. Confirm Invoker IAM is still ENFORCED on the service (must be empty/false).
gcloud run services describe "${SERVICE}" \
  --project="${PROJECT_ID}" --region="${REGION}" \
  --format='value(metadata.annotations.run.googleapis.com/invoker-iam-disabled)'
```

## Step 8 — Vercel env (manual, dashboard — NOT part of this runbook's commands)

After the GCP readbacks are clean, set these NON-SECRET env vars in the Vercel
project (Production scope first; Preview scope with the staging pool/provider
when staging is armed). **Do not set these until the supervised window** — they
are the switches that arm the client's keyless mint. All absent → the client is
a dormant no-op (returns null), exactly as it ships today.

| Vercel env var | Production value |
|---|---|
| `PYTHON_AI_BASE_URL` | `https://ai-services-518404877846.asia-south1.run.app` |
| `GCP_PROJECT_NUMBER` | `518404877846` (the readback from 7a) |
| `GCP_SERVICE_ACCOUNT_EMAIL` | `vercel-cloudrun-invoker@alfanumrik-ai-prod.iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | `vercel-prod` |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | `vercel-prod-oidc` |

For Preview scope (once staging is armed): same `PYTHON_AI_BASE_URL` +
`GCP_PROJECT_NUMBER` + `GCP_SERVICE_ACCOUNT_EMAIL`, but
`GCP_WORKLOAD_IDENTITY_POOL_ID=vercel-staging` and
`GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel-staging-oidc`.

> The client reads only `GCP_*` (non-secret) + `PYTHON_AI_BASE_URL`. It never
> reads a service-account key. End-to-end verification (the actual mint +
> `X-Serverless-Authorization` call) can only be observed from a Vercel
> deployment — it is out of scope for this gcloud runbook.

## Rollback

- **Disarm without deleting infra:** clear the five Vercel env vars (or just
  `PYTHON_AI_BASE_URL`). The client returns to its dormant no-op immediately.
- **Revoke impersonation:** remove the `roles/iam.workloadIdentityUser` binding
  (Step 4) — the mint fails and the client returns null (perception dark).
  ```bash
  gcloud iam service-accounts remove-iam-policy-binding "${SA_EMAIL}" \
    --project="${PROJECT_ID}" \
    --role="roles/iam.workloadIdentityUser" \
    --member="${PRINCIPAL_PROD}"
  ```
- **Full teardown (only if abandoning WIF):** delete the providers, then the
  pools (`gcloud iam workload-identity-pools … delete`), then the SA. Pools have
  a 30-day soft-delete; the same ID cannot be recreated until purged.
