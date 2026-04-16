import 'package:flutter/material.dart';
import '../../providers/tenant_provider.dart';

/// Builds a ThemeData that applies school branding colors.
/// B2C students get default Alfanumrik theme (purple/orange).
/// B2B students get their school's colors applied throughout.
ThemeData buildSchoolTheme(SchoolBranding branding) {
  return ThemeData(
    useMaterial3: true,
    colorSchemeSeed: branding.primaryColor,
    fontFamily: 'PlusJakartaSans',
    appBarTheme: AppBarTheme(
      backgroundColor: branding.primaryColor,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: false,
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: branding.primaryColor,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: branding.primaryColor,
        side: BorderSide(color: branding.primaryColor),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    ),
    cardTheme: CardTheme(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.grey.shade200),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: branding.primaryColor, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
    ),
    textTheme: const TextTheme(
      headlineLarge:
          TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w700),
      headlineMedium:
          TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w600),
      titleLarge:
          TextStyle(fontFamily: 'Sora', fontWeight: FontWeight.w600),
      bodyLarge: TextStyle(fontFamily: 'PlusJakartaSans'),
      bodyMedium: TextStyle(fontFamily: 'PlusJakartaSans'),
      labelLarge: TextStyle(
          fontFamily: 'PlusJakartaSans', fontWeight: FontWeight.w600),
    ),
  );
}