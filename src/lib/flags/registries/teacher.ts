/**
 * Phase 3A — Teacher Command Center flags (2026-06-08).
 *
 *  ff_teacher_command_center  — master switch for the dense, desktop-first
 *    teacher home (the "Class Command Center"). Gates BOTH surfaces together:
 *      1. `/teacher` renders the Command Center (class switcher + roster mastery
 *         heatmap + at-risk alerts rail with one-tap "Assign remediation" +
 *         today summary + action bar) instead of the legacy tabbed dashboard.
 *      2. The teacher primary nav (TeacherShell) is slimmed to FIVE items
 *         (Command Center · Gradebook · Assignments · Messages · Reports);
 *         the remaining pages move to an account/overflow menu (routes stay
 *         reachable — no dead links).
 *    When OFF, BOTH surfaces are byte-identical to today: `/teacher` renders the
 *    existing dashboard and TeacherShell shows the existing full nav. Default:
 *    false. Read client-side via the existing client flag read path.
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF.
 *
 *  Spec/plan: docs/superpowers/{specs,plans}/2026-06-08-phase-3a-teacher-command-center*
 */
export const TEACHER_COMMAND_CENTER_FLAGS = {
  /** Dense desktop-first teacher home + slimmed 5-item nav. Default off. */
  V1: 'ff_teacher_command_center',
} as const;

/**
 * Phase 3A — Wave B (Assignment lifecycle) flag (2026-06-08).
 *
 *  ff_teacher_assignment_lifecycle — ADDITIONAL gate, layered ON TOP of
 *    `ff_teacher_command_center`, for the cross-assignment GRADING QUEUE inside
 *    the Command Center. When ON (and the Command Center is already rendering):
 *      1. The Command Center fetches the `get_grading_queue` teacher-dashboard
 *         Edge action and surfaces its `count` as a badge on the today-summary
 *         "N awaiting grading" tile.
 *      2. The action-bar "Grading queue" button becomes ENABLED (it is a
 *         disabled placeholder otherwise). Clicking it opens the dense,
 *         oldest-first grading queue surface (lazy-loaded — P10).
 *      3. A queue row one-taps through to the EXISTING /teacher/submissions
 *         review flow (get_submission_detail + mark_submission_reviewed); no
 *         new grading/scoring UI is built (P1/P2 untouched).
 *    When OFF, BOTH the queue surface and the enabled button are suppressed:
 *    the "Grading queue" button stays the disabled placeholder and the today
 *    summary behaves exactly as in Wave A. Default: false.
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF (and the queue is byte-identical-OFF).
 *
 *  Spec/plan: docs/superpowers/{specs,plans}/2026-06-08-phase-3a-wave-b-*
 */
export const TEACHER_ASSIGNMENT_LIFECYCLE_FLAGS = {
  /** Cross-assignment grading queue surface inside the Command Center. Default off. */
  V1: 'ff_teacher_assignment_lifecycle',
} as const;

/**
 * Phase 3A — Wave C (Gradebook + reporting depth) flag (2026-06-08).
 *
 *  ff_teacher_gradebook_depth — ADDITIONAL gate for the MASTERY + BLOOM'S
 *    reporting depth layered onto two existing teacher surfaces. When ON:
 *      1. Command Center heatmap cells / student rows become a DRILL-THROUGH:
 *         clicking one opens a lazy-loaded Student Mastery Report panel
 *         (`get_student_mastery_report`) — mastery by concept, the 6 Bloom's
 *         levels with per-level accuracy (weakest highlighted), and recent
 *         performance. The panel offers a "Download report" action that calls
 *         `export_student_report` and saves the parent-ready CSV.
 *      2. `/teacher/grade-book` surfaces a class mastery/Bloom depth view
 *         (`get_class_mastery_bloom_summary`) — weakest concepts first + the
 *         class's weakest Bloom's level — above the existing score matrix.
 *    When OFF, BOTH surfaces are byte-identical to today: the heatmap cell is a
 *    plain navigate-to-student link (no panel), and the gradebook is the score
 *    matrix only (no depth view, no Bloom). Default: false. Read client-side via
 *    the existing client flag read path (getFeatureFlags).
 *
 *    Bloom's level names (remember→understand→apply→analyze→evaluate→create) are
 *    technical terms — NOT translated even when isHi (P7 exception).
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF (and both surfaces stay byte-identical-OFF).
 *
 *  Spec/plan: docs/superpowers/{specs,plans}/2026-06-08-phase-3a-wave-c-*
 */
export const TEACHER_GRADEBOOK_DEPTH_FLAGS = {
  /** Mastery + Bloom's reporting depth (drill-through + class summary + export). Default off. */
  V1: 'ff_teacher_gradebook_depth',
} as const;

/**
 * Phase 3A — Wave D (Parent comms) flag (2026-06-08).
 *
 *  ff_teacher_parent_comms — ADDITIONAL gate, layered ON TOP of
 *    `ff_teacher_command_center`, for the one-tap "Tell the parent" affordance.
 *    When ON (and the Command Center is already rendering):
 *      1. An at-risk alert whose `remediation_status === 'resolved'` gains a
 *         one-tap "Tell the parent 🎉" button → POST /api/teacher/parent-notify
 *         { student_id, context:'remediation_resolved', remediation_id?,
 *         include_report:true }. It find-or-creates the teacher↔parent thread and
 *         sends a templated good-news message with an inline progress summary.
 *      2. The Wave C Student Mastery Report panel gains a "Share with parent"
 *         button → POST /api/teacher/parent-notify { student_id, context:'general',
 *         include_report:true }.
 *    Outcomes (bilingual toasts): 200 → "Parent notified ✓"; 409 `no_guardian` →
 *    "No parent linked for this student" (informational, not an error); other →
 *    friendly error. The button optimistically disables + shows a spinner and
 *    stays disabled after success (idempotent-safe). P13: no PII in client logs.
 *
 *    When OFF, NO "Tell the parent" / "Share with parent" affordance is rendered
 *    anywhere and NO parent-notify fetch is ever issued — the Command Center and
 *    the report panel stay byte-identical to Waves A–C. Default: false. Read
 *    client-side via the existing client flag read path (getFeatureFlags).
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both read
 *    paths resolve it to OFF (and both surfaces stay byte-identical-OFF).
 *
 *  Spec/plan: docs/superpowers/{specs,plans}/2026-06-08-phase-3a-wave-d-*
 */
export const TEACHER_PARENT_COMMS_FLAGS = {
  /** One-tap "Tell the parent" / "Share with parent" affordance. Default off. */
  V1: 'ff_teacher_parent_comms',
} as const;
