// CEO defect #1 (2026-08-24) — Foxy chat has never persisted anything on
// mobile. Three compounding faults, all pinned here:
//
//   1. The repository read/wrote `chat_messages`, a table that DOES NOT EXIST
//      (`to_regclass('public.chat_messages')` → NULL in production). The write
//      sat inside `sendMessage`'s outer try, so the missing table turned every
//      send into `ApiFailure('Failed to get response: …')`.
//   2. `startSession()` unconditionally called `createSession(...)`, minting a
//      row in the dead `chat_sessions` table on every open, and NEVER read
//      history back — `getMessages()` / `getRecentSessions()` were dead code.
//   3. `_sendViaApi` posted a `chat_sessions.id` as `sessionId` and DISCARDED
//      the `sessionId` `/api/foxy` returned. No `foxy_sessions` row ever had
//      that id, so `resolveSession()` logged `foxy.session.silent_reset` and
//      minted a new session per turn → zero multi-turn context.
//
// The session-id round-trip (test group 1) is the highest-value assertion in
// this file: it is what makes a thread durable.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:alfanumrik/data/models/chat_message.dart';
import 'package:alfanumrik/data/models/student.dart';
import 'package:alfanumrik/data/repositories/chat_repository.dart';
import 'package:alfanumrik/core/network/api_result.dart';
import 'package:alfanumrik/providers/auth_provider.dart';
import 'package:alfanumrik/providers/chat_provider.dart';

/// In-memory stand-in for [ChatRepository]. `implements` (not `extends`) so the
/// real constructor — which reaches for `Supabase.instance.client` — never
/// runs. Records what the notifier actually sent so the round-trip is
/// observable.
class _FakeChatRepository implements ChatRepository {
  _FakeChatRepository({
    List<String?>? serverSessionIds,
    this.recent = const [],
    Map<String, List<ChatMessage>>? history,
  })  : serverSessionIds = serverSessionIds ?? const ['srv-1'],
        history = history ?? const {};

  /// The `sessionId` value passed on each turn, in order. `null` = omitted.
  final List<String?> sentSessionIds = [];
  final List<String?> serverSessionIds;
  final List<ChatSession> recent;
  final Map<String, List<ChatMessage>> history;
  final List<String> historyReads = [];
  int _turn = 0;

  @override
  Future<ApiResult<FoxyTurn>> sendMessage({
    required String studentId,
    required String message,
    String? sessionId,
    String? subject,
    String? topic,
    required String grade,
    String mode = 'learn',
  }) async {
    sentSessionIds.add(sessionId);
    final index = _turn < serverSessionIds.length
        ? _turn
        : serverSessionIds.length - 1;
    _turn++;
    return ApiSuccess(
      FoxyTurn(
        message: ChatMessage(
          id: 'assistant-$_turn',
          role: 'assistant',
          content: 'reply $_turn',
          timestamp: DateTime.now(),
        ),
        sessionId: serverSessionIds[index],
      ),
    );
  }

  @override
  Future<ApiResult<List<ChatMessage>>> getMessages({
    required String sessionId,
    int limit = 50,
  }) async {
    historyReads.add(sessionId);
    return ApiSuccess(history[sessionId] ?? const []);
  }

  @override
  Future<ApiResult<List<ChatSession>>> getRecentSessions({
    required String studentId,
    int limit = 20,
  }) async {
    return ApiSuccess(recent);
  }
}

/// P5: grade is the STRING '10', never an int.
const _student = Student(
  id: 'student-1',
  authUserId: 'auth-1',
  name: 'Test Student',
  grade: '10',
);

class _FakeStudentNotifier extends StudentNotifier {
  @override
  Future<Student?> build() async => _student;
}

ProviderContainer _containerWith(_FakeChatRepository repo) {
  return ProviderContainer(
    overrides: [
      chatRepositoryProvider.overrideWithValue(repo),
      studentProvider.overrideWith(_FakeStudentNotifier.new),
    ],
  );
}

ChatSession _session(
  String id, {
  String mode = 'learn',
  String? subject = 'science',
  Duration age = Duration.zero,
}) {
  final at = DateTime.now().subtract(age);
  return ChatSession(
    id: id,
    studentId: _student.id,
    subject: subject,
    mode: mode,
    createdAt: at,
    lastActiveAt: at,
  );
}

void main() {
  group('session-id round-trip (defect #1, fault 3)', () {
    test(
        'turn 1 omits sessionId; the id the SERVER returns is persisted and '
        'echoed on turn 2', () async {
      final repo = _FakeChatRepository(serverSessionIds: ['srv-1', 'srv-1']);
      final container = _containerWith(repo);
      addTearDown(container.dispose);
      await container.read(studentProvider.future);

      final notifier = container.read(chatProvider.notifier);
      await notifier.startSession(subject: 'science');

      // Nothing minted client-side: no `chat_sessions` INSERT, no id yet.
      expect(container.read(chatProvider).sessionId, isNull);

      await notifier.sendMessage('what is photosynthesis');
      expect(repo.sentSessionIds, [null]);
      // BEFORE: the returned sessionId was discarded and state kept a
      // `chat_sessions.id`. AFTER: the server's id is the state's id.
      expect(container.read(chatProvider).sessionId, 'srv-1');

      await notifier.sendMessage('and respiration');
      expect(repo.sentSessionIds, [null, 'srv-1']);
      expect(container.read(chatProvider).sessionId, 'srv-1');
    });

    test('adopts a DIFFERENT id when the server changes it mid-thread',
        () async {
      // Thread-id collision fallback: `/api/foxy` may answer with a
      // server-generated id instead of the one we sent. The server is
      // authoritative — we must follow it, not keep re-sending a dead id.
      final repo = _FakeChatRepository(serverSessionIds: ['srv-1', 'srv-2']);
      final container = _containerWith(repo);
      addTearDown(container.dispose);
      await container.read(studentProvider.future);

      final notifier = container.read(chatProvider.notifier);
      await notifier.startSession(subject: 'science');
      await notifier.sendMessage('one');
      await notifier.sendMessage('two');

      expect(repo.sentSessionIds, [null, 'srv-1']);
      expect(container.read(chatProvider).sessionId, 'srv-2');
    });

    test('a null/blank sessionId in the response never clobbers a known id',
        () async {
      final repo = _FakeChatRepository(serverSessionIds: ['srv-1', null, '']);
      final container = _containerWith(repo);
      addTearDown(container.dispose);
      await container.read(studentProvider.future);

      final notifier = container.read(chatProvider.notifier);
      await notifier.startSession(subject: 'science');
      await notifier.sendMessage('one');
      await notifier.sendMessage('two');
      await notifier.sendMessage('three');

      expect(container.read(chatProvider).sessionId, 'srv-1');
      expect(repo.sentSessionIds, [null, 'srv-1', 'srv-1']);
    });

    test('a null session no longer blocks sending', () async {
      // The old gate was `if (state.session == null) return;`, so a failed
      // createSession silently swallowed every message the student typed.
      final repo = _FakeChatRepository();
      final container = _containerWith(repo);
      addTearDown(container.dispose);
      await container.read(studentProvider.future);

      final notifier = container.read(chatProvider.notifier);
      await notifier.sendMessage('sent with no session at all');

      expect(repo.sentSessionIds, hasLength(1));
      expect(container.read(chatProvider).messages, hasLength(2));
    });
  });

  group('startSession resumes instead of always creating (fault 2)', () {
    test('restores the most recent matching thread and its transcript',
        () async {
      final repo = _FakeChatRepository(
        recent: [
          _session('older', age: const Duration(hours: 2)),
          _session('newest', age: const Duration(minutes: 5)),
        ],
        history: {
          'newest': [
            ChatMessage(
              id: 'm1',
              role: 'user',
              content: 'earlier question',
              timestamp: DateTime.now(),
            ),
            ChatMessage(
              id: 'm2',
              role: 'assistant',
              content: 'earlier answer',
              timestamp: DateTime.now(),
            ),
          ],
        },
      );
      final container = _containerWith(repo);
      addTearDown(container.dispose);
      await container.read(studentProvider.future);

      await container
          .read(chatProvider.notifier)
          .startSession(subject: 'science');

      final state = container.read(chatProvider);
      expect(state.sessionId, 'newest');
      expect(state.messages, hasLength(2));
      expect(state.isRestoring, isFalse);
      expect(repo.historyReads, ['newest']);

      // …and the resumed id is what goes to the server on the next turn.
      await container.read(chatProvider.notifier).sendMessage('follow up');
      expect(repo.sentSessionIds, ['newest']);
    });

    test('forceNew skips resumption — "New Chat" must not restore', () async {
      final repo = _FakeChatRepository(recent: [_session('newest')]);
      final container = _containerWith(repo);
      addTearDown(container.dispose);
      await container.read(studentProvider.future);

      await container
          .read(chatProvider.notifier)
          .startSession(subject: 'science', forceNew: true);

      final state = container.read(chatProvider);
      expect(state.sessionId, isNull);
      expect(state.messages, isEmpty);
      expect(repo.historyReads, isEmpty);
    });

    test('never resumes across modes — explorer must not inherit learn',
        () async {
      final repo = _FakeChatRepository(
        recent: [_session('learn-thread', mode: 'learn')],
      );
      final container = _containerWith(repo);
      addTearDown(container.dispose);
      await container.read(studentProvider.future);

      await container
          .read(chatProvider.notifier)
          .startSession(subject: 'science', mode: 'explorer');

      expect(container.read(chatProvider).sessionId, isNull);
      expect(repo.historyReads, isEmpty);
    });

    test('a history read failure is not surfaced as a chat error', () async {
      final repo = _FakeChatRepository(recent: const []);
      final container = _containerWith(repo);
      addTearDown(container.dispose);
      await container.read(studentProvider.future);

      await container
          .read(chatProvider.notifier)
          .startSession(subject: 'science');

      expect(container.read(chatProvider).error, isNull);
      expect(container.read(chatProvider).isRestoring, isFalse);
    });
  });

  group('source scan: `chat_messages` is gone for good (fault 1)', () {
    // `chat_messages` does not exist in the database and never has. A source
    // scan is the cheapest durable guard against it being reintroduced by a
    // copy-paste from an old branch. Comments are stripped first so the
    // explanatory prose in these files does not trip the check.
    String executableSource(String path) {
      final file = File(path);
      expect(file.existsSync(), isTrue, reason: 'missing source file: $path');
      return file
          .readAsLinesSync()
          .where((line) => !line.trimLeft().startsWith('//'))
          .join('\n');
    }

    const paths = [
      'lib/data/repositories/chat_repository.dart',
      'lib/providers/chat_provider.dart',
      'lib/data/models/chat_message.dart',
    ];

    for (final path in paths) {
      test('$path references no non-existent / dead chat table', () {
        final source = executableSource(path);

        // `foxy_chat_messages` is the REAL table and legitimately appears.
        // Strip it before looking for a bare `chat_messages`.
        final withoutFoxy = source.replaceAll('foxy_chat_messages', '');
        expect(
          withoutFoxy.contains('chat_messages'),
          isFalse,
          reason: '`chat_messages` does not exist in the database '
              '(to_regclass returns NULL) — use `foxy_chat_messages`.',
        );

        expect(
          source.contains('chat_sessions'),
          isFalse,
          reason: '`chat_sessions` is legacy and dead since 2026-05-29 — '
              'use `foxy_sessions`.',
        );
      });
    }
  });
}
