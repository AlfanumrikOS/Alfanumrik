'use client';
import { useState, useRef, useEffect } from 'react';

export default function GeneExpression() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const [hasLactose, setHasLactose] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    setAnimating(true);
    tRef.current = 0;
  }, [hasLactose]);

  useEffect(() => {
    if (!animating) return;
    const loop = () => {
      tRef.current++;
      draw();
      if (tRef.current < 120) animRef.current = requestAnimationFrame(loop);
      else setAnimating(false);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [animating, hasLactose]);

  useEffect(() => { draw(); }, [hasLactose]);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#F8FFF8'; ctx.fillRect(0, 0, W, H);

    const t = Math.min(tRef.current / 120, 1);

    const genes = [
      { label: 'Promoter', x: 60, color: '#FFCC80', w: 70 },
      { label: 'Operator', x: 145, color: '#EF9A9A', w: 70 },
      { label: 'lacZ', x: 230, color: '#A5D6A7', w: 70 },
      { label: 'lacY', x: 315, color: '#80DEEA', w: 70 },
      { label: 'lacA', x: 400, color: '#CE93D8', w: 70 },
    ];
    genes.forEach(g => {
      ctx.fillStyle = g.color; ctx.fillRect(g.x, 130, g.w, 40); ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.strokeRect(g.x, 130, g.w, 40);
      ctx.fillStyle = '#333'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(g.label, g.x + g.w / 2, 155);
    });

    ctx.fillStyle = '#555'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText("DNA →", 14, 154);
    ctx.fillStyle = '#333'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('β-gal', 230 + 25, 180); ctx.fillText('permease', 315 + 15, 180); ctx.fillText('transacet.', 400 + 12, 180);

    const repX = hasLactose ? 145 + t * (-90) : 60;
    const repY = hasLactose ? 70 + t * (-10) : 70;
    const repOpacity = hasLactose ? Math.max(0.1, 1 - t * 0.8) : 1;
    ctx.globalAlpha = repOpacity;
    ctx.beginPath(); ctx.arc(repX, repY, 22, 0, Math.PI * 2);
    ctx.fillStyle = hasLactose ? '#90CAF9' : '#EF5350'; ctx.fill();
    ctx.strokeStyle = hasLactose ? '#1565C0' : '#C62828'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Repressor', repX, repY + 3);
    ctx.globalAlpha = 1;

    if (!hasLactose) {
      ctx.beginPath(); ctx.moveTo(178, 70); ctx.lineTo(178, 130); ctx.strokeStyle = '#EF5350'; ctx.lineWidth = 2; ctx.setLineDash([4, 2]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#EF5350'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('blocks', 190, 105);
      ctx.fillStyle = '#C62828'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('GENE OFF', W / 2, 220);
      ctx.fillStyle = '#EF5350'; ctx.fillText('RNA Pol blocked', 130, 110);
      ctx.beginPath(); ctx.moveTo(80, 115); ctx.lineTo(145, 130); ctx.strokeStyle = '#f44'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = '18px sans-serif'; ctx.fillText('🚫', 118, 135);
    } else {
      if (hasLactose) {
        const lX = 145 - t * 60, lY = 45 + t * 25;
        ctx.beginPath(); ctx.arc(lX, lY, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#FFEB3B'; ctx.fill(); ctx.strokeStyle = '#F9A825'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#5D4037'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('lac', lX, lY + 3);
      }

      const polX = 60 + t * 280;
      ctx.fillStyle = '#4CAF50'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('RNA Pol', polX, 118);
      ctx.beginPath(); ctx.moveTo(polX - 16, 122); ctx.lineTo(polX + 16, 122); ctx.lineTo(polX + 10, 130);
      ctx.fillStyle = '#4CAF50'; ctx.fill();

      if (t > 0.3) {
        const mLen = Math.round((t - 0.3) / 0.7 * 300);
        ctx.beginPath(); ctx.moveTo(145, 190);
        for (let i = 0; i < mLen; i++) { ctx.lineTo(145 + i, 190 + (i % 20 < 10 ? 2 : -2)); }
        ctx.strokeStyle = '#66BB6A'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#2E7D32'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('mRNA', 145, 212);
      }
      ctx.fillStyle = '#2E7D32'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('GENE ON — β-galactosidase produced!', W / 2, 235);
    }

    ctx.fillStyle = '#1565C0'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(hasLactose ? 'Lactose present: repressor inactivated' : 'No lactose: repressor bound to operator', 14, 260);
  };

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Gene Expression — Lac Operon</h3>
      <canvas ref={canvasRef} width={560} height={270} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={() => setHasLactose(false)} style={{ padding: '6px 20px', background: !hasLactose ? '#EF5350' : 'var(--surface-2)', color: !hasLactose ? '#fff' : 'var(--text-1)', border: '2px solid #EF5350', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          No Lactose (Gene OFF)
        </button>
        <button onClick={() => setHasLactose(true)} style={{ padding: '6px 20px', background: hasLactose ? '#4CAF50' : 'var(--surface-2)', color: hasLactose ? '#fff' : 'var(--text-1)', border: '2px solid #4CAF50', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          Add Lactose (Gene ON)
        </button>
      </div>
      <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-2)' }}>
        {hasLactose
          ? 'Lactose (inducer) binds repressor → repressor leaves operator → RNA polymerase transcribes lacZ, lacY, lacA → enzymes produced to digest lactose'
          : 'No lactose → repressor binds operator → RNA polymerase blocked → no transcription → genes OFF'}
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#E8F5E9', borderRadius: 8, fontSize: 13, color: '#2E7D32', borderLeft: '3px solid #4CAF50' }}>
        Inducible operon: <strong>inducer inactivates repressor → gene expression ON</strong>
      </div>
    </div>
  );
}
