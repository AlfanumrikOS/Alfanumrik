'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  Input,
  Select,
  Badge,
  ProgressBar,
  Skeleton,
  EmptyState,
  BottomNav,
} from '@/components/ui';

/* ─────────────────────────────────────────────────────────────
   BILINGUAL HELPER (P7)
───────────────────────────────────────────────────────────── */
function t(isHi: boolean, en: string, hi: string): string {
  return isHi ? hi : en;
}

/* ─────────────────────────────────────────────────────────────
   TYPES
───────────────────────────────────────────────────────────── */
interface StudentRow {
  name: string;
  email: string;
  /** Always a string "6"–"12" per P5 */
  grade: string;
  section: string;
  parent_email: string;
}

interface RowValidation {
  valid: boolean;
  errors: string[];
}

interface ImportResult {
  total: number;
  success_count: number;
  error_count: number;
  errors: Array<{ row: number; field: string; message: string }>;
}

type Step = 'upload' | 'preview' | 'importing' | 'results';

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ─────────────────────────────────────────────────────────────
   CSV PARSER (same as super-admin bulk-upload)
───────────────────────────────────────────────────────────── */
function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line) => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  });
}

function validateRow(row: string[], headers: string[]): RowValidation {
  const errors: string[] = [];
  const nameIdx = headers.findIndex((h) => h.toLowerCase().includes('name') && !h.toLowerCase().includes('parent'));
  const emailIdx = headers.findIndex((h) => h.toLowerCase().includes('email') && !h.toLowerCase().includes('parent'));
  const gradeIdx = headers.findIndex((h) => h.toLowerCase().includes('grade'));

  if (nameIdx >= 0 && (!row[nameIdx] || row[nameIdx].trim().length < 2)) {
    errors.push('Name must be at least 2 characters');
  }
  if (emailIdx >= 0 && (!row[emailIdx] || !EMAIL_REGEX.test(row[emailIdx].trim()))) {
    errors.push('Invalid email format');
  }
  if (gradeIdx >= 0) {
    const grade = row[gradeIdx]?.trim();
    if (!grade || !VALID_GRADES.includes(grade)) {
      errors.push(`Grade must be one of: ${VALID_GRADES.join(', ')}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADING STATE
───────────────────────────────────────────────────────────── */
function PageSkeleton() {
  return (
    <div className="px-4 pt-4 pb-24 max-w-2xl mx-auto space-y-5">
      <Skeleton variant="title" height={28} width="55%" />
      <Skeleton variant="rect" height={160} rounded="rounded-2xl" />
      <Skeleton variant="rect" height={48} rounded="rounded-xl" />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   MAIN PAGE COMPONENT
───────────────────────────────────────────────────────────── */
export default function SchoolAdminEnrollPage() {
  const router = useRouter();
  const { authUserId, isLoading: authLoading, isHi } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── state ── */
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<string[][]>([]);
  const [validationResults, setValidationResults] = useState<RowValidation[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  /* ── auth guard ── */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* ── bootstrap ── */
  const bootstrap = useCallback(async () => {
    if (!authUserId) return;

    setLoading(true);
    setError(null);

    try {
      const { data: adminRecord, error: adminErr } = await supabase
        .from('school_admins')
        .select('school_id')
        .eq('auth_user_id', authUserId)
        .eq('is_active', true)
        .maybeSingle();

      if (adminErr) throw new Error(adminErr.message);

      if (!adminRecord) {
        router.replace('/login');
        return;
      }

      setSchoolId(adminRecord.school_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [authUserId, router]);

  useEffect(() => {
    if (!authLoading && authUserId) {
      bootstrap();
    }
  }, [authLoading, authUserId, bootstrap]);

  /* ── CSV processing ── */
  function processFile(file: File) {
    if (!file.name.endsWith('.csv')) {
      setError(t(isHi, 'Please upload a CSV file', 'कृपया एक CSV फ़ाइल अपलोड करें'));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t(isHi, 'File size must be under 5 MB', 'फ़ाइल का आकार 5 MB से कम होना चाहिए'));
      return;
    }

    setError(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCSV(text);

      if (rows.length < 2) {
        setError(t(isHi, 'CSV must have a header row and at least one data row', 'CSV में हेडर पंक्ति और कम से कम एक डेटा पंक्ति होनी चाहिए'));
        return;
      }

      const hdrs = rows[0];
      const dataRows = rows.slice(1);

      setHeaders(hdrs);
      setPreviewData(dataRows);
      setValidationResults(dataRows.map((row) => validateRow(row, hdrs)));
      setStep('preview');
    };
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  }

  /* ── Import ── */
  async function handleImport() {
    if (!schoolId || previewData.length === 0) return;

    setImporting(true);
    setStep('importing');
    setError(null);

    try {
      // Map headers to field positions
      const nameIdx = headers.findIndex((h) => h.toLowerCase().includes('name') && !h.toLowerCase().includes('parent'));
      const emailIdx = headers.findIndex((h) => h.toLowerCase().includes('email') && !h.toLowerCase().includes('parent'));
      const gradeIdx = headers.findIndex((h) => h.toLowerCase().includes('grade'));
      const sectionIdx = headers.findIndex((h) => h.toLowerCase().includes('section'));
      const parentIdx = headers.findIndex((h) => h.toLowerCase().includes('parent'));

      const students = previewData
        .filter((_, idx) => validationResults[idx]?.valid !== false)
        .map((row) => ({
          name: row[nameIdx]?.trim() ?? '',
          email: row[emailIdx]?.trim() ?? '',
          grade: String(row[gradeIdx]?.trim() ?? ''),
          section: sectionIdx >= 0 ? row[sectionIdx]?.trim() : undefined,
          parent_email: parentIdx >= 0 ? row[parentIdx]?.trim() : undefined,
        }));

      const res = await fetch('/api/schools/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school_id: schoolId, students }),
      });

      const result = await res.json();

      if (!result.success && !result.data) {
        setError(result.error || 'Import failed');
        setStep('preview');
        setImporting(false);
        return;
      }

      setImportResult(result.data as ImportResult);
      setStep('results');
    } catch {
      setError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।'));
      setStep('preview');
    } finally {
      setImporting(false);
    }
  }

  /* ── Reset ── */
  function handleReset() {
    setStep('upload');
    setHeaders([]);
    setPreviewData([]);
    setValidationResults([]);
    setImportResult(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /* ── Derived ── */
  const validCount = validationResults.filter((r) => r.valid).length;
  const invalidCount = validationResults.filter((r) => !r.valid).length;
  const totalRows = previewData.length;

  /* ── Render ── */
  if (authLoading || loading) {
    return (
      <div style={{ background: 'var(--bg)' }} className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
        <header
          className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
          style={{
            background: 'rgba(251,248,244,0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Skeleton variant="rect" height={36} width={36} rounded="rounded-xl" />
          <Skeleton variant="title" height={22} width="50%" />
        </header>
        <PageSkeleton />
      </div>
    );
  }

  if (error && !schoolId) {
    return (
      <div
        className="min-h-dvh flex items-center justify-center px-4 font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
        style={{ background: 'var(--bg)' }}
      >
        <Card className="max-w-xs w-full text-center py-8">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-[var(--text-2)] mb-4">{error}</p>
          <Button variant="primary" onClick={bootstrap}>
            {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div
      style={{ background: 'var(--bg)' }}
      className="min-h-dvh font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
    >
      {/* STICKY HEADER */}
      <header
        className="sticky top-0 z-10 px-4 py-3 flex items-center gap-3"
        style={{
          background: 'rgba(251,248,244,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          onClick={() => router.push('/school-admin')}
          className="rounded-xl flex items-center justify-center transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
          style={{
            width: '40px',
            height: '40px',
            minWidth: '40px',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            fontSize: '18px',
          }}
          aria-label={t(isHi, 'Back to dashboard', 'डैशबोर्ड पर वापस जाएं')}
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <h1
            className="text-base font-bold text-[var(--text-1)] truncate"
            style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
          >
            {t(isHi, 'Bulk Enrollment', 'सामूहिक नामांकन')}
          </h1>
          <p className="text-xs text-[var(--text-3)]">
            {step === 'upload' && t(isHi, 'Upload CSV', 'CSV अपलोड करें')}
            {step === 'preview' && t(isHi, 'Preview Data', 'डेटा पूर्वावलोकन')}
            {step === 'importing' && t(isHi, 'Importing...', 'आयात हो रहा है...')}
            {step === 'results' && t(isHi, 'Results', 'परिणाम')}
          </p>
        </div>
      </header>

      <main className="px-4 pt-4 pb-24 max-w-2xl mx-auto">
        {/* Error banner */}
        {error && (
          <div
            className="rounded-xl p-3 text-center mb-4"
            style={{ background: '#FEE2E2', border: '1px solid #FCA5A5' }}
          >
            <p className="text-sm text-red-700">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-xs text-red-500 font-semibold mt-1"
            >
              {t(isHi, 'Dismiss', 'बंद करें')}
            </button>
          </div>
        )}

        {/* ═══ STEP: UPLOAD ═══ */}
        {step === 'upload' && (
          <div className="space-y-4">
            {/* CSV format guide */}
            <Card accent="#7C3AED">
              <h3 className="text-sm font-bold text-[var(--text-1)] mb-2">
                {t(isHi, 'CSV Format', 'CSV प्रारूप')}
              </h3>
              <p className="text-xs text-[var(--text-3)] mb-3">
                {t(
                  isHi,
                  'Upload a CSV with the following columns:',
                  'निम्नलिखित कॉलम के साथ CSV अपलोड करें:'
                )}
              </p>
              <div
                className="rounded-lg p-3 text-xs font-mono overflow-x-auto"
                style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
              >
                name,email,grade,section,parent_email
                <br />
                Arun Kumar,arun@email.com,9,A,parent@email.com
                <br />
                Priya Singh,priya@email.com,10,B,
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge color="#16A34A">name *</Badge>
                <Badge color="#16A34A">email *</Badge>
                <Badge color="#16A34A">grade *</Badge>
                <Badge color="#7C3AED">section</Badge>
                <Badge color="#7C3AED">parent_email</Badge>
              </div>
              <p className="text-xs text-[var(--text-3)] mt-2">
                * = {t(isHi, 'required', 'आवश्यक')}
              </p>
            </Card>

            {/* Drop zone */}
            <div
              className="rounded-2xl p-8 text-center cursor-pointer transition-all"
              style={{
                border: `2px dashed ${dragOver ? 'var(--purple)' : 'var(--border)'}`,
                background: dragOver ? 'rgba(124,58,237,0.05)' : 'var(--surface-1)',
              }}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              aria-label={t(isHi, 'Upload CSV file', 'CSV फ़ाइल अपलोड करें')}
            >
              <div className="text-4xl mb-3" aria-hidden="true">📁</div>
              <p className="text-sm font-semibold text-[var(--text-1)]">
                {t(isHi, 'Drop CSV here or click to upload', 'CSV यहां डालें या अपलोड करने के लिए क्लिक करें')}
              </p>
              <p className="text-xs text-[var(--text-3)] mt-1">
                {t(isHi, 'Maximum 200 rows, 5 MB', 'अधिकतम 200 पंक्तियां, 5 MB')}
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileInput}
              className="hidden"
              aria-hidden="true"
            />
          </div>
        )}

        {/* ═══ STEP: PREVIEW ═══ */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl py-2.5 px-3 text-center" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{totalRows}</div>
                <div className="text-xs text-[var(--text-3)] font-medium">
                  {t(isHi, 'Total', 'कुल')}
                </div>
              </div>
              <div className="rounded-xl py-2.5 px-3 text-center" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xl font-bold" style={{ color: '#16A34A' }}>{validCount}</div>
                <div className="text-xs text-[var(--text-3)] font-medium">
                  {t(isHi, 'Valid', 'मान्य')}
                </div>
              </div>
              <div className="rounded-xl py-2.5 px-3 text-center" style={{ background: 'var(--surface-2)' }}>
                <div className="text-xl font-bold" style={{ color: invalidCount > 0 ? '#DC2626' : 'var(--text-3)' }}>
                  {invalidCount}
                </div>
                <div className="text-xs text-[var(--text-3)] font-medium">
                  {t(isHi, 'Errors', 'त्रुटियां')}
                </div>
              </div>
            </div>

            {/* Preview table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--surface-2)' }}>
                    <th className="px-3 py-2 text-left font-semibold text-[var(--text-3)]">#</th>
                    {headers.map((h, i) => (
                      <th key={i} className="px-3 py-2 text-left font-semibold text-[var(--text-3)]">
                        {h}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left font-semibold text-[var(--text-3)]">
                      {t(isHi, 'Status', 'स्थिति')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.slice(0, 50).map((row, idx) => {
                    const validation = validationResults[idx];
                    return (
                      <tr
                        key={idx}
                        style={{
                          background: validation?.valid === false ? '#FEF2F2' : 'transparent',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        <td className="px-3 py-2 text-[var(--text-3)]">{idx + 1}</td>
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2 text-[var(--text-1)] max-w-[120px] truncate">
                            {cell}
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          {validation?.valid ? (
                            <Badge color="#16A34A">OK</Badge>
                          ) : (
                            <span className="text-xs text-red-500">
                              {validation?.errors[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalRows > 50 && (
              <p className="text-xs text-[var(--text-3)] text-center">
                {t(isHi, `Showing 50 of ${totalRows} rows`, `${totalRows} पंक्तियों में से 50 दिखा रहे हैं`)}
              </p>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={handleReset} className="flex-1">
                {t(isHi, 'Start Over', 'फिर से शुरू करें')}
              </Button>
              <Button
                variant="primary"
                onClick={handleImport}
                disabled={validCount === 0}
                className="flex-1"
              >
                {t(isHi, `Import ${validCount} Students`, `${validCount} छात्र आयात करें`)}
              </Button>
            </div>
          </div>
        )}

        {/* ═══ STEP: IMPORTING ═══ */}
        {step === 'importing' && (
          <div className="text-center py-12 space-y-4">
            <div className="text-5xl animate-pulse" aria-hidden="true">📤</div>
            <h2
              className="text-lg font-bold"
              style={{ fontFamily: 'Sora, system-ui, sans-serif', color: 'var(--text-1)' }}
            >
              {t(isHi, 'Importing Students...', 'छात्रों को आयात किया जा रहा है...')}
            </h2>
            <p className="text-sm text-[var(--text-3)]">
              {t(isHi, 'Please wait, this may take a moment.', 'कृपया प्रतीक्षा करें, इसमें कुछ समय लग सकता है।')}
            </p>
            <div className="max-w-xs mx-auto">
              <ProgressBar value={50} color="var(--purple)" />
            </div>
          </div>
        )}

        {/* ═══ STEP: RESULTS ═══ */}
        {step === 'results' && importResult && (
          <div className="space-y-4">
            {/* Results summary */}
            <Card
              accent={importResult.success_count > 0 ? '#16A34A' : '#DC2626'}
              className="text-center"
            >
              <div className="py-4 space-y-3">
                <div className="text-4xl" aria-hidden="true">
                  {importResult.success_count > 0 ? '🎉' : '⚠️'}
                </div>
                <h2
                  className="text-lg font-bold"
                  style={{ fontFamily: 'Sora, system-ui, sans-serif', color: 'var(--text-1)' }}
                >
                  {t(isHi, 'Import Complete', 'आयात पूरा हुआ')}
                </h2>
              </div>
            </Card>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl py-3 px-3 text-center" style={{ background: 'var(--surface-2)' }}>
                <div className="text-2xl font-bold" style={{ color: 'var(--text-1)' }}>
                  {importResult.total}
                </div>
                <div className="text-xs text-[var(--text-3)] font-medium">{t(isHi, 'Total', 'कुल')}</div>
              </div>
              <div className="rounded-xl py-3 px-3 text-center" style={{ background: '#F0FDF4' }}>
                <div className="text-2xl font-bold" style={{ color: '#16A34A' }}>
                  {importResult.success_count}
                </div>
                <div className="text-xs text-[var(--text-3)] font-medium">{t(isHi, 'Success', 'सफल')}</div>
              </div>
              <div className="rounded-xl py-3 px-3 text-center" style={{ background: importResult.error_count > 0 ? '#FEF2F2' : 'var(--surface-2)' }}>
                <div
                  className="text-2xl font-bold"
                  style={{ color: importResult.error_count > 0 ? '#DC2626' : 'var(--text-3)' }}
                >
                  {importResult.error_count}
                </div>
                <div className="text-xs text-[var(--text-3)] font-medium">{t(isHi, 'Errors', 'त्रुटियां')}</div>
              </div>
            </div>

            {/* Error details */}
            {importResult.errors.length > 0 && (
              <Card>
                <h3 className="text-sm font-bold text-[var(--text-1)] mb-2">
                  {t(isHi, 'Import Errors', 'आयात त्रुटियां')}
                </h3>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {importResult.errors.map((err, idx) => (
                    <div
                      key={idx}
                      className="flex gap-2 text-xs"
                      style={{ color: '#DC2626' }}
                    >
                      <span className="font-semibold flex-shrink-0">
                        {t(isHi, `Row ${err.row}:`, `पंक्ति ${err.row}:`)}
                      </span>
                      <span>{err.message}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button variant="ghost" onClick={handleReset} className="flex-1">
                {t(isHi, 'Import More', 'और आयात करें')}
              </Button>
              <Button
                variant="primary"
                onClick={() => router.push('/school-admin/students')}
                className="flex-1"
              >
                {t(isHi, 'View Students', 'छात्र देखें')}
              </Button>
            </div>
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}