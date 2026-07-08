'use client';
import { useState } from 'react';

export default function RustingExperiment() {
  const [days, setDays] = useState(0);
  const [showControl, setShowControl] = useState(false);

  const rustLevel = Math.min(1, days / 7);

  const tubes = [
    { label: 'Tube 1', condition: 'Dry air (no water)', hasWater: false, hasAir: true, rusts: false, control: 'Controls: Water absent' },
    { label: 'Tube 2', condition: 'Boiled water + oil layer (no air)', hasWater: true, hasAir: false, rusts: false, control: 'Controls: Air absent' },
    { label: 'Tube 3', condition: 'Water + Air', hasWater: true, hasAir: true, rusts: true, control: 'Both water and air present → Rusting!' },
  ];

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Rusting Experiment</h3>
      <div style={{ marginBottom: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Time: Day {days} of 7</label>
        <input type="range" min={0} max={7} value={days} onChange={e => setDays(+e.target.value)} style={{ width: '100%', marginTop: 4 }} />
      </div>
      <button onClick={() => setShowControl(c => !c)} style={{
        marginBottom: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--text-2)',
        background: showControl ? 'var(--orange)' : 'var(--surface-2)', color: showControl ? '#fff' : 'var(--text-1)',
        cursor: 'pointer', fontSize: 12,
      }}>
        {showControl ? 'Hide' : 'Show'} control variables
      </button>
      <svg viewBox="0 0 560 240" style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }}>
        {tubes.map((tube, i) => {
          const x = 60 + i * 160;
          const tubeColor = tube.hasWater ? 'rgba(100,160,220,0.4)' : 'rgba(200,220,240,0.2)';
          const rustColor = `rgba(180,80,20,${tube.rusts ? rustLevel * 0.9 : 0})`;
          const nailRust = tube.rusts ? rustLevel : 0;

          return (
            <g key={i}>
              {/* Test tube */}
              <rect x={x} y={40} width={60} height={160} rx={10} fill={tubeColor} stroke="#888" strokeWidth={2} />
              {/* Iron nail */}
              <rect x={x + 25} y={50} width={10} height={100} rx={3}
                fill={`rgb(${Math.round(120 + nailRust * 60)},${Math.round(120 - nailRust * 50)},${Math.round(120 - nailRust * 60)})`} />
              <rect x={x + 20} y={50} width={20} height={6} rx={2} fill="#888" />
              {/* Rust overlay */}
              {tube.rusts && days > 0 && (
                <rect x={x + 25} y={55} width={10} height={90} rx={3} fill={rustColor} />
              )}
              {/* Oil layer on tube 2 */}
              {!tube.hasAir && tube.hasWater && (
                <rect x={x + 2} y={42} width={56} height={15} rx={8} fill="rgba(255,220,100,0.5)" stroke="rgba(200,160,0,0.5)" strokeWidth={1} />
              )}
              {/* Desiccant in tube 1 */}
              {!tube.hasWater && (
                <rect x={x + 5} y={185} width={50} height={12} rx={3} fill="rgba(200,200,200,0.5)" />
              )}
              <text x={x + 30} y={218} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text-1)">{tube.label}</text>
              <text x={x + 30} y={230} textAnchor="middle" fontSize="9" fill="var(--text-2)">{tube.rusts && days > 0 ? '🔴 RUST' : '✓ No rust'}</text>
              {showControl && (
                <text x={x + 30} y={10} textAnchor="middle" fontSize="8" fill={tube.rusts ? 'var(--orange)' : '#16a34a'}>{tube.control.split(' ').slice(0, 3).join(' ')}</text>
              )}
            </g>
          );
        })}
        {tubes.map((tube, i) => {
          const x = 60 + i * 160 + 30;
          return (
            <text key={`cond${i}`} x={x} y={28} textAnchor="middle" fontSize="9" fill="var(--text-2)">{tube.condition.split(' ').slice(0, 2).join(' ')}</text>
          );
        })}
      </svg>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>4Fe + 3O₂ + 6H₂O → 4Fe(OH)₃</b> (rust) — Both water AND air needed
      </div>
    </div>
  );
}
