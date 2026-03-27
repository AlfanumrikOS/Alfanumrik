'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Quadratic Equation Grapher
 *
 * Interactive graph of y = ax² + bx + c.
 * Shows roots, vertex, axis of symmetry, discriminant.
 * Students adjust a, b, c and see the parabola change in real-time.
 */

export default function QuadraticGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [a, setA] = useState(1);
  const [b, setB] = useState(-2);
  const [c, setC] = useState(-3);

  const discriminant = b * b - 4 * a * c;
  const vertexX = a !== 0 ? -b / (2 * a) : 0;
  const vertexY = a !== 0 ? a * vertexX * vertexX + b * vertexX + c : c;

  let root1: number | null = null;
  let root2: number | null = null;
  if (a !== 0 && discriminant >= 0) {
    root1 = (-b + Math.sqrt(discriminant)) / (2 * a);
    root2 = (-b - Math.sqrt(discriminant)) / (2 * a);
  }

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
    ctx.fillStyle = '#fafaf9';
    ctx.fillRect(0, 0, w, h);

    // Determine view bounds
    const padding = 40;
    const plotW = w - padding * 2;
    const plotH = h - padding * 2;

    // Auto-scale based on vertex and roots
    let xMin = -10, xMax = 10;
    let yMin = -10, yMax = 10;

    if (a !== 0) {
      xMin = Math.min(vertexX - 5, root1 !== null ? root1 - 2 : -5);
      xMax = Math.max(vertexX + 5, root2 !== null ? root2 + 2 : 5);
      const yRange = Math.abs(vertexY) + 8;
      if (a > 0) {
        yMin = vertexY - 2;
        yMax = vertexY + yRange;
      } else {
        yMin = vertexY - yRange;
        yMax = vertexY + 2;
      }
    }

    // Ensure origin is visible
    if (xMin > -1) xMin = -1;
    if (xMax < 1) xMax = 1;
    if (yMin > -1) yMin = -1;
    if (yMax < 1) yMax = 1;

    const toPixelX = (x: number) => padding + ((x - xMin) / (xMax - xMin)) * plotW;
    const toPixelY = (y: number) => padding + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

    // Grid
    ctx.strokeStyle = '#e7e5e4';
    ctx.lineWidth = 0.5;
    for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x++) {
      const px = toPixelX(x);
      ctx.beginPath();
      ctx.moveTo(px, padding);
      ctx.lineTo(px, h - padding);
      ctx.stroke();
    }
    for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y++) {
      const py = toPixelY(y);
      ctx.beginPath();
      ctx.moveTo(padding, py);
      ctx.lineTo(w - padding, py);
      ctx.stroke();
    }

    // Axes
    const originX = toPixelX(0);
    const originY = toPixelY(0);

    ctx.strokeStyle = '#57534e';
    ctx.lineWidth = 1.5;

    if (originX >= padding && originX <= w - padding) {
      ctx.beginPath();
      ctx.moveTo(originX, padding);
      ctx.lineTo(originX, h - padding);
      ctx.stroke();
    }
    if (originY >= padding && originY <= h - padding) {
      ctx.beginPath();
      ctx.moveTo(padding, originY);
      ctx.lineTo(w - padding, originY);
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = '#78716c';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x++) {
      if (x === 0) continue;
      const px = toPixelX(x);
      if (px > padding + 10 && px < w - padding - 10) {
        ctx.fillText(String(x), px, Math.min(originY + 14, h - padding + 14));
      }
    }
    ctx.textAlign = 'right';
    for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y++) {
      if (y === 0) continue;
      const py = toPixelY(y);
      if (py > padding + 5 && py < h - padding - 5) {
        ctx.fillText(String(y), Math.max(originX - 6, padding - 4), py + 3);
      }
    }

    // Axis of symmetry (dashed)
    if (a !== 0) {
      const axisX = toPixelX(vertexX);
      ctx.strokeStyle = '#f59e0b80';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(axisX, padding);
      ctx.lineTo(axisX, h - padding);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(`x = ${vertexX.toFixed(1)}`, axisX, padding - 5);
    }

    // Parabola
    if (a !== 0) {
      ctx.beginPath();
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2.5;

      let started = false;
      const step = (xMax - xMin) / plotW;
      for (let x = xMin; x <= xMax; x += step) {
        const y = a * x * x + b * x + c;
        const px = toPixelX(x);
        const py = toPixelY(y);
        if (py >= padding - 20 && py <= h - padding + 20) {
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    } else {
      // Linear: y = bx + c
      ctx.beginPath();
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2.5;
      ctx.moveTo(toPixelX(xMin), toPixelY(b * xMin + c));
      ctx.lineTo(toPixelX(xMax), toPixelY(b * xMax + c));
      ctx.stroke();
    }

    // Vertex
    if (a !== 0) {
      const vx = toPixelX(vertexX);
      const vy = toPixelY(vertexY);
      ctx.beginPath();
      ctx.arc(vx, vy, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ef4444';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`(${vertexX.toFixed(1)}, ${vertexY.toFixed(1)})`, vx + 8, vy - 8);
    }

    // Roots
    if (root1 !== null && root2 !== null) {
      [root1, root2].forEach((r, i) => {
        const rx = toPixelX(r);
        const ry = toPixelY(0);
        ctx.beginPath();
        ctx.arc(rx, ry, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#22c55e';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = '#22c55e';
        ctx.font = '10px system-ui';
        ctx.textAlign = i === 0 ? 'left' : 'right';
        ctx.fillText(`x=${r.toFixed(2)}`, rx + (i === 0 ? 8 : -8), ry - 10);
      });
    }

    // Y-intercept
    const yIntPx = toPixelY(c);
    if (yIntPx >= padding && yIntPx <= h - padding) {
      const yiX = toPixelX(0);
      ctx.beginPath();
      ctx.arc(yiX, yIntPx, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#8b5cf6';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#8b5cf6';
      ctx.font = '9px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(`(0, ${c})`, yiX + 6, yIntPx + 4);
    }

  }, [a, b, c, vertexX, vertexY, root1, root2]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) draw(canvas);
  }, [draw]);

  // Build equation string
  const eqParts: string[] = [];
  if (a !== 0) eqParts.push(a === 1 ? 'x²' : a === -1 ? '-x²' : `${a}x²`);
  if (b !== 0) eqParts.push(b > 0 && eqParts.length > 0 ? `+ ${b === 1 ? '' : b}x` : `${b === -1 ? '-' : b}x`);
  if (c !== 0) eqParts.push(c > 0 && eqParts.length > 0 ? `+ ${c}` : `${c}`);
  const equation = eqParts.length > 0 ? `y = ${eqParts.join(' ')}` : 'y = 0';

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Equation display */}
      <div style={{
        textAlign: 'center',
        padding: '8px',
        marginBottom: 8,
        borderRadius: 10,
        background: '#eef2ff',
        border: '1px solid #c7d2fe',
        fontFamily: 'serif',
        fontSize: 18,
        fontWeight: 700,
        color: '#4338ca',
        letterSpacing: 1,
      }}>
        {equation}
      </div>

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 260, borderRadius: 12, border: '1px solid #e7e5e4' }}
      />

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 6,
        margin: '10px 0',
        fontSize: 11,
      }}>
        <div style={{ padding: '6px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', textAlign: 'center' }}>
          <div style={{ color: '#b91c1c', fontSize: 9 }}>Vertex</div>
          <div style={{ color: '#dc2626', fontWeight: 700 }}>({vertexX.toFixed(1)}, {vertexY.toFixed(1)})</div>
        </div>
        <div style={{ padding: '6px', borderRadius: 8, background: discriminant >= 0 ? '#f0fdf4' : '#fef9c3', border: `1px solid ${discriminant >= 0 ? '#bbf7d0' : '#fde68a'}`, textAlign: 'center' }}>
          <div style={{ color: discriminant >= 0 ? '#16a34a' : '#a16207', fontSize: 9 }}>D = b²−4ac</div>
          <div style={{ fontWeight: 700, color: discriminant >= 0 ? '#15803d' : '#92400e' }}>{discriminant.toFixed(1)} {discriminant > 0 ? '(2 roots)' : discriminant === 0 ? '(1 root)' : '(no real roots)'}</div>
        </div>
        <div style={{ padding: '6px', borderRadius: 8, background: '#f5f3ff', border: '1px solid #ddd6fe', textAlign: 'center' }}>
          <div style={{ color: '#7c3aed', fontSize: 9 }}>Y-intercept</div>
          <div style={{ color: '#6d28d9', fontWeight: 700 }}>(0, {c})</div>
        </div>
      </div>

      {/* Roots display */}
      {root1 !== null && root2 !== null && (
        <div style={{
          padding: '6px 12px',
          borderRadius: 8,
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          fontSize: 12,
          textAlign: 'center',
          color: '#15803d',
          marginBottom: 8,
        }}>
          Roots: <b>x = {root1.toFixed(2)}</b>{discriminant > 0 && <> and <b>x = {root2.toFixed(2)}</b></>}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#6366f1' }}>a = <b>{a}</b></span>
          <input type="range" min={-5} max={5} step={0.5} value={a}
            onChange={e => setA(+e.target.value)}
            style={{ width: '60%' }}
          />
        </label>
        <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#8b5cf6' }}>b = <b>{b}</b></span>
          <input type="range" min={-10} max={10} step={0.5} value={b}
            onChange={e => setB(+e.target.value)}
            style={{ width: '60%' }}
          />
        </label>
        <label style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#a855f7' }}>c = <b>{c}</b></span>
          <input type="range" min={-10} max={10} step={0.5} value={c}
            onChange={e => setC(+e.target.value)}
            style={{ width: '60%' }}
          />
        </label>
      </div>

      {/* Presets */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {[
          { label: 'x²−4', a: 1, b: 0, c: -4 },
          { label: '−x²+4', a: -1, b: 0, c: 4 },
          { label: 'x²−2x−3', a: 1, b: -2, c: -3 },
          { label: 'x²+1 (no roots)', a: 1, b: 0, c: 1 },
          { label: '2x²−4x+2', a: 2, b: -4, c: 2 },
        ].map(p => (
          <button key={p.label} onClick={() => { setA(p.a); setB(p.b); setC(p.c); }}
            style={{
              padding: '4px 8px', borderRadius: 6, border: '1px solid #c7d2fe',
              background: '#eef2ff', color: '#4338ca', fontSize: 10, cursor: 'pointer',
            }}
          >{p.label}</button>
        ))}
      </div>
    </div>
  );
}
