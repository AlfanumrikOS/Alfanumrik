# Alfanumrik — Consumer-Minimalist / Professional-Depth Redesign (Design Spec)

**Status:** Proposed · **Author:** Orchestrator (system-design) · **Date:** 2026-06-06
**Companion plan:** [docs/superpowers/plans/2026-06-06-phase-1-consumer-minimalism.md](../plans/2026-06-06-phase-1-consumer-minimalism.md)
**Approval required from:** CEO (Pradeep Sharma) — IA changes are product strategy; parent-auth unification touches P15.

---

## 1. Problem statement

Alfanumrik has a powerful learning **engine** (cognitive-engine: SM-2, BKT, IRT 3PL, ZPD, interleaving, Bloom) wrapped in a **catalog of features**. The result is three measurable problems:

| Symptom | Evidence | Cost |
|---|---|---|
| Student surface sprawl | 27+ student routes; `/quiz` vs `/pyq` vs `/mock-exam` vs `/exams` overlap; `/review` vs `/study-plan` overlap; `/dive`+`/synthesis`+daily-rhythm are 3 destinations for 1 idea | Student must *pick a mode* before learning; the adaptive resolver that should pick for them is buried |
| Mobile is a thin afterthought | Flutter app ~35–40% parity, **student-only**; chat has no history/modes; no progress/exams/leaderboard; STEM is a WebView | Highest-growth channel (mobile-first India) is the weakest product |
| Architectural duality | 9 active Exceptions (E1–E9): Foxy two code paths, parent dual auth (E2), payments skip `authorizeRequest` (E8), event bus flagged OFF with Path-C fallback (E5) | Each duality hides bugs and lets web/mobile drift |

**Thesis:** fewer doors on the consumer side, deeper rooms on the professional side, both on one contract and one source of truth.

---

## 2. Design philosophy — two products, two languages

```
        CONSUMER PLANE                      PROFESSIONAL PLANE
   (students + parents)                  (teachers + schools)
   Principle: THE SYSTEM DECIDES         Principle: THE USER CONTROLS
   Mobile-first, native, offline-tolerant Desktop-first, data-dense, bulk ops
   <= 4 destinations, one loop           Deep hierarchies, tables, filters
   Minimize cognitive load               Maximize information density
```

---

## 3. Student — minimalist mobile

**IA: 4 tabs, one loop.**

```
TODAY   the adaptive queue (home)   <- ~90% of sessions
LEARN   browse subjects/chapters    <- "I want to choose"
FOXY    AI tutor (center)           <- ask anything
ME      progress / streak / profile <- motivation + settings
```

**The "Today" screen** is the product: one greeting strip (streak + XP), one big **Today's Focus** card with a single **Continue** CTA, an auto-built **Up next** list (SRS due, weak-topic ZPD pick, weekly dive/monthly synthesis when due), and a week sparkline. Behind "Continue", the resolver (src/lib/state/learner-loop/) decides the next item. The student experiences flow, not a file-picker.

**Collapses (same capability, fewer doors):**

| Today (separate routes) | Becomes |
|---|---|
| `/dashboard` + `/study-plan` + `/review` + daily-rhythm | **Today** tab (one queue) |
| `/quiz` + `/pyq` + `/mock-exam` + `/exams` | **One quiz runtime**, parameterized `mode: practice \| pyq \| mock \| exam` |
| `/dive` + `/synthesis` | Queue cards inside Today, full-screen when due |
| `/progress` + `/leaderboard` + `/profile` | **Me** tab |
| `/stem-centre` | **Learn** entry + queue card; native top sims, WebView long tail |

**27 destinations → 4.** Deep routes survive as redirectable URLs (SEO) but leave the nav. **Learn** tab is the always-available manual escape hatch so the student is never trapped by a bad resolver pick.

---

## 4. Parent — minimalist mobile ("glance, not dashboard")

Parents ask three questions: *Is my child okay? What did they do? What should I do?* Today that is an 8-tab, ~1,200-LOC-per-page web portal behind custom HMAC auth. Redesign for how parents actually behave — **push-first**.

**New IA: one scroll + push, three surfaces.**

```
SNAPSHOT  this week, plain language (no charts)
MOMENTS   AI-summarized breakthroughs + struggles + teacher notes
ACTIONS   1-tap: Encourage child / Full report / Manage plan / Message teacher
```

- **Push notification / WhatsApp is the primary surface**; the app is for occasional depth.
- The heavy 6-tab `/parent/reports` survives as a *secondary, on-demand* report — not the home.
- **One-tap "Encourage"** (new) sends the child an in-app cheer — the parent-retention lever, absent today.

**Eight tabs → one home + a settings drawer** (children/billing/messages/consent move to settings).

**Backend prerequisite:** close **E2** — drop HMAC `link_code` auth, standardize on Supabase guardian role + `guardian_student_links`, so parent web and mobile share auth/RLS/BFF. This is the gate for any parent mobile app.

---

## 5. Teacher — professional depth (density is the feature)

Desktop-first **Class Command Center**: roster mastery heatmap (concept × student), at-risk alerts, today summary, action bar. Heatmap + alerts already exist via the `teacher-dashboard` Edge Function; the gap is the **action layer**.

**The #1 gap: assignment → autograde → exception-review → intervene lifecycle.**

```
CREATE -> ASSIGN -> AUTO-GRADE -> REVIEW (exceptions only) -> INTERVENE (1-click remediation)
```

- Auto-grade everything gradeable; surface only exceptions (4 flags, not 32 papers).
- Intervention is one click: at-risk alert → push targeted remediation queue into those students' **Today** tab (closes consumer↔professional loop).
- Bulk roster via CSV (today: invite-codes only).

Teacher targets: bulk CSV roster · full grading + exception review · optional attendance · mastery+Bloom gradebook · threaded parent comms w/ attachments · alert→remediation.

---

## 6. School / Admin — professional depth

**Explicit tenant hierarchy:**

```
TRUST / DISTRICT (optional, for chains)   <- NEW dormant tier
  School (tenant: branding, plan, seats, modules, locale)
    Grade (6-12)
      Section (9-A, 9-B)
        Class (Section x Subject x Teacher)
          Student --< guardian_student_links >-- Parent
```

**Four things to finish for schools:**

| Capability | Status | Why |
|---|---|---|
| Seat licensing + enforcement | shown, not enforced | how B2B revenue is metered — enforce at enrollment |
| Bulk provisioning (teachers too) | students CSV only | schools onboard 500 students + 30 teachers in week 1 |
| White-label theming | built, flagged OFF (`ff_tenant_config_v2`, `ff_tenant_type_v1`) | flip on for pilots — it's done |
| Deep analytics | dashboards exist; cohort/predictive in pilot | principals buy on outcomes |

`schools.tenant_type ∈ {school, coaching, corporate, government}` is a strong white-label lever — finish copy variants so "class"→"batch"/"course" sells one codebase into four markets.

---

## 7. System architecture — making it flawless

```
   Web (Next)        Mobile (Flutter)
       \   same typed /v2 contract   /
            BFF / API  (role-scoped, resource-oriented)
                 Domain services  (src/lib/domains/* — exist)
                 Event spine  (state_events -> projectors -> resolver)
```

1. **One BFF contract, two thin clients.** Publish a typed `/v2` contract consumed by web + mobile → mobile parity becomes "render the contract," not a porting effort. Collapse 288 routes into role-scoped domains; retire duplicates (`/api/cron/daily` vs `/api/cron/daily-cron`).
2. **Turn the event spine ON.** Finish projector dead-letter+replay; ramp `ff_tutor_bkt_v1` to 100%; watch `tutor_answer_path_c_fallback` hit zero a week; delete the fallback (E5). One canonical writer of learner state.
3. **Unify auth.** Close E2 (parent) and E8 (payments through `authorizeRequest`).
4. **Offline-tolerant consumer clients.** Cache the day's Today queue; queue submissions; background-sync on reconnect via the event spine.
5. **Consolidate ~20 flags** into a launch-phase gate matrix (Pilot → GA per capability).

---

## 8. Trade-offs

| Decision | Win | Risk | Mitigation |
|---|---|---|---|
| 27 student routes → 4 | minimalism, parity, no drift | power-user direct access, SEO | redirectable deep URLs; **Learn** = manual path |
| Adaptive Today front door | engine becomes the product | bad resolver pick = bad session | **Learn** escape hatch; offline-eval resolver |
| Parent glance + push | matches behavior, retention | less analytics surface | full report on-demand |
| One BFF contract | cheap parity | 288-route refactor | incremental `/v2`, migrate behind it |
| Event bus ON, kill fallback | one source of truth | projector lag user-visible | keep optimistic response; gate on zero-fallback week |

---

## 9. Phased roadmap

- **Phase 1 — Consumer minimalism:** Today home (web), unified quiz runtime, parent glance + Encourage + push, parent auth unification (E2). *(see companion plan)*
- **Phase 2 — Mobile parity via one contract:** publish `/v2`; Flutter renders it → full student + parent parity; offline Today queue.
- **Phase 3 — Professional depth:** teacher assignment lifecycle + bulk CSV; school seat enforcement + bulk teacher provisioning; flip white-label flags.
- **Phase 4 — Backbone hardening:** event bus 100% + delete Path-C (E5); payments via `authorizeRequest` (E8); close tenant-audit gap (E3); flag-matrix consolidation.

---

## 10. What to revisit at scale

- Resolver quality is now load-bearing — invest in offline evaluation before Today is the only path.
- Design the dormant `organizations` parent of `schools` now (first multi-school customer forces it).
- Measure projector p99 under 10× load before removing the optimistic response.
- Watch whether coaching/corporate diverge enough to need real module forks vs copy variants.

---

## Product invariants touched (must hold)

P1 score, P2 XP, P3 anti-cheat, P4 atomic submit, P6 question quality (unified quiz runtime must **not** change any formula — UI/runtime consolidation only) · P7 bilingual (all new surfaces) · P8 RLS / P9 RBAC / **P15 onboarding integrity** (parent auth unification) · P10 bundle budget (new Today/parent screens) · P13 data privacy (parent surfaces, no PII in logs).
