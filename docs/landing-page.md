# Landing Page (`/welcome`)

Operational doc for the editorial landing surface. Audience: an engineer who has
never seen this code and needs to understand the surface, edit copy, or add a
new section.

For product invariants and agent ownership, see [`.claude/CLAUDE.md`](../.claude/CLAUDE.md).
For the broader stack, see [`ARCHITECTURE.md`](../ARCHITECTURE.md).
For PostHog plumbing, see [`docs/posthog-integration.md`](./posthog-integration.md).

---

## 1. What this is

The landing page is the primary acquisition surface for unauthenticated
visitors. It sits at `/welcome`; root `/` redirects unauthenticated visitors
here. Four audiences — **parents** (default), **students**, **teachers**,
**schools** — switched via the role-strip below the issue bar. The page is
bilingual (English / Hindi) and uses an editorial newspaper visual style.

The route is feature-flag-gated in `src/app/welcome/page.tsx`: v2 (this doc) is
the live editorial landing; v1 (`page-v1.tsx`) is the prior implementation kept
for fallback.

---

## 2. Component map

All v2 components live in `src/components/landing-v2/`.

| Component | Section ID | Renders | Notes |
|---|---|---|---|
| `NavV2` | (top) | Brand, primary nav (Product / Solutions ▾ / Pricing / Research / About), lang toggle, theme toggle, CTA, mobile burger, issue bar, role-strip | Phase 2 nav restructure; Phase 3 added `#faq` link |
| `HeroV2` | (top, no `#`) | Role-aware headline + lede + CTA + phone mockup | "Aryabhata's place-value system" copy is in `parent.lede1.en` — Phase 1 cultural fix |
| `StatsV2` | `#stats` | 4 stats: 12k students, 94% feel easier, 7 subjects, ₹699 | |
| `MissionV2` | `#mission` | Vision, Mission, Principles 3-column | Phase 2 |
| `WorkbookV2` | `#how` | Problem / solution columns ("Tuition has eaten the evening" → "Ten minutes, then we stop") | |
| `ShowcaseV2` | `#showcase` | 3 tools: tutor / mastery x-ray / quiz | |
| `TrustV2` | `#trust` | Founder note, teacher quote, parent quote, Recognition strip, compliance band, live counter, Review JSON-LD | Phase 3 added Recognition + Review schema |
| `PricingTeaserV2` | `#pricing` | Plan tease | |
| `FAQV2` | `#faq` | 10 bilingual FAQs + FAQPage JSON-LD | Phase 3 |
| `FinalCtaV2` | `#cta` | Repeat CTA | |
| `FooterV2` | (bottom) | 3 columns: Product, Company (6 items), Legal (4 items) | Phase 4 wired Vision / Careers / Press / Refunds |

Shared utilities:

- `WelcomeV2.tsx` — composes the page
- `WelcomeV2Context.tsx` — provides `t(en, hi)` helper plus role / lang / theme state
- `welcome-v2.module.css` — single CSS module (~2,500 lines, append-only)

---

## 3. Page flow order

```
WelcomeV2
├── NavV2              (top bar + issue bar + role-strip)
├── HeroV2
├── StatsV2            (#stats)
├── MissionV2          (#mission)
├── WorkbookV2         (#how)
├── ShowcaseV2         (#showcase)
├── TrustV2            (#trust)
├── PricingTeaserV2    (#pricing)
├── FAQV2              (#faq)
├── FinalCtaV2         (#cta)
└── FooterV2
```

---

## 4. The bilingual contract (P7)

- Every visible string MUST go through `t(en, hi)` from `useWelcomeV2()`, OR an
  `isHi ? hi : en` ternary.
- JSON-LD payloads (FAQPage, Review, BreadcrumbList) are intentionally
  English-only — Google best practice (mixing languages in a single schema
  risks spam flags).
- Deep marketing pages (`/about`, `/contact`, `/press`, `/careers`, `/refunds`)
  are English-only by convention. They are not bilingual unless they sit on the
  welcome surface.
- Technical terms NOT translated: CBSE, XP, Bloom's, NCERT, DPDPA, DPIIT.
- Brand terms NOT translated: Alfanumrik, Foxy, Cusiosense Learning.

---

## 5. JSON-LD schema map

| Schema | Component | Mounted at |
|---|---|---|
| `Organization` | `JsonLd` | `/welcome` layout (every visitor) |
| `WebApplication` | `JsonLd` | `/welcome` layout (every visitor) |
| `FAQPage` | `FAQV2` | `/welcome` (10 questions, English-only payload) |
| `Review` (×3) | `TrustV2` | `/welcome` (3 testimonials @ 5/5, attached to `WebApplication` `@id`) |
| `BreadcrumbList` | `Breadcrumbs` | `/about`, `/pricing`, `/product`, `/research`, `/for-parents`, `/for-teachers`, `/for-schools`, `/press`, `/careers`, `/refunds` |

**TODO**: `Organization.sameAs` is currently `[]`. Add LinkedIn, Twitter/X, and
YouTube URLs once those handles exist.

---

## 6. SEO surface

| Concern | Where |
|---|---|
| Sitemap | `src/app/sitemap.ts` — `/welcome` priority 1.0; deep marketing pages 0.5–0.9; auth-gated routes 0.5–0.7; legal 0.3 |
| Hreflang | `src/app/welcome/layout.tsx` `alternates.languages` — `en-IN` (default) + `hi-IN` (`?lang=hi`) + `x-default` |
| OpenGraph locale | `en_IN` primary + `hi_IN` alternate |
| Robots | `public/robots.txt` — allows everything by default |
| Canonical | every public page sets `alternates.canonical` in its `metadata` block |

---

## 7. PostHog event taxonomy (Phase 5)

Six landing-page events. All are typed in `src/lib/posthog/types.ts` and fired
via `track()` from `src/lib/posthog/client.ts`.

| Event | Fires when | Used for |
|---|---|---|
| `landing_nav_click` | User clicks any primary nav, Solutions dropdown item, or mobile burger link | Nav discoverability funnel (objective O2) |
| `landing_solutions_dropdown_opened` | Solutions dropdown opens (not on close) | Solutions-funnel volumetric |
| `landing_role_changed` | User picks a different role tab (skip on initial hydration) | Audience-fit signal |
| `landing_faq_opened` | A FAQ `<details>` expands (not on collapse) | Buying-objection signal |
| `landing_cta_click` | Any "Start free / Begin a session / etc." CTA across nav, hero, pricing teaser, final CTA | Time-to-CTA-click (objective O6) |
| `landing_breadcrumb_click` | A breadcrumb link is clicked on any deep page | Cross-page navigation pattern |

Constraints:

- Lazy-loaded — only fires when `NEXT_PUBLIC_POSTHOG_ENABLED === 'true'`.
- Type-checked via `EventPayloadByName` in `src/lib/posthog/types.ts`.
- PII-free — closed-set string-literal unions for roles, sources, locations.

### Dashboards to build

- **Funnel O2 — Nav discoverability**: `pageview /welcome` →
  `landing_nav_click` where `destination ∈ {/about, /pricing, /product,
  /research, /for-*}`.
- **Funnel O6 — Time-to-CTA-click**: `pageview /welcome` →
  `landing_cta_click`. Median should be ≤ 45s.
- Cohort by `active_role`, `language`, `source`.

---

## 8. How to add a new section to `/welcome`

1. Create `src/components/landing-v2/MyNewSection.tsx`:

   ```tsx
   'use client';
   import { useWelcomeV2 } from './WelcomeV2Context';
   import s from './welcome-v2.module.css';

   export default function MyNewSection() {
     const { isHi, t } = useWelcomeV2();
     return (
       <section className={s.mySection} id="my-new" aria-labelledby="my-new-title">
         <div className={s.wrap}>
           <span className={s.label}>{t('Section · ', 'खंड · ')}</span>
           <h2 id="my-new-title">{t('English headline', 'हिन्दी शीर्षक')}</h2>
           {/* ... */}
         </div>
       </section>
     );
   }
   ```

2. Append CSS rules to `src/components/landing-v2/welcome-v2.module.css`.
   **Append-only — never modify existing rules.** Use `:global()` for
   bare-name descendants per file convention.
3. Mount in `WelcomeV2.tsx` between the right neighbors (e.g., between
   `StatsV2` and `MissionV2`).
4. Add a `#my-new` link to the `NavV2` mobile burger Sections list (renumber
   the existing items if needed).
5. Verify:

   ```bash
   npm run type-check && npm run lint && npx vitest run src/__tests__/landing-v2/
   ```

---

## 9. How to add a new deep marketing page

1. Create `src/app/my-page/page.tsx`:
   - Server component (no `'use client'`).
   - Export `metadata: Metadata` with `title`, `description`, `openGraph`,
     `alternates: { canonical }`.
   - Use inline-style + local Navbar / Footer (NOT `FooterV2`). See
     `/about` and `/contact` for the pattern.
   - Mount `<Breadcrumbs items={[{ label: 'Home', href: '/welcome' }, ...]} />`.
2. Add an entry to `src/app/sitemap.ts`. Sensible priority: 0.5–0.9 for
   marketing, 0.3 for legal.
3. Wire from `FooterV2` if it's a Company or Legal page.
4. Wire from `NavV2` primary nav if it's a Product or Solutions destination.

---

## 10. How to fix a copy issue

Most marketing copy is co-located with its component:

| Component | Where the copy lives |
|---|---|
| `HeroV2.tsx` | `ROLE_COPY` object — 4 roles × `headlineEn/Hi`, `devaEn/Hi`, `lede1`, `lede2`, `ctaLabel`, `ctaHref` |
| `StatsV2.tsx` | `STATS` array |
| `WorkbookV2.tsx` | `PROBLEMS` / `SOLUTIONS` arrays |
| `ShowcaseV2.tsx` | 3 cards, hard-coded JSX |
| `TrustV2.tsx` | Founder / teacher / parent quotes, hard-coded |
| `FAQV2.tsx` | `FAQS` array — 10 entries × `qEn/qHi/aEn/aHi` |
| `MissionV2.tsx` | `PRINCIPLES` array |
| `PricingTeaserV2.tsx` | pricing labels and CTAs |
| `FinalCtaV2.tsx` | final CTA text |
| `FooterV2.tsx` | `COLS` array (Product / Company / Legal column links) |

For deep pages (`/about`, `/press`, `/careers`, `/refunds`), copy is inline in
the page file.

---

## 11. Performance and bundle

| Target | Limit | Current |
|---|---|---|
| Shared JS (P10) | < 160 kB | 168.5 kB — over by 8.5 kB (pre-existing on main; architect investigation ongoing as a Phase 5 sub-task) |
| `/welcome` page bundle | < 260 kB | ~131.7 kB (well under) |
| New marketing pages | < 260 kB | ~97.9 kB each |
| Lighthouse Performance | ≥ 90 | tracked manually |
| LCP on slow 4G | ≤ 2.5s | tracked manually |

---

## 12. Regression catalog gaps surfaced

Phases 1–5 surfaced ~17 testing gaps that warrant catalog entries (filed as
`REG-NEW-A` through `REG-LP-14` in PR comments). They cover:

- Solutions dropdown ARIA + keyboard contract
- Mission section structural contract (3 columns, 5 principles)
- OG locale parity with hreflang
- Role-strip placement outside primary nav
- FAQPage / Review / BreadcrumbList schema validity
- `/about` Vision and Founder note section presence
- `/press` / `/careers` / `/refunds` metadata + `mailto:` contracts
- `FooterV2` column ordering
- Sitemap entries

These are deferred testing-agent work — not blocking the landing-page
deployment. See [`.claude/regression-catalog.md`](../.claude/regression-catalog.md)
once entries land.

---

## 13. What's NOT in the landing-v2 system

- **Quiz, dashboard, foxy, profile, parent / teacher portals** — separate
  surfaces with separate state (`AuthContext`, `SchoolContext`).
- **Payments** — `src/lib/razorpay.ts` and `/api/payments/*`. Distinct from
  the landing surface.
- **AI tutor** — `supabase/functions/foxy-tutor/`. The marketing surface
  only links to `/foxy`.

---

## See also

- [`.claude/CLAUDE.md`](../.claude/CLAUDE.md) — product invariants P1–P15
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — full stack overview
- [`LAUNCH_CHECKLIST.md`](../LAUNCH_CHECKLIST.md) — pre-launch gates
- [`docs/posthog-integration.md`](./posthog-integration.md) — PostHog plumbing
- [`docs/RBAC_MATRIX.md`](./RBAC_MATRIX.md) — role matrix (auth-gated routes)
- [`docs/ADMIN_OPERATIONS.md`](./ADMIN_OPERATIONS.md) — admin runbooks
