/**
 * invoice-generator – Alfanumrik Edge Function
 *
 * Generates a GST-compliant PDF for a single school_invoices row, fills in
 * the GST fields (invoice_number, gst breakdown, place_of_supply etc.), and
 * uploads the PDF to the `school-invoices` storage bucket. Updates the row
 * with the resulting `pdf_url`.
 *
 * Phase 3-A of the May 2026 upgrade. Gated by `ff_gst_invoicing_v1`.
 *
 * Auth: service-role JWT only (server-to-server). Caller is expected to
 *       be `/api/super-admin/...` or `/api/school-admin/invoices/[id]/pdf`,
 *       which already enforce auth + permission.
 *
 * POST body:
 * {
 *   school_invoice_id: string  // uuid of the school_invoices row to render
 *   force?: boolean            // re-render PDF; preserves existing invoice_number
 * }
 *
 * Response:
 *   200 { ok: true, invoice_id, invoice_number, pdf_url, total_inr, ... }
 *   400 invalid input
 *   403 flag off OR invalid auth
 *   404 invoice/school not found
 *   409 invoice already has invoice_number AND force not set
 *   500 internal
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
import { getCorsHeaders } from '../_shared/cors.ts'
import { checkBearerToken } from '../_shared/auth.ts'

// ── Config (env-driven) ───────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const SUPPLIER_LEGAL_NAME       = Deno.env.get('ALFANUMRIK_LEGAL_NAME') ?? 'Cusiosense Learning India Private Limited'
const SUPPLIER_GSTIN            = Deno.env.get('ALFANUMRIK_GSTIN') ?? ''
const SUPPLIER_BILLING_ADDRESS  = Deno.env.get('ALFANUMRIK_BILLING_ADDRESS') ?? ''
const SUPPLIER_STATE_CODE       = Deno.env.get('ALFANUMRIK_STATE_CODE') ?? 'MH'
const DEFAULT_HSN_CODE          = Deno.env.get('ALFANUMRIK_HSN_CODE') ?? '999293'
const DEFAULT_GST_RATE_PCT      = Number(Deno.env.get('ALFANUMRIK_GST_RATE') ?? '18.00')

const FLAG_NAME = 'ff_gst_invoicing_v1'
const BUCKET    = 'school-invoices'

// ── Types ────────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
  school_id: string
  period_start: string
  period_end: string
  seats_used: number
  amount_inr: number
  status: string
  pdf_url: string | null
  invoice_number: string | null
  financial_year: string | null
  state_code: string | null
  place_of_supply: string | null
  school_gstin: string | null
  school_legal_name: string | null
  school_billing_address: string | null
  hsn_code: string | null
  taxable_amount_inr: number | null
  gst_rate: number | null
  cgst_amount: number | null
  sgst_amount: number | null
  igst_amount: number | null
}

interface SchoolRow {
  id: string
  name: string
  state: string | null
  city: string | null
  address: string | null
  gstin: string | null
  legal_name: string | null
  billing_address: string | null
}

interface RequestBody {
  school_invoice_id?: string
  force?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────

function json(data: unknown, status = 200, cors: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/**
 * Indian financial year for a given date. Apr 1 → Mar 31.
 * 2025-04-01 to 2026-03-31 returns "2526". CGST Rule 46 compliance.
 */
function financialYearForDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const startYear = m >= 4 ? y : y - 1
  const endYear   = startYear + 1
  return `${String(startYear).slice(-2)}${String(endYear).slice(-2)}`
}

/**
 * GST split given a taxable amount, rate (percent), and intra/inter-state.
 * Money rounded to 2 decimals. Halves sum to total exactly even with rounding.
 */
function computeGst(taxable: number, ratePct: number, intraState: boolean) {
  const total = Math.round(taxable * ratePct) / 100
  if (intraState) {
    const half = Math.round((total / 2) * 100) / 100
    const cgst = half
    const sgst = Math.round((total - cgst) * 100) / 100
    return { cgst, sgst, igst: 0, total }
  }
  return { cgst: 0, sgst: 0, igst: total, total }
}

/**
 * Indian INR formatting: "₹1,23,456.78" with lakhs/crores grouping.
 * Pure JS — Deno's Intl may not include the full ICU locale data.
 */
function formatINR(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs  = Math.abs(n)
  const fixed = abs.toFixed(2)
  const [intPart, decPart] = fixed.split('.')
  if (intPart.length <= 3) return `${sign}₹${intPart}.${decPart}`
  const last3 = intPart.slice(-3)
  const rest  = intPart.slice(0, -3)
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return `${sign}₹${grouped},${last3}.${decPart}`
}

// ── Flag check (server-to-server: binary on/off only) ────────────────────

async function flagEnabled(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client
    .from('feature_flags')
    .select('is_enabled, rollout_percentage')
    .eq('flag_name', FLAG_NAME)
    .maybeSingle()
  if (error || !data) return false
  return data.is_enabled === true && (data.rollout_percentage ?? 0) > 0
}

// ── PDF rendering ────────────────────────────────────────────────────────

interface PdfInputs {
  invoiceNumber:    string
  invoiceDate:      string
  periodStart:      string
  periodEnd:        string
  seatsUsed:        number
  taxableAmount:    number
  gstRate:          number
  cgst:             number
  sgst:             number
  igst:             number
  total:            number
  hsnCode:          string
  placeOfSupply:    string

  supplierName:     string
  supplierGstin:    string
  supplierAddress:  string
  supplierState:    string

  schoolName:       string
  schoolGstin:      string | null
  schoolAddress:    string | null
  schoolState:      string
}

async function renderInvoicePdf(inp: PdfInputs): Promise<Uint8Array> {
  const doc  = await PDFDocument.create()
  const page = doc.addPage([595.28, 841.89])  // A4 portrait, points
  const helv     = await doc.embedFont(StandardFonts.Helvetica)
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink      = rgb(0.05, 0.05, 0.05)
  const grey     = rgb(0.4, 0.4, 0.4)

  let y = 800
  const left = 40
  const right = 555

  // Header
  page.drawText('TAX INVOICE', { x: left, y, size: 22, font: helvBold, color: ink })
  y -= 28
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: grey })
  y -= 18

  // Supplier (left) and Invoice meta (right) side-by-side
  const supplierLines = [
    inp.supplierName,
    `GSTIN: ${inp.supplierGstin || '—'}`,
    `State: ${inp.supplierState}`,
    ...inp.supplierAddress.split('\n').slice(0, 4),
  ]
  const metaLines = [
    `Invoice No: ${inp.invoiceNumber}`,
    `Date: ${inp.invoiceDate}`,
    `Period: ${inp.periodStart} → ${inp.periodEnd}`,
    `HSN/SAC: ${inp.hsnCode}`,
    `Place of Supply: ${inp.placeOfSupply}`,
  ]
  const blockTop = y
  supplierLines.forEach((line, i) => {
    page.drawText(line, { x: left, y: blockTop - i * 13, size: 10, font: i === 0 ? helvBold : helv, color: ink })
  })
  metaLines.forEach((line, i) => {
    page.drawText(line, { x: 320, y: blockTop - i * 13, size: 10, font: helv, color: ink })
  })
  y = blockTop - Math.max(supplierLines.length, metaLines.length) * 13 - 20

  // Bill-to
  page.drawText('Bill To', { x: left, y, size: 11, font: helvBold, color: ink })
  y -= 14
  const billToLines = [
    inp.schoolName,
    inp.schoolGstin ? `GSTIN: ${inp.schoolGstin}` : 'GSTIN: Unregistered',
    `State: ${inp.schoolState}`,
    ...(inp.schoolAddress ?? '').split('\n').slice(0, 4),
  ]
  billToLines.forEach((line, i) => {
    page.drawText(line, { x: left, y: y - i * 13, size: 10, font: helv, color: ink })
  })
  y -= billToLines.length * 13 + 16

  // Line item table
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: grey })
  y -= 14
  page.drawText('Description',     { x: left,        y, size: 10, font: helvBold, color: ink })
  page.drawText('HSN',             { x: left + 280,  y, size: 10, font: helvBold, color: ink })
  page.drawText('Qty (seats)',     { x: left + 330,  y, size: 10, font: helvBold, color: ink })
  page.drawText('Amount (₹)',      { x: left + 430,  y, size: 10, font: helvBold, color: ink })
  y -= 6
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: grey })
  y -= 14

  page.drawText(
    `Subscription seats — ${inp.periodStart} to ${inp.periodEnd}`,
    { x: left, y, size: 10, font: helv, color: ink },
  )
  page.drawText(inp.hsnCode,                  { x: left + 280, y, size: 10, font: helv, color: ink })
  page.drawText(String(inp.seatsUsed),        { x: left + 330, y, size: 10, font: helv, color: ink })
  page.drawText(formatINR(inp.taxableAmount), { x: left + 430, y, size: 10, font: helv, color: ink })
  y -= 24

  // Totals (right-aligned)
  const totalsLeft = 350
  const drawRow = (label: string, value: string, bold = false) => {
    page.drawText(label, { x: totalsLeft, y, size: 10, font: bold ? helvBold : helv, color: ink })
    page.drawText(value, { x: left + 430, y, size: 10, font: bold ? helvBold : helv, color: ink })
    y -= 14
  }

  drawRow('Taxable amount', formatINR(inp.taxableAmount))
  if (inp.igst > 0) {
    drawRow(`IGST (${inp.gstRate.toFixed(2)}%)`, formatINR(inp.igst))
  } else {
    drawRow(`CGST (${(inp.gstRate / 2).toFixed(2)}%)`, formatINR(inp.cgst))
    drawRow(`SGST (${(inp.gstRate / 2).toFixed(2)}%)`, formatINR(inp.sgst))
  }
  page.drawLine({ start: { x: totalsLeft, y: y + 4 }, end: { x: right, y: y + 4 }, thickness: 0.5, color: grey })
  drawRow('Total', formatINR(inp.total), true)

  y -= 30

  // Footer
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: grey })
  y -= 12
  page.drawText(
    'This is a computer-generated invoice. Authorised under the IT Act 2000; no signature required.',
    { x: left, y, size: 8, font: helv, color: grey },
  )
  y -= 10
  page.drawText(
    "Subject to the jurisdiction of courts in the supplier's registered state.",
    { x: left, y, size: 8, font: helv, color: grey },
  )

  return await doc.save()
}

// ── Main ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405, cors)

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'misconfigured', detail: 'missing supabase env' }, 500, cors)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Service-role bearer required (server-to-server only). Constant-time
  // check — comparing a high-value secret with `!==` short-circuits at the
  // first differing byte and leaks the secret through response timing.
  if (!checkBearerToken(req.headers.get('Authorization'), SUPABASE_SERVICE_ROLE_KEY)) {
    return json({ error: 'forbidden' }, 403, cors)
  }

  // Flag gate
  if (!(await flagEnabled(admin))) {
    return json({ error: 'flag_off', flag: FLAG_NAME }, 403, cors)
  }

  // Parse body
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400, cors)
  }
  const invoiceId = (body.school_invoice_id ?? '').trim()
  const force     = body.force === true
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) {
    return json({ error: 'invalid_school_invoice_id' }, 400, cors)
  }

  // Fetch invoice + school
  const { data: invoice, error: invErr } = await admin
    .from('school_invoices')
    .select('id, school_id, period_start, period_end, seats_used, amount_inr, status, pdf_url, invoice_number, financial_year, state_code, place_of_supply, school_gstin, school_legal_name, school_billing_address, hsn_code, taxable_amount_inr, gst_rate, cgst_amount, sgst_amount, igst_amount')
    .eq('id', invoiceId)
    .maybeSingle()
  if (invErr || !invoice) {
    return json({ error: 'invoice_not_found', detail: invErr?.message }, 404, cors)
  }
  const inv = invoice as InvoiceRow

  if (inv.invoice_number && !force) {
    return json(
      { error: 'already_generated', invoice_number: inv.invoice_number, hint: 'pass { force: true } to re-render PDF (number is preserved)' },
      409,
      cors,
    )
  }

  const { data: school, error: schoolErr } = await admin
    .from('schools')
    .select('id, name, state, city, address, gstin, legal_name, billing_address')
    .eq('id', inv.school_id)
    .maybeSingle()
  if (schoolErr || !school) {
    return json({ error: 'school_not_found', detail: schoolErr?.message }, 404, cors)
  }
  const sch = school as SchoolRow

  // ── Compute GST fields ───────────────────────────────────────────────
  const periodStartDate = new Date(inv.period_start)
  const finYear         = inv.financial_year ?? financialYearForDate(periodStartDate)
  const stateCode       = inv.state_code     ?? SUPPLIER_STATE_CODE
  const placeOfSupply   = inv.place_of_supply ?? (sch.state ?? SUPPLIER_STATE_CODE)
  const intraState      = placeOfSupply === SUPPLIER_STATE_CODE
  const gstRate         = inv.gst_rate ?? DEFAULT_GST_RATE_PCT
  const hsnCode         = inv.hsn_code ?? DEFAULT_HSN_CODE
  const taxable         = inv.taxable_amount_inr ?? Number(inv.amount_inr) ?? 0

  if (taxable <= 0) {
    return json({ error: 'invalid_amount', detail: 'taxable_amount_inr or amount_inr must be > 0' }, 400, cors)
  }

  const split = computeGst(taxable, gstRate, intraState)

  // ── Allocate invoice number (only if not yet set) ─────────────────────
  let invoiceNumberInt: number
  if (inv.invoice_number) {
    invoiceNumberInt = parseInt(inv.invoice_number.split('/').pop() ?? '0', 10) || 0
  } else {
    const { data: nextNumData, error: rpcErr } = await admin
      .rpc('next_invoice_number', { p_financial_year: finYear, p_state_code: stateCode })
    if (rpcErr || typeof nextNumData !== 'number') {
      return json({ error: 'sequence_failed', detail: rpcErr?.message }, 500, cors)
    }
    invoiceNumberInt = nextNumData
  }
  const invoiceNumber = `ALF/${finYear}/${stateCode}/${String(invoiceNumberInt).padStart(5, '0')}`

  // ── Render PDF ────────────────────────────────────────────────────────
  const pdfBytes = await renderInvoicePdf({
    invoiceNumber,
    invoiceDate:     new Date().toISOString().slice(0, 10),
    periodStart:     inv.period_start,
    periodEnd:       inv.period_end,
    seatsUsed:       inv.seats_used,
    taxableAmount:   taxable,
    gstRate,
    cgst:            split.cgst,
    sgst:            split.sgst,
    igst:            split.igst,
    total:           split.total + taxable,
    hsnCode,
    placeOfSupply,
    supplierName:    SUPPLIER_LEGAL_NAME,
    supplierGstin:   SUPPLIER_GSTIN,
    supplierAddress: SUPPLIER_BILLING_ADDRESS,
    supplierState:   SUPPLIER_STATE_CODE,
    schoolName:      sch.legal_name ?? sch.name,
    schoolGstin:     sch.gstin ?? null,
    schoolAddress:   sch.billing_address ?? sch.address ?? null,
    schoolState:     sch.state ?? placeOfSupply,
  })

  // ── Upload PDF ────────────────────────────────────────────────────────
  const path = `${inv.school_id}/${finYear}/${invoiceNumberInt}.pdf`
  const upload = await admin.storage.from(BUCKET).upload(path, pdfBytes, {
    contentType: 'application/pdf',
    upsert:      true,
  })
  if (upload.error) {
    return json({ error: 'upload_failed', detail: upload.error.message }, 500, cors)
  }

  // ── Update invoice row ────────────────────────────────────────────────
  const totalAmount = Math.round((taxable + split.total) * 100) / 100
  const { error: updErr } = await admin
    .from('school_invoices')
    .update({
      invoice_number:         invoiceNumber,
      financial_year:         finYear,
      state_code:             stateCode,
      hsn_code:               hsnCode,
      place_of_supply:        placeOfSupply,
      school_gstin:           sch.gstin ?? null,
      school_legal_name:      sch.legal_name ?? sch.name,
      school_billing_address: sch.billing_address ?? sch.address ?? null,
      taxable_amount_inr:     taxable,
      gst_rate:               gstRate,
      cgst_amount:            split.cgst,
      sgst_amount:            split.sgst,
      igst_amount:            split.igst,
      amount_inr:             totalAmount,
      pdf_url:                path,
      updated_at:             new Date().toISOString(),
    })
    .eq('id', invoiceId)
  if (updErr) {
    return json({ error: 'invoice_update_failed', detail: updErr.message }, 500, cors)
  }

  return json(
    {
      ok: true,
      invoice_id:     invoiceId,
      invoice_number: invoiceNumber,
      pdf_url:        path,
      total_inr:      totalAmount,
      taxable_inr:    taxable,
      gst_breakdown:  intraState ? { cgst: split.cgst, sgst: split.sgst } : { igst: split.igst },
    },
    200,
    cors,
  )
})
