import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../providers/revision_provider.dart';
import '../../widgets/loading_widget.dart';

const List<(int q, String en, String hi, Color color)> _kQualityButtons = [
  (0, '😵 Forgot', '😵 भूल गया', Color(0xFFDC2626)),
  (3, '😐 Hard', '😐 कठिन', Color(0xFFD97706)),
  (4, '🙂 Good', '🙂 ठीक', Color(0xFF0891B2)),
  (5, '😎 Easy', '😎 आसान', Color(0xFF16A34A)),
];

/// Quick Recall flashcard flow — mobile parity for the card-flip + rate UI
/// in `packages/ui/src/refresh/QuickRecallSection.tsx`. Pushed at
/// `/refresh/recall` from [RevisionOverviewScreen]'s entry card.
///
/// SAFETY: rating a card calls the server (`POST /api/learner/review/grade`)
/// via [QuickRecallNotifier.rate] — the SM-2 schedule is computed entirely
/// server-side. This screen only displays the CURRENT (pre-grade) schedule
/// fields for context; it never recomputes or previews the post-grade
/// schedule.
class QuickRecallScreen extends ConsumerStatefulWidget {
  const QuickRecallScreen({super.key});

  @override
  ConsumerState<QuickRecallScreen> createState() => _QuickRecallScreenState();
}

class _QuickRecallScreenState extends ConsumerState<QuickRecallScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(quickRecallProvider.notifier).load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(quickRecallProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '⚡ झटपट याद' : '⚡ Quick Recall'),
        actions: [
          if (state.pageState == QuickRecallPageState.playing)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(
                child: Text(
                  '${state.currentIndex + 1}/${state.cards.length}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textTertiary,
                  ),
                ),
              ),
            ),
        ],
      ),
      body: SafeArea(
        child: switch (state.pageState) {
          QuickRecallPageState.loading => LoadingScreen(
              message: isHi ? 'कार्ड लोड हो रहे हैं...' : 'Loading cards...',
            ),
          QuickRecallPageState.empty => _EmptyState(isHi: isHi),
          QuickRecallPageState.playing => _PlayingState(state: state, isHi: isHi),
          QuickRecallPageState.done => _DoneState(isHi: isHi),
        },
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
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('✨', style: TextStyle(fontSize: 40)),
            const SizedBox(height: 12),
            Text(
              isHi ? 'अभी कोई कार्ड नहीं है' : 'No cards to review right now',
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => context.pop(),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
              ),
              child: Text(isHi ? 'वापस जाओ' : 'Go back'),
            ),
          ],
        ),
      ),
    );
  }
}

class _DoneState extends StatelessWidget {
  final bool isHi;
  const _DoneState({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('🎉', style: TextStyle(fontSize: 44)),
            const SizedBox(height: 12),
            Text(
              isHi ? 'बढ़िया! सारे कार्ड पूरे हुए' : 'Nice! You finished all your cards',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: () => context.pop(),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.success,
                foregroundColor: Colors.white,
              ),
              child: Text(isHi ? 'वापस जाओ' : 'Back to Refresh'),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlayingState extends ConsumerWidget {
  final QuickRecallState state;
  final bool isHi;

  const _PlayingState({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final card = state.currentCard;
    if (card == null) return _DoneState(isHi: isHi);

    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Text(
              // Quiz-review cards write `topic` as a machine composite key
              // (subject:chapter:question_id); chapterTitle is the human
              // label when present — see `RevisionCard.displayLabel`.
              '${card.subject} · ${card.displayLabel}',
              style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
            ),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: GestureDetector(
              onTap: () => ref.read(quickRecallProvider.notifier).flip(),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: state.flipped
                      ? AppColors.accent.withValues(alpha: 0.06)
                      : AppColors.surface,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: state.flipped
                        ? AppColors.accent.withValues(alpha: 0.4)
                        : AppColors.border,
                    width: 1.5,
                  ),
                ),
                child: Center(
                  child: SingleChildScrollView(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          state.flipped
                              ? (isHi ? 'उत्तर' : 'Answer')
                              : (isHi ? 'प्रश्न' : 'Question'),
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textTertiary,
                            letterSpacing: 0.6,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Text(
                          state.flipped ? card.backText : card.frontText,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: state.flipped ? 15 : 17,
                            fontWeight:
                                state.flipped ? FontWeight.w400 : FontWeight.w600,
                            height: 1.4,
                          ),
                        ),
                        if (!state.flipped && card.hint.isNotEmpty) ...[
                          const SizedBox(height: 16),
                          if (!state.showHint)
                            TextButton(
                              onPressed: () =>
                                  ref.read(quickRecallProvider.notifier).revealHint(),
                              child: Text('💡 ${isHi ? 'संकेत' : 'Hint'}'),
                            )
                          else
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF5A623).withValues(alpha: 0.08),
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text('💡 ${card.hint}'),
                            ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (state.flipped)
            Row(
              children: _kQualityButtons
                  .map(
                    (btn) => Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 3),
                        child: OutlinedButton(
                          onPressed: () =>
                              ref.read(quickRecallProvider.notifier).rate(btn.$1),
                          style: OutlinedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            foregroundColor: btn.$4,
                            side: BorderSide(color: btn.$4.withValues(alpha: 0.3)),
                            backgroundColor: btn.$4.withValues(alpha: 0.06),
                          ),
                          child: Text(
                            isHi ? btn.$3 : btn.$2,
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      ),
                    ),
                  )
                  .toList(growable: false),
            )
          else
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                isHi ? 'उत्तर देखने के लिए टैप करो' : 'Tap the card to see the answer',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
              ),
            ),
        ],
      ),
    );
  }
}
