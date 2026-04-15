'use client';
import { useState, useRef, useEffect } from 'react';

export default function MirrorReflection() {
  const [angle, setAngle] = useState(40);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const mx = w / 2, my = h - 60;
    const rad = (angle * Math.PI) / 180;
    const rayLen = 200;

    // Mirror
    ctx.strokeStyle = '#aaa'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(mx - 100, my); ctx.lineTo(mx + 100, my); ctx.stroke();
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2;
    for (let i = -90; i <= 90; i += 15) {
      ctx.beginPath(); ctx.moveTo(mx + i, my); ctx.lineTo(mx + i + 8, my + 10); ctx.stroke();
    }

    // Normal (dashed)
    ctx.setLineDash([5, 4]); ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mx, my - 140); ctx.lineTo(mx, my + 20); ctx.stroke();
    ctx.setLineDash([]);

    // Incident ray (orange)
    const ix = mx - Math.sin(rad) * rayLen;
    const iy = my - Math.cos(rad) * rayLen;
    ctx.strokeStyle = 'var(--orange)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(mx, my);
    ctx.stroke();
    // arrowhead
    ctx.fillStyle = 'var(--orange)';
    const ax = mx - Math.sin(rad) * 10, ay = my - Math.cos(rad) * 10;
    ctx.save(); ctx.translate(mx, my); ctx.rotate(-rad + Math.PI / 2 + Math.PI);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, -12); ctx.lineTo(6, -12); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Reflected ray (purple)
    const rx = mx + Math.sin(rad) * rayLen;
    const ry = my - Math.cos(rad) * rayLen;
    ctx.strokeStyle = 'var(--purple)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(rx, ry); ctx.stroke();
    ctx.fillStyle = 'var(--purple)';
    ctx.save(); ctx.translate(rx, ry); ctx.rotate(rad + Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-6, 12); ctx.lineTo(6, 12); ctx.closePath(); ctx.fill();
    ctx.restore();

    // Angle arcs
    ctx.strokeStyle = 'var(--orange)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mx, my, 50, -Math.PI / 2, -Math.PI / 2 - rad, true); ctx.stroke();
    ctx.strokeStyle = 'var(--purple)';
    ctx.beginPath(); ctx.arc(mx, my, 50, -Math.PI / 2, -Math.PI / 2 + rad, false); ctx.stroke();

    // Labels
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = 'var(--orange)';
    ctx.fillText(`i = ${angle}°`, mx - 80, my - 60);
    ctx.fillStyle = 'var(--purple)';
    ctx.fillText(`r = ${angle}°`, mx + 30, my - 60);
    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    ctx.fillText('Normal', mx + 6, my - 120);

    // Surface label
    ctx.fillStyle = 'var(--text-2)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Mirror Surface', mx, my + 16);
  }, [angle]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Mirror Reflection — Law of Reflection</h3>
      <canvas ref={canvasRef} width={560} height={300} style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      <div style={{ marginTop: 10 }}>
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Incident Angle: {angle}°</label>
        <input type="range" min={5} max={85} value={angle} onChange={e => setAngle(+e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        ∠i = ∠r &nbsp;→&nbsp; <b style={{ color: 'var(--orange)' }}>{angle}°</b> = <b style={{ color: 'var(--purple)' }}>{angle}°</b> &nbsp;(Law of Reflection)
      </div>
    </div>
  );
}
