# Dependency Map

## Parallel Stage 1

| Workstream | Can Run With | Blocks |
|---|---|---|
| Architecture | B, C, D, E, F, G | H, final prioritisation |
| Backend/Data Security | A, C, D, E, F, G | Security-sensitive implementation tasks |
| Frontend/Design System | A, B, D, E, F, G | UI implementation tasks |
| Adaptive Intelligence | A, B, C, E, F, G | Adaptive learning implementation tasks |
| Foxy AI/Safety | A, B, C, D, F, G | AI tutor implementation tasks |
| QA/Certification | A, B, C, D, E, G | Release evidence and regression task selection |
| DevOps/Platform | A, B, C, D, E, F | Release-gate and environment task selection |
| Independent Review | None initially | Requires A-G reports |

## Likely Sequencing Constraints

- Backend service-role/RLS migrations must precede broad certification claims.
- Canonical membership cutover affects backend, teacher/school-admin UI, tenant tests, and QA smoke tests.
- API contract/OpenAPI changes affect backend, mobile/client parity, QA, and DevOps gates.
- Foxy streaming/output safety changes affect AI safety, frontend rendering, QA, and platform observability.
- UI navigation/product-surface changes depend on feature-flag and API-route truth.

## Likely File-Ownership Conflicts

- `scripts/admin-client-allowlist.json`, `scripts/route-access-manifest.json`, and route tests are shared by backend/security and QA.
- `openapi/v2.json`, `docs/public-api/openapi.json`, and generator scripts are shared by backend, mobile/API contract, and DevOps.
- `apps/host/src/app/api/foxy/**`, `packages/lib/src/ai/**`, and grounded-answer Edge code are shared by Foxy AI and QA.
- `packages/lib/src/rbac.ts`, teacher/school-admin route helpers, and membership migrations are shared by architecture, backend, and QA.
- `packages/ui/src/navigation/**`, role shells, and role-specific pages are shared by frontend and QA.
