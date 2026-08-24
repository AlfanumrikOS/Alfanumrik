import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../core/constants/api_constants.dart';
import '../../core/errors/app_exception.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_result.dart';
import '../models/chat_message.dart';

/// One completed Foxy turn: the assistant reply PLUS the server-authoritative
/// session id.
///
/// CEO defect #1 (2026-08-24): the previous code discarded the `sessionId`
/// that `/api/foxy` returns and instead echoed a `chat_sessions.id` — a row
/// from a legacy, dead table that has no counterpart in `foxy_sessions`. The
/// server's `resolveSession()` could never match it, logged
/// `foxy.session.silent_reset`, and minted a brand-new `foxy_sessions` row on
/// EVERY turn. Result: zero multi-turn context and zero persisted transcript.
///
/// [sessionId] must be threaded back into the next [ChatRepository.sendMessage]
/// call. That single round-trip is what makes the thread durable.
class FoxyTurn {
  final ChatMessage message;

  /// Server-authoritative `foxy_sessions.id`. Null only when the response body
  /// omitted it (legacy/edge path or a malformed body).
  final String? sessionId;

  const FoxyTurn({required this.message, this.sessionId});
}

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

  // ─── Persistence model (READ THIS BEFORE ADDING A WRITE) ────────────────────
  //
  // Real tables: `foxy_sessions` + `foxy_chat_messages`.
  //   * `chat_messages` DOES NOT EXIST in this database — `to_regclass(
  //     'public.chat_messages')` returns NULL and no migration ever created it.
  //     Every read/write this repository used to issue against it failed, which
  //     is why Foxy chat has never persisted anything from mobile.
  //   * `chat_sessions` exists but is legacy and dead since 2026-05-29.
  //
  // WRITES: `foxy_chat_messages` has student SELECT policies only — there is NO
  // student INSERT or UPDATE policy. All writes are service-role writes issued
  // by `apps/host/src/app/api/foxy/route.ts`. This client therefore NEVER
  // inserts a message row; it reads history and lets `/api/foxy` persist both
  // the user turn and the assistant turn. Same for sessions: `resolveSession()`
  // mints the `foxy_sessions` row, so there is no client-side `createSession`.

  /// Server-side idle window after which `/api/foxy` treats a thread as stale.
  ///
  /// Mirrors `SESSION_IDLE_MINUTES` in
  /// `apps/host/src/app/api/foxy/_lib/session.ts` (240 = 4 hours). Kept in sync
  /// so mobile never offers to resume a thread the server would reset anyway.
  static const Duration foxySessionIdleWindow = Duration(minutes: 240);

  /// Load the transcript for a session.
  ///
  /// Uses `GET /api/foxy?sessionId=<uuid>` — the contract web already consumes
  /// (`{ success, session, messages: [{ id, role, content, structured,
  /// tokens_used, created_at }] }`). Shared contract beats a direct table read;
  /// the route also strips `sources` before returning, which a raw table read
  /// would not.
  Future<ApiResult<List<ChatMessage>>> getMessages({
    required String sessionId,
    int limit = 50,
  }) async {
    try {
      final response = await _api.get<dynamic>(
        '/foxy',
        queryParameters: {'sessionId': sessionId},
      );

      final raw = response.data;
      if (raw is! Map) {
        return const ApiFailure('Could not load this conversation.');
      }

      final history = parseHistory(
        Map<String, dynamic>.from(raw),
        limit: limit,
      );
      return ApiSuccess(history);
    } on AppException catch (e) {
      return ApiFailure(e.message);
    } on DioException catch (e) {
      return ApiFailure(
        'Failed to load messages.',
        e.response?.statusCode,
      );
    } catch (e) {
      return ApiFailure('Failed to load messages: ${e.toString()}');
    }
  }

  /// Send a message to Foxy and get the response.
  ///
  /// Routes to either the legacy Edge Function (`foxy-tutor`) or the Next.js
  /// route (`/api/foxy`) based on [ApiConstants.foxyEndpoint] (default 'api').
  ///
  /// [sessionId] is now NULLABLE and must be the id previously returned by the
  /// server (see [FoxyTurn.sessionId]). Pass null for the first turn of a new
  /// thread — `/api/foxy` mints the `foxy_sessions` row and returns its id,
  /// which the caller persists and echoes on the next turn.
  ///
  /// [mode] is the Foxy session mode, defaulting to `'learn'`. Valid values are
  /// the route's own `VALID_MODES`
  /// (`apps/host/src/app/api/foxy/_lib/constants.ts`):
  /// `learn | explain | practice | revise | doubt | homework | explorer |
  /// olympiad | lesson`. An unrecognised value is silently coerced to `'learn'`
  /// SERVER-SIDE, so an unknown mode degrades safely — no client-side allowlist
  /// is duplicated here.
  ///
  /// No message row is written from this client: `/api/foxy` persists both the
  /// user turn and the assistant turn to `foxy_chat_messages` under the service
  /// role (the table has no student INSERT policy).
  Future<ApiResult<FoxyTurn>> sendMessage({
    required String studentId,
    required String message,
    String? sessionId,
    String? subject,
    String? topic,
    required String grade,
    String mode = 'learn',
  }) async {
    try {
      return _foxyEndpoint == 'api'
          ? await _sendViaApi(
              sessionId: sessionId,
              message: message,
              subject: subject,
              topic: topic,
              grade: grade,
              mode: mode,
            )
          : await _sendViaEdge(
              sessionId: sessionId,
              studentId: studentId,
              message: message,
              subject: subject,
              topic: topic,
              grade: grade,
              mode: mode,
            );
    } catch (e) {
      return ApiFailure('Failed to get response: ${e.toString()}');
    }
  }

  // ─── Legacy path: foxy-tutor Edge Function ──────────────────────────────────
  //
  // DEPRECATED AND DEAD SERVER-SIDE: the `foxy-tutor` Edge Function was
  // retired 2026-07-01 and no longer exists under `supabase/functions/`.
  // This branch is only reachable via `--dart-define=FOXY_ENDPOINT=edge`
  // (not the default, which is 'api') and, if invoked, will fail because
  // the target no longer exists. It is NOT a usable fallback or rollback
  // path anymore — see the comment on `ApiConstants.foxyEndpoint`. Kept
  // compiled in only so already-installed APKs still pointed at 'edge'
  // fail predictably at the network call rather than crash; do not build
  // new APKs with FOXY_ENDPOINT=edge. Removing this dead code path
  // entirely is a separate, larger change — out of scope here.
  Future<ApiResult<FoxyTurn>> _sendViaEdge({
    required String? sessionId,
    required String studentId,
    required String message,
    String? subject,
    String? topic,
    required String grade,
    String mode = 'learn',
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
        'mode': mode,
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
    final parsed = parseEdgeResponseForTest(data) ?? _fallbackReply();
    return ApiSuccess(
      FoxyTurn(message: parsed, sessionId: parseSessionId(data)),
    );
  }

  // ─── New path: Next.js /api/foxy → grounded-answer service ──────────────────
  //
  // Voyage RAG + RRF k=60 + rerank-2 + Sonnet, P12-grade safety rails, IRT
  // aware. Response shape differs from the Edge Function (see adapter below).
  Future<ApiResult<FoxyTurn>> _sendViaApi({
    required String? sessionId,
    required String message,
    String? subject,
    String? topic,
    required String grade,
    String mode = 'learn',
  }) async {
    try {
      // ApiClient prepends `apiBase` to the path; pass relative path only.
      // /api/foxy expects: { message, subject, grade, chapter?, sessionId?, mode? }
      //
      // `sessionId` is OMITTED (not sent as null) on the first turn so the
      // route takes its clean create path. On every later turn we echo the id
      // the server itself handed back, which is what keeps `resolveSession()`
      // on the reuse branch instead of `foxy.session.silent_reset`.
      final response = await _api.post(
        '/foxy',
        data: {
          'message': message,
          'subject': subject ?? '',
          'grade': grade,
          if (topic != null) 'chapter': topic,
          if (sessionId != null && sessionId.isNotEmpty) 'sessionId': sessionId,
          'mode': mode,
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
      final parsed = parseApiResponseForTest(raw) ?? _fallbackReply();
      return ApiSuccess(
        FoxyTurn(message: parsed, sessionId: parseSessionId(raw)),
      );
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

  static ChatMessage _fallbackReply() => ChatMessage(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        role: 'assistant',
        content: "Sorry, I couldn't respond.",
        timestamp: DateTime.now(),
      );

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

  /// Extract the server-authoritative session id from a Foxy response body.
  ///
  /// Accepts the `/api/foxy` camelCase key AND the legacy Edge Function's
  /// snake_case key so both send paths round-trip an id. Blank strings are
  /// treated as absent — echoing `''` back would put the route on its
  /// create-a-new-session branch every turn, which is the bug being fixed.
  static String? parseSessionId(Map<String, dynamic> raw) {
    for (final key in const ['sessionId', 'session_id']) {
      final value = raw[key];
      if (value is String && value.trim().isNotEmpty) return value.trim();
    }
    return null;
  }

  /// Adapt a `GET /api/foxy?sessionId=…` body into chat messages.
  ///
  /// Keeps only the most recent [limit] turns (the route returns the whole
  /// transcript ascending). Malformed rows are skipped rather than throwing —
  /// a single bad row must not blank the whole restored thread.
  static List<ChatMessage> parseHistory(
    Map<String, dynamic> raw, {
    int limit = 50,
  }) {
    final rows = raw['messages'];
    if (rows is! List) return const [];

    final parsed = <ChatMessage>[];
    for (final row in rows) {
      if (row is! Map) continue;
      final map = Map<String, dynamic>.from(row);
      final role = map['role'];
      final content = map['content'];
      if (role is! String || content is! String) continue;
      parsed.add(ChatMessage.fromJson(map));
    }

    if (parsed.length <= limit) return parsed;
    return parsed.sublist(parsed.length - limit);
  }

  /// Choose which recent thread (if any) to resume.
  ///
  /// Rules, mirroring what `resolveSession()` would accept:
  ///   * same [mode] — an `explorer` launch never resumes a `learn` thread;
  ///   * same [subject] (case-insensitive) when a subject is requested;
  ///   * last activity inside [foxySessionIdleWindow].
  /// Sessions are assumed newest-first but are re-sorted defensively.
  static ChatSession? pickResumableSession(
    List<ChatSession> sessions, {
    required String mode,
    required DateTime now,
    String? subject,
    Duration idleWindow = foxySessionIdleWindow,
  }) {
    final candidates = sessions.where((s) {
      if (s.mode != mode) return false;
      if (subject != null && subject.isNotEmpty) {
        final theirs = s.subject;
        if (theirs == null ||
            theirs.toLowerCase() != subject.toLowerCase()) {
          return false;
        }
      }
      return now.difference(s.activeAt) <= idleWindow;
    }).toList();

    if (candidates.isEmpty) return null;
    candidates.sort((a, b) => b.activeAt.compareTo(a.activeAt));
    return candidates.first;
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

  /// Recent Foxy threads for the history / resume flow.
  ///
  /// TODO(mobile↔frontend): switch to `GET /api/foxy/sessions` once its
  /// payload carries `mode`.
  ///
  /// That endpoint now EXISTS (`apps/host/src/app/api/foxy/sessions/route.ts`,
  /// added in this same wave) and is the contract we want to share with web —
  /// it also derives a `title` and a real `messageCount`, neither of which a
  /// raw table read can give us. It is NOT adopted yet for one concrete
  /// reason: its items are `{ id, title, subject, chapter, updatedAt,
  /// messageCount }` with **no `mode`**, and [pickResumableSession] scopes
  /// resumption by mode. Without it, `ChatSession.fromFoxyJson` would default
  /// every thread to `'learn'`, so an `explorer` launch (Weekly Curiosity Dive)
  /// could never resume and a `learn` launch could inherit an explorer thread —
  /// exactly the cross-mode bleed `chat_screen.dart` is written to prevent.
  ///
  /// [ChatSession.fromFoxyJson] already parses that camelCase shape, so adding
  /// `mode` server-side makes this a one-line swap.
  ///
  /// Until then, read through the RLS-scoped Supabase client: `foxy_sessions`
  /// has a student SELECT policy (`student_id IN (SELECT id FROM students WHERE
  /// auth_user_id = auth.uid())`), so this is a read the student is entitled to
  /// and it never bypasses RLS.
  Future<ApiResult<List<ChatSession>>> getRecentSessions({
    required String studentId,
    int limit = 20,
  }) async {
    try {
      final res = await _client
          .from('foxy_sessions')
          .select(
            'id, student_id, subject, chapter, mode, created_at, last_active_at',
          )
          .eq('student_id', studentId)
          .order('last_active_at', ascending: false)
          .limit(limit);

      final sessions = (res as List<dynamic>)
          .map((e) => ChatSession.fromFoxyJson(
                Map<String, dynamic>.from(e as Map),
                studentId: studentId,
              ))
          .toList(growable: false);

      return ApiSuccess(sessions);
    } catch (e) {
      return ApiFailure('Failed to load history: ${e.toString()}');
    }
  }
}
