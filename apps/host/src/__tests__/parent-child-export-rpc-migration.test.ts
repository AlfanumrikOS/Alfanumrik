import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const routePath = path.join(repoRoot, 'apps/host/src/app/api/parent/children/[student_id]/export/route.ts');
const migrationPath = path.join(
  repoRoot,
  'supabase/migrations/20260710060000_xc3_parent_child_export_scoped_rpc.sql',
);

describe('XC-3 parent child export data aggregation migration', () => {
  it('routes DPDP export table aggregation through a request-scoped authenticated RPC', () => {
    const source = readFileSync(routePath, 'utf8');

    expect(source).toContain('createRlsScopedClient(request)');
    expect(source).toContain("rpc('parent_child_export_data'");
    expect(source).not.toContain('for (const spec of TABLE_SPECS)');
    expect(source).not.toContain('.from(spec.table)');
    expect(source).toContain("rpc('parent_publish_child_state_event'");
    expect(source).not.toContain('publishEvent(supabaseAdmin');
    expect(source).not.toContain('@alfanumrik/lib/supabase-admin');
    expect(source).not.toContain('@alfanumrik/lib/state/events/publish');
  });

  it('defines a SECURITY DEFINER helper bound to auth.uid() guardian ownership', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.parent_child_export_data');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = public');
    expect(sql).toContain('auth.uid()');
    expect(sql).toContain('guardians');
    expect(sql).toContain('guardian_student_links');
    expect(sql).toContain("gsl.status IN ('active', 'approved')");
    expect(sql).toContain('student_subscriptions');
    expect(sql).toContain('student_learning_profiles');
    expect(sql).toContain('quiz_sessions');
    expect(sql).toContain('quiz_responses');
    expect(sql).toContain('foxy_chat_messages');
    expect(sql).toContain('score_history');
    expect(sql).toContain('assignment_submissions');
    expect(sql).toContain('notifications');
    expect(sql).toContain("recipient_type = 'student'");
    expect(sql).toContain('audit_logs');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.parent_child_export_data');
    expect(sql).toContain('FROM anon');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.parent_child_export_data');
    expect(sql).toContain('TO authenticated');
  });
});
