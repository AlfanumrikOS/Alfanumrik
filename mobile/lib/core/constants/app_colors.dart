import 'package:flutter/material.dart';

/// Alfanumrik design tokens — warm, scholarly palette.
class AppColors {
  AppColors._();

  // Primary — warm brown/amber scholarly tone
  static const Color primary = Color(0xFF8B6F47);
  static const Color primaryLight = Color(0xFFD4C4B0);
  static const Color primaryDark = Color(0xFF5C4A2F);

  // Accent — teal for interactive elements
  static const Color accent = Color(0xFF0891B2);
  static const Color accentLight = Color(0xFFCFFAFE);

  // Backgrounds
  static const Color background = Color(0xFFFBF8F4);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceAlt = Color(0xFFF5F0E8);

  // Text
  static const Color textPrimary = Color(0xFF1A1A1A);
  static const Color textSecondary = Color(0xFF666666);
  static const Color textTertiary = Color(0xFF999999);

  // Borders
  static const Color border = Color(0xFFE8DDD0);
  static const Color borderLight = Color(0xFFF0EBE3);

  // Status colors
  static const Color success = Color(0xFF22C55E);
  static const Color warning = Color(0xFFF59E0B);
  static const Color error = Color(0xFFEF4444);
  static const Color info = Color(0xFF3B82F6);

  // Subject colors
  static const Color mathColor = Color(0xFF6366F1);
  static const Color scienceColor = Color(0xFF0891B2);
  static const Color physicsColor = Color(0xFFF59E0B);
  static const Color chemistryColor = Color(0xFF22C55E);
  static const Color biologyColor = Color(0xFFEC4899);
  static const Color englishColor = Color(0xFF8B5CF6);
  static const Color hindiColor = Color(0xFFEF4444);
  static const Color socialStudiesColor = Color(0xFF78716C);
  static const Color codingColor = Color(0xFF06B6D4);

  // XP / Gamification
  static const Color xpGold = Color(0xFFFBBF24);
  static const Color xpBronze = Color(0xFFCD7F32);

  // Plan badge colors
  static const Color planFree = Color(0xFF94A3B8);
  static const Color planStarter = Color(0xFF3B82F6);
  static const Color planPro = Color(0xFF8B5CF6);
  static const Color planUltimate = Color(0xFFF59E0B);

  static Color subjectColor(String code) {
    switch (code) {
      case 'math':
      case 'mathematics':
        return mathColor;
      case 'science':
        return scienceColor;
      case 'physics':
        return physicsColor;
      case 'chemistry':
        return chemistryColor;
      case 'biology':
        return biologyColor;
      case 'english':
        return englishColor;
      case 'hindi':
        return hindiColor;
      case 'social_studies':
        return socialStudiesColor;
      case 'coding':
      case 'computer_science':
        return codingColor;
      default:
        return primary;
    }
  }
}
