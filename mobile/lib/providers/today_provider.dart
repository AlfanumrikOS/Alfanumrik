import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/network/v2_api_client.dart';

/// Adaptive "Today" home state — fetched from the `/v2` `TodayApi` via the
/// GENERATED dart-dio client (Wave 2.3 mobile-parity). This is the centerpiece
/// of the `/v2` surface: a server-resolved, ordered "what could I do today?"
/// queue rendered straight from the contract DTO.
///
/// AsyncNotifier so the screen gets first-class loading / error / data states
/// and a `refresh()` for pull-to-retry — mirroring the existing
/// `dashboardProvider` pattern.
final todayProvider =
    AsyncNotifierProvider<TodayNotifier, TodayResponse>(TodayNotifier.new);

class TodayNotifier extends AsyncNotifier<TodayResponse> {
  @override
  Future<TodayResponse> build() async {
    return _fetch();
  }

  /// Re-fetch the Today queue (pull-to-retry / pull-to-refresh).
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_fetch);
  }

  Future<TodayResponse> _fetch() async {
    final client = ref.read(v2ApiClientProvider);
    // `client.todayApi` re-stamps the current Supabase Bearer token before the
    // request (see V2ApiClient.api). The response is a fully-typed,
    // built_value-deserialized TodayResponse.
    final response = await client.todayApi.getToday();
    final data = response.data;
    if (data == null) {
      throw StateError('Today response had no body');
    }
    return data;
  }
}
