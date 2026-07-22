// Tests for the pure Concept Chain game engine (challenge_engine.dart) —
// mobile parity for `packages/lib/src/challenge-engine.ts`. This is the
// highest-value port to unit-test since it is exactly analogous to how
// `challenge-engine.ts` would be tested on web (chain-order verification,
// misplaced-card counting, card selection, hint locking — all pure
// functions, no widgets, no network).
library;

import 'dart:math';

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/game/challenge_engine.dart';
import 'package:alfanumrik/data/models/challenge_models.dart';

ChainCard _card(String id, int position) =>
    ChainCard(id: id, text: 'text-$id', textHi: 'hi-$id', position: position);

void main() {
  final baseChain = [_card('c1', 0), _card('c2', 1), _card('c3', 2)];

  group('checkChainOrder', () {
    test('true when chain cards are in correct order (distractors ignored)', () {
      expect(checkChainOrder(['c1', 'c2', 'c3'], baseChain), isTrue);
    });

    test('true even with distractors interspersed, as long as chain order holds', () {
      expect(checkChainOrder(['d1', 'c1', 'd2', 'c2', 'c3'], baseChain), isTrue);
    });

    test('false when chain cards are out of order', () {
      expect(checkChainOrder(['c2', 'c1', 'c3'], baseChain), isFalse);
    });

    test('false when a chain card is missing (length mismatch)', () {
      expect(checkChainOrder(['c1', 'c2'], baseChain), isFalse);
    });

    test('empty submission is false for a non-empty chain', () {
      expect(checkChainOrder([], baseChain), isFalse);
    });
  });

  group('countMisplacedCards', () {
    test('zero misplaced for a fully correct order', () {
      expect(countMisplacedCards(['c1', 'c2', 'c3'], baseChain), 0);
    });

    test('adjacent swap produces exactly 2 misplaced (both positions mismatch)', () {
      expect(countMisplacedCards(['c2', 'c1', 'c3'], baseChain), 2);
    });

    test('fully reversed 3-card chain produces 2 misplaced (middle card matches by chance)', () {
      // Reversed order: c3, c2, c1 vs correct c1, c2, c3.
      // i=0: c3 != c1 -> misplaced. i=1: c2 == c2 -> ok. i=2: c1 != c3 -> misplaced.
      expect(countMisplacedCards(['c3', 'c2', 'c1'], baseChain), 2);
    });

    test('missing trailing cards count as misplaced', () {
      expect(countMisplacedCards(['c1'], baseChain), 2);
    });

    test('distractors do not affect the count', () {
      expect(countMisplacedCards(['d1', 'c1', 'c2', 'c3'], baseChain), 0);
    });
  });

  group('selectCardsForStudent', () {
    final distractors = [_card('d1', -1), _card('d2', -1), _card('d3', -1)];
    final challenge = ChallengeData(baseChain: baseChain, distractors: distractors);

    test('selects exactly cardCount base cards + distractorCount distractors', () {
      const difficulty = ChallengeDifficulty(cardCount: 2, distractorCount: 1, band: 'low');
      final result = selectCardsForStudent(challenge, difficulty, random: Random(1));

      expect(result.correctOrder, hasLength(2));
      expect(result.distractorIds, hasLength(1));
      expect(result.cards, hasLength(3));

      // correctOrder always preserves the base chain's positional order
      // (selection takes the first `cardCount` from the SORTED chain,
      // before shuffling into `cards`).
      expect(result.correctOrder, ['c1', 'c2']);
    });

    test('clamps to available cards when difficulty asks for more than exist', () {
      const difficulty = ChallengeDifficulty(cardCount: 10, distractorCount: 10, band: 'expert');
      final result = selectCardsForStudent(challenge, difficulty, random: Random(2));

      expect(result.correctOrder, hasLength(baseChain.length));
      expect(result.distractorIds, hasLength(distractors.length));
    });

    test('cards list is a permutation of exactly the selected base + distractor ids', () {
      const difficulty = ChallengeDifficulty(cardCount: 3, distractorCount: 2, band: 'high');
      final result = selectCardsForStudent(challenge, difficulty, random: Random(3));

      final expectedIds = {'c1', 'c2', 'c3', 'd1', 'd2'};
      expect(result.cards.map((c) => c.id).toSet(), expectedIds);
    });
  });

  group('applyHint', () {
    test('first hint locks the earliest correct card into position 0', () {
      final currentOrder = ['c3', 'c1', 'c2'];
      final result = applyHint(currentOrder, baseChain, const []);

      expect(result.lockedIds, ['c1']);
      expect(result.newOrder[0], 'c1');
      expect(result.newOrder.toSet(), {'c1', 'c2', 'c3'});
    });

    test('locked cards always form a growing PREFIX across successive hints', () {
      var order = ['c3', 'c1', 'c2'];
      var locked = <String>[];

      final hint1 = applyHint(order, baseChain, locked);
      order = hint1.newOrder;
      locked = hint1.lockedIds;
      expect(order, ['c1', 'c3', 'c2']);
      expect(locked, ['c1']);

      final hint2 = applyHint(order, baseChain, locked);
      order = hint2.newOrder;
      locked = hint2.lockedIds;
      expect(order, ['c1', 'c2', 'c3']);
      expect(locked, ['c1', 'c2']);

      final hint3 = applyHint(order, baseChain, locked);
      order = hint3.newOrder;
      locked = hint3.lockedIds;
      expect(order, ['c1', 'c2', 'c3']);
      expect(locked, ['c1', 'c2', 'c3']);
    });

    test('applying a hint when all chain cards are already locked is a no-op', () {
      final order = ['c1', 'c2', 'c3'];
      final locked = ['c1', 'c2', 'c3'];
      final result = applyHint(order, baseChain, locked);

      expect(result.newOrder, order);
      expect(result.lockedIds, locked);
    });
  });
}
