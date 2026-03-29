---
name: supabase-patterns
description: Migration, RLS, RPC, and Edge Function patterns for the Alfanumrik Supabase database.
user-invocable: false
---

# Skill: Supabase Patterns

Patterns for working with the Alfanumrik Supabase database. Reference when writing migrations, RLS policies, RPCs, or Edge Functions.

**Owning agent**: architect (schema/RLS), backend (non-AI Edge Functions), ai-engineer (AI Edge Functions).

## Migration Template
```sql
-- Migration: YYYYMMDDHHMMSS_descriptive_name.sql
-- Purpose: [one sentence]

-- Tables
CREATE TABLE IF NOT EXISTS new_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS (mandatory for every new table)
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- Student reads own
CREATE POLICY "new_table_student_select" ON new_table
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Student inserts own
CREATE POLICY "new_table_student_insert" ON new_table
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

-- Parent reads linked child
CREATE POLICY "new_table_parent_select" ON new_table
  FOR SELECT USING (
    student_id IN (
      SELECT student_id FROM guardian_student_links
      WHERE guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
      AND status = 'approved'
    )
  );

-- Teacher reads assigned class
CREATE POLICY "new_table_teacher_select" ON new_table
  FOR SELECT USING (
    student_id IN (
      SELECT student_id FROM class_enrollments
      WHERE class_id IN (
        SELECT id FROM classes WHERE teacher_id IN (
          SELECT id FROM teachers WHERE auth_user_id = auth.uid()
        )
      )
    )
  );

-- Indexes (on columns used in WHERE/JOIN/ORDER BY)
CREATE INDEX IF NOT EXISTS idx_new_table_student ON new_table(student_id);
CREATE INDEX IF NOT EXISTS idx_new_table_created ON new_table(created_at);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_new_table_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_new_table_updated_at ON new_table;
CREATE TRIGGER trg_new_table_updated_at BEFORE UPDATE ON new_table
  FOR EACH ROW EXECUTE FUNCTION update_new_table_updated_at();
```

## RPC Template
```sql
CREATE OR REPLACE FUNCTION my_rpc_name(
  p_student_id UUID,
  p_param TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER  -- default; use DEFINER only with documented justification
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Verify caller owns this student
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Business logic here
  SELECT jsonb_build_object('key', 'value') INTO v_result;

  RETURN v_result;
END;
$$;
```

## Edge Function Template (Deno)
```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Business logic
    const { data, error } = await supabase.from("table").select("*");
    if (error) throw error;

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
```

## Checklist: Before Applying a Migration
- [ ] File is idempotent (IF NOT EXISTS, CREATE OR REPLACE)
- [ ] New tables have RLS enabled
- [ ] RLS policies cover: student own, parent linked, teacher assigned
- [ ] Indexes on FK columns and frequently queried columns
- [ ] Grade columns are TEXT, not INTEGER
- [ ] No DROP TABLE/COLUMN without user approval
- [ ] Tested mentally against the 160+ existing migration chain
