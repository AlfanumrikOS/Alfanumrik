'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Select,
  Badge,
  Skeleton,
  EmptyState,
  SheetModal,
  BottomNav,
} from '@/components/ui';

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────── */
/** P5: Grades are always strings */
const GRADE_VALUES = ['6', '7', '8', '9', '10', '11', '12'] as const;

const SUBJECT_OPTIONS = [
  { value: '', label: 'All Subjects', labelHi: 'सभी विषय' },
  { value: 'Mathematics', label: 'Mathematics', labelHi: 'गणित' },
  { value: 'Science', label: 'Science', labelHi: 'विज्ञान' },
  { value: 'English', label: 'English', labelHi: 'अंग्रेज़ी' },
  { value: 'Social Science', label: 'Social Science', labelHi: 'सामाजिक विज्ञान' },
  { value: 'Hindi', label: 'Hindi', labelHi: 'हिंदी' },
  { value: 'Computer Science', label: 'Computer Science', labelHi: 'कंप्यूटर विज्ञान' },
];

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy', labelHi: 'आसान' },
  { value: 'medium', label: 'Medium', labelHi: 'मध्यम' },
  { value: 'hard', label: 'Hard', labelHi: 'कठिन' },
];

const BLOOM_OPTIONS = [
  { value: 'remember', label: 'Remember', labelHi: 'याद करना' },
  { value: 'understand', label: 'Understand', labelHi: 'समझना' },
  { value: 'apply', label: 'Apply', labelHi: 'लागू करना' },
  { value: 'analyze', label: 'Analyze', labelHi: 'विश्लेषण' },
  { value: 'evaluate', label: 'Evaluate', labelHi: 'मूल्यांकन' },
  { value: 'create', label: 'Create', labelHi: 'सृजन' },
];

const STATUS_OPTIONS_EN = [
  { value: '', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending Review' },
];

const STATUS_OPTIONS_HI = [
  { value: '', label: 'सभी' },
  { value: 'approved', label: 'स्वीकृत' },
  { value: 'pending', label: 'समीक्षा के लिए' },
];

const GRADE_FILTER_EN = [
  { value: '', label: 'All Grades' },
  ...GRADE_VALUES.map(g => ({ value: g, label: `Grade ${g}` })),
];

const GRADE_FILTER_HI = [
  { value: '', label: 'सभी कक्षा' },
  ...GRADE_VALUES.map(g => ({ value: g, label: `कक्षा ${g}` })),
];

const PAGE_SIZE = 20;

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface Question {
  id: string;
  subject: string;
  /** Always string "6"–"12" per P5 */
  grade: string;
  topic: string;
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
  difficulty: string;
  bloom_level: string;
  status: 'approved' | 'pending';
  created_at: string;
}

interface QuestionFormData {
  subject: string;
  grade: string;
  topic: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string; // 'A' | 'B' | 'C' | 'D'
  explanation: string;
  difficulty: string;
  bloom_level: string;
}

interface FormErrors {
  subject?: string;
  grade?: string;
  question_text?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  options_distinct?: string;
  correct_answer?: string;
  explanation?: string;
  difficulty?: string;
  bloom_level?: string;
}

interface CsvRow {
  subject: string;
  grade: string;
  topic: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  explanation: string;
  difficulty: string;
  bloom_level: string;
  valid: boolean;
  errors: string[];
}

/* ─────────────────────────────────────────────────────────────
   QUESTION FORM VALIDATION (P6)
───────────────────────────────────────────────────────────── */
function validateQuestion(data: QuestionFormData, isHi: boolean): FormErrors {
  const errors: FormErrors = {};

  if (!data.subject) {
    errors.subject = t(isHi, 'Subject is required', 'विषय आवश्यक है');
  }
  if (!data.grade) {
    errors.grade = t(isHi, 'Grade is required', 'कक्षा आवश्यक है');
  }
  if (!data.question_text.trim()) {
    errors.question_text = t(isHi, 'Question text is required', 'प्रश्न लिखना आवश्यक है');
  } else if (data.question_text.includes('{{') || data.question_text.includes('[BLANK]')) {
    errors.question_text = t(isHi, 'Question text contains invalid placeholders ({{ or [BLANK])', 'प्रश्न में अमान्य प्लेसहोल्डर हैं ({{ या [BLANK])');
  }
  if (!data.option_a.trim()) errors.option_a = t(isHi, 'Option A is required', 'विकल्प A आवश्यक है');
  if (!data.option_b.trim()) errors.option_b = t(isHi, 'Option B is required', 'विकल्प B आवश्यक है');
  if (!data.option_c.trim()) errors.option_c = t(isHi, 'Option C is required', 'विकल्प C आवश्यक है');
  if (!data.option_d.trim()) errors.option_d = t(isHi, 'Option D is required', 'विकल्प D आवश्यक है');

  // P6: All 4 options must be distinct
  const opts = [data.option_a.trim(), data.option_b.trim(), data.option_c.trim(), data.option_d.trim()].filter(Boolean);
  if (opts.length === 4 && new Set(opts).size < 4) {
    errors.options_distinct = t(isHi, 'All four options must be different', 'सभी चार विकल्प अलग-अलग होने चाहिए');
  }

  if (!data.correct_answer) {
    errors.correct_answer = t(isHi, 'Correct answer must be selected', 'सही उत्तर चुनना आवश्यक है');
  }
  if (!data.explanation.trim()) {
    errors.explanation = t(isHi, 'Explanation is required', 'व्याख्या आवश्यक है');
  }
  if (!data.difficulty) {
    errors.difficulty = t(isHi, 'Difficulty is required', 'कठिनाई स्तर आवश्यक है');
  }
  if (!data.bloom_level) {
    errors.bloom_level = t(isHi, "Bloom's level is required", "Bloom's स्तर आवश्यक है");
  }

  return errors;
}

function answerLetterToIndex(letter: string): number {
  const map: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  return map[letter.toUpperCase()] ?? -1;
}

function answerIndexToLetter(index: number): string {
  return ['A', 'B', 'C', 'D'][index] ?? '';
}

/* ─────────────────────────────────────────────────────────────
   CSV PARSER
───────────────────────────────────────────────────────────── */
function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Skip header row
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parse (handles basic comma separation)
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 12) {
      rows.push({
        subject: cols[0] || '',
        grade: cols[1] || '',
        topic: cols[2] || '',
        question_text: cols[3] || '',
        option_a: cols[4] || '',
        option_b: cols[5] || '',
        option_c: cols[6] || '',
        option_d: cols[7] || '',
        correct_answer: cols[8] || '',
        explanation: cols[9] || '',
        difficulty: cols[10] || '',
        bloom_level: cols[11] || '',
        valid: false,
        errors: ['Insufficient columns (expected 12)'],
      });
      continue;
    }

    const row: CsvRow = {
      subject: cols[0],
      grade: cols[1],
      topic: cols[2],
      question_text: cols[3],
      option_a: cols[4],
      option_b: cols[5],
      option_c: cols[6],
      option_d: cols[7],
      correct_answer: cols[8].toUpperCase(),
      explanation: cols[9],
      difficulty: cols[10].toLowerCase(),
      bloom_level: cols[11].toLowerCase(),
      valid: true,
      errors: [],
    };

    // Validate
    const errs: string[] = [];
    if (!row.subject) errs.push('Missing subject');
    if (!GRADE_VALUES.includes(row.grade as typeof GRADE_VALUES[number])) errs.push('Invalid grade');
    if (!row.question_text) errs.push('Missing question text');
    if (row.question_text.includes('{{') || row.question_text.includes('[BLANK]')) errs.push('Invalid placeholders');
    if (!row.option_a || !row.option_b || !row.option_c || !row.option_d) errs.push('Missing options');
    const opts = [row.option_a, row.option_b, row.option_c, row.option_d].filter(Boolean);
    if (opts.length === 4 && new Set(opts).size < 4) errs.push('Duplicate options');
    if (!['A', 'B', 'C', 'D'].includes(row.correct_answer)) errs.push('Invalid correct answer');
    if (!row.explanation) errs.push('Missing explanation');
    if (!['easy', 'medium', 'hard'].includes(row.difficulty)) errs.push('Invalid difficulty');
    if (!['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'].includes(row.bloom_level)) errs.push('Invalid bloom level');

    row.errors = errs;
    row.valid = errs.length === 0;
    rows.push(row);
  }

  return rows;
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING STATE
───────────────────────────────────────────────────────────── */
function QuestionRowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <Skeleton variant="text" height={14} width="35%" />
      <Skeleton variant="rect" height={20} width={60} rounded="rounded-full" />
      <Skeleton variant="rect" height={20} width={40} rounded="rounded-full" />
      <Skeleton variant="rect" height={20} width={50} rounded="rounded-full" />
      <Skeleton variant="rect" height={20} width={60} rounded="rounded-full" />
      <Skeleton variant="rect" height={20} width={70} rounded="rounded-full" />
      <div className="flex gap-2 ml-auto">
        <Skeleton variant="rect" height={28} width={50} rounded="rounded-lg" />
        <Skeleton variant="rect" height={28} width={60} rounded="rounded-lg" />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   QUESTION FORM COMPONENT
───────────────────────────────────────────────────────────── */
interface QuestionFormProps {
  isHi: boolean;
  existing?: Question | null;
  onSave: (payload: any) => Promise<void>;
  onClose: () => void;
}

function QuestionForm({ isHi, existing, onSave, onClose }: QuestionFormProps) {
  const [form, setForm] = useState<QuestionFormData>({
    subject: existing?.subject ?? '',
    grade: existing?.grade ?? '',
    topic: existing?.topic ?? '',
    question_text: existing?.question_text ?? '',
    option_a: existing?.options?.[0] ?? '',
    option_b: existing?.options?.[1] ?? '',
    option_c: existing?.options?.[2] ?? '',
    option_d: existing?.options?.[3] ?? '',
    correct_answer: existing ? answerIndexToLetter(existing.correct_answer_index) : '',
    explanation: existing?.explanation ?? '',
    difficulty: existing?.difficulty ?? '',
    bloom_level: existing?.bloom_level ?? '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const update = (key: keyof QuestionFormData, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    // Clear field error on change
    setErrors(prev => ({ ...prev, [key]: undefined, options_distinct: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validateQuestion(form, isHi);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await onSave({
        id: existing?.id,
        subject: form.subject,
        grade: form.grade, // P5: string
        topic: form.topic.trim(),
        question_text: form.question_text.trim(),
        options: [form.option_a.trim(), form.option_b.trim(), form.option_c.trim(), form.option_d.trim()],
        correct_answer_index: answerLetterToIndex(form.correct_answer),
        explanation: form.explanation.trim(),
        difficulty: form.difficulty,
        bloom_level: form.bloom_level,
      });
      onClose();
    } catch (err: any) {
      setSubmitError(err.message || t(isHi, 'Failed to save question', 'प्रश्न सहेजने में विफल'));
    } finally {
      setSubmitting(false);
    }
  };

  const subjectOpts = SUBJECT_OPTIONS.slice(1).map(s => ({
    value: s.value,
    label: isHi ? s.labelHi : s.label,
  }));
  const gradeOpts = GRADE_VALUES.map(g => ({
    value: g,
    label: t(isHi, `Grade ${g}`, `कक्षा ${g}`),
  }));
  const diffOpts = DIFFICULTY_OPTIONS.map(d => ({
    value: d.value,
    label: isHi ? d.labelHi : d.label,
  }));
  const bloomOpts = BLOOM_OPTIONS.map(b => ({
    value: b.value,
    label: isHi ? b.labelHi : b.label,
  }));

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4 pt-1">
      {/* Subject + Grade row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <Select
            label={t(isHi, 'Subject', 'विषय') + ' *'}
            value={form.subject}
            onChange={(v) => update('subject', v)}
            options={[{ value: '', label: t(isHi, 'Select...', 'चुनें...') }, ...subjectOpts]}
          />
          {errors.subject && (
            <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.subject}</p>
          )}
        </div>
        <div>
          <Select
            label={t(isHi, 'Grade', 'कक्षा') + ' *'}
            value={form.grade}
            onChange={(v) => update('grade', v)}
            options={[{ value: '', label: t(isHi, 'Select...', 'चुनें...') }, ...gradeOpts]}
          />
          {errors.grade && (
            <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.grade}</p>
          )}
        </div>
      </div>

      {/* Topic */}
      <Input
        label={t(isHi, 'Topic', 'विषय-वस्तु')}
        value={form.topic}
        onChange={(e) => update('topic', e.target.value)}
        placeholder={t(isHi, 'e.g. Quadratic Equations', 'उदा. द्विघात समीकरण')}
        style={{ minHeight: 48 }}
      />

      {/* Question Text */}
      <div>
        <label
          className="block text-xs font-semibold mb-1.5"
          style={{ color: 'var(--text-2)' }}
        >
          {t(isHi, 'Question Text', 'प्रश्न')} *
        </label>
        <textarea
          value={form.question_text}
          onChange={(e) => update('question_text', e.target.value)}
          placeholder={t(isHi, 'Enter the question...', 'प्रश्न लिखें...')}
          rows={4}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 12,
            border: errors.question_text ? '1px solid #DC2626' : '1px solid var(--border)',
            background: 'var(--surface-1)',
            color: 'var(--text-1)',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
        {errors.question_text && (
          <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.question_text}</p>
        )}
      </div>

      {/* Options A-D in 2-col */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Input
          label={t(isHi, 'Option A', 'विकल्प A') + ' *'}
          value={form.option_a}
          onChange={(e) => update('option_a', e.target.value)}
          error={errors.option_a}
          style={{ minHeight: 48 }}
        />
        <Input
          label={t(isHi, 'Option B', 'विकल्प B') + ' *'}
          value={form.option_b}
          onChange={(e) => update('option_b', e.target.value)}
          error={errors.option_b}
          style={{ minHeight: 48 }}
        />
        <Input
          label={t(isHi, 'Option C', 'विकल्प C') + ' *'}
          value={form.option_c}
          onChange={(e) => update('option_c', e.target.value)}
          error={errors.option_c}
          style={{ minHeight: 48 }}
        />
        <Input
          label={t(isHi, 'Option D', 'विकल्प D') + ' *'}
          value={form.option_d}
          onChange={(e) => update('option_d', e.target.value)}
          error={errors.option_d}
          style={{ minHeight: 48 }}
        />
      </div>
      {errors.options_distinct && (
        <p className="text-xs ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.options_distinct}</p>
      )}

      {/* Correct Answer */}
      <div>
        <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>
          {t(isHi, 'Correct Answer', 'सही उत्तर')} *
        </label>
        <div className="flex gap-4">
          {(['A', 'B', 'C', 'D'] as const).map(letter => (
            <label key={letter} className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="radio"
                name="correct_answer"
                value={letter}
                checked={form.correct_answer === letter}
                onChange={() => update('correct_answer', letter)}
                style={{ accentColor: 'var(--orange)', width: 18, height: 18 }}
              />
              <span className="text-sm font-medium text-[var(--text-1)]">{letter}</span>
            </label>
          ))}
        </div>
        {errors.correct_answer && (
          <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.correct_answer}</p>
        )}
      </div>

      {/* Explanation */}
      <div>
        <label
          className="block text-xs font-semibold mb-1.5"
          style={{ color: 'var(--text-2)' }}
        >
          {t(isHi, 'Explanation', 'व्याख्या')} *
        </label>
        <textarea
          value={form.explanation}
          onChange={(e) => update('explanation', e.target.value)}
          placeholder={t(isHi, 'Explain why this answer is correct...', 'बताएं कि यह उत्तर सही क्यों है...')}
          rows={3}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 12,
            border: errors.explanation ? '1px solid #DC2626' : '1px solid var(--border)',
            background: 'var(--surface-1)',
            color: 'var(--text-1)',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'vertical',
          }}
        />
        {errors.explanation && (
          <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.explanation}</p>
        )}
      </div>

      {/* Difficulty + Bloom's */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <Select
            label={t(isHi, 'Difficulty', 'कठिनाई') + ' *'}
            value={form.difficulty}
            onChange={(v) => update('difficulty', v)}
            options={[{ value: '', label: t(isHi, 'Select...', 'चुनें...') }, ...diffOpts]}
          />
          {errors.difficulty && (
            <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.difficulty}</p>
          )}
        </div>
        <div>
          <Select
            label="Bloom's Level *"
            value={form.bloom_level}
            onChange={(v) => update('bloom_level', v)}
            options={[{ value: '', label: t(isHi, 'Select...', 'चुनें...') }, ...bloomOpts]}
          />
          {errors.bloom_level && (
            <p className="text-xs mt-1 ml-1 font-medium" style={{ color: '#DC2626' }} role="alert">{errors.bloom_level}</p>
          )}
        </div>
      </div>

      {/* Submit error */}
      {submitError && (
        <p className="text-xs font-medium px-1" style={{ color: '#DC2626' }} role="alert">{submitError}</p>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <Button
          type="submit"
          variant="primary"
          fullWidth
          disabled={submitting}
          style={{ minHeight: 48 }}
        >
          {submitting
            ? t(isHi, 'Saving...', 'सहेज रहे हैं...')
            : existing
              ? t(isHi, 'Update Question', 'प्रश्न अपडेट करें')
              : t(isHi, 'Add Question', 'प्रश्न जोड़ें')}
        </Button>
        <Button
          type="button"
          variant="soft"
          onClick={onClose}
          style={{ minHeight: 48 }}
        >
          {t(isHi, 'Cancel', 'रद्द करें')}
        </Button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────────────────
   BULK UPLOAD PREVIEW COMPONENT
───────────────────────────────────────────────────────────── */
interface BulkUploadProps {
  isHi: boolean;
  onUpload: (rows: CsvRow[]) => Promise<void>;
  onClose: () => void;
}

function BulkUploadForm({ isHi, onUpload, onClose }: BulkUploadProps) {
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCsv(text);
      setCsvRows(parsed);
    };
    reader.readAsText(file);
  };

  const validRows = csvRows.filter(r => r.valid);
  const invalidRows = csvRows.filter(r => !r.valid);

  const handleUpload = async () => {
    if (validRows.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      await onUpload(validRows);
      onClose();
    } catch (err: any) {
      setUploadError(err.message || t(isHi, 'Upload failed', 'अपलोड विफल'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-4 pt-1">
      {/* File input */}
      <div>
        <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-2)' }}>
          {t(isHi, 'Upload CSV File', 'CSV फ़ाइल अपलोड करें')}
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="text-sm"
          style={{ color: 'var(--text-2)' }}
        />
        <p className="text-xs text-[var(--text-3)] mt-2">
          {t(isHi,
            'Expected columns: subject, grade, topic, question_text, option_a, option_b, option_c, option_d, correct_answer (A/B/C/D), explanation, difficulty, bloom_level',
            'अपेक्षित कॉलम: subject, grade, topic, question_text, option_a, option_b, option_c, option_d, correct_answer (A/B/C/D), explanation, difficulty, bloom_level'
          )}
        </p>
      </div>

      {/* Preview table */}
      {csvRows.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-[var(--text-1)] mb-2">
            {t(isHi, 'Preview', 'पूर्वावलोकन')}: {validRows.length} {t(isHi, 'valid', 'वैध')}, {invalidRows.length} {t(isHi, 'invalid', 'अवैध')}
          </p>
          <div
            style={{
              maxHeight: 300,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600 }}>#</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600 }}>{t(isHi, 'Status', 'स्थिति')}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600 }}>{t(isHi, 'Question', 'प्रश्न')}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600 }}>{t(isHi, 'Subject', 'विषय')}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600 }}>{t(isHi, 'Grade', 'कक्षा')}</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600 }}>{t(isHi, 'Issues', 'समस्याएं')}</th>
                </tr>
              </thead>
              <tbody>
                {csvRows.map((row, idx) => (
                  <tr
                    key={idx}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: row.valid ? 'transparent' : 'rgba(239,68,68,0.04)',
                    }}
                  >
                    <td style={{ padding: '6px 12px', color: 'var(--text-3)' }}>{idx + 1}</td>
                    <td style={{ padding: '6px 12px' }}>
                      <span style={{ color: row.valid ? '#22C55E' : '#EF4444', fontWeight: 600 }}>
                        {row.valid ? '✓' : '✗'}
                      </span>
                    </td>
                    <td style={{ padding: '6px 12px', color: 'var(--text-1)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.question_text.slice(0, 60)}{row.question_text.length > 60 ? '...' : ''}
                    </td>
                    <td style={{ padding: '6px 12px', color: 'var(--text-2)' }}>{row.subject}</td>
                    <td style={{ padding: '6px 12px', color: 'var(--text-2)' }}>{row.grade}</td>
                    <td style={{ padding: '6px 12px', color: '#EF4444', fontSize: 11 }}>
                      {row.errors.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <p className="text-xs font-medium" style={{ color: '#DC2626' }} role="alert">{uploadError}</p>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          variant="primary"
          fullWidth
          disabled={uploading || validRows.length === 0}
          onClick={handleUpload}
          style={{ minHeight: 48 }}
        >
          {uploading
            ? t(isHi, 'Uploading...', 'अपलोड हो रहा है...')
            : t(isHi, `Upload ${validRows.length} valid questions`, `${validRows.length} वैध प्रश्न अपलोड करें`)}
        </Button>
        <Button
          variant="soft"
          onClick={onClose}
          style={{ minHeight: 48 }}
        >
          {t(isHi, 'Cancel', 'रद्द करें')}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   DELETE CONFIRMATION
───────────────────────────────────────────────────────────── */
interface DeleteConfirmProps {
  isHi: boolean;
  questionText: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function DeleteConfirm({ isHi, questionText, onConfirm, onCancel, loading }: DeleteConfirmProps) {
  const preview = questionText.length > 80 ? questionText.slice(0, 80) + '...' : questionText;
  return (
    <div className="space-y-4 pt-2">
      <p className="text-sm text-[var(--text-2)]">
        {t(isHi,
          `Are you sure you want to delete this question? This action cannot be undone.`,
          `क्या आप इस प्रश्न को हटाना चाहते हैं? यह कार्रवाई पूर्ववत नहीं की जा सकती।`
        )}
      </p>
      <p className="text-xs text-[var(--text-3)] italic">&ldquo;{preview}&rdquo;</p>
      <div className="flex gap-3">
        <Button
          variant="primary"
          fullWidth
          onClick={onConfirm}
          disabled={loading}
          style={{ minHeight: 48, background: '#DC2626' }}
        >
          {loading
            ? t(isHi, 'Deleting...', 'हटा रहे हैं...')
            : t(isHi, 'Delete', 'हटाएं')}
        </Button>
        <Button variant="soft" onClick={onCancel} style={{ minHeight: 48 }}>
          {t(isHi, 'Cancel', 'रद्द करें')}
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────── */
export default function SchoolAdminContentPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi, setLanguage } = useAuth();

  /* ── State ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  /* Filter state */
  const [subjectFilter, setSubjectFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  /* Pagination */
  const [currentPage, setCurrentPage] = useState(1);

  /* Modal state */
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  /* Toast */
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  /* ── Auth helper: get session token ── */
  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  /* ── Step 1: Auth guard — fetch school_admins record ── */
  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;
    setLoadingAdmin(true);

    const { data, error } = await supabase
      .from('school_admins')
      .select('school_id, name')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (error || !data) {
      router.replace('/login');
      return;
    }

    setSchoolId(data.school_id as string);
    setLoadingAdmin(false);
  }, [authUserId, router]);

  /* ── Fetch questions via API ── */
  const fetchQuestions = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    setLoadingQuestions(true);
    setApiError(null);

    try {
      const res = await fetch('/api/school-admin/content', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Unknown error');
      setQuestions((json.data ?? []) as Question[]);
    } catch (err: any) {
      setApiError(err.message || t(isHi, 'Failed to load questions', 'प्रश्न लोड करने में विफल'));
    } finally {
      setLoadingQuestions(false);
    }
  }, [getToken, isHi]);

  /* ── Save question (create / update) ── */
  const handleSaveQuestion = useCallback(async (payload: any) => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');

    const method = payload.id ? 'PUT' : 'POST';
    const res = await fetch('/api/school-admin/content', {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }

    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');

    setSuccessMsg(
      payload.id
        ? t(isHi, 'Question updated!', 'प्रश्न अपडेट हो गया!')
        : t(isHi, 'Question added!', 'प्रश्न जोड़ दिया गया!')
    );
    fetchQuestions();
  }, [getToken, isHi, fetchQuestions]);

  /* ── Bulk upload ── */
  const handleBulkUpload = useCallback(async (rows: CsvRow[]) => {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');

    const payload = rows.map(r => ({
      subject: r.subject,
      grade: r.grade, // P5: string
      topic: r.topic,
      question_text: r.question_text,
      options: [r.option_a, r.option_b, r.option_c, r.option_d],
      correct_answer_index: answerLetterToIndex(r.correct_answer),
      explanation: r.explanation,
      difficulty: r.difficulty,
      bloom_level: r.bloom_level,
    }));

    const res = await fetch('/api/school-admin/content/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ questions: payload }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }

    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');

    setSuccessMsg(t(isHi, `${rows.length} questions uploaded!`, `${rows.length} प्रश्न अपलोड हो गए!`));
    fetchQuestions();
  }, [getToken, isHi, fetchQuestions]);

  /* ── Toggle approval status ── */
  const handleToggleApproval = useCallback(async (question: Question) => {
    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/school-admin/content', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: question.id,
          status: question.status === 'approved' ? 'pending' : 'approved',
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      setSuccessMsg(
        question.status === 'approved'
          ? t(isHi, 'Question marked as pending', 'प्रश्न समीक्षा के लिए चिह्नित')
          : t(isHi, 'Question approved!', 'प्रश्न स्वीकृत!')
      );
      fetchQuestions();
    } catch (err: any) {
      setApiError(err.message);
    }
  }, [getToken, isHi, fetchQuestions]);

  /* ── Delete question ── */
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const token = await getToken();
    if (!token) return;

    setDeleteLoading(true);
    try {
      const res = await fetch('/api/school-admin/content', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: deleteTarget.id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      setSuccessMsg(t(isHi, 'Question deleted', 'प्रश्न हटा दिया गया'));
      setDeleteTarget(null);
      fetchQuestions();
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, getToken, isHi, fetchQuestions]);

  /* ── Auth redirect guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* ── Fetch admin record once auth is ready ── */
  useEffect(() => {
    if (!authLoading && authUserId) {
      fetchAdminRecord();
    }
  }, [authLoading, authUserId, fetchAdminRecord]);

  /* ── Fetch questions once school_id is known ── */
  useEffect(() => {
    if (schoolId) {
      fetchQuestions();
    }
  }, [schoolId, fetchQuestions]);

  /* ── Auto-dismiss success message ── */
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 3500);
    return () => clearTimeout(timer);
  }, [successMsg]);

  /* ── Client-side filtering ── */
  const filteredQuestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return questions.filter(item => {
      if (subjectFilter && item.subject !== subjectFilter) return false;
      if (gradeFilter && item.grade !== gradeFilter) return false;
      if (statusFilter && item.status !== statusFilter) return false;
      if (q && !item.question_text.toLowerCase().includes(q) && !item.topic.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [questions, subjectFilter, gradeFilter, statusFilter, searchQuery]);

  /* ── Pagination ── */
  const totalPages = Math.max(1, Math.ceil(filteredQuestions.length / PAGE_SIZE));
  const paginatedQuestions = filteredQuestions.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [subjectFilter, gradeFilter, statusFilter, searchQuery]);

  /* ── Stats ── */
  const stats = useMemo(() => {
    const approved = questions.filter(q => q.status === 'approved').length;
    const pending = questions.filter(q => q.status === 'pending').length;
    const bySubject: Record<string, number> = {};
    for (const q of questions) {
      bySubject[q.subject] = (bySubject[q.subject] || 0) + 1;
    }
    return { total: questions.length, approved, pending, bySubject };
  }, [questions]);

  /* ── Loading states ── */
  const isPageLoading = authLoading || loadingAdmin;

  const openCreate = () => {
    setEditingQuestion(null);
    setFormModalOpen(true);
  };

  const openEdit = (q: Question) => {
    setEditingQuestion(q);
    setFormModalOpen(true);
  };

  /* ─── Subject filter options ─── */
  const subjectFilterOpts = SUBJECT_OPTIONS.map(s => ({
    value: s.value,
    label: isHi ? s.labelHi : s.label,
  }));

  /* ══════════════════════════════════════════════════════════
     PAGE HEADER
  ══════════════════════════════════════════════════════════ */
  const PageHeader = (
    <header
      className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
      style={{
        background: 'rgba(251,248,244,0.94)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <button
        onClick={() => router.push('/school-admin')}
        className="flex items-center justify-center rounded-xl transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 flex-shrink-0"
        style={{
          minWidth: 44,
          minHeight: 44,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
          fontSize: '18px',
        }}
        aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस')}
      >
        &#8592;
      </button>

      <div className="flex-1 min-w-0">
        <h1
          className="text-base font-bold text-[var(--text-1)] truncate"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {t(isHi, 'Question Bank', 'प्रश्न बैंक')}
        </h1>
      </div>

      <button
        onClick={() => setLanguage && setLanguage(isHi ? 'en' : 'hi')}
        className="flex items-center justify-center rounded-xl text-xs font-semibold transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2 flex-shrink-0"
        style={{
          minWidth: 44,
          minHeight: 44,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text-2)',
        }}
        aria-label={isHi ? 'Switch to English' : 'हिन्दी में बदलें'}
      >
        {isHi ? 'EN' : 'हि'}
      </button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setBulkUploadOpen(true)}
        style={{ minHeight: 44, flexShrink: 0, whiteSpace: 'nowrap' }}
      >
        {t(isHi, 'Bulk Upload', 'बल्क अपलोड')}
      </Button>

      <Button
        variant="primary"
        size="sm"
        onClick={openCreate}
        style={{ minHeight: 44, flexShrink: 0 }}
        aria-label={t(isHi, 'Add Question', 'प्रश्न जोड़ें')}
      >
        + {t(isHi, 'Add', 'जोड़ें')}
      </Button>
    </header>
  );

  /* ══════════════════════════════════════════════════════════
     FULL PAGE LOADING SKELETON
  ══════════════════════════════════════════════════════════ */
  if (isPageLoading) {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        <header
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-2"
          style={{
            background: 'rgba(251,248,244,0.94)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="rect" width={44} height={44} rounded="rounded-xl" />
          <Skeleton variant="title" height={20} width="30%" className="flex-1" />
          <Skeleton variant="rect" width={44} height={44} rounded="rounded-xl" />
          <Skeleton variant="rect" width={90} height={44} rounded="rounded-xl" />
          <Skeleton variant="rect" width={70} height={44} rounded="rounded-xl" />
        </header>
        <div className="px-4 pt-4 pb-24 max-w-4xl mx-auto space-y-3">
          <div className="grid grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} variant="rect" height={60} rounded="rounded-xl" />)}
          </div>
          <div className="flex gap-2">
            <Skeleton variant="rect" height={44} rounded="rounded-xl" className="flex-1" />
            <Skeleton variant="rect" height={44} rounded="rounded-xl" className="flex-1" />
            <Skeleton variant="rect" height={44} rounded="rounded-xl" className="flex-1" />
          </div>
          {[1, 2, 3, 4, 5].map(i => <QuestionRowSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     ERROR STATE
  ══════════════════════════════════════════════════════════ */
  if (apiError && !loadingQuestions && questions.length === 0) {
    return (
      <div
        style={{ background: 'var(--bg)' }}
        className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
      >
        {PageHeader}
        <main className="px-4 pt-6 pb-24 max-w-4xl mx-auto">
          <Card className="text-center py-8">
            <div className="text-4xl mb-3" aria-hidden="true">&#9888;</div>
            <p className="text-sm text-[var(--text-2)] mb-4">{apiError}</p>
            <Button variant="primary" onClick={fetchQuestions}>
              {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </Button>
          </Card>
        </main>
        <BottomNav />
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════
     LOADED STATE
  ══════════════════════════════════════════════════════════ */
  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {PageHeader}

      <main className="px-4 pt-4 pb-24 max-w-4xl mx-auto space-y-4">

        {/* ── Stats Row ── */}
        {!loadingQuestions && questions.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              className="rounded-xl py-3 px-4 text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <div className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{stats.total}</div>
              <div className="text-xs text-[var(--text-3)] font-medium mt-0.5">{t(isHi, 'Total', 'कुल')}</div>
            </div>
            <div
              className="rounded-xl py-3 px-4 text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <div className="text-xl font-bold" style={{ color: '#22C55E' }}>{stats.approved}</div>
              <div className="text-xs text-[var(--text-3)] font-medium mt-0.5">{t(isHi, 'Approved', 'स्वीकृत')}</div>
            </div>
            <div
              className="rounded-xl py-3 px-4 text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <div className="text-xl font-bold" style={{ color: '#EAB308' }}>{stats.pending}</div>
              <div className="text-xs text-[var(--text-3)] font-medium mt-0.5">{t(isHi, 'Pending', 'लंबित')}</div>
            </div>
            <div
              className="rounded-xl py-3 px-4 text-center"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
            >
              <div className="text-xl font-bold" style={{ color: 'var(--purple)' }}>
                {Object.keys(stats.bySubject).length}
              </div>
              <div className="text-xs text-[var(--text-3)] font-medium mt-0.5">{t(isHi, 'Subjects', 'विषय')}</div>
            </div>
          </div>
        )}

        {/* ── Filter Bar ── */}
        <section aria-label={t(isHi, 'Filters', 'फ़िल्टर')}>
          <div className="flex gap-2 mb-3 flex-wrap">
            <div className="flex-1" style={{ minWidth: 140 }}>
              <Select
                label={t(isHi, 'Subject', 'विषय')}
                value={subjectFilter}
                onChange={setSubjectFilter}
                options={subjectFilterOpts}
              />
            </div>
            <div className="flex-1" style={{ minWidth: 120 }}>
              <Select
                label={t(isHi, 'Grade', 'कक्षा')}
                value={gradeFilter}
                onChange={setGradeFilter}
                options={isHi ? GRADE_FILTER_HI : GRADE_FILTER_EN}
              />
            </div>
            <div className="flex-1" style={{ minWidth: 120 }}>
              <Select
                label={t(isHi, 'Status', 'स्थिति')}
                value={statusFilter}
                onChange={setStatusFilter}
                options={isHi ? STATUS_OPTIONS_HI : STATUS_OPTIONS_EN}
              />
            </div>
          </div>
          <Input
            placeholder={t(isHi, 'Search questions or topics...', 'प्रश्न या विषय खोजें...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t(isHi, 'Search questions', 'प्रश्न खोजें')}
            style={{ minHeight: 48 }}
          />
        </section>

        {/* ── Count ── */}
        {!loadingQuestions && (
          <p className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            {filteredQuestions.length} {t(isHi, 'questions', 'प्रश्न')}
            {(subjectFilter || gradeFilter || statusFilter || searchQuery.trim()) && (
              <span> {t(isHi, '(filtered)', '(फ़िल्टर किए गए)')}</span>
            )}
          </p>
        )}

        {/* ── Loading skeleton ── */}
        {loadingQuestions && (
          <div className="space-y-1">
            {[1, 2, 3, 4, 5, 6].map(i => <QuestionRowSkeleton key={i} />)}
          </div>
        )}

        {/* ── Question table ── */}
        {!loadingQuestions && paginatedQuestions.length > 0 && (
          <Card className="p-0 overflow-hidden">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {t(isHi, 'Question', 'प्रश्न')}
                    </th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {t(isHi, 'Subject', 'विषय')}
                    </th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {t(isHi, 'Grade', 'कक्षा')}
                    </th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {t(isHi, 'Difficulty', 'कठिनाई')}
                    </th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                      Bloom&apos;s
                    </th>
                    <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {t(isHi, 'Status', 'स्थिति')}
                    </th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-3)', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {t(isHi, 'Actions', 'कार्रवाई')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedQuestions.map(q => (
                    <tr key={q.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 12px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-1)' }}>
                        {q.question_text.length > 70 ? q.question_text.slice(0, 70) + '...' : q.question_text}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                        {q.subject}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <Badge color="var(--purple)" size="sm">
                          {t(isHi, `Grade ${q.grade}`, `कक्षा ${q.grade}`)}
                        </Badge>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <Badge
                          color={q.difficulty === 'easy' ? '#22C55E' : q.difficulty === 'medium' ? '#EAB308' : '#EF4444'}
                          size="sm"
                        >
                          {q.difficulty}
                        </Badge>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', color: 'var(--text-2)', fontSize: 12 }}>
                        {q.bloom_level}
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <Badge
                          color={q.status === 'approved' ? '#22C55E' : '#EAB308'}
                          size="sm"
                        >
                          {q.status === 'approved'
                            ? t(isHi, 'Approved', 'स्वीकृत')
                            : t(isHi, 'Pending', 'लंबित')}
                        </Badge>
                      </td>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            onClick={() => openEdit(q)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                            style={{
                              background: 'var(--surface-2)',
                              border: '1px solid var(--border)',
                              color: 'var(--text-2)',
                              minHeight: 30,
                            }}
                          >
                            {t(isHi, 'Edit', 'संपादित')}
                          </button>
                          <button
                            onClick={() => handleToggleApproval(q)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                            style={{
                              background: q.status === 'approved' ? 'rgba(234,179,8,0.06)' : 'rgba(22,163,74,0.06)',
                              border: `1px solid ${q.status === 'approved' ? 'rgba(234,179,8,0.2)' : 'rgba(22,163,74,0.2)'}`,
                              color: q.status === 'approved' ? '#EAB308' : '#16A34A',
                              minHeight: 30,
                            }}
                          >
                            {q.status === 'approved'
                              ? t(isHi, 'Reject', 'अस्वीकार')
                              : t(isHi, 'Approve', 'स्वीकृत करें')}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(q)}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95"
                            style={{
                              background: 'rgba(220,38,38,0.06)',
                              border: '1px solid rgba(220,38,38,0.2)',
                              color: '#DC2626',
                              minHeight: 30,
                            }}
                          >
                            {t(isHi, 'Delete', 'हटाएं')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ── Pagination ── */}
        {!loadingQuestions && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: currentPage === 1 ? 'var(--text-3)' : 'var(--text-1)',
                opacity: currentPage === 1 ? 0.5 : 1,
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              }}
            >
              &#8592; {t(isHi, 'Prev', 'पिछला')}
            </button>
            <span className="text-xs text-[var(--text-3)] font-medium">
              {t(isHi, `Page ${currentPage} of ${totalPages}`, `पृष्ठ ${currentPage} / ${totalPages}`)}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: currentPage === totalPages ? 'var(--text-3)' : 'var(--text-1)',
                opacity: currentPage === totalPages ? 0.5 : 1,
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              {t(isHi, 'Next', 'अगला')} &#8594;
            </button>
          </div>
        )}

        {/* ── Empty state: no questions match filters ── */}
        {!loadingQuestions && questions.length > 0 && filteredQuestions.length === 0 && (
          <Card className="py-2">
            <EmptyState
              icon="&#128269;"
              title={t(isHi, 'No questions found', 'कोई प्रश्न नहीं मिला')}
              description={t(isHi, 'Try adjusting your filters or search term.', 'फ़िल्टर या खोज बदलकर देखें।')}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSubjectFilter('');
                    setGradeFilter('');
                    setStatusFilter('');
                    setSearchQuery('');
                  }}
                >
                  {t(isHi, 'Clear filters', 'फ़िल्टर हटाएं')}
                </Button>
              }
            />
          </Card>
        )}

        {/* ── Empty state: no questions at all ── */}
        {!loadingQuestions && questions.length === 0 && !apiError && (
          <EmptyState
            icon="&#128218;"
            title={t(isHi, 'No questions yet', 'अभी कोई प्रश्न नहीं')}
            description={t(isHi,
              'Add your first question or upload a CSV to get started.',
              'शुरू करने के लिए अपना पहला प्रश्न जोड़ें या CSV अपलोड करें।'
            )}
            action={
              <div className="flex gap-2 justify-center">
                <Button variant="primary" onClick={openCreate} style={{ minHeight: 48 }}>
                  + {t(isHi, 'Add Question', 'प्रश्न जोड़ें')}
                </Button>
                <Button variant="ghost" onClick={() => setBulkUploadOpen(true)} style={{ minHeight: 48 }}>
                  {t(isHi, 'Bulk Upload', 'बल्क अपलोड')}
                </Button>
              </div>
            }
          />
        )}
      </main>

      {/* ── Add/Edit Question Modal ── */}
      <SheetModal
        open={formModalOpen}
        onClose={() => { setFormModalOpen(false); setEditingQuestion(null); }}
        title={editingQuestion
          ? t(isHi, 'Edit Question', 'प्रश्न संपादित करें')
          : t(isHi, 'Add Question', 'प्रश्न जोड़ें')}
      >
        <QuestionForm
          isHi={isHi}
          existing={editingQuestion}
          onSave={handleSaveQuestion}
          onClose={() => { setFormModalOpen(false); setEditingQuestion(null); }}
        />
      </SheetModal>

      {/* ── Bulk Upload Modal ── */}
      <SheetModal
        open={bulkUploadOpen}
        onClose={() => setBulkUploadOpen(false)}
        title={t(isHi, 'Bulk Upload Questions', 'प्रश्न बल्क अपलोड')}
      >
        <BulkUploadForm
          isHi={isHi}
          onUpload={handleBulkUpload}
          onClose={() => setBulkUploadOpen(false)}
        />
      </SheetModal>

      {/* ── Delete Confirmation Modal ── */}
      <SheetModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t(isHi, 'Delete Question', 'प्रश्न हटाएं')}
      >
        {deleteTarget && (
          <DeleteConfirm
            isHi={isHi}
            questionText={deleteTarget.question_text}
            onConfirm={handleDelete}
            onCancel={() => setDeleteTarget(null)}
            loading={deleteLoading}
          />
        )}
      </SheetModal>

      {/* ── Success Toast ── */}
      {successMsg && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[70] px-5 py-3 rounded-2xl text-sm font-semibold text-white shadow-lg pointer-events-none animate-fade-in"
          style={{
            background: 'rgba(22,163,74,0.92)',
            backdropFilter: 'blur(8px)',
            whiteSpace: 'nowrap',
          }}
          role="status"
          aria-live="polite"
        >
          {successMsg}
        </div>
      )}

      <BottomNav />
    </div>
  );
}
