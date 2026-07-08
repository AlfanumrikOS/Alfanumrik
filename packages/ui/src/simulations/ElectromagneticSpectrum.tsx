'use client';
import { useState } from 'react';

const REGIONS = [
  { name: 'Radio', color: '#dc2626', wavelength: '1mm – 100km', frequency: '3 kHz – 300 GHz', use: 'Broadcasting, WiFi, AM/FM Radio', source: 'Antennae, oscillating circuits' },
  { name: 'Microwave', color: '#ea580c', wavelength: '1mm – 1m', frequency: '300 MHz – 300 GHz', use: 'Radar, Microwave ovens, Satellite', source: 'Magnetron tubes, klystrons' },
  { name: 'Infrared', color: '#ca8a04', wavelength: '700nm – 1mm', frequency: '300 GHz – 430 THz', use: 'Thermal imaging, Remote controls', source: 'Warm bodies, lasers' },
  { name: 'Visible', color: 'url(#vis)', wavelength: '380nm – 700nm', frequency: '430 THz – 790 THz', use: 'Human vision, Photography', source: 'Sun, LEDs, incandescent bulbs' },
  { name: 'UV', color: '#7c3aed', wavelength: '10nm – 380nm', frequency: '790 THz – 30 PHz', use: 'Sterilisation, Fluorescence', source: 'Sun, Mercury lamps' },
  { name: 'X-ray', color: '#2563eb', wavelength: '0.01nm – 10nm', frequency: '30 PHz – 30 EHz', use: 'Medical imaging, Airport security', source: 'X-ray tubes, synchrotrons' },
  { name: 'Gamma', color: '#059669', wavelength: '< 0.01nm', frequency: '> 30 EHz', use: 'Cancer therapy, Sterilisation', source: 'Radioactive nuclei, pulsars' },
] as const;

export default function ElectromagneticSpectrum() {
  const [selected, setSelected] = useState<number | null>(null);

  const barW = 560 / REGIONS.length;
  const sel = selected !== null ? REGIONS[selected] : null;

  return (
    <div style={{ background: 'var(--surface-1)', borderRadius: 12, padding: 16, maxWidth: 600, margin: '0 auto', fontFamily: 'inherit' }}>
      <h3 style={{ color: 'var(--text-1)', fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Electromagnetic Spectrum</h3>

      <svg viewBox="0 0 560 120" style={{ width: '100%', borderRadius: 8, background: 'var(--surface-2)', display: 'block', cursor: 'pointer' }}>
        <defs>
          <linearGradient id="vis" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#6600ff" />
            <stop offset="16%" stopColor="#4400ff" />
            <stop offset="33%" stopColor="#0044ff" />
            <stop offset="50%" stopColor="#00cc44" />
            <stop offset="67%" stopColor="#ffff00" />
            <stop offset="83%" stopColor="#ff8800" />
            <stop offset="100%" stopColor="#ff0000" />
          </linearGradient>
        </defs>
        {REGIONS.map((r, i) => (
          <g key={r.name} onClick={() => setSelected(selected === i ? null : i)}>
            <rect
              x={i * barW} y={20} width={barW} height={60}
              fill={r.color}
              opacity={selected === null || selected === i ? 1 : 0.4}
              rx={i === 0 ? 6 : i === REGIONS.length - 1 ? 6 : 0}
            />
            {selected === i && <rect x={i * barW} y={20} width={barW} height={60} fill="none" stroke="#fff" strokeWidth="2.5" rx={4} />}
            <text x={i * barW + barW / 2} y={58} textAnchor="middle" fill="#fff" fontSize={barW > 70 ? 11 : 9} fontWeight="bold">{r.name}</text>
          </g>
        ))}
        {/* Wavelength arrow */}
        <text x="8" y="14" fill="#9ca3af" fontSize="10">Long λ →</text>
        <text x="452" y="14" fill="#9ca3af" fontSize="10">Short λ</text>
        <text x="8" y="106" fill="#9ca3af" fontSize="10">Low f</text>
        <text x="452" y="106" fill="#9ca3af" fontSize="10">← High f</text>
      </svg>

      {sel && (
        <div style={{ marginTop: 10, padding: '12px', background: 'var(--surface-2)', borderRadius: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-1)', marginBottom: 6 }}>{sel.name} Waves</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13 }}>
            <div><span style={{ color: 'var(--text-2)' }}>Wavelength: </span><b style={{ color: 'var(--orange,#f97316)' }}>{sel.wavelength}</b></div>
            <div><span style={{ color: 'var(--text-2)' }}>Frequency: </span><b style={{ color: 'var(--purple,#7c3aed)' }}>{sel.frequency}</b></div>
            <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--text-2)' }}>Uses: </span><span style={{ color: 'var(--text-1)' }}>{sel.use}</span></div>
            <div style={{ gridColumn: '1/-1' }}><span style={{ color: 'var(--text-2)' }}>Source: </span><span style={{ color: 'var(--text-1)' }}>{sel.source}</span></div>
          </div>
        </div>
      )}
      {!sel && (
        <p style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 8, textAlign: 'center' }}>Click any region to see details</p>
      )}

      <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 13, color: 'var(--text-1)', textAlign: 'center' }}>
        c = fλ &nbsp;|&nbsp; c = <b style={{ color: 'var(--orange,#f97316)' }}>3 × 10⁸ m/s</b>
      </div>
    </div>
  );
}
