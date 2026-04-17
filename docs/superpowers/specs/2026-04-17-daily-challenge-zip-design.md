# Daily Challenge (Concept Chain) — Design Spec

## Context

The current app has no daily engagement hook. Students open the app when they feel like studying, but there's no pull to come back every day. LinkedIn's game suite (Crossclimb, Pinpoint, Queens, Tango, Zip) achieves 84% next-day return rates through daily puzzles, streaks, and social visibility.

**Goal**: Introduce a daily curriculum-aligned challenge (Concept Chain) that students earn by studying first, creating a study-then-play loop that drives daily habit formation while teaching real CBSE concepts.

**Key insight**: LinkedIn's games are generic brain teasers — empty calories. Ours are curriculum-aligned, meaning every daily challenge session has genuine learning value. We also have classmate-level social dynamics (far stronger than LinkedIn's professional connections) and difficulty personalization via the cognitive engine's ZPD.

---

## 1. Architecture

### The Daily Loop

```
Student opens app
  -> Dashboard shows: "Locked: Today's Challenge: Biology — Life Processes"
  -> Student completes effort gate (quiz >= 5 questions, Foxy session, study task, or revision)
  -> Dashboard updates: "Unlocked! Solve now"
  -> Student plays Concept Chain (~2 min)
  -> Result: "Solved in 3 moves! Day 12"
  -> Earns: 15 coins + consistency signal + streak continues
  -> Class board updates: "Priya solved today's challenge"
```

### Where It Lives

| Location | What Shows |
|---|---|
| Dashboard (primary) | Challenge card — locked/unlocked state, today's topic, streak flame |
| Dedicated `/challenge` page | Full game UI, result screen, class board, streak history |
| Profile | Streak badge, milestone badges (bronze/silver/gold), best streak |
| Leaderboard | "Challenge Streaks" tab alongside existing ranks/compete/fame tabs |

### Integration With Performance Score

The daily challenge feeds into the behavioral component of Performance Score:
- **Consistency** (4/20 weight): solving the daily challenge counts as an active day
- **Challenge-seeking** (3/20 weight): the challenge IS a ZPD-targeted activity

It does NOT directly affect the performance component (80%). The challenge is too short to meaningfully measure mastery. This keeps the Performance Score honest.

---

## 2. Concept Chain — Game Mechanics

### Core Experience

Students see 4-7 shuffled concept cards and must arrange them in the correct logical order by dragging/swapping. One topic per day, shared across the entire grade, with difficulty personalized per student.

### Input Methods

- **Primary**: Drag-and-drop to reorder cards
- **Fallback**: Tap-tap swap (accessibility + small screens)

### Game Flow

| Step | Behavior |
|---|---|
| Check answer | Student taps "Check Answer" when ready. No timer. No auto-submit. |
| Correct | Celebration animation (Foxy cheers), coins awarded, streak increments. Show bilingual explanation of why this order is correct. |
| Incorrect | Foxy says "Almost! 2 cards are in the wrong place." Gentle highlight on wrong cards. Unlimited retries. No penalty. |
| Hints | After 2 failed attempts, Foxy offers to lock one card in place. No coin penalty, no shame. |
| Explanation | After solving, show 2-3 line bilingual explanation of WHY this order is correct. This is the learning moment. |

### Moves Tracking

Each swap/drag = 1 move. Moves are displayed but NOT scored, NOT compared, NOT rewarded. This prevents speed/efficiency pressure while giving the student a sense of progress.

### Personalized Difficulty (ZPD)

Same topic for the entire grade. Difficulty adjusts per student via cognitive engine:

| ZPD Band | Cards | Distractors | Example (Biology: Life Processes) |
|---|---|---|---|
| Low (mastery < 0.4) | 4 | 0 | Ingestion -> Digestion -> Absorption -> Excretion |
| Medium (0.4-0.7) | 5 | 0 | Ingestion -> Digestion -> Absorption -> Assimilation -> Excretion |
| High (> 0.7) | 5 + 1 distractor | 1 | Same 5 + "Photosynthesis" (doesn't belong) |
| Expert (> 0.9) | 5 + 2 distractors | 2 | Same 5 + "Photosynthesis" + "Transpiration" |

At high difficulty, the game becomes Concept Chain + Odd One Out naturally. The student must identify which cards don't belong, THEN sequence the rest.

### Subject Rotation

| Day | Subject | Rationale |
|---|---|---|
| Monday | Math | Start the week with structured thinking |
| Tuesday | Science | Lab-style sequencing (processes, reactions) |
| Wednesday | English/Hindi | Sentence structure, grammar rules, literary sequences |
| Thursday | Social Studies | Historical timelines, geographical processes |
| Friday | Math | Bookend the week (highest exam weight, gets 2 days) |
| Saturday | Student's weakest subject | Personalized via cognitive engine's lowest Performance Score subject. Falls back to Science if no score data exists. |
| Sunday | Fun/mixed | Cross-subject chain ("Arrange discoveries by year"). Lighter, celebratory. |

---

## 3. Unlock Gate

### Effort-Based, Not Score-Based

Students must complete ANY one of the following before the daily challenge unlocks:
- A quiz with >= 5 questions (finished, any score)
- A Foxy tutoring session (>= 3 exchanges)
- A study plan task
- Revise a topic flagged as decaying

Rationale: gating on score punishes struggling students. A Grade 6 student who attempts 10 questions and scores 30% tried harder than the Grade 10 student who scored 80% on easy recall. The Performance Score handles quality; the gate handles effort.

### 3-Day Grace Period

New users get 3 days of ungated access to the daily challenge during onboarding. This hooks them before we ask them to earn it.

### Unlock State Tracking

The unlock state is tracked per student per day in the existing `daily_activity` table. Once unlocked, stays unlocked for the rest of the calendar day (IST timezone).

---

## 4. Rewards — Three Layers

### Layer 1: Tangible (Foxy Coins)

| Event | Coins |
|---|---|
| Solve daily challenge | 15 |
| 7-day streak milestone | +25 bonus |
| 30-day streak milestone | +100 bonus |
| 100-day streak milestone | +500 bonus |

### Layer 2: Meaningful (Performance Score Signal)

Solving the daily challenge counts toward two behavioral signals:
- Consistency (4/20 weight): challenge day = active day
- Challenge-seeking (3/20 weight): challenge IS a ZPD-targeted activity

This is honest — doing the challenge daily IS consistent study behavior. But the challenge alone can't meaningfully move the Performance Score since it's one of many signals contributing to 20% of the total.

### Layer 3: Social (The Real Hook)

- Streak flame on profile (visible to classmates)
- Class challenge board (who solved today, sorted by streak length)
- Shareable result card (WhatsApp-optimized)
- Milestone badges (permanent — show achievement even after streak breaks)

---

## 5. Streak System

| Element | Design |
|---|---|
| What counts | Unlock gate completed + daily challenge solved = 1 day |
| Visibility | Flame icon with day count on profile, class board, dashboard |
| Streak freeze | 80 Foxy Coins to protect for 1 missed day (existing shop item) |
| Weekly mercy | 1 free missed day per week (automatic, no purchase needed) |
| Milestones | 7d: bronze badge + 25 coins. 30d: silver + 100. 100d: gold + 500. Badges are permanent. |
| Streak recovery | After break, show "Your best streak: 23 days" as target to beat |
| Grade 6-7 gentleness | Streak doesn't display publicly until 3+ days. Weekly mercy = 2 days instead of 1. |

---

## 6. Social Layer

### Class Challenge Board

Visible on `/challenge` page after solving and from leaderboard streaks tab:
- Sorted by streak length (rewards consistency, not performance)
- Shows only students who HAVE solved. No shaming absent students.
- Bottom shows: "12 of 34 students solved today. Class streak avg: 8.2 days"
- Teacher sees class board on `/teacher` portal (engagement pulse)
- Parents see only their child's streak. NOT the class board (avoids toxic comparison)

### Shareable Result Card

```
  Alfanumrik Daily
  April 17 - Biology

  [check][check][check][check][check]
  Solved in 3 moves
  Day 12

  alfanumrik.com/challenge
```

- 5 green squares = 5 cards solved. Doesn't reveal the answer.
- Optimized for WhatsApp sharing (critical for Indian students)
- Uses existing `src/lib/share.ts` utility

### Where We Beat LinkedIn

| Dimension | LinkedIn | Alfanumrik |
|---|---|---|
| Audience | Professional connections (low investment) | Classmates (high investment, daily proximity) |
| Content value | Generic brain teasers (zero skill development) | Curriculum-aligned (solving IS studying) |
| Difficulty | Same for everyone | ZPD-personalized with distractors at higher levels |
| Streak forgiveness | All-or-nothing | Weekly mercy + streak freeze + grade gentleness |
| Share target | LinkedIn feed (low engagement) | WhatsApp class group (high engagement) |
| Learning outcome | None | Feeds Performance Score + teaches sequencing skills |

---

## 7. Content Pipeline

### Generation: AI + Human Curation

```
Nightly cron (11 PM IST):
  1. Determine tomorrow's subject from rotation schedule
  2. For each grade (6-12):
     a. Pick chapter from CBSE academic calendar
     b. Call quiz-generator Edge Function with mode "concept_chain"
     c. AI generates: base chain (5 items) + 3 distractors + bilingual explanation
     d. Store in daily_challenges with status "auto_generated"
  3. Super-admin can review/override via CMS before morning

Morning (5 AM IST):
  4. Challenges go live
  5. Push notification: "Today's challenge is ready!"
```

### Quality Safeguards

- P6 compliance: non-empty text, 4-7 cards, valid subject/chapter, explanation present, bilingual
- AI validation: exactly one correct ordering, plausible distractors, no ambiguous sequences
- Human override: super-admin CMS page to edit/reject/regenerate
- Fallback pool: 50 pre-built chains per grade as emergency backup
- Student reporting: "Report" button, auto-flag at 3+ reports on same chain

---

## 8. Database Schema

### `daily_challenges`

```sql
id              UUID PRIMARY KEY
grade           TEXT NOT NULL          -- "6" through "12" (P5: strings)
subject         TEXT NOT NULL
chapter         TEXT
topic           TEXT NOT NULL
challenge_date  DATE NOT NULL
base_chain      JSONB NOT NULL         -- ordered array of {id, text, text_hi}
distractors     JSONB DEFAULT '[]'     -- array of {id, text, text_hi}
explanation     TEXT NOT NULL
explanation_hi  TEXT NOT NULL
status          TEXT NOT NULL DEFAULT 'auto_generated'
                CHECK (status IN ('auto_generated','approved','rejected','live'))
created_at      TIMESTAMPTZ DEFAULT now()
UNIQUE(grade, challenge_date)
```

### `challenge_attempts`

```sql
id                    UUID PRIMARY KEY
student_id            UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE
challenge_id          UUID NOT NULL REFERENCES daily_challenges(id)
solved                BOOLEAN NOT NULL DEFAULT false
moves                 INTEGER DEFAULT 0
hints_used            INTEGER DEFAULT 0
distractors_excluded  INTEGER DEFAULT 0
time_spent_seconds    INTEGER DEFAULT 0
coins_earned          INTEGER DEFAULT 0
attempted_at          TIMESTAMPTZ DEFAULT now()
UNIQUE(student_id, challenge_id)
```

### `challenge_streaks`

```sql
student_id              UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE
current_streak          INTEGER NOT NULL DEFAULT 0
best_streak             INTEGER NOT NULL DEFAULT 0
last_challenge_date     DATE
mercy_days_used_week    INTEGER DEFAULT 0
mercy_week_start        DATE
badges                  JSONB DEFAULT '[]'    -- ['bronze_7','silver_30','gold_100']
updated_at              TIMESTAMPTZ DEFAULT now()
```

All tables: RLS enabled, student reads own, parent reads linked, teacher reads assigned class.

---

## 9. Files Affected

### New Files

| File | Purpose |
|---|---|
| `src/app/challenge/page.tsx` | Daily challenge page — game UI, results, class board |
| `src/components/challenge/ConceptChain.tsx` | Core game component — drag/drop cards |
| `src/components/challenge/ChallengeCard.tsx` | Dashboard widget — lock/unlock state |
| `src/components/challenge/StreakBadge.tsx` | Flame icon + day count |
| `src/components/challenge/ClassChallengeBoard.tsx` | Class participation board |
| `src/components/challenge/ShareCard.tsx` | Shareable result card (WhatsApp) |
| `src/lib/challenge-config.ts` | Constants: rotation schedule, coin rewards, streak rules |
| `supabase/migrations/YYYYMMDD_daily_challenge_system.sql` | 3 new tables + RLS |
| `supabase/functions/generate-daily-challenge/index.ts` | Nightly AI chain generation |

### Modified Files

| File | Change |
|---|---|
| `src/app/dashboard/page.tsx` | Add ChallengeCard widget |
| `src/app/leaderboard/page.tsx` | Add "Streaks" tab |
| `src/app/profile/page.tsx` | Add streak badge + milestone badges |
| `src/app/teacher/page.tsx` | Add class challenge participation view |
| `src/components/dashboard/ProgressSnapshot.tsx` | Show current streak |
| `supabase/functions/daily-cron/index.ts` | Add challenge generation step + streak management |
| `src/lib/coin-rules.ts` | Add challenge coin rewards |
| `mobile/lib/core/constants/coin_rules.dart` | Sync challenge rewards |

### Existing Functions to Reuse

| Function | File | How Used |
|---|---|---|
| `calculateZPD()` | `cognitive-engine.ts` | Determines difficulty band per student |
| `zpdToDifficultyLevel()` | `cognitive-engine.ts` | Maps ZPD to card count |
| `share()` | `src/lib/share.ts` | WhatsApp share for result card |
| `playSound()` | `src/lib/sounds.ts` | Celebration/incorrect sounds |
| `onCorrectAnswer()` / `onWrongAnswer()` | `feedback-engine.ts` | Foxy voice lines during game |
| `COIN_REWARDS` | `coin-rules.ts` | Extend with challenge rewards |

---

## 10. Verification Plan

### Unit Tests
- `challenge-config.test.ts`: rotation schedule covers all days, coin values positive, streak rules consistent
- `concept-chain.test.ts`: correct ordering detection, distractor validation, hint mechanics, move counting
- `streak.test.ts`: streak increment, break, mercy day logic, milestone badge award, grade-sensitive mercy

### Integration Tests
- Effort gate -> unlock -> solve -> coins awarded -> streak increments
- AI generation -> validation -> storage -> retrieval at game time
- Streak freeze purchase -> miss a day -> streak preserved
- Weekly mercy -> miss 1 day without freeze -> streak preserved
- Share card generation -> WhatsApp deep link

### Manual Validation
- Play through daily challenge on mobile (320px) and desktop
- Verify drag-and-drop and tap-tap-swap both work
- Test with screen reader (accessibility)
- Verify class board only shows solvers, never names non-solvers
- Verify parent portal shows child's streak but NOT class board

### Regression
- P1 (score accuracy): untouched — challenge doesn't affect quiz scoring
- P2 (Performance Score): behavioral signals only, performance component unchanged
- P3 (anti-cheat): new UNIQUE(student_id, challenge_id) prevents double-solving
- P5 (grade strings): all grade columns TEXT
- P7 (bilingual): all cards, explanations, UI text bilingual
- P10 (bundle budget): drag-and-drop is vanilla JS, no library. SVG share card.
