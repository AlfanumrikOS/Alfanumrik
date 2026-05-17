import { describe, it, expect, beforeEach, vi } from 'vitest';
import { _resetAuditThrottleForTests, auditPiiReadThrottled } from './admin-audit-throttle';
import * as adminAuth from './admin-auth';
import type { AdminAuth } from './admin-auth';

const fakeAdmin: AdminAuth = {
  authorized: true,
  userId: '00000000-0000-0000-0000-000000000001',
  adminId: '00000000-0000-0000-0000-000000000002',
  email: 'admin@alfanumrik.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

const studentId = '11111111-1111-1111-1111-111111111111';

describe('auditPiiReadThrottled', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetAuditThrottleForTests();
    logSpy = vi.spyOn(adminAuth, 'logAdminAudit').mockResolvedValue();
  });

  it('writes audit on first call', () => {
    auditPiiReadThrottled(fakeAdmin, 'student_profile.read', 'student', studentId);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('suppresses immediate duplicate (same admin + entity + action)', () => {
    auditPiiReadThrottled(fakeAdmin, 'student_profile.read', 'student', studentId);
    auditPiiReadThrottled(fakeAdmin, 'student_profile.read', 'student', studentId);
    auditPiiReadThrottled(fakeAdmin, 'student_profile.read', 'student', studentId);
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('allows different actions on the same entity', () => {
    auditPiiReadThrottled(fakeAdmin, 'student_profile.read', 'student', studentId);
    auditPiiReadThrottled(fakeAdmin, 'student_progress.read', 'student', studentId);
    auditPiiReadThrottled(fakeAdmin, 'student_quiz_history.read', 'student', studentId);
    expect(logSpy).toHaveBeenCalledTimes(3);
  });

  it('allows different entities for the same action', () => {
    const otherStudentId = '22222222-2222-2222-2222-222222222222';
    auditPiiReadThrottled(fakeAdmin, 'student_profile.read', 'student', studentId);
    auditPiiReadThrottled(fakeAdmin, 'student_profile.read', 'student', otherStudentId);
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it('allows different admins for the same entity + action', () => {
    const otherAdmin: AdminAuth = { ...fakeAdmin, userId: '99999999-9999-9999-9999-999999999999' };
    auditPiiReadThrottled(fakeAdmin, 'student_profile.read', 'student', studentId);
    auditPiiReadThrottled(otherAdmin, 'student_profile.read', 'student', studentId);
    expect(logSpy).toHaveBeenCalledTimes(2);
  });
});
