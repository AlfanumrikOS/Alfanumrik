import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/network/api_result.dart';
import '../../core/cache/cache_manager.dart';
import '../models/student.dart';

class AuthRepository {
  final SupabaseClient _client;
  final CacheManager _cache;

  AuthRepository({
    SupabaseClient? client,
    CacheManager? cache,
  })  : _client = client ?? Supabase.instance.client,
        _cache = cache ?? CacheManager();

  /// Current auth user
  User? get currentUser => _client.auth.currentUser;

  /// Auth state stream
  Stream<AuthState> get authStateChanges => _client.auth.onAuthStateChange;

  /// Sign up with email + password, then create student profile
  Future<ApiResult<Student>> signUp({
    required String email,
    required String password,
    required String name,
    required String grade,
  }) async {
    try {
      final authRes = await _client.auth.signUp(
        email: email,
        password: password,
        data: {'name': name},
      );

      if (authRes.user == null) {
        return const ApiFailure('Registration failed. Please try again.');
      }

      // Create student profile
      final studentData = {
        'auth_user_id': authRes.user!.id,
        'name': name,
        'email': email,
        'grade': 'Grade $grade',
        'board': 'CBSE',
        'role': 'student',
        'plan_code': 'free',
        'xp_total': 0,
        'level': 1,
      };

      final res = await _client
          .from('students')
          .insert(studentData)
          .select()
          .single();

      final student = Student.fromJson(res);
      await _cache.put('current_student', res);
      return ApiSuccess(student);
    } on AuthException catch (e) {
      if (e.message.contains('already registered')) {
        return const ApiFailure('This email is already registered.');
      }
      return ApiFailure(e.message);
    } catch (e) {
      return ApiFailure('Sign up failed: ${e.toString()}');
    }
  }

  /// Sign in with email + password
  Future<ApiResult<Student>> signIn({
    required String email,
    required String password,
  }) async {
    try {
      final authRes = await _client.auth.signInWithPassword(
        email: email,
        password: password,
      );

      if (authRes.user == null) {
        return const ApiFailure('Invalid email or password.');
      }

      // Fetch student profile
      final res = await _client
          .from('students')
          .select()
          .eq('auth_user_id', authRes.user!.id)
          .maybeSingle();

      if (res == null) {
        return const ApiFailure('Student profile not found.');
      }

      final student = Student.fromJson(res);
      await _cache.put('current_student', res);
      return ApiSuccess(student);
    } on AuthException catch (e) {
      return ApiFailure(e.message);
    } catch (e) {
      return ApiFailure('Sign in failed. Please try again.');
    }
  }

  /// Get current student profile (cached first, then network)
  Future<ApiResult<Student>> getCurrentStudent() async {
    try {
      // Try cache first
      final cached = _cache.get<Student>('current_student', Student.fromJson);
      if (cached != null) return ApiSuccess(cached);

      final user = currentUser;
      if (user == null) {
        return const ApiFailure('Not authenticated.');
      }

      final res = await _client
          .from('students')
          .select()
          .eq('auth_user_id', user.id)
          .maybeSingle();

      if (res == null) {
        return const ApiFailure('Student profile not found.');
      }

      await _cache.put('current_student', res);
      return ApiSuccess(Student.fromJson(res));
    } catch (e) {
      return ApiFailure('Failed to load profile: ${e.toString()}');
    }
  }

  /// Sign out and clear cache
  Future<void> signOut() async {
    await _client.auth.signOut();
    await _cache.clearAll();
  }

  /// Refresh student profile from network
  Future<ApiResult<Student>> refreshProfile() async {
    await _cache.remove('current_student');
    return getCurrentStudent();
  }
}
