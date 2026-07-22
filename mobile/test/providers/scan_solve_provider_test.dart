// State-machine tests for scan_solve_provider.dart.
//
// Covers EVERY failure mode the pipeline can end in, each of which must land
// in its own distinct phase (permission denied, upload/network failure, OCR
// found no questions, solve failed, plan-gated, quota, kill switch) — the
// whole point of the union is that none of them collapse into one "error".
//
// Fake-repository + ProviderContainer pattern, matching
// test/providers/dive_provider_test.dart.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/scan_solve_models.dart';
import 'package:alfanumrik/data/repositories/scan_solve_repository.dart';
import 'package:alfanumrik/providers/scan_solve_provider.dart';

class _FakeImageSource implements ScanImageSource {
  ScanCaptureOutcome outcome;
  int pickCalls = 0;
  final List<ScanCaptureSource> requested = [];

  _FakeImageSource(this.outcome);

  @override
  Future<ScanCaptureOutcome> pick(ScanCaptureSource source) async {
    pickCalls++;
    requested.add(source);
    return outcome;
  }
}

class _FakeScanSolveRepository implements ScanSolveRepository {
  ScanSolveOutcome outcome;
  int solveCalls = 0;
  final List<String> fileNames = [];
  final List<bool> langs = [];

  _FakeScanSolveRepository(this.outcome);

  @override
  Future<ScanSolveOutcome> solveImage({
    required List<int> bytes,
    required String fileName,
    bool isHi = false,
  }) async {
    solveCalls++;
    fileNames.add(fileName);
    langs.add(isHi);
    return outcome;
  }
}

ScanCaptureSuccess _capture() => const ScanCaptureSuccess(
      bytes: [1, 2, 3, 4],
      fileName: 'scan_1700000000000.jpg',
    );

ScanSolveResult _solvedResult({int? remaining = 4}) => ScanSolveResult(
      scanId: 'scan-1',
      status: 'solved',
      extractedText: 'Solve: 3x + 5 = 20',
      solution: const ScanSolution(answer: 'x = 5', verified: true),
      remainingScans: remaining,
    );

ProviderContainer _container({
  required _FakeImageSource source,
  required _FakeScanSolveRepository repo,
}) {
  final c = ProviderContainer(overrides: [
    scanImageSourceProvider.overrideWithValue(source),
    scanSolveRepositoryProvider.overrideWithValue(repo),
  ]);
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('initial state', () {
    test('starts idle with nothing captured', () {
      final c = _container(
        source: _FakeImageSource(const ScanCaptureCancelled()),
        repo: _FakeScanSolveRepository(const ScanSolveFailure('unset')),
      );
      final s = c.read(scanSolveProvider);
      expect(s.phase, ScanSolvePhase.idle);
      expect(s.previewBytes, isNull);
      expect(s.result, isNull);
      expect(s.canCapture, isTrue);
      expect(s.canRetrySolve, isFalse);
    });
  });

  group('capture-side outcomes', () {
    test('cancelling the picker returns to idle silently (no error banner)',
        () async {
      final source = _FakeImageSource(const ScanCaptureCancelled());
      final repo = _FakeScanSolveRepository(const ScanSolveFailure('unset'));
      final c = _container(source: source, repo: repo);

      await c.read(scanSolveProvider.notifier).capture(ScanCaptureSource.camera);

      final s = c.read(scanSolveProvider);
      expect(s.phase, ScanSolvePhase.idle);
      expect(s.captureErrorCode, isNull);
      expect(repo.solveCalls, 0);
    });

    test(
        'CAMERA permission denial parks in permissionDenied and STILL offers '
        'gallery (never a dead end)', () async {
      final source = _FakeImageSource(
          const ScanCapturePermissionDenied(ScanCaptureSource.camera));
      final repo = _FakeScanSolveRepository(const ScanSolveFailure('unset'));
      final c = _container(source: source, repo: repo);

      await c.read(scanSolveProvider.notifier).capture(ScanCaptureSource.camera);

      final s = c.read(scanSolveProvider);
      expect(s.phase, ScanSolvePhase.permissionDenied);
      expect(s.deniedSource, ScanCaptureSource.camera);
      expect(s.canFallBackToGallery, isTrue);
      expect(repo.solveCalls, 0, reason: 'nothing may be uploaded');
    });

    test('GALLERY permission denial reports no gallery fallback', () async {
      final source = _FakeImageSource(
          const ScanCapturePermissionDenied(ScanCaptureSource.gallery));
      final c = _container(
        source: source,
        repo: _FakeScanSolveRepository(const ScanSolveFailure('unset')),
      );

      await c.read(scanSolveProvider.notifier).capture(ScanCaptureSource.gallery);

      final s = c.read(scanSolveProvider);
      expect(s.phase, ScanSolvePhase.permissionDenied);
      expect(s.canFallBackToGallery, isFalse);
    });

    test(
        'acknowledging a denial reopens the capture affordances, and the '
        'gallery retry actually reaches the picker', () async {
      final source = _FakeImageSource(
          const ScanCapturePermissionDenied(ScanCaptureSource.camera));
      final repo = _FakeScanSolveRepository(ScanSolveSolved(_solvedResult()));
      final c = _container(source: source, repo: repo);
      final n = c.read(scanSolveProvider.notifier);

      await n.capture(ScanCaptureSource.camera);
      expect(c.read(scanSolveProvider).phase, ScanSolvePhase.permissionDenied);

      n.acknowledgePermissionDenied();
      expect(c.read(scanSolveProvider).phase, ScanSolvePhase.idle);
      expect(c.read(scanSolveProvider).deniedSource, isNull);

      // The gallery path now succeeds.
      source.outcome = _capture();
      await n.capture(ScanCaptureSource.gallery);

      expect(source.requested,
          [ScanCaptureSource.camera, ScanCaptureSource.gallery]);
      expect(c.read(scanSolveProvider).phase, ScanSolvePhase.solved);
    });

    test('an oversized image banners "too_large" without leaving idle',
        () async {
      final source = _FakeImageSource(const ScanCaptureTooLarge(9000000));
      final repo = _FakeScanSolveRepository(const ScanSolveFailure('unset'));
      final c = _container(source: source, repo: repo);

      await c.read(scanSolveProvider.notifier).capture(ScanCaptureSource.gallery);

      final s = c.read(scanSolveProvider);
      expect(s.phase, ScanSolvePhase.idle);
      expect(s.captureErrorCode, 'too_large');
      expect(s.canCapture, isTrue);
      expect(repo.solveCalls, 0);
    });

    test('a picker failure code is surfaced verbatim as the banner code',
        () async {
      final c = _container(
        source: _FakeImageSource(const ScanCaptureFailure('no_camera')),
        repo: _FakeScanSolveRepository(const ScanSolveFailure('unset')),
      );

      await c.read(scanSolveProvider.notifier).capture(ScanCaptureSource.camera);

      expect(c.read(scanSolveProvider).captureErrorCode, 'no_camera');
    });

    test('dismissing the banner clears it and nothing else', () async {
      final c = _container(
        source: _FakeImageSource(const ScanCaptureFailure('picker_busy')),
        repo: _FakeScanSolveRepository(const ScanSolveFailure('unset')),
      );
      final n = c.read(scanSolveProvider.notifier);

      await n.capture(ScanCaptureSource.camera);
      expect(c.read(scanSolveProvider).captureErrorCode, 'picker_busy');

      n.dismissCaptureError();
      expect(c.read(scanSolveProvider).captureErrorCode, isNull);
      expect(c.read(scanSolveProvider).phase, ScanSolvePhase.idle);
    });
  });

  group('solve-side outcomes — each failure mode is its own phase', () {
    Future<ScanSolveScreenState> run(ScanSolveOutcome outcome) async {
      final c = _container(
        source: _FakeImageSource(_capture()),
        repo: _FakeScanSolveRepository(outcome),
      );
      await c.read(scanSolveProvider.notifier).capture(ScanCaptureSource.camera);
      return c.read(scanSolveProvider);
    }

    test('solved → phase.solved with the server result stored verbatim',
        () async {
      final s = await run(ScanSolveSolved(_solvedResult()));
      expect(s.phase, ScanSolvePhase.solved);
      expect(s.result!.solution!.answer, 'x = 5');
      expect(s.remainingScans, 4);
      expect(s.previewBytes, isNotNull);
    });

    test('ocr_only → phase.textOnly, carrying the solve_error copy', () async {
      final s = await run(const ScanSolveTextOnly(ScanSolveResult(
        scanId: 'scan-2',
        status: 'ocr_only',
        extractedText: 'Define force.',
        solveError: 'Could not solve this question. Try asking Foxy instead.',
      )));
      expect(s.phase, ScanSolvePhase.textOnly);
      expect(s.serverMessage, contains('Foxy'));
      expect(s.result!.hasSolution, isFalse);
    });

    test('ocr_failed → phase.noText with no result attached', () async {
      final s = await run(const ScanSolveNoText(
        scanId: 'scan-3',
        serverMessage: 'Could not read text from this image.',
      ));
      expect(s.phase, ScanSolvePhase.noText);
      expect(s.result, isNull);
      expect(s.serverMessage, contains('Could not read text'));
    });

    test('429 → phase.limitReached with the server used/limit numbers',
        () async {
      final s = await run(const ScanSolveLimitReached(
        used: 3,
        limit: 3,
        serverMessage: 'Daily scan limit reached (3/3).',
      ));
      expect(s.phase, ScanSolvePhase.limitReached);
      expect(s.usedScans, 3);
      expect(s.scanLimit, 3);
    });

    test('422 → phase.planGated with the governance payload preserved',
        () async {
      final s = await run(const ScanSolvePlanGated(
        code: 'subject_not_allowed',
        subject: 'physics',
        reason: 'not_in_plan',
        allowed: ['math'],
      ));
      expect(s.phase, ScanSolvePhase.planGated);
      expect(s.planGate!.subject, 'physics');
      expect(s.planGate!.allowed, ['math']);
    });

    test('503 → phase.unavailable (distinct from a generic error)', () async {
      final s = await run(const ScanSolveUnavailable('paused'));
      expect(s.phase, ScanSolvePhase.unavailable);
      expect(s.serverMessage, 'paused');
    });

    test('network/other failure → phase.error', () async {
      final s = await run(const ScanSolveFailure('No internet connection.'));
      expect(s.phase, ScanSolvePhase.error);
      expect(s.serverMessage, 'No internet connection.');
    });

    test('all seven solve outcomes land in seven DISTINCT phases', () async {
      final phases = <ScanSolvePhase>{
        (await run(ScanSolveSolved(_solvedResult()))).phase,
        (await run(const ScanSolveTextOnly(ScanSolveResult(
          scanId: 'x',
          status: 'ocr_only',
          extractedText: 'q',
        )))).phase,
        (await run(const ScanSolveNoText())).phase,
        (await run(const ScanSolveLimitReached(used: 1, limit: 1))).phase,
        (await run(const ScanSolvePlanGated(code: 'c'))).phase,
        (await run(const ScanSolveUnavailable())).phase,
        (await run(const ScanSolveFailure('boom'))).phase,
      };
      expect(phases.length, 7);
    });
  });

  group('retry semantics', () {
    test('a network failure is retryable with the SAME image (no retake)',
        () async {
      final source = _FakeImageSource(_capture());
      final repo = _FakeScanSolveRepository(const ScanSolveFailure('offline'));
      final c = _container(source: source, repo: repo);
      final n = c.read(scanSolveProvider.notifier);

      await n.capture(ScanCaptureSource.camera);
      expect(c.read(scanSolveProvider).phase, ScanSolvePhase.error);
      expect(c.read(scanSolveProvider).canRetrySolve, isTrue);

      repo.outcome = ScanSolveSolved(_solvedResult());
      await n.retrySolve();

      expect(c.read(scanSolveProvider).phase, ScanSolvePhase.solved);
      expect(repo.solveCalls, 2);
      expect(source.pickCalls, 1, reason: 'the student never retook the photo');
      expect(repo.fileNames, ['scan_1700000000000.jpg', 'scan_1700000000000.jpg']);
    });

    test('the 503 kill-switch state is retryable too', () async {
      final repo = _FakeScanSolveRepository(const ScanSolveUnavailable());
      final c = _container(source: _FakeImageSource(_capture()), repo: repo);
      final n = c.read(scanSolveProvider.notifier);

      await n.capture(ScanCaptureSource.camera);
      expect(c.read(scanSolveProvider).canRetrySolve, isTrue);

      repo.outcome = ScanSolveSolved(_solvedResult());
      await n.retrySolve();
      expect(c.read(scanSolveProvider).phase, ScanSolvePhase.solved);
    });

    test('quota and plan-gate states are NOT retryable (no wasted round trip)',
        () async {
      for (final outcome in <ScanSolveOutcome>[
        const ScanSolveLimitReached(used: 3, limit: 3),
        const ScanSolvePlanGated(code: 'subject_not_allowed'),
        const ScanSolveNoText(),
      ]) {
        final repo = _FakeScanSolveRepository(outcome);
        final c = _container(source: _FakeImageSource(_capture()), repo: repo);
        final n = c.read(scanSolveProvider.notifier);

        await n.capture(ScanCaptureSource.camera);
        expect(c.read(scanSolveProvider).canRetrySolve, isFalse);

        await n.retrySolve();
        expect(repo.solveCalls, 1, reason: '$outcome must not re-post');
      }
    });

    test('retrySolve from idle is a no-op', () async {
      final repo = _FakeScanSolveRepository(ScanSolveSolved(_solvedResult()));
      final c = _container(source: _FakeImageSource(_capture()), repo: repo);
      await c.read(scanSolveProvider.notifier).retrySolve();
      expect(repo.solveCalls, 0);
      expect(c.read(scanSolveProvider).phase, ScanSolvePhase.idle);
    });
  });

  group('language + reset', () {
    test('isHi is forwarded to the repository (x-lang header)', () async {
      final repo = _FakeScanSolveRepository(ScanSolveSolved(_solvedResult()));
      final c = _container(source: _FakeImageSource(_capture()), repo: repo);

      await c
          .read(scanSolveProvider.notifier)
          .capture(ScanCaptureSource.camera, isHi: true);

      expect(repo.langs, [true]);
    });

    test('reset drops the preview, the result and the pending image', () async {
      final repo = _FakeScanSolveRepository(ScanSolveSolved(_solvedResult()));
      final c = _container(source: _FakeImageSource(_capture()), repo: repo);
      final n = c.read(scanSolveProvider.notifier);

      await n.capture(ScanCaptureSource.camera);
      expect(c.read(scanSolveProvider).previewBytes, isNotNull);

      n.reset();
      final s = c.read(scanSolveProvider);
      expect(s.phase, ScanSolvePhase.idle);
      expect(s.previewBytes, isNull);
      expect(s.result, isNull);
      expect(s.serverMessage, isNull);
      expect(s.captureErrorCode, isNull);

      // The retained bytes are gone, so a retry cannot silently re-post.
      await n.retrySolve();
      expect(repo.solveCalls, 1);
    });

    test('a new capture clears the previous terminal state before running',
        () async {
      final source = _FakeImageSource(_capture());
      final repo = _FakeScanSolveRepository(
          const ScanSolveLimitReached(used: 3, limit: 3));
      final c = _container(source: source, repo: repo);
      final n = c.read(scanSolveProvider.notifier);

      await n.capture(ScanCaptureSource.camera);
      expect(c.read(scanSolveProvider).phase, ScanSolvePhase.limitReached);

      repo.outcome = ScanSolveSolved(_solvedResult());
      await n.capture(ScanCaptureSource.camera);

      final s = c.read(scanSolveProvider);
      expect(s.phase, ScanSolvePhase.solved);
      expect(s.planGate, isNull);
      expect(s.result, isNotNull);
    });
  });
}
