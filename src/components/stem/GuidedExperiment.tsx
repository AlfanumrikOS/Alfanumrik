'use client';

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from '@/lib/AuthContext';

/* ─── Types ─── */
export interface ExperimentResult {
  observations: Record<string, string>;
  dataEntries: string[][];
  conclusion: string;
  quizScore: number;
  totalQuestions: number;
  timeSpent: number;
}

interface GuidedExperimentProps {
  title: string; titleHi?: string; chapterRef: string;
  grade: string; subject: string; difficulty: number;
  bloomLevel: string; estimatedMinutes: number;
  objective: string; objectiveHi?: string; materials?: string[];
  simulation: ReactNode;
  observations: Array<{ prompt: string; promptHi?: string; type: 'text' | 'number' | 'select'; options?: string[]; expectedHint?: string }>;
  dataTable?: { columns: string[]; rows: number };
  conclusionPrompt: string; conclusionPromptHi?: string;
  quizQuestions?: Array<{ question: string; questionHi?: string; options: string[]; correctIndex: number; explanation: string }>;
  onComplete?: (data: ExperimentResult) => void;
  onClose: () => void;
}

/* ─── i18n + Constants ─── */
const DC: Record<number, string> = { 1: 'bg-green-100 text-green-700', 2: 'bg-blue-100 text-blue-700', 3: 'bg-red-100 text-red-700' };
const DL: Record<number, string> = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };
const BTN = 'w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl text-sm font-semibold transition-colors active:scale-[0.98] min-h-[44px]';
const INP = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none min-h-[44px]';
const L: Record<string, [string, string]> = {
  begin: ['Begin Experiment', 'प्रयोग शुरू करें'], saveObs: ['Save Observations', 'अवलोकन सहेजें'],
  saveData: ['Save Data', 'डेटा सहेजें'], submit: ['Submit Conclusion', 'निष्कर्ष जमा करें'],
  complete: ['Complete Experiment', 'प्रयोग पूरा करें'], materials: ['Materials', 'सामग्री'],
  objective: ['Objective', 'उद्देश्य'], simDone: ["I've explored enough", 'मैंने काफ़ी देख लिया'],
  showHint: ['Show Hint', 'संकेत दिखाएं'], hideHint: ['Hide Hint', 'संकेत छुपाएं'],
  yourObs: ['Your Observations', 'आपके अवलोकन'], conclusion: ['Write your conclusion', 'अपना निष्कर्ष लिखें'],
  correct: ['Correct!', 'सही!'], incorrect: ['Incorrect', 'ग़लत'],
  score: ['Score', 'स्कोर'], elapsed: ['Time elapsed', 'बीता समय'], viva: ['Viva', 'मौखिक'],
};
const t = (k: string, hi: boolean) => (L[k] ?? ['', ''])[hi ? 1 : 0];
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

/* ─── Component ─── */
export default function GuidedExperiment(props: GuidedExperimentProps) {
  const { isHi } = useAuth();
  const { title, titleHi, chapterRef, difficulty, bloomLevel, estimatedMinutes, objective, objectiveHi,
    materials, simulation, observations, dataTable, conclusionPrompt, conclusionPromptHi,
    quizQuestions, onComplete, onClose } = props;

  const hasData = !!dataTable, hasQuiz = !!quizQuestions?.length;
  const totalSteps = 4 + (hasData ? 1 : 0) + (hasQuiz ? 1 : 0);
  const [step, setStep] = useState(1);
  const [secs, setSecs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t0 = useRef(Date.now());
  const started = useRef(false);
  const [obs, setObs] = useState<Record<string, string>>({});
  const [hints, setHints] = useState<Record<number, boolean>>({});
  const [data, setData] = useState<string[][]>(() =>
    dataTable ? Array.from({ length: dataTable.rows }, () => Array(dataTable.columns.length).fill('')) : []);
  const [conclusion, setConclusion] = useState('');
  const [qi, setQi] = useState(0);
  const [qSel, setQSel] = useState<number | null>(null);
  const [qRev, setQRev] = useState(false);
  const [qScore, setQScore] = useState(0);
  const [qDone, setQDone] = useState(false);

  useEffect(() => {
    if (step >= 2 && !started.current) {
      started.current = true; t0.current = Date.now();
      timerRef.current = setInterval(() => setSecs(Math.floor((Date.now() - t0.current) / 1000)), 1000);
    }
  }, [step]);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const phase = useCallback((s: number) => {
    if (s <= 3) return (['objective', 'sim', 'observe'] as const)[s - 1];
    if (hasData && s === 4) return 'record' as const;
    if (s === (hasData ? 5 : 4)) return 'conclude' as const;
    return 'quiz' as const;
  }, [hasData]);
  const p = phase(step);
  const advance = () => setStep(s => Math.min(s + 1, totalSteps));
  const complete = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    onComplete?.({ observations: obs, dataEntries: data, conclusion, quizScore: qScore,
      totalQuestions: quizQuestions?.length ?? 0, timeSpent: Math.floor((Date.now() - t0.current) / 1000) });
    onClose();
  };
  const qAnswer = (i: number) => {
    if (qRev) return;
    setQSel(i); setQRev(true);
    if (i === quizQuestions![qi].correctIndex) setQScore(s => s + 1);
  };
  const qNext = () => {
    if (qi + 1 < quizQuestions!.length) { setQi(i => i + 1); setQSel(null); setQRev(false); }
    else setQDone(true);
  };
  const hi = (a?: string, b?: string) => isHi && a ? a : b ?? '';

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-orange-100 overflow-hidden max-w-3xl mx-auto">
      <div className="flex items-center justify-between px-4 py-3 bg-orange-50 border-b border-orange-100">
        <div className="min-w-0">
          <h2 className="font-bold text-gray-900 text-base font-[Sora] truncate">{hi(titleHi, title)}</h2>
          <p className="text-xs text-gray-500 truncate">{chapterRef}</p>
        </div>
        <button onClick={onClose} className="flex-shrink-0 ml-3 min-w-[44px] min-h-[44px] flex items-center justify-center bg-red-50 text-red-600 rounded-xl text-sm font-medium hover:bg-red-100 transition" aria-label="Close">
          {isHi ? 'बंद' : 'Close'}
        </button>
      </div>
      <div className="flex items-center justify-center gap-2 py-3">
        {Array.from({ length: totalSteps }, (_, i) => (
          <div key={i} className={`w-3 h-3 rounded-full transition-all ${i + 1 === step ? 'bg-orange-500 scale-125 ring-2 ring-orange-200' : i + 1 < step ? 'bg-orange-300' : 'bg-gray-200'}`} />
        ))}
        {step >= 2 && <span className="ml-3 text-xs text-gray-400 font-mono tabular-nums">{fmt(secs)}</span>}
      </div>
      <div className="px-4 pb-5">
        {p === 'objective' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${DC[difficulty] || 'bg-gray-100 text-gray-600'}`}>{DL[difficulty] || 'Medium'}</span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 font-medium capitalize">{bloomLevel}</span>
              <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">~{estimatedMinutes} {isHi ? 'मिनट' : 'min'}</span>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('objective', isHi)}</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{hi(objectiveHi, objective)}</p>
            </div>
            {materials?.length ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-1">{t('materials', isHi)}</h3>
                <ul className="list-disc list-inside text-sm text-gray-600 space-y-0.5">{materials.map((m, i) => <li key={i}>{m}</li>)}</ul>
              </div>
            ) : null}
            <button onClick={advance} className={BTN}>{t('begin', isHi)} &rarr;</button>
          </div>
        )}
        {p === 'sim' && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl overflow-hidden min-h-[300px] flex items-center justify-center">{simulation}</div>
            <button onClick={advance} className={BTN}>{t('simDone', isHi)} &rarr;</button>
          </div>
        )}
        {p === 'observe' && (
          <div className="space-y-3">
            {observations.map((o, i) => (
              <div key={i} className="bg-gray-50 rounded-xl p-3 space-y-2">
                <p className="text-sm font-medium text-gray-700">{hi(o.promptHi, o.prompt)}</p>
                {o.type === 'select' && o.options ? (
                  <select value={obs[String(i)] || ''} onChange={e => setObs(p => ({ ...p, [String(i)]: e.target.value }))} className={`${INP} bg-white`}>
                    <option value="">{isHi ? 'चुनें...' : 'Select...'}</option>
                    {o.options.map((v, j) => <option key={j} value={v}>{v}</option>)}
                  </select>
                ) : (
                  <input type={o.type === 'number' ? 'number' : 'text'} value={obs[String(i)] || ''} onChange={e => setObs(p => ({ ...p, [String(i)]: e.target.value }))} className={INP} />
                )}
                {o.expectedHint && (<>
                  <button onClick={() => setHints(p => ({ ...p, [i]: !p[i] }))} className="text-xs text-orange-500 font-medium min-h-[44px] min-w-[44px] px-2">
                    {hints[i] ? t('hideHint', isHi) : t('showHint', isHi)}
                  </button>
                  {hints[i] && <p className="text-xs text-orange-600 bg-orange-50 rounded-lg px-3 py-2">{o.expectedHint}</p>}
                </>)}
              </div>
            ))}
            <button onClick={advance} className={BTN}>{t('saveObs', isHi)} &rarr;</button>
          </div>
        )}
        {p === 'record' && dataTable && (
          <div className="space-y-3">
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm border-collapse">
                <thead><tr>{dataTable.columns.map((c, i) => <th key={i} className="border border-gray-200 bg-gray-50 px-3 py-2 text-left font-medium text-gray-700 text-xs">{c}</th>)}</tr></thead>
                <tbody>{data.map((row, ri) => (
                  <tr key={ri}>{row.map((cell, ci) => (
                    <td key={ci} className="border border-gray-200 p-0">
                      <input type="text" value={cell} onChange={e => { const n = data.map(r => [...r]); n[ri][ci] = e.target.value; setData(n); }} className="w-full px-2 py-2 text-sm outline-none focus:bg-orange-50 min-h-[44px]" />
                    </td>
                  ))}</tr>
                ))}</tbody>
              </table>
            </div>
            <button onClick={advance} className={BTN}>{t('saveData', isHi)} &rarr;</button>
          </div>
        )}
        {p === 'conclude' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 font-medium">{hi(conclusionPromptHi, conclusionPrompt)}</p>
            {Object.keys(obs).length > 0 && (
              <details className="bg-gray-50 rounded-xl p-3">
                <summary className="text-xs font-semibold text-gray-500 cursor-pointer min-h-[44px] flex items-center">{t('yourObs', isHi)}</summary>
                <ul className="mt-2 space-y-1 text-xs text-gray-600">
                  {observations.map((o, i) => obs[String(i)] ? <li key={i}><span className="font-medium">{hi(o.promptHi, o.prompt)}:</span> {obs[String(i)]}</li> : null)}
                </ul>
              </details>
            )}
            <textarea value={conclusion} onChange={e => setConclusion(e.target.value)} placeholder={t('conclusion', isHi)} rows={4} className="w-full rounded-xl border border-gray-200 px-3 py-3 text-sm focus:ring-2 focus:ring-orange-300 focus:border-orange-400 outline-none resize-none" />
            {hasQuiz
              ? <button onClick={advance} className={BTN}>{t('submit', isHi)} &rarr;</button>
              : <button onClick={complete} className={BTN.replace('bg-orange-500 hover:bg-orange-600', 'bg-green-500 hover:bg-green-600')}>{t('complete', isHi)}</button>}
          </div>
        )}
        {p === 'quiz' && quizQuestions && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700">{t('viva', isHi)} — {qi + 1}/{quizQuestions.length}</h3>
            {!qDone ? (<>
              <p className="text-sm text-gray-800 font-medium leading-relaxed">{hi(quizQuestions[qi].questionHi, quizQuestions[qi].question)}</p>
              <div className="space-y-2">
                {quizQuestions[qi].options.map((opt, i) => {
                  const cor = i === quizQuestions[qi].correctIndex, sel = i === qSel;
                  let c = 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-orange-50';
                  if (qRev) { if (cor) c = 'bg-green-50 border-green-400 text-green-800'; else if (sel) c = 'bg-red-50 border-red-400 text-red-800'; else c = 'bg-gray-50 border-gray-200 text-gray-400'; }
                  else if (sel) c = 'bg-orange-50 border-orange-400 text-orange-700';
                  return <button key={i} onClick={() => qAnswer(i)} disabled={qRev} className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all min-h-[44px] ${c}`}>{opt}</button>;
                })}
              </div>
              {qRev && (
                <div className={`rounded-xl px-4 py-3 text-sm ${qSel === quizQuestions[qi].correctIndex ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  <p className="font-semibold mb-1">{qSel === quizQuestions[qi].correctIndex ? t('correct', isHi) : t('incorrect', isHi)}</p>
                  <p className="text-xs">{quizQuestions[qi].explanation}</p>
                </div>
              )}
              {qRev && <button onClick={qNext} className={BTN}>{qi + 1 < quizQuestions.length ? `${isHi ? 'आगे' : 'Next'} →` : t('complete', isHi)}</button>}
            </>) : (
              <div className="text-center py-6 space-y-4">
                <div className="text-4xl">{qScore === quizQuestions.length ? '🎉' : '👍'}</div>
                <p className="text-lg font-bold text-gray-900">{t('score', isHi)}: {qScore}/{quizQuestions.length}</p>
                <p className="text-xs text-gray-400">{t('elapsed', isHi)}: {fmt(secs)}</p>
                <button onClick={complete} className={BTN}>{t('complete', isHi)}</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
