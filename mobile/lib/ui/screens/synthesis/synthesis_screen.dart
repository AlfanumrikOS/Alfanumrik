/// Monthly Synthesis — mobile parity for
/// `apps/host/src/app/synthesis/page.tsx` (Pedagogy v2 Wave 3), including
/// `<SynthesisRitual/>` and `<ParentShareCard/>`.
///
/// FLAG STATE (2026-07-22): `ff_pedagogy_v2_monthly_synthesis` is still OFF in
/// production, so `GET /api/synthesis/state` currently returns **404** for
/// essentially every student. That is the DESIGNED degrade path, not an
/// outage: this screen renders a calm "not available for you yet" card with a
/// way back, never an error wall and never a spinner that hangs.
///
/// `flagged` PARENT-SHARE STATUS: a summary that failed the pre-send
/// fabrication re-check is held for human review. It is rendered as
/// "Under review / समीक्षा में" with an explanatory line — deliberately NOT as
/// a failure, because nothing the student did caused it and nothing they can
/// do fixes it.
///
/// Owner: mobile · Reviewers: quality (UX), assessment (summary copy),
/// backend (parent-share contract)
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/synthesis_models.dart';
import '../../../providers/synthesis_provider.dart';
import '../../widgets/error_widget.dart';
import '../../widgets/loading_widget.dart';

class SynthesisScreen extends ConsumerStatefulWidget {
  const SynthesisScreen({super.key});

  @override
  ConsumerState<SynthesisScreen> createState() => _SynthesisScreenState();
}

class _SynthesisScreenState extends ConsumerState<SynthesisScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(synthesisProvider.notifier).load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final s = ref.watch(synthesisProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '🗓️ मासिक सारांश' : '🗓️ Monthly Synthesis'),
      ),
      body: SafeArea(
        child: switch (s.phase) {
          SynthesisPhase.loading =>
            LoadingScreen(message: isHi ? 'लोड हो रहा है...' : 'Loading...'),
          SynthesisPhase.error => AppErrorWidget(
              message: isHi ? 'लोड नहीं हो सका' : 'Failed to load',
              onRetry: () => ref.read(synthesisProvider.notifier).load(),
            ),
          SynthesisPhase.unavailable => _MessageCard(
              emoji: '🗓️',
              title: isHi
                  ? 'यह सुविधा अभी उपलब्ध नहीं है।'
                  : 'This feature is not available for you yet.',
            ),
          SynthesisPhase.notYet => _MessageCard(
              emoji: '🌱',
              title: isHi ? 'पहला सारांश आने वाला है' : 'Your first synthesis is coming',
              subtitle: isHi
                  ? 'यह इस महीने के अंत में आएगा। तब तक रोज़ाना अभ्यास और साप्ताहिक डाइव करते रहो।'
                  : 'It lands at the end of this month. Until then, keep up the daily practice and weekly dives.',
            ),
          SynthesisPhase.ready => RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () => ref.read(synthesisProvider.notifier).load(),
              child: _ReadyView(state: s, isHi: isHi),
            ),
        },
      ),
    );
  }
}

// ─── Ready ──────────────────────────────────────────────────────────────────

class _ReadyView extends ConsumerWidget {
  final SynthesisScreenState state;
  final bool isHi;

  const _ReadyView({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final row = state.row!;
    final md = row.bundle.masteryDelta;
    final summary = row.summary(isHi);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        Text(
          isHi ? 'महीना पूरा' : 'Month complete',
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 2),
        Text(
          // Server-produced 'YYYY-MM' label — rendered verbatim.
          row.synthesisMonth,
          style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
        ),
        const SizedBox(height: 16),

        // ── Mastery delta tiles ──
        Row(
          children: [
            Expanded(
              child: _DeltaTile(
                label: isHi ? 'महारत' : 'Mastered',
                value: md.topicsMastered,
                color: AppColors.success,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _DeltaTile(
                label: isHi ? 'सुधार' : 'Improved',
                value: md.topicsImproved,
                color: AppColors.accent,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _DeltaTile(
                label: isHi ? 'पीछे गए' : 'Regressed',
                value: md.topicsRegressed,
                color: AppColors.error,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),

        // ── Chapters touched ──
        if (md.chaptersTouched.isNotEmpty) ...[
          _SectionLabel(isHi ? 'इस महीने के अध्याय' : 'Chapters touched'),
          const SizedBox(height: 6),
          ...md.chaptersTouched.take(6).map(
                (c) => Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('• ', style: TextStyle(color: AppColors.accent)),
                      Expanded(
                        child: Text(
                          c,
                          style: const TextStyle(fontSize: 12.5),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          if (md.chaptersTouched.length > 6)
            Text(
              isHi
                  ? '+ ${md.chaptersTouched.length - 6} और'
                  : '+ ${md.chaptersTouched.length - 6} more',
              style: const TextStyle(
                fontSize: 12,
                fontStyle: FontStyle.italic,
                color: AppColors.textTertiary,
              ),
            ),
          const SizedBox(height: 16),
        ],

        // ── Weekly dives + mock questions ──
        Row(
          children: [
            Expanded(
              child: _InfoTile(
                label: isHi ? 'साप्ताहिक डाइव' : 'Weekly dives',
                value: '${row.bundle.weeklyArtifactIds.length}/4',
              ),
            ),
            if (row.bundle.chapterMockSummary != null) ...[
              const SizedBox(width: 8),
              Expanded(
                child: _InfoTile(
                  label: isHi ? 'मॉक प्रश्न' : 'Mock questions',
                  value: '${row.bundle.chapterMockSummary!.totalQuestions}',
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 20),

        // ── Summary ──
        _SectionLabel(isHi ? 'इस महीने का सारांश' : 'This month at a glance'),
        const SizedBox(height: 6),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: summary.trim().isEmpty
              ? Text(
                  isHi
                      ? 'सारांश तैयार हो रहा है — कुछ ही पल में…'
                      : 'Generating your summary — pull down to refresh in a moment…',
                  style: const TextStyle(
                    fontSize: 12.5,
                    fontStyle: FontStyle.italic,
                    color: AppColors.textTertiary,
                  ),
                )
              : SelectableText(
                  // Rendered VERBATIM. Never trimmed, summarised, or
                  // re-worded on this side — the text already passed the
                  // server-side fabrication oracle in exactly this form.
                  summary,
                  style: const TextStyle(fontSize: 13.5, height: 1.55),
                ),
        ),
        const SizedBox(height: 20),

        // ── Parent share ──
        _ParentShareCard(state: state, isHi: isHi),
      ],
    );
  }
}

class _ParentShareCard extends ConsumerWidget {
  final SynthesisScreenState state;
  final bool isHi;

  const _ParentShareCard({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final row = state.row!;
    final status = row.parentShareStatus;
    final chip = _statusChip(status, isHi);
    final summaryEmpty = row.summary(isHi).trim().isEmpty;
    final canSend = !state.isSharing && !status.blocksSending && !summaryEmpty;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.brand.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  isHi ? 'अभिभावक के साथ साझा करो' : 'Share with parent',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.6,
                    color: AppColors.primary,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
                decoration: BoxDecoration(
                  color: chip.$2.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  chip.$1,
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: chip.$2,
                  ),
                ),
              ),
            ],
          ),

          // `flagged` needs an explanation, not just a chip: it is a HOLD for
          // human review, not something the student failed at or can retry.
          if (status == ParentShareStatus.flagged) ...[
            const SizedBox(height: 8),
            Text(
              isHi
                  ? 'यह सारांश जाँच के लिए रोका गया है। हमारी टीम इसे देख रही है — तुम्हें कुछ नहीं करना है।'
                  : 'This summary is being checked by our team before it goes out. Nothing for you to do.',
              style: const TextStyle(
                fontSize: 12,
                height: 1.45,
                color: AppColors.textSecondary,
              ),
            ),
          ],

          if (state.shareFeedback != null) ...[
            const SizedBox(height: 10),
            ErrorBanner(
              message: _feedbackCopy(state.shareFeedback!, isHi),
              onDismiss: () =>
                  ref.read(synthesisProvider.notifier).dismissShareFeedback(),
            ),
          ],

          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            height: 44,
            child: ElevatedButton(
              onPressed: canSend
                  ? () => ref.read(synthesisProvider.notifier).shareWithParent()
                  : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brand,
                foregroundColor: Colors.white,
              ),
              child: state.isSharing
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Text(
                      status == ParentShareStatus.sent
                          ? (isHi ? '✓ भेज दिया' : '✓ Sent')
                          : (isHi ? 'WhatsApp पर भेजो' : 'Send via WhatsApp'),
                    ),
            ),
          ),
        ],
      ),
    );
  }

  /// (label, colour) for each of the SIX current statuses.
  static (String, Color) _statusChip(ParentShareStatus status, bool isHi) {
    return switch (status) {
      ParentShareStatus.sent => (isHi ? 'भेज दिया' : 'Sent', AppColors.success),
      ParentShareStatus.optedOut => (
          isHi ? 'अभिभावक ने मना किया' : 'Parent opted out',
          AppColors.textSecondary,
        ),
      ParentShareStatus.failed => (isHi ? 'विफल' : 'Failed', AppColors.error),
      ParentShareStatus.suppressed => (
          isHi ? 'रोका गया' : 'Suppressed',
          AppColors.textSecondary,
        ),
      // NOT an error colour — this is a review hold.
      ParentShareStatus.flagged => (
          isHi ? 'समीक्षा में' : 'Under review',
          AppColors.warning,
        ),
      ParentShareStatus.pending => (
          isHi ? 'लंबित' : 'Pending',
          AppColors.warning,
        ),
    };
  }

  static String _feedbackCopy(ParentShareFeedback f, bool isHi) {
    return switch (f) {
      ParentShareFeedback.sent =>
        isHi ? 'भेज दिया गया।' : 'Sent to your parent.',
      ParentShareFeedback.alreadySent =>
        isHi ? 'यह पहले ही भेजा जा चुका है।' : 'This was already sent.',
      ParentShareFeedback.optedOut => isHi
          ? 'तुम्हारे अभिभावक ने मासिक संदेश बंद किए हैं।'
          : 'Your parent has turned off monthly updates.',
      ParentShareFeedback.flagged => isHi
          ? 'यह सारांश जाँच के लिए रोका गया है — टीम इसे देख रही है।'
          : 'Held for a quick check by our team before sending.',
      ParentShareFeedback.noGuardian => isHi
          ? 'कोई अभिभावक खाता जुड़ा नहीं है।'
          : 'No parent account is linked yet.',
      ParentShareFeedback.phoneMissing => isHi
          ? 'अभिभावक का फ़ोन नंबर नहीं मिला।'
          : "Your parent's phone number is missing.",
      ParentShareFeedback.unavailable => isHi
          ? 'यह सुविधा अभी उपलब्ध नहीं है।'
          : 'This feature is not available right now.',
      ParentShareFeedback.deliveryFailed => isHi
          ? 'WhatsApp पर नहीं भेजा जा सका — बाद में कोशिश करो।'
          : "Couldn't deliver over WhatsApp — try again later.",
      ParentShareFeedback.failed =>
        isHi ? 'कुछ गलत हो गया।' : 'Something went wrong.',
    };
  }
}

// ─── Small presentational pieces ────────────────────────────────────────────

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w800,
        letterSpacing: 0.6,
        color: AppColors.textSecondary,
      ),
    );
  }
}

class _DeltaTile extends StatelessWidget {
  final String label;
  final int value;
  final Color color;

  const _DeltaTile({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Column(
        children: [
          Text(
            '$value',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 10.5,
              color: AppColors.textTertiary,
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoTile extends StatelessWidget {
  final String label;
  final String value;

  const _InfoTile({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 10.5,
              color: AppColors.textTertiary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }
}

class _MessageCard extends StatelessWidget {
  final String emoji;
  final String title;
  final String? subtitle;

  const _MessageCard({required this.emoji, required this.title, this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 40)),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            if (subtitle != null) ...[
              const SizedBox(height: 8),
              Text(
                subtitle!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 12.5,
                  height: 1.5,
                  color: AppColors.textTertiary,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
