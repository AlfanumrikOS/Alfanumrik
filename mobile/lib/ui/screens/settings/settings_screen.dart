import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/experience_provider.dart';
import '../../../providers/subscription_provider.dart';
import '../../widgets/notification_badge.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final student = ref.watch(studentProvider).valueOrNull;
    final subscription = ref.watch(subscriptionProvider).valueOrNull;
    final experience = ref.watch(oneExperienceProvider).valueOrNull;
    final oneExperience = ref.watch(oneExperienceRuntimeEnabledProvider);
    bool allows(String capability) =>
        experience?.allowsCapability(capability) == true;
    // Device-locale Hindi detection — matches today_screen / quiz_screen until
    // an app-wide toggle ships.
    final isHi = Localizations.localeOf(context).languageCode == 'hi';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Profile card
          if (student != null)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: AppColors.borderLight),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: AppColors.primary.withValues(alpha: 0.1),
                    child: Text(
                      student.name.isNotEmpty
                          ? student.name[0].toUpperCase()
                          : 'S',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          student.name,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        Text(
                          'Class ${student.gradeNumber} · ${student.board}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.textTertiary,
                          ),
                        ),
                        if (student.email != null)
                          Text(
                            student.email!,
                            style: const TextStyle(
                              fontSize: 11,
                              color: AppColors.textTertiary,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

          const SizedBox(height: 16),

          // V2 destinations require the server-enabled assignment and their
          // filtered manifest capabilities. Explicit legacy retains the
          // historical Settings screen without this group.
          if (oneExperience &&
              allows('shared.settings') &&
              (allows('student.foxy') ||
                  allows('student.progress') ||
                  allows('student.rewards') ||
                  allows('student.learn'))) ...[
            _SettingsGroup(
              title: isHi ? 'मेरी सीख' : 'My Learning',
              children: [
                if (allows('student.foxy'))
                  _SettingsTile(
                    icon: Icons.chat_bubble_outline_rounded,
                    title: isHi ? 'फॉक्सी से पूछें' : 'Ask Foxy',
                    subtitle: isHi
                        ? 'अपने सीखने के संदर्भ में सहायता पाएँ'
                        : 'Get help in your learning context',
                    onTap: () => context.go('/chat'),
                  ),
                if (allows('student.progress'))
                  _SettingsTile(
                    icon: Icons.insights_rounded,
                    title: isHi ? 'प्रगति' : 'Progress',
                    subtitle: isHi
                        ? 'स्कोर, महारत और ज्ञान अंतराल'
                        : 'Scores, mastery & knowledge gaps',
                    onTap: () => context.go('/progress'),
                  ),
                if (allows('student.rewards'))
                  _SettingsTile(
                    icon: Icons.leaderboard_rounded,
                    title: isHi ? 'लीडरबोर्ड' : 'Leaderboard',
                    subtitle: isHi ? 'देखें आप कहाँ हैं' : 'See where you rank',
                    onTap: () => context.go('/leaderboard'),
                  ),
                if (allows('student.learn'))
                  _SettingsTile(
                    icon: Icons.science_outlined,
                    title: isHi ? 'STEM लैब' : 'STEM Lab',
                    subtitle: isHi
                        ? 'इंटरैक्टिव प्रयोग और सिमुलेशन'
                        : 'Interactive experiments and simulations',
                    onTap: () => context.push('/stem-lab'),
                  ),
              ],
            ),
            const SizedBox(height: 12),
          ],

          // Practice & Prep — the mobile "More" hub is the app's equivalent of
          // the web Study Menu / bottom-nav "More" sheet. These practice
          // surfaces were registered in the router (Phase 6) but had no
          // user-facing entry point; grouping them here makes them discoverable
          // in BOTH the legacy 5-tab and the v2 "More" nav (the routes are
          // registered unconditionally, so both modes can reach them). All are
          // full-screen routes → context.push, matching Library / Assignments /
          // STEM Lab above.
          _SettingsGroup(
            title: isHi ? 'अभ्यास और तैयारी' : 'Practice & Prep',
            children: [
              _SettingsTile(
                icon: Icons.electric_bolt_outlined,
                title: isHi ? 'डेली चैलेंज' : 'Daily Challenge',
                subtitle: isHi
                    ? 'कॉन्सेप्ट चेन — रोज़ का दिमागी स्ट्रीक'
                    : 'Concept Chain — your daily brain streak',
                onTap: () => context.push('/challenge'),
              ),
              _SettingsTile(
                icon: Icons.history_edu_outlined,
                title: isHi ? 'पिछले वर्ष के प्रश्न' : 'Previous Year Questions',
                subtitle: isHi
                    ? 'बोर्ड परीक्षा के असली सवालों से अभ्यास'
                    : 'Practice real board-exam questions',
                onTap: () => context.push('/pyq'),
              ),
              _SettingsTile(
                icon: Icons.autorenew_rounded,
                title: isHi ? 'रिफ्रेश और रिवीज़न' : 'Refresh & Revise',
                subtitle: isHi
                    ? 'क्विक रिकॉल और रिटेंशन टेस्ट'
                    : 'Quick recall & retention tests',
                onTap: () => context.push('/refresh'),
              ),
              _SettingsTile(
                icon: Icons.timer_outlined,
                title: isHi ? 'मॉक टेस्ट' : 'Mock Tests',
                subtitle: isHi
                    ? 'समयबद्ध पूर्ण-लंबाई परीक्षा अभ्यास'
                    : 'Timed full-length exam practice',
                onTap: () => context.push('/exams'),
              ),
              _SettingsTile(
                icon: Icons.document_scanner_outlined,
                title: isHi ? 'स्कैन और हल करें' : 'Scan & Solve',
                subtitle: isHi
                    ? 'सवाल की फोटो लो, हल किया हुआ उत्तर पाओ'
                    : 'Snap a question, get a worked solution',
                onTap: () => context.push('/scan'),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // Progress & Reports — reflection / report surfaces that logically sit
          // near Progress. Kept in the "More" hub so they stay reachable in the
          // legacy nav too (which has no Progress tab); the v2 Today queue also
          // deep-links Weekly Dive / Monthly Synthesis directly (see
          // today_deeplink.dart).
          _SettingsGroup(
            title: isHi ? 'प्रगति और रिपोर्ट' : 'Progress & Reports',
            children: [
              _SettingsTile(
                icon: Icons.rocket_launch_outlined,
                title: isHi ? 'साप्ताहिक डाइव' : 'Weekly Dive',
                subtitle: isHi
                    ? 'इस हफ़्ते की जिज्ञासा यात्रा'
                    : "This week's curiosity journey",
                onTap: () => context.push('/dive'),
              ),
              _SettingsTile(
                icon: Icons.auto_awesome_outlined,
                title: isHi ? 'मासिक संश्लेषण' : 'Monthly Synthesis',
                subtitle: isHi
                    ? 'महीने भर की सीख का सार'
                    : 'Your month of learning, summarised',
                onTap: () => context.push('/synthesis'),
              ),
              _SettingsTile(
                icon: Icons.assessment_outlined,
                title: isHi
                    ? 'समग्र प्रगति कार्ड'
                    : 'Holistic Progress Card',
                subtitle: isHi
                    ? 'आपका NEP 2020 समग्र रिपोर्ट कार्ड'
                    : 'Your NEP 2020 holistic report card',
                onTap: () => context.push('/hpc'),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // Plan section
          _SettingsGroup(
            title: 'Subscription',
            children: [
              _SettingsTile(
                icon: Icons.diamond_outlined,
                title: student?.planDisplayName ?? 'Free',
                subtitle: subscription?.isFree == true
                    ? 'Upgrade for more features'
                    : 'Active plan',
                trailing: subscription?.isFree == true
                    ? Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 5,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.primary,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Text(
                          'Upgrade',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      )
                    : null,
                onTap: () => context.push('/plans'),
              ),
            ],
          ),

          const SizedBox(height: 12),

          // App settings
          _SettingsGroup(
            title: 'App',
            children: [
              _SettingsTile(
                icon: Icons.notifications_outlined,
                title: isHi ? 'सूचनाएँ' : 'Notifications',
                subtitle: isHi
                    ? 'स्ट्रीक, क्विज़ और रिमाइंडर अपडेट'
                    : 'Streaks, quiz results & reminders',
                trailing: const NotificationBadge(
                  child: Icon(
                    Icons.arrow_forward_ios_rounded,
                    size: 12,
                    color: AppColors.textTertiary,
                  ),
                ),
                onTap: () => context.push('/notifications'),
              ),
              _SettingsTile(
                icon: Icons.explore_outlined,
                title: isHi ? 'लाइब्रेरी' : 'Library',
                subtitle: isHi
                    ? 'सभी NCERT अध्याय बिना प्रगति दबाव के देखें'
                    : 'Browse all NCERT chapters, no progress pressure',
                onTap: () => context.push('/library'),
              ),
              _SettingsTile(
                icon: Icons.assignment_outlined,
                title: isHi ? 'मेरे असाइनमेंट' : 'My Assignments',
                subtitle: isHi
                    ? 'आपके शिक्षकों द्वारा दिए गए कार्य'
                    : 'Work assigned by your teachers',
                onTap: () => context.push('/assignments'),
              ),
              _SettingsTile(
                icon: Icons.language_outlined,
                title: 'Language',
                subtitle: isHi
                    ? 'हिन्दी · डिवाइस भाषा'
                    : 'English · Device language',
              ),
              const _SettingsTile(
                icon: Icons.info_outline_rounded,
                title: 'About Alfanumrik',
                subtitle: 'Version 1.1.0',
              ),
            ],
          ),

          const SizedBox(height: 12),

          // Logout
          _SettingsGroup(
            children: [
              _SettingsTile(
                icon: Icons.logout_rounded,
                title: 'Logout',
                titleColor: AppColors.error,
                onTap: () async {
                  final confirmed = await showDialog<bool>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('Logout?'),
                      content: const Text('Are you sure you want to logout?'),
                      actions: [
                        TextButton(
                          onPressed: () => Navigator.pop(ctx, false),
                          child: const Text('Cancel'),
                        ),
                        TextButton(
                          onPressed: () => Navigator.pop(ctx, true),
                          child: const Text(
                            'Logout',
                            style: TextStyle(color: AppColors.error),
                          ),
                        ),
                      ],
                    ),
                  );
                  if (confirmed == true && context.mounted) {
                    await ref.read(studentProvider.notifier).signOut();
                    if (context.mounted) context.go('/login');
                  }
                },
              ),
            ],
          ),

          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _SettingsGroup extends StatelessWidget {
  final String? title;
  final List<Widget> children;

  const _SettingsGroup({this.title, required this.children});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (title != null)
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 8),
            child: Text(
              title!,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.textTertiary,
              ),
            ),
          ),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Column(
            children: children
                .asMap()
                .entries
                .map(
                  (e) => Column(
                    children: [
                      e.value,
                      if (e.key < children.length - 1)
                        const Divider(indent: 52),
                    ],
                  ),
                )
                .toList(),
          ),
        ),
      ],
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Color? titleColor;
  final Widget? trailing;
  final VoidCallback? onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.titleColor,
    this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: onTap != null,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          child: Row(
            children: [
              Icon(
                icon,
                size: 20,
                color: titleColor ?? AppColors.textSecondary,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                        color: titleColor ?? AppColors.textPrimary,
                      ),
                    ),
                    if (subtitle != null)
                      Text(
                        subtitle!,
                        style: const TextStyle(
                          fontSize: 11,
                          color: AppColors.textTertiary,
                        ),
                      ),
                  ],
                ),
              ),
              if (trailing != null)
                trailing!
              else if (onTap != null)
                const Icon(
                  Icons.arrow_forward_ios_rounded,
                  size: 12,
                  color: AppColors.textTertiary,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
