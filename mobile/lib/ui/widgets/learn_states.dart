import 'package:flutter/material.dart';

import '../../core/constants/app_colors.dart';

/// Non-blocking banner shown above Learn content that was served from cache
/// while offline (or when the curriculum-version poll failed) and is still
/// inside the STALE_TTL grace window. It never blocks the content — it only
/// tells the student how fresh what they're reading is. Bilingual (P7).
class OfflineAsOfChip extends StatelessWidget {
  final DateTime asOf;
  final bool isHi;

  const OfflineAsOfChip({super.key, required this.asOf, required this.isHi});

  @override
  Widget build(BuildContext context) {
    final date = _formatAsOf(asOf);
    final text = isHi
        ? 'ऑफ़लाइन — $date तक की सामग्री'
        : 'Offline — content as of $date';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.2)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_rounded,
              size: 15, color: AppColors.warning),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              text,
              style: const TextStyle(
                color: AppColors.warning,
                fontSize: 12,
                height: 1.3,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Dedicated Offline state shown when the app is offline (or the version poll
/// failed) AND there is no cached content within the STALE_TTL grace window.
/// The app REFUSES to serve stale content here — this is the honest "you're
/// offline, reconnect to load" surface, never a silent stale/static serve.
/// Bilingual (P7).
class LearnOfflineState extends StatelessWidget {
  final bool isHi;
  final VoidCallback? onRetry;

  const LearnOfflineState({super.key, required this.isHi, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_rounded,
                size: 44, color: AppColors.textTertiary),
            const SizedBox(height: 14),
            Text(
              isHi ? 'आप ऑफ़लाइन हैं' : "You're offline",
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 16,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              isHi
                  ? 'यह सामग्री अभी डाउनलोड नहीं हुई है। लोड करने के लिए फिर से कनेक्ट करें।'
                  : "This content hasn't been downloaded yet. Reconnect to load it.",
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 13,
                height: 1.5,
              ),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 20),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: Text(isHi ? 'पुनः प्रयास करें' : 'Try Again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Compact, locale-neutral date label ("16 Jul") for the offline chip. Month
/// abbreviations are treated as technical tokens (not translated), matching the
/// project's convention for CBSE/XP/Bloom's.
String _formatAsOf(DateTime dt) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  final local = dt.toLocal();
  final month = months[(local.month - 1).clamp(0, 11)];
  return '${local.day} $month';
}
