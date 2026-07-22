// Tests for dive_provider.dart's two notifiers:
//   - DiveNotifier        (the /dive picker → active → saved state machine)
//   - DiveHistoryNotifier (the /dive/history aggregate fetch)
//
// Follows the same fake-repository + ProviderContainer pattern as
// test/providers/revision_provider_test.dart.
//
// SAFETY: no test asserts that the notifier PRODUCED a streak or an ISO week —
// only that it PROPAGATED the server's. `weeklyStreakCount` and
// `currentIsoWeek`/`isoWeek` are computed exclusively server-side
// (computeWeeklyStreakFromHistory / isoWeekOf); baking a derivation into a
// mobile test would invite exactly the drift these tests exist to prevent.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/network/api_result.dart';
import 'package:alfanumrik/data/models/dive_models.dart';
import 'package:alfanumrik/data/repositories/dive_repository.dart';
import 'package:alfanumrik/providers/dive_provider.dart';

DiveState _openState({
  int streak = 3,
  String isoWeek = '2026-W30',
  DivePickerOption defaultPicker = DivePickerOption.ownTopic,
}) =>
    DiveState(
      isCompleted: false,
      currentIsoWeek: isoWeek,
      lastCompletedIsoWeek: null,
      weeklyStreakCount: streak,
      defaultPicker: defaultPicker,
      showPhenomenonOption: true,
      showWeakTopicOption: true,
      showOwnTopicOption: true,
      eligiblePhenomena: const [],
      weakTopics: const [],
    );

class _FakeDiveRepository implements DiveRepository {
  /// `null` here means the repository returns `ApiSuccess(null)` — the
  /// feature-unavailable (404) signal.
  DiveState? stateValue;
  bool stateFails;

  ResolvedDive? startValue;
  bool startFails;

  DiveArtifactOutcome artifactOutcome;

  List<DiveHistoryItem>? historyValue;
  bool historyFails;

  int getStateCalls = 0;
  int startCalls = 0;
  int saveCalls = 0;
  int historyCalls = 0;
  final List<DivePickerOption> startOptions = [];
  final List<Map<String, dynamic>> saveArgs = [];

  _FakeDiveRepository({
    this.stateValue,
    this.stateFails = false,
    this.startValue,
    this.startFails = false,
    this.artifactOutcome = const DiveArtifactFailure('unset'),
    this.historyValue = const <DiveHistoryItem>[],
    this.historyFails = false,
  });

  @override
  Future<ApiResult<DiveState?>> getState() async {
    getStateCalls++;
    if (stateFails) return const ApiFailure<DiveState?>('boom');
    return ApiSuccess<DiveState?>(stateValue);
  }

  @override
  Future<ApiResult<ResolvedDive?>> start({
    required DivePickerOption option,
    String? phenomenonSlug,
    String? weakTopicId,
    String? ownTopic,
  }) async {
    startCalls++;
    startOptions.add(option);
    if (startFails) return const ApiFailure<ResolvedDive?>('boom');
    return ApiSuccess<ResolvedDive?>(startValue);
  }

  @override
  Future<DiveArtifactOutcome> saveArtifact({
    required DivePickerOption pickerOption,
    required String diveTopic,
    required List<String> diveSubjects,
    String? phenomenonSlug,
    required String title,
    required List<String> keyConcepts,
    String? workedExample,
    required String studentVoice,
  }) async {
    saveCalls++;
    saveArgs.add({
      'pickerOption': pickerOption,
      'diveTopic': diveTopic,
      'title': title,
      'keyConcepts': keyConcepts,
      'studentVoice': studentVoice,
    });
    return artifactOutcome;
  }

  @override
  Future<ApiResult<List<DiveHistoryItem>?>> getHistory({int limit = 60}) async {
    historyCalls++;
    if (historyFails) return const ApiFailure<List<DiveHistoryItem>?>('boom');
    return ApiSuccess<List<DiveHistoryItem>?>(historyValue);
  }
}

ProviderContainer _container(_FakeDiveRepository fake) {
  final c = ProviderContainer(overrides: [
    diveRepositoryProvider.overrideWithValue(fake),
  ]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('DiveNotifier.load', () {
    test('an open dive lands on the picker and carries the server streak',
        () async {
      final fake = _FakeDiveRepository(
        stateValue: _openState(streak: 3, isoWeek: '2026-W30'),
      );
      final c = _container(fake);

      await c.read(diveProvider.notifier).load();
      final s = c.read(diveProvider);

      expect(s.phase, DivePhase.picker);
      expect(s.state, isNotNull);
      expect(s.weeklyStreakCount, 3);
      expect(s.isoWeek, '2026-W30');
      expect(fake.getStateCalls, 1);
    });

    test('a completed dive lands on the completed phase', () async {
      final fake = _FakeDiveRepository(
        stateValue: const DiveState(
          isCompleted: true,
          currentIsoWeek: '2026-W30',
          weeklyStreakCount: 7,
          defaultPicker: DivePickerOption.ownTopic,
          showPhenomenonOption: false,
          showWeakTopicOption: false,
          showOwnTopicOption: true,
          eligiblePhenomena: [],
          weakTopics: [],
        ),
      );
      final c = _container(fake);

      await c.read(diveProvider.notifier).load();
      final s = c.read(diveProvider);

      expect(s.phase, DivePhase.completed);
      expect(s.weeklyStreakCount, 7);
    });

    test('a 404 (flag off) is the UNAVAILABLE phase, never the error phase',
        () async {
      final fake = _FakeDiveRepository(stateValue: null);
      final c = _container(fake);

      await c.read(diveProvider.notifier).load();
      expect(c.read(diveProvider).phase, DivePhase.unavailable);
      expect(c.read(diveProvider).errorMessage, isNull);
    });

    test('a genuine transport failure IS the error phase (retriable)', () async {
      final fake = _FakeDiveRepository(stateFails: true);
      final c = _container(fake);

      await c.read(diveProvider.notifier).load();
      expect(c.read(diveProvider).phase, DivePhase.error);
      expect(c.read(diveProvider).errorMessage, 'boom');
    });
  });

  group('DiveNotifier.commitPicker', () {
    test('a resolved dive moves picker → diveActive', () async {
      final fake = _FakeDiveRepository(
        stateValue: _openState(),
        startValue: const ResolvedDive(
          pickerOption: DivePickerOption.ownTopic,
          diveTopic: 'Black holes',
          diveSubjects: [],
        ),
      );
      final c = _container(fake);
      await c.read(diveProvider.notifier).load();

      await c.read(diveProvider.notifier).commitPicker(
            option: DivePickerOption.ownTopic,
            ownTopic: 'Black holes',
          );

      final s = c.read(diveProvider);
      expect(s.phase, DivePhase.diveActive);
      expect(s.resolved!.diveTopic, 'Black holes');
      expect(fake.startCalls, 1);
      expect(fake.startOptions.single, DivePickerOption.ownTopic);
      expect(s.isSubmitting, isFalse);
    });

    test('a start failure keeps the picker visible with an inline error',
        () async {
      final fake = _FakeDiveRepository(
        stateValue: _openState(),
        startFails: true,
      );
      final c = _container(fake);
      await c.read(diveProvider.notifier).load();

      await c
          .read(diveProvider.notifier)
          .commitPicker(option: DivePickerOption.ownTopic, ownTopic: 'x');

      final s = c.read(diveProvider);
      expect(s.phase, DivePhase.picker);
      expect(s.errorMessage, 'boom');
      expect(s.isSubmitting, isFalse);
      // The picker data survives so the student can just pick again.
      expect(s.state, isNotNull);
    });

    test('a 404 on start keeps the picker with the unavailable-option marker',
        () async {
      final fake = _FakeDiveRepository(
        stateValue: _openState(),
        startValue: null,
      );
      final c = _container(fake);
      await c.read(diveProvider.notifier).load();

      await c.read(diveProvider.notifier).commitPicker(
            option: DivePickerOption.phenomenon,
            phenomenonSlug: 'stale-slug',
          );

      final s = c.read(diveProvider);
      expect(s.phase, DivePhase.picker);
      expect(s.errorMessage, 'dive_start_unavailable');
    });

    test('is a no-op outside the picker phase', () async {
      final fake = _FakeDiveRepository(stateValue: null); // → unavailable
      final c = _container(fake);
      await c.read(diveProvider.notifier).load();

      await c
          .read(diveProvider.notifier)
          .commitPicker(option: DivePickerOption.ownTopic, ownTopic: 'x');

      expect(fake.startCalls, 0);
      expect(c.read(diveProvider).phase, DivePhase.unavailable);
    });
  });

  group('DiveNotifier.saveArtifact', () {
    Future<ProviderContainer> activeDive(_FakeDiveRepository fake) async {
      final c = _container(fake);
      await c.read(diveProvider.notifier).load();
      await c.read(diveProvider.notifier).commitPicker(
            option: DivePickerOption.ownTopic,
            ownTopic: 'Black holes',
          );
      return c;
    }

    _FakeDiveRepository baseFake(DiveArtifactOutcome outcome) =>
        _FakeDiveRepository(
          stateValue: _openState(streak: 3),
          startValue: const ResolvedDive(
            pickerOption: DivePickerOption.ownTopic,
            diveTopic: 'Black holes',
            diveSubjects: [],
          ),
          artifactOutcome: outcome,
        );

    test('a save lands on justSaved with the SERVER-returned streak', () async {
      final fake = baseFake(const DiveArtifactSaved(DiveArtifactSaveResult(
        artifactId: 'a-1',
        weeklyStreakCount: 4,
        isoWeek: '2026-W30',
      )));
      final c = await activeDive(fake);

      await c.read(diveProvider.notifier).saveArtifact(
            title: 'Black holes',
            keyConcepts: const ['event horizon'],
            studentVoice: 'I learned that light cannot escape past the horizon.',
          );

      final s = c.read(diveProvider);
      expect(s.phase, DivePhase.justSaved);
      // 4, not the 3 the state fetch reported — the server recomputed it.
      expect(s.weeklyStreakCount, 4);
      expect(s.isoWeek, '2026-W30');
      expect(fake.saveCalls, 1);
      expect(fake.saveArgs.single['keyConcepts'], ['event horizon']);
    });

    test('a 409 already-saved is treated as COMPLETED, not an error', () async {
      final fake = baseFake(const DiveArtifactAlreadySaved());
      final c = await activeDive(fake);

      await c.read(diveProvider.notifier).saveArtifact(
            title: 't',
            keyConcepts: const ['c'],
            studentVoice: 'a long enough student voice for the composer',
          );

      final s = c.read(diveProvider);
      expect(s.phase, DivePhase.completed);
      expect(s.errorMessage, isNull);
      // The 409 branch carries no body, so the streak stays the last value the
      // SERVER gave us — never a locally incremented guess.
      expect(s.weeklyStreakCount, 3);
    });

    test('a 400 keeps the composer open and exposes the server error code',
        () async {
      final fake = baseFake(const DiveArtifactInvalid('missing_student_voice'));
      final c = await activeDive(fake);

      await c.read(diveProvider.notifier).saveArtifact(
            title: 't',
            keyConcepts: const ['c'],
            studentVoice: 'short',
          );

      final s = c.read(diveProvider);
      expect(s.phase, DivePhase.diveActive);
      expect(s.artifactErrorCode, 'missing_student_voice');
      expect(s.isSubmitting, isFalse);
      expect(s.resolved, isNotNull);
    });

    test('a 404 during save drops to the unavailable phase', () async {
      final fake = baseFake(const DiveArtifactUnavailable());
      final c = await activeDive(fake);

      await c.read(diveProvider.notifier).saveArtifact(
            title: 't',
            keyConcepts: const ['c'],
            studentVoice: 'a long enough student voice for the composer',
          );

      expect(c.read(diveProvider).phase, DivePhase.unavailable);
    });

    test('a 500 keeps the composer open and retriable', () async {
      final fake = baseFake(const DiveArtifactFailure('server exploded'));
      final c = await activeDive(fake);

      await c.read(diveProvider.notifier).saveArtifact(
            title: 't',
            keyConcepts: const ['c'],
            studentVoice: 'a long enough student voice for the composer',
          );

      final s = c.read(diveProvider);
      expect(s.phase, DivePhase.diveActive);
      expect(s.errorMessage, 'server exploded');
      expect(s.isSubmitting, isFalse);
    });

    test('is a no-op outside the active phase', () async {
      final fake = baseFake(const DiveArtifactAlreadySaved());
      final c = _container(fake);
      await c.read(diveProvider.notifier).load(); // picker, not active

      await c.read(diveProvider.notifier).saveArtifact(
            title: 't',
            keyConcepts: const ['c'],
            studentVoice: 'a long enough student voice for the composer',
          );

      expect(fake.saveCalls, 0);
      expect(c.read(diveProvider).phase, DivePhase.picker);
    });
  });

  group('DiveNotifier.backToPicker / clearError', () {
    test('backToPicker returns to the picker with its data intact', () async {
      final fake = _FakeDiveRepository(
        stateValue: _openState(),
        startValue: const ResolvedDive(
          pickerOption: DivePickerOption.ownTopic,
          diveTopic: 'x',
          diveSubjects: [],
        ),
      );
      final c = _container(fake);
      await c.read(diveProvider.notifier).load();
      await c
          .read(diveProvider.notifier)
          .commitPicker(option: DivePickerOption.ownTopic, ownTopic: 'x');
      expect(c.read(diveProvider).phase, DivePhase.diveActive);

      c.read(diveProvider.notifier).backToPicker();
      final s = c.read(diveProvider);
      expect(s.phase, DivePhase.picker);
      expect(s.state, isNotNull);
      expect(s.resolved, isNull);
    });

    test('clearError clears both error channels without changing the phase',
        () async {
      final fake = _FakeDiveRepository(
        stateValue: _openState(),
        startFails: true,
      );
      final c = _container(fake);
      await c.read(diveProvider.notifier).load();
      await c
          .read(diveProvider.notifier)
          .commitPicker(option: DivePickerOption.ownTopic, ownTopic: 'x');
      expect(c.read(diveProvider).errorMessage, isNotNull);

      c.read(diveProvider.notifier).clearError();
      final s = c.read(diveProvider);
      expect(s.errorMessage, isNull);
      expect(s.artifactErrorCode, isNull);
      expect(s.phase, DivePhase.picker);
    });
  });

  group('DiveHistoryNotifier', () {
    test('rows produce the list phase', () async {
      final fake = _FakeDiveRepository(historyValue: const [
        DiveHistoryItem(
          id: 'a-1',
          isoWeek: '2026-W29',
          pickerOption: DivePickerOption.ownTopic,
          diveTopic: 'Black holes',
          diveSubjects: [],
          title: 'What I learned',
          createdAt: '2026-07-18T10:30:00.000Z',
        ),
      ]);
      final c = _container(fake);

      final h = await c.read(diveHistoryProvider.future);
      expect(h.phase, DiveHistoryPhase.list);
      expect(h.items, hasLength(1));
      expect(fake.historyCalls, 1);
    });

    test('an empty list is the EMPTY phase (a valid state, not an error)',
        () async {
      final fake = _FakeDiveRepository(historyValue: const []);
      final c = _container(fake);

      final h = await c.read(diveHistoryProvider.future);
      expect(h.phase, DiveHistoryPhase.empty);
      expect(h.items, isEmpty);
    });

    test('a 404 is the UNAVAILABLE phase, distinct from empty', () async {
      final fake = _FakeDiveRepository(historyValue: null);
      final c = _container(fake);

      final h = await c.read(diveHistoryProvider.future);
      expect(h.phase, DiveHistoryPhase.unavailable);
    });

    test('a fetch failure degrades to EMPTY, matching the web page', () async {
      final fake = _FakeDiveRepository(historyFails: true);
      final c = _container(fake);

      final h = await c.read(diveHistoryProvider.future);
      expect(h.phase, DiveHistoryPhase.empty);
    });

    test('refresh re-fetches', () async {
      final fake = _FakeDiveRepository(historyValue: const []);
      final c = _container(fake);
      await c.read(diveHistoryProvider.future);
      expect(fake.historyCalls, 1);

      await c.read(diveHistoryProvider.notifier).refresh();
      expect(fake.historyCalls, 2);
    });
  });
}
