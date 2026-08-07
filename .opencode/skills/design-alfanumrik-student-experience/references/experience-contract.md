# Experience Contract — Alfanumrik Student Surface

Reference for any UI, UX, interaction, visual-system, or Foxy task on the student surface. Grounded in the live tree (verified 2026-08-06). Companion references: `information-architecture.md` (IA/routes) and `implementation-and-quality.md` (code/data/testing/DoD). For `/dashboard` card-level detail, the repo's `student-dashboard-design` skill is the canonical card recipe — this contract governs everything else.

## 1. Visual system

### Design tokens (`packages/ui/src/globals.css`)

| Group | Tokens (line refs) |
|---|---|
| Surfaces | `--bg #FBF8F4` (`:130`), `--surface-1 #FFFFFF` / `--surface-2 #F5F0EA` / `--surface-3 #EDE6DC` (`:132-134`) |
| Text (AA-verified) | `--text-1 #1A1207`, `--text-2 #4A3F2E`, `--text-3 #6B6053` (`:151-153`). Contrast rationale at `:141-150` — `--text-3` clears AA (4.95:1) on the darkest warm surface; don't push muted text darker. |
| Borders | `--border rgba(0,0,0,.08)`, `--border-mid .12`, `--border-strong .18` (`:137-139`) |
| Brand | `--orange #E8581C` + `--orange-rgb` (`:46-47`), `--purple`, `--gold`, `--teal`, `--green`, `--red` (`:66-86`) |
| Semantic | `--success`→green, `--warning`→gold, `--info`→teal, `--danger`→red (`:98-101`); `--primary/--primary-light/--primary-hover` (`:102-104`) |
| Gamification | `--xp-color`→gold, `--streak-color`→orange, `--level-up`→purple, `--mastery-low/mid/high` (`:109-111,124-126`) |
| Shadows | `--shadow-sm/md/lg/glow` (`:160-163`); `--scrim` overlay (`:171`) |
| Radius | `--radius-sm..2xl` (2/6/8/12/16 px, `:180-184`) — `rounded-*` utilities map onto these |
| CTA gradient | `--btn-primary-from #CB4710` → `--btn-primary-to #C2440F`, both AA-safe under white text (`:186-195`). `#fff` on bare `--orange` (3.59:1) is a FAIL — only use white on the CTA stops or `--on-*` tokens. |
| Paired on-surface | `--surface-inverse` + `--on-surface-inverse` (`:233-238`), `--on-accent` (`:244`), `--surface-accent` + `--on-surface-accent` (`:250-251`). **Rule: text on surface X uses `--on-X`; never bare `#fff` on a decorative background.** |
| Warm channel | `--accent-warm #E8581C`, `--accent-warm-rgb`, `--accent-warm-strong #C2440F` (`:57-65`) — stable burnt-orange on every surface; Foxy mascot/avatar identity rides this, not `--orange` |
| Layout | `--layout-max-rail 220px`, `--layout-max-aside 320px`, `--layout-max-content min(1240px, …)`, `--shell-header-h-compact 44px`, `--safe-top/bottom`, `--space-fluid-1…12` |
| Z-index | `--z-base … --z-skip` ladder (`:203-216`); bottom nav `--z-nav`, sheets/modals `--z-modal` |
| Fonts | `--font-display` (Sora — headings/data), `--font-body` (Plus Jakarta Sans — body) (`:7-8`). `--font-serif` (Fraunces) is **marketing-only**, never on the student surface. Mono needs a fallback: `var(--font-mono, ui-monospace, monospace)`. |

### Standing rules

1. **No `dark:` Tailwind classes** — the `darkMode` selector in `apps/host/tailwind.config.js` targets an attribute that is never written; `dark:` ships dead bytes.
2. **The app ships light-only** — `color-scheme: light` is forced in the root layout (`apps/host/src/app/layout.tsx:112`).
3. **Tokens over hex/palette.** A hex is acceptable only as a `var()` fallback.
4. Warm-orange alpha tints use `rgb(var(--accent-warm-rgb) / <α>)` (stable channel), not `--orange-rgb` (remappable under cosmic scopes).

## 2. Surface conventions

- **Card recipe** (dashboard OS sections): semantic `<section className="os-reveal-card rounded-2xl p-4">` + Tailwind for geometry only + inline `style` with CSS variables for every colour/border/shadow + `--reveal-i` stagger index + bilingual `aria-label`. See the `student-dashboard-design` skill for the full table (hero `rounded-3xl p-5 md:p-6` + `--shadow-md`; standard `rounded-2xl p-4` + `--shadow-sm`; sub-row `--surface-2`/tint; empty `--surface-2` + dashed `--border`).
- **Component system boundary:** generic cards use `packages/ui/src/ui/primitives/Card.tsx` (`variant: flat | elevated | interactive`). `PremiumCard` (`wonder-blocks.tsx`) is **legacy** — existing render sites (progress/leaderboard/exams) are inherited surface area, not precedent; do not add new usages.
- **Two skeleton APIs — don't mix them:** the exported `Skeleton` primitive (`wonder-blocks.tsx:1132`) takes `className/width/height/rounded/variant`; the dashboard `DashboardSkeleton` uses a file-local `Bone` helper (`width/height/radius/className`). Adding/reordering dashboard cards requires updating `DashboardSkeleton` to match first paint.
- **Two card systems coexist on `/dashboard`** — the section+token recipe and the `PendingLinkApproval`/`RevisionRail` outliers are documented defects (D12/D13 in `student-dashboard-design`), not precedent.

## 3. Interaction patterns

- **One primary action per screen.** The hero owns the primary CTA (`TodayHomeV2.tsx:16`). Nothing competes for hero weight.
- **Resume-first interruption recovery.** An in-progress session becomes a dark high-contrast "pick up where you left off" hero with the continue action as the only primary button (`TodayHomeV2.tsx:59-118`).
- **Touch targets** ≥ 44px, 48px preferred (`--tap-comfort: 48px`, `globals.css:1481`). Never below 44 for a primary control.
- **Focus visibility:** `focus-visible:ring-2` (+ `ring-offset-2` on decorative backgrounds) on every interactive element.
- **Press feedback:** `active:scale-[0.98]`/`active:scale-95` on touchable rows and FABs; not a substitute for focus styling.
- **Quiet by default:** cards with nothing to say self-hide rather than occupying space with filler.
- **No dark patterns:** no fake urgency, no guilt copy, no streak shaming. A broken streak offers a comeback path, never shame.
- **Progress is visible and earned:** never fabricate, round up, or "encourage" a number. Every percentage shows its denominator; percentages over fewer than N = 5 observations are suppressed or marked provisional (assessment-owned floor). Mastery/accuracy/XP semantics and the re-present/re-compute line are defined in `student-dashboard-design` → Learner Data Semantics and bind every surface.
- **Recognition over recall:** use plain learner language over system terminology; translate engine acronyms (IRT, SRS, CME, DKT/BKT, BoardScore internals) into useful reasons and actions.

## 4. The complete state model

Every data-bound region and action must define, at minimum, the four required states plus the extended set where relevant:

| State | Requirement |
|---|---|
| Loading | Shape-matched skeleton; `<section aria-busy="true">`; bones mirror loaded layout |
| Loaded | The real presentation |
| Empty / insufficient evidence | Dashed panel + `aria-hidden` emoji + headline + sub-line + CTA to the action that fills it. **Empty may only blame the student when the emptiness is attributable to the student** — a platform content/coverage gap is not the child's inaction |
| Recoverable error | Bilingual, `role="status"`, never the raw error string, retry where the fetch is cheap |
| Partial / stale | Show what is known + a freshness marker when it affects interpretation; `keepPreviousData` shows stale-while-loading |
| Offline / interrupted | The offline boundary (`packages/ui/src/offline/v2/OfflineBoundary.tsx`) covers logged-in students; downloaded chapters, queued answers, Foxy state |
| Locked / permission-limited | Locked nav items render a "Grade N+" chip + lock (`MobileBottomNav.tsx:125-161`); locked subjects stay visible and greyed with an upgrade CTA, never hidden (`(student)/learn/page.tsx` header) |
| Completion / undo | Confirmation and undo where applicable; celebrate the specific win ("3 chapters mastered in Science"), not generic praise |

**Anti-pattern:** a failed or in-flight fetch must never masquerade as a positive empty state ("all caught up", "0 topics"). Gate reassuring empties on `loaded && !error` (reference: `RevisionRail.tsx:35-36,80`). Every visible control must work, be disabled with a reason, or be removed.

## 5. Motion

- **CSS-only. No framer-motion, no runtime animation dependency** (P10 protection; stated in the CSS).
- Reveal stagger: `.os-reveal-card` + `--reveal-i` keyframes (`globals.css:~3923-3962`); roadmap nodes use `--stagger-i`.
- Tailwind animation utilities: `float`, `scale-in`, `slide-up`, `fade-in`, `bounce-in`, `level-up`, `xp-burst`, `streak-pulse`, `mastery-fill`, `score-reveal`.
- **Reduced motion:** global blanket collapses all animation under `prefers-reduced-motion` (`globals.css:772-788`). Looping/infinite animations need an explicit `animation: none !important` entry in the kill block (`:779-786`); one-shots are auto-collapsed. `AppShell` no-ops the media query by design — CSS owns reduced motion, not JS.

## 6. Bilingual (P7)

- No i18n library, no locale JSON. `const { isHi } = useAuth()`; components read `isHi` via props or hooks, never a second context.
- 1–3 strings → inline ternary; many strings → `const T = {}` label map; enum labels → bilingual constant tables (`STATUS_CFG` in `BoardScoreWidget`, `BUCKETS` in `MasterySnapshot`).
- Today-queue copy routes through `todayCopy()` (`packages/lib/src/today/copy.ts`).
- Error boundaries cannot use AuthContext — sniff `localStorage['alfanumrik_language'] === 'hi'` (the `/dashboard` `error.tsx` pattern).
- Never ship a user-facing string English-only. Do **not** translate CBSE, XP, Bloom's, BoardScore™, Foxy, NCERT, PYQ.

## 7. Foxy experience contract

- **One persistent, non-blocking entry point.** The center FAB in the bottom nav IS the `/foxy` route (`MobileBottomNav.tsx:263-303`). Embedded Foxy on a page goes through `FoxyPanelLauncher` (`packages/ui/src/foxy-launcher/FoxyPanelLauncher.tsx`) — a compact CTA until tapped, then `next/dynamic({ssr:false})` panel. **Never import `FoxyPanel` statically from a page** (enforced by the `foxy-panel-no-static-embed.test.ts` regression test).
- **Keep the current task visible while Foxy opens** — an embed must not replace or obscure the page's primary action; on dashboards the launcher is a compact secondary row.
- **Modes:** `learn / explain / practice / revise / doubt / homework / explorer`. Prefer short actions in the panel: Explain simpler, Give an example, Hint, Quiz me, Save to notebook, Report issue.
- **Context through real contracts:** learner, concept, attempt, language, modality, and safety context travel via the existing Foxy routes/state — never via fabricated fields.
- **Truthfulness:** Foxy never fabricates mastery, grades, teacher messages, or learning history. Surfaced mastery comes from backend-owned state, not the chat's own claims.
- **Safety (P12):** age-appropriate (grades 6-12), CBSE-scope responses, per-plan daily limits. "Limit reached" is a clear bilingual state, never a raw API error.
- **Privacy (P13):** no `studentId`/`studentName` in logs, Sentry, or analytics with Foxy events. Learner-memory transparency + erasure live on the `/memory` surface.
- **Full screen:** `/foxy` is edge-to-edge (`bleed` + `foxy-shell`), body scroll locked via `:has()` (`globals.css:1597-1615`), header blur dropped (`:1629-1634`).

## 8. Accessibility floor (WCAG 2.2 AA)

Run on every new or touched component:

- [ ] Bilingual `aria-label` on sections/dialogs where the heading is not self-describing
- [ ] `aria-busy="true"` on loading shells; `role="status"`/`alert` for status/error panels
- [ ] `role="list"` + `role="listitem"` for repeated rows
- [ ] `role="progressbar"` + `aria-valuenow/min/max` + bilingual label on bars/rings/gauges
- [ ] `aria-hidden="true"` on every decorative emoji/glyph/decoration
- [ ] `focus-visible:ring-2` everywhere; logical focus order; focus managed after sheet/dialog open and after retry/tab switches
- [ ] Touch target ≥ 44px (48 preferred) — stricter than WCAG 2.2 2.5.8's 24px floor
- [ ] Meaning never colour-only (1.4.1) — pair colour with icon + label + number
- [ ] Contrast via tokens; verify custom colours against their actual background
- [ ] No keyboard traps; Escape closes sheets/dialogs (More sheet: `MobileBottomNav.tsx:54-58`)
- [ ] Focus not obscured by sticky header/nav (scroll-margin where a target could hide under it)
- [ ] Reduced-motion respected (§5)
- [ ] Exactly one `h1` per page/screen
- [ ] Errors announced, not just coloured (3.3.x)

## 9. Event plan (analytics)

- Events go through `track()` (`packages/lib/src/analytics.ts`) with names matching the tracking-plan conventions.
- **Never include PII or identifiers** — event name + non-identifying counts; server correlates from the authenticated session.
- New surfaces emit events; placeholder analytics that fire but feed nothing are rejected.
