'use client';
import { useState, useEffect } from 'react';
import { useResponsiveCanvas } from '@/hooks/useResponsiveCanvas';

export default function ConcaveMirrorLab() {
  const [focal, setFocal] = useState(8);
  const [objDist, setObjDist] = useState(16);
  const { canvasRef, containerRef, size } = useResponsiveCanvas(560 / 260);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = size.width, H = size.height;
    ctx.clearRect(0, 0, W, H);

    const scale = 14; // pixels per cm
    const poleX = W - 60; // mirror pole on right
    const axisY = H / 2;

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    // Principal axis
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, axisY);
    ctx.lineTo(W - 20, axisY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Concave mirror arc
    ctx.beginPath();
    ctx.arc(poleX - focal * scale, axisY, focal * scale, -Math.PI / 6, Math.PI / 6);
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Label points
    const markPt = (x: number, label: string, color: string) => {
      ctx.beginPath();
      ctx.arc(x, axisY, 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, axisY + 18);
    };

    const Px = poleX;
    const Fx = poleX - focal * scale;
    const Cx = poleX - 2 * focal * scale;
    markPt(Px, 'P', '#93c5fd');
    if (Fx > 30) markPt(Fx, 'F', '#fbbf24');
    if (Cx > 30) markPt(Cx, 'C', '#f87171');

    // Object arrow
    const objX = poleX - objDist * scale;
    const objH = 50;
    if (objX > 30) {
      ctx.beginPath();
      ctx.moveTo(objX, axisY);
      ctx.lineTo(objX, axisY - objH);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.stroke();
      // arrowhead
      ctx.beginPath();
      ctx.moveTo(objX, axisY - objH);
      ctx.lineTo(objX - 6, axisY - objH + 10);
      ctx.lineTo(objX + 6, axisY - objH + 10);
      ctx.closePath();
      ctx.fillStyle = '#4ade80';
      ctx.fill();
    }

    // Image calculation: 1/v = 1/f - 1/(-u) using sign convention u=-objDist, f=-focal
    const u = -objDist;
    const f = -focal;
    const v = (u * f) / (u - f);
    const m = -v / u;
    const imgDist = -v; // distance from pole (positive = in front)
    const imgH = m * objH;

    // Image arrow
    const imgX = poleX - imgDist * scale;
    const isReal = v < 0;
    const isVirtual = v > 0;

    if (imgX > 10 && imgX < W - 10) {
      ctx.beginPath();
      ctx.moveTo(imgX, axisY);
      ctx.lineTo(imgX, axisY - imgH);
      ctx.strokeStyle = isVirtual ? '#c084fc' : '#fb923c';
      ctx.lineWidth = 2;
      ctx.setLineDash(isVirtual ? [4, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = isVirtual ? '#c084fc' : '#fb923c';
      ctx.textAlign = 'center';
      ctx.fillText(isVirtual ? 'Virtual' : 'Real', imgX, axisY + 32);
    }

    // Info text
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9ca3af';
    ctx.fillText(`u = -${objDist} cm  |  v = ${v.toFixed(1)} cm  |  m = ${m.toFixed(2)}`, 20, H - 12);
  }, [focal, objDist, size, canvasRef]);

  const u = -objDist, f = -focal;
  const v = +((u * f) / (u - f)).toFixed(2);
  const m = +(-v / u).toFixed(2);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Concave Mirror Lab</h3>
      <div ref={containerRef} className="w-full" style={{ aspectRatio: '560/260' }}>
        <canvas ref={canvasRef} className="rounded-lg" style={{ display: 'block' }} />
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Focal length f: {focal} cm</label>
          <input type="range" min={4} max={15} value={focal} onChange={e => setFocal(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Object distance u: {objDist} cm</label>
          <input type="range" min={2} max={30} value={objDist} onChange={e => setObjDist(+e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        1/v + 1/u = 1/f &nbsp;→&nbsp; v = <b style={{ color: 'var(--orange,#f97316)' }}>{v} cm</b> &nbsp;|&nbsp; m = <b style={{ color: 'var(--purple,#7c3aed)' }}>{m}</b>
      </div>
    </div>
  );
}
