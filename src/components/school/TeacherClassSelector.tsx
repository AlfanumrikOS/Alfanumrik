'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

function t(isHi: boolean, en: string, hi: string): string { return isHi ? hi : en; }

interface ClassOption {
  id: string;
  name: string;
  grade: string;
  section: string;
  subject: string | null;
}

interface Props {
  onClassChange: (classId: string | null) => void;
}

/**
 * Class selector dropdown for B2B school teachers.
 * Allows filtering dashboard/views by assigned class section.
 * Returns null for B2C teachers (no classes).
 */
export default function TeacherClassSelector({ onClassChange }: Props) {
  const { authUserId, isHi } = useAuth();
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authUserId) return;
    (async () => {
      const { data: teacher } = await supabase
        .from('teachers')
        .select('id, school_id')
        .eq('auth_user_id', authUserId)
        .single();

      if (!teacher?.school_id) { setLoading(false); return; }

      const { data } = await supabase
        .from('classes')
        .select('id, name, grade, section, subject')
        .eq('school_id', teacher.school_id)
        .eq('is_active', true)
        .order('grade')
        .order('section');

      setClasses(data || []);
      setLoading(false);
    })();
  }, [authUserId]);

  if (loading || classes.length === 0) return null;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value || null;
    setSelected(val);
    onClassChange(val);
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, color: '#666', marginBottom: 4, display: 'block' }}>
        {t(isHi, 'Select Class', 'कक्षा चुनें')}
      </label>
      <select
        value={selected || ''}
        onChange={handleChange}
        style={{
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          fontSize: 13,
          minWidth: 200,
          background: '#fff',
        }}
      >
        <option value="">{t(isHi, 'All Classes', 'सभी कक्षाएँ')}</option>
        {classes.map(c => (
          <option key={c.id} value={c.id}>
            {c.grade}-{c.section}{c.subject ? ` (${c.subject})` : ''} — {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}