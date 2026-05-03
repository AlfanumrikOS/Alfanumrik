-- Migration: 20260416230000_phase3_audit_invoices_usage.sql
-- Purpose: Phase 3 tables — audit log, invoices, seat usage, alert rules
-- Applied via Supabase MCP on 2026-04-16

-- 1. School Audit Log
CREATE TABLE IF NOT EXISTS school_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  actor_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_school_time ON school_audit_log (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON school_audit_log (actor_id, created_at DESC);
ALTER TABLE school_audit_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "audit_log_service_role" ON school_audit_log FOR ALL USING (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "audit_log_admin_select" ON school_audit_log FOR SELECT TO authenticated USING (school_id = get_admin_school_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. School Invoices
CREATE TABLE IF NOT EXISTS school_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  seats_used INT NOT NULL,
  amount_inr NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'sent', 'paid', 'overdue')),
  pdf_url TEXT,
  razorpay_invoice_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_school ON school_invoices (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON school_invoices (status) WHERE status IN ('generated', 'sent', 'overdue');
ALTER TABLE school_invoices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "invoices_service_role" ON school_invoices FOR ALL USING (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "invoices_admin_select" ON school_invoices FOR SELECT TO authenticated USING (school_id = get_admin_school_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION update_school_invoices_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_school_invoices_updated_at ON school_invoices;
CREATE TRIGGER trg_school_invoices_updated_at BEFORE UPDATE ON school_invoices FOR EACH ROW EXECUTE FUNCTION update_school_invoices_updated_at();

-- 3. Seat Usage Snapshots
CREATE TABLE IF NOT EXISTS school_seat_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id),
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active_students INT NOT NULL DEFAULT 0,
  seats_purchased INT NOT NULL DEFAULT 0,
  utilization_pct NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(school_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_seat_usage_school_date ON school_seat_usage (school_id, snapshot_date DESC);
ALTER TABLE school_seat_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN CREATE POLICY "seat_usage_service_role" ON school_seat_usage FOR ALL USING (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "seat_usage_admin_select" ON school_seat_usage FOR SELECT TO authenticated USING (school_id = get_admin_school_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 4. Alert Rules
CREATE TABLE IF NOT EXISTS school_alert_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES schools(id),
  rule_type TEXT NOT NULL CHECK (rule_type IN ('error_rate', 'engagement_drop', 'payment_failure', 'ai_budget', 'seat_limit')),
  threshold NUMERIC NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE school_alert_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "alert_rules_service_role" ON school_alert_rules FOR ALL USING (auth.role() = 'service_role'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
