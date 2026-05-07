# Runbook — PDF library choice for invoice-generator Edge Function

**Date:** 2026-05-07
**Phase:** 3-A (GST invoice PDF generation)
**Decision:** Use **`pdf-lib`** via esm.sh in the `invoice-generator` Supabase Edge Function (Deno runtime).

## Why pdf-lib

| Library | Deno (esm.sh) | Bundle / cold-start | API ergonomics | Verdict |
|---|---|---|---|---|
| **`pdf-lib`** | ✅ TypeScript-native, no Node-only deps; imports cleanly via `https://esm.sh/pdf-lib@1.17.1` | Small (~200 KB), pure JS, fast cold-start | Programmatic — draw text/lines, embed standard fonts | **Chosen.** Programmatic is fine for a fixed GST invoice template; pure JS keeps Edge Function startup snappy. |
| `pdfmake` | ⚠️ Uses Node-only deps internally (`vfs_fonts` via `fs`); needs custom font shim to work in Deno | Medium — fonts bundled | Declarative document definition | Workable but the Node-deps shim is fragile across Deno upgrades. Rejected. |
| `@react-pdf/renderer` | ❌ Heavy React runtime + Node-only fs/stream usage | Large | JSX-driven, very ergonomic | Rejected — too heavy for an Edge Function and Deno-incompatible. |

## Fallback path if pdf-lib breaks

If a future Deno version breaks `https://esm.sh/pdf-lib@1.17.1` or pdf-lib becomes unmaintained:

1. Move PDF generation to a Next.js Node-runtime API route (`/api/internal/invoice-generator`) and have the Edge Function call it via `fetch`. Keeps Next.js client bundle clean (P10) by using `runtime = 'nodejs'` on the route.
2. With Node available, switch to `@react-pdf/renderer` for cleaner JSX-driven invoice templates.

Documented; not implemented. Only flip if pdf-lib breaks.

## Edge Function environment variables

The PDF needs Alfanumrik's own GSTIN, legal name, address, and state code on every invoice. These are set as Supabase Edge Function secrets (via `supabase secrets set` in the staging/prod project), not in `.env`:

| Variable | Example | Purpose |
|---|---|---|
| `ALFANUMRIK_LEGAL_NAME` | `Cusiosense Learning India Private Limited` | Header line on PDF |
| `ALFANUMRIK_GSTIN` | `27AAAAA0000A1Z5` (15-char India GSTIN) | Required for tax invoice |
| `ALFANUMRIK_BILLING_ADDRESS` | multi-line address | Header block |
| `ALFANUMRIK_STATE_CODE` | `MH` (2-letter state code) | Drives intra-state vs inter-state |
| `ALFANUMRIK_HSN_CODE` | `999293` (educational services SAC) | CGST Rule 46 requirement |
| `ALFANUMRIK_GST_RATE` | `18.00` | Percent — confirm with company CA |

**Action item before flag rollout:** confirm `ALFANUMRIK_HSN_CODE` and `ALFANUMRIK_GST_RATE` with the company's CA. Defaults (999293 / 18%) are reasonable but not authoritative.

## Deploy

```bash
supabase functions deploy invoice-generator --project-ref <staging_or_prod_ref>
supabase secrets set --project-ref <ref> \
  ALFANUMRIK_LEGAL_NAME="Cusiosense Learning India Private Limited" \
  ALFANUMRIK_GSTIN="..." \
  ALFANUMRIK_BILLING_ADDRESS="..." \
  ALFANUMRIK_STATE_CODE="MH" \
  ALFANUMRIK_HSN_CODE="999293" \
  ALFANUMRIK_GST_RATE="18.00"
```

The CI workflow `deploy-staging.yml` deploys all changed Edge Functions on push to `develop`; manual `supabase secrets set` is a one-time operator action.

## Smoke test after deploy

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/invoice-generator" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"school_invoice_id": "<existing_invoice_uuid>"}'
```

Expected when flag OFF: `403 { error: "flag_off", flag: "ff_gst_invoicing_v1" }`.
Expected when flag ON for that school: `200 { ok: true, invoice_number: "ALF/2526/MH/00001", pdf_url: "..." }`.

Then download from storage (signed URL via `/api/school-admin/invoices/[id]/pdf`) and inspect the PDF visually. The first PDF rendered against a real Indian school is the qualitative smoke test — confirm GSTIN, place-of-supply, and tax split are correct before flipping the flag for any other school.
