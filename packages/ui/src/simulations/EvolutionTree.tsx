'use client';
import { useState } from 'react';

const ORGANISMS = ['Fish', 'Amphibian', 'Reptile', 'Bird', 'Mammal', 'Human'];
const TRAITS = [
  { id: 'jaw', label: 'Jaw', x: 280, y: 240, info: 'Jawed vertebrates (gnathostomes) — ~450 mya. Enabled predation.' },
  { id: 'limbs', label: '4 Limbs', x: 280, y: 195, info: 'Tetrapod limbs evolved ~375 mya. Allowed movement on land.' },
  { id: 'amniotic', label: 'Amniotic Egg', x: 340, y: 155, info: 'Amniotes ~320 mya. Egg with protective membranes — freed from water.' },
  { id: 'feathers', label: 'Feathers', x: 370, y: 115, info: 'Feathers evolved in theropod dinosaurs ~150 mya (Jurassic).' },
  { id: 'hair', label: 'Hair/Milk', x: 330, y: 115, info: 'Mammary glands & hair ~225 mya. Warm-blooded thermoregulation.' },
  { id: 'bipedal', label: 'Bipedalism', x: 355, y: 80, info: 'Upright walking ~4 mya in Australopithecus. Frees hands for tools.' },
];

const BRANCHES = [
  { from: [280, 270], to: [280, 240] },
  { from: [280, 240], to: [160, 180], label: 'Fish', organism: 'Fish', x: 130, y: 175 },
  { from: [280, 240], to: [280, 195] },
  { from: [280, 195], to: [200, 145], label: 'Amphibian', organism: 'Amphibian', x: 162, y: 138 },
  { from: [280, 195], to: [280, 155] },
  { from: [280, 155], to: [220, 110], label: 'Reptile', organism: 'Reptile', x: 185, y: 103 },
  { from: [280, 155], to: [340, 155] },
  { from: [340, 155], to: [370, 115] },
  { from: [370, 115], to: [390, 80], label: 'Bird', organism: 'Bird', x: 380, y: 72 },
  { from: [340, 155], to: [330, 115] },
  { from: [330, 115], to: [310, 80], label: 'Mammal', organism: 'Mammal', x: 280, y: 72 },
  { from: [310, 80], to: [355, 50], label: 'Human', organism: 'Human', x: 344, y: 42 },
  { from: [310, 80], to: [280, 45] },
];

export default function EvolutionTree() {
  const [selected, setSelected] = useState<string | null>(null);
  const [org1, setOrg1] = useState<string | null>(null);
  const [org2, setOrg2] = useState<string | null>(null);

  const trait = TRAITS.find(t => t.id === selected);

  const handleOrgClick = (org: string) => {
    if (!org1) { setOrg1(org); return; }
    if (org === org1) { setOrg1(null); setOrg2(null); return; }
    setOrg2(org);
  };

  const lcaMap: Record<string, Record<string, string>> = {
    Fish: { Amphibian: 'jaw', Reptile: 'jaw', Bird: 'jaw', Mammal: 'jaw', Human: 'jaw' },
    Amphibian: { Reptile: 'limbs', Bird: 'limbs', Mammal: 'limbs', Human: 'limbs' },
    Reptile: { Bird: 'amniotic', Mammal: 'amniotic', Human: 'amniotic' },
    Bird: { Mammal: 'amniotic', Human: 'amniotic' },
    Mammal: { Human: 'hair' },
  };
  const lca = org1 && org2 ? (lcaMap[org1]?.[org2] || lcaMap[org2]?.[org1] || null) : null;

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Evolution Tree (Cladogram)</h3>
      <p style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>Click trait nodes to learn. Select 2 organisms to find common ancestor.</p>
      <svg viewBox="0 0 560 300" style={{ width: '100%', background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        {BRANCHES.map((b, i) => (
          <line key={i} x1={b.from[0]} y1={b.from[1]} x2={b.to[0]} y2={b.to[1]}
            stroke={lca && b.organism && (b.organism === org1 || b.organism === org2) ? '#F97316' : '#7C3AED'} strokeWidth={2} />
        ))}
        {BRANCHES.filter(b => b.organism).map((b, i) => {
          const isHighlighted = b.organism === org1 || b.organism === org2;
          return (
            <g key={i} onClick={() => handleOrgClick(b.organism!)} style={{ cursor: 'pointer' }}>
              <circle cx={b.x! + 8} cy={b.y! + 6} r={16} fill={isHighlighted ? '#F97316' : '#E8EAF6'} stroke={isHighlighted ? '#E65100' : '#7C3AED'} strokeWidth={1.5} opacity={0.9} />
              <text x={b.x! + 8} y={b.y! + 10} textAnchor="middle" fontSize={9} fill={isHighlighted ? '#fff' : '#3949AB'} fontWeight={isHighlighted ? 700 : 400}>{b.organism}</text>
            </g>
          );
        })}
        {TRAITS.map(t => (
          <g key={t.id} onClick={() => setSelected(selected === t.id ? null : t.id)} style={{ cursor: 'pointer' }}>
            <circle cx={t.x} cy={t.y} r={12} fill={selected === t.id ? '#F97316' : (lca === t.id ? '#FFE082' : '#FFF9C4')}
              stroke={selected === t.id ? '#E65100' : '#F9A825'} strokeWidth={1.8} />
            <text x={t.x} y={t.y + 3} textAnchor="middle" fontSize={7} fill="#5D4037" fontWeight={700}>{t.label}</text>
          </g>
        ))}
        <circle cx={280} cy={285} r={12} fill="#CE93D8" stroke="#7C3AED" strokeWidth={2} />
        <text x={280} y={289} textAnchor="middle" fontSize={9} fill="#fff" fontWeight={700}>Ancestor</text>
        {[0, 50, 100, 150, 200, 250].map((v, i) => (
          <text key={i} x={8} y={285 - i * 42} fontSize={9} fill="#aaa">{v + 300}mya</text>
        ))}
      </svg>
      {trait && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: '#FFF9C4', borderRadius: 8, fontSize: 13, color: '#5D4037', borderLeft: '3px solid #F9A825' }}>
          <strong>{trait.label}:</strong> {trait.info}
        </div>
      )}
      {lca && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: '#FFF3E0', borderRadius: 8, fontSize: 13, color: '#E65100', borderLeft: '3px solid #F97316' }}>
          Common ancestor of <strong>{org1}</strong> and <strong>{org2}</strong>: diverged at <em>{TRAITS.find(t => t.id === lca)?.label}</em>
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {ORGANISMS.map(o => (
          <button key={o} onClick={() => handleOrgClick(o)} style={{ padding: '4px 10px', background: org1 === o || org2 === o ? 'var(--orange)' : 'var(--surface-2)', color: org1 === o || org2 === o ? '#fff' : 'var(--text-1)', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>{o}</button>
        ))}
        <button onClick={() => { setOrg1(null); setOrg2(null); setSelected(null); }} style={{ padding: '4px 10px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Clear</button>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#EDE7F6', borderRadius: 8, fontSize: 13, color: '#4527A0', borderLeft: '3px solid #7C3AED' }}>
        Divergent evolution: <strong>common ancestor → different species</strong> via natural selection
      </div>
    </div>
  );
}
