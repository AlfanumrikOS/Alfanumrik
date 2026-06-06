# Alfanumrik `/v2` API Contract Standard

This document is the contract standard for every route under `src/app/api/v2/**`.
`/v2` is the **single-contract surface**: one Zod source of truth generates the
OpenAPI document, the TypeScript types, and the Flutter (Dart) client, so web and
mobile always consume the exact same shapes.

> Wave 2.1 (Phase 2 foundation) stood up this standard + the codegen pipeline,
> proven on the two seeded routes (`/v2/today`, `/v2/parent/encourage`). New `/v2`
> routes MUST follow the five rules below.

---

## The single source of truth

```
src/lib/api/v2/contract.ts   ← Zod schemas + OpenAPIRegistry (edit this)
        │
        ├─ npm run gen:openapi → openapi/v2.json   (OpenAPI 3.1, committed, CI-drift-checked)
        │                              │
        │                              └─ npm run gen:dart → mobile/lib/api/v2/  (Dart-dio client)
        │
        └─ z.infer<…> types       → import directly in route handlers (TS)
```

- Edit shapes ONLY in `src/lib/api/v2/contract.ts`.
- Run `npm run gen:openapi` and commit `openapi/v2.json`.
- CI (`.github/workflows/openapi-contract.yml`) regenerates and fails if the
  committed artifact drifts from the Zod source — the contract cannot silently
  diverge.
- The Dart client is regenerated in mobile CI (Wave 2.6) via `npm run gen:dart`
  (needs Java; see below).

---

## The five rules

### 1. Response envelope

Every route returns one of:

```jsonc
// success
{ "success": true, "data": <T> }          // (or { "success": true } for a bare ack)

// error
{ "success": false, "error": "<message>", "code": "<MACHINE_CODE>" }  // code optional
```

Use the helpers in `src/lib/api-response.ts` for the bodies. The discriminated
`success` boolean is what mobile + web branch on. Register the success and error
envelopes for each route in the registry (`SuccessAck` / `ErrorResponse` are the
shared building blocks; route-specific data shapes get their own schema).

> Note: `src/lib/api-response.ts` historically emits a bare `{ data }` / `{ error }`
> envelope. The `/v2` standard adds the top-level `success` boolean. The seeded
> `encourage` route already returns `{ success: true }` / `{ success: false, error }`.
> When the route handlers are migrated to validate against the contract
> (a later wave), align the envelope helper or wrap its output accordingly.

### 2. Input validation with Zod via `validateBody()`

Every route that accepts a body validates it against a Zod schema using
`validateBody(schema, body)` from `src/lib/validation.ts`. The schema lives in
(or is imported into) `src/lib/api/v2/contract.ts` so it is part of the generated
contract. A validation failure returns the standard `400` error envelope
(`code: "VALIDATION_ERROR"`).

```ts
import { EncourageRequest } from '@/lib/api/v2/contract';
import { validateBody } from '@/lib/validation';

const parsed = validateBody(EncourageRequest, body);
if (!parsed.success) return parsed.error; // 400 with structured details
const { student_id, message_key } = parsed.data;
```

### 3. Auth: both Bearer JWT (mobile) and cookie (web) + RBAC

Every route calls `authorizeRequest(request, '<permission.code>')` from
`src/lib/rbac.ts`. `authorizeRequest` accepts **both** a Supabase access-token
`Authorization: Bearer <jwt>` header (mobile clients) **and** the Supabase session
cookie (web clients) — the same call covers both transports. RBAC permission
codes are enforced server-side (P9); `usePermissions()` on the client is UI
convenience only, never a security boundary.

The OpenAPI doc declares two security schemes (`bearerAuth`, `cookieAuth`) on each
operation so the generated Dart client attaches the bearer token.

### 4. Payloads carry `schemaVersion`

Response payloads include a `schemaVersion` literal (e.g. `schemaVersion: 1`) so
clients can branch when a shape grows. Bump it in the Zod schema when a shape
changes incompatibly; the regenerated `openapi/v2.json` + Dart client follow.

### 5. All request/response schemas live in the registry

Every `/v2` request and response Zod schema is `.openapi('Name')`-tagged and
registered in `src/lib/api/v2/contract.ts` (`registry.register*`), so it emits to
the OpenAPI doc → TS types → Dart models. A `/v2` shape that is NOT in the
registry is not part of the contract and will not reach mobile.

---

## Codegen commands

| Command | What it does | Where it runs |
|---|---|---|
| `npm run gen:openapi` | Build `openapi/v2.json` from the Zod registry (stable key order). | Local + dev; commit the result. |
| `npm run gen:openapi:check` | Fail if `openapi/v2.json` is stale vs the Zod source (no write). | CI drift-check. |
| `npm run gen:dart` | Generate the Dart-dio client into `mobile/lib/api/v2/`. | Local (needs Java 11+) + mobile CI (Wave 2.6). |

`gen:dart` uses `@openapitools/openapi-generator-cli`, which downloads and runs a
Java jar (generator `dart-dio`, pinned in `openapitools.json`). It requires a JDK
on the machine; if Java is unavailable the OpenAPI half (`gen:openapi`) still works
and the Dart client is regenerated in mobile CI.

---

## Adding a new `/v2` route — checklist

- [ ] Define the request/response Zod schemas in `src/lib/api/v2/contract.ts`, each `.openapi('Name')`-tagged.
- [ ] `registry.registerPath({ ... })` for the operation (method, path, security, responses).
- [ ] Response payload carries `schemaVersion`.
- [ ] Route handler: `authorizeRequest(request, '<perm>')` → `validateBody(<Schema>, body)` → standard envelope.
- [ ] `npm run gen:openapi` and commit `openapi/v2.json`.
- [ ] Mobile CI regenerates the Dart client (`npm run gen:dart`) from the updated spec.
