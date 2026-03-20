"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════
// FOXY — THE ALFANUMRIK INTELLIGENT GUIDE & ADVISOR
// The MOAT: AI Tutor managing ALL student tasks under one chat interface
// ═══════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dxipobqngyfpqbbznojz.supabase.co";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4aXBvYnFuZ3lmcHFiYnpub2p6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE1ODQ1MDcsImV4cCI6MjA1NzE2MDUwN30.CZJH4VPQa6MHmYkXXxnEFPkfGhJnBPqMlG3MwjUe3tE";

const SUBJECT_CONFIG = {
  math: {
    name: "Mathematics", nameHi: "\u0917\u0923\u093F\u0924", icon: "\u2211", color: "#3B82F6",
    symbols: ["\u222B","\u2202","\u221A","\u03C0","\u221E","\u2248","\u2260","\u2264","\u2265","\u0394","\u03B8","\u03B1","\u03B2","\u2208","\u2205","\u222A","\u2229","\u2282","\u2192","\u21D2","\u2200","\u2203","\u00B1","\u00F7","\u00D7","\u00B2","\u00B3","\u207F","\u2081","\u2082"],
    quickTools: ["Calculator","Graph Plotter","Formula Sheet","Geometry Kit"]
  },
  science: {
    name: "Science", nameHi: "\u0935\u093F\u091C\u094D\u091E\u093E\u0928", icon: "\u269B", color: "#10B981",
    symbols: ["\u2697","\u26A1","\u2103","\u03A9","\u03BC","\u03BB","\u212B","\u2192","\u21CC","\u2191","\u2193","\u0394","\u221D","\u2261","mol","pH","atm","Pa","Hz","eV","nm","kg","m/s","N","J","W","V","A"],
    quickTools: ["Periodic Table","Unit Converter","Lab Simulator","Diagram Tool"]
  },
  english: {
    name: "English", nameHi: "\u0905\u0902\u0917\u094D\u0930\u0947\u091C\u093C\u0940", icon: "Aa", color: "#8B5CF6",
    symbols: ["\u2014","\u2013","\u2026","\u00A9","\u00AE","\u2122","\u00B6","\u00A7","\u2020","\u2021","\u2022","\u00B7","\u00AB","\u00BB","\u2039","\u203A","\u2070","\u00B9","\u00B2","\u00B3","\u2074"],
    quickTools: ["Dictionary","Grammar Check","Essay Outline","Reading Log"]
  },
  hindi: {
    name: "\u0939\u093F\u0928\u094D\u0926\u0940", nameHi: "\u0939\u093F\u0928\u094D\u0926\u0940", icon: "\u0905", color: "#F59E0B",
    symbols: ["\u0964","\u0965","\u0901","\u0902","\u0903","\u093D","\u094D","\u0950","\u20B9","\u0970"],
    quickTools: ["\u0936\u092C\u094D\u0926\u0915\u094B\u0936","\u0935\u094D\u092F\u093E\u0915\u0930\u0923","\u0928\u093F\u092C\u0902\u0927","\u0915\u0935\u093F\u0924\u093E"]
  },
  physics: {
    name: "Physics", nameHi: "\u092D\u094C\u0924\u093F\u0915 \u0935\u093F\u091C\u094D\u091E\u093E\u0928", icon: "\u26A1", color: "#EF4444",
    symbols: ["F","m","a","v","t","s","\u03C9","\u03C4","\u03C1","\u03C3","\u03B5","\u03BC","\u03BB","\u03BD","\u03A6","\u03A8","\u2207","\u2202","\u222B","\u03A3","\u0394","\u2192","\u22A5","\u2225","\u2248","\u221D","\u210F","eV","\u212B"],
    quickTools: ["Formula Reference","Vector Visualizer","Circuit Builder","Motion Graphs"]
  },
  chemistry: {
    name: "Chemistry", nameHi: "\u0930\u0938\u093E\u092F\u0928 \u0935\u093F\u091C\u094D\u091E\u093E\u0928", icon: "\u2697", color: "#06B6D4",
    symbols: ["\u2192","\u21CC","\u2191","\u2193","\u0394","\u00B0","\u207A","\u207B","\u00B7","\u2261","\u2295","\u2296","mol","aq","(s)","(l)","(g)","pH"],
    quickTools: ["Periodic Table","Equation Balancer","Molarity Calc","VSEPR Shapes"]
  },
  biology: {
    name: "Biology", nameHi: "\u091C\u0940\u0935 \u0935\u093F\u091C\u094D\u091E\u093E\u0928", icon: "\u2695", color: "#22C55E",
    symbols: ["\u2642","\u2640","\u00D7","\u2192","\u21D2","\u2248","ATP","DNA","RNA","mRNA","tRNA","CO2","O2","H2O","N2"],
    quickTools: ["Cell Diagram","Taxonomy Tree","Body Systems","Genetics Calc"]
  }
};

const LANGUAGES = [
  { code: "en", label: "English", flag: "EN" },
  { code: "hi", label: "Hindi", flag: "HI" },
  { code: "hinglish", label: "Hinglish", flag: "HN" },
  { code: "ta", label: "Tamil", flag: "TA" },
  { code: "te", label: "Telugu", flag: "TE" },
  { code: "bn", label: "Bangla", flag: "BN" },
];

const SESSION_MODES = [
  { id: "learn", label: "Learn", labelHi: "\u0938\u0940\u0916\u094B", color: "#3B82F6" },
  { id: "practice", label: "Practice", labelHi: "\u0905\u092D\u094D\u092F\u093E\u0938", color: "#10B981" },
  { id: "quiz", label: "Quiz", labelHi: "\u0915\u094D\u0935\u093F\u091C\u093C", color: "#F59E0B" },
  { id: "doubt", label: "Doubt", labelHi: "\u0938\u0902\u0926\u0947\u0939", color: "#8B5CF6" },
  { id: "revision", label: "Revise", labelHi: "\u0926\u094B\u0939\u0930\u093E\u0913", color: "#EF4444" },
  { id: "notes", label: "Notes", labelHi: "\u0928\u094B\u091F\u094D\u0938", color: "#06B6D4" },
];

async function supaFetch(path) {
  try {
    const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: "Bearer " + SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    });
    if (!r.ok) return null;
    return r.json();
  } catch (e) { return null; }
}

async function callFoxyTutor(payload) {
  try {
    const r = await fetch(SUPABASE_URL + "/functions/v1/foxy-tutor", {
      method: "POST",
      headers: { Authorization: "Bearer " + SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { reply: "Foxy is taking a short break. Try again!" };
    return r.json();
  } catch (e) { return { reply: "Connection issue. Please retry!" }; }
}

function RichContent({ content, subject }) {
  var cfg = SUBJECT_CONFIG[subject] || SUBJECT_CONFIG.science;
  if (!content) return null;
  var lines = content.split("\n");
  var elements = [];
  var listItems = [];
  var listKind = null;

  function flush() {
    if (listItems.length > 0) {
      elements.push(
        <div key={"l" + elements.length} style={{ margin: "12px 0", padding: "12px 16px", background: cfg.color + "08", borderLeft: "3px solid " + cfg.color, borderRadius: "0 12px 12px 0" }}>
          {listItems.map(function(item, i) {
            return (
              <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", alignItems: "flex-start", borderBottom: i < listItems.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                <span style={{ minWidth: 24, height: 24, borderRadius: "50%", background: cfg.color + "20", color: cfg.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                  {listKind === "num" ? i + 1 : "\u2022"}
                </span>
                <span style={{ lineHeight: 1.6 }}>{item}</span>
              </div>
            );
          })}
        </div>
      );
      listItems = [];
      listKind = null;
    }
  }

  lines.forEach(function(line, idx) {
    var t = line.trim();
    if (t.startsWith("###")) { flush(); elements.push(<h4 key={idx} style={{ fontSize: 14, fontWeight: 700, color: cfg.color, margin: "16px 0 8px", textTransform: "uppercase", letterSpacing: 1 }}>{cfg.icon + " " + t.replace(/^###\s*/, "")}</h4>); }
    else if (t.startsWith("##")) { flush(); elements.push(<h3 key={idx} style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", margin: "18px 0 10px", paddingBottom: 8, borderBottom: "2px solid " + cfg.color + "30" }}>{t.replace(/^##\s*/, "")}</h3>); }
    else if (t.startsWith(">")) { flush(); elements.push(<div key={idx} style={{ margin: "12px 0", padding: "14px 16px", background: cfg.color + "08", border: "1px solid " + cfg.color + "25", borderRadius: 12, fontSize: 14, lineHeight: 1.7 }}>{t.replace(/^>\s*/, "")}</div>); }
    else if (/^\d+[\.\)]\s/.test(t)) { if (listKind !== "num") { flush(); listKind = "num"; } listItems.push(t.replace(/^\d+[\.\)]\s*/, "")); }
    else if (/^[-\u2022*]\s/.test(t)) { if (listKind !== "bul") { flush(); listKind = "bul"; } listItems.push(t.replace(/^[-\u2022*]\s*/, "")); }
    else if (!t) { flush(); elements.push(<div key={idx} style={{ height: 8 }} />); }
    else { flush(); elements.push(<p key={idx} style={{ margin: "6px 0", lineHeight: 1.75, color: "#374151" }}>{t}</p>); }
  });
  flush();
  return <div>{elements}</div>;
}

function StructuredAnswerInput({ onSubmit, subject }) {
  var _a = useState([""]), points = _a[0], setPoints = _a[1];
  var _b = useState("free"), mode = _b[0], setMode = _b[1];
  var cfg = SUBJECT_CONFIG[subject] || SUBJECT_CONFIG.science;
  var _c = useState(false), showSym = _c[0], setShowSym = _c[1];
  var _d = useState(false), showTools = _d[0], setShowTools = _d[1];
  var taRef = useRef(null);
  var _e = useState(0), aPtIdx = _e[0], setAPtIdx = _e[1];

  function insertSym(s) {
    if (mode === "points") { var u = points.slice(); u[aPtIdx] = (u[aPtIdx] || "") + s; setPoints(u); }
    else if (taRef.current) { var ta = taRef.current; var st = ta.selectionStart; ta.value = ta.value.substring(0, st) + s + ta.value.substring(ta.selectionEnd); ta.selectionStart = ta.selectionEnd = st + s.length; ta.focus(); }
  }
  function submit() {
    if (mode === "points") { var f = points.filter(function(p){return p.trim();}); if (!f.length) return; onSubmit(f.map(function(p,i){return (i+1)+". "+p;}).join("\n")); setPoints([""]); }
    else { var v = taRef.current && taRef.current.value && taRef.current.value.trim(); if (!v) return; onSubmit(v); taRef.current.value = ""; }
  }
  function kd(e) { if (e.key === "Enter" && !e.shiftKey && mode === "free") { e.preventDefault(); submit(); } if (e.key === "Enter" && mode === "points") { e.preventDefault(); setPoints(points.concat([""])); } }

  return (
    <div style={{ padding: "16px 20px", background: "#fff", borderTop: "1px solid #e5e7eb" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>Answer:</span>
        {[{id:"free",l:"Free Text"},{id:"points",l:"Point-wise"}].map(function(m){return (
          <button key={m.id} onClick={function(){setMode(m.id);}} style={{ padding: "4px 12px", borderRadius: 20, border: mode===m.id ? "2px solid "+cfg.color : "1px solid #e5e7eb", background: mode===m.id ? cfg.color+"10" : "#fff", color: mode===m.id ? cfg.color : "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{m.l}</button>
        );})}
        <button onClick={function(){setShowSym(!showSym);}} style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 20, border: showSym ? "2px solid "+cfg.color : "1px solid #e5e7eb", background: showSym ? cfg.color+"10" : "#fff", color: showSym ? cfg.color : "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{cfg.icon} Symbols</button>
        <button onClick={function(){setShowTools(!showTools);}} style={{ padding: "4px 12px", borderRadius: 20, border: showTools ? "2px solid "+cfg.color : "1px solid #e5e7eb", background: showTools ? cfg.color+"10" : "#fff", color: showTools ? cfg.color : "#6b7280", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Tools</button>
      </div>
      {showSym && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "10px 12px", background: cfg.color+"05", borderRadius: 12, marginBottom: 10, border: "1px solid "+cfg.color+"20", maxHeight: 120, overflowY: "auto" }}>
        {cfg.symbols.map(function(s,i){return <button key={i} onClick={function(){insertSym(s);}} style={{ width: 36, height: 36, borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace" }}>{s}</button>;})}
      </div>}
      {showTools && <div style={{ display: "flex", gap: 8, padding: "10px 0", marginBottom: 10, flexWrap: "wrap" }}>
        {cfg.quickTools.map(function(tool,i){return <button key={i} onClick={function(){onSubmit("/tool "+tool);}} style={{ padding: "8px 16px", borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151" }}>{tool}</button>;})}
      </div>}
      {mode === "points" ? (
        <div style={{ marginBottom: 10 }}>
          {points.map(function(pt, idx) {return (
            <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span style={{ minWidth: 28, height: 28, borderRadius: "50%", background: pt.trim() ? cfg.color+"20" : "#f3f4f6", color: pt.trim() ? cfg.color : "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{idx+1}</span>
              <input value={pt} onChange={function(e){var u=points.slice();u[idx]=e.target.value;setPoints(u);}} onFocus={function(){setAPtIdx(idx);}} onKeyDown={kd} placeholder={"Point "+(idx+1)+"..."} style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", fontFamily: "Nunito, sans-serif" }} />
              {points.length > 1 && <button onClick={function(){setPoints(points.filter(function(_,i){return i!==idx;}));}} style={{ width: 28, height: 28, borderRadius: "50%", border: "1px solid #fecaca", background: "#fef2f2", color: "#ef4444", cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>x</button>}
            </div>
          );})}
          <button onClick={function(){setPoints(points.concat([""]));}} style={{ padding: "6px 14px", borderRadius: 8, border: "1px dashed "+cfg.color+"40", background: "transparent", color: cfg.color, fontSize: 12, fontWeight: 600, cursor: "pointer", marginTop: 4 }}>+ Add Point</button>
        </div>
      ) : (
        <textarea ref={taRef} onKeyDown={kd} placeholder="Type your answer or ask Foxy... (Shift+Enter for new line)" rows={2} style={{ width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid #e5e7eb", fontSize: 14, outline: "none", resize: "vertical", fontFamily: "Nunito, sans-serif", lineHeight: 1.6, marginBottom: 10, boxSizing: "border-box" }} />
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={submit} style={{ padding: "10px 24px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, "+cfg.color+", "+cfg.color+"dd)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px "+cfg.color+"30", fontFamily: "Nunito, sans-serif" }}>Send to Foxy</button>
      </div>
    </div>
  );
}

function MasteryRing({ value, size, color, label }) {
  size = size || 60;
  var r = (size - 8) / 2;
  var c = 2 * Math.PI * r;
  var o = c - (value / 100) * c;
  return (
    <div style={{ textAlign: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={4} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4} strokeDasharray={c} strokeDashoffset={o} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{ marginTop: -size/2-8, fontSize: size > 50 ? 14 : 11, fontWeight: 800, color: color, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>{Math.round(value)}%</div>
      {label && <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2, fontWeight: 600 }}>{label}</div>}
    </div>
  );
}

function TopicCard({ topic, onClick, mastery, subject }) {
  var cfg = SUBJECT_CONFIG[subject] || SUBJECT_CONFIG.science;
  var pct = mastery ? (mastery.mastery_percent || 0) : 0;
  var lvl = mastery ? (mastery.mastery_level || "not_started") : "not_started";
  var lc = { not_started: "#9ca3af", beginner: "#F59E0B", developing: "#3B82F6", proficient: "#8B5CF6", mastered: "#10B981" };
  return (
    <button onClick={onClick} style={{ padding: "14px 16px", borderRadius: 16, border: "1px solid "+(lc[lvl] || "#9ca3af")+"25", background: "#fff", cursor: "pointer", textAlign: "left", width: "100%", display: "flex", alignItems: "center", gap: 14, transition: "all 0.3s", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", fontFamily: "Nunito, sans-serif" }}>
      <MasteryRing value={pct} size={48} color={lc[lvl] || "#9ca3af"} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Ch {topic.chapter_number}: {topic.title}</div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ padding: "1px 8px", borderRadius: 10, background: (lc[lvl]||"#9ca3af")+"15", color: lc[lvl]||"#9ca3af", fontSize: 10, fontWeight: 700, textTransform: "capitalize" }}>{lvl.replace("_", " ")}</span>
          {topic.estimated_minutes && <span style={{ fontSize: 10, color: "#9ca3af" }}>{topic.estimated_minutes}m</span>}
        </div>
      </div>
    </button>
  );
}

export default function FoxyDashboard() {
  var _s1 = useState(null), student = _s1[0], setStudent = _s1[1];
  var _s2 = useState("science"), activeSubject = _s2[0], setActiveSubject = _s2[1];
  var _s3 = useState([]), topics = _s3[0], setTopics = _s3[1];
  var _s4 = useState([]), masteryData = _s4[0], setMasteryData = _s4[1];
  var _s5 = useState([]), messages = _s5[0], setMessages = _s5[1];
  var _s6 = useState(false), loading = _s6[0], setLoading = _s6[1];
  var _s7 = useState("learn"), sessionMode = _s7[0], setSessionMode = _s7[1];
  var _s8 = useState("en"), language = _s8[0], setLanguage = _s8[1];
  var _s9 = useState(null), activeTopic = _s9[0], setActiveTopic = _s9[1];
  var _s10 = useState("idle"), foxyState = _s10[0], setFoxyState = _s10[1];
  var _s11 = useState("topics"), sidePanel = _s11[0], setSidePanel = _s11[1];
  var _s12 = useState(null), chatSessionId = _s12[0], setChatSessionId = _s12[1];
  var _s13 = useState(0), xpGained = _s13[0], setXpGained = _s13[1];
  var _s14 = useState(0), streakDays = _s14[0], setStreakDays = _s14[1];
  var _s15 = useState(0), totalXP = _s15[0], setTotalXP = _s15[1];
  var _s16 = useState(null), dailyActivity = _s16[0], setDailyActivity = _s16[1];
  var _s17 = useState([]), recentNotes = _s17[0], setRecentNotes = _s17[1];
  var _s18 = useState("9"), studentGrade = _s18[0], setStudentGrade = _s18[1];
  var messagesEndRef = useRef(null);

  useEffect(function() {
    (async function() {
      var grade = typeof window !== "undefined" ? (localStorage.getItem("alfanumrik_grade") || "9") : "9";
      var lang = typeof window !== "undefined" ? (localStorage.getItem("alfanumrik_language") || "en") : "en";
      setStudentGrade(grade); setLanguage(lang);
      var students = await supaFetch("students?limit=1&order=created_at.desc");
      if (students && students[0]) {
        setStudent(students[0]); setTotalXP(students[0].xp_total || 0); setStreakDays(students[0].streak_days || 0);
        setStudentGrade((students[0].grade || "Grade 9").replace("Grade ", ""));
        var today = new Date().toISOString().split("T")[0];
        var act = await supaFetch("daily_activity?student_id=eq." + students[0].id + "&activity_date=eq." + today + "&limit=1");
        if (act && act[0]) setDailyActivity(act[0]);
        var notes = await supaFetch("student_notes?student_id=eq." + students[0].id + "&order=created_at.desc&limit=5");
        if (notes) setRecentNotes(notes);
      } else { setStudent({ id: "demo", name: "Demo Student", grade: "Grade " + grade }); }
    })();
  }, []);

  useEffect(function() {
    (async function() {
      var gf = "Grade " + studentGrade;
      var data = await supaFetch("curriculum_topics?grade=eq." + encodeURIComponent(gf) + "&parent_topic_id=is.null&is_active=eq.true&order=chapter_number,display_order&limit=50");
      if (data) setTopics(data);
      if (student && student.id && student.id !== "demo") {
        var m = await supaFetch("topic_mastery?student_id=eq." + student.id + "&subject=eq." + activeSubject + "&order=updated_at.desc");
        if (m) setMasteryData(m);
      }
    })();
  }, [activeSubject, studentGrade, student]);

  useEffect(function() { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  var sendMessage = useCallback(async function(text) {
    if (!text.trim()) return;
    setMessages(function(p) { return p.concat([{ id: Date.now(), role: "student", content: text, timestamp: new Date().toISOString() }]); });
    setLoading(true); setFoxyState("thinking");
    try {
      var resp = await callFoxyTutor({ message: text, student_id: student ? student.id : "demo", student_name: student ? student.name : "Student", grade: studentGrade, subject: activeSubject, language: language, mode: sessionMode, topic_id: activeTopic ? activeTopic.id : null, topic_title: activeTopic ? activeTopic.title : null, session_id: chatSessionId });
      var reply = resp.reply || resp.response || resp.message || "Let me think about that...";
      var xp = resp.xp_earned || 0;
      setMessages(function(p) { return p.concat([{ id: Date.now() + 1, role: "tutor", content: reply, timestamp: new Date().toISOString(), xp: xp }]); });
      if (xp > 0) setXpGained(function(p) { return p + xp; });
      if (resp.session_id) setChatSessionId(resp.session_id);
      setFoxyState("happy"); setTimeout(function() { setFoxyState("idle"); }, 2000);
    } catch (e) {
      setMessages(function(p) { return p.concat([{ id: Date.now() + 1, role: "tutor", content: "Oops! Please resend.", timestamp: new Date().toISOString() }]); });
      setFoxyState("idle");
    }
    setLoading(false);
  }, [student, studentGrade, activeSubject, language, sessionMode, activeTopic, chatSessionId]);

  var cfg = SUBJECT_CONFIG[activeSubject] || SUBJECT_CONFIG.science;
  var FOXY = { idle: "\uD83E\uDD8A", thinking: "\uD83E\uDD14", happy: "\uD83D\uDE04" };

  return (
    <div style={{ fontFamily: "Nunito, Segoe UI, sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#f8fafc", color: "#1a1a2e" }}>
      <style dangerouslySetInnerHTML={{ __html: "@import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}*{box-sizing:border-box;scrollbar-width:thin}" }} />

      {/* HEADER */}
      <div style={{ padding: "10px 20px", background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)", color: "#fff", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", zIndex: 10 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg, #E8590C, #F59E0B)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, animation: foxyState === "thinking" ? "pulse 1s infinite" : "none", boxShadow: "0 0 20px rgba(232,89,12,0.4)" }}>{FOXY[foxyState] || FOXY.idle}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Foxy <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>Your Intelligent Guide</span></div>
          <div style={{ fontSize: 11, opacity: 0.6, display: "flex", gap: 12, marginTop: 2 }}>
            <span>{student ? student.name : "Student"}</span><span>Grade {studentGrade}</span><span>{streakDays}d streak</span><span>{totalXP + xpGained} XP</span>
          </div>
        </div>
        <select value={language} onChange={function(e){setLanguage(e.target.value);}} style={{ padding: "6px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", outline: "none" }}>
          {LANGUAGES.map(function(l) { return <option key={l.code} value={l.code} style={{ color: "#000" }}>{l.flag} {l.label}</option>; })}
        </select>
      </div>

      {/* SUBJECT + MODE BAR */}
      <div style={{ padding: "8px 20px", background: "#fff", borderBottom: "1px solid #e5e7eb", display: "flex", gap: 8, alignItems: "center", overflowX: "auto" }}>
        {Object.keys(SUBJECT_CONFIG).map(function(key) { var sub = SUBJECT_CONFIG[key]; return (
          <button key={key} onClick={function(){setActiveSubject(key);setActiveTopic(null);}} style={{ padding: "6px 14px", borderRadius: 20, border: activeSubject===key ? "2px solid "+sub.color : "1px solid #e5e7eb", background: activeSubject===key ? sub.color+"10" : "transparent", color: activeSubject===key ? sub.color : "#6b7280", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", flexShrink: 0 }}><span style={{ fontSize: 14 }}>{sub.icon}</span>{sub.name}</button>
        );})}
        <div style={{ flex: 1 }} />
        {SESSION_MODES.map(function(m) { return (
          <button key={m.id} onClick={function(){setSessionMode(m.id);}} style={{ padding: "5px 10px", borderRadius: 16, border: sessionMode===m.id ? "2px solid "+m.color : "1px solid transparent", background: sessionMode===m.id ? m.color+"10" : "transparent", color: sessionMode===m.id ? m.color : "#9ca3af", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>{language === "hi" ? m.labelHi : m.label}</button>
        );})}
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* SIDEBAR */}
        <div style={{ width: 300, borderRight: "1px solid #e5e7eb", background: "#fff", display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb" }}>
            {["topics","stats","notes"].map(function(tab) { return (
              <button key={tab} onClick={function(){setSidePanel(tab);}} style={{ flex: 1, padding: "10px 0", border: "none", borderBottom: sidePanel===tab ? "3px solid "+cfg.color : "3px solid transparent", background: sidePanel===tab ? cfg.color+"05" : "transparent", color: sidePanel===tab ? cfg.color : "#9ca3af", fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>{tab}</button>
            );})}
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            {sidePanel === "topics" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ padding: "10px 14px", background: cfg.color+"10", borderRadius: 12, fontSize: 12, color: cfg.color, fontWeight: 700 }}>{cfg.icon} {cfg.name} - Grade {studentGrade} ({topics.length} chapters)</div>
                {topics.length === 0 && <div style={{ padding: 30, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>Loading...</div>}
                {topics.map(function(topic) {
                  var mastery = masteryData.find(function(m){ return m.topic_tag === topic.title || m.chapter_number === topic.chapter_number; });
                  return <TopicCard key={topic.id} topic={topic} mastery={mastery} subject={activeSubject} onClick={function(){setActiveTopic(topic);sendMessage("Teach me about: "+topic.title+" (Chapter "+topic.chapter_number+")");}} />;
                })}
              </div>
            )}
            {sidePanel === "stats" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ padding: 20, background: "linear-gradient(135deg, #1a1a2e, #16213e)", borderRadius: 16, color: "#fff", display: "flex", justifyContent: "space-around", textAlign: "center" }}>
                  <div><div style={{ fontSize: 28, fontWeight: 900, color: "#F59E0B" }}>{totalXP+xpGained}</div><div style={{ fontSize: 10, opacity: 0.7 }}>Total XP</div></div>
                  <div><div style={{ fontSize: 28, fontWeight: 900, color: "#EF4444" }}>{streakDays}</div><div style={{ fontSize: 10, opacity: 0.7 }}>Streak</div></div>
                </div>
                <div style={{ padding: "14px 16px", background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Today</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {[{l:"Sessions",v:dailyActivity?dailyActivity.sessions_count:0},{l:"Questions",v:dailyActivity?dailyActivity.questions_asked:0},{l:"Correct",v:dailyActivity?dailyActivity.questions_correct:0},{l:"XP",v:(dailyActivity?dailyActivity.xp_earned:0)+xpGained}].map(function(s,i){return (
                      <div key={i} style={{ padding: 10, background: "#fff", borderRadius: 10, textAlign: "center", border: "1px solid #f3f4f6" }}>
                        <div style={{ fontSize: 18, fontWeight: 800 }}>{s.v}</div><div style={{ fontSize: 10, color: "#9ca3af" }}>{s.l}</div>
                      </div>
                    );})}
                  </div>
                </div>
              </div>
            )}
            {sidePanel === "notes" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button onClick={function(){sendMessage("/notes create");}} style={{ padding: 12, borderRadius: 12, border: "2px dashed "+cfg.color+"40", background: "transparent", color: cfg.color, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Ask Foxy for notes</button>
                {recentNotes.map(function(n,i){return (
                  <div key={i} style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff", borderLeft: "4px solid "+(n.color||"#E8590C") }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{n.title}</div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>{n.content ? n.content.substring(0,120)+"..." : ""}</div>
                  </div>
                );})}
                {recentNotes.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#9ca3af", fontSize: 13 }}>No notes yet</div>}
              </div>
            )}
          </div>
        </div>

        {/* CHAT */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "linear-gradient(180deg, #f8fafc, #f1f5f9)" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 40px", animation: "fadeInUp 0.5s ease" }}>
                <div style={{ fontSize: 80, marginBottom: 16, animation: "float 3s ease-in-out infinite" }}>{FOXY.idle}</div>
                <h2 style={{ fontSize: 24, fontWeight: 900, background: "linear-gradient(135deg, #E8590C, "+cfg.color+")", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 8 }}>
                  {language === "hi" ? "Namaste! Main Foxy hoon" : "Hi! I am Foxy"}
                </h2>
                <p style={{ color: "#6b7280", fontSize: 14, lineHeight: 1.8, maxWidth: 500, margin: "0 auto" }}>
                  {language === "hi" ? "Baayen panel se chapter chuno ya neeche likhkar poocho!" : "Your Intelligent Guide. Pick any chapter from the left, or type below to ask me anything!"}
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 24 }}>
                  {[
                    language === "hi" ? "Aaj kya padhen?" : "What should I study today?",
                    language === "hi" ? "Quiz shuru karo" : "Start a quick quiz",
                    language === "hi" ? "Meri kamzoriyan batao" : "Show my weak areas",
                    language === "hi" ? "Notes banao" : "Create smart notes",
                    language === "hi" ? "Formula sheet do" : "Give me formula sheet",
                  ].map(function(text, i) { return (
                    <button key={i} onClick={function(){sendMessage(text);}} style={{ padding: "10px 18px", borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#374151", boxShadow: "0 2px 8px rgba(0,0,0,0.04)", animation: "fadeInUp "+(0.3+i*0.1)+"s ease" }}>{text}</button>
                  );})}
                </div>
              </div>
            )}

            {messages.map(function(msg) { return (
              <div key={msg.id} style={{ display: "flex", justifyContent: msg.role === "student" ? "flex-end" : "flex-start", marginBottom: 16, animation: "fadeInUp 0.3s ease", gap: 10, alignItems: "flex-start" }}>
                {msg.role === "tutor" && <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #E8590C, #F59E0B)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{FOXY.idle}</div>}
                <div style={{ maxWidth: "75%", padding: "14px 18px", borderRadius: msg.role === "student" ? "18px 18px 4px 18px" : "18px 18px 18px 4px", background: msg.role === "student" ? "linear-gradient(135deg, "+cfg.color+", "+cfg.color+"dd)" : "#fff", color: msg.role === "student" ? "#fff" : "#1a1a2e", fontSize: 14, lineHeight: 1.7, boxShadow: msg.role === "student" ? "0 4px 12px "+cfg.color+"25" : "0 2px 12px rgba(0,0,0,0.06)", border: msg.role === "tutor" ? "1px solid #f3f4f6" : "none", position: "relative" }}>
                  {msg.role === "tutor" ? <RichContent content={msg.content} subject={activeSubject} /> : <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>}
                  {msg.xp > 0 && <div style={{ position: "absolute", top: -8, right: -8, background: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "#fff", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 800 }}>+{msg.xp} XP</div>}
                  <div style={{ fontSize: 10, opacity: 0.5, marginTop: 6, textAlign: "right" }}>{new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
                {msg.role === "student" && <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, "+cfg.color+", "+cfg.color+"bb)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#fff", fontWeight: 800, flexShrink: 0 }}>{student ? student.name[0].toUpperCase() : "S"}</div>}
              </div>
            );})}

            {loading && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #E8590C, #F59E0B)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, animation: "pulse 1s infinite" }}>{FOXY.thinking}</div>
                <div style={{ padding: "12px 20px", borderRadius: "18px 18px 18px 4px", background: "#fff", border: "1px solid #f3f4f6", display: "flex", gap: 6 }}>
                  {[0,1,2].map(function(i){return <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.color, animation: "pulse 1s infinite "+(i*0.2)+"s", opacity: 0.6 }} />;})}
                  <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 6 }}>{language === "hi" ? "Foxy soch rahi hai..." : "Foxy is thinking..."}</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <StructuredAnswerInput onSubmit={sendMessage} subject={activeSubject} />
        </div>
      </div>
    </div>
  );
}
