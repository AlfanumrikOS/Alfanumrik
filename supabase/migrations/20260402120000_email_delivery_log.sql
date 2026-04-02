-- ============================================================================
-- Migration: 20260402120000_email_delivery_log.sql
-- Purpose: Create email_delivery_log table for Mailgun webhook events.
--          Provides observability into auth email delivery/bounce/complaints.
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_email TEXT NOT NULL,
  message_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT,
  reason TEXT,
  delivery_status_code TEXT,
  delivery_status_message TEXT,
  raw_event JSONB DEFAULT '{}',
  mailgun_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE email_delivery_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_delivery_log_service_role" ON email_delivery_log;
CREATE POLICY "email_delivery_log_service_role" ON email_delivery_log
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_recipient ON email_delivery_log(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_delivery_log_status ON email_delivery_log(status);
CREATE INDEX IF NOT EXISTS idx_email_delivery_log_created ON email_delivery_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_delivery_log_event ON email_delivery_log(event_type);
