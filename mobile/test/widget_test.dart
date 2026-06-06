// Smoke test for the Alfanumrik app shell.
//
// The previous contents were the unmodified `flutter create` counter
// template (referencing a non-existent `MyApp` + counter widget), which no
// longer compiled. The real root widget is `AlfanumrikApp`, but pumping it
// directly requires a live `Supabase.initialize()` (the GoRouter redirect
// reads `Supabase.instance.client`), which a bare widget test cannot provide.
//
// So this smoke test exercises the app's Material theme through a minimal
// MaterialApp — enough to prove the theme builds and a frame pumps without
// touching Supabase/Hive. Behaviour-only assertions on real screens live in
// the screen/provider tests under test/ui and test/data.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/theme/app_theme.dart';

void main() {
  testWidgets('App theme builds and a frame renders', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        darkTheme: AppTheme.dark,
        home: const Scaffold(
          body: Center(child: Text('Alfanumrik')),
        ),
      ),
    );

    expect(find.text('Alfanumrik'), findsOneWidget);
  });
}
