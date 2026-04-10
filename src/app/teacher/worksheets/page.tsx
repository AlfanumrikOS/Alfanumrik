'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useRouter } from 'next/navigation';
import { SUBJECT_META } from '@/lib/constants';
import { BottomNav } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { VALID_GRADES } from '@/lib/identity';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const tt = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

const GRADES = VALID_GRADES;
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'] as const;
const Q_TYPES = ['MCQ', 'Fill in the Blanks', 'Short Answer', 'True/False', 'Match the Following'] as const;

const DIFFICULTY_LABELS: Record<string, Record<string, string>> = {
  Easy: { en: 'Easy', hi: 'आसान' },
  Medium: { en: 'Medium', hi: 'मध्यम' },
  Hard: { en: 'Hard', hi: 'कठिन' },
};

const QTYPE_LABELS: Record<string, Record<string, string>> = {
  'MCQ': { en: 'MCQ', hi: 'बहुविकल्पीय' },
  'Fill in the Blanks': { en: 'Fill in the Blanks', hi: 'रिक्त स्थान भरें' },
  'Short Answer': { en: 'Short Answer', hi: 'लघु उत्तर' },
  'True/False': { en: 'True/False', hi: 'सही/गलत' },
  'Match the Following': { en: 'Match the Following', hi: 'मिलान करें' },
};

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

// No hardcoded question bank -- questions are fetched from the question_bank table.

async function fetchQuestionsFromBank(
  subject: string,
  grade: string,
  count: number,
  difficulty?: string,
): Promise<GeneratedQuestion[] | null> {
  try {
    let query = supabase
      .from('question_bank')
      .select('question_text, options, correct_answer_index, explanation, difficulty, bloom_level')
      .eq('subject', subject)
      .eq('grade', grade)
      .eq('is_active', true)
      .limit(count * 3);

    if (difficulty) {
      const difficultyNum = difficulty === 'easy' ? 1 : difficulty === 'medium' ? 2 : 3;
      query = query.eq('difficulty', difficultyNum);
    }

    const { data } = await query;
    if (!data || data.length === 0) return null;

    // Shuffle and take requested count
    const shuffled = data.sort(() => Math.random() - 0.5).slice(0, count);
    return shuffled.map(q => {
      const opts = Array.isArray(q.options)
        ? q.options
        : typeof q.options === 'string'
          ? JSON.parse(q.options)
          : [];
      return {
        type: 'MCQ',
        question:
          q.question_text +
          '\n' +
          (opts as string[]).map((o: string, i: number) => `(${String.fromCharCode(97 + i)}) ${o}`).join('  '),
        answer: opts[q.correct_answer_index] || 'See explanation',
        explanation: q.explanation || '',
      };
    });
  } catch {
    return null;
  }
}

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
  const { teacher, isLoggedIn, isLoading: authLoading, activeRole, isHi } = useAuth();
  const router = useRouter();

  const [subject, setSubject] = useState('math');
  const [grade, setGrade] = useState('10');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<typeof DIFFICULTIES[number]>('Medium');
  const [questionCount, setQuestionCount] = useState(10);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['MCQ', 'Short Answer']);
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [generated, setGenerated] = useState<GeneratedQuestion[] | null>(null);
  const [questionSource, setQuestionSource] = useState<'db' | 'fallback' | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [savedList, setSavedList] = useState<SavedWorksheet[]>([]);
  const [isPrintView, setIsPrintView] = useState(false);

  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) router.replace('/login');
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

  const generateWorksheet = async () => {
    if (selectedTypes.length === 0) return;
    setIsGenerating(true);

    // Fetch questions from the question_bank table
    const dbQuestions = await fetchQuestionsFromBank(
      subject,
      grade,
      questionCount,
      difficulty.toLowerCase(),
    );

    let questions: GeneratedQuestion[];
    let source: 'db' | 'fallback';

    if (dbQuestions && dbQuestions.length > 0) {
      source = 'db';

      // DB returns MCQ-formatted questions; assign requested types proportionally
      const hasMCQ = selectedTypes.includes('MCQ');
      const nonMCQTypes = selectedTypes.filter(t => t !== 'MCQ');

      if (nonMCQTypes.length === 0 || !hasMCQ) {
        // Only MCQ selected, or only non-MCQ — use DB questions as MCQs
        questions = dbQuestions.slice(0, questionCount);
        // Re-label if teacher selected only a non-MCQ type
        if (!hasMCQ && selectedTypes.length === 1) {
          questions = questions.map(q => ({ ...q, type: selectedTypes[0] }));
        }
      } else {
        // Mix: allocate MCQ portion from DB, fill non-MCQ types from DB too (re-labelled)
        const mcqCount = Math.ceil(questionCount / selectedTypes.length);
        const remainingCount = questionCount - mcqCount;
        const mcqSlice = dbQuestions.slice(0, mcqCount);

        const otherPool = dbQuestions.slice(mcqCount);
        const otherQuestions: GeneratedQuestion[] = [];
        const perOtherType = Math.ceil(remainingCount / nonMCQTypes.length);
        let poolIdx = 0;

        for (const type of nonMCQTypes) {
          for (let i = 0; i < perOtherType && otherQuestions.length < remainingCount; i++) {
            if (poolIdx < otherPool.length) {
              // Use DB question re-labelled as the requested type
              otherQuestions.push({ ...otherPool[poolIdx], type });
              poolIdx++;
            } else {
              // Exhausted DB pool — use fallback placeholder
              otherQuestions.push(DEFAULT_BANK[type]?.[0] || { type, question: `${type} question — refer to your textbook.`, answer: '(Refer textbook)' });
            }
          }
        }

        questions = [...mcqSlice, ...otherQuestions].slice(0, questionCount);
      }
    } else {
      // Fallback when the DB returns no questions for this subject/grade
      source = 'fallback';
      questions = [];
      const perType = Math.ceil(questionCount / selectedTypes.length);

      for (const type of selectedTypes) {
        const pool = DEFAULT_BANK[type] || [];
        for (let i = 0; i < perType && questions.length < questionCount; i++) {
          questions.push(pool[i % pool.length]);
        }
      }
      questions = questions.slice(0, questionCount);
    }

    setGenerated(questions);
    setQuestionSource(source);
    setIsGenerating(false);

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
          <div style={{ background: 'linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)', padding: '32px 20px 28px', color: '#fff', position: 'relative' }}>
            <button
              onClick={() => router.push('/teacher')}
              style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8, padding: '6px 12px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              &larr; {tt(isHi, 'डैशबोर्ड', 'Dashboard')}
            </button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📝</div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, fontFamily: 'Sora, sans-serif' }}>{tt(isHi, 'Worksheet Generator', 'वर्कशीट जनरेटर')}</h1>
              <p style={{ fontSize: 13, opacity: 0.8, marginTop: 6 }}>{tt(isHi, 'Create printable worksheets for your students', 'अपने छात्रों के लिए प्रिंट योग्य वर्कशीट बनाएं')}</p>
            </div>
          </div>

          {/* Form */}
          <div style={{ padding: '20px', maxWidth: 600, margin: '0 auto' }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb', marginBottom: 16 }}>
              {/* Subject */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 8 }}>{tt(isHi, 'Subject', 'विषय')}</label>
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
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 8 }}>{tt(isHi, 'Grade', 'कक्षा')}</label>
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
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 6 }}>{tt(isHi, 'Topic (optional)', 'विषय (वैकल्पिक)')}</label>
                <input value={topic} onChange={e => setTopic(e.target.value)} placeholder={tt(isHi, 'e.g., Quadratic Equations, Light and Reflection', 'जैसे, द्विघात समीकरण, प्रकाश और परावर्तन')}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e0e0e0', fontSize: 14, outline: 'none' }} />
              </div>

              {/* Difficulty */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 8 }}>{tt(isHi, 'Difficulty', 'कठिनाई स्तर')}</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {DIFFICULTIES.map(d => (
                    <button key={d} onClick={() => setDifficulty(d)} style={{
                      padding: '7px 18px', borderRadius: 10, border: '1.5px solid',
                      borderColor: difficulty === d ? '#2563EB' : '#e0e0e0',
                      background: difficulty === d ? '#2563EB' : '#fff',
                      color: difficulty === d ? '#fff' : '#555',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                      {isHi ? DIFFICULTY_LABELS[d]?.hi || d : d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Question Count */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 6 }}>
                  {tt(isHi, `Number of Questions: ${questionCount}`, `प्रश्नों की संख्या: ${questionCount}`)}
                </label>
                <input type="range" min={5} max={30} step={5} value={questionCount} onChange={e => setQuestionCount(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: '#2563EB' }} />
              </div>

              {/* Question Types */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 8 }}>{tt(isHi, 'Question Types', 'प्रश्न प्रकार')}</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Q_TYPES.map(t => (
                    <button key={t} onClick={() => toggleType(t)} style={{
                      padding: '6px 12px', borderRadius: 8, border: '1.5px solid',
                      borderColor: selectedTypes.includes(t) ? '#2563EB' : '#e0e0e0',
                      background: selectedTypes.includes(t) ? '#EFF6FF' : '#fff',
                      color: selectedTypes.includes(t) ? '#2563EB' : '#888',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}>
                      {selectedTypes.includes(t) ? '✓ ' : ''}{isHi ? QTYPE_LABELS[t]?.hi || t : t}
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
                <span style={{ fontSize: 13, color: '#555', fontWeight: 500 }}>{tt(isHi, 'Include Answer Key', 'उत्तर कुंजी शामिल करें')}</span>
              </div>

              {/* Generate Button */}
              <button onClick={generateWorksheet} disabled={selectedTypes.length === 0 || isGenerating}
                style={{
                  width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                  background: selectedTypes.length > 0 && !isGenerating ? 'linear-gradient(135deg, #2563EB, #1D4ED8)' : '#d1d5db',
                  color: '#fff', fontSize: 14, fontWeight: 700, cursor: selectedTypes.length > 0 && !isGenerating ? 'pointer' : 'not-allowed',
                }}>
                {isGenerating ? tt(isHi, 'Generating...', 'बना रहे हैं...') : tt(isHi, 'Generate Worksheet', 'वर्कशीट बनाएं')}
              </button>
            </div>

            {/* Recent Worksheets */}
            {savedList.length > 0 && !generated && (
              <div style={{ background: '#fff', borderRadius: 16, padding: 20, border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 12 }}>{tt(isHi, 'Recent Worksheets', 'हाल की वर्कशीट')}</div>
                {savedList.slice(0, 5).map(ws => (
                  <div key={ws.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{ws.title}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{tt(isHi, 'Class', 'कक्षा')} {ws.grade} · {ws.questionCount} {tt(isHi, 'questions', 'प्रश्न')} · {ws.date}</div>
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
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => { setGenerated(null); setQuestionSource(null); }} style={{
                padding: '8px 18px', borderRadius: 10, border: '1px solid #e0e0e0',
                background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: '#555',
              }}>
                {tt(isHi, '← Back', '← वापस')}
              </button>
              <button onClick={handlePrint} style={{
                padding: '8px 18px', borderRadius: 10, border: 'none',
                background: '#2563EB', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>
                {tt(isHi, 'Print Worksheet', 'वर्कशीट प्रिंट करें')}
              </button>
              {questionSource && (
                <span style={{
                  marginLeft: 'auto',
                  padding: '4px 12px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontWeight: 600,
                  background: questionSource === 'db' ? '#ECFDF5' : '#FEF3C7',
                  color: questionSource === 'db' ? '#065F46' : '#92400E',
                  border: `1px solid ${questionSource === 'db' ? '#A7F3D0' : '#FDE68A'}`,
                }}>
                  {questionSource === 'db' ? tt(isHi, 'Questions from CBSE bank', 'CBSE बैंक से प्रश्न') : tt(isHi, 'Sample questions', 'नमूना प्रश्न')}
                </span>
              )}
            </div>
          )}

          <div style={{ background: '#fff', borderRadius: isPrintView ? 0 : 16, padding: isPrintView ? '20px 0' : 24, border: isPrintView ? 'none' : '1px solid #e5e7eb' }}>
            {/* Worksheet Header */}
            <div style={{ textAlign: 'center', marginBottom: 20, paddingBottom: 16, borderBottom: '2px solid #1a1a1a' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>
                {teacher?.school_name || 'Alfanumrik School'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#555', marginTop: 8 }}>
                {subjectName} {tt(isHi, 'Worksheet', 'वर्कशीट')} — {tt(isHi, 'Class', 'कक्षा')} {grade}
              </div>
              {topic && <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>{tt(isHi, 'Topic', 'विषय')}: {topic}</div>}
              <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                {tt(isHi, 'Date', 'दिनांक')}: {new Date().toLocaleDateString('en-IN')} · {tt(isHi, 'Difficulty', 'कठिनाई')}: {isHi ? DIFFICULTY_LABELS[difficulty]?.hi || difficulty : difficulty} · {tt(isHi, 'Total Marks', 'कुल अंक')}: {questionCount}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 12, color: '#555' }}>
                <span>{tt(isHi, 'Name', 'नाम')}: _________________________</span>
                <span>{tt(isHi, 'Roll No', 'रोल नंबर')}: ________</span>
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
                    {tt(isHi, 'Section', 'खंड')}: {isHi ? QTYPE_LABELS[type]?.hi || type : type}
                  </div>
                  {questions.map((q, i) => {
                    qNum++;
                    return (
                      <div key={i} style={{ marginBottom: 14, paddingLeft: 4 }}>
                        <div style={{ fontSize: 13, color: '#1a1a1a', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                          <strong>{tt(isHi, 'Q', 'प्र')}{qNum}.</strong> {q.question}
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
                <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 10 }}>{tt(isHi, 'Answer Key', 'उत्तर कुंजी')}</div>
                {(() => {
                  let aNum = 0;
                  return generated.map((q, i) => {
                    aNum++;
                    return (
                      <div key={i} style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>
                        <strong>{tt(isHi, 'Q', 'प्र')}{aNum}:</strong> {q.answer || tt(isHi, '(See textbook)', '(पाठ्यपुस्तक देखें)')}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {!isPrintView && (
            <div style={{ marginTop: 12, textAlign: 'center', fontSize: 12, color: '#888' }}>
              {tt(isHi, 'Tip: Use your browser\'s Print \u2192 "Save as PDF" to download as PDF', 'सुझाव: PDF डाउनलोड करने के लिए ब्राउज़र का Print \u2192 "Save as PDF" उपयोग करें')}
            </div>
          )}
        </div>
      )}
      <BottomNav />
    </div>
  );
}
