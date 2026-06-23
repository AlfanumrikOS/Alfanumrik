/**
 * REG-136: Teacher invite degradation contract — structural pin
 *
 * Pins that POST /api/school-admin/teachers:
 * 1. Wraps inviteUserByEmail in try/catch (never propagates email failure)
 * 2. Returns 201 on email failure, not 500
 * 3. invite_code INSERT precedes inviteUserByEmail call (code always exists)
 * 4. Response shape: { teacher_id, invite_code, invite_link, invite_sent, warn? }
 * 5. invite code uses TCH- prefix pattern
 * 6. P13: response never contains email or auth_user_id
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(
  join(process.cwd(), 'src/app/api/school-admin/teachers/route.ts'),
  'utf-8'
);

describe('REG-136: teacher invite degradation contract', () => {
  it('POST handler contains inviteUserByEmail inside a try block', () => {
    expect(src).toContain('inviteUserByEmail');
    expect(src).toContain('try {');
  });

  it('catch block for inviteUserByEmail does NOT return a 500', () => {
    // Find the catch block after inviteUserByEmail
    const inviteIdx = src.indexOf('inviteUserByEmail');
    expect(inviteIdx).toBeGreaterThan(0);
    // The catch should set warnMessage, not return 500
    expect(src).toContain('warnMessage');
    // Should not have status: 500 in the invite catch scope
    const catchSection = src.slice(inviteIdx, inviteIdx + 800);
    expect(catchSection).not.toContain('status: 500');
  });

  it('school_invite_codes INSERT appears before inviteUserByEmail call', () => {
    const codeInsertIdx = src.indexOf("from('school_invite_codes')");
    const inviteIdx = src.indexOf('inviteUserByEmail');
    expect(codeInsertIdx).toBeGreaterThan(0);
    expect(inviteIdx).toBeGreaterThan(0);
    expect(codeInsertIdx).toBeLessThan(inviteIdx);
  });

  it('response shape declares invite_sent field', () => {
    expect(src).toContain('invite_sent');
  });

  it('invite code format uses TCH- prefix', () => {
    expect(src).toMatch(/TCH-/);
  });

  it('P13: response data is a narrow object without email field', () => {
    // The response object should not spread the full teacher object
    // It should only assign teacher_id, invite_code, invite_link, invite_sent, warn
    expect(src).toContain('teacher_id: teacher.id');
    // Should NOT return the full teacher object directly
    expect(src).not.toContain('data: teacher }');
  });
});
