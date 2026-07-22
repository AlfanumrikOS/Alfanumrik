// Decode tests for scan_solve_models.dart, pinned to the ACTUAL response
// shapes emitted by `apps/host/src/app/api/scan-solve/route.ts` (read
// 2026-07-22) and `supabase/functions/ncert-solver/index.ts`.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/data/models/scan_solve_models.dart';

void main() {
  group('ScanSolution.fromJson', () {
    test('decodes the full solver payload the route assembles', () {
      final s = ScanSolution.fromJson(const {
        'answer': 'x = 5',
        'steps': ['3x + 5 = 20', '3x = 15', 'x = 5'],
        'explanation': 'Isolate x by subtracting 5 then dividing by 3.',
        'concept': 'Linear Equations in One Variable',
        'common_mistake': 'Dividing before subtracting.',
        'formula_used': 'ax + b = c',
        'confidence': 0.86,
        'verified': true,
        'question_type': 'numerical',
        'subject': 'math',
        'topic': 'Linear Equations in One Variable',
      });

      expect(s.answer, 'x = 5');
      expect(s.steps, ['3x + 5 = 20', '3x = 15', 'x = 5']);
      expect(s.concept, 'Linear Equations in One Variable');
      expect(s.commonMistake, 'Dividing before subtracting.');
      expect(s.formulaUsed, 'ax + b = c');
      expect(s.confidence, closeTo(0.86, 1e-9));
      expect(s.confidencePercent, 86);
      expect(s.verified, isTrue);
      expect(s.questionType, 'numerical');
      expect(s.isEmpty, isFalse);
    });

    test('drops blank steps and tolerates non-string step entries', () {
      final s = ScanSolution.fromJson(const {
        'steps': ['first', '', '   ', 42, null],
      });
      expect(s.steps, ['first', '42']);
    });

    test('steps that is not a List decodes to empty, not a crash', () {
      final s = ScanSolution.fromJson(const {'steps': 'not-a-list'});
      expect(s.steps, isEmpty);
    });

    test('recognises the ncert-solver abstain shape as empty', () {
      // This is the literal body ncert-solver returns when the grounded
      // answer service abstains (index.ts lines ~346-354).
      final s = ScanSolution.fromJson(const {
        'answer': '',
        'steps': <String>[],
        'concept': '',
        'explanation': '',
        'confidence': 0,
        'verified': false,
        'question_type': 'unknown',
      });
      expect(s.isEmpty, isTrue);
      expect(s.verified, isFalse);
      expect(s.confidencePercent, 0);
    });

    test('verified is only true for a literal true (never truthy-ish)', () {
      expect(ScanSolution.fromJson(const {'verified': 'true'}).verified, isFalse);
      expect(ScanSolution.fromJson(const {'verified': 1}).verified, isFalse);
      expect(ScanSolution.fromJson(const {}).verified, isFalse);
    });

    test('confidencePercent clamps into 0..100', () {
      expect(ScanSolution.fromJson(const {'confidence': 1.4}).confidencePercent, 100);
      expect(ScanSolution.fromJson(const {'confidence': -0.5}).confidencePercent, 0);
    });
  });

  group('ScanSolveResult.fromJson', () {
    test("decodes the 'solved' body", () {
      final r = ScanSolveResult.fromJson(const {
        'scan_id': 'scan-1',
        'status': 'solved',
        'extracted_text': 'Solve: 3x + 5 = 20',
        'solution': {'answer': 'x = 5', 'verified': true},
        'solve_error': null,
        'remaining_scans': 7,
      });

      expect(r.scanId, 'scan-1');
      expect(r.status, 'solved');
      expect(r.extractedText, 'Solve: 3x + 5 = 20');
      expect(r.solution, isNotNull);
      expect(r.hasSolution, isTrue);
      expect(r.solveError, isNull);
      expect(r.remainingScans, 7);
    });

    test("decodes the 'ocr_only' body (solution null + solve_error set)", () {
      final r = ScanSolveResult.fromJson(const {
        'scan_id': 'scan-2',
        'status': 'ocr_only',
        'extracted_text': 'Define force.',
        'solution': null,
        'solve_error': 'Could not solve this question. Try asking Foxy instead.',
        'remaining_scans': 0,
      });

      expect(r.status, 'ocr_only');
      expect(r.solution, isNull);
      expect(r.hasSolution, isFalse);
      expect(r.solveError, isNotNull);
      expect(r.remainingScans, 0);
    });

    test('hasSolution is false when the solution object is present but empty',
        () {
      final r = ScanSolveResult.fromJson(const {
        'status': 'solved',
        'extracted_text': 'q',
        'solution': {'answer': '', 'explanation': '', 'steps': <String>[]},
      });
      expect(r.solution, isNotNull);
      expect(r.hasSolution, isFalse);
    });

    test('missing remaining_scans decodes to null, never 0', () {
      final r = ScanSolveResult.fromJson(const {
        'status': 'solved',
        'extracted_text': 'q',
      });
      expect(r.remainingScans, isNull);
    });
  });

  group('capture constants', () {
    test('the client ceiling matches the server multipart limit (5MB)', () {
      expect(kScanMaxImageBytes, 5 * 1024 * 1024);
    });

    test('downsizing is configured, not left at the sensor default', () {
      expect(kScanMaxImageEdge, lessThanOrEqualTo(2000));
      expect(kScanImageQuality, inInclusiveRange(60, 90));
    });
  });

  group('ScanCapturePermissionDenied', () {
    test('a camera denial can still fall back to gallery', () {
      const d = ScanCapturePermissionDenied(ScanCaptureSource.camera);
      expect(d.canFallBackToGallery, isTrue);
    });

    test('a gallery denial cannot fall back to gallery', () {
      const d = ScanCapturePermissionDenied(ScanCaptureSource.gallery);
      expect(d.canFallBackToGallery, isFalse);
    });
  });
}
