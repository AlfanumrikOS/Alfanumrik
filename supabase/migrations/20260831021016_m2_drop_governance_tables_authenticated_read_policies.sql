-- M2 (schema review finding): 8 internal ops/compliance/governance tables from
-- the 2026-08-06 audit-remediation migration wave were given `authenticated`-
-- wide SELECT policies (USING (true)) with no legitimate app consumer. Verified
-- via repo-wide grep: zero routes/components/lib files read any of these 8
-- tables under the authenticated role (only the generated database.types.ts
-- references them). Each table already has its own service_role-only
-- `FOR ALL` policy, so dropping these leaves them correctly service-role-only.
-- data_classification in particular is a PII/sensitivity map (which columns
-- are direct identifiers, financial, require consent propagation, etc.) —
-- exactly the kind of internal artifact that should never be readable by a
-- student or parent account.
DROP POLICY IF EXISTS "Authenticated can read classification"     ON public.data_classification;
DROP POLICY IF EXISTS "Authenticated can read processing purposes" ON public.data_processing_purposes;
DROP POLICY IF EXISTS "Authenticated can read quality results"     ON public.data_quality_check_results;
DROP POLICY IF EXISTS "Authenticated can read metric contracts"    ON public.kpi_metric_contracts;
DROP POLICY IF EXISTS "Authenticated can read source_of_truth"     ON public.source_of_truth_registry;
DROP POLICY IF EXISTS "Authenticated can read baselines"            ON public.table_row_count_baselines;
DROP POLICY IF EXISTS "Authenticated can read drill log"            ON public.restore_drill_log;
DROP POLICY IF EXISTS "Authenticated can read freshness log"        ON public.analytics_freshness_log;
