export const teacherDashboardActionNames = [
  'get_dashboard',
  'get_heatmap',
  'get_alerts',
  'resolve_alert',
  'launch_poll',
  'close_poll',
  'get_class_overview',
  'get_student_report',
  'get_class_trends',
  'get_trends',
  'get_students_list',
  'get_assignment_submissions',
  'get_grading_queue',
  'get_submission_detail',
  'mark_submission_reviewed',
  'get_grade_book',
  'set_grade_book_cell',
  'export_grade_book_csv',
  'get_student_mastery_report',
  'get_class_mastery_bloom_summary',
  'export_student_report',
  'get_lesson_plans',
  'set_lesson_plan',
  'get_in_the_moment_alerts',
  'deploy_intervention',
] as const

export type TeacherDashboardActionName = typeof teacherDashboardActionNames[number]

export interface TeacherDashboardActionInput {
  action: TeacherDashboardActionName
  teacher_id: string
  [key: string]: unknown
}

export interface TeacherDashboardActionOutput {
  success?: boolean
  error?: string
  [key: string]: unknown
}

export interface TeacherDashboardActionContract {
  readonly name: TeacherDashboardActionName
  readonly auditLabel: `teacher_dashboard.${TeacherDashboardActionName}`
  readonly metricLabel: `teacher_dashboard.${TeacherDashboardActionName}`
  readonly requiresJwtTeacherBinding: true
  readonly requiresTenantTeacherBinding: true
}

export const teacherDashboardActions: Record<TeacherDashboardActionName, TeacherDashboardActionContract> =
  Object.fromEntries(
    teacherDashboardActionNames.map((name) => [name, {
      name,
      auditLabel: `teacher_dashboard.${name}`,
      metricLabel: `teacher_dashboard.${name}`,
      requiresJwtTeacherBinding: true,
      requiresTenantTeacherBinding: true,
    }]),
  ) as Record<TeacherDashboardActionName, TeacherDashboardActionContract>
