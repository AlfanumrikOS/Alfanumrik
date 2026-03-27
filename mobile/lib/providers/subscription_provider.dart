import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/subscription.dart';
import '../data/repositories/subscription_repository.dart';
import 'auth_provider.dart';

final subscriptionRepositoryProvider = Provider<SubscriptionRepository>((ref) {
  return SubscriptionRepository();
});

/// Current subscription state
final subscriptionProvider =
    AsyncNotifierProvider<SubscriptionNotifier, SubscriptionState>(
        SubscriptionNotifier.new);

class SubscriptionNotifier extends AsyncNotifier<SubscriptionState> {
  @override
  Future<SubscriptionState> build() async {
    final student = ref.watch(studentProvider).valueOrNull;
    if (student == null) {
      return const SubscriptionState(planCode: 'free');
    }

    final repo = ref.read(subscriptionRepositoryProvider);
    final result = await repo.getSubscription(student.id);
    return result.dataOrNull ?? const SubscriptionState(planCode: 'free');
  }

  Future<void> refresh() async {
    ref.invalidateSelf();
  }
}
