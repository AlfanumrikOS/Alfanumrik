'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export const metadata = {
  id: 'electrochemical-cell',
  name: 'Electrochemical Cell',
  subject: 'Chemistry',
  grade: '11-12',
  description: 'Explore galvanic cells — electron flow, electrode reactions, and cell potential',
};

/**
 * Electrochemical Cell (Daniell Cell) Simulation
 *
 * CBSE Class 12, Chapter 3: Electrochemistry
 * Board Exam Relevance: HIGH
 *
 * Demonstrates:
 * - Galvanic cell construction (two half-cells + salt bridge)
 * - Oxidation at anode (Zn → Zn²⁺ + 2e⁻)
 * - Reduction at cathode (Cu²⁺ + 2e⁻ → Cu)
 * - Electron flow through external wire
 * - Ion flow through salt bridge
 * - EMF calculation: E°cell = E°cathode − E°anode
 * - Nernst equation display
 */

interface ElectrodePair {
  id: string;
  label: string;
  anode: { metal: string; ion: string; solution: string; color: string; eStd: number };
  cathode: { metal: string; ion: string; solution: string; color: string; eStd: number };
  emf: number;
}

const ELECTRODE_PAIRS: ElectrodePair[] = [
  {
    id: 'zn_cu',
    label: 'Zn | Cu (Daniell Cell)',
    anode: { metal: 'Zn', ion: 'Zn²⁺', solution: 'ZnSO₄ (1M)', color: 'rgba(200, 200, 200, 0.15)', eStd: -0.76 },
    cathode: { metal: 'Cu', ion: 'Cu²⁺', solution: 'CuSO₄ (1M)', color: 'rgba(64, 140, 255, 0.25)', eStd: 0.34 },
    emf: 1.1,
  },
  {
    id: 'zn_ag',
    label: 'Zn | Ag',
    anode: { metal: 'Zn', ion: 'Zn²⁺', solution: 'ZnSO₄ (1M)', color: 'rgba(200, 200, 200, 0.15)', eStd: -0.76 },
    cathode: { metal: 'Ag', ion: 'Ag⁺', solution: 'AgNO₃ (1M)', color: 'rgba(200, 200, 200, 0.1)', eStd: 0.80 },
    emf: 1.56,
  },
  {
    id: 'fe_cu',
    label: 'Fe | Cu',
    anode: { metal: 'Fe', ion: 'Fe²⁺', solution: 'FeSO₄ (1M)', color: 'rgba(180, 220, 180, 0.15)', eStd: -0.44 },
    cathode: { metal: 'Cu', ion: 'Cu²⁺', solution: 'CuSO₄ (1M)', color: 'rgba(64, 140, 255, 0.25)', eStd: 0.34 },
    emf: 0.78,
  },
  {
    id: 'mg_cu',
    label: 'Mg | Cu',
    anode: { metal: 'Mg', ion: 'Mg²⁺', solution: 'MgSO₄ (1M)', color: 'rgba(200, 200, 200, 0.1)', eStd: -2.37 },
    cathode: { metal: 'Cu', ion: 'Cu²⁺', solution: 'CuSO₄ (1M)', color: 'rgba(64, 140, 255, 0.25)', eStd: 0.34 },
    emf: 2.71,
  },
];

interface AnimParticle {
  x: number;
  y: number;
  progress: number;
  speed: number;
  type: 'electron' | 'cation' | 'anion';
}

function createParticles(count: number, type: AnimParticle['type']): AnimParticle[] {
  return Array.from({ length: count }, () => ({
    x: 0, y: 0,
    progress: Math.random(),
    speed: 0.003 + Math.random() * 0.004,
    type,
  }));
}

export default function ElectrochemicalCell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  const [pairIdx, setPairIdx] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [showNernst, setShowNernst] = useState(false);
  const [concentration, setConcentration] = useState(1.0); // M for Nernst demo

  const electronsRef = useRef<AnimParticle[]>(createParticles(12, 'electron'));
  const cationsRef = useRef<AnimParticle[]>(createParticles(6, 'cation'));
  const anionsRef = useRef<AnimParticle[]>(createParticles(6, 'anion'));

  const pair = ELECTRODE_PAIRS[pairIdx];

  // Nernst: E = E° - (RT/nF) * ln(Q) ; simplified at 298K: E = E° - (0.0592/n) * log([anode ion]/[cathode ion])
  const nernstEmf = pair.emf - (0.0592 / 2) * Math.log10(concentration / 1.0);

  const drawScene = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    const dpr = window.devicePixelRatio || 1;
    const cw = w / dpr;
    const ch = h / dpr;

    // Background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, cw, ch);

    // Title
    ctx.font = 'bold 14px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220, 180, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.fillText(`Electrochemical Cell: ${pair.label}`, cw / 2, 18);

    // Layout
    const cellTop = 50;
    const cellH = ch * 0.48;
    const cellW = cw * 0.32;
    const gap = cw * 0.12;
    const anodeLeft = cw * 0.08;
    const cathodeLeft = cw - cw * 0.08 - cellW;
    const bridgeMidY = cellTop + 20;

    // --- Anode beaker ---
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(anodeLeft, cellTop, cellW, cellH);
    // Solution fill
    const solnTop = cellTop + cellH * 0.2;
    ctx.fillStyle = pair.anode.color;
    ctx.fillRect(anodeLeft + 1, solnTop, cellW - 2, cellH - (solnTop - cellTop) - 1);

    // Anode electrode (plate)
    const anodeElX = anodeLeft + cellW * 0.5;
    ctx.fillStyle = '#a0a0a0';
    ctx.fillRect(anodeElX - 4, cellTop - 8, 8, cellH * 0.75);
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#ef4444';
    ctx.textAlign = 'center';
    ctx.fillText(`${pair.anode.metal} (Anode)`, anodeLeft + cellW / 2, cellTop + cellH + 14);
    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Oxidation', anodeLeft + cellW / 2, cellTop + cellH + 26);
    ctx.fillText(`${pair.anode.metal} → ${pair.anode.ion} + 2e⁻`, anodeLeft + cellW / 2, cellTop + cellH + 38);

    // Solution label
    ctx.font = '9px sans-serif';
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.fillText(pair.anode.solution, anodeLeft + cellW / 2, cellTop + cellH - 8);

    // --- Cathode beaker ---
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cathodeLeft, cellTop, cellW, cellH);
    ctx.fillStyle = pair.cathode.color;
    ctx.fillRect(cathodeLeft + 1, solnTop, cellW - 2, cellH - (solnTop - cellTop) - 1);

    // Cathode electrode
    const cathodeElX = cathodeLeft + cellW * 0.5;
    ctx.fillStyle = pair.cathode.metal === 'Cu' ? '#b87333' : pair.cathode.metal === 'Ag' ? '#c0c0c0' : '#a0a0a0';
    ctx.fillRect(cathodeElX - 4, cellTop - 8, 8, cellH * 0.75);
    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#22c55e';
    ctx.textAlign = 'center';
    ctx.fillText(`${pair.cathode.metal} (Cathode)`, cathodeLeft + cellW / 2, cellTop + cellH + 14);
    ctx.font = '9px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Reduction', cathodeLeft + cellW / 2, cellTop + cellH + 26);
    ctx.fillText(`${pair.cathode.ion} + 2e⁻ → ${pair.cathode.metal}`, cathodeLeft + cellW / 2, cellTop + cellH + 38);

    ctx.font = '9px sans-serif';
    ctx.fillStyle = 'rgba(200, 200, 200, 0.7)';
    ctx.fillText(pair.cathode.solution, cathodeLeft + cellW / 2, cellTop + cellH - 8);

    // --- Salt Bridge ---
    const bridgeLeft = anodeLeft + cellW;
    const bridgeRight = cathodeLeft;
    const bridgeW = bridgeRight - bridgeLeft;

    // U-tube shape
    ctx.beginPath();
    ctx.moveTo(bridgeLeft + 5, solnTop + 15);
    ctx.lineTo(bridgeLeft + 5, bridgeMidY);
    ctx.lineTo(bridgeRight - 5, bridgeMidY);
    ctx.lineTo(bridgeRight - 5, solnTop + 15);
    ctx.strokeStyle = 'rgba(255, 200, 100, 0.5)';
    ctx.lineWidth = 8;
    ctx.stroke();
    // Inner fill
    ctx.beginPath();
    ctx.moveTo(bridgeLeft + 5, solnTop + 15);
    ctx.lineTo(bridgeLeft + 5, bridgeMidY);
    ctx.lineTo(bridgeRight - 5, bridgeMidY);
    ctx.lineTo(bridgeRight - 5, solnTop + 15);
    ctx.strokeStyle = 'rgba(255, 220, 150, 0.2)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.font = '8px sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.fillText('Salt Bridge (KCl)', cw / 2, bridgeMidY - 6);

    // --- External Wire ---
    const wireY = cellTop - 18;
    ctx.beginPath();
    ctx.moveTo(anodeElX, cellTop - 8);
    ctx.lineTo(anodeElX, wireY);
    ctx.lineTo(cathodeElX, wireY);
    ctx.lineTo(cathodeElX, cellTop - 8);
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Arrow showing electron direction on wire (anode → cathode)
    const arrowX = cw / 2;
    ctx.beginPath();
    ctx.moveTo(arrowX - 8, wireY - 5);
    ctx.lineTo(arrowX + 4, wireY - 5);
    ctx.lineTo(arrowX + 4, wireY - 9);
    ctx.lineTo(arrowX + 12, wireY - 2);
    ctx.lineTo(arrowX + 4, wireY + 5);
    ctx.lineTo(arrowX + 4, wireY + 1);
    ctx.lineTo(arrowX - 8, wireY + 1);
    ctx.closePath();
    ctx.fillStyle = '#fbbf24';
    ctx.fill();
    ctx.font = '8px sans-serif';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.fillText('e⁻ flow →', cw / 2, wireY - 10);

    // --- Voltmeter ---
    const vmX = cw / 2;
    const vmY = wireY + 2;
    const vmR = 14;
    ctx.beginPath();
    ctx.arc(vmX, vmY, vmR, 0, Math.PI * 2);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = '#22c55e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${pair.emf.toFixed(2)}V`, vmX, vmY);
    ctx.textBaseline = 'alphabetic';
    ctx.font = '7px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('V', vmX, vmY - vmR - 3);

    // --- Animated particles ---
    if (isRunning) {
      // Electrons along wire (anode to cathode)
      electronsRef.current.forEach(p => {
        p.progress = (p.progress + p.speed) % 1;
        const totalPath = (cathodeElX - anodeElX) + 20;
        const dist = p.progress * totalPath;
        // Move along the wire path
        if (dist < 10) {
          p.x = anodeElX;
          p.y = cellTop - 8 - dist;
        } else if (dist < 10 + (cathodeElX - anodeElX)) {
          p.x = anodeElX + (dist - 10);
          p.y = wireY;
        } else {
          p.x = cathodeElX;
          p.y = wireY + (dist - 10 - (cathodeElX - anodeElX));
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fbbf24';
        ctx.fill();
      });

      // Cations through salt bridge (anode side → cathode side: K⁺ moves toward cathode)
      cationsRef.current.forEach(p => {
        p.progress = (p.progress + p.speed * 0.7) % 1;
        const bLen = bridgeW - 10;
        const prog = p.progress;
        // Move along U-tube: down anode side, across, up cathode side
        if (prog < 0.3) {
          p.x = bridgeLeft + 5;
          p.y = solnTop + 15 - (prog / 0.3) * (solnTop + 15 - bridgeMidY);
        } else if (prog < 0.7) {
          const across = (prog - 0.3) / 0.4;
          p.x = bridgeLeft + 5 + across * (bridgeRight - bridgeLeft - 10);
          p.y = bridgeMidY;
        } else {
          p.x = bridgeRight - 5;
          p.y = bridgeMidY + ((prog - 0.7) / 0.3) * (solnTop + 15 - bridgeMidY);
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#3b82f6';
        ctx.fill();
      });

      // Anions through salt bridge (cathode side → anode side: Cl⁻ moves toward anode)
      anionsRef.current.forEach(p => {
        p.progress = (p.progress + p.speed * 0.7) % 1;
        const prog = p.progress;
        // Reverse direction
        if (prog < 0.3) {
          p.x = bridgeRight - 5;
          p.y = solnTop + 15 - (prog / 0.3) * (solnTop + 15 - bridgeMidY);
        } else if (prog < 0.7) {
          const across = (prog - 0.3) / 0.4;
          p.x = bridgeRight - 5 - across * (bridgeRight - bridgeLeft - 10);
          p.y = bridgeMidY;
        } else {
          p.x = bridgeLeft + 5;
          p.y = bridgeMidY + ((prog - 0.7) / 0.3) * (solnTop + 15 - bridgeMidY);
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fill();
      });

      // Dissolving ions at anode (Zn²⁺ leaving electrode)
      for (let i = 0; i < 3; i++) {
        const ix = anodeElX + Math.sin(t * 2 + i * 2.5) * 18;
        const iy = solnTop + 30 + Math.cos(t * 1.5 + i * 1.8) * 15;
        ctx.beginPath();
        ctx.arc(ix, iy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(59, 130, 246, ${0.5 + Math.sin(t * 3 + i) * 0.3})`;
        ctx.fill();
      }

      // Depositing at cathode (Cu depositing on electrode)
      for (let i = 0; i < 3; i++) {
        const dx = cathodeElX + Math.sin(t * 2.5 + i * 2) * 14;
        const dy = solnTop + 25 + Math.cos(t * 2 + i * 1.5) * 12;
        ctx.beginPath();
        ctx.arc(dx, dy, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(184, 115, 51, ${0.4 + Math.sin(t * 3.5 + i) * 0.3})`;
        ctx.fill();
      }
    }

    // Legend
    const legendY = cellTop + cellH + 48;
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'left';
    const legends = [
      { color: '#fbbf24', label: 'Electrons (e⁻)' },
      { color: '#3b82f6', label: 'Cations (K⁺)' },
      { color: '#ef4444', label: 'Anions (Cl⁻)' },
    ];
    legends.forEach((l, i) => {
      const lx = cw * 0.1 + i * cw * 0.3;
      ctx.beginPath();
      ctx.arc(lx, legendY, 3, 0, Math.PI * 2);
      ctx.fillStyle = l.color;
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(l.label, lx + 6, legendY + 3);
    });

    // E° values
    const eY = legendY + 18;
    ctx.font = '10px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'center';
    ctx.fillText(
      `E°cell = E°cathode − E°anode = (${pair.cathode.eStd.toFixed(2)}) − (${pair.anode.eStd.toFixed(2)}) = ${pair.emf.toFixed(2)} V`,
      cw / 2, eY
    );

  }, [pair, isRunning]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const animate = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      timeRef.current += 0.016;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);

      drawScene(ctx, w * dpr, h * dpr, timeRef.current);
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [drawScene]);

  return (
    <div ref={containerRef} style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6366f1' }}>Electrochemical Cell Lab</div>
        <div style={{ fontSize: 11, color: '#64748B' }}>CBSE Class 12, Ch 3: Electrochemistry</div>
      </div>

      {/* Electrode pair selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {ELECTRODE_PAIRS.map((ep, idx) => (
          <button
            key={ep.id}
            onClick={() => setPairIdx(idx)}
            style={{
              padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${pairIdx === idx ? '#6366f1' : '#e2e8f0'}`,
              background: pairIdx === idx ? '#6366f1' : '#fff',
              color: pairIdx === idx ? '#fff' : '#64748B',
              fontSize: 10, cursor: 'pointer', fontWeight: pairIdx === idx ? 600 : 400,
            }}
          >
            {ep.label}
          </button>
        ))}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Electrochemical cell showing ${pair.anode.metal} anode and ${pair.cathode.metal} cathode with electron flow and ion migration`}
        style={{ width: '100%', height: 360, borderRadius: 8, border: '1px solid #e2e8f0' }}
      />

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => setIsRunning(!isRunning)}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: isRunning ? '#ef4444' : '#22c55e',
            color: '#fff', fontWeight: 600, fontSize: 12,
            minWidth: 44, minHeight: 44,
          }}
        >
          {isRunning ? 'Pause' : 'Start'}
        </button>
        <button
          onClick={() => setShowNernst(!showNernst)}
          style={{
            padding: '8px 16px', borderRadius: 8,
            border: `1px solid ${showNernst ? '#6366f1' : '#e2e8f0'}`,
            background: showNernst ? '#6366f1' : '#fff',
            color: showNernst ? '#fff' : '#6366f1',
            fontWeight: 600, fontSize: 12, cursor: 'pointer',
            minWidth: 44, minHeight: 44,
          }}
        >
          Nernst Equation
        </button>
      </div>

      {/* EMF Display */}
      <div style={{ marginTop: 10, padding: '10px 12px', background: '#1e293b', borderRadius: 8, textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>Cell EMF (E° at standard conditions)</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e', marginTop: 2 }}>
          {pair.emf.toFixed(2)} V
        </div>
        <div style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>
          E°({pair.cathode.metal}) = {pair.cathode.eStd.toFixed(2)} V | E°({pair.anode.metal}) = {pair.anode.eStd.toFixed(2)} V
        </div>
      </div>

      {/* Cell notation */}
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#f1f5f9', borderRadius: 8, textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>Cell Notation (IUPAC)</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', fontFamily: 'monospace' }}>
          {pair.anode.metal}(s) | {pair.anode.ion}(aq) || {pair.cathode.ion}(aq) | {pair.cathode.metal}(s)
        </div>
      </div>

      {/* Nernst Equation */}
      {showNernst && (
        <div style={{ marginTop: 8, padding: '10px 12px', background: '#faf5ff', borderRadius: 8, border: '1px solid #e9d5ff' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', textAlign: 'center', marginBottom: 6 }}>
            Nernst Equation (at 298 K)
          </div>
          <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', fontFamily: 'monospace', marginBottom: 6 }}>
            E = E° - (0.0592 / n) x log₁₀([{pair.anode.ion}] / [{pair.cathode.ion}])
          </div>
          <div style={{ padding: '6px 10px', background: '#fff', borderRadius: 6, marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>
              Adjust [{pair.anode.ion}] concentration:
            </div>
            <input
              type="range"
              min={0.01}
              max={2}
              step={0.01}
              value={concentration}
              onChange={e => setConcentration(Number(e.target.value))}
              aria-label={`Anode ion concentration: ${concentration} M`}
              style={{ width: '100%', accentColor: '#7c3aed' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8' }}>
              <span>0.01 M</span>
              <span style={{ fontWeight: 600, color: '#334155' }}>{concentration.toFixed(2)} M</span>
              <span>2.00 M</span>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: 11, color: '#64748B' }}>E = {pair.emf.toFixed(2)} - (0.0296) x log₁₀({concentration.toFixed(2)}) = </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#7c3aed' }}>{nernstEmf.toFixed(3)} V</span>
          </div>
        </div>
      )}

      {/* Half-reactions summary */}
      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: '8px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#991b1b' }}>Anode (Oxidation)</div>
          <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>
            {pair.anode.metal} → {pair.anode.ion} + 2e⁻
          </div>
          <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>
            E° = {pair.anode.eStd.toFixed(2)} V
          </div>
        </div>
        <div style={{ padding: '8px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#166534' }}>Cathode (Reduction)</div>
          <div style={{ fontSize: 11, color: '#334155', marginTop: 2 }}>
            {pair.cathode.ion} + 2e⁻ → {pair.cathode.metal}
          </div>
          <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>
            E° = {pair.cathode.eStd.toFixed(2)} V
          </div>
        </div>
      </div>
    </div>
  );
}
