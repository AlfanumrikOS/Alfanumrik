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
  /// The active Foxy thread.
  ///
  /// NULL until the server hands one back. Sessions are minted by
  /// `/api/foxy`'s `resolveSession()` (service role) — the client never
  /// INSERTs a session row, so a null session is a perfectly normal
  /// "first turn not sent yet" state and must NOT block sending.
  final ChatSession? session;
  final List<ChatMessage> messages;
  final bool isSending;

  /// True while a previous thread's transcript is being restored.
  final bool isRestoring;
  final String? error;
  final String? subject;
  final String? topic;

  /// Foxy session mode sent with every message in this session. Defaults to
  /// `'learn'` — the value that was hardcoded in [ChatRepository] before the
  /// Weekly Curiosity Dive needed `'explorer'`. Set once by [startSession] and
  /// never changed mid-session (a mode switch means a NEW session, exactly
  /// like the web, where `/foxy?mode=…` is a fresh page load).
  final String mode;

  const ChatState({
    this.session,
    this.messages = const [],
    this.isSending = false,
    this.isRestoring = false,
    this.error,
    this.subject,
    this.topic,
    this.mode = 'learn',
  });

  /// The id to echo back to `/api/foxy` on the next turn. Null on turn one.
  String? get sessionId => session?.id;

  ChatState copyWith({
    ChatSession? session,
    List<ChatMessage>? messages,
    bool? isSending,
    bool? isRestoring,
    String? error,
    String? subject,
    String? topic,
    String? mode,
  }) {
    return ChatState(
      session: session ?? this.session,
      messages: messages ?? this.messages,
      isSending: isSending ?? this.isSending,
      isRestoring: isRestoring ?? this.isRestoring,
      error: error,
      subject: subject ?? this.subject,
      topic: topic ?? this.topic,
      mode: mode ?? this.mode,
    );
  }
}

class ChatNotifier extends Notifier<ChatState> {
  @override
  ChatState build() => const ChatState();

  /// Open a chat surface for [subject] / [topic] in [mode].
  ///
  /// CEO defect #1 (2026-08-24): this used to unconditionally call
  /// `repo.createSession(...)`, minting a fresh row in the dead `chat_sessions`
  /// table every single time Foxy was opened, and it never read history back —
  /// `getMessages()` and `getRecentSessions()` were dead code and mobile had no
  /// history at all.
  ///
  /// Now it RESUMES: it looks for the student's most recent `foxy_sessions`
  /// thread that matches [mode] + [subject] and is still inside the server's
  /// idle window, and restores its transcript. If nothing is resumable the
  /// state simply carries a null session and the FIRST send mints the thread
  /// server-side (see [sendMessage]).
  ///
  /// Pass [forceNew] to skip resumption — that is what the "New Chat" action
  /// wants.
  ///
  /// [mode] defaults to `'learn'`, so every pre-existing call site keeps its
  /// mode. The Weekly Curiosity Dive passes `'explorer'` to open Foxy in its
  /// Socratic exploration persona.
  Future<void> startSession({
    String? subject,
    String? topic,
    String mode = 'learn',
    bool forceNew = false,
  }) async {
    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    state = ChatState(
      subject: subject,
      topic: topic,
      mode: mode,
      isRestoring: !forceNew,
    );

    if (forceNew) return;

    final repo = ref.read(chatRepositoryProvider);
    final recent = await repo.getRecentSessions(studentId: student.id);

    // A history read failure is NOT a chat failure — the student can still
    // start a fresh thread. Stay silent rather than showing an error banner.
    final resumable = ChatRepository.pickResumableSession(
      recent.dataOrNull ?? const [],
      mode: mode,
      subject: subject,
      now: DateTime.now(),
    );

    if (resumable == null) {
      state = state.copyWith(isRestoring: false);
      return;
    }

    final history = await repo.getMessages(sessionId: resumable.id);
    state = state.copyWith(
      session: resumable,
      messages: history.dataOrNull ?? const [],
      isRestoring: false,
    );
  }

  /// Send a message and get Foxy's response.
  ///
  /// The gate used to be `state.session == null → return`, which meant a failed
  /// `createSession` silently swallowed every message the student typed. The
  /// session is now server-minted, so a null session is the normal first-turn
  /// state and must not block the send.
  Future<void> sendMessage(String content) async {
    if (state.isSending || content.trim().isEmpty) return;

    final student = ref.read(studentProvider).valueOrNull;
    if (student == null) return;

    // Add user message immediately
    final userMsg = ChatMessage.user(content);
    final updatedMessages = [...state.messages, userMsg, ChatMessage.assistantLoading()];
    state = state.copyWith(messages: updatedMessages, isSending: true, error: null);

    final repo = ref.read(chatRepositoryProvider);
    final result = await repo.sendMessage(
      // Null on the first turn; the id the SERVER returned on every turn after
      // that. Echoing the server's own id is what keeps `resolveSession()` on
      // its reuse branch instead of minting a new `foxy_sessions` row per turn.
      sessionId: state.sessionId,
      studentId: student.id,
      message: content,
      subject: state.subject,
      topic: state.topic,
      grade: student.grade,
      mode: state.mode,
    );

    result.when(
      success: (turn) {
        // Replace loading message with actual reply
        final msgs = state.messages
            .where((m) => !m.isLoading)
            .toList()
          ..add(turn.message);
        state = state.copyWith(
          messages: msgs,
          isSending: false,
          session: _adoptSessionId(turn.sessionId, student.id),
        );
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

  /// Persist the session id the server just handed back.
  ///
  /// The server is authoritative: if it returns an id that differs from the one
  /// we sent (thread-id collision fallback, or a fresh thread), we adopt it.
  /// Returns null when there is nothing to change, which leaves
  /// [ChatState.copyWith]'s existing session in place.
  ChatSession? _adoptSessionId(String? sessionId, String studentId) {
    if (sessionId == null || sessionId.isEmpty) return null;

    final current = state.session;
    if (current != null) {
      return current.id == sessionId ? null : current.copyWith(id: sessionId);
    }

    final now = DateTime.now();
    return ChatSession(
      id: sessionId,
      studentId: studentId,
      subject: state.subject,
      topic: state.topic,
      mode: state.mode,
      createdAt: now,
      lastActiveAt: now,
    );
  }

  void clearError() {
    state = state.copyWith(error: null);
  }
}
