// Data models for Scan & Solve — mobile parity for the web's
// `apps/host/src/app/scan/page.tsx` surface, but wired to the REAL solving
// pipeline rather than the web page's simulated OCR.
//
// ── What the server actually exposes (read 2026-07-22, not assumed) ────────
//
// `POST /api/scan-solve` is a SINGLE call that does the whole pipeline
// server-side: it accepts the image, uploads it to the private
// `student-scans` Storage bucket ITSELF, calls the `scan-ocr` Edge Function,
// then calls `ncert-solver`, and returns one combined body. There is no
// separate "upload then solve" handshake for this route.
//
// Two request encodings are accepted:
//   * `multipart/form-data` with an `image` File  (hard 5 MB server check)
//   * `application/json` with `{ image_base64, file_name?, subject?, grade? }`
// Mobile uses the JSON/base64 branch (one Dio call, no MultipartFile plumbing)
// and enforces the SAME 5 MB ceiling client-side — see [kScanMaxImageBytes].
//
// Response shapes, verbatim from the route:
//   200 { scan_id, status: 'solved'   , extracted_text, solution{…}, solve_error: null, remaining_scans }
//   200 { scan_id, status: 'ocr_only' , extracted_text, solution: null, solve_error: '…', remaining_scans }
//   200 { scan_id, status: 'ocr_failed', extracted_text: null, solution: null, error: '…' }
//   422 { error: <governance code>, subject, reason, allowed[] }   (subject not in the student's plan)
//   429 { error, limit_reached: true, used, limit }                (daily scan cap)
//   503 { error }  + Retry-After                                   (ai_usage_global kill switch)
//   4xx/5xx { error }
//
// NOTE — `POST /api/student/scan-upload` is deliberately NOT modelled here.
// That route only RECORDS metadata into `image_uploads` after the *client*
// has already uploaded into the public `uploads` bucket, and it hard-rejects
// any URL outside `/uploads/<caller-student-id>/`. It belongs to the web
// page's simulated-OCR flow. Mobile never performs a client-side Storage
// upload, so there is nothing for it to record; using it would create an
// orphan metadata row with no solve attached.
//
// ── P12 / P13 ─────────────────────────────────────────────────────────────
// Every field below carries student work produced by an AI/OCR pipeline.
// Nothing in this file (or in the repository/provider that use it) is ever
// written to a log, a crash breadcrumb, or an analytics payload. There is no
// `toString()` override that would splice [extractedText] or [ScanSolution]
// prose into a stack trace.
//
// P1/P2: no score and no XP exists on this surface. `/api/scan-solve` awards
// neither, and there is no XP constant anywhere in this file.
library;

import 'package:equatable/equatable.dart';

// ── Capture tuning ────────────────────────────────────────────────────────

/// Longest edge (px) any captured image is downscaled to before upload.
///
/// Indian 4G is the target network (2-5 Mbps). A raw 12 MP phone capture is
/// 3-6 MB and buys nothing: the OCR pipeline reads printed/handwritten
/// homework, which is legible far below sensor resolution. 1600 px on the
/// long edge keeps ~8-10 pt text readable while landing a JPEG in the
/// 200-500 KB range — roughly a 1-2 s upload instead of 15-25 s.
const int kScanMaxImageEdge = 1600;

/// JPEG re-encode quality applied by `image_picker` during capture.
/// 78 is the knee of the quality/size curve for document photos; below ~70
/// JPEG ringing starts eating thin glyph strokes and OCR accuracy drops.
const int kScanImageQuality = 78;

/// Hard client-side ceiling, mirroring the server's multipart branch
/// (`file.size > 5 * 1024 * 1024` → 400). The JSON/base64 branch has no
/// explicit server check, so mobile enforces the documented limit itself
/// rather than relying on an incidental body-size rejection.
const int kScanMaxImageBytes = 5 * 1024 * 1024;

/// Where an image came from. Camera is the primary affordance; gallery is
/// the ALWAYS-available fallback (it needs no camera permission at all), so a
/// camera denial can never dead-end the feature.
enum ScanCaptureSource { camera, gallery }

// ── Capture outcomes ──────────────────────────────────────────────────────

/// Result of asking the platform for an image. Modelled as a union so the
/// provider can distinguish "user backed out" (silent) from "OS refused"
/// (needs a rationale + a gallery fallback) from "picture is unusable".
sealed class ScanCaptureOutcome {
  const ScanCaptureOutcome();
}

/// Bytes are already downscaled and re-encoded by the picker.
class ScanCaptureSuccess extends ScanCaptureOutcome {
  final List<int> bytes;

  /// A synthesised, PII-free name (`scan_<epochMs>.jpg`). The original
  /// device filename is deliberately discarded — it can encode album names,
  /// dates, or the student's own naming, and it reaches the server (and the
  /// `student_scans.file_name` column) untouched.
  final String fileName;

  const ScanCaptureSuccess({required this.bytes, required this.fileName});

  int get byteLength => bytes.length;
}

/// The student dismissed the camera / picker. Not an error — the UI returns
/// to idle with no message at all.
class ScanCaptureCancelled extends ScanCaptureOutcome {
  const ScanCaptureCancelled();
}

/// The OS refused access. [source] says which affordance was refused so the
/// screen can show the right rationale AND, for [ScanCaptureSource.camera],
/// keep offering gallery.
class ScanCapturePermissionDenied extends ScanCaptureOutcome {
  final ScanCaptureSource source;
  const ScanCapturePermissionDenied(this.source);

  /// True when gallery is still a viable path (camera was the thing denied).
  bool get canFallBackToGallery => source == ScanCaptureSource.camera;
}

/// Downscaling still left the file above [kScanMaxImageBytes] — vanishingly
/// rare at 1600 px / q78, but a lossless-PNG screenshot of a whiteboard can
/// do it. Distinct so the copy can say "try a photo, not a screenshot".
class ScanCaptureTooLarge extends ScanCaptureOutcome {
  final int byteLength;
  const ScanCaptureTooLarge(this.byteLength);
}

/// Anything else the platform channel threw (corrupt image, picker already
/// active, no camera hardware).
class ScanCaptureFailure extends ScanCaptureOutcome {
  final String message;
  const ScanCaptureFailure(this.message);
}

// ── Solution payload ──────────────────────────────────────────────────────

/// The `solution` object as the route assembles it (it normalises every
/// `ncert-solver` field, so each key is always present when `solution` is
/// non-null — but we still decode defensively).
///
/// `steps` is a `string[]` in `ncert-solver` (`solution.steps.push(...)`).
class ScanSolution extends Equatable {
  final String answer;
  final List<String> steps;
  final String explanation;
  final String concept;
  final String commonMistake;
  final String formulaUsed;

  /// 0..1 from `estimateConfidence()`. Presentation only.
  final double confidence;

  /// Whether the solver's own verification pass approved the answer. When
  /// false the UI must NOT present the answer as authoritative (P12).
  final bool verified;

  final String questionType;
  final String subject;
  final String topic;

  const ScanSolution({
    this.answer = '',
    this.steps = const [],
    this.explanation = '',
    this.concept = '',
    this.commonMistake = '',
    this.formulaUsed = '',
    this.confidence = 0,
    this.verified = false,
    this.questionType = 'unknown',
    this.subject = '',
    this.topic = '',
  });

  factory ScanSolution.fromJson(Map<String, dynamic> json) {
    final rawSteps = json['steps'];
    return ScanSolution(
      answer: json['answer']?.toString() ?? '',
      steps: rawSteps is List
          ? rawSteps
              .map((e) => e?.toString() ?? '')
              .where((s) => s.trim().isNotEmpty)
              .toList(growable: false)
          : const [],
      explanation: json['explanation']?.toString() ?? '',
      concept: json['concept']?.toString() ?? '',
      commonMistake: json['common_mistake']?.toString() ?? '',
      formulaUsed: json['formula_used']?.toString() ?? '',
      confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
      verified: json['verified'] == true,
      questionType: json['question_type']?.toString() ?? 'unknown',
      subject: json['subject']?.toString() ?? '',
      topic: json['topic']?.toString() ?? '',
    );
  }

  /// True when the solver produced nothing usable — the route can return a
  /// `solution` object whose every field is empty (the `ncert-solver`
  /// abstain branch returns exactly that shape with `confidence: 0`).
  bool get isEmpty =>
      answer.trim().isEmpty && explanation.trim().isEmpty && steps.isEmpty;

  /// Confidence as whole percent, for display. Never used as a gate.
  int get confidencePercent => (confidence * 100).round().clamp(0, 100);

  @override
  List<Object?> get props => [
        answer,
        steps,
        explanation,
        concept,
        commonMistake,
        formulaUsed,
        confidence,
        verified,
        questionType,
        subject,
        topic,
      ];
}

/// The 200-body of `/api/scan-solve` for the two "OCR worked" statuses.
class ScanSolveResult extends Equatable {
  final String scanId;

  /// `'solved'` or `'ocr_only'`.
  final String status;

  /// The OCR text. This IS student work — never log it.
  final String extractedText;

  /// Null when `status == 'ocr_only'`.
  final ScanSolution? solution;

  /// Server-localised "could not solve, ask Foxy" copy. Present only on
  /// `ocr_only`.
  final String? solveError;

  /// Scans left today after this one. `null` when the server omitted it.
  final int? remainingScans;

  const ScanSolveResult({
    required this.scanId,
    required this.status,
    required this.extractedText,
    this.solution,
    this.solveError,
    this.remainingScans,
  });

  factory ScanSolveResult.fromJson(Map<String, dynamic> json) {
    final rawSolution = json['solution'];
    return ScanSolveResult(
      scanId: json['scan_id']?.toString() ?? '',
      status: json['status']?.toString() ?? '',
      extractedText: json['extracted_text']?.toString() ?? '',
      solution: rawSolution is Map
          ? ScanSolution.fromJson(Map<String, dynamic>.from(rawSolution))
          : null,
      solveError: json['solve_error']?.toString(),
      remainingScans: (json['remaining_scans'] as num?)?.toInt(),
    );
  }

  bool get hasSolution => solution != null && !solution!.isEmpty;

  @override
  List<Object?> get props =>
      [scanId, status, extractedText, solution, solveError, remainingScans];
}

// ── Solve outcomes ────────────────────────────────────────────────────────

/// One branch per way `/api/scan-solve` can end. Every failure mode the route
/// encodes gets its own case — none of them collapse into a generic error,
/// because they need materially different copy and different next actions
/// (retake vs upgrade vs wait vs ask Foxy).
sealed class ScanSolveOutcome {
  const ScanSolveOutcome();
}

/// `status: 'solved'` — OCR text AND a solver answer.
class ScanSolveSolved extends ScanSolveOutcome {
  final ScanSolveResult result;
  const ScanSolveSolved(this.result);
}

/// `status: 'ocr_only'` — the text was read but `ncert-solver` failed or
/// abstained. Recoverable: the student can still send the text to Foxy.
class ScanSolveTextOnly extends ScanSolveOutcome {
  final ScanSolveResult result;
  const ScanSolveTextOnly(this.result);
}

/// `status: 'ocr_failed'` (HTTP 200 — the route is explicit that this is
/// "not a server error, just OCR failure"). The fix is a clearer photo.
class ScanSolveNoText extends ScanSolveOutcome {
  final String? scanId;

  /// The server's own bilingual copy, when present.
  final String? serverMessage;

  const ScanSolveNoText({this.scanId, this.serverMessage});
}

/// 429 — the plan's daily scan cap. `used`/`limit` come straight from the
/// route; mobile does NOT keep its own copy of `SCAN_LIMITS` (that table
/// lives server-side and is the single source of truth).
class ScanSolveLimitReached extends ScanSolveOutcome {
  final int used;
  final int limit;
  final String? serverMessage;
  const ScanSolveLimitReached({
    required this.used,
    required this.limit,
    this.serverMessage,
  });
}

/// 422 — subject governance rejected the subject this student's scan was
/// attributed to (`validateSubjectWrite`). This is the plan/stream gate.
class ScanSolvePlanGated extends ScanSolveOutcome {
  final String code;
  final String? subject;
  final String? reason;
  final List<String> allowed;
  const ScanSolvePlanGated({
    required this.code,
    this.subject,
    this.reason,
    this.allowed = const [],
  });
}

/// 503 — the `ai_usage_global` kill switch is OFF. Transient by design; the
/// route ships a `Retry-After`.
class ScanSolveUnavailable extends ScanSolveOutcome {
  final String? serverMessage;
  const ScanSolveUnavailable([this.serverMessage]);
}

/// Everything else (400 bad body, 401, 404 no student profile, 5xx, network).
class ScanSolveFailure extends ScanSolveOutcome {
  final String message;
  final int? statusCode;
  const ScanSolveFailure(this.message, [this.statusCode]);
}
