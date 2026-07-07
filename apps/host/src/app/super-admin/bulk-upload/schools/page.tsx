'use client';

/**
 * Super-admin: Bulk-onboard schools from CSV.
 *
 * Parallel to the existing student bulk-upload wizard (`../page.tsx`) but
 * targets the school-level provisioning endpoint
 * `POST /api/super-admin/institutions/bulk-onboard`. We deliberately keep
 * the two flows separate — selecting a school then uploading students has
 * different prerequisites than provisioning many new schools at once.
 *
 * Flow: pick CSV → preview → dry-run validate → commit → outcome table.
 */

import { useState, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import StatCard from '../../_components/StatCard';
import StatusBadge from '../../_components/StatusBadge';

// Local style constants — mirrors the sibling page.tsx to keep visuals consistent.
const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: '2px solid var(--surface-3)',
  color: 'var(--text-2)',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 1,
  background: 'var(--surface-2)',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};
const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--surface-2)',
  color: 'var(--text-1)',
  fontSize: 13,
};
const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 8,
  border: '1px solid var(--surface-3)',
  background: 'var(--surface-1)',
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  background: 'var(--text-1)',
  color: 'var(--surface-1)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  letterSpacing: 0.2,
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: '1px solid var(--surface-3)',
  background: 'var(--surface-1)',
  color: 'var(--text-1)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
};

// CSV template columns must mirror the server's REQUIRED_COLUMNS + OPTIONAL_COLUMNS.
const REQUIRED_COLUMNS = ['school_name', 'principal_name', 'principal_email'] as const;
const OPTIONAL_COLUMNS = [
  'phone',
  'board',
  'city',
  'state',
  'grade_range_min',
  'grade_range_max',
  'admin_email',
] as const;
const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];

const MAX_ROWS_PER_CSV = 200;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RowOutcome {
  row_index: number;
  status: 'created' | 'skipped' | 'failed';
  school_id?: string;
  reason?: string;
  error?: string;
}

interface BulkResponse {
  total: number;
  created: number;
  skipped: number;
  failed: number;
  rows: RowOutcome[];
  dry_run: boolean;
}

function parseCSVLine(line: string): string[] {
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
}

interface ParsedCsv {
  headers: string[];
  rows: string[][];
  rowObjects: Record<string, string>[];
  missingRequired: string[];
}

function parseCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^﻿/, ''))
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], rowObjects: [], missingRequired: [...REQUIRED_COLUMNS] };
  }
  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
  const dataRows = lines.slice(1).map(parseCSVLine);
  const rowObjects = dataRows.map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim();
    });
    return obj;
  });
  const missingRequired = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  return { headers, rows: dataRows, rowObjects, missingRequired };
}

function clientValidateRow(row: Record<string, string>): string[] {
  const errors: string[] = [];
  if (!row.school_name || row.school_name.length < 2) errors.push('school_name missing');
  if (!row.principal_name || row.principal_name.length < 2) errors.push('principal_name missing');
  if (!row.principal_email || !EMAIL_REGEX.test(row.principal_email)) errors.push('principal_email invalid');
  if (row.admin_email && !EMAIL_REGEX.test(row.admin_email)) errors.push('admin_email invalid');
  if (row.grade_range_min || row.grade_range_max) {
    const min = Number(row.grade_range_min);
    const max = Number(row.grade_range_max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 6 || max > 12 || min > max) {
      errors.push('grade_range out of 6..12');
    }
  }
  return errors;
}

function BulkOnboardSchoolsContent() {
  const { apiFetch } = useAdmin();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [dryRunResult, setDryRunResult] = useState<BulkResponse | null>(null);
  const [commitResult, setCommitResult] = useState<BulkResponse | null>(null);
  const [running, setRunning] = useState<'idle' | 'dry-run' | 'committing'>('idle');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const processFile = useCallback((f: File) => {
    if (!f.name.endsWith('.csv')) {
      setError('Please upload a CSV file.');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      setError('File size must be under 5 MB.');
      return;
    }
    setError('');
    setFile(f);
    setDryRunResult(null);
    setCommitResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      setCsvText(text);
      const p = parseCsv(text);
      setParsed(p);
      if (p.missingRequired.length > 0) {
        setError(`CSV missing required columns: ${p.missingRequired.join(', ')}`);
      } else if (p.rowObjects.length === 0) {
        setError('CSV contains a header but no data rows.');
      } else if (p.rowObjects.length > MAX_ROWS_PER_CSV) {
        setError(
          `CSV has ${p.rowObjects.length} rows; max is ${MAX_ROWS_PER_CSV}. Split the file and retry.`,
        );
      }
    };
    reader.readAsText(f);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) processFile(f);
  };

  const downloadTemplate = () => {
    const header = ALL_COLUMNS.join(',');
    const example1 = [
      'Springdale Public School',
      'Anita Verma',
      'principal@springdale.example.in',
      '+91 98765 43210',
      'CBSE',
      'Pune',
      'MH',
      '6',
      '12',
      'admin@springdale.example.in',
    ].join(',');
    const example2 = [
      'Lotus Valley International',
      'Rajesh Kumar',
      'principal@lotus.example.in',
      '+91 98765 12345',
      'CBSE',
      'Gurugram',
      'HR',
      '6',
      '10',
      '',
    ].join(',');
    const csv = `${header}\n${example1}\n${example2}\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'school-bulk-onboard-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const runBulkRequest = async (dryRun: boolean): Promise<BulkResponse | null> => {
    if (!csvText || !parsed || parsed.missingRequired.length > 0) return null;
    try {
      const res = await apiFetch('/api/super-admin/institutions/bulk-onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: csvText,
          dry_run: dryRun,
          csv_filename: file?.name ?? 'inline.csv',
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error || `Request failed (status ${res.status}).`);
        return null;
      }
      return body.data as BulkResponse;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
      return null;
    }
  };

  const handleDryRun = async () => {
    setError('');
    setRunning('dry-run');
    const result = await runBulkRequest(true);
    if (result) setDryRunResult(result);
    setRunning('idle');
  };

  const handleCommit = async () => {
    setError('');
    setRunning('committing');
    const result = await runBulkRequest(false);
    if (result) setCommitResult(result);
    setRunning('idle');
  };

  const downloadErrorReport = () => {
    const source = commitResult ?? dryRunResult;
    if (!source) return;
    const failedRows = source.rows.filter((r) => r.status === 'failed');
    if (failedRows.length === 0) return;
    const header = 'row_index,status,error';
    const lines = failedRows.map(
      (r) => `${r.row_index},${r.status},"${(r.error || '').replace(/"/g, '""')}"`,
    );
    const csv = `${header}\n${lines.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bulk-onboard-errors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setFile(null);
    setCsvText('');
    setParsed(null);
    setDryRunResult(null);
    setCommitResult(null);
    setError('');
    setRunning('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Compute per-row validation flags for preview banner.
  const previewValidations = parsed
    ? parsed.rowObjects.map((row) => clientValidateRow(row))
    : [];
  const invalidCount = previewValidations.filter((errs) => errs.length > 0).length;

  const canSubmit =
    parsed !== null &&
    parsed.missingRequired.length === 0 &&
    parsed.rowObjects.length > 0 &&
    parsed.rowObjects.length <= MAX_ROWS_PER_CSV &&
    running === 'idle';

  const summary = commitResult ?? dryRunResult;

  return (
    <div>
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <h1 className="text-xl font-bold text-foreground" style={{ marginBottom: 4 }}>
            Bulk Onboard Schools
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
            Provision multiple trial schools from a single CSV. Up to {MAX_ROWS_PER_CSV} rows per upload.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/super-admin/bulk-upload" style={{ ...secondaryBtnStyle, textDecoration: 'none' }}>
            Student Bulk Upload
          </a>
          <button onClick={downloadTemplate} style={secondaryBtnStyle}>
            Download Template
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            marginBottom: 16,
            background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
            border: '1px solid var(--danger)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}>{error}</span>
          <button
            onClick={() => setError('')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--danger)',
              fontWeight: 700,
            }}
          >
            x
          </button>
        </div>
      )}

      {/* Drop zone */}
      <div style={{ ...cardStyle, maxWidth: 720, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
          1. Upload CSV
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 0, marginBottom: 12 }}>
          Required columns: <code>{REQUIRED_COLUMNS.join(', ')}</code>. Optional:{' '}
          <code>{OPTIONAL_COLUMNS.join(', ')}</code>.
        </p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--info)' : 'var(--surface-3)'}`,
            borderRadius: 8,
            padding: '40px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragOver ? 'color-mix(in srgb, var(--info) 10%, transparent)' : 'var(--surface-2)',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>+</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>
            {dragOver ? 'Drop your CSV here' : 'Drag and drop CSV file here'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>or click to browse (max 5 MB)</div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileInput}
            style={{ display: 'none' }}
          />
        </div>
        {file && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
              background: 'var(--surface-2)',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--text-1)', fontWeight: 500 }}>{file.name}</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{(file.size / 1024).toFixed(1)} KB</span>
          </div>
        )}
      </div>

      {/* Preview */}
      {parsed && parsed.rowObjects.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
            2. Preview ({parsed.rowObjects.length} row{parsed.rowObjects.length !== 1 ? 's' : ''})
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <StatCard label="Total Rows" value={parsed.rowObjects.length} accentColor={'var(--info)'} />
            <StatCard
              label="Client-side OK"
              value={parsed.rowObjects.length - invalidCount}
              accentColor={'var(--success)'}
            />
            <StatCard
              label="Client-side Issues"
              value={invalidCount}
              accentColor={invalidCount > 0 ? 'var(--danger)' : 'var(--text-3)'}
            />
          </div>
          <div
            style={{
              overflowX: 'auto',
              border: '1px solid var(--surface-3)',
              borderRadius: 8,
              marginBottom: 12,
            }}
          >
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 50 }}>#</th>
                  {parsed.headers.map((h, idx) => (
                    <th key={idx} style={thStyle}>
                      {h}
                    </th>
                  ))}
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rowObjects.slice(0, 10).map((row, rowIdx) => {
                  const errs = previewValidations[rowIdx];
                  const isValid = errs.length === 0;
                  return (
                    <tr
                      key={rowIdx}
                      style={{ background: isValid ? undefined : 'color-mix(in srgb, var(--danger) 4%, transparent)' }}
                    >
                      <td style={{ ...tdStyle, fontWeight: 600, color: 'var(--text-3)' }}>{rowIdx + 1}</td>
                      {parsed.headers.map((h, cellIdx) => (
                        <td key={cellIdx} style={tdStyle}>
                          {row[h] || <span style={{ color: 'var(--text-3)' }}>--</span>}
                        </td>
                      ))}
                      <td style={tdStyle}>
                        <StatusBadge
                          label={isValid ? 'Valid' : errs.join('; ')}
                          variant={isValid ? 'success' : 'danger'}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {parsed.rowObjects.length > 10 && (
              <div
                style={{
                  padding: '8px 14px',
                  fontSize: 12,
                  color: 'var(--text-3)',
                  background: 'var(--surface-2)',
                  textAlign: 'center',
                }}
              >
                Showing first 10 of {parsed.rowObjects.length} rows
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {parsed && parsed.rowObjects.length > 0 && parsed.missingRequired.length === 0 && (
        <div style={{ ...cardStyle, marginBottom: 16, maxWidth: 720 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 4 }}>
            3. Validate, then commit
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 0, marginBottom: 12 }}>
            Dry-run never writes to the database and NEVER sends invite emails. Use it first to confirm
            outcomes. Commit fires invite emails to each new principal.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handleDryRun}
              disabled={!canSubmit}
              style={{
                ...secondaryBtnStyle,
                opacity: canSubmit ? 1 : 0.5,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {running === 'dry-run' ? 'Validating...' : 'Validate (dry run)'}
            </button>
            <button
              onClick={handleCommit}
              disabled={!canSubmit}
              style={{
                ...primaryBtnStyle,
                opacity: canSubmit ? 1 : 0.5,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {running === 'committing' ? 'Onboarding...' : `Commit (create ${parsed.rowObjects.length} schools)`}
            </button>
            <button onClick={reset} style={secondaryBtnStyle}>
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Outcomes */}
      {summary && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12 }}>
            {summary.dry_run ? 'Dry-run outcome (no rows created)' : 'Onboarding complete'}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <StatCard label="Total" value={summary.total} accentColor={'var(--info)'} />
            <StatCard
              label={summary.dry_run ? 'Would create' : 'Created'}
              value={summary.created}
              accentColor={'var(--success)'}
            />
            <StatCard
              label="Skipped"
              value={summary.skipped}
              accentColor={summary.skipped > 0 ? 'var(--warning)' : 'var(--text-3)'}
            />
            <StatCard
              label="Failed"
              value={summary.failed}
              accentColor={summary.failed > 0 ? 'var(--danger)' : 'var(--text-3)'}
            />
          </div>

          {summary.failed > 0 && (
            <div style={{ marginBottom: 12 }}>
              <button
                onClick={downloadErrorReport}
                style={{ ...secondaryBtnStyle, color: 'var(--danger)', borderColor: 'var(--danger)' }}
              >
                Download Error Report ({summary.failed})
              </button>
            </div>
          )}

          <div
            style={{
              overflowX: 'auto',
              border: '1px solid var(--surface-3)',
              borderRadius: 8,
            }}
          >
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Row</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>School ID / Reason</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.slice(0, 50).map((r) => (
                  <tr key={r.row_index}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{r.row_index}</td>
                    <td style={tdStyle}>
                      <StatusBadge
                        label={r.status}
                        variant={
                          r.status === 'created'
                            ? 'success'
                            : r.status === 'skipped'
                              ? 'warning'
                              : 'danger'
                        }
                      />
                    </td>
                    <td style={tdStyle}>
                      {r.school_id ? (
                        <code style={{ fontSize: 11 }}>{r.school_id}</code>
                      ) : r.reason ? (
                        <span style={{ color: 'var(--text-3)' }}>{r.reason}</span>
                      ) : r.error ? (
                        <span style={{ color: 'var(--danger)' }}>{r.error}</span>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary.rows.length > 50 && (
              <div
                style={{
                  padding: '8px 14px',
                  fontSize: 12,
                  color: 'var(--text-3)',
                  background: 'var(--surface-2)',
                  textAlign: 'center',
                }}
              >
                Showing first 50 of {summary.rows.length} rows. Download the error report for the
                full list.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function BulkOnboardSchoolsPage() {
  return (
    <AdminShell>
      <BulkOnboardSchoolsContent />
    </AdminShell>
  );
}
