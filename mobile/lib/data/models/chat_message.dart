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

class ChatSession extends Equatable {
  final String id;
  final String studentId;
  final String? subject;
  final String? topic;
  final int messageCount;
  final DateTime createdAt;

  const ChatSession({
    required this.id,
    required this.studentId,
    this.subject,
    this.topic,
    this.messageCount = 0,
    required this.createdAt,
  });

  factory ChatSession.fromJson(Map<String, dynamic> json) {
    return ChatSession(
      id: json['id'] as String,
      studentId: json['student_id'] as String,
      subject: json['subject'] as String?,
      topic: json['topic'] as String?,
      messageCount: json['message_count'] as int? ?? 0,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  @override
  List<Object?> get props => [id, studentId, subject, topic];
}
