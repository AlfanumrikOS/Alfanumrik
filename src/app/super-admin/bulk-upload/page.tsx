'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';
import DataTable, { Column } from '../_components/DataTable';
import { colors, S } from '../_components/admin-styles';

interface SchoolOption {
  id: string;
  name: string;
  board: string;
  city?: string;
}

interface UploadError {
  row: number;
  field: string;
  message: string;
  value?: string;
}

interface UploadResult {
  success_count: number;
  error_count: number;
  total: number;
  errors: UploadError[];
  job_id?: string;
}

interface UploadJob {
  id: string;
  school_name: string;
  file_name: string;
  total: number;
  success_count: number;
  error_count: number;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

type Step = 'select' | 'upload' | 'preview' | 'processing' | 'results';

const VALID_GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRow(row: string[], headers: string[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const nameIdx = headers.findIndex(h => h.toLowerCase().includes('name'));
  const emailIdx = headers.findIndex(h => h.toLowerCase().includes('email'));
  const gradeIdx = headers.findIndex(h => h.toLowerCase().includes('grade'));

  if (nameIdx >= 0 && (!row[nameIdx] || row[nameIdx].trim().length < 2)) {
    errors.push('Name must be at least 2 characters');
  }
  if (emailIdx >= 0 && row[emailIdx] && !EMAIL_REGEX.test(row[emailIdx].trim())) {
    errors.push('Invalid email format');
  }
  if (gradeIdx >= 0) {
    const grade = row[gradeIdx]?.trim();
    if (grade && !VALID_GRADES.includes(grade)) {
      errors.push(`Grade must be one of: ${VALID_GRADES.join(', ')}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  return lines.map(line => {
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

function BulkUploadContent() {
  const { apiFetch } = useAdmin();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('select');
  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
  const [selectedSchoolName, setSelectedSchoolName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [validationResults, setValidationResults] = useState<{ valid: boolean; errors: string[] }[]>([]);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState('');

  const fetchSchools = useCallback(async () => {
    setLoadingSchools(true);
    try {
      const res = await apiFetch('/api/super-admin/institutions?limit=200');
      if (res.ok) {
        const d = await res.json();
        setSchools((d.data || []).map((s: Record<string, unknown>) => ({
          id: s.id as string,
          name: s.name as string,
          board: s.board as string,
          city: s.city as string | undefined,
        })));
      }
    } catch { /* ignore */ }
    setLoadingSchools(false);
  }, [apiFetch]);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await apiFetch('/api/super-admin/bulk-upload?action=jobs');
      if (res.ok) {
        const d = await res.json();
        setJobs(d.data || []);
      }
    } catch { /* ignore */ }
  }, [apiFetch]);

  useEffect(() => { fetchSchools(); fetchJobs(); }, [fetchSchools, fetchJobs]);

  const handleSchoolSelect = (schoolId: string) => {
    setSelectedSchool(schoolId);
    const school = schools.find(s => s.id === schoolId);
    setSelectedSchoolName(school?.name || '');
    setStep('upload');
    setError('');
  };

  const processFile = (f: File) => {
    if (!f.name.endsWith('.csv')) {
      setError('Please upload a CSV file');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('File size must be under 5 MB');
      return;
    }
    setFile(f);
    setError('');

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length < 2) {
        setError('CSV must have a header row and at least one data row');
        return;
      }
      const hdrs = rows[0];
      const dataRows = rows.slice(1);
      setHeaders(hdrs);
      setPreviewData(dataRows);

      const results = dataRows.map(row => validateRow(row, hdrs));
      setValidationResults(results);
      setStep('preview');
    };
    reader.readAsText(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  const downloadTemplate = async () => {
    try {
      const res = await apiFetch('/api/super-admin/bulk-upload?action=template');
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'student-upload-template.csv';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        // Fallback: generate template client-side
        const template = 'name,email,grade,section,parent_email,phone\nJohn Doe,john@example.com,8,A,parent@example.com,9876543210';
        const blob = new Blob([template], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'student-upload-template.csv';
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // Fallback template
      const template = 'name,email,grade,section,parent_email,phone\nJohn Doe,john@example.com,8,A,parent@example.com,9876543210';
      const blob = new Blob([template], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'student-upload-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleUpload = async () => {
    if (!file || !selectedSchool) return;
    setStep('processing');
    setUploading(true);
    setUploadProgress(0);

    // Simulate progress while waiting
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => Math.min(prev + 5, 90));
    }, 300);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('school_id', selectedSchool);

      const res = await fetch('/api/super-admin/bulk-upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${(await apiFetch('/api/super-admin/stats')).headers.get('x-token') || ''}`,
        },
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (res.ok) {
        const result = await res.json();
        setUploadResult(result);
        setStep('results');
      } else {
        const errData = await res.json().catch(() => ({ error: 'Upload failed' }));
        setError(errData.error || 'Upload failed');
        setStep('preview');
      }
    } catch {
      clearInterval(progressInterval);
      setError('Upload request failed. Please try again.');
      setStep('preview');
    }
    setUploading(false);
    fetchJobs();
  };

  const downloadErrorReport = () => {
    if (!uploadResult?.errors.length) return;
    const header = 'Row,Field,Message,Value';
    const rows = uploadResult.errors.map(e =>
      `${e.row},"${e.field}","${e.message}","${e.value || ''}"`
    );
    const csv = header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulk-upload-errors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetWizard = () => {
    setStep('select');
    setSelectedSchool(null);
    setSelectedSchoolName('');
    setFile(null);
    setPreviewData([]);
    setHeaders([]);
    setValidationResults([]);
    setUploadResult(null);
    setUploadProgress(0);
    setError('');
  };

  const validCount = validationResults.filter(v => v.valid).length;
  const invalidCount = validationResults.filter(v => !v.valid).length;

  const stepLabels: { key: Step; label: string; number: number }[] = [
    { key: 'select', label: 'Select School', number: 1 },
    { key: 'upload', label: 'Upload CSV', number: 2 },
    { key: 'preview', label: 'Preview', number: 3 },
    { key: 'processing', label: 'Processing', number: 4 },
    { key: 'results', label: 'Results', number: 5 },
  ];

  const stepOrder: Step[] = ['select', 'upload', 'preview', 'processing', 'results'];
  const currentStepIdx = stepOrder.indexOf(step);

  const jobColumns: Column<UploadJob>[] = [
    { key: 'school_name', label: 'School', render: r => <strong style={{ color: colors.text1 }}>{r.school_name || '—'}</strong> },
    { key: 'file_name', label: 'File' },
    { key: 'total', label: 'Total', render: r => <span style={{ fontWeight: 600 }}>{r.total}</span> },
    { key: 'success_count', label: 'Success', render: r => <span style={{ fontWeight: 600, color: colors.success }}>{r.success_count}</span> },
    { key: 'error_count', label: 'Errors', render: r => <span style={{ fontWeight: 600, color: r.error_count > 0 ? colors.danger : colors.text3 }}>{r.error_count}</span> },
    { key: 'status', label: 'Status', render: r => (
      <StatusBadge
        label={r.status}
        variant={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}
      />
    )},
    { key: 'created_at', label: 'Date', render: r => (
      <span style={{ fontSize: 12, color: colors.text3 }}>{new Date(r.created_at).toLocaleDateString()}</span>
    )},
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={S.h1}>Bulk Student Upload</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>Import students from CSV files for onboarded schools</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowHistory(!showHistory)} style={S.secondaryBtn}>
            {showHistory ? 'Back to Upload' : 'Upload History'}
          </button>
          <button onClick={downloadTemplate} style={S.secondaryBtn}>
            Download Template
          </button>
        </div>
      </div>

      {/* Upload History View */}
      {showHistory && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
            <StatCard label="Total Uploads" value={jobs.length} icon="^" accentColor={colors.accent} />
            <StatCard label="Completed" value={jobs.filter(j => j.status === 'completed').length} icon="*" accentColor={colors.success} />
            <StatCard label="Total Students" value={jobs.reduce((s, j) => s + (j.success_count || 0), 0)} icon="+" accentColor={colors.warning} />
            <StatCard label="Total Errors" value={jobs.reduce((s, j) => s + (j.error_count || 0), 0)} icon="!" accentColor={colors.danger} />
          </div>
          <DataTable columns={jobColumns} data={jobs} keyField="id" emptyMessage="No upload history" />
          return;
        </div>
      )}

      {/* Wizard - only when not showing history */}
      {!showHistory && (
        <>
          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 24 }}>
            {stepLabels.map((s, i) => {
              const isActive = currentStepIdx === i;
              const isComplete = currentStepIdx > i;
              return (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', flex: i < stepLabels.length - 1 ? 1 : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700,
                      background: isComplete ? colors.success : isActive ? colors.text1 : colors.surface,
                      color: isComplete || isActive ? '#fff' : colors.text3,
                      border: `2px solid ${isComplete ? colors.success : isActive ? colors.text1 : colors.border}`,
                    }}>
                      {isComplete ? '\u2713' : s.number}
                    </div>
                    <span style={{
                      fontSize: 12, fontWeight: isActive ? 700 : 400,
                      color: isActive ? colors.text1 : isComplete ? colors.success : colors.text3,
                      whiteSpace: 'nowrap',
                    }}>{s.label}</span>
                  </div>
                  {i < stepLabels.length - 1 && (
                    <div style={{
                      flex: 1, height: 2, marginLeft: 12, marginRight: 12,
                      background: isComplete ? colors.success : colors.border,
                    }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Error banner */}
          {error && (
            <div style={{
              padding: '10px 16px', borderRadius: 8, marginBottom: 16,
              background: colors.dangerLight, border: `1px solid ${colors.danger}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 13, color: colors.danger, fontWeight: 500 }}>{error}</span>
              <button onClick={() => setError('')} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 16, color: colors.danger, fontWeight: 700,
              }}>x</button>
            </div>
          )}

          {/* Step 1: Select School */}
          {step === 'select' && (
            <div style={{ ...S.card, maxWidth: 600 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 4 }}>Step 1: Select School</div>
              <p style={{ fontSize: 12, color: colors.text3, marginBottom: 16, marginTop: 0 }}>
                Choose the institution to upload students for.
              </p>
              {loadingSchools ? (
                <div style={{ color: colors.text3, fontSize: 13 }}>Loading schools...</div>
              ) : schools.length === 0 ? (
                <div style={{ color: colors.text3, fontSize: 13 }}>
                  No schools onboarded yet. <a href="/super-admin/institutions" style={{ color: colors.accent }}>Add one first</a>.
                </div>
              ) : (
                <div>
                  <select
                    value={selectedSchool || ''}
                    onChange={(e) => { if (e.target.value) handleSchoolSelect(e.target.value); }}
                    style={{ ...S.select, width: '100%', padding: '10px 12px', fontSize: 14 }}
                  >
                    <option value="">-- Select a school --</option>
                    {schools.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.board}{s.city ? `, ${s.city}` : ''})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Upload CSV */}
          {step === 'upload' && (
            <div style={{ maxWidth: 600 }}>
              <div style={{ ...S.card, marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 4 }}>Step 2: Upload CSV</div>
                <p style={{ fontSize: 12, color: colors.text3, marginBottom: 16, marginTop: 0 }}>
                  Uploading for: <strong style={{ color: colors.text1 }}>{selectedSchoolName}</strong>
                </p>

                {/* Drop zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? colors.accent : colors.border}`,
                    borderRadius: 8,
                    padding: '40px 20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: dragOver ? colors.accentLight : colors.surface,
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>+</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.text1, marginBottom: 4 }}>
                    {dragOver ? 'Drop your CSV here' : 'Drag and drop CSV file here'}
                  </div>
                  <div style={{ fontSize: 12, color: colors.text3 }}>
                    or click to browse (max 5 MB)
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileInput}
                    style={{ display: 'none' }}
                  />
                </div>

                {file && (
                  <div style={{ marginTop: 12, padding: '8px 12px', background: colors.surface, borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: colors.text1, fontWeight: 500 }}>{file.name}</span>
                    <span style={{ fontSize: 11, color: colors.text3 }}>{(file.size / 1024).toFixed(1)} KB</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setStep('select'); setFile(null); }} style={S.secondaryBtn}>Back</button>
              </div>
            </div>
          )}

          {/* Step 3: Preview */}
          {step === 'preview' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 4 }}>Step 3: Preview Data</div>
                  <div style={{ fontSize: 12, color: colors.text3 }}>
                    {previewData.length} rows found. School: <strong style={{ color: colors.text1 }}>{selectedSchoolName}</strong>
                  </div>
                </div>
              </div>

              {/* Validation summary */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
                <StatCard label="Total Rows" value={previewData.length} accentColor={colors.accent} />
                <StatCard label="Valid" value={validCount} accentColor={colors.success} />
                <StatCard label="Invalid" value={invalidCount} accentColor={invalidCount > 0 ? colors.danger : colors.text3} />
              </div>

              {/* Preview table */}
              <div style={{ overflowX: 'auto', border: `1px solid ${colors.border}`, borderRadius: 8, marginBottom: 16 }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={{ ...S.th, width: 50 }}>#</th>
                      {headers.map((h, i) => (
                        <th key={i} style={S.th}>{h}</th>
                      ))}
                      <th style={S.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.slice(0, 10).map((row, rowIdx) => {
                      const validation = validationResults[rowIdx];
                      const isValid = validation?.valid !== false;
                      return (
                        <tr key={rowIdx} style={{ background: isValid ? undefined : 'rgba(220,38,38,0.04)' }}>
                          <td style={{ ...S.td, fontWeight: 600, color: colors.text3 }}>{rowIdx + 1}</td>
                          {row.map((cell, cellIdx) => {
                            const isGradeCol = headers[cellIdx]?.toLowerCase().includes('grade');
                            const isEmailCol = headers[cellIdx]?.toLowerCase().includes('email');
                            let cellColor: string = colors.text1;
                            if (isGradeCol && cell && !VALID_GRADES.includes(cell.trim())) cellColor = colors.danger;
                            if (isEmailCol && cell && !EMAIL_REGEX.test(cell.trim())) cellColor = colors.danger;
                            return (
                              <td key={cellIdx} style={{ ...S.td, color: cellColor }}>
                                {cell || <span style={{ color: colors.text3 }}>--</span>}
                              </td>
                            );
                          })}
                          <td style={S.td}>
                            <StatusBadge
                              label={isValid ? 'Valid' : 'Error'}
                              variant={isValid ? 'success' : 'danger'}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {previewData.length > 10 && (
                  <div style={{ padding: '8px 14px', fontSize: 12, color: colors.text3, background: colors.surface, textAlign: 'center' }}>
                    Showing first 10 of {previewData.length} rows
                  </div>
                )}
              </div>

              {/* Validation errors detail */}
              {invalidCount > 0 && (
                <div style={{ ...S.card, padding: 12, marginBottom: 16, borderLeft: `3px solid ${colors.danger}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: colors.danger, marginBottom: 8 }}>Validation Issues</div>
                  {validationResults.slice(0, 10).map((v, i) => {
                    if (v.valid) return null;
                    return (
                      <div key={i} style={{ padding: '4px 0', borderBottom: `1px solid ${colors.borderLight}`, fontSize: 12 }}>
                        <span style={{ fontWeight: 600, color: colors.text1 }}>Row {i + 1}:</span>{' '}
                        <span style={{ color: colors.danger }}>{v.errors.join('; ')}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setStep('upload'); setPreviewData([]); setFile(null); }} style={S.secondaryBtn}>Back</button>
                <button
                  onClick={handleUpload}
                  disabled={previewData.length === 0}
                  style={{
                    ...S.primaryBtn,
                    opacity: previewData.length === 0 ? 0.5 : 1,
                    cursor: previewData.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  Upload {validCount} Valid Student{validCount !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Processing */}
          {step === 'processing' && (
            <div style={{ ...S.card, maxWidth: 500, textAlign: 'center', padding: '40px 24px' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 16 }}>Processing Upload...</div>
              <div style={{
                height: 8, background: colors.surface, borderRadius: 4, overflow: 'hidden', marginBottom: 12,
              }}>
                <div style={{
                  width: `${uploadProgress}%`, height: '100%',
                  background: colors.accent, borderRadius: 4,
                  transition: 'width 0.3s',
                }} />
              </div>
              <div style={{ fontSize: 12, color: colors.text3 }}>{uploadProgress}% complete</div>
              <div style={{ fontSize: 11, color: colors.text3, marginTop: 8 }}>
                Uploading {previewData.length} students to {selectedSchoolName}
              </div>
            </div>
          )}

          {/* Step 5: Results */}
          {step === 'results' && uploadResult && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: colors.text1, marginBottom: 16 }}>Upload Complete</div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
                <StatCard label="Total Processed" value={uploadResult.total} accentColor={colors.accent} />
                <StatCard label="Successful" value={uploadResult.success_count} accentColor={colors.success} />
                <StatCard label="Errors" value={uploadResult.error_count} accentColor={uploadResult.error_count > 0 ? colors.danger : colors.text3} />
              </div>

              {/* Success message */}
              {uploadResult.success_count > 0 && (
                <div style={{
                  padding: '12px 16px', borderRadius: 8, marginBottom: 16,
                  background: colors.successLight, border: `1px solid ${colors.success}`,
                }}>
                  <span style={{ fontSize: 13, color: colors.success, fontWeight: 600 }}>
                    {uploadResult.success_count} student{uploadResult.success_count !== 1 ? 's' : ''} imported successfully to {selectedSchoolName}
                  </span>
                </div>
              )}

              {/* Error table */}
              {uploadResult.errors.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: colors.danger }}>
                      {uploadResult.error_count} Error{uploadResult.error_count !== 1 ? 's' : ''}
                    </div>
                    <button onClick={downloadErrorReport} style={{ ...S.dlBtn, color: colors.danger, borderColor: colors.danger }}>
                      Download Error Report
                    </button>
                  </div>
                  <div style={{ overflowX: 'auto', border: `1px solid ${colors.border}`, borderRadius: 8 }}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          <th style={S.th}>Row</th>
                          <th style={S.th}>Field</th>
                          <th style={S.th}>Message</th>
                          <th style={S.th}>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadResult.errors.slice(0, 20).map((err, i) => (
                          <tr key={i}>
                            <td style={{ ...S.td, fontWeight: 600 }}>{err.row}</td>
                            <td style={S.td}><code style={{ fontSize: 11, background: colors.surface, padding: '1px 4px', borderRadius: 2 }}>{err.field}</code></td>
                            <td style={{ ...S.td, color: colors.danger }}>{err.message}</td>
                            <td style={{ ...S.td, color: colors.text3 }}>{err.value || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {uploadResult.errors.length > 20 && (
                      <div style={{ padding: '8px 14px', fontSize: 12, color: colors.text3, background: colors.surface, textAlign: 'center' }}>
                        Showing first 20 of {uploadResult.errors.length} errors. Download the full report for all errors.
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={resetWizard} style={S.primaryBtn}>Upload Another File</button>
                <a href="/super-admin/users" style={{ ...S.secondaryBtn, textDecoration: 'none', display: 'inline-block' }}>View Students</a>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function BulkUploadPage() {
  return (
    <AdminShell>
      <BulkUploadContent />
    </AdminShell>
  );
}
