-- supabase/seed.sql
BEGIN;

-- Ensure canonical subjects exist with Hindi names and subject_kind
INSERT INTO subjects (code, name, name_hi, icon, color, subject_kind, is_active, display_order) VALUES
  ('math',              'Math',              'गणित',            '🧮', '#F97316', 'cbse_core',         true, 10),
  ('science',           'Science',           'विज्ञान',          '🔬', '#10B981', 'cbse_core',         true, 20),
  ('english',           'English',           'अंग्रेज़ी',         '📘', '#3B82F6', 'cbse_core',         true, 30),
  ('hindi',             'Hindi',             'हिंदी',            '📕', '#EF4444', 'cbse_core',         true, 40),
  ('social_studies',    'Social Studies',    'सामाजिक विज्ञान',  '🌏', '#8B5CF6', 'cbse_core',         true, 50),
  ('physics',           'Physics',           'भौतिक विज्ञान',    '⚛️', '#0EA5E9', 'cbse_core',         true, 110),
  ('chemistry',         'Chemistry',         'रसायन विज्ञान',    '⚗️', '#14B8A6', 'cbse_core',         true, 120),
  ('biology',           'Biology',           'जीव विज्ञान',      '🧬', '#22C55E', 'cbse_core',         true, 130),
  ('economics',         'Economics',         'अर्थशास्त्र',      '💹', '#F59E0B', 'cbse_core',         true, 210),
  ('accountancy',       'Accountancy',       'लेखा-शास्त्र',     '📊', '#DC2626', 'cbse_core',         true, 220),
  ('business_studies',  'Business Studies',  'व्यवसाय अध्ययन',   '💼', '#1D4ED8', 'cbse_core',         true, 230),
  ('history_sr',        'History',           'इतिहास',           '🏛️', '#B45309', 'cbse_core',         true, 310),
  ('geography',         'Geography',         'भूगोल',            '🗺️', '#059669', 'cbse_core',         true, 320),
  ('political_science', 'Political Science', 'राजनीति विज्ञान',  '⚖️', '#6D28D9', 'cbse_core',         true, 330),
  ('computer_science',  'Computer Science',  'कंप्यूटर विज्ञान',  '💻', '#7C3AED', 'cbse_elective',     true, 410),
  ('sanskrit',          'Sanskrit',          'संस्कृत',          '🪔', '#A16207', 'cbse_elective',     true, 420),
  ('coding',            'Coding',            'कोडिंग',          '👨‍💻', '#E11D48', 'platform_elective', true, 510)
ON CONFLICT (code) DO UPDATE SET
  name_hi      = EXCLUDED.name_hi,
  subject_kind = EXCLUDED.subject_kind;

COMMIT;
