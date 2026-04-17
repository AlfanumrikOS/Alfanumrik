'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useResponsiveCanvas } from '@/hooks/useResponsiveCanvas';

export const metadata = {
  id: 'wave-interference',
  name: 'Wave Interference',
  subject: 'Physics',
  grade: '11-12',
  description: 'Explore constructive and destructive interference through wave superposition',
};

export default function WaveInterference() {
  const { canvasRef, containerRef, size } = useResponsiveCanvas(2);
  const animFrameRef = useRef<number>(0);
  const phaseRef = useRef<number>(0);

  const [amp1, setAmp1] = useState(0.7);
  const [freq1, setFreq1] = useState(1.5);
  const [amp2, setAmp2] = useState(0.7);
  const [freq2, setFreq2] = useState(1.5);
  const [phase2, setPhase2] = useState(0);
  const [isAnimating, setIsAnimating] = useState(true);

  const stateRef = useRef({ amp1, freq1, amp2, freq2, phase2, isAnimating });
  useEffect(() => { stateRef.current = { amp1, freq1, amp2, freq2, phase2, isAnimating }; }, [amp1, freq1, amp2, freq2, phase2, isAnimating]);

  const getInterferenceType = useCallback(() => {
    const freqMatch = Math.abs(freq1 - freq2) < 0.1;
    const phaseDeg = phase2 % 360;
    if (!freqMatch) return 'Mixed (Beat)';
    if (phaseDeg < 30 || phaseDeg > 330) return 'Constructive';
    if (phaseDeg > 150 && phaseDeg < 210) return 'Destructive';
    return 'Partial';
  }, [freq1, freq2, phase2]);

  const drawFrame = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { amp1: a1, freq1: f1, amp2: a2, freq2: f2, phase2: p2, isAnimating: anim } = stateRef.current;

    const W = size.width;
    const H = size.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0f0f23';
    ctx.fillRect(0, 0, W, H);

    const centerY = H / 2;
    const amplitude = (H / 2) * 0.35;
    const animPhase = anim ? time * 0.002 : 0;
    const p2Rad = (p2 * Math.PI) / 180;

    // x-axis
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(W, centerY);
    ctx.stroke();

    const plotWave = (color: string, getY: (x: number) => number, lineWidth = 1.5) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      for (let px = 0; px <= W; px++) {
        const xNorm = (px / W) * 4 * Math.PI;
        const y = centerY - getY(xNorm) * amplitude;
        px === 0 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
      }
      ctx.stroke();
    };

    // Wave 1: blue
    plotWave('rgba(96, 165, 250, 0.8)', x => a1 * Math.sin(f1 * x - animPhase));
    // Wave 2: green
    plotWave('rgba(74, 222, 128, 0.8)', x => a2 * Math.sin(f2 * x - animPhase + p2Rad));
    // Resultant: orange, thicker
    plotWave('#F97316', x =>
      a1 * Math.sin(f1 * x - animPhase) + a2 * Math.sin(f2 * x - animPhase + p2Rad), 2.5);

    // Legend
    const legend = [
      { label: 'Wave 1', color: 'rgba(96,165,250,0.9)' },
      { label: 'Wave 2', color: 'rgba(74,222,128,0.9)' },
      { label: 'Resultant', color: '#F97316' },
    ];
    legend.forEach(({ label, color }, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(8, 8 + i * 18, 22, 4);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(label, 36, 14 + i * 18);
    });

    // Interference type
    const itype = getInterferenceType();
    const itypeColor = itype === 'Constructive' ? '#22c55e' : itype === 'Destructive' ? '#ef4444' : '#f59e0b';
    ctx.fillStyle = itypeColor;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(itype, W - 8, H - 8);
  }, [getInterferenceType, size, canvasRef]);

  useEffect(() => {
    let raf: number;
    const loop = (time: number) => {
      phaseRef.current = time;
      drawFrame(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    animFrameRef.current = raf;
    return () => cancelAnimationFrame(raf);
  }, [drawFrame]);

  const sliderStyle = { width: '100%', accentColor: '#F97316' };
  const labelStyle: React.CSSProperties = { color: '#94a3b8', fontSize: 12 };
  const valueStyle: React.CSSProperties = { color: '#F97316', fontWeight: 700, fontSize: 12 };
  const itype = getInterferenceType();
  const itypeColor = itype === 'Constructive' ? '#22c55e' : itype === 'Destructive' ? '#ef4444' : '#f59e0b';

  return (
    <div style={{ background: '#1a1a2e', borderRadius: 12, padding: 16, maxWidth: '100%', fontFamily: 'sans-serif' }}>
      <h2 style={{ color: '#F97316', margin: '0 0 12px', fontSize: 18, fontWeight: 700 }}>Wave Interference</h2>
      <div ref={containerRef} className="w-full" style={{ aspectRatio: '2/1' }}>
        <canvas ref={canvasRef} className="rounded-lg" style={{ display: 'block' }} />
      </div>
      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <div>
          <div style={{ color: 'rgba(96,165,250,0.9)', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Wave 1 (Blue)</div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={labelStyle}>Amplitude</span>
              <span style={valueStyle}>{amp1.toFixed(1)}</span>
            </div>
            <input type="range" min={0.1} max={1} step={0.05} value={amp1}
              onChange={e => setAmp1(Number(e.target.value))} style={sliderStyle} />
          </div>
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={labelStyle}>Frequency</span>
              <span style={valueStyle}>{freq1.toFixed(1)} Hz</span>
            </div>
            <input type="range" min={0.5} max={3} step={0.1} value={freq1}
              onChange={e => setFreq1(Number(e.target.value))} style={sliderStyle} />
          </div>
        </div>
        <div>
          <div style={{ color: 'rgba(74,222,128,0.9)', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Wave 2 (Green)</div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={labelStyle}>Amplitude</span>
              <span style={valueStyle}>{amp2.toFixed(1)}</span>
            </div>
            <input type="range" min={0.1} max={1} step={0.05} value={amp2}
              onChange={e => setAmp2(Number(e.target.value))} style={sliderStyle} />
          </div>
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={labelStyle}>Frequency</span>
              <span style={valueStyle}>{freq2.toFixed(1)} Hz</span>
            </div>
            <input type="range" min={0.5} max={3} step={0.1} value={freq2}
              onChange={e => setFreq2(Number(e.target.value))} style={sliderStyle} />
          </div>
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={labelStyle}>Wave 2 Phase Shift</span>
          <span style={valueStyle}>{phase2}°</span>
        </div>
        <input type="range" min={0} max={360} step={5} value={phase2}
          onChange={e => setPhase2(Number(e.target.value))} style={sliderStyle} />
      </div>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => setIsAnimating(a => !a)}
          style={{ padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: isAnimating ? '#7C3AED' : '#1e293b',
            color: '#fff', fontWeight: 700, fontSize: 13 }}>
          {isAnimating ? 'Pause' : 'Animate'}
        </button>
        <div style={{ color: itypeColor, fontWeight: 700, fontSize: 14 }}>
          {itype} Interference
        </div>
      </div>
    </div>
  );
}
