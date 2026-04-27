import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/constants/api_constants.dart';
import '../../core/errors/app_exception.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/chat_message.dart';

class ChatRepository {
  final SupabaseClient _client;
  final ApiClient _api;

  /// Foxy endpoint selector. Defaults to compile-time config
  /// (`ApiConstants.foxyEndpoint`). Override only in tests.
  ///
  /// Values: 'edge' (legacy foxy-tutor Edge Function) | 'api' (new /api/foxy).
  final String _foxyEndpoint;

  ChatRepository({
    SupabaseClient? client,
    ApiClient? api,
    String? foxyEndpoint,
  })  : _client = client ?? Supabase.instance.client,
        _api = api ?? ApiClient(),
        _foxyEndpoint = foxyEndpoint ?? ApiConstants.foxyEndpoint;

  /// Create a new chat session
  Future<ApiResult<ChatSession>> createSession({
    required String studentId,
    String? subject,
    String? topic,
  }) async {
    try {
      final res = await _client
          .from('chat_sessions')
          .insert({
            'student_id': studentId,
            'subject': subject,
            'topic': topic,
          })
          .select()
          .single();

      return ApiSuccess(ChatSession.fromJson(res));
    } catch (e) {
      return ApiFailure('Failed to start chat: ${e.toString()}');
    }
  }

  /// Load recent messages for a session (paginated)
  Future<ApiResult<List<ChatMessage>>> getMessages({
    required String sessionId,
    int limit = 50,
    int offset = 0,
  }) async {
    try {
      final res = await _client
          .from('chat_messages')
          .select()
          .eq('session_id', sessionId)
          .order('created_at', ascending: true)
          .range(offset, offset + limit - 1);

      final messages = (res as List<dynamic>)
          .map((e) => ChatMessage.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);

      return ApiSuccess(messages);
    } catch (e) {
      return ApiFailure('Failed to load messages: ${e.toString()}');
    }
  }

  /// Send a message to Foxy and get response.
  ///
  /// Routes to either the legacy Edge Function (`foxy-tutor`) or the new
  /// Next.js route (`/api/foxy`) based on [ApiConstants.foxyEndpoint].
  ///
  /// Default ('edge') preserves prior behavior. Ops flips the default to
  /// 'api' in a future build after staging validates parity.
  Future<ApiResult<ChatMessage>> sendMessage({
    required String sessionId,
    required String studentId,
    required String message,
    String? subject,
    String? topic,
    required String grade,
  }) async {
    try {
      // Save user message
      await _client.from('chat_messages').insert({
        'session_id': sessionId,
        'role': 'user',
        'content': message,
      });

      if (_foxyEndpoint == 'api') {
        return _sendViaApi(
          sessionId: sessionId,
          message: message,
          subject: subject,
          topic: topic,
          grade: grade,
        );
      }
      return _sendViaEdge(
        sessionId: sessionId,
        studentId: studentId,
        message: message,
        subject: subject,
        topic: topic,
        grade: grade,
      );
    } catch (e) {
      return ApiFailure('Failed to get response: ${e.toString()}');
    }
  }

  // ─── Legacy path: foxy-tutor Edge Function ──────────────────────────────────
  //
  // DEPRECATED. FTS-only retrieval, weaker P12 rails. Kept as fallback while
  // mobile clients in the wild are still on this path. Will be removed in a
  // future PR after >95% of active clients migrate to the 'api' path.
  Future<ApiResult<ChatMessage>> _sendViaEdge({
    required String sessionId,
    required String studentId,
    required String message,
    String? subject,
    String? topic,
    required String grade,
  }) async {
    final res = await _client.functions.invoke(
      'foxy-tutor',
      body: {
        'session_id': sessionId,
        'student_id': studentId,
        'message': message,
        'subject': subject,
        'topic': topic,
        'grade': grade,
        'mode': 'learn',
      },
    );

    if (res.status != 200) {
      // 429 = quota exceeded on legacy path
      if (res.status == 429) {
        return const ApiFailure(
          'Daily chat limit reached. Upgrade for more!',
          429,
        );
      }
      return ApiFailure('Foxy is taking a break. Try again!', res.status);
    }

    final data = res.data as Map<String, dynamic>;
    final parsed = parseEdgeResponseForTest(data) ??
        ChatMessage(
          id: DateTime.now().millisecondsSinceEpoch.toString(),
          role: 'assistant',
          content: "Sorry, I couldn't respond.",
          timestamp: DateTime.now(),
        );
    return ApiSuccess(parsed);
  }

  // ─── New path: Next.js /api/foxy → grounded-answer service ──────────────────
  //
  // Voyage RAG + RRF k=60 + rerank-2 + Sonnet, P12-grade safety rails, IRT
  // aware. Response shape differs from the Edge Function (see adapter below).
  Future<ApiResult<ChatMessage>> _sendViaApi({
    required String sessionId,
    required String message,
    String? subject,
    String? topic,
    required String grade,
  }) async {
    try {
      // ApiClient prepends `apiBase` to the path; pass relative path only.
      // /api/foxy expects: { message, subject, grade, chapter?, sessionId?, mode? }
      final response = await _api.post(
        '/foxy',
        data: {
          'message': message,
          'subject': subject ?? '',
          'grade': grade,
          if (topic != null) 'chapter': topic,
          'sessionId': sessionId,
          'mode': 'learn',
        },
      );

      final raw = response.data;
      if (raw is! Map<String, dynamic>) {
        return const ApiFailure('Foxy returned an unexpected response.');
      }

      // Hard-abstain + grounded responses both flow through the adapter.
      // Adapter returns null only if `response` is missing on a non-abstain
      // body — we treat that as a fallback "couldn't respond" message rather
      // than an error so the UI doesn't break.
      final parsed = parseApiResponseForTest(raw) ??
          ChatMessage(
            id: DateTime.now().millisecondsSinceEpoch.toString(),
            role: 'assistant',
            content: "Sorry, I couldn't respond.",
            timestamp: DateTime.now(),
          );
      return ApiSuccess(parsed);
    } on UsageLimitException {
      // ApiClient maps 429 → UsageLimitException
      return const ApiFailure(
        'Daily chat limit reached. Upgrade for more!',
        429,
      );
    } on NetworkException catch (e) {
      // 402 isn't currently emitted by /api/foxy (429 is the canonical quota
      // signal), but route this defensively in case backend adds it later.
      if (e.statusCode == 402) {
        return const ApiFailure(
          'Daily chat limit reached. Upgrade for more!',
          402,
        );
      }
      if (e.statusCode == 503) {
        return const ApiFailure('Foxy is taking a break. Try again!', 503);
      }
      return ApiFailure(e.message, e.statusCode);
    } on DioException catch (e) {
      final code = e.response?.statusCode;
      if (code == 429 || code == 402) {
        return ApiFailure(
          'Daily chat limit reached. Upgrade for more!',
          code,
        );
      }
      return ApiFailure('Foxy is taking a break. Try again!', code);
    }
  }

  // ─── Pure helpers (testable without network) ───────────────────────────────

  /// Resolve which Foxy URL a given endpoint mode would target. Used by tests
  /// to confirm the endpoint switch wires correctly without spinning up Dio
  /// or the Supabase Functions client.
  static String resolveFoxyUrlForTest(String endpointMode, {
    String? supabaseUrl,
    String? apiBase,
  }) {
    if (endpointMode == 'api') {
      return '${apiBase ?? ApiConstants.apiBase}/foxy';
    }
    return '${supabaseUrl ?? ApiConstants.supabaseUrl}/functions/v1/foxy-tutor';
  }

  /// Parse a /api/foxy success/abstain response body into a ChatMessage.
  /// Pure function — exposed for unit testing the adapter without network.
  ///
  /// Returns null if the body is malformed.
  static ChatMessage? parseApiResponseForTest(Map<String, dynamic> raw) {
    final groundingStatus = raw['groundingStatus'] as String?;
    if (groundingStatus == 'hard-abstain') {
      return ChatMessage(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        role: 'assistant',
        content:
            "I'm not sure about that one — let me suggest you check the NCERT textbook or ask your teacher. 🦊",
        timestamp: DateTime.now(),
      );
    }
    final reply = raw['response'] as String?;
    if (reply == null) return null;
    return ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      role: 'assistant',
      content: reply,
      timestamp: DateTime.now(),
    );
  }

  /// Parse a foxy-tutor (Edge Function) response body into a ChatMessage.
  /// Pure function — exposed for backward-compat parsing tests.
  static ChatMessage? parseEdgeResponseForTest(Map<String, dynamic> raw) {
    final reply = raw['reply'] as String?;
    if (reply == null) return null;
    return ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      role: 'assistant',
      content: reply,
      timestamp: DateTime.now(),
    );
  }

  /// Get recent chat sessions for history
  Future<ApiResult<List<ChatSession>>> getRecentSessions({
    required String studentId,
    int limit = 20,
  }) async {
    try {
      final res = await _client
          .from('chat_sessions')
          .select()
          .eq('student_id', studentId)
          .order('created_at', ascending: false)
          .limit(limit);

      final sessions = (res as List<dynamic>)
          .map((e) => ChatSession.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);

      return ApiSuccess(sessions);
    } catch (e) {
      return ApiFailure('Failed to load history: ${e.toString()}');
    }
  }
}
