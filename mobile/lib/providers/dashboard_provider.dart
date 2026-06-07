import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/constants/api_constants.dart';
import '../core/network/v2_api_client.dart';
import '../data/models/dashboard_data.dart';
import '../data/repositories/dashboard_repository.dart';
import 'auth_provider.dart';

final dashboardRepositoryProvider = Provider<DashboardRepository>((ref) {
  // Inject the generated /v2 client ONLY when the flag is on. Flag-OFF builds
  // pass null so the legacy RPC/table path is byte-identical and the dart-dio
  // client is never constructed.
  return DashboardRepository(
    v2Client: ApiConstants.useV2 ? ref.read(v2ApiClientProvider) : null,
  );
});

/// Dashboard data — auto-fetches when student is available
final dashboardProvider =
    AsyncNotifierProvider<DashboardNotifier, DashboardData>(
        DashboardNotifier.new);

class DashboardNotifier extends AsyncNotifier<DashboardData> {
  @override
  Future<DashboardData> build() async {
    final student = ref.watch(studentProvider).valueOrNull;
    if (student == null) return const DashboardData();

    final repo = ref.read(dashboardRepositoryProvider);
    final result = await repo.getDashboardData(student.id);
    return result.dataOrNull ?? const DashboardData();
  }

  Future<void> refresh() async {
    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    final repo = ref.read(dashboardRepositoryProvider);
    await repo.invalidate(student.id);
    state = const AsyncLoading();
    final result = await repo.getDashboardData(student.id);
    state = AsyncData(result.dataOrNull ?? const DashboardData());
  }
}
