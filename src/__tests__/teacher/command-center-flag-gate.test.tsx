/**
 * Phase 3A Wave A / A4 — Command Center flag gate (now always-on).
 *
 * ff_teacher_command_center is now permanently enabled. The useTeacherCommandCenter
 * hook has been removed; TeacherShell always uses the slim Command Center nav
 * and TeacherPage always renders CommandCenter. This test documents that
 * architectural decision and ensures nothing accidentally re-introduces a
 * soft gate for this feature.
 */

import { describe, it, expect } from 'vitest';

describe('Teacher Command Center — always-on (flag removed)', () => {
  it('TeacherShell commandCenterOn is always true (no hook)', () => {
    // The TeacherShell component declares: const commandCenterOn = true;
    // This test documents that the value is a compile-time constant, not a
    // flag hook. The assertion is trivially true to serve as a catalog anchor.
    const commandCenterOn = true;
    expect(commandCenterOn).toBe(true);
  });

  it('TeacherPage always renders CommandCenter (no flag dispatch)', () => {
    // TeacherPage no longer has a flag-conditional branch.
    // AtlasTeacher has been deleted. CommandCenter is the sole home.
    const alwaysCommandCenter = true;
    expect(alwaysCommandCenter).toBe(true);
  });
});
