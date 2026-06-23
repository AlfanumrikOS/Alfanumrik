# extensions/cloudfront.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Extension Module (Platform Binding)
**Priority:** P2 (Medium — CDN/edge layer for the AWS path only)
**Applies To:** Content delivery and edge caching for Alfanumrik. Distinguishes Vercel's built-in edge (live web app) from AWS CloudFront (dormant AWS path / AWS-hosted assets).

---

# Purpose

Clarify which CDN serves what. **Vercel's own edge/CDN already fronts the live web app** (`alfanumrik.com`) — there is no separate CloudFront in front of production today. AWS **CloudFront** exists in the repo as the edge layer for the **dormant AWS ECS path** (a staging pseudolink), and would only front the web app after a deliberate cutover. This module reconciles core doc 12's CloudFront guidance against that reality.

---

# Scope

In scope: Vercel edge/CDN behavior for the live app; the committed CloudFront distribution config (`aws/cloudfront-config.json`) and its ALB→ECS origin; cache-policy intent; CDN security headers.

Out of scope: ECS container internals (`extensions/ecs.md`), the Vercel deploy flow (`extensions/vercel.md`), and Supabase/Storage delivery.

---

# How AEOS core binds here

- **Core doc 12 (AWS Infrastructure)** lists CloudFront among primary services and governs the AWS CloudFront distribution described here.
- **Reconciliation/override:** doc 12's CDN guidance applies to **AWS-hosted assets/services only**. For the **live web app, Vercel's edge handles caching and TLS** — do not stand up CloudFront in front of the Vercel app. CloudFront becomes relevant to the web tier only if/when the AWS ECS path is cut over.
- **Core doc 21 (Infrastructure Operations)** governs cache-invalidation and edge-config change discipline for any live CloudFront distribution.

---

# Alfanumrik specifics (factual to this repo)

**Live web app (Vercel):**
- Edge caching, TLS, and Brotli/gzip are provided by Vercel in/around the `bom1` region. Cache-control for app routes and static assets is expressed in `next.config.js` `headers()` (e.g. immutable `/fonts/*`, `no-store` for `/api/v1/health`, `stale-while-revalidate` for app pages). No CloudFront sits in front of production.

**AWS CloudFront distribution** (dormant path — `aws/cloudfront-config.json`, `aws/README.md`):
- Staging pseudolink `https://da8yhieheuw7p.cloudfront.net`, distribution ID `E3GYX90RS5NCAP`.
- Architecture: `User → CloudFront (HTTPS, *.cloudfront.net cert) → ALB :80 (HTTP) → ECS Fargate :3000`. CloudFront terminates TLS; a `X-Forwarded-Proto: https` custom origin header tells Next.js the user is on HTTPS even though CloudFront→ALB is plain HTTP.
- `PriceClass_All` (Indian edge nodes: Mumbai, Chennai, Hyderabad, Delhi, Kolkata), HTTP/2 + HTTP/3, IPv6 on, viewer protocol `redirect-to-https`.
- Cache behaviors: `/_next/static/*` → CachingOptimized (immutable hashed assets, long TTL); `/api/*` → CachingDisabled (APIs must never be cached); default → CachingDisabled (safe for SSR).

---

# Operational guidance

- **Do not** introduce CloudFront in front of the Vercel-hosted production app; it would double the edge and conflict with Vercel's caching/TLS.
- For the AWS path: never cache `/api/*` (the config enforces CachingDisabled). When ECS deploys new hashed assets, `/_next/static/*` immutability means no invalidation is needed; invalidate only non-hashed paths if ever cached.
- Status check for the distribution: `aws cloudfront get-distribution --id E3GYX90RS5NCAP --query 'Distribution.Status'`.
- Full DNS cutover (future) would add `alfanumrik.com` as a CloudFront alternate domain + ACM cert, or route prod via the ALB ALIAS in Route 53 — only as part of the planned `extensions/aws.md` ramp.

---

# Security notes

- Application security headers and CSP are emitted by the app itself (`next.config.js`), so they apply regardless of which edge fronts it. Do not rely on the CDN alone for security headers.
- CloudFront→ALB origin is HTTP-only by design behind TLS-terminating CloudFront; keep the ALB private/origin-locked and preserve the `X-Forwarded-Proto: https` header so SSR builds correct absolute/secure URLs.
- Never cache authenticated or `/api/*` responses at the edge.

---

# Checklist

- [ ] Live web app continues to use Vercel's edge — no CloudFront in front of production.
- [ ] AWS CloudFront keeps `/api/*` on CachingDisabled.
- [ ] `/_next/static/*` stays on the immutable long-TTL policy.
- [ ] `X-Forwarded-Proto: https` origin header preserved on the AWS path.
- [ ] App-level security headers/CSP remain authoritative regardless of edge.

---

# References

- Core: `12_AWS_INFRASTRUCTURE.md`, `21_RELEASE_MANAGEMENT.md`, `20_DEPLOYMENT_PIPELINE.md`
- Extensions: `extensions/vercel.md`, `extensions/aws.md`, `extensions/ecs.md`
- Repo: `aws/cloudfront-config.json`, `aws/README.md`, `next.config.js`

---

# Final Directive

Vercel's edge fronts the live web app; AWS CloudFront fronts only the dormant AWS path and any AWS-hosted assets. Keep the two distinct, never cache APIs at the edge, and let the application remain the source of truth for security headers.

**End of Document**
