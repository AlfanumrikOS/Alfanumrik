'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Hooke's Law Simulation
 *
 * Interactive spring-mass system demonstrating F = -kx.
 * Shows spring extension, restoring force, and energy.
 * Supports both static equilibrium and oscillation modes.
 */

export default function HookesLaw() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const stateRef = useRef({ y: 0, vy: 0 });
  const timeRef = useRef(0);

  const [springK, setSpringK] = useState(20);
  const [mass, setMass] = useState(2);
  const [damping, setDamping] = useState(0.05);
  const [mode, setMode] = useState<'static' | 'oscillate'>('static');
  const [isRunning, setIsRunning] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  const g = 9.8;
  const naturalLen = 80; // pixels
  const equilibriumExt = (mass * g) / springK; // in "units" mapped to pixels
  const pixelsPerUnit = 15;

  const reset = useCallback(() => {
    stateRef.current = { y: 0, vy: 0 };
    timeRef.current = 0;
    setIsRunning(false);
    setDragOffset(0);
  }, []);

  const startOscillation = useCallback(() => {
    stateRef.current = { y: -equilibriumExt * 0.6, vy: 0 };
    setMode('oscillate');
    setIsRunning(true);
  }, [equilibriumExt]);

  const draw = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    const anchorX = w * 0.35;
    const anchorY = 25;

    // Ceiling
    ctx.fillStyle = '#64748b';
    ctx.fillRect(anchorX - 40, 0, 80, anchorY);
    // Hash marks
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    for (let i = -35; i < 40; i += 8) {
      ctx.beginPath();
      ctx.moveTo(anchorX + i, 0);
      ctx.lineTo(anchorX + i + 8, anchorY);
      ctx.stroke();
    }

    // Calculate extension
    let extension: number;
    if (mode === 'static') {
      extension = equilibriumExt + dragOffset;
    } else {
      extension = equilibriumExt + stateRef.current.y;
    }

    const totalLen = naturalLen + extension * pixelsPerUnit;
    const massY = anchorY + Math.max(totalLen, 30);
    const massR = 14 + mass * 2;

    // Draw spring (zigzag)
    const coils = 12;
    const coilW = 18;
    const springLen = massY - anchorY - massR;
    const coilH = springLen / coils;

    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    for (let i = 0; i < coils; i++) {
      const y1 = anchorY + i * coilH;
      const y2 = anchorY + (i + 0.5) * coilH;
      const y3 = anchorY + (i + 1) * coilH;
      const dir = i % 2 === 0 ? 1 : -1;
      ctx.quadraticCurveTo(anchorX + dir * coilW, y2, anchorX, y3);
    }
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Mass block
    ctx.beginPath();
    ctx.arc(anchorX, massY, massR, 0, Math.PI * 2);
    const massGrad = ctx.createRadialGradient(anchorX - 3, massY - 3, 0, anchorX, massY, massR);
    massGrad.addColorStop(0, '#ef4444');
    massGrad.addColorStop(1, '#b91c1c');
    ctx.fillStyle = massGrad;
    ctx.fill();
    ctx.strokeStyle = '#991b1b';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Mass label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${mass}kg`, anchorX, massY);

    // Natural length marker
    const natEndY = anchorY + naturalLen;
    ctx.strokeStyle = '#94a3b880';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(anchorX - 50, natEndY);
    ctx.lineTo(anchorX + 50, natEndY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('Natural length', anchorX - 55, natEndY + 3);

    // Extension arrow
    const extPixels = extension * pixelsPerUnit;
    if (Math.abs(extPixels) > 2) {
      const arrowStartY = natEndY;
      const arrowEndY = natEndY + extPixels;

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(anchorX + 35, arrowStartY);
      ctx.lineTo(anchorX + 35, arrowEndY);
      ctx.stroke();

      // Arrow head
      const dir = extPixels > 0 ? 1 : -1;
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.moveTo(anchorX + 35, arrowEndY);
      ctx.lineTo(anchorX + 30, arrowEndY - 6 * dir);
      ctx.lineTo(anchorX + 40, arrowEndY - 6 * dir);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`x = ${extension.toFixed(2)} m`, anchorX + 45, (arrowStartY + arrowEndY) / 2 + 3);
    }

    // Force arrow (restoring force)
    const force = -springK * (extension - equilibriumExt);
    if (Math.abs(force) > 0.5 && mode === 'oscillate') {
      const forceLen = Math.min(Math.abs(force) * 1.5, 50) * Math.sign(force);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(anchorX - 35, massY);
      ctx.lineTo(anchorX - 35, massY - forceLen);
      ctx.stroke();

      // Arrow head
      const fDir = force > 0 ? 1 : -1;
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.moveTo(anchorX - 35, massY - forceLen);
      ctx.lineTo(anchorX - 30, massY - forceLen + 6 * fDir);
      ctx.lineTo(anchorX - 40, massY - forceLen + 6 * fDir);
      ctx.closePath();
      ctx.fill();

      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(`F = ${force.toFixed(1)} N`, anchorX - 45, massY);
    }

    // Right panel: Force-Extension graph
    const graphX = w * 0.6;
    const graphY = 30;
    const graphW = w * 0.35;
    const graphH = h * 0.5;

    // Graph background
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(graphX, graphY, graphW, graphH, 6);
    ctx.fill();
    ctx.stroke();

    // Graph title
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Force vs Extension', graphX + graphW / 2, graphY + 15);

    // Graph axes
    const gLeft = graphX + 30;
    const gRight = graphX + graphW - 10;
    const gTop = graphY + 25;
    const gBottom = graphY + graphH - 20;

    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gLeft, gTop);
    ctx.lineTo(gLeft, gBottom);
    ctx.lineTo(gRight, gBottom);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '8px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('Extension (m)', (gLeft + gRight) / 2, gBottom + 14);
    ctx.save();
    ctx.translate(gLeft - 18, (gTop + gBottom) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Force (N)', 0, 0);
    ctx.restore();

    // F = kx line
    const maxExt = 5;
    const maxF = springK * maxExt;
    ctx.beginPath();
    ctx.moveTo(gLeft, gBottom);
    ctx.lineTo(gRight, gTop);
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Current point
    const currentExt = Math.max(0, extension);
    const currentF = springK * currentExt;
    const dotX = gLeft + (currentExt / maxExt) * (gRight - gLeft);
    const dotY = gBottom - (currentF / maxF) * (gBottom - gTop);

    if (dotX >= gLeft && dotX <= gRight && dotY >= gTop && dotY <= gBottom) {
      // Crosshair
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = '#ef444450';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dotX, gBottom);
      ctx.lineTo(dotX, dotY);
      ctx.lineTo(gLeft, dotY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Energy display (bottom right)
    const PE = 0.5 * springK * (extension - equilibriumExt) ** 2;
    const KE = mode === 'oscillate' ? 0.5 * mass * stateRef.current.vy ** 2 : 0;

    ctx.fillStyle = '#475569';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'left';
    const energyY = graphY + graphH + 15;
    ctx.fillText('Energy:', graphX, energyY);
    ctx.fillStyle = '#6366f1';
    ctx.fillText(`PE = ${PE.toFixed(2)} J`, graphX, energyY + 16);
    ctx.fillStyle = '#ef4444';
    ctx.fillText(`KE = ${KE.toFixed(2)} J`, graphX, energyY + 32);
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 10px system-ui';
    ctx.fillText(`Total = ${(PE + KE).toFixed(2)} J`, graphX, energyY + 48);

  }, [mass, springK, mode, equilibriumExt, dragOffset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const animate = () => {
      if (isRunning && mode === 'oscillate') {
        const dt = 0.016;
        const s = stateRef.current;
        const displacement = s.y;
        const restoring = -springK * displacement / mass;
        const dampForce = -damping * s.vy;

        s.vy += (restoring + dampForce) * dt;
        s.y += s.vy * dt;
      }

      draw(canvas);
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw, isRunning, mode, springK, mass, damping]);

  const period = 2 * Math.PI * Math.sqrt(mass / springK);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Hooke's Law spring and mass simulation showing spring extension and oscillation"
        style={{ width: '100%', height: 300, borderRadius: 12, border: '1px solid #e2e8f0' }}
      />

      {/* Info bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 6,
        margin: '8px 0',
        fontSize: 11,
        textAlign: 'center',
      }}>
        <div style={{ padding: '5px', borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe' }}>
          <div style={{ color: '#4338ca', fontSize: 9 }}>Spring Constant</div>
          <div style={{ fontWeight: 700, color: '#4338ca' }}>k = {springK} N/m</div>
        </div>
        <div style={{ padding: '5px', borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a' }}>
          <div style={{ color: '#92400e', fontSize: 9 }}>Eq. Extension</div>
          <div style={{ fontWeight: 700, color: '#b45309' }}>{equilibriumExt.toFixed(2)} m</div>
        </div>
        <div style={{ padding: '5px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
          <div style={{ color: '#16a34a', fontSize: 9 }}>Period (T)</div>
          <div style={{ fontWeight: 700, color: '#15803d' }}>{period.toFixed(2)} s</div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>k: <b>{springK} N/m</b></span>
          <input type="range" min={5} max={100} step={5} value={springK}
            onChange={e => { setSpringK(+e.target.value); reset(); }}
            aria-label={`Spring constant slider, ${springK} Newtons per metre, range 5 to 100`}
            style={{ width: '55%' }}
          />
        </label>
        <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Mass: <b>{mass} kg</b></span>
          <input type="range" min={0.5} max={10} step={0.5} value={mass}
            onChange={e => { setMass(+e.target.value); reset(); }}
            aria-label={`Mass slider, ${mass} kilograms, range 0.5 to 10`}
            style={{ width: '55%' }}
          />
        </label>
        {mode === 'static' && (
          <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Pull: <b>{dragOffset.toFixed(1)} m</b></span>
            <input type="range" min={-2} max={3} step={0.1} value={dragOffset}
              onChange={e => setDragOffset(+e.target.value)}
              aria-label={`Pull offset slider, ${dragOffset.toFixed(1)} metres, range -2 to 3`}
              style={{ width: '55%' }}
            />
          </label>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={startOscillation}
          aria-label="Start spring oscillation"
          style={{
            flex: 1, padding: '8px', borderRadius: 8, border: 'none',
            background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}
        >
          🔄 Oscillate
        </button>
        <button
          onClick={() => { setMode('static'); reset(); }}
          aria-label="Reset simulation"
          style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid #d4d4d8',
            background: '#fff', fontSize: 13, cursor: 'pointer',
          }}
        >
          ↺ Reset
        </button>
      </div>

      <div style={{
        marginTop: 8, padding: '6px 12px', borderRadius: 8,
        background: '#eef2ff', border: '1px solid #c7d2fe',
        fontSize: 12, textAlign: 'center', color: '#4338ca',
      }}>
        <b>F = kx</b> = {springK} × {Math.abs(mode === 'static' ? equilibriumExt + dragOffset : equilibriumExt + stateRef.current.y).toFixed(2)} = {(springK * Math.abs(mode === 'static' ? equilibriumExt + dragOffset : equilibriumExt + stateRef.current.y)).toFixed(1)} N
        &nbsp;|&nbsp; <b>T = 2π√(m/k)</b> = {period.toFixed(2)} s
      </div>
    </div>
  );
}
