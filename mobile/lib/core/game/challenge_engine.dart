// Concept Chain game engine — pure Dart port of
// `packages/lib/src/challenge-engine.ts`. Mirrors that file's logic
// EXACTLY (chain-order verification, misplaced-card counting, ZPD-based
// card selection, hint locking). No side effects, no DB calls, no
// Flutter/widget imports — this file must stay unit-testable in isolation.
//
// Keep in sync with `challenge-engine.ts` whenever the web logic changes.
library;

import 'dart:math';

import '../../data/models/challenge_models.dart';

// ---- Internal Helpers ----

/// Fisher-Yates shuffle (returns a new list; does not mutate [input]).
/// [random] is injectable for deterministic tests.
List<T> shuffleList<T>(List<T> input, {Random? random}) {
  final rnd = random ?? Random();
  final result = List<T>.from(input);
  for (int i = result.length - 1; i > 0; i--) {
    final j = rnd.nextInt(i + 1);
    final tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

// ---- Chain Order Verification ----

/// Checks whether the submitted card order is correct.
/// Only considers non-distractor (base chain) cards. Distractors (IDs not
/// in [baseChain]) are ignored regardless of where they sit.
bool checkChainOrder(List<String> submittedIds, List<ChainCard> baseChain) {
  final chainIdSet = baseChain.map((c) => c.id).toSet();
  final sortedChain = List<ChainCard>.from(baseChain)
    ..sort((a, b) => a.position.compareTo(b.position));
  final correctOrder = sortedChain.map((c) => c.id).toList(growable: false);

  final submittedChainIds =
      submittedIds.where((id) => chainIdSet.contains(id)).toList(growable: false);

  if (submittedChainIds.length != correctOrder.length) return false;

  for (int i = 0; i < correctOrder.length; i++) {
    if (submittedChainIds[i] != correctOrder[i]) return false;
  }
  return true;
}

// ---- Misplaced Card Counting ----

/// Counts how many base chain cards are NOT in their correct position.
/// Distractors are ignored.
int countMisplacedCards(List<String> submittedIds, List<ChainCard> baseChain) {
  final chainIdSet = baseChain.map((c) => c.id).toSet();
  final sortedChain = List<ChainCard>.from(baseChain)
    ..sort((a, b) => a.position.compareTo(b.position));
  final correctOrder = sortedChain.map((c) => c.id).toList(growable: false);

  final submittedChainIds =
      submittedIds.where((id) => chainIdSet.contains(id)).toList(growable: false);

  int misplaced = 0;
  for (int i = 0; i < correctOrder.length; i++) {
    if (i >= submittedChainIds.length || submittedChainIds[i] != correctOrder[i]) {
      misplaced++;
    }
  }
  return misplaced;
}

// ---- Card Selection ----

/// Selects cards for a student based on difficulty settings. Picks
/// `cardCount` base chain cards and `distractorCount` distractors, then
/// shuffles them all together.
///
/// If fewer cards are available than requested, uses what is available.
/// [random] is injectable for deterministic tests.
StudentChallenge selectCardsForStudent(
  ChallengeData challenge,
  ChallengeDifficulty difficulty, {
  Random? random,
}) {
  final sortedChain = List<ChainCard>.from(challenge.baseChain)
    ..sort((a, b) => a.position.compareTo(b.position));
  final selectedBase = sortedChain.take(difficulty.cardCount).toList(growable: false);
  final correctOrder = selectedBase.map((c) => c.id).toList(growable: false);

  final selectedDistractors =
      challenge.distractors.take(difficulty.distractorCount).toList(growable: false);
  final distractorIds = selectedDistractors.map((c) => c.id).toList(growable: false);

  final allCards = <ChainCard>[...selectedBase, ...selectedDistractors];
  final shuffled = shuffleList(allCards, random: random);

  return StudentChallenge(
    cards: shuffled,
    correctOrder: correctOrder,
    distractorIds: distractorIds,
  );
}

// ---- Hint System ----

/// Applies a hint by locking the next correct card into its proper
/// position. Finds the first unlocked card in the correct chain order and
/// places it at its correct position, then fills remaining positions with
/// other cards in their original relative order.
///
/// Faithful port of `applyHint` in `challenge-engine.ts` — see that file
/// for the derivation. Note: because hints are always applied to the
/// earliest not-yet-locked chain card, locked cards always end up forming a
/// growing PREFIX of the output list (position 0, 1, 2, ... in order) —
/// this is relied on by the mobile UI to render locked cards as a simple
/// fixed prefix rather than tracking arbitrary locked slots.
HintResult applyHint(
  List<String> currentOrder,
  List<ChainCard> baseChain,
  List<String> alreadyLocked,
) {
  final sortedChain = List<ChainCard>.from(baseChain)
    ..sort((a, b) => a.position.compareTo(b.position));
  final lockedSet = alreadyLocked.toSet();

  ChainCard? cardToLock;
  for (final card in sortedChain) {
    if (!lockedSet.contains(card.id)) {
      cardToLock = card;
      break;
    }
  }

  // If all chain cards are already locked, return unchanged.
  if (cardToLock == null) {
    return HintResult(
      newOrder: List<String>.from(currentOrder),
      lockedIds: List<String>.from(alreadyLocked),
    );
  }

  final newLockedIds = <String>[...alreadyLocked, cardToLock.id];
  final newLockedSet = newLockedIds.toSet();

  // Build list of remaining cards (everything except the card being
  // locked, preserving order).
  final remaining = currentOrder.where((id) => id != cardToLock!.id).toList(growable: false);

  // Determine all locked chain cards and their target positions (index in
  // the sorted chain == absolute output position).
  final lockedPositions = <int, String>{};
  for (int i = 0; i < sortedChain.length; i++) {
    final chainCard = sortedChain[i];
    if (newLockedSet.contains(chainCard.id)) {
      lockedPositions[i] = chainCard.id;
    }
  }

  final nonLockedCards = remaining.where((id) => !newLockedSet.contains(id)).toList(growable: false);

  final output = List<String?>.filled(currentOrder.length, null);
  int nonLockedIdx = 0;

  // First pass: place locked cards.
  lockedPositions.forEach((pos, id) {
    if (pos < output.length) output[pos] = id;
  });

  // Second pass: fill remaining slots with non-locked cards.
  for (int i = 0; i < output.length; i++) {
    if (output[i] == null) {
      if (nonLockedIdx < nonLockedCards.length) {
        output[i] = nonLockedCards[nonLockedIdx++];
      }
    }
  }

  return HintResult(
    newOrder: output.whereType<String>().toList(growable: false),
    lockedIds: newLockedIds,
  );
}
