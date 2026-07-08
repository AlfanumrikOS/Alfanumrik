'use client';
import { useState, useEffect, useRef } from 'react';

type Method = 'Filtration' | 'Distillation' | 'Evaporation';

export default function MixturesSeparation() {
  const [method, setMethod] = useState<Method>('Filtration');
  const [particleSize, setParticleSize] = useState(5);
  const [tick, setTick] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 400);
    return () => clearInterval(id);
  }, []);

  const bubbles = Array.from({ length: 6 }, (_, i) => ({
    x: 80 + (i % 3) * 20,
    y: 160 - ((tick * 12 + i * 30) % 80),
    r: 4 + (i % 3),
  }));

  const steamPts = Array.from({ length: 5 }, (_, i) => ({
    x: 180 + i * 8,
    oy: 90 - ((tick * 8 + i * 20) % 50),
  }));

  const crystals = Array.from({ length: 8 }, (_, i) => ({ x: 55 + i * 14, s: 6 + (i % 3) * 2 }));

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Mixtures Separation</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['Filtration', 'Distillation', 'Evaporation'] as Method[]).map(m => (
          <button key={m} onClick={() => setMethod(m)} style={{
            padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13,
            background: method === m ? 'var(--orange)' : 'var(--surface-2)', color: method === m ? '#fff' : 'var(--text-1)',
          }}>{m}</button>
        ))}
      </div>
      {method === 'Filtration' && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-2)' }}>Particle size: {particleSize}</label>
          <input type="range" min={1} max={10} value={particleSize} onChange={e => setParticleSize(+e.target.value)} style={{ width: '100%', marginTop: 4 }} />
        </div>
      )}
      <svg ref={svgRef} viewBox="0 0 560 280" style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block' }}>
        {method === 'Filtration' && (
          <g>
            <polygon points="200,20 360,20 310,120 250,120" fill="#e0d0b0" stroke="#8b6914" strokeWidth={2} />
            <line x1="250" y1="120" x2="255" y2="160" stroke="#888" strokeWidth={2} />
            <line x1="310" y1="120" x2="305" y2="160" stroke="#888" strokeWidth={2} />
            <ellipse cx="280" cy="80" rx="55" ry="8" fill="none" stroke="#a0522d" strokeWidth={2} strokeDasharray="4 2" />
            <text x="280" y="84" textAnchor="middle" fontSize="11" fill="#a0522d">Filter paper</text>
            {[...Array(8)].map((_, i) => (
              <circle key={i} cx={230 + i * 14} cy={50 + (i % 3) * 10} r={particleSize > 5 ? 4 : 2} fill={particleSize > 5 ? '#8b4513' : '#4488cc'} opacity={0.8} />
            ))}
            <rect x="250" y="130" width="60" height="8" rx="4" fill="none" stroke="#4488cc" strokeWidth={2} />
            <rect x="255" y="160" width="50" height="60" rx="4" fill="rgba(100,160,220,0.3)" stroke="#4488cc" strokeWidth={2} />
            <text x="280" y="225" textAnchor="middle" fontSize="11" fill="#4488cc">Filtrate</text>
            <text x="280" y="238" textAnchor="middle" fontSize="10" fill="var(--text-2)">(soluble particles pass)</text>
            <text x="280" y="260" textAnchor="middle" fontSize="10" fill="#8b4513">Residue stays on paper</text>
          </g>
        )}
        {method === 'Distillation' && (
          <g>
            <ellipse cx="120" cy="180" rx="60" ry="50" fill="rgba(100,160,220,0.3)" stroke="#4488cc" strokeWidth={2} />
            <rect x="60" y="130" width="120" height="10" rx="3" fill="rgba(100,160,220,0.5)" />
            <text x="120" y="200" textAnchor="middle" fontSize="11" fill="#4488cc">Mixture</text>
            <line x1="180" y1="150" x2="350" y2="100" stroke="#888" strokeWidth={8} />
            <line x1="180" y1="165" x2="350" y2="115" stroke="#aaa" strokeWidth={4} />
            <text x="265" y="130" textAnchor="middle" fontSize="11" fill="var(--text-2)" transform="rotate(-12,265,130)">Condenser</text>
            {steamPts.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.oy} r={3} fill="rgba(200,220,255,0.7)" />
            ))}
            <ellipse cx="420" cy="180" rx="40" ry="35" fill="rgba(100,160,220,0.2)" stroke="#4488cc" strokeWidth={2} />
            <text x="420" y="200" textAnchor="middle" fontSize="11" fill="#4488cc">Distillate</text>
            <rect x="80" y="225" width="80" height="12" rx="3" fill="#ff6600" opacity={0.7} />
            <text x="120" y="255" textAnchor="middle" fontSize="10" fill="var(--text-2)">Heat source</text>
          </g>
        )}
        {method === 'Evaporation' && (
          <g>
            <ellipse cx="280" cy="180" rx="100" ry="30" fill="rgba(100,160,220,0.3)" stroke="#4488cc" strokeWidth={2} />
            <rect x="180" y="155" width="200" height="25" fill="rgba(100,160,220,0.2)" />
            <path d="M170,190 Q280,160 390,190" fill="none" stroke="#4488cc" strokeWidth={2} />
            {bubbles.map((b, i) => (
              <circle key={i} cx={b.x + 180} cy={b.y + 80} r={b.r} fill="rgba(100,160,220,0.6)" />
            ))}
            {crystals.map((c, i) => (
              <polygon key={i} points={`${c.x},${200 - c.s} ${c.x + c.s},200 ${c.x},${200 + c.s} ${c.x - c.s},200`} fill="#e8d080" stroke="#b8a020" strokeWidth={1} />
            ))}
            <text x="280" y="240" textAnchor="middle" fontSize="11" fill="#b8a020">Salt crystals remain</text>
            <rect x="230" y="218" width="100" height="10" rx="3" fill="#ff6600" opacity={0.7} />
            <text x="280" y="260" textAnchor="middle" fontSize="10" fill="var(--text-2)">Water evaporates, solid stays</text>
          </g>
        )}
      </svg>
      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--text-1)', textAlign: 'center' }}>
        {method === 'Filtration' && <><b style={{ color: 'var(--orange)' }}>Filtration</b>: separates insoluble solid from liquid</>}
        {method === 'Distillation' && <><b style={{ color: 'var(--orange)' }}>Distillation</b>: separates liquids by boiling point difference</>}
        {method === 'Evaporation' && <><b style={{ color: 'var(--orange)' }}>Evaporation</b>: removes volatile solvent, leaves non-volatile solute</>}
      </div>
    </div>
  );
}
