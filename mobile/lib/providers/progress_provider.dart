import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/network/v2_api_client.dart';

/// Student progress state — fetched from `GET /v2/student/progress`
/// (`StudentApi`) via the GENERATED dart-dio client (Wave 2.3b mobile-parity).
///
/// Mirrors the [todayProvider] AsyncNotifier shape so the Progress screen gets
/// first-class loading / error / data states and a `refresh()` for
/// pull-to-retry. Reached ONLY when `ApiConstants.useV2` is on — the flag-OFF
/// app never mounts the Progress screen, so this provider is never built.
final progressProvider =
    AsyncNotifierProvider<ProgressNotifier, StudentProgressResponse>(
        ProgressNotifier.new);

class ProgressNotifier extends AsyncNotifier<StudentProgressResponse> {
  @override
  Future<StudentProgressResponse> build() async {
    return _fetch();
  }

  /// Re-fetch progress (pull-to-retry / pull-to-refresh).
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }

  Future<StudentProgressResponse> _fetch() async {
    final client = ref.read(v2ApiClientProvider);
    // `client.studentApi` re-stamps the current Supabase Bearer token before
    // the request. The response is a fully-typed, built_value-deserialized
    // StudentProgressResponse (RLS-safe; the route reads only the caller's own
    // progress).
    final response = await client.studentApi.getStudentProgress();
    final data = response.data;
    if (data == null) {
      throw StateError('Progress response had no body');
    }
    return data;
  }
}
