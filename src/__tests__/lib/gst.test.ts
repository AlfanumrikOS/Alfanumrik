/**
 * src/lib/gst.ts — Track A.3 per-state GST helper (unit).
 *
 * The module is a thin wrapper around the single `public.compute_gst()` RPC. ALL
 * GST arithmetic lives in the RPC; these tests prove the wrapper:
 *   1. invokes compute_gst with the right state inputs and maps the jsonb result
 *      faithfully (intra-state → cgst+sgst, inter-state → igst);
 *   2. returns null on RPC error (caller decides the bare-taxable fallback);
 *   3. gstToRazorpayNotes flattens to STRING-only values, money/codes only —
 *      NO PII (no name/email/phone) — P13;
 *   4. gstSubscriptionColumns produces the documented B2C persist payload shape;
 *   5. supplierStateCode reads the env override chain with a sane MH fallback.
 *
 * No live DB: the SupabaseClient is a stub whose .rpc() returns whatever the test
 * stages. This pins the WIRING + SHAPE, not the SQL (the SQL is pinned by the
 * migration-conformance harness).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  computeGst,
  gstToRazorpayNotes,
  gstSubscriptionColumns,
  supplierStateCode,
  DEFAULT_SAC_CODE,
  type ComputeGstResult,
} from '@/lib/gst';

// ── A stubbed service-role client whose .rpc() returns a staged result. ──
function makeAdmin(staged: { data: unknown; error: unknown }) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    rpc: (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve(staged);
    },
  } as unknown as Parameters<typeof computeGst>[0];
  return { client, calls };
}

// A representative INTRA-state (same supplier+recipient → CGST+SGST) RPC result.
const INTRA: ComputeGstResult = {
  taxable_amount: 1000,
  sac: '9992',
  rate: 18,
  is_exempt: false,
  intra_state: true,
  cgst: 90,
  sgst: 90,
  igst: 0,
  total_tax: 180,
  total_payable: 1180,
  supplier_gstin: '27ABCDE1234F1Z5',
};

// A representative INTER-state (different states → IGST only) RPC result.
const INTER: ComputeGstResult = {
  taxable_amount: 1000,
  sac: '9992',
  rate: 18,
  is_exempt: false,
  intra_state: false,
  cgst: 0,
  sgst: 0,
  igst: 180,
  total_tax: 180,
  total_payable: 1180,
  supplier_gstin: '27ABCDE1234F1Z5',
};

describe('computeGst — RPC wiring + jsonb mapping', () => {
  it('calls public.compute_gst with the supplied state inputs and default SAC', async () => {
    const { client, calls } = makeAdmin({ data: INTRA, error: null });
    const res = await computeGst(client, 1000, 'MH', undefined, 'MH');
    expect(res).toEqual(INTRA);
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('compute_gst');
    expect(calls[0].args).toEqual({
      p_taxable_amount: 1000,
      p_supplier_state: 'MH',
      p_recipient_state: 'MH',
      p_sac: DEFAULT_SAC_CODE,
    });
  });

  it('intra-state result maps to cgst + sgst (no igst)', async () => {
    const { client } = makeAdmin({ data: INTRA, error: null });
    const res = await computeGst(client, 1000, 'MH', '9992', 'MH');
    expect(res).not.toBeNull();
    expect(res!.intra_state).toBe(true);
    expect(res!.cgst + res!.sgst).toBe(res!.total_tax);
    expect(res!.igst).toBe(0);
    expect(res!.total_payable).toBe(res!.taxable_amount + res!.total_tax);
  });

  it('inter-state result maps to igst only (no cgst/sgst)', async () => {
    const { client } = makeAdmin({ data: INTER, error: null });
    const res = await computeGst(client, 1000, 'KA', '9992', 'MH');
    expect(res).not.toBeNull();
    expect(res!.intra_state).toBe(false);
    expect(res!.igst).toBe(res!.total_tax);
    expect(res!.cgst).toBe(0);
    expect(res!.sgst).toBe(0);
  });

  it('passes a null recipient state through to the RPC (B2C no-state → IGST upstream)', async () => {
    const { client, calls } = makeAdmin({ data: INTER, error: null });
    await computeGst(client, 1000, null, '9992', 'MH');
    expect((calls[0].args as { p_recipient_state: unknown }).p_recipient_state).toBeNull();
  });

  it('returns null when the RPC errors (caller falls back to bare taxable)', async () => {
    const { client } = makeAdmin({ data: null, error: { message: 'no tax_config' } });
    const res = await computeGst(client, 1000, 'MH', '9992', 'MH');
    expect(res).toBeNull();
  });

  it('returns null when the RPC returns no data', async () => {
    const { client } = makeAdmin({ data: null, error: null });
    const res = await computeGst(client, 1000, 'MH', '9992', 'MH');
    expect(res).toBeNull();
  });
});

describe('gstToRazorpayNotes — string-only, PII-free (P13)', () => {
  it('flattens every value to a string', () => {
    const notes = gstToRazorpayNotes(INTRA);
    for (const [k, v] of Object.entries(notes)) {
      expect(typeof v, `notes.${k} must be a string`).toBe('string');
    }
  });

  it('carries the full tax split + codes for webhook reconciliation', () => {
    const notes = gstToRazorpayNotes(INTRA);
    expect(notes.gst_sac).toBe('9992');
    expect(notes.gst_rate).toBe('18');
    expect(notes.gst_intra_state).toBe('true');
    expect(notes.gst_cgst_inr).toBe('90');
    expect(notes.gst_sgst_inr).toBe('90');
    expect(notes.gst_igst_inr).toBe('0');
    expect(notes.gst_total_tax_inr).toBe('180');
    expect(notes.gst_total_payable_inr).toBe('1180');
    expect(notes.gst_supplier_gstin).toBe('27ABCDE1234F1Z5');
  });

  it('contains NO PII key (no name/email/phone) — P13', () => {
    const notes = gstToRazorpayNotes(INTRA);
    const keys = Object.keys(notes).join('|').toLowerCase();
    expect(keys).not.toMatch(/name|email|phone|mobile|address/);
    // And every key is a gst_/business code, no identity payload.
    for (const k of Object.keys(notes)) {
      expect(k).toMatch(/^gst_/);
    }
  });

  it('emits an empty string (never null/undefined) for an unregistered supplier GSTIN', () => {
    const notes = gstToRazorpayNotes({ ...INTRA, supplier_gstin: null });
    expect(notes.gst_supplier_gstin).toBe('');
    expect(typeof notes.gst_supplier_gstin).toBe('string');
  });
});

describe('gstSubscriptionColumns — B2C persist payload shape', () => {
  it('maps the GST split + supplier/place metadata onto the documented columns', () => {
    const cols = gstSubscriptionColumns(INTRA, { supplierState: 'MH', placeOfSupply: 'KA' });
    expect(cols).toEqual({
      sac: '9992',
      gst_rate: 18,
      taxable_amount_inr: 1000,
      cgst_amount: 90,
      sgst_amount: 90,
      igst_amount: 0,
      total_tax_inr: 180,
      supplier_gstin: '27ABCDE1234F1Z5',
      supplier_state_code: 'MH',
      place_of_supply: 'KA',
    });
  });

  it('keeps numeric money values numeric (not coerced to strings) for numeric(12,2) columns', () => {
    const cols = gstSubscriptionColumns(INTER, { supplierState: 'MH', placeOfSupply: 'KA' });
    expect(typeof cols.cgst_amount).toBe('number');
    expect(typeof cols.igst_amount).toBe('number');
    expect(typeof cols.total_tax_inr).toBe('number');
  });

  it('normalizes a missing/undefined place_of_supply to null', () => {
    const cols = gstSubscriptionColumns(INTRA, { supplierState: 'MH', placeOfSupply: undefined });
    expect(cols.place_of_supply).toBeNull();
  });

  it('persists a null supplier_gstin verbatim (unregistered supplier state)', () => {
    const cols = gstSubscriptionColumns({ ...INTRA, supplier_gstin: null }, {
      supplierState: 'MH',
      placeOfSupply: 'KA',
    });
    expect(cols.supplier_gstin).toBeNull();
  });
});

describe('supplierStateCode — env override chain + fallback', () => {
  const ORIG_A = process.env.ALFANUMRIK_SUPPLIER_STATE_CODE;
  const ORIG_B = process.env.ALFANUMRIK_STATE_CODE;

  beforeEach(() => {
    delete process.env.ALFANUMRIK_SUPPLIER_STATE_CODE;
    delete process.env.ALFANUMRIK_STATE_CODE;
  });
  afterEach(() => {
    if (ORIG_A === undefined) delete process.env.ALFANUMRIK_SUPPLIER_STATE_CODE;
    else process.env.ALFANUMRIK_SUPPLIER_STATE_CODE = ORIG_A;
    if (ORIG_B === undefined) delete process.env.ALFANUMRIK_STATE_CODE;
    else process.env.ALFANUMRIK_STATE_CODE = ORIG_B;
  });

  it('falls back to "MH" when no env override is set', () => {
    expect(supplierStateCode()).toBe('MH');
  });

  it('prefers ALFANUMRIK_SUPPLIER_STATE_CODE when set', () => {
    process.env.ALFANUMRIK_SUPPLIER_STATE_CODE = 'KA';
    expect(supplierStateCode()).toBe('KA');
  });

  it('uses the legacy ALFANUMRIK_STATE_CODE alias when the primary is unset', () => {
    process.env.ALFANUMRIK_STATE_CODE = 'DL';
    expect(supplierStateCode()).toBe('DL');
  });

  it('primary override wins over the legacy alias', () => {
    process.env.ALFANUMRIK_SUPPLIER_STATE_CODE = 'GJ';
    process.env.ALFANUMRIK_STATE_CODE = 'DL';
    expect(supplierStateCode()).toBe('GJ');
  });
});
