-- CMS media storage bucket + policies
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cms-media', 'cms-media', true, 10485760, ARRAY['image/png','image/jpeg','image/svg+xml','image/webp','application/pdf'])
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "Admin upload cms media" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'cms-media' AND EXISTS (SELECT 1 FROM public.admin_users WHERE auth_user_id = auth.uid() AND is_active = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Public read cms media" ON storage.objects
    FOR SELECT TO public USING (bucket_id = 'cms-media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Admin delete cms media" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'cms-media' AND EXISTS (SELECT 1 FROM public.admin_users WHERE auth_user_id = auth.uid() AND is_active = true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
