# STEM Lab — Mobile Phase 2 Plan

Phase 1 (shipped, Tier 3 R12) wraps `/stem-centre` in an authenticated
WebView so mobile reaches parity with web FAST. The Starter+ value
proposition ("119 simulations, lab streak, coin rewards") is now
consistent across web and mobile from day one.

Phase 2 unlocks offline + native frame-rate for the highest-leverage
slice of the catalog. Trigger: WebView usage telemetry shows the top-10
sims account for ≥60% of mobile sim sessions for two consecutive weeks.

## Phase 2 scope

### 1. Native Flutter ports of the top-10 sims
Pick from current `BUILT_IN_SIMULATIONS` (web `src/components/simulations/`)
based on actual mobile usage. Likely starters:

- Ohm's Law (Class 10 Physics)
- Photosynthesis rate (Class 10 Biology)
- Acid-Base titration (Class 10 Chemistry)
- Pendulum (Class 9 Physics)
- Lens / mirror ray diagrams (Class 10 Physics)
- Wave interference (Class 11 Physics)
- Pressure vs volume (Boyle's Law) (Class 11 Physics)
- DNA replication (Class 12 Biology)
- Newton's cradle (Class 9 Physics)
- Projectile motion (Class 9 Physics)

Each port lives in `lib/ui/screens/stem/sims/` and is registered in a
`SimRegistry` map keyed by the same slug the web uses (so analytics keys
and lab-streak attribution stay identical).

### 2. Native lab streak / badges card
Read `student_lab_streaks` and `student_lab_badges` directly via the
Supabase Dart SDK (no WebView round-trip). Render on the dashboard as a
small card next to the existing XP/Coins/Streak row. Same source-of-truth
RPCs the web uses; XP and coin rewards still flow through the existing
atomic RPCs so P2 (XP economy) cannot drift between platforms.

### 3. Decommission criterion (Phase 3 trigger)
WebView fallback stays as a long-tail catch — the 109 less-used sims
keep working via WebView indefinitely. Phase 3 (full native catalog)
only triggers if WebView load latency becomes a top-3 mobile complaint.

## Why phased
- Phase 1 = parity in days, not weeks. Plan-value consistency wins now.
- Phase 2 = quality-of-life for the long-tail of *active* mobile sim
  users, justified by data.
- Phase 3 = only if needed.

Owner: mobile · Reviewers: assessment (XP/coin sync), quality (UX)
