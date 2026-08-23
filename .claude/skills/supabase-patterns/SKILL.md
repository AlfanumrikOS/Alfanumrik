---
name: supabase-patterns
description: Migration, RLS, RPC, and Edge Function patterns for the Alfanumrik Supabase database, plus the security and governance review checklist (SECURITY DEFINER, search_path, least privilege, forward-only migrations).
user-invocable: false
---

# Skill: Supabase Patterns

Patterns for working with the Alfanumrik Supabase database. Reference when writing migrations, RLS policies, RPCs, or Edge Functions.

**Owning agent**: architect (schema/RLS), backend (non-AI Edge Functions), ai-engineer (AI Edge Functions). Release timing and full-platform audits are not this skill's job -- see `release-gates` (per-change) and `alfanumrik-release-audit` (manual, full-platform) instead.

## Migration Template
```sql
-- Migration: YYYYMMDDHHMMSS_descriptive_name.sql
-- Purpose: [one sentence]

CREATE TABLE IF NOT EXISTS new_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS (mandatory for every new table, in the SAME migration file)
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "new_table_student_select" ON new_table
  FOR SELECT USING (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "new_table_student_insert" ON new_table
  FOR INSERT WITH CHECK (
    student_id IN (SELECT id FROM students WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "new_table_parent_select" ON new_table
  FOR SELECT USING (
    student_id IN (
      SELECT student_id FROM guardian_student_links
      WHERE guardian_id IN (SELECT id FROM guardians WHERE auth_user_id = auth.uid())
      AND status = 'approved'
    )
  );

CREATE INDEX IF NOT EXISTS idx_new_table_student ON new_table(student_id);
```

## RPC Template
```sql
CREATE OR REPLACE FUNCTION my_rpc_name(
  p_student_id UUID,
  p_param TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER  -- default; use DEFINER only with documented justification and a pinned search_path
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object('key', 'value') INTO v_result;
  RETURN v_result;
END;
$$;
```

## Edge Function Template (Deno)
```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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

  const { data, error } = await supabase.from("table").select("*");
  if (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

## Security & Governance Review

This is the checklist `release-gates` Gate 5b and `alfanumrik-release-audit` both defer to -- keep it here, don't let it re-spread into either of those.

- **Forward-only migrations.** Never rewrite an already-applied migration to "fix" it, even to make local setup pass -- write a new, forward migration instead. An applied migration is a historical fact, not a draft.
- **RLS and least privilege.** Every new table gets RLS enabled and policies in the same migration. Grants should be as narrow as the reading/writing role actually needs -- do not grant broader than the template above without a stated reason.
- **No undocumented schema/console drift.** A change made directly in the Supabase dashboard/console without a corresponding migration is invisible to every other environment and to this repo's history. If it must happen operationally, it needs a follow-up migration that codifies it, or it needs to be recorded in `docs/architecture/EXCEPTIONS.md` as a deliberate, dated exception.
- **Never expose the service-role key to client code.** `packages/lib/src/supabase-admin.ts` (bypasses RLS) is server-only -- never imported in client components. Client code uses `packages/lib/src/supabase.ts`; server components/middleware use `supabase-server.ts`.
- **Review every SECURITY DEFINER function for a pinned `search_path`.** A DEFINER function without an explicit `SET search_path` is a privilege-escalation risk (a caller could manipulate name resolution). Use INVOKER by default; DEFINER only with a documented reason and a pinned search_path, per the RPC template above.
- **Review RPC authorisation.** Every RPC that touches student/parent/teacher data verifies the caller owns the resource it's asked to touch (see the RPC template's ownership check) -- do not rely on the caller only being authenticated.
- **Evidence, not memory.** `docs/audits/FIX-LEDGER.md` documents concrete, previously-found instances of exactly these failure modes (RLS-bypassing grants, self-grant-capable policies, broad TRUNCATE grants, SECURITY DEFINER functions with no matching migration). Treat it as a worked example of what to look for -- do not copy its specific counts or findings into new work as if they were current; re-check the live state yourself.

## Checklist: Before Applying a Migration
- [ ] File is idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`) and forward-only (never edits a prior applied migration)
- [ ] New tables have RLS enabled, in the same migration
- [ ] RLS policies cover: student own, parent linked, teacher assigned (as applicable)
- [ ] Indexes on FK columns and frequently queried columns
- [ ] Grade columns are TEXT, not INTEGER
- [ ] Any SECURITY DEFINER function has a pinned `search_path` and a documented reason for DEFINER over INVOKER
- [ ] No DROP TABLE/COLUMN without user approval
- [ ] No service-role key referenced from client-importable code
- [ ] Tested mentally against the existing migration chain -- re-count it yourself (`git ls-files supabase/migrations | wc -l`) rather than quoting a remembered number
