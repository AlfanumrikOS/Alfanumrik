'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export const metadata = {
  id: 'statistics-lab',
  name: 'Statistics Lab',
  subject: 'Mathematics',
  grade: '9-12',
  description: 'Calculate mean, median, mode, variance and visualize data distributions with histograms',
};

const ORANGE = '#F97316';
const PURPLE = '#7C3AED';

const PRESETS: Record<string, string> = {
  'Exam Scores': '72, 85, 91, 63, 78, 85, 92, 55, 88, 74, 85, 67, 79, 93, 81',
  'Heights (cm)': '155, 162, 168, 170, 158, 165, 172, 160, 175, 163',
  'Custom': '',
};

function computeStats(nums: number[]) {
  if (nums.length === 0) return null;
  const n = nums.length;
  const sorted = [...nums].sort((a, b) => a - b);
  const mean = nums.reduce((s, x) => s + x, 0) / n;
  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[Math.floor(n / 2)];
  const freq: Record<number, number> = {};
  nums.forEach(x => { freq[x] = (freq[x] || 0) + 1; });
  const maxFreq = Math.max(...Object.values(freq));
  const modes = Object.keys(freq).filter(k => freq[Number(k)] === maxFreq).map(Number);
  const variance = nums.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const range = sorted[n - 1] - sorted[0];
  return { n, mean, median, modes, maxFreq, variance, std, range, sorted, min: sorted[0], max: sorted[n - 1] };
}

export default function StatisticsLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedPreset, setSelectedPreset] = useState<string>('Exam Scores');
  const [input, setInput] = useState(PRESETS['Exam Scores']);

  const nums = input
    .split(',')
    .map(x => parseFloat(x.trim()))
    .filter(x => !isNaN(x));
  const stats = computeStats(nums);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stats) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const PAD = { top: 20, right: 16, bottom: 40, left: 44 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, W, H);

    if (nums.length < 2) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Enter at least 2 numbers', W / 2, H / 2);
      return;
    }

    // Histogram bins
    const binCount = Math.min(10, Math.ceil(Math.sqrt(nums.length)));
    const binWidth = (stats.max - stats.min) / binCount || 1;
    const bins: number[] = Array(binCount).fill(0);
    nums.forEach(x => {
      const idx = Math.min(Math.floor((x - stats.min) / binWidth), binCount - 1);
      bins[idx]++;
    });
    const maxBin = Math.max(...bins, 1);

    // Background
    ctx.fillStyle = '#111827';
    ctx.fillRect(PAD.left, PAD.top, plotW, plotH);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + plotH - (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round((i / 4) * maxBin)), PAD.left - 4, y + 4);
    }

    // Bars
    const barW = plotW / binCount;
    bins.forEach((count, i) => {
      const barH = count > 0 ? (count / maxBin) * plotH : 0;
      const x = PAD.left + i * barW;
      const y = PAD.top + plotH - barH;

      // Gradient bar
      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, '#7C3AED');
      grad.addColorStop(1, '#F97316');
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, y, barW - 2, barH);

      // Bin label
      const binLabel = (stats.min + i * binWidth).toFixed(0);
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(binLabel, x + barW / 2, PAD.top + plotH + 14);
    });

    // Mean line (orange)
    const meanX = PAD.left + ((stats.mean - stats.min) / ((stats.max - stats.min) || 1)) * plotW;
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(meanX, PAD.top);
    ctx.lineTo(meanX, PAD.top + plotH);
    ctx.stroke();
    ctx.fillStyle = ORANGE;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('x̄', meanX, PAD.top - 4);

    // Median line (purple)
    const medianX = PAD.left + ((stats.median - stats.min) / ((stats.max - stats.min) || 1)) * plotW;
    ctx.strokeStyle = PURPLE;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(medianX, PAD.top);
    ctx.lineTo(medianX, PAD.top + plotH);
    ctx.stroke();
    ctx.fillStyle = PURPLE;
    ctx.textAlign = 'center';
    ctx.fillText('M', medianX, PAD.top + plotH + 28);

    ctx.setLineDash([]);

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, PAD.top + plotH);
    ctx.lineTo(PAD.left + plotW, PAD.top + plotH);
    ctx.stroke();
  }, [nums, stats]);

  useEffect(() => { draw(); }, [draw]);

  const handlePreset = (name: string) => {
    setSelectedPreset(name);
    if (name !== 'Custom') setInput(PRESETS[name]);
  };

  const statBoxStyle = { background: '#1f2937', borderRadius: 8, padding: '8px 12px', textAlign: 'center' as const };
  const statLabelStyle = { color: '#9ca3af', fontSize: 11, marginBottom: 2 };
  const statValueStyle = { color: '#f9fafb', fontSize: 15, fontWeight: 700 };

  return (
    <div style={{ background: '#111827', minHeight: '100vh', padding: 16, fontFamily: 'Plus Jakarta Sans, sans-serif', color: '#f9fafb' }}>
      <h2 style={{ textAlign: 'center', color: ORANGE, fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Statistics Lab</h2>
      <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: 12, marginBottom: 12 }}>Mean, Median, Mode, Variance & Histogram</p>

      {/* Preset selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' as const }}>
        {Object.keys(PRESETS).map(name => (
          <button
            key={name}
            onClick={() => handlePreset(name)}
            style={{
              padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: selectedPreset === name ? ORANGE : '#374151',
              color: selectedPreset === name ? '#fff' : '#d1d5db',
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Data input */}
      <textarea
        value={input}
        onChange={e => { setInput(e.target.value); setSelectedPreset('Custom'); }}
        rows={2}
        placeholder="Enter comma-separated numbers..."
        style={{
          width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 8,
          color: '#f9fafb', padding: '8px 10px', fontSize: 13, resize: 'vertical', outline: 'none',
          boxSizing: 'border-box' as const,
        }}
      />

      {/* Histogram */}
      <canvas
        ref={canvasRef}
        width={360} height={200}
        style={{ display: 'block', margin: '12px auto 0', borderRadius: 10, maxWidth: '100%', border: '1px solid #374151' }}
      />

      <div style={{ display: 'flex', gap: 12, marginTop: 6, justifyContent: 'center', fontSize: 11 }}>
        <span style={{ color: ORANGE }}>— Mean (x̄)</span>
        <span style={{ color: PURPLE }}>— Median (M)</span>
      </div>

      {/* Stats grid */}
      {stats ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Mean (x̄)</p>
              <p style={{ ...statValueStyle, color: ORANGE }}>{stats.mean.toFixed(2)}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Median</p>
              <p style={{ ...statValueStyle, color: PURPLE }}>{stats.median.toFixed(2)}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Mode</p>
              <p style={statValueStyle}>{stats.modes.join(', ')}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Range</p>
              <p style={statValueStyle}>{stats.range.toFixed(2)}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Variance (σ²)</p>
              <p style={statValueStyle}>{stats.variance.toFixed(2)}</p>
            </div>
            <div style={statBoxStyle}>
              <p style={statLabelStyle}>Std Dev (σ)</p>
              <p style={statValueStyle}>{stats.std.toFixed(2)}</p>
            </div>
          </div>

          <div style={{ background: '#1f2937', borderRadius: 8, padding: 10, marginTop: 8, border: '1px solid #374151' }}>
            <p style={{ color: '#9ca3af', fontSize: 11, textAlign: 'center' }}>
              n = {stats.n} &nbsp;|&nbsp; Min = {stats.min} &nbsp;|&nbsp; Max = {stats.max}
            </p>
            <p style={{ color: '#6b7280', fontSize: 11, textAlign: 'center', marginTop: 2 }}>
              σ² = Σ(x − x̄)² / n &nbsp;&nbsp;|&nbsp;&nbsp; σ = √σ²
            </p>
          </div>
        </>
      ) : (
        <div style={{ background: '#1f2937', borderRadius: 8, padding: 16, marginTop: 12, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
          Enter valid numbers above to see statistics
        </div>
      )}
    </div>
  );
}
