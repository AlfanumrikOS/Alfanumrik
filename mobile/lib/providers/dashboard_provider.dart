import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/dashboard_data.dart';
import '../data/repositories/dashboard_repository.dart';
import 'auth_provider.dart';
import 'experience_provider.dart';

final dashboardRepositoryProvider = Provider<DashboardRepository>((ref) {
  // The build switch only permits assignment resolution. Inject the generated
  // client after an explicit server-enabled assignment; legacy/denied/loading
  // states retain the historical RPC/table data plane.
  return DashboardRepository(
    v2Client: ref.watch(oneExperienceV2ApiClientProvider),
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

    final repo = ref.watch(dashboardRepositoryProvider);
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
