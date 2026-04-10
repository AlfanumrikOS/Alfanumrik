'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Aerobic vs Anaerobic Respiration Simulation
 *
 * CBSE Class 10, Chapter 6: Life Processes
 * Board Exam Relevance: HIGH (3-5 marks)
 *
 * Animated side-by-side comparison of aerobic and anaerobic respiration.
 * Shows molecule flow, ATP production, and mitochondria visualization.
 * Toggle between yeast (ethanol pathway) and muscle (lactic acid pathway).
 */

type AnaerobicMode = 'yeast' | 'muscle';

interface MoleculeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: string;
  color: string;
  size: number;
  label: string;
  opacity: number;
}

export default function RespirationLab() {
  const [anaerobicMode, setAnaerobicMode] = useState<AnaerobicMode>('yeast');
  const [isPlaying, setIsPlaying] = useState(true);
  const [step, setStep] = useState(0);
  const animRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Animation step cycling
  useEffect(() => {
    if (!isPlaying) return;

    const tick = (time: number) => {
      if (time - lastTimeRef.current > 1200) {
        lastTimeRef.current = time;
        setStep(s => (s + 1) % 4);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPlaying]);

  const stepLabels = [
    'Glucose enters the cell',
    'Glucose breaks down (glycolysis in cytoplasm)',
    step === 2 ? 'Pyruvate enters mitochondria (aerobic) / stays in cytoplasm (anaerobic)' : '',
    'Products released + ATP generated',
  ];

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '16px',
      fontFamily: "'Plus Jakarta Sans', 'Segoe UI', system-ui, sans-serif",
      color: '#f1f5f9',
    }}>
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
        @keyframes moveRight {
          0% { transform: translateX(-10px); opacity: 0; }
          50% { opacity: 1; }
          100% { transform: translateX(10px); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 8px rgba(251, 191, 36, 0.3); }
          50% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.6); }
        }
        .molecule {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 0.72rem;
          font-weight: 700;
          animation: float 2s ease-in-out infinite;
        }
        .step-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          transition: all 0.3s ease;
        }
        .panel-card {
          background: rgba(255,255,255,0.06);
          border-radius: 16px;
          padding: 16px;
          border: 1px solid rgba(255,255,255,0.1);
          flex: 1;
          min-width: 280px;
        }
      `}</style>

      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: '16px' }}>
        <h1 style={{
          fontSize: 'clamp(1.2rem, 3.5vw, 1.8rem)',
          fontWeight: 800,
          margin: 0,
          background: 'linear-gradient(90deg, #22c55e, #3b82f6, #f59e0b)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          Respiration: Aerobic vs Anaerobic
        </h1>
        <p style={{ margin: '4px 0', fontSize: 'clamp(0.78rem, 1.8vw, 0.9rem)', color: '#94a3b8' }}>
          Compare how cells extract energy from glucose
        </p>
      </div>

      {/* Anaerobic mode toggle */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.15)',
        marginBottom: 16,
        maxWidth: 320,
        margin: '0 auto 16px',
      }}>
        {(['yeast', 'muscle'] as AnaerobicMode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setAnaerobicMode(m)}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: anaerobicMode === m ? '#6366f1' : 'rgba(255,255,255,0.05)',
              color: anaerobicMode === m ? '#fff' : '#94a3b8',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: 700,
              transition: 'all 0.2s ease',
              minHeight: '44px',
            }}
            aria-label={`Show ${m === 'yeast' ? 'yeast (ethanol)' : 'muscle (lactic acid)'} pathway`}
          >
            {m === 'yeast' ? 'Yeast Cell' : 'Muscle Cell'}
          </button>
        ))}
      </div>

      {/* Step indicator */}
      <div style={{
        maxWidth: '700px',
        margin: '0 auto 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        justifyContent: 'center',
      }}>
        {[0, 1, 2, 3].map(s => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div
              className="step-dot"
              style={{
                background: step === s ? '#f59e0b' : step > s ? '#22c55e' : 'rgba(255,255,255,0.15)',
                width: step === s ? '12px' : '10px',
                height: step === s ? '12px' : '10px',
                boxShadow: step === s ? '0 0 10px rgba(245,158,11,0.5)' : 'none',
              }}
            />
            {s < 3 && <div style={{ width: '20px', height: '2px', background: step > s ? '#22c55e' : 'rgba(255,255,255,0.1)' }} />}
          </div>
        ))}
      </div>
      <div style={{
        textAlign: 'center',
        fontSize: '0.78rem',
        color: '#f59e0b',
        fontWeight: 600,
        marginBottom: '14px',
        minHeight: '1.2em',
        animation: 'fadeIn 0.3s ease',
      }}>
        Step {step + 1}: {stepLabels[step]}
      </div>

      {/* Side-by-side panels */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto 16px',
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        {/* Aerobic panel */}
        <div className="panel-card" style={{ borderColor: 'rgba(34,197,94,0.3)' }}>
          <div style={{
            fontSize: '0.9rem',
            fontWeight: 800,
            color: '#22c55e',
            marginBottom: '10px',
            textAlign: 'center',
          }}>
            Aerobic Respiration
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center', marginBottom: '12px' }}>
            Occurs in presence of O{'\u2082'} | In mitochondria
          </div>

          {/* Cell visualization */}
          <div style={{
            position: 'relative',
            height: '200px',
            background: 'rgba(34,197,94,0.05)',
            borderRadius: '12px',
            border: '2px solid rgba(34,197,94,0.15)',
            overflow: 'hidden',
            marginBottom: '12px',
          }}>
            {/* Cell membrane label */}
            <div style={{ position: 'absolute', top: 4, left: 8, fontSize: '0.6rem', color: '#22c55e', fontWeight: 600 }}>
              CELL
            </div>

            {/* Mitochondria */}
            <div style={{
              position: 'absolute',
              right: '10%',
              top: '25%',
              width: '80px',
              height: '50px',
              borderRadius: '50%',
              border: '2px solid #22c55e',
              background: step >= 2 ? 'rgba(34,197,94,0.2)' : 'rgba(34,197,94,0.08)',
              transition: 'all 0.5s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: step >= 2 ? 'pulse 2s ease infinite' : 'none',
            }}>
              {/* Inner membrane folds (cristae) */}
              <svg width="60" height="30" viewBox="0 0 60 30" style={{ opacity: 0.5 }}>
                <path d="M10 5 Q15 15 10 25" stroke="#22c55e" fill="none" strokeWidth="1.5" />
                <path d="M25 5 Q30 15 25 25" stroke="#22c55e" fill="none" strokeWidth="1.5" />
                <path d="M40 5 Q45 15 40 25" stroke="#22c55e" fill="none" strokeWidth="1.5" />
              </svg>
            </div>
            <div style={{
              position: 'absolute',
              right: '8%',
              top: '76%',
              fontSize: '0.55rem',
              color: '#22c55e',
              fontWeight: 700,
              textAlign: 'center',
              width: '90px',
            }}>
              Mitochondria
            </div>

            {/* Glucose entering */}
            {step >= 0 && (
              <div className="molecule" style={{
                position: 'absolute',
                left: step >= 1 ? '30%' : '5%',
                top: '40%',
                background: 'rgba(251,191,36,0.2)',
                color: '#fbbf24',
                transition: 'left 1s ease',
                animationDelay: '0s',
              }}>
                C{'\u2086'}H{'\u2081\u2082'}O{'\u2086'}
              </div>
            )}

            {/* O2 entering */}
            {step >= 0 && (
              <div className="molecule" style={{
                position: 'absolute',
                left: step >= 2 ? '55%' : '5%',
                top: '15%',
                background: 'rgba(59,130,246,0.2)',
                color: '#60a5fa',
                transition: 'left 1s ease',
                animationDelay: '0.5s',
              }}>
                6O{'\u2082'}
              </div>
            )}

            {/* CO2 leaving */}
            {step >= 3 && (
              <div className="molecule" style={{
                position: 'absolute',
                right: '5%',
                top: '5%',
                background: 'rgba(148,163,184,0.2)',
                color: '#94a3b8',
                animation: 'moveRight 2s ease infinite',
              }}>
                6CO{'\u2082'} {'\u2191'}
              </div>
            )}

            {/* H2O leaving */}
            {step >= 3 && (
              <div className="molecule" style={{
                position: 'absolute',
                right: '5%',
                top: '85%',
                background: 'rgba(56,189,248,0.2)',
                color: '#38bdf8',
                animation: 'moveRight 2s ease infinite',
                animationDelay: '0.3s',
              }}>
                6H{'\u2082'}O
              </div>
            )}

            {/* ATP particles */}
            {step >= 3 && (
              <div style={{
                position: 'absolute',
                left: '30%',
                bottom: '8%',
                display: 'flex',
                gap: '3px',
                animation: 'fadeIn 0.5s ease',
              }}>
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#fbbf24',
                    animation: `pulse 1.5s ease infinite ${i * 0.1}s`,
                    boxShadow: '0 0 6px rgba(251,191,36,0.5)',
                  }} />
                ))}
              </div>
            )}
          </div>

          {/* Equation */}
          <div style={{
            background: 'rgba(34,197,94,0.1)',
            borderRadius: '8px',
            padding: '10px 12px',
            fontSize: '0.75rem',
            color: '#e2e8f0',
            textAlign: 'center',
            lineHeight: 1.8,
          }}>
            <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: '4px' }}>Chemical Equation</div>
            C{'\u2086'}H{'\u2081\u2082'}O{'\u2086'} + 6O{'\u2082'} {'\u2192'} 6CO{'\u2082'} + 6H{'\u2082'}O + <strong style={{ color: '#fbbf24' }}>38 ATP</strong>
          </div>
        </div>

        {/* Anaerobic panel */}
        <div className="panel-card" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
          <div style={{
            fontSize: '0.9rem',
            fontWeight: 800,
            color: '#ef4444',
            marginBottom: '10px',
            textAlign: 'center',
          }}>
            Anaerobic Respiration
          </div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', textAlign: 'center', marginBottom: '12px' }}>
            Occurs without O{'\u2082'} | In cytoplasm ({anaerobicMode === 'yeast' ? 'Yeast' : 'Muscle'})
          </div>

          {/* Cell visualization */}
          <div style={{
            position: 'relative',
            height: '200px',
            background: 'rgba(239,68,68,0.05)',
            borderRadius: '12px',
            border: '2px solid rgba(239,68,68,0.15)',
            overflow: 'hidden',
            marginBottom: '12px',
          }}>
            <div style={{ position: 'absolute', top: 4, left: 8, fontSize: '0.6rem', color: '#ef4444', fontWeight: 600 }}>
              {anaerobicMode === 'yeast' ? 'YEAST CELL' : 'MUSCLE CELL'}
            </div>

            {/* No mitochondria highlight — cytoplasm only */}
            <div style={{
              position: 'absolute',
              right: '10%',
              top: '25%',
              width: '80px',
              height: '50px',
              borderRadius: '50%',
              border: '2px dashed rgba(239,68,68,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <span style={{ fontSize: '0.5rem', color: '#64748b' }}>No O{'\u2082'}</span>
            </div>

            {/* Glucose entering */}
            {step >= 0 && (
              <div className="molecule" style={{
                position: 'absolute',
                left: step >= 1 ? '30%' : '5%',
                top: '40%',
                background: 'rgba(251,191,36,0.2)',
                color: '#fbbf24',
                transition: 'left 1s ease',
              }}>
                C{'\u2086'}H{'\u2081\u2082'}O{'\u2086'}
              </div>
            )}

            {/* Products */}
            {step >= 3 && anaerobicMode === 'yeast' && (
              <>
                <div className="molecule" style={{
                  position: 'absolute',
                  right: '5%',
                  top: '20%',
                  background: 'rgba(168,85,247,0.2)',
                  color: '#c084fc',
                  animation: 'moveRight 2s ease infinite',
                }}>
                  2C{'\u2082'}H{'\u2085'}OH
                </div>
                <div className="molecule" style={{
                  position: 'absolute',
                  right: '5%',
                  top: '5%',
                  background: 'rgba(148,163,184,0.2)',
                  color: '#94a3b8',
                  animation: 'moveRight 2s ease infinite',
                  animationDelay: '0.4s',
                }}>
                  2CO{'\u2082'} {'\u2191'}
                </div>
              </>
            )}

            {step >= 3 && anaerobicMode === 'muscle' && (
              <div className="molecule" style={{
                position: 'absolute',
                right: '5%',
                top: '20%',
                background: 'rgba(239,68,68,0.2)',
                color: '#fca5a5',
                animation: 'moveRight 2s ease infinite',
              }}>
                2C{'\u2083'}H{'\u2086'}O{'\u2083'}
              </div>
            )}

            {/* ATP particles (only 2) */}
            {step >= 3 && (
              <div style={{
                position: 'absolute',
                left: '30%',
                bottom: '8%',
                display: 'flex',
                gap: '6px',
                animation: 'fadeIn 0.5s ease',
              }}>
                {Array.from({ length: 2 }, (_, i) => (
                  <div key={i} style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#fbbf24',
                    animation: `pulse 1.5s ease infinite ${i * 0.15}s`,
                    boxShadow: '0 0 6px rgba(251,191,36,0.5)',
                  }} />
                ))}
              </div>
            )}

            {/* Lactic acid note */}
            {step >= 3 && anaerobicMode === 'muscle' && (
              <div style={{
                position: 'absolute',
                bottom: '8px',
                right: '8px',
                fontSize: '0.55rem',
                color: '#fca5a5',
                fontWeight: 600,
                animation: 'fadeIn 0.5s ease',
              }}>
                Causes muscle cramps!
              </div>
            )}
          </div>

          {/* Equation */}
          <div style={{
            background: 'rgba(239,68,68,0.1)',
            borderRadius: '8px',
            padding: '10px 12px',
            fontSize: '0.75rem',
            color: '#e2e8f0',
            textAlign: 'center',
            lineHeight: 1.8,
          }}>
            <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: '4px' }}>
              Chemical Equation ({anaerobicMode === 'yeast' ? 'Yeast' : 'Muscle'})
            </div>
            {anaerobicMode === 'yeast' ? (
              <>C{'\u2086'}H{'\u2081\u2082'}O{'\u2086'} {'\u2192'} 2C{'\u2082'}H{'\u2085'}OH + 2CO{'\u2082'} + <strong style={{ color: '#fbbf24' }}>2 ATP</strong></>
            ) : (
              <>C{'\u2086'}H{'\u2081\u2082'}O{'\u2086'} {'\u2192'} 2C{'\u2083'}H{'\u2086'}O{'\u2083'} + <strong style={{ color: '#fbbf24' }}>2 ATP</strong></>
            )}
          </div>
        </div>
      </div>

      {/* ATP Comparison Bar Chart */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto 16px',
        background: 'rgba(255,255,255,0.06)',
        borderRadius: '14px',
        padding: '16px',
        border: '1px solid rgba(255,255,255,0.1)',
      }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#fbbf24', marginBottom: '12px', textAlign: 'center' }}>
          Energy (ATP) Comparison
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '20px', justifyContent: 'center', height: '100px' }}>
          {/* Aerobic bar */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '60px',
              height: `${(38 / 38) * 80}px`,
              background: 'linear-gradient(180deg, #22c55e, #16a34a)',
              borderRadius: '6px 6px 0 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: step >= 3 ? 'glow 2s ease infinite' : 'none',
              transition: 'height 0.5s ease',
            }}>
              <span style={{ fontSize: '1rem', fontWeight: 800, color: '#fff' }}>38</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px', fontWeight: 600 }}>Aerobic</div>
          </div>
          {/* Anaerobic bar */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '60px',
              height: `${(2 / 38) * 80}px`,
              minHeight: '12px',
              background: 'linear-gradient(180deg, #ef4444, #dc2626)',
              borderRadius: '6px 6px 0 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'height 0.5s ease',
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fff' }}>2</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px', fontWeight: 600 }}>Anaerobic</div>
          </div>
        </div>
        <div style={{ textAlign: 'center', fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600, marginTop: '10px' }}>
          Aerobic respiration produces <strong>19 times</strong> more ATP than anaerobic!
        </div>
      </div>

      {/* Play/Pause control */}
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <button
          type="button"
          onClick={() => setIsPlaying(!isPlaying)}
          style={{
            background: isPlaying ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
            border: `1px solid ${isPlaying ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
            color: isPlaying ? '#fca5a5' : '#86efac',
            borderRadius: '10px',
            padding: '8px 24px',
            cursor: 'pointer',
            fontSize: '0.82rem',
            fontWeight: 700,
            minHeight: '44px',
            transition: 'all 0.2s ease',
          }}
          aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
        >
          {isPlaying ? 'Pause' : 'Play'} Animation
        </button>
      </div>

      {/* Key differences table */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto 16px',
        overflowX: 'auto',
      }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase' }}>
          Key Differences
        </div>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 'clamp(0.68rem, 1.5vw, 0.78rem)',
          minWidth: '400px',
        }}>
          <thead>
            <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.15)' }}>
              <th style={{ textAlign: 'left', padding: '8px', color: '#94a3b8' }}>Feature</th>
              <th style={{ textAlign: 'center', padding: '8px', color: '#22c55e' }}>Aerobic</th>
              <th style={{ textAlign: 'center', padding: '8px', color: '#ef4444' }}>Anaerobic</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Oxygen', 'Required', 'Not required'],
              ['Location', 'Mitochondria', 'Cytoplasm'],
              ['ATP produced', '38 ATP', '2 ATP'],
              ['End products', 'CO\u2082 + H\u2082O', anaerobicMode === 'yeast' ? 'Ethanol + CO\u2082' : 'Lactic acid'],
              ['Complete breakdown?', 'Yes', 'No (partial)'],
              ['Organisms', 'Most living organisms', anaerobicMode === 'yeast' ? 'Yeast, bacteria' : 'Muscle cells (during exercise)'],
            ].map(([feature, aerobic, anaerobic], idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <td style={{ padding: '6px 8px', fontWeight: 600 }}>{feature}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: '#86efac' }}>{aerobic}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: '#fca5a5' }}>{anaerobic}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div style={{
        textAlign: 'center',
        marginTop: '16px',
        fontSize: '0.7rem',
        color: '#475569',
      }}>
        CBSE Class 10 Biology &mdash; Ch 6: Life Processes
      </div>
    </div>
  );
}
