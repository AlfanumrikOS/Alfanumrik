-- A-08: Scope service/admin policies to service_role instead of {public}
-- Priority: fix policies with USING/WITH CHECK = 'true' (no inline role check — genuinely open to anon)

-- 1. admin_audit_log: audit_service_insert
DROP POLICY IF EXISTS audit_service_insert ON public.admin_audit_log;
CREATE POLICY audit_service_insert ON public.admin_audit_log
  FOR INSERT TO service_role WITH CHECK (true);

-- 2. ai_governance_log: aigl_service_insert
DROP POLICY IF EXISTS aigl_service_insert ON public.ai_governance_log;
CREATE POLICY aigl_service_insert ON public.ai_governance_log
  FOR INSERT TO service_role WITH CHECK (true);

-- 3. guardian_student_links: gsl_service_write (CRITICAL — anyone could create guardian links)
DROP POLICY IF EXISTS gsl_service_write ON public.guardian_student_links;
CREATE POLICY gsl_service_write ON public.guardian_student_links
  FOR INSERT TO service_role WITH CHECK (true);

-- 4. ncert_book_catalog: ncert_catalog_service (ALL with USING=true — fully open)
DROP POLICY IF EXISTS ncert_catalog_service ON public.ncert_book_catalog;
CREATE POLICY ncert_catalog_service ON public.ncert_book_catalog
  FOR ALL TO service_role USING (true);

-- 5. interactive_simulations: sim_insert_admin
DROP POLICY IF EXISTS sim_insert_admin ON public.interactive_simulations;
CREATE POLICY sim_insert_admin ON public.interactive_simulations
  FOR INSERT TO service_role WITH CHECK (true);

-- 6. class_enrollments: class_enrollments_service_role (has inline check but scoped to public)
DROP POLICY IF EXISTS class_enrollments_service_role ON public.class_enrollments;
CREATE POLICY class_enrollments_service_role ON public.class_enrollments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. school_announcements: announcements_service_role
DROP POLICY IF EXISTS announcements_service_role ON public.school_announcements;
CREATE POLICY announcements_service_role ON public.school_announcements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. school_api_keys: school_api_keys_service_role
DROP POLICY IF EXISTS school_api_keys_service_role ON public.school_api_keys;
CREATE POLICY school_api_keys_service_role ON public.school_api_keys
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 9. school_questions: school_questions_service_role
DROP POLICY IF EXISTS school_questions_service_role ON public.school_questions;
CREATE POLICY school_questions_service_role ON public.school_questions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 10. school_exams: school_exams_service_role
DROP POLICY IF EXISTS school_exams_service_role ON public.school_exams;
CREATE POLICY school_exams_service_role ON public.school_exams
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 11. school_audit_log: audit_log_service_role
DROP POLICY IF EXISTS audit_log_service_role ON public.school_audit_log;
CREATE POLICY audit_log_service_role ON public.school_audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 12. school_invoices: invoices_service_role
DROP POLICY IF EXISTS invoices_service_role ON public.school_invoices;
CREATE POLICY invoices_service_role ON public.school_invoices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 13. school_seat_usage: seat_usage_service_role
DROP POLICY IF EXISTS seat_usage_service_role ON public.school_seat_usage;
CREATE POLICY seat_usage_service_role ON public.school_seat_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 14. school_alert_rules: alert_rules_service_role
DROP POLICY IF EXISTS alert_rules_service_role ON public.school_alert_rules;
CREATE POLICY alert_rules_service_role ON public.school_alert_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 15. coverage_audit_snapshots: coverage_audit_snapshots_write_service
DROP POLICY IF EXISTS coverage_audit_snapshots_write_service ON public.coverage_audit_snapshots;
CREATE POLICY coverage_audit_snapshots_write_service ON public.coverage_audit_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 16. grounded_ai_traces: grounded_traces_insert_service
DROP POLICY IF EXISTS grounded_traces_insert_service ON public.grounded_ai_traces;
CREATE POLICY grounded_traces_insert_service ON public.grounded_ai_traces
  FOR INSERT TO service_role WITH CHECK (true);
