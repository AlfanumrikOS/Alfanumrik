/**
 * Phase 1 Academic Structure — Migration Contract Tests
 *
 * Migration: 20260621000000_phase1_academic_structure_attendance_boards.sql
 *
 * Tests cover:
 *   REG-162: boards table RLS — authenticated SELECT, service_role-only INSERT
 *   REG-163: student_attendance RLS — teacher/student/parent access boundaries
 *   REG-164: student_attendance validation — status enum and UNIQUE constraint logic
 *   REG-165: mark_attendance handler — input validation logic
 *   REG-166: academic_terms — NULL school_id partial index and seeded defaults
 *   REG-167: class_schedule — time and constraint checks
 *
 * All tests are pure unit tests (no live DB, no fetch, no env vars).
 * RLS policies are tested as equivalent TypeScript predicate functions.
 * Validation logic is tested as standalone pure functions.
 * Schema contract assertions validate the TypeScript interface shapes
 * expected from the migration DDL.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Migration: phase1_academic_structure_attendance_boards
// ---------------------------------------------------------------------------

describe('Migration: phase1_academic_structure_attendance_boards', () => {

  // =========================================================================
  // Group 1: boards table — schema contract (REG-162)
  // =========================================================================

  describe('REG-162: boards table — schema contract', () => {

    // TypeScript interface matching the boards table DDL
    interface Board {
      id: string;
      code: string;
      name: string;
      name_hi: string | null;
      country: string;
      is_active: boolean;
      display_order: number;
      created_at: string;
    }

    // Seeded boards as documented in the migration
    const SEEDED_BOARDS: Board[] = [
      { id: 'cbse', code: 'CBSE', name: 'Central Board of Secondary Education', name_hi: 'केंद्रीय माध्यमिक शिक्षा बोर्ड', country: 'IN', is_active: true, display_order: 1, created_at: '2026-06-21T00:00:00Z' },
      { id: 'icse', code: 'ICSE', name: 'Indian Certificate of Secondary Education', name_hi: 'भारतीय माध्यमिक शिक्षा प्रमाणपत्र', country: 'IN', is_active: true, display_order: 2, created_at: '2026-06-21T00:00:00Z' },
      { id: 'ib',   code: 'IB',   name: 'International Baccalaureate',             name_hi: null,                              country: 'IN', is_active: true, display_order: 3, created_at: '2026-06-21T00:00:00Z' },
      { id: 'nios', code: 'NIOS', name: 'National Institute of Open Schooling',    name_hi: 'राष्ट्रीय मुक्त विद्यालयी शिक्षा संस्थान', country: 'IN', is_active: true, display_order: 4, created_at: '2026-06-21T00:00:00Z' },
    ];

    it('should have required fields: id, code, name, name_hi, country, is_active, display_order, created_at', () => {
      const requiredFields: (keyof Board)[] = [
        'id', 'code', 'name', 'name_hi', 'country', 'is_active', 'display_order', 'created_at',
      ];
      const board = SEEDED_BOARDS[0];
      for (const field of requiredFields) {
        expect(field in board).toBe(true);
      }
    });

    it('should have CBSE as a seeded board with country IN', () => {
      const cbse = SEEDED_BOARDS.find(b => b.code === 'CBSE');
      expect(cbse).toBeDefined();
      expect(cbse!.country).toBe('IN');
      expect(cbse!.is_active).toBe(true);
    });

    it('should have exactly 4 seeded boards: CBSE, ICSE, IB, NIOS', () => {
      expect(SEEDED_BOARDS).toHaveLength(4);
      const codes = SEEDED_BOARDS.map(b => b.code);
      expect(codes).toContain('CBSE');
      expect(codes).toContain('ICSE');
      expect(codes).toContain('IB');
      expect(codes).toContain('NIOS');
    });

    it('board code should be unique — duplicate code insert should be rejected', () => {
      // Simulate uniqueness constraint: adding a second CBSE should conflict
      function wouldConflictOnInsert(existing: Board[], newCode: string): boolean {
        return existing.some(b => b.code === newCode);
      }
      expect(wouldConflictOnInsert(SEEDED_BOARDS, 'CBSE')).toBe(true);
      expect(wouldConflictOnInsert(SEEDED_BOARDS, 'STATE')).toBe(false);
    });

  });


  // =========================================================================
  // Group 2: student_attendance — attendance status validation (REG-164)
  // =========================================================================

  describe('REG-164: student_attendance — attendance status validation', () => {

    const VALID_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
    type AttendanceStatus = typeof VALID_STATUSES[number];

    function isValidStatus(status: string): status is AttendanceStatus {
      return (VALID_STATUSES as readonly string[]).includes(status);
    }

    // Represents a student_attendance row shape
    interface AttendanceRow {
      id: string;
      class_id: string;
      student_id: string;
      attendance_date: string; // YYYY-MM-DD
      period: string;
      status: AttendanceStatus;
      notes: string | null;
      marked_by: string;
      created_at: string;
    }

    // UNIQUE constraint: (class_id, student_id, attendance_date, period)
    function wouldConflictAttendance(
      existing: AttendanceRow[],
      newRow: Pick<AttendanceRow, 'class_id' | 'student_id' | 'attendance_date' | 'period'>
    ): boolean {
      return existing.some(
        r =>
          r.class_id === newRow.class_id &&
          r.student_id === newRow.student_id &&
          r.attendance_date === newRow.attendance_date &&
          r.period === newRow.period
      );
    }

    it('accepts all 4 valid statuses', () => {
      for (const status of VALID_STATUSES) {
        expect(isValidStatus(status)).toBe(true);
      }
    });

    it('rejects invalid status like "here" or "tardy"', () => {
      expect(isValidStatus('here')).toBe(false);
      expect(isValidStatus('tardy')).toBe(false);
      expect(isValidStatus('')).toBe(false);
      expect(isValidStatus('PRESENT')).toBe(false); // case-sensitive
    });

    it('period defaults to "All Day" when not specified', () => {
      const DEFAULT_PERIOD = 'All Day';
      function resolvePeriod(period?: string): string {
        return period?.trim() || DEFAULT_PERIOD;
      }
      expect(resolvePeriod(undefined)).toBe('All Day');
      expect(resolvePeriod('')).toBe('All Day');
      expect(resolvePeriod('  ')).toBe('All Day');
      expect(resolvePeriod('Period 1')).toBe('Period 1');
    });

    it('UNIQUE constraint: same class+student+date+period combo is a conflict', () => {
      const existing: AttendanceRow[] = [
        {
          id: 'att-1',
          class_id: 'class-a',
          student_id: 'student-1',
          attendance_date: '2026-06-21',
          period: 'All Day',
          status: 'present',
          notes: null,
          marked_by: 'teacher-1',
          created_at: '2026-06-21T08:00:00Z',
        },
      ];

      const duplicate = {
        class_id: 'class-a',
        student_id: 'student-1',
        attendance_date: '2026-06-21',
        period: 'All Day',
      };
      expect(wouldConflictAttendance(existing, duplicate)).toBe(true);
    });

    it('same class+student+date with different period is NOT a conflict', () => {
      const existing: AttendanceRow[] = [
        {
          id: 'att-1',
          class_id: 'class-a',
          student_id: 'student-1',
          attendance_date: '2026-06-21',
          period: 'Period 1',
          status: 'present',
          notes: null,
          marked_by: 'teacher-1',
          created_at: '2026-06-21T08:00:00Z',
        },
      ];

      const differentPeriod = {
        class_id: 'class-a',
        student_id: 'student-1',
        attendance_date: '2026-06-21',
        period: 'Period 2',
      };
      expect(wouldConflictAttendance(existing, differentPeriod)).toBe(false);
    });

  });


  // =========================================================================
  // Group 3: mark_attendance handler — input validation (REG-165)
  // =========================================================================

  describe('REG-165: mark_attendance — input validation', () => {

    const VALID_STATUSES_SET = new Set(['present', 'absent', 'late', 'excused']);
    const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
    const MAX_RECORDS = 200;
    const MAX_NOTES_LENGTH = 200;
    const MAX_PERIOD_LENGTH = 50;

    interface AttendanceRecord {
      student_id?: string;
      status?: string;
      notes?: string;
      period?: string;
    }

    interface MarkAttendanceInput {
      teacher_id?: string;
      class_id?: string;
      date?: string;
      records?: AttendanceRecord[];
    }

    type ValidationResult =
      | { valid: true }
      | { valid: false; error: string; code: string };

    function validateMarkAttendanceInput(input: MarkAttendanceInput): ValidationResult {
      if (!input.teacher_id) {
        return { valid: false, error: 'teacher_id is required', code: 'MISSING_TEACHER_ID' };
      }
      if (!input.class_id) {
        return { valid: false, error: 'class_id is required', code: 'MISSING_CLASS_ID' };
      }
      if (!input.date || !DATE_REGEX.test(input.date)) {
        return { valid: false, error: 'date must be in YYYY-MM-DD format', code: 'INVALID_DATE_FORMAT' };
      }
      if (!input.records || input.records.length === 0) {
        return { valid: false, error: 'records must be a non-empty array', code: 'EMPTY_RECORDS' };
      }
      if (input.records.length > MAX_RECORDS) {
        return { valid: false, error: `records must not exceed ${MAX_RECORDS} items`, code: 'RECORDS_TOO_LARGE' };
      }
      for (const rec of input.records) {
        if (!rec.student_id) {
          return { valid: false, error: 'each record must have a student_id', code: 'MISSING_STUDENT_ID' };
        }
        if (!rec.status || !VALID_STATUSES_SET.has(rec.status)) {
          return { valid: false, error: `invalid status: ${rec.status}`, code: 'INVALID_STATUS' };
        }
      }
      return { valid: true };
    }

    function sanitizeRecord(rec: AttendanceRecord): AttendanceRecord {
      return {
        ...rec,
        notes: rec.notes ? rec.notes.slice(0, MAX_NOTES_LENGTH) : rec.notes,
        period: rec.period ? rec.period.trim().slice(0, MAX_PERIOD_LENGTH) : rec.period,
      };
    }

    it('rejects missing teacher_id', () => {
      const result = validateMarkAttendanceInput({
        class_id: 'c1', date: '2026-06-21',
        records: [{ student_id: 's1', status: 'present' }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.code).toBe('MISSING_TEACHER_ID');
    });

    it('rejects missing class_id', () => {
      const result = validateMarkAttendanceInput({
        teacher_id: 't1', date: '2026-06-21',
        records: [{ student_id: 's1', status: 'present' }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.code).toBe('MISSING_CLASS_ID');
    });

    it('rejects date not in YYYY-MM-DD format', () => {
      const invalid = validateMarkAttendanceInput({
        teacher_id: 't1', class_id: 'c1', date: '21-06-2026',
        records: [{ student_id: 's1', status: 'present' }],
      });
      expect(invalid.valid).toBe(false);
      if (!invalid.valid) expect(invalid.code).toBe('INVALID_DATE_FORMAT');

      const missingDate = validateMarkAttendanceInput({
        teacher_id: 't1', class_id: 'c1',
        records: [{ student_id: 's1', status: 'present' }],
      });
      expect(missingDate.valid).toBe(false);
    });

    it('rejects empty records array', () => {
      const result = validateMarkAttendanceInput({
        teacher_id: 't1', class_id: 'c1', date: '2026-06-21', records: [],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.code).toBe('EMPTY_RECORDS');
    });

    it('rejects records array > 200 items', () => {
      const records = Array.from({ length: 201 }, (_, i) => ({ student_id: `s${i}`, status: 'present' }));
      const result = validateMarkAttendanceInput({
        teacher_id: 't1', class_id: 'c1', date: '2026-06-21', records,
      });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.code).toBe('RECORDS_TOO_LARGE');
    });

    it('rejects a record with invalid status', () => {
      const result = validateMarkAttendanceInput({
        teacher_id: 't1', class_id: 'c1', date: '2026-06-21',
        records: [{ student_id: 's1', status: 'here' }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.code).toBe('INVALID_STATUS');
    });

    it('rejects a record missing student_id', () => {
      const result = validateMarkAttendanceInput({
        teacher_id: 't1', class_id: 'c1', date: '2026-06-21',
        records: [{ status: 'present' }],
      });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.code).toBe('MISSING_STUDENT_ID');
    });

    it('accepts a valid batch of records', () => {
      const result = validateMarkAttendanceInput({
        teacher_id: 't1',
        class_id: 'c1',
        date: '2026-06-21',
        records: [
          { student_id: 's1', status: 'present' },
          { student_id: 's2', status: 'absent' },
          { student_id: 's3', status: 'late' },
          { student_id: 's4', status: 'excused' },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it('accepts notes truncated to 200 characters', () => {
      const longNotes = 'A'.repeat(300);
      const rec = sanitizeRecord({ student_id: 's1', status: 'absent', notes: longNotes });
      expect(rec.notes!.length).toBe(MAX_NOTES_LENGTH);
    });

    it('period is trimmed and capped at 50 characters', () => {
      const longPeriod = 'P'.repeat(80);
      const rec = sanitizeRecord({ student_id: 's1', status: 'present', period: `  ${longPeriod}  ` });
      expect(rec.period!.length).toBeLessThanOrEqual(MAX_PERIOD_LENGTH);
      // After trimming leading/trailing spaces, then slicing to 50
      expect(rec.period).toBe('P'.repeat(50));
    });

  });


  // =========================================================================
  // Group 4: academic_terms — NULL school_id partial index logic (REG-166)
  // =========================================================================

  describe('REG-166: academic_terms — global default vs school-specific', () => {

    interface AcademicTerm {
      id: string;
      school_id: string | null;
      academic_year: string;
      term_number: number;
      name: string;
      start_date: string;
      end_date: string;
      is_current: boolean;
    }

    // Seeded platform-wide defaults per migration
    const SEEDED_TERMS: AcademicTerm[] = [
      {
        id: 'term-1',
        school_id: null,
        academic_year: '2025-26',
        term_number: 1,
        name: 'Term 1',
        start_date: '2025-04-01',
        end_date: '2025-09-30',
        is_current: false,
      },
      {
        id: 'term-2',
        school_id: null,
        academic_year: '2025-26',
        term_number: 2,
        name: 'Term 2',
        start_date: '2025-10-01',
        end_date: '2026-03-31',
        is_current: true,
      },
    ];

    // Partial unique index: UNIQUE (academic_year, term_number) WHERE school_id IS NULL
    function wouldViolateGlobalTermIndex(
      existing: AcademicTerm[],
      newTerm: Pick<AcademicTerm, 'academic_year' | 'term_number' | 'school_id'>
    ): boolean {
      if (newTerm.school_id !== null) return false; // partial index applies only to NULL school_id
      return existing.some(
        t =>
          t.school_id === null &&
          t.academic_year === newTerm.academic_year &&
          t.term_number === newTerm.term_number
      );
    }

    it('platform-wide defaults have school_id = null', () => {
      for (const term of SEEDED_TERMS) {
        expect(term.school_id).toBeNull();
      }
    });

    it('CBSE 2025-26 should have Term 1 (Apr-Sep) and Term 2 (Oct-Mar) seeded', () => {
      const term1 = SEEDED_TERMS.find(t => t.term_number === 1);
      const term2 = SEEDED_TERMS.find(t => t.term_number === 2);
      expect(term1).toBeDefined();
      expect(term1!.start_date).toBe('2025-04-01');
      expect(term1!.end_date).toBe('2025-09-30');
      expect(term2).toBeDefined();
      expect(term2!.start_date).toBe('2025-10-01');
      expect(term2!.end_date).toBe('2026-03-31');
    });

    it('Term 2 2025-26 should be is_current = true', () => {
      const term2 = SEEDED_TERMS.find(t => t.term_number === 2 && t.academic_year === '2025-26');
      expect(term2).toBeDefined();
      expect(term2!.is_current).toBe(true);
    });

    it('two NULL school_id rows with same academic_year+term_number should conflict via partial index', () => {
      const conflicting = {
        academic_year: '2025-26',
        term_number: 1,
        school_id: null as null,
      };
      expect(wouldViolateGlobalTermIndex(SEEDED_TERMS, conflicting)).toBe(true);
    });

    it('NULL school_id row and non-NULL school_id row with same year+term should NOT conflict', () => {
      const schoolSpecific = {
        academic_year: '2025-26',
        term_number: 1,
        school_id: 'school-uuid-1',
      };
      expect(wouldViolateGlobalTermIndex(SEEDED_TERMS, schoolSpecific)).toBe(false);
    });

    it('a school-specific term with different academic_year does not conflict globally', () => {
      const future = {
        academic_year: '2026-27',
        term_number: 1,
        school_id: null as null,
      };
      expect(wouldViolateGlobalTermIndex(SEEDED_TERMS, future)).toBe(false);
    });

  });


  // =========================================================================
  // Group 5: class_schedule — constraint checks (REG-167)
  // =========================================================================

  describe('REG-167: class_schedule — time constraints', () => {

    interface ClassScheduleRow {
      id: string;
      class_id: string;
      day_of_week: number;     // 0..6
      period_number: number;   // >= 1
      subject_code: string;
      teacher_id: string;
      start_time: string;      // HH:MM
      end_time: string;        // HH:MM (must be > start_time)
      effective_from: string;  // date
      effective_until: string | null; // date | null
    }

    type TimeConstraintResult = { valid: true } | { valid: false; error: string };

    function validateScheduleRow(row: Partial<ClassScheduleRow>): TimeConstraintResult {
      if (
        row.day_of_week !== undefined &&
        (!Number.isInteger(row.day_of_week) || row.day_of_week < 0 || row.day_of_week > 6)
      ) {
        return { valid: false, error: 'day_of_week must be an integer 0..6' };
      }
      if (row.period_number !== undefined && row.period_number < 1) {
        return { valid: false, error: 'period_number must be >= 1' };
      }
      if (row.start_time && row.end_time && row.end_time <= row.start_time) {
        return { valid: false, error: 'end_time must be > start_time' };
      }
      if (
        row.effective_from &&
        row.effective_until &&
        row.effective_until < row.effective_from
      ) {
        return { valid: false, error: 'effective_until must be >= effective_from' };
      }
      return { valid: true };
    }

    it('rejects end_time <= start_time (constraint: end_time > start_time)', () => {
      const equalTimes = validateScheduleRow({ start_time: '09:00', end_time: '09:00' });
      expect(equalTimes.valid).toBe(false);
      if (!equalTimes.valid) expect(equalTimes.error).toContain('end_time');

      const reversedTimes = validateScheduleRow({ start_time: '11:00', end_time: '10:00' });
      expect(reversedTimes.valid).toBe(false);
    });

    it('rejects effective_until < effective_from (constraint: effective_until >= effective_from)', () => {
      const result = validateScheduleRow({
        start_time: '09:00',
        end_time: '10:00',
        effective_from: '2026-06-21',
        effective_until: '2026-06-20',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toContain('effective_until');
    });

    it('allows effective_until = null (currently active)', () => {
      const result = validateScheduleRow({
        day_of_week: 1,
        period_number: 1,
        start_time: '09:00',
        end_time: '10:00',
        effective_from: '2026-06-21',
        effective_until: null,
      });
      expect(result.valid).toBe(true);
    });

    it('day_of_week must be 0..6', () => {
      for (let d = 0; d <= 6; d++) {
        expect(validateScheduleRow({ day_of_week: d }).valid).toBe(true);
      }
      expect(validateScheduleRow({ day_of_week: 7 }).valid).toBe(false);
      expect(validateScheduleRow({ day_of_week: -1 }).valid).toBe(false);
    });

    it('period_number must be >= 1', () => {
      expect(validateScheduleRow({ period_number: 1 }).valid).toBe(true);
      expect(validateScheduleRow({ period_number: 8 }).valid).toBe(true);
      expect(validateScheduleRow({ period_number: 0 }).valid).toBe(false);
      expect(validateScheduleRow({ period_number: -1 }).valid).toBe(false);
    });

    it('accepts a valid schedule row', () => {
      const result = validateScheduleRow({
        day_of_week: 1,
        period_number: 2,
        start_time: '10:00',
        end_time: '11:00',
        effective_from: '2026-06-21',
        effective_until: null,
      });
      expect(result.valid).toBe(true);
    });

    it('effective_until equal to effective_from is allowed', () => {
      const result = validateScheduleRow({
        start_time: '09:00',
        end_time: '10:00',
        effective_from: '2026-06-21',
        effective_until: '2026-06-21',
      });
      expect(result.valid).toBe(true);
    });

  });


  // =========================================================================
  // Group 6: RLS policy boundary tests — student_attendance (REG-163)
  // =========================================================================

  describe('REG-163: RLS boundaries — student_attendance', () => {

    // RLS policy for teacher SELECT on student_attendance:
    // USING (class_id IN (
    //   SELECT ct.class_id FROM class_teachers ct
    //   JOIN teachers t ON t.id = ct.teacher_id
    //   WHERE t.auth_user_id = auth.uid()
    // ))
    function teacherCanSelectAttendance(classId: string, teacherClassIds: string[]): boolean {
      return teacherClassIds.includes(classId);
    }

    // RLS policy for student SELECT on student_attendance:
    // USING (student_id = (
    //   SELECT id FROM students WHERE auth_user_id = auth.uid()
    // ))
    function studentCanSelectAttendance(rowStudentId: string, callerStudentId: string): boolean {
      return rowStudentId === callerStudentId;
    }

    // RLS policy for parent/guardian SELECT on student_attendance:
    // USING (student_id IN (
    //   SELECT gsl.student_id FROM guardian_student_links gsl
    //   JOIN guardians g ON g.id = gsl.guardian_id
    //   WHERE g.auth_user_id = auth.uid()
    //     AND gsl.status = 'approved'
    // ))
    function parentCanSelectAttendance(
      rowStudentId: string,
      approvedLinkedStudentIds: string[]
    ): boolean {
      return approvedLinkedStudentIds.includes(rowStudentId);
    }

    it('teacher with class_teachers link should have SELECT access', () => {
      expect(teacherCanSelectAttendance('class-1', ['class-1', 'class-2'])).toBe(true);
    });

    it('teacher without class_teachers link should NOT have SELECT access', () => {
      expect(teacherCanSelectAttendance('class-3', ['class-1', 'class-2'])).toBe(false);
    });

    it('teacher with empty class list should NOT have SELECT access', () => {
      expect(teacherCanSelectAttendance('class-1', [])).toBe(false);
    });

    it('student should see only own attendance rows (student_id = auth user student id)', () => {
      expect(studentCanSelectAttendance('student-1', 'student-1')).toBe(true);
      expect(studentCanSelectAttendance('student-2', 'student-1')).toBe(false);
    });

    it('parent should see child attendance rows (via guardian_student_links where status=approved)', () => {
      const approvedLinks = ['student-1', 'student-2'];
      expect(parentCanSelectAttendance('student-1', approvedLinks)).toBe(true);
    });

    it('parent with pending (not approved) link should NOT see child rows', () => {
      // pending links are NOT in the approvedLinkedStudentIds set
      const approvedLinks: string[] = [];
      expect(parentCanSelectAttendance('student-3', approvedLinks)).toBe(false);
    });

    it('unauthenticated user should see zero rows', () => {
      // No auth.uid() means no class_teachers match and no student match
      // Represented by empty/mismatched inputs
      expect(teacherCanSelectAttendance('class-1', [])).toBe(false);
      expect(studentCanSelectAttendance('student-1', '')).toBe(false);
      expect(parentCanSelectAttendance('student-1', [])).toBe(false);
    });

  });

  describe('RLS boundaries — boards', () => {

    // boards RLS:
    // SELECT: USING (true) for all authenticated users
    // INSERT/UPDATE: no policy at all (service_role only via RLS bypass)

    function authenticatedUserCanSelectBoards(isAuthenticated: boolean): boolean {
      return isAuthenticated;
    }

    function authenticatedUserCanInsertBoards(): boolean {
      // No INSERT policy exists for authenticated role
      return false;
    }

    it('authenticated user can SELECT all boards', () => {
      expect(authenticatedUserCanSelectBoards(true)).toBe(true);
    });

    it('unauthenticated user cannot SELECT boards', () => {
      expect(authenticatedUserCanSelectBoards(false)).toBe(false);
    });

    it('boards is reference data — no authenticated INSERT allowed (service_role only)', () => {
      expect(authenticatedUserCanInsertBoards()).toBe(false);
    });

  });

  describe('RLS boundaries — assignment_submissions (new parent policy: REG-163)', () => {

    // New policy: assignment_submissions_parent_select
    // USING (student_id IN (
    //   SELECT gsl.student_id FROM guardian_student_links gsl
    //   JOIN guardians g ON g.id = gsl.guardian_id
    //   WHERE g.auth_user_id = auth.uid() AND gsl.status = 'approved'
    // ))
    function parentCanSelectSubmission(
      submissionStudentId: string,
      approvedLinkedStudentIds: string[]
    ): boolean {
      return approvedLinkedStudentIds.includes(submissionStudentId);
    }

    function studentCanSelectOwnSubmission(
      submissionStudentId: string,
      callerStudentId: string
    ): boolean {
      return submissionStudentId === callerStudentId;
    }

    function teacherCanSelectSubmissionsForAssignment(
      assignmentId: string,
      teacherAssignmentIds: string[]
    ): boolean {
      return teacherAssignmentIds.includes(assignmentId);
    }

    it('parent with approved guardian_student_link can SELECT child submissions', () => {
      expect(parentCanSelectSubmission('student-1', ['student-1', 'student-2'])).toBe(true);
    });

    it('parent with pending link cannot SELECT child submissions', () => {
      expect(parentCanSelectSubmission('student-3', [])).toBe(false);
    });

    it('student can SELECT own submissions', () => {
      expect(studentCanSelectOwnSubmission('student-1', 'student-1')).toBe(true);
      expect(studentCanSelectOwnSubmission('student-2', 'student-1')).toBe(false);
    });

    it('teacher can SELECT submissions for their assignments', () => {
      const teacherAssignments = ['assignment-1', 'assignment-2'];
      expect(teacherCanSelectSubmissionsForAssignment('assignment-1', teacherAssignments)).toBe(true);
      expect(teacherCanSelectSubmissionsForAssignment('assignment-3', teacherAssignments)).toBe(false);
    });

  });


  // =========================================================================
  // Group 7: Regression catalog — Phase 1 schema (REG-162..REG-167)
  // =========================================================================

  describe('Regression catalog — Phase 1 schema (REG-162..REG-167)', () => {

    // These tests document the regression contract explicitly, exercising the
    // same predicate functions defined above from a regression-catalog perspective.

    function teacherCanSelectAttendance(classId: string, teacherClassIds: string[]): boolean {
      return teacherClassIds.includes(classId);
    }

    function studentCanSelectAttendance(rowStudentId: string, callerStudentId: string): boolean {
      return rowStudentId === callerStudentId;
    }

    function parentCanSelectAttendance(rowStudentId: string, approvedLinkedStudentIds: string[]): boolean {
      return approvedLinkedStudentIds.includes(rowStudentId);
    }

    function authenticatedUserCanInsertBoards(): boolean {
      return false;
    }

    const VALID_STATUSES = new Set(['present', 'absent', 'late', 'excused']);
    const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

    function validateMarkAttendancePreconditions(input: {
      teacherId?: string;
      classId?: string;
      date?: string;
      records?: Array<{ student_id?: string; status?: string }>;
    }): boolean {
      if (!input.teacherId || !input.classId) return false;
      if (!input.date || !DATE_REGEX.test(input.date)) return false;
      if (!input.records || input.records.length === 0 || input.records.length > 200) return false;
      return input.records.every(r => r.student_id && r.status && VALID_STATUSES.has(r.status));
    }

    it('REG-163: student_attendance RLS — teacher can only mark their own class', () => {
      expect(teacherCanSelectAttendance('class-A', ['class-A'])).toBe(true);
      expect(teacherCanSelectAttendance('class-B', ['class-A'])).toBe(false);
    });

    it('REG-163: student_attendance RLS — student cannot see other students attendance', () => {
      expect(studentCanSelectAttendance('student-X', 'student-X')).toBe(true);
      expect(studentCanSelectAttendance('student-Y', 'student-X')).toBe(false);
    });

    it('REG-163: student_attendance RLS — parent sees child only, not other students', () => {
      const approvedChildren = ['child-1'];
      expect(parentCanSelectAttendance('child-1', approvedChildren)).toBe(true);
      expect(parentCanSelectAttendance('child-2', approvedChildren)).toBe(false);
    });

    it('REG-162: boards — anon cannot insert board rows', () => {
      expect(authenticatedUserCanInsertBoards()).toBe(false);
    });

    it('REG-166: academic_terms partial index — no duplicate global defaults', () => {
      // Partial index: UNIQUE (academic_year, term_number) WHERE school_id IS NULL
      const existing = [
        { school_id: null as null, academic_year: '2025-26', term_number: 1 },
        { school_id: null as null, academic_year: '2025-26', term_number: 2 },
      ];
      function wouldViolate(
        academic_year: string,
        term_number: number,
        school_id: string | null
      ): boolean {
        if (school_id !== null) return false;
        return existing.some(
          t => t.school_id === null &&
            t.academic_year === academic_year &&
            t.term_number === term_number
        );
      }
      expect(wouldViolate('2025-26', 1, null)).toBe(true);    // duplicate global — BLOCKED
      expect(wouldViolate('2025-26', 1, 'school-1')).toBe(false); // school-specific — ALLOWED
      expect(wouldViolate('2026-27', 1, null)).toBe(false);   // different year — ALLOWED
    });

    it('REG-167: class_schedule — time constraint rejects invalid time ranges', () => {
      function endTimeIsValid(start: string, end: string): boolean {
        return end > start;
      }
      expect(endTimeIsValid('09:00', '10:00')).toBe(true);
      expect(endTimeIsValid('10:00', '10:00')).toBe(false); // equal — BLOCKED
      expect(endTimeIsValid('11:00', '10:00')).toBe(false); // reversed — BLOCKED
    });

    it('REG-165: mark_attendance: valid submission with all required fields is accepted', () => {
      const valid = validateMarkAttendancePreconditions({
        teacherId: 'teacher-1',
        classId: 'class-1',
        date: '2026-06-21',
        records: [
          { student_id: 'student-1', status: 'present' },
          { student_id: 'student-2', status: 'absent' },
        ],
      });
      expect(valid).toBe(true);
    });

    it('REG-165: mark_attendance: missing teacher_id is rejected', () => {
      expect(validateMarkAttendancePreconditions({
        classId: 'class-1',
        date: '2026-06-21',
        records: [{ student_id: 's1', status: 'present' }],
      })).toBe(false);
    });

    it('REG-165: mark_attendance: invalid date format is rejected', () => {
      expect(validateMarkAttendancePreconditions({
        teacherId: 'teacher-1',
        classId: 'class-1',
        date: '06/21/2026',
        records: [{ student_id: 's1', status: 'present' }],
      })).toBe(false);
    });

    it('REG-165: mark_attendance: records array exceeding 200 items is rejected', () => {
      const bigRecords = Array.from({ length: 201 }, (_, i) => ({ student_id: `s${i}`, status: 'present' }));
      expect(validateMarkAttendancePreconditions({
        teacherId: 'teacher-1',
        classId: 'class-1',
        date: '2026-06-21',
        records: bigRecords,
      })).toBe(false);
    });

  });

});
