import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════
// 🦊 FOXY — THE ALFANUMRIK INTELLIGENT GUIDE & ADVISOR
// The MOAT: AI Tutor managing ALL student tasks under one chat interface
// Connects to Supabase: curriculum_topics, question_bank, learning_graph,
// concept_mastery, chat_sessions, student_learning_profiles, RAG content
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://dxipobqngyfpqbbznojz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE1ODQ1MDcsImV4cCI6MjA1NzE2MDUwN30.CZJH4VPQa6MHmYkXXxnEFPkfGhJnBPqMlG3MwjUe3tE";

// Subject configuration with mathematical/scientific symbols
const SUBJECT_CONFIG = {
  math: {
    name: "Mathematics", nameHi: "गणित", icon: "∑", color: "#3B82F6",
    symbols: ["∫","∂","√","π","∞","≈","≠","≤","≥","Δ","θ","α","β","∈","∅","∪","∩","⊂","→","⇒","∀","∃","±","÷","×","²","³","ⁿ","₁","₂"],
    quickTools: ["Calculator","Graph Plotter","Formula Sheet","Geometry Kit"]
  },
  science: {
    name: "Science", nameHi: "विज्ञान", icon: "⚛", color: "#10B981",
    symbols: ["⚗","🧪","⚡","℃","Ω","μ","λ","Å","→","⇌","↑","↓","Δ","∝","≡","mol","pH","atm","Pa","Hz","eV","nm","kg","m/s","N","J","W","V","A"],
    quickTools: ["Periodic Table","Unit Converter","Lab Simulator","Diagram Tool"]
  },
  english: {
    name: "English", nameHi: "अंग्रेज़ी", icon: "📖", color: "#8B5CF6",
    symbols: ['"','"',"'","'","—","–","…","©","®","™","¶","§","†","‡","•","·","«","»","‹","›","'","'",""",""","⁰","¹","²","³","⁴"],
    quickTools: ["Dictionary","Grammar Check","Essay Outline","Reading Log"]
  },
  hindi: {
    name: "हिन्दी", nameHi: "हिन्दी", icon: "अ", color: "#F59E0B",
    symbols: ["।","॥","ँ","ं","ः","ऽ","्","ॐ","₹","॰","꣸","꣹","꣺","ॲ","ऑ","ॅ","ॄ","ॣ","ॢ","़"],
    quickTools: ["शब्दकोश","व्याकरण","निबंध","कविता"]
  },
  physics: {
    name: "Physics", nameHi: "भौतिक विज्ञान", icon: "⚡", color: "#EF4444",
    symbols: ["F","m","a","v","t","s","ω","τ","ρ","σ","ε","μ","λ","ν","Φ","Ψ","∇","∂","∫","Σ","Δ","→","⊥","∥","≈","∝","ℏ","eV","Å"],
    quickTools: ["Formula Reference","Vector Visualizer","Circuit Builder","Motion Graphs"]
  },
  chemistry: {
    name: "Chemistry", nameHi: "रसायन विज्ञान", icon: "⚗", color: "#06B6D4",
    symbols: ["→","⇌","↑","↓","Δ","°","⁺","⁻","²⁺","³⁺","²⁻","·","≡","⊕","⊖","mol","aq","(s)","(l)","(g)","pH","Kₐ","Kᵦ","Kₛₚ","ΔH","ΔG","ΔS"],
    quickTools: ["Periodic Table","Equation Balancer","Molarity Calc","VSEPR Shapes"]
  },
  biology: {
    name: "Biology", nameHi: "जीव विज्ञान", icon: "🧬", color: "#22C55E",
    symbols: ["♂","♀","×","→","⇒","≈","μm","nm","ATP","DNA","RNA","mRNA","tRNA","rRNA","CO₂","O₂","H₂O","C₆H₁₂O₆","N₂","NH₃"],
    quickTools: ["Cell Diagram","Taxonomy Tree","Body Systems","Genetics Calc"]
  }
};

const LANGUAGES = [
  { code: "en", label: "English", flag: "🇬🇧" },
  { code: "hi", label: "हिन्दी", flag: "🇮🇳" },
  { code: "hinglish", label: "Hinglish", flag: "🇮🇳" },
  { code: "ta", label: "தமிழ்", flag: "🇮🇳" },
  { code: "te", label: "తెలుగు", flag: "🇮🇳" },
  { code: "bn", label: "বাংলা", flag: "🇮🇳" },
];

const SESSION_MODES = [
  { id: "learn", icon: "📚", label: "Learn", labelHi: "सीखो", color: "#3B82F6", desc: "Guided lesson with Foxy" },
  { id: "practice", icon: "✏️", label: "Practice", labelHi: "अभ्यास", color: "#10B981", desc: "Adaptive practice questions" },
  { id: "quiz", icon: "🎯", label: "Quiz", labelHi: "क्विज़", color: "#F59E0B", desc: "Timed assessment" },
  { id: "doubt", icon: "❓", label: "Doubt", labelHi: "संदेह", color: "#8B5CF6", desc: "Ask anything" },
  { id: "revision", icon: "🔄", label: "Revise", labelHi: "दोहराओ", color: "#EF4444", desc: "Spaced repetition review" },
  { id: "notes", icon: "📝", label: "Notes", labelHi: "नोट्स", color: "#06B6D4", desc: "Smart note-taking" },
];

// Foxy expressions based on context
const FOXY_STATES = {
  idle: "🦊", thinking: "🤔", happy: "😄", teaching: "📖",
  celebrating: "🎉", encouraging: "💪", pointing: "👉", warning: "⚠️"
};

// ── Supabase helper ──
async function supaFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...options.headers,
    },
    method: options.method || "GET",
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) return null;
  return res.json();
}

async function callFoxyTutor(payload) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/foxy-tutor`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { reply: "Oops! Foxy is taking a nap 😴 Try again!", error: true };
  return res.json();
}

// ── Rich Content Renderer ──
function RichContent({ content, subject }) {
  const cfg = SUBJECT_CONFIG[subject] || SUBJECT_CONFIG.science;
  
  // Parse structured content blocks
  const renderBlock = (text, idx) => {
    // Detect formulas: $...$
    if (text.match(/\$(.+?)\$/g)) {
      const parts = text.split(/(\$[^$]+\$)/g);
      return (
        <span key={idx}>
          {parts.map((p, i) =>
            p.startsWith("$") && p.endsWith("$") ? (
              <code key={i} style={{
                background: `${cfg.color}15`,
                color: cfg.color,
                padding: "2px 8px",
                borderRadius: 6,
                fontFamily: "'Fira Code', monospace",
                fontSize: 14,
                border: `1px solid ${cfg.color}30`,
              }}>{p.slice(1, -1)}</code>
            ) : p
          )}
        </span>
      );
    }
    return <span key={idx}>{text}</span>;
  };

  // Split content into structured sections
  const lines = content.split("\n");
  const elements = [];
  let currentList = [];
  let listType = null;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <div key={`list-${elements.length}`} style={{
          margin: "12px 0",
          padding: "12px 16px",
          background: `linear-gradient(135deg, ${cfg.color}08, ${cfg.color}04)`,
          borderLeft: `3px solid ${cfg.color}`,
          borderRadius: "0 12px 12px 0",
        }}>
          {currentList.map((item, i) => (
            <div key={i} style={{
              display: "flex",
              gap: 10,
              padding: "6px 0",
              alignItems: "flex-start",
              borderBottom: i < currentList.length - 1 ? "1px solid #f0f0f0" : "none",
            }}>
              <span style={{
                minWidth: 24, height: 24,
                borderRadius: "50%",
                background: `${cfg.color}20`,
                color: cfg.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                marginTop: 2,
              }}>
                {listType === "numbered" ? i + 1 : "•"}
              </span>
              <span style={{ lineHeight: 1.6 }}>{renderBlock(item, i)}</span>
            </div>
          ))}
        </div>
      );
      currentList = [];
      listType = null;
    }
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    
    // Headers
    if (trimmed.startsWith("###")) {
      flushList();
      elements.push(
        <h4 key={idx} style={{
          fontSize: 14, fontWeight: 700, color: cfg.color,
          margin: "16px 0 8px", display: "flex", alignItems: "center", gap: 8,
          textTransform: "uppercase", letterSpacing: 1,
        }}>
          <span style={{ fontSize: 18 }}>{cfg.icon}</span> {trimmed.replace(/^###\s*/, "")}
        </h4>
      );
    } else if (trimmed.startsWith("##")) {
      flushList();
      elements.push(
        <h3 key={idx} style={{
          fontSize: 16, fontWeight: 700, color: "#1a1a2e",
          margin: "18px 0 10px", paddingBottom: 8,
          borderBottom: `2px solid ${cfg.color}30`,
        }}>{trimmed.replace(/^##\s*/, "")}</h3>
      );
    }
    // Callout boxes: > ...
    else if (trimmed.startsWith(">")) {
      flushList();
      const isImportant = trimmed.includes("⚠") || trimmed.toLowerCase().includes("important");
      const isTip = trimmed.includes("💡") || trimmed.toLowerCase().includes("tip");
      const boxColor = isImportant ? "#EF4444" : isTip ? "#F59E0B" : cfg.color;
      elements.push(
        <div key={idx} style={{
          margin: "12px 0",
          padding: "14px 16px",
          background: `${boxColor}08`,
          border: `1px solid ${boxColor}25`,
          borderRadius: 12,
          fontSize: 14,
          lineHeight: 1.7,
          position: "relative",
        }}>
          <div style={{
            position: "absolute", top: -10, left: 16,
            background: "#fff", padding: "0 8px",
            fontSize: 11, fontWeight: 700, color: boxColor,
            textTransform: "uppercase", letterSpacing: 1,
          }}>
            {isImportant ? "⚠️ Important" : isTip ? "💡 Tip" : "📌 Note"}
          </div>
          {renderBlock(trimmed.replace(/^>\s*/, ""), idx)}
        </div>
      );
    }
    // Numbered lists
    else if (trimmed.match(/^\d+[\.\)]\s/)) {
      if (listType !== "numbered") { flushList(); listType = "numbered"; }
      currentList.push(trimmed.replace(/^\d+[\.\)]\s*/, ""));
    }
    // Bullet lists
    else if (trimmed.match(/^[-•*]\s/)) {
      if (listType !== "bullet") { flushList(); listType = "bullet"; }
      currentList.push(trimmed.replace(/^[-•*]\s*/, ""));
    }
    // Code blocks
    else if (trimmed.startsWith("```")) {
      flushList();
      // skip code fence markers
    }
    // Bold text: **...**
    else if (trimmed.match(/\*\*(.+?)\*\*/)) {
      flushList();
      const parts = trimmed.split(/(\*\*[^*]+\*\*)/g);
      elements.push(
        <p key={idx} style={{ margin: "8px 0", lineHeight: 1.7 }}>
          {parts.map((p, i) =>
            p.startsWith("**") && p.endsWith("**")
              ? <strong key={i} style={{ color: "#1a1a2e", fontWeight: 700 }}>{p.slice(2, -2)}</strong>
              : renderBlock(p, i)
          )}
        </p>
      );
    }
    // Empty lines
    else if (!trimmed) {
      flushList();
      elements.push(<div key={idx} style={{ height: 8 }} />);
    }
    // Regular paragraph
    else {
      flushList();
      elements.push(
        <p key={idx} style={{ margin: "6px 0", lineHeight: 1.75, color: "#374151" }}>
          {renderBlock(trimmed, idx)}
        </p>
      );
    }
  });
  flushList();

  return <div>{elements}</div>;
}

// ── Structured Answer Input ──
function StructuredAnswerInput({ onSubmit, subject, mode }) {
  const [points, setPoints] = useState([""]);
  const [answerMode, setAnswerMode] = useState("free"); // free | points | mcq
  const cfg = SUBJECT_CONFIG[subject] || SUBJECT_CONFIG.science;
  const [showSymbols, setShowSymbols] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const textareaRef = useRef(null);
  const [activePointIdx, setActivePointIdx] = useState(0);

  const insertSymbol = (sym) => {
    if (answerMode === "points") {
      const updated = [...points];
      updated[activePointIdx] = (updated[activePointIdx] || "") + sym;
      setPoints(updated);
    } else if (textareaRef.current) {
      const ta = textareaRef.current;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;
      ta.value = val.substring(0, start) + sym + val.substring(end);
      ta.selectionStart = ta.selectionEnd = start + sym.length;
      ta.focus();
    }
  };

  const addPoint = () => setPoints([...points, ""]);
  const removePoint = (idx) => {
    if (points.length > 1) setPoints(points.filter((_, i) => i !== idx));
  };
  const updatePoint = (idx, val) => {
    const updated = [...points];
    updated[idx] = val;
    setPoints(updated);
  };

  const handleSubmit = () => {
    if (answerMode === "points") {
      const filled = points.filter(p => p.trim());
      if (filled.length === 0) return;
      const formatted = filled.map((p, i) => `${i + 1}. ${p}`).join("\n");
      onSubmit(formatted);
      setPoints([""]);
    } else {
      const val = textareaRef.current?.value?.trim();
      if (!val) return;
      onSubmit(val);
      textareaRef.current.value = "";
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && answerMode === "free") {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Enter" && answerMode === "points") {
      e.preventDefault();
      addPoint();
    }
  };

  return (
    <div style={{
      padding: "16px 20px",
      background: "#fff",
      borderTop: "1px solid #e5e7eb",
      position: "relative",
    }}>
      {/* Mode Switcher */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 10,
        flexWrap: "wrap", alignItems: "center",
      }}>
        <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
          Answer Mode:
        </span>
        {[
          { id: "free", icon: "💬", label: "Free Text" },
          { id: "points", icon: "📋", label: "Point-wise" },
        ].map(m => (
          <button key={m.id} onClick={() => setAnswerMode(m.id)} style={{
            padding: "4px 12px",
            borderRadius: 20,
            border: answerMode === m.id ? `2px solid ${cfg.color}` : "1px solid #e5e7eb",
            background: answerMode === m.id ? `${cfg.color}10` : "#fff",
            color: answerMode === m.id ? cfg.color : "#6b7280",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "all 0.2s",
          }}>
            {m.icon} {m.label}
          </button>
        ))}
        
        {/* Symbol Palette Toggle */}
        <button onClick={() => setShowSymbols(!showSymbols)} style={{
          marginLeft: "auto",
          padding: "4px 12px",
          borderRadius: 20,
          border: showSymbols ? `2px solid ${cfg.color}` : "1px solid #e5e7eb",
          background: showSymbols ? `${cfg.color}10` : "#fff",
          color: showSymbols ? cfg.color : "#6b7280",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.2s",
        }}>
          {cfg.icon} Symbols
        </button>
        
        {/* Quick Tools Toggle */}
        <button onClick={() => setShowTools(!showTools)} style={{
          padding: "4px 12px",
          borderRadius: 20,
          border: showTools ? `2px solid ${cfg.color}` : "1px solid #e5e7eb",
          background: showTools ? `${cfg.color}10` : "#fff",
          color: showTools ? cfg.color : "#6b7280",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          transition: "all 0.2s",
        }}>
          🛠️ Tools
        </button>
      </div>

      {/* Symbol Palette */}
      {showSymbols && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: "10px 12px",
          background: `linear-gradient(135deg, ${cfg.color}05, ${cfg.color}10)`,
          borderRadius: 12,
          marginBottom: 10,
          border: `1px solid ${cfg.color}20`,
          maxHeight: 120,
          overflowY: "auto",
        }}>
          {cfg.symbols.map((sym, i) => (
            <button key={i} onClick={() => insertSymbol(sym)} style={{
              width: 36, height: 36,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#fff",
              cursor: "pointer",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.15s",
              fontFamily: "'Fira Code', monospace",
            }}
            onMouseEnter={e => {
              e.target.style.background = `${cfg.color}15`;
              e.target.style.borderColor = cfg.color;
              e.target.style.transform = "scale(1.15)";
            }}
            onMouseLeave={e => {
              e.target.style.background = "#fff";
              e.target.style.borderColor = "#e5e7eb";
              e.target.style.transform = "scale(1)";
            }}>
              {sym}
            </button>
          ))}
        </div>
      )}

      {/* Quick Tools */}
      {showTools && (
        <div style={{
          display: "flex",
          gap: 8,
          padding: "10px 0",
          marginBottom: 10,
          flexWrap: "wrap",
        }}>
          {cfg.quickTools.map((tool, i) => (
            <button key={i} onClick={() => onSubmit(`/tool ${tool}`)} style={{
              padding: "8px 16px",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "linear-gradient(135deg, #f9fafb, #fff)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              color: "#374151",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.2s",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
            onMouseEnter={e => {
              e.target.style.borderColor = cfg.color;
              e.target.style.boxShadow = `0 2px 8px ${cfg.color}20`;
            }}
            onMouseLeave={e => {
              e.target.style.borderColor = "#e5e7eb";
              e.target.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
            }}>
              🛠️ {tool}
            </button>
          ))}
        </div>
      )}

      {/* Input Area */}
      {answerMode === "points" ? (
        <div style={{ marginBottom: 10 }}>
          {points.map((point, idx) => (
            <div key={idx} style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 6,
              animation: "fadeInUp 0.2s ease",
            }}>
              <span style={{
                minWidth: 28, height: 28,
                borderRadius: "50%",
                background: point.trim() ? `${cfg.color}20` : "#f3f4f6",
                color: point.trim() ? cfg.color : "#9ca3af",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                transition: "all 0.2s",
              }}>
                {idx + 1}
              </span>
              <input
                value={point}
                onChange={e => updatePoint(idx, e.target.value)}
                onFocus={() => setActivePointIdx(idx)}
                onKeyDown={handleKeyDown}
                placeholder={`Point ${idx + 1}...`}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  fontSize: 14,
                  outline: "none",
                  transition: "all 0.2s",
                  fontFamily: "'Nunito', sans-serif",
                }}
                onFocuCapture={e => e.target.style.borderColor = cfg.color}
              />
              {points.length > 1 && (
                <button onClick={() => removePoint(idx)} style={{
                  width: 28, height: 28,
                  borderRadius: "50%",
                  border: "1px solid #fecaca",
                  background: "#fef2f2",
                  color: "#ef4444",
                  cursor: "pointer",
                  fontSize: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>×</button>
              )}
            </div>
          ))}
          <button onClick={addPoint} style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: `1px dashed ${cfg.color}40`,
            background: "transparent",
            color: cfg.color,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            marginTop: 4,
          }}>+ Add Point</button>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer or ask Foxy... (Shift+Enter for new line)"
          rows={2}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            fontSize: 14,
            outline: "none",
            resize: "vertical",
            fontFamily: "'Nunito', sans-serif",
            lineHeight: 1.6,
            marginBottom: 10,
            boxSizing: "border-box",
            transition: "border-color 0.2s",
          }}
        />
      )}

      {/* Send Button */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button onClick={handleSubmit} style={{
          padding: "10px 24px",
          borderRadius: 12,
          border: "none",
          background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}dd)`,
          color: "#fff",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          transition: "all 0.2s",
          boxShadow: `0 4px 12px ${cfg.color}30`,
          fontFamily: "'Nunito', sans-serif",
        }}
        onMouseEnter={e => e.target.style.transform = "translateY(-1px)"}
        onMouseLeave={e => e.target.style.transform = "translateY(0)"}>
          🦊 Send to Foxy
        </button>
      </div>
    </div>
  );
}

// ── Mastery Ring Component ──
function MasteryRing({ value, size = 60, color, label }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  
  return (
    <div style={{ textAlign: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke="#f3f4f6" strokeWidth={4} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={color} strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{
        marginTop: -size/2 - 8,
        fontSize: size > 50 ? 14 : 11,
        fontWeight: 800,
        color,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>{Math.round(value)}%</div>
      {label && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, fontWeight: 600 }}>{label}</div>}
    </div>
  );
}

// ── Topic Card (fetched from curriculum_topics) ──
function TopicCard({ topic, onClick, mastery, subject }) {
  const cfg = SUBJECT_CONFIG[subject] || SUBJECT_CONFIG.science;
  const masteryPct = mastery?.mastery_percent || 0;
  const masteryLevel = mastery?.mastery_level || "not_started";
  const levelColors = {
    not_started: "#9ca3af", beginner: "#F59E0B",
    developing: "#3B82F6", proficient: "#8B5CF6", mastered: "#10B981"
  };
  
  return (
    <button onClick={onClick} style={{
      padding: "14px 16px",
      borderRadius: 16,
      border: `1px solid ${levelColors[masteryLevel]}25`,
      background: `linear-gradient(135deg, #fff, ${levelColors[masteryLevel]}05)`,
      cursor: "pointer",
      textAlign: "left",
      width: "100%",
      display: "flex",
      alignItems: "center",
      gap: 14,
      transition: "all 0.3s",
      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
      fontFamily: "'Nunito', sans-serif",
    }}
    onMouseEnter={e => {
      e.currentTarget.style.transform = "translateY(-2px)";
      e.currentTarget.style.boxShadow = `0 6px 20px ${levelColors[masteryLevel]}15`;
    }}
    onMouseLeave={e => {
      e.currentTarget.style.transform = "translateY(0)";
      e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
    }}>
      <MasteryRing value={masteryPct} size={48} color={levelColors[masteryLevel]} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 700, color: "#1a1a2e",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          Ch {topic.chapter_number}: {topic.title}
        </div>
        <div style={{
          fontSize: 11, color: "#6b7280", marginTop: 2,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{
            padding: "1px 8px",
            borderRadius: 10,
            background: `${levelColors[masteryLevel]}15`,
            color: levelColors[masteryLevel],
            fontSize: 10,
            fontWeight: 700,
            textTransform: "capitalize",
          }}>
            {masteryLevel.replace("_", " ")}
          </span>
          {topic.bloom_focus && (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>
              {topic.bloom_focus}
            </span>
          )}
          {topic.estimated_minutes && (
            <span style={{ fontSize: 10, color: "#9ca3af" }}>
              ⏱ {topic.estimated_minutes}m
            </span>
          )}
        </div>
      </div>
      <span style={{ fontSize: 18, color: cfg.color }}>→</span>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════
// 🦊 MAIN FOXY DASHBOARD COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function FoxyDashboard() {
  // State
  const [student, setStudent] = useState(null);
  const [profile, setProfile] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [activeSubject, setActiveSubject] = useState("science");
  const [topics, setTopics] = useState([]);
  const [masteryData, setMasteryData] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sessionMode, setSessionMode] = useState("learn");
  const [language, setLanguage] = useState("en");
  const [activeTopic, setActiveTopic] = useState(null);
  const [foxyState, setFoxyState] = useState("idle");
  const [sidePanel, setSidePanel] = useState("topics"); // topics | stats | notes | history
  const [chatSessionId, setChatSessionId] = useState(null);
  const [xpGained, setXpGained] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [totalXP, setTotalXP] = useState(0);
  const [dailyActivity, setDailyActivity] = useState(null);
  const [recentNotes, setRecentNotes] = useState([]);
  const [achievements, setAchievements] = useState([]);
  const messagesEndRef = useRef(null);
  const [studentGrade, setStudentGrade] = useState("9");

  // Load student data
  useEffect(() => {
    const loadStudent = async () => {
      // Try to get from localStorage or fetch first student (demo mode)
      const name = localStorage.getItem("alfanumrik_name") || "Demo Student";
      const grade = localStorage.getItem("alfanumrik_grade") || "9";
      const lang = localStorage.getItem("alfanumrik_language") || "en";
      setStudentGrade(grade);
      setLanguage(lang);

      // Fetch real student data
      const students = await supaFetch(`students?limit=1&order=created_at.desc`);
      if (students?.[0]) {
        setStudent(students[0]);
        setTotalXP(students[0].xp_total || 0);
        setStreakDays(students[0].streak_days || 0);
        setStudentGrade(students[0].grade?.replace("Grade ", "") || "9");

        // Fetch learning profile
        const profiles = await supaFetch(
          `student_learning_profiles?student_id=eq.${students[0].id}&order=updated_at.desc&limit=1`
        );
        if (profiles?.[0]) setProfile(profiles[0]);

        // Fetch daily activity
        const today = new Date().toISOString().split("T")[0];
        const activity = await supaFetch(
          `daily_activity?student_id=eq.${students[0].id}&activity_date=eq.${today}&limit=1`
        );
        if (activity?.[0]) setDailyActivity(activity[0]);

        // Fetch recent notes
        const notes = await supaFetch(
          `student_notes?student_id=eq.${students[0].id}&order=created_at.desc&limit=5`
        );
        if (notes) setRecentNotes(notes);

        // Fetch achievements
        const achvs = await supaFetch(
          `student_achievements?student_id=eq.${students[0].id}&order=unlocked_at.desc&limit=5&select=*,achievements(*)`
        );
        if (achvs) setAchievements(achvs);
      } else {
        setStudent({ id: "demo", name, grade: `Grade ${grade}` });
      }

      // Fetch subjects
      const subs = await supaFetch(`subjects?is_active=eq.true&order=display_order`);
      if (subs) setSubjects(subs);
    };
    loadStudent();
  }, []);

  // Load topics when subject changes
  useEffect(() => {
    const loadTopics = async () => {
      const gradeFilter = `Grade ${studentGrade}`;
      const subjectFilter = activeSubject;
      
      // Get parent-level topics (chapters)
      const data = await supaFetch(
        `curriculum_topics?grade=eq.${encodeURIComponent(gradeFilter)}&subject_id=not.is.null&parent_topic_id=is.null&is_active=eq.true&order=chapter_number,display_order&limit=50&select=*,subjects!inner(code)`,
      );
      
      // If the join doesn't work, try without it
      if (!data) {
        const allTopics = await supaFetch(
          `curriculum_topics?grade=eq.${encodeURIComponent(gradeFilter)}&parent_topic_id=is.null&is_active=eq.true&order=chapter_number,display_order&limit=50`
        );
        if (allTopics) setTopics(allTopics);
      } else {
        const filtered = data.filter(t => t.subjects?.code === activeSubject);
        setTopics(filtered.length > 0 ? filtered : data.slice(0, 15));
      }

      // Fetch mastery for this student
      if (student?.id && student.id !== "demo") {
        const mastery = await supaFetch(
          `topic_mastery?student_id=eq.${student.id}&subject=eq.${activeSubject}&order=updated_at.desc`
        );
        if (mastery) setMasteryData(mastery);
      }
    };
    if (studentGrade) loadTopics();
  }, [activeSubject, studentGrade, student]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Send message to Foxy
  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return;

    const userMsg = {
      id: Date.now(),
      role: "student",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setFoxyState("thinking");

    try {
      const payload = {
        message: text,
        student_id: student?.id || "demo",
        student_name: student?.name || "Student",
        grade: studentGrade,
        subject: activeSubject,
        language,
        mode: sessionMode,
        topic_id: activeTopic?.id,
        topic_title: activeTopic?.title,
        session_id: chatSessionId,
      };

      const response = await callFoxyTutor(payload);
      
      const foxyMsg = {
        id: Date.now() + 1,
        role: "tutor",
        content: response.reply || response.response || response.message || "🦊 Let me think about that...",
        timestamp: new Date().toISOString(),
        xp: response.xp_earned || 0,
        topicsCovered: response.topics_covered || [],
      };
      
      setMessages(prev => [...prev, foxyMsg]);
      if (foxyMsg.xp > 0) setXpGained(prev => prev + foxyMsg.xp);
      if (response.session_id) setChatSessionId(response.session_id);
      setFoxyState("happy");
      setTimeout(() => setFoxyState("idle"), 2000);
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: "tutor",
        content: "😅 Oops! I had a hiccup. Let me try again — please resend your message!",
        timestamp: new Date().toISOString(),
      }]);
      setFoxyState("idle");
    }
    setLoading(false);
  }, [student, studentGrade, activeSubject, language, sessionMode, activeTopic, chatSessionId]);

  // Topic click handler
  const handleTopicClick = (topic) => {
    setActiveTopic(topic);
    sendMessage(`Teach me about: ${topic.title} (Chapter ${topic.chapter_number})`);
  };

  // ── RENDER ──
  const cfg = SUBJECT_CONFIG[activeSubject] || SUBJECT_CONFIG.science;

  return (
    <div style={{
      fontFamily: "'Nunito', 'Segoe UI', sans-serif",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "#f8fafc",
      color: "#1a1a2e",
    }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Fira+Code:wght@400;500&display=swap');
        @keyframes fadeInUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.05); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes float { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
        * { box-sizing: border-box; scrollbar-width: thin; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
      `}</style>

      {/* ═══ TOP HEADER BAR ═══ */}
      <div style={{
        padding: "10px 20px",
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        gap: 16,
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        position: "relative",
        zIndex: 10,
      }}>
        {/* Foxy Avatar */}
        <div style={{
          width: 44, height: 44,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #E8590C, #F59E0B)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          animation: foxyState === "thinking" ? "pulse 1s infinite" : foxyState === "happy" ? "float 1s ease" : "none",
          boxShadow: "0 0 20px rgba(232,89,12,0.4)",
        }}>
          {FOXY_STATES[foxyState]}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: 0.5 }}>
            🦊 Foxy <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>
              — Your Intelligent Guide & Advisor
            </span>
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, display: "flex", gap: 12, marginTop: 2 }}>
            <span>👤 {student?.name || "Student"}</span>
            <span>📚 Grade {studentGrade}</span>
            <span>🔥 {streakDays} day streak</span>
            <span>⭐ {totalXP + xpGained} XP</span>
          </div>
        </div>

        {/* Language Selector */}
        <select
          value={language}
          onChange={e => setLanguage(e.target.value)}
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.1)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            outline: "none",
          }}
        >
          {LANGUAGES.map(l => (
            <option key={l.code} value={l.code} style={{ color: "#000" }}>
              {l.flag} {l.label}
            </option>
          ))}
        </select>
      </div>

      {/* ═══ SUBJECT TABS + MODE BAR ═══ */}
      <div style={{
        padding: "8px 20px",
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        gap: 12,
        alignItems: "center",
        overflowX: "auto",
      }}>
        {/* Subject Tabs */}
        {Object.entries(SUBJECT_CONFIG).map(([key, sub]) => (
          <button key={key} onClick={() => { setActiveSubject(key); setActiveTopic(null); }} style={{
            padding: "6px 16px",
            borderRadius: 20,
            border: activeSubject === key ? `2px solid ${sub.color}` : "1px solid #e5e7eb",
            background: activeSubject === key ? `${sub.color}10` : "transparent",
            color: activeSubject === key ? sub.color : "#6b7280",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            whiteSpace: "nowrap",
            transition: "all 0.2s",
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 16 }}>{sub.icon}</span>
            {sub.name}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {/* Session Mode Chips */}
        {SESSION_MODES.map(mode => (
          <button key={mode.id} onClick={() => setSessionMode(mode.id)} style={{
            padding: "5px 12px",
            borderRadius: 16,
            border: sessionMode === mode.id ? `2px solid ${mode.color}` : "1px solid transparent",
            background: sessionMode === mode.id ? `${mode.color}10` : "transparent",
            color: sessionMode === mode.id ? mode.color : "#9ca3af",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            whiteSpace: "nowrap",
            transition: "all 0.2s",
            flexShrink: 0,
          }}>
            {mode.icon} {language === "hi" ? mode.labelHi : mode.label}
          </button>
        ))}
      </div>

      {/* ═══ MAIN CONTENT AREA ═══ */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        
        {/* ── LEFT SIDEBAR: Topics, Stats, Notes ── */}
        <div style={{
          width: 320,
          borderRight: "1px solid #e5e7eb",
          background: "#fff",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}>
          {/* Sidebar Tabs */}
          <div style={{
            display: "flex",
            borderBottom: "1px solid #e5e7eb",
          }}>
            {[
              { id: "topics", icon: "📚", label: "Topics" },
              { id: "stats", icon: "📊", label: "Stats" },
              { id: "notes", icon: "📝", label: "Notes" },
            ].map(tab => (
              <button key={tab.id} onClick={() => setSidePanel(tab.id)} style={{
                flex: 1,
                padding: "10px 0",
                border: "none",
                borderBottom: sidePanel === tab.id ? `3px solid ${cfg.color}` : "3px solid transparent",
                background: sidePanel === tab.id ? `${cfg.color}05` : "transparent",
                color: sidePanel === tab.id ? cfg.color : "#9ca3af",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                transition: "all 0.2s",
              }}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Sidebar Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
            {sidePanel === "topics" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{
                  padding: "10px 14px",
                  background: `linear-gradient(135deg, ${cfg.color}10, ${cfg.color}05)`,
                  borderRadius: 12,
                  fontSize: 12,
                  color: cfg.color,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}>
                  {cfg.icon} {cfg.name} — Grade {studentGrade}
                  <span style={{
                    marginLeft: "auto",
                    background: `${cfg.color}20`,
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 10,
                  }}>
                    {topics.length} chapters
                  </span>
                </div>
                
                {topics.length === 0 ? (
                  <div style={{
                    padding: 30,
                    textAlign: "center",
                    color: "#9ca3af",
                    fontSize: 13,
                  }}>
                    Loading curriculum...
                  </div>
                ) : (
                  topics.map(topic => {
                    const mastery = masteryData.find(m => 
                      m.topic_tag === topic.title || m.chapter_number === topic.chapter_number
                    );
                    return (
                      <TopicCard
                        key={topic.id}
                        topic={topic}
                        mastery={mastery}
                        subject={activeSubject}
                        onClick={() => handleTopicClick(topic)}
                      />
                    );
                  })
                )}
              </div>
            )}

            {sidePanel === "stats" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* XP & Streak Card */}
                <div style={{
                  padding: 20,
                  background: "linear-gradient(135deg, #1a1a2e, #16213e)",
                  borderRadius: 16,
                  color: "#fff",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 900, color: "#F59E0B" }}>
                        {totalXP + xpGained}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>Total XP</div>
                    </div>
                    <div style={{ width: 1, background: "rgba(255,255,255,0.1)" }} />
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 900, color: "#EF4444" }}>
                        🔥 {streakDays}
                      </div>
                      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>Day Streak</div>
                    </div>
                  </div>
                </div>

                {/* Today's Activity */}
                <div style={{ padding: "14px 16px", background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
                    📅 Today's Activity
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[
                      { label: "Sessions", value: dailyActivity?.sessions_count || 0, icon: "📖" },
                      { label: "Questions", value: dailyActivity?.questions_asked || 0, icon: "❓" },
                      { label: "Correct", value: dailyActivity?.questions_correct || 0, icon: "✅" },
                      { label: "XP Earned", value: (dailyActivity?.xp_earned || 0) + xpGained, icon: "⭐" },
                      { label: "Minutes", value: dailyActivity?.time_spent_minutes || 0, icon: "⏱" },
                      { label: "Quizzes", value: dailyActivity?.quizzes_completed || 0, icon: "🎯" },
                    ].map((stat, i) => (
                      <div key={i} style={{
                        padding: "10px",
                        background: "#fff",
                        borderRadius: 10,
                        textAlign: "center",
                        border: "1px solid #f3f4f6",
                      }}>
                        <div style={{ fontSize: 16 }}>{stat.icon}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>{stat.value}</div>
                        <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600 }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Subject Mastery Overview */}
                <div style={{ padding: "14px 16px", background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
                    🎯 Subject Mastery
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-around" }}>
                    {["math", "science", "english"].map(sub => {
                      const s = SUBJECT_CONFIG[sub];
                      return (
                        <MasteryRing
                          key={sub}
                          value={profile?.subject === sub ? ((profile?.total_questions_answered_correctly || 0) / Math.max(profile?.total_questions_asked || 1, 1)) * 100 : 45}
                          size={56}
                          color={s.color}
                          label={s.name}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Recent Achievements */}
                {achievements.length > 0 && (
                  <div style={{ padding: "14px 16px", background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 10 }}>
                      🏆 Recent Achievements
                    </div>
                    {achievements.map((a, i) => (
                      <div key={i} style={{
                        display: "flex",
                        gap: 10,
                        padding: "8px 0",
                        borderBottom: i < achievements.length - 1 ? "1px solid #f3f4f6" : "none",
                        alignItems: "center",
                      }}>
                        <span style={{ fontSize: 22 }}>{a.achievements?.icon || "🏅"}</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{a.achievements?.title}</div>
                          <div style={{ fontSize: 10, color: "#9ca3af" }}>+{a.achievements?.xp_reward || 0} XP</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {sidePanel === "notes" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={() => sendMessage("/notes create")} style={{
                  padding: "12px",
                  borderRadius: 12,
                  border: `2px dashed ${cfg.color}40`,
                  background: "transparent",
                  color: cfg.color,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}>
                  + Ask Foxy to create notes
                </button>
                {recentNotes.map((note, i) => (
                  <div key={i} style={{
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                    borderLeft: `4px solid ${note.color || "#E8590C"}`,
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{note.title}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4, lineHeight: 1.5 }}>
                      {note.content?.substring(0, 120)}...
                    </div>
                    <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 6, display: "flex", gap: 8 }}>
                      <span>{note.note_type}</span>
                      <span>Ch {note.chapter_number}</span>
                    </div>
                  </div>
                ))}
                {recentNotes.length === 0 && (
                  <div style={{ padding: 20, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>
                    No notes yet. Ask Foxy to create some!
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── MAIN CHAT AREA ── */}
        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)",
        }}>
          {/* Chat Messages */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px",
          }}>
            {/* Welcome message if no messages */}
            {messages.length === 0 && (
              <div style={{
                textAlign: "center",
                padding: "60px 40px",
                animation: "fadeInUp 0.5s ease",
              }}>
                <div style={{
                  fontSize: 80,
                  marginBottom: 16,
                  animation: "float 3s ease-in-out infinite",
                }}>🦊</div>
                <h2 style={{
                  fontSize: 24,
                  fontWeight: 900,
                  background: `linear-gradient(135deg, #E8590C, ${cfg.color})`,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  marginBottom: 8,
                }}>
                  {language === "hi" ? "नमस्ते! मैं Foxy हूँ 🦊" : "Hi! I'm Foxy 🦊"}
                </h2>
                <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.8, maxWidth: 500, margin: "0 auto" }}>
                  {language === "hi" 
                    ? "आपका बुद्धिमान गाइड और सलाहकार। बाएं पैनल से कोई भी chapter चुनो या नीचे लिखकर मुझसे कुछ भी पूछो!" 
                    : "Your Intelligent Guide & Advisor. Pick any chapter from the left panel, or type below to ask me anything!"}
                </p>
                
                {/* Quick Start Prompts */}
                <div style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  justifyContent: "center",
                  marginTop: 24,
                }}>
                  {[
                    { text: language === "hi" ? "आज क्या पढ़ें?" : "What should I study today?", icon: "📚" },
                    { text: language === "hi" ? "क्विज़ शुरू करो" : "Start a quick quiz", icon: "🎯" },
                    { text: language === "hi" ? "मेरी कमज़ोरियाँ बताओ" : "Show my weak areas", icon: "📊" },
                    { text: language === "hi" ? "नोट्स बनाओ" : "Create smart notes", icon: "📝" },
                    { text: language === "hi" ? "रिवीज़न प्लान बनाओ" : "Build revision plan", icon: "🔄" },
                    { text: language === "hi" ? "फॉर्मूला शीट दो" : "Give me formula sheet", icon: "∑" },
                  ].map((prompt, i) => (
                    <button key={i} onClick={() => sendMessage(prompt.text)} style={{
                      padding: "10px 18px",
                      borderRadius: 14,
                      border: "1px solid #e5e7eb",
                      background: "#fff",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#374151",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.2s",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                      animation: `fadeInUp ${0.3 + i * 0.1}s ease`,
                    }}
                    onMouseEnter={e => {
                      e.target.style.borderColor = cfg.color;
                      e.target.style.boxShadow = `0 4px 16px ${cfg.color}15`;
                      e.target.style.transform = "translateY(-2px)";
                    }}
                    onMouseLeave={e => {
                      e.target.style.borderColor = "#e5e7eb";
                      e.target.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
                      e.target.style.transform = "translateY(0)";
                    }}>
                      {prompt.icon} {prompt.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message Bubbles */}
            {messages.map((msg, idx) => (
              <div key={msg.id} style={{
                display: "flex",
                justifyContent: msg.role === "student" ? "flex-end" : "flex-start",
                marginBottom: 16,
                animation: "fadeInUp 0.3s ease",
                gap: 10,
                alignItems: "flex-start",
              }}>
                {msg.role === "tutor" && (
                  <div style={{
                    width: 36, height: 36,
                    borderRadius: "50%",
                    background: "linear-gradient(135deg, #E8590C, #F59E0B)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    flexShrink: 0,
                    boxShadow: "0 2px 8px rgba(232,89,12,0.3)",
                  }}>🦊</div>
                )}
                
                <div style={{
                  maxWidth: "75%",
                  padding: "14px 18px",
                  borderRadius: msg.role === "student" 
                    ? "18px 18px 4px 18px" 
                    : "18px 18px 18px 4px",
                  background: msg.role === "student"
                    ? `linear-gradient(135deg, ${cfg.color}, ${cfg.color}dd)`
                    : "#fff",
                  color: msg.role === "student" ? "#fff" : "#1a1a2e",
                  fontSize: 14,
                  lineHeight: 1.7,
                  boxShadow: msg.role === "student"
                    ? `0 4px 12px ${cfg.color}25`
                    : "0 2px 12px rgba(0,0,0,0.06)",
                  border: msg.role === "tutor" ? "1px solid #f3f4f6" : "none",
                  position: "relative",
                }}>
                  {msg.role === "tutor" ? (
                    <RichContent content={msg.content} subject={activeSubject} />
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>
                  )}
                  
                  {/* XP Badge */}
                  {msg.xp > 0 && (
                    <div style={{
                      position: "absolute",
                      top: -8,
                      right: -8,
                      background: "linear-gradient(135deg, #F59E0B, #EF4444)",
                      color: "#fff",
                      padding: "2px 8px",
                      borderRadius: 10,
                      fontSize: 10,
                      fontWeight: 800,
                      boxShadow: "0 2px 6px rgba(245,158,11,0.4)",
                    }}>+{msg.xp} XP</div>
                  )}
                  
                  {/* Timestamp */}
                  <div style={{
                    fontSize: 10,
                    opacity: 0.5,
                    marginTop: 6,
                    textAlign: "right",
                  }}>
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>

                {msg.role === "student" && (
                  <div style={{
                    width: 36, height: 36,
                    borderRadius: "50%",
                    background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}bb)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    color: "#fff",
                    fontWeight: 800,
                    flexShrink: 0,
                  }}>
                    {(student?.name || "S")[0].toUpperCase()}
                  </div>
                )}
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                animation: "fadeInUp 0.2s ease",
                marginBottom: 16,
              }}>
                <div style={{
                  width: 36, height: 36,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #E8590C, #F59E0B)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  animation: "pulse 1s infinite",
                }}>🦊</div>
                <div style={{
                  padding: "12px 20px",
                  borderRadius: "18px 18px 18px 4px",
                  background: "#fff",
                  border: "1px solid #f3f4f6",
                  display: "flex",
                  gap: 6,
                }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 8, height: 8,
                      borderRadius: "50%",
                      background: cfg.color,
                      animation: `pulse 1s infinite ${i * 0.2}s`,
                      opacity: 0.6,
                    }} />
                  ))}
                  <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 6 }}>
                    {language === "hi" ? "Foxy सोच रही है..." : "Foxy is thinking..."}
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── INPUT AREA WITH STRUCTURED ANSWER ── */}
          <StructuredAnswerInput
            onSubmit={sendMessage}
            subject={activeSubject}
            mode={sessionMode}
          />
        </div>
      </div>
    </div>
  );
}
