import 'package:alfanumrik/data/models/student.dart';
import 'package:alfanumrik/providers/auth_provider.dart';
import 'package:alfanumrik/providers/experience_provider.dart';
import 'package:alfanumrik/ui/screens/settings/settings_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

class _EmptyStudentNotifier extends StudentNotifier {
  @override
  Future<Student?> build() async => null;
}

Future<void> _pumpSettings(
  WidgetTester tester,
  OneExperienceResolution resolution,
) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        studentProvider.overrideWith(_EmptyStudentNotifier.new),
        oneExperienceProvider.overrideWith((ref) async => resolution),
      ],
      child: const MaterialApp(home: SettingsScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('explicit server legacy preserves the historical settings UI', (
    tester,
  ) async {
    await _pumpSettings(tester, OneExperienceResolution.legacy);

    expect(find.text('My Learning'), findsNothing);
    expect(find.text('Ask Foxy'), findsNothing);
    expect(find.text('Progress'), findsNothing);
    expect(find.text('Leaderboard'), findsNothing);
    expect(find.text('STEM Lab'), findsNothing);
  });

  testWidgets('enabled settings exposes only server-permitted destinations', (
    tester,
  ) async {
    await _pumpSettings(
      tester,
      const OneExperienceResolution(
        assignment: OneExperienceAssignment.enabled,
        role: 'student',
        permittedCapabilities: {'shared.settings', 'student.progress'},
      ),
    );

    expect(find.text('My Learning'), findsOneWidget);
    expect(find.text('Progress'), findsOneWidget);
    expect(find.text('Ask Foxy'), findsNothing);
    expect(find.text('Leaderboard'), findsNothing);
    expect(find.text('STEM Lab'), findsNothing);
  });

  testWidgets('missing settings capability keeps V2 destinations closed', (
    tester,
  ) async {
    await _pumpSettings(
      tester,
      const OneExperienceResolution(
        assignment: OneExperienceAssignment.enabled,
        role: 'student',
        permittedCapabilities: {
          'student.foxy',
          'student.progress',
          'student.rewards',
          'student.learn',
        },
      ),
    );

    expect(find.text('My Learning'), findsNothing);
    expect(find.text('Ask Foxy'), findsNothing);
    expect(find.text('Progress'), findsNothing);
    expect(find.text('Leaderboard'), findsNothing);
    expect(find.text('STEM Lab'), findsNothing);
  });
}
