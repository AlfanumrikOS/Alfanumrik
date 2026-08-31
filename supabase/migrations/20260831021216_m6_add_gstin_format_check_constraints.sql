-- M6 (schema review finding): no CHECK constraint validated GSTIN format on any
-- of the 6 GSTIN columns across 5 tables. Verified live: every GSTIN value in
-- production is currently NULL (zero non-null rows across all 6 columns), so
-- this is unusually low-risk to add now, before the GST-invoicing feature
-- (still pre-launch) starts writing real data. One column
-- (school_gst_details.gstin) already has app-layer Zod validation with an
-- identical regex; the other five have none anywhere.
ALTER TABLE public.schools
  ADD CONSTRAINT schools_gstin_format_chk
  CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$');

ALTER TABLE public.school_gst_details
  ADD CONSTRAINT school_gst_details_gstin_format_chk
  CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$');

ALTER TABLE public.school_invoices
  ADD CONSTRAINT school_invoices_school_gstin_format_chk
  CHECK (school_gstin IS NULL OR school_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$'),
  ADD CONSTRAINT school_invoices_supplier_gstin_format_chk
  CHECK (supplier_gstin IS NULL OR supplier_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$');

ALTER TABLE public.student_subscriptions
  ADD CONSTRAINT student_subscriptions_supplier_gstin_format_chk
  CHECK (supplier_gstin IS NULL OR supplier_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$');

ALTER TABLE public.supplier_gstins
  ADD CONSTRAINT supplier_gstins_gstin_format_chk
  CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$');
