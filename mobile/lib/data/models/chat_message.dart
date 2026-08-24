import 'package:equatable/equatable.dart';

class ChatMessage extends Equatable {
  final String id;
  final String role; // 'user' | 'assistant'
  final String content;
  final DateTime timestamp;
  final bool isLoading;

  const ChatMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.timestamp,
    this.isLoading = false,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    return ChatMessage(
      id: json['id'] as String? ?? '',
      role: json['role'] as String,
      content: json['content'] as String,
      timestamp: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : DateTime.now(),
    );
  }

  factory ChatMessage.user(String content) {
    return ChatMessage(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      role: 'user',
      content: content,
      timestamp: DateTime.now(),
    );
  }

  factory ChatMessage.assistantLoading() {
    return ChatMessage(
      id: 'loading',
      role: 'assistant',
      content: '',
      timestamp: DateTime.now(),
      isLoading: true,
    );
  }

  bool get isUser => role == 'user';
  bool get isAssistant => role == 'assistant';

  @override
  List<Object?> get props => [id, role, content, timestamp];
}

/// A Foxy conversation thread.
///
/// Backed by `public.foxy_sessions` — NOT the legacy `chat_sessions` table
/// (dead since 2026-05-29) and definitely not `chat_messages`, which has never
/// existed in this database. Column mapping:
///
/// | Dart          | `foxy_sessions`  |
/// |---------------|------------------|
/// | `topic`       | `chapter`        |
/// | `lastActiveAt`| `last_active_at` |
/// | `mode`        | `mode`           |
///
/// There is no `message_count` column on `foxy_sessions`; the field is
/// populated only when the row comes from the (forthcoming)
/// `GET /api/foxy/sessions` list endpoint, which computes it server-side.
class ChatSession extends Equatable {
  final String id;
  final String studentId;
  final String? subject;

  /// Maps to `foxy_sessions.chapter`.
  final String? topic;

  /// Foxy session mode — `learn | explain | practice | revise | doubt |
  /// homework | explorer | olympiad | lesson`.
  final String mode;
  final int messageCount;
  final DateTime createdAt;

  /// `foxy_sessions.last_active_at`. Null when the source payload omits it
  /// (fall back to [createdAt] via [activeAt]).
  final DateTime? lastActiveAt;

  const ChatSession({
    required this.id,
    required this.studentId,
    this.subject,
    this.topic,
    this.mode = 'learn',
    this.messageCount = 0,
    required this.createdAt,
    this.lastActiveAt,
  });

  /// Last-activity timestamp with a safe fallback.
  DateTime get activeAt => lastActiveAt ?? createdAt;

  /// Parse a `foxy_sessions` row (snake_case, from the RLS-scoped Supabase
  /// client) OR a `GET /api/foxy/sessions` entry (camelCase). Both shapes are
  /// accepted so swapping the read source is a one-line change in
  /// `ChatRepository.getRecentSessions`.
  factory ChatSession.fromFoxyJson(
    Map<String, dynamic> json, {
    String? studentId,
  }) {
    DateTime? parse(Object? v) =>
        v is String && v.isNotEmpty ? DateTime.tryParse(v) : null;

    final created = parse(json['created_at']) ?? DateTime.now();
    return ChatSession(
      id: json['id'] as String,
      studentId: (json['student_id'] as String?) ?? studentId ?? '',
      subject: json['subject'] as String?,
      topic: (json['chapter'] ?? json['topic']) as String?,
      mode: (json['mode'] as String?) ?? 'learn',
      messageCount:
          ((json['message_count'] ?? json['messageCount']) as num?)?.toInt() ??
              0,
      createdAt: created,
      lastActiveAt:
          parse(json['last_active_at']) ?? parse(json['updatedAt']) ?? created,
    );
  }

  ChatSession copyWith({
    String? id,
    String? subject,
    String? topic,
    String? mode,
    int? messageCount,
    DateTime? lastActiveAt,
  }) {
    return ChatSession(
      id: id ?? this.id,
      studentId: studentId,
      subject: subject ?? this.subject,
      topic: topic ?? this.topic,
      mode: mode ?? this.mode,
      messageCount: messageCount ?? this.messageCount,
      createdAt: createdAt,
      lastActiveAt: lastActiveAt ?? this.lastActiveAt,
    );
  }

  @override
  List<Object?> get props => [id, studentId, subject, topic, mode];
}
