import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/constants/app_colors.dart';
import '../../../data/models/scan_solve_models.dart';
import '../../../providers/scan_solve_provider.dart';
import '../../widgets/loading_widget.dart';

/// Scan & Solve — capture screen. Mobile parity for
/// `apps/host/src/app/scan/page.tsx`, wired to the REAL `/api/scan-solve`
/// pipeline (the web page still renders a hardcoded `simulateOCR()` fixture;
/// mobile deliberately does not reproduce that fiction).
///
/// ── Graceful degradation ──────────────────────────────────────────────────
/// Camera is the headline affordance, but gallery is ALWAYS rendered beside
/// it and needs no camera permission. If the OS refuses the camera, this
/// screen shows a plain-language rationale plus a "Choose from gallery"
/// button — it never dead-ends and never crashes.
///
/// ── P12 / P13 ─────────────────────────────────────────────────────────────
/// No `print`/`debugPrint`/logger call exists on this screen. The preview
/// thumbnail is rendered from in-memory bytes and is never persisted.
class ScanCaptureScreen extends ConsumerWidget {
  const ScanCaptureScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isHi = Localizations.localeOf(context).languageCode == 'hi';
    final state = ref.watch(scanSolveProvider);

    // Push straight to the result screen the moment the server answers with
    // something readable (solved OR text-only — both have a question to show).
    ref.listen<ScanSolveScreenState>(scanSolveProvider, (prev, next) {
      final wasResult = prev?.phase == ScanSolvePhase.solved ||
          prev?.phase == ScanSolvePhase.textOnly;
      final isResult = next.phase == ScanSolvePhase.solved ||
          next.phase == ScanSolvePhase.textOnly;
      if (!wasResult && isResult) {
        context.push('/scan/result');
      }
    });

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        title: Text(isHi ? 'स्कैन और हल करो' : 'Scan & Solve'),
        actions: [
          if (state.phase != ScanSolvePhase.idle &&
              state.phase != ScanSolvePhase.solving &&
              state.phase != ScanSolvePhase.capturing)
            TextButton(
              onPressed: () => ref.read(scanSolveProvider.notifier).reset(),
              child: Text(isHi ? 'नया स्कैन' : 'New scan'),
            ),
        ],
      ),
      body: SafeArea(child: _body(context, ref, state, isHi)),
    );
  }

  Widget _body(
    BuildContext context,
    WidgetRef ref,
    ScanSolveScreenState state,
    bool isHi,
  ) {
    switch (state.phase) {
      case ScanSolvePhase.capturing:
        return LoadingScreen(
          message: isHi ? 'कैमरा खुल रहा है…' : 'Opening camera…',
        );

      case ScanSolvePhase.solving:
        return _SolvingView(previewBytes: state.previewBytes, isHi: isHi);

      case ScanSolvePhase.permissionDenied:
        return _PermissionDeniedView(state: state, isHi: isHi);

      case ScanSolvePhase.noText:
        return _OutcomeCard(
          emoji: '🔍',
          title: isHi ? 'तस्वीर से पढ़ नहीं पाए' : "Couldn't read this photo",
          body: state.serverMessage ??
              (isHi
                  ? 'रोशनी अच्छी रखें, पूरा सवाल फ्रेम में लें और फ़ोन को सीधा पकड़ें — फिर दोबारा कोशिश करें।'
                  : 'Use good light, fit the whole question in the frame, and hold the phone straight — then try again.'),
          actionLabel: isHi ? 'दोबारा फ़ोटो लें' : 'Take another photo',
          onAction: () => _capture(ref, ScanCaptureSource.camera, isHi),
          secondaryLabel: isHi ? 'गैलरी से चुनें' : 'Choose from gallery',
          onSecondary: () => _capture(ref, ScanCaptureSource.gallery, isHi),
        );

      case ScanSolvePhase.limitReached:
        return _OutcomeCard(
          emoji: '⏳',
          title: isHi ? 'आज के स्कैन खत्म' : "Today's scans are used up",
          body: state.scanLimit > 0
              ? (isHi
                  ? 'आपने आज ${state.usedScans}/${state.scanLimit} स्कैन इस्तेमाल कर लिए हैं। कल फिर से मिलेंगे, या ज़्यादा स्कैन के लिए प्लान अपग्रेड करें।'
                  : 'You have used ${state.usedScans}/${state.scanLimit} scans today. They reset tomorrow, or upgrade your plan for more.')
              : (state.serverMessage ??
                  (isHi
                      ? 'आज के स्कैन खत्म हो गए। कल फिर कोशिश करें।'
                      : 'You have used all of today\'s scans. Try again tomorrow.')),
          actionLabel: isHi ? 'प्लान देखें' : 'See plans',
          onAction: () => context.push('/plans'),
          secondaryLabel: isHi ? 'फ़ॉक्सी से पूछें' : 'Ask Foxy instead',
          onSecondary: () => context.push('/chat'),
        );

      case ScanSolvePhase.planGated:
        return _OutcomeCard(
          emoji: '🔒',
          title: isHi ? 'यह विषय आपके प्लान में नहीं है' : 'This subject is not in your plan',
          body: isHi
              ? 'इस विषय के सवाल हल करने के लिए आपको प्लान अपग्रेड करना होगा।'
              : 'Upgrade your plan to get solutions for this subject.',
          actionLabel: isHi ? 'प्लान देखें' : 'See plans',
          onAction: () => context.push('/plans'),
          secondaryLabel: isHi ? 'वापस जाएँ' : 'Go back',
          onSecondary: () => ref.read(scanSolveProvider.notifier).reset(),
        );

      case ScanSolvePhase.unavailable:
        return _OutcomeCard(
          emoji: '🛠️',
          title: isHi ? 'अभी उपलब्ध नहीं' : 'Temporarily unavailable',
          body: state.serverMessage ??
              (isHi
                  ? 'स्कैन-और-हल अभी बंद है। कृपया थोड़ी देर बाद कोशिश करें।'
                  : 'Scan & Solve is paused right now. Please try again in a minute.'),
          actionLabel: isHi ? 'फिर कोशिश करें' : 'Try again',
          onAction: () =>
              ref.read(scanSolveProvider.notifier).retrySolve(isHi: isHi),
          secondaryLabel: isHi ? 'फ़ॉक्सी से पूछें' : 'Ask Foxy instead',
          onSecondary: () => context.push('/chat'),
        );

      case ScanSolvePhase.error:
        return _OutcomeCard(
          emoji: '⚠️',
          title: isHi ? 'स्कैन पूरा नहीं हो सका' : 'Scan could not finish',
          body: state.serverMessage ??
              (isHi ? 'कृपया पुनः प्रयास करें।' : 'Please try again.'),
          actionLabel: state.canRetrySolve
              ? (isHi ? 'फिर भेजें' : 'Retry')
              : (isHi ? 'दोबारा फ़ोटो लें' : 'Take another photo'),
          onAction: state.canRetrySolve
              ? () => ref.read(scanSolveProvider.notifier).retrySolve(isHi: isHi)
              : () => _capture(ref, ScanCaptureSource.camera, isHi),
          secondaryLabel: isHi ? 'गैलरी से चुनें' : 'Choose from gallery',
          onSecondary: () => _capture(ref, ScanCaptureSource.gallery, isHi),
        );

      case ScanSolvePhase.solved:
      case ScanSolvePhase.textOnly:
        // The listener above is already pushing /scan/result.
        return LoadingScreen(
          message: isHi ? 'हल खुल रहा है…' : 'Opening the solution…',
        );

      case ScanSolvePhase.idle:
        return _IdleView(state: state, isHi: isHi);
    }
  }

  void _capture(WidgetRef ref, ScanCaptureSource source, bool isHi) {
    ref.read(scanSolveProvider.notifier).capture(source, isHi: isHi);
  }
}

// ── Idle ──────────────────────────────────────────────────────────────────

class _IdleView extends ConsumerWidget {
  final ScanSolveScreenState state;
  final bool isHi;
  const _IdleView({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(scanSolveProvider.notifier);
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
      children: [
        if (state.captureErrorCode != null) ...[
          _CaptureErrorBanner(
            code: state.captureErrorCode!,
            isHi: isHi,
            onDismiss: notifier.dismissCaptureError,
          ),
          const SizedBox(height: 16),
        ],
        Container(
          padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              const Text('📷', style: TextStyle(fontSize: 44)),
              const SizedBox(height: 12),
              Text(
                isHi ? 'सवाल की फ़ोटो लो' : 'Photograph a question',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                isHi
                    ? 'होमवर्क, प्रश्नपत्र या किताब का सवाल — हम उसे पढ़कर NCERT के हिसाब से हल करेंगे।'
                    : 'Homework, a question paper, or a textbook problem — we read it and solve it the NCERT way.',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: state.canCapture
                      ? () => notifier.capture(ScanCaptureSource.camera,
                          isHi: isHi)
                      : null,
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: Text(isHi ? 'कैमरा खोलें' : 'Open camera'),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primary,
                    side: const BorderSide(color: AppColors.border),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: state.canCapture
                      ? () => notifier.capture(ScanCaptureSource.gallery,
                          isHi: isHi)
                      : null,
                  icon: const Icon(Icons.photo_library_outlined),
                  label: Text(isHi ? 'गैलरी से चुनें' : 'Choose from gallery'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _TipsCard(isHi: isHi),
      ],
    );
  }
}

class _TipsCard extends StatelessWidget {
  final bool isHi;
  const _TipsCard({required this.isHi});

  @override
  Widget build(BuildContext context) {
    final tips = isHi
        ? const [
            'एक बार में एक ही सवाल फ़्रेम में रखें',
            'अच्छी रोशनी में फ़ोटो लें, परछाईं से बचें',
            'फ़ोन को पन्ने के सीधा ऊपर रखें',
          ]
        : const [
            'Keep one question in the frame at a time',
            'Shoot in good light and avoid shadows',
            'Hold the phone flat above the page',
          ];
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.accentLight,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isHi ? 'बेहतर नतीजों के लिए' : 'For the best results',
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 8),
          for (final tip in tips)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('•  ',
                      style: TextStyle(color: AppColors.textSecondary)),
                  Expanded(
                    child: Text(
                      tip,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.textSecondary,
                        height: 1.35,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

// ── Capture-side inline banner ────────────────────────────────────────────

class _CaptureErrorBanner extends StatelessWidget {
  final String code;
  final bool isHi;
  final VoidCallback onDismiss;

  const _CaptureErrorBanner({
    required this.code,
    required this.isHi,
    required this.onDismiss,
  });

  /// Bilingual copy for every code
  /// [ImagePickerScanImageSource.classifyPickerError] can emit, plus
  /// `too_large`. Unknown codes fall back to generic retry copy — the banner
  /// never renders a raw machine string to a student.
  String _message() {
    switch (code) {
      case 'too_large':
        return isHi
            ? 'यह फ़ाइल बहुत बड़ी है। स्क्रीनशॉट के बजाय कैमरे से फ़ोटो लें।'
            : 'That file is too large. Take a camera photo instead of using a screenshot.';
      case 'no_camera':
        return isHi
            ? 'इस डिवाइस पर कैमरा उपलब्ध नहीं है — गैलरी से फ़ोटो चुनें।'
            : 'No camera is available on this device — pick a photo from your gallery.';
      case 'picker_busy':
        return isHi
            ? 'पिछली फ़ोटो अभी खुल रही है। एक पल रुककर फिर कोशिश करें।'
            : 'A photo request is already open. Wait a moment and try again.';
      case 'invalid_image':
        return isHi
            ? 'यह फ़ाइल पढ़ी नहीं जा सकी। कोई और फ़ोटो चुनें।'
            : 'That file could not be read. Please choose another photo.';
      case 'capture_empty':
        return isHi
            ? 'फ़ोटो खाली आई। कृपया दोबारा कोशिश करें।'
            : 'The photo came back empty. Please try again.';
      default:
        return isHi
            ? 'फ़ोटो नहीं ली जा सकी। कृपया दोबारा कोशिश करें।'
            : "Couldn't take that photo. Please try again.";
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceAlt,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, size: 18, color: AppColors.warning),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _message(),
              style: const TextStyle(
                fontSize: 12.5,
                color: AppColors.textPrimary,
                height: 1.35,
              ),
            ),
          ),
          IconButton(
            onPressed: onDismiss,
            icon: const Icon(Icons.close, size: 18),
            color: AppColors.textTertiary,
            tooltip: isHi ? 'बंद करें' : 'Dismiss',
          ),
        ],
      ),
    );
  }
}

// ── Permission denied ─────────────────────────────────────────────────────

class _PermissionDeniedView extends ConsumerWidget {
  final ScanSolveScreenState state;
  final bool isHi;
  const _PermissionDeniedView({required this.state, required this.isHi});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(scanSolveProvider.notifier);
    final cameraDenied = state.deniedSource == ScanCaptureSource.camera;

    // The RATIONALE copy. Bilingual, plain-language, and honest about what
    // the permission is used for — this is also what the Play Store data
    // safety declaration must stay consistent with.
    final rationale = cameraDenied
        ? (isHi
            ? 'सवाल की फ़ोटो लेने के लिए ऐप को कैमरे की अनुमति चाहिए। फ़ोटो सिर्फ़ सवाल पढ़ने और हल करने के लिए भेजी जाती है — कहीं और साझा नहीं होती।\n\nअनुमति नहीं देनी? कोई बात नहीं — गैलरी से फ़ोटो चुनकर भी स्कैन कर सकते हैं।'
            : 'Alfanumrik needs camera access to photograph your question. The photo is used only to read and solve that question — it is not shared anywhere else.\n\nPrefer not to allow it? That is fine — you can still scan by picking a photo from your gallery.')
        : (isHi
            ? 'गैलरी से फ़ोटो चुनने के लिए ऐप को फ़ोटो की अनुमति चाहिए। आप चाहें तो इसके बजाय कैमरे से सीधे फ़ोटो ले सकते हैं, या फ़ोन की सेटिंग्स में जाकर अनुमति चालू कर सकते हैं।'
            : 'Alfanumrik needs photo access to pick an image from your gallery. You can use the camera instead, or turn the permission on in your phone Settings.');

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              Icon(
                cameraDenied
                    ? Icons.no_photography_outlined
                    : Icons.photo_library_outlined,
                size: 36,
                color: AppColors.textTertiary,
              ),
              const SizedBox(height: 12),
              Text(
                cameraDenied
                    ? (isHi ? 'कैमरे की अनुमति नहीं मिली' : 'Camera access not granted')
                    : (isHi ? 'फ़ोटो की अनुमति नहीं मिली' : 'Photo access not granted'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                rationale,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 20),
              // Camera denied → gallery is the guaranteed forward path.
              // Gallery denied → camera is.
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: () {
                    notifier.acknowledgePermissionDenied();
                    notifier.capture(
                      cameraDenied
                          ? ScanCaptureSource.gallery
                          : ScanCaptureSource.camera,
                      isHi: isHi,
                    );
                  },
                  icon: Icon(cameraDenied
                      ? Icons.photo_library_outlined
                      : Icons.photo_camera_outlined),
                  label: Text(
                    cameraDenied
                        ? (isHi ? 'गैलरी से चुनें' : 'Choose from gallery')
                        : (isHi ? 'कैमरा खोलें' : 'Open camera'),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: notifier.acknowledgePermissionDenied,
                child: Text(isHi ? 'वापस जाएँ' : 'Go back'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ── Solving ───────────────────────────────────────────────────────────────

class _SolvingView extends StatelessWidget {
  final Uint8List? previewBytes;
  final bool isHi;
  const _SolvingView({required this.previewBytes, required this.isHi});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (previewBytes != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Image.memory(
                  previewBytes!,
                  width: 148,
                  height: 148,
                  fit: BoxFit.cover,
                  gaplessPlayback: true,
                ),
              ),
            const SizedBox(height: 20),
            const SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(height: 14),
            Text(
              isHi ? 'सवाल पढ़ा जा रहा है…' : 'Reading your question…',
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              isHi
                  ? 'इसमें कुछ सेकंड लग सकते हैं। ऐप बंद न करें।'
                  : 'This can take a few seconds. Please keep the app open.',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 12.5,
                color: AppColors.textTertiary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Generic terminal card ─────────────────────────────────────────────────

class _OutcomeCard extends StatelessWidget {
  final String emoji;
  final String title;
  final String body;
  final String actionLabel;
  final VoidCallback onAction;
  final String? secondaryLabel;
  final VoidCallback? onSecondary;

  const _OutcomeCard({
    required this.emoji,
    required this.title,
    required this.body,
    required this.actionLabel,
    required this.onAction,
    this.secondaryLabel,
    this.onSecondary,
  });

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            children: [
              Text(emoji, style: const TextStyle(fontSize: 36)),
              const SizedBox(height: 12),
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                body,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: onAction,
                  child: Text(actionLabel),
                ),
              ),
              if (secondaryLabel != null && onSecondary != null) ...[
                const SizedBox(height: 8),
                TextButton(onPressed: onSecondary, child: Text(secondaryLabel!)),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
