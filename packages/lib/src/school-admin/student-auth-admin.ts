import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';

export interface CreateSchoolAdminStudentAuthUserInput {
  email: string;
  password: string;
  name: string;
  grade: string;
}

export async function createSchoolAdminStudentAuthUser(
  input: CreateSchoolAdminStudentAuthUserInput,
): Promise<{ ok: true; authUserId: string } | { ok: false; message: string }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      name: input.name,
      role: 'student',
      grade: input.grade,
    },
  });

  if (error || !data?.user?.id) {
    return { ok: false, message: error?.message ?? 'Failed to create auth user' };
  }

  return { ok: true, authUserId: data.user.id };
}
