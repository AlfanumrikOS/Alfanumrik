'use client';
import { useState, useEffect } from 'react';
import { useResponsiveCanvas } from '@/hooks/useResponsiveCanvas';

type Tab = 'lever' | 'pulley' | 'incline';

export default function SimpleMachines() {
  const [tab, setTab] = useState<Tab>('lever');
  const [effort, setEffort] = useState(50);
  const [effortArm, setEffortArm] = useState(5);
  const [load, setLoad] = useState(60);
  const [angle, setAngle] = useState(30);
  const [pulleyType, setPulleyType] = useState<'fixed' | 'movable'>('fixed');
  const { canvasRef, containerRef, size } = useResponsiveCanvas(560 / 220);
  const LOAD_ARM = 5;
  const W = 80;

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const w = size.width;
    const h = size.height;
    ctx.clearRect(0, 0, w, h);

    if (tab === 'lever') {
      const loadForce = (effort * effortArm) / LOAD_ARM;
      const tilt = Math.atan2((effort - loadForce) * 0.4, 200) * 0.5;
      const cx = w / 2, cy = h / 2 + 20;
      // fulcrum
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - 20, cy + 40); ctx.lineTo(cx + 20, cy + 40); ctx.closePath();
      ctx.fillStyle = '#888'; ctx.fill();
      // beam
      const bLen = Math.min(220, w * 0.4);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt);
      ctx.fillStyle = '#a0522d'; ctx.fillRect(-bLen, -8, bLen * 2, 16);
      // effort side
      ctx.fillStyle = 'var(--orange)'; ctx.fillRect(-bLen + 10, -28, 20, 20);
      ctx.fillStyle = 'var(--text-1)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`E=${effort}N`, -bLen + 20, -32);
      // load side
      ctx.fillStyle = 'var(--purple)'; ctx.fillRect(bLen - 30, -28, 20, 20);
      ctx.fillStyle = 'var(--text-1)'; ctx.fillText(`L=${loadForce.toFixed(1)}N`, bLen - 20, -32);
      ctx.restore();
      ctx.fillStyle = 'var(--text-2)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`MA = ${(loadForce / effort).toFixed(2)}`, cx, h - 10);
    }

    if (tab === 'pulley') {
      const eff = pulleyType === 'fixed' ? load : load / 2;
      const cx = w / 2, cy = 80;
      ctx.strokeStyle = '#888'; ctx.lineWidth = 3;
      // ceiling
      ctx.fillStyle = '#ccc'; ctx.fillRect(cx - 40, 20, 80, 10);
      // wheel
      ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.strokeStyle = '#555'; ctx.lineWidth = 3; ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#555'; ctx.fill();
      // ropes
      ctx.strokeStyle = 'var(--orange)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 30, cy); ctx.lineTo(cx - 30, cy + 120); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 30, cy); ctx.lineTo(cx + 30, cy + 120); ctx.stroke();
      // load block
      ctx.fillStyle = 'var(--purple)';
      ctx.fillRect(cx - 25, cy + 120, 50, 30);
      ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${load}N`, cx, cy + 140);
      // effort label
      ctx.fillStyle = 'var(--text-1)'; ctx.font = '12px sans-serif';
      ctx.fillText(`Effort = ${eff}N`, cx, h - 15);
    }

    if (tab === 'incline') {
      const rad = (angle * Math.PI) / 180;
      const effortI = +(W * Math.sin(rad)).toFixed(1);
      const normal = +(W * Math.cos(rad)).toFixed(1);
      const bx = 80, by = h - 40, rx = w - 60;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(rx, by); ctx.lineTo(bx, by - Math.tan(rad) * (rx - bx)); ctx.closePath();
      ctx.fillStyle = '#d4a96a'; ctx.fill(); ctx.strokeStyle = '#888'; ctx.lineWidth = 2; ctx.stroke();
      // box on slope
      const blen = rx - bx;
      const boxX = bx + blen * 0.55;
      const boxY = by - Math.tan(rad) * blen * 0.55;
      ctx.save(); ctx.translate(boxX, boxY); ctx.rotate(-rad);
      ctx.fillStyle = 'var(--orange)'; ctx.fillRect(-15, -20, 30, 20);
      ctx.restore();
      ctx.fillStyle = 'var(--text-2)'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`Effort=${effortI}N  Normal=${normal}N`, w / 2, h - 10);
    }
  }, [tab, effort, effortArm, load, angle, pulleyType, size, canvasRef]);

  const MA = tab === 'lever' ? ((effort * effortArm) / LOAD_ARM / effort).toFixed(2)
    : tab === 'pulley' ? (pulleyType === 'fixed' ? '1.00' : '2.00')
    : (1 / Math.sin((angle * Math.PI) / 180)).toFixed(2);

  const btnStyle = (t: Tab) => ({
    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13,
    background: tab === t ? 'var(--orange)' : 'var(--surface-2)', color: tab === t ? '#fff' : 'var(--text-1)',
  });

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Simple Machines</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button style={btnStyle('lever')} onClick={() => setTab('lever')}>Lever</button>
        <button style={btnStyle('pulley')} onClick={() => setTab('pulley')}>Pulley</button>
        <button style={btnStyle('incline')} onClick={() => setTab('incline')}>Inclined Plane</button>
      </div>
      <div ref={containerRef} style={{ width: '100%', aspectRatio: '560/220' }}>
        <canvas ref={canvasRef} style={{ borderRadius: 8, background: 'var(--surface-2)', display: 'block' }} />
      </div>
      <div style={{ marginTop: 10 }}>
        {tab === 'lever' && (<>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Effort: {effort} N</label>
          <input type="range" min={1} max={100} value={effort} onChange={e => setEffort(+e.target.value)} style={{ width: '100%' }} />
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Effort Arm: {effortArm} m</label>
          <input type="range" min={1} max={10} value={effortArm} onChange={e => setEffortArm(+e.target.value)} style={{ width: '100%' }} />
        </>)}
        {tab === 'pulley' && (<>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Load: {load} N</label>
          <input type="range" min={10} max={100} value={load} onChange={e => setLoad(+e.target.value)} style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {(['fixed', 'movable'] as const).map(p => (
              <button key={p} onClick={() => setPulleyType(p)} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, background: pulleyType === p ? 'var(--purple)' : 'var(--surface-2)', color: pulleyType === p ? '#fff' : 'var(--text-1)' }}>{p}</button>
            ))}
          </div>
        </>)}
        {tab === 'incline' && (<>
          <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Angle: {angle}deg</label>
          <input type="range" min={10} max={60} value={angle} onChange={e => setAngle(+e.target.value)} style={{ width: '100%' }} />
        </>)}
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        MA = Load / Effort = <b style={{ color: 'var(--orange)' }}>{MA}</b>
      </div>
    </div>
  );
}