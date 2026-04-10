'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

// Meter bridge (Wheatstone bridge) simulation
// CBSE Physics Practical: Find unknown resistance using a meter bridge

const WIRE_LENGTH_CM = 100; // 1 meter wire

interface Trial {
  S: number;          // known resistance (ohm)
  balanceL: number;   // balance length (cm)
  R: number;          // calculated unknown resistance
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export default function MeterBridgeLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  // Unknown resistance (hidden from student, used for simulation)
  const [actualR] = useState(() => Math.round(15 + Math.random() * 35)); // 15-50 ohm
  const [knownS, setKnownS] = useState(20);
  const [jockeyPos, setJockeyPos] = useState(50); // cm along wire
  const [isDragging, setIsDragging] = useState(false);
  const [trials, setTrials] = useState<Trial[]>([]);
  const [showAnswer, setShowAnswer] = useState(false);

  // Calculate galvanometer deflection based on jockey position
  // At balance: R/S = l/(100-l)  =>  l_balance = 100*R / (R+S)
  const balancePoint = (100 * actualR) / (actualR + knownS);
  const deviation = jockeyPos - balancePoint;
  // Galvanometer reading: proportional to deviation from balance
  const galvDeflection = clamp(deviation * 0.8, -40, 40);
  const isBalanced = Math.abs(galvDeflection) < 1.5;

  // Calculated R from current jockey position
  const calcR = knownS * (jockeyPos / (WIRE_LENGTH_CM - jockeyPos));

  const recordTrial = useCallback(() => {
    if (!isBalanced) return;
    const trial: Trial = {
      S: knownS,
      balanceL: Math.round(jockeyPos * 10) / 10,
      R: Math.round(calcR * 100) / 100,
    };
    setTrials(prev => [...prev, trial]);
  }, [knownS, jockeyPos, calcR, isBalanced]);

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
    ctx.fillText('Meter Bridge — Find Unknown Resistance', cw / 2, 10);

    // Layout constants
    const wireY = 140;
    const wireLeft = 60;
    const wireRight = cw - 60;
    const wireLen = wireRight - wireLeft;

    // --- Draw the meter bridge wire ---
    // Wire background (ruler)
    ctx.fillStyle = '#2a1845';
    ctx.beginPath();
    ctx.roundRect(wireLeft - 5, wireY - 12, wireLen + 10, 24, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,100,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(wireLeft - 5, wireY - 12, wireLen + 10, 24, 6);
    ctx.stroke();

    // Wire
    ctx.strokeStyle = '#cd7f32'; // copper color
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(wireLeft, wireY);
    ctx.lineTo(wireRight, wireY);
    ctx.stroke();

    // Scale markings
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = '#aaa';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let cm = 0; cm <= 100; cm += 10) {
      const x = wireLeft + (cm / 100) * wireLen;
      ctx.beginPath();
      ctx.moveTo(x, wireY + 8);
      ctx.lineTo(x, wireY + 14);
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillText(`${cm}`, x, wireY + 16);
    }

    // --- Resistance boxes ---
    // Left gap: Unknown R
    const rBoxX = wireLeft - 5;
    const rBoxY = 50;
    const rBoxW = wireLen * 0.4;
    const rBoxH = 36;

    ctx.fillStyle = 'rgba(255, 100, 100, 0.15)';
    ctx.beginPath();
    ctx.roundRect(rBoxX, rBoxY, rBoxW, rBoxH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 100, 100, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(rBoxX, rBoxY, rBoxW, rBoxH, 8);
    ctx.stroke();

    ctx.font = 'bold 13px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ff8888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(showAnswer ? `R = ${actualR} Ω (unknown)` : 'R = ? (unknown)', rBoxX + rBoxW / 2, rBoxY + rBoxH / 2);

    // Right gap: Known S
    const sBoxX = wireRight - rBoxW + 5;

    ctx.fillStyle = 'rgba(100, 200, 100, 0.15)';
    ctx.beginPath();
    ctx.roundRect(sBoxX, rBoxY, rBoxW, rBoxH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(100, 200, 100, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(sBoxX, rBoxY, rBoxW, rBoxH, 8);
    ctx.stroke();

    ctx.fillStyle = '#88ff88';
    ctx.fillText(`S = ${knownS} Ω (known)`, sBoxX + rBoxW / 2, rBoxY + rBoxH / 2);

    // Connections from boxes to wire endpoints
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    // R to left end of wire
    ctx.beginPath();
    ctx.moveTo(rBoxX + 20, rBoxY + rBoxH);
    ctx.lineTo(wireLeft, wireY - 12);
    ctx.stroke();
    // R to junction
    ctx.beginPath();
    ctx.moveTo(rBoxX + rBoxW - 20, rBoxY + rBoxH);
    ctx.lineTo(wireLeft + wireLen * 0.5, rBoxY + rBoxH + 10);
    ctx.stroke();
    // S to right end of wire
    ctx.beginPath();
    ctx.moveTo(sBoxX + rBoxW - 20, rBoxY + rBoxH);
    ctx.lineTo(wireRight, wireY - 12);
    ctx.stroke();
    // S to junction
    ctx.beginPath();
    ctx.moveTo(sBoxX + 20, rBoxY + rBoxH);
    ctx.lineTo(wireLeft + wireLen * 0.5, rBoxY + rBoxH + 10);
    ctx.stroke();

    // --- Jockey (draggable) ---
    const jockeyX = wireLeft + (jockeyPos / 100) * wireLen;

    // Jockey line from wire to galvanometer connection
    ctx.strokeStyle = isBalanced ? '#4CAF50' : '#ff9800';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(jockeyX, wireY);
    ctx.lineTo(jockeyX, wireY - 50);
    ctx.lineTo(wireLeft + wireLen * 0.5, rBoxY + rBoxH + 10);
    ctx.stroke();
    ctx.setLineDash([]);

    // Jockey tip
    const jPulse = 0.8 + 0.2 * Math.sin(time * 0.003);
    ctx.fillStyle = isDragging
      ? `rgba(255, 200, 50, ${jPulse})`
      : isBalanced
        ? '#4CAF50'
        : '#ff9800';
    ctx.beginPath();
    ctx.moveTo(jockeyX, wireY - 4);
    ctx.lineTo(jockeyX - 6, wireY - 18);
    ctx.lineTo(jockeyX + 6, wireY - 18);
    ctx.closePath();
    ctx.fill();

    // Jockey handle
    ctx.fillStyle = '#555';
    ctx.beginPath();
    ctx.roundRect(jockeyX - 4, wireY - 30, 8, 14, 3);
    ctx.fill();

    // Touch target indicator
    if (!isDragging) {
      ctx.fillStyle = 'rgba(255, 200, 50, 0.15)';
      ctx.beginPath();
      ctx.arc(jockeyX, wireY, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    // Position label
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.fillStyle = '#ffdd66';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`l = ${jockeyPos.toFixed(1)} cm`, jockeyX, wireY + 42);

    // --- Galvanometer ---
    const galvX = wireLeft + wireLen * 0.5;
    const galvY = rBoxY + rBoxH + 10;
    const galvR = 20;

    // Galvanometer circle
    ctx.fillStyle = '#1a1030';
    ctx.beginPath();
    ctx.arc(galvX, galvY, galvR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isBalanced ? '#4CAF50' : 'rgba(160,100,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(galvX, galvY, galvR, 0, Math.PI * 2);
    ctx.stroke();

    // G label
    ctx.font = 'bold 14px "Segoe UI", sans-serif';
    ctx.fillStyle = isBalanced ? '#4CAF50' : '#c090ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('G', galvX, galvY - 6);

    // Needle
    const needleAngle = (galvDeflection / 40) * (Math.PI / 3);
    ctx.save();
    ctx.translate(galvX, galvY + 6);
    ctx.rotate(-needleAngle);
    ctx.strokeStyle = isBalanced ? '#4CAF50' : '#ff4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -galvR + 4);
    ctx.stroke();
    ctx.restore();

    // Deflection reading
    ctx.font = '10px "Courier New", monospace';
    ctx.fillStyle = isBalanced ? '#4CAF50' : '#ff9999';
    ctx.textBaseline = 'top';
    ctx.fillText(
      isBalanced ? 'NULL (balanced!)' : `deflection: ${galvDeflection.toFixed(1)}`,
      galvX, galvY + galvR + 4
    );

    // --- Balance indicator ---
    if (isBalanced) {
      const glow = 0.5 + 0.5 * Math.sin(time * 0.005);
      ctx.fillStyle = `rgba(76, 175, 80, ${0.15 * glow})`;
      ctx.beginPath();
      ctx.arc(galvX, galvY, galvR + 10, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Live calculation ---
    const calcY = wireY + 58;
    const calcBoxW = Math.min(cw - 40, 440);
    const calcBoxX = (cw - calcBoxW) / 2;

    ctx.fillStyle = 'rgba(30, 20, 50, 0.7)';
    ctx.beginPath();
    ctx.roundRect(calcBoxX, calcY, calcBoxW, 70, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,100,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(calcBoxX, calcY, calcBoxW, 70, 10);
    ctx.stroke();

    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e0c0ff';
    ctx.fillText('R = S × l / (100 - l)', cw / 2, calcY + 8);

    ctx.font = '12px "Courier New", monospace';
    ctx.fillStyle = '#aaccff';
    ctx.fillText(
      `R = ${knownS} × ${jockeyPos.toFixed(1)} / (100 - ${jockeyPos.toFixed(1)})`,
      cw / 2, calcY + 28
    );

    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.fillStyle = isBalanced ? '#4CAF50' : '#ffcc88';
    const displayR = jockeyPos >= 99.5 ? '∞' : calcR.toFixed(2);
    ctx.fillText(`R = ${displayR} Ω`, cw / 2, calcY + 48);

    // --- Error analysis (show if we have trials) ---
    if (trials.length >= 2) {
      const avgR = trials.reduce((s, t) => s + t.R, 0) / trials.length;
      const maxDev = Math.max(...trials.map(t => Math.abs(t.R - avgR)));
      const percentError = showAnswer ? ((Math.abs(avgR - actualR) / actualR) * 100).toFixed(1) : '?';

      const errY = calcY + 78;
      ctx.fillStyle = 'rgba(30, 20, 50, 0.5)';
      ctx.beginPath();
      ctx.roundRect(calcBoxX, errY, calcBoxW, 40, 8);
      ctx.fill();

      ctx.font = '11px "Courier New", monospace';
      ctx.fillStyle = '#88ddff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(
        `Mean R = ${avgR.toFixed(2)} Ω | Max dev = ${maxDev.toFixed(2)} Ω | Error = ${percentError}%`,
        cw / 2, errY + 12
      );
    }

  }, [actualR, knownS, jockeyPos, isDragging, galvDeflection, isBalanced, calcR, trials, showAnswer]);

  // Canvas setup and animation
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
      timeRef.current = time;
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

  // Pointer interaction for jockey dragging
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const wireLeft = 60;
    const wireRight = rect.width - 60;
    const wireLen = wireRight - wireLeft;
    const jockeyX = wireLeft + (jockeyPos / 100) * wireLen;

    // Check if click is near jockey
    if (Math.abs(x - jockeyX) < 30) {
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
    const wireLeft = 60;
    const wireRight = rect.width - 60;
    const wireLen = wireRight - wireLeft;
    const newPos = clamp(((x - wireLeft) / wireLen) * 100, 1, 99);
    setJockeyPos(Math.round(newPos * 10) / 10);
  }, [isDragging]);

  const handlePointerUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleReset = () => {
    setKnownS(20);
    setJockeyPos(50);
    setTrials([]);
    setShowAnswer(false);
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
        aria-label="Meter bridge simulation for finding unknown resistance by sliding a jockey along a wire"
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
        {/* Jockey position slider (fine control) */}
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
            aria-label={`Jockey position slider, ${jockeyPos.toFixed(1)} cm, range 1 to 99`}
            style={{
              flex: 1,
              accentColor: '#ffaa33',
              height: 6,
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Known resistance S selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label
            style={{
              minWidth: 130,
              color: '#88ff88',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Known S: {knownS} Ω
          </label>
          <input
            type="range"
            min={5}
            max={50}
            step={1}
            value={knownS}
            onChange={(e) => setKnownS(parseInt(e.target.value))}
            aria-label={`Known resistance S, ${knownS} Ohms, range 5 to 50`}
            style={{
              flex: 1,
              accentColor: '#66cc66',
              height: 6,
              cursor: 'pointer',
            }}
          />
        </div>

        {/* Actions row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <button
            onClick={recordTrial}
            disabled={!isBalanced}
            aria-label="Record this trial measurement"
            style={{
              background: isBalanced
                ? 'linear-gradient(135deg, #1b5e20 0%, #2e7d32 100%)'
                : 'rgba(50,50,50,0.5)',
              border: `1px solid ${isBalanced ? 'rgba(76,175,80,0.7)' : 'rgba(100,100,100,0.3)'}`,
              borderRadius: 10,
              padding: '8px 20px',
              color: isBalanced ? '#c8e6c9' : '#666',
              fontWeight: 700,
              fontSize: 14,
              cursor: isBalanced ? 'pointer' : 'not-allowed',
            }}
          >
            Record Trial ({trials.length})
          </button>

          <button
            onClick={() => setShowAnswer(prev => !prev)}
            style={{
              background: 'linear-gradient(135deg, #1a237e 0%, #283593 100%)',
              border: '1px solid rgba(100,140,255,0.4)',
              borderRadius: 10,
              padding: '8px 16px',
              color: '#bbccff',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            {showAnswer ? 'Hide Answer' : 'Show Answer'}
          </button>

          <button
            onClick={handleReset}
            aria-label="Reset simulation"
            style={{
              background: 'linear-gradient(135deg, #2a1845 0%, #3a2060 100%)',
              border: '1px solid rgba(160,100,255,0.4)',
              borderRadius: 10,
              padding: '8px 20px',
              color: '#d0b0ff',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        </div>

        {/* Trial data table */}
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
                fontSize: 13,
                fontFamily: '"Courier New", monospace',
              }}
            >
              <thead>
                <tr>
                  <th style={{ padding: '4px 8px', color: '#c090ff', textAlign: 'center', borderBottom: '1px solid rgba(160,100,255,0.3)' }}>Trial</th>
                  <th style={{ padding: '4px 8px', color: '#88ff88', textAlign: 'center', borderBottom: '1px solid rgba(160,100,255,0.3)' }}>S (Ω)</th>
                  <th style={{ padding: '4px 8px', color: '#ffdd66', textAlign: 'center', borderBottom: '1px solid rgba(160,100,255,0.3)' }}>l (cm)</th>
                  <th style={{ padding: '4px 8px', color: '#ff8888', textAlign: 'center', borderBottom: '1px solid rgba(160,100,255,0.3)' }}>R (Ω)</th>
                </tr>
              </thead>
              <tbody>
                {trials.map((t, i) => (
                  <tr key={i}>
                    <td style={{ padding: '4px 8px', color: '#aaa', textAlign: 'center' }}>{i + 1}</td>
                    <td style={{ padding: '4px 8px', color: '#88ff88', textAlign: 'center' }}>{t.S}</td>
                    <td style={{ padding: '4px 8px', color: '#ffdd66', textAlign: 'center' }}>{t.balanceL}</td>
                    <td style={{ padding: '4px 8px', color: '#ff8888', textAlign: 'center' }}>{t.R.toFixed(2)}</td>
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
          <strong>How to use:</strong> Drag the jockey along the wire (or use the slider) until the
          galvanometer reads zero (null point). Then record the trial. Change S and repeat for
          multiple readings. The formula R = S x l/(100-l) gives the unknown resistance.
        </p>
      </div>
    </div>
  );
}
