-- Migration: 20260507150001_contract_number_sequences.sql
-- Purpose: Per (financial_year, state_code) sequence for school_contracts.
--          contract_number, mirroring invoice_number_sequences from P3-A.
--
-- Contract numbers do NOT have the same legal "no gaps" requirement as GST
-- invoice numbers (CGST Rule 46), but consistency with the invoice pattern
-- keeps the codebase predictable and lets us reuse the advisory-lock idiom.
--
-- Phase 3-C of the May 2026 upgrade.
--
-- DOWN (manual):
--   DROP FUNCTION public.next_contract_number(text, text);
--   DROP TABLE public.contract_number_sequences;

BEGIN;

CREATE TABLE IF NOT EXISTS public.contract_number_sequences (
  financial_year   text NOT NULL,
  state_code       text NOT NULL,
  last_used_number integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (financial_year, state_code),
  CONSTRAINT contract_seq_year_format CHECK (financial_year ~ '^\d{4}$'),
  CONSTRAINT contract_seq_state_format CHECK (state_code ~ '^[A-Z]{2}$'),
  CONSTRAINT contract_seq_non_negative CHECK (last_used_number >= 0)
);

ALTER TABLE public.contract_number_sequences ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_contract_number(
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
  IF p_financial_year IS NULL OR p_financial_year !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'p_financial_year must be 4 digits e.g. "2526" (got %)',
      p_financial_year USING ERRCODE = '22023';
  END IF;
  IF p_state_code IS NULL OR p_state_code !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'p_state_code must be 2 uppercase letters e.g. "MH" (got %)',
      p_state_code USING ERRCODE = '22023';
  END IF;

  -- Distinct lock domain from invoice numbers (different prefix in the md5).
  v_lock := ('x' || substr(md5('contract:' || p_financial_year || ':' || p_state_code), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock);

  INSERT INTO public.contract_number_sequences (financial_year, state_code, last_used_number)
  VALUES (p_financial_year, p_state_code, 1)
  ON CONFLICT (financial_year, state_code)
  DO UPDATE SET
    last_used_number = contract_number_sequences.last_used_number + 1,
    updated_at       = now()
  RETURNING last_used_number INTO v_next;

  RETURN v_next;
END;
$function$;

REVOKE ALL ON FUNCTION public.next_contract_number(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_contract_number(text, text) TO service_role;

COMMENT ON FUNCTION public.next_contract_number(text, text) IS
  'Returns the next contract number for (financial_year, state_code). '
  'Concurrency-safe via pg_advisory_xact_lock keyed by md5("contract:" + inputs). '
  'Service-role only. Phase 3-C.';

COMMIT;
