import 'package:flutter/material.dart';

/// Alfanumrik One Experience design tokens — Calm Intelligence.
///
/// These values intentionally mirror the governed web V3 semantic palette.
/// Feature screens may use the subject colours below for data visualisation,
/// but actions and status messaging must use these semantic tokens.
class AppColors {
  AppColors._();

  // Brand and accessible action colours.
  static const Color brand = Color(0xFFE8581C);
  static const Color primary = Color(0xFFB94718);
  static const Color primaryLight = Color(0xFFF8E5D9);
  static const Color primaryDark = Color(0xFF8F3512);

  // Information is intentionally distinct from the primary action colour.
  static const Color accent = Color(0xFF176D68);
  static const Color accentLight = Color(0xFFDCECEA);

  // Backgrounds
  static const Color background = Color(0xFFFBF7F1);
  static const Color surface = Color(0xFFFFFDFC);
  static const Color surfaceRaised = Color(0xFFFFFFFF);
  static const Color surfaceAlt = Color(0xFFF8E5D9);

  // Text
  static const Color textPrimary = Color(0xFF211E1A);
  static const Color textSecondary = Color(0xFF6D655E);
  static const Color textTertiary = Color(0xFF756B63);

  // Borders
  static const Color border = Color(0xFFE5DBD0);
  static const Color borderLight = Color(0xFFEDE5DC);

  // Status colors
  static const Color success = Color(0xFF27734E);
  static const Color warning = Color(0xFF9A580A);
  static const Color error = Color(0xFFB42318);
  static const Color info = Color(0xFF176D68);

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

  // XP / Gamification / Foxy Coins
  static const Color xpGold = Color(0xFFFBBF24);
  static const Color xpBronze = Color(0xFFCD7F32);
  static const Color foxyCoins = Color(0xFFF59E0B); // Amber for Foxy Coins

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
