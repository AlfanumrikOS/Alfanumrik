// COMPOSITION test for the offline-replay classification seam.
//
// WHY THIS FILE EXISTS
// ────────────────────
// `OfflineDrainService.parseRetryable` and `OfflineDrainService.classify` are
// each thoroughly unit-tested in isolation (offline_drain_service_test.dart).
// Neither of those tests touches the ONE line that connects them to a real
// server response — `QuizRepository.submitOfflineReplay`:
//
//     final retryable = OfflineDrainService.parseRetryable(e.response?.data);
//     return OfflineDrainService.classify(..., retryable: retryable);
//
// Delete that `retryable:` argument and every drain unit test still passes,
// while the entire server-side `retryable:false` fix silently becomes a no-op
// on mobile: a permanent 503 would go back to being an unbounded `retain`.
// That is precisely the class of gap that let the original P0 ship.
//
// These tests therefore drive a REAL HTTP response body all the way through
// Dio → the generated `/v2` client → `submitOfflineReplay` → `classify`, and
// assert the end-to-end outcome. The seam that makes it possible is
// `V2ApiClient.forTesting(dio: ...)` (a caller-supplied Dio + a null token
// source, so no Supabase runtime is required).
//
// The mutation this file kills, stated plainly:
//   * drop `retryable:`   → the `retryable:false` case returns `retain`
//                           instead of `failedPermanent`  → test 1 fails.
//   * hardcode `false`    → the transient cases return `failedPermanent`
//                           instead of `retain`           → tests 2 & 3 fail.
//   * drop `parseRetryable`/pass a constant null → test 1 fails.
//
// NOTHING here grades, scores, or computes XP — the device never does (P1/P2).

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
// `show` is load-bearing: postgrest also exports a `Headers` symbol, which
// would collide with Dio's.
import 'package:supabase_flutter/supabase_flutter.dart'
    show AuthClientOptions, SupabaseClient;

import 'package:alfanumrik/core/network/v2_api_client.dart';
import 'package:alfanumrik/data/models/offline_quiz_models.dart';
import 'package:alfanumrik/data/repositories/offline_drain_service.dart';
import 'package:alfanumrik/data/repositories/quiz_repository.dart';

/// A Dio adapter that answers every request with one scripted response and
/// records the request options it saw (so we can assert on the
/// `Idempotency-Key` header the repository stamped).
class _ScriptedAdapter implements HttpClientAdapter {
  final int statusCode;
  final Object body;

  final List<RequestOptions> seen = [];

  _ScriptedAdapter({required this.statusCode, required this.body});

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    seen.add(options);
    return ResponseBody.fromString(
      body is String ? body as String : jsonEncode(body),
      statusCode,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

/// Builds a repository whose `/v2` client talks to [adapter]. The Supabase
/// client is a bare offline instance — the offline-replay path never touches
/// it, but the constructor would otherwise fall back to `Supabase.instance`.
QuizRepository _repoFor(_ScriptedAdapter adapter) {
  final dio = Dio(BaseOptions(baseUrl: 'https://test.invalid/api'));
  dio.httpClientAdapter = adapter;
  return QuizRepository(
    client: SupabaseClient(
      'https://test.invalid',
      'test-anon-key',
      authOptions: const AuthClientOptions(autoRefreshToken: false),
    ),
    v2Client: V2ApiClient.forTesting(dio: dio),
  );
}

QueuedQuizAttempt _attempt({String key = 'idem-key-composition'}) =>
    QueuedQuizAttempt(
      localId: 'local-1',
      sessionId: 'sess-1',
      studentId: 'stu-1',
      subject: 'math',
      grade: '7',
      responses: const [
        OfflineResponse(
            questionId: 'q1', selectedDisplayedIndex: 2, timeSpent: 11),
        OfflineResponse(
            questionId: 'q2', selectedDisplayedIndex: 0, timeSpent: 9),
      ],
      totalTimeSeconds: 20,
      capturedAt: DateTime.utc(2026, 6, 7, 9).toIso8601String(),
      idempotencyKey: key,
      drainAttempt: 1,
    );

void main() {
  group('QuizRepository.submitOfflineReplay — server body → classify seam', () {
    test(
        'a 503 carrying retryable:false reaches classify and produces a '
        'TERMINAL outcome end-to-end (not an unbounded retain)', () async {
      // The exact P0 shape: POST /v2/quiz/submit answered 503 RPC_FAILED for a
      // PERMANENT SQLSTATE (42501 permission denied). Only the body says so.
      final adapter = _ScriptedAdapter(
        statusCode: 503,
        body: const {
          'success': false,
          'error': 'Quiz submission failed',
          'code': 'RPC_FAILED',
          'retryable': false,
        },
      );

      final outcome = await _repoFor(adapter).submitOfflineReplay(_attempt());

      expect(outcome.kind, DrainOutcomeKind.failedPermanent,
          reason: 'the repository must forward the parsed `retryable` into '
              'classify; without that argument this is a `retain`');
      expect(outcome.reasonCode, 'RPC_FAILED',
          reason: 'the structured server code is surfaced, never PII (P13)');
      expect(outcome.result, isNull, reason: 'nothing was graded');

      // The request actually went out with the IMMUTABLE key verbatim (P2).
      expect(adapter.seen, hasLength(1));
      expect(adapter.seen.single.headers['Idempotency-Key'],
          'idem-key-composition');
      expect(adapter.seen.single.path, '/v2/quiz/submit');
    });

    test(
        'the SAME 503 without a retryable field stays a RETAIN — old servers '
        'and genuine transients are byte-for-byte unchanged', () async {
      final adapter = _ScriptedAdapter(
        statusCode: 503,
        body: const {
          'success': false,
          'error': 'Quiz submission failed',
          'code': 'RPC_FAILED',
        },
      );

      final outcome = await _repoFor(adapter).submitOfflineReplay(_attempt());

      expect(outcome.kind, DrainOutcomeKind.retain);
      expect(outcome.reasonCode, 'RPC_FAILED');
    });

    test('a 503 with retryable:true stays a RETAIN (flaky-network replay)',
        () async {
      final adapter = _ScriptedAdapter(
        statusCode: 503,
        body: const {
          'success': false,
          'error': 'upstream timeout',
          'code': 'RPC_FAILED',
          'retryable': true,
        },
      );

      final outcome = await _repoFor(adapter).submitOfflineReplay(_attempt());

      expect(outcome.kind, DrainOutcomeKind.retain);
    });

    test(
        'a non-JSON 502 proxy page (unparseable body) still RETAINS — a parse '
        'failure must never change an outcome', () async {
      final adapter = _ScriptedAdapter(
        statusCode: 502,
        body: '<html><body>502 Bad Gateway</body></html>',
      );

      final outcome = await _repoFor(adapter).submitOfflineReplay(_attempt());

      expect(outcome.kind, DrainOutcomeKind.retain);
    });

    test(
        'a 422 REPLAY_TOO_STALE DISCARDS even when the body says '
        'retryable:true — retryable can never resurrect a 4xx', () async {
      final adapter = _ScriptedAdapter(
        statusCode: 422,
        body: const {
          'success': false,
          'error': 'offline attempt too stale',
          'code': 'REPLAY_TOO_STALE',
          'retryable': true,
        },
      );

      final outcome = await _repoFor(adapter).submitOfflineReplay(_attempt());

      expect(outcome.kind, DrainOutcomeKind.discard);
      expect(outcome.reasonCode, 'REPLAY_TOO_STALE');
    });

    // ── The defect this file uncovered ────────────────────────────────────
    // The body below is the REAL server shape, byte-for-byte:
    // `apps/host/src/app/api/v2/quiz/submit/route.ts` emits
    // `schemaVersion: 1 as const` — a JSON NUMBER (openapi/v2.json declares
    // `{ type: 'number', enum: [1] }`).
    //
    // openapi-generator's dart-dio target compiled that numeric enum to a
    // STRING-keyed serializer (`_fromWire = { '1': 'n1' }`), so the int 1 threw
    // `Invalid argument(s)` INSIDE the generated client. The generated method
    // rewrapped it as a DioException carrying the 200 response, which
    // `classify` fell through to `retain` — meaning a SUCCESSFULLY GRADED quiz
    // never left the queue and the student never saw their score. All 12
    // top-level /v2 response models carry the same discriminator.
    //
    // `SchemaVersionCompatInterceptor` (mobile-owned, applied to every
    // V2ApiClient) coerces it. If the contract/codegen is ever fixed to emit a
    // string, this test keeps passing and the interceptor becomes a no-op that
    // can then be deleted.
    test('a 200 grade composes into SUCCESS with the server values verbatim — '
        'with the REAL numeric schemaVersion the server actually sends',
        () async {
      // P1/P2: score/XP come from the server response and are never derived
      // on-device. This also proves the happy path composes end-to-end.
      final adapter = _ScriptedAdapter(
        statusCode: 200,
        body: const {
          'session_id': 'sess-1',
          'correct': 7,
          'total': 10,
          'score_percent': 70,
          'xp_earned': 90,
          'flagged': false,
          'idempotent_replay': true,
          'marking_authenticity_path': 'v2',
          // NUMBER, not the string '1'. This is the line that used to break
          // every /v2 success response.
          'schemaVersion': 1,
          'questions': <Map<String, Object?>>[],
        },
      );

      final outcome = await _repoFor(adapter).submitOfflineReplay(_attempt());

      expect(outcome.kind, DrainOutcomeKind.success,
          reason: 'a graded 200 must not degrade to `retain` — that silently '
              'strands the student\'s completed quiz in the queue');
      expect(outcome.reasonCode, 'idempotent_replay');
      expect(outcome.result?.scorePercent, 70);
      expect(outcome.result?.xpEarned, 90);
      expect(outcome.result?.correctAnswers, 7);
      expect(outcome.result?.totalQuestions, 10);
    });
  });

  group('SchemaVersionCompatInterceptor (numeric-enum contract shim)', () {
    Response<dynamic> run(Object? body) {
      final res = Response<dynamic>(
        requestOptions: RequestOptions(path: '/v2/quiz/submit'),
        data: body,
        statusCode: 200,
      );
      SchemaVersionCompatInterceptor()
          .onResponse(res, ResponseInterceptorHandler());
      return res;
    }

    // `<String, dynamic>` is what `jsonDecode` produces, so that is what these
    // fixtures must be. A bare `{'schemaVersion': 1}` literal infers
    // `Map<String, int>`, which no real response is.
    test('coerces an int and an integral double to the wire literal', () {
      expect(
          (run(<String, dynamic>{'schemaVersion': 1}).data as Map)['schemaVersion'],
          '1');
      expect(
          (run(<String, dynamic>{'schemaVersion': 1.0}).data
              as Map)['schemaVersion'],
          '1',
          reason: 'a naive toString() would emit "1.0" and miss the enum');
    });

    test('leaves an already-correct string untouched', () {
      expect(
          (run(<String, dynamic>{'schemaVersion': '1'}).data
              as Map)['schemaVersion'],
          '1');
    });

    test('touches ONLY the schemaVersion key — never scores, XP or flags', () {
      final out = run(<String, dynamic>{
        'schemaVersion': 1,
        'score_percent': 70,
        'xp_earned': 90,
        'correct': 7,
        'total': 10,
        'flagged': false,
      }).data as Map;
      expect(out['score_percent'], 70);
      expect(out['xp_earned'], 90);
      expect(out['correct'], 7);
      expect(out['total'], 10);
      expect(out['flagged'], isFalse, reason: 'bool is not num — never coerced');
    });

    test('walks nested objects and lists', () {
      final out = run(<String, dynamic>{
        'items': <dynamic>[
          <String, dynamic>{'schemaVersion': 1},
          <String, dynamic>{
            'nested': <String, dynamic>{'schemaVersion': 1}
          },
        ],
      }).data as Map;
      expect((out['items'] as List)[0]['schemaVersion'], '1');
      expect((out['items'] as List)[1]['nested']['schemaVersion'], '1');
    });

    test('never throws on a non-JSON / null / self-referential body', () {
      expect(() => run('<html>502</html>'), returnsNormally);
      expect(() => run(null), returnsNormally);
      final cyclic = <String, dynamic>{'schemaVersion': 1};
      cyclic['self'] = cyclic;
      expect(() => run(cyclic), returnsNormally,
          reason: 'depth-limited: a shim that can hang is worse than the bug');
      expect(cyclic['schemaVersion'], '1');
    });
  });
}
