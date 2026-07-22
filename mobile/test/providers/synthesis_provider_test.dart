// Tests for synthesis_provider.dart's SynthesisNotifier.
//
// Follows the same fake-repository + ProviderContainer pattern as
// test/providers/dive_provider_test.dart.
//
// The load-phase tests pin the THREE-WAY distinction the web page collapses:
// unavailable (404 / flag off) vs notYet (200 no_synthesis_yet) vs error
// (5xx). The share tests pin the rule that the notifier only writes a local
// parentShareStatus on branches where the SERVER documented writing that exact
// status to the row — mobile never invents a delivery state.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/synthesis_models.dart';
import 'package:alfanumrik/data/repositories/synthesis_repository.dart';
import 'package:alfanumrik/providers/synthesis_provider.dart';

SynthesisRow _row({ParentShareStatus status = ParentShareStatus.pending}) =>
    SynthesisRow(
      id: 'run-1',
      synthesisMonth: '2026-06',
      bundle: const SynthesisBundle(
        monthLabel: '2026-06',
        weeklyArtifactIds: ['a1', 'a2'],
        masteryDelta: SynthesisMasteryDelta(
          chaptersTouched: ['Light'],
          topicsMastered: 2,
          topicsImproved: 1,
          topicsRegressed: 0,
        ),
      ),
      summaryTextEn: 'You mastered 2 topics this month.',
      summaryTextHi: 'इस महीने तुमने 2 विषयों में महारत हासिल की।',
      parentShareStatus: status,
      createdAt: '2026-07-01T00:00:00.000Z',
    );

class _FakeSynthesisRepository implements SynthesisRepository {
  SynthesisStateResult stateResult;
  ParentShareOutcome shareOutcome;

  int stateCalls = 0;
  int shareCalls = 0;
  final List<String> shareIds = [];

  _FakeSynthesisRepository({
    this.stateResult = const SynthesisNotYet(),
    this.shareOutcome = const ParentShareSent(null),
  });

  @override
  Future<SynthesisStateResult> getState() async {
    stateCalls++;
    return stateResult;
  }

  @override
  Future<ParentShareOutcome> shareToParent(String synthesisRunId) async {
    shareCalls++;
    shareIds.add(synthesisRunId);
    return shareOutcome;
  }
}

ProviderContainer _container(_FakeSynthesisRepository fake) {
  final c = ProviderContainer(overrides: [
    synthesisRepositoryProvider.overrideWithValue(fake),
  ]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('SynthesisNotifier.load', () {
    test('a ready row lands on the ready phase', () async {
      final fake = _FakeSynthesisRepository(
        stateResult: SynthesisReady(_row()),
      );
      final c = _container(fake);

      await c.read(synthesisProvider.notifier).load();
      final s = c.read(synthesisProvider);

      expect(s.phase, SynthesisPhase.ready);
      expect(s.row!.id, 'run-1');
      expect(s.row!.bundle.masteryDelta.topicsMastered, 2);
      expect(fake.stateCalls, 1);
    });

    test('404 (flag off — the CURRENT production state) is unavailable, not error',
        () async {
      final fake = _FakeSynthesisRepository(
        stateResult: const SynthesisUnavailable(),
      );
      final c = _container(fake);

      await c.read(synthesisProvider.notifier).load();
      final s = c.read(synthesisProvider);
      expect(s.phase, SynthesisPhase.unavailable);
      expect(s.errorMessage, isNull);
      expect(s.row, isNull);
    });

    test('no_synthesis_yet is its OWN phase, distinct from unavailable',
        () async {
      final fake = _FakeSynthesisRepository(stateResult: const SynthesisNotYet());
      final c = _container(fake);

      await c.read(synthesisProvider.notifier).load();
      expect(c.read(synthesisProvider).phase, SynthesisPhase.notYet);
    });

    test('a 5xx is the retriable error phase', () async {
      final fake = _FakeSynthesisRepository(
        stateResult: const SynthesisStateFailure('boom'),
      );
      final c = _container(fake);

      await c.read(synthesisProvider.notifier).load();
      final s = c.read(synthesisProvider);
      expect(s.phase, SynthesisPhase.error);
      expect(s.errorMessage, 'boom');
    });
  });

  group('SynthesisNotifier.shareWithParent', () {
    Future<ProviderContainer> ready(
      _FakeSynthesisRepository fake, {
      ParentShareStatus status = ParentShareStatus.pending,
    }) async {
      fake.stateResult = SynthesisReady(_row(status: status));
      final c = _container(fake);
      await c.read(synthesisProvider.notifier).load();
      return c;
    }

    test('a successful send writes status=sent and the SERVER timestamp',
        () async {
      final fake = _FakeSynthesisRepository(
        shareOutcome: const ParentShareSent('2026-07-02T09:00:00.000Z'),
      );
      final c = await ready(fake);

      await c.read(synthesisProvider.notifier).shareWithParent();
      final s = c.read(synthesisProvider);

      expect(s.row!.parentShareStatus, ParentShareStatus.sent);
      expect(s.row!.parentShareSentAt, '2026-07-02T09:00:00.000Z');
      expect(s.shareFeedback, ParentShareFeedback.sent);
      expect(s.isSharing, isFalse);
      expect(fake.shareIds.single, 'run-1');
    });

    test('a 200 with no sentAt leaves the timestamp null (none is invented)',
        () async {
      final fake = _FakeSynthesisRepository(
        shareOutcome: const ParentShareSent(null),
      );
      final c = await ready(fake);

      await c.read(synthesisProvider.notifier).shareWithParent();
      final s = c.read(synthesisProvider);
      expect(s.row!.parentShareStatus, ParentShareStatus.sent);
      expect(s.row!.parentShareSentAt, isNull);
    });

    test('flagged writes status=flagged with its own feedback, NOT a failure',
        () async {
      final fake = _FakeSynthesisRepository(
        shareOutcome: const ParentShareFlagged(),
      );
      final c = await ready(fake);

      await c.read(synthesisProvider.notifier).shareWithParent();
      final s = c.read(synthesisProvider);

      expect(s.row!.parentShareStatus, ParentShareStatus.flagged);
      expect(s.shareFeedback, ParentShareFeedback.flagged);
      expect(s.shareFeedback, isNot(ParentShareFeedback.failed));
      expect(s.shareFeedback, isNot(ParentShareFeedback.deliveryFailed));
      // The row is now non-sendable — the server would just re-flag it.
      expect(s.row!.parentShareStatus.blocksSending, isTrue);
    });

    test('opted_out and delivery-failed each write the status the server wrote',
        () async {
      final optedOutFake = _FakeSynthesisRepository(
        shareOutcome: const ParentShareOptedOut(),
      );
      final c1 = await ready(optedOutFake);
      await c1.read(synthesisProvider.notifier).shareWithParent();
      expect(c1.read(synthesisProvider).row!.parentShareStatus,
          ParentShareStatus.optedOut);

      final failedFake = _FakeSynthesisRepository(
        shareOutcome: const ParentShareDeliveryFailed(),
      );
      final c2 = await ready(failedFake);
      await c2.read(synthesisProvider.notifier).shareWithParent();
      expect(c2.read(synthesisProvider).row!.parentShareStatus,
          ParentShareStatus.failed);
    });

    test('no-guardian / phone-missing / unavailable leave the status UNTOUCHED',
        () async {
      // The route does NOT write a row status on these branches, so neither
      // may mobile.
      for (final outcome in <ParentShareOutcome>[
        const ParentShareNoGuardian(),
        const ParentSharePhoneMissing(),
        const ParentShareUnavailable(),
      ]) {
        final fake = _FakeSynthesisRepository(shareOutcome: outcome);
        final c = await ready(fake);
        await c.read(synthesisProvider.notifier).shareWithParent();
        final s = c.read(synthesisProvider);
        expect(s.row!.parentShareStatus, ParentShareStatus.pending,
            reason: '$outcome must not mutate the persisted status');
        expect(s.shareFeedback, isNotNull);
        expect(s.isSharing, isFalse);
      }
    });

    test('a generic failure surfaces feedback without changing the status',
        () async {
      final fake = _FakeSynthesisRepository(
        shareOutcome: const ParentShareFailure('nope'),
      );
      final c = await ready(fake);

      await c.read(synthesisProvider.notifier).shareWithParent();
      final s = c.read(synthesisProvider);
      expect(s.shareFeedback, ParentShareFeedback.failed);
      expect(s.errorMessage, 'nope');
      expect(s.row!.parentShareStatus, ParentShareStatus.pending);
    });

    test('a blocking status short-circuits before any network call', () async {
      for (final status in <ParentShareStatus>[
        ParentShareStatus.sent,
        ParentShareStatus.optedOut,
        ParentShareStatus.flagged,
      ]) {
        final fake = _FakeSynthesisRepository();
        final c = await ready(fake, status: status);
        await c.read(synthesisProvider.notifier).shareWithParent();
        expect(fake.shareCalls, 0, reason: '$status must not be re-sendable');
      }
    });

    test('is a no-op when there is no row', () async {
      final fake = _FakeSynthesisRepository(
        stateResult: const SynthesisUnavailable(),
      );
      final c = _container(fake);
      await c.read(synthesisProvider.notifier).load();

      await c.read(synthesisProvider.notifier).shareWithParent();
      expect(fake.shareCalls, 0);
    });

    test('dismissShareFeedback clears the banner without touching the row',
        () async {
      final fake = _FakeSynthesisRepository(
        shareOutcome: const ParentShareFlagged(),
      );
      final c = await ready(fake);
      await c.read(synthesisProvider.notifier).shareWithParent();
      expect(c.read(synthesisProvider).shareFeedback, isNotNull);

      c.read(synthesisProvider.notifier).dismissShareFeedback();
      final s = c.read(synthesisProvider);
      expect(s.shareFeedback, isNull);
      expect(s.errorMessage, isNull);
      expect(s.row!.parentShareStatus, ParentShareStatus.flagged);
      expect(s.phase, SynthesisPhase.ready);
    });
  });
}
