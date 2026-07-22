// Pure-classifier tests for scan_solve_repository.dart.
//
// Both classifiers under test are `static` and network-free by design (the
// exam_repository.dart precedent), so the FULL failure matrix of
// `POST /api/scan-solve` is exercised here without a Dio mock.
//
// Every status branch is pinned to the route as READ on 2026-07-22 —
// apps/host/src/app/api/scan-solve/route.ts.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/scan_solve_models.dart';
import 'package:alfanumrik/data/repositories/scan_solve_repository.dart';

void main() {
  group('classifySolveResponse — success branches', () {
    test("200 'solved' with a real solution → ScanSolveSolved", () {
      final outcome = ScanSolveRepository.classifySolveResponse(200, const {
        'scan_id': 'scan-1',
        'status': 'solved',
        'extracted_text': 'Solve: 3x + 5 = 20',
        'solution': {'answer': 'x = 5', 'verified': true, 'confidence': 0.9},
        'solve_error': null,
        'remaining_scans': 6,
      });

      expect(outcome, isA<ScanSolveSolved>());
      final r = (outcome as ScanSolveSolved).result;
      expect(r.scanId, 'scan-1');
      expect(r.solution!.answer, 'x = 5');
      expect(r.remainingScans, 6);
    });

    test("200 'ocr_only' → ScanSolveTextOnly (NOT a failure)", () {
      final outcome = ScanSolveRepository.classifySolveResponse(200, const {
        'scan_id': 'scan-2',
        'status': 'ocr_only',
        'extracted_text': 'Define force.',
        'solution': null,
        'solve_error': 'Could not solve this question. Try asking Foxy instead.',
        'remaining_scans': 2,
      });

      expect(outcome, isA<ScanSolveTextOnly>());
      expect((outcome as ScanSolveTextOnly).result.solveError, isNotNull);
    });

    test(
        "200 'solved' with an ABSTAINED (all-empty) solution degrades to "
        'ScanSolveTextOnly rather than showing a blank answer', () {
      final outcome = ScanSolveRepository.classifySolveResponse(200, const {
        'scan_id': 'scan-3',
        'status': 'solved',
        'extracted_text': 'Some question text',
        'solution': {
          'answer': '',
          'steps': <String>[],
          'explanation': '',
          'confidence': 0,
          'verified': false,
        },
      });
      expect(outcome, isA<ScanSolveTextOnly>());
    });
  });

  group('classifySolveResponse — OCR failure (HTTP 200)', () {
    test("200 'ocr_failed' → ScanSolveNoText, carrying the server copy", () {
      final outcome = ScanSolveRepository.classifySolveResponse(200, const {
        'scan_id': 'scan-4',
        'status': 'ocr_failed',
        'extracted_text': null,
        'solution': null,
        'error': 'Could not read text from this image. Please try a clearer photo.',
      });

      expect(outcome, isA<ScanSolveNoText>());
      final o = outcome as ScanSolveNoText;
      expect(o.scanId, 'scan-4');
      expect(o.serverMessage, contains('clearer photo'));
    });

    test('200 with an empty extracted_text is treated as no-text, not success',
        () {
      final outcome = ScanSolveRepository.classifySolveResponse(200, const {
        'scan_id': 'scan-5',
        'status': 'solved',
        'extracted_text': '   ',
        'solution': {'answer': 'x = 5'},
      });
      expect(outcome, isA<ScanSolveNoText>());
    });

    test('200 with an unrecognised status and no text → ScanSolveNoText', () {
      final outcome = ScanSolveRepository.classifySolveResponse(
          200, const {'status': 'something_new'});
      expect(outcome, isA<ScanSolveNoText>());
    });
  });

  group('classifySolveResponse — plan / quota / kill-switch branches', () {
    test('429 → ScanSolveLimitReached with the server used/limit numbers', () {
      final outcome = ScanSolveRepository.classifySolveResponse(429, const {
        'error': 'Daily scan limit reached (3/3). Upgrade your plan for more scans.',
        'limit_reached': true,
        'used': 3,
        'limit': 3,
      });

      expect(outcome, isA<ScanSolveLimitReached>());
      final o = outcome as ScanSolveLimitReached;
      expect(o.used, 3);
      expect(o.limit, 3);
      expect(o.serverMessage, contains('3/3'));
    });

    test('limit_reached:true is honoured even on an unexpected status', () {
      final outcome = ScanSolveRepository.classifySolveResponse(
          403, const {'limit_reached': true, 'used': 10, 'limit': 10});
      expect(outcome, isA<ScanSolveLimitReached>());
    });

    test('429 with no used/limit still classifies (defaults to 0/0)', () {
      final outcome =
          ScanSolveRepository.classifySolveResponse(429, const {'error': 'slow down'});
      expect(outcome, isA<ScanSolveLimitReached>());
      expect((outcome as ScanSolveLimitReached).limit, 0);
    });

    test('422 → ScanSolvePlanGated carrying subject + allowed[]', () {
      final outcome = ScanSolveRepository.classifySolveResponse(422, const {
        'error': 'subject_not_allowed',
        'subject': 'physics',
        'reason': 'not_in_plan',
        'allowed': ['math', 'science'],
      });

      expect(outcome, isA<ScanSolvePlanGated>());
      final o = outcome as ScanSolvePlanGated;
      expect(o.code, 'subject_not_allowed');
      expect(o.subject, 'physics');
      expect(o.reason, 'not_in_plan');
      expect(o.allowed, ['math', 'science']);
    });

    test('422 with a malformed allowed field decodes to an empty list', () {
      final outcome = ScanSolveRepository.classifySolveResponse(
          422, const {'error': 'x', 'allowed': 'math'});
      expect((outcome as ScanSolvePlanGated).allowed, isEmpty);
    });

    test('503 → ScanSolveUnavailable (kill switch), NOT a generic failure', () {
      final outcome = ScanSolveRepository.classifySolveResponse(503, const {
        'error': 'Scan-to-solve is temporarily unavailable. Please try again in a minute.',
      });
      expect(outcome, isA<ScanSolveUnavailable>());
      expect((outcome as ScanSolveUnavailable).serverMessage,
          contains('temporarily unavailable'));
    });
  });

  group('classifySolveResponse — generic failures', () {
    test('401 → ScanSolveFailure with the status attached', () {
      final outcome = ScanSolveRepository.classifySolveResponse(
          401, const {'error': 'Unauthorized'});
      expect(outcome, isA<ScanSolveFailure>());
      expect((outcome as ScanSolveFailure).statusCode, 401);
    });

    test('404 (no student profile) → ScanSolveFailure', () {
      final outcome = ScanSolveRepository.classifySolveResponse(
          404, const {'error': 'Student profile not found'});
      expect(outcome, isA<ScanSolveFailure>());
      expect((outcome as ScanSolveFailure).message, 'Student profile not found');
    });

    test('500 with no body still yields non-empty user-facing copy', () {
      final outcome = ScanSolveRepository.classifySolveResponse(500, null);
      expect(outcome, isA<ScanSolveFailure>());
      expect((outcome as ScanSolveFailure).message, isNotEmpty);
    });

    test('a null status code (no response at all) → ScanSolveFailure', () {
      final outcome = ScanSolveRepository.classifySolveResponse(null, null);
      expect(outcome, isA<ScanSolveFailure>());
    });

    test('a non-Map body on a 2xx does not throw', () {
      final outcome =
          ScanSolveRepository.classifySolveResponse(200, 'plain text body');
      expect(outcome, isA<ScanSolveNoText>());
    });
  });

  group('ImagePickerScanImageSource.classifyPickerError', () {
    test('iOS camera denial maps to a camera permission denial', () {
      final o = ImagePickerScanImageSource.classifyPickerError(
          'camera_access_denied', ScanCaptureSource.camera);
      expect(o, isA<ScanCapturePermissionDenied>());
      expect((o as ScanCapturePermissionDenied).source, ScanCaptureSource.camera);
      expect(o.canFallBackToGallery, isTrue);
    });

    test('iOS photo denial maps to a gallery permission denial', () {
      final o = ImagePickerScanImageSource.classifyPickerError(
          'photo_access_denied', ScanCaptureSource.gallery);
      expect((o as ScanCapturePermissionDenied).source, ScanCaptureSource.gallery);
      expect(o.canFallBackToGallery, isFalse);
    });

    test("Android's generic access_denied is attributed to the asked source",
        () {
      final o = ImagePickerScanImageSource.classifyPickerError(
          'access_denied', ScanCaptureSource.camera);
      expect((o as ScanCapturePermissionDenied).source, ScanCaptureSource.camera);
    });

    test('non-permission codes never masquerade as a permission denial', () {
      for (final code in ['no_available_camera', 'already_active', 'multiple_request', 'invalid_image']) {
        final o = ImagePickerScanImageSource.classifyPickerError(
            code, ScanCaptureSource.camera);
        expect(o, isA<ScanCaptureFailure>(), reason: code);
        expect(o, isNot(isA<ScanCapturePermissionDenied>()), reason: code);
      }
    });

    test('an unknown code degrades to a generic retryable failure', () {
      final o = ImagePickerScanImageSource.classifyPickerError(
          'some_future_code', ScanCaptureSource.gallery);
      expect(o, isA<ScanCaptureFailure>());
      expect((o as ScanCaptureFailure).message, 'capture_failed');
    });

    test('a null code degrades to a generic retryable failure', () {
      final o = ImagePickerScanImageSource.classifyPickerError(
          null, ScanCaptureSource.camera);
      expect(o, isA<ScanCaptureFailure>());
    });
  });

  group('ImagePickerScanImageSource.buildCaptureOutcome', () {
    test('normal bytes succeed and get a PII-free synthesised filename', () {
      final o = ImagePickerScanImageSource.buildCaptureOutcome(
        List<int>.filled(1024, 7),
        now: DateTime.fromMillisecondsSinceEpoch(1700000000000),
      );
      expect(o, isA<ScanCaptureSuccess>());
      final s = o as ScanCaptureSuccess;
      expect(s.fileName, 'scan_1700000000000.jpg');
      expect(s.byteLength, 1024);
    });

    test('bytes over the 5MB ceiling are rejected as too large', () {
      final o = ImagePickerScanImageSource.buildCaptureOutcome(
          List<int>.filled(kScanMaxImageBytes + 1, 0));
      expect(o, isA<ScanCaptureTooLarge>());
    });

    test('exactly at the ceiling is accepted (boundary is inclusive)', () {
      final o = ImagePickerScanImageSource.buildCaptureOutcome(
          List<int>.filled(kScanMaxImageBytes, 0));
      expect(o, isA<ScanCaptureSuccess>());
    });

    test('empty bytes are a failure, never a zero-byte upload', () {
      final o = ImagePickerScanImageSource.buildCaptureOutcome(const <int>[]);
      expect(o, isA<ScanCaptureFailure>());
      expect((o as ScanCaptureFailure).message, 'capture_empty');
    });
  });
}
