'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

type DecayMode = 'alpha' | 'beta' | 'gamma';

const COLS = 10, ROWS = 6, N0 = COLS * ROWS;

export default function NuclearDecay() {
  const [mode, setMode] = useState<DecayMode>('alpha');
  const [halfLife, setHalfLife] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nucleiRef = useRef<boolean[]>(Array(N0).fill(false)); // true = decayed
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const elapsedRef = useRef(0);

  const modeColors = { alpha: { intact: '#f97316', decayed: '#374151', daughter: '#fbbf24' }, beta: { intact: '#7c3aed', decayed: '#374151', daughter: '#a78bfa' }, gamma: { intact: '#10b981', decayed: '#374151', daughter: '#6ee7b7' } };
  const col = modeColors[mode];

  const reset = useCallback(() => {
    nucleiRef.current = Array(N0).fill(false);
    elapsedRef.current = 0;
    setElapsed(0);
    setPlaying(false);
  }, []);

  useEffect(() => { reset(); }, [mode, halfLife, reset]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    const leftW = W * 0.55;
    const cellW = leftW / COLS, cellH = 160 / ROWS;
    const startX = 10, startY = 30;

    // Nuclei grid
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    nucleiRef.current.forEach((decayed, i) => {
      const col_ = i % COLS, row = Math.floor(i / COLS);
      const cx = startX + col_ * cellW + cellW / 2;
      const cy = startY + row * cellH + cellH / 2;
      const r = Math.min(cellW, cellH) * 0.35;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (!decayed) {
        ctx.fillStyle = col.intact;
        ctx.fill();
      } else {
        ctx.fillStyle = '#1f2937';
        ctx.fill();
        ctx.strokeStyle = col.decayed;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // daughter dot
        ctx.beginPath();
        ctx.arc(cx + r * 0.4, cy - r * 0.4, r * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = col.daughter;
        ctx.fill();
      }
    });

    // Grid labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px sans-serif';
    ctx.fillText('Parent nuclei', leftW / 2 + startX, 20);

    // N vs t plot
    const gX = leftW + 20, gY = 20, gW = W - gX - 10, gH = H - gY - 35;
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 1;
    ctx.strokeRect(gX, gY, gW, gH);

    const tMax = halfLife * 5;
    // Theoretical curve
    ctx.beginPath();
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 1;
    for (let px = 0; px <= gW; px++) {
      const t = (px / gW) * tMax;
      const n = N0 * Math.pow(0.5, t / halfLife);
      const x = gX + px;
      const y = gY + gH - (n / N0) * gH;
      px === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Simulation dot
    const remaining = nucleiRef.current.filter(d => !d).length;
    const dotX = gX + Math.min(1, elapsedRef.current / tMax) * gW;
    const dotY = gY + gH - (remaining / N0) * gH;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
    ctx.fillStyle = col.intact;
    ctx.fill();

    // Axes labels
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('t →', gX + gW / 2, gY + gH + 12);
    ctx.fillText('N', gX - 10, gY + gH / 2);

    ctx.textAlign = 'right';
    ctx.fillText(`${N0}`, gX - 2, gY + 8);
    ctx.fillText(`${remaining}`, gX - 2, dotY + 4);

    // Half life markers
    for (let k = 1; k <= 5; k++) {
      const x = gX + (k * halfLife / tMax) * gW;
      ctx.fillStyle = '#374151';
      ctx.textAlign = 'center';
      ctx.fillText(`${k}t½`, x, gY + gH + 12);
    }

    // Info
    ctx.fillStyle = '#9ca3af';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`N=${remaining}  t=${elapsedRef.current.toFixed(1)}s`, gX + gW / 2, H - 5);
  }, [col]);

  useEffect(() => {
    const loop = (ts: number) => {
      if (playing && ts - lastTickRef.current > 200) {
        lastTickRef.current = ts;
        elapsedRef.current += 0.2;
        setElapsed(elapsedRef.current);
        // Decay probability per tick per nucleus
        const p = 1 - Math.pow(0.5, 0.2 / halfLife);
        nucleiRef.current = nucleiRef.current.map(d => d || Math.random() < p);
      }
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, halfLife, draw]);

  const modeBtn = (m: DecayMode, label: string) => (
    <button key={m} onClick={() => setMode(m)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: mode === m ? modeColors[m].intact : 'var(--surface-2)', color: mode === m ? '#fff' : 'var(--text-2)' }}>{label}</button>
  );

  const Nt = +(N0 * Math.pow(0.5, elapsed / halfLife)).toFixed(1);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Nuclear Decay Simulation</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {modeBtn('alpha', 'α Decay')}
        {modeBtn('beta', 'β Decay')}
        {modeBtn('gamma', 'γ Decay')}
        <button onClick={() => setPlaying(p => !p)} style={{ padding: '6px 14px', background: 'var(--surface-2)', color: 'var(--text-1)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={reset} style={{ padding: '6px 14px', background: 'var(--surface-2)', color: 'var(--text-2)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}>Reset</button>
      </div>
      <canvas ref={canvasRef} width={540} height={230} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 8 }}>
        <label style={{ color: 'var(--text-2)', fontSize: 13 }}>Half-life t½: {halfLife}s</label>
        <input type="range" min={1} max={10} value={halfLife} onChange={e => setHalfLife(+e.target.value)} style={{ width: '100%' }} />
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        N(t) = N₀ × (½)^(t/t½) = <b style={{ color: 'var(--orange,#f97316)' }}>{Nt}</b> at t={elapsed.toFixed(1)}s
      </div>
    </div>
  );
}
