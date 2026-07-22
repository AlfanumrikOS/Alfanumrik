-- Migration: 20260722094000_whatsapp_notify_register_adaptive_remediation_caller.sql
-- Purpose: Master Action Plan Phase 3 — register the 4th whatsapp-notify
--          internal caller so the 3 new adaptive-loop escalation WhatsApp
--          sends (remediation_escalated, reengagement_escalated,
--          concentration_escalated) are not rejected by the Platform
--          Security Layer once Meta templates are approved and the feature
--          flags (ff_adaptive_remediation_v1 / ff_adaptive_loops_bc_v1) are
--          flipped on.
--
-- ─── Context ─────────────────────────────────────────────────────────────
-- packages/lib/src/notification-triggers.ts defines:
--   const WHATSAPP_INTERNAL_CALLER = 'adaptive-remediation-whatsapp';
-- and passes it as the `caller` argument to buildInternalCallerHeaders(),
-- which sets the `x-internal-caller` header on every POST to
-- whatsapp-notify from onRemediationEscalated / onInactivityEscalated /
-- onConcentrationEscalated / onConcentrationReescalated (sendWhatsAppEscalation
-- helper). supabase/functions/_shared/security/auth.ts verifies that header
-- via security_resolve_internal_caller(p_caller_name), which looks up
-- security_internal_callers.name — so the registered `name` value here MUST
-- match that literal string exactly (case-sensitive), matched 1:1 against
-- the source, not guessed.
--
-- This migration follows the EXACT registration pattern established in
-- 20260620001500_whatsapp_notify_security_policy.sql for the 3 existing
-- whatsapp-notify callers (notifications-whatsapp-route,
-- school-admin-parents-route, synthesis-parent-share-route). Only step 3
-- (internal caller registration) is needed here — the quota profile
-- ('whatsapp-notify-internal_service') and the route policy for route
-- 'whatsapp-notify' were already seeded generically in that migration
-- (allow_signed_internal = true, internal_caller_id = NULL, i.e. it already
-- admits ANY active, signed internal_service caller on this route) and are
-- reused as-is, not re-seeded here.
--
-- This caller is a Next.js server-side lib module (not a route handler file
-- like the other 3), but it plays the identical role — a signed, service-role
-- Next.js-side caller reaching whatsapp-notify — so caller_kind stays
-- 'service_name' for consistency with the existing 3 rows.
--
-- No behavior change while ff_adaptive_remediation_v1 and
-- ff_adaptive_loops_bc_v1 remain OFF (constitution-pinned default) — the
-- call sites this unblocks are unreachable dead code paths until both flags
-- are flipped AND real Meta-approved template ids replace the current
-- placeholders in whatsapp-notify's TEMPLATES map.

INSERT INTO public.security_internal_callers (
  name, owner, description, status, caller_kind, quota_profile_id
)
SELECT
  'adaptive-remediation-whatsapp',
  'platform',
  'packages/lib/src/notification-triggers.ts sendWhatsAppEscalation() — WhatsApp channel for the 3 highest-stakes adaptive-loop parent escalations (remediation_escalated, reengagement_escalated, concentration_escalated), posting to whatsapp-notify',
  'active',
  'service_name',
  p.id
FROM public.security_quota_profiles p
WHERE p.name = 'whatsapp-notify-internal_service'
ON CONFLICT (name) DO UPDATE SET
  status      = EXCLUDED.status,
  description = EXCLUDED.description;
