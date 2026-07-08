'use client';
import { useState, useRef, useEffect } from 'react';

const CODON_TABLE: Record<string, string> = {
  AUG: 'Met', UUU: 'Phe', AAA: 'Lys', GGG: 'Gly', CCC: 'Pro', UAA: 'STOP',
};
const EXAMPLE_CODONS = ['AUG', 'UUU', 'AAA', 'GGG', 'CCC', 'UAA'];
const DNA_TEMPLATE = ['TAC', 'AAA', 'TTT', 'CCC', 'GGG', 'ATT'];

const STEPS = [
  { phase: 'transcription', label: 'Step 1: DNA unwinds', desc: 'RNA polymerase binds promoter. Double helix opens.' },
  { phase: 'transcription', label: 'Step 2: mRNA synthesis', desc: 'RNA pol reads DNA template 3\'→5\'. Builds mRNA 5\'→3\'. A-U, T-A, G-C, C-G.' },
  { phase: 'transcription', label: 'Step 3: mRNA exits nucleus', desc: 'Pre-mRNA is processed (introns removed). Mature mRNA exits through nuclear pore.' },
  { phase: 'translation', label: 'Step 4: Ribosome attaches', desc: 'Ribosome binds mRNA at start codon AUG. Translation begins.' },
  { phase: 'translation', label: 'Step 5: tRNA brings amino acids', desc: 'Each codon matched by tRNA anticodon. Amino acid added to chain.' },
  { phase: 'translation', label: 'Step 6: Polypeptide grows', desc: 'Ribosome moves along mRNA. Chain elongates until stop codon reached.' },
];

export default function ProteinSynthesis() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#F3E5F5'; ctx.fillRect(0, 0, W, H);

    const s = STEPS[step];
    if (s.phase === 'transcription') {
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 95, 0, Math.PI * 2);
      ctx.fillStyle = '#FFF8E1'; ctx.fill(); ctx.strokeStyle = '#7C3AED'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#9E9D24'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Nucleus', W / 2, H / 2 - 80);

      const openLen = step >= 1 ? Math.min(6, step * 3) : 0;
      for (let i = 0; i < DNA_TEMPLATE.length; i++) {
        const x = 140 + i * 48;
        const isOpen = i < openLen && step >= 1;
        ctx.fillStyle = isOpen ? '#A5D6A7' : '#CE93D8';
        ctx.fillRect(x, H / 2 - 30, 38, 20); ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(DNA_TEMPLATE[i], x + 19, H / 2 - 16);
        ctx.fillStyle = isOpen ? '#80CBC4' : '#FFCC80';
        ctx.fillRect(x, H / 2 + 10, 38, 20); ctx.fillStyle = '#fff'; ctx.fillText(EXAMPLE_CODONS[i], x + 19, H / 2 + 24);
        if (!isOpen) { ctx.beginPath(); ctx.moveTo(x + 19, H / 2 - 10); ctx.lineTo(x + 19, H / 2 + 10); ctx.strokeStyle = '#888'; ctx.lineWidth = 1; ctx.stroke(); }
      }

      if (step >= 1) {
        ctx.fillStyle = '#4CAF50'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('mRNA:', W / 2, H / 2 + 58);
        EXAMPLE_CODONS.slice(0, Math.min(openLen, 6)).forEach((c, i) => {
          ctx.fillStyle = '#80CBC4'; ctx.fillRect(140 + i * 48, H / 2 + 62, 38, 18);
          ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.fillText(c, 159 + i * 48, H / 2 + 75);
        });
      }

      if (step === 2) {
        ctx.fillStyle = '#F97316'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('mRNA → exits nucleus →', W / 2, H - 18);
      }

      ctx.fillStyle = '#3F51B5'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.fillText("5' DNA", 115, H / 2 - 16); ctx.fillText("3' template", 106, H / 2 + 24);
    } else {
      ctx.fillStyle = '#E8F5E9'; ctx.fillRect(0, 0, W, H);
      const codonIdx = Math.min(step - 3, EXAMPLE_CODONS.length - 1);
      const showCodons = EXAMPLE_CODONS.slice(0, 6);
      showCodons.forEach((c, i) => {
        const x = 60 + i * 75;
        const isCurrent = i === codonIdx;
        ctx.fillStyle = isCurrent ? '#FFF9C4' : '#E8EAF6';
        ctx.fillRect(x, H / 2 + 10, 60, 22); ctx.strokeStyle = isCurrent ? '#F9A825' : '#ccc'; ctx.lineWidth = 1.5; ctx.strokeRect(x, H / 2 + 10, 60, 22);
        ctx.fillStyle = '#333'; ctx.font = isCurrent ? 'bold 11px sans-serif' : '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(c, x + 30, H / 2 + 25);
      });
      ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText("mRNA (5' → 3')", W / 2, H / 2 + 48);

      ctx.fillStyle = '#FFCC80'; ctx.fillRect(W / 2 - codonIdx * 75 + 60 - 80, H / 2 - 60, 160, 55);
      ctx.strokeStyle = '#F97316'; ctx.lineWidth = 2; ctx.strokeRect(W / 2 - codonIdx * 75 + 60 - 80, H / 2 - 60, 160, 55);
      ctx.fillStyle = '#333'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Ribosome', W / 2 - codonIdx * 75 + 60, H / 2 - 44);

      const aa = CODON_TABLE[EXAMPLE_CODONS[codonIdx]] || '?';
      const anticodon = EXAMPLE_CODONS[codonIdx].replace(/U/g, 'X').replace(/A/g, 'U').replace(/X/g, 'A').replace(/G/g, 'Y').replace(/C/g, 'G').replace(/Y/g, 'C');
      ctx.fillStyle = '#CE93D8'; ctx.fillRect(W / 2 - codonIdx * 75 + 60 - 35, H / 2 - 100, 70, 36);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('tRNA', W / 2 - codonIdx * 75 + 60, H / 2 - 84);
      ctx.font = '9px sans-serif'; ctx.fillText(anticodon, W / 2 - codonIdx * 75 + 60, H / 2 - 72);

      const chainLen = Math.max(0, codonIdx);
      if (chainLen > 0) {
        ctx.fillStyle = '#EF9A9A'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText('Chain: ' + EXAMPLE_CODONS.slice(0, chainLen).map(c => CODON_TABLE[c] || '').filter(Boolean).join('-'), 40, 30);
      }

      ctx.fillStyle = '#2E7D32'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`Codon: ${EXAMPLE_CODONS[codonIdx]} → AA: ${aa}`, W / 2, H - 12);
    }
  }, [step]);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Protein Synthesis</h3>
      <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6 }}>Phase: <strong style={{ color: STEPS[step].phase === 'transcription' ? '#7C3AED' : '#2E7D32' }}>{STEPS[step].phase === 'transcription' ? 'Transcription' : 'Translation'}</strong></p>
      <canvas ref={canvasRef} width={560} height={230} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 8, padding: '6px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-2)' }}>
        <strong style={{ color: 'var(--text-1)' }}>{STEPS[step].label}:</strong> {STEPS[step].desc}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <button onClick={() => setStep(s => Math.max(0, s - 1))} style={{ padding: '6px 16px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Back</button>
        <button onClick={() => setStep(s => (s + 1) % STEPS.length)} style={{ padding: '6px 16px', background: 'var(--orange)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Next</button>
        <span style={{ fontSize: 12, color: 'var(--text-2)', alignSelf: 'center' }}>{step + 1}/{STEPS.length}</span>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#EDE7F6', borderRadius: 8, fontSize: 13, color: '#4527A0', borderLeft: '3px solid #7C3AED' }}>
        DNA → mRNA <strong>(transcription)</strong> → Protein <strong>(translation)</strong>
      </div>
    </div>
  );
}
