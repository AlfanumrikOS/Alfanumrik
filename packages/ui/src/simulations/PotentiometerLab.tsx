'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

// Potentiometer simulation: Compare EMFs of two cells
// CBSE Physics Practical: Compare EMFs using a potentiometer

interface TrialRecord {
  e1: number;
  e2: number;
  l1: number;
  l2: number;
  ratio: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// Animated particles along the wire to show current flow
interface Particle {
  pos: number; // 0 to 1 along wire
  speed: number;
}

const NUM_PARTICLES = 30;

export default function PotentiometerLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>(
    Array.from({ length: NUM_PARTICLES }, () => ({
      pos: Math.random(),
      speed: 0.001 + Math.random() * 0.0005,
    }))
  );

  // Two cells with different EMFs
  const [emf1] = useState(() => +(1.0 + Math.random() * 0.5).toFixed(2)); // 1.0 - 1.5 V
  const [emf2] = useState(() => +(1.2 + Math.random() * 0.8).toFixed(2)); // 1.2 - 2.0 V
  const [selectedCell, setSelectedCell] = useState<1 | 2>(1);
  const [jockeyPos, setJockeyPos] = useState(50); // cm (0-100)
  const [isDragging, setIsDragging] = useState(false);
  const [trials, setTrials] = useState<TrialRecord[]>([]);
  const [l1Recorded, setL1Recorded] = useState<number | null>(null);
  const [l2Recorded, setL2Recorded] = useState<number | null>(null);

  // Potentiometer wire: 10 m length, driven by accumulator (say 2V across 10m)
  // Fall of potential per cm = V_driver / total_length
  const driverVoltage = 3.0; // Accumulator voltage
  const wireLength = 100; // cm representation

  // Balance condition: EMF = (V_driver / L_total) * l_balance
  // l_balance = EMF * L_total / V_driver
  const currentEmf = selectedCell === 1 ? emf1 : emf2;
  const balancePoint = (currentEmf * wireLength) / driverVoltage;

  // Galvanometer deflection
  const deviation = jockeyPos - balancePoint;
  const galvDeflection = clamp(deviation * 1.2, -40, 40);
  const isBalanced = Math.abs(galvDeflection) < 1.5;

  const recordBalance = useCallback(() => {
    if (!isBalanced) return;
    const roundedPos = Math.round(jockeyPos * 10) / 10;

    if (selectedCell === 1) {
      setL1Recorded(roundedPos);
    } else {
      setL2Recorded(roundedPos);
    }
  }, [isBalanced, jockeyPos, selectedCell]);

  // Auto-save trial when both recorded
  useEffect(() => {
    if (l1Recorded !== null && l2Recorded !== null) {
      const trial: TrialRecord = {
        e1: emf1,
        e2: emf2,
        l1: l1Recorded,
        l2: l2Recorded,
        ratio: Math.round((l1Recorded / l2Recorded) * 1000) / 1000,
      };
      setTrials(prev => [...prev, trial]);
      setL1Recorded(null);
      setL2Recorded(null);
    }
  }, [l1Recorded, l2Recorded, emf1, emf2]);

  const drawScene = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, time: number) => {
    const dpr = window.devicePixelRatio || 1;
    const cw = w / dpr;
    const ch = h / dpr;

    // Background
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, cw, ch);

    // Title
    ctx.font = 'bold 16px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(220, 180, 255, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Potentiometer — Compare EMFs', cw / 2, 10);

    // Layout
    const wireY = 80;
    const wireLeft = 50;
    const wireRight = cw - 50;
    const wireLen = wireRight - wireLeft;

    // --- Driver cell (accumulator) at top ---
    const accX = wireLeft - 20;
    const accY = wireY - 30;

    ctx.fillStyle = 'rgba(255, 200, 50, 0.15)';
    ctx.beginPath();
    ctx.roundRect(accX - 30, accY - 12, 60, 24, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 200, 50, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(accX - 30, accY - 12, 60, 24, 6);
    ctx.stroke();

    ctx.font = 'bold 11px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffdd66';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Acc: ${driverVoltage}V`, accX, accY);

    // Connection from accumulator to wire
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(accX + 30, accY);
    ctx.lineTo(wireLeft, wireY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(accX - 30, accY);
    ctx.lineTo(wireLeft - 10, accY);
    ctx.lineTo(wireLeft - 10, wireY + 40);
    ctx.lineTo(wireRight + 10, wireY + 40);
    ctx.lineTo(wireRight + 10, wireY);
    ctx.lineTo(wireRight, wireY);
    ctx.stroke();

    // --- Potentiometer wire ---
    // Wire background
    ctx.fillStyle = '#2a1845';
    ctx.beginPath();
    ctx.roundRect(wireLeft - 4, wireY - 8, wireLen + 8, 16, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,100,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(wireLeft - 4, wireY - 8, wireLen + 8, 16, 4);
    ctx.stroke();

    // Wire
    ctx.strokeStyle = '#cd7f32';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wireLeft, wireY);
    ctx.lineTo(wireRight, wireY);
    ctx.stroke();

    // Scale
    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = '#777';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let cm = 0; cm <= 100; cm += 10) {
      const x = wireLeft + (cm / 100) * wireLen;
      ctx.beginPath();
      ctx.moveTo(x, wireY + 6);
      ctx.lineTo(x, wireY + 12);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillText(`${cm}`, x, wireY + 13);
    }

    // --- Animated current particles along wire ---
    const particles = particlesRef.current;
    for (const p of particles) {
      p.pos = (p.pos + p.speed) % 1;
      const px = wireLeft + p.pos * wireLen;
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.004 + p.pos * Math.PI * 4);

      const grad = ctx.createRadialGradient(px, wireY, 0, px, wireY, 4);
      grad.addColorStop(0, `rgba(100, 200, 255, ${0.6 * pulse})`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(px - 4, wireY - 4, 8, 8);

      ctx.fillStyle = `rgba(150, 220, 255, ${0.8 * pulse})`;
      ctx.beginPath();
      ctx.arc(px, wireY, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Current direction arrows
    ctx.fillStyle = 'rgba(100, 200, 255, 0.4)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 5; i++) {
      const ax = wireLeft + ((i + 0.5) / 5) * wireLen;
      ctx.fillText('▸', ax, wireY - 14);
    }

    // --- Cells (E1 and E2) ---
    const cellY = wireY + 80;
    const cellSpacing = 70;
    const cellCenterX = cw / 2;

    // Cell E1
    const c1x = cellCenterX - cellSpacing;
    const c1Active = selectedCell === 1;
    ctx.fillStyle = c1Active ? 'rgba(255, 100, 100, 0.2)' : 'rgba(255, 100, 100, 0.08)';
    ctx.beginPath();
    ctx.roundRect(c1x - 30, cellY - 14, 60, 28, 6);
    ctx.fill();
    ctx.strokeStyle = c1Active ? 'rgba(255,100,100,0.7)' : 'rgba(255,100,100,0.3)';
    ctx.lineWidth = c1Active ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(c1x - 30, cellY - 14, 60, 28, 6);
    ctx.stroke();

    ctx.font = `bold 12px "Segoe UI", sans-serif`;
    ctx.fillStyle = c1Active ? '#ff8888' : '#ff666680';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`E1: ${emf1}V`, c1x, cellY);

    // Cell E2
    const c2x = cellCenterX + cellSpacing;
    const c2Active = selectedCell === 2;
    ctx.fillStyle = c2Active ? 'rgba(100, 200, 100, 0.2)' : 'rgba(100, 200, 100, 0.08)';
    ctx.beginPath();
    ctx.roundRect(c2x - 30, cellY - 14, 60, 28, 6);
    ctx.fill();
    ctx.strokeStyle = c2Active ? 'rgba(100,200,100,0.7)' : 'rgba(100,200,100,0.3)';
    ctx.lineWidth = c2Active ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect(c2x - 30, cellY - 14, 60, 28, 6);
    ctx.stroke();

    ctx.fillStyle = c2Active ? '#88ff88' : '#66cc6680';
    ctx.fillText(`E2: ${emf2}V`, c2x, cellY);

    // Two-way key (DPDT switch representation)
    const keyX = cellCenterX;
    const keyY = cellY;
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1.5;
    // Lines from cells to key
    ctx.beginPath();
    ctx.moveTo(c1x + 30, cellY);
    ctx.lineTo(keyX - 8, keyY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c2x - 30, cellY);
    ctx.lineTo(keyX + 8, keyY);
    ctx.stroke();

    // Key indicator
    ctx.fillStyle = c1Active ? '#ff8888' : '#88ff88';
    ctx.beginPath();
    ctx.arc(keyX, keyY, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '8px "Courier New", monospace';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('K', keyX, keyY);

    // --- Galvanometer ---
    const galvX = cellCenterX;
    const galvY = cellY + 50;
    const galvR = 18;

    // Connection from key through galvanometer to jockey
    const jockeyX = wireLeft + (jockeyPos / 100) * wireLen;

    ctx.strokeStyle = isBalanced ? 'rgba(76,175,80,0.6)' : 'rgba(160,100,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(keyX, keyY + 14);
    ctx.lineTo(galvX, galvY - galvR - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(galvX, galvY + galvR + 4);
    ctx.lineTo(jockeyX, wireY + 28);
    ctx.stroke();
    ctx.setLineDash([]);

    // Connection from active cell to wire start
    const activeCellX = selectedCell === 1 ? c1x : c2x;
    ctx.strokeStyle = 'rgba(160,100,255,0.3)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(activeCellX - 30, cellY);
    ctx.lineTo(wireLeft, wireY + 28);
    ctx.stroke();
    ctx.setLineDash([]);

    // Galvanometer body
    ctx.fillStyle = '#1a1030';
    ctx.beginPath();
    ctx.arc(galvX, galvY, galvR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isBalanced ? '#4CAF50' : 'rgba(160,100,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(galvX, galvY, galvR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.fillStyle = isBalanced ? '#4CAF50' : '#c090ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('G', galvX, galvY - 5);

    // Needle
    const needleAngle = (galvDeflection / 40) * (Math.PI / 3);
    ctx.save();
    ctx.translate(galvX, galvY + 4);
    ctx.rotate(-needleAngle);
    ctx.strokeStyle = isBalanced ? '#4CAF50' : '#ff4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -galvR + 3);
    ctx.stroke();
    ctx.restore();

    ctx.font = '9px "Courier New", monospace';
    ctx.fillStyle = isBalanced ? '#4CAF50' : '#ff9999';
    ctx.textBaseline = 'top';
    ctx.fillText(
      isBalanced ? 'NULL' : `G: ${galvDeflection.toFixed(1)}`,
      galvX, galvY + galvR + 3
    );

    // Balance glow
    if (isBalanced) {
      const glow = 0.5 + 0.5 * Math.sin(time * 0.005);
      ctx.fillStyle = `rgba(76, 175, 80, ${0.12 * glow})`;
      ctx.beginPath();
      ctx.arc(galvX, galvY, galvR + 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Jockey ---
    const jPulse = 0.8 + 0.2 * Math.sin(time * 0.003);
    ctx.fillStyle = isDragging
      ? `rgba(255, 200, 50, ${jPulse})`
      : isBalanced
        ? '#4CAF50'
        : '#ff9800';
    ctx.beginPath();
    ctx.moveTo(jockeyX, wireY + 4);
    ctx.lineTo(jockeyX - 5, wireY + 16);
    ctx.lineTo(jockeyX + 5, wireY + 16);
    ctx.closePath();
    ctx.fill();

    // Handle
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.roundRect(jockeyX - 3, wireY + 16, 6, 12, 2);
    ctx.fill();

    // Touch target
    if (!isDragging) {
      ctx.fillStyle = 'rgba(255, 200, 50, 0.12)';
      ctx.beginPath();
      ctx.arc(jockeyX, wireY + 12, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    // Position label
    ctx.font = 'bold 11px "Courier New", monospace';
    ctx.fillStyle = '#ffdd66';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`l = ${jockeyPos.toFixed(1)} cm`, jockeyX, wireY + 30);

    // --- Calculation panel ---
    const calcY = ch - 100;
    const calcW = Math.min(cw - 30, 460);
    const calcX = (cw - calcW) / 2;

    ctx.fillStyle = 'rgba(30, 20, 50, 0.7)';
    ctx.beginPath();
    ctx.roundRect(calcX, calcY, calcW, 90, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,100,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(calcX, calcY, calcW, 90, 10);
    ctx.stroke();

    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e0c0ff';
    ctx.fillText('E1/E2 = l1/l2', cw / 2, calcY + 8);

    // Show recorded values
    ctx.font = '11px "Courier New", monospace';
    ctx.fillStyle = '#ff8888';
    ctx.fillText(
      l1Recorded !== null
        ? `l1 = ${l1Recorded} cm (recorded)`
        : selectedCell === 1 && isBalanced
          ? `l1 = ${jockeyPos.toFixed(1)} cm (ready to record)`
          : `l1 = ? (select E1, find null)`,
      cw / 2, calcY + 28
    );

    ctx.fillStyle = '#88ff88';
    ctx.fillText(
      l2Recorded !== null
        ? `l2 = ${l2Recorded} cm (recorded)`
        : selectedCell === 2 && isBalanced
          ? `l2 = ${jockeyPos.toFixed(1)} cm (ready to record)`
          : `l2 = ? (select E2, find null)`,
      cw / 2, calcY + 44
    );

    // Ratio
    if (trials.length > 0) {
      const latest = trials[trials.length - 1];
      ctx.font = 'bold 13px "Courier New", monospace';
      ctx.fillStyle = '#ffcc88';
      ctx.fillText(
        `E1/E2 = ${latest.l1}/${latest.l2} = ${latest.ratio.toFixed(3)}`,
        cw / 2, calcY + 62
      );

      // Actual ratio comparison
      const actualRatio = emf1 / emf2;
      const error = Math.abs(((latest.ratio - actualRatio) / actualRatio) * 100);
      ctx.font = '10px "Courier New", monospace';
      ctx.fillStyle = error < 2 ? '#4CAF50' : '#ff9999';
      ctx.fillText(
        `Actual: ${actualRatio.toFixed(3)} | Error: ${error.toFixed(1)}%`,
        cw / 2, calcY + 78
      );
    } else {
      // Advantage note
      ctx.font = '10px "Segoe UI", sans-serif';
      ctx.fillStyle = '#88bbff';
      ctx.fillText(
        'Advantage: No current drawn at balance (unlike voltmeter)',
        cw / 2, calcY + 68
      );
    }

  }, [emf1, emf2, selectedCell, jockeyPos, isDragging, galvDeflection, isBalanced, l1Recorded, l2Recorded, trials, driverVoltage]);

  // Canvas setup
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const canvasH = 400;
      canvas.width = rect.width * dpr;
      canvas.height = canvasH * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${canvasH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const animate = (time: number) => {
      if (!running) return;
      drawScene(ctx, canvas.width, canvas.height, time);
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [drawScene]);

  // Pointer interaction
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const wireLeftPx = 50;
    const wireRightPx = rect.width - 50;
    const wireLenPx = wireRightPx - wireLeftPx;
    const jockeyX = wireLeftPx + (jockeyPos / 100) * wireLenPx;

    // Jockey touch area
    if (Math.abs(x - jockeyX) < 25 && y < 140 && y > 50) {
      setIsDragging(true);
      canvas.setPointerCapture(e.pointerId);
    }
  }, [jockeyPos]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const wireLeftPx = 50;
    const wireRightPx = rect.width - 50;
    const wireLenPx = wireRightPx - wireLeftPx;
    const newPos = clamp(((x - wireLeftPx) / wireLenPx) * 100, 1, 99);
    setJockeyPos(Math.round(newPos * 10) / 10);
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleReset = () => {
    setJockeyPos(50);
    setTrials([]);
    setL1Recorded(null);
    setL2Recorded(null);
    setSelectedCell(1);
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        maxWidth: 640,
        margin: '0 auto',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Potentiometer simulation for comparing EMFs of two cells by finding balance lengths"
        style={{
          width: '100%',
          height: 400,
          borderRadius: 16,
          display: 'block',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <div
        style={{
          padding: '20px 4px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {/* Jockey slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label
            style={{
              minWidth: 130,
              color: '#ffdd66',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Jockey: {jockeyPos.toFixed(1)} cm
          </label>
          <input
            type="range"
            min={1}
            max={99}
            step={0.1}
            value={jockeyPos}
            onChange={(e) => setJockeyPos(parseFloat(e.target.value))}
            aria-label={`Jockey position, ${jockeyPos.toFixed(1)} cm`}
            style={{
              flex: 1,
              accentColor: '#ffaa33',
              height: 6,
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Cell selector + actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setSelectedCell(1)}
              style={{
                background: selectedCell === 1
                  ? 'linear-gradient(135deg, #b71c1c 0%, #c62828 100%)'
                  : 'rgba(40, 30, 60, 0.6)',
                border: `1px solid ${selectedCell === 1 ? 'rgba(255,100,100,0.7)' : 'rgba(100,100,100,0.3)'}`,
                borderRadius: 8,
                padding: '6px 14px',
                color: selectedCell === 1 ? '#ffcccc' : '#888',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cell E1 ({emf1}V)
            </button>
            <button
              onClick={() => setSelectedCell(2)}
              style={{
                background: selectedCell === 2
                  ? 'linear-gradient(135deg, #1b5e20 0%, #2e7d32 100%)'
                  : 'rgba(40, 30, 60, 0.6)',
                border: `1px solid ${selectedCell === 2 ? 'rgba(100,200,100,0.7)' : 'rgba(100,100,100,0.3)'}`,
                borderRadius: 8,
                padding: '6px 14px',
                color: selectedCell === 2 ? '#c8e6c9' : '#888',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cell E2 ({emf2}V)
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={recordBalance}
              disabled={!isBalanced}
              aria-label="Record balance length"
              style={{
                background: isBalanced
                  ? 'linear-gradient(135deg, #1a237e 0%, #283593 100%)'
                  : 'rgba(50,50,50,0.5)',
                border: `1px solid ${isBalanced ? 'rgba(100,140,255,0.7)' : 'rgba(100,100,100,0.3)'}`,
                borderRadius: 8,
                padding: '6px 14px',
                color: isBalanced ? '#bbccff' : '#666',
                fontWeight: 700,
                fontSize: 13,
                cursor: isBalanced ? 'pointer' : 'not-allowed',
              }}
            >
              Record l{selectedCell}
            </button>

            <button
              onClick={handleReset}
              aria-label="Reset simulation"
              style={{
                background: 'linear-gradient(135deg, #2a1845 0%, #3a2060 100%)',
                border: '1px solid rgba(160,100,255,0.4)',
                borderRadius: 8,
                padding: '6px 14px',
                color: '#d0b0ff',
                fontWeight: 700,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Status indicators */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: '"Courier New", monospace',
            background: l1Recorded !== null ? 'rgba(76,175,80,0.15)' : 'rgba(255,100,100,0.1)',
            border: `1px solid ${l1Recorded !== null ? 'rgba(76,175,80,0.4)' : 'rgba(255,100,100,0.2)'}`,
            color: l1Recorded !== null ? '#4CAF50' : '#ff8888',
          }}>
            l1 = {l1Recorded !== null ? `${l1Recorded} cm` : 'not recorded'}
          </div>
          <div style={{
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: '"Courier New", monospace',
            background: l2Recorded !== null ? 'rgba(76,175,80,0.15)' : 'rgba(100,200,100,0.1)',
            border: `1px solid ${l2Recorded !== null ? 'rgba(76,175,80,0.4)' : 'rgba(100,200,100,0.2)'}`,
            color: l2Recorded !== null ? '#4CAF50' : '#88ff88',
          }}>
            l2 = {l2Recorded !== null ? `${l2Recorded} cm` : 'not recorded'}
          </div>
        </div>

        {/* Trial table */}
        {trials.length > 0 && (
          <div
            style={{
              background: 'rgba(30, 20, 50, 0.5)',
              border: '1px solid rgba(160,100,255,0.2)',
              borderRadius: 10,
              padding: 12,
              overflowX: 'auto',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 12,
                fontFamily: '"Courier New", monospace',
              }}
            >
              <thead>
                <tr>
                  {['Trial', 'l1 (cm)', 'l2 (cm)', 'E1/E2 = l1/l2'].map(h => (
                    <th key={h} style={{ padding: '4px 8px', color: '#c090ff', textAlign: 'center', borderBottom: '1px solid rgba(160,100,255,0.3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trials.map((t, i) => (
                  <tr key={i}>
                    <td style={{ padding: '4px 8px', color: '#aaa', textAlign: 'center' }}>{i + 1}</td>
                    <td style={{ padding: '4px 8px', color: '#ff8888', textAlign: 'center' }}>{t.l1}</td>
                    <td style={{ padding: '4px 8px', color: '#88ff88', textAlign: 'center' }}>{t.l2}</td>
                    <td style={{ padding: '4px 8px', color: '#ffcc88', textAlign: 'center' }}>{t.ratio.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tip */}
        <p
          style={{
            margin: 0,
            padding: '8px 12px',
            background: 'rgba(255, 170, 50, 0.08)',
            border: '1px solid rgba(255, 170, 50, 0.2)',
            borderRadius: 10,
            color: '#ffcc88',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>How to use:</strong> Select Cell E1, slide the jockey to find the null point
          (galvanometer = 0), then record l1. Switch to Cell E2, find its null point, and record l2.
          The ratio E1/E2 = l1/l2. The potentiometer&apos;s advantage: it draws no current at balance,
          giving a more accurate EMF measurement than a voltmeter.
        </p>
      </div>
    </div>
  );
}
