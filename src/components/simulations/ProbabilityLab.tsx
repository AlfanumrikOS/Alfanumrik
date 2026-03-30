'use client';

import { useState, useCallback } from 'react';

/**
 * Probability Experiment Lab
 *
 * CBSE Class 10 Ch.15, Class 11 Ch.16: Probability
 * Board Exam Relevance: HIGH
 *
 * Demonstrates law of large numbers through:
 * - Coin toss (fair/biased)
 * - Dice roll (single/double)
 * - Custom probability spinner
 *
 * Students run experiments and see experimental probability
 * converge to theoretical probability as trials increase.
 */

interface Trial {
  outcome: string;
  color: string;
}

type Mode = 'coin' | 'dice' | 'two-dice';

const COIN_OUTCOMES = ['Heads', 'Tails'];
const DICE_OUTCOMES = ['1', '2', '3', '4', '5', '6'];
const DICE_COLORS: Record<string, string> = {
  '1': '#EF4444', '2': '#F59E0B', '3': '#22C55E',
  '4': '#3B82F6', '5': '#8B5CF6', '6': '#EC4899',
};

export default function ProbabilityLab() {
  const [mode, setMode] = useState<Mode>('coin');
  const [trials, setTrials] = useState<Trial[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const runSingle = useCallback(() => {
    let outcome: string;
    let color: string;

    if (mode === 'coin') {
      outcome = Math.random() < 0.5 ? 'Heads' : 'Tails';
      color = outcome === 'Heads' ? '#F59E0B' : '#94A3B8';
    } else if (mode === 'dice') {
      const val = Math.floor(Math.random() * 6) + 1;
      outcome = String(val);
      color = DICE_COLORS[outcome] || '#6B7280';
    } else {
      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;
      outcome = String(d1 + d2);
      color = '#6366F1';
    }

    setTrials(prev => [...prev, { outcome, color }]);
  }, [mode]);

  const runMany = useCallback(async (count: number) => {
    setIsRunning(true);
    const batch: Trial[] = [];
    for (let i = 0; i < count; i++) {
      let outcome: string;
      let color: string;
      if (mode === 'coin') {
        outcome = Math.random() < 0.5 ? 'Heads' : 'Tails';
        color = outcome === 'Heads' ? '#F59E0B' : '#94A3B8';
      } else if (mode === 'dice') {
        const val = Math.floor(Math.random() * 6) + 1;
        outcome = String(val);
        color = DICE_COLORS[outcome] || '#6B7280';
      } else {
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        outcome = String(d1 + d2);
        color = '#6366F1';
      }
      batch.push({ outcome, color });
    }
    setTrials(prev => [...prev, ...batch]);
    setIsRunning(false);
  }, [mode]);

  const reset = useCallback(() => {
    setTrials([]);
  }, []);

  // Compute frequencies
  const freq: Record<string, number> = {};
  for (const t of trials) {
    freq[t.outcome] = (freq[t.outcome] || 0) + 1;
  }

  // Expected outcomes and theoretical probabilities
  const outcomes = mode === 'coin' ? COIN_OUTCOMES :
    mode === 'dice' ? DICE_OUTCOMES :
    ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

  const theoreticalProb = (outcome: string): number => {
    if (mode === 'coin') return 0.5;
    if (mode === 'dice') return 1 / 6;
    // Two dice sum probabilities
    const n = Number(outcome);
    const ways = Math.min(n - 1, 13 - n);
    return ways / 36;
  };

  const total = trials.length;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", maxWidth: 600, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#6366F1' }}>🎲 Probability Experiment Lab</div>
        <div style={{ fontSize: 11, color: '#64748B' }}>Run experiments and discover the Law of Large Numbers</div>
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12, justifyContent: 'center' }}>
        {([
          { id: 'coin' as Mode, label: '🪙 Coin', desc: 'P(H) = 0.5' },
          { id: 'dice' as Mode, label: '🎲 Dice', desc: 'P(n) = 1/6' },
          { id: 'two-dice' as Mode, label: '🎲🎲 Two Dice', desc: 'Sum distribution' },
        ]).map(m => (
          <button key={m.id} onClick={() => { setMode(m.id); setTrials([]); }} style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${mode === m.id ? '#6366F1' : '#e2e8f0'}`, background: mode === m.id ? '#6366F1' : '#fff', color: mode === m.id ? '#fff' : '#64748B', fontSize: 12, cursor: 'pointer', fontWeight: mode === m.id ? 600 : 400 }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={runSingle} disabled={isRunning} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6366F1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {mode === 'coin' ? '🪙 Flip' : '🎲 Roll'}
        </button>
        <button onClick={() => runMany(10)} disabled={isRunning} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, cursor: 'pointer' }}>
          ×10
        </button>
        <button onClick={() => runMany(100)} disabled={isRunning} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, cursor: 'pointer' }}>
          ×100
        </button>
        <button onClick={() => runMany(1000)} disabled={isRunning} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', fontSize: 12, cursor: 'pointer' }}>
          ×1000
        </button>
        <button onClick={reset} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #fca5a5', background: '#fff', color: '#ef4444', fontSize: 12, cursor: 'pointer' }}>
          Reset
        </button>
      </div>

      {/* Trial count */}
      <div style={{ textAlign: 'center', marginBottom: 12, fontSize: 12, color: '#64748B' }}>
        Total trials: <strong style={{ color: '#1e293b', fontSize: 16 }}>{total}</strong>
      </div>

      {/* Frequency chart */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, padding: '0 4px' }}>
          {outcomes.map(o => {
            const count = freq[o] || 0;
            const maxFreq = Math.max(...outcomes.map(x => freq[x] || 0), 1);
            const barH = total > 0 ? (count / maxFreq) * 100 : 0;
            const expProb = theoreticalProb(o);
            const actualProb = total > 0 ? count / total : 0;
            const color = mode === 'coin' ? (o === 'Heads' ? '#F59E0B' : '#94A3B8') :
              mode === 'dice' ? (DICE_COLORS[o] || '#6366F1') : '#6366F1';

            return (
              <div key={o} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 10, color: '#64748B' }}>{count}</span>
                <div style={{ width: '100%', maxWidth: 36, height: barH, background: color, borderRadius: '4px 4px 0 0', transition: 'height 0.2s', minHeight: count > 0 ? 4 : 0 }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: '#334155' }}>{o}</span>
                {total > 0 && (
                  <span style={{ fontSize: 10, color: Math.abs(actualProb - expProb) < 0.05 ? '#22c55e' : '#f59e0b' }}>
                    {(actualProb * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Theoretical vs Experimental comparison */}
      {total > 0 && (
        <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748B', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Theoretical vs Experimental
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(outcomes.length, 6)}, 1fr)`, gap: 4 }}>
            {outcomes.slice(0, 6).map(o => {
              const expProb = theoreticalProb(o);
              const actualProb = total > 0 ? (freq[o] || 0) / total : 0;
              const diff = Math.abs(actualProb - expProb);
              return (
                <div key={o} style={{ textAlign: 'center', padding: '4px 2px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{o}</div>
                  <div style={{ fontSize: 10, color: '#6366F1' }}>T: {(expProb * 100).toFixed(1)}%</div>
                  <div style={{ fontSize: 10, color: diff < 0.03 ? '#22c55e' : diff < 0.08 ? '#f59e0b' : '#ef4444' }}>
                    E: {(actualProb * 100).toFixed(1)}%
                  </div>
                </div>
              );
            })}
          </div>
          {total >= 100 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#166534', textAlign: 'center', padding: '6px', background: '#f0fdf4', borderRadius: 6 }}>
              💡 {total >= 1000
                ? 'With 1000+ trials, experimental probability closely matches theoretical!'
                : 'Keep increasing trials — watch experimental approach theoretical probability.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
