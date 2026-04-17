'use client';

import React, { useState, useCallback } from 'react';

interface Substance {
  name: string;
  pH: number;
  emoji: string;
}

const SUBSTANCES: Substance[] = [
  { name: 'Battery Acid', pH: 0.5, emoji: '🔋' },
  { name: 'Stomach Acid', pH: 1.5, emoji: '🫁' },
  { name: 'Lemon Juice', pH: 2, emoji: '🍋' },
  { name: 'Vinegar', pH: 3, emoji: '🫗' },
  { name: 'Coffee', pH: 5, emoji: '☕' },
  { name: 'Milk', pH: 6.5, emoji: '🥛' },
  { name: 'Water', pH: 7, emoji: '💧' },
  { name: 'Blood', pH: 7.4, emoji: '🩸' },
  { name: 'Baking Soda', pH: 8.5, emoji: '🧁' },
  { name: 'Soap', pH: 10, emoji: '🧼' },
  { name: 'Ammonia', pH: 11.5, emoji: '🧪' },
  { name: 'Bleach', pH: 13, emoji: '🧴' },
];

function getPhColor(pH: number): string {
  if (pH <= 0) return 'hsl(0, 90%, 45%)';
  if (pH <= 1) return 'hsl(0, 85%, 50%)';
  if (pH <= 2) return 'hsl(10, 85%, 50%)';
  if (pH <= 3) return 'hsl(25, 90%, 50%)';
  if (pH <= 4) return 'hsl(40, 95%, 50%)';
  if (pH <= 5) return 'hsl(50, 95%, 50%)';
  if (pH <= 6) return 'hsl(60, 90%, 48%)';
  if (pH <= 7) return 'hsl(120, 50%, 45%)';
  if (pH <= 8) return 'hsl(150, 50%, 45%)';
  if (pH <= 9) return 'hsl(180, 55%, 45%)';
  if (pH <= 10) return 'hsl(210, 65%, 50%)';
  if (pH <= 11) return 'hsl(230, 60%, 50%)';
  if (pH <= 12) return 'hsl(260, 55%, 50%)';
  if (pH <= 13) return 'hsl(280, 50%, 45%)';
  return 'hsl(290, 50%, 40%)';
}

function getClassification(pH: number): { label: string; color: string } {
  if (pH < 3) return { label: 'Strong Acid', color: '#ef4444' };
  if (pH < 7) return { label: 'Weak Acid', color: '#f97316' };
  if (pH === 7) return { label: 'Neutral', color: '#22c55e' };
  if (pH <= 7.5 && pH > 7) return { label: 'Neutral', color: '#22c55e' };
  if (pH < 11) return { label: 'Weak Base', color: '#3b82f6' };
  return { label: 'Strong Base', color: '#8b5cf6' };
}

function getLitmusResult(pH: number): { red: string; blue: string } {
  if (pH < 7) {
    return {
      red: 'Red litmus → stays red',
      blue: 'Blue litmus → turns red',
    };
  }
  if (pH > 7) {
    return {
      red: 'Red litmus → turns blue',
      blue: 'Blue litmus → stays blue',
    };
  }
  return {
    red: 'Red litmus → stays red',
    blue: 'Blue litmus → stays blue',
  };
}

function getUniversalIndicatorColor(pH: number): string {
  if (pH < 2) return '#ff1a1a';
  if (pH < 4) return '#ff8c1a';
  if (pH < 6) return '#e6e600';
  if (pH < 7.5) return '#33cc33';
  if (pH < 9) return '#1a8cff';
  if (pH < 11) return '#4d4dff';
  return '#7a1aff';
}

export default function PHScale() {
  const [selected, setSelected] = useState<Substance | null>(null);

  const handleSelect = useCallback((substance: Substance) => {
    setSelected(substance);
  }, []);

  const phColor = selected ? getPhColor(selected.pH) : 'hsl(200, 30%, 70%)';
  const classification = selected ? getClassification(selected.pH) : null;
  const litmus = selected ? getLitmusResult(selected.pH) : null;
  const indicatorColor = selected ? getUniversalIndicatorColor(selected.pH) : '#ccc';
  const markerPercent = selected ? (selected.pH / 14) * 100 : -5;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      padding: '20px',
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      color: '#f1f5f9',
      borderRadius: '16px',
    }}>
      <style>{`
        @keyframes bubbleRise {
          0% { transform: translateY(0) scale(1); opacity: 0.7; }
          50% { opacity: 0.5; }
          100% { transform: translateY(-120px) scale(0.3); opacity: 0; }
        }
        @keyframes liquidWave {
          0% { d: path("M 0 10 Q 25 5 50 10 Q 75 15 100 10 L 100 60 L 0 60 Z"); }
          50% { d: path("M 0 10 Q 25 15 50 10 Q 75 5 100 10 L 100 60 L 0 60 Z"); }
          100% { d: path("M 0 10 Q 25 5 50 10 Q 75 15 100 10 L 100 60 L 0 60 Z"); }
        }
        @keyframes pulseGlow {
          0%, 100% { filter: brightness(1); }
          50% { filter: brightness(1.2); }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .substance-btn {
          background: rgba(255,255,255,0.08);
          border: 2px solid rgba(255,255,255,0.12);
          border-radius: 16px;
          padding: 12px 8px;
          cursor: pointer;
          transition: all 0.25s ease;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          color: #e2e8f0;
          min-width: 0;
        }
        .substance-btn:hover {
          background: rgba(255,255,255,0.15);
          border-color: rgba(255,255,255,0.3);
          transform: translateY(-3px) scale(1.03);
          box-shadow: 0 8px 25px rgba(0,0,0,0.3);
        }
        .substance-btn.active {
          border-color: rgba(255,255,255,0.6);
          background: rgba(255,255,255,0.18);
          box-shadow: 0 0 20px rgba(255,255,255,0.15);
        }
        .bubble {
          position: absolute;
          border-radius: 50%;
          background: rgba(255,255,255,0.25);
          animation: bubbleRise linear infinite;
        }
        .info-card {
          animation: fadeSlideIn 0.3s ease;
        }
      `}</style>

      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <h1 style={{
          fontSize: 'clamp(1.5rem, 4vw, 2.2rem)',
          fontWeight: 800,
          margin: 0,
          background: 'linear-gradient(90deg, #ff6b6b, #ffd93d, #6bcb77, #4d96ff, #9b59b6)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.5px',
        }}>
          pH Scale Explorer
        </h1>
        <p style={{
          margin: '6px 0 0',
          fontSize: 'clamp(0.85rem, 2vw, 1rem)',
          color: '#94a3b8',
        }}>
          Click a substance to explore acids, bases & neutral solutions!
        </p>
      </div>

      {/* pH Scale Bar */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto 28px',
        position: 'relative',
        padding: '0 10px',
      }}>
        <div style={{
          height: '40px',
          borderRadius: '20px',
          background: 'linear-gradient(to right, #ff0000, #ff4400, #ff8800, #ffcc00, #ffff00, #aaff00, #00cc44, #00aa88, #0088cc, #0044ff, #2200ff, #6600cc, #8800aa, #990088, #880077)',
          position: 'relative',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4), inset 0 2px 4px rgba(255,255,255,0.15)',
          overflow: 'visible',
        }}>
          {/* pH number labels */}
          {Array.from({ length: 15 }, (_, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${(i / 14) * 100}%`,
              top: '100%',
              transform: 'translateX(-50%)',
              marginTop: '6px',
              fontSize: 'clamp(0.6rem, 1.5vw, 0.8rem)',
              fontWeight: 700,
              color: '#94a3b8',
            }}>
              {i}
            </div>
          ))}

          {/* Animated marker */}
          {selected && (
            <div style={{
              position: 'absolute',
              left: `${markerPercent}%`,
              top: '-10px',
              transform: 'translateX(-50%)',
              transition: 'left 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
              zIndex: 10,
            }}>
              <div style={{
                width: '0',
                height: '0',
                borderLeft: '10px solid transparent',
                borderRight: '10px solid transparent',
                borderTop: '14px solid #ffffff',
                filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))',
              }} />
              <div style={{
                position: 'absolute',
                top: '-28px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#ffffff',
                color: '#0f172a',
                borderRadius: '8px',
                padding: '2px 8px',
                fontSize: '0.75rem',
                fontWeight: 800,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}>
                {selected.pH}
              </div>
            </div>
          )}
        </div>

        {/* Scale category labels */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '28px',
          fontSize: 'clamp(0.55rem, 1.4vw, 0.75rem)',
          fontWeight: 600,
        }}>
          <span style={{ color: '#ef4444', textAlign: 'center', flex: 1 }}>Strong Acid</span>
          <span style={{ color: '#f97316', textAlign: 'center', flex: 1 }}>Weak Acid</span>
          <span style={{ color: '#22c55e', textAlign: 'center', flex: 1 }}>Neutral</span>
          <span style={{ color: '#3b82f6', textAlign: 'center', flex: 1 }}>Weak Base</span>
          <span style={{ color: '#8b5cf6', textAlign: 'center', flex: 1 }}>Strong Base</span>
        </div>
      </div>

      {/* Main content: Beaker + Info */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto 28px',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '20px',
        justifyContent: 'center',
        alignItems: 'flex-start',
      }}>
        {/* Beaker */}
        <div style={{
          width: '180px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}>
          <div style={{
            width: '140px',
            height: '180px',
            position: 'relative',
            borderRadius: '0 0 20px 20px',
            border: '4px solid rgba(255,255,255,0.3)',
            borderTop: 'none',
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.05)',
          }}>
            {/* Liquid fill */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: selected ? '70%' : '40%',
              background: phColor,
              transition: 'background 0.6s ease, height 0.4s ease',
              animation: 'pulseGlow 3s ease infinite',
            }}>
              {/* Liquid surface wave SVG */}
              <svg viewBox="0 0 100 20" preserveAspectRatio="none" style={{
                position: 'absolute',
                top: '-10px',
                left: 0,
                width: '100%',
                height: '20px',
              }}>
                <path
                  d="M 0 10 Q 25 5 50 10 Q 75 15 100 10 L 100 20 L 0 20 Z"
                  fill={phColor}
                  style={{ transition: 'fill 0.6s ease' }}
                >
                  <animate
                    attributeName="d"
                    dur="2s"
                    repeatCount="indefinite"
                    values="
                      M 0 10 Q 25 4 50 10 Q 75 16 100 10 L 100 20 L 0 20 Z;
                      M 0 10 Q 25 16 50 10 Q 75 4 100 10 L 100 20 L 0 20 Z;
                      M 0 10 Q 25 4 50 10 Q 75 16 100 10 L 100 20 L 0 20 Z
                    "
                  />
                </path>
              </svg>

              {/* Bubbles */}
              {selected && (
                <>
                  <div className="bubble" style={{ width: 6, height: 6, left: '20%', bottom: '10%', animationDuration: '2.5s', animationDelay: '0s' }} />
                  <div className="bubble" style={{ width: 8, height: 8, left: '55%', bottom: '5%', animationDuration: '3s', animationDelay: '0.8s' }} />
                  <div className="bubble" style={{ width: 5, height: 5, left: '75%', bottom: '15%', animationDuration: '2.8s', animationDelay: '1.5s' }} />
                  <div className="bubble" style={{ width: 7, height: 7, left: '35%', bottom: '8%', animationDuration: '3.2s', animationDelay: '0.3s' }} />
                  <div className="bubble" style={{ width: 4, height: 4, left: '65%', bottom: '20%', animationDuration: '2.2s', animationDelay: '2s' }} />
                </>
              )}
            </div>

            {/* Beaker rim */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: '-8px',
              right: '-8px',
              height: '6px',
              background: 'rgba(255,255,255,0.25)',
              borderRadius: '3px',
            }} />
          </div>
          {selected && (
            <div style={{
              marginTop: '10px',
              fontSize: '1.6rem',
              textAlign: 'center',
            }}>
              {selected.emoji}
            </div>
          )}
        </div>

        {/* Info Panel */}
        {selected && (
          <div className="info-card" style={{
            flex: '1 1 280px',
            maxWidth: '400px',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: '20px',
            padding: '20px',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}>
            <h2 style={{
              margin: '0 0 4px',
              fontSize: 'clamp(1.1rem, 3vw, 1.4rem)',
              fontWeight: 700,
            }}>
              {selected.emoji} {selected.name}
            </h2>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', margin: '12px 0' }}>
              <span style={{
                display: 'inline-block',
                background: phColor,
                color: '#fff',
                borderRadius: '12px',
                padding: '4px 14px',
                fontSize: '0.95rem',
                fontWeight: 700,
                textShadow: '0 1px 3px rgba(0,0,0,0.4)',
              }}>
                pH {selected.pH}
              </span>
              {classification && (
                <span style={{
                  display: 'inline-block',
                  background: classification.color,
                  color: '#fff',
                  borderRadius: '12px',
                  padding: '4px 14px',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                }}>
                  {classification.label}
                </span>
              )}
            </div>

            {/* Litmus Paper Results */}
            {litmus && (
              <div style={{
                background: 'rgba(0,0,0,0.2)',
                borderRadius: '12px',
                padding: '12px 14px',
                marginBottom: '12px',
              }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '8px', color: '#cbd5e1' }}>
                  LITMUS PAPER TEST
                </div>
                <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '24px',
                      height: '14px',
                      borderRadius: '3px',
                      background: selected.pH < 7 ? '#dc2626' : '#3b82f6',
                      transition: 'background 0.4s ease',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }} />
                    <span style={{ color: '#e2e8f0' }}>{litmus.red}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      width: '24px',
                      height: '14px',
                      borderRadius: '3px',
                      background: selected.pH > 7 ? '#3b82f6' : '#dc2626',
                      transition: 'background 0.4s ease',
                      border: '1px solid rgba(255,255,255,0.2)',
                    }} />
                    <span style={{ color: '#e2e8f0' }}>{litmus.blue}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Universal Indicator */}
            <div style={{
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '12px',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '8px', color: '#cbd5e1' }}>
                UNIVERSAL INDICATOR
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: indicatorColor,
                  transition: 'background 0.5s ease',
                  boxShadow: `0 0 16px ${indicatorColor}80`,
                  border: '2px solid rgba(255,255,255,0.2)',
                }} />
                <span style={{ fontSize: '0.85rem', color: '#e2e8f0' }}>
                  Turns <strong style={{ color: indicatorColor, transition: 'color 0.5s ease' }}>
                    {selected.pH < 3 ? 'Red' : selected.pH < 5 ? 'Orange' : selected.pH < 7 ? 'Yellow' : selected.pH < 8 ? 'Green' : selected.pH < 10 ? 'Blue' : selected.pH < 12 ? 'Dark Blue' : 'Violet'}
                  </strong>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Placeholder when nothing selected */}
        {!selected && (
          <div style={{
            flex: '1 1 280px',
            maxWidth: '400px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '20px',
            padding: '32px 20px',
            border: '2px dashed rgba(255,255,255,0.15)',
            textAlign: 'center',
            color: '#64748b',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>🧪</div>
            <div style={{ fontSize: '1rem', fontWeight: 600 }}>Select a substance below</div>
            <div style={{ fontSize: '0.85rem', marginTop: '4px' }}>to see its pH and properties!</div>
          </div>
        )}
      </div>

      {/* Substance Buttons Grid */}
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
          gap: '10px',
        }}>
          {SUBSTANCES.map((substance) => (
            <button
              key={substance.name}
              className={`substance-btn ${selected?.name === substance.name ? 'active' : ''}`}
              onClick={() => handleSelect(substance)}
              type="button"
              aria-label={`Select ${substance.name}, pH ${substance.pH}`}
            >
              <span style={{ fontSize: '1.6rem', lineHeight: 1 }}>{substance.emoji}</span>
              <span style={{
                fontSize: 'clamp(0.7rem, 1.8vw, 0.82rem)',
                fontWeight: 600,
                lineHeight: 1.2,
                textAlign: 'center',
              }}>
                {substance.name}
              </span>
              <span style={{
                fontSize: '0.7rem',
                color: '#94a3b8',
                fontWeight: 500,
              }}>
                pH {substance.pH}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <div style={{
        textAlign: 'center',
        marginTop: '24px',
        fontSize: '0.75rem',
        color: '#475569',
      }}>
        CBSE Class 10 Chemistry — Acids, Bases and Salts
      </div>
    </div>
  );
}
