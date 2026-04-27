// Unit tests for ChatRepository's pure logic — endpoint resolution and
// response-shape adapters for the foxy-tutor → /api/foxy migration (Audit F7).
//
// These tests intentionally exercise only the static helpers + constructor
// wiring. The full network paths (_sendViaEdge / _sendViaApi) require Supabase
// + Dio mocks, which are not currently in pubspec — those are covered by
// integration tests on the Next.js side.
import 'package:flutter_test/flutter_test.dart';

import 'package:alfanumrik/core/constants/api_constants.dart';
import 'package:alfanumrik/data/repositories/chat_repository.dart';

void main() {
  group('ApiConstants.foxyEndpoint', () {
    test('defaults to "edge" so existing builds preserve current behavior',
        () {
      // Sanity-check the compile-time default. If this fails, somebody flipped
      // the default from edge → api without a coordinated rollout — that
      // breaks F7's "default-stays-edge" rollout safety guarantee.
      expect(ApiConstants.foxyEndpoint, 'edge');
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

  // NOTE: constructor-level tests (with full ChatRepository instantiation)
  // require Supabase + Dio mocks (mocktail/mockito), which aren't currently
  // in pubspec. The static helpers above cover the migration's behavioral
  // surface; constructor wiring is exercised indirectly via the existing
  // chat_provider integration smoke when run on a configured device.
}
