'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export default function HeartCirculation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [bpm, setBpm] = useState(72);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#FFF8F0';
    ctx.fillRect(0, 0, W, H);

    const period = Math.round(3600 / (bpm / 60));
    const phase = (tRef.current % period) / period;
    const beat = Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
    const pulse = 1 + beat * 0.06;

    ctx.save(); ctx.translate(W / 2, H / 2 - 10); ctx.scale(pulse, pulse);
    const drawChamber = (x: number, y: number, w: number, h: number, color: string, label: string) => {
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 8);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(label, x + w / 2, y + h / 2 + 4);
    };
    drawChamber(-95, -55, 80, 50, '#90CAF9', 'RA');
    drawChamber(-95, 5, 80, 55, '#42A5F5', 'RV');
    drawChamber(15, -55, 80, 50, '#EF9A9A', 'LA');
    drawChamber(15, 5, 80, 55, '#EF5350', 'LV');

    const valve = (x: number, y: number, open: boolean, color: string) => {
      ctx.beginPath();
      if (open) { ctx.moveTo(x - 6, y); ctx.lineTo(x, y - 5); ctx.lineTo(x + 6, y); }
      else { ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); }
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
    };
    valve(-55, 5, beat > 0.5, '#1565C0');
    valve(55, 5, beat > 0.5, '#B71C1C');
    valve(-90, -10, beat < 0.5, '#0288D1');
    valve(90, -10, beat < 0.5, '#C62828');
    ctx.restore();

    const dotPhase = (tRef.current * bpm / 3600) % 1;
    const pathPoints = [
      [W / 2 - 55, H / 2 - 60], [W / 2 - 55, H / 2 - 120], [W / 2, H / 2 - 140], [W / 2 + 55, H / 2 - 120], [W / 2 + 55, H / 2 - 60],
    ];
    for (let i = 0; i < pathPoints.length - 1; i++) {
      ctx.beginPath();
      ctx.moveTo(pathPoints[i][0], pathPoints[i][1]);
      ctx.lineTo(pathPoints[i + 1][0], pathPoints[i + 1][1]);
      ctx.strokeStyle = '#FFAB91'; ctx.lineWidth = 3; ctx.stroke();
    }
    const pi = Math.floor(dotPhase * (pathPoints.length - 1));
    const pf = dotPhase * (pathPoints.length - 1) - pi;
    if (pi < pathPoints.length - 1) {
      const dx = pathPoints[pi][0] + (pathPoints[pi + 1][0] - pathPoints[pi][0]) * pf;
      const dy = pathPoints[pi][1] + (pathPoints[pi + 1][1] - pathPoints[pi][1]) * pf;
      ctx.beginPath(); ctx.arc(dx, dy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#90CAF9'; ctx.fill();
    }

    ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('Vena Cava →', 14, 80);
    ctx.fillText('← Pulmonary Artery', 14, 96);
    ctx.fillText('Pulmonary Vein →', W - 160, 80);
    ctx.fillText('← Aorta', W - 160, 96);
    ctx.fillText(`♥ ${bpm} BPM`, W / 2 - 24, H - 8);
    ctx.fillStyle = '#90CAF9'; ctx.fillRect(14, 110, 12, 12); ctx.fillStyle = '#333'; ctx.fillText(' Deoxygenated', 28, 121);
    ctx.fillStyle = '#EF5350'; ctx.fillRect(14, 128, 12, 12); ctx.fillStyle = '#333'; ctx.fillText(' Oxygenated', 28, 139);
  }, [bpm]);

  useEffect(() => {
    if (!playing) return;
    const loop = () => { draw(); tRef.current++; animRef.current = requestAnimationFrame(loop); };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing, draw]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Heart Circulation</h3>
      <canvas ref={canvasRef} width={560} height={240} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setPlaying(p => !p)} style={{ padding: '6px 16px', background: playing ? '#f44336' : '#4CAF50', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Heart Rate: {bpm} BPM
          <input type="range" min={40} max={180} value={bpm} onChange={e => setBpm(+e.target.value)} style={{ marginLeft: 8, width: 100 }} />
        </label>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#FCE4EC', borderRadius: 8, fontSize: 13, color: '#880E4F', borderLeft: '3px solid #EF5350' }}>
        <strong>Double circulation:</strong> Pulmonary (heart↔lungs) + Systemic (heart↔body)
      </div>
    </div>
  );
}
