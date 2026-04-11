'use client';
import { useState } from 'react';

type Mode = 'functions' | 'types';

const PARTS = [
  { id: 'root', label: 'Root', func: 'Anchors plant, absorbs water & minerals', typeInfo: 'Taproot (carrot) | Fibrous (grass) | Adventitious' },
  { id: 'stem', label: 'Stem', func: 'Transports water (xylem) & food (phloem), supports plant', typeInfo: 'Herbaceous (soft) | Woody | Underground (rhizome, tuber)' },
  { id: 'leaf', label: 'Leaf', func: 'Photosynthesis, transpiration, gaseous exchange', typeInfo: 'Simple (mango) | Compound (neem) | Needle (pine)' },
  { id: 'flower', label: 'Flower', func: 'Sexual reproduction, attracts pollinators', typeInfo: 'Complete | Incomplete | Bisexual | Unisexual' },
  { id: 'fruit', label: 'Fruit / Seed', func: 'Seed dispersal, protects seed, stores food', typeInfo: 'Fleshy (mango) | Dry (mustard) | Seed = embryo + endosperm + seed coat' },
];

export default function PlantParts() {
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('functions');
  const [showLeaf, setShowLeaf] = useState(false);

  const part = PARTS.find(p => p.id === selected);

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Parts of a Plant</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {(['functions', 'types'] as Mode[]).map(m => (
          <button key={m} onClick={() => setMode(m)} style={{ padding: '4px 12px', background: mode === m ? 'var(--purple)' : 'var(--surface-2)', color: mode === m ? '#fff' : 'var(--text-1)', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
            {m === 'functions' ? 'Functions' : 'Types'}
          </button>
        ))}
        <button onClick={() => setShowLeaf(s => !s)} style={{ padding: '4px 12px', background: showLeaf ? '#4CAF50' : 'var(--surface-2)', color: showLeaf ? '#fff' : 'var(--text-1)', border: '1px solid #ddd', borderRadius: 6, cursor: 'pointer', fontSize: 12, marginLeft: 'auto' }}>
          {showLeaf ? 'Plant View' : 'Leaf Cross-section'}
        </button>
      </div>
      <svg viewBox="0 0 560 280" style={{ width: '100%', background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        {!showLeaf ? (
          <>
            <rect x={0} y={200} width={560} height={80} fill="#D7CCC8" rx={0} />
            <text x={10} y={215} fontSize={10} fill="#795548">Soil</text>
            <line x1={275} y1={200} x2={275} y2={280} stroke="#795548" strokeWidth={2} strokeDasharray="4,2" />
            <ellipse cx={260} cy={250} rx={30} ry={10} fill="#8D6E63" opacity={0.5} />
            <ellipse cx={290} cy={265} rx={22} ry={8} fill="#8D6E63" opacity={0.4} />
            <rect x={270} y={130} width={10} height={70} fill="#66BB6A" />
            <ellipse cx={230} cy={140} rx={35} ry={20} fill="#81C784" transform="rotate(-20,230,140)" onClick={() => setSelected(selected === 'leaf' ? null : 'leaf')} style={{ cursor: 'pointer' }} stroke={selected === 'leaf' ? '#F97316' : 'transparent'} strokeWidth={2} />
            <ellipse cx={320} cy={150} rx={30} ry={18} fill="#66BB6A" transform="rotate(15,320,150)" onClick={() => setSelected(selected === 'leaf' ? null : 'leaf')} style={{ cursor: 'pointer' }} stroke={selected === 'leaf' ? '#F97316' : 'transparent'} strokeWidth={2} />
            <g onClick={() => setSelected(selected === 'flower' ? null : 'flower')} style={{ cursor: 'pointer' }}>
              {[0, 60, 120, 180, 240, 300].map((a, i) => (
                <ellipse key={i} cx={275 + 18 * Math.cos(a * Math.PI / 180)} cy={85 + 12 * Math.sin(a * Math.PI / 180)} rx={10} ry={7} fill="#FF8A65" transform={`rotate(${a},${275 + 18 * Math.cos(a * Math.PI / 180)},${85 + 12 * Math.sin(a * Math.PI / 180)})`} stroke={selected === 'flower' ? '#F97316' : 'transparent'} strokeWidth={1.5} />
              ))}
              <circle cx={275} cy={85} r={8} fill="#FFD54F" />
            </g>
            <g onClick={() => setSelected(selected === 'stem' ? null : 'stem')} style={{ cursor: 'pointer' }}>
              <rect x={268} y={100} width={14} height={100} fill="#4CAF50" stroke={selected === 'stem' ? '#F97316' : 'transparent'} strokeWidth={2} rx={3} />
            </g>
            <g onClick={() => setSelected(selected === 'root' ? null : 'root')} style={{ cursor: 'pointer' }}>
              <line x1={275} y1={200} x2={250} y2={240} stroke="#8D6E63" strokeWidth={3} />
              <line x1={275} y1={210} x2={295} y2={250} stroke="#8D6E63" strokeWidth={2.5} />
              <line x1={275} y1={220} x2={260} y2={270} stroke="#8D6E63" strokeWidth={2} />
              <rect x={240} y={195} width={70} height={85} fill={selected === 'root' ? '#F9731633' : 'transparent'} rx={4} stroke={selected === 'root' ? '#F97316' : 'transparent'} strokeWidth={1.5} />
            </g>
            <g onClick={() => setSelected(selected === 'fruit' ? null : 'fruit')} style={{ cursor: 'pointer' }}>
              <circle cx={240} cy={108} r={12} fill="#FF7043" stroke={selected === 'fruit' ? '#F97316' : 'transparent'} strokeWidth={2} />
            </g>
            <line x1={400} y1={140} x2={230} y2={143} stroke="#aaa" strokeWidth={1} strokeDasharray="3,2" />
            <text x={405} y={144} fontSize={11} fill="var(--text-2)">Leaf</text>
            <line x1={400} y1={88} x2={285} y2={88} stroke="#aaa" strokeWidth={1} strokeDasharray="3,2" />
            <text x={405} y={92} fontSize={11} fill="var(--text-2)">Flower</text>
            <line x1={400} y1={160} x2={282} y2={155} stroke="#aaa" strokeWidth={1} strokeDasharray="3,2" />
            <text x={405} y={164} fontSize={11} fill="var(--text-2)">Stem</text>
            <line x1={90} y1={230} x2={250} y2={245} stroke="#aaa" strokeWidth={1} strokeDasharray="3,2" />
            <text x={20} y={234} fontSize={11} fill="var(--text-2)">Root</text>
            <line x1={180} y1={108} x2={228} y2={108} stroke="#aaa" strokeWidth={1} strokeDasharray="3,2" />
            <text x={120} y={112} fontSize={11} fill="var(--text-2)">Fruit</text>
          </>
        ) : (
          <>
            <text x={20} y={30} fontSize={13} fontWeight={700} fill="var(--text-1)">Leaf Cross-Section</text>
            <rect x={40} y={45} width={480} height={22} rx={4} fill="#C8E6C9" stroke="#4CAF50" strokeWidth={1} />
            <text x={210} y={60} fontSize={11} fill="#2E7D32">Upper Epidermis (waxy cuticle)</text>
            <rect x={40} y={68} width={480} height={60} rx={0} fill="#A5D6A7" />
            <text x={205} y={102} fontSize={11} fill="#1B5E20">Palisade Mesophyll (chloroplasts)</text>
            <rect x={40} y={129} width={480} height={50} rx={0} fill="#B2DFDB" />
            <text x={195} y={158} fontSize={11} fill="#00695C">Spongy Mesophyll (air spaces)</text>
            <rect x={40} y={180} width={480} height={22} rx={4} fill="#DCEDC8" stroke="#8BC34A" strokeWidth={1} />
            <text x={210} y={195} fontSize={11} fill="#558B2F">Lower Epidermis</text>
            <ellipse cx={280} cy={202} rx={8} ry={4} fill="#66BB6A" />
            <ellipse cx={350} cy={202} rx={8} ry={4} fill="#66BB6A" />
            <text x={260} y={220} fontSize={10} fill="#388E3C">Stomata (gas exchange)</text>
            <rect x={190} y={68} width={20} height={134} fill="#FFEB3B" opacity={0.7} rx={3} />
            <text x={175} y={240} fontSize={10} fill="#F9A825">Vein (xylem+phloem)</text>
          </>
        )}
      </svg>
      {part && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', borderLeft: '3px solid var(--orange)' }}>
          <strong>{part.label}:</strong> {mode === 'functions' ? part.func : part.typeInfo}
        </div>
      )}
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#E8F5E9', borderRadius: 8, fontSize: 13, color: '#2E7D32', borderLeft: '3px solid #4CAF50' }}>
        Root=anchor+absorb | Stem=transport+support | Leaf=photosynthesis
      </div>
    </div>
  );
}
