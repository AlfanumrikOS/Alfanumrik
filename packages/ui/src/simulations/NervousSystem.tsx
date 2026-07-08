'use client';
import { useState, useRef, useEffect } from 'react';

type Mode = 'neuron' | 'reflex' | 'speed';

const NEURON_PARTS = [
  { id: 'dendrite', label: 'Dendrites', x: 60, y: 100, r: 14, color: '#90CAF9', info: 'Receive signals from other neurons. Multiple branched extensions.' },
  { id: 'cell', label: 'Cell Body (Soma)', x: 155, y: 100, r: 22, color: '#CE93D8', info: 'Contains nucleus. Controls neuron activity and metabolism.' },
  { id: 'axon', label: 'Axon', x: 310, y: 100, r: 0, color: '#A5D6A7', info: 'Long fibre that carries impulse away from cell body. Up to 1 metre long!' },
  { id: 'myelin', label: 'Myelin Sheath', x: 310, y: 128, r: 0, color: '#FFE082', info: 'Fatty insulating layer. Speeds up signal transmission (100 m/s).' },
  { id: 'node', label: 'Node of Ranvier', x: 280, y: 100, r: 0, color: '#FFAB91', info: 'Gaps in myelin sheath. Impulse jumps between nodes — saltatory conduction.' },
  { id: 'synapse', label: 'Synaptic Knobs', x: 480, y: 100, r: 14, color: '#80DEEA', info: 'Release neurotransmitters into synapse to signal next neuron/muscle.' },
];

export default function NervousSystem() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const tRef = useRef(0);
  const [mode, setMode] = useState<Mode>('neuron');
  const [selected, setSelected] = useState<string | null>(null);
  const [myelinated, setMyelinated] = useState(true);

  useEffect(() => {
    if (mode !== 'reflex') return;
    const loop = () => { tRef.current++; draw(); animRef.current = requestAnimationFrame(loop); };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  });

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== 'reflex') return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#F3E5F5'; ctx.fillRect(0, 0, W, H);

    const nodes = [
      { label: 'Receptor\n(skin)', x: 60, y: 130 },
      { label: 'Sensory\nNerve', x: 165, y: 100 },
      { label: 'Spinal\nCord', x: 280, y: 80 },
      { label: 'Motor\nNerve', x: 395, y: 100 },
      { label: 'Effector\n(muscle)', x: 500, y: 130 },
    ];

    for (let i = 0; i < nodes.length - 1; i++) {
      ctx.beginPath(); ctx.moveTo(nodes[i].x + 30, nodes[i].y); ctx.lineTo(nodes[i + 1].x - 30, nodes[i + 1].y);
      ctx.strokeStyle = '#CE93D8'; ctx.lineWidth = 3; ctx.stroke();
    }

    nodes.forEach(n => {
      ctx.beginPath(); ctx.arc(n.x, n.y, 30, 0, Math.PI * 2);
      ctx.fillStyle = '#EDE7F6'; ctx.fill(); ctx.strokeStyle = '#7C3AED'; ctx.lineWidth = 2; ctx.stroke();
      const lines = n.label.split('\n');
      ctx.fillStyle = '#4527A0'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center';
      lines.forEach((l, i) => ctx.fillText(l, n.x, n.y - 4 + i * 13));
    });

    const speed = myelinated ? 0.012 : 0.004;
    const pos = (tRef.current * speed) % 1;
    const totalDist = (nodes.length - 1) * 1;
    const posOnPath = pos * totalDist;
    const seg = Math.min(Math.floor(posOnPath), nodes.length - 2);
    const t2 = posOnPath - seg;
    const x = nodes[seg].x + (nodes[seg + 1].x - nodes[seg].x) * t2;
    const y = nodes[seg].y + (nodes[seg + 1].y - nodes[seg].y) * t2;
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#F97316'; ctx.fill();

    ctx.fillStyle = '#333'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`Signal speed: ${myelinated ? '~100 m/s (myelinated)' : '~1 m/s (unmyelinated)'}`, 10, 200);
    ctx.fillText('Brain (not involved in reflex!)', 240, 50);
    ctx.beginPath(); ctx.moveTo(280, 55); ctx.lineTo(280, 65); ctx.strokeStyle = '#999'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
  };

  const part = NEURON_PARTS.find(p => p.id === selected);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Nervous System</h3>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {(['neuron', 'reflex', 'speed'] as Mode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); setSelected(null); }} style={{ flex: 1, padding: '4px 8px', background: mode === m ? 'var(--purple)' : 'var(--surface-2)', color: mode === m ? '#fff' : 'var(--text-1)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
            {m === 'neuron' ? 'Neuron Structure' : m === 'reflex' ? 'Reflex Arc' : 'Signal Speed'}
          </button>
        ))}
      </div>
      {mode === 'neuron' && (
        <svg viewBox="0 0 560 210" style={{ width: '100%', background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
          {[0, 1, 2].map(i => (<line key={i} x1={60 + i * 20} y1={100} x2={133} y2={100} stroke="#90CAF9" strokeWidth={2} />))}
          <circle cx={60} cy={80} r={8} fill="#90CAF9" onClick={() => setSelected('dendrite')} style={{ cursor: 'pointer' }} />
          <circle cx={40} cy={100} r={8} fill="#90CAF9" onClick={() => setSelected('dendrite')} style={{ cursor: 'pointer' }} />
          <circle cx={60} cy={120} r={8} fill="#90CAF9" onClick={() => setSelected('dendrite')} style={{ cursor: 'pointer' }} />
          <circle cx={155} cy={100} r={22} fill="#CE93D8" stroke={selected === 'cell' ? '#F97316' : '#aaa'} strokeWidth={2} onClick={() => setSelected('cell')} style={{ cursor: 'pointer' }} />
          <text x={155} y={104} textAnchor="middle" fontSize={10} fill="#fff" fontWeight={700}>Soma</text>
          <line x1={177} y1={100} x2={460} y2={100} stroke="#A5D6A7" strokeWidth={4} onClick={() => setSelected('axon')} style={{ cursor: 'pointer' }} strokeDasharray="1" />
          {[210, 260, 310, 360, 410].map(x => (
            <rect key={x} x={x} y={87} width={40} height={26} rx={4} fill="#FFE082" opacity={0.8} onClick={() => setSelected('myelin')} style={{ cursor: 'pointer' }} />
          ))}
          {[205, 255, 305, 355, 405, 455].map(x => (
            <circle key={x} cx={x} cy={100} r={4} fill="#FFAB91" onClick={() => setSelected('node')} style={{ cursor: 'pointer' }} />
          ))}
          <circle cx={490} cy={90} r={10} fill="#80DEEA" onClick={() => setSelected('synapse')} style={{ cursor: 'pointer' }} />
          <circle cx={505} cy={105} r={9} fill="#80DEEA" onClick={() => setSelected('synapse')} style={{ cursor: 'pointer' }} />
          <circle cx={490} cy={115} r={9} fill="#80DEEA" onClick={() => setSelected('synapse')} style={{ cursor: 'pointer' }} />
          {NEURON_PARTS.filter(p => p.id !== 'axon' && p.id !== 'myelin' && p.id !== 'node').map(p => (
            <text key={p.id} x={p.x} y={p.y + 42} textAnchor="middle" fontSize={9} fill="var(--text-2)">{p.label}</text>
          ))}
          <text x={310} y={142} textAnchor="middle" fontSize={9} fill="var(--text-2)">Myelin Sheath</text>
          <text x={310} y={75} textAnchor="middle" fontSize={9} fill="var(--text-2)">Nodes of Ranvier</text>
          <text x={310} y={165} textAnchor="middle" fontSize={10} fill="#aaa">← Axon →</text>
        </svg>
      )}
      {mode === 'reflex' && (
        <canvas ref={canvasRef} width={560} height={220} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      )}
      {mode === 'speed' && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 16 }}>
          <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-1)' }}>Myelinated fibre: <strong style={{ color: '#4CAF50' }}>~100 m/s</strong></div>
          <div style={{ height: 20, background: '#E8F5E9', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ height: '100%', width: '100%', background: '#4CAF50', borderRadius: 10 }} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-1)', marginBottom: 6 }}>Unmyelinated fibre: <strong style={{ color: '#F97316' }}>~1 m/s</strong></div>
          <div style={{ height: 20, background: '#FFF3E0', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: '1%', background: '#F97316', borderRadius: 10 }} />
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-2)' }}>Myelin sheath acts as insulator — impulse jumps node-to-node (saltatory conduction), 100x faster!</div>
        </div>
      )}
      {mode === 'reflex' && (
        <div style={{ marginTop: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--text-2)' }}>
            <input type="checkbox" checked={myelinated} onChange={e => setMyelinated(e.target.checked)} style={{ marginRight: 6 }} />
            Myelinated nerve (faster)
          </label>
        </div>
      )}
      {part && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: part.color + '44', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', borderLeft: `3px solid ${part.color}` }}>
          <strong>{part.label}:</strong> {part.info}
        </div>
      )}
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#EDE7F6', borderRadius: 8, fontSize: 13, color: '#4527A0', borderLeft: '3px solid #7C3AED' }}>
        Reflex arc <strong>bypasses brain</strong> for faster response — receptor → spinal cord → effector
      </div>
    </div>
  );
}
