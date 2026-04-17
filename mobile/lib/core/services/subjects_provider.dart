import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/subject.dart';
import '../network/api_client.dart';

/// Thin wrapper around `ApiClient` so tests can inject a mock client.
/// Production code should not instantiate this directly — use the providers
/// below.
class SubjectsService {
  final ApiClient _client;

  SubjectsService(this._client);

  /// Fetch the subjects the current student is allowed to see.
  ///
  /// Calls `GET /api/student/subjects`. The auth header is injected by
  /// `ApiClient`'s `_AuthInterceptor`. Returns an empty list if the response
  /// shape is unexpected (never throws for empty data).
  Future<List<Subject>> fetchAllowedSubjects() async {
    final response = await _client.get<Map<String, dynamic>>('/student/subjects');
    final data = response.data;
    if (data == null) return const [];
    final raw = data['subjects'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map<String, dynamic>>()
        .map(Subject.fromJson)
        .toList(growable: false);
  }
}

/// Injectable API client — overrideable in tests.
final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

/// Injectable subjects service — overrideable in tests.
final subjectsServiceProvider = Provider<SubjectsService>(
  (ref) => SubjectsService(ref.read(apiClientProvider)),
);

/// Current student's allowed subjects.
///
/// Source of truth is the web API (`/api/student/subjects`), which applies
/// grade + stream + plan rules server-side. Replaces the deprecated
/// hardcoded `GradeSubjects` constants.
///
/// `autoDispose` so the list refreshes when the user re-enters a subject
/// picker — plan upgrades and stream changes are reflected without a
/// manual invalidate.
final subjectsProvider = FutureProvider.autoDispose<List<Subject>>((ref) async {
  final service = ref.read(subjectsServiceProvider);
  return service.fetchAllowedSubjects();
});

/// Look up a single subject by code from the cached `subjectsProvider` list.
///
/// Returns `null` if the provider hasn't loaded yet or the code is unknown.
/// Safe to call from any `ConsumerWidget` with a `WidgetRef`.
Subject? findSubject(WidgetRef ref, String code) {
  final list = ref.watch(subjectsProvider).valueOrNull;
  if (list == null) return null;
  for (final s in list) {
    if (s.code == code) return s;
  }
  return null;
}
