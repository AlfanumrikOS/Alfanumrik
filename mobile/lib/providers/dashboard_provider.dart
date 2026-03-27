import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/dashboard_data.dart';
import '../data/repositories/dashboard_repository.dart';
import 'auth_provider.dart';

final dashboardRepositoryProvider = Provider<DashboardRepository>((ref) {
  return DashboardRepository();
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
