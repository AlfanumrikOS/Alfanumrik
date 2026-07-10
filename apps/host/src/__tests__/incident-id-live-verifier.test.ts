import { describe, expect, it } from 'vitest';
import {
  compareIncidentIdLiveEvidence,
  type IncidentIdLiveEvidence,
} from '../../../../scripts/verify-incident-id-live';

describe('RCA-23 live incident ID verifier', () => {
  it('passes when the response request ID appears in exported observability rows', () => {
    const evidence: IncidentIdLiveEvidence = {
      sampledRoute: '/api/board-score',
      responseRequestId: 'req-123',
      observedEvents: [
        {
          source: 'host-route',
          request_id: 'req-123',
          message: 'board score request accepted',
        },
        {
          source: 'edge-function',
          request_id: 'req-123',
          message: 'board-score edge completed',
        },
      ],
    };

    const result = compareIncidentIdLiveEvidence(evidence);

    expect(result).toEqual({
      ok: true,
      requestId: 'req-123',
      matchedEvents: 2,
      failures: [],
    });
  });

  it('fails when the response ID is missing, absent from events, or only partially represented', () => {
    expect(
      compareIncidentIdLiveEvidence({
        sampledRoute: '/api/board-score',
        responseRequestId: '',
        observedEvents: [{ source: 'host-route', request_id: 'req-123' }],
      }).failures,
    ).toEqual(['missing response X-Request-Id']);

    expect(
      compareIncidentIdLiveEvidence({
        sampledRoute: '/api/board-score',
        responseRequestId: 'req-123',
        observedEvents: [{ source: 'host-route', request_id: 'different' }],
      }).failures,
    ).toEqual(['response X-Request-Id req-123 was not found in exported observability events']);

    expect(
      compareIncidentIdLiveEvidence({
        sampledRoute: '/api/board-score',
        responseRequestId: 'req-123',
        requiredSources: ['host-route', 'edge-function'],
        observedEvents: [{ source: 'host-route', request_id: 'req-123' }],
      }).failures,
    ).toEqual(['missing required observability source for req-123: edge-function']);
  });
});
