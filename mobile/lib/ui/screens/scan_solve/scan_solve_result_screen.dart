import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/scan_solve_models.dart';
import '../../../providers/scan_solve_provider.dart';

/// Scan & Solve — result screen.
///
/// Renders exactly what `/api/scan-solve` returned:
///   * the OCR question text (always — this is what the student photographed)
///   * the `ncert-solver` answer / steps / explanation, when there is one
///   * the follow-on actions the web page offers (Foxy, similar questions)
///
/// ── P12 ───────────────────────────────────────────────────────────────────
/// The solver ships a `verified` flag and a `confidence`. When `verified` is
/// false the answer is rendered with an explicit "check this against your
/// NCERT textbook" caveat rather than being presented as authoritative. The
/// screen never suppresses, rewrites, or re-scores solver output — it only
/// frames it.
///
/// ── P13 ───────────────────────────────────────────────────────────────────
/// Nothing here logs. The OCR text and the solution are student work and stay
/// on-screen only.
class ScanSolveResultScreen extends ConsumerWidget {
  const ScanSolveResultScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(scanSolveProvider);
    final result = state.result;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? 'स्कैन का नतीजा' : 'Scan result'),
        actions: [
          TextButton(
            onPressed: () {
              ref.read(scanSolveProvider.notifier).reset();
              if (context.canPop()) {
                context.pop();
              } else {
                context.go('/scan');
              }
            },
            child: Text(isHi ? 'नया स्कैन' : 'New scan'),
          ),
        ],
      ),
      body: SafeArea(
        child: result == null
            ? _EmptyState(isHi: isHi)
            : _ResultBody(state: state, result: result, isHi: isHi),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final bool isHi;
  const _EmptyState({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('📄', style: TextStyle(fontSize: 36)),
            const SizedBox(height: 12),
            Text(
              isHi ? 'दिखाने के लिए कोई नतीजा नहीं' : 'No result to show',
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              isHi
                  ? 'फिर से सवाल की फ़ोटो लेकर स्कैन करें।'
                  : 'Photograph the question again to scan it.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: 18),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
              ),
              onPressed: () => context.go('/scan'),
              child: Text(isHi ? 'स्कैन पर जाएँ' : 'Go to Scan'),
            ),
          ],
        ),
      ),
    );
  }
}

class _ResultBody extends StatelessWidget {
  final ScanSolveScreenState state;
  final ScanSolveResult result;
  final bool isHi;

  const _ResultBody({
    required this.state,
    required this.result,
    required this.isHi,
  });

  @override
  Widget build(BuildContext context) {
    final solution = result.solution;
    final hasSolution = result.hasSolution && solution != null;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        if (state.previewBytes != null) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Image.memory(
              state.previewBytes!,
              height: 150,
              width: double.infinity,
              fit: BoxFit.cover,
              gaplessPlayback: true,
            ),
          ),
          const SizedBox(height: 14),
        ],

        // ── The question we read ──
        _SectionCard(
          title: isHi ? 'हमने यह सवाल पढ़ा' : 'The question we read',
          child: SelectableText(
            result.extractedText,
            style: const TextStyle(
              fontSize: 14,
              height: 1.5,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        const SizedBox(height: 12),

        if (hasSolution) ...[
          if (!solution.verified) _UnverifiedNotice(isHi: isHi),
          if (!solution.verified) const SizedBox(height: 12),

          if (solution.answer.trim().isNotEmpty) ...[
            _SectionCard(
              title: isHi ? 'उत्तर' : 'Answer',
              accent: AppColors.success,
              trailing: solution.confidencePercent > 0
                  ? _ConfidencePill(
                      percent: solution.confidencePercent, isHi: isHi)
                  : null,
              child: SelectableText(
                solution.answer,
                style: const TextStyle(
                  fontSize: 15,
                  height: 1.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],

          if (solution.steps.isNotEmpty) ...[
            _SectionCard(
              title: isHi ? 'हल के चरण' : 'Step by step',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (var i = 0; i < solution.steps.length; i++)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 22,
                            height: 22,
                            alignment: Alignment.center,
                            decoration: const BoxDecoration(
                              color: AppColors.primaryLight,
                              shape: BoxShape.circle,
                            ),
                            child: Text(
                              '${i + 1}',
                              style: const TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w700,
                                color: AppColors.primaryDark,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: SelectableText(
                              solution.steps[i],
                              style: const TextStyle(
                                fontSize: 13.5,
                                height: 1.5,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],

          if (solution.explanation.trim().isNotEmpty &&
              solution.explanation.trim() != solution.answer.trim()) ...[
            _SectionCard(
              title: isHi ? 'समझाइए' : 'Explanation',
              child: SelectableText(
                solution.explanation,
                style: const TextStyle(
                  fontSize: 13.5,
                  height: 1.55,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],

          if (solution.formulaUsed.trim().isNotEmpty) ...[
            _SectionCard(
              title: isHi ? 'इस्तेमाल किया सूत्र' : 'Formula used',
              accent: AppColors.info,
              child: SelectableText(
                solution.formulaUsed,
                style: const TextStyle(
                  fontSize: 13.5,
                  height: 1.5,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],

          if (solution.commonMistake.trim().isNotEmpty) ...[
            _SectionCard(
              title: isHi ? 'आम गलती' : 'Common mistake',
              accent: AppColors.warning,
              child: SelectableText(
                solution.commonMistake,
                style: const TextStyle(
                  fontSize: 13.5,
                  height: 1.5,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
        ] else ...[
          // `status: 'ocr_only'` — we read the question but the solver did
          // not produce an answer. This is a first-class outcome, not an
          // error screen: the text is still useful and Foxy is one tap away.
          _SectionCard(
            title: isHi ? 'हल नहीं मिल पाया' : 'No solution yet',
            accent: AppColors.warning,
            child: Text(
              result.solveError ??
                  state.serverMessage ??
                  (isHi
                      ? 'हम सवाल पढ़ पाए, पर इसका हल नहीं बना पाए। फ़ॉक्सी से पूछकर देखें।'
                      : 'We read your question but could not solve it. Try asking Foxy.'),
              style: const TextStyle(
                fontSize: 13.5,
                height: 1.5,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          const SizedBox(height: 12),
        ],

        // ── Follow-on actions (mirrors the web page's three CTAs) ──
        _ActionsCard(result: result, isHi: isHi),

        if (result.remainingScans != null) ...[
          const SizedBox(height: 14),
          Text(
            isHi
                ? 'आज ${result.remainingScans} स्कैन बाकी हैं'
                : '${result.remainingScans} scans left today',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
          ),
        ],
      ],
    );
  }
}

/// P12 caveat shown whenever `ncert-solver` did not self-verify the answer.
class _UnverifiedNotice extends StatelessWidget {
  final bool isHi;
  const _UnverifiedNotice({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surfaceAlt,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.warning_amber_rounded,
              size: 18, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              isHi
                  ? 'यह हल जाँचा नहीं गया है। इसे अपनी NCERT किताब से मिलाकर देखें।'
                  : 'This solution was not self-verified. Please check it against your NCERT textbook.',
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.4,
                color: AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ConfidencePill extends StatelessWidget {
  final int percent;
  final bool isHi;
  const _ConfidencePill({required this.percent, required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.borderLight,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        isHi ? '$percent% भरोसा' : '$percent% confidence',
        style: const TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w600,
          color: AppColors.textSecondary,
        ),
      ),
    );
  }
}

class _ActionsCard extends ConsumerWidget {
  final ScanSolveResult result;
  final bool isHi;
  const _ActionsCard({required this.result, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final solution = result.solution;
    // Prefer the solver's own topic/concept; fall back to nothing rather than
    // shipping a truncated slice of the student's question into a URL.
    final topic = (solution?.topic.trim().isNotEmpty ?? false)
        ? solution!.topic.trim()
        : ((solution?.concept.trim().isNotEmpty ?? false)
            ? solution!.concept.trim()
            : null);
    final subject = (solution?.subject.trim().isNotEmpty ?? false)
        ? solution!.subject.trim()
        : null;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            isHi ? 'आगे क्या?' : 'What next?',
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 12),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 13),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(13),
              ),
            ),
            onPressed: () {
              final params = <String, String>{
                'mode': 'doubt',
                if (topic != null) 'topic': topic,
                if (subject != null) 'subject': subject,
              };
              context.push(Uri(path: '/chat', queryParameters: params).toString());
            },
            icon: const Icon(Icons.chat_bubble_outline, size: 18),
            label: Text(isHi ? 'फ़ॉक्सी से समझो' : 'Understand it with Foxy'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primary,
              side: const BorderSide(color: AppColors.border),
              padding: const EdgeInsets.symmetric(vertical: 13),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(13),
              ),
            ),
            onPressed: () {
              final params = <String, String>{
                if (subject != null) 'subject': subject,
              };
              context.push(
                params.isEmpty
                    ? '/quiz'
                    : Uri(path: '/quiz', queryParameters: params).toString(),
              );
            },
            icon: const Icon(Icons.quiz_outlined, size: 18),
            label: Text(isHi ? 'ऐसे ही सवाल हल करो' : 'Practise similar questions'),
          ),
          const SizedBox(height: 8),
          TextButton.icon(
            onPressed: () {
              ref.read(scanSolveProvider.notifier).reset();
              if (context.canPop()) {
                context.pop();
              } else {
                context.go('/scan');
              }
            },
            icon: const Icon(Icons.photo_camera_outlined, size: 18),
            label: Text(isHi ? 'एक और सवाल स्कैन करो' : 'Scan another question'),
          ),
        ],
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  final String title;
  final Widget child;
  final Color? accent;
  final Widget? trailing;

  const _SectionCard({
    required this.title,
    required this.child,
    this.accent,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (accent != null) ...[
                Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
                ),
                const SizedBox(width: 8),
              ],
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                    color: accent ?? AppColors.textTertiary,
                  ),
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }
}
