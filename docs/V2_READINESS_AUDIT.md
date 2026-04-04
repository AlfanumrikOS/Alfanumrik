# Alfanumrik v2.0 Readiness Audit

**Date:** 2026-04-04
**Scope:** Full-stack production readiness (Web + Android), UX upgrade assessment
**Constraint:** No changes to core engines (CME, BKT, Spaced Repetition, RAG/Voyage)

---

## Executive Summary

Alfanumrik has a **remarkably mature core** — the cognitive engine (1,412 lines implementing 15+ cognitive science principles), RAG pipeline (Voyage-3 embeddings + reranking), payment system, and auth infrastructure are production-grade. The app is **v1.x feature-complete** with 48 routes, 23 Edge Functions, 222 migrations, and 345 TypeScript files.

**v2.0 verdict: YES — upgradeable, with one critical caveat.** The core algorithms (SM-2, BKT, IRT 3PL, Ebbinghaus retention, ZPD, interleaving, cognitive load management) are individually solid. However, the **deep audit revealed critical integration gaps** between these engines that must be addressed for v2.0 to deliver on its learning science promise. The upgrade path is:

1. **Engine integration** (wiring, not algorithm changes) — 3-4 weeks
2. **UX surface** (simplify, animate, celebrate) — 2-3 weeks
3. **Mobile maturity** (feature parity, Play Store) — 3-4 weeks
4. **Operational hardening** (analytics, alerting) — 1-2 weeks

---

## Section 1: Core Engine Assessment

### 1.1 Individual Algorithms — PRODUCTION READY (DO NOT TOUCH)
| Algorithm | Implementation | Status | Maturity |
|---|---|---|---|
| SM-2 Spaced Repetition | `sm2Update()`, `responseToQuality()`, `nextReviewDate()` | Complete | 85% |
| Bloom's Taxonomy (6 levels) | Full config, progression, mastery tracking | Complete | 100% |
| Zone of Proximal Development | `calculateZPD()` with confidence bands | Complete | 100% |
| Interleaving | 70/30 weak/strong split, no back-to-back | Complete | 100% |
| Cognitive Load Manager | Fatigue detection, ease-off/push-harder/pause | Complete | 100% |
| Metacognitive Reflection | Bilingual prompts (4 types) | Complete | 100% |
| Learning Velocity Analytics | Trend detection (fast/steady/slow) | Complete | 100% |
| Knowledge Gap Detector | Severity classification, bilingual descriptions | Complete | 100% |
| IRT 3PL | Newton-Raphson MLE, `irtProbCorrect()` | Complete | 100% |
| BKT | Adaptive parameters, per-concept tracking | Complete |
| Error Classification | Careless / conceptual / misinterpretation | Complete |
| RL Reward Function | Multi-factor reward for question selection | Complete |
| Ebbinghaus Retention Decay | `predictRetention()`, `shouldRetest()` | Complete |
| Lesson Flow (6-step) | Hook → Visualization → Guided → Recall → Application → Revision | Complete |
| Predict-Before-Reveal | Active recall prompts | Complete |

**Verdict:** Individual algorithms are world-class. No algorithm changes needed.

### 1.1b CRITICAL: Engine Integration Gaps

The deep audit revealed that while each engine works in isolation, **they don't talk to each other**. This is the #1 blocker for v2.0 learning effectiveness.

#### The Three Mastery Sources Problem
| Source | Table | Written By | Read By |
|---|---|---|---|
| Quiz BKT path | `concept_mastery` | `queue-consumer` | `quiz-generator` |
| CME path | `cme_concept_state` | `cme-engine` | `cme-engine` only |
| SM-2 path | `review_cards` | `queue-consumer` | **Nobody** (orphaned!) |

**Impact:** A student's mastery is tracked in 3 places with no reconciliation. Foxy tutor reads none of them. Quiz generator reads only one.

#### Missing Integration Flows

| Flow | Current State | What Should Happen |
|---|---|---|
| Quiz → CME action | CME never called after quiz | Post-quiz should trigger CME `selectNextAction()` to recommend next step |
| SM-2 → Quiz selection | Review cards created but never fetched | 50% of quiz questions should come from due review cards |
| Error classification → Remediation | Error type stored in `cme_error_log`, never consumed | Careless → "slow down" nudge; Conceptual → Foxy re-teach with simpler RAG |
| CME → Foxy difficulty | Foxy ignores learner state entirely | Foxy should adjust explanation depth based on mastery + Bloom level |
| Bloom's enforcement | `getNextBloomTarget()` exists but never called from quiz-generator | Must master "remember" before receiving "apply" questions |

#### Resolution (Wiring, Not Algorithm Changes)
This is **plumbing work**, not core algorithm changes:
1. **Unify learner state** — Single table consolidating all 3 sources (1 migration + 1 RPC)
2. **Wire CME → quiz recommendation** — Post-quiz calls CME, stores action in `quiz_sessions`
3. **Fetch review cards in quiz-generator** — Add `WHERE due_date <= now()` query
4. **Pass learner state to Foxy** — Include mastery + Bloom level in tutor context
5. **Route error classification** — Feed `classifyError()` output back to adaptation logic

**Effort:** ~3-4 weeks | **Risk of not fixing:** HIGH — students get random difficulty, wasted review cards, no personalized remediation

### 1.2 RAG Pipeline — PRODUCTION READY (95%)
| Component | Technology | Status |
|---|---|---|
| Embeddings | Voyage-3 (1024 dims) with OpenAI fallback | Complete |
| Reranking | Voyage-rerank-2 | Complete |
| Retry logic | Exponential backoff, 3 retries | Complete |
| Vector storage | Supabase pgvector (`rag_content_chunks`) | Complete |
| Batch processing | Up to 128 texts per Voyage batch | Complete |
| Trace logging | Async to `retrieval_traces` table | Complete |
| Backward compat | `fetchRAGContextV2()` wraps new API for legacy callers | Complete |

Minor gaps: No semantic caching (repeated queries re-embed), no embedding versioning (model upgrade = re-embed all).

### 1.3 Integrations — PRODUCTION READY
| Service | Usage | Status |
|---|---|---|
| **Mailgun** | Auth emails (signup, recovery, magic link, email change) via Edge Function | Complete with branded templates |
| **Upstash** | Rate limiting (`@upstash/ratelimit` + `@upstash/redis`) | Complete |
| **Razorpay** | Monthly recurring + yearly one-time, webhook verified | Complete |
| **Sentry** | Client/server/edge, source maps, ad-blocker tunnel | Complete |
| **Vercel** | Mumbai (bom1), bundle analyzer, speed insights | Complete |

### 1.4 AI Integration — SHIP READY (7.8/10)

| AI Function | LOC | Status | Key Strength | Key Gap |
|---|---|---|---|---|
| **Foxy Tutor** | 640 | ✅ Production | Circuit breaker, 3-lang fallback, 6-category safety filter | No streaming, no output filtering |
| **NCERT Solver** | 409 | ✅ Production | 2-pass verification (solver + verifier), confidence scoring | 2x Claude cost per question |
| **Quiz Generator** | 807 | ✅ Production | Mastery-based adaptive, Bloom's scaffolding, deduplication | No mid-quiz difficulty adjustment |
| **CME Engine** | 539 | ✅ Production | IRT-based mastery, 5-tier action priority, exam readiness | Not connected to other engines |
| **Shared RAG** | 939 | ✅ Production | Voyage-3 + rerank-2, 8-filter vector search, trace logging | No semantic caching |
| **Total AI code** | 5,812 | — | — | — |

**AI Safety posture:**
- ✅ 6-category input safety filter (violence, sexual, self-harm, substance, hate, PII)
- ✅ NCERT grounding with "no reference found" disclaimer + confidence dampening
- ✅ Grade-level curriculum scope enforcement (blocks out-of-grade formulas)
- ✅ Temperature 0.3 (factual, not creative)
- ⚠️ No output filtering (relies on Claude training + prompts)
- ⚠️ No multi-turn jailbreak detection

**v2.0 AI action items:**
1. Add thumbs up/down feedback on Foxy responses (quality signal)
2. Implement token counting for cost attribution per user/feature
3. Add output safety filter (scan Claude responses for PII leakage)
4. Consider streaming for Foxy (SSE for lower perceived latency)

---

## Section 2: What Needs Upgrading for v2.0

### 2.1 UX Upgrade — Student-Oriented Psychology (HIGH PRIORITY)

**Current state:** Functional but information-dense. The dashboard has 15+ state variables. Foxy tutor has 7 modes visible upfront. Good design system (Wonder Blocks inspired by Khan Academy) but could be more focused.

**Recommended v2.0 UX philosophy: "One Thing at a Time"**

Based on educational psychology (Cognitive Load Theory, Self-Determination Theory, Flow Theory):

#### A. Reduce Decision Fatigue (Hick's Law)
| Current | v2.0 Upgrade | Psychology |
|---|---|---|
| Dashboard shows 15+ data points at once | **Focus Dashboard**: 3 cards max — Today's Goal, Continue Learning, Streak | Cognitive Load Theory: 7±2 items max |
| Foxy has 7 modes visible (Learn, Practice, Quiz, Doubt, Revise, Notes, Lesson) | **Smart Mode**: Auto-select mode based on learner state. Show 3 max: recommended + 2 alternatives | Paradox of Choice: fewer options → more engagement |
| Subject picker + topic picker + mode picker | **One-tap flow**: "Continue where you left off" as primary CTA | Flow Theory: reduce friction to enter flow state |
| Complex onboarding (grade + board) | Add **interest/goal selection**: "What do you want to achieve?" (Exam prep / Understand better / Stay ahead) | Self-Determination Theory: autonomy in goal-setting |

#### B. Gamification & Motivation (Self-Determination Theory)
| Current | v2.0 Upgrade | Psychology |
|---|---|---|
| XP + Levels exist but are secondary | **XP always visible** in top bar with animated progress ring | Operant conditioning: visible progress |
| Streak badge exists | **Daily streak prominently displayed** with loss-aversion messaging ("Don't break your 7-day streak!") | Loss Aversion (Kahneman) |
| Level names (Curious Cub → Grand Master) | Add **visual avatar evolution** — Foxy grows/changes with level | Identity-based motivation |
| Leaderboard is a separate page | **Mini leaderboard widget** on dashboard (top 3 + your rank) | Social comparison theory |
| No celebration moments | **Celebration screen** after quiz completion: confetti, XP burst, Foxy celebration animation | Dopamine reward loop |

#### C. Visual Simplification (Minimalism)
| Current | v2.0 Upgrade |
|---|---|
| Warm cream theme (#FBF8F4) — good | Keep it. Add subtle **glassmorphism** for cards on premium feel |
| Emoji-based icons (📖, ✏️, ⚡, etc.) | Replace with **custom Foxy-themed SVG icons** for polish |
| CSS animations (float, bounce, fade) | Add **Framer Motion** for page transitions, card swipes, progress animations |
| No dark mode | Add **dark mode** (students study at night, OLED battery saving) |
| 720px max content width | Good for mobile-first. Add **tablet layout** (2-column) for larger screens |

#### D. Navigation Simplification
| Current Bottom Nav | v2.0 Bottom Nav |
|---|---|
| Multiple items | **4 items only**: Home, Foxy (AI), Learn, Profile |
| Separate pages for progress, review, study-plan | Merge into **unified "Learn" tab** with sub-sections |
| Leaderboard, exams, scan as separate routes | Move to dashboard cards or profile sub-sections |
| Notifications as separate page | **In-app notification bell** in header (badge count) |

#### E. Micro-interactions & Polish
- **Page transitions**: Slide left/right for navigation, slide up for modals
- **Skeleton loading**: Already exists (good), enhance with shimmer animation
- **Pull-to-refresh**: On dashboard and learn pages
- **Haptic feedback**: On correct answer, XP gain, level up (mobile)
- **Sound effects**: Optional toggle — correct ding, wrong buzz, level-up fanfare
- **Typing indicator**: When Foxy is "thinking" — show animated dots
- **Smooth number counting**: XP and score animations (count up)

### 2.2 Mobile App (Android) — NEEDS SIGNIFICANT WORK

**Current state:** 46 Dart files, clean architecture (providers/repositories/screens pattern), Riverpod + GoRouter. But:

| Area | Current State | v2.0 Requirement |
|---|---|---|
| **Screens** | 13 screens (splash, auth, dashboard, quiz, chat, settings, subjects, chapters, topics, concept, plans) | Feature parity with web (missing: progress, review, leaderboard, study-plan, exams, scan, notifications, reports) |
| **Tests** | 1 file (`widget_test.dart`) | Need 30+ widget tests, 10+ integration tests for Play Store confidence |
| **Offline** | Hive + SharedPreferences available | Need offline quiz caching, sync queue, conflict resolution |
| **Push Notifications** | Not implemented | Need Firebase Cloud Messaging (FCM) + local notifications |
| **Deep Linking** | GoRouter supports it | Need verified app links for `alfanumrik.com` |
| **ProGuard** | Enabled (`minifyEnabled true`) | Good |
| **minSdk** | 21 (Android 5.0) | Consider raising to 23 (Android 6.0) — drops <1% of Indian users, gains security APIs |
| **App Bundle** | Not verified | Need AAB (not APK) for Play Store, check bundle size |
| **Crashlytics** | Not present | Need Firebase Crashlytics |
| **Play Store metadata** | Not prepared | Need: screenshots, descriptions (EN + HI), privacy policy URL, content rating |
| **Version** | 1.0.0+1 | Need version management strategy |

**Play Store Readiness Score: 4/10** — Functional skeleton, needs significant feature parity and polish work.

### 2.3 Testing & Quality — CRITICAL GAPS FOUND

| Metric | Current | v2.0 Target | Status |
|---|---|---|---|
| Unit tests | 47 files, 1,621 tests, 2,754 assertions | 60+ files | ✅ Good foundation |
| E2E tests | 7 specs (smoke, auth, nav, SEO, a11y) | 15+ (full user journeys) | ⚠️ Missing: quiz, payment, signup |
| Mobile tests | 1 placeholder file (non-functional) | 30+ widget + 10 integration | ❌ Zero coverage |
| **Regression catalog** | **4/35 (11%)** — NOT 100% as claimed | **35/35 (100%)** | ❌ **CRITICAL BLOCKER** |
| Type safety | Strict mode, 27 `any` instances | Maintain strict | ✅ Good |
| Bundle budget | <160kB shared, <260kB pages, CI-enforced | Monitor with v2.0 additions | ✅ Good |
| E2E gate in CI | `continue-on-error: true` (non-blocking) | Must block merges | ❌ Fix required |
| Dependencies | 3 HIGH severity vulns (glob via eslint-config-next) | 0 high severity | ⚠️ Patch needed |

**Regression catalog breakdown — what's missing:**
- P1 Score Accuracy: 0/8 tests
- P2 XP Economy: 0/8 tests
- P3 Anti-Cheat: 0/5 complete (3 partial)
- P6 Question Quality: 0/4 tests
- P11 Payment Integrity: 0/4 tests
- Only RBAC has 3/4 passing (best covered area)

### 2.3b Mobile App — NOT PLAY STORE READY

| Area | Score | Blocker? |
|---|---|---|
| Architecture (Riverpod + GoRouter) | 8/10 | No |
| State management | 8/10 | No |
| Security (PKCE, HTTPS-only) | 8/10 | No |
| **Release signing** | **0/10** | **YES — debug keystore** |
| **App icon & screenshots** | **0/10** | **YES — no assets** |
| **Privacy policy URL** | **0/10** | **YES — not hosted** |
| Testing | 0/10 | YES — zero coverage |
| Crash reporting | 0/10 | YES — no Crashlytics |
| Push notifications | 0/10 | No (post-launch) |
| Feature parity with web | 5/10 | No (companion app) |
| Offline write queue | 0/10 | Yes — quiz results lost |
| **Overall Play Store readiness** | **4/10** | **4-6 weeks to fix** |

### 2.4 Performance & Scalability

| Area | Current | v2.0 Upgrade |
|---|---|---|
| **Image optimization** | Next.js Image with AVIF/WebP | Good |
| **Caching** | SWR + service worker + Upstash Redis | Good |
| **Security headers** | CSP + HSTS + X-Frame-Options + Permissions-Policy | Excellent |
| **Code splitting** | Next.js automatic | Good |
| **Font loading** | Google Fonts loaded from CDN | Consider self-hosting for privacy + speed |
| **Bundle analysis** | Available via `npm run analyze` | Need CI integration for size regression alerts |
| **Database indexes** | 222 migrations suggest mature schema | Audit slow queries with `pg_stat_statements` |
| **Edge Function cold starts** | Deno-based, no specific optimization | Consider warming strategy for foxy-tutor |

### 2.5 Infrastructure Gaps

| Gap | Impact | Effort |
|---|---|---|
| **DB connection pooling not verified** | Serverless cold starts → connection exhaustion at 50k+ users | High — verify PgBouncer on Supabase |
| **Circuit breaker only in foxy-tutor** | Other Edge Functions (ncert-solver, quiz-generator) lack graceful degradation | Medium — roll pattern to all external API callers |
| **No distributed tracing** | Cannot correlate API → Edge Function → RPC in incidents | Medium — add request ID propagation |
| **No feature flag UI** | Can't A/B test UX changes | Medium — ops owns this |
| **No analytics events** | Can't measure UX improvement impact | Medium — add Mixpanel/PostHog |
| **No error rate alerting** | May miss production issues | Low — add Sentry alert rules |
| **No load testing** | Unknown breaking point | Medium — k6 or Artillery scripts |
| **Upstash underutilized** | Only rate limiting — no caching, session store, or feature flag cache | Low — extend usage |
| **Webhook endpoints not rate-limited** | Razorpay/Mailgun webhooks could be DDoS vector | Low — add per-endpoint limits |
| **Health check gaps** | No checks for: Storage, Edge Functions, Mailgun, Razorpay reachability | Low — extend health endpoint |

---

## Section 3: v2.0 Upgrade Roadmap

### Phase 0: Engine Integration (3-4 weeks) �� CRITICAL
**Goal:** Unify the three mastery sources and wire engine feedback loops

0a. **Unified learner state migration** — Consolidate `concept_mastery` + `cme_concept_state` + `review_cards` into single canonical table with dual-write migration
0b. **Post-quiz CME action** — After quiz submission, call CME `selectNextAction()`, store recommendation in `quiz_sessions`
0c. **SM-2 review card fetching** — Quiz generator queries due review cards (50% weight)
0d. **Bloom's enforcement** — Quiz generator checks `getNextBloomTarget()` before serving questions
0e. **Error classification routing** — Feed `classifyError()` output to Foxy remediation context
0f. **Foxy learner context** — Pass mastery + Bloom level + error patterns to foxy-tutor prompts
0g. **Integration tests** — End-to-end: submit quiz → mastery updates → CME action → Foxy recommendation

### Phase 1: UX Foundation (2-3 weeks)
**Goal:** Visible improvement without touching core algorithms

1. **Dark mode** — Add CSS variables for dark theme, toggle in settings
2. **Framer Motion** — Add `framer-motion` for page transitions and micro-interactions
3. **Simplified dashboard** — Reduce to 3 primary cards + progressive disclosure
4. **Smart Foxy mode** — Auto-select learn/practice/quiz based on learner state (CME already provides this data!)
5. **Celebration screens** — Post-quiz confetti, XP burst animations, Foxy reactions
6. **Notification bell** — Move from separate page to header component
7. **Custom SVG icons** — Replace emoji-based UI elements with Foxy-themed icons

### Phase 2: Student Psychology (1-2 weeks)
**Goal:** Engagement and retention

8. **Streak loss-aversion** — Push notification + dashboard warning for at-risk streaks
9. **Daily goal setting** — "Study 15 minutes today" with progress ring
10. **Mini-leaderboard** — Dashboard widget showing top 3 + student rank
11. **Learning path visualization** — Topic tree/map showing progress through curriculum
12. **Smart nudges** — Already in database (`nudges` table), surface them better in UI
13. **Session summary** — End-of-session stats: time, questions, accuracy, XP earned

### Phase 2b: Testing & Regression (2 weeks, parallel with Phase 2)
**Goal:** Fix critical testing gaps

13b. **Regression catalog** — Write 31 missing tests (P1 scoring: 8, P2 XP: 8, P3 anti-cheat: 5, P6 question quality: 4, P11 payment: 4, P5 grade: 2)
13c. **E2E critical flows** — Add quiz submission, payment, signup E2E specs
13d. **Enable E2E gate in CI** — Remove `continue-on-error: true` from Playwright step
13e. **Patch dependencies** — Fix 3 high-severity glob vulnerabilities
13f. **AI quality feedback** — Add thumbs up/down to Foxy responses for quality signal

### Phase 3: Mobile App → Play Store (3-4 weeks)
**Goal:** Play Store submission

14. **Release signing** — Generate keystore, configure build.gradle signing (CRITICAL BLOCKER)
15. **Visual assets** — App icon (512x512), feature graphic (1024x500), 5-8 screenshots
16. **Privacy policy** — Host at alfanumrik.com/privacy (CRITICAL BLOCKER)
17. **Firebase Crashlytics** — Error tracking for production monitoring
18. **Feature parity** — Add missing screens (progress, review, leaderboard, study-plan)
19. **Offline quiz queue** — Cache quiz submissions in Hive, sync on reconnect
20. **Push notifications** — Firebase Cloud Messaging for streak reminders
21. **Widget tests** — 30+ tests covering all screens
22. **App bundle optimization** — Verify AAB build, check bundle size

### Phase 4: Operational Readiness (1-2 weeks)
**Goal:** Production confidence

21. **Analytics events** — Key funnel tracking: signup → onboard → first quiz → subscription
22. **Error alerting** — Sentry alert rules for spike detection
23. **Load testing** — k6 scripts for API routes and Edge Functions
24. **Self-hosted fonts** — Remove Google Fonts CDN dependency
25. **Bundle size CI gate** — Fail builds if bundle exceeds budget
26. **Database query audit** — Identify and index slow queries

---

## Section 4: What NOT to Change

These are explicitly preserved per requirements:

| Component | Reason |
|---|---|
| SM-2 Spaced Repetition algorithm | Core learning engine, well-tested |
| BKT (Bayesian Knowledge Tracing) | Adaptive parameter model working correctly |
| IRT 3PL implementation | Newton-Raphson MLE converges reliably |
| Ebbinghaus retention model | Drives review scheduling |
| Cognitive Load Manager | Fatigue detection thresholds calibrated |
| Voyage AI embeddings (voyage-3) | RAG retrieval quality depends on this model |
| Voyage reranking (voyage-rerank-2) | Improves retrieval precision |
| XP economy constants | P2 product invariant |
| Scoring formula | P1 product invariant |
| Anti-cheat system | P3 product invariant |
| Mailgun email delivery | Working, branded templates |
| Upstash rate limiting | Working, protects API |
| Razorpay payment flow | P11 product invariant |

---

## Section 5: Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Framer Motion adds bundle size | Medium | Tree-shake, lazy-load animation components, monitor P10 budget |
| Dark mode CSS conflicts | Low | Use CSS custom properties (already in use), test systematically |
| Mobile feature parity takes longer than estimated | High | Prioritize: dashboard, quiz, Foxy chat first. Others can be web-only initially |
| Analytics tracking slows pages | Low | Use `requestIdleCallback` for non-critical events |
| Play Store review rejection | Medium | Follow Google's education app policies, prepare data safety section early |
| Student confusion with UI changes | Medium | Feature-flag new UI, A/B test with small cohort first |

---

## Section 6: Technology Recommendations

### Add (No Core Changes)
| Technology | Purpose | Bundle Impact |
|---|---|---|
| `framer-motion` | Page transitions, micro-interactions | ~15-25kB gzipped (tree-shakeable) |
| `@vercel/og` | Social sharing images | Server-side only |
| Firebase (mobile only) | FCM + Crashlytics | Mobile bundle only |
| PostHog or Mixpanel | Product analytics | <10kB script |

### Replace (Cosmetic Only)
| Current | Replacement | Reason |
|---|---|---|
| Emoji icons (📖 ✏️ ⚡) | Custom SVG icon set | Professional polish, consistent sizing |
| Google Fonts CDN | Self-hosted Sora + Plus Jakarta Sans | Privacy, speed, no external dependency |

### Keep As-Is
| Technology | Version | Reason |
|---|---|---|
| Next.js | 16.2.1 | Current, App Router mature |
| React | 18.3 | Stable, concurrent features used |
| Supabase | 2.49.1 | Auth + DB + Realtime working well |
| Tailwind | 3.4 | Design system built on it |
| SWR | 2.4 | Caching + revalidation working |
| Vitest | 4.1 | Fast, modern test runner |
| Flutter | 3.16+ | Mobile framework, Riverpod state |

---

## Section 7: Estimated Effort

| Phase | Duration | Agents Needed | Priority |
|---|---|---|---|
| Phase 0: Engine Integration | 3-4 weeks | architect, assessment, ai-engineer, backend, testing | CRITICAL |
| Phase 1: UX Foundation | 2-3 weeks | frontend, quality | HIGH |
| Phase 2: Student Psychology | 1-2 weeks | frontend, assessment (validation), quality | HIGH |
| Phase 3: Mobile Polish | 3-4 weeks | mobile, testing, quality | HIGH |
| Phase 4: Operational | 1-2 weeks | ops, architect, testing | MEDIUM |
| **Total** | **10-14 weeks** | — | — |

**Note:** Phases 1-2 can run in parallel with Phase 0 (different files). Phase 3 can start after Phase 1.

---

## Conclusion

### Final Scorecard (6 Deep Audits Completed)

| Domain | Score | Verdict | Primary Blocker |
|---|---|---|---|
| Core Engines (CME/BKT/SM-2/IRT) | 9/10 | Algorithms world-class | Integration between engines broken |
| RAG Pipeline (Voyage) | 9.5/10 | Production-ready | No semantic caching |
| AI Integration (Foxy/NCERT/Quiz) | 7.8/10 | Ship-ready | No quality feedback, no output filtering |
| Frontend UX | 8.5/10 | Strong foundation | No dark mode, needs simplification |
| Backend & Infrastructure | 7.5/10 | Ready with caveats | Connection pooling, distributed tracing |
| Security & Auth | 9/10 | Excellent | RLS complexity (185 migrations of fixes) |
| Testing & Regression | 5/10 | **CRITICAL GAPS** | Regression catalog 11%, E2E non-blocking |
| Mobile App (Android) | 4/10 | **NOT READY** | No signing, no assets, zero tests |
| Documentation | 9/10 | Comprehensive | Missing API reference |
| **Overall** | **7.5/10** | **Upgradeable** | — |

### v2.0 Upgrade Path

Alfanumrik is **architecturally ready for v2.0** with three critical prerequisites:

1. **Wire the engines together** (Phase 0, 3-4 weeks) — Three mastery tables must become one. SM-2 review cards must be fetched. CME actions must be consumed. Foxy must see learner state. This is plumbing, not algorithm changes.

2. **Fix testing gaps** (Phase 2b, 2 weeks, parallel) — Regression catalog at 11% is a **data integrity risk**. Missing P1/P2/P6/P11 tests mean scoring, XP, question quality, and payment changes could ship broken.

3. **Prepare Android for Play Store** (Phase 3, 3-4 weeks) — Debug keystore, missing assets, no privacy policy, and zero tests are hard blockers.

**What's already excellent and must NOT change:**
- All core algorithms (SM-2, BKT, IRT 3PL, Ebbinghaus, ZPD, interleaving)
- Voyage-3 embeddings + rerank-2 RAG pipeline
- Mailgun email delivery, Upstash rate limiting, Razorpay payments
- 7-layer security (middleware → RLS → RBAC → CSP → HSTS → bot blocking → Sentry)
- Wonder Blocks design system (81 components, AAA contrast, ARIA, keyboard nav)
- 5,812 lines of AI code across 5 Edge Functions with circuit breakers

**The UX upgrade philosophy:** "One Thing at a Time"
- Reduce dashboard from 15+ data points to 3 focus cards
- Auto-select Foxy mode from learner state (CME already provides this!)
- Add dark mode, celebration screens, Framer Motion transitions
- Minimize choices (Hick's Law), maximize flow (Flow Theory)

**Estimated total: 10-14 weeks across 5 phases (0-4), with Phases 1-2 running parallel to Phase 0.**

---

*Audit conducted: 2026-04-04 by 6 specialist agents (core engines, frontend UX, backend infrastructure, mobile app, testing & quality, AI integration) examining 345 TypeScript files, 46 Dart files, 222 SQL migrations, 23 Edge Functions, 47 test files, and 47 operational documents.*
