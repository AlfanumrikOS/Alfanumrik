'use client';

import { useLang } from './LangToggle';
import { FoxyMark } from './FoxyMark';
import { IconBloomLevel, IconXPStar } from './CustomIcons';
import { FadeIn, StaggerContainer, StaggerItem, HoverScale } from './Animations';

function FoxyCard() {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
      <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
        <FoxyMark size="sm" />
        <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: '#E8581C' }}>Foxy AI Tutor</span>
        <div className="ml-auto flex gap-1">
          {['Learn', 'Practice', 'Quiz'].map((mode, i) => (
            <span key={mode} className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ background: i === 0 ? '#E8581C' : 'var(--surface-2)', color: i === 0 ? '#fff' : 'var(--text-3)' }}>{mode}</span>
          ))}
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex justify-end">
          <div className="rounded-2xl rounded-br-md px-3.5 py-2.5 max-w-[80%] text-xs leading-relaxed" style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}>Photosynthesis samjhao step by step</div>
        </div>
        <div className="flex gap-2 items-start">
          <FoxyMark size="sm" />
          <div className="rounded-2xl rounded-bl-md px-3.5 py-2.5 max-w-[85%] text-xs leading-relaxed" style={{ background: 'var(--surface-1)', color: 'var(--text-1)' }}>
            <p className="mb-2"><span className="font-bold">Photosynthesis</span> mein plants sunlight se food banate hain:</p>
            <p className="mb-1"><span className="font-semibold" style={{ color: '#E8581C' }}>Step 1:</span> Chlorophyll absorbs light</p>
            <p className="mb-1"><span className="font-semibold" style={{ color: '#E8581C' }}>Step 2:</span> Water splits (photolysis)</p>
            <p className="mb-2"><span className="font-semibold" style={{ color: '#E8581C' }}>Step 3:</span> CO₂ → glucose</p>
            <div className="inline-block text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}>6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂</div>
            <p className="mt-2" style={{ color: 'var(--text-2)' }}>Bata sakte ho chlorophyll kahan hota hai?</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ParentCard() {
  const mastery = [
    { topics: ['Algebra', 'Photosynthesis', 'Grammar'], fills: [88, 82, 92], type: 'strong' as const },
    { topics: ['Geometry', 'Chemical Rxns'], fills: [38, 42], type: 'weak' as const },
  ];
  return (
    <div className="rounded-2xl overflow-hidden relative sm:-translate-y-2" style={{ background: 'var(--bg)', border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(22,163,74,0.12)' }}>
      <div className="absolute top-3 right-3 text-[10px] font-bold px-2.5 py-1 rounded-full z-10" style={{ background: 'rgba(22,163,74,0.1)', color: '#16A34A', border: '1px solid rgba(22,163,74,0.2)' }}>For You</div>
      <div className="px-4 py-3 flex items-center gap-2 border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
        <span className="text-lg">👨‍👩‍👧</span>
        <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: '#16A34A' }}>Parent Dashboard</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: 'linear-gradient(135deg, rgba(232,88,28,0.15), rgba(251,248,244,0.8))', color: '#E8581C' }}>A</div>
          <div>
            <div className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>Aarav Sharma</div>
            <div className="text-[10px]" style={{ color: 'var(--text-3)' }}>Class 8 · CBSE</div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#16A34A' }} />
            <span className="text-[10px] font-semibold" style={{ color: '#16A34A' }}>Active today</span>
          </div>
        </div>
        <div className="rounded-xl p-3" style={{ background: 'rgba(22,163,74,0.04)', border: '1px solid rgba(22,163,74,0.12)' }}>
          <div className="text-[10px] font-semibold mb-2" style={{ color: '#16A34A' }}>This Week</div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[{ val: '5', label: 'Quizzes' }, { val: '82%', label: 'Avg Score' }, { val: '45m', label: 'Study Time' }].map((m) => (
              <div key={m.label}><div className="text-sm font-extrabold" style={{ color: 'var(--text-1)' }}>{m.val}</div><div className="text-[10px]" style={{ color: 'var(--text-3)' }}>{m.label}</div></div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {mastery.map((group) => (
            <div key={group.type} className="rounded-xl p-2.5" style={{ background: group.type === 'strong' ? 'rgba(22,163,74,0.04)' : 'rgba(232,88,28,0.04)', border: `1px solid ${group.type === 'strong' ? 'rgba(22,163,74,0.12)' : 'rgba(232,88,28,0.12)'}`, borderLeft: `3px solid ${group.type === 'strong' ? '#16A34A' : '#E8581C'}` }}>
              <div className="text-[10px] font-semibold mb-1.5" style={{ color: group.type === 'strong' ? '#16A34A' : '#E8581C' }}>{group.type === 'strong' ? 'Strong' : 'Needs Work'}</div>
              {group.topics.map((topic, j) => (
                <div key={topic} className="flex items-center gap-1.5 mb-1">
                  <div className="h-1.5 rounded-full flex-1" style={{ background: group.type === 'strong' ? 'rgba(22,163,74,0.15)' : 'rgba(232,88,28,0.1)' }}>
                    <div className="h-full rounded-full" style={{ width: `${group.fills[j]}%`, background: group.type === 'strong' ? '#16A34A' : '#E8581C' }} />
                  </div>
                  <span className="text-[9px] shrink-0 w-16" style={{ color: 'var(--text-2)' }}>{topic}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuizCard() {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.06)' }}>
      <div className="px-4 py-3 flex items-center justify-between border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">⚡</span>
          <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: '#2563EB' }}>Smart Quiz</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(124,58,237,0.08)', color: '#7C3AED' }}><IconBloomLevel activeLevel={1} /> Apply</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,88,28,0.08)', color: '#E8581C' }}>Medium</span>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold" style={{ color: 'var(--text-3)' }}>Question 7 of 10</span>
          <span className="text-[10px] font-bold" style={{ color: '#E8581C' }}>7/10</span>
        </div>
        <div className="flex gap-0.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-1.5 flex-1 rounded-sm" style={{ background: i < 7 ? 'linear-gradient(90deg, #E8581C, #F5A623)' : 'var(--surface-2)' }} />
          ))}
        </div>
        <p className="text-xs font-semibold leading-relaxed mt-2" style={{ color: 'var(--text-1)' }}>Which of the following is the correct product of photosynthesis?</p>
        <div className="space-y-2 mt-2">
          {[
            { label: 'A', text: 'Carbon dioxide and water', correct: false },
            { label: 'B', text: 'Glucose and oxygen', correct: true },
            { label: 'C', text: 'Starch and nitrogen', correct: false },
            { label: 'D', text: 'Protein and hydrogen', correct: false },
          ].map((opt) => (
            <div key={opt.label} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs" style={{ background: opt.correct ? 'rgba(22,163,74,0.08)' : 'var(--surface-1)', border: opt.correct ? '1.5px solid rgba(22,163,74,0.4)' : '1px solid var(--border)', color: opt.correct ? '#16A34A' : 'var(--text-1)', fontWeight: opt.correct ? 600 : 400 }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: opt.correct ? '#16A34A' : 'var(--surface-2)', color: opt.correct ? '#fff' : 'var(--text-3)' }}>{opt.correct ? '✓' : opt.label}</span>
              {opt.text}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold mt-1" style={{ color: '#16A34A' }}>
          <span>✅</span> Correct! <span className="inline-flex items-center gap-0.5" style={{ color: '#E8581C' }}>+10 <IconXPStar /> XP</span>
        </div>
      </div>
    </div>
  );
}

export function ProductShowcase() {
  const { t } = useLang();
  return (
    <section className="py-12 sm:py-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <FadeIn className="text-center mb-8 max-w-2xl mx-auto">
          <span className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-3" style={{ background: 'rgba(232,88,28,0.08)', color: 'var(--orange)' }}>{t('SEE IT IN ACTION', 'देखें कैसे काम करता है')}</span>
          <h2 className="text-2xl sm:text-3xl font-extrabold mb-3" style={{ fontFamily: 'var(--font-display)' }}>{t('Real product. Real interface. Not stock photos.', 'असली प्रोडक्ट। असली इंटरफ़ेस। स्टॉक फ़ोटो नहीं।')}</h2>
        </FadeIn>
        <StaggerContainer className="grid sm:grid-cols-3 gap-5">
          <StaggerItem className="sm:order-1 order-2">
            <HoverScale><FoxyCard /></HoverScale>
            <p className="text-xs text-center mt-3" style={{ color: 'var(--text-2)' }}>{t('Your child asks. Foxy explains. In Hindi, English, or both.', 'आपका बच्चा पूछता है। Foxy समझाता है। हिन्दी, अंग्रेज़ी, या दोनों में।')}</p>
          </StaggerItem>
          <StaggerItem className="sm:order-2 order-1">
            <HoverScale><ParentCard /></HoverScale>
            <p className="text-xs text-center mt-3" style={{ color: 'var(--text-2)' }}>{t('See what they studied. Know what\'s weak. No surprises.', 'देखें क्या पढ़ा। जानें क्या कमज़ोर है। कोई सरप्राइज़ नहीं।')}</p>
          </StaggerItem>
          <StaggerItem className="sm:order-3 order-3">
            <HoverScale><QuizCard /></HoverScale>
            <p className="text-xs text-center mt-3" style={{ color: 'var(--text-2)' }}>{t('Board-pattern questions. Instant feedback. Real improvement.', 'बोर्ड-पैटर्न सवाल। तुरंत फीडबैक। असली सुधार।')}</p>
          </StaggerItem>
        </StaggerContainer>
      </div>
    </section>
  );
}