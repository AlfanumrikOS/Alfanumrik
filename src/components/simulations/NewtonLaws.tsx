'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Newton's Laws Simulation
 *
 * Interactive force and motion lab demonstrating F = ma.
 * Students apply forces to a block on a surface with optional friction.
 * Shows free body diagram, acceleration, velocity, and displacement in real-time.
 */

interface Block {
  x: number;
  v: number;
  a: number;
  mass: number;
}

export default function NewtonLaws() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const blockRef = useRef<Block>({ x: 0, v: 0, a: 0, mass: 5 });
  const lastTimeRef = useRef<number>(0);

  const [appliedForce, setAppliedForce] = useState(10);
  const [mass, setMass] = useState(5);
  const [friction, setFriction] = useState(0.2);
  const [showFBD, setShowFBD] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState({ a: 0, v: 0, x: 0, netForce: 0 });

  const g = 9.8;

  const reset = useCallback(() => {
    blockRef.current = { x: 0, v: 0, a: 0, mass };
    lastTimeRef.current = 0;
    setIsRunning(false);
    setStats({ a: 0, v: 0, x: 0, netForce: 0 });
  }, [mass]);

  useEffect(() => { reset(); }, [mass, reset]);

  const draw = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const block = blockRef.current;
    const groundY = h * 0.65;
    const blockW = 40 + mass * 4;
    const blockH = 30 + mass * 3;

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, groundY);
    skyGrad.addColorStop(0, '#e0f2fe');
    skyGrad.addColorStop(1, '#f0f9ff');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, groundY);

    // Ground
    const gndGrad = ctx.createLinearGradient(0, groundY, 0, h);
    gndGrad.addColorStop(0, '#92400e');
    gndGrad.addColorStop(0.3, '#a8601c');
    gndGrad.addColorStop(1, '#78350f');
    ctx.fillStyle = gndGrad;
    ctx.fillRect(0, groundY, w, h - groundY);

    // Surface line
    ctx.strokeStyle = '#713f12';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(w, groundY);
    ctx.stroke();

    // Friction hash marks
    if (friction > 0) {
      ctx.strokeStyle = '#a0855060';
      ctx.lineWidth = 1;
      for (let i = 0; i < w; i += 12) {
        ctx.beginPath();
        ctx.moveTo(i, groundY);
        ctx.lineTo(i - 4, groundY + 6);
        ctx.stroke();
      }
    }

    // Scale markers
    ctx.fillStyle = '#71717a';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    const pixelsPerMeter = 40;
    const offsetPixels = block.x * pixelsPerMeter;
    const centerX = w / 2;

    for (let m = -10; m <= 10; m++) {
      const px = centerX + m * pixelsPerMeter - (offsetPixels % (pixelsPerMeter * 2));
      if (px > 0 && px < w) {
        ctx.beginPath();
        ctx.moveTo(px, groundY - 3);
        ctx.lineTo(px, groundY + 3);
        ctx.stroke();
      }
    }

    // Block position (centered, moves with physics)
    const blockX = centerX - blockW / 2;
    const blockY = groundY - blockH;

    // Block shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(blockX + 3, groundY - 2, blockW, 4);

    // Block body
    const blockGrad = ctx.createLinearGradient(blockX, blockY, blockX, groundY);
    blockGrad.addColorStop(0, '#3b82f6');
    blockGrad.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = blockGrad;
    ctx.beginPath();
    ctx.roundRect(blockX, blockY, blockW, blockH, 4);
    ctx.fill();

    // Block border
    ctx.strokeStyle = '#1e40af';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Mass label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${mass} kg`, blockX + blockW / 2, blockY + blockH / 2);

    // Position indicator
    ctx.fillStyle = '#3f3f46';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`x = ${block.x.toFixed(1)} m`, centerX, groundY + 20);

    // --- Free Body Diagram ---
    if (showFBD) {
      const fbdCx = blockX + blockW / 2;
      const fbdCy = blockY + blockH / 2;
      const scale = 2;

      // Weight (down)
      const W = mass * g;
      drawArrow(ctx, fbdCx, fbdCy, fbdCx, fbdCy + Math.min(W * scale, 80), '#ef4444', 2.5);
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`W=${W.toFixed(0)}N`, fbdCx + 5, fbdCy + Math.min(W * scale, 80) - 5);

      // Normal (up)
      drawArrow(ctx, fbdCx, fbdCy, fbdCx, fbdCy - Math.min(W * scale, 80), '#22c55e', 2.5);
      ctx.fillStyle = '#22c55e';
      ctx.fillText(`N=${W.toFixed(0)}N`, fbdCx + 5, fbdCy - Math.min(W * scale, 80) + 12);

      // Applied force (right)
      if (isRunning || appliedForce > 0) {
        const fLen = Math.min(appliedForce * scale, 100);
        drawArrow(ctx, fbdCx, fbdCy, fbdCx + fLen, fbdCy, '#3b82f6', 2.5);
        ctx.fillStyle = '#3b82f6';
        ctx.textAlign = 'center';
        ctx.fillText(`F=${appliedForce.toFixed(0)}N`, fbdCx + fLen / 2, fbdCy - 10);
      }

      // Friction (opposes applied force or motion)
      if (friction > 0 && (isRunning || appliedForce > 0)) {
        const maxFriction = friction * W;
        const fFriction = Math.min(maxFriction, Math.abs(appliedForce));
        const frLen = Math.min(fFriction * scale, 100);
        if (frLen > 2) {
          // Friction arrow points opposite to applied force direction
          drawArrow(ctx, fbdCx, fbdCy, fbdCx - frLen, fbdCy, '#f59e0b', 2.5);
          ctx.fillStyle = '#f59e0b';
          ctx.textAlign = 'center';
          ctx.fillText(`f=${fFriction.toFixed(1)}N`, fbdCx - frLen / 2, fbdCy + 15);
        }
      }
    }

    // Velocity indicator
    if (Math.abs(block.v) > 0.1) {
      const velArrowLen = Math.min(Math.abs(block.v) * 8, 60) * Math.sign(block.v);
      ctx.strokeStyle = '#8b5cf6';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 3]);
      drawArrow(ctx, centerX, blockY - 15, centerX + velArrowLen, blockY - 15, '#8b5cf6', 3);
      ctx.setLineDash([]);
      ctx.fillStyle = '#8b5cf6';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`v=${block.v.toFixed(1)} m/s`, centerX, blockY - 25);
    }
  }, [mass, friction, appliedForce, isRunning, showFBD]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const animate = (time: number) => {
      if (lastTimeRef.current === 0) lastTimeRef.current = time;
      const dt = Math.min((time - lastTimeRef.current) / 1000, 0.05);
      lastTimeRef.current = time;

      if (isRunning) {
        const block = blockRef.current;
        const W = mass * g;
        const maxStaticFriction = friction * W;

        // Friction opposes motion (kinetic) or prevents motion (static)
        let frictionForce = 0;
        if (Math.abs(block.v) > 0.01) {
          // Kinetic friction: opposes direction of velocity
          frictionForce = Math.sign(block.v) * friction * W;
        } else {
          // Static friction: opposes net applied force, capped at max static
          if (Math.abs(appliedForce) > maxStaticFriction) {
            frictionForce = 0; // Static friction overcome — block starts moving
          } else {
            frictionForce = appliedForce; // Balances applied force exactly
          }
        }

        const netForce = appliedForce - frictionForce;
        const a = netForce / mass;

        block.a = a;
        block.v += a * dt;
        block.x += block.v * dt;

        // Stop block if velocity crosses zero due to friction (prevents oscillation)
        if (Math.abs(block.v) < 0.01 && Math.abs(appliedForce) <= maxStaticFriction) {
          block.v = 0;
        }

        setStats({
          a: block.a,
          v: block.v,
          x: block.x,
          netForce,
        });
      }

      draw(canvas);
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw, isRunning, mass, appliedForce, friction]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 260, borderRadius: 12, background: '#f0f9ff' }}
      />

      {/* Stats bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
        margin: '10px 0',
        fontSize: 11,
        textAlign: 'center',
      }}>
        {[
          { label: 'Net Force', value: `${stats.netForce.toFixed(1)} N`, color: '#3b82f6' },
          { label: 'Acceleration', value: `${stats.a.toFixed(2)} m/s²`, color: '#ef4444' },
          { label: 'Velocity', value: `${stats.v.toFixed(2)} m/s`, color: '#8b5cf6' },
          { label: 'Position', value: `${stats.x.toFixed(1)} m`, color: '#22c55e' },
        ].map(s => (
          <div key={s.label} style={{
            padding: '6px 4px',
            borderRadius: 8,
            background: `${s.color}10`,
            border: `1px solid ${s.color}25`,
          }}>
            <div style={{ color: '#71717a', fontSize: 9 }}>{s.label}</div>
            <div style={{ color: s.color, fontWeight: 700, fontSize: 13 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Applied Force: <b>{appliedForce} N</b></span>
          <input type="range" min={0} max={100} step={1} value={appliedForce}
            onChange={e => setAppliedForce(+e.target.value)}
            style={{ width: '55%' }}
          />
        </label>
        <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Mass: <b>{mass} kg</b></span>
          <input type="range" min={1} max={20} step={1} value={mass}
            onChange={e => setMass(+e.target.value)}
            style={{ width: '55%' }}
          />
        </label>
        <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Friction (μ): <b>{friction.toFixed(2)}</b></span>
          <input type="range" min={0} max={1} step={0.05} value={friction}
            onChange={e => setFriction(+e.target.value)}
            style={{ width: '55%' }}
          />
        </label>
      </div>

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={() => setIsRunning(!isRunning)}
          style={{
            flex: 1,
            padding: '8px 0',
            borderRadius: 8,
            border: 'none',
            background: isRunning ? '#ef4444' : '#22c55e',
            color: '#fff',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {isRunning ? '⏸ Pause' : '▶ Apply Force'}
        </button>
        <button
          onClick={reset}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid #d4d4d8',
            background: '#fff',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          ↺ Reset
        </button>
        <button
          onClick={() => setShowFBD(!showFBD)}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: `1px solid ${showFBD ? '#3b82f6' : '#d4d4d8'}`,
            background: showFBD ? '#eff6ff' : '#fff',
            color: showFBD ? '#3b82f6' : '#71717a',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          FBD {showFBD ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Formula */}
      <div style={{
        marginTop: 10,
        padding: '8px 12px',
        borderRadius: 8,
        background: '#f0f9ff',
        border: '1px solid #bae6fd',
        fontSize: 12,
        textAlign: 'center',
        color: '#0369a1',
      }}>
        <b>F = ma</b> → {appliedForce} = {mass} × {(appliedForce / mass).toFixed(2)} m/s²
        {friction > 0 && <span style={{ color: '#92400e' }}> | f = μN = {friction} × {(mass * g).toFixed(0)} = {(friction * mass * g).toFixed(1)} N</span>}
      </div>
    </div>
  );
}

function drawArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, lineWidth: number) {
  const headLen = 8;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
