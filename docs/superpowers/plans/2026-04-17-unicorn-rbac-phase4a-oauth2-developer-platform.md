# Unicorn RBAC Phase 4A: OAuth2 Developer Platform — Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the OAuth2 developer platform foundation — app registration, scope definitions, school consent management, token issuance with triple intersection, school-scoped API keys, and the anomaly detection Edge Function.

**Architecture:** Five new DB tables (`oauth_apps`, `oauth_scopes`, `oauth_consents`, `oauth_tokens`, `school_api_keys`) + seed scopes. A TypeScript OAuth manager handles app registration, token exchange (Authorization Code + PKCE), and the triple intersection rule. School API keys are a simplified alternative for server-to-server integrations. An anomaly detection function scans `audit_events` for suspicious patterns. Super admin gets an app review page.

**Tech Stack:** Supabase PostgreSQL, TypeScript (Next.js), bcrypt (password hashing for client secrets), Vitest

**Spec:** `docs/superpowers/specs/2026-04-17-unicorn-rbac-design.md` — Section 6 (OAuth2) + Forensic Audit (anomaly detection)

**Depends on:** Phase 1 (audit_events), Phase 2A (school_id scoping), Phase 2B (school_api_keys migration if exists)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260417500000_rbac_phase4a_oauth2_platform.sql` | oauth_apps, oauth_scopes, oauth_consents, oauth_tokens, school_api_keys tables + seed scopes |
| Create | `src/lib/oauth-manager.ts` | App registration, token exchange, triple intersection, token validation |
| Create | `src/lib/api-key-manager.ts` | School API key CRUD + validation |
| Create | `src/lib/anomaly-detector.ts` | Scan audit_events for suspicious patterns |
| Create | `src/__tests__/oauth-manager.test.ts` | Tests for OAuth flows |
| Create | `src/__tests__/api-key-manager.test.ts` | Tests for API key operations |
| Create | `src/__tests__/anomaly-detector.test.ts` | Tests for anomaly detection rules |
| Create | `src/app/api/oauth/authorize/route.ts` | OAuth authorization endpoint |
| Create | `src/app/api/oauth/token/route.ts` | OAuth token exchange endpoint |
| Create | `src/app/api/super-admin/oauth-apps/route.ts` | App review + management API |
| Create | `src/app/super-admin/oauth-apps/page.tsx` | App review page in super admin |

---

## Task 1: Migration — OAuth2 Tables + School API Keys

Create `supabase/migrations/20260417500000_rbac_phase4a_oauth2_platform.sql`.

### oauth_apps
App registration table for third-party developers:
- id UUID PK, name TEXT NOT NULL, description TEXT, developer_id UUID NOT NULL, developer_org TEXT
- logo_url TEXT, homepage_url TEXT, privacy_policy_url TEXT NOT NULL
- redirect_uris TEXT[] NOT NULL, client_id TEXT NOT NULL UNIQUE, client_secret_hash TEXT NOT NULL
- requested_scopes TEXT[] NOT NULL, app_type TEXT DEFAULT 'third_party' CHECK IN ('first_party','third_party','school_internal')
- review_status TEXT DEFAULT 'pending' CHECK IN ('pending','approved','rejected','suspended')
- reviewed_by UUID, reviewed_at TIMESTAMPTZ, is_active BOOLEAN DEFAULT true
- rate_limit_per_minute INT DEFAULT 60, created_at/updated_at TIMESTAMPTZ
- Indexes: client_id, developer_id, review_status
- RLS: service_role full, authenticated SELECT if developer_id=self OR admin

### oauth_scopes
Available API scopes mapping to RBAC permissions:
- id UUID PK, code TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, display_name_hi TEXT
- description TEXT NOT NULL, permissions_required TEXT[] NOT NULL
- risk_level TEXT DEFAULT 'low' CHECK IN ('low','medium','high'), is_active BOOLEAN DEFAULT true
- RLS: SELECT for all authenticated (scopes are public info)

### oauth_consents (school-level)
School admin consent decisions:
- id UUID PK, school_id UUID NOT NULL FK->schools, app_id UUID NOT NULL FK->oauth_apps
- consented_by UUID NOT NULL, granted_scopes TEXT[] NOT NULL, denied_scopes TEXT[]
- consent_type TEXT DEFAULT 'school_wide', expires_at TIMESTAMPTZ nullable
- revoked_at TIMESTAMPTZ, revoked_by UUID, status TEXT DEFAULT 'active' CHECK IN ('active','revoked','expired')
- created_at TIMESTAMPTZ, UNIQUE(school_id, app_id)
- RLS: service_role full, authenticated SELECT if school member or admin

### oauth_tokens
Issued access/refresh tokens:
- id UUID PK, app_id UUID NOT NULL FK->oauth_apps, school_id UUID NOT NULL
- user_id UUID NOT NULL, access_token_hash TEXT NOT NULL, refresh_token_hash TEXT
- scopes TEXT[] NOT NULL, access_token_expires_at TIMESTAMPTZ NOT NULL
- refresh_token_expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ
- Indexes: access_token_hash, app_id+school_id, user_id
- RLS: service_role only (tokens never accessed directly by clients)

### school_api_keys
Simplified API keys for school integrations:
- id UUID PK, school_id UUID NOT NULL FK->schools, name TEXT NOT NULL
- key_hash TEXT NOT NULL, created_by UUID NOT NULL, scopes TEXT[] NOT NULL
- ip_allowlist INET[], rate_limit_per_minute INT DEFAULT 30
- last_used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, is_active BOOLEAN DEFAULT true
- created_at TIMESTAMPTZ
- RLS: service_role full, authenticated SELECT if school member or admin

### Seed OAuth scopes
Insert default scopes mapping to RBAC permissions:
- read:student_profile → ['profile.view_own'] (low)
- read:quiz_results → ['quiz.view_results'] (low)
- read:class_analytics → ['class.view_analytics'] (medium)
- read:student_progress → ['progress.view_own'] (medium)
- write:class_roster → ['class.manage','institution.manage_students'] (high)
- read:financial_reports → ['finance.view_revenue','finance.view_subscriptions'] (high)

## Task 2: OAuth Manager Module

Create `src/lib/oauth-manager.ts` + `src/__tests__/oauth-manager.test.ts`.

### Functions:
- `registerApp(input)`: validate privacy_policy_url required, generate client_id (uuid), hash client_secret (bcrypt), insert oauth_apps with status='pending'. Return {clientId, clientSecret (raw, shown once)}
- `validateAuthorizationRequest(clientId, redirectUri, scopes, schoolId)`: verify app exists + approved + redirect_uri matches + scopes are valid. Return {valid, app, error?}
- `exchangeCodeForToken(code, clientId, clientSecret, redirectUri)`: verify code, verify client_secret hash, compute triple intersection (app scopes ∩ school consent ∩ user permissions), generate access+refresh tokens, store hashes. Return {accessToken, refreshToken, expiresIn, scopes}
- `validateAccessToken(token)`: hash token, look up in oauth_tokens, check expiry, return {valid, appId, userId, schoolId, scopes}
- `revokeAppTokens(appId, schoolId?)`: revoke all tokens for app (or app+school). Instant cache invalidation.
- `tripleIntersection(appScopes, consentScopes, userPermissions, scopeDefinitions)`: pure function computing effective permissions

### Tests (8+):
- Register app returns clientId + clientSecret
- Register app rejects without privacy_policy_url
- Triple intersection correctly intersects 3 sets
- Triple intersection with disjoint sets returns empty
- Validate token returns correct scopes
- Token validation fails for expired token
- Revoke tokens invalidates all for app+school
- Authorization request rejects unapproved app

## Task 3: API Key Manager Module

Create `src/lib/api-key-manager.ts` + `src/__tests__/api-key-manager.test.ts`.

### Functions:
- `createApiKey(input: {schoolId, name, scopes, createdBy, ipAllowlist?, expiresAt?})`: generate random key, store SHA-256 hash, return {keyId, apiKey (raw, shown once)}
- `validateApiKey(rawKey)`: hash, look up by hash, check active + not expired + IP allowlist. Apply triple intersection (key scopes ∩ school permission ceiling ∩ creating admin's permissions). Return {valid, schoolId, scopes, error?}
- `revokeApiKey(keyId, revokedBy)`: set is_active=false, write audit
- `listApiKeys(schoolId)`: list keys for school (never return hash)
- `updateLastUsed(keyId)`: fire-and-forget timestamp update

### Tests (6+):
- Create key returns raw key + stores hash
- Validate key checks active + not expired
- Validate key checks IP allowlist
- Revoke key makes it invalid
- List keys excludes hash
- Expired key is rejected

## Task 4: Anomaly Detector Module

Create `src/lib/anomaly-detector.ts` + `src/__tests__/anomaly-detector.test.ts`.

### Functions:
- `detectAnomalies(sinceMinutes?: number)`: scans audit_events from last N minutes. Returns array of detected anomalies.

### Detection Rules (pure functions, testable without DB):
- `detectBulkAccess(events)`: >100 student records by one user in 5 min → anomaly
- `detectEscalationAttempts(events)`: >5 denied permission checks from same user in 1 min → anomaly
- `detectImpersonationAbuse(events)`: impersonation session >30 min or >50 actions → anomaly
- `detectDelegationStorm(events)`: >20 delegation tokens by one user in 1 hour → anomaly

Each returns `{ type, severity, userId, details, detectedAt }` or null.

### Tests (5+):
- Bulk access detected when >100 records
- Bulk access not triggered at 99 records
- Escalation detected at >5 denials in 1 min
- Impersonation abuse at >50 actions
- Delegation storm at >20 tokens in 1 hour

## Task 5: OAuth API Routes

### `src/app/api/oauth/authorize/route.ts`
GET handler: validates client_id, redirect_uri, scopes, school_id. Returns authorization page data (app name, requested scopes with risk levels, school name). This is consumed by a consent screen UI.

### `src/app/api/oauth/token/route.ts`
POST handler: exchanges authorization code for tokens. Validates client_secret, computes triple intersection, issues tokens. Standard OAuth2 token endpoint.

Both use `supabaseAdminHeaders` for DB access (these are server endpoints, not client-facing).

## Task 6: Super Admin OAuth Apps Page

### `src/app/api/super-admin/oauth-apps/route.ts`
GET: list apps with optional `?status=pending` filter
POST actions: approve_app, reject_app, suspend_app — update review_status, write audit

### `src/app/super-admin/oauth-apps/page.tsx`
Table of registered apps. Pending review queue at top. Approve/Reject/Suspend buttons. App details in expandable rows (scopes, redirect URIs, privacy policy link, review status).

Add nav item to AdminShell: `{ href: '/super-admin/oauth-apps', label: 'OAuth Apps', icon: '⊚' }`

## Task 7: Verification
Full test suite, type-check, push to Vercel.
