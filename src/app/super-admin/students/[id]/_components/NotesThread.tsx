'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '../../../_components/AdminShell';
import { colors, S } from '../../../_components/admin-styles';

interface Note {
  id: string;
  student_id: string;
  admin_id: string;
  admin_name: string;
  category: string;
  content: string;
  created_at: string;
}

const CATEGORIES = [
  'support-call',
  'bug-report',
  'account-issue',
  'observation',
  'escalation',
] as const;

const CATEGORY_COLORS: Record<string, { bg: string; fg: string }> = {
  'support-call': { bg: colors.accentLight, fg: colors.accent },
  'bug-report': { bg: colors.dangerLight, fg: colors.danger },
  'account-issue': { bg: colors.warningLight, fg: colors.warning },
  'observation': { bg: colors.surface, fg: colors.text2 },
  'escalation': { bg: colors.dangerLight, fg: colors.danger },
};

interface NotesThreadProps {
  studentId: string;
}

export default function NotesThread({ studentId }: NotesThreadProps) {
  const { apiFetch } = useAdmin();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<string>('observation');
  const [submitting, setSubmitting] = useState(false);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/super-admin/students/${studentId}/notes`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to fetch notes' }));
        setError(body.error || 'Failed to fetch notes');
        return;
      }
      const data = await res.json();
      setNotes(data.notes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch notes');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, studentId]);

  // Fetch on mount
  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSubmit = async () => {
    if (!newContent.trim()) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(
        `/api/super-admin/students/${studentId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: newContent.trim(),
            category: newCategory,
          }),
        }
      );
      if (res.ok) {
        setNewContent('');
        fetchNotes();
      } else {
        const body = await res.json().catch(() => ({ error: 'Failed to create note' }));
        setError(body.error || 'Failed to create note');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Notes list */}
      {loading && notes.length === 0 && (
        <div style={{ padding: 16, color: colors.text3, fontSize: 13 }}>
          Loading notes...
        </div>
      )}

      {error && (
        <div
          style={{
            padding: 12,
            color: colors.danger,
            fontSize: 13,
            background: colors.dangerLight,
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {!loading && !error && notes.length === 0 && (
        <div style={{ padding: 16, color: colors.text3, fontSize: 13 }}>
          No notes yet. Add the first note below.
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
        {notes.map((note) => {
          const catStyle = CATEGORY_COLORS[note.category] || CATEGORY_COLORS['observation'];
          return (
            <div
              key={note.id}
              style={{
                padding: 12,
                border: `1px solid ${colors.borderLight}`,
                borderRadius: 6,
                background: colors.bg,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: colors.text1,
                    }}
                  >
                    {note.admin_name}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: catStyle.bg,
                      color: catStyle.fg,
                    }}
                  >
                    {note.category}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: colors.text3 }}>
                  {new Date(note.created_at).toLocaleString()}
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: colors.text1,
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {note.content}
              </p>
            </div>
          );
        })}
      </div>

      {/* Add note form */}
      <div
        style={{
          padding: 12,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          background: colors.surface,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 8,
            alignItems: 'center',
          }}
        >
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            style={S.select}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Add a note..."
            rows={2}
            style={{
              ...S.searchInput,
              width: '100%',
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || !newContent.trim()}
            style={{
              ...S.primaryBtn,
              opacity: submitting || !newContent.trim() ? 0.5 : 1,
              alignSelf: 'flex-end',
              whiteSpace: 'nowrap',
            }}
          >
            {submitting ? 'Adding...' : 'Add Note'}
          </button>
        </div>
      </div>
    </div>
  );
}