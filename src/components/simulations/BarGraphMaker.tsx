'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Bar Graph Maker
 *
 * CBSE Class 6 Ch9, Class 7 Ch3, Class 8 Ch5 — Data Handling
 *
 * Students enter category labels and values, see a real-time bar chart,
 * auto-calculated mean/mode/range, toggle bar chart / pictograph,
 * and pick from preset data sets.
 */

type ViewMode = 'bar' | 'pictograph';

interface DataRow {
  label: string;
  value: number;
}

interface PresetData {
  name: string;
  emoji: string;
  rows: DataRow[];
  unit: string;
  pictEmoji: string;
}

const PRESETS: PresetData[] = [
  {
    name: 'Favourite Fruits in Class',
    emoji: '🍎',
    rows: [
      { label: 'Mango', value: 12 },
      { label: 'Banana', value: 8 },
      { label: 'Apple', value: 10 },
      { label: 'Grapes', value: 6 },
      { label: 'Orange', value: 9 },
    ],
    unit: 'students',
    pictEmoji: '🧑',
  },
  {
    name: 'Monthly Rainfall (mm)',
    emoji: '🌧️',
    rows: [
      { label: 'Jun', value: 180 },
      { label: 'Jul', value: 310 },
      { label: 'Aug', value: 290 },
      { label: 'Sep', value: 200 },
      { label: 'Oct', value: 80 },
      { label: 'Nov', value: 20 },
    ],
    unit: 'mm',
    pictEmoji: '💧',
  },
  {
    name: 'Cricket Scores',
    emoji: '🏏',
    rows: [
      { label: 'Match 1', value: 45 },
      { label: 'Match 2', value: 72 },
      { label: 'Match 3', value: 38 },
      { label: 'Match 4', value: 91 },
      { label: 'Match 5', value: 55 },
      { label: 'Match 6', value: 72 },
    ],
    unit: 'runs',
    pictEmoji: '🏏',
  },
];

const BAR_COLORS = [
  '#F97316', '#9333EA', '#2563EB', '#16A34A', '#EAB308', '#EC4899', '#06B6D4', '#6366F1',
];

const BG_COLOR = '#FAFAF9';
const GRID_COLOR = '#E7E5E4';

function computeStats(rows: DataRow[]): { mean: number; mode: number[]; range: number; max: number; min: number } {
  const values = rows.map((r) => r.value).filter((v) => v > 0);
  if (values.length === 0) return { mean: 0, mode: [], range: 0, max: 0, min: 0 };

  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;

  // Mode: most frequent value(s)
  const freq: Record<number, number> = {};
  let maxFreq = 0;
  for (const v of values) {
    freq[v] = (freq[v] || 0) + 1;
    if (freq[v] > maxFreq) maxFreq = freq[v];
  }
  const mode = maxFreq > 1
    ? Object.entries(freq).filter(([, f]) => f === maxFreq).map(([v]) => Number(v))
    : [];

  return { mean, mode, range, max, min };
}

export default function BarGraphMaker() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<DataRow[]>(PRESETS[0].rows.map((r) => ({ ...r })));
  const [unit, setUnit] = useState(PRESETS[0].unit);
  const [pictEmoji, setPictEmoji] = useState(PRESETS[0].pictEmoji);
  const [viewMode, setViewMode] = useState<ViewMode>('bar');
  const [activePreset, setActivePreset] = useState(0);
  const [title, setTitle] = useState(PRESETS[0].name);

  const stats = computeStats(rows);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    const validRows = rows.filter((r) => r.label.trim() && r.value > 0);
    if (validRows.length === 0) {
      ctx.fillStyle = '#A8A29E';
      ctx.font = '14px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Enter data below to see the chart', w / 2, h / 2);
      return;
    }

    const maxVal = stats.max || 1;
    const padLeft = 55;
    const padRight = 20;
    const padTop = 40;
    const padBottom = 55;
    const chartW = w - padLeft - padRight;
    const chartH = h - padTop - padBottom;

    // Title
    ctx.fillStyle = '#1C1917';
    ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title || 'My Data', w / 2, 22);

    // Y-axis gridlines and labels
    const ySteps = 5;
    const niceMax = Math.ceil(maxVal / ySteps) * ySteps;
    ctx.font = '11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= ySteps; i++) {
      const val = (niceMax / ySteps) * i;
      const y = padTop + chartH - (chartH * val) / niceMax;
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
      ctx.fillStyle = '#78716C';
      ctx.fillText(String(Math.round(val)), padLeft - 8, y);
    }

    // X-axis line
    ctx.strokeStyle = '#D6D3D1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop + chartH);
    ctx.lineTo(w - padRight, padTop + chartH);
    ctx.stroke();

    // Y-axis line
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, padTop + chartH);
    ctx.stroke();

    const barGap = Math.max(8, chartW * 0.04);
    const barWidth = Math.max(20, (chartW - barGap * (validRows.length + 1)) / validRows.length);

    if (viewMode === 'bar') {
      validRows.forEach((row, i) => {
        const x = padLeft + barGap + i * (barWidth + barGap);
        const barH = (row.value / niceMax) * chartH;
        const y = padTop + chartH - barH;
        const color = BAR_COLORS[i % BAR_COLORS.length];

        // Bar shadow
        ctx.fillStyle = 'rgba(0,0,0,0.04)';
        ctx.fillRect(x + 2, y + 2, barWidth, barH);

        // Bar
        const grad = ctx.createLinearGradient(x, y, x, y + barH);
        grad.addColorStop(0, color);
        grad.addColorStop(1, color + 'CC');
        ctx.fillStyle = grad;
        ctx.beginPath();
        // Rounded top
        const radius = Math.min(4, barWidth / 4);
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + barWidth - radius, y);
        ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
        ctx.lineTo(x + barWidth, y + barH);
        ctx.lineTo(x, y + barH);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fill();

        // Value label on top
        ctx.fillStyle = '#1C1917';
        ctx.font = 'bold 12px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(row.value), x + barWidth / 2, y - 4);

        // Category label
        ctx.fillStyle = '#57534E';
        ctx.font = '11px "Plus Jakarta Sans", sans-serif';
        ctx.textBaseline = 'top';
        ctx.save();
        ctx.translate(x + barWidth / 2, padTop + chartH + 6);
        // Rotate if too many bars
        if (validRows.length > 5) {
          ctx.rotate(-Math.PI / 6);
          ctx.textAlign = 'right';
        } else {
          ctx.textAlign = 'center';
        }
        const displayLabel = row.label.length > 10 ? row.label.slice(0, 9) + '\u2026' : row.label;
        ctx.fillText(displayLabel, 0, 0);
        ctx.restore();
      });

      // Mean line
      if (stats.mean > 0) {
        const meanY = padTop + chartH - (stats.mean / niceMax) * chartH;
        ctx.strokeStyle = '#DC2626';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, meanY);
        ctx.lineTo(w - padRight, meanY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#DC2626';
        ctx.font = 'bold 10px "Plus Jakarta Sans", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`Mean: ${stats.mean.toFixed(1)}`, padLeft + 4, meanY - 3);
      }
    } else {
      // Pictograph mode
      const emojiPerUnit = niceMax > 50 ? Math.ceil(niceMax / 25) : niceMax > 20 ? 5 : 1;
      const emojiSize = Math.min(20, barWidth * 0.8);

      validRows.forEach((row, i) => {
        const x = padLeft + barGap + i * (barWidth + barGap);
        const count = Math.round(row.value / emojiPerUnit);
        const fullEmojis = Math.floor(row.value / emojiPerUnit);
        const remainder = (row.value % emojiPerUnit) / emojiPerUnit;

        ctx.font = `${emojiSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let j = 0; j < fullEmojis; j++) {
          const ey = padTop + chartH - (j + 0.5) * (emojiSize + 2);
          ctx.globalAlpha = 1;
          ctx.fillText(pictEmoji, x + barWidth / 2, ey);
        }

        // Partial emoji
        if (remainder > 0.1) {
          const ey = padTop + chartH - (fullEmojis + 0.5) * (emojiSize + 2);
          ctx.globalAlpha = remainder;
          ctx.fillText(pictEmoji, x + barWidth / 2, ey);
          ctx.globalAlpha = 1;
        }

        // Value label
        const topEmojiY = padTop + chartH - (Math.max(fullEmojis + (remainder > 0.1 ? 1 : 0), 1)) * (emojiSize + 2);
        ctx.fillStyle = '#1C1917';
        ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(row.value), x + barWidth / 2, topEmojiY - 2);

        // Category label
        ctx.fillStyle = '#57534E';
        ctx.font = '11px "Plus Jakarta Sans", sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(
          row.label.length > 10 ? row.label.slice(0, 9) + '\u2026' : row.label,
          x + barWidth / 2,
          padTop + chartH + 6
        );
      });

      ctx.globalAlpha = 1;

      // Pictograph legend
      ctx.fillStyle = '#78716C';
      ctx.font = '11px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`${pictEmoji} = ${emojiPerUnit} ${unit}`, padLeft, padTop + chartH + 38);
    }
  }, [rows, viewMode, title, stats, pictEmoji, unit]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  const updateRow = useCallback((index: number, field: 'label' | 'value', val: string) => {
    setRows((prev) => {
      const next = [...prev];
      if (field === 'label') {
        next[index] = { ...next[index], label: val };
      } else {
        const num = parseInt(val, 10);
        next[index] = { ...next[index], value: isNaN(num) ? 0 : Math.max(0, num) };
      }
      return next;
    });
    setActivePreset(-1);
  }, []);

  const addRow = useCallback(() => {
    if (rows.length >= 8) return;
    setRows((prev) => [...prev, { label: '', value: 0 }]);
    setActivePreset(-1);
  }, [rows.length]);

  const removeRow = useCallback((index: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
    setActivePreset(-1);
  }, [rows.length]);

  const loadPreset = useCallback((idx: number) => {
    const preset = PRESETS[idx];
    setRows(preset.rows.map((r) => ({ ...r })));
    setTitle(preset.name);
    setUnit(preset.unit);
    setPictEmoji(preset.pictEmoji);
    setActivePreset(idx);
  }, []);

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl mx-auto">
      {/* Preset & view toggle */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-semibold text-stone-500 uppercase tracking-wide">Presets:</span>
        {PRESETS.map((p, i) => (
          <button
            key={p.name}
            onClick={() => loadPreset(i)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors min-h-[44px] ${
              activePreset === i
                ? 'bg-orange-500 text-white border-orange-500'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-orange-50 hover:border-orange-300'
            }`}
          >
            {p.emoji} {p.name}
          </button>
        ))}
        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => setViewMode('bar')}
            className={`px-3 py-1.5 rounded-l-lg text-sm font-medium border transition-colors min-h-[44px] ${
              viewMode === 'bar'
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
            }`}
          >
            Bar Chart
          </button>
          <button
            onClick={() => setViewMode('pictograph')}
            className={`px-3 py-1.5 rounded-r-lg text-sm font-medium border transition-colors min-h-[44px] ${
              viewMode === 'pictograph'
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-stone-600 border-stone-300 hover:bg-stone-50'
            }`}
          >
            Pictograph
          </button>
        </div>
      </div>

      {/* Title input */}
      <input
        type="text"
        value={title}
        onChange={(e) => { setTitle(e.target.value); setActivePreset(-1); }}
        placeholder="Chart title"
        className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-800 focus:ring-2 focus:ring-orange-400 outline-none bg-white"
      />

      {/* Canvas */}
      <div ref={containerRef} className="relative w-full" style={{ aspectRatio: '4/3' }}>
        <canvas
          ref={canvasRef}
          className="w-full h-full rounded-xl border border-stone-200 touch-none"
        />
      </div>

      {/* Data input table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200">
              <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wide w-8">#</th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wide">Category</th>
              <th className="text-left py-2 px-2 text-xs font-semibold text-stone-500 uppercase tracking-wide w-24">Value</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-stone-100">
                <td className="py-1.5 px-2">
                  <span
                    className="w-5 h-5 rounded-full inline-block"
                    style={{ backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }}
                  />
                </td>
                <td className="py-1.5 px-2">
                  <input
                    type="text"
                    value={row.label}
                    onChange={(e) => updateRow(i, 'label', e.target.value)}
                    placeholder={`Category ${i + 1}`}
                    className="w-full rounded border border-stone-200 px-2 py-1.5 text-sm focus:ring-1 focus:ring-orange-400 outline-none min-h-[36px]"
                    maxLength={20}
                  />
                </td>
                <td className="py-1.5 px-2">
                  <input
                    type="number"
                    value={row.value || ''}
                    onChange={(e) => updateRow(i, 'value', e.target.value)}
                    placeholder="0"
                    min={0}
                    max={9999}
                    className="w-full rounded border border-stone-200 px-2 py-1.5 text-sm focus:ring-1 focus:ring-orange-400 outline-none min-h-[36px]"
                  />
                </td>
                <td className="py-1.5 px-2">
                  {rows.length > 1 && (
                    <button
                      onClick={() => removeRow(i)}
                      className="text-stone-400 hover:text-red-500 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
                      aria-label={`Remove row ${i + 1}`}
                    >
                      &times;
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length < 8 && (
          <button
            onClick={addRow}
            className="mt-2 px-4 py-2 rounded-lg border border-dashed border-stone-300 text-sm text-stone-500 hover:border-orange-400 hover:text-orange-600 transition-colors w-full min-h-[44px]"
          >
            + Add category
          </button>
        )}
      </div>

      {/* Statistics cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-orange-50 rounded-xl p-3 text-center">
          <div className="text-xs text-stone-500 font-medium uppercase tracking-wide">Mean</div>
          <div className="text-xl font-bold text-orange-600 mt-1">
            {stats.max > 0 ? stats.mean.toFixed(1) : '\u2014'}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">Average value</div>
        </div>
        <div className="bg-purple-50 rounded-xl p-3 text-center">
          <div className="text-xs text-stone-500 font-medium uppercase tracking-wide">Mode</div>
          <div className="text-xl font-bold text-purple-600 mt-1">
            {stats.mode.length > 0 ? stats.mode.join(', ') : '\u2014'}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">Most frequent</div>
        </div>
        <div className="bg-blue-50 rounded-xl p-3 text-center">
          <div className="text-xs text-stone-500 font-medium uppercase tracking-wide">Range</div>
          <div className="text-xl font-bold text-blue-600 mt-1">
            {stats.max > 0 ? stats.range : '\u2014'}
          </div>
          <div className="text-xs text-stone-500 mt-0.5">Max &minus; Min</div>
        </div>
      </div>

      {/* Learning tip */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-stone-700">
        <span className="font-semibold text-amber-700">Key Insight: </span>
        The <strong>mean</strong> (average) can be pulled by extreme values, while the{' '}
        <strong>mode</strong> shows the most common value. Try changing one number to something very large
        and see how the mean shifts but the mode may stay the same!
      </div>
    </div>
  );
}
