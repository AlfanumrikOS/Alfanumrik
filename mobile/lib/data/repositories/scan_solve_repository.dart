import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:image_picker/image_picker.dart';

import '../../core/network/api_client.dart';
import '../models/scan_solve_models.dart';

/// Abstraction over camera/gallery capture so the provider's state machine is
/// testable without a platform channel. [ImagePickerScanImageSource] is the
/// only production implementation.
abstract class ScanImageSource {
  Future<ScanCaptureOutcome> pick(ScanCaptureSource source);
}

/// `image_picker`-backed capture with MANDATORY downsizing.
///
/// ── Why downsizing is not optional ────────────────────────────────────────
/// The app targets Indian 4G (2-5 Mbps). A raw capture is 3-6 MB; base64
/// inflates it another ~33% on the wire. [kScanMaxImageEdge] +
/// [kScanImageQuality] are applied by the picker itself (native-side, before
/// the bytes ever cross the platform channel), so we neither pull a 12 MP
/// bitmap into the Dart heap nor add a second image-processing package.
///
/// ── Why there is no `permission_handler` ──────────────────────────────────
/// `image_picker_android` requests `CAMERA` itself when the manifest declares
/// it, and gallery goes through the system photo picker, which needs no
/// permission at all on any supported Android version. Adding
/// `permission_handler` would only let us re-ask for permissions we already
/// get asked for, at the cost of a larger declared-permission surface.
///
/// ── P13 ───────────────────────────────────────────────────────────────────
/// The device-supplied filename is discarded and replaced with
/// `scan_<epochMs>.jpg`. Image bytes are never logged, never attached to an
/// exception message, and never stringified.
class ImagePickerScanImageSource implements ScanImageSource {
  final ImagePicker _picker;

  ImagePickerScanImageSource({ImagePicker? picker})
      : _picker = picker ?? ImagePicker();

  @override
  Future<ScanCaptureOutcome> pick(ScanCaptureSource source) async {
    try {
      final file = await _picker.pickImage(
        source: source == ScanCaptureSource.camera
            ? ImageSource.camera
            : ImageSource.gallery,
        maxWidth: kScanMaxImageEdge.toDouble(),
        maxHeight: kScanMaxImageEdge.toDouble(),
        imageQuality: kScanImageQuality,
        // Rear camera: students photograph a book/worksheet in front of them.
        preferredCameraDevice: CameraDevice.rear,
        requestFullMetadata: false,
      );
      if (file == null) return const ScanCaptureCancelled();

      final bytes = await file.readAsBytes();
      return buildCaptureOutcome(bytes);
    } on PlatformException catch (e) {
      return classifyPickerError(e.code, source);
    } catch (_) {
      // Deliberately does NOT interpolate the exception — a decoder failure
      // can echo image data into the message (P13).
      return const ScanCaptureFailure('capture_failed');
    }
  }

  // ── Pure helpers (testable without a platform channel) ──────────────────

  /// Size-gates already-downscaled bytes and stamps a PII-free filename.
  static ScanCaptureOutcome buildCaptureOutcome(
    List<int> bytes, {
    DateTime? now,
  }) {
    if (bytes.isEmpty) return const ScanCaptureFailure('capture_empty');
    if (bytes.length > kScanMaxImageBytes) {
      return ScanCaptureTooLarge(bytes.length);
    }
    final ts = (now ?? DateTime.now()).millisecondsSinceEpoch;
    return ScanCaptureSuccess(bytes: bytes, fileName: 'scan_$ts.jpg');
  }

  /// Maps an `image_picker` [PlatformException.code] to a capture outcome.
  ///
  /// Codes are the ones the plugin actually emits:
  ///   * `camera_access_denied`  — iOS camera permission refused
  ///   * `photo_access_denied`   — iOS photo-library permission refused
  ///   * `access_denied`         — Android runtime CAMERA permission refused
  ///   * `no_available_camera`   — device has no usable camera
  ///   * `already_active`        — a picker request is already in flight
  ///   * `multiple_request`      — same, older plugin spelling
  ///   * `invalid_image`         — the returned file could not be decoded
  ///
  /// Anything unrecognised falls through to a generic, non-dead-end failure —
  /// never to a permission state, because falsely claiming "permission
  /// denied" would send the student into system Settings for no reason.
  static ScanCaptureOutcome classifyPickerError(
    String? code,
    ScanCaptureSource source,
  ) {
    switch (code) {
      case 'camera_access_denied':
        return const ScanCapturePermissionDenied(ScanCaptureSource.camera);
      case 'photo_access_denied':
        return const ScanCapturePermissionDenied(ScanCaptureSource.gallery);
      case 'access_denied':
        // Android's generic denial — attribute it to whatever was asked for.
        return ScanCapturePermissionDenied(source);
      case 'no_available_camera':
        return const ScanCaptureFailure('no_camera');
      case 'already_active':
      case 'multiple_request':
        return const ScanCaptureFailure('picker_busy');
      case 'invalid_image':
        return const ScanCaptureFailure('invalid_image');
      default:
        return const ScanCaptureFailure('capture_failed');
    }
  }
}

/// Scan & Solve repository — the single `POST /api/scan-solve` call.
///
/// Transport: [ApiClient]'s raw [Dio] (the `assignments_repository.dart` /
/// `exam_repository.dart` pattern) rather than [ApiClient.post], because this
/// route encodes meaning in non-2xx bodies that `_mapDioError` would flatten:
///   * 429 carries `used`/`limit` → a real usage readout, not "rate limited"
///   * 422 carries `subject`/`allowed[]` → a plan gate, not a validation error
///   * 503 is the AI kill switch → "back in a minute", not "request failed"
/// and because a 200 can itself mean failure (`status: 'ocr_failed'`).
///
/// ── Timeouts ──────────────────────────────────────────────────────────────
/// [ApiConstants.receiveTimeout] is 15 s, tuned for ordinary reads. This one
/// request fans out to Storage upload → `scan-ocr` → `ncert-solver` (two LLM
/// round trips), so it gets its own 90 s receive / 60 s send budget. Without
/// the override every scan on a slow link would time out mid-solve and the
/// student would be billed a scan against their daily cap for nothing.
///
/// ── P13 ───────────────────────────────────────────────────────────────────
/// Nothing here logs. Not the bytes, not `extracted_text`, not the solution
/// prose, not a truncated preview of any of them.
class ScanSolveRepository {
  final ApiClient _api;

  ScanSolveRepository({ApiClient? api}) : _api = api ?? ApiClient();

  static const Duration _solveReceiveTimeout = Duration(seconds: 90);
  static const Duration _solveSendTimeout = Duration(seconds: 60);

  /// Upload + OCR + solve in one call.
  ///
  /// [isHi] sets the `x-lang` header, which is the ONLY thing that makes the
  /// route emit Hindi copy for its own error strings. Mobile still owns all
  /// of its own UI copy — this just keeps server-authored messages (429 quota
  /// text, `ocr_failed` guidance) in the student's language.
  ///
  /// `subject`/`grade` are deliberately NOT sent. The route already defaults
  /// them to the student's own `preferred_subject` / `grade` server-side, and
  /// anything we supplied would have to clear `validateSubjectWrite` — i.e.
  /// mobile could only ever cause a 422 it had no better information to avoid.
  Future<ScanSolveOutcome> solveImage({
    required List<int> bytes,
    required String fileName,
    bool isHi = false,
  }) async {
    if (bytes.isEmpty) {
      return const ScanSolveFailure('No image to send.');
    }
    if (bytes.length > kScanMaxImageBytes) {
      return const ScanSolveFailure('This image is too large to send.');
    }

    try {
      final response = await _api.dio.post<dynamic>(
        '/scan-solve',
        data: {
          'image_base64': base64Encode(bytes),
          'file_name': fileName,
        },
        options: Options(
          receiveTimeout: _solveReceiveTimeout,
          sendTimeout: _solveSendTimeout,
          headers: {if (isHi) 'x-lang': 'hi'},
          // Let every status reach the classifier instead of being thrown —
          // the 422/429/503 bodies are the payload we care about.
          validateStatus: (_) => true,
        ),
      );
      return classifySolveResponse(response.statusCode, response.data);
    } on DioException catch (e) {
      if (e.response != null) {
        return classifySolveResponse(e.response!.statusCode, e.response!.data);
      }
      return ScanSolveFailure(messageFor(e));
    } catch (_) {
      return const ScanSolveFailure('Connection error. Please try again.');
    }
  }

  // ── Pure classifier (testable without a network) ────────────────────────

  /// Maps `(statusCode, body)` from `/api/scan-solve` to a
  /// [ScanSolveOutcome]. Pure and static so the full failure matrix is unit
  /// testable.
  static ScanSolveOutcome classifySolveResponse(int? statusCode, dynamic data) {
    final map =
        data is Map ? Map<String, dynamic>.from(data) : const <String, dynamic>{};
    final serverError = map['error']?.toString();

    // 503 — ai_usage_global kill switch.
    if (statusCode == 503) return ScanSolveUnavailable(serverError);

    // 429 — daily scan cap. `limit_reached` is the route's own marker.
    if (statusCode == 429 || map['limit_reached'] == true) {
      return ScanSolveLimitReached(
        used: (map['used'] as num?)?.toInt() ?? 0,
        limit: (map['limit'] as num?)?.toInt() ?? 0,
        serverMessage: serverError,
      );
    }

    // 422 — subject governance (validateSubjectWrite). Note this body puts
    // the machine CODE in `error`, not a sentence.
    if (statusCode == 422) {
      final rawAllowed = map['allowed'];
      return ScanSolvePlanGated(
        code: serverError ?? 'subject_not_allowed',
        subject: map['subject']?.toString(),
        reason: map['reason']?.toString(),
        allowed: rawAllowed is List
            ? rawAllowed.map((e) => e.toString()).toList(growable: false)
            : const [],
      );
    }

    if (statusCode == null || statusCode < 200 || statusCode >= 300) {
      return ScanSolveFailure(
        serverError ?? 'Could not scan this image. Please try again.',
        statusCode,
      );
    }

    // ── 2xx from here on. A 200 is NOT automatically a success. ──
    final status = map['status']?.toString() ?? '';

    if (status == 'ocr_failed') {
      return ScanSolveNoText(
        scanId: map['scan_id']?.toString(),
        serverMessage: serverError,
      );
    }

    final result = ScanSolveResult.fromJson(map);

    // Defensive: a 2xx with neither a recognised status nor any text is not
    // something we can render. Treat it as "no text found" (the actionable
    // framing) rather than inventing a success.
    if (result.extractedText.trim().isEmpty) {
      return ScanSolveNoText(
        scanId: result.scanId.isEmpty ? null : result.scanId,
        serverMessage: serverError,
      );
    }

    if (status == 'solved' && result.hasSolution) {
      return ScanSolveSolved(result);
    }
    // 'ocr_only', or 'solved' with an empty/abstained solution object — both
    // mean "we have the question, not the answer".
    return ScanSolveTextOnly(result);
  }

  /// Shared network-error copy (same wording as `exam_repository.dart`).
  static String messageFor(DioException e) {
    return switch (e.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout =>
        'The request timed out. Please try again.',
      DioExceptionType.connectionError => 'No internet connection.',
      _ => 'Something went wrong. Please try again.',
    };
  }
}
