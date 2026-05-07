-- Migration: 20260507130002_invoice_number_sequences.sql
-- Purpose: Gap-free, concurrency-safe sequential invoice numbering per
--          (financial_year, state_code), as required by India CGST Rule 46
--          ("a consecutive serial number ... unique for a financial year").
--
-- Why a table + advisory lock instead of a Postgres SEQUENCE:
--   - SEQUENCE is fast but allows gaps if a transaction rolls back. CGST
--     auditors flag gaps; we cannot tolerate them.
--   - A table row protected by pg_advisory_xact_lock guarantees the number
--     we hand out is the same one we commit. If the transaction aborts after
--     this RPC returns, the caller never used the number, but the row
--     update also rolls back, so the next call gets the same number again.
--     Net: no gaps even under concurrent calls and transaction aborts.
--
-- Phase 3-A of the May 2026 upgrade.
--
-- DOWN (manual):
--   DROP FUNCTION public.next_invoice_number(text, text);
--   DROP TABLE public.invoice_number_sequences;

BEGIN;

-- ── 1. Sequence table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_number_sequences (
  financial_year   text NOT NULL,
  state_code       text NOT NULL,
  last_used_number integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (financial_year, state_code),
  CONSTRAINT invoice_seq_year_format CHECK (financial_year ~ '^\d{4}$'),
  CONSTRAINT invoice_seq_state_format CHECK (state_code ~ '^[A-Z]{2}$'),
  CONSTRAINT invoice_seq_non_negative CHECK (last_used_number >= 0)
);

ALTER TABLE public.invoice_number_sequences ENABLE ROW LEVEL SECURITY;

-- Service-role only (bypasses RLS via service_role JWT). No client policies.

COMMENT ON TABLE public.invoice_number_sequences IS
  'Per (financial_year, state_code) counter for GST invoice numbers. '
  'Mutated only via next_invoice_number() RPC, which holds an advisory '
  'transaction lock so concurrent calls serialise without gaps.';

-- ── 2. RPC: next_invoice_number ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.next_invoice_number(
  p_financial_year text,
  p_state_code     text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_next  integer;
  v_lock  bigint;
BEGIN
  -- ── Argument validation ────────────────────────────────────────────────
  IF p_financial_year IS NULL OR p_financial_year !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'p_financial_year must be 4 digits e.g. "2526" (got %)',
      p_financial_year USING ERRCODE = '22023';
  END IF;
  IF p_state_code IS NULL OR p_state_code !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'p_state_code must be 2 uppercase letters e.g. "MH" (got %)',
      p_state_code USING ERRCODE = '22023';
  END IF;

  -- ── Advisory lock (transaction-scoped) ────────────────────────────────
  -- Hash (year, state) into a single bigint key. Different (year, state)
  -- pairs lock independently, so concurrent invoices for different states
  -- or different fin-years do not block each other.
  v_lock := ('x' || substr(md5(p_financial_year || ':' || p_state_code), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock);

  -- ── Upsert + increment ────────────────────────────────────────────────
  INSERT INTO public.invoice_number_sequences (financial_year, state_code, last_used_number)
  VALUES (p_financial_year, p_state_code, 1)
  ON CONFLICT (financial_year, state_code)
  DO UPDATE SET
    last_used_number = invoice_number_sequences.last_used_number + 1,
    updated_at       = now()
  RETURNING last_used_number INTO v_next;

  RETURN v_next;
END;
$function$;

REVOKE ALL ON FUNCTION public.next_invoice_number(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(text, text) TO service_role;

COMMENT ON FUNCTION public.next_invoice_number(text, text) IS
  'Returns the next gap-free invoice number for (financial_year, state_code). '
  'Concurrency-safe via pg_advisory_xact_lock keyed by md5 of the inputs. '
  'Service-role only. CGST Rule 46 compliance.';

COMMIT;
