'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

export const metadata = {
  id: 'sound-waves',
  name: 'Sound Waves',
  subject: 'Physics',
  grade: '9-11',
  description: 'Visualize sound as longitudinal waves — frequency, amplitude, wavelength, and speed',
};

const SOUND_SPEED = 343; // m/s

export default function SoundWaves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const [frequency, setFrequency] = useState(500);
  const [amplitude, setAmplitude] = useState(0.6);

  const stateRef = useRef({ frequency, amplitude });
  useEffect(() => { stateRef.current = { frequency, amplitude }; }, [frequency, amplitude]);

  const wavelength = SOUND_SPEED / frequency; // m
  const period = 1 / frequency; // s

  const drawFrame = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { frequency: freq, amplitude: amp } = stateRef.current;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, W, H);

    // Animation speed: scale freq to visual (1Hz visual = 100Hz actual)
    const visualFreq = freq / 100;
    const animPhase = time * 0.001 * visualFreq * 2 * Math.PI;

    const topH = H * 0.48;
    const botH = H * 0.48;
    const topCY = topH / 2;
    const botCY = topH + H * 0.04 + botH / 2;

    // ---- TOP HALF: Longitudinal wave (particle dots) ----
    const numParticles = 60;
    const particleSpacing = W / numParticles;
    const maxDisplace = amp * particleSpacing * 1.2;
    const dotRadius = Math.max(2, amp * 5);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Longitudinal (Particle View)', 6, 12);

    // Draw compression/rarefaction background
    for (let px = 0; px < W; px++) {
      const xNorm = (px / W) * 4 * Math.PI;
      const compression = Math.sin(xNorm - animPhase);
      const alpha = (compression + 1) / 2 * 0.25 * amp;
      ctx.fillStyle = `rgba(124, 58, 237, ${alpha})`;
      ctx.fillRect(px, 0, 1, topH);
    }

    for (let i = 0; i < numParticles; i++) {
      const baseX = i * particleSpacing + particleSpacing / 2;
      const xNorm = (baseX / W) * 4 * Math.PI;
      const displacement = maxDisplace * Math.sin(xNorm - animPhase);
      const px = baseX + displacement;
      const compression = (Math.sin(xNorm - animPhase) + 1) / 2;
      const r = Math.round(148 + compression * (249 - 148));
      const g = Math.round(163 + compression * (115 - 163));
      const b = Math.round(184 + compression * (22 - 184));
      ctx.beginPath();
      ctx.arc(px, topCY, dotRadius, 0, 2 * Math.PI);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fill();
    }

    // Labels: C = compression, R = rarefaction
    ctx.fillStyle = '#F97316';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < 2; i++) {
      const cx = W * (i * 0.5 + 0.125);
      ctx.fillText('C', cx, topH - 6);
    }
    ctx.fillStyle = '#7C3AED';
    for (let i = 0; i < 2; i++) {
      const rx = W * (i * 0.5 + 0.375);
      ctx.fillText('R', rx, topH - 6);
    }

    // Divider
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, topH + H * 0.02);
    ctx.lineTo(W, topH + H * 0.02);
    ctx.stroke();

    // ---- BOTTOM HALF: Transverse wave ----
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Transverse (Wave Shape)', 6, topH + H * 0.04 + 12);

    // x-axis
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, botCY);
    ctx.lineTo(W, botCY);
    ctx.stroke();

    const waveAmp = (botH / 2) * 0.75 * amp;
    ctx.strokeStyle = '#F97316';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let px = 0; px <= W; px++) {
      const xNorm = (px / W) * 4 * Math.PI;
      const y = botCY - waveAmp * Math.sin(xNorm - animPhase);
      px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    }
    ctx.stroke();

    // Wavelength annotation (one full cycle = W/2 pixels visual)
    const cycleW = W / 2;
    const annoY = botCY + waveAmp + 14;
    ctx.strokeStyle = '#7C3AED';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, annoY);
    ctx.lineTo(cycleW, annoY);
    ctx.stroke();
    // Arrow endpoints
    [0, cycleW].forEach(x => {
      ctx.beginPath();
      ctx.moveTo(x, annoY - 4);
      ctx.lineTo(x, annoY + 4);
      ctx.stroke();
    });
    ctx.fillStyle = '#7C3AED';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`\u03bb = ${(wavelength * 100).toFixed(1)} cm`, cycleW / 2, annoY + 12);
  }, [wavelength]);

  useEffect(() => {
    const loop = (time: number) => {
      drawFrame(time);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawFrame]);

  const sliderStyle = { width: '100%', accentColor: '#F97316' };
  const labelStyle: React.CSSProperties = { color: '#94a3b8', fontSize: 13 };
  const valueStyle: React.CSSProperties = { color: '#F97316', fontWeight: 700 };

  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, maxWidth: '100%', fontFamily: 'sans-serif' }}>
      <h2 style={{ color: '#F97316', margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Sound Waves</h2>
      <canvas ref={canvasRef} width={400} height={240} style={{ width: '100%', borderRadius: 8, display: 'block' }} />
      <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={labelStyle}>Frequency (f)</span>
            <span style={valueStyle}>{frequency} Hz</span>
          </div>
          <input type="range" min={100} max={2000} step={50} value={frequency}
            onChange={e => setFrequency(Number(e.target.value))} style={sliderStyle} />
        </div>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
            <span style={labelStyle}>Amplitude (A)</span>
            <span style={valueStyle}>{amplitude.toFixed(2)}</span>
          </div>
          <input type="range" min={0.2} max={1.0} step={0.05} value={amplitude}
            onChange={e => setAmplitude(Number(e.target.value))} style={sliderStyle} />
        </div>
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: 'Wavelength (\u03bb)', value: `${(wavelength * 100).toFixed(1)} cm` },
          { label: 'Period (T)', value: `${(period * 1000).toFixed(2)} ms` },
          { label: 'Speed (v)', value: `${SOUND_SPEED} m/s` },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: '#0f0f23', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ color: '#64748b', fontSize: 11 }}>{label}</div>
            <div style={{ color: '#F97316', fontWeight: 700, fontSize: 14 }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
