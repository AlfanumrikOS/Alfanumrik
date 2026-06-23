# Optimization Guide

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Guide
**Priority:** High
**Applies To:** Every engineer or AI agent who proposes, applies, or reviews a change made in the name of performance — across the frontend bundle and render path, the network layer, backend latency, and database queries.

---

# Purpose

Core doc 18 (Performance Engineering) defines the *principles* of performance work: measure before you optimize, govern with budgets, profile with evidence, prevent regression. This guide gives the *operational technique* for living those principles inside the real Alfanumrik stack — Next.js on Vercel (bom1), SWR for server state, Supabase Postgres behind RLS.

It answers four practical questions an engineer faces the moment they suspect something is slow:

1. How do I run the measure -> profile -> change -> verify loop without fooling myself?
2. Where, across this specific stack, is optimization actually worth doing?
3. How do I avoid optimizing something that was never the bottleneck?
4. How do I prove an optimization worked, with evidence a reviewer will accept?

This guide does not restate the budgets — those live in core 18 and the bundle-size script. It teaches the discipline of getting from "this feels slow" to "this is provably faster, and here is the number."

---

# The Optimization Loop

Every optimization is a closed loop. Skipping a step turns engineering into speculation.

```text
MEASURE   establish the baseline number for the metric that matters
   v
PROFILE   locate where the time actually goes (not where you guess)
   v
CHANGE    apply exactly one change aimed at the dominant cost
   v
VERIFY    re-measure under the same conditions; compare to baseline
   v
KEEP or REVERT   keep only if the number moved past noise
```

Two rules govern the loop, both inherited from core 18:

- **One change at a time.** Bundle two optimizations and you can no longer attribute the result. If the number moves, you will not know which change moved it — and you may be shipping a regression hidden behind a win.
- **A claim without a measurement is an opinion.** "This is faster" is not a deliverable. "P75 first-contentful-paint dropped from 2.4 s to 1.7 s on the throttled run, build attached" is.

The loop is identical whether you are shaving a bundle chunk or rewriting a query. Only the measurement instrument changes.

---

# Step 1: Measure the Baseline

The baseline is the single most important artifact in any optimization. Without it, "improvement" is unfalsifiable.

A usable baseline is:

- **Specific to one metric** — bundle kB, P75 latency, query milliseconds, render count. Not "speed."
- **Reproducible** — the same command on the same input yields the same number within a known variance.
- **Captured under realistic conditions** — production-like data volume, a throttled network for frontend work, a warm connection for backend work. A profile against ten rows lies about a table that holds ten million.

Record the baseline before touching code. Paste the raw command output into the PR. The baseline is evidence, not a memory.

If you cannot measure the thing you want to optimize, stop. Build the measurement first. An unmeasurable optimization cannot be proven and must not be claimed.

---

# Step 2: Profile to Find the Bottleneck

Profiling is the disciplined act of finding where time is actually spent. Intuition is consistently wrong about this — the slowest part of a system is rarely the part that feels slow.

Profile against a realistic workload, then:

1. Reproduce the slow scenario reliably.
2. Capture the profile under production-like conditions.
3. Identify the **dominant** cost — the one item that accounts for most of the time — not every cost.
4. Confirm the dominant cost with a second measurement.
5. Fix the dominant cost before touching anything smaller.

A ten percent improvement to the largest cost beats a ninety percent improvement to a trivial one. Optimizing a path that was never a bottleneck adds complexity and buys nothing.

---

# Where to Optimize in This Stack

The four arenas below are where Alfanumrik performance is won or lost. Each has its own measurement instrument and its own dominant failure modes. `performance-tuning.md` gives the concrete technique for each; this section is the map of where to look.

## Frontend: Bundle Size

The shared first-load JavaScript and per-route chunks are what an Indian-4G user downloads before the app is usable. This is governed by P10 and enforced mechanically by `scripts/check-bundle-size.mjs`, which measures gzipped chunks honestly from the rendered HTML.

Measure with `npm run build` followed by the bundle-size check; investigate composition with `npm run analyze`. The dominant costs are usually a heavy library pulled into a shared chunk, or a component that should have been dynamically imported but was statically imported into the root layout.

## Frontend: Render Path

Redundant rendering recomputes or repaints UI state that did not change. The common causes are unstable references passed to memoized children, state placed too high in the component tree, and derived values recomputed every render.

Measure with the React profiler under a realistic interaction, counting renders and their cost. Stabilize references, lower state to where it is used, and memoize genuinely expensive derivations — but only after the profiler shows the render is the cost. Never wrap everything in `useMemo` on faith; needless memoization adds its own overhead.

## Network: Requests

Redundant requests fetch the same data more than once in a short window. Over-fetching pulls more than the consumer needs. Both inflate the network waterfall the user waits on.

SWR is the platform's server-state layer; its deduplication and caching are the primary tools here. Measure with the network tab on a real flow — count requests, watch for the same endpoint firing twice, and look for payloads far larger than the rendered UI. The fix is request deduplication, an explicit cache lifetime, and selecting only the fields the screen renders.

## Backend: API Latency

Backend budgets are about the **tail**, not the average. A healthy median with a degrading P95 is a failing system, because users experience the tail. Endpoint latency on a hot path declares a target at both the median and the tail percentile, and the tail is the contract.

Measure endpoint timing under concurrency, then decompose it: how much is query time, how much is serialization, how much is an external call (Supabase, an AI provider, Razorpay). Attack the dominant slice. Move heavy synchronous work off the request path; a long-running job belongs in a background worker, not in the response a user is waiting for.

## Database: Queries

Database time is frequently the dominant cost in a request and the least elastic resource. Every hot-path query declares an expected execution time and is backed by an index; none performs an unbounded scan over a growing table.

Measure with the query plan: examine scan types, index usage, and estimated rows versus actual rows. The two dominant failure modes are the N+1 pattern (one query for a list, then one per item) and over-fetching (`SELECT *`, full nested objects when an id would do, loading a collection to display a count). Both look fine on ten rows and fail catastrophically at scale.

---

# Avoiding Premature Optimization

Premature optimization is the act of spending effort, and adding complexity, against a cost that was never proven to matter. It is the most common way performance work goes wrong.

The guardrails:

- **No baseline, no optimization.** If you have not measured the current state, you are not optimizing — you are guessing.
- **No profile, no target.** Optimize the bottleneck the profiler identified, not the line of code that looks expensive.
- **Within budget means leave it alone.** A surface that passes its declared budget does not need to be faster. Effort spent there is effort stolen from a surface that is failing.
- **Complexity is a cost.** An optimization that makes code harder to read, test, or evolve must pay for that cost in a measured, durable win. If the win is inside the noise, the complexity is a net loss — revert it.

Correctness and simplicity outrank speed in the architecture priority order. A faster system that is wrong, or one no future engineer can safely change, is not an improvement.

---

# Proving an Optimization With Evidence

An optimization is complete only when it is proven. Proof has a fixed shape:

1. **The metric** — exactly what was measured (gzipped shared kB, P75 endpoint latency, query milliseconds, render count).
2. **The conditions** — production-like data, throttled network for frontend, concurrency level for backend. The before and after measurements must use the *same* conditions; otherwise the comparison is meaningless.
3. **The baseline number** — captured before the change, with the raw command output.
4. **The post-change number** — captured after the change, under identical conditions.
5. **The delta, against noise** — the improvement must clearly exceed measurement variance. A move from 274.1 kB to 273.9 kB is noise, not a win. Run the measurement enough times to know the variance before claiming the delta.

Attach the evidence to the PR. A reviewer should be able to read the before number, the after number, and the conditions, and agree the change earned its place. An optimization that cannot be shown this way has not been proven, and under AEOS discipline an unproven performance claim is not made.

Finally, protect the win. Once a number is achieved, CI must keep it there — the bundle-size gate fails the build on a budget breach so a future change cannot silently erode what you proved.

---

# Optimization Readiness Checklist

Before an optimization is considered complete, verify:

- [ ] A baseline was measured and recorded before any code changed.
- [ ] The bottleneck was located by profiling, not by assumption.
- [ ] Exactly one change was applied, aimed at the dominant cost.
- [ ] The post-change measurement used the same conditions as the baseline.
- [ ] The delta clearly exceeds measurement noise.
- [ ] The change stays within every declared budget (P10 and any latency/query target).
- [ ] N+1 patterns and over-fetching were checked for and eliminated on touched paths.
- [ ] Redundant renders and redundant requests were checked for on touched paths.
- [ ] Any new cache declares an explicit invalidation strategy and leaks no private data across users.
- [ ] The added complexity (if any) is justified by a measured, durable win.
- [ ] Evidence (before number, after number, conditions, raw output) is attached to the PR.
- [ ] CI enforces the relevant budget so the win cannot silently regress.

If any answer is No, address it before claiming the optimization done.

---

# References

This guide operates within the AEOS hierarchy and must be read together with:

- 05_ARCHITECTURE_STANDARDS — the priority order (correctness, security, simplicity before performance) and the layered boundaries within which optimizations must stay; "measure before optimizing."
- 13_FRONTEND_ENGINEERING — rendering, bundle, hydration, image and request practices that frontend optimizations operate on.
- 14_BACKEND_ENGINEERING — service latency, throughput, query, and connection-pool discipline; heavy work belongs off the request path.
- 18_PERFORMANCE_ENGINEERING — the governing standard: the measure-before-optimize sequence, budgets, profiling methodology, anti-patterns, caching discipline, and regression prevention.
- Companion guide: `guides/performance-tuning.md` — the concrete, stack-specific tuning technique that this loop is applied with.

Where this guide and a higher-authority document conflict, the higher-authority document prevails. The authority order is the project-root constitution, then AEOS/MASTER_SYSTEM_PROMPT.md, then AEOS/EXECUTION_ENGINE.md, then the numbered AEOS documents (00-29), then extensions, then the task.

---

# Final Directive

Optimization is a loop, not a hunch. Measure first, profile to find the real bottleneck, change one thing, re-measure under the same conditions, and keep the change only if the number moved past the noise.

Never optimize a path you have not proven is slow. Never claim a win you cannot show with a before number and an after number. Never trade readability for a speedup that lives inside measurement error.

A system is fast because someone measured it, proved it, and built the gate that keeps it that way — not because someone believed it would be.

**End of Document**
