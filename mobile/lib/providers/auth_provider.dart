import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../data/models/student.dart';
import '../data/repositories/auth_repository.dart';
import '../core/network/api_result.dart';

/// Repository singleton
final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository();
});

/// Current student — loaded after auth, refreshed on profile changes
final studentProvider =
    AsyncNotifierProvider<StudentNotifier, Student?>(StudentNotifier.new);

class StudentNotifier extends AsyncNotifier<Student?> {
  @override
  Future<Student?> build() async {
    final repo = ref.read(authRepositoryProvider);
    final user = Supabase.instance.client.auth.currentUser;
    if (user == null) return null;

    final result = await repo.getCurrentStudent();
    return result.dataOrNull;
  }

  Future<ApiResult<Student>> signIn({
    required String email,
    required String password,
  }) async {
    state = const AsyncLoading();
    final result = await ref.read(authRepositoryProvider).signIn(
          email: email,
          password: password,
        );
    result.when(
      success: (student) => state = AsyncData(student),
      failure: (msg) => state = AsyncError(msg, StackTrace.current),
    );
    return result;
  }

  Future<ApiResult<Student>> signUp({
    required String email,
    required String password,
    required String name,
    required String grade,
  }) async {
    state = const AsyncLoading();
    final result = await ref.read(authRepositoryProvider).signUp(
          email: email,
          password: password,
          name: name,
          grade: grade,
        );
    result.when(
      success: (student) => state = AsyncData(student),
      failure: (msg) => state = AsyncError(msg, StackTrace.current),
    );
    return result;
  }

  Future<void> signOut() async {
    await ref.read(authRepositoryProvider).signOut();
    state = const AsyncData(null);
  }

  Future<void> refresh() async {
    final result = await ref.read(authRepositoryProvider).refreshProfile();
    result.when(
      success: (student) => state = AsyncData(student),
      failure: (_) {},
    );
  }
}

/// Auth state stream — drives router redirects
final authStateProvider = StreamProvider<AuthState>((ref) {
  return ref.read(authRepositoryProvider).authStateChanges;
});
