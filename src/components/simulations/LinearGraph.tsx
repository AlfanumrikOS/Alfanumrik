'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Linear Equation Grapher
 *
 * Interactive visualization of y = mx + c (slope-intercept form).
 * Shows slope, y-intercept, x-intercept, and angle with x-axis.
 * Supports comparison of two lines (parallel, perpendicular, intersecting).
 */

export default function LinearGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [m1, setM1] = useState(2);
  const [c1, setC1] = useState(1);
  const [showSecondLine, setShowSecondLine] = useState(false);
  const [m2, setM2] = useState(-0.5);
  const [c2, setC2] = useState(3);

  const draw = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#fafaf9';
    ctx.fillRect(0, 0, w, h);

    const pad = 35;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;

    const xRange = 10;
    const yRange = 10;
    const xMin = -xRange, xMax = xRange;
    const yMin = -yRange, yMax = yRange;

    const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * plotW;
    const toY = (y: number) => pad + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

    // Grid
    ctx.strokeStyle = '#e7e5e4';
    ctx.lineWidth = 0.5;
    for (let i = Math.ceil(xMin); i <= Math.floor(xMax); i++) {
      const px = toX(i);
      ctx.beginPath(); ctx.moveTo(px, pad); ctx.lineTo(px, h - pad); ctx.stroke();
    }
    for (let i = Math.ceil(yMin); i <= Math.floor(yMax); i++) {
      const py = toY(i);
      ctx.beginPath(); ctx.moveTo(pad, py); ctx.lineTo(w - pad, py); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = '#57534e';
    ctx.lineWidth = 1.5;
    const oX = toX(0), oY = toY(0);
    ctx.beginPath(); ctx.moveTo(oX, pad); ctx.lineTo(oX, h - pad); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad, oY); ctx.lineTo(w - pad, oY); ctx.stroke();

    // Tick labels
    ctx.fillStyle = '#78716c';
    ctx.font = '8px system-ui';
    ctx.textAlign = 'center';
    for (let i = Math.ceil(xMin); i <= Math.floor(xMax); i += 2) {
      if (i === 0) continue;
      ctx.fillText(String(i), toX(i), oY + 12);
    }
    ctx.textAlign = 'right';
    for (let i = Math.ceil(yMin); i <= Math.floor(yMax); i += 2) {
      if (i === 0) continue;
      ctx.fillText(String(i), oX - 5, toY(i) + 3);
    }

    // Draw line function
    const drawLine = (m: number, c: number, color: string, label: string) => {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;

      const y1 = m * xMin + c;
      const y2 = m * xMax + c;
      ctx.moveTo(toX(xMin), toY(y1));
      ctx.lineTo(toX(xMax), toY(y2));
      ctx.stroke();

      // Y-intercept dot
      const yIntPy = toY(c);
      if (yIntPy >= pad && yIntPy <= h - pad) {
        ctx.beginPath();
        ctx.arc(oX, yIntPy, 5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.font = '9px system-ui';
        ctx.textAlign = 'left';
        ctx.fillText(`(0, ${c})`, oX + 8, yIntPy - 6);
      }

      // X-intercept dot
      if (m !== 0) {
        const xInt = -c / m;
        const xIntPx = toX(xInt);
        const xIntPy = oY;
        if (xIntPx >= pad && xIntPx <= w - pad) {
          ctx.beginPath();
          ctx.arc(xIntPx, xIntPy, 4, 0, Math.PI * 2);
          ctx.fillStyle = color + '80';
          ctx.fill();

          ctx.fillStyle = color;
          ctx.font = '8px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(`(${xInt.toFixed(1)}, 0)`, xIntPx, xIntPy + 14);
        }
      }

      // Slope triangle at x = 1
      if (Math.abs(m) > 0.1 && Math.abs(m) < 8) {
        const sx = 1;
        const sy = m * sx + c;
        const sx2 = 2;
        const sy2 = m * sx2 + c;

        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = color + '50';
        ctx.lineWidth = 1;

        // Horizontal
        ctx.beginPath();
        ctx.moveTo(toX(sx), toY(sy));
        ctx.lineTo(toX(sx2), toY(sy));
        ctx.stroke();

        // Vertical (rise)
        ctx.beginPath();
        ctx.moveTo(toX(sx2), toY(sy));
        ctx.lineTo(toX(sx2), toY(sy2));
        ctx.stroke();

        ctx.setLineDash([]);

        // Rise/Run labels
        ctx.fillStyle = color;
        ctx.font = '8px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('run=1', (toX(sx) + toX(sx2)) / 2, toY(sy) + 10);
        ctx.textAlign = 'left';
        ctx.fillText(`rise=${m}`, toX(sx2) + 4, (toY(sy) + toY(sy2)) / 2 + 3);
      }

      // Label
      ctx.fillStyle = color;
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'left';
      const labelY = m * (xMax - 1) + c;
      const ly = toY(labelY);
      if (ly > pad + 15 && ly < h - pad - 5) {
        ctx.fillText(label, toX(xMax - 1) + 4, ly - 6);
      }
    };

    // Draw lines
    const eq1 = `y = ${m1 === 1 ? '' : m1 === -1 ? '-' : m1}x ${c1 >= 0 ? '+' : ''} ${c1}`;
    drawLine(m1, c1, '#6366f1', eq1);

    if (showSecondLine) {
      const eq2 = `y = ${m2 === 1 ? '' : m2 === -1 ? '-' : m2}x ${c2 >= 0 ? '+' : ''} ${c2}`;
      drawLine(m2, c2, '#ef4444', eq2);

      // Intersection point
      if (m1 !== m2) {
        const ix = (c2 - c1) / (m1 - m2);
        const iy = m1 * ix + c1;
        const ipx = toX(ix);
        const ipy = toY(iy);

        if (ipx >= pad && ipx <= w - pad && ipy >= pad && ipy <= h - pad) {
          ctx.beginPath();
          ctx.arc(ipx, ipy, 6, 0, Math.PI * 2);
          ctx.fillStyle = '#22c55e';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#22c55e';
          ctx.font = 'bold 10px system-ui';
          ctx.textAlign = 'center';
          ctx.fillText(`(${ix.toFixed(1)}, ${iy.toFixed(1)})`, ipx, ipy - 10);
        }
      }
    }

    // Axis labels
    ctx.fillStyle = '#57534e';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('x', w - pad + 15, oY + 4);
    ctx.fillText('y', oX, pad - 8);

  }, [m1, c1, showSecondLine, m2, c2]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) draw(canvas);
  }, [draw]);

  const angle1 = Math.atan(m1) * (180 / Math.PI);
  const relationship = showSecondLine
    ? m1 === m2 ? (c1 === c2 ? 'Same line' : 'Parallel')
    : Math.abs(m1 * m2 + 1) < 0.01 ? 'Perpendicular'
    : 'Intersecting'
    : null;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 280, borderRadius: 12, border: '1px solid #e7e5e4' }}
      />

      {/* Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: showSecondLine ? 'repeat(4, 1fr)' : 'repeat(3, 1fr)',
        gap: 6,
        margin: '8px 0',
        fontSize: 11,
        textAlign: 'center',
      }}>
        <div style={{ padding: 5, borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe' }}>
          <div style={{ color: '#4338ca', fontSize: 9 }}>Slope (m)</div>
          <div style={{ fontWeight: 700, color: '#4338ca' }}>{m1}</div>
        </div>
        <div style={{ padding: 5, borderRadius: 8, background: '#f5f3ff', border: '1px solid #ddd6fe' }}>
          <div style={{ color: '#6d28d9', fontSize: 9 }}>Angle</div>
          <div style={{ fontWeight: 700, color: '#6d28d9' }}>{angle1.toFixed(1)}°</div>
        </div>
        <div style={{ padding: 5, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca' }}>
          <div style={{ color: '#b91c1c', fontSize: 9 }}>x-intercept</div>
          <div style={{ fontWeight: 700, color: '#dc2626' }}>{m1 !== 0 ? (-c1 / m1).toFixed(1) : '∞'}</div>
        </div>
        {showSecondLine && relationship && (
          <div style={{
            padding: 5, borderRadius: 8,
            background: relationship === 'Perpendicular' ? '#f0fdf4' : relationship === 'Parallel' ? '#fef3c7' : '#eff6ff',
            border: `1px solid ${relationship === 'Perpendicular' ? '#bbf7d0' : relationship === 'Parallel' ? '#fde68a' : '#bfdbfe'}`,
          }}>
            <div style={{ fontSize: 9, color: '#64748b' }}>Relation</div>
            <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 10 }}>{relationship}</div>
          </div>
        )}
      </div>

      {/* Line 1 Controls */}
      <div style={{ marginBottom: 8, padding: '6px 10px', borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#4338ca', marginBottom: 4 }}>Line 1</div>
        <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span>slope m = <b>{m1}</b></span>
          <input type="range" min={-5} max={5} step={0.5} value={m1}
            onChange={e => setM1(+e.target.value)} style={{ width: '55%' }}
          />
        </label>
        <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>intercept c = <b>{c1}</b></span>
          <input type="range" min={-8} max={8} step={0.5} value={c1}
            onChange={e => setC1(+e.target.value)} style={{ width: '55%' }}
          />
        </label>
      </div>

      {/* Second line toggle + controls */}
      <button
        onClick={() => setShowSecondLine(!showSecondLine)}
        style={{
          width: '100%', padding: '6px', borderRadius: 8,
          border: `1px solid ${showSecondLine ? '#ef4444' : '#d4d4d8'}`,
          background: showSecondLine ? '#fef2f2' : '#fff',
          color: showSecondLine ? '#ef4444' : '#71717a',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 6,
        }}
      >
        {showSecondLine ? '✕ Hide' : '+ Compare'} Second Line
      </button>

      {showSecondLine && (
        <div style={{ padding: '6px 10px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>Line 2</div>
          <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span>slope m = <b>{m2}</b></span>
            <input type="range" min={-5} max={5} step={0.5} value={m2}
              onChange={e => setM2(+e.target.value)} style={{ width: '55%' }}
            />
          </label>
          <label style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>intercept c = <b>{c2}</b></span>
            <input type="range" min={-8} max={8} step={0.5} value={c2}
              onChange={e => setC2(+e.target.value)} style={{ width: '55%' }}
            />
          </label>
        </div>
      )}

      {/* Presets */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {[
          { label: 'y = x', m: 1, c: 0 },
          { label: 'y = 2x + 1', m: 2, c: 1 },
          { label: 'y = -x + 3', m: -1, c: 3 },
          { label: 'y = ½x - 2', m: 0.5, c: -2 },
        ].map(p => (
          <button key={p.label} onClick={() => { setM1(p.m); setC1(p.c); }}
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
