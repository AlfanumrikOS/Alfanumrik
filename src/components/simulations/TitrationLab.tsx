'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Titration Lab — Acid-Base Titration Simulation
 *
 * CBSE Class 11-12 Chemistry Practical (30 marks in board exams)
 * Demonstrates:
 * - KMnO4 vs Oxalic acid titration (self-indicator)
 * - HCl vs Na2CO3 titration (with indicator)
 * - M1V1 = M2V2 calculation
 * - Concordant readings detection
 * - Burette reading with meniscus awareness
 */

type Indicator = 'phenolphthalein' | 'methyl_orange' | 'self';
type TitrationType = 'kmno4_oxalic' | 'hcl_na2co3';

interface Trial {
  initial: number;
  final: number;
  volume: number;
}

const TITRATIONS: Record<TitrationType, {
  title: string;
  titleHi: string;
  titrant: string;
  analyte: string;
  titrantColor: string;
  analyteColor: string;
  endpointColor: string;
  indicator: Indicator;
  indicatorName: string;
  molarityTitrant: number;
  molarityAnalyte: number;
  volumeAnalyte: number;
  endpointVolume: number;
  nFactorRatio: number;
  equation: string;
}> = {
  kmno4_oxalic: {
    title: 'KMnO4 vs Oxalic Acid',
    titleHi: 'KMnO4 बनाम ऑक्सैलिक अम्ल',
    titrant: 'KMnO4 (0.02 M)',
    analyte: 'Oxalic Acid (0.05 M)',
    titrantColor: '#9b1d9b',
    analyteColor: 'rgba(255,255,255,0.15)',
    endpointColor: '#c44ec4',
    indicator: 'self',
    indicatorName: 'Self-indicator (KMnO4)',
    molarityTitrant: 0.02,
    molarityAnalyte: 0.05,
    volumeAnalyte: 20,
    endpointVolume: 20.0,
    nFactorRatio: 2.5,
    equation: '2KMnO4 + 5H2C2O4 + 3H2SO4 → 2MnSO4 + K2SO4 + 10CO2 + 8H2O',
  },
  hcl_na2co3: {
    title: 'HCl vs Na2CO3',
    titleHi: 'HCl बनाम Na2CO3',
    titrant: 'HCl (0.1 M)',
    analyte: 'Na2CO3 (0.05 M)',
    titrantColor: 'rgba(255,255,255,0.1)',
    analyteColor: 'rgba(255,255,255,0.15)',
    endpointColor: '#ff6b35',
    indicator: 'methyl_orange',
    indicatorName: 'Methyl Orange',
    molarityTitrant: 0.1,
    molarityAnalyte: 0.05,
    volumeAnalyte: 20,
    endpointVolume: 20.0,
    nFactorRatio: 2.0,
    equation: 'Na2CO3 + 2HCl → 2NaCl + H2O + CO2',
  },
};

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export default function TitrationLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  const [titType, setTitType] = useState<TitrationType>('kmno4_oxalic');
  const [indicator, setIndicator] = useState<Indicator>('self');
  const [stopcockOpen, setStopcockOpen] = useState(false);
  const [buretteLevel, setBuretteLevel] = useState(0); // mL dispensed
  const [initialReading, setInitialReading] = useState(0);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [showFormula, setShowFormula] = useState(false);
  const [isDripping, setIsDripping] = useState(false);
  const dripRef = useRef<number | null>(null);

  const config = TITRATIONS[titType];
  const endpointVol = config.endpointVolume;
  const progress = clamp(buretteLevel / endpointVol, 0, 1.3);
  const pastEndpoint = buretteLevel > endpointVol;

  // Update indicator when titration type changes
  useEffect(() => {
    const c = TITRATIONS[titType];
    setIndicator(c.indicator);
    setBuretteLevel(0);
    setInitialReading(0);
    setStopcockOpen(false);
    setTrials([]);
    setShowFormula(false);
  }, [titType]);

  // Dripping effect when stopcock is open
  useEffect(() => {
    if (stopcockOpen && !isDripping) {
      setIsDripping(true);
      const interval = window.setInterval(() => {
        setBuretteLevel(prev => {
          const next = prev + 0.1;
          if (next > 50) {
            setStopcockOpen(false);
            return 50;
          }
          return Math.round(next * 10) / 10;
        });
      }, 100);
      dripRef.current = interval;
      return () => window.clearInterval(interval);
    } else if (!stopcockOpen && isDripping) {
      setIsDripping(false);
      if (dripRef.current) window.clearInterval(dripRef.current);
    }
  }, [stopcockOpen, isDripping]);

  const getSolutionColor = useCallback(() => {
    if (titType === 'kmno4_oxalic') {
      // Self-indicator: colorless until endpoint, then permanent light pink/purple
      if (progress < 0.95) return `rgba(255, 240, 245, ${0.3 + progress * 0.1})`;
      if (progress < 1.0) return `rgba(200, 100, 200, ${(progress - 0.95) * 10})`;
      return '#c44ec4';
    }
    // HCl vs Na2CO3 with methyl orange
    if (indicator === 'methyl_orange') {
      // Yellow in alkaline → orange at endpoint → red/pink in acidic
      if (progress < 0.9) return '#ffc107';
      if (progress < 1.0) return `rgb(${255}, ${Math.round(193 - (progress - 0.9) * 1500)}, ${Math.round(7 - (progress - 0.9) * 70)})`;
      return '#ff6b35';
    }
    if (indicator === 'phenolphthalein') {
      // Pink in alkaline → colorless at endpoint
      if (progress < 0.9) return '#ff69b4';
      if (progress < 1.0) return `rgba(255, 105, 180, ${1 - (progress - 0.9) * 10})`;
      return 'rgba(255, 255, 255, 0.2)';
    }
    return 'rgba(255, 255, 255, 0.2)';
  }, [titType, indicator, progress]);

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
    ctx.fillText(config.title + ' Titration', cw / 2, 18);

    // === BURETTE (left-center) ===
    const buretteX = cw * 0.35;
    const buretteTop = 35;
    const buretteBot = ch * 0.55;
    const buretteW = 24;
    const buretteH = buretteBot - buretteTop;

    // Burette glass tube
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(buretteX - buretteW / 2, buretteTop, buretteW, buretteH);

    // Burette liquid level
    const maxBuretteMl = 50;
    const liquidFraction = 1 - buretteLevel / maxBuretteMl;
    const liquidTop = buretteTop + buretteH * (1 - liquidFraction);
    const liquidH = buretteH * liquidFraction;

    if (liquidFraction > 0.01) {
      ctx.fillStyle = titType === 'kmno4_oxalic' ? 'rgba(155, 29, 155, 0.7)' : 'rgba(200, 200, 200, 0.15)';
      ctx.fillRect(buretteX - buretteW / 2 + 1, liquidTop, buretteW - 2, liquidH);

      // Meniscus (concave)
      ctx.beginPath();
      ctx.moveTo(buretteX - buretteW / 2 + 1, liquidTop);
      ctx.quadraticCurveTo(buretteX, liquidTop + 4, buretteX + buretteW / 2 - 1, liquidTop);
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Burette markings (every 10 mL)
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(200, 200, 200, 0.6)';
    ctx.textAlign = 'right';
    for (let ml = 0; ml <= 50; ml += 10) {
      const y = buretteTop + (ml / maxBuretteMl) * buretteH;
      ctx.fillText(`${ml}`, buretteX - buretteW / 2 - 3, y + 3);
      ctx.beginPath();
      ctx.moveTo(buretteX - buretteW / 2, y);
      ctx.lineTo(buretteX - buretteW / 2 + 5, y);
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.4)';
      ctx.stroke();
    }

    // Current reading indicator
    const readingY = buretteTop + (buretteLevel / maxBuretteMl) * buretteH;
    ctx.beginPath();
    ctx.moveTo(buretteX + buretteW / 2 + 2, readingY);
    ctx.lineTo(buretteX + buretteW / 2 + 12, readingY - 5);
    ctx.lineTo(buretteX + buretteW / 2 + 12, readingY + 5);
    ctx.closePath();
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#ef4444';
    ctx.textAlign = 'left';
    ctx.fillText(`${buretteLevel.toFixed(1)} mL`, buretteX + buretteW / 2 + 14, readingY + 3);

    // Stopcock
    const stopcockY = buretteBot + 5;
    ctx.fillStyle = stopcockOpen ? '#22c55e' : '#ef4444';
    ctx.fillRect(buretteX - 8, stopcockY, 16, 8);
    ctx.font = '8px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(stopcockOpen ? 'OPEN' : 'CLOSED', buretteX, stopcockY + 6);

    // Nozzle / drip path
    ctx.beginPath();
    ctx.moveTo(buretteX, stopcockY + 8);
    ctx.lineTo(buretteX, stopcockY + 30);
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Drip animation
    if (stopcockOpen && buretteLevel < 50) {
      const dripY = stopcockY + 10 + ((t * 200) % 22);
      ctx.beginPath();
      ctx.arc(buretteX, dripY, 2, 0, Math.PI * 2);
      ctx.fillStyle = titType === 'kmno4_oxalic' ? '#9b1d9b' : 'rgba(200,200,200,0.5)';
      ctx.fill();
    }

    // === CONICAL FLASK (below burette) ===
    const flaskCx = buretteX;
    const flaskTop = stopcockY + 35;
    const flaskMouthW = 20;
    const flaskBodyW = 60;
    const flaskH = ch - flaskTop - 15;

    // Flask outline (trapezoid shape)
    ctx.beginPath();
    ctx.moveTo(flaskCx - flaskMouthW / 2, flaskTop);
    ctx.lineTo(flaskCx - flaskBodyW / 2, flaskTop + flaskH);
    ctx.lineTo(flaskCx + flaskBodyW / 2, flaskTop + flaskH);
    ctx.lineTo(flaskCx + flaskMouthW / 2, flaskTop);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Flask solution (fills bottom ~60%)
    const solnTop = flaskTop + flaskH * 0.35;
    const solnColor = getSolutionColor();
    ctx.beginPath();
    const solnMouthW = flaskMouthW + (flaskBodyW - flaskMouthW) * 0.35;
    ctx.moveTo(flaskCx - solnMouthW / 2, solnTop);
    ctx.lineTo(flaskCx - flaskBodyW / 2, flaskTop + flaskH);
    ctx.lineTo(flaskCx + flaskBodyW / 2, flaskTop + flaskH);
    ctx.lineTo(flaskCx + solnMouthW / 2, solnTop);
    ctx.closePath();
    ctx.fillStyle = solnColor;
    ctx.fill();

    // Swirl animation (small circles in flask)
    if (stopcockOpen) {
      for (let i = 0; i < 3; i++) {
        const sx = flaskCx + Math.sin(t * 3 + i * 2.1) * 15;
        const sy = solnTop + 20 + Math.cos(t * 2 + i * 1.7) * 10;
        ctx.beginPath();
        ctx.arc(sx, sy, 3 + Math.sin(t * 4 + i) * 1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.1 + Math.sin(t * 3 + i) * 0.05})`;
        ctx.fill();
      }
    }

    // Endpoint flash
    if (pastEndpoint && Math.sin(t * 6) > 0.5) {
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = '#22c55e';
      ctx.textAlign = 'center';
      ctx.fillText('ENDPOINT REACHED!', flaskCx, flaskTop - 5);
    }

    // === INFO PANEL (right side) ===
    const infoX = cw * 0.65;
    const infoY = 40;

    ctx.font = 'bold 11px sans-serif';
    ctx.fillStyle = '#e2e8f0';
    ctx.textAlign = 'left';
    ctx.fillText('Titration Data:', infoX, infoY);

    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#94a3b8';
    const lines = [
      `Titrant: ${config.titrant}`,
      `Analyte: ${config.analyte}`,
      `Vol. analyte: ${config.volumeAnalyte} mL`,
      `Indicator: ${config.indicatorName}`,
      '',
      `Dispensed: ${buretteLevel.toFixed(1)} mL`,
      `Endpoint: ~${endpointVol.toFixed(1)} mL`,
    ];
    lines.forEach((line, i) => {
      ctx.fillText(line, infoX, infoY + 16 + i * 14);
    });

    // Equation
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(99, 102, 241, 0.8)';
    const eqY = infoY + 16 + lines.length * 14 + 10;
    // Wrap equation text
    const words = config.equation.split(' ');
    let eqLine = '';
    let eqLineNum = 0;
    for (const word of words) {
      if ((eqLine + word).length > 30) {
        ctx.fillText(eqLine, infoX, eqY + eqLineNum * 12);
        eqLine = word + ' ';
        eqLineNum++;
      } else {
        eqLine += word + ' ';
      }
    }
    if (eqLine) ctx.fillText(eqLine, infoX, eqY + eqLineNum * 12);

  }, [config, buretteLevel, endpointVol, stopcockOpen, pastEndpoint, titType, getSolutionColor]);

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

  const recordReading = () => {
    const vol = Math.round((buretteLevel - initialReading) * 10) / 10;
    if (vol <= 0) return;
    setTrials(prev => [...prev, { initial: initialReading, final: buretteLevel, volume: vol }]);
    setInitialReading(buretteLevel);
  };

  const resetTitration = () => {
    setBuretteLevel(0);
    setInitialReading(0);
    setStopcockOpen(false);
    setShowFormula(false);
  };

  // Concordant readings: 2+ readings within 0.2 mL
  const concordantPairs: number[] = [];
  for (let i = 0; i < trials.length; i++) {
    for (let j = i + 1; j < trials.length; j++) {
      if (Math.abs(trials[i].volume - trials[j].volume) <= 0.2) {
        if (!concordantPairs.includes(i)) concordantPairs.push(i);
        if (!concordantPairs.includes(j)) concordantPairs.push(j);
      }
    }
  }

  const concordantVolume = concordantPairs.length >= 2
    ? concordantPairs.reduce((sum, idx) => sum + trials[idx].volume, 0) / concordantPairs.length
    : null;

  return (
    <div ref={containerRef} style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#a855f7' }}>Titration Lab</div>
        <div style={{ fontSize: 11, color: '#64748B' }}>CBSE Chemistry Practical — Acid-Base Titration</div>
      </div>

      {/* Titration type selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {(Object.keys(TITRATIONS) as TitrationType[]).map(key => (
          <button
            key={key}
            onClick={() => setTitType(key)}
            style={{
              padding: '5px 10px', borderRadius: 6,
              border: `1px solid ${titType === key ? '#a855f7' : '#e2e8f0'}`,
              background: titType === key ? '#a855f7' : '#fff',
              color: titType === key ? '#fff' : '#64748B',
              fontSize: 11, cursor: 'pointer', fontWeight: titType === key ? 600 : 400,
            }}
          >
            {TITRATIONS[key].title}
          </button>
        ))}
      </div>

      {/* Indicator selector (only for HCl vs Na2CO3) */}
      {titType === 'hcl_na2co3' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, justifyContent: 'center' }}>
          {([
            { id: 'methyl_orange' as Indicator, label: 'Methyl Orange' },
            { id: 'phenolphthalein' as Indicator, label: 'Phenolphthalein' },
          ]).map(ind => (
            <button
              key={ind.id}
              onClick={() => setIndicator(ind.id)}
              style={{
                padding: '4px 8px', borderRadius: 4,
                border: `1px solid ${indicator === ind.id ? '#6366f1' : '#e2e8f0'}`,
                background: indicator === ind.id ? '#6366f1' : '#fff',
                color: indicator === ind.id ? '#fff' : '#64748B',
                fontSize: 10, cursor: 'pointer',
              }}
            >
              {ind.label}
            </button>
          ))}
        </div>
      )}

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Titration apparatus showing burette with stopcock and conical flask with solution color change"
        style={{ width: '100%', height: 340, borderRadius: 8, border: '1px solid #e2e8f0' }}
      />

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={() => setStopcockOpen(!stopcockOpen)}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: stopcockOpen ? '#ef4444' : '#22c55e',
            color: '#fff', fontWeight: 600, fontSize: 12,
            minWidth: 44, minHeight: 44,
          }}
        >
          {stopcockOpen ? 'Close Stopcock' : 'Open Stopcock'}
        </button>
        <button
          onClick={recordReading}
          disabled={buretteLevel <= initialReading}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: buretteLevel > initialReading ? '#3b82f6' : '#94a3b8',
            color: '#fff', fontWeight: 600, fontSize: 12,
            minWidth: 44, minHeight: 44, opacity: buretteLevel > initialReading ? 1 : 0.5,
          }}
        >
          Record Reading
        </button>
        <button
          onClick={resetTitration}
          style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0',
            background: '#fff', color: '#64748B', fontWeight: 600, fontSize: 12,
            cursor: 'pointer', minWidth: 44, minHeight: 44,
          }}
        >
          Reset
        </button>
      </div>

      {/* Burette reading display */}
      <div style={{ marginTop: 10, padding: '8px 12px', background: '#1e293b', borderRadius: 8, textAlign: 'center' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>Burette Reading: </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{buretteLevel.toFixed(1)} mL</span>
        <span style={{ fontSize: 10, color: '#64748B', marginLeft: 8 }}>
          (Read at bottom of meniscus)
        </span>
      </div>

      {/* Data Table */}
      {trials.length > 0 && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#e2e8f0' }}>
                <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Trial</th>
                <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Initial (mL)</th>
                <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Final (mL)</th>
                <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Vol. Used (mL)</th>
                <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #334155' }}>Concordant</th>
              </tr>
            </thead>
            <tbody>
              {trials.map((trial, idx) => {
                const isConcordant = concordantPairs.includes(idx);
                return (
                  <tr key={idx} style={{ background: isConcordant ? 'rgba(34, 197, 94, 0.1)' : '#0d1117' }}>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e2e8f0', borderBottom: '1px solid #1e293b' }}>{idx + 1}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e2e8f0', borderBottom: '1px solid #1e293b' }}>{trial.initial.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e2e8f0', borderBottom: '1px solid #1e293b' }}>{trial.final.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', color: '#e2e8f0', fontWeight: 700, borderBottom: '1px solid #1e293b' }}>{trial.volume.toFixed(1)}</td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', borderBottom: '1px solid #1e293b' }}>
                      {isConcordant ? <span style={{ color: '#22c55e', fontWeight: 700 }}>Yes</span> : <span style={{ color: '#64748B' }}>-</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Concordant result */}
      {concordantVolume !== null && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid #22c55e', borderRadius: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
            Concordant Volume: {concordantVolume.toFixed(2)} mL
          </div>
          <div style={{ fontSize: 10, color: '#86efac', marginTop: 2 }}>
            (Average of readings within 0.2 mL difference)
          </div>
        </div>
      )}

      {/* Formula toggle */}
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <button
          onClick={() => setShowFormula(!showFormula)}
          style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid #6366f1',
            background: showFormula ? '#6366f1' : '#fff',
            color: showFormula ? '#fff' : '#6366f1',
            fontSize: 11, cursor: 'pointer', fontWeight: 600,
          }}
        >
          {showFormula ? 'Hide Formula' : 'Show M1V1 = M2V2'}
        </button>
      </div>

      {showFormula && (
        <div style={{ marginTop: 8, padding: '10px 12px', background: '#f1f5f9', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', textAlign: 'center', marginBottom: 4 }}>
            M1 x V1 = M2 x V2 x (n-factor ratio)
          </div>
          <div style={{ fontSize: 11, color: '#64748B', textAlign: 'center' }}>
            {config.molarityTitrant} x V1 = {config.molarityAnalyte} x {config.volumeAnalyte} x {config.nFactorRatio}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', textAlign: 'center', marginTop: 2 }}>
            V1 = {((config.molarityAnalyte * config.volumeAnalyte * config.nFactorRatio) / config.molarityTitrant).toFixed(1)} mL (theoretical)
          </div>
          {concordantVolume !== null && (
            <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, textAlign: 'center', marginTop: 4 }}>
              Your result: {concordantVolume.toFixed(2)} mL | Error: {Math.abs(concordantVolume - endpointVol).toFixed(2)} mL ({((Math.abs(concordantVolume - endpointVol) / endpointVol) * 100).toFixed(1)}%)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
