import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/diagnostic_copy.dart';
import '../../../core/services/subjects_provider.dart';
import '../../../data/models/diagnostic_models.dart';
import '../../../data/models/subject.dart';
import '../../../providers/diagnostic_provider.dart';
import '../../widgets/loading_widget.dart';
import '../../widgets/quiz_question_widgets.dart';
import 'diagnostic_alternative_route.dart';

/// Diagnostic Assessment — mobile surface for
/// `POST /api/diagnostic/{start,complete}`.
///
/// Five screen states, matching the API's three non-error 200 outcomes plus the
/// local quiz/results steps. The two `diagnostic: null` outcomes
/// (insufficient content, stream required) are FIRST-CLASS screens with real
/// tappable actions — never a spinner, never a crash, never a dead end.
///
/// Deep-linked from the `first_quiz_nudge` notification type (registered in
/// `notification_type_config.dart`).
class DiagnosticScreen extends ConsumerWidget {
  const DiagnosticScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(diagnosticProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '🎯 डायग्नोस्टिक टेस्ट' : '🎯 Diagnostic Assessment'),
      ),
      body: SafeArea(
        child: switch (state.screen) {
          DiagnosticScreenState.setup => _SetupScreen(state: state, isHi: isHi),
          DiagnosticScreenState.quiz => state.currentQuestion == null
              ? _NoQuestionsScreen(isHi: isHi)
              : _QuizScreen(state: state, isHi: isHi),
          DiagnosticScreenState.results => state.summary == null
              ? const LoadingScreen()
              : _ResultsScreen(state: state, isHi: isHi),
          DiagnosticScreenState.insufficient => state.insufficient == null
              ? _NoQuestionsScreen(isHi: isHi)
              : _InsufficientContentScreen(payload: state.insufficient!, isHi: isHi),
          DiagnosticScreenState.streamRequired => state.streamRequired == null
              ? _NoQuestionsScreen(isHi: isHi)
              : _StreamRequiredScreen(payload: state.streamRequired!, isHi: isHi),
        },
      ),
    );
  }
}

// ── Setup ───────────────────────────────────────────────────────────────────

class _SetupScreen extends ConsumerWidget {
  final DiagnosticState state;
  final bool isHi;
  const _SetupScreen({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Governance-sourced subjects: grade × stream × plan aware, with the
    // server's `isLocked`. Mobile holds NO subject map of its own.
    final subjectsAsync = ref.watch(subjectsProvider);

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Center(child: Text('🎯', style: TextStyle(fontSize: 40))),
        const SizedBox(height: 12),
        Text(
          isHi
              ? '15 प्रश्नों का टेस्ट देकर जानें आप किस स्तर पर हैं।'
              : 'Answer 15 questions to discover your current level and get personalised recommendations.',
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 13, color: AppColors.textSecondary, height: 1.5),
        ),
        const SizedBox(height: 10),
        // §7.5c — the recalibrated 5/6/4 blueprint makes scores lower on
        // purpose; say so before the student starts.
        Text(
          (state.setupReassurance ?? DiagnosticCopy.setupReassurance).text(isHi),
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 12, color: AppColors.textTertiary, height: 1.5),
        ),
        const SizedBox(height: 24),
        Text(
          isHi ? 'कक्षा' : 'Grade',
          style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          // P5: `kDiagnosticGrades` holds STRINGS "6".."12".
          children: kDiagnosticGrades.map((g) {
            final isSelected = state.grade == g;
            return GestureDetector(
              onTap: () => ref.read(diagnosticProvider.notifier).selectGrade(g),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: isSelected ? AppColors.brand : AppColors.surface,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(
                      color:
                          isSelected ? AppColors.brand : AppColors.borderLight),
                ),
                child: Text(
                  isHi ? 'कक्षा $g' : 'Grade $g',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: isSelected ? Colors.white : AppColors.textPrimary,
                  ),
                ),
              ),
            );
          }).toList(growable: false),
        ),
        // §4 G3 — the server uses the PROFILE grade when it has one. Do not let
        // the picker imply otherwise.
        if (state.profileGrade.isNotEmpty && state.grade != state.profileGrade) ...[
          const SizedBox(height: 10),
          Text(
            DiagnosticCopy.gradeOverrideNote
                .fill({'grade': state.profileGrade}).text(isHi),
            style: const TextStyle(
                fontSize: 11, color: AppColors.textTertiary, height: 1.4),
          ),
        ],
        if (state.grade.isNotEmpty) ...[
          const SizedBox(height: 20),
          Text(
            isHi ? 'विषय' : 'Subject',
            style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary),
          ),
          const SizedBox(height: 8),
          subjectsAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (_, __) => _InlineNotice(
              message: DiagnosticCopy.subjectsLoadFailed,
              isHi: isHi,
              actionLabel: DiagnosticCopy.retry,
              onAction: () => ref.invalidate(subjectsProvider),
            ),
            data: (subjects) => subjects.isEmpty
                ? _EmptySubjects(isHi: isHi)
                : _SubjectGrid(
                    subjects: subjects,
                    selected: state.subject,
                    isHi: isHi,
                  ),
          ),
        ],
        if (state.missingSelection) ...[
          const SizedBox(height: 14),
          Text(
            isHi ? 'कृपया कक्षा और विषय चुनें।' : 'Please select grade and subject.',
            style: const TextStyle(
                fontSize: 12,
                color: AppColors.error,
                fontWeight: FontWeight.w600),
          ),
        ],
        if (state.setupError != null) ...[
          const SizedBox(height: 14),
          Text(
            state.setupError!.text(isHi),
            style: const TextStyle(
                fontSize: 12,
                color: AppColors.error,
                fontWeight: FontWeight.w600),
          ),
        ],
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: state.starting
              ? null
              : () => ref.read(diagnosticProvider.notifier).start(),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.brand,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          child: Text(
            state.starting
                ? (isHi ? 'लोड हो रहा है...' : 'Loading...')
                : (isHi ? 'टेस्ट शुरू करें' : 'Start Diagnostic'),
          ),
        ),
      ],
    );
  }
}

class _SubjectGrid extends ConsumerWidget {
  final List<Subject> subjects;
  final String? selected;
  final bool isHi;
  const _SubjectGrid({
    required this.subjects,
    required this.selected,
    required this.isHi,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisSpacing: 8,
      mainAxisSpacing: 8,
      childAspectRatio: 2.0,
      children: subjects.map((s) {
        final isSelected = selected == s.code;
        // Locked subjects stay VISIBLE (so the upgrade path is discoverable)
        // but are not selectable — tapping routes to plans instead of letting
        // the student hit a 422 from subject governance.
        final locked = s.isLocked;
        return Semantics(
          button: true,
          selected: isSelected,
          label: isHi ? s.nameHi : s.name,
          hint: locked ? DiagnosticCopy.lockedSubjectNote.text(isHi) : null,
          child: GestureDetector(
            onTap: () {
              if (locked) {
                context.push('/plans');
                return;
              }
              ref.read(diagnosticProvider.notifier).selectSubject(s.code);
            },
            child: Container(
              decoration: BoxDecoration(
                color: isSelected
                    ? AppColors.brand.withValues(alpha: 0.06)
                    : AppColors.surface,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: isSelected ? AppColors.brand : AppColors.borderLight,
                  width: 2,
                ),
              ),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(locked ? '🔒' : s.icon,
                      style: const TextStyle(fontSize: 16)),
                  const SizedBox(height: 2),
                  Text(
                    isHi ? s.nameHi : s.name,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: locked
                          ? AppColors.textTertiary
                          : (isSelected
                              ? AppColors.brand
                              : AppColors.textSecondary),
                    ),
                  ),
                  if (locked) ...[
                    const SizedBox(height: 2),
                    Text(
                      DiagnosticCopy.lockedSubjectNote.text(isHi),
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 9, color: AppColors.textTertiary),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      }).toList(growable: false),
    );
  }
}

/// Governance returned nothing unlocked. On grades 11-12 this is usually the
/// same root cause the API reports as `streamRequired`; either way the student
/// gets a real next action instead of an empty grid.
class _EmptySubjects extends StatelessWidget {
  final bool isHi;
  const _EmptySubjects({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            DiagnosticCopy.noSubjectsHeadline.text(isHi),
            style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary),
          ),
          const SizedBox(height: 6),
          Text(
            DiagnosticCopy.noSubjectsBody.text(isHi),
            style: const TextStyle(
                fontSize: 12, color: AppColors.textSecondary, height: 1.5),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => context.push('/chat'),
                  child: Text(DiagnosticCopy.ctaFoxy.text(isHi)),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton(
                  onPressed: () => context.push('/plans'),
                  child: Text(DiagnosticCopy.viewPlans.text(isHi)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _InlineNotice extends StatelessWidget {
  final DiagnosticBilingual message;
  final bool isHi;
  final DiagnosticBilingual actionLabel;
  final VoidCallback onAction;
  const _InlineNotice({
    required this.message,
    required this.isHi,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          message.text(isHi),
          style: const TextStyle(fontSize: 12, color: AppColors.error),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: onAction,
          child: Text(actionLabel.text(isHi)),
        ),
      ],
    );
  }
}

// ── Content-gap / stream stops (HTTP 200, diagnostic: null) ─────────────────

class _InsufficientContentScreen extends ConsumerWidget {
  final DiagnosticInsufficientContent payload;
  final bool isHi;
  const _InsufficientContentScreen({required this.payload, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The server guarantees at least one alternative (the unconditional Foxy
    // CTA). If a payload ever arrives without one, synthesise it locally so
    // this screen is structurally incapable of being a dead end.
    final alternatives = payload.alternatives.isNotEmpty
        ? payload.alternatives
        : <DiagnosticAlternative>[
            DiagnosticAlternative(
              kind: 'foxy',
              label: DiagnosticCopy.ctaFoxy,
              href: '/foxy',
            ),
          ];

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Center(child: Text('📭', style: TextStyle(fontSize: 40))),
        const SizedBox(height: 12),
        Text(
          payload.headline.text(isHi),
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary),
        ),
        const SizedBox(height: 10),
        Text(
          payload.message.text(isHi),
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 13, color: AppColors.textSecondary, height: 1.6),
        ),
        const SizedBox(height: 20),
        ...alternatives.map(
          (alt) => Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: ElevatedButton(
              onPressed: () => _onTap(context, ref, alt),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.brand,
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(48),
              ),
              child: Text(
                alt.label.text(isHi),
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ),
        const SizedBox(height: 6),
        OutlinedButton(
          onPressed: () =>
              ref.read(diagnosticProvider.notifier).retakeAnotherSubject(),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: Text(DiagnosticCopy.backToSetup.text(isHi)),
        ),
      ],
    );
  }

  void _onTap(BuildContext context, WidgetRef ref, DiagnosticAlternative alt) {
    // `other_subject` is an in-app subject switch, not a navigation — pushing
    // `/diagnostic` onto `/diagnostic` would stack a duplicate screen.
    final subjectCode = diagnosticOtherSubjectCode(alt);
    if (subjectCode != null) {
      ref.read(diagnosticProvider.notifier).switchSubjectAndRestart(subjectCode);
      return;
    }
    final route = diagnosticAlternativeRoute(alt);
    if (route != null) context.push(route);
  }
}

class _StreamRequiredScreen extends ConsumerWidget {
  final DiagnosticStreamRequired payload;
  final bool isHi;
  const _StreamRequiredScreen({required this.payload, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final options =
        payload.streamOptions.isEmpty ? kDiagnosticStreams : payload.streamOptions;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Center(child: Text('🧭', style: TextStyle(fontSize: 40))),
        const SizedBox(height: 12),
        Text(
          payload.headline.text(isHi),
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary),
        ),
        const SizedBox(height: 10),
        Text(
          payload.message.text(isHi),
          textAlign: TextAlign.center,
          style: const TextStyle(
              fontSize: 13, color: AppColors.textSecondary, height: 1.6),
        ),
        const SizedBox(height: 18),
        // Stream names are CBSE terms and stay untranslated (P7).
        Wrap(
          alignment: WrapAlignment.center,
          spacing: 8,
          runSpacing: 8,
          children: options
              .map(
                (s) => Chip(
                  label: Text(
                    _streamLabel(s),
                    style: const TextStyle(
                        fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                  backgroundColor: AppColors.surface,
                  side: const BorderSide(color: AppColors.borderLight),
                ),
              )
              .toList(growable: false),
        ),
        const SizedBox(height: 20),
        // The API deliberately sends no href for the stream picker (spec §7.4),
        // so mobile routes to its own profile surface rather than inventing a
        // server-owned destination.
        ElevatedButton(
          onPressed: () => context.push('/settings'),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.brand,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          child: Text(payload.cta.text(isHi)),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () => context.push('/chat'),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: Text(DiagnosticCopy.ctaFoxy.text(isHi)),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () =>
              ref.read(diagnosticProvider.notifier).retakeAnotherSubject(),
          child: Text(DiagnosticCopy.backToSetup.text(isHi)),
        ),
      ],
    );
  }

  /// Title-case the raw code. CBSE stream names are not translated.
  static String _streamLabel(String code) => code.isEmpty
      ? code
      : '${code[0].toUpperCase()}${code.substring(1)}';
}

// ── Quiz / results ──────────────────────────────────────────────────────────

class _NoQuestionsScreen extends ConsumerWidget {
  final bool isHi;
  const _NoQuestionsScreen({required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              DiagnosticCopy.unknownStopHeadline.text(isHi),
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary),
            ),
            const SizedBox(height: 8),
            Text(
              DiagnosticCopy.unknownStopBody.text(isHi),
              textAlign: TextAlign.center,
              style: const TextStyle(
                  fontSize: 12, color: AppColors.textSecondary, height: 1.5),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () =>
                  ref.read(diagnosticProvider.notifier).retakeAnotherSubject(),
              child: Text(DiagnosticCopy.backToSetup.text(isHi)),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: () => context.push('/chat'),
              child: Text(DiagnosticCopy.ctaFoxy.text(isHi)),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuizScreen extends ConsumerWidget {
  final DiagnosticState state;
  final bool isHi;
  const _QuizScreen({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = state.currentQuestion!;
    final total = state.questions.length;
    final progress = total == 0 ? 0.0 : state.currentIdx / total;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Column(
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  IconButton(
                    onPressed: () => ref
                        .read(diagnosticProvider.notifier)
                        .retakeAnotherSubject(),
                    icon: const Icon(Icons.arrow_back_rounded, size: 20),
                  ),
                  Text(
                    isHi
                        ? 'प्रश्न ${state.currentIdx + 1} / $total'
                        : 'Question ${state.currentIdx + 1} of $total',
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary),
                  ),
                  const SizedBox(width: 40),
                ],
              ),
              const SizedBox(height: 6),
              LinearProgressIndicator(
                value: progress,
                minHeight: 4,
                backgroundColor: AppColors.borderLight,
                valueColor: const AlwaysStoppedAnimation(AppColors.brand),
              ),
            ],
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // §7.1 — fewer than 15 items were available. Say so; the
                // result still counts.
                if (state.shortFormMessage != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.warning.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                          color: AppColors.warning.withValues(alpha: 0.3)),
                    ),
                    child: Text(
                      state.shortFormMessage!.text(isHi),
                      style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                          height: 1.5),
                    ),
                  ),
                  const SizedBox(height: 12),
                ],
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: AppColors.borderLight),
                  ),
                  child: Text(
                    q.displayText(isHi),
                    style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                        height: 1.5),
                  ),
                ),
                const SizedBox(height: 16),
                // Untimed, no immediate reveal (P3: the diagnostic is
                // XP-neutral and has no anti-cheat gate) — plain selection.
                QuestionOptionsList(
                  options: q.options,
                  selectedIndex: state.selectedOption,
                  onSelect: (i) =>
                      ref.read(diagnosticProvider.notifier).selectOption(i),
                ),
                if (state.quizError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    state.quizError!.text(isHi),
                    style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.error,
                        fontWeight: FontWeight.w600),
                  ),
                ],
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: state.selectedOption == null || state.submitting
                      ? null
                      : () => ref.read(diagnosticProvider.notifier).next(),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.brand,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(48),
                  ),
                  child: Text(
                    state.submitting
                        ? (isHi ? 'जमा हो रहा है...' : 'Submitting...')
                        : state.currentIdx < total - 1
                            ? (isHi ? 'अगला' : 'Next')
                            : (isHi ? 'परिणाम देखें' : 'See Results'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ResultsScreen extends ConsumerWidget {
  final DiagnosticState state;
  final bool isHi;
  const _ResultsScreen({required this.state, required this.isHi});

  static const Map<String, (String, String, Color)> _difficultyLabels = {
    'easy': ('Start with Easy questions', 'आसान प्रश्नों से शुरू करें', Color(0xFF16A34A)),
    'medium': ('Start with Medium questions', 'मध्यम प्रश्नों से शुरू करें', Color(0xFFD97706)),
    'hard': ('Start with Hard questions', 'कठिन प्रश्नों से शुरू करें', Color(0xFFDC2626)),
  };

  /// Server-side placement bands (`DIAGNOSTIC_PLACEMENT_THRESHOLDS`, moved to
  /// 50/80 on 2026-07-29). Used ONLY to pick an encouragement emoji/colour —
  /// the score and the recommendation itself are the server's values verbatim
  /// (P1: mobile never re-derives either).
  static const int _mediumBand = 50;
  static const int _hardBand = 80;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summary = state.summary!;
    final pct = summary.scorePercent;
    final emoji = pct >= _hardBand ? '🏆' : (pct >= _mediumBand ? '💪' : '📚');
    final tone = pct >= _hardBand
        ? AppColors.success
        : (pct >= _mediumBand ? AppColors.warning : AppColors.error);
    final diff =
        _difficultyLabels[summary.recommendedDifficulty] ?? _difficultyLabels['medium']!;
    final lowConfidence = summary.placementConfidence == 'low';

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Center(
          child: Column(
            children: [
              Text(emoji, style: const TextStyle(fontSize: 40)),
              const SizedBox(height: 8),
              Text(
                isHi ? 'डायग्नोस्टिक परिणाम' : 'Diagnostic Results',
                style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Column(
            children: [
              Text(
                '$pct%',
                style: TextStyle(
                    fontSize: 36, fontWeight: FontWeight.w800, color: tone),
              ),
              const SizedBox(height: 6),
              LinearProgressIndicator(
                value: pct / 100,
                minHeight: 8,
                backgroundColor: AppColors.borderLight,
                valueColor: AlwaysStoppedAnimation(tone),
              ),
              const SizedBox(height: 10),
              Text(
                '${summary.correctAnswers}/${summary.totalQuestions} ${isHi ? 'सही' : 'correct'}',
                style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary),
              ),
              const SizedBox(height: 4),
              Text(
                pct >= _hardBand
                    ? (isHi
                        ? 'शानदार! तुम इस विषय में अच्छे हो।'
                        : 'Great work! You have a strong foundation.')
                    : pct >= _mediumBand
                        ? (isHi
                            ? 'ठीक है! थोड़ा अभ्यास और करो।'
                            : 'Good start! A bit more practice will help.')
                        : (isHi
                            ? 'चलो मिलकर बेसिक्स मजबूत करते हैं।'
                            : "Let's build a stronger foundation together."),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: diff.$3.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: diff.$3.withValues(alpha: 0.3)),
          ),
          child: Row(
            children: [
              const Text('🎯', style: TextStyle(fontSize: 18)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isHi ? 'सुझाव' : 'Recommendation',
                      style: const TextStyle(
                          fontSize: 11, color: AppColors.textTertiary),
                    ),
                    Text(
                      isHi ? diff.$2 : diff.$1,
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: diff.$3),
                    ),
                    // §C2 — the server flagged this placement as low-confidence
                    // (under 3s per question on average). Be honest that the
                    // recommendation is a placeholder, not a verdict.
                    if (lowConfidence) ...[
                      const SizedBox(height: 4),
                      Text(
                        isHi
                            ? 'यह सुझाव अस्थायी है — प्रश्न बहुत जल्दी हल हुए। आराम से दोबारा जाँच करें तो हम बेहतर स्तर बता पाएंगे।'
                            : "This is a placeholder — the answers came in very fast. Take the check again at your own pace and we'll place you properly.",
                        style: const TextStyle(
                            fontSize: 11,
                            color: AppColors.textTertiary,
                            height: 1.4),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
        if (summary.weakTopics.isNotEmpty) ...[
          const SizedBox(height: 14),
          _TopicChipGroup(
            title: isHi ? '⚠ सुधार की जरूरत' : '⚠ Areas to strengthen',
            color: AppColors.error,
            topics: summary.weakTopics,
          ),
        ],
        if (summary.strongTopics.isNotEmpty) ...[
          const SizedBox(height: 14),
          _TopicChipGroup(
            title: isHi ? '✓ मजबूत क्षेत्र' : '✓ Strong areas',
            color: AppColors.success,
            topics: summary.strongTopics,
          ),
        ],
        if (summary.weakTopics.isEmpty && summary.strongTopics.isEmpty) ...[
          const SizedBox(height: 14),
          Text(
            isHi
                ? 'विस्तृत topic विश्लेषण उपलब्ध नहीं है। कृपया अभ्यास शुरू करें।'
                : 'Detailed topic analysis is not available. Please start practising.',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
          ),
        ],
        const SizedBox(height: 24),
        ElevatedButton(
          onPressed: () => context.push('/quiz'),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.brand,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          child: Text(isHi ? 'अभ्यास शुरू करें' : 'Start Practicing'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () =>
              ref.read(diagnosticProvider.notifier).retakeAnotherSubject(),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: Text(isHi ? 'दूसरा विषय आज़माएं' : 'Try Another Subject'),
        ),
      ],
    );
  }
}

class _TopicChipGroup extends StatelessWidget {
  final String title;
  final Color color;
  final List<String> topics;
  const _TopicChipGroup(
      {required this.title, required this.color, required this.topics});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w700, color: color)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: topics.map((t) {
              return Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: color.withValues(alpha: 0.2)),
                ),
                child: Text(t,
                    style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: color)),
              );
            }).toList(growable: false),
          ),
        ],
      ),
    );
  }
}
