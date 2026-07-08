'use client';
import { useState, useRef, useEffect } from 'react';

const STAGES = [
  { name: 'Prophase I', desc: 'Chromosomes condense. Homologous pairs (bivalents) form. Crossing over occurs — X-shaped chiasmata.' },
  { name: 'Metaphase I', desc: 'Bivalents align at metaphase plate. Each homolog faces opposite poles.' },
  { name: 'Anaphase I', desc: 'Homologous chromosomes separate and move to opposite poles. Sister chromatids stay joined.' },
  { name: 'Telophase I', desc: 'Two haploid cells form. Each has one chromosome from each homologous pair.' },
  { name: 'Prophase II', desc: 'No DNA replication. Chromosomes condense again in each daughter cell.' },
  { name: 'Metaphase II', desc: 'Chromosomes (with 2 chromatids) align at metaphase plate in each cell.' },
  { name: 'Anaphase II', desc: 'Sister chromatids separate and move to poles — like mitosis.' },
  { name: 'Telophase II', desc: 'Four haploid (n) cells formed. Each has a single set of chromosomes.' },
];

export default function MeiosisStages() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#F8F0FF'; ctx.fillRect(0, 0, W, H);

    const drawCell = (cx: number, cy: number, r: number, chrs: [number, number, string][], label?: string) => {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#EDE7F6'; ctx.fill(); ctx.strokeStyle = '#7C3AED'; ctx.lineWidth = 2; ctx.stroke();
      chrs.forEach(([x, y, color]) => {
        ctx.beginPath(); ctx.arc(cx + x, cy + y, 7, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.fill();
        ctx.beginPath(); ctx.arc(cx + x, cy + y + 4, 5, 0, Math.PI * 2);
        ctx.fillStyle = color + 'aa'; ctx.fill();
      });
      if (label) { ctx.fillStyle = '#7C3AED'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, cx, cy + r + 14); }
    };

    const drawBivalent = (cx: number, cy: number, cx2: number, cy2: number) => {
      ctx.beginPath(); ctx.moveTo(cx - 4, cy); ctx.lineTo(cx2 - 4, cy2); ctx.strokeStyle = '#EF5350'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 4, cy); ctx.lineTo(cx2 + 4, cy2); ctx.strokeStyle = '#42A5F5'; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx2, cy2 - 4); ctx.strokeStyle = '#EF5350'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]);
    };

    if (stage === 0) {
      drawCell(W / 2, H / 2, 90, []);
      drawBivalent(W / 2 - 20, H / 2 - 10, W / 2 - 20, H / 2 + 10);
      drawBivalent(W / 2 + 20, H / 2 - 10, W / 2 + 20, H / 2 + 10);
      ctx.beginPath(); ctx.moveTo(W / 2 - 22, H / 2); ctx.lineTo(W / 2 + 22, H / 2); ctx.strokeStyle = '#8B0000'; ctx.lineWidth = 1.5; ctx.setLineDash([2, 1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#7C3AED'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Chiasmata (crossing over)', W / 2, H / 2 + 28);
    } else if (stage === 1) {
      drawCell(W / 2, H / 2, 90, []);
      ctx.beginPath(); ctx.moveTo(W / 2 - 80, H / 2); ctx.lineTo(W / 2 + 80, H / 2); ctx.strokeStyle = '#9E9E9E'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      drawBivalent(W / 2 - 18, H / 2 - 14, W / 2 - 18, H / 2 + 14);
      drawBivalent(W / 2 + 18, H / 2 - 14, W / 2 + 18, H / 2 + 14);
      ctx.fillStyle = '#9E9E9E'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Metaphase plate', W / 2, H / 2 - 50);
    } else if (stage === 2) {
      drawCell(W / 2, H / 2, 90, []);
      ctx.beginPath(); ctx.moveTo(W / 2 - 12, H / 2 - 50); ctx.lineTo(W / 2 - 12, H / 2 - 70); ctx.strokeStyle = '#EF5350'; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2 + 12, H / 2 - 50); ctx.lineTo(W / 2 + 12, H / 2 - 70); ctx.strokeStyle = '#42A5F5'; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2 - 12, H / 2 + 50); ctx.lineTo(W / 2 - 12, H / 2 + 70); ctx.strokeStyle = '#42A5F5'; ctx.lineWidth = 4; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W / 2 + 12, H / 2 + 50); ctx.lineTo(W / 2 + 12, H / 2 + 70); ctx.strokeStyle = '#EF5350'; ctx.lineWidth = 4; ctx.stroke();
    } else if (stage === 3) {
      drawCell(W / 2 - 50, H / 2, 60, [[-8, 0, '#EF5350'], [8, 0, '#EF5350']], 'Cell 1 (n)');
      drawCell(W / 2 + 90, H / 2, 60, [[-8, 0, '#42A5F5'], [8, 0, '#42A5F5']], 'Cell 2 (n)');
    } else if (stage === 4) {
      drawCell(W / 2 - 55, H / 2 - 50, 48, [[-5, 0, '#EF5350'], [5, 0, '#EF5350']], 'n');
      drawCell(W / 2 + 55, H / 2 - 50, 48, [[-5, 0, '#42A5F5'], [5, 0, '#42A5F5']], 'n');
      ctx.fillStyle = '#7C3AED'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Meiosis II begins in both cells', W / 2, H - 12);
    } else if (stage === 5) {
      [W / 2 - 55, W / 2 + 55].forEach((cx, i) => {
        drawCell(cx, H / 2 - 30, 48, []);
        ctx.beginPath(); ctx.moveTo(cx - 40, H / 2 - 30); ctx.lineTo(cx + 40, H / 2 - 30); ctx.strokeStyle = '#9E9E9E'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
        const color = i === 0 ? '#EF5350' : '#42A5F5';
        ctx.beginPath(); ctx.arc(cx, H / 2 - 42, 7, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        ctx.beginPath(); ctx.arc(cx, H / 2 - 18, 7, 0, Math.PI * 2); ctx.fillStyle = color + 'aa'; ctx.fill();
      });
    } else if (stage === 6) {
      [W / 2 - 90, W / 2 - 30, W / 2 + 30, W / 2 + 90].forEach((cx, i) => {
        const color = i < 2 ? '#EF5350' : '#42A5F5';
        ctx.beginPath(); ctx.arc(cx, H / 2 - 50, 5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
        ctx.beginPath(); ctx.arc(cx, H / 2 + 50, 5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
      });
    } else if (stage === 7) {
      [W / 2 - 110, W / 2 - 36, W / 2 + 36, W / 2 + 110].forEach((cx, i) => {
        drawCell(cx, H / 2, 38, [[0, 0, i < 2 ? '#EF5350' : '#42A5F5']], 'n');
      });
      ctx.fillStyle = '#2E7D32'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('4 haploid cells', W / 2, H - 8);
    }
  }, [stage]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Meiosis Stages</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {STAGES.map((s, i) => (
          <button key={i} onClick={() => setStage(i)} style={{ padding: '3px 8px', background: stage === i ? 'var(--purple)' : 'var(--surface-2)', color: stage === i ? '#fff' : 'var(--text-1)', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: stage === i ? 700 : 400 }}>
            {s.name}
          </button>
        ))}
      </div>
      <canvas ref={canvasRef} width={560} height={220} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 8, padding: '6px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-2)' }}>
        <strong style={{ color: 'var(--text-1)' }}>{STAGES[stage].name}:</strong> {STAGES[stage].desc}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={() => setStage(s => Math.max(0, s - 1))} style={{ padding: '6px 16px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Back</button>
        <button onClick={() => setStage(s => (s + 1) % STAGES.length)} style={{ padding: '6px 16px', background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Next</button>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#EDE7F6', borderRadius: 8, fontSize: 13, color: '#4527A0', borderLeft: '3px solid #7C3AED' }}>
        Meiosis: <strong>2n → 4 haploid (n) cells</strong> | Key difference from mitosis: crossing over + 2 divisions
      </div>
    </div>
  );
}
