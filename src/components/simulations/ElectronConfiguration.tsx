'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export const metadata = {
  id: 'electron-configuration',
  name: 'Electron Configuration',
  subject: 'Chemistry',
  grade: '11-12',
  description: "Visualize electron filling in orbitals following Aufbau principle and Hund's rule",
};

// First 36 elements
const ELEMENTS: { name: string; symbol: string }[] = [
  { name: 'Hydrogen', symbol: 'H' },
  { name: 'Helium', symbol: 'He' },
  { name: 'Lithium', symbol: 'Li' },
  { name: 'Beryllium', symbol: 'Be' },
  { name: 'Boron', symbol: 'B' },
  { name: 'Carbon', symbol: 'C' },
  { name: 'Nitrogen', symbol: 'N' },
  { name: 'Oxygen', symbol: 'O' },
  { name: 'Fluorine', symbol: 'F' },
  { name: 'Neon', symbol: 'Ne' },
  { name: 'Sodium', symbol: 'Na' },
  { name: 'Magnesium', symbol: 'Mg' },
  { name: 'Aluminium', symbol: 'Al' },
  { name: 'Silicon', symbol: 'Si' },
  { name: 'Phosphorus', symbol: 'P' },
  { name: 'Sulfur', symbol: 'S' },
  { name: 'Chlorine', symbol: 'Cl' },
  { name: 'Argon', symbol: 'Ar' },
  { name: 'Potassium', symbol: 'K' },
  { name: 'Calcium', symbol: 'Ca' },
  { name: 'Scandium', symbol: 'Sc' },
  { name: 'Titanium', symbol: 'Ti' },
  { name: 'Vanadium', symbol: 'V' },
  { name: 'Chromium', symbol: 'Cr' },
  { name: 'Manganese', symbol: 'Mn' },
  { name: 'Iron', symbol: 'Fe' },
  { name: 'Cobalt', symbol: 'Co' },
  { name: 'Nickel', symbol: 'Ni' },
  { name: 'Copper', symbol: 'Cu' },
  { name: 'Zinc', symbol: 'Zn' },
  { name: 'Gallium', symbol: 'Ga' },
  { name: 'Germanium', symbol: 'Ge' },
  { name: 'Arsenic', symbol: 'As' },
  { name: 'Selenium', symbol: 'Se' },
  { name: 'Bromine', symbol: 'Br' },
  { name: 'Krypton', symbol: 'Kr' },
];

// Aufbau order orbitals (capacity, label)
const ORBITALS: { label: string; cap: number; shell: number }[] = [
  { label: '1s', cap: 2, shell: 1 },
  { label: '2s', cap: 2, shell: 2 },
  { label: '2p', cap: 6, shell: 2 },
  { label: '3s', cap: 2, shell: 3 },
  { label: '3p', cap: 6, shell: 3 },
  { label: '4s', cap: 2, shell: 4 },
  { label: '3d', cap: 10, shell: 3 },
];

// Special cases: Cr (24) and Cu (29)
function getElectronCounts(z: number): number[] {
  // Returns electrons in each orbital slot per ORBITALS order
  const counts = new Array(ORBITALS.length).fill(0);
  let remaining = z;

  // Special cases
  if (z === 24) { // Cr: [Ar] 3d5 4s1 instead of 3d4 4s2
    counts[0] = 2; counts[1] = 2; counts[2] = 6;
    counts[3] = 2; counts[4] = 6; counts[5] = 1; counts[6] = 5;
    return counts;
  }
  if (z === 29) { // Cu: [Ar] 3d10 4s1 instead of 3d9 4s2
    counts[0] = 2; counts[1] = 2; counts[2] = 6;
    counts[3] = 2; counts[4] = 6; counts[5] = 1; counts[6] = 10;
    return counts;
  }

  for (let i = 0; i < ORBITALS.length && remaining > 0; i++) {
    const fill = Math.min(remaining, ORBITALS[i].cap);
    counts[i] = fill;
    remaining -= fill;
  }
  return counts;
}

function buildConfigString(counts: number[]): string {
  return ORBITALS
    .map((orb, i) => counts[i] > 0 ? `${orb.label}${superscript(counts[i])}` : '')
    .filter(Boolean)
    .join(' ');
}

function superscript(n: number): string {
  const sup: Record<number, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', 10: '¹⁰' };
  return sup[n] ?? String(n);
}

export default function ElectronConfiguration() {
  const [atomicNumber, setAtomicNumber] = useState(6); // Carbon default
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const el = ELEMENTS[atomicNumber - 1];
  const counts = getElectronCounts(atomicNumber);
  const configStr = buildConfigString(counts);

  const drawOrbitalDiagram = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    const boxW = 30;
    const boxH = 28;
    const startX = 10;
    const startY = 24;
    const gap = 6;

    // Group orbitals into rows: row1 = 1s, row2 = 2s 2p, row3 = 3s 3p, row4 = 4s 3d
    const rows: { label: string; orbIdx: number; subBoxes: number }[][] = [
      [{ label: '1s', orbIdx: 0, subBoxes: 1 }],
      [{ label: '2s', orbIdx: 1, subBoxes: 1 }, { label: '2p', orbIdx: 2, subBoxes: 3 }],
      [{ label: '3s', orbIdx: 3, subBoxes: 1 }, { label: '3p', orbIdx: 4, subBoxes: 3 }],
      [{ label: '4s', orbIdx: 5, subBoxes: 1 }, { label: '3d', orbIdx: 6, subBoxes: 5 }],
    ];

    rows.forEach((row, rowIdx) => {
      let curX = startX;
      const y = startY + rowIdx * (boxH + 10);

      row.forEach(group => {
        const orbCount = counts[group.orbIdx];
        // How many electrons per box (Hund's rule: fill all boxes once before pairing)
        const boxCount = group.subBoxes;
        const electronPerBox: number[] = new Array(boxCount).fill(0);
        // First pass: single electrons
        for (let e = 0; e < Math.min(orbCount, boxCount); e++) electronPerBox[e] = 1;
        // Second pass: pairing
        for (let e = boxCount; e < orbCount; e++) electronPerBox[e - boxCount] = 2;

        // Label above group
        ctx.font = 'bold 9px monospace';
        ctx.fillStyle = '#334155';
        ctx.textAlign = 'left';
        ctx.fillText(group.label, curX, y - 4);

        for (let b = 0; b < boxCount; b++) {
          const bx = curX + b * (boxW + 2);
          const elCount = electronPerBox[b];

          // Box
          const filled = orbCount > 0;
          ctx.fillStyle = filled ? 'rgba(249, 115, 22, 0.08)' : '#fff';
          ctx.strokeStyle = filled ? '#F97316' : '#cbd5e1';
          ctx.lineWidth = filled ? 1.5 : 1;
          ctx.beginPath();
          ctx.roundRect(bx, y, boxW, boxH, 3);
          ctx.fill();
          ctx.stroke();

          // Up arrow
          if (elCount >= 1) {
            ctx.fillStyle = '#7c3aed';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('↑', bx + boxW / 2 - 5, y + boxH - 6);
          }
          // Down arrow
          if (elCount >= 2) {
            ctx.fillStyle = '#F97316';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('↓', bx + boxW / 2 + 5, y + boxH - 6);
          }

          // Electron count text
          ctx.font = '7px sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.textAlign = 'right';
          ctx.fillText(String(elCount), bx + boxW - 2, y + 9);
        }

        curX += boxCount * (boxW + 2) + gap;
      });
    });
  }, [counts]);

  useEffect(() => {
    drawOrbitalDiagram();
  }, [drawOrbitalDiagram]);

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 520, margin: '0 auto', padding: '0 4px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>Electron Configuration</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>Aufbau Principle + Hund's Rule — CBSE Class 11-12</div>
      </div>

      {/* Element Card */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px', background: 'linear-gradient(135deg, #faf5ff, #fff7ed)', borderRadius: 12, border: '1px solid #e9d5ff', marginBottom: 12 }}>
        <div style={{ width: 64, height: 64, borderRadius: 12, background: '#7c3aed', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.7)', lineHeight: 1 }}>{atomicNumber}</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{el.symbol}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>{el.name}</div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Z = {atomicNumber} | Electrons = {atomicNumber}</div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#7c3aed', marginTop: 4, wordBreak: 'break-all' }}>{configStr}</div>
        </div>
      </div>

      {/* Orbital Diagram */}
      <div style={{ background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 12, overflow: 'hidden' }}>
        <div style={{ padding: '6px 10px 0', fontSize: 10, fontWeight: 600, color: '#334155' }}>
          Orbital Diagram (↑ = spin-up, ↓ = spin-down)
        </div>
        <canvas
          ref={canvasRef}
          width={490}
          height={180}
          style={{ width: '100%', display: 'block' }}
          role="img"
          aria-label={`Orbital diagram for ${el.name}: ${configStr}`}
        />
      </div>

      {/* Slider */}
      <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
          <span>Atomic Number (Z)</span>
          <span style={{ color: '#7c3aed' }}>Z = {atomicNumber}</span>
        </div>
        <input
          type="range"
          min={1}
          max={36}
          step={1}
          value={atomicNumber}
          onChange={e => setAtomicNumber(Number(e.target.value))}
          aria-label={`Atomic number: ${atomicNumber}`}
          style={{ width: '100%', accentColor: '#7c3aed' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94a3b8', marginTop: 2 }}>
          <span>H (1)</span>
          <span>Kr (36)</span>
        </div>
      </div>

      {/* Quick-pick buttons */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Quick pick:</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {[1, 6, 8, 10, 11, 17, 18, 20, 24, 26, 29, 36].map(z => (
            <button
              key={z}
              onClick={() => setAtomicNumber(z)}
              style={{
                padding: '4px 8px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
                border: `1px solid ${atomicNumber === z ? '#7c3aed' : '#e2e8f0'}`,
                background: atomicNumber === z ? '#7c3aed' : '#fff',
                color: atomicNumber === z ? '#fff' : '#334155',
                fontWeight: atomicNumber === z ? 700 : 400,
                minHeight: 28,
              }}
            >
              {ELEMENTS[z - 1].symbol}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 10, color: '#64748b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#7c3aed', fontSize: 14, fontWeight: 700 }}>↑</span>
          <span>Spin-up (first electron)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#F97316', fontSize: 14, fontWeight: 700 }}>↓</span>
          <span>Spin-down (paired)</span>
        </div>
      </div>
    </div>
  );
}
