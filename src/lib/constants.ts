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

export const FOXY_MODES = [
  { id: 'learn', label: 'Learn', labelHi: 'सीखो', icon: '📖', desc: 'Step-by-step lesson' },
  { id: 'doubt', label: 'Ask Doubt', labelHi: 'डाउट पूछो', icon: '❓', desc: 'Clear any confusion' },
  { id: 'quiz', label: 'Quiz Me', labelHi: 'क्विज़ लो', icon: '⚡', desc: 'Test your knowledge' },
  { id: 'revise', label: 'Revise', labelHi: 'रिवीज़ करो', icon: '🔄', desc: 'Quick review' },
] as const;

/* ─── Role System ─── */
export type UserRole = 'student' | 'teacher' | 'guardian' | 'none';

export const ROLE_CONFIG = {
  student: {
    label: 'Student', labelHi: 'छात्र', icon: '🎓', color: '#E8581C',
    homePath: '/dashboard',
    nav: [
      { href: '/dashboard', icon: '⬡', label: 'Home', labelHi: 'होम' },
      { href: '/foxy', icon: '🦊', label: 'Foxy', labelHi: 'फॉक्सी' },
      { href: '/simulations', icon: '🔬', label: 'Lab', labelHi: 'लैब' },
      { href: '/quiz', icon: '⚡', label: 'Quiz', labelHi: 'क्विज़' },
      { href: '/progress', icon: '📈', label: 'Progress', labelHi: 'प्रगति' },
      { href: '/leaderboard', icon: '🏆', label: 'Ranks', labelHi: 'रैंक' },
      { href: '/review', icon: '🔄', label: 'Review', labelHi: 'रिव्यू' },
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
      { href: '/teacher/assignments', icon: '📝', label: 'Assignments', labelHi: 'असाइनमेंट' },
      { href: '/teacher/reports', icon: '📊', label: 'Reports', labelHi: 'रिपोर्ट' },
      { href: '/teacher/curriculum', icon: '📚', label: 'Curriculum', labelHi: 'पाठ्यक्रम' },
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
      { href: '/parent/notifications', icon: '🔔', label: 'Alerts', labelHi: 'सूचनाएँ' },
      { href: '/parent/profile', icon: '👤', label: 'Profile', labelHi: 'प्रोफ़ाइल' },
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

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
