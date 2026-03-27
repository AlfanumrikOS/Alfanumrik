import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/network/api_result.dart';
import '../models/chat_message.dart';

class ChatRepository {
  final SupabaseClient _client;

  ChatRepository({
    SupabaseClient? client,
  })  : _client = client ?? Supabase.instance.client;

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
  /// Calls the Edge Function (or API route) for AI response.
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

      // Call Foxy AI (Edge Function)
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
        // Check for usage limit
        if (res.status == 429) {
          return const ApiFailure('Daily chat limit reached. Upgrade for more!', 429);
        }
        return ApiFailure('Foxy is taking a break. Try again!', res.status);
      }

      final data = res.data as Map<String, dynamic>;
      final reply = data['reply'] as String? ?? 'Sorry, I couldn\'t respond.';

      return ApiSuccess(ChatMessage(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        role: 'assistant',
        content: reply,
        timestamp: DateTime.now(),
      ));
    } catch (e) {
      return ApiFailure('Failed to get response: ${e.toString()}');
    }
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
