// Widget test for the assignments list screen's status-badge rendering —
// confirms the not-started/overdue/due-today, submitted, and reviewed
// badges each render their own distinct label, following the same
// ProviderScope override pattern as test/ui/parent/parent_app_shell_test.dart.
library;

import 'package:alfanumrik/data/models/assignment_models.dart';
import 'package:alfanumrik/providers/assignments_provider.dart';
import 'package:alfanumrik/ui/screens/assignments/assignments_list_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// Serves a fixed list without touching studentProvider/AssignmentsRepository
/// at all (mirrors diagnostic_provider_test.dart's `_EmptyStudentNotifier`
/// override-with-a-fixed-`build()` pattern).
class _FixedAssignmentsListNotifier extends AssignmentsListNotifier {
  final List<AssignmentListItem> items;
  _FixedAssignmentsListNotifier(this.items);

  @override
  Future<List<AssignmentListItem>> build() async => items;
}

Widget _wrap(List<AssignmentListItem> items) {
  return ProviderScope(
    overrides: [
      assignmentsListProvider.overrideWith(() => _FixedAssignmentsListNotifier(items)),
    ],
    child: const MaterialApp(home: AssignmentsListScreen()),
  );
}

void main() {
  testWidgets('empty list shows the "no assignments yet" nudge', (tester) async {
    await tester.pumpWidget(_wrap(const []));
    await tester.pumpAndSettle();

    expect(find.text('No assignments yet'), findsOneWidget);
  });

  testWidgets('a not-started, overdue assignment shows the Overdue badge and Start CTA', (tester) async {
    final item = AssignmentListItem(
      assignment: Assignment(
        id: 'a-1',
        title: 'Chapter 3 Practice',
        subject: 'math',
        dueDate: DateTime.now().subtract(const Duration(days: 2)).toIso8601String(),
      ),
    );
    await tester.pumpWidget(_wrap([item]));
    await tester.pumpAndSettle();

    expect(find.text('Overdue'), findsOneWidget);
    expect(find.text('Start Assignment'), findsOneWidget);
    // The not-started card shows a CTA, not a score row.
    expect(find.textContaining('Score'), findsNothing);
  });

  testWidgets('a submitted (not yet graded) assignment shows the Submitted badge and score', (tester) async {
    final item = AssignmentListItem(
      assignment: const Assignment(id: 'a-2', title: 'Algebra Basics'),
      attempts: const [
        AssignmentSubmission(
          id: 's-1',
          assignmentId: 'a-2',
          attemptNumber: 1,
          score: 70,
          submittedAt: '2026-07-20T10:00:00.000Z',
        ),
      ],
    );
    await tester.pumpWidget(_wrap([item]));
    await tester.pumpAndSettle();

    expect(find.text('Submitted'), findsOneWidget);
    expect(find.text('70%'), findsOneWidget);
    // Submitted (ungraded) rows never show the Start CTA.
    expect(find.text('Start Assignment'), findsNothing);
  });

  testWidgets('a graded assignment shows the Reviewed badge — DISTINCT from Submitted', (tester) async {
    final item = AssignmentListItem(
      assignment: const Assignment(id: 'a-3', title: 'Geometry Quiz'),
      attempts: const [
        AssignmentSubmission(
          id: 's-1',
          assignmentId: 'a-3',
          attemptNumber: 1,
          score: 90,
          submittedAt: '2026-07-18T10:00:00.000Z',
          gradedAt: '2026-07-19T10:00:00.000Z',
        ),
      ],
    );
    await tester.pumpWidget(_wrap([item]));
    await tester.pumpAndSettle();

    expect(find.text('Reviewed'), findsOneWidget);
    expect(find.text('Submitted'), findsNothing);
    expect(find.text('90%'), findsOneWidget);
  });
}
