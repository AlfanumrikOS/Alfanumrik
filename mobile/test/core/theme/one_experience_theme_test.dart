import 'package:alfanumrik/core/constants/app_colors.dart';
import 'package:alfanumrik/core/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('One Experience native theme contract', () {
    test('uses the governed Calm Intelligence semantic palette', () {
      expect(AppColors.background, const Color(0xFFFBF7F1));
      expect(AppColors.surface, const Color(0xFFFFFDFC));
      expect(AppColors.textPrimary, const Color(0xFF211E1A));
      expect(AppColors.border, const Color(0xFFE5DBD0));
      expect(AppColors.brand, const Color(0xFFE8581C));
      expect(AppColors.primary, const Color(0xFFB94718));
      expect(AppColors.success, const Color(0xFF27734E));
      expect(AppColors.warning, const Color(0xFF9A580A));
      expect(AppColors.error, const Color(0xFFB42318));
      expect(AppColors.info, const Color(0xFF176D68));
    });

    testWidgets('primary controls keep a 48 point minimum target', (
      tester,
    ) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          home: Scaffold(
            body: Column(
              children: [
                ElevatedButton(onPressed: () {}, child: const Text('Start')),
                OutlinedButton(onPressed: () {}, child: const Text('Review')),
                IconButton(onPressed: () {}, icon: const Icon(Icons.help)),
              ],
            ),
          ),
        ),
      );

      expect(
        tester.getSize(find.byType(ElevatedButton)).height,
        greaterThanOrEqualTo(48),
      );
      expect(
        tester.getSize(find.byType(OutlinedButton)).height,
        greaterThanOrEqualTo(48),
      );
      expect(
        tester.getSize(find.byType(IconButton)).height,
        greaterThanOrEqualTo(48),
      );
    });
  });
}
