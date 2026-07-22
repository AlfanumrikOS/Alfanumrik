import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../core/constants/coin_rules.dart';
import '../../../core/game/challenge_config.dart';
import '../../../core/game/challenge_engine.dart';
import '../../../core/game/challenge_streak.dart';
import '../../../data/models/challenge_models.dart';
import '../../../providers/challenge_provider.dart';
import '../../widgets/loading_widget.dart';

/// Daily Challenge (Concept Chain game) — mobile parity for
/// `apps/host/src/app/challenge/page.tsx`.
///
/// Renders the same state machine as web: loading → locked | playing |
/// solved | no-challenge. The Concept Chain game itself uses tap-select +
/// tap-swap (the web's touch fallback interaction — see
/// `packages/ui/src/challenge/ConceptChain.tsx`'s `handleTap`/`swapCards`);
/// mobile does not need the HTML5 drag-and-drop path since tap-swap is a
/// strict superset of the touch interaction web already ships.
class DailyChallengeScreen extends ConsumerStatefulWidget {
  const DailyChallengeScreen({super.key});

  @override
  ConsumerState<DailyChallengeScreen> createState() => _DailyChallengeScreenState();
}

class _DailyChallengeScreenState extends ConsumerState<DailyChallengeScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(challengeProvider.notifier).load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(challengeProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? '🧩 डेली चैलेंज' : '🧩 Daily Challenge'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(child: _StreakBadge(streak: state.streak, isHi: isHi)),
          ),
        ],
      ),
      body: SafeArea(
        child: switch (state.pageState) {
          ChallengePageState.loading => LoadingScreen(
              message: isHi ? 'चैलेंज लोड हो रहा है...' : 'Loading challenge...',
            ),
          ChallengePageState.locked => _LockedState(state: state, isHi: isHi),
          ChallengePageState.noChallenge => _NoChallengeState(isHi: isHi),
          ChallengePageState.playing => _PlayingState(state: state, isHi: isHi),
          ChallengePageState.solved => _SolvedState(state: state, isHi: isHi),
        },
      ),
    );
  }
}

/// Compact streak display — mirrors `StreakBadge.tsx`.
class _StreakBadge extends StatelessWidget {
  final StreakState streak;
  final bool isHi;
  const _StreakBadge({required this.streak, required this.isHi});

  @override
  Widget build(BuildContext context) {
    if (!shouldShowStreak(streak.currentStreak)) {
      if (streak.currentStreak <= 0) return const SizedBox.shrink();
      return Text(
        isHi ? 'स्ट्रीक शुरू करो!' : 'Start a streak!',
        style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
      );
    }

    final earnedBadges = kStreakMilestones
        .where((m) => streak.badges.contains(m.badgeId))
        .toList(growable: false);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.brand.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.brand.withValues(alpha: 0.2)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('🔥', style: TextStyle(fontSize: 14)),
          const SizedBox(width: 4),
          Text(
            '${streak.currentStreak}',
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.brand,
            ),
          ),
          for (final m in earnedBadges) ...[
            const SizedBox(width: 3),
            Text(m.badgeIcon, style: const TextStyle(fontSize: 13)),
          ],
        ],
      ),
    );
  }
}

class _LockedState extends StatelessWidget {
  final ChallengeState state;
  final bool isHi;
  const _LockedState({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final challenge = state.challenge;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const SizedBox(height: 24),
        Center(
          child: Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: AppColors.surfaceAlt,
              borderRadius: BorderRadius.circular(20),
            ),
            alignment: Alignment.center,
            child: const Text('🔒', style: TextStyle(fontSize: 32)),
          ),
        ),
        const SizedBox(height: 16),
        if (challenge != null) ...[
          Text(
            isHi ? (challenge.subjectHi ?? challenge.subject) : challenge.subject,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          if (challenge.topic != null) ...[
            const SizedBox(height: 4),
            Text(
              challenge.topic!,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
            ),
          ],
          const SizedBox(height: 12),
        ],
        Text(
          isHi
              ? 'अनलॉक करने के लिए एक क्विज़ या Foxy सेशन पूरा करो'
              : 'Complete a quiz or Foxy session to unlock',
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 28),
        ElevatedButton(
          onPressed: () => context.push('/chat'),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.brand,
            foregroundColor: Colors.white,
            minimumSize: const Size.fromHeight(48),
          ),
          child: Text(isHi ? '🦊 Foxy से बात करो' : '🦊 Chat with Foxy'),
        ),
        const SizedBox(height: 10),
        OutlinedButton(
          onPressed: () => context.push('/quiz'),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: Text(isHi ? '📝 क्विज़ खेलो' : '📝 Take a Quiz'),
        ),
        if (state.streak.currentStreak > 0) ...[
          const SizedBox(height: 20),
          Center(
            child: Text(
              isHi
                  ? 'तुम्हारी स्ट्रीक: ${state.streak.currentStreak} दिन | सबसे अच्छी: ${state.streak.bestStreak} दिन'
                  : 'Your streak: ${state.streak.currentStreak} days | Best: ${state.streak.bestStreak} days',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
            ),
          ),
        ],
      ],
    );
  }
}

class _NoChallengeState extends StatelessWidget {
  final bool isHi;
  const _NoChallengeState({required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('🧩', style: TextStyle(fontSize: 48)),
            const SizedBox(height: 16),
            Text(
              isHi ? 'चैलेंज तैयार हो रहा है' : "Today's challenge is being prepared",
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              isHi
                  ? 'कुछ देर बाद फिर से देखो। हर दिन एक नया चैलेंज आता है!'
                  : 'Check back soon. A new challenge appears every day!',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
            ),
            const SizedBox(height: 24),
            OutlinedButton(
              onPressed: () => context.go('/'),
              child: Text(isHi ? 'डैशबोर्ड पर जाओ' : 'Go to Dashboard'),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlayingState extends ConsumerWidget {
  final ChallengeState state;
  final bool isHi;
  const _PlayingState({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final studentChallenge = state.studentChallenge;
    final challenge = state.challenge;
    if (studentChallenge == null || challenge == null) {
      return const SizedBox.shrink();
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: AppColors.accentLight.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.accent.withValues(alpha: 0.15)),
          ),
          child: Row(
            children: [
              const Text('🧩', style: TextStyle(fontSize: 20)),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isHi
                          ? 'कार्ड को सही क्रम में लगाओ'
                          : 'Arrange cards in the correct order',
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    if (challenge.topic != null)
                      Text(
                        challenge.topic!,
                        style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _ConceptChainGame(
          studentChallenge: studentChallenge,
          explanation: challenge.explanation ?? '',
          explanationHi: challenge.explanationHi ?? '',
          isHi: isHi,
          onSolved: (moves, hintsUsed, distractorsExcluded) {
            ref.read(challengeProvider.notifier).handleSolved(
                  moves: moves,
                  hintsUsed: hintsUsed,
                  distractorsExcluded: distractorsExcluded,
                );
          },
        ),
      ],
    );
  }
}

/// Concept Chain game widget — port of `ConceptChain.tsx`'s tap-select +
/// tap-swap interaction (`handleTap`/`swapCards`) plus its check/hint
/// handlers, which call straight into the ported pure engine functions in
/// `challenge_engine.dart`.
class _ConceptChainGame extends StatefulWidget {
  final StudentChallenge studentChallenge;
  final String explanation;
  final String explanationHi;
  final bool isHi;
  final void Function(int moves, int hintsUsed, int distractorsExcluded) onSolved;

  const _ConceptChainGame({
    required this.studentChallenge,
    required this.explanation,
    required this.explanationHi,
    required this.isHi,
    required this.onSolved,
  });

  @override
  State<_ConceptChainGame> createState() => _ConceptChainGameState();
}

class _ConceptChainGameState extends State<_ConceptChainGame> {
  late List<String> _cardOrder;
  late Map<String, ChainCard> _cardMap;
  late List<ChainCard> _baseChain;
  late Set<String> _distractorSet;

  int _moveCount = 0;
  int _failureCount = 0;
  int _hintsUsed = 0;
  List<String> _lockedIds = const [];
  bool _solved = false;
  String? _selectedId;
  List<String> _wrongIds = const [];
  String? _feedback;

  @override
  void initState() {
    super.initState();
    _cardOrder = widget.studentChallenge.cards.map((c) => c.id).toList();
    _cardMap = {for (final c in widget.studentChallenge.cards) c.id: c};
    // Reconstruct the base chain (position = index in correctOrder) for the
    // pure engine functions — see challenge_engine.dart's applyHint doc.
    _baseChain = <ChainCard>[];
    for (int i = 0; i < widget.studentChallenge.correctOrder.length; i++) {
      final id = widget.studentChallenge.correctOrder[i];
      final existing = _cardMap[id];
      _baseChain.add(ChainCard(
        id: id,
        text: existing?.text ?? '',
        textHi: existing?.textHi ?? '',
        position: i,
      ));
    }
    _distractorSet = widget.studentChallenge.distractorIds.toSet();
  }

  void _swapCards(String fromId, String toId) {
    if (_lockedIds.contains(fromId) || _lockedIds.contains(toId)) return;
    if (fromId == toId) return;

    final fromIdx = _cardOrder.indexOf(fromId);
    final toIdx = _cardOrder.indexOf(toId);
    if (fromIdx == -1 || toIdx == -1) return;

    setState(() {
      final newOrder = List<String>.from(_cardOrder);
      final tmp = newOrder[fromIdx];
      newOrder[fromIdx] = newOrder[toIdx];
      newOrder[toIdx] = tmp;
      _cardOrder = newOrder;
      _moveCount++;
      _selectedId = null;
      _wrongIds = const [];
    });
  }

  void _handleTap(String cardId) {
    if (_lockedIds.contains(cardId) || _solved) return;
    if (_selectedId == null) {
      setState(() => _selectedId = cardId);
    } else if (_selectedId == cardId) {
      setState(() => _selectedId = null);
    } else {
      _swapCards(_selectedId!, cardId);
    }
  }

  void _handleCheck() {
    final isCorrect = checkChainOrder(_cardOrder, _baseChain);

    if (isCorrect) {
      final excludedDistractors =
          _cardOrder.where((id) => _distractorSet.contains(id)).length;
      setState(() {
        _solved = true;
        _wrongIds = const [];
        _feedback = widget.isHi ? 'सही जवाब!' : 'Correct!';
      });
      widget.onSolved(_moveCount, _hintsUsed, excludedDistractors);
    } else {
      final misplaced = countMisplacedCards(_cardOrder, _baseChain);
      final chainIdSet = widget.studentChallenge.correctOrder.toSet();
      final sortedCorrect = List<ChainCard>.from(_baseChain)
        ..sort((a, b) => a.position.compareTo(b.position));
      final correctIds = sortedCorrect.map((c) => c.id).toList(growable: false);
      final submittedChain =
          _cardOrder.where((id) => chainIdSet.contains(id)).toList(growable: false);

      final wrong = <String>[];
      for (int i = 0; i < correctIds.length; i++) {
        if (i >= submittedChain.length || submittedChain[i] != correctIds[i]) {
          if (i < submittedChain.length) wrong.add(submittedChain[i]);
        }
      }
      for (final id in widget.studentChallenge.distractorIds) {
        final idx = _cardOrder.indexOf(id);
        if (idx != -1 && idx < widget.studentChallenge.correctOrder.length) {
          wrong.add(id);
        }
      }

      setState(() {
        _wrongIds = wrong;
        _failureCount++;
        _feedback = widget.isHi
            ? '$misplaced कार्ड गलत जगह पर हैं'
            : '$misplaced card${misplaced != 1 ? 's are' : ' is'} in the wrong place';
      });
    }
  }

  void _handleHint() {
    final result = applyHint(_cardOrder, _baseChain, _lockedIds);
    setState(() {
      _cardOrder = result.newOrder;
      _lockedIds = result.lockedIds;
      _hintsUsed++;
      _wrongIds = const [];
    });
  }

  @override
  Widget build(BuildContext context) {
    final isHi = widget.isHi;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                isHi ? '$_moveCount चाल' : '$_moveCount move${_moveCount != 1 ? 's' : ''}',
                style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
              ),
              if (_hintsUsed > 0)
                Text(
                  isHi ? '$_hintsUsed हिंट' : '$_hintsUsed hint${_hintsUsed != 1 ? 's' : ''}',
                  style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
                ),
            ],
          ),
        ),
        for (final cardId in _cardOrder) _buildCard(cardId),
        if (_feedback != null) ...[
          const SizedBox(height: 8),
          Text(
            _feedback!,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: _solved ? AppColors.success : AppColors.textSecondary,
            ),
          ),
        ],
        if (_solved) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.success.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.success.withValues(alpha: 0.2)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  const Text('✅', style: TextStyle(fontSize: 16)),
                  const SizedBox(width: 6),
                  Text(
                    isHi ? 'सही जवाब!' : 'Correct!',
                    style: const TextStyle(
                        fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.success),
                  ),
                ]),
                if ((isHi ? widget.explanationHi : widget.explanation).isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    isHi ? widget.explanationHi : widget.explanation,
                    style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary),
                  ),
                ],
                const SizedBox(height: 8),
                Row(children: [
                  const Text('\u{1FA99}', style: TextStyle(fontSize: 14)),
                  const SizedBox(width: 6),
                  Text(
                    '+${CoinRewards.challengeSolve} ${isHi ? 'सिक्के' : 'coins'}',
                    style: const TextStyle(
                        fontSize: 12.5, fontWeight: FontWeight.w700, color: AppColors.xpGold),
                  ),
                ]),
              ],
            ),
          ),
        ] else ...[
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: _handleCheck,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.brand,
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(48),
            ),
            child: Text(isHi ? 'जवाब चेक करो' : 'Check Answer'),
          ),
          if (_failureCount >= 2) ...[
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _handleHint,
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              child: Text(isHi ? 'हिंट चाहिए?' : 'Need a hint?'),
            ),
          ],
        ],
      ],
    );
  }

  Widget _buildCard(String cardId) {
    final card = _cardMap[cardId];
    if (card == null) return const SizedBox.shrink();

    final isLocked = _lockedIds.contains(cardId);
    final isDistractor = _distractorSet.contains(cardId);
    final isWrong = _wrongIds.contains(cardId);
    final isSelected = _selectedId == cardId;

    Color border = AppColors.borderLight;
    if (isWrong) {
      border = AppColors.error;
    } else if (isSelected) {
      border = AppColors.brand;
    } else if (isLocked) {
      border = AppColors.accent.withValues(alpha: 0.4);
    } else if (_solved) {
      border = AppColors.success.withValues(alpha: 0.4);
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: GestureDetector(
        onTap: () => _handleTap(cardId),
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: isLocked
                ? AppColors.surfaceAlt
                : _solved
                    ? AppColors.success.withValues(alpha: 0.04)
                    : AppColors.surface,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: border, width: isSelected ? 2 : 1),
          ),
          child: Row(
            children: [
              Text(
                isLocked || _solved ? '✓' : '☰',
                style: const TextStyle(fontSize: 13, color: AppColors.textTertiary),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  widget.isHi ? card.textHi : card.text,
                  style: const TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w500, color: AppColors.textPrimary),
                ),
              ),
              if (isWrong && isDistractor)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.error.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    widget.isHi ? 'अतिरिक्त' : 'Extra',
                    style: const TextStyle(
                        fontSize: 9, fontWeight: FontWeight.w700, color: AppColors.error),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SolvedState extends StatelessWidget {
  final ChallengeState state;
  final bool isHi;
  const _SolvedState({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final attempt = state.attempt;
    final streak = state.streak;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (state.showMilestone && state.milestones.isNotEmpty)
          Consumer(builder: (context, ref, _) {
            return Container(
              margin: const EdgeInsets.only(bottom: 16),
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFFFFF7ED), Color(0xFFF5E6FF)],
                ),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.brand.withValues(alpha: 0.3)),
              ),
              child: Column(
                children: [
                  for (final m in state.milestones) ...[
                    Text(m.badgeIcon, style: const TextStyle(fontSize: 36)),
                    const SizedBox(height: 6),
                    Text(
                      isHi ? m.badgeLabelHi : m.badgeLabel,
                      style: const TextStyle(
                          fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.brand),
                    ),
                    Text(
                      '+${m.coins} ${isHi ? 'सिक्के' : 'coins'}',
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.accent),
                    ),
                    const SizedBox(height: 8),
                  ],
                  TextButton(
                    onPressed: () => ref.read(challengeProvider.notifier).dismissMilestone(),
                    child: Text(isHi ? 'आगे बढ़ो' : 'Continue'),
                  ),
                ],
              ),
            );
          }),
        if (attempt != null)
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: AppColors.borderLight),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isHi ? '🎉 चैलेंज पूरा!' : '🎉 Challenge complete!',
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _StatChip(label: isHi ? 'चालें' : 'Moves', value: '${attempt.moves}'),
                    _StatChip(
                        label: isHi ? 'हिंट' : 'Hints', value: '${attempt.hintsUsed}'),
                    _StatChip(
                        label: isHi ? 'सिक्के' : 'Coins', value: '+${attempt.coinsEarned}'),
                  ],
                ),
              ],
            ),
          ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.borderLight),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isHi ? 'स्ट्रीक' : 'Streak',
                    style: const TextStyle(fontSize: 12, color: AppColors.textTertiary),
                  ),
                  const SizedBox(height: 4),
                  Row(children: [
                    const Text('🔥', style: TextStyle(fontSize: 16)),
                    const SizedBox(width: 4),
                    Text(
                      '${streak.currentStreak}',
                      style: const TextStyle(
                          fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.brand),
                    ),
                  ]),
                ],
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    isHi ? 'सबसे अच्छी' : 'Best',
                    style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
                  ),
                  Text(
                    '${streak.bestStreak}',
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w700, color: AppColors.accent),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.accentLight.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              Text(
                isHi ? 'कल नया चैलेंज आएगा!' : 'Come back tomorrow for a new challenge!',
                textAlign: TextAlign.center,
                style: const TextStyle(
                    fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
              ),
              const SizedBox(height: 4),
              Text(
                isHi ? 'हर दिन खेलो, स्ट्रीक बढ़ाओ!' : 'Play every day to build your streak!',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 11, color: AppColors.textTertiary),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        OutlinedButton(
          onPressed: () => context.go('/'),
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          child: Text(isHi ? 'डैशबोर्ड पर जाओ' : 'Back to Dashboard'),
        ),
      ],
    );
  }
}

class _StatChip extends StatelessWidget {
  final String label;
  final String value;
  const _StatChip({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
              fontSize: 15, fontWeight: FontWeight.w700, color: AppColors.textPrimary),
        ),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(fontSize: 10, color: AppColors.textTertiary)),
      ],
    );
  }
}
