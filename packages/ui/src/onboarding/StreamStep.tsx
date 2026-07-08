'use client';

/**
 * StreamStep — blocking stream selector shown only to grade 11/12 students during
 * onboarding. CBSE senior secondary students must pick one of science / commerce
 * / humanities; the rest of their subject options (and plan gating) follow.
 */

export type Stream = 'science' | 'commerce' | 'humanities';

interface StreamStepProps {
  value: Stream | null;
  onChange: (next: Stream) => void;
  onNext: () => void;
  onBack: () => void;
  isHi: boolean;
}

const STREAMS: Array<{
  id: Stream;
  icon: string;
  label: string;
  labelHi: string;
  blurb: string;
  blurbHi: string;
  color: string;
}> = [
  {
    id: 'science',
    icon: '\uD83D\uDD2C',
    label: 'Science',
    labelHi: 'विज्ञान',
    blurb: 'Physics, Chemistry, Biology, Math, etc.',
    blurbHi: 'विज्ञान — भौतिक, रसायन, जीव, गणित, आदि',
    color: '#2563EB',
  },
  {
    id: 'commerce',
    icon: '\uD83D\uDCC8',
    label: 'Commerce',
    labelHi: 'वाणिज्य',
    blurb: 'Accountancy, Business Studies, Economics, etc.',
    blurbHi: 'वाणिज्य — लेखाशास्त्र, व्यवसाय अध्ययन, अर्थशास्त्र, आदि',
    color: '#16A34A',
  },
  {
    id: 'humanities',
    icon: '\uD83C\uDFDB',
    label: 'Humanities',
    labelHi: 'मानविकी',
    blurb: 'History, Geography, Political Science, etc.',
    blurbHi: 'मानविकी — इतिहास, भूगोल, राजनीति विज्ञान, आदि',
    color: '#7C3AED',
  },
];

export default function StreamStep({ value, onChange, onNext, onBack, isHi }: StreamStepProps) {
  return (
    <div className="animate-fade-in">
      <div className="text-center mb-6">
        <h2 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? 'स्ट्रीम चुनें' : 'Choose your stream'}
        </h2>
        <p className="text-xs text-[var(--text-3)] mt-1">
          {isHi
            ? 'कक्षा 11–12 के लिए स्ट्रीम ज़रूरी है'
            : 'Grade 11–12 requires a stream selection'}
        </p>
      </div>

      <div className="space-y-3">
        {STREAMS.map((s) => {
          const selected = value === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onChange(s.id)}
              className="w-full p-4 rounded-2xl text-left flex items-start gap-3 transition-all active:scale-[0.98]"
              style={{
                background: selected ? `${s.color}10` : 'var(--surface-1)',
                border: `1.5px solid ${selected ? s.color : 'var(--border)'}`,
              }}
              aria-pressed={selected}
            >
              <span className="text-2xl" aria-hidden="true">{s.icon}</span>
              <div className="flex-1">
                <div className="text-base font-bold" style={{ color: selected ? s.color : 'var(--text-1)' }}>
                  {isHi ? s.labelHi : s.label}
                </div>
                <div className="text-xs text-[var(--text-3)] mt-0.5">
                  {isHi ? s.blurbHi : s.blurb}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={!value}
        onClick={onNext}
        className="w-full mt-6 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-40"
        style={{ background: 'var(--orange)' }}
      >
        {isHi ? 'आगे बढ़ो' : 'Continue'}
      </button>
      <button
        type="button"
        onClick={onBack}
        className="w-full mt-2 text-sm text-[var(--text-3)] py-2"
      >
        {isHi ? '← वापस जाओ' : '← Go back'}
      </button>
    </div>
  );
}
