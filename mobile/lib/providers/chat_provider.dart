import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/chat_message.dart';
import '../data/repositories/chat_repository.dart';
import 'auth_provider.dart';

final chatRepositoryProvider = Provider<ChatRepository>((ref) {
  return ChatRepository();
});

/// Chat state — manages active session, messages, and sending
final chatProvider = NotifierProvider<ChatNotifier, ChatState>(ChatNotifier.new);

class ChatState {
  final ChatSession? session;
  final List<ChatMessage> messages;
  final bool isSending;
  final String? error;
  final String? subject;
  final String? topic;

  const ChatState({
    this.session,
    this.messages = const [],
    this.isSending = false,
    this.error,
    this.subject,
    this.topic,
  });

  ChatState copyWith({
    ChatSession? session,
    List<ChatMessage>? messages,
    bool? isSending,
    String? error,
    String? subject,
    String? topic,
  }) {
    return ChatState(
      session: session ?? this.session,
      messages: messages ?? this.messages,
      isSending: isSending ?? this.isSending,
      error: error,
      subject: subject ?? this.subject,
      topic: topic ?? this.topic,
    );
  }
}

class ChatNotifier extends Notifier<ChatState> {
  @override
  ChatState build() => const ChatState();

  /// Start a new chat session
  Future<void> startSession({String? subject, String? topic}) async {
    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    state = ChatState(subject: subject, topic: topic);

    final repo = ref.read(chatRepositoryProvider);
    final result = await repo.createSession(
      studentId: student.id,
      subject: subject,
      topic: topic,
    );

    result.when(
      success: (session) => state = state.copyWith(session: session),
      failure: (msg) => state = state.copyWith(error: msg),
    );
  }

  /// Send a message and get Foxy's response
  Future<void> sendMessage(String content) async {
    if (state.isSending || content.trim().isEmpty) return;

    final student = ref.read(studentProvider).valueOrNull;
    if (student == null || state.session == null) return;

    // Add user message immediately
    final userMsg = ChatMessage.user(content);
    final updatedMessages = [...state.messages, userMsg, ChatMessage.assistantLoading()];
    state = state.copyWith(messages: updatedMessages, isSending: true, error: null);

    final repo = ref.read(chatRepositoryProvider);
    final result = await repo.sendMessage(
      sessionId: state.session!.id,
      studentId: student.id,
      message: content,
      subject: state.subject,
      topic: state.topic,
      grade: student.grade,
    );

    result.when(
      success: (reply) {
        // Replace loading message with actual reply
        final msgs = state.messages
            .where((m) => !m.isLoading)
            .toList()
          ..add(reply);
        state = state.copyWith(messages: msgs, isSending: false);
      },
      failure: (msg) {
        final msgs = state.messages.where((m) => !m.isLoading).toList();
        state = state.copyWith(
          messages: msgs,
          isSending: false,
          error: msg,
        );
      },
    );
  }

  void clearError() {
    state = state.copyWith(error: null);
  }
}
