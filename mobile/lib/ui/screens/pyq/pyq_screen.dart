import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/pyq_years.dart';
import '../../../core/services/subjects_provider.dart';
import '../../widgets/error_widget.dart';

/// `/pyq` — Previous-Year-Question LAUNCHER.
///
/// ## What this used to be, and why it changed
///
/// Until 2026-08-11 this screen was a SECOND, independent quiz runtime (~458
/// LOC): its own question renderer, its own option grid, its own inline
/// explanation, its own "session complete" screen — and its own grading, done
/// on the device by comparing the student's tap against a
/// `correct_answer_index` that `PyqRepository` had just SELECTed out of
/// `question_bank`. It was a Dart clone of the web page retired in
/// `fa01f7e32`, and carried the same two defects:
///
///   1. DATA LOSS. A student answered 25-30 board questions and the product
///      recorded nothing. No quiz session, no responses, no XP, no mastery, no
///      streak. The score lived in a Riverpod notifier and died with the route.
///      `/progress`, the leaderboard and every parent/teacher report were blind
///      to it. Zero session/submit calls existed anywhere in the PYQ stack.
///
///   2. THE ANSWER KEY WAS ON THE DEVICE. Shipping `correct_answer_index` to a
///      client is exactly what the server-owned shuffle snapshot
///      (`start_quiz_session` -> `quiz_session_shuffles`) exists to prevent.
///      The canonical mobile quiz path never receives it — every
///      `QuizQuestion` factory sets the `-1` "server-owned, do not consult"
///      sentinel. This screen received it for every question.
///
/// ## What it is now
///
/// A subject + year picker that hands off to the canonical engine:
///
///     /quiz?subject=<code>&year=<board year>&mode=practice&count=15
///
/// Everything that makes an attempt COUNT is then the standard `/quiz` path:
/// the server shuffle (`start_quiz_session`), P3 anti-cheat, P1 scoring, P2 XP
/// and the P4 atomic submit (`submit_quiz_results_v2` ->
/// `atomic_quiz_profile_update`). Nothing about scoring is decided here, and no
/// score is displayed here — `QuizScreen` owns the result surface.
///
/// The year is a question-SELECTION hint only. See
/// [QuizRepository.getQuestions] for exactly how far it currently travels and
/// the one server-side gap that stops it going further.
///
/// CONTRACT: no `correct_answer_index` is read, fetched, or compared in this
/// file — the only mentions are in this comment, explaining the removal.
/// `test/ui/pyq/pyq_launcher_test.dart` asserts that statically; if a future
/// edit reintroduces on-device grading, it fails.
///
/// P7 bilingual throughout. P13: no student data logged.
class PyqScreen extends ConsumerStatefulWidget {
  const PyqScreen({super.key});

  @override
  ConsumerState<PyqScreen> createState() => _PyqScreenState();
}

class _PyqScreenState extends ConsumerState<PyqScreen> {
  /// Questions per PYQ practice run. Must be one of the counts `/quiz`
  /// accepts (5/10/15/20) — anything else silently falls back to 10.
  static const int _questionCount = 15;

  String? _subject;
  int? _year;

  /// Derived ONCE per mount, not per build: the window must not shift
  /// mid-session if the clock ticks over midnight on 31 December while the
  /// picker is open.
  late final List<int> _years = pyqYears();

  void _start() {
    final subject = _subject;
    final year = _year;
    if (subject == null || year == null) return;
    context.push(
      '/quiz?subject=${Uri.encodeComponent(subject)}&year=$year'
      '&mode=practice&count=$_questionCount',
    );
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final subjectsAsync = ref.watch(subjectsProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '📄 PYQ अभ्यास' : '📄 PYQ Practice'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              isHi ? 'CBSE बोर्ड प्रश्नपत्र अभ्यास' : 'CBSE Board Paper Practice',
              style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
            ),
            const SizedBox(height: 20),

            // ── 1. Subject ────────────────────────────────────────────────
            Text(
              isHi ? '1. विषय चुनें' : '1. Choose Subject',
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 10),
            subjectsAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 20),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (e, _) => AppErrorWidget(
                message: e.toString(),
                onRetry: () => ref.invalidate(subjectsProvider),
              ),
              data: (subjects) {
                final unlocked =
                    subjects.where((s) => !s.isLocked).toList(growable: false);
                if (unlocked.isEmpty) {
                  return Text(
                    isHi
                        ? 'आपकी कक्षा और योजना के लिए कोई विषय उपलब्ध नहीं है।'
                        : 'No subjects available for your grade and plan.',
                    style: const TextStyle(
                        fontSize: 13, color: AppColors.textTertiary),
                  );
                }
                return Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: unlocked.map((s) {
                    final isSelected = _subject == s.code;
                    final color = AppColors.subjectColor(s.code);
                    return GestureDetector(
                      onTap: () => setState(() => _subject = s.code),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? color.withValues(alpha: 0.12)
                              : AppColors.surface,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: isSelected ? color : AppColors.borderLight,
                            width: 2,
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(s.icon,
                                style: TextStyle(fontSize: 18, color: color)),
                            const SizedBox(width: 6),
                            Text(
                              isHi ? s.nameHi : s.name,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color:
                                    isSelected ? color : AppColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }).toList(growable: false),
                );
              },
            ),

            // ── 2. Year ───────────────────────────────────────────────────
            if (_subject != null) ...[
              const SizedBox(height: 24),
              Text(
                isHi ? '2. वर्ष चुनें' : '2. Choose Year',
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _years.map((yr) {
                  final isSelected = _year == yr;
                  return GestureDetector(
                    onTap: () => setState(() => _year = yr),
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 10),
                      decoration: BoxDecoration(
                        color:
                            isSelected ? AppColors.brand : AppColors.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isSelected
                              ? AppColors.brand
                              : AppColors.borderLight,
                        ),
                      ),
                      child: Text(
                        '$yr',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: isSelected
                              ? Colors.white
                              : AppColors.textPrimary,
                        ),
                      ),
                    ),
                  );
                }).toList(growable: false),
              ),
            ],

            // ── 3. Launch ─────────────────────────────────────────────────
            if (_subject != null && _year != null) ...[
              const SizedBox(height: 28),
              ElevatedButton(
                key: const Key('pyq-start'),
                onPressed: _start,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.brand,
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(48),
                ),
                child: Text(
                  isHi
                      ? '$_questionCount प्रश्नों का अभ्यास शुरू करें →'
                      : 'Start $_questionCount-question practice →',
                ),
              ),
              const SizedBox(height: 12),
              // Said up front rather than as a badge mid-quiz. The retired
              // runtime labelled a generic question-bank pull with the year the
              // student had picked and explained it only in a small banner
              // after the quiz had already started.
              Text(
                isHi
                    ? 'यह अभ्यास सामान्य क्विज़ इंजन से चलता है, इसलिए तुम्हारा स्कोर, XP और प्रगति सेव होती है। $_year के पेपर अभी जोड़े जा रहे हैं — अगर उस वर्ष के पर्याप्त प्रश्न नहीं हैं, तो उसी विषय और कक्षा के बोर्ड-पैटर्न प्रश्न मिलेंगे।'
                    : 'This runs through the normal quiz engine, so your score, XP and progress are saved. We are still adding $_year papers — if that year is short, you will get board-pattern questions from the same subject and class.',
                style: const TextStyle(
                  fontSize: 12.5,
                  height: 1.5,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
