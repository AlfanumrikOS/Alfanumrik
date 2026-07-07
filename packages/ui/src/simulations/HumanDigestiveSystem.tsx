'use client';
import { useState } from 'react';

const ORGANS = [
  { id: 'mouth', label: 'Mouth', x: 245, y: 30, w: 70, h: 26, color: '#FFAB91', enzyme: 'Salivary Amylase', digests: 'Starch → Maltose', info: 'Mechanical + chemical digestion begins. Saliva softens food.' },
  { id: 'oesophagus', label: 'Oesophagus', x: 255, y: 66, w: 50, h: 28, color: '#FFCC80', enzyme: 'None', digests: 'Peristalsis moves food', info: 'Muscular tube. Peristalsis pushes bolus to stomach.' },
  { id: 'stomach', label: 'Stomach', x: 170, y: 104, w: 80, h: 44, color: '#EF9A9A', enzyme: 'Pepsin, HCl', digests: 'Protein → Peptides', info: 'Churning + acid (pH 2). Pepsin breaks proteins. Chyme formed.' },
  { id: 'liver', label: 'Liver', x: 290, y: 110, w: 60, h: 30, color: '#CE93D8', enzyme: 'Bile (no enzyme)', digests: 'Emulsifies fats', info: 'Produces bile stored in gallbladder. Emulsifies lipids.' },
  { id: 'pancreas', label: 'Pancreas', x: 290, y: 148, w: 60, h: 26, color: '#80DEEA', enzyme: 'Trypsin, Lipase, Amylase', digests: 'All macronutrients', info: 'Secretes pancreatic juice into small intestine.' },
  { id: 'small', label: 'Small Intestine', x: 175, y: 158, w: 100, h: 36, color: '#A5D6A7', enzyme: 'Maltase, Sucrase, Lactase', digests: 'Complete digestion + absorption', info: '6-7 m long. Villi + microvilli absorb nutrients into blood.' },
  { id: 'large', label: 'Large Intestine', x: 175, y: 204, w: 100, h: 32, color: '#FFE082', enzyme: 'Bacteria', digests: 'Water absorption', info: '1.5 m. Absorbs water, forms faeces. Gut bacteria present.' },
  { id: 'rectum', label: 'Rectum', x: 245, y: 244, w: 70, h: 26, color: '#BCAAA4', enzyme: 'None', digests: 'Stores faeces', info: 'Temporary storage before elimination via anus.' },
];

const BOLUS_PATH = [0, 1, 2, 4, 5, 6, 7];

export default function HumanDigestiveSystem() {
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const currentOrg = ORGANS.find(o => o.id === selected);
  const bolusOrg = ORGANS[BOLUS_PATH[step]];

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Human Digestive System</h3>
      <p style={{ color: 'var(--text-2)', fontSize: 12, marginBottom: 8 }}>Click organs to learn. Use Next to follow the food.</p>
      <svg viewBox="0 0 560 290" style={{ width: '100%', background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        <line x1="280" y1="56" x2="280" y2="104" stroke="#999" strokeWidth={1.5} />
        <line x1="210" y1="148" x2="210" y2="158" stroke="#999" strokeWidth={1.5} />
        <line x1="225" y1="194" x2="225" y2="204" stroke="#999" strokeWidth={1.5} />
        <line x1="280" y1="236" x2="280" y2="244" stroke="#999" strokeWidth={1.5} />
        <line x1="310" y1="125" x2="275" y2="148" stroke="#80DEEA" strokeWidth={1.5} strokeDasharray="3,2" />
        <line x1="320" y1="161" x2="275" y2="172" stroke="#80DEEA" strokeWidth={1.5} strokeDasharray="3,2" />
        {ORGANS.map(o => {
          const isSel = selected === o.id;
          const isBolus = o.id === bolusOrg.id;
          return (
            <g key={o.id} onClick={() => setSelected(isSel ? null : o.id)} style={{ cursor: 'pointer' }}>
              <rect x={o.x} y={o.y} width={o.w} height={o.h} rx={8}
                fill={o.color} stroke={isSel ? '#F97316' : isBolus ? '#1565C0' : '#aaa'}
                strokeWidth={isSel ? 2.5 : isBolus ? 2.5 : 1} />
              <text x={o.x + o.w / 2} y={o.y + o.h / 2 + 4} textAnchor="middle" fontSize={10} fill="#333" fontWeight={isSel ? 700 : 400}>
                {o.label}
              </text>
            </g>
          );
        })}
        <circle cx={bolusOrg.x + bolusOrg.w / 2} cy={bolusOrg.y - 8} r={6} fill="#1565C0" opacity={0.85} />
        <text x={60} y={50} fontSize={10} fill="var(--text-2)">← Click organ</text>
        <text x={430} y={170} fontSize={10} fill="#7C3AED">Accessory</text>
        <text x={430} y={182} fontSize={10} fill="#7C3AED">organs →</text>
      </svg>
      {currentOrg && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: currentOrg.color + '55', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', borderLeft: `3px solid ${currentOrg.color}` }}>
          <strong>{currentOrg.label}</strong> | Enzyme: {currentOrg.enzyme}<br />
          Digests: <em>{currentOrg.digests}</em><br />
          <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{currentOrg.info}</span>
        </div>
      )}
      <div style={{ marginTop: 8, padding: '6px 12px', background: '#E3F2FD', borderRadius: 8, fontSize: 12, color: '#1565C0' }}>
        Step {step + 1}/{BOLUS_PATH.length}: Food at <strong>{bolusOrg.label}</strong> — {bolusOrg.digests}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={() => setStep(s => Math.max(0, s - 1))} style={{ padding: '6px 16px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Back</button>
        <button onClick={() => setStep(s => (s + 1) % BOLUS_PATH.length)} style={{ padding: '6px 16px', background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Next</button>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#E8F5E9', borderRadius: 8, fontSize: 13, color: '#2E7D32', borderLeft: '3px solid #4CAF50' }}>
        Digestive system = <strong>breakdown</strong> (digestion) + <strong>absorption</strong> of nutrients
      </div>
    </div>
  );
}
