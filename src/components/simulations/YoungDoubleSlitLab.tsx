'use client';
import { useState, useEffect } from 'react';
import { useResponsiveCanvas } from '@/hooks/useResponsiveCanvas';

export default function YoungDoubleSlitLab() {
  const [lambda, setLambda] = useState(550);
  const [d, setD] = useState(0.5);
  const [D, setD_] = useState(1.0);
  const { canvasRef, containerRef, size } = useResponsiveCanvas(2);

  const beta = (lambda * 1e-9 * D) / (d * 1e-3) * 1000; // fringe width in mm

  function wavelengthToRgb(wl: number) {
    let r = 0, g = 0, b = 0;
    if (wl >= 380 && wl < 440) { r = -(wl - 440) / 60; b = 1; }
    else if (wl < 490) { g = (wl - 440) / 50; b = 1; }
    else if (wl < 510) { g = 1; b = -(wl - 510) / 20; }
    else if (wl < 580) { r = (wl - 510) / 70; g = 1; }
    else if (wl < 645) { r = 1; g = -(wl - 645) / 65; }
    else { r = 1; }
    const factor = wl < 420 ? 0.3 + 0.7 * (wl - 380) / 40 : wl > 700 ? 0.3 + 0.7 * (700 - wl) / 55 : 1;
    return `rgb(${Math.round(r * 255 * factor)},${Math.round(g * 255 * factor)},${Math.round(b * 255 * factor)})`;
  }

  const lightColor = wavelengthToRgb(lambda);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = size.width, H = size.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    // Source arrow (left)
    ctx.strokeStyle = lightColor;
    ctx.lineWidth = 2;
    for (let y = H / 2 - 40; y <= H / 2 + 40; y += 10) {
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(90, y);
      ctx.stroke();
    }

    // Barrier with slits
    const barrierX = 100;
    const slitGap = 30;
    const slitH = 8;
    ctx.fillStyle = '#4b5563';
    ctx.fillRect(barrierX, 0, 8, H / 2 - slitGap - slitH);
    ctx.fillRect(barrierX, H / 2 - slitGap + slitH, 8, slitGap * 2 - slitH * 2);
    ctx.fillRect(barrierX, H / 2 + slitGap + slitH, 8, H - (H / 2 + slitGap + slitH));

    // Rays from slits
    const slit1Y = H / 2 - slitGap;
    const slit2Y = H / 2 + slitGap;
    ctx.strokeStyle = lightColor + '55';
    ctx.lineWidth = 1;
    const screenX = W - 60;
    for (let i = -3; i <= 3; i++) {
      const screenY = H / 2 + i * (H / 8);
      ctx.beginPath();
      ctx.moveTo(barrierX + 8, slit1Y);
      ctx.lineTo(screenX, screenY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(barrierX + 8, slit2Y);
      ctx.lineTo(screenX, screenY);
      ctx.stroke();
    }

    // Fringe pattern on screen
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(screenX, 0, 40, H);

    const numFringes = 7;
    const halfH = H / 2;
    const fringeSpacingPx = (H * 0.4) / numFringes;

    for (let n = -numFringes; n <= numFringes; n++) {
      const y = halfH + n * fringeSpacingPx;
      const bright = Math.pow(Math.cos((n * Math.PI) / 2), 2);
      const intensity = bright > 0.5 ? 1 : 0.08;
      const color = n === 0 ? `rgba(255,255,220,${intensity})` : `${lightColor.slice(0, -1)},${intensity})`.replace('rgb', 'rgba');
      ctx.fillStyle = color;
      ctx.fillRect(screenX + 1, y - fringeSpacingPx / 2, 38, fringeSpacingPx);
    }

    // Labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Source', 50, H - 8);
    ctx.fillText('Slits', barrierX + 4, H - 8);
    ctx.fillText('Screen', screenX + 20, H - 8);

    // β annotation
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(screenX - 5, halfH);
    ctx.lineTo(screenX - 5, halfH + fringeSpacingPx);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'right';
    ctx.fillText(`β`, screenX - 8, halfH + fringeSpacingPx / 2 + 4);
  }, [lambda, d, D, lightColor, size, canvasRef]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Young's Double Slit Lab</h3>
      <div ref={containerRef} className="w-full" style={{ aspectRatio: '2/1' }}>
        <canvas ref={canvasRef} className="rounded-lg" style={{ display: 'block' }} />
      </div>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
        <div>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>λ: {lambda} nm <span style={{ display: 'inline-block', width: 12, height: 12, background: lightColor, borderRadius: 2, verticalAlign: 'middle' }} /></label>
          <input type="range" min={380} max={700} value={lambda} onChange={e => setLambda(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>d: {d.toFixed(1)} mm</label>
          <input type="range" min={0.1} max={1} step={0.05} value={d} onChange={e => setD(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>D: {D.toFixed(1)} m</label>
          <input type="range" min={0.5} max={2} step={0.1} value={D} onChange={e => setD_(+e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        β = λD/d = <b style={{ color: 'var(--orange,#f97316)' }}>{(beta).toFixed(3)} mm</b>
      </div>
    </div>
  );
}
