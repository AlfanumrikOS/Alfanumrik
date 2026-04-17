import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Validates that the admin has an active impersonation session for the given student.
 * An active session has: ended_at IS NULL and expires_at > now().
 */
export async function validateImpersonationSession(
  adminId: string,
  studentId: string
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('admin_impersonation_sessions')
    .select('id')
    .eq('admin_id', adminId)
    .eq('student_id', studentId)
    .is('ended_at', null)
    .gt('expires_at', new Date().toISOString())
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Records a page view on the active impersonation session (fire-and-forget).
 * Appends the page to pages_viewed if not already present.
 */
export async function recordPageView(
  adminId: string,
  studentId: string,
  page: string
): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from('admin_impersonation_sessions')
      .select('id, pages_viewed')
      .eq('admin_id', adminId)
      .eq('student_id', studentId)
      .is('ended_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('started_at', { ascending: false })
      .limit(1);

    const session = data?.[0];
    if (session && !session.pages_viewed.includes(page)) {
      await supabaseAdmin
        .from('admin_impersonation_sessions')
        .update({ pages_viewed: [...session.pages_viewed, page] })
        .eq('id', session.id);
    }
  } catch {
    // Fire-and-forget — don't let page view tracking break the main flow
  }
}
