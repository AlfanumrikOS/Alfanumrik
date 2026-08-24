// Unit tests for ChatRepository's pure logic — endpoint resolution and
// response-shape adapters for the foxy-tutor → /api/foxy migration (Audit F7).
//
// These tests intentionally exercise only the static helpers + constructor
// wiring. The full network paths (_sendViaEdge / _sendViaApi) require Supabase
// + Dio mocks, which are not currently in pubspec — those are covered by
// integration tests on the Next.js side.
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/constants/api_constants.dart';
import 'package:alfanumrik/data/models/chat_message.dart';
import 'package:alfanumrik/data/repositories/chat_repository.dart';

void main() {
  group('ApiConstants.foxyEndpoint', () {
    test('defaults to "api" — mobile uses the Next.js /api/foxy route', () {
      // Phase 2 cutover (PR feat/mobile-quiz-v2-and-foxy-route): default
      // flipped from 'edge' → 'api'. Mobile now matches the surface web has
      // been on (Voyage RAG + Sonnet + full P12 rails). The 'edge' branch
      // stays compiled-in indefinitely for old builds in the wild and as a
      // rollback path via --dart-define=FOXY_ENDPOINT=edge.
      //
      // If this assertion needs to change, update the docs:
      //   - mobile/docs/foxy-migration.md (rollout timeline)
      //   - mobile/lib/core/constants/api_constants.dart (the default itself)
      //   - mobile/build_apk.sh (the env-var default)
      expect(ApiConstants.foxyEndpoint, 'api');
    });
  });

  group('ChatRepository.resolveFoxyUrlForTest', () {
    test('endpointMode "edge" returns the foxy-tutor Edge Function URL', () {
      final url = ChatRepository.resolveFoxyUrlForTest(
        'edge',
        supabaseUrl: 'https://example.supabase.co',
        apiBase: 'https://alfanumrik.com/api',
      );
      expect(url, 'https://example.supabase.co/functions/v1/foxy-tutor');
    });

    test('endpointMode "api" returns the Next.js /api/foxy URL', () {
      final url = ChatRepository.resolveFoxyUrlForTest(
        'api',
        supabaseUrl: 'https://example.supabase.co',
        apiBase: 'https://alfanumrik.com/api',
      );
      expect(url, 'https://alfanumrik.com/api/foxy');
    });

    test('unknown endpointMode falls back to legacy edge URL', () {
      // Defensive default: any unexpected value (including null after env
      // strip) routes to 'edge'. This is the safe choice since 'edge' is
      // backward-compatible.
      final url = ChatRepository.resolveFoxyUrlForTest(
        'something-else',
        supabaseUrl: 'https://example.supabase.co',
        apiBase: 'https://alfanumrik.com/api',
      );
      expect(url, 'https://example.supabase.co/functions/v1/foxy-tutor');
    });
  });

  group('ChatRepository.parseEdgeResponseForTest (legacy foxy-tutor shape)',
      () {
    test('parses { reply, xp_earned, session_id } success body', () {
      final msg = ChatRepository.parseEdgeResponseForTest({
        'reply': 'Photosynthesis is the process by which plants make food.',
        'xp_earned': 0,
        'session_id': 'sess-abc',
      });
      expect(msg, isNotNull);
      expect(msg!.role, 'assistant');
      expect(msg.content, contains('Photosynthesis'));
    });

    test('returns null when reply field is missing', () {
      final msg = ChatRepository.parseEdgeResponseForTest({
        'xp_earned': 0,
        'session_id': 'sess-abc',
      });
      expect(msg, isNull);
    });
  });

  group('ChatRepository.parseApiResponseForTest (new /api/foxy shape)', () {
    test('parses grounded { success, response, sessionId, ... } success body',
        () {
      final msg = ChatRepository.parseApiResponseForTest({
        'success': true,
        'response':
            'Newton\'s second law states that F = ma, where F is the net force.',
        'sessionId': 'sess-xyz',
        'quotaRemaining': 5,
        'tokensUsed': 142,
        'confidence': 0.91,
        'groundingStatus': 'grounded',
        'traceId': 'trace-001',
      });
      expect(msg, isNotNull);
      expect(msg!.role, 'assistant');
      expect(msg.content, contains('F = ma'));
    });

    test(
        'hard-abstain body returns a safe "I don\'t know" message instead of '
        'an error', () {
      // Hard-abstain happens when the grounded-answer service ran but cannot
      // safely answer (out of CBSE scope, no NCERT chunks, low similarity).
      // Mobile must NOT surface this as an error — it's a successful
      // response that the student should see.
      final msg = ChatRepository.parseApiResponseForTest({
        'success': true,
        'response': '',
        'sessionId': 'sess-xyz',
        'quotaRemaining': 5,
        'tokensUsed': 0,
        'groundingStatus': 'hard-abstain',
        'abstainReason': 'low_similarity',
        'traceId': 'trace-002',
      });
      expect(msg, isNotNull);
      expect(msg!.role, 'assistant');
      expect(msg.content, contains('NCERT'));
    });

    test('returns null on malformed body (missing response field)', () {
      final msg = ChatRepository.parseApiResponseForTest({
        'success': true,
        'sessionId': 'sess-xyz',
        'groundingStatus': 'grounded',
      });
      expect(msg, isNull);
    });

    test('handles upgradePrompt-bearing response without breaking', () {
      // When quota is near exhaustion, /api/foxy attaches an upgradePrompt.
      // The adapter should still extract the response cleanly; UI layers
      // can read upgradePrompt separately if/when that lands in mobile.
      final msg = ChatRepository.parseApiResponseForTest({
        'success': true,
        'response': 'Sure, let me explain.',
        'sessionId': 'sess-xyz',
        'quotaRemaining': 2,
        'tokensUsed': 50,
        'groundingStatus': 'grounded',
        'traceId': 'trace-003',
        'upgradePrompt': {
          'message': 'You have 2 messages left today.',
          'messageHi': 'आज 2 मैसेज बाकी हैं।',
          'nextPlan': 'starter',
          'remaining': 2,
        },
      });
      expect(msg, isNotNull);
      expect(msg!.content, 'Sure, let me explain.');
    });
  });

  group('ChatRepository.parseSessionId (CEO defect #1, fault 3)', () {
    test('extracts the camelCase sessionId /api/foxy returns', () {
      expect(
        ChatRepository.parseSessionId({
          'success': true,
          'response': 'hi',
          'sessionId': '0f7f5d6e-1c2b-4a3d-9e8f-1122334455aa',
        }),
        '0f7f5d6e-1c2b-4a3d-9e8f-1122334455aa',
      );
    });

    test('extracts the legacy snake_case session_id (Edge Function shape)', () {
      expect(
        ChatRepository.parseSessionId({
          'reply': 'hi',
          'session_id': 'sess-abc',
        }),
        'sess-abc',
      );
    });

    test('blank / missing / non-string ids are treated as absent', () {
      // Echoing back `''` would put the route on its create-a-new-session
      // branch every turn — exactly the bug being fixed.
      expect(ChatRepository.parseSessionId({'sessionId': '   '}), isNull);
      expect(ChatRepository.parseSessionId({'sessionId': 42}), isNull);
      expect(ChatRepository.parseSessionId(const {}), isNull);
    });
  });

  group('ChatRepository.parseHistory (GET /api/foxy?sessionId=…)', () {
    test('adapts the route contract into ordered ChatMessages', () {
      final messages = ChatRepository.parseHistory({
        'success': true,
        'session': {'id': 'sess-1'},
        'messages': [
          {
            'id': 'm1',
            'role': 'user',
            'content': 'what is inertia',
            'created_at': '2026-08-24T10:00:00.000Z',
          },
          {
            'id': 'm2',
            'role': 'assistant',
            'content': 'Inertia is…',
            'structured': null,
            'tokens_used': 91,
            'created_at': '2026-08-24T10:00:04.000Z',
          },
        ],
      });

      expect(messages, hasLength(2));
      expect(messages.first.role, 'user');
      expect(messages.last.content, 'Inertia is…');
    });

    test('skips malformed rows instead of blanking the thread', () {
      final messages = ChatRepository.parseHistory({
        'messages': [
          {'id': 'm1', 'role': 'user', 'content': 'ok'},
          {'id': 'm2', 'role': 'assistant'}, // no content
          'not-a-map',
          {'id': 'm3', 'content': 'no role'},
        ],
      });
      expect(messages, hasLength(1));
    });

    test('missing/!list messages field yields an empty transcript', () {
      expect(ChatRepository.parseHistory(const {}), isEmpty);
      expect(ChatRepository.parseHistory({'messages': 'nope'}), isEmpty);
    });

    test('keeps the most recent `limit` turns', () {
      final rows = List.generate(
        10,
        (i) => {'id': 'm$i', 'role': 'user', 'content': 'q$i'},
      );
      final messages =
          ChatRepository.parseHistory({'messages': rows}, limit: 3);
      expect(messages.map((m) => m.content), ['q7', 'q8', 'q9']);
    });
  });

  group('ChatRepository.pickResumableSession', () {
    final now = DateTime.utc(2026, 8, 24, 12, 0, 0);

    ChatSession session(
      String id, {
      String mode = 'learn',
      String? subject = 'science',
      Duration age = Duration.zero,
    }) {
      final at = now.subtract(age);
      return ChatSession(
        id: id,
        studentId: 'student-1',
        subject: subject,
        mode: mode,
        createdAt: at,
        lastActiveAt: at,
      );
    }

    test('picks the most recently active matching thread', () {
      final picked = ChatRepository.pickResumableSession(
        [
          session('a', age: const Duration(hours: 3)),
          session('b', age: const Duration(minutes: 10)),
          session('c', age: const Duration(hours: 1)),
        ],
        mode: 'learn',
        subject: 'science',
        now: now,
      );
      expect(picked?.id, 'b');
    });

    test('never crosses modes', () {
      final picked = ChatRepository.pickResumableSession(
        [session('a', mode: 'learn')],
        mode: 'explorer',
        subject: 'science',
        now: now,
      );
      expect(picked, isNull);
    });

    test('subject match is case-insensitive', () {
      final picked = ChatRepository.pickResumableSession(
        [session('a', subject: 'Science')],
        mode: 'learn',
        subject: 'science',
        now: now,
      );
      expect(picked?.id, 'a');
    });

    test('a different subject is not resumable', () {
      expect(
        ChatRepository.pickResumableSession(
          [session('a', subject: 'maths')],
          mode: 'learn',
          subject: 'science',
          now: now,
        ),
        isNull,
      );
    });

    test('honours the server idle window (SESSION_IDLE_MINUTES = 240)', () {
      // Mirrors apps/host/src/app/api/foxy/_lib/session.ts. Offering to resume
      // a thread the server would reset anyway just recreates the bug.
      expect(ChatRepository.foxySessionIdleWindow, const Duration(hours: 4));

      expect(
        ChatRepository.pickResumableSession(
          [session('stale', age: const Duration(hours: 5))],
          mode: 'learn',
          subject: 'science',
          now: now,
        ),
        isNull,
      );
      expect(
        ChatRepository.pickResumableSession(
          [session('fresh', age: const Duration(hours: 3, minutes: 59))],
          mode: 'learn',
          subject: 'science',
          now: now,
        )?.id,
        'fresh',
      );
    });

    test('a null requested subject matches any subject in the same mode', () {
      final picked = ChatRepository.pickResumableSession(
        [session('a', subject: 'maths')],
        mode: 'learn',
        now: now,
      );
      expect(picked?.id, 'a');
    });
  });

  group('ChatSession.fromFoxyJson', () {
    test('maps a foxy_sessions row (chapter → topic, snake_case)', () {
      final s = ChatSession.fromFoxyJson(const {
        'id': 'sess-1',
        'student_id': 'student-1',
        'subject': 'science',
        'chapter': '8',
        'mode': 'explorer',
        'created_at': '2026-08-24T09:00:00.000Z',
        'last_active_at': '2026-08-24T11:00:00.000Z',
      });

      expect(s.id, 'sess-1');
      expect(s.topic, '8');
      expect(s.mode, 'explorer');
      expect(s.activeAt, DateTime.utc(2026, 8, 24, 11));
    });

    test('also accepts the GET /api/foxy/sessions camelCase shape', () {
      // apps/host/src/app/api/foxy/sessions/route.ts returns
      // { id, title, subject, chapter, updatedAt, messageCount }. Parsing it
      // here already means adopting that endpoint is a one-line change in
      // getRecentSessions — blocked only on the route also returning `mode`
      // (see the TODO there; mode-scoped resume is what stops an explorer
      // launch inheriting a learn thread).
      final s = ChatSession.fromFoxyJson(
        const {
          'id': 'sess-2',
          'subject': 'maths',
          'updatedAt': '2026-08-24T11:30:00.000Z',
          'messageCount': 7,
        },
        studentId: 'student-1',
      );

      expect(s.studentId, 'student-1');
      expect(s.messageCount, 7);
      expect(s.activeAt, DateTime.utc(2026, 8, 24, 11, 30));
    });

    test('falls back to createdAt when last activity is absent', () {
      final s = ChatSession.fromFoxyJson(const {
        'id': 'sess-3',
        'student_id': 'student-1',
        'created_at': '2026-08-24T09:00:00.000Z',
      });
      expect(s.activeAt, DateTime.utc(2026, 8, 24, 9));
      expect(s.mode, 'learn');
    });
  });

  // NOTE: constructor-level tests (with full ChatRepository instantiation)
  // require Supabase + Dio mocks (mocktail/mockito), which aren't currently
  // in pubspec. The static helpers above cover the migration's behavioral
  // surface; the notifier-level session-id round-trip is covered in
  // test/providers/chat_session_persistence_test.dart via a fake repository.
}
