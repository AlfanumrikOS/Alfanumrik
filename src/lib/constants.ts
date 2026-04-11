/* ─── Alfanumrik Constants ────────────────────────────────── */

export const GRADES = ['6', '7', '8', '9', '10', '11', '12'] as const;

export const BOARDS = ['CBSE', 'ICSE', 'State Board', 'IB', 'Cambridge', 'IGCSE', 'Other'] as const;

export const LANGUAGES = [
  { code: 'en', label: 'English', labelNative: 'English' },
  { code: 'hi', label: 'Hindi', labelNative: 'हिन्दी' },
  { code: 'hinglish', label: 'Hinglish', labelNative: 'Hinglish' },
  { code: 'ta', label: 'Tamil', labelNative: 'தமிழ்' },
  { code: 'te', label: 'Telugu', labelNative: 'తెలుగు' },
  { code: 'bn', label: 'Bengali', labelNative: 'বাংলা' },
] as const;

export const SUBJECT_META = [
  { code: 'math', name: 'Mathematics', icon: '∑', color: '#6C5CE7' },
  { code: 'science', name: 'Science', icon: '⚛', color: '#0891B2' },
  { code: 'physics', name: 'Physics', icon: '⚡', color: '#2563EB' },
  { code: 'chemistry', name: 'Chemistry', icon: '🧪', color: '#DC2626' },
  { code: 'biology', name: 'Biology', icon: '🧬', color: '#16A34A' },
  { code: 'english', name: 'English', icon: 'Aa', color: '#E17055' },
  { code: 'hindi', name: 'Hindi', icon: 'अ', color: '#E84393' },
  { code: 'social_studies', name: 'Social Studies', icon: '🌍', color: '#FDCB6E' },
  { code: 'computer_science', name: 'Computer Science', icon: '💻', color: '#0D9488' },
  { code: 'economics', name: 'Economics', icon: '📈', color: '#D97706' },
  { code: 'accountancy', name: 'Accountancy', icon: '📊', color: '#7C3AED' },
  { code: 'business_studies', name: 'Business Studies', icon: '🏢', color: '#0891B2' },
  { code: 'political_science', name: 'Political Science', icon: '🏛', color: '#4F46E5' },
  { code: 'history_sr', name: 'History', icon: '📜', color: '#92400E' },
  { code: 'geography', name: 'Geography', icon: '🌍', color: '#059669' },
  { code: 'coding', name: 'Coding', icon: '</>', color: '#0984E3' },
] as const;

/** Grade-specific subject availability — CBSE curriculum mapping */
export const GRADE_SUBJECTS: Record<string, string[]> = {
  '6':  ['math', 'science', 'english', 'hindi', 'social_studies', 'coding'],
  '7':  ['math', 'science', 'english', 'hindi', 'social_studies', 'coding'],
  '8':  ['math', 'science', 'english', 'hindi', 'social_studies', 'coding'],
  '9':  ['math', 'science', 'english', 'hindi', 'social_studies', 'computer_science'],
  '10': ['math', 'science', 'english', 'hindi', 'social_studies', 'computer_science'],
  '11': ['math', 'physics', 'chemistry', 'biology', 'english', 'computer_science', 'economics', 'accountancy', 'business_studies', 'political_science', 'history_sr', 'geography'],
  '12': ['math', 'physics', 'chemistry', 'biology', 'english', 'computer_science', 'economics', 'accountancy', 'business_studies', 'political_science', 'history_sr', 'geography'],
};

/** Get subjects available for a specific grade */
export function getSubjectsForGrade(grade: string): typeof SUBJECT_META[number][] {
  const g = grade.replace('Grade ', '').trim();
  const codes = GRADE_SUBJECTS[g] || GRADE_SUBJECTS['9']; // fallback to Grade 9
  return SUBJECT_META.filter(s => codes.includes(s.code));
}

export const FOXY_MODES = [
  { id: 'learn', label: 'Learn', labelHi: 'सीखो', icon: '📖', desc: 'Step-by-step lesson' },
  { id: 'doubt', label: 'Ask Doubt', labelHi: 'डाउट पूछो', icon: '❓', desc: 'Clear any confusion' },
  { id: 'quiz', label: 'Quiz Me', labelHi: 'क्विज़ लो', icon: '⚡', desc: 'Test your knowledge' },
  { id: 'revise', label: 'Revise', labelHi: 'रिवीज़ करो', icon: '🔄', desc: 'Quick review' },
] as const;

/* ─── Role System ─── */
export type UserRole = 'student' | 'teacher' | 'guardian' | 'institution_admin' | 'none';

export const ROLE_CONFIG = {
  student: {
    label: 'Student', labelHi: 'छात्र', icon: '🎓', color: '#E8581C',
    homePath: '/dashboard',
    nav: [
      { href: '/dashboard', icon: '⬡', label: 'Home', labelHi: 'होम' },
      { href: '/learn', icon: '📚', label: 'Chapters', labelHi: 'अध्याय' },
      { href: '/foxy', icon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी' },
      { href: '/stem-centre', icon: '🔬', label: 'STEM Centre', labelHi: 'स्टेम सेंटर' },
      { href: '/progress', icon: '📈', label: 'Progress', labelHi: 'प्रगति' },
      { href: '/leaderboard', icon: '🏆', label: 'Ranks', labelHi: 'रैंक' },
      { href: '/review', icon: '🔄', label: 'Review', labelHi: 'रिव्यू' },
      { href: '/exams', icon: '📋', label: 'Exams', labelHi: 'परीक्षा' },
      { href: '/scan', icon: '📷', label: 'Scan', labelHi: 'स्कैन' },
      { href: '/reports', icon: '📊', label: 'Reports', labelHi: 'रिपोर्ट' },
      { href: '/study-plan', icon: '📅', label: 'Plan', labelHi: 'योजना' },
      { href: '/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
    ],
  },
  teacher: {
    label: 'Teacher', labelHi: 'शिक्षक', icon: '👩‍🏫', color: '#2563EB',
    homePath: '/teacher',
    nav: [
      { href: '/teacher', icon: '🏠', label: 'Dashboard', labelHi: 'डैशबोर्ड' },
      { href: '/teacher/classes', icon: '🏫', label: 'Classes', labelHi: 'कक्षाएँ' },
      { href: '/teacher/students', icon: '👨‍🎓', label: 'Students', labelHi: 'छात्र' },
      { href: '/teacher/worksheets', icon: '📝', label: 'Worksheets', labelHi: 'वर्कशीट' },
      { href: '/teacher/reports', icon: '📊', label: 'Reports', labelHi: 'रिपोर्ट' },
      { href: '/teacher/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
    ],
  },
  guardian: {
    label: 'Parent', labelHi: 'अभिभावक', icon: '👨‍👩‍👧', color: '#16A34A',
    homePath: '/parent',
    nav: [
      { href: '/parent', icon: '🏠', label: 'Dashboard', labelHi: 'डैशबोर्ड' },
      { href: '/parent/children', icon: '👧', label: 'Children', labelHi: 'बच्चे' },
      { href: '/parent/reports', icon: '📊', label: 'Reports', labelHi: 'रिपोर्ट' },
      { href: '/parent/children', icon: '📋', label: 'Exams', labelHi: 'परीक्षा' },
      { href: '/parent/support', icon: '💬', label: 'Support', labelHi: 'सहायता' },
      { href: '/parent/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
    ],
  },
  institution_admin: {
    label: 'School Admin', labelHi: 'स्कूल व्यवस्थापक', icon: '🏫', color: '#7C3AED',
    homePath: '/school-admin',
    nav: [
      { href: '/school-admin', icon: '🏠', label: 'Dashboard', labelHi: 'डैशबोर्ड' },
      { href: '/school-admin/teachers', icon: '👩‍🏫', label: 'Teachers', labelHi: 'शिक्षक' },
      { href: '/school-admin/students', icon: '👩‍🎓', label: 'Students', labelHi: 'छात्र' },
      { href: '/school-admin/classes', icon: '🏫', label: 'Classes', labelHi: 'कक्षाएं' },
      { href: '/school-admin/invite-codes', icon: '🔑', label: 'Invite Codes', labelHi: 'कोड' },
    ],
  },
  none: {
    label: 'Guest', labelHi: 'अतिथि', icon: '👤', color: '#9C8E78',
    homePath: '/',
    nav: [],
  },
} as const;

/* ─── Assignment Types ─── */
export const ASSIGNMENT_TYPES = [
  { id: 'practice', label: 'Practice', icon: '📝', desc: 'Practice questions on a topic' },
  { id: 'quiz', label: 'Quiz', icon: '⚡', desc: 'Timed quiz assessment' },
  { id: 'mastery_goal', label: 'Mastery Goal', icon: '🎯', desc: 'Master a topic or unit' },
  { id: 'unit_test', label: 'Unit Test', icon: '📋', desc: 'End-of-unit assessment' },
  { id: 'revision', label: 'Revision', icon: '🔄', desc: 'Review previously learned topics' },
] as const;

/* ─── Mastery Levels ─── */
export const MASTERY_LEVELS = [
  { id: 'not_started', label: 'Not Started', labelHi: 'शुरू नहीं', color: '#9C8E78', icon: '○' },
  { id: 'developing', label: 'Developing', labelHi: 'विकासशील', color: '#FF9800', icon: '◔' },
  { id: 'familiar', label: 'Familiar', labelHi: 'परिचित', color: '#0891B2', icon: '◑' },
  { id: 'proficient', label: 'Proficient', labelHi: 'कुशल', color: '#16A34A', icon: '◕' },
  { id: 'mastered', label: 'Mastered', labelHi: 'महारत', color: '#F5A623', icon: '●' },
] as const;

/* ─── Bloom's Taxonomy Configuration ─── */
export const BLOOM_LEVELS = [
  { id: 'remember', label: 'Remember', labelHi: 'याद करो', color: '#9CA3AF', icon: '○', order: 0 },
  { id: 'understand', label: 'Understand', labelHi: 'समझो', color: '#3B82F6', icon: '◔', order: 1 },
  { id: 'apply', label: 'Apply', labelHi: 'लागू करो', color: '#10B981', icon: '◑', order: 2 },
  { id: 'analyze', label: 'Analyze', labelHi: 'विश्लेषण करो', color: '#F59E0B', icon: '◕', order: 3 },
  { id: 'evaluate', label: 'Evaluate', labelHi: 'मूल्यांकन करो', color: '#EF4444', icon: '◉', order: 4 },
  { id: 'create', label: 'Create', labelHi: 'रचना करो', color: '#8B5CF6', icon: '●', order: 5 },
] as const;

/* ─── CBSE Board Exam Years ─── */
export const BOARD_EXAM_YEARS = [2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015] as const;

/* ─── Quiz Modes ─── */
export const QUIZ_MODES = [
  { id: 'practice', label: 'Practice', labelHi: 'अभ्यास', icon: '⚡', desc: 'Standard quiz with selected difficulty', descHi: 'चुनी हुई कठिनाई के साथ क्विज़' },
  { id: 'cognitive', label: 'Smart Practice', labelHi: 'स्मार्ट अभ्यास', icon: '🧠', desc: 'AI-powered adaptive questions using ZPD', descHi: 'AI-संचालित अनुकूली प्रश्न' },
  { id: 'board', label: 'Board Exam', labelHi: 'बोर्ड परीक्षा', icon: '📋', desc: 'Real CBSE board exam questions', descHi: 'असली CBSE बोर्ड परीक्षा के प्रश्न' },
] as const;

/* ─── CBSE Question Types ─── */
export const CBSE_QUESTION_TYPES = [
  { id: 'mcq', label: 'MCQ', marks: 1 },
  { id: 'assertion_reasoning', label: 'Assertion-Reasoning', marks: 1 },
  { id: 'case_based', label: 'Case-Based', marks: 4 },
  { id: 'short_answer', label: 'Short Answer', marks: 2 },
  { id: 'long_answer', label: 'Long Answer', marks: 5 },
] as const;

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/* ─── Exam Configuration ─── */
export const EXAM_TYPES = [
  { id: 'unit_test', label: 'Unit Test', labelHi: 'इकाई परीक्षा', icon: '📝', marks: 25, duration: 60 },
  { id: 'half_yearly', label: 'Half-Yearly', labelHi: 'अर्ध-वार्षिक', icon: '📋', marks: 80, duration: 180 },
  { id: 'annual', label: 'Annual Exam', labelHi: 'वार्षिक परीक्षा', icon: '🎓', marks: 80, duration: 180 },
] as const;

export const CBSE_SECTIONS = [
  { id: 'A', label: 'Section A', labelHi: 'खंड A', desc: 'MCQ (1 mark each)', marks: 20 },
  { id: 'B', label: 'Section B', labelHi: 'खंड B', desc: 'Short Answer (2 marks)', marks: 20 },
  { id: 'C', label: 'Section C', labelHi: 'खंड C', desc: 'Long Answer (3 marks)', marks: 18 },
  { id: 'D', label: 'Section D', labelHi: 'खंड D', desc: 'Long Answer (5 marks)', marks: 20 },
  { id: 'E', label: 'Section E', labelHi: 'खंड E', desc: 'Case Study (4 marks)', marks: 12 },
] as const;

export const IMAGE_TYPES = [
  { id: 'assignment', label: 'Assignment', labelHi: 'असाइनमेंट', icon: '📝' },
  { id: 'question_paper', label: 'Question Paper', labelHi: 'प्रश्न पत्र', icon: '📄' },
  { id: 'notes', label: 'Notes', labelHi: 'नोट्स', icon: '📓' },
  { id: 'textbook', label: 'Textbook', labelHi: 'पाठ्यपुस्तक', icon: '📖' },
  { id: 'other', label: 'Other', labelHi: 'अन्य', icon: '📎' },
] as const;

export const REPORT_MONTHS_COUNT = 6;
