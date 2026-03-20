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
  { code: 'economics', name: 'Economics', icon: '📈', color: '#D97706' },
] as const;

export const FOXY_MODES = [
  { id: 'learn', label: 'Learn', labelHi: 'सीखो', icon: '📖', desc: 'Step-by-step lesson' },
  { id: 'doubt', label: 'Ask Doubt', labelHi: 'डाउट पूछो', icon: '❓', desc: 'Clear any confusion' },
  { id: 'quiz', label: 'Quiz Me', labelHi: 'क्विज़ लो', icon: '⚡', desc: 'Test your knowledge' },
  { id: 'revise', label: 'Revise', labelHi: 'रिवीज़ करो', icon: '🔄', desc: 'Quick review' },
] as const;

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
