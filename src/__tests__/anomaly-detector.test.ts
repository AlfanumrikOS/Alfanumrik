import { describe, it, expect } from 'vitest';

import {
  detectBulkAccess,
  detectEscalationAttempts,
  detectImpersonationAbuse,
  detectDelegationStorm,
  runAllDetectors,
  type AuditEvent,
} from '@/lib/anomaly-detector';

// ── Helpers ──

function makeEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    actor_user_id: 'user-1',
    event_type: 'data_access',
    resource_type: 'student',
    action: 'read',
    result: 'granted',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvents(count: number, overrides: Partial<AuditEvent> = {}): AuditEvent[] {
  return Array.from({ length: count }, () => makeEvent(overrides));
}

describe('Anomaly Detector', () => {
  // ── detectBulkAccess ──

  describe('detectBulkAccess', () => {
    it('should detect when a user reads >100 student records', () => {
      const events = makeEvents(101, {
        actor_user_id: 'bulk-user',
        resource_type: 'student',
        action: 'read',
      });

      const result = detectBulkAccess(events);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('bulk_student_access');
      expect(result!.severity).toBe('high');
      expect(result!.userId).toBe('bulk-user');
      expect(result!.details).toContain('101');
    });

    it('should not detect when a user reads 99 student records', () => {
      const events = makeEvents(99, {
        actor_user_id: 'normal-user',
        resource_type: 'student',
        action: 'read',
      });

      const result = detectBulkAccess(events);

      expect(result).toBeNull();
    });
  });

  // ── detectEscalationAttempts ──

  describe('detectEscalationAttempts', () => {
    it('should detect when a user has >5 denied attempts', () => {
      const events = makeEvents(6, {
        actor_user_id: 'escalate-user',
        result: 'denied',
      });

      const result = detectEscalationAttempts(events);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('escalation_attempt');
      expect(result!.severity).toBe('medium');
      expect(result!.userId).toBe('escalate-user');
    });
  });

  // ── detectImpersonationAbuse ──

  describe('detectImpersonationAbuse', () => {
    it('should detect impersonation with action_count > 50', () => {
      const events: AuditEvent[] = [
        makeEvent({
          actor_user_id: 'admin-user',
          event_type: 'impersonation_start',
          metadata: { action_count: 51 },
        }),
      ];

      const result = detectImpersonationAbuse(events);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('impersonation_abuse');
      expect(result!.severity).toBe('high');
      expect(result!.userId).toBe('admin-user');
      expect(result!.details).toContain('51');
    });
  });

  // ── detectDelegationStorm ──

  describe('detectDelegationStorm', () => {
    it('should detect when a user grants >20 delegations', () => {
      const events = makeEvents(21, {
        actor_user_id: 'storm-user',
        event_type: 'delegation_grant',
      });

      const result = detectDelegationStorm(events);

      expect(result).not.toBeNull();
      expect(result!.type).toBe('delegation_storm');
      expect(result!.severity).toBe('medium');
      expect(result!.userId).toBe('storm-user');
      expect(result!.details).toContain('21');
    });
  });

  // ── runAllDetectors ──

  describe('runAllDetectors', () => {
    it('should aggregate results from all detectors', () => {
      const events: AuditEvent[] = [
        // Bulk access: 101 student reads
        ...makeEvents(101, { actor_user_id: 'bulk-user', resource_type: 'student', action: 'read' }),
        // Escalation: 6 denials
        ...makeEvents(6, { actor_user_id: 'escalate-user', result: 'denied' }),
      ];

      const anomalies = runAllDetectors(events);

      expect(anomalies.length).toBeGreaterThanOrEqual(2);
      const types = anomalies.map((a) => a.type);
      expect(types).toContain('bulk_student_access');
      expect(types).toContain('escalation_attempt');
    });
  });
});
