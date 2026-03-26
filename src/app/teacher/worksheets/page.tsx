'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { SUBJECT_META } from '@/lib/constants';
import { BottomNav } from '@/components/ui';

const GRADES = ['6', '7', '8', '9', '10', '11', '12'];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
const Q_TYPES = ['MCQ', 'Fill in the Blanks', 'Short Answer', 'True/False', 'Match the Following'] as const;

interface SavedWorksheet {
  id: string;
  title: string;
  subject: string;
  grade: string;
  date: string;
  questionCount: number;
}

interface GeneratedQuestion {
  type: string;
  question: string;
  answer?: string;
}

const QUESTION_BANK: Record<string, Record<string, GeneratedQuestion[]>> = {
  math: {
    MCQ: [
      { type: 'MCQ', question: 'The value of sin 30° is:\n(a) 1/2  (b) √3/2  (c) 1  (d) 0', answer: '(a) 1/2' },
      { type: 'MCQ', question: 'If x² - 5x + 6 = 0, then x equals:\n(a) 2, 3  (b) -2, -3  (c) 1, 6  (d) -1, -6', answer: '(a) 2, 3' },
      { type: 'MCQ', question: 'The HCF of 12 and 18 is:\n(a) 2  (b) 3  (c) 6  (d) 36', answer: '(c) 6' },
      { type: 'MCQ', question: 'The sum of angles of a triangle is:\n(a) 90°  (b) 180°  (c) 270°  (d) 360°', answer: '(b) 180°' },
      { type: 'MCQ', question: 'The area of a circle with radius 7 cm is:\n(a) 44 cm²  (b) 154 cm²  (c) 22 cm²  (d) 308 cm²', answer: '(b) 154 cm²' },
    ],
    'Fill in the Blanks': [
      { type: 'Fill in the Blanks', question: 'The value of π is approximately _______.', answer: '3.14159 (or 22/7)' },
      { type: 'Fill in the Blanks', question: 'A quadrilateral with all sides equal and all angles 90° is called a _______.', answer: 'Square' },
      { type: 'Fill in the Blanks', question: 'The LCM of 4 and 6 is _______.', answer: '12' },
      { type: 'Fill in the Blanks', question: 'The derivative of x² is _______.', answer: '2x' },
    ],
    'Short Answer': [
      { type: 'Short Answer', question: 'Find the roots of the equation: x² - 7x + 12 = 0', answer: 'x = 3, x = 4' },
      { type: 'Short Answer', question: 'Calculate the area of a triangle with base 10 cm and height 6 cm.', answer: 'Area = ½ × 10 × 6 = 30 cm²' },
      { type: 'Short Answer', question: 'If the ratio of two numbers is 3:5 and their sum is 160, find the numbers.', answer: '60 and 100' },
    ],
    'True/False': [
      { type: 'True/False', question: 'The square root of 144 is 14.', answer: 'False (it is 12)' },
      { type: 'True/False', question: 'Every integer is a rational number.', answer: 'True' },
      { type: 'True/False', question: 'The diagonals of a rectangle are equal.', answer: 'True' },
    ],
    'Match the Following': [
      { type: 'Match the Following', question: 'Match:\nA. Circle area      1. πr\nB. Circumference    2. πr²\nC. Sphere volume    3. 2πr\nD. Sphere surface   4. 4/3 πr³\n                    5. 4πr²', answer: 'A→2, B→3, C→4, D→5' },
    ],
  },
  science: {
    MCQ: [
      { type: 'MCQ', question: 'The SI unit of force is:\n(a) Watt  (b) Joule  (c) Newton  (d) Pascal', answer: '(c) Newton' },
      { type: 'MCQ', question: 'Photosynthesis takes place in:\n(a) Mitochondria  (b) Chloroplast  (c) Nucleus  (d) Ribosome', answer: '(b) Chloroplast' },
      { type: 'MCQ', question: 'The pH of pure water is:\n(a) 0  (b) 7  (c) 14  (d) 1', answer: '(b) 7' },
      { type: 'MCQ', question: 'Which gas is released during photosynthesis?\n(a) CO₂  (b) N₂  (c) O₂  (d) H₂', answer: '(c) O₂' },
      { type: 'MCQ', question: 'The powerhouse of the cell is:\n(a) Nucleus  (b) Ribosome  (c) Mitochondria  (d) Golgi body', answer: '(c) Mitochondria' },
    ],
    'Fill in the Blanks': [
      { type: 'Fill in the Blanks', question: 'The chemical formula of water is _______.', answer: 'H₂O' },
      { type: 'Fill in the Blanks', question: 'The speed of light is approximately _______ m/s.', answer: '3 × 10⁸' },
      { type: 'Fill in the Blanks', question: 'The process of converting sugar into alcohol is called _______.', answer: 'Fermentation' },
    ],
    'Short Answer': [
      { type: 'Short Answer', question: 'What is Newton\'s third law of motion? Give one example.', answer: 'For every action, there is an equal and opposite reaction. E.g., rocket propulsion.' },
      { type: 'Short Answer', question: 'Differentiate between mitosis and meiosis.', answer: 'Mitosis: 2 identical daughter cells; Meiosis: 4 genetically different cells with half chromosomes.' },
      { type: 'Short Answer', question: 'What is an acid-base indicator? Name two examples.', answer: 'Substance that shows different colors in acidic and basic solutions. E.g., Litmus, Phenolphthalein.' },
    ],
    'True/False': [
      { type: 'True/False', question: 'Sound travels faster in air than in water.', answer: 'False (sound travels faster in water)' },
      { type: 'True/False', question: 'All metals are good conductors of electricity.', answer: 'True (with some exceptions like Bismuth)' },
      { type: 'True/False', question: 'The human body has 206 bones.', answer: 'True' },
    ],
    'Match the Following': [
      { type: 'Match the Following', question: 'Match the vitamin with its deficiency disease:\nA. Vitamin A    1. Scurvy\nB. Vitamin B₁   2. Night blindness\nC. Vitamin C    3. Rickets\nD. Vitamin D    4. Beriberi', answer: 'A→2, B→4, C→1, D→3' },
    ],
  },
};

// Fallback for subjects without a specific bank
const DEFAULT_BANK: Record<string, GeneratedQuestion[]> = {
  MCQ: [
    { type: 'MCQ', question: 'Sample MCQ question for this topic.\n(a) Option A  (b) Option B  (c) Option C  (d) Option D', answer: '(Refer textbook)' },
  ],
  'Fill in the Blanks': [
    { type: 'Fill in the Blanks', question: 'A key concept related to this topic is _______.', answer: '(Refer textbook)' },
  ],
  'Short Answer': [
    { type: 'Short Answer', question: 'Explain the main concept of this topic in your own words.', answer: '(Refer textbook)' },
  ],
  'True/False': [
    { type: 'True/False', question: 'This topic is part of the CBSE curriculum.', answer: 'True' },
  ],
  'Match the Following': [
    { type: 'Match the Following', question: 'Match the terms with their definitions (refer to your textbook for this topic).', answer: '(Refer textbook)' },
  ],
};

export default function TeacherWorksheetsPage() {
  const { teacher, isLoggedIn, isLoading: authLoading, activeRole } = useAuth();
  const router = useRouter();

  const [subject, setSubject] = useState('math');
  const [grade, setGrade] = useState('10');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<typeof DIFFICULTIES[number]>('Medium');
  const [questionCount, setQuestionCount] = useState(10);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['MCQ', 'Short Answer']);
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [generated, setGenerated] = useState<GeneratedQuestion[] | null>(null);
  const [savedList, setSavedList] = useState<SavedWorksheet[]>([]);
  const [isPrintView, setIsPrintView] = useState(false);

  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) router.replace('/');
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('alfanumrik_worksheets');
      if (saved) setSavedList(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const toggleType = (t: string) => {
    setSelectedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const generateWorksheet = () => {
    if (selectedTypes.length === 0) return;
    const bank = QUESTION_BANK[subject] || DEFAULT_BANK;
    const questions: GeneratedQuestion[] = [];
    const perType = Math.ceil(questionCount / selectedTypes.length);

    for (const type of selectedTypes) {
      const pool = bank[type] || DEFAULT_BANK[type] || [];
      for (let i = 0; i < perType && questions.length < questionCount; i++) {
        questions.push(pool[i % pool.length]);
      }
    }

    setGenerated(questions.slice(0, questionCount));

    const entry: SavedWorksheet = {
      id: Date.now().toString(),
      title: topic || `${SUBJECT_META.find(s => s.code === subject)?.name || subject} Worksheet`,
      subject,
      grade,
      date: new Date().toLocaleDateString('en-IN'),
      questionCount: Math.min(questions.length, questionCount),
    };
    const updated = [entry, ...savedList].slice(0, 20);
    setSavedList(updated);
    try { localStorage.setItem('alfanumrik_worksheets', JSON.stringify(updated)); } catch { /* ignore */ }
  };

  const handlePrint = () => {
    setIsPrintView(true);
    setTimeout(() => { window.print(); setIsPrintView(false); }, 200);
  };

  const subjectName = SUBJECT_META.find(s => s.code === subject)?.name || subject;

  if (authLoading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ fontSize: 48 }}>📝</div></div>;

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', paddingBottom: 100 }}>
      {!isPrintView && (
        <>
          {/* Header */}
          <div style={{ background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)', padding: '32px 20px 28px', color: '#fff', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📝</div>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'Sora, sans-serif' }}>Worksheet Generator</h1>
            <p style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>Create printable worksheets for your students</p>
          </div>

          {/* Form */}
          <div style={{ padding: '20px', maxWidth: 600, margin: '0 auto' }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb', marginBottom: 16 }}>
              {/* Subject */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 8 }}>Subject</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {SUBJECT_META.filter(s => ['math', 'science', 'physics', 'chemistry', 'biology', 'english', 'hindi'].includes(s.code)).map(s => (
                    <button key={s.code} onClick={() => setSubject(s.code)} style={{
                      padding: '7px 14px', borderRadius: 10, border: '1.5px solid',
                      borderColor: subject === s.code ? '#2563EB' : '#e0e0e0',
                      background: subject === s.code ? '#2563EB' : '#fff',
                      color: subject === s.code ? '#fff' : '#555',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                      {s.icon} {s.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grade */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 8 }}>Grade</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {GRADES.map(g => (
                    <button key={g} onClick={() => setGrade(g)} style={{
                      padding: '6px 14px', borderRadius: 8, border: '1.5px solid',
                      borderColor: grade === g ? '#2563EB' : '#e0e0e0',
                      background: grade === g ? '#EFF6FF' : '#fff',
                      color: grade === g ? '#2563EB' : '#888',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                      {g}
                    </button>
                  ))}
                </div>
              </div>

              {/* Topic */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 6 }}>Topic (optional)</label>
                <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g., Quadratic Equations, Light and Reflection"
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e0e0e0', fontSize: 14, outline: 'none' }} />
              </div>

              {/* Difficulty */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 8 }}>Difficulty</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {DIFFICULTIES.map(d => (
                    <button key={d} onClick={() => setDifficulty(d)} style={{
                      padding: '7px 18px', borderRadius: 10, border: '1.5px solid',
                      borderColor: difficulty === d ? '#2563EB' : '#e0e0e0',
                      background: difficulty === d ? '#2563EB' : '#fff',
                      color: difficulty === d ? '#fff' : '#555',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Question Count */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 6 }}>
                  Number of Questions: {questionCount}
                </label>
                <input type="range" min={5} max={30} step={5} value={questionCount} onChange={e => setQuestionCount(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: '#2563EB' }} />
              </div>

              {/* Question Types */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 8 }}>Question Types</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Q_TYPES.map(t => (
                    <button key={t} onClick={() => toggleType(t)} style={{
                      padding: '6px 12px', borderRadius: 8, border: '1.5px solid',
                      borderColor: selectedTypes.includes(t) ? '#2563EB' : '#e0e0e0',
                      background: selectedTypes.includes(t) ? '#EFF6FF' : '#fff',
                      color: selectedTypes.includes(t) ? '#2563EB' : '#888',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>
                      {selectedTypes.includes(t) ? '✓ ' : ''}{t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Answer Key Toggle */}
              <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => setIncludeAnswers(!includeAnswers)} style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: includeAnswers ? '#2563EB' : '#d1d5db', position: 'relative', transition: 'background 0.2s',
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 3, left: includeAnswers ? 23 : 3, transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </button>
                <span style={{ fontSize: 13, color: '#555', fontWeight: 500 }}>Include Answer Key</span>
              </div>

              {/* Generate Button */}
              <button onClick={generateWorksheet} disabled={selectedTypes.length === 0}
                style={{
                  width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                  background: selectedTypes.length > 0 ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : '#d1d5db',
                  color: '#fff', fontSize: 14, fontWeight: 700, cursor: selectedTypes.length > 0 ? 'pointer' : 'not-allowed',
                }}>
                Generate Worksheet
              </button>
            </div>

            {/* Recent Worksheets */}
            {savedList.length > 0 && !generated && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 12 }}>Recent Worksheets</div>
                {savedList.slice(0, 5).map(ws => (
                  <div key={ws.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{ws.title}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>Class {ws.grade} · {ws.questionCount} questions · {ws.date}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Generated Worksheet */}
      {generated && (
        <div style={{ padding: '20px', maxWidth: 700, margin: '0 auto' }}>
          {!isPrintView && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <button onClick={() => setGenerated(null)} style={{
                padding: '8px 18px', borderRadius: 10, border: '1px solid #e0e0e0',
                background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: '#555',
              }}>
                ← Back
              </button>
              <button onClick={handlePrint} style={{
                padding: '8px 18px', borderRadius: 10, border: 'none',
                background: '#2563EB', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
                🖨 Print Worksheet
              </button>
            </div>
          )}

          <div style={{ background: '#fff', borderRadius: isPrintView ? 0 : 16, padding: isPrintView ? '20px 0' : 24, border: isPrintView ? 'none' : '1px solid #e5e7eb' }}>
            {/* Worksheet Header */}
            <div style={{ textAlign: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid #1a1a1a' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>
                {teacher?.school_name || 'Alfanumrik School'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#555', marginTop: 8 }}>
                {subjectName} Worksheet — Class {grade}
              </div>
              {topic && <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Topic: {topic}</div>}
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                Date: {new Date().toLocaleDateString('en-IN')} · Difficulty: {difficulty} · Total Marks: {questionCount}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 12, color: '#555' }}>
                <span>Name: _________________________</span>
                <span>Roll No: ________</span>
              </div>
            </div>

            {/* Questions */}
            {(() => {
              const grouped: Record<string, GeneratedQuestion[]> = {};
              generated.forEach(q => {
                if (!grouped[q.type]) grouped[q.type] = [];
                grouped[q.type].push(q);
              });

              let qNum = 0;
              return Object.entries(grouped).map(([type, questions]) => (
                <div key={type} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#2563EB', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Section: {type}
                  </div>
                  {questions.map((q, i) => {
                    qNum++;
                    return (
                      <div key={i} style={{ marginBottom: 14, paddingLeft: 4 }}>
                        <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                          <strong>Q{qNum}.</strong> {q.question}
                        </div>
                        {type === 'Short Answer' && (
                          <div style={{ marginTop: 8, borderBottom: '1px dotted #ccc', height: 60 }} />
                        )}
                      </div>
                    );
                  })}
                </div>
              ));
            })()}

            {/* Answer Key */}
            {includeAnswers && (
              <div style={{ marginTop: 30, paddingTop: 16, borderTop: '2px dashed #ccc' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 10 }}>Answer Key</div>
                {(() => {
                  let aNum = 0;
                  return generated.map((q, i) => {
                    aNum++;
                    return (
                      <div key={i} style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                        <strong>Q{aNum}:</strong> {q.answer || '(See textbook)'}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {!isPrintView && (
            <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: '#888' }}>
              Tip: Use your browser&apos;s Print → &quot;Save as PDF&quot; to download as PDF
            </div>
          )}
        </div>
      )}
      <BottomNav />
    </div>
  );
}
