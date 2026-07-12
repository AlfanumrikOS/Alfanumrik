import 'package:alfanumrik/providers/experience_provider.dart';
import 'package:alfanumrik/ui/widgets/parent_app_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test(
    'guardian navigation selects each destination and message deep link',
    () {
      expect(parentDestinationIndexForLocation('/parent'), 0);
      expect(parentDestinationIndexForLocation('/parent/progress'), 1);
      expect(parentDestinationIndexForLocation('/parent/plan'), 2);
      expect(parentDestinationIndexForLocation('/parent/messages'), 3);
      expect(parentDestinationIndexForLocation('/parent/messages/thread-1'), 3);
      expect(parentDestinationIndexForLocation('/parent/more'), 4);
    },
  );

  testWidgets('denied assignment never renders the legacy parent child', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          oneExperienceProvider.overrideWith(
            (ref) async => OneExperienceResolution.denied,
          ),
        ],
        child: const MaterialApp(
          home: ParentAppShell(child: Text('legacy parent surface')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Parent workspace unavailable.'), findsOneWidget);
    expect(find.text('legacy parent surface'), findsNothing);
  });

  testWidgets('explicit server legacy assignment renders the legacy child', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          oneExperienceProvider.overrideWith(
            (ref) async => OneExperienceResolution.legacy,
          ),
        ],
        child: const MaterialApp(
          home: ParentAppShell(child: Text('legacy parent surface')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('legacy parent surface'), findsOneWidget);
  });
}
