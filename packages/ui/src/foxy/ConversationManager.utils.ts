export interface ConversationSummary {
  id: string;
  title: string;
  subject: string;
  chapter?: string;
  chapterNumber?: number;
  lastMessage: string;
  messageCount: number;
  updatedAt: string;
  isActive: boolean;
}

export const FALLBACK_SUBJECT_NAMES: Record<string, string> = {
  math: 'Mathematics',
  science: 'Science',
  english: 'English',
  hindi: 'Hindi',
  physics: 'Physics',
  chemistry: 'Chemistry',
  biology: 'Biology',
  social_studies: 'Social Studies',
  coding: 'Coding',
};

export function generateTitle(messages: Array<{ role: string; content: string }>, subject: string): string {
  const firstUserMsg = messages.find(m => m.role === 'student' || m.role === 'user');
  const subjectLabel = FALLBACK_SUBJECT_NAMES[subject] || subject || 'New Chat';
  if (!firstUserMsg) return subjectLabel;
  // Extract meaningful title: strip common prefixes, truncate
  let title = firstUserMsg.content
    .replace(/^(teach me about|explain|help me with|mujhe sikhao|samjhao):\s*/i, '')
    .replace(/\(Chapter \d+\)/i, '')
    .trim();
  if (title.length > 50) title = title.substring(0, 47) + '...';
  return title || subjectLabel;
}

export interface SimplifiedMode {
  id: string;
  label: string;
  labelHi: string;
  icon: string;
  description: string;
  descriptionHi: string;
}

export const SIMPLIFIED_MODES: SimplifiedMode[] = [
  {
    id: 'ask',
    label: 'Ask Foxy',
    labelHi: 'Foxy \u0938\u0947 \u092A\u0942\u091B\u094B',
    icon: '\uD83D\uDCA1',
    description: 'Learn concepts, clear doubts',
    descriptionHi: '\u0915\u0949\u0928\u094D\u0938\u0947\u092A\u094D\u091F \u0938\u0940\u0916\u094B, \u0921\u093E\u0909\u091F \u0915\u094D\u0932\u093F\u092F\u0930 \u0915\u0930\u094B',
  },
  {
    id: 'practice',
    label: 'Practice',
    labelHi: '\u0905\u092D\u094D\u092F\u093E\u0938',
    icon: '\u270F\uFE0F',
    description: 'Problems & quizzes',
    descriptionHi: '\u092A\u094D\u0930\u0936\u094D\u0928 \u0914\u0930 \u0915\u094D\u0935\u093F\u091C\u093C',
  },
  {
    id: 'revise',
    label: 'Revise',
    labelHi: '\u0930\u093F\u0935\u0940\u091C\u093C',
    icon: '\uD83D\uDD04',
    description: 'Summaries & notes',
    descriptionHi: '\u0938\u093E\u0930\u093E\u0902\u0936 \u0914\u0930 \u0928\u094B\u091F\u094D\u0938',
  },
];

export const MODE_MAP: Record<string, string> = {
  ask: 'learn',
  practice: 'practice',
  revise: 'revision',
  lesson: 'lesson',
};
