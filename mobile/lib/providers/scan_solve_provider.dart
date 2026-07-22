import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/scan_solve_models.dart';
import '../data/repositories/scan_solve_repository.dart';

final scanSolveRepositoryProvider =
    Provider<ScanSolveRepository>((ref) => ScanSolveRepository());

final scanImageSourceProvider =
    Provider<ScanImageSource>((ref) => ImagePickerScanImageSource());

/// Every distinct resting place of the capture → upload → solve pipeline.
///
/// There is deliberately NO single `error` bucket for the server-side failure
/// modes: each one needs different copy and a different next action, and
/// collapsing them is exactly how "Upgrade your plan" ends up rendered as
/// "Something went wrong".
enum ScanSolvePhase {
  /// Nothing captured. The capture affordances are live.
  idle,

  /// Camera/gallery sheet is open.
  capturing,

  /// The OS refused camera (or gallery) access. NOT a dead end — see
  /// [ScanSolveScreenState.canFallBackToGallery].
  permissionDenied,

  /// Bytes are in flight to `/api/scan-solve` (upload + OCR + solve).
  solving,

  /// `status: 'solved'` — question text AND an answer.
  solved,

  /// `status: 'ocr_only'` — question text, no answer. Recoverable via Foxy.
  textOnly,

  /// `status: 'ocr_failed'` — the image was unreadable. Retake.
  noText,

  /// 429 — the plan's daily scan cap is exhausted.
  limitReached,

  /// 422 — subject governance / plan gate.
  planGated,

  /// 503 — the `ai_usage_global` kill switch is off. Transient.
  unavailable,

  /// Network / unexpected server failure. Retryable with the SAME image.
  error,
}

/// Machine-readable capture-side problems that do not warrant leaving
/// [ScanSolvePhase.idle] — they surface as an inline banner while the capture
/// buttons stay live. Kept as codes (not sentences) so the screen owns all
/// bilingual copy.
///
/// Values mirror [ImagePickerScanImageSource.classifyPickerError]'s outputs
/// plus `too_large`.
typedef ScanCaptureErrorCode = String;

class ScanSolveScreenState {
  final ScanSolvePhase phase;

  /// Which affordance the OS refused. Only meaningful in
  /// [ScanSolvePhase.permissionDenied].
  final ScanCaptureSource? deniedSource;

  /// Thumbnail bytes of the captured image, kept ONLY to render the preview.
  ///
  /// P13: this class has no `toString()`/`props` override, is never passed to
  /// a logger, and is dropped by [ScanSolveNotifier.reset].
  final Uint8List? previewBytes;

  /// Server result for [ScanSolvePhase.solved] / [ScanSolvePhase.textOnly].
  final ScanSolveResult? result;

  /// Populated in [ScanSolvePhase.limitReached].
  final int usedScans;
  final int scanLimit;

  /// Populated in [ScanSolvePhase.planGated].
  final ScanSolvePlanGated? planGate;

  /// Free-form server/network copy for [ScanSolvePhase.error],
  /// [ScanSolvePhase.unavailable], [ScanSolvePhase.noText] and
  /// [ScanSolvePhase.limitReached]. Always OPTIONAL — every screen state has
  /// its own bilingual fallback copy and never depends on this being set.
  final String? serverMessage;

  /// Inline, non-blocking capture problem (see [ScanCaptureErrorCode]).
  final ScanCaptureErrorCode? captureErrorCode;

  const ScanSolveScreenState({
    this.phase = ScanSolvePhase.idle,
    this.deniedSource,
    this.previewBytes,
    this.result,
    this.usedScans = 0,
    this.scanLimit = 0,
    this.planGate,
    this.serverMessage,
    this.captureErrorCode,
  });

  /// A camera denial still leaves gallery open; a gallery denial does not.
  /// The screen uses this to decide whether to keep offering a way forward.
  bool get canFallBackToGallery =>
      phase == ScanSolvePhase.permissionDenied &&
      deniedSource == ScanCaptureSource.camera;

  /// True while the student can start a new capture.
  bool get canCapture =>
      phase != ScanSolvePhase.capturing && phase != ScanSolvePhase.solving;

  /// True when a previously captured image is still around, so a failed
  /// solve can be retried without making the student retake the photo.
  bool get canRetrySolve =>
      previewBytes != null &&
      (phase == ScanSolvePhase.error || phase == ScanSolvePhase.unavailable);

  int? get remainingScans => result?.remainingScans;

  ScanSolveScreenState copyWith({
    ScanSolvePhase? phase,
    ScanCaptureSource? deniedSource,
    bool clearDeniedSource = false,
    Uint8List? previewBytes,
    bool clearPreview = false,
    ScanSolveResult? result,
    bool clearResult = false,
    int? usedScans,
    int? scanLimit,
    ScanSolvePlanGated? planGate,
    bool clearPlanGate = false,
    String? serverMessage,
    bool clearServerMessage = false,
    ScanCaptureErrorCode? captureErrorCode,
    bool clearCaptureError = false,
  }) {
    return ScanSolveScreenState(
      phase: phase ?? this.phase,
      deniedSource: clearDeniedSource ? null : (deniedSource ?? this.deniedSource),
      previewBytes: clearPreview ? null : (previewBytes ?? this.previewBytes),
      result: clearResult ? null : (result ?? this.result),
      usedScans: usedScans ?? this.usedScans,
      scanLimit: scanLimit ?? this.scanLimit,
      planGate: clearPlanGate ? null : (planGate ?? this.planGate),
      serverMessage:
          clearServerMessage ? null : (serverMessage ?? this.serverMessage),
      captureErrorCode:
          clearCaptureError ? null : (captureErrorCode ?? this.captureErrorCode),
    );
  }
}

final scanSolveProvider =
    NotifierProvider<ScanSolveNotifier, ScanSolveScreenState>(
        ScanSolveNotifier.new);

/// Scan & Solve state machine — mobile parity for `apps/host/src/app/scan/`,
/// wired to the REAL `/api/scan-solve` pipeline (the web page still renders a
/// hardcoded `simulateOCR()` fixture; mobile does not reproduce that).
///
/// ── Graceful degradation ──────────────────────────────────────────────────
/// A camera denial NEVER dead-ends. It parks in
/// [ScanSolvePhase.permissionDenied] with [ScanSolveScreenState
/// .canFallBackToGallery] true, and the gallery path (which requires no
/// camera permission on any supported platform) stays one tap away. The only
/// state with no forward action is a gallery denial, which is a deliberate
/// OS-level choice by the user and is surfaced with settings guidance.
///
/// ── P12 / P13 ─────────────────────────────────────────────────────────────
/// Nothing in this notifier logs, prints, or reports. Image bytes and OCR
/// text live in memory for the duration of the screen and are dropped by
/// [reset]. `verified == false` solutions are still shown but the SCREEN
/// stamps them with an "check against your textbook" caveat — this notifier
/// never suppresses or rewrites solver output.
///
/// P1/P2: no score, no XP. `/api/scan-solve` awards neither and this file
/// contains no arithmetic on either.
class ScanSolveNotifier extends Notifier<ScanSolveScreenState> {
  /// Kept OUT of the public state: only [previewBytes] (the same data) is
  /// exposed, and only for rendering. This copy exists so [retrySolve] can
  /// re-post without a retake.
  List<int>? _pendingBytes;
  String? _pendingFileName;

  @override
  ScanSolveScreenState build() => const ScanSolveScreenState();

  /// Capture from [source] and immediately run the solve pipeline.
  Future<void> capture(ScanCaptureSource source, {bool isHi = false}) async {
    if (!state.canCapture) return;

    state = state.copyWith(
      phase: ScanSolvePhase.capturing,
      clearCaptureError: true,
      clearServerMessage: true,
      clearDeniedSource: true,
      clearPlanGate: true,
      clearResult: true,
    );

    final picker = ref.read(scanImageSourceProvider);
    final outcome = await picker.pick(source);

    switch (outcome) {
      case ScanCaptureCancelled():
        // Silent — backing out of the camera is not an error.
        state = state.copyWith(phase: ScanSolvePhase.idle, clearPreview: true);
        return;

      case ScanCapturePermissionDenied(source: final denied):
        state = state.copyWith(
          phase: ScanSolvePhase.permissionDenied,
          deniedSource: denied,
          clearPreview: true,
        );
        return;

      case ScanCaptureTooLarge():
        state = state.copyWith(
          phase: ScanSolvePhase.idle,
          captureErrorCode: 'too_large',
          clearPreview: true,
        );
        return;

      case ScanCaptureFailure(message: final code):
        state = state.copyWith(
          phase: ScanSolvePhase.idle,
          captureErrorCode: code,
          clearPreview: true,
        );
        return;

      case ScanCaptureSuccess(bytes: final bytes, fileName: final name):
        _pendingBytes = bytes;
        _pendingFileName = name;
        state = state.copyWith(
          phase: ScanSolvePhase.solving,
          previewBytes: Uint8List.fromList(bytes),
        );
        await _solve(isHi: isHi);
    }
  }

  /// Re-post the image already in memory. Only valid from a retryable
  /// failure ([ScanSolvePhase.error] / [ScanSolvePhase.unavailable]) — never
  /// from `limitReached` or `planGated`, which retrying cannot fix and which
  /// would burn another server round trip for a guaranteed identical answer.
  Future<void> retrySolve({bool isHi = false}) async {
    if (!state.canRetrySolve) return;
    if (_pendingBytes == null || _pendingFileName == null) return;
    state = state.copyWith(
      phase: ScanSolvePhase.solving,
      clearServerMessage: true,
    );
    await _solve(isHi: isHi);
  }

  Future<void> _solve({required bool isHi}) async {
    final bytes = _pendingBytes;
    final fileName = _pendingFileName;
    if (bytes == null || fileName == null) {
      state = state.copyWith(phase: ScanSolvePhase.error);
      return;
    }

    final repo = ref.read(scanSolveRepositoryProvider);
    final outcome = await repo.solveImage(
      bytes: bytes,
      fileName: fileName,
      isHi: isHi,
    );
    applyOutcome(outcome);
  }

  /// Folds a [ScanSolveOutcome] into the screen state. Public so the state
  /// machine can be exercised directly in tests without a fake repository
  /// round trip (and so every branch is provably distinct).
  void applyOutcome(ScanSolveOutcome outcome) {
    switch (outcome) {
      case ScanSolveSolved(result: final r):
        state = state.copyWith(phase: ScanSolvePhase.solved, result: r);

      case ScanSolveTextOnly(result: final r):
        state = state.copyWith(
          phase: ScanSolvePhase.textOnly,
          result: r,
          serverMessage: r.solveError,
        );

      case ScanSolveNoText(serverMessage: final msg):
        state = state.copyWith(
          phase: ScanSolvePhase.noText,
          serverMessage: msg,
          clearResult: true,
        );

      case ScanSolveLimitReached(
          used: final used,
          limit: final limit,
          serverMessage: final msg
        ):
        state = state.copyWith(
          phase: ScanSolvePhase.limitReached,
          usedScans: used,
          scanLimit: limit,
          serverMessage: msg,
          clearResult: true,
        );

      case ScanSolvePlanGated():
        state = state.copyWith(
          phase: ScanSolvePhase.planGated,
          planGate: outcome,
          clearResult: true,
        );

      case ScanSolveUnavailable(serverMessage: final msg):
        state = state.copyWith(
          phase: ScanSolvePhase.unavailable,
          serverMessage: msg,
          clearResult: true,
        );

      case ScanSolveFailure(message: final msg):
        state = state.copyWith(
          phase: ScanSolvePhase.error,
          serverMessage: msg,
          clearResult: true,
        );
    }
  }

  /// Dismiss the inline capture banner without touching the phase.
  void dismissCaptureError() {
    if (state.captureErrorCode == null) return;
    state = state.copyWith(clearCaptureError: true);
  }

  /// Leave the permission-denied state so the capture affordances come back
  /// (used by the "Choose from gallery instead" button).
  void acknowledgePermissionDenied() {
    if (state.phase != ScanSolvePhase.permissionDenied) return;
    state = state.copyWith(
      phase: ScanSolvePhase.idle,
      clearDeniedSource: true,
    );
  }

  /// Full teardown — also DROPS the image bytes and OCR text from memory.
  void reset() {
    _pendingBytes = null;
    _pendingFileName = null;
    state = const ScanSolveScreenState();
  }
}
