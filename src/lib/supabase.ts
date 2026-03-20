/* ═══ ROLE & CLASS RPCs (add to bottom of supabase.ts) ═══ */

/* ── Role detection ── */
export async function getUserRole(authUserId: string) {
  const { data, error } = await supabase.rpc('get_user_role', { p_auth_user_id: authUserId });
  if (error) console.error('getUserRole:', error.message);
  return data;
}

/* ── Teacher RPCs ── */
export async function getTeacherDashboard(teacherId: string) {
  const { data, error } = await supabase.rpc('get_teacher_dashboard', { p_teacher_id: teacherId });
  if (error) console.error('getTeacherDashboard:', error.message);
  return data;
}

export async function getClassDetail(classId: string) {
  const { data, error } = await supabase.rpc('get_class_detail', { p_class_id: classId });
  if (error) console.error('getClassDetail:', error.message);
  return data;
}

export async function teacherCreateClass(teacherId: string, name: string, grade: string, section?: string, subject?: string) {
  const { data, error } = await supabase.rpc('teacher_create_class', {
    p_teacher_id: teacherId, p_name: name, p_grade: grade, p_section: section ?? null, p_subject: subject ?? null,
  });
  if (error) throw error;
  return data;
}

export async function teacherCreateAssignment(
  teacherId: string, classId: string, title: string, type = 'practice',
  topicId?: string, subject?: string, dueDate?: string, questionCount = 10,
) {
  const { data, error } = await supabase.rpc('teacher_create_assignment', {
    p_teacher_id: teacherId, p_class_id: classId, p_title: title, p_type: type,
    p_topic_id: topicId ?? null, p_subject: subject ?? null,
    p_due_date: dueDate ?? null, p_question_count: questionCount,
  });
  if (error) throw error;
  return data;
}

export async function getAssignmentReport(assignmentId: string) {
  const { data, error } = await supabase.rpc('get_assignment_report', { p_assignment_id: assignmentId });
  if (error) console.error('getAssignmentReport:', error.message);
  return data;
}

/* ── Guardian/Parent RPCs ── */
export async function getGuardianDashboard(guardianId: string) {
  const { data, error } = await supabase.rpc('get_guardian_dashboard', { p_guardian_id: guardianId });
  if (error) console.error('getGuardianDashboard:', error.message);
  return data;
}

/* ── Student class RPCs ── */
export async function studentJoinClass(studentId: string, classCode: string) {
  const { data, error } = await supabase.rpc('student_join_class', {
    p_student_id: studentId, p_class_code: classCode,
  });
  if (error) throw error;
  return data;
}

/* ── Notification RPCs ── */
export async function getUnreadNotifications(recipientType: string, recipientId: string) {
  const { data, error } = await supabase.rpc('get_unread_notifications', {
    p_recipient_type: recipientType, p_recipient_id: recipientId,
  });
  if (error) console.error('getUnreadNotifications:', error.message);
  return data;
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: notificationId });
  if (error) console.error('markNotificationRead:', error.message);
}

/* ── Curriculum browser ── */
export async function getCurriculumBrowser(grade: string, subject?: string) {
  const { data, error } = await supabase.rpc('get_curriculum_browser', {
    p_grade: grade, p_subject: subject ?? null,
  });
  if (error) console.error('getCurriculumBrowser:', error.message);
  return data;
}

/* ── Mastery overview ── */
export async function getMasteryOverview(studentId: string, subject?: string) {
  const { data, error } = await supabase.rpc('get_mastery_overview', {
    p_student_id: studentId, p_subject: subject ?? null,
  });
  if (error) console.error('getMasteryOverview:', error.message);
  return data;
}

/* ── Record learning event ── */
export async function recordLearningEvent(
  studentId: string, topicId: string, isCorrect: boolean,
  interactionType = 'practice', bloomLevel?: string,
) {
  const { data, error } = await supabase.rpc('record_learning_event', {
    p_student_id: studentId, p_topic_id: topicId, p_is_correct: isCorrect,
    p_interaction_type: interactionType, p_bloom_level: bloomLevel ?? null,
  });
  if (error) console.error('recordLearningEvent:', error.message);
  return data;
}
