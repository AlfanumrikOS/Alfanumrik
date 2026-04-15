'use client';
import { useState } from 'react';

const ORGANISMS = [
  { id: 'sun', label: 'Sun', x: 270, y: 20, level: 0, role: 'Energy Source', color: '#FFD700' },
  { id: 'grass', label: 'Grass', x: 270, y: 80, level: 1, role: 'Producer', color: '#4CAF50' },
  { id: 'grasshopper', label: 'Grasshopper', x: 120, y: 160, level: 2, role: 'Primary Consumer', color: '#8BC34A' },
  { id: 'rabbit', label: 'Rabbit', x: 270, y: 160, level: 2, role: 'Primary Consumer', color: '#FF9800' },
  { id: 'frog', label: 'Frog', x: 120, y: 230, level: 3, role: 'Secondary Consumer', color: '#009688' },
  { id: 'snake', label: 'Snake', x: 270, y: 230, level: 3, role: 'Secondary Consumer', color: '#795548' },
  { id: 'fox', label: 'Fox', x: 390, y: 230, level: 3, role: 'Secondary Consumer', color: '#FF5722' },
  { id: 'eagle', label: 'Eagle', x: 270, y: 300, level: 4, role: 'Tertiary Consumer', color: '#9C27B0' },
];

const EDGES: [string, string][] = [
  ['sun', 'grass'], ['grass', 'grasshopper'], ['grass', 'rabbit'],
  ['grasshopper', 'frog'], ['frog', 'snake'], ['rabbit', 'snake'],
  ['rabbit', 'fox'], ['snake', 'eagle'], ['fox', 'eagle'], ['frog', 'eagle'],
];

export default function FoodWeb() {
  const [selected, setSelected] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const getConnected = (id: string) => {
    const connected = new Set<string>();
    EDGES.forEach(([a, b]) => {
      if (a === id) connected.add(b);
      if (b === id) connected.add(a);
    });
    return connected;
  };

  const getCascade = (id: string): Set<string> => {
    const cascade = new Set<string>();
    const depsOn = (target: string) => EDGES.filter(([a]) => a === target).map(([, b]) => b);
    const providers = (target: string) => EDGES.filter(([, b]) => b === target).map(([a]) => a);
    const visit = (node: string) => {
      depsOn(node).forEach(dep => {
        const allProviders = providers(dep).filter(p => p !== node && !removed.has(p));
        if (allProviders.length === 0 && !cascade.has(dep)) {
          cascade.add(dep);
          visit(dep);
        }
      });
    };
    visit(id);
    return cascade;
  };

  const connectedIds = selected ? getConnected(selected) : new Set<string>();
  const cascadeIds = selected ? getCascade(selected) : new Set<string>();
  const org = ORGANISMS.find(o => o.id === selected);

  const handleRemove = () => {
    if (selected) {
      setRemoved(prev => new Set([...prev, selected, ...getCascade(selected)]));
      setSelected(null);
    }
  };

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Food Web — Trophic Levels</h3>
      <p style={{ color: 'var(--text-2)', fontSize: 12, marginBottom: 8 }}>Click an organism to see its connections</p>
      <svg viewBox="0 0 560 360" style={{ width: '100%', background: 'var(--surface-2)', borderRadius: 8, display: 'block' }}>
        {EDGES.map(([a, b], i) => {
          const A = ORGANISMS.find(o => o.id === a)!;
          const B = ORGANISMS.find(o => o.id === b)!;
          const isHighlighted = selected && (connectedIds.has(a) && connectedIds.has(b) || a === selected || b === selected);
          const isRemoved = removed.has(a) || removed.has(b);
          return (
            <line key={i} x1={A.x + 30} y1={A.y + 14} x2={B.x + 30} y2={B.y + 14}
              stroke={isRemoved ? '#ccc' : isHighlighted ? '#F97316' : '#aaa'}
              strokeWidth={isHighlighted ? 2.5 : 1.2} strokeDasharray={isRemoved ? '4,3' : undefined}
              markerEnd="url(#arrow)" opacity={isRemoved ? 0.3 : 1} />
          );
        })}
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="#F97316" />
          </marker>
        </defs>
        {ORGANISMS.map(o => {
          const isSelected = selected === o.id;
          const isConnected = connectedIds.has(o.id);
          const isRemov = removed.has(o.id);
          const isCascade = cascadeIds.has(o.id);
          return (
            <g key={o.id} onClick={() => !isRemov && setSelected(isSelected ? null : o.id)} style={{ cursor: isRemov ? 'default' : 'pointer' }}>
              <rect x={o.x} y={o.y} width={60} height={28} rx={6}
                fill={isRemov ? '#eee' : isSelected ? o.color : isConnected ? o.color + 'aa' : isCascade ? '#ff444444' : o.color + '44'}
                stroke={isSelected ? o.color : isCascade ? '#f44' : '#ccc'}
                strokeWidth={isSelected ? 2.5 : isCascade ? 2 : 1} opacity={isRemov ? 0.3 : 1} />
              <text x={o.x + 30} y={o.y + 18} textAnchor="middle" fontSize={11} fill={isRemov ? '#aaa' : isSelected ? '#fff' : 'var(--text-1)'} fontWeight={isSelected ? 700 : 400}>
                {o.label}
              </text>
              {(isRemov || isCascade) && <text x={o.x + 48} y={o.y + 10} fontSize={14} fill="#f44">✕</text>}
            </g>
          );
        })}
        <text x={8} y={100} fontSize={10} fill="var(--text-2)">Producers</text>
        <text x={8} y={175} fontSize={10} fill="var(--text-2)">Primary</text>
        <text x={8} y={245} fontSize={10} fill="var(--text-2)">Secondary</text>
        <text x={8} y={315} fontSize={10} fill="var(--text-2)">Tertiary</text>
      </svg>
      {org && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)' }}>
          <strong>{org.label}</strong> — Trophic Level {org.level} | Role: {org.role}
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={handleRemove} disabled={!selected} style={{ padding: '6px 16px', background: selected ? '#f44336' : '#ccc', color: '#fff', border: 'none', borderRadius: 6, cursor: selected ? 'pointer' : 'not-allowed', fontSize: 13 }}>Remove Selected</button>
        <button onClick={() => { setRemoved(new Set()); setSelected(null); }} style={{ padding: '6px 16px', background: 'var(--purple)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Reset</button>
      </div>
      <div style={{ marginTop: 8, padding: '8px 12px', background: '#FFF3E0', borderRadius: 8, fontSize: 13, color: '#E65100', borderLeft: '3px solid #F97316' }}>
        Energy transfer: only <strong>10%</strong> moves to the next trophic level (10% Law)
      </div>
    </div>
  );
}
