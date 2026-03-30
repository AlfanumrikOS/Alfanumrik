'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Bohr Atomic Model Simulation
 *
 * Interactive visualization of Bohr's model for first 20 elements.
 * Shows electron shells, energy levels, electron configuration.
 * Electrons orbit the nucleus with correct shell distribution (2, 8, 8, 2).
 */

const ELEMENTS = [
  { z: 1, symbol: 'H', name: 'Hydrogen', config: [1] },
  { z: 2, symbol: 'He', name: 'Helium', config: [2] },
  { z: 3, symbol: 'Li', name: 'Lithium', config: [2, 1] },
  { z: 4, symbol: 'Be', name: 'Beryllium', config: [2, 2] },
  { z: 5, symbol: 'B', name: 'Boron', config: [2, 3] },
  { z: 6, symbol: 'C', name: 'Carbon', config: [2, 4] },
  { z: 7, symbol: 'N', name: 'Nitrogen', config: [2, 5] },
  { z: 8, symbol: 'O', name: 'Oxygen', config: [2, 6] },
  { z: 9, symbol: 'F', name: 'Fluorine', config: [2, 7] },
  { z: 10, symbol: 'Ne', name: 'Neon', config: [2, 8] },
  { z: 11, symbol: 'Na', name: 'Sodium', config: [2, 8, 1] },
  { z: 12, symbol: 'Mg', name: 'Magnesium', config: [2, 8, 2] },
  { z: 13, symbol: 'Al', name: 'Aluminium', config: [2, 8, 3] },
  { z: 14, symbol: 'Si', name: 'Silicon', config: [2, 8, 4] },
  { z: 15, symbol: 'P', name: 'Phosphorus', config: [2, 8, 5] },
  { z: 16, symbol: 'S', name: 'Sulphur', config: [2, 8, 6] },
  { z: 17, symbol: 'Cl', name: 'Chlorine', config: [2, 8, 7] },
  { z: 18, symbol: 'Ar', name: 'Argon', config: [2, 8, 8] },
  { z: 19, symbol: 'K', name: 'Potassium', config: [2, 8, 8, 1] },
  { z: 20, symbol: 'Ca', name: 'Calcium', config: [2, 8, 8, 2] },
];

const SHELL_NAMES = ['K', 'L', 'M', 'N'];
const SHELL_MAX = [2, 8, 18, 32];
const SHELL_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6'];

export default function BohrModel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  const [elementIdx, setElementIdx] = useState(5); // Carbon default
  const [showLabels, setShowLabels] = useState(true);
  const [speed, setSpeed] = useState(1);

  const element = ELEMENTS[elementIdx];

  const draw = useCallback((canvas: HTMLCanvasElement, t: number) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const cx = w / 2;
    const cy = h / 2 - 10;
    const maxRadius = Math.min(w, h) / 2 - 30;

    // Background
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius + 40);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(0.6, '#1e293b');
    bgGrad.addColorStop(1, '#0f172a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const shellCount = element.config.length;
    const shellGap = maxRadius / (shellCount + 0.5);

    // Draw shells (orbits)
    for (let s = 0; s < shellCount; s++) {
      const r = shellGap * (s + 1);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `${SHELL_COLORS[s]}40`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Shell label
      if (showLabels) {
        ctx.fillStyle = `${SHELL_COLORS[s]}90`;
        ctx.font = '10px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(`${SHELL_NAMES[s]} (n=${s + 1})`, cx + r + 5, cy - 5);
      }

      // Draw electrons in this shell
      const eCount = element.config[s];
      const orbitalSpeed = (0.5 + (shellCount - s) * 0.3) * speed;

      for (let e = 0; e < eCount; e++) {
        const angle = (2 * Math.PI * e / eCount) + t * orbitalSpeed;
        const ex = cx + r * Math.cos(angle);
        const ey = cy + r * Math.sin(angle);

        // Electron glow
        const eGlow = ctx.createRadialGradient(ex, ey, 0, ex, ey, 8);
        eGlow.addColorStop(0, '#60a5fa');
        eGlow.addColorStop(0.5, '#3b82f680');
        eGlow.addColorStop(1, 'transparent');
        ctx.fillStyle = eGlow;
        ctx.fillRect(ex - 8, ey - 8, 16, 16);

        // Electron dot
        ctx.beginPath();
        ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#93c5fd';
        ctx.fill();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Nucleus
    const nucleusR = 12 + element.z * 0.5;
    const nGrad = ctx.createRadialGradient(cx - 3, cy - 3, 0, cx, cy, nucleusR);
    nGrad.addColorStop(0, '#fbbf24');
    nGrad.addColorStop(0.5, '#f59e0b');
    nGrad.addColorStop(1, '#d97706');
    ctx.beginPath();
    ctx.arc(cx, cy, nucleusR, 0, Math.PI * 2);
    ctx.fillStyle = nGrad;
    ctx.fill();

    // Nucleus glow
    const nGlow = ctx.createRadialGradient(cx, cy, nucleusR, cx, cy, nucleusR + 15);
    nGlow.addColorStop(0, '#f59e0b40');
    nGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = nGlow;
    ctx.beginPath();
    ctx.arc(cx, cy, nucleusR + 15, 0, Math.PI * 2);
    ctx.fill();

    // Nucleus label
    ctx.fillStyle = '#451a03';
    ctx.font = `bold ${Math.max(10, 14 - element.z * 0.2)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${element.z}+`, cx, cy);

    // Element info (top)
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 16px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${element.symbol} — ${element.name}`, cx, 22);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px system-ui';
    ctx.fillText(`Atomic Number: ${element.z} | Electrons: ${element.z} | Shells: ${shellCount}`, cx, 40);

    // Configuration
    const configStr = element.config.map((n, i) => `${SHELL_NAMES[i]}:${n}`).join(', ');
    ctx.fillStyle = '#67e8f9';
    ctx.font = '12px system-ui';
    ctx.fillText(`Configuration: ${configStr}`, cx, h - 8);

  }, [element, showLabels, speed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const animate = (time: number) => {
      timeRef.current = time / 1000;
      draw(canvas, timeRef.current);
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const valenceElectrons = element.config[element.config.length - 1];
  const isMetal = valenceElectrons <= 3 && element.z > 2;
  const isNobleGas = element.config[element.config.length - 1] === SHELL_MAX[element.config.length - 1] || element.z === 2;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Bohr atomic model visualization showing electron shells and orbits"
        style={{ width: '100%', height: 280, borderRadius: 12, background: '#0f172a' }}
      />

      {/* Element selector */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(10, 1fr)',
        gap: 3,
        margin: '10px 0',
      }}>
        {ELEMENTS.map((el, i) => (
          <button
            key={el.z}
            onClick={() => setElementIdx(i)}
            aria-label={`Select element ${el.symbol}, atomic number ${el.z}`}
            style={{
              padding: '4px 0',
              borderRadius: 6,
              border: i === elementIdx ? '2px solid #3b82f6' : '1px solid #33415540',
              background: i === elementIdx ? '#1e3a5f' : '#1e293b',
              color: i === elementIdx ? '#93c5fd' : '#94a3b8',
              fontSize: 11,
              fontWeight: i === elementIdx ? 700 : 400,
              cursor: 'pointer',
            }}
          >
            {el.symbol}
          </button>
        ))}
      </div>

      {/* Info cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
        <div style={{ padding: '6px 8px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 11, textAlign: 'center' }}>
          <div style={{ color: '#16a34a', fontWeight: 700 }}>Valence e⁻</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#15803d' }}>{valenceElectrons}</div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', fontSize: 11, textAlign: 'center' }}>
          <div style={{ color: '#b45309', fontWeight: 700 }}>Type</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e' }}>{isNobleGas ? 'Noble Gas' : isMetal ? 'Metal' : 'Non-metal'}</div>
        </div>
        <div style={{ padding: '6px 8px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe', fontSize: 11, textAlign: 'center' }}>
          <div style={{ color: '#2563eb', fontWeight: 700 }}>Valency</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1d4ed8' }}>
            {isNobleGas ? 0 : valenceElectrons <= 4 ? valenceElectrons : 8 - valenceElectrons}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
          Speed:
          <input type="range" min={0.1} max={3} step={0.1} value={speed}
            onChange={e => setSpeed(+e.target.value)}
            aria-label={`Electron orbit speed slider, ${speed.toFixed(1)}, range 0.1 to 3`}
            style={{ flex: 1 }}
          />
        </label>
        <button
          onClick={() => setShowLabels(!showLabels)}
          aria-label={`Toggle shell labels, currently ${showLabels ? 'on' : 'off'}`}
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            border: `1px solid ${showLabels ? '#3b82f6' : '#d4d4d8'}`,
            background: showLabels ? '#eff6ff' : '#fff',
            color: showLabels ? '#3b82f6' : '#71717a',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Labels {showLabels ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  );
}
