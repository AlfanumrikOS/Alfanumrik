import 'package:flutter/material.dart';

import '../../core/constants/app_colors.dart';

/// Shared answer-option row (A/B/C/D badge + option text), extracted from
/// `quiz_screen.dart`'s inline `_QuizInProgress` options rendering so
/// PYQ / Diagnostic can reuse the exact same look instead of duplicating it.
///
/// Two modes:
///  * plain selection (`showResult: false`, the Quiz screen's mode) —
///    highlights only the tapped option, no reveal.
///  * revealed mode (`showResult: true`, PYQ / Diagnostic's "answer, then
///    see correct/incorrect immediately" UX) — highlights the correct
///    option green and a wrong tapped option red, after an answer is locked
///    in.
class QuizOptionTile extends StatelessWidget {
  final int index;
  final String text;
  final bool isSelected;
  final bool showResult;
  final bool isCorrectOption;
  final VoidCallback? onTap;

  const QuizOptionTile({
    super.key,
    required this.index,
    required this.text,
    required this.isSelected,
    this.showResult = false,
    this.isCorrectOption = false,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    Color bg = AppColors.surface;
    Color border = AppColors.borderLight;
    Color textColor = AppColors.textPrimary;
    Color badgeColor = AppColors.borderLight;
    Color badgeTextColor = AppColors.textSecondary;
    double borderWidth = 1;

    if (showResult) {
      if (isCorrectOption) {
        bg = AppColors.success.withValues(alpha: 0.08);
        border = AppColors.success;
        textColor = AppColors.success;
        badgeColor = AppColors.success;
        badgeTextColor = Colors.white;
        borderWidth = 1.5;
      } else if (isSelected) {
        bg = AppColors.error.withValues(alpha: 0.08);
        border = AppColors.error;
        textColor = AppColors.error;
        badgeColor = AppColors.error;
        badgeTextColor = Colors.white;
        borderWidth = 1.5;
      }
    } else if (isSelected) {
      bg = AppColors.primary.withValues(alpha: 0.06);
      border = AppColors.primary;
      textColor = AppColors.primary;
      badgeColor = AppColors.primary;
      badgeTextColor = Colors.white;
      borderWidth = 1.5;
    }

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: border, width: borderWidth),
          ),
          child: Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(color: badgeColor, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: Text(
                  String.fromCharCode(65 + index), // A, B, C, D
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: badgeTextColor,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  text,
                  style: TextStyle(
                    fontSize: 14,
                    color: textColor,
                    fontWeight: isSelected || (showResult && isCorrectOption)
                        ? FontWeight.w600
                        : FontWeight.w400,
                    height: 1.4,
                  ),
                ),
              ),
              if (showResult && isCorrectOption)
                const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 18),
              if (showResult && isSelected && !isCorrectOption)
                const Icon(Icons.cancel_rounded, color: AppColors.error, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

/// Renders the full options list for one question. [onSelect] is ignored
/// (options become non-interactive) once [showResult] is true, matching the
/// web's "lock in after answering" behaviour.
class QuestionOptionsList extends StatelessWidget {
  final List<String> options;
  final int? selectedIndex;
  final bool showResult;
  final int? correctIndex;
  final ValueChanged<int>? onSelect;

  const QuestionOptionsList({
    super.key,
    required this.options,
    this.selectedIndex,
    this.showResult = false,
    this.correctIndex,
    this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(options.length, (i) {
        return QuizOptionTile(
          index: i,
          text: options[i],
          isSelected: selectedIndex == i,
          showResult: showResult,
          isCorrectOption: correctIndex != null && correctIndex == i,
          onTap: showResult
              ? null
              : (onSelect != null ? () => onSelect!(i) : null),
        );
      }),
    );
  }
}
