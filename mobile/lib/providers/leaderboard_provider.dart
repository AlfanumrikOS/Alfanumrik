import 'package:alfanumrik_api_v2/alfanumrik_api_v2.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/network/v2_api_client.dart';

/// Leaderboard period — the three values the `/v2/student/leaderboard`
/// contract accepts. `wire` is sent verbatim as the `period` query param.
enum LeaderboardPeriod {
  weekly('weekly'),
  monthly('monthly'),
  all('all');

  const LeaderboardPeriod(this.wire);
  final String wire;
}

/// Currently-selected leaderboard period. Driving the selector through a tiny
/// state provider (rather than a Notifier method) keeps the AsyncNotifier
/// below dependency-driven: it `ref.watch`es this and re-fetches on change.
final leaderboardPeriodProvider =
    StateProvider<LeaderboardPeriod>((ref) => LeaderboardPeriod.weekly);

/// Leaderboard state — fetched from `GET /v2/student/leaderboard`
/// (`StudentApi`) via the GENERATED dart-dio client (Wave 2.3b mobile-parity).
///
/// Re-fetches whenever [leaderboardPeriodProvider] changes. Mirrors the
/// [todayProvider] AsyncNotifier shape (loading / error / data + refresh).
/// Reached ONLY when `ApiConstants.useV2` is on.
///
/// P13: the response carries only what the endpoint returns (name / grade /
/// xp / rank / streak / school / city) — the screen surfaces exactly that, no
/// extra PII, and nothing is logged.
final leaderboardProvider =
    AsyncNotifierProvider<LeaderboardNotifier, LeaderboardResponse>(
        LeaderboardNotifier.new);

class LeaderboardNotifier extends AsyncNotifier<LeaderboardResponse> {
  @override
  Future<LeaderboardResponse> build() async {
    // Re-run build (and therefore re-fetch) whenever the period changes.
    final period = ref.watch(leaderboardPeriodProvider);
    return _fetch(period);
  }

  /// Pull-to-retry / pull-to-refresh for the current period.
  Future<void> refresh() async {
    final period = ref.read(leaderboardPeriodProvider);
    state = const AsyncLoading();
    state = await AsyncValue.guard(() => _fetch(period));
  }

  Future<LeaderboardResponse> _fetch(LeaderboardPeriod period) async {
    final client = ref.read(v2ApiClientProvider);
    final response =
        await client.studentApi.getStudentLeaderboard(period: period.wire);
    final data = response.data;
    if (data == null) {
      throw StateError('Leaderboard response had no body');
    }
    return data;
  }
}
