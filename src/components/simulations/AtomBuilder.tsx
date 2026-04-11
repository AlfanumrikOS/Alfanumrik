'use client';
import { useState, useEffect, useRef } from 'react';

const ELEMENTS: Record<number, string> = {
  1:'Hydrogen',2:'Helium',3:'Lithium',4:'Beryllium',5:'Boron',6:'Carbon',7:'Nitrogen',8:'Oxygen',
  9:'Fluorine',10:'Neon',11:'Sodium',12:'Magnesium',13:'Aluminium',14:'Silicon',15:'Phosphorus',
  16:'Sulfur',17:'Chlorine',18:'Argon',19:'Potassium',20:'Calcium',
};

function fillShells(electrons: number) {
  const caps = [2, 8, 8];
  const shells: number[] = [];
  let rem = electrons;
  for (const cap of caps) { const n = Math.min(rem, cap); shells.push(n); rem -= n; if (rem <= 0) break; }
  return shells;
}

export default function AtomBuilder() {
  const [protons, setProtons] = useState(6);
  const [neutrons, setNeutrons] = useState(6);
  const [electrons, setElectrons] = useState(6);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const name = ELEMENTS[protons] || 'Unknown';
  const charge = protons - electrons;
  const A = protons + neutrons;
  const stable = Math.abs(neutrons - protons) <= Math.max(1, protons * 0.3);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    // Nucleus
    const nr = Math.max(18, (protons + neutrons) * 1.2);
    for (let i = 0; i < protons + neutrons; i++) {
      const angle = (i / (protons + neutrons)) * Math.PI * 2;
      const r2 = nr * 0.5;
      const nx = cx + Math.cos(angle) * r2;
      const ny = cy + Math.sin(angle) * r2;
      ctx.beginPath(); ctx.arc(nx, ny, 5, 0, Math.PI * 2);
      ctx.fillStyle = i < protons ? '#ef4444' : '#9ca3af'; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, nr, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(150,150,150,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    // Shells
    const shells = fillShells(electrons);
    const shellRadii = [55, 90, 125];
    shells.forEach((count, si) => {
      const sr = shellRadii[si];
      ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(100,130,200,0.3)'; ctx.lineWidth = 1; ctx.stroke();
      for (let e = 0; e < count; e++) {
        const angle = (e / count) * Math.PI * 2 - Math.PI / 2;
        const ex = cx + Math.cos(angle) * sr;
        const ey = cy + Math.sin(angle) * sr;
        ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#60a5fa'; ctx.fill();
      }
    });
  }, [protons, neutrons, electrons]);

  const adj = (setter: React.Dispatch<React.SetStateAction<number>>, delta: number, min: number, max: number) =>
    setter(v => Math.max(min, Math.min(max, v + delta)));

  const btnStyle = (color: string) => ({
    padding: '4px 12px', borderRadius: 6, border: 'none', background: color,
    color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14,
  });

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Atom Builder</h3>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Protons', val: protons, setter: setProtons, color: '#ef4444' },
          { label: 'Neutrons', val: neutrons, setter: setNeutrons, color: '#9ca3af' },
          { label: 'Electrons', val: electrons, setter: setElectrons, color: '#60a5fa' },
        ].map(({ label, val, setter, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface-2)', borderRadius: 8, padding: '6px 10px' }}>
            <button style={btnStyle(color)} onClick={() => adj(setter, -1, 0, 30)}>−</button>
            <span style={{ minWidth: 60, textAlign: 'center', fontSize: 13, color: 'var(--text-1)' }}>
              <b style={{ color }}>{val}</b> {label}
            </span>
            <button style={btnStyle(color)} onClick={() => adj(setter, 1, 0, 30)}>+</button>
          </div>
        ))}
      </div>
      <canvas ref={canvasRef} width={560} height={260} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 120, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ color: 'var(--text-2)' }}>Element</div>
          <div style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 14 }}>{protons > 0 && protons <= 20 ? name : 'Unknown'}</div>
          <div style={{ color: 'var(--text-2)' }}>Z={protons}, A={A}</div>
          {charge !== 0 && <div style={{ color: 'var(--orange)' }}>Charge: {charge > 0 ? '+' : ''}{charge}</div>}
        </div>
        <div style={{ flex: 1, minWidth: 120, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ color: 'var(--text-2)' }}>Electron config</div>
          <div style={{ fontWeight: 700, color: '#60a5fa' }}>{fillShells(electrons).join(' | ')}</div>
          <div style={{ color: stable ? '#16a34a' : 'var(--orange)' }}>{stable ? 'Stable nucleus' : 'Unstable nucleus'}</div>
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        <b style={{ color: 'var(--orange)' }}>A = Z + N</b> &nbsp;|&nbsp; Charge = Z − electrons
      </div>
    </div>
  );
}
