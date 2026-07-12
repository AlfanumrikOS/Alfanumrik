import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/auth_provider.dart';
import '../../../providers/experience_provider.dart';
import '../../../providers/parent_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';
import 'cheer_presets.dart';

/// The parent "Glance" home — the centerpiece of the Wave 2.4 parent surface.
///
/// Glance-first: a guardian lands here (`/parent`) after the role-aware router
/// fork (`ApiConstants.useV2` ON AND role == guardian). It:
///   1. fetches the guardian's linked children (`GET /v2/parent/children`),
///   2. lets the parent pick a child (chips, only when there's more than one),
///   3. renders that child's Snapshot + Moments + Actions
///      (`GET /v2/parent/glance?student_id=`), and
///   4. lets the parent send a PRESET cheer (`POST /v2/parent/encourage`).
///
/// All copy is bilingual (P7) via the device-locale `_isHindi` convention used
/// across mobile. No PII is logged (P13). Reached ONLY for guardians under the
/// flag — a student login is byte-identical to today.
class ParentGlanceScreen extends ConsumerStatefulWidget {
  const ParentGlanceScreen({super.key});

  @override
  ConsumerState<ParentGlanceScreen> createState() => _ParentGlanceScreenState();
}

class _ParentGlanceScreenState extends ConsumerState<ParentGlanceScreen> {
  @override
  Widget build(BuildContext context) {
    final isHi = _isHindi(context);
    final childrenAsync = ref.watch(parentChildrenProvider);
    final assignmentAsync = ref.watch(oneExperienceProvider);
    if (assignmentAsync.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final resolution =
        assignmentAsync.valueOrNull ?? OneExperienceResolution.denied;
    final assignment = resolution.assignment;
    if (assignment == OneExperienceAssignment.denied) {
      return const Scaffold(
        body: Center(child: Text('Parent workspace unavailable.')),
      );
    }
    final oneExperience = assignment == OneExperienceAssignment.enabled;
    final selectedStudentId = ref.watch(selectedParentChildProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: oneExperience
          ? null
          : AppBar(
              backgroundColor: AppColors.surface,
              elevation: 0,
              title: Text(
                isHi ? 'अभिभावक' : 'Parent',
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              actions: [
                IconButton(
                  tooltip: isHi ? 'लॉग आउट' : 'Log out',
                  icon: const Icon(
                    Icons.logout_rounded,
                    color: AppColors.textTertiary,
                    size: 20,
                  ),
                  onPressed: () => _confirmLogout(context, ref, isHi),
                ),
              ],
            ),
      body: SafeArea(
        top: false,
        child: childrenAsync.when(
          loading: () => const _ChildrenLoading(),
          error: (e, _) => _FullError(
            isHi: isHi,
            onRetry: () => ref.read(parentChildrenProvider.notifier).refresh(),
          ),
          data: (response) {
            final children = response.children.toList(growable: false);
            if (children.isEmpty) {
              return _NoChildren(isHi: isHi);
            }

            // Default the selection to the first child; keep the prior choice if
            // it still exists in the (possibly refreshed) list.
            final selectedId = _resolveSelected(children, selectedStudentId);

            return _ParentBody(
              children: children,
              selectedStudentId: selectedId,
              isHi: isHi,
              onSelect: (id) =>
                  ref.read(selectedParentChildProvider.notifier).state = id,
            );
          },
        ),
      ),
    );
  }

  String _resolveSelected(List<ParentChild> children, String? current) {
    if (current != null && children.any((c) => c.studentId == current)) {
      return current;
    }
    return children.first.studentId;
  }

  Future<void> _confirmLogout(
    BuildContext context,
    WidgetRef ref,
    bool isHi,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(isHi ? 'लॉग आउट करें?' : 'Log out?'),
        content: Text(
          isHi
              ? 'आपको दोबारा साइन इन करना होगा।'
              : 'You will need to sign in again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(isHi ? 'रद्द करें' : 'Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(isHi ? 'लॉग आउट' : 'Log out'),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await ref.read(studentProvider.notifier).signOut();
      if (context.mounted) context.go('/login');
    }
  }
}

/// Body once children are known: child selector (if >1) + the selected child's
/// glance.
class _ParentBody extends ConsumerWidget {
  final List<ParentChild> children;
  final String selectedStudentId;
  final bool isHi;
  final ValueChanged<String> onSelect;

  const _ParentBody({
    required this.children,
    required this.selectedStudentId,
    required this.isHi,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final glanceAsync = ref.watch(parentGlanceProvider(selectedStudentId));

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () =>
          ref.read(parentGlanceProvider(selectedStudentId).notifier).refresh(),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          if (children.length > 1) ...[
            _ChildSelector(
              children: children,
              selectedStudentId: selectedStudentId,
              onSelect: onSelect,
            ),
            const SizedBox(height: 20),
          ],
          glanceAsync.when(
            loading: () => const _GlanceLoading(),
            error: (e, _) => Padding(
              padding: const EdgeInsets.only(top: 40),
              child: AppErrorWidget(
                message: isHi
                    ? 'जानकारी लोड नहीं हो सकी। दोबारा कोशिश करें।'
                    : "Couldn't load this child's glance. Pull to retry.",
                onRetry: () => ref
                    .read(parentGlanceProvider(selectedStudentId).notifier)
                    .refresh(),
              ),
            ),
            data: (glance) => _GlanceContent(glance: glance, isHi: isHi),
          ),
        ],
      ),
    );
  }
}

/// Hindi-detection helper — mirrors the convention in today_screen.dart /
/// quiz_screen.dart. Mobile has no app-wide language toggle yet; we honour the
/// device locale until one ships.
bool _isHindi(BuildContext context) {
  return Localizations.localeOf(context).languageCode == 'hi';
}

/// Child selector chips, shown only when the guardian has more than one linked
/// child. Selecting a chip re-resolves [parentGlanceProvider] for that child.
class _ChildSelector extends StatelessWidget {
  final List<ParentChild> children;
  final String selectedStudentId;
  final ValueChanged<String> onSelect;

  const _ChildSelector({
    required this.children,
    required this.selectedStudentId,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: children.map((child) {
        final isSelected = child.studentId == selectedStudentId;
        final name = (child.name ?? '').trim();
        final label = name.isEmpty ? '—' : name.split(' ').first;
        return ChoiceChip(
          label: Text(label),
          selected: isSelected,
          onSelected: (_) => onSelect(child.studentId),
          selectedColor: AppColors.primaryLight,
          backgroundColor: AppColors.surface,
          labelStyle: TextStyle(
            fontSize: 13,
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
            color: isSelected ? AppColors.primaryDark : AppColors.textSecondary,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
            side: BorderSide(
              color: isSelected ? AppColors.primary : AppColors.borderLight,
            ),
          ),
        );
      }).toList(),
    );
  }
}

/// The glance content for the selected child: Snapshot, Moments, Actions.
class _GlanceContent extends StatelessWidget {
  final ParentGlanceResponse glance;
  final bool isHi;

  const _GlanceContent({required this.glance, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final childName = (glance.child.name ?? '').trim();
    final firstName = childName.isEmpty ? null : childName.split(' ').first;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          firstName ?? (isHi ? 'आपका बच्चा' : 'Your child'),
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          isHi ? 'इस सप्ताह एक नज़र में' : 'This week at a glance',
          style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
        ),
        const SizedBox(height: 20),

        // ── Snapshot ──────────────────────────────────────────────
        _SectionLabel(isHi ? 'झलक' : 'Snapshot'),
        const SizedBox(height: 10),
        _SnapshotCard(snapshot: glance.snapshot, isHi: isHi),

        const SizedBox(height: 24),

        // ── Moments ───────────────────────────────────────────────
        _SectionLabel(isHi ? 'खास पल' : 'Moments'),
        const SizedBox(height: 10),
        _MomentsCard(moments: glance.moments, isHi: isHi),

        const SizedBox(height: 24),

        // ── Actions ───────────────────────────────────────────────
        _SectionLabel(isHi ? 'क्रियाएँ' : 'Actions'),
        const SizedBox(height: 10),
        _EncourageButton(
          studentId: glance.child.studentId,
          childFirstName: firstName,
          isHi: isHi,
        ),
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: AppColors.textTertiary,
      ),
    );
  }
}

/// Plain-language snapshot. Only renders the metrics that are present — accuracy
/// / avg score are optional in the contract.
class _SnapshotCard extends StatelessWidget {
  final ParentGlanceSnapshot snapshot;
  final bool isHi;

  const _SnapshotCard({required this.snapshot, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];

    // Sessions this week. Missing source evidence is shown as —, never zero.
    final sessionsThisWeek = snapshot.sessionsThisWeek;
    rows.add(
      _StatRow(
        icon: '📚',
        text: sessionsThisWeek == null
            ? (isHi ? 'इस सप्ताह सेशन —' : 'Sessions this week —')
            : isHi
                ? '$sessionsThisWeek सेशन इस सप्ताह'
                : '$sessionsThisWeek ${sessionsThisWeek == 1 ? 'session' : 'sessions'} this week',
      ),
    );

    // Streak. Missing source evidence is shown as —, never zero.
    final streakDays = snapshot.streakDays;
    rows.add(
      _StatRow(
        icon: '🔥',
        text: streakDays == null
            ? (isHi ? 'सीखने की स्ट्रीक —' : 'Learning streak —')
            : isHi
                ? '$streakDays-दिन की स्ट्रीक'
                : '$streakDays-day streak',
      ),
    );

    // Accuracy (optional).
    final accuracy = snapshot.accuracy;
    if (accuracy != null) {
      rows.add(
        _StatRow(
          icon: '🎯',
          text: isHi
              ? '${accuracy.round()}% सटीकता'
              : '${accuracy.round()}% accuracy',
        ),
      );
    }

    // Average score (optional).
    final avg = snapshot.avgScore;
    if (avg != null) {
      rows.add(
        _StatRow(
          icon: '📊',
          text: isHi
              ? 'औसत स्कोर ${avg.round()}%'
              : 'Average score ${avg.round()}%',
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (int i = 0; i < rows.length; i++) ...[
            if (i > 0) const SizedBox(height: 12),
            rows[i],
          ],
        ],
      ),
    );
  }
}

class _StatRow extends StatelessWidget {
  final String icon;
  final String text;
  const _StatRow({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(icon, style: const TextStyle(fontSize: 18)),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              fontSize: 14,
              color: AppColors.textPrimary,
              height: 1.35,
            ),
          ),
        ),
      ],
    );
  }
}

/// Moments: highlights (positive), concerns (gentle), and an optional
/// suggestion. Renders simple rows; empty sections collapse to a friendly note.
class _MomentsCard extends StatelessWidget {
  final ParentGlanceMoments moments;
  final bool isHi;

  const _MomentsCard({required this.moments, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final highlights = moments.highlights.toList(growable: false);
    final concerns = moments.concerns.toList(growable: false);
    final suggestion = moments.suggestion;

    final hasAny =
        highlights.isNotEmpty || concerns.isNotEmpty || (suggestion != null);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: !hasAny
          ? Text(
              isHi
                  ? 'अभी कोई खास अपडेट नहीं। जल्द ही और जानकारी मिलेगी।'
                  : 'No notable updates yet. More will appear as your child learns.',
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
                height: 1.4,
              ),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final h in highlights) ...[
                  _MomentRow(icon: '✅', text: h),
                  const SizedBox(height: 10),
                ],
                for (final c in concerns) ...[
                  _MomentRow(icon: '💡', text: c),
                  const SizedBox(height: 10),
                ],
                if (suggestion != null)
                  Container(
                    margin: const EdgeInsets.only(top: 2),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceAlt,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('🧭', style: TextStyle(fontSize: 16)),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            suggestion,
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.textSecondary,
                              height: 1.4,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
    );
  }
}

class _MomentRow extends StatelessWidget {
  final String icon;
  final String text;
  const _MomentRow({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(icon, style: const TextStyle(fontSize: 16)),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              fontSize: 14,
              color: AppColors.textPrimary,
              height: 1.4,
            ),
          ),
        ),
      ],
    );
  }
}

/// The Encourage call-to-action. Opens the preset picker; on selection it sends
/// the cheer and shows a bilingual toast keyed off the server's status code.
class _EncourageButton extends ConsumerWidget {
  final String studentId;
  final String? childFirstName;
  final bool isHi;

  const _EncourageButton({
    required this.studentId,
    required this.childFirstName,
    required this.isHi,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primary,
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
        icon: const Icon(Icons.celebration_rounded, size: 20),
        label: Text(
          isHi ? 'प्रोत्साहन भेजें' : 'Send encouragement',
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        ),
        onPressed: () => _openPicker(context, ref),
      ),
    );
  }

  Future<void> _openPicker(BuildContext context, WidgetRef ref) async {
    final selected = await showModalBottomSheet<CheerPreset>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => _CheerPickerSheet(isHi: isHi),
    );
    if (selected == null || !context.mounted) return;

    // P13: send ONLY { student_id, message_key }. Do not log either value.
    final outcome = await ref
        .read(encourageProvider)
        .send(studentId: studentId, messageKey: selected.messageKey);
    if (!context.mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(encourageMessage(outcome, isHi)),
        backgroundColor: outcome == EncourageOutcome.success
            ? AppColors.success
            : (outcome == EncourageOutcome.rateLimited
                ? AppColors.warning
                : AppColors.error),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

/// The preset picker bottom sheet. Lists the 8 curated cheers (P12: no free
/// text). Returns the chosen [CheerPreset] to the caller.
class _CheerPickerSheet extends StatelessWidget {
  final bool isHi;
  const _CheerPickerSheet({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: AppColors.borderLight,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            Text(
              isHi ? 'एक प्रोत्साहन चुनें' : 'Pick an encouragement',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 12),
            // The fixed 8-preset catalog (mirrors src/lib/parent/cheer-catalog.ts).
            ...kCheerPresets.map(
              (preset) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Text(
                  preset.icon,
                  style: const TextStyle(fontSize: 24),
                ),
                title: Text(
                  preset.title(isHi),
                  style: const TextStyle(
                    fontSize: 15,
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                onTap: () => Navigator.of(context).pop(preset),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Loading / empty / error states ───────────────────────────────────────

/// Children list loading skeleton.
class _ChildrenLoading extends StatelessWidget {
  const _ChildrenLoading();

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
      children: const [
        ShimmerCard(height: 28),
        SizedBox(height: 20),
        ShimmerCard(height: 130),
        SizedBox(height: 20),
        ShimmerList(count: 3, itemHeight: 60),
      ],
    );
  }
}

/// Glance section loading skeleton (children already loaded).
class _GlanceLoading extends StatelessWidget {
  const _GlanceLoading();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ShimmerCard(height: 28),
        SizedBox(height: 20),
        ShimmerCard(height: 120),
        SizedBox(height: 24),
        ShimmerCard(height: 120),
      ],
    );
  }
}

/// Top-level error (children fetch failed).
class _FullError extends StatelessWidget {
  final bool isHi;
  final VoidCallback onRetry;

  const _FullError({required this.isHi, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.25),
        AppErrorWidget(
          message: isHi
              ? 'जानकारी लोड नहीं हो सकी। दोबारा प्रयास करें।'
              : "Couldn't load your children. Pull to retry.",
          onRetry: onRetry,
        ),
      ],
    );
  }
}

/// No linked children — the guardian has not been linked to any student yet.
class _NoChildren extends StatelessWidget {
  final bool isHi;
  const _NoChildren({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(28),
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.18),
        const Center(child: Text('👨‍👩‍👧', style: TextStyle(fontSize: 44))),
        const SizedBox(height: 14),
        Text(
          isHi ? 'अभी कोई बच्चा जुड़ा नहीं है' : 'No children linked yet',
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          isHi
              ? 'जब आपका बच्चा आपके खाते से जुड़ जाएगा, तो उनकी प्रगति यहाँ दिखेगी।'
              : "Once your child is linked to your account, their progress will appear here.",
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 14,
            color: AppColors.textSecondary,
            height: 1.5,
          ),
        ),
      ],
    );
  }
}
