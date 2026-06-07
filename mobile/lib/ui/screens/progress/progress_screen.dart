import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/progress_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

/// Progress screen (Wave 2.3b) — renders `GET /v2/student/progress`
/// (`StudentApi`) via the generated dart-dio client: per-subject performance
/// scores, topic mastery, knowledge gaps, learning velocity, and decay topics.
///
/// Loading / empty / error states. Bilingual (P7) via the device-locale
/// `_isHindi` convention already used in today_screen / quiz_screen (no
/// app-wide language toggle yet). P13: surfaces only what the endpoint returns.
///
/// Reached ONLY when `ApiConstants.useV2` is on — the flag-OFF app never mounts
/// this screen.
class ProgressScreen extends ConsumerWidget {
  const ProgressScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = _isHindi(context);
    final progressAsync = ref.watch(progressProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(isHi ? 'प्रगति' : 'Progress')),
      body: SafeArea(
        child: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => ref.read(progressProvider.notifier).refresh(),
          child: progressAsync.when(
            loading: () => ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
              children: const [
                ShimmerCard(height: 120),
                SizedBox(height: 20),
                ShimmerList(count: 4, itemHeight: 64),
              ],
            ),
            error: (e, _) => ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                SizedBox(height: MediaQuery.of(context).size.height * 0.28),
                AppErrorWidget(
                  message: isHi
                      ? 'प्रगति लोड नहीं हो सकी। दोबारा खींचें।'
                      : "Couldn't load your progress. Pull to retry.",
                  onRetry: () => ref.read(progressProvider.notifier).refresh(),
                ),
              ],
            ),
            data: (progress) => _ProgressBody(progress: progress, isHi: isHi),
          ),
        ),
      ),
    );
  }
}

/// Device-locale Hindi detection — matches the convention in today_screen.dart
/// and quiz_screen.dart until an app-wide toggle ships.
bool _isHindi(BuildContext context) {
  return Localizations.localeOf(context).languageCode == 'hi';
}

class _ProgressBody extends StatelessWidget {
  final StudentProgressResponse progress;
  final bool isHi;

  const _ProgressBody({required this.progress, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final perf = progress.performanceScores.toList();
    final mastery = progress.topicMastery.toList();
    final gaps = progress.knowledgeGaps.toList();
    final velocity = progress.learningVelocity.toList();
    final decay = progress.decayTopics.toList();

    final everythingEmpty = perf.isEmpty &&
        mastery.isEmpty &&
        gaps.isEmpty &&
        velocity.isEmpty &&
        decay.isEmpty;

    if (everythingEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          const SizedBox(height: 40),
          _EmptyHint(
            text: isHi
                ? 'अभी कोई प्रगति डेटा नहीं है। एक क्विज़ या पाठ पूरा करें और यहाँ वापस आएँ!'
                : 'No progress data yet. Finish a quiz or lesson and come back!',
          ),
        ],
      );
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      children: [
        if (perf.isNotEmpty) ...[
          _SectionHeader(title: isHi ? 'प्रदर्शन स्कोर' : 'Performance Scores'),
          const SizedBox(height: 10),
          ...perf.map((p) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: _PerformanceCard(score: p, isHi: isHi),
              )),
          const SizedBox(height: 22),
        ],
        if (gaps.isNotEmpty) ...[
          _SectionHeader(title: isHi ? 'ज्ञान अंतराल' : 'Knowledge Gaps'),
          const SizedBox(height: 10),
          ...gaps.map((g) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _GapRow(gap: g, isHi: isHi),
              )),
          const SizedBox(height: 22),
        ],
        if (velocity.isNotEmpty) ...[
          _SectionHeader(title: isHi ? 'सीखने की गति' : 'Learning Velocity'),
          const SizedBox(height: 10),
          ...velocity.map((v) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _VelocityRow(velocity: v, isHi: isHi),
              )),
          const SizedBox(height: 22),
        ],
        if (mastery.isNotEmpty) ...[
          _SectionHeader(title: isHi ? 'टॉपिक महारत' : 'Topic Mastery'),
          const SizedBox(height: 10),
          ...mastery.map((m) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _MasteryRow(mastery: m, isHi: isHi),
              )),
          const SizedBox(height: 22),
        ],
        if (decay.isNotEmpty) ...[
          _SectionHeader(title: isHi ? 'दोहराने योग्य टॉपिक' : 'Topics to Review'),
          const SizedBox(height: 10),
          ...decay.map((d) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _DecayRow(decay: d, isHi: isHi),
              )),
        ],
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w700,
        color: AppColors.textPrimary,
      ),
    );
  }
}

/// Per-subject performance score (0-100) with a level name + progress bar.
class _PerformanceCard extends StatelessWidget {
  final ProgressPerformanceScore score;
  final bool isHi;

  const _PerformanceCard({required this.score, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final color = AppColors.subjectColor(score.subject);
    final value = score.overallScore.toDouble().clamp(0, 100).toDouble();

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _titleCase(score.subject),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              Text(
                '${value.round()}',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
              const Text(
                ' / 100',
                style: TextStyle(
                  fontSize: 12,
                  color: AppColors.textTertiary,
                ),
              ),
            ],
          ),
          if (score.levelName != null && score.levelName!.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              score.levelName!,
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textSecondary,
              ),
            ),
          ],
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: LinearProgressIndicator(
              value: value / 100.0,
              minHeight: 6,
              backgroundColor: AppColors.borderLight,
              valueColor: AlwaysStoppedAnimation(color),
            ),
          ),
        ],
      ),
    );
  }
}

class _GapRow extends StatelessWidget {
  final ProgressKnowledgeGap gap;
  final bool isHi;

  const _GapRow({required this.gap, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final severity = (gap.severity ?? '').toLowerCase();
    final color = switch (severity) {
      'high' => AppColors.error,
      'medium' => AppColors.warning,
      _ => AppColors.info,
    };
    final severityLabel = _severityLabel(severity, isHi);

    return _MetricTile(
      leadingColor: color,
      title: gap.topic ?? (isHi ? 'अज्ञात टॉपिक' : 'Unknown topic'),
      subtitle: gap.subject == null ? null : _titleCase(gap.subject!),
      trailing: severityLabel == null
          ? null
          : _Pill(text: severityLabel, color: color),
    );
  }
}

class _VelocityRow extends StatelessWidget {
  final ProgressLearningVelocity velocity;
  final bool isHi;

  const _VelocityRow({required this.velocity, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final rate = velocity.weeklyMasteryRate;
    final subtitle = rate == null
        ? null
        : (isHi
            ? 'साप्ताहिक दर: ${(rate * 100).round()}%'
            : 'Weekly rate: ${(rate * 100).round()}%');

    return _MetricTile(
      leadingColor: AppColors.subjectColor(velocity.subject),
      title: _titleCase(velocity.subject),
      subtitle: subtitle,
      trailing: velocity.predictedMasteryDate == null
          ? null
          : _Pill(
              text: isHi
                  ? 'लक्ष्य: ${_shortDate(velocity.predictedMasteryDate!)}'
                  : 'ETA: ${_shortDate(velocity.predictedMasteryDate!)}',
              color: AppColors.accent,
            ),
    );
  }
}

class _MasteryRow extends StatelessWidget {
  final ProgressTopicMastery mastery;
  final bool isHi;

  const _MasteryRow({required this.mastery, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final pct = (mastery.masteryProbability * 100).round();
    final color = pct >= 80
        ? AppColors.success
        : pct >= 50
            ? AppColors.warning
            : AppColors.error;

    return _MetricTile(
      leadingColor: color,
      title: mastery.topicId ?? (isHi ? 'टॉपिक' : 'Topic'),
      subtitle: mastery.consecutiveCorrect == null
          ? null
          : (isHi
              ? 'लगातार सही: ${mastery.consecutiveCorrect}'
              : 'Streak: ${mastery.consecutiveCorrect}'),
      trailing: _Pill(text: '$pct%', color: color),
    );
  }
}

class _DecayRow extends StatelessWidget {
  final ProgressDecayTopic decay;
  final bool isHi;

  const _DecayRow({required this.decay, required this.isHi});

  @override
  Widget build(BuildContext context) {
    return _MetricTile(
      leadingColor: AppColors.warning,
      title: decay.topicId ?? (isHi ? 'टॉपिक' : 'Topic'),
      subtitle: decay.subject == null ? null : _titleCase(decay.subject!),
      trailing: decay.nextReviewAt == null
          ? null
          : _Pill(
              text: isHi
                  ? 'दोहराएँ: ${_shortDate(decay.nextReviewAt!)}'
                  : 'Due: ${_shortDate(decay.nextReviewAt!)}',
              color: AppColors.warning,
            ),
    );
  }
}

/// Shared row layout for the gap / velocity / mastery / decay sections.
class _MetricTile extends StatelessWidget {
  final Color leadingColor;
  final String title;
  final String? subtitle;
  final Widget? trailing;

  const _MetricTile({
    required this.leadingColor,
    required this.title,
    this.subtitle,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: leadingColor, shape: BoxShape.circle),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: const TextStyle(
                      fontSize: 11.5,
                      color: AppColors.textTertiary,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 10), trailing!],
        ],
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  final String text;
  final Color color;

  const _Pill({required this.text, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}

class _EmptyHint extends StatelessWidget {
  final String text;
  const _EmptyHint({required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceAlt,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Text(
        text,
        textAlign: TextAlign.center,
        style: const TextStyle(
          fontSize: 13,
          color: AppColors.textSecondary,
          height: 1.4,
        ),
      ),
    );
  }
}

String? _severityLabel(String severity, bool isHi) {
  switch (severity) {
    case 'high':
      return isHi ? 'अधिक' : 'High';
    case 'medium':
      return isHi ? 'मध्यम' : 'Medium';
    case 'low':
      return isHi ? 'कम' : 'Low';
    default:
      return null;
  }
}

/// Turn a subject CODE (e.g. `social_studies`) into a display label. Technical
/// terms are not translated; this is a structural transform only.
String _titleCase(String code) {
  if (code.isEmpty) return code;
  return code
      .split(RegExp(r'[_\s]+'))
      .where((w) => w.isNotEmpty)
      .map((w) => w[0].toUpperCase() + w.substring(1))
      .join(' ');
}

/// Render an ISO date/timestamp as a short `YYYY-MM-DD`. Falls back to the raw
/// string when it doesn't parse, so a malformed value is never a crash.
String _shortDate(String iso) {
  final dt = DateTime.tryParse(iso);
  if (dt == null) return iso;
  final m = dt.month.toString().padLeft(2, '0');
  final d = dt.day.toString().padLeft(2, '0');
  return '${dt.year}-$m-$d';
}
