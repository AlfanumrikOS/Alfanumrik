# 07 — Public Website & SEO Plan

Date: 2026-09-03. Positioning to preserve: "Adaptive Learning OS for K-12" / "fixing what classrooms can't measure". The word "tutor" is removed everywhere.

## 1. Current baseline (measured)

Lighthouse via PageSpeed Insights could not run (API daily quota exhausted for the shared project, HTTP 429 from Google, not from the site). Baseline is therefore the Playwright throttled probe (`audit/evidence/perf-results.json`: Moto G4, 1.6 Mbps/150 ms RTT, 4× CPU) plus in-browser metadata capture. **Crawlability blocker:** every non-browser request, including a Googlebot UA, receives HTTP 429 + "Vercel Security Checkpoint" (C-008); Search Console / Vercel Firewall verification is decision D-4.

| Page | Title (live) | Canonical | H1 count | JSON-LD blocks | "tutor" hits | LCP s | JS KB | Notes |
|---|---|---|---|---|---|---|---|---|
| `/` → `/welcome` | AI Tutor for CBSE Students (Class 6–12) — Alfanumrik | `/welcome` | 2 (rotating words concatenated) | 10 (Organization×3, WebApplication×5, FAQPage×2) | 2 | **13.1** | 345 | hreflang en-IN/hi-IN/x-default present; OG image `/api/og` |
| `/pricing` | Pricing — CBSE Learning App, Free & Paid Plans | ok | 1 | 3 (+BreadcrumbList) | 1+ | 7.4 | 339 | no `Product`/`Offer` schema |
| `/for-schools` | For Schools — School Intelligence OS for CBSE | ok | 1 | 4 (BreadcrumbList ×2) | 0 | 5.6 | 507 | |
| `/for-parents` | For Parents — Track Your Child's CBSE Progress | ok | **2** | 4 (Breadcrumb ×2) | 1 | 5.5 | 508 | |
| `/for-teachers` | For Teachers — CBSE Worksheet Generator & Class Analytics | ok | **2** | 4 | 1 | 5.1 | 510 | |
| `/product` | Product — Alfanumrik AI Learning Platform for CBSE | ok | **2** | 4 | 2 | 5.5 | 502 | |
| `/about` | About Alfanumrik — Cusiosense Learning India | ok | **2** | 4 | 4 | 5.6 | 498 | spelling to confirm |
| `/contact` | Contact Alfanumrik — Support & Sales | ok | 1 | 2 | 0 | 2.2 | 483 | |
| `/schools` | **default** "Alfanumrik - Adaptive Learning OS \| AI Tutor…" | **`/`** (wrong) | 2 | 2 | 1 | 3.0 | 497 | orphan page, not in sitemap |
| `/help` | Help & Support — Alfanumrik | ok | 1 | 0 | 0 | — | — | |
| `/login` | default | `/` (should be noindex) | 1 | 0 | 1 | 6.0 | 327 | |
| `robots.txt` | allows `/`, disallows app paths + `/api/` (allows `/api/og`) | | | | | | | served, but 429 to bots |
| `sitemap.xml` | 17 URLs, all `lastmod` 2026-07-16, includes `/demo`; excludes `/schools` | | | | | | | |

Other: `next/image` usage is minimal (0 `<img>` on `/`; hero is CSS/text); `lang="en"` switches with `?lang=hi`; fonts 284 KB on `/`; hero copy is `opacity:0` until JS.

## 2. Keyword & intent map (India, K-12 CBSE/NCERT)

| Page | Primary intent | Target cluster (no stuffing; 1 primary + 3–5 secondary) |
|---|---|---|
| `/` | Category definition | "adaptive learning platform for CBSE", "learning OS for schools India", "NCERT-based learning app class 6-12", "personalised learning CBSE" |
| `/for-schools` | Principal/director evaluation | "adaptive learning software for CBSE schools", "school learning analytics NEP 2020", "mastery tracking software schools India", "AI learning platform for schools pricing per student" |
| `/for-teachers` | Teacher tooling | "CBSE worksheet generator", "class mastery analytics", "Bloom's taxonomy question bank CBSE", "auto-graded NCERT practice" |
| `/for-parents` | Parent reassurance | "track child's CBSE progress", "weekly progress report app", "NCERT practice app class 8", "is my child exam ready" |
| `/pricing` | Commercial | "CBSE learning app price", "per student pricing school software", "free NCERT quiz app" |
| `/product` | Feature depth | "adaptive quiz engine CBSE", "NCERT grounded AI doubts", "mastery model K-12" |
| `/schools` (merge into `/for-schools`) | — | duplicate intent; 301 |
| New `/resources/*` (blog) | Top-of-funnel | "CBSE class 10 science chapter list", "NEP 2020 competency based assessment", "how to prepare class 9 maths" — chapter-level NCERT pages generated from `curriculum_topics` (542 rows) are the largest untapped long-tail |
| `/about`, `/contact`, `/demo` | Trust / conversion | brand queries |

## 3. Proposed page architecture

```
/                       Learning OS positioning (single H1, server-rendered hero)
/for-schools            (absorbs /schools; ₹99/seat block; Organization + Offer schema; demo CTA)
/for-teachers
/for-parents
/product                (feature depth; Course/LearningResource schema for Foxy, Practice, Reports)
/pricing                (Product + Offer schema per plan; FAQPage once)
/resources/             (index) → /resources/cbse/class-{6..12}/{subject}/{chapter-slug}  generated from curriculum_topics; Course + BreadcrumbList schema; hi-IN twins
/about /contact /demo /careers /press /help /privacy /terms /refunds /security
/login /join /parent /super-admin/login   noindex, nofollow; canonical self
```

## 4. Technical SEO checklist — pass/fail per page (today) and target

| Check | `/` | `/pricing` | `/for-*` | `/product` | `/about` | `/schools` | `/login` | Target |
|---|---|---|---|---|---|---|---|---|
| Crawlable (200 to verified bots) | ✗ (429) | ✗ | ✗ | ✗ | ✗ | ✗ | n/a | Vercel Firewall: allow verified bots; re-test with Search Console URL Inspection |
| Unique, ≤60-char title without "tutor" | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | all ✓ |
| Meta description ≤155, no "tutor"/"tutoring" | ✗ | ✗ ("AI tutoring") | ✓ | ✗ | ✓ | ✗ | ✗ | all ✓ |
| Exactly one `<h1>` | ✗ (2) | ✓ | ✗ (2) | ✗ (2) | ✗ (2) | ✗ | ✓ | one; rotating words via `aria-live` span inside it |
| Canonical self-referencing | ✓ (`/welcome`; make `/` canonical and serve landing at `/` directly) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ (noindex) | ✓ |
| JSON-LD: one `Organization`/`EducationalOrganization` sitewide, page-specific `WebPage`, `BreadcrumbList` once, `FAQPage` once, `Product`+`Offer` on pricing, `Course` on chapter pages | ✗ (10 blocks, duplicates) | ✗ (no Offer) | ✗ (Breadcrumb ×2) | ✗ | ✗ | — | — | deduplicate via a single `JsonLd` provider in the marketing layout |
| OG/Twitter cards | ✓ (`/api/og`) | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ + page-specific images |
| hreflang en-IN / hi-IN / x-default with real Hindi HTML | ✓ (`?lang=hi` SSR) | ✗ | ✗ | ✗ | ✗ | ✗ | — | all marketing pages |
| Heading hierarchy H1→H2→H3, no skipped levels | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Images with alt + `next/image` | ✓ (0 imgs) | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Internal links: every marketing page in header/footer + sitemap | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | — | ✓ |
| Mobile-first render without JS (hero visible) | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ |
| LCP < 2.5 s throttled | ✗ 13.1 | ✗ 7.4 | ✗ 5.1–5.6 | ✗ 5.5 | ✗ 5.6 | ✗ 3.0 | ✗ 6.0 | ✓ |
| JS ≤ 180 KB | ✗ 345 | ✗ 339 | ✗ 507–510 | ✗ 502 | ✗ 498 | ✗ 497 | ✗ 327 | ✓ (marketing shell without app auth/Supabase chunks) |
| `sitemap.xml` accurate `lastmod` from content, includes resources | ✗ (static 2026-07-16) | | | | | | | generated from data |
| `robots.txt` | ✓ | | | | | | | keep; add `Sitemap:` line |

## 5. Targets (per page, after 08-build-plan steps 2, 10 and 11)

| Page | Lighthouse Perf / A11y / BP / SEO (mobile) | LCP | JS |
|---|---|---|---|
| `/`, `/for-*`, `/product`, `/pricing` | ≥ 85 / ≥ 95 / ≥ 95 / 100 | ≤ 2.5 s | ≤ 180 KB |
| `/resources/*` chapter pages | ≥ 90 / ≥ 95 / ≥ 95 / 100 | ≤ 2.0 s | ≤ 120 KB (static, no app chunks) |
| `/login`, `/join`, `/parent` | ≥ 80 / ≥ 95 / ≥ 95 / n/a (noindex) | ≤ 3.0 s | ≤ 220 KB |

Baseline Lighthouse numbers will be captured with a local `lighthouse` run in Step 0 of the build plan (needs the CEO's OK to add the dev dependency) or via PSI once the quota resets.
