'use client';

import React, { useState, useCallback, useRef } from 'react';

/**
 * Acid-Base Indicator Simulation
 *
 * CBSE Class 10, Chapter 2: Acids, Bases and Salts
 * Board Exam Relevance: HIGH (3-5 marks)
 *
 * Students test 6 solutions with 4 indicators and observe
 * color changes. A data table auto-fills results. pH revealed after testing.
 */

interface Solution {
  name: string;
  formula: string;
  pH: number;
  type: 'acid' | 'base' | 'neutral';
  color: string;
}

interface Indicator {
  name: string;
  emoji: string;
  getColor: (pH: number) => string;
  getColorName: (pH: number) => string;
}

const SOLUTIONS: Solution[] = [
  { name: 'Hydrochloric Acid', formula: 'HCl', pH: 1.0, type: 'acid', color: '#f0f0f0' },
  { name: 'Sodium Hydroxide', formula: 'NaOH', pH: 13.0, type: 'base', color: '#f0f8ff' },
  { name: 'Lemon Juice', formula: 'C\u2086H\u2088O\u2087', pH: 2.2, type: 'acid', color: '#fef9c3' },
  { name: 'Soap Solution', formula: 'R-COONa', pH: 10.0, type: 'base', color: '#f0f4ff' },
  { name: 'Vinegar', formula: 'CH\u2083COOH', pH: 2.8, type: 'acid', color: '#fef3c7' },
  { name: 'Baking Soda', formula: 'NaHCO\u2083', pH: 8.3, type: 'base', color: '#fefefe' },
];

const INDICATORS: Indicator[] = [
  {
    name: 'Red Litmus',
    emoji: '\uD83D\uDD34',
    getColor: (pH: number) => pH > 7 ? '#3b82f6' : '#dc2626',
    getColorName: (pH: number) => pH > 7 ? 'Blue' : 'Red (no change)',
  },
  {
    name: 'Blue Litmus',
    emoji: '\uD83D\uDD35',
    getColor: (pH: number) => pH < 7 ? '#dc2626' : '#3b82f6',
    getColorName: (pH: number) => pH < 7 ? 'Red' : 'Blue (no change)',
  },
  {
    name: 'Phenolphthalein',
    emoji: '\uD83E\uDDEA',
    getColor: (pH: number) => pH >= 8.2 ? '#ec4899' : '#f5f5f4',
    getColorName: (pH: number) => pH >= 8.2 ? 'Pink' : 'Colourless',
  },
  {
    name: 'Methyl Orange',
    emoji: '\uD83E\uDDCA',
    getColor: (pH: number) => pH < 3.1 ? '#dc2626' : pH < 4.4 ? '#f97316' : '#fbbf24',
    getColorName: (pH: number) => pH < 3.1 ? 'Red' : pH < 4.4 ? 'Orange' : 'Yellow',
  },
];

interface TestResult {
  solutionIdx: number;
  indicatorIdx: number;
  colorName: string;
  color: string;
}

export default function AcidBaseIndicator() {
  const [selectedSolution, setSelectedSolution] = useState<number | null>(null);
  const [dragIndicator, setDragIndicator] = useState<number | null>(null);
  const [results, setResults] = useState<TestResult[]>([]);
  const [animating, setAnimating] = useState(false);
  const [lastResult, setLastResult] = useState<TestResult | null>(null);
  const [revealedPH, setRevealedPH] = useState<Set<number>>(new Set());
  const tubeRefs = useRef<(HTMLDivElement | null)[]>([]);

  const hasResult = useCallback((sIdx: number, iIdx: number) => {
    return results.some(r => r.solutionIdx === sIdx && r.indicatorIdx === iIdx);
  }, [results]);

  const getResultForTube = useCallback((sIdx: number) => {
    const solutionResults = results.filter(r => r.solutionIdx === sIdx);
    if (solutionResults.length === 0) return null;
    return solutionResults[solutionResults.length - 1];
  }, [results]);

  const handleDrop = useCallback((solutionIdx: number) => {
    if (dragIndicator === null) return;
    if (hasResult(solutionIdx, dragIndicator)) {
      setDragIndicator(null);
      return;
    }

    const solution = SOLUTIONS[solutionIdx];
    const indicator = INDICATORS[dragIndicator];
    const color = indicator.getColor(solution.pH);
    const colorName = indicator.getColorName(solution.pH);

    setAnimating(true);
    const newResult: TestResult = {
      solutionIdx,
      indicatorIdx: dragIndicator,
      colorName,
      color,
    };

    setTimeout(() => {
      setResults(prev => [...prev, newResult]);
      setLastResult(newResult);
      setAnimating(false);

      // Check if all 4 indicators tested for this solution
      const count = results.filter(r => r.solutionIdx === solutionIdx).length + 1;
      if (count >= 4) {
        setRevealedPH(prev => new Set([...prev, solutionIdx]));
      }
    }, 600);

    setDragIndicator(null);
    setSelectedSolution(solutionIdx);
  }, [dragIndicator, hasResult, results]);

  const handleIndicatorClick = useCallback((indicatorIdx: number) => {
    if (dragIndicator === indicatorIdx) {
      setDragIndicator(null);
    } else {
      setDragIndicator(indicatorIdx);
    }
  }, [dragIndicator]);

  const handleTubeClick = useCallback((solutionIdx: number) => {
    if (dragIndicator !== null) {
      handleDrop(solutionIdx);
    } else {
      setSelectedSolution(solutionIdx === selectedSolution ? null : solutionIdx);
    }
  }, [dragIndicator, handleDrop, selectedSolution]);

  const completedSolutions = SOLUTIONS.map((_, sIdx) => {
    const count = results.filter(r => r.solutionIdx === sIdx).length;
    return count;
  });

  const totalTests = results.length;
  const maxTests = SOLUTIONS.length * INDICATORS.length;

  const resetAll = useCallback(() => {
    setResults([]);
    setRevealedPH(new Set());
    setLastResult(null);
    setSelectedSolution(null);
    setDragIndicator(null);
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '16px',
      fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif",
      color: '#f1f5f9',
    }}>
      <style>{`
        @keyframes dropIn {
          0% { transform: translateY(-40px) scale(0.5); opacity: 0; }
          60% { transform: translateY(5px) scale(1.05); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes colorChange {
          0% { opacity: 0.3; }
          50% { opacity: 0.7; transform: scale(1.05); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes bubbleRise {
          0% { transform: translateY(0) scale(1); opacity: 0.6; }
          100% { transform: translateY(-50px) scale(0.3); opacity: 0; }
        }
        @keyframes pulseGlow {
          0%, 100% { box-shadow: 0 0 0 rgba(255,255,255,0); }
          50% { box-shadow: 0 0 12px rgba(255,255,255,0.3); }
        }
        .indicator-btn {
          border: 2px solid rgba(255,255,255,0.15);
          border-radius: 14px;
          padding: 10px 14px;
          cursor: pointer;
          transition: all 0.25s ease;
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255,255,255,0.06);
          color: #e2e8f0;
          font-size: 0.85rem;
          font-weight: 600;
          min-height: 44px;
        }
        .indicator-btn:hover {
          background: rgba(255,255,255,0.12);
          transform: translateY(-2px);
          box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        }
        .indicator-btn.selected {
          border-color: #f59e0b;
          background: rgba(245,158,11,0.15);
          box-shadow: 0 0 20px rgba(245,158,11,0.2);
        }
        .tube-container {
          cursor: pointer;
          transition: all 0.25s ease;
          position: relative;
        }
        .tube-container:hover {
          transform: translateY(-4px);
        }
        .tube-container.drop-target {
          animation: pulseGlow 1s ease infinite;
        }
        .result-row {
          animation: colorChange 0.4s ease;
        }
      `}</style>

      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <h1 style={{
          fontSize: 'clamp(1.3rem, 4vw, 2rem)',
          fontWeight: 800,
          margin: 0,
          background: 'linear-gradient(90deg, #ef4444, #f59e0b, #22c55e, #6366f1)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          Acid-Base Indicator Lab
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 'clamp(0.8rem, 2vw, 0.95rem)', color: '#94a3b8' }}>
          Select an indicator, then tap a test tube to test!
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ maxWidth: '700px', margin: '0 auto 16px', padding: '0 4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '4px' }}>
          <span>Tests completed</span>
          <span>{totalTests}/{maxTests}</span>
        </div>
        <div style={{
          height: '6px',
          borderRadius: '3px',
          background: 'rgba(255,255,255,0.1)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${(totalTests / maxTests) * 100}%`,
            borderRadius: '3px',
            background: 'linear-gradient(90deg, #f59e0b, #22c55e)',
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* Indicator selection */}
      <div style={{ maxWidth: '700px', margin: '0 auto 20px' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Step 1: Choose an Indicator
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
          gap: '8px',
        }}>
          {INDICATORS.map((indicator, iIdx) => (
            <button
              key={indicator.name}
              type="button"
              className={`indicator-btn ${dragIndicator === iIdx ? 'selected' : ''}`}
              onClick={() => handleIndicatorClick(iIdx)}
              aria-label={`Select ${indicator.name} indicator`}
            >
              <span style={{ fontSize: '1.2rem' }}>{indicator.emoji}</span>
              <span>{indicator.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Test tube rack */}
      <div style={{ maxWidth: '700px', margin: '0 auto 20px' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Step 2: Tap a Test Tube to Add Indicator
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 'clamp(8px, 2vw, 16px)',
          flexWrap: 'wrap',
          padding: '16px 0',
        }}>
          {SOLUTIONS.map((solution, sIdx) => {
            const latestResult = getResultForTube(sIdx);
            const liquidColor = latestResult ? latestResult.color : solution.color;
            const testCount = completedSolutions[sIdx];
            const isRevealed = revealedPH.has(sIdx);

            return (
              <div
                key={solution.name}
                ref={el => { tubeRefs.current[sIdx] = el; }}
                className={`tube-container ${dragIndicator !== null ? 'drop-target' : ''}`}
                onClick={() => handleTubeClick(sIdx)}
                style={{ textAlign: 'center' }}
                role="button"
                tabIndex={0}
                aria-label={`Test tube with ${solution.name}. ${testCount} of 4 indicators tested.`}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTubeClick(sIdx); }}
              >
                {/* Test tube SVG */}
                <svg width="48" height="120" viewBox="0 0 48 120" style={{ display: 'block', margin: '0 auto' }}>
                  {/* Tube body */}
                  <rect x="10" y="8" width="28" height="85" rx="0" ry="0" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
                  {/* Tube bottom (rounded) */}
                  <ellipse cx="24" cy="93" rx="14" ry="8" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
                  {/* Rim */}
                  <rect x="7" y="5" width="34" height="6" rx="3" fill="rgba(255,255,255,0.15)" />
                  {/* Liquid */}
                  <rect x="11.5" y="40" width="25" height="52" rx="0" fill={liquidColor} style={{ transition: 'fill 0.6s ease' }}>
                    {animating && selectedSolution === sIdx && (
                      <animate attributeName="opacity" values="0.5;1;0.8;1" dur="0.6s" />
                    )}
                  </rect>
                  <ellipse cx="24" cy="93" rx="12.5" ry="6.5" fill={liquidColor} style={{ transition: 'fill 0.6s ease' }} />
                  {/* Liquid surface */}
                  <ellipse cx="24" cy="40" rx="12.5" ry="3" fill={liquidColor} style={{ transition: 'fill 0.6s ease', opacity: 0.8 }} />
                  {/* Bubbles when animating */}
                  {animating && selectedSolution === sIdx && (
                    <>
                      <circle cx="18" cy="70" r="2" fill="rgba(255,255,255,0.4)">
                        <animate attributeName="cy" values="70;45" dur="0.8s" />
                        <animate attributeName="opacity" values="0.6;0" dur="0.8s" />
                      </circle>
                      <circle cx="30" cy="75" r="1.5" fill="rgba(255,255,255,0.3)">
                        <animate attributeName="cy" values="75;50" dur="0.6s" />
                        <animate attributeName="opacity" values="0.5;0" dur="0.6s" />
                      </circle>
                    </>
                  )}
                  {/* Test count dots */}
                  {[0, 1, 2, 3].map(i => (
                    <circle
                      key={i}
                      cx={15 + i * 7}
                      cy="108"
                      r="2.5"
                      fill={i < testCount ? '#22c55e' : 'rgba(255,255,255,0.15)'}
                      style={{ transition: 'fill 0.3s ease' }}
                    />
                  ))}
                </svg>
                {/* Solution label */}
                <div style={{
                  fontSize: 'clamp(0.6rem, 1.5vw, 0.72rem)',
                  fontWeight: 600,
                  color: selectedSolution === sIdx ? '#f59e0b' : '#cbd5e1',
                  marginTop: '4px',
                  lineHeight: 1.2,
                  maxWidth: '60px',
                  transition: 'color 0.2s ease',
                }}>
                  {solution.formula}
                </div>
                <div style={{
                  fontSize: 'clamp(0.55rem, 1.2vw, 0.65rem)',
                  color: '#64748b',
                  lineHeight: 1.1,
                  maxWidth: '60px',
                }}>
                  {solution.name}
                </div>
                {/* pH badge (revealed after all 4 tested) */}
                {isRevealed && (
                  <div style={{
                    marginTop: '4px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    color: solution.type === 'acid' ? '#ef4444' : '#3b82f6',
                    background: solution.type === 'acid' ? 'rgba(239,68,68,0.15)' : 'rgba(59,130,246,0.15)',
                    borderRadius: '6px',
                    padding: '1px 6px',
                    animation: 'colorChange 0.5s ease',
                  }}>
                    pH {solution.pH}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* Rack shelf */}
        <div style={{
          height: '8px',
          background: 'linear-gradient(180deg, rgba(139,92,50,0.6) 0%, rgba(101,67,33,0.4) 100%)',
          borderRadius: '4px',
          maxWidth: '500px',
          margin: '0 auto',
        }} />
      </div>

      {/* Last result callout */}
      {lastResult && (
        <div style={{
          maxWidth: '700px',
          margin: '0 auto 16px',
          padding: '12px 16px',
          background: 'rgba(255,255,255,0.08)',
          borderRadius: '12px',
          border: '1px solid rgba(255,255,255,0.12)',
          animation: 'colorChange 0.4s ease',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: lastResult.color,
            border: '2px solid rgba(255,255,255,0.2)',
            flexShrink: 0,
            transition: 'background 0.5s ease',
          }} />
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700 }}>
              {INDICATORS[lastResult.indicatorIdx].name} + {SOLUTIONS[lastResult.solutionIdx].name}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Turns <strong style={{ color: lastResult.color }}>{lastResult.colorName}</strong>
              {' \u2014 '}
              {SOLUTIONS[lastResult.solutionIdx].type === 'acid' ? 'This is an Acid' : 'This is a Base'}
            </div>
          </div>
        </div>
      )}

      {/* Data Table */}
      {results.length > 0 && (
        <div style={{ maxWidth: '700px', margin: '0 auto 20px', overflowX: 'auto' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Observation Table
          </div>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 'clamp(0.7rem, 1.6vw, 0.82rem)',
            minWidth: '400px',
          }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)' }}>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#94a3b8', fontWeight: 700 }}>Solution</th>
                <th style={{ textAlign: 'left', padding: '8px 10px', color: '#94a3b8', fontWeight: 700 }}>Indicator</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', color: '#94a3b8', fontWeight: 700 }}>Colour</th>
                <th style={{ textAlign: 'center', padding: '8px 10px', color: '#94a3b8', fontWeight: 700 }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, idx) => (
                <tr key={idx} className="result-row" style={{
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                  background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>
                    {SOLUTIONS[result.solutionIdx].formula}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {INDICATORS[result.indicatorIdx].emoji} {INDICATORS[result.indicatorIdx].name}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: '14px',
                        height: '14px',
                        borderRadius: '50%',
                        background: result.color,
                        border: '1px solid rgba(255,255,255,0.2)',
                      }} />
                      {result.colorName}
                    </span>
                  </td>
                  <td style={{
                    padding: '6px 10px',
                    textAlign: 'center',
                    fontWeight: 700,
                    color: SOLUTIONS[result.solutionIdx].type === 'acid' ? '#ef4444' : '#3b82f6',
                  }}>
                    {SOLUTIONS[result.solutionIdx].type === 'acid' ? 'Acid' : 'Base'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Key Learning */}
      <div style={{
        maxWidth: '700px',
        margin: '0 auto 16px',
        padding: '14px 16px',
        background: 'rgba(99,102,241,0.1)',
        borderRadius: '12px',
        border: '1px solid rgba(99,102,241,0.2)',
      }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#a5b4fc', marginBottom: '6px' }}>
          Key Learning Points
        </div>
        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.8 }}>
          <li><strong>Litmus paper</strong>: Red litmus turns blue in base; blue litmus turns red in acid</li>
          <li><strong>Phenolphthalein</strong>: Colourless in acid, <strong style={{ color: '#ec4899' }}>pink</strong> in base (pH {'\u2265'} 8.2)</li>
          <li><strong>Methyl Orange</strong>: <strong style={{ color: '#dc2626' }}>Red</strong> in strong acid (pH {'<'} 3.1), <strong style={{ color: '#fbbf24' }}>yellow</strong> in base</li>
          <li>Different indicators change colour at <strong>different pH ranges</strong> (transition range)</li>
          <li>No single indicator tells the exact pH &mdash; that is why we use <strong>pH paper or pH meter</strong></li>
        </ul>
      </div>

      {/* Reset button */}
      {results.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: '8px' }}>
          <button
            type="button"
            onClick={resetAll}
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#94a3b8',
              borderRadius: '10px',
              padding: '8px 20px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              minHeight: '44px',
            }}
            aria-label="Reset all tests"
          >
            Reset Experiment
          </button>
        </div>
      )}

      {/* Footer */}
      <div style={{
        textAlign: 'center',
        marginTop: '20px',
        fontSize: '0.7rem',
        color: '#475569',
      }}>
        CBSE Class 10 Chemistry &mdash; Ch 2: Acids, Bases and Salts
      </div>
    </div>
  );
}
