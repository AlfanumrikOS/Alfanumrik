# Cycle 6 — Super-Admin & Observability — 03 ROOT CAUSE

For each significant gap: the true root cause and the layer that introduced it.

## SAO-1 — Bulk PII export at `support` tier
- **Root cause**: the admin-level ladder (`support<…<super_admin`, `admin-auth.ts:28-45`) was retrofitted in Phase G.1 (2026-05-17) onto routes that pre-existed it. Phase G.1 correctly tightened the DESTRUCTIVE/mutation routes to `super_admin` (RBAC, impersonation, plan-change, flag writes) but treated all READ/export routes as a uniform `support` floor — equating "read" with "low sensitivity". A bulk PII export is a read, so it inherited the floor even though its sensitivity is high.
- **Introducing layer**: ops/architect RBAC tiering decision at Phase G.1. The route itself (`reports/route.ts`) is mechanically correct (gated + audited); the defect is the POLICY mapping of export-type → required level, which was never differentiated by PII content.
- **Why not caught**: no invariant says "PII export must be above tier N". P13 permits admin access to student data generally, so neither the hooks nor REG-119 (which pins the EXISTING tier, including `support`, against silent change) flag a too-low-but-intentional tier.

## SAO-2 — Analytics response carries email
- **Root cause**: the analytics endpoint was built as an admin "kitchen-sink" dashboard feed (`analytics/route.ts` returns engagement+revenue+retention+top_students in one shot). `top_students` reused the same `students` projection as other admin views (`id,name,email,…`) rather than a minimized leaderboard projection. Email was copied in by convenience, not by requirement.
- **Introducing layer**: ops (metric/field definition) — "what to return" is ops-owned; the field set was never minimized against the actual render need.
- **Why not caught**: P13's admin-access carve-out makes any admin-visible PII technically legal, so the data-minimization principle (return only what the surface needs) has no mechanical enforcer.

## SAO-3 — Observability export skips egress redaction
- **Root cause**: the redaction architecture is "redact at WRITE time" — `logOpsEvent` is expected to produce PII-free `context`, so the read/export path assumed clean data and serialized it directly (`observability/export/route.ts:91`). This is a single-layer-of-defense assumption; the in-flight redactor (`redactPII`) was designed for the log/Sentry/analytics egress points and simply wasn't wired to this CSV egress.
- **Introducing layer**: ops, when adding the export route — the redactor existed (`ops-events-redactor.ts`) but the export was treated as "internal data, already clean".
- **Why not caught**: no test asserts that admin export bodies are PII-free; REG-49 covers Sentry egress, not CSV egress.

## SAO-4 — Logger omits bare `name`/`ip`
- **Root cause**: a deliberate precision-vs-recall tradeoff in the key-based redactor (`redact-pii.ts:43-46`). Bare `name`/`ip` collide with too many legitimate keys (`event_name`, `subject_name`, metric fields), so they were excluded to avoid over-redacting useful telemetry. The cost is that a caller using the unlucky key `name` for a student's actual name bypasses redaction.
- **Introducing layer**: ops (redactor design, D7 follow-up 2026-05-05). The decision is documented and reasonable; the residual risk is unmanaged caller discipline, not a redactor bug.
- **Why not caught**: key-based redaction cannot know semantics; there is no lint canary on logging call shapes.

## SAO-5 — Audit export leaks admin email/name
- **Root cause**: `logAdminAudit` enriches `details` with `admin_name`/`admin_email` (`admin-auth.ts:258`) for read-time convenience (so the logs UI need not join `admin_users`). That convenience copy then rides along when `details` is bulk-exported as CSV. Same Phase-G.1 tier-policy root as SAO-1.
- **Introducing layer**: ops/architect — the audit-enrichment design (Phase G.4) plus the SAO-1 tiering policy intersect here.

## SAO-7 — Incomplete route sweep
- **Root cause**: the surface grew ~5x (24→119 super-admin routes) faster than the audit cadence, and there is no AST-level invariant that the FIRST executable statement of every admin handler is an authorization call — enforcement is by convention + spot-checked regression pins (REG-116/119), not by mechanical coverage of all 119 files.
- **Introducing layer**: process/tooling — the guard hooks enforce file-ownership, not gate-ordering; no static check closes the "gate present but mis-ordered / sibling handler ungated" class.

## Cross-cutting observation
The dominant root cause across SAO-1/2/5 is a single policy gap: **the admin-level ladder differentiates by ACTION DESTRUCTIVENESS but not by DATA SENSITIVITY of reads.** Phase G.1 hardened mutations to `super_admin` while leaving all reads/exports at `support`, so PII-heavy read endpoints sit at the floor tier. Closing this is a tiering-policy decision (architect + ops) gated on user approval, plus a complementary data-minimization pass on response/export field sets (ops-owned, mostly auto-fix-safe). The pure-mechanism layers — gate ordering, constant-time compare, log/analytics/Sentry redaction, flag default-OFF — are sound and well-pinned.
