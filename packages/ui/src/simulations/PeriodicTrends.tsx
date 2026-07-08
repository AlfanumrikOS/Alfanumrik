'use client';
import { useState } from 'react';

type Mode = 'Atomic Radius' | 'Electronegativity' | 'Ionisation Energy';

const ELEMENTS = [
  { symbol:'H',  period:1, group:1,  radius:53,  en:2.20, ie:1312 },
  { symbol:'He', period:1, group:18, radius:31,  en:0,    ie:2372 },
  { symbol:'Li', period:2, group:1,  radius:167, en:0.98, ie:520  },
  { symbol:'Be', period:2, group:2,  radius:112, en:1.57, ie:900  },
  { symbol:'B',  period:2, group:13, radius:87,  en:2.04, ie:801  },
  { symbol:'C',  period:2, group:14, radius:77,  en:2.55, ie:1086 },
  { symbol:'N',  period:2, group:15, radius:75,  en:3.04, ie:1402 },
  { symbol:'O',  period:2, group:16, radius:73,  en:3.44, ie:1314 },
  { symbol:'F',  period:2, group:17, radius:64,  en:3.98, ie:1681 },
  { symbol:'Ne', period:2, group:18, radius:38,  en:0,    ie:2081 },
  { symbol:'Na', period:3, group:1,  radius:186, en:0.93, ie:496  },
  { symbol:'Mg', period:3, group:2,  radius:160, en:1.31, ie:738  },
  { symbol:'Al', period:3, group:13, radius:143, en:1.61, ie:578  },
  { symbol:'Si', period:3, group:14, radius:117, en:1.90, ie:787  },
  { symbol:'P',  period:3, group:15, radius:115, en:2.19, ie:1012 },
  { symbol:'S',  period:3, group:16, radius:103, en:2.58, ie:1000 },
  { symbol:'Cl', period:3, group:17, radius:99,  en:3.16, ie:1251 },
  { symbol:'Ar', period:3, group:18, radius:71,  en:0,    ie:1521 },
  { symbol:'K',  period:4, group:1,  radius:227, en:0.82, ie:419  },
  { symbol:'Ca', period:4, group:2,  radius:197, en:1.00, ie:590  },
];

const GROUP_COL: Record<number,number> = {1:0,2:1,13:2,14:3,15:4,16:5,17:6,18:7};

function heatColor(t: number) {
  const r = Math.round(255 * t);
  const b = Math.round(255 * (1 - t));
  return `rgb(${r},50,${b})`;
}

export default function PeriodicTrends() {
  const [mode, setMode] = useState<Mode>('Atomic Radius');
  const [hovered, setHovered] = useState<typeof ELEMENTS[0] | null>(null);

  const vals = ELEMENTS.map(e => mode === 'Atomic Radius' ? e.radius : mode === 'Electronegativity' ? e.en : e.ie);
  const min = Math.min(...vals), max = Math.max(...vals);
  const norm = (v: number) => (v - min) / (max - min);

  const trendText: Record<Mode, string> = {
    'Atomic Radius': 'Increases down group, decreases across period →',
    'Electronegativity': 'Increases across period →, decreases down group ↓',
    'Ionisation Energy': 'Increases across period →, decreases down group ↓',
  };

  const CW = 50, CH = 40;

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Periodic Trends</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['Atomic Radius', 'Electronegativity', 'Ionisation Energy'] as Mode[]).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{
            padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: mode === m ? 'var(--orange)' : 'var(--surface-2)', color: mode === m ? '#fff' : 'var(--text-1)',
          }}>{m}</button>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: 8 * CW + 20, height: 4 * CH + 30 }}>
          {ELEMENTS.map((el, i) => {
            const col = GROUP_COL[el.group];
            const row = el.period - 1;
            const val = vals[i];
            const t = norm(val);
            return (
              <div key={el.symbol} onMouseEnter={() => setHovered(el)} onMouseLeave={() => setHovered(null)}
                style={{
                  position: 'absolute', left: col * CW + 10, top: row * CH,
                  width: CW - 2, height: CH - 2, borderRadius: 4,
                  background: heatColor(t), display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                  border: hovered?.symbol === el.symbol ? '2px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                }}>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#fff' }}>{el.symbol}</span>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.8)' }}>{val.toFixed(mode === 'Atomic Radius' ? 0 : mode === 'Electronegativity' ? 2 : 0)}</span>
              </div>
            );
          })}
        </div>
      </div>
      {hovered && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)' }}>
          <b style={{ color: 'var(--orange)' }}>{hovered.symbol}</b> — Radius: {hovered.radius} pm | EN: {hovered.en} | IE: {hovered.ie} kJ/mol
        </div>
      )}
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>{mode}:</b> {trendText[mode]}
      </div>
    </div>
  );
}
