import 'package:flutter/material.dart';

/// Bilingual display config for one notification `type`.
///
/// Faithful port of the web's `TYPE_CONFIG` map in
/// `apps/host/src/app/notifications/page.tsx` — keep this in sync with that
/// file whenever a type is added/edited there. Colors are the closest
/// `Color` equivalent of the web's hex/CSS-var values.
class NotificationTypeConfig {
  final String icon;
  final Color color;
  final String label;
  final String labelHi;

  const NotificationTypeConfig({
    required this.icon,
    required this.color,
    required this.label,
    required this.labelHi,
  });
}

/// Fallback for any `type` not (yet) in [kNotificationTypeConfig]. Mirrors
/// the web's inline fallback
/// (`{ icon: '📌', color: 'var(--text-3)', label: 'Update', labelHi: 'अपडेट' }`).
///
/// This is the graceful-degradation contract: new notification types are
/// added to the web registry over time (e.g. `prerequisite_blocked` /
/// `prerequisite_resolved` for the not-yet-launched Digital Twin feature),
/// and OLD INSTALLED APKs must never crash when they encounter one they
/// don't recognize yet — they show this generic "Update" card instead.
const NotificationTypeConfig kNotificationTypeFallback =
    NotificationTypeConfig(
  icon: '📌',
  color: Color(0xFF756B63), // AppColors.textTertiary — closest to --text-3
  label: 'Update',
  labelHi: 'अपडेट',
);

/// Port of the web `TYPE_CONFIG` map (`apps/host/src/app/notifications/page.tsx`).
const Map<String, NotificationTypeConfig> kNotificationTypeConfig =
    <String, NotificationTypeConfig>{
  'streak_risk': NotificationTypeConfig(
      icon: '🔥', color: Color(0xFFDC2626), label: 'Streak Alert', labelHi: 'स्ट्रीक अलर्ट'),
  'streak_milestone': NotificationTypeConfig(
      icon: '🔥', color: Color(0xFFF5A623), label: 'Streak', labelHi: 'स्ट्रीक'),
  'review_due': NotificationTypeConfig(
      icon: '🔄', color: Color(0xFF0891B2), label: 'Review', labelHi: 'रिव्यू'),
  'rank_update': NotificationTypeConfig(
      icon: '📊', color: Color(0xFF7C3AED), label: 'Rank', labelHi: 'रैंक'),
  'competition_live': NotificationTypeConfig(
      icon: '🏆', color: Color(0xFF16A34A), label: 'Competition', labelHi: 'प्रतियोगिता'),
  'daily_progress': NotificationTypeConfig(
      icon: '🎯', color: Color(0xFFE8581C), label: 'Daily Goal', labelHi: 'दैनिक लक्ष्य'),
  'plan_reminder': NotificationTypeConfig(
      icon: '📅', color: Color(0xFF7C3AED), label: 'Study Plan', labelHi: 'अध्ययन योजना'),
  'foxy_motivation': NotificationTypeConfig(
      icon: '🦊', color: Color(0xFFE8581C), label: 'Foxy', labelHi: 'फॉक्सी'),
  'xp_milestone': NotificationTypeConfig(
      icon: '⭐', color: Color(0xFFF5A623), label: 'Milestone', labelHi: 'उपलब्धि'),
  'parent_daily_report': NotificationTypeConfig(
      icon: '👨‍👩‍👧', color: Color(0xFF16A34A), label: 'Parent', labelHi: 'अभिभावक'),
  // Parent → child "cheer" (Wave D, ff_parent_encourage_v1). The per-cheer
  // emoji comes from data.icon (cheer-catalog preset) — see
  // [NotificationItem.dataIcon]; this is just the type label + accent color.
  'parent_cheer': NotificationTypeConfig(
      icon: '👏', color: Color(0xFFEC4899), label: 'From Family', labelHi: 'परिवार से'),
  'achievement': NotificationTypeConfig(
      icon: '🏅', color: Color(0xFFF5A623), label: 'Achievement', labelHi: 'उपलब्धि'),
  'quiz_result': NotificationTypeConfig(
      icon: '⚡', color: Color(0xFFD97706), label: 'Quiz', labelHi: 'क्विज़'),
  // Phase A Loop A — adaptive remediation (En in title/body; Hindi rides
  // data.title_hi / data.body_hi per the house pattern).
  'remediation_assigned': NotificationTypeConfig(
      icon: '🦊', color: Color(0xFFE8581C), label: 'Extra Practice', labelHi: 'अतिरिक्त अभ्यास'),
  'remediation_recovered': NotificationTypeConfig(
      icon: '🎉', color: Color(0xFF16A34A), label: 'Comeback', labelHi: 'वापसी'),
  'remediation_escalated': NotificationTypeConfig(
      icon: '🤝', color: Color(0xFFF59E0B), label: 'Extra Help', labelHi: 'अतिरिक्त मदद'),
  // Phase A Loop B — inactivity / re-engagement.
  'reengagement_nudge': NotificationTypeConfig(
      icon: '👋', color: Color(0xFF7C3AED), label: 'Come Back', labelHi: 'वापस आओ'),
  'reengagement_returned': NotificationTypeConfig(
      icon: '🎉', color: Color(0xFF16A34A), label: 'Welcome Back', labelHi: 'वापसी'),
  'reengagement_escalated': NotificationTypeConfig(
      icon: '🏠', color: Color(0xFFF59E0B), label: 'Family Alert', labelHi: 'परिवार अलर्ट'),
  // Phase A Loop C — at-risk concentration (subject-level escalation).
  'concentration_escalated': NotificationTypeConfig(
      icon: '🆘', color: Color(0xFFDC2626), label: 'Subject At Risk', labelHi: 'विषय जोखिम में'),
  'concentration_resolved': NotificationTypeConfig(
      icon: '🎉', color: Color(0xFF16A34A), label: 'Back on Track', labelHi: 'फिर पटरी पर'),
  'concentration_reescalated': NotificationTypeConfig(
      icon: '🔁', color: Color(0xFFDC2626), label: 'Still At Risk', labelHi: 'अब भी जोखिम में'),
  // First-quiz nudge — sent by daily-cron to students who completed
  // onboarding but never took a quiz. Deep-link: /diagnostic.
  'first_quiz_nudge': NotificationTypeConfig(
      icon: '🚀', color: Color(0xFFE8581C), label: 'Get Started', labelHi: 'शुरू करो'),
  // Loop B engagement — streak about to break (daily-cron early warning).
  'streak_at_risk': NotificationTypeConfig(
      icon: '🔥', color: Color(0xFFEF4444), label: 'Streak at Risk', labelHi: 'स्ट्रीक खतरे में'),
  // Loop D — blocked-prerequisite (Digital Twin + Knowledge Graph Slice 1,
  // ff_digital_twin_v1). Frontend readiness only — the flag is still OFF.
  'prerequisite_blocked': NotificationTypeConfig(
      icon: '🔗', color: Color(0xFFF59E0B), label: 'Foundation Boost', labelHi: 'नींव अभ्यास'),
  'prerequisite_resolved': NotificationTypeConfig(
      icon: '✅', color: Color(0xFF16A34A), label: 'Foundation Ready', labelHi: 'नींव तैयार'),
};

/// Look up config for [type], degrading gracefully to
/// [kNotificationTypeFallback] for anything not (yet) ported. MUST NEVER
/// throw — see [kNotificationTypeFallback] doc for why.
NotificationTypeConfig typeConfigFor(String type) =>
    kNotificationTypeConfig[type] ?? kNotificationTypeFallback;
