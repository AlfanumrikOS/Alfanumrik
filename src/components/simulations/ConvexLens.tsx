'use client';
import { useState, useRef, useEffect } from 'react';

export default function ConvexLens() {
  const [focal, setFocal] = useState(8);
  const [objDist, setObjDist] = useState(18);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    const scale = 12;
    const lensX = W / 2;
    const axisY = H / 2;
    const objH = 50;

    // Principal axis
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, axisY);
    ctx.lineTo(W - 10, axisY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Lens (biconvex)
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(lensX - 18, axisY, 70, -Math.PI / 4.5, Math.PI / 4.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(lensX + 18, axisY, 70, Math.PI - Math.PI / 4.5, Math.PI + Math.PI / 4.5);
    ctx.stroke();
    // lens axis bar
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lensX, axisY - 80);
    ctx.lineTo(lensX, axisY + 80);
    ctx.stroke();

    // Focus points
    const f1X = lensX - focal * scale;
    const f2X = lensX + focal * scale;
    const markF = (x: number, label: string) => {
      ctx.beginPath();
      ctx.arc(x, axisY, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, axisY + 16);
    };
    markF(f1X, 'F');
    markF(f2X, "F'");

    // Object
    const objX = lensX - objDist * scale;
    if (objX > 10) {
      ctx.beginPath();
      ctx.moveTo(objX, axisY);
      ctx.lineTo(objX, axisY - objH);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(objX, axisY - objH);
      ctx.lineTo(objX - 6, axisY - objH + 10);
      ctx.lineTo(objX + 6, axisY - objH + 10);
      ctx.closePath();
      ctx.fillStyle = '#4ade80';
      ctx.fill();
    }

    // Lens formula: 1/v - 1/u = 1/f, u = -objDist
    const u = -objDist;
    const v = (u * focal) / (u + focal);
    const m = v / u;
    const imgH = m * objH;
    const imgX = lensX + v * scale;

    // Ray 1: parallel to axis → through F2
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(objX, axisY - objH);
    ctx.lineTo(lensX, axisY - objH);
    ctx.lineTo(imgX, axisY - imgH);
    ctx.stroke();

    // Ray 2: through optical centre
    ctx.strokeStyle = '#a78bfa';
    ctx.beginPath();
    ctx.moveTo(objX, axisY - objH);
    ctx.lineTo(lensX, axisY);
    if (imgX > lensX) {
      ctx.lineTo(imgX, axisY - imgH);
    } else {
      ctx.lineTo(W - 10, axisY - imgH * ((W - 10 - objX) / (lensX - objX)));
    }
    ctx.stroke();

    // Image
    if (imgX > 10 && imgX < W - 10) {
      const isVirtual = v < 0;
      ctx.beginPath();
      ctx.moveTo(imgX, axisY);
      ctx.lineTo(imgX, axisY - imgH);
      ctx.strokeStyle = isVirtual ? '#c084fc' : '#fb923c';
      ctx.lineWidth = 2.5;
      ctx.setLineDash(isVirtual ? [4, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = isVirtual ? '#c084fc' : '#fb923c';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isVirtual ? 'Virtual' : 'Real', imgX, axisY + 30);
    }

    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9ca3af';
    ctx.fillText(`u = -${objDist} cm  |  v = ${v.toFixed(1)} cm  |  m = ${m.toFixed(2)}`, 10, H - 10);
  }, [focal, objDist]);

  const u = -objDist;
  const v = +((u * focal) / (u + focal)).toFixed(2);
  const m = +(v / u).toFixed(2);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Convex Lens Ray Diagram</h3>
      <canvas ref={canvasRef} width={560} height={280} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Focal length f: {focal} cm</label>
          <input type="range" min={3} max={15} value={focal} onChange={e => setFocal(+e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Object distance: {objDist} cm</label>
          <input type="range" min={Math.ceil(focal * 1.5)} max={focal * 5} value={objDist} onChange={e => setObjDist(+e.target.value)} style={{ width: '100%' }} />
        </div>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        1/v − 1/u = 1/f &nbsp;→&nbsp; v = <b style={{ color: 'var(--orange,#f97316)' }}>{v} cm</b> &nbsp;|&nbsp; m = <b style={{ color: 'var(--purple,#7c3aed)' }}>{m}</b> ({v < 0 ? 'Virtual, erect' : 'Real, inverted'})
      </div>
    </div>
  );
}
