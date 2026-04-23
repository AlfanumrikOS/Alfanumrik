-- Migration: 20260416220000_school_invoices_seat_usage.sql
-- Purpose: Add school_invoices and school_seat_usage tables for B2B billing automation

-- ─── 1. school_invoices ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS school_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  period_start        DATE NOT NULL,
  period_end          DATE NOT NULL,
  seats_used          INTEGER NOT NULL DEFAULT 0,
  amount_inr          NUMERIC(12,2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'generated'
                        CHECK (status IN ('generated', 'sent', 'paid', 'overdue')),
  pdf_url             TEXT,
  razorpay_invoice_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate invoices for the same school + period
  CONSTRAINT uq_school_invoice_period UNIQUE (school_id, period_start, period_end)
);

-- RLS
ALTER TABLE school_invoices ENABLE ROW LEVEL SECURITY;

-- Super admin (service role) has full access via supabase-admin client.
-- School admins can read their own school's invoices via RLS.
CREATE POLICY "school_invoices_school_admin_select" ON school_invoices
  FOR SELECT USING (
    school_id IN (
      SELECT school_id FROM school_admins
      WHERE auth_user_id = auth.uid()
      AND is_active = true
    )
  );

-- Service role bypass is automatic with supabase-admin.
-- No INSERT/UPDATE/DELETE policies for anon/authenticated — mutations go through service role only.

-- Indexes
CREATE INDEX IF NOT EXISTS idx_school_invoices_school ON school_invoices(school_id);
CREATE INDEX IF NOT EXISTS idx_school_invoices_status ON school_invoices(status);
CREATE INDEX IF NOT EXISTS idx_school_invoices_period ON school_invoices(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_school_invoices_created ON school_invoices(created_at);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_school_invoices_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_school_invoices_updated_at ON school_invoices;
CREATE TRIGGER trg_school_invoices_updated_at BEFORE UPDATE ON school_invoices
  FOR EACH ROW EXECUTE FUNCTION update_school_invoices_updated_at();


-- ─── 2. school_seat_usage ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS school_seat_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  snapshot_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  active_students   INTEGER NOT NULL DEFAULT 0,
  seats_purchased   INTEGER NOT NULL DEFAULT 0,
  utilization_pct   INTEGER NOT NULL DEFAULT 0,

  -- One snapshot per school per day (idempotent upsert target)
  CONSTRAINT uq_school_seat_usage_daily UNIQUE (school_id, snapshot_date)
);

-- RLS
ALTER TABLE school_seat_usage ENABLE ROW LEVEL SECURITY;

-- School admins can read their own school's seat usage
CREATE POLICY "school_seat_usage_school_admin_select" ON school_seat_usage
  FOR SELECT USING (
    school_id IN (
      SELECT school_id FROM school_admins
      WHERE auth_user_id = auth.uid()
      AND is_active = true
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_school_seat_usage_school ON school_seat_usage(school_id);
CREATE INDEX IF NOT EXISTS idx_school_seat_usage_date ON school_seat_usage(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_school_seat_usage_school_date ON school_seat_usage(school_id, snapshot_date);
