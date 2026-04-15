'use client';
import { useState } from 'react';

type BondType = 'Ionic' | 'Covalent' | 'Polar Covalent';

const STEPS: Record<BondType, string[]> = {
  Ionic: ['Na and Cl atoms approach', 'Na transfers its outer electron to Cl', 'Na⁺ and Cl⁻ ions form', 'Electrostatic attraction bonds them'],
  Covalent: ['Two H atoms approach each other', 'Electron clouds begin to overlap', 'Shared electron pair forms', 'H₂ molecule — stable bond'],
  'Polar Covalent': ['H and Cl atoms approach', 'Electrons shared but Cl is more electronegative', 'Electron cloud shifts toward Cl', 'δ+ on H, δ− on Cl — polar bond'],
};

export default function IonicCovalentBonds() {
  const [bond, setBond] = useState<BondType>('Ionic');
  const [step, setStep] = useState(0);
  const steps = STEPS[bond];
  const progress = step / (steps.length - 1);

  const ionicDist = 180 - progress * 80;
  const electronX = 140 + progress * 100;
  const electronOpacity = step >= 1 && step <= 2 ? 1 : step === 0 ? 0 : 0.3;
  const ionCharge = step >= 2;

  const overlapX = 50 + progress * 30;
  const shareOpacity = progress > 0.4 ? Math.min(1, (progress - 0.4) * 2.5) : 0;

  const cloudX = 0 + progress * 25;

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Ionic & Covalent Bonds</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['Ionic', 'Covalent', 'Polar Covalent'] as BondType[]).map(b => (
          <button key={b} onClick={() => { setBond(b); setStep(0); }} style={{
            padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
            background: bond === b ? 'var(--orange)' : 'var(--surface-2)', color: bond === b ? '#fff' : 'var(--text-1)',
          }}>{b}</button>
        ))}
      </div>
      <svg viewBox="0 0 560 200" style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block', marginBottom: 10 }}>
        {bond === 'Ionic' && (
          <g transform="translate(80,50)">
            <circle cx={150} cy={60} r={40} fill="rgba(251,146,60,0.3)" stroke="var(--orange)" strokeWidth={2} />
            <text x={150} y={55} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--orange)">Na</text>
            <text x={150} y={72} textAnchor="middle" fontSize="11" fill="var(--orange)">{ionCharge ? 'Na⁺' : 'Z=11'}</text>
            <circle cx={ionicDist + 150} cy={60} r={45} fill="rgba(124,58,237,0.3)" stroke="var(--purple)" strokeWidth={2} />
            <text x={ionicDist + 150} y={55} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--purple)">Cl</text>
            <text x={ionicDist + 150} y={72} textAnchor="middle" fontSize="11" fill="var(--purple)">{ionCharge ? 'Cl⁻' : 'Z=17'}</text>
            {step >= 1 && step <= 2 && (
              <circle cx={electronX} cy={60} r={6} fill="#60a5fa" />
            )}
            {step >= 3 && (
              <path d={`M${190},60 L${ionicDist + 100},60`} stroke="#888" strokeWidth={2} markerEnd="url(#arr)" />
            )}
            <text x={ionicDist / 2 + 150} y={120} textAnchor="middle" fontSize="11" fill="var(--text-2)">{steps[step]}</text>
          </g>
        )}
        {bond === 'Covalent' && (
          <g transform="translate(120,40)">
            <circle cx={50 + overlapX} cy={60} r={40} fill="rgba(96,165,250,0.3)" stroke="#60a5fa" strokeWidth={2} />
            <text x={50 + overlapX} y={65} textAnchor="middle" fontSize="18" fontWeight="700" fill="#60a5fa">H</text>
            <circle cx={200 - overlapX} cy={60} r={40} fill="rgba(96,165,250,0.3)" stroke="#60a5fa" strokeWidth={2} />
            <text x={200 - overlapX} y={65} textAnchor="middle" fontSize="18" fontWeight="700" fill="#60a5fa">H</text>
            {shareOpacity > 0 && (
              <ellipse cx={125} cy={60} rx={22} ry={16} fill={`rgba(96,165,250,${shareOpacity * 0.6})`} />
            )}
            {step >= 3 && <text x={125} y={115} textAnchor="middle" fontSize="12" fill="#60a5fa">H — H (shared pair)</text>}
            <text x={125} y={135} textAnchor="middle" fontSize="11" fill="var(--text-2)">{steps[step]}</text>
          </g>
        )}
        {bond === 'Polar Covalent' && (
          <g transform="translate(100,40)">
            <ellipse cx={90 - cloudX} cy={60} rx={35} ry={30} fill={`rgba(96,165,250,${0.3 - progress * 0.15})`} stroke="#60a5fa" strokeWidth={2} />
            <text x={90 - cloudX} y={65} textAnchor="middle" fontSize="18" fontWeight="700" fill="#60a5fa">H</text>
            {step >= 2 && <text x={90 - cloudX} y={45} textAnchor="middle" fontSize="13" fill="#60a5fa">δ+</text>}
            <ellipse cx={220 + cloudX} cy={60} rx={40} ry={35} fill={`rgba(124,58,237,${0.3 + progress * 0.2})`} stroke="var(--purple)" strokeWidth={2} />
            <text x={220 + cloudX} y={65} textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--purple)">Cl</text>
            {step >= 2 && <text x={220 + cloudX} y={45} textAnchor="middle" fontSize="13" fill="var(--purple)">δ−</text>}
            {step >= 1 && (
              <ellipse cx={155} cy={60} rx={25} ry={18} fill={`rgba(124,58,237,${shareOpacity * 0.4})`} />
            )}
            <text x={155} y={130} textAnchor="middle" fontSize="11" fill="var(--text-2)">{steps[step]}</text>
          </g>
        )}
      </svg>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} style={{
          padding: '6px 16px', borderRadius: 8, border: 'none', cursor: step === 0 ? 'not-allowed' : 'pointer',
          background: step === 0 ? 'var(--surface-2)' : 'var(--purple)', color: '#fff', fontWeight: 600,
        }}>Back</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 12, color: 'var(--text-1)', fontWeight: 600 }}>
          Step {step + 1} / {steps.length}
        </div>
        <button onClick={() => setStep(s => Math.min(steps.length - 1, s + 1))} disabled={step === steps.length - 1} style={{
          padding: '6px 16px', borderRadius: 8, border: 'none', cursor: step === steps.length - 1 ? 'not-allowed' : 'pointer',
          background: step === steps.length - 1 ? 'var(--surface-2)' : 'var(--orange)', color: '#fff', fontWeight: 600,
        }}>Next</button>
      </div>
      <div style={{ padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>Ionic:</b> electron transfer &nbsp;|&nbsp;
        <b style={{ color: 'var(--purple)' }}>Covalent:</b> electron sharing &nbsp;|&nbsp;
        <b style={{ color: '#60a5fa' }}>Polar:</b> unequal sharing
      </div>
    </div>
  );
}
