-- Migration: 20260621000300_track_a_per_state_gst_billing.sql
-- Purpose: Track A.3 — per-state GST (India) billing FOUNDATION (architect-owned
--          SCHEMA + RPC half). Establishes the supplier-side tax configuration,
--          the per-state supplier GSTIN registry, the per-school tax identity, a
--          single reusable deterministic compute_gst() RPC, and the additive
--          invoice/subscription columns that backend will populate atomically with
--          the invoice + Razorpay order. Backend wires the computation afterward.
--
-- BUSINESS MODEL (user-confirmed decision #1 = PER-STATE GSTIN):
--   * Alfanumrik registers a GSTIN per Indian STATE of operation (multiple GSTINs).
--   * GST on an invoice depends on PLACE OF SUPPLY (recipient school's state) vs the
--     SUPPLIER state of the issuing GSTIN:
--       - Same state (intra-state)   -> CGST + SGST, each = HALF the total rate.
--       - Different state (inter-state) -> IGST = the FULL total rate.
--   * Education-SaaS SAC code is 9992. The GST RATE is CONFIGURABLE (NOT hardcoded
--     18%): whether SAC 9992 is taxable@18% or exempt is a LEGAL call the CEO sets
--     per SAC. We SEED a sensible default behind a clearly-marked CEO-confirmable
--     comment; the live rate is a config row, edited (not migrated) before go-live.
--   * Coexists with B2C student subscriptions (decision #3): GST is modelled for
--     BOTH B2B school invoices AND B2C student subscriptions, but the computation
--     lives in ONE reusable RPC (compute_gst) — no duplicated arithmetic.
--
-- ─── Scope / safety contract (HARD CONSTRAINTS) ──────────────────────────────
--   - ADDITIVE + IDEMPOTENT ONLY. No DROP TABLE / DROP COLUMN / DELETE / UPDATE /
--     TRUNCATE of data. The only DROPs are DROP POLICY IF EXISTS / DROP TRIGGER IF
--     EXISTS, each immediately followed by an equivalent CREATE in the same txn
--     (Postgres has no CREATE OR REPLACE POLICY). Replayable on PROD, main-staging,
--     CI live-DB, and fresh DBs.
--   - P8: every NEW table (tax_config, supplier_gstins, school_gst_details) gets
--     ENABLE ROW LEVEL SECURITY + policies in THIS file.
--   - P11: the GST breakdown columns added to school_invoices / student_subscriptions
--     are NULLABLE and ADDITIVE — they let backend write the tax split ATOMICALLY
--     with the invoice/payment record (this migration provides the columns; backend
--     guarantees the single-transaction write).
--   - P13: no PII anywhere here — GSTINs and legal names are business-registration
--     data, uuid-keyed; compute_gst returns money + codes only, never student PII.
--   - P5: grades untouched. money stored as numeric(_,2), never float.
--   - SECURITY DEFINER: ONLY compute_gst, with the standard justification comment
--     (it must read tax_config + supplier_gstins across the admin-only RLS boundary
--     so the invoice generator can call it as the service role OR a school admin and
--     get the same answer). Keyed strictly by its inputs (no auth.uid() widening),
--     read-only, search_path pinned to public.
--
-- ─── ROLE-MODEL NOTE (read before go-live) ───────────────────────────────────
--   There is NO dedicated 'finance' role on this platform today. RBAC roles are
--   student / parent / teacher / tutor / admin / super_admin, plus institution_admin
--   (schools) and the platform-staff admin_users table. Per the constitution, ADDING
--   a finance role requires explicit CEO approval, so this migration maps "admin /
--   finance read+write" onto the EXISTING platform-admin surface:
--     * READ  of tax_config / supplier_gstins  -> is_admin() (active admin_users:
--                                                  role admin OR super_admin) + service_role.
--     * WRITE of tax_config / supplier_gstins   -> active super_admin in admin_users
--                                                  + service_role.
--   When a true segregated finance role is approved, swap the is_admin()/super_admin
--   predicates for a finance-aware helper in a follow-up widening migration. Flagged
--   for CEO/finance confirmation (see the GO-LIVE CHECKLIST at the foot of this file).
--
-- Owner: architect. Track A.3 — per-state GST billing schema + RPC foundation.

BEGIN;

-- =============================================================================
-- 0. ROLE HELPER — is_platform_super_admin()
-- =============================================================================
-- Small STABLE helper so the write policies below read cleanly. Mirrors is_admin()
-- (active admin_users) but narrows to super_admin. SECURITY DEFINER to read
-- admin_users regardless of the caller's RLS; keyed only by auth.uid().
CREATE OR REPLACE FUNCTION "public"."is_platform_super_admin"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN (
    SELECT EXISTS (
      SELECT 1 FROM admin_users
       WHERE auth_user_id = auth.uid()
         AND is_active = true
         AND role = 'super_admin'
    )
  );
END;
$$;

COMMENT ON FUNCTION "public"."is_platform_super_admin"() IS
  'TRUE when the caller is an active super_admin in admin_users. Used by the GST '
  'config write policies (tax_config, supplier_gstins) as the stand-in for a '
  'finance-writer role until a segregated finance role is CEO-approved. '
  'SECURITY DEFINER, keyed by auth.uid(), search_path pinned to public.';

-- =============================================================================
-- 1. tax_config — supplier-side tax configuration (per-SAC GST rate, effective).
-- =============================================================================
-- One row per (sac, effective_from). The CURRENT rate for a SAC is the row with the
-- greatest effective_from <= today that is is_active. Rate changes are NEW rows
-- (history-preserving), never an UPDATE of an old row — so an issued invoice can
-- always be reconstructed against the rate in force on its date.
--
-- is_exempt = true means the SAC is GST-EXEMPT: compute_gst returns zero tax even
-- if a non-zero gst_rate is present (the legal exempt flag wins). This is the CEO's
-- taxable-vs-exempt switch for education SaaS.
CREATE TABLE IF NOT EXISTS "public"."tax_config" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sac"            text NOT NULL,                 -- SAC service code, e.g. '9992'
  "gst_rate"       numeric(5,2) NOT NULL,         -- TOTAL rate %, e.g. 18.00. Split into CGST/SGST or IGST by place of supply.
  "is_exempt"      boolean NOT NULL DEFAULT false,-- true => zero tax regardless of gst_rate (legal exemption)
  "effective_from" date NOT NULL DEFAULT CURRENT_DATE,
  "effective_to"   date,                          -- NULL = open-ended (current)
  "is_active"      boolean NOT NULL DEFAULT true,
  "notes"          text,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tax_config_gst_rate_nonneg" CHECK ("gst_rate" >= 0 AND "gst_rate" <= 100),
  CONSTRAINT "tax_config_period_valid"    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);

-- One ACTIVE config per (sac, effective_from) — replays/idempotent seeds collapse.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tax_config_sac_effective"
  ON "public"."tax_config" ("sac", "effective_from");
CREATE INDEX IF NOT EXISTS "idx_tax_config_sac_active"
  ON "public"."tax_config" ("sac", "is_active");

ALTER TABLE "public"."tax_config" ENABLE ROW LEVEL SECURITY;

-- READ: platform admins/super_admins (is_admin) + service role.
DROP POLICY IF EXISTS "tax_config_admin_select" ON "public"."tax_config";
CREATE POLICY "tax_config_admin_select"
  ON "public"."tax_config"
  FOR SELECT TO "authenticated"
  USING ("public"."is_admin"());

DROP POLICY IF EXISTS "tax_config_service_role" ON "public"."tax_config";
CREATE POLICY "tax_config_service_role"
  ON "public"."tax_config"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- WRITE: super_admin only (finance-writer stand-in). Separate INSERT/UPDATE so a
-- future finance role can be widened independently. No DELETE policy (history is
-- append/supersede, never deleted).
DROP POLICY IF EXISTS "tax_config_super_admin_insert" ON "public"."tax_config";
CREATE POLICY "tax_config_super_admin_insert"
  ON "public"."tax_config"
  FOR INSERT TO "authenticated"
  WITH CHECK ("public"."is_platform_super_admin"());

DROP POLICY IF EXISTS "tax_config_super_admin_update" ON "public"."tax_config";
CREATE POLICY "tax_config_super_admin_update"
  ON "public"."tax_config"
  FOR UPDATE TO "authenticated"
  USING ("public"."is_platform_super_admin"())
  WITH CHECK ("public"."is_platform_super_admin"());

-- Seed: SAC 9992 (education services). DEFAULT RATE 18.00% is a SENSIBLE PLACEHOLDER
-- ── CEO/finance MUST confirm before go-live whether SAC 9992 is taxable@18% or
-- EXEMPT (set is_exempt=true and/or gst_rate=0). Do NOT treat 18.00 as authoritative.
INSERT INTO "public"."tax_config" ("sac", "gst_rate", "is_exempt", "effective_from", "notes")
VALUES (
  '9992',
  18.00,                         -- <<< CEO-CONFIRMABLE default; legal call pending.
  false,                         -- <<< CEO-CONFIRMABLE: flip to true if 9992 is exempt.
  '2025-04-01',                  -- FY2025-26 start; harmless historical anchor.
  'PLACEHOLDER default rate for education SaaS (SAC 9992). CEO/finance to confirm '
  'taxable@18% vs exempt before go-live. Change via a NEW row (new effective_from), '
  'not by editing this one, to preserve invoice-time reconstructability.'
)
ON CONFLICT ("sac", "effective_from") DO NOTHING;

COMMENT ON TABLE "public"."tax_config" IS
  'Supplier-side per-SAC GST configuration. Current rate for a SAC = active row with '
  'the greatest effective_from <= invoice date. is_exempt overrides gst_rate to zero. '
  'Rate changes are NEW rows (history-preserving). Read: admins+service. Write: super_admin.';
COMMENT ON COLUMN "public"."tax_config"."gst_rate" IS
  'TOTAL GST rate %. compute_gst splits it: intra-state -> CGST+SGST (each rate/2); '
  'inter-state -> IGST (full rate). CEO-confirmable for SAC 9992.';
COMMENT ON COLUMN "public"."tax_config"."is_exempt" IS
  'Legal GST exemption flag. true => compute_gst returns zero tax regardless of gst_rate.';

-- =============================================================================
-- 2. supplier_gstins — per-state supplier GSTIN registry (Alfanumrik's own).
-- =============================================================================
-- One row per Indian state in which Alfanumrik holds a GSTIN. The SUPPLIER state of
-- an invoice resolves its issuing GSTIN; compare it to the recipient (place-of-supply)
-- state to pick intra- vs inter-state. NO real GSTINs seeded here (left to finance);
-- a clearly-marked placeholder is inserted behind a comment for shape only.
CREATE TABLE IF NOT EXISTS "public"."supplier_gstins" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "state_code"  text NOT NULL,        -- 2-letter India state code, e.g. 'MH', 'KA', 'DL'
  "gstin"       text NOT NULL,        -- 15-char GSTIN for that state
  "legal_name"  text NOT NULL,        -- registered legal entity name for that GSTIN
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

-- One active GSTIN per state (a supplier holds at most one GSTIN per state).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_supplier_gstins_state"
  ON "public"."supplier_gstins" ("state_code");
CREATE INDEX IF NOT EXISTS "idx_supplier_gstins_active"
  ON "public"."supplier_gstins" ("is_active");

ALTER TABLE "public"."supplier_gstins" ENABLE ROW LEVEL SECURITY;

-- READ: platform admins (is_admin) + service role (the invoice generator reads it).
DROP POLICY IF EXISTS "supplier_gstins_admin_select" ON "public"."supplier_gstins";
CREATE POLICY "supplier_gstins_admin_select"
  ON "public"."supplier_gstins"
  FOR SELECT TO "authenticated"
  USING ("public"."is_admin"());

DROP POLICY IF EXISTS "supplier_gstins_service_role" ON "public"."supplier_gstins";
CREATE POLICY "supplier_gstins_service_role"
  ON "public"."supplier_gstins"
  TO "service_role"
  USING (true) WITH CHECK (true);

-- WRITE: super_admin only.
DROP POLICY IF EXISTS "supplier_gstins_super_admin_insert" ON "public"."supplier_gstins";
CREATE POLICY "supplier_gstins_super_admin_insert"
  ON "public"."supplier_gstins"
  FOR INSERT TO "authenticated"
  WITH CHECK ("public"."is_platform_super_admin"());

DROP POLICY IF EXISTS "supplier_gstins_super_admin_update" ON "public"."supplier_gstins";
CREATE POLICY "supplier_gstins_super_admin_update"
  ON "public"."supplier_gstins"
  FOR UPDATE TO "authenticated"
  USING ("public"."is_platform_super_admin"())
  WITH CHECK ("public"."is_platform_super_admin"());

-- NO REAL GSTINs are invented. Finance/ops seeds the real per-state registry in a
-- follow-up. The placeholder below is intentionally NOT inserted (commented out) so
-- compute_gst returns supplier_gstin = NULL until finance seeds real data — making a
-- missing-GSTIN go-live blocker LOUD rather than silently shipping a fake number.
--   INSERT INTO public.supplier_gstins (state_code, gstin, legal_name) VALUES
--     ('MH', '27XXXXXXXXXXXZ5', 'Cusiosense Learning India Private Limited');  -- PLACEHOLDER — finance to provide real GSTIN.

COMMENT ON TABLE "public"."supplier_gstins" IS
  'Per-state supplier (Alfanumrik) GSTIN registry. One GSTIN per Indian state of '
  'operation. The invoice supplier state selects the issuing GSTIN; compared to the '
  'recipient place-of-supply state to pick intra- vs inter-state. Read: admins+service. '
  'Write: super_admin. REAL GSTINs seeded by finance in a follow-up — none invented here.';

-- =============================================================================
-- 3. school_gst_details — per-school tax identity (buyer side, B2B).
-- =============================================================================
-- One row per school. gstin is NULLABLE (unregistered schools exist; the invoice
-- still issues, marked "GSTIN: Unregistered"). place_of_supply_state_code drives the
-- intra/inter-state split for that school's B2B invoices.
CREATE TABLE IF NOT EXISTS "public"."school_gst_details" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "school_id"                   uuid NOT NULL REFERENCES "public"."schools"("id") ON DELETE CASCADE,
  "gstin"                       text,            -- NULLABLE: unregistered schools have none
  "legal_name"                  text,            -- registered bill-to legal entity (defaults to schools.legal_name/name)
  "place_of_supply_state_code"  text,            -- 2-letter recipient state code; drives intra/inter split
  "is_registered"               boolean NOT NULL DEFAULT false,
  "created_at"                  timestamptz NOT NULL DEFAULT now(),
  "updated_at"                  timestamptz NOT NULL DEFAULT now()
);

-- One GST-details row per school.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_school_gst_details_school"
  ON "public"."school_gst_details" ("school_id");

ALTER TABLE "public"."school_gst_details" ENABLE ROW LEVEL SECURITY;

-- A school admin can read+write ONLY their own school's row. Mirrors the established
-- school-scoped pattern (is_school_admin_of / get_admin_school_id). Separate
-- SELECT/INSERT/UPDATE so the contract is explicit and matches sibling migrations.
DROP POLICY IF EXISTS "school_gst_details_admin_select" ON "public"."school_gst_details";
CREATE POLICY "school_gst_details_admin_select"
  ON "public"."school_gst_details"
  FOR SELECT TO "authenticated"
  USING (
    ("school_id" = "public"."get_admin_school_id"())
    OR "public"."is_school_admin_of"("school_id")
  );

DROP POLICY IF EXISTS "school_gst_details_admin_insert" ON "public"."school_gst_details";
CREATE POLICY "school_gst_details_admin_insert"
  ON "public"."school_gst_details"
  FOR INSERT TO "authenticated"
  WITH CHECK (
    "school_id" IS NOT NULL
    AND (
      ("school_id" = "public"."get_admin_school_id"())
      OR "public"."is_school_admin_of"("school_id")
    )
  );

DROP POLICY IF EXISTS "school_gst_details_admin_update" ON "public"."school_gst_details";
CREATE POLICY "school_gst_details_admin_update"
  ON "public"."school_gst_details"
  FOR UPDATE TO "authenticated"
  USING (
    ("school_id" = "public"."get_admin_school_id"())
    OR "public"."is_school_admin_of"("school_id")
  )
  WITH CHECK (
    "school_id" IS NOT NULL
    AND (
      ("school_id" = "public"."get_admin_school_id"())
      OR "public"."is_school_admin_of"("school_id")
    )
  );

-- Service role full access (invoice generator snapshots these values at issue time).
DROP POLICY IF EXISTS "school_gst_details_service_role" ON "public"."school_gst_details";
CREATE POLICY "school_gst_details_service_role"
  ON "public"."school_gst_details"
  TO "service_role"
  USING (true) WITH CHECK (true);

COMMENT ON TABLE "public"."school_gst_details" IS
  'Per-school buyer-side tax identity for B2B invoicing. gstin NULLABLE (unregistered '
  'schools). place_of_supply_state_code drives intra/inter-state GST split. RLS: a '
  'school admin reads/writes only their own school row (get_admin_school_id / '
  'is_school_admin_of); service role full.';
COMMENT ON COLUMN "public"."school_gst_details"."gstin" IS
  'Buyer GSTIN (15-char). NULL => unregistered school; invoice marked "GSTIN: Unregistered".';
COMMENT ON COLUMN "public"."school_gst_details"."place_of_supply_state_code" IS
  'Recipient 2-letter state code (CGST Rule 46(g)). Compared to the supplier state to '
  'pick intra-state (CGST+SGST) vs inter-state (IGST).';

-- =============================================================================
-- 4. compute_gst() — the single reusable, deterministic GST RPC (B2B + B2C).
-- =============================================================================
-- INPUTS:
--   p_taxable_amount numeric  -- pre-GST taxable value (numeric; INR). >= 0.
--   p_supplier_state text     -- 2-letter supplier state code (issuing GSTIN's state).
--   p_recipient_state text    -- 2-letter recipient / place-of-supply state code.
--   p_sac text                -- SAC code (default '9992' education services).
--
-- RETURNS jsonb:
--   { taxable_amount, sac, rate, is_exempt, intra_state(bool),
--     cgst, sgst, igst, total_tax, total_payable, supplier_gstin }
--
-- LOGIC:
--   * rate + is_exempt looked up from tax_config (current active row for the SAC).
--   * If exempt OR rate=0: all tax components 0, total_payable = taxable_amount.
--   * intra_state = (supplier_state = recipient_state), case-insensitively, when BOTH
--     are present. If recipient_state is NULL/empty (e.g. an unregistered B2C buyer
--     with no state), we DEFAULT to INTER-STATE (IGST) — the conservative full-rate
--     treatment — and the caller may override once a state is captured.
--   * Intra-state -> cgst = sgst = round(taxable * (rate/2) / 100, 2); igst = 0.
--   * Inter-state -> igst = round(taxable * rate / 100, 2); cgst = sgst = 0.
--   * supplier_gstin resolved from supplier_gstins by p_supplier_state (active), else NULL.
--
-- ROUNDING CONVENTION: each tax COMPONENT is rounded HALF-UP to 2 decimals
-- INDEPENDENTLY (Postgres numeric round() is half-up), then total_tax = sum of the
-- rounded components, and total_payable = taxable_amount + total_tax. This matches the
-- common GST-invoice practice of rounding per-component (CGST and SGST shown to 2 dp
-- each). taxable_amount is echoed rounded to 2 dp. Backend persists these exact values.
--
-- SECURITY DEFINER justification: tax_config and supplier_gstins are admin/service
-- read-only (RLS above). compute_gst must read both so it returns the SAME answer
-- whether invoked by the service-role invoice generator or (future) a school admin
-- previewing their bill. It is keyed STRICTLY by its inputs (no auth.uid() use, no
-- tenant widening), is READ-ONLY (no writes), and pins search_path = public to block
-- search-path hijack of the unqualified lookups.
CREATE OR REPLACE FUNCTION "public"."compute_gst"(
  "p_taxable_amount" numeric,
  "p_supplier_state" text,
  "p_recipient_state" text,
  "p_sac" text DEFAULT '9992'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_taxable        numeric(14,2);
  v_rate           numeric(5,2);
  v_is_exempt      boolean;
  v_intra          boolean;
  v_cgst           numeric(14,2) := 0;
  v_sgst           numeric(14,2) := 0;
  v_igst           numeric(14,2) := 0;
  v_total_tax      numeric(14,2) := 0;
  v_supplier_gstin text;
  v_sac            text := COALESCE(NULLIF(btrim(p_sac), ''), '9992');
BEGIN
  IF p_taxable_amount IS NULL OR p_taxable_amount < 0 THEN
    RAISE EXCEPTION 'p_taxable_amount must be a non-negative number'
      USING ERRCODE = '22023';
  END IF;

  v_taxable := round(p_taxable_amount, 2);

  -- Current active rate for the SAC (greatest effective_from in force today).
  SELECT tc.gst_rate, tc.is_exempt
    INTO v_rate, v_is_exempt
    FROM tax_config tc
   WHERE tc.sac = v_sac
     AND tc.is_active = true
     AND tc.effective_from <= CURRENT_DATE
     AND (tc.effective_to IS NULL OR tc.effective_to >= CURRENT_DATE)
   ORDER BY tc.effective_from DESC
   LIMIT 1;

  -- No config row => treat as 0% (do NOT guess a rate). Caller/finance must seed one.
  v_rate := COALESCE(v_rate, 0);
  v_is_exempt := COALESCE(v_is_exempt, false);

  -- Resolve the issuing supplier GSTIN for the supplier state (if registered there).
  SELECT sg.gstin
    INTO v_supplier_gstin
    FROM supplier_gstins sg
   WHERE upper(btrim(sg.state_code)) = upper(btrim(p_supplier_state))
     AND sg.is_active = true
   LIMIT 1;

  -- intra-state only when BOTH states are present and equal (case-insensitive).
  -- Missing recipient state => conservative inter-state (IGST, full rate).
  v_intra := (
    p_supplier_state IS NOT NULL AND btrim(p_supplier_state) <> ''
    AND p_recipient_state IS NOT NULL AND btrim(p_recipient_state) <> ''
    AND upper(btrim(p_supplier_state)) = upper(btrim(p_recipient_state))
  );

  IF v_is_exempt OR v_rate = 0 THEN
    -- Exempt or zero-rated: no tax components.
    v_cgst := 0; v_sgst := 0; v_igst := 0;
  ELSIF v_intra THEN
    -- Intra-state: CGST + SGST, each half the total rate, rounded per component.
    v_cgst := round(v_taxable * (v_rate / 2) / 100, 2);
    v_sgst := round(v_taxable * (v_rate / 2) / 100, 2);
    v_igst := 0;
  ELSE
    -- Inter-state: IGST at the full rate.
    v_igst := round(v_taxable * v_rate / 100, 2);
    v_cgst := 0; v_sgst := 0;
  END IF;

  v_total_tax := v_cgst + v_sgst + v_igst;

  RETURN jsonb_build_object(
    'taxable_amount', v_taxable,
    'sac',            v_sac,
    'rate',           v_rate,
    'is_exempt',      v_is_exempt,
    'intra_state',    v_intra,
    'cgst',           v_cgst,
    'sgst',           v_sgst,
    'igst',           v_igst,
    'total_tax',      v_total_tax,
    'total_payable',  round(v_taxable + v_total_tax, 2),
    'supplier_gstin', v_supplier_gstin
  );
END;
$$;

COMMENT ON FUNCTION "public"."compute_gst"(numeric, text, text, text) IS
  'Single reusable deterministic India-GST calculator for BOTH B2B school invoices '
  'and B2C student subscriptions. Looks up the current per-SAC rate + exempt flag from '
  'tax_config and the issuing GSTIN from supplier_gstins. intra-state (supplier=recipient '
  'state) -> CGST+SGST (each rate/2); inter-state (or unknown recipient state) -> IGST '
  '(full rate). is_exempt or rate=0 => zero tax. Per-component half-up rounding to 2dp; '
  'total_tax = sum of rounded components; total_payable = taxable + total_tax. Returns '
  'jsonb {taxable_amount,sac,rate,is_exempt,intra_state,cgst,sgst,igst,total_tax,'
  'total_payable,supplier_gstin}. READ-ONLY. SECURITY DEFINER (must read the admin-only '
  'config tables); keyed strictly by inputs, search_path pinned to public.';

-- compute_gst is callable by the service-role invoice generator and by authenticated
-- school admins (future preview). No PII flows through it.
GRANT EXECUTE ON FUNCTION "public"."compute_gst"(numeric, text, text, text)
  TO "authenticated", "service_role";

-- =============================================================================
-- 5. Additive GST-breakdown columns on the invoice / subscription paths.
-- =============================================================================
-- All NULLABLE + ADDITIVE so backend can populate the GST split ATOMICALLY with the
-- invoice / payment record (P11). Existing amount columns are NOT touched.

-- 5a. school_invoices (B2B). The prior GST migration (20260507130001) already added
-- taxable_amount_inr, gst_rate, cgst_amount, sgst_amount, igst_amount, place_of_supply,
-- school_gstin, school_legal_name, hsn_code. We add ONLY the missing pieces for the
-- per-state model: the SAC code and the SUPPLIER-side GSTIN snapshot (the issuing
-- GSTIN of Alfanumrik's state). total_tax / total_payable are derivable but stored
-- for invoice fidelity.
ALTER TABLE "public"."school_invoices"
  ADD COLUMN IF NOT EXISTS "sac"                  text,
  ADD COLUMN IF NOT EXISTS "supplier_gstin"       text,           -- issuing Alfanumrik GSTIN snapshot
  ADD COLUMN IF NOT EXISTS "supplier_state_code"  text,           -- supplier state of the issuing GSTIN
  ADD COLUMN IF NOT EXISTS "total_tax_inr"        numeric(12,2),
  ADD COLUMN IF NOT EXISTS "total_payable_inr"    numeric(12,2);

COMMENT ON COLUMN "public"."school_invoices"."sac" IS
  'SAC service code for the line (education SaaS = 9992). Snapshotted at issue time.';
COMMENT ON COLUMN "public"."school_invoices"."supplier_gstin" IS
  'Issuing Alfanumrik GSTIN (the per-state supplier GSTIN). Snapshot from supplier_gstins '
  'at issue time. Distinct from school_gstin (the buyer GSTIN).';
COMMENT ON COLUMN "public"."school_invoices"."total_payable_inr" IS
  'taxable_amount_inr + cgst_amount + sgst_amount + igst_amount, snapshot from compute_gst.';

-- 5b. student_subscriptions (B2C). No separate B2C invoice table exists; the
-- subscription row IS the B2C billing record. Add a GST breakdown additively so the
-- B2C payment path can persist tax alongside amount_paid (which stays untouched).
-- NOTE: amount_paid on student_subscriptions is INTEGER (paise/rupee units per the
-- existing B2C convention) — we do NOT alter it. The new GST columns are numeric(12,2)
-- (rupees) to match compute_gst's output; backend reconciles units when populating.
ALTER TABLE "public"."student_subscriptions"
  ADD COLUMN IF NOT EXISTS "sac"                  text,
  ADD COLUMN IF NOT EXISTS "gst_rate"             numeric(5,2),
  ADD COLUMN IF NOT EXISTS "taxable_amount_inr"   numeric(12,2),
  ADD COLUMN IF NOT EXISTS "cgst_amount"          numeric(12,2),
  ADD COLUMN IF NOT EXISTS "sgst_amount"          numeric(12,2),
  ADD COLUMN IF NOT EXISTS "igst_amount"          numeric(12,2),
  ADD COLUMN IF NOT EXISTS "total_tax_inr"        numeric(12,2),
  ADD COLUMN IF NOT EXISTS "supplier_gstin"       text,
  ADD COLUMN IF NOT EXISTS "supplier_state_code"  text,
  ADD COLUMN IF NOT EXISTS "place_of_supply"      text;             -- student/buyer state code

COMMENT ON COLUMN "public"."student_subscriptions"."place_of_supply" IS
  'B2C buyer (student/guardian) state code. Drives intra/inter-state GST for the '
  'subscription. NULL for legacy rows; backend captures it at checkout going forward.';
COMMENT ON COLUMN "public"."student_subscriptions"."taxable_amount_inr" IS
  'Pre-GST taxable value in rupees (numeric). Distinct from amount_paid (integer, '
  'existing B2C unit convention) which is NOT altered by this migration.';

-- =============================================================================
-- 6. updated_at triggers for the 3 new tables (reuse the standard pattern).
-- =============================================================================
CREATE OR REPLACE FUNCTION "public"."tg_set_updated_at_gst"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS "trg_tax_config_updated_at" ON "public"."tax_config";
CREATE TRIGGER "trg_tax_config_updated_at" BEFORE UPDATE ON "public"."tax_config"
  FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_updated_at_gst"();

DROP TRIGGER IF EXISTS "trg_supplier_gstins_updated_at" ON "public"."supplier_gstins";
CREATE TRIGGER "trg_supplier_gstins_updated_at" BEFORE UPDATE ON "public"."supplier_gstins"
  FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_updated_at_gst"();

DROP TRIGGER IF EXISTS "trg_school_gst_details_updated_at" ON "public"."school_gst_details";
CREATE TRIGGER "trg_school_gst_details_updated_at" BEFORE UPDATE ON "public"."school_gst_details"
  FOR EACH ROW EXECUTE FUNCTION "public"."tg_set_updated_at_gst"();

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. Default config seeded:
--      SELECT sac, gst_rate, is_exempt FROM tax_config WHERE sac = '9992';  -- 9992 | 18.00 | f
-- 2. compute_gst intra-state (same state) splits CGST+SGST:
--      SELECT public.compute_gst(1000, 'MH', 'MH', '9992');
--      -- {... intra_state:true, cgst:90.00, sgst:90.00, igst:0, total_tax:180.00, total_payable:1180.00 ...}
-- 3. compute_gst inter-state (different state) charges IGST:
--      SELECT public.compute_gst(1000, 'MH', 'KA', '9992');
--      -- {... intra_state:false, cgst:0, sgst:0, igst:180.00, total_tax:180.00, total_payable:1180.00 ...}
-- 4. exempt flag zeroes tax:
--      -- (after UPDATE tax_config SET is_exempt=true WHERE sac='9992')
--      SELECT public.compute_gst(1000, 'MH', 'KA', '9992');  -- total_tax:0, total_payable:1000.00
-- 5. supplier_gstin NULL until finance seeds supplier_gstins (loud go-live blocker).
--
-- ─── GO-LIVE CHECKLIST (CEO / finance MUST confirm before enabling GST billing) ──
--   [ ] CONFIRM SAC 9992 tax treatment: taxable@18% (current placeholder) OR exempt.
--       If exempt: UPDATE tax_config SET is_exempt = true (or insert a new effective
--       row); do NOT keep the placeholder 18.00 as authoritative.
--   [ ] SEED real per-state supplier GSTINs into supplier_gstins (no real numbers were
--       invented in this migration). compute_gst returns supplier_gstin = NULL until then.
--   [ ] CONFIRM the finance-writer authority model: this migration uses
--       is_platform_super_admin() as the finance-write stand-in. If a segregated
--       finance role is approved, widen the write policies in a follow-up.
--   [ ] Backend: populate the new invoice/subscription GST columns ATOMICALLY with the
--       invoice + payment record (P11), reading values from compute_gst (see handoff note).
