-- supabase/migrations/20260415000004_subject_governance_seed.sql
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

-- grade_subject_map (see spec §4.2 seed content)
INSERT INTO grade_subject_map (grade, subject_code, stream, is_core) VALUES
  -- Grades 6-8 core
  ('6','math',NULL,true),('6','science',NULL,true),('6','english',NULL,true),
  ('6','hindi',NULL,true),('6','social_studies',NULL,true),('6','sanskrit',NULL,false),
  ('7','math',NULL,true),('7','science',NULL,true),('7','english',NULL,true),
  ('7','hindi',NULL,true),('7','social_studies',NULL,true),('7','sanskrit',NULL,false),
  ('8','math',NULL,true),('8','science',NULL,true),('8','english',NULL,true),
  ('8','hindi',NULL,true),('8','social_studies',NULL,true),('8','sanskrit',NULL,false),
  -- Grades 9-10 adds CS elective
  ('9','math',NULL,true),('9','science',NULL,true),('9','english',NULL,true),
  ('9','hindi',NULL,true),('9','social_studies',NULL,true),('9','sanskrit',NULL,false),
  ('9','computer_science',NULL,false),
  ('10','math',NULL,true),('10','science',NULL,true),('10','english',NULL,true),
  ('10','hindi',NULL,true),('10','social_studies',NULL,true),('10','sanskrit',NULL,false),
  ('10','computer_science',NULL,false),
  -- Grade 11 science
  ('11','math','science',true),('11','physics','science',true),('11','chemistry','science',true),
  ('11','biology','science',false),('11','english','science',true),
  ('11','computer_science','science',false),('11','hindi','science',false),
  ('11','sanskrit','science',false),
  -- Grade 11 commerce
  ('11','math','commerce',false),('11','accountancy','commerce',true),
  ('11','business_studies','commerce',true),('11','economics','commerce',true),
  ('11','english','commerce',true),('11','computer_science','commerce',false),
  ('11','hindi','commerce',false),
  -- Grade 11 humanities
  ('11','history_sr','humanities',true),('11','geography','humanities',true),
  ('11','political_science','humanities',true),('11','economics','humanities',true),
  ('11','english','humanities',true),('11','hindi','humanities',false),
  ('11','sanskrit','humanities',false),
  -- Grade 12 mirrors Grade 11
  ('12','math','science',true),('12','physics','science',true),('12','chemistry','science',true),
  ('12','biology','science',false),('12','english','science',true),
  ('12','computer_science','science',false),('12','hindi','science',false),
  ('12','sanskrit','science',false),
  ('12','math','commerce',false),('12','accountancy','commerce',true),
  ('12','business_studies','commerce',true),('12','economics','commerce',true),
  ('12','english','commerce',true),('12','computer_science','commerce',false),
  ('12','hindi','commerce',false),
  ('12','history_sr','humanities',true),('12','geography','humanities',true),
  ('12','political_science','humanities',true),('12','economics','humanities',true),
  ('12','english','humanities',true),('12','hindi','humanities',false),
  ('12','sanskrit','humanities',false)
ON CONFLICT DO NOTHING;

-- plan_subject_access
INSERT INTO plan_subject_access (plan_code, subject_code) VALUES
  -- free: 5 universal cores; max_subjects=2 caps selection
  ('free','math'),('free','science'),('free','english'),('free','hindi'),('free','social_studies'),
  -- starter: free + extras (still max_subjects=4)
  ('starter','math'),('starter','science'),('starter','english'),('starter','hindi'),
  ('starter','social_studies'),('starter','sanskrit'),('starter','computer_science'),
  ('starter','history_sr'),('starter','geography'),('starter','political_science'),
  -- pro: all CBSE subjects (no coding)
  ('pro','math'),('pro','science'),('pro','english'),('pro','hindi'),('pro','social_studies'),
  ('pro','sanskrit'),('pro','computer_science'),('pro','physics'),('pro','chemistry'),
  ('pro','biology'),('pro','economics'),('pro','accountancy'),('pro','business_studies'),
  ('pro','history_sr'),('pro','geography'),('pro','political_science'),
  -- unlimited: everything incl. coding
  ('unlimited','math'),('unlimited','science'),('unlimited','english'),('unlimited','hindi'),
  ('unlimited','social_studies'),('unlimited','sanskrit'),('unlimited','computer_science'),
  ('unlimited','physics'),('unlimited','chemistry'),('unlimited','biology'),
  ('unlimited','economics'),('unlimited','accountancy'),('unlimited','business_studies'),
  ('unlimited','history_sr'),('unlimited','geography'),('unlimited','political_science'),
  ('unlimited','coding')
ON CONFLICT DO NOTHING;

-- max_subjects on subscription_plans
UPDATE subscription_plans SET max_subjects = 2    WHERE plan_code = 'free';
UPDATE subscription_plans SET max_subjects = 4    WHERE plan_code = 'starter';
UPDATE subscription_plans SET max_subjects = NULL WHERE plan_code IN ('pro','unlimited');

COMMIT;