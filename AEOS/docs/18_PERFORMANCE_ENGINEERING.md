# 18_PERFORMANCE_ENGINEERING.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Performance Engineering Standard
**Priority:** Critical
**Applies To:** Every feature, API, query, rendering path, background job, and AI-generated implementation that affects latency, throughput, resource consumption, or perceived responsiveness.

---

# Purpose

This document establishes the mandatory performance engineering discipline for the platform.

Its objective is to ensure that every system is:

- measured before it is optimized,
- governed by explicit budgets,
- profiled with evidence,
- free from known performance anti-patterns,
- protected against regression,
- responsive under real-world load.

Performance is a feature. It is not an afterthought, and it is not a luxury.

These standards apply regardless of language, framework, repository, or runtime.

---

# Performance Philosophy

Performance work is governed by one principle above all others:

Measure before you optimize.

Optimization without measurement is speculation. Speculation wastes effort, increases complexity, and frequently makes systems slower.

Every optimization shall begin with a measurement that establishes the current state, and end with a measurement that proves the change improved it.

A performance claim without a measurement is not a claim. It is an opinion.

---

# Measure Before Optimize

The mandatory sequence for all performance work:

```text
Define the metric
        v
Establish a baseline
        v
Identify the bottleneck
        v
Form a hypothesis
        v
Apply one change
        v
Re-measure
        v
Compare against baseline
        v
Keep or revert
```

Never apply multiple optimizations simultaneously. When several changes are bundled, the effect of each becomes impossible to attribute.

Never optimize a path that has not been proven to be a bottleneck. The slowest part of the system is rarely the part that intuition suspects.

---

# Performance Budgets

A budget is a numeric limit that the system must not exceed. Budgets convert performance from a subjective debate into an objective gate.

Every significant surface must declare a budget. A change that breaches a budget is a defect, regardless of whether functionality is correct.

## Frontend Budgets

Frontend budgets protect the experience of users on constrained networks and modest devices.

- Initial shared bundle size shall remain within the declared project ceiling.
- Per-route bundle size shall remain within the declared per-page ceiling.
- Time to interactive shall remain within the declared target on a mid-tier device.
- Largest contentful paint shall remain within the declared target on a representative network.
- Cumulative layout shift shall remain below the declared threshold.

The reference operating context is a constrained mobile network. Performance must be acceptable under that context, not only on a developer workstation.

## Backend Budgets

Backend budgets protect throughput and predictability.

- API endpoint latency shall declare a target at the median and at the tail.
- The tail percentile is the contract, not the average.
- Throughput shall declare a sustained requests-per-second target.
- Background jobs shall declare a maximum runtime and a maximum queue age.
- Memory consumption per request shall remain within the declared envelope.

A median that looks healthy while the tail degrades is a failing system. Users experience the tail.

## Database Budgets

Database budgets protect the most expensive and least elastic resource.

- Every query on a hot path shall declare an expected execution time.
- Every query on a hot path shall be backed by an appropriate index.
- No query on a request path shall perform an unbounded scan over a growing table.
- Result set sizes shall be bounded by pagination or explicit limits.
- Connection usage shall remain within the pool envelope.

Database time is frequently the dominant cost in a request. It receives proportionate scrutiny.

---

# Profiling Methodology

Profiling is the disciplined act of locating where time and resources are actually spent.

Profiling shall be performed against a realistic workload. A profile taken against trivial data is misleading because real bottlenecks emerge at real scale.

The profiling workflow:

1. Reproduce the slow scenario reliably.
2. Capture a profile under conditions that resemble production.
3. Identify the dominant cost, not every cost.
4. Confirm the dominant cost with a second measurement.
5. Address the dominant cost before any secondary cost.

Frontend profiling shall examine bundle composition, render timing, and network waterfalls.

Backend profiling shall examine endpoint timing, query timing, serialization cost, and external-call latency.

Database profiling shall examine query plans, index usage, scan types, and row estimates versus actual rows.

Optimize the dominant cost first. A ten percent improvement to the largest cost outperforms a ninety percent improvement to a trivial one.

---

# Common Anti-Patterns

The following patterns are the most frequent and most damaging causes of poor performance. Each must be actively looked for and eliminated.

## N+1 Access Patterns

An N+1 pattern issues one query to fetch a list, then one additional query per item in that list.

This collapses gracefully in development with small data and fails catastrophically in production with large data.

Resolution:

- fetch related data in a single batched query,
- use joins or set-based loading,
- never issue a query inside a loop over a result set.

## Over-Fetching

Over-fetching retrieves more data than the consumer needs.

Examples include selecting all columns when few are used, returning full nested objects when identifiers suffice, and loading entire collections to display a count.

Resolution:

- select only required fields,
- paginate large collections,
- compute aggregates in the database rather than in application code.

## Redundant Rendering

Redundant rendering recomputes or repaints user-interface state that has not changed.

Examples include unstable references passed to memoized children, state placed too high in the tree, and derived values recomputed on every render.

Resolution:

- stabilize references for values that do not change,
- locate state at the lowest level that needs it,
- memoize expensive derivations.

## Redundant Requests

Redundant requests fetch the same data multiple times within a short window.

Resolution:

- deduplicate concurrent identical requests,
- cache responses with an explicit lifetime,
- avoid refetching data that has not become stale.

## Synchronous Heavy Work

Heavy computation on a critical path blocks everything behind it.

Resolution:

- move heavy work off the request path,
- precompute where possible,
- stream or paginate large results.

---

# Caching

Caching is the most powerful and most dangerous performance tool. A cache trades correctness risk for speed. That trade must be deliberate.

## The Caching Rule

Never introduce a cache without first defining how it is invalidated.

A cache without an invalidation strategy is a future correctness defect with a delayed fuse. Stale data is frequently worse than slow data.

## Caching Discipline

For every cache, the implementation shall declare:

- what is cached,
- the key that identifies an entry,
- the lifetime of an entry,
- the events that invalidate an entry,
- the behavior on a cache miss,
- the behavior on cache failure.

## Invalidation Strategies

Acceptable invalidation strategies include:

- time-based expiry with a defined lifetime,
- event-based invalidation when underlying data changes,
- versioned keys that change when inputs change.

The strategy must match the data. Frequently changing data tolerates only short lifetimes or event-based invalidation. Rarely changing data may use longer expiry.

## Caching Hazards

Caching shall never:

- serve one user private data to another user,
- mask a slow underlying system that should be fixed,
- become a hidden source of truth,
- persist indefinitely without a refresh path.

A cache is a performance optimization layered over a correct system. It is never a substitute for one.

---

# Load and Stress Testing

Load and stress testing establish how a system behaves as demand rises.

Load testing measures behavior at expected peak demand. The system must remain within budget at expected peak.

Stress testing measures behavior beyond expected peak. The objective is to discover the breaking point and confirm that failure is graceful rather than catastrophic.

Both shall verify:

- latency under sustained concurrency,
- throughput at and beyond target,
- resource saturation points,
- recovery behavior after load subsides,
- absence of data corruption under contention.

A system that has never been load tested has unknown limits. Unknown limits are discovered by users at the worst possible time.

Performance claims about scale require measurement under load. An untested scaling assumption is not evidence.

---

# Performance Regression Prevention

Performance, once achieved, decays silently. Each change risks eroding it. Prevention is mechanical, not manual.

The continuous integration pipeline shall enforce:

- bundle-size checks against declared frontend budgets,
- failure of the build when a budget is breached,
- comparison of key metrics against an established baseline,
- a recorded baseline that future changes are measured against.

A budget breach shall block the change. The author must either bring the change within budget or obtain an explicit, recorded budget revision.

Performance budgets are treated identically to correctness tests. A breached budget is a failed gate, not a warning to be ignored.

---

# Observability for Performance

A system that cannot be observed cannot be tuned.

Production systems shall expose:

- latency distributions, including tail percentiles,
- throughput metrics,
- error rates correlated with load,
- slow-query visibility,
- resource utilization trends.

Performance regressions in production must be detectable from metrics before they are reported by users.

---

# Performance Readiness Checklist

Before a performance-sensitive change is considered complete, verify:

- Was a baseline measured before any change was made?
- Was the bottleneck identified by profiling rather than assumption?
- Was only one optimization applied at a time?
- Was the improvement confirmed by a post-change measurement?
- Does the change remain within all declared budgets?
- Were N+1 access patterns checked for and eliminated?
- Is the system fetching only the data it needs?
- Were redundant renders and redundant requests checked for?
- Does every new cache declare an explicit invalidation strategy?
- Does no cache risk leaking private data across users?
- Were load and stress characteristics considered for high-traffic paths?
- Does CI enforce the relevant performance budgets?
- Are tail latencies, not just averages, within target?
- Can the change be observed in production metrics?

If any answer is No, address it before completion.

---

# References

This document operates within the AEOS hierarchy and must be read together with:

- 05_ARCHITECTURE_STANDARDS - system boundaries and component responsibilities within which performance budgets are allocated.
- 06_API_ENGINEERING - endpoint contracts, pagination, and latency expectations.
- 07_DATABASE_ENGINEERING - indexing, query design, and data-access discipline.
- 08_TESTING_PROTOCOL - the verification and evidence discipline that performance measurement extends.
- 13_FRONTEND_ENGINEERING - rendering, bundle, and client-side performance practices.
- 14_BACKEND_ENGINEERING - service latency, throughput, and resource discipline.

Where this document and a higher-authority document appear to conflict, the higher-authority document prevails. The authority order is the project-root constitution, then AEOS/MASTER_SYSTEM_PROMPT.md, then AEOS/EXECUTION_ENGINE.md, then the numbered AEOS documents (00-29), then extensions, then the task.

---

# Final Directive

Performance is earned through measurement and protected through discipline.

Never optimize what you have not measured.

Never claim a system is fast without evidence that it is fast under realistic conditions.

Never introduce a cache you cannot invalidate.

A system is fast not because someone believed it would be, but because someone measured it, proved it, and built the gates that keep it that way.

**End of Document**
