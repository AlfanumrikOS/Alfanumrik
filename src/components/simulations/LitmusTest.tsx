'use client';
import { useState } from 'react';

const SUBSTANCES = [
  { name: 'HCl', type: 'Acid', ph: 1, color: '#ff4444' },
  { name: 'Lemon juice', type: 'Acid', ph: 3, color: '#ffe066' },
  { name: 'Water', type: 'Neutral', ph: 7, color: '#88ccff' },
  { name: 'Milk', type: 'Neutral', ph: 6.5, color: '#fff8e0' },
  { name: 'Baking soda', type: 'Base', ph: 9, color: '#88ddaa' },
  { name: 'NaOH', type: 'Base', ph: 13, color: '#aa88ff' },
];

export default function LitmusTest() {
  const [selected, setSelected] = useState<number | null>(null);

  const sub = selected !== null ? SUBSTANCES[selected] : null;

  const redLitmusColor = sub
    ? sub.type === 'Base' ? '#5555ff' : '#cc2222'
    : '#cc2222';
  const blueLitmusColor = sub
    ? sub.type === 'Acid' ? '#cc2222' : '#3333cc'
    : '#3333cc';

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Litmus Test Simulator</h3>
      <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>Click a substance to test it with litmus paper</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {SUBSTANCES.map((s, i) => (
          <button key={i} onClick={() => setSelected(i)} style={{
            padding: '8px 12px', borderRadius: 8, border: `2px solid ${selected === i ? s.color : 'transparent'}`,
            background: s.color + '33', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text-1)',
            boxShadow: selected === i ? `0 0 0 2px ${s.color}` : 'none',
          }}>
            <div style={{ fontSize: 16, marginBottom: 2 }}>🧪</div>
            {s.name}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginBottom: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 60, height: 120, background: redLitmusColor, borderRadius: 6, border: '2px solid #888', transition: 'background 0.5s', margin: '0 auto 6px' }} />
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Red Litmus</div>
          {sub && sub.type === 'Base' && <div style={{ fontSize: 11, color: '#5555ff', fontWeight: 700 }}>Turned BLUE!</div>}
          {sub && sub.type !== 'Base' && <div style={{ fontSize: 11, color: '#cc2222' }}>No change</div>}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 60, height: 120, background: blueLitmusColor, borderRadius: 6, border: '2px solid #888', transition: 'background 0.5s', margin: '0 auto 6px' }} />
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>Blue Litmus</div>
          {sub && sub.type === 'Acid' && <div style={{ fontSize: 11, color: '#cc2222', fontWeight: 700 }}>Turned RED!</div>}
          {sub && sub.type !== 'Acid' && <div style={{ fontSize: 11, color: '#3333cc' }}>No change</div>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
          {sub && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: sub.color + '33', border: `1px solid ${sub.color}` }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{sub.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 2 }}>Type: <b style={{ color: sub.type === 'Acid' ? '#cc2222' : sub.type === 'Base' ? '#5555ff' : '#16a34a' }}>{sub.type}</b></div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>pH ≈ <b style={{ color: 'var(--orange)' }}>{sub.ph}</b></div>
            </div>
          )}
          {!sub && <div style={{ fontSize: 12, color: 'var(--text-2)', padding: 10 }}>Select a substance</div>}
        </div>
      </div>
      <div style={{ padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: '#cc2222' }}>Acids</b> turn blue litmus <b>red</b> &nbsp;|&nbsp;
        <b style={{ color: '#5555ff' }}>Bases</b> turn red litmus <b>blue</b>
      </div>
    </div>
  );
}
