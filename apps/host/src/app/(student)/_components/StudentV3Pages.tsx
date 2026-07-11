'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { getChaptersForSubject } from '@alfanumrik/lib/supabase';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { useTodayQueue } from '@alfanumrik/lib/today/use-today-queue';
import { todayCopy } from '@alfanumrik/lib/today/copy';
import type { TodayQueueItem } from '@alfanumrik/lib/today/types';
import { safeTodayHref, studentRecommendationReason } from './student-v3-contract';
import { Button as V3Button, RecommendationCard, StatusBadge } from '@alfanumrik/ui/v3';

type Chapter = { chapter_number: number; title: string; verified_question_count?: number };

const copy = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

function reasonFor(item: TodayQueueItem, isHi: boolean): string {
  return studentRecommendationReason(item.type, isHi);
}

function StudentAuthBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { activeRole, isLoading, isLoggedIn, student } = useAuth();
  useEffect(() => {
    if (isLoading) return;
    if (!isLoggedIn) router.replace('/login');
    else if (activeRole !== 'student') router.replace(activeRole === 'guardian' ? '/parent' : activeRole === 'teacher' ? '/teacher' : '/login');
  }, [activeRole, isLoading, isLoggedIn, router]);
  if (isLoading || !isLoggedIn || activeRole !== 'student' || !student) {
    return <div className="v3-state" role="status">Loading your learning space…</div>;
  }
  return <>{children}</>;
}

export function StudentTodayV3() {
  const { student, snapshot, isHi } = useAuth();
  const { data, error, isLoading, mutate } = useTodayQueue(student?.id);

  return (
    <StudentAuthBoundary>
      <section className="v3-page" data-testid="student-v3-today">
        <header className="v3-page-header">
          <div>
            <p className="v3-eyebrow">{copy(isHi, 'Your adaptive plan', 'आपकी अनुकूली योजना')}</p>
            <h1>{copy(isHi, `Good to see you, ${student?.name ?? ''}`, `${student?.name ?? ''}, आपका स्वागत है`)}</h1>
            <p>{copy(isHi, 'One clear next step, selected from your real learning signals.', 'आपके वास्तविक सीखने के संकेतों से चुना गया एक स्पष्ट अगला कदम।')}</p>
          </div>
          <Link className="v3-icon-action" href="/foxy?from=today" aria-label={copy(isHi, 'Ask Foxy', 'फॉक्सी से पूछें')}>🦊</Link>
        </header>

        <div className="v3-metrics" aria-label={copy(isHi, 'Learning summary', 'सीखने का सारांश')}>
          <Metric label={copy(isHi, 'Mastered', 'मास्टर्ड')} value={snapshot?.topics_mastered} suffix="" />
          <Metric label={copy(isHi, 'In progress', 'जारी')} value={snapshot?.topics_in_progress} suffix="" />
          <Metric label={copy(isHi, 'Current streak', 'वर्तमान स्ट्रीक')} value={snapshot?.current_streak} suffix={copy(isHi, ' दिन', ' days')} />
        </div>

        {isLoading ? <State title={copy(isHi, 'Building today’s plan…', 'आज की योजना बन रही है…')} /> : null}
        {error ? <State title={copy(isHi, 'Today’s plan is unavailable', 'आज की योजना उपलब्ध नहीं है')} detail={copy(isHi, 'Your data was not replaced with an estimate.', 'आपके डेटा की जगह कोई अनुमान नहीं दिखाया गया है।')} action={<V3Button variant="secondary" onClick={() => void mutate()}>{copy(isHi, 'Try again', 'फिर कोशिश करें')}</V3Button>} /> : null}
        {!isLoading && !error && !data?.queue.length ? <State title={copy(isHi, 'You are caught up', 'आपका आज का काम पूरा है')} detail={copy(isHi, 'Choose practice if you would like another challenge.', 'एक और चुनौती के लिए अभ्यास चुनें।')} action={<Link className="v3-button v3-button--primary v3-button--md" href="/practice">{copy(isHi, 'Open practice', 'अभ्यास खोलें')}</Link>} /> : null}

        {data?.primary ? (
          <RecommendationCard
            accent="student"
            eyebrow={copy(isHi, 'Recommended next', 'अगला सुझाव')}
            title={todayCopy(data.primary.labelKey, isHi)}
            description={data.primary.chapterTitleHi && isHi ? data.primary.chapterTitleHi : data.primary.chapterTitle ?? copy(isHi, 'Selected from your latest learning evidence.', 'आपके नवीनतम सीखने के प्रमाण से चुना गया।')}
            reason={reasonFor(data.primary, isHi)}
            reasonLabel={copy(isHi, 'Why this is next:', 'यह अगला क्यों है:')}
            meta={<><StatusBadge tone="role">{data.primary.estMinutes} {copy(isHi, 'minutes', 'मिनट')}</StatusBadge><span>{copy(isHi, 'Updated', 'अपडेट')} {new Date(data.resolvedAt).toLocaleTimeString(isHi ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' })}</span></>}
            primaryAction={{ label: copy(isHi, 'Start now', 'अभी शुरू करें'), href: safeTodayHref(data.primary) }}
          />
        ) : null}

        {data && data.queue.length > 1 ? (
          <section className="v3-section" aria-labelledby="student-v3-later">
            <h2 id="student-v3-later">{copy(isHi, 'Later in your plan', 'योजना में आगे')}</h2>
            <div className="v3-list">
              {data.queue.slice(1).map((item) => (
                <Link className="v3-list-row" href={safeTodayHref(item)} key={`${item.rank}-${item.type}`}>
                  <span><strong>{item.chapterTitleHi && isHi ? item.chapterTitleHi : item.chapterTitle ?? todayCopy(item.labelKey, isHi)}</strong><small>{reasonFor(item, isHi)}</small></span>
                  <span aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </StudentAuthBoundary>
  );
}

export function StudentLearnV3() {
  const { student, isHi } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const selected = search?.get('subject');
  const { subjects, isLoading, error, refresh } = useAllowedSubjects();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);
  const [chapterError, setChapterError] = useState(false);
  const selectedSubject = useMemo(() => subjects.find((subject) => subject.code === selected && !subject.isLocked) ?? null, [selected, subjects]);

  useEffect(() => {
    if (!selectedSubject || !student?.grade) {
      setChapters([]);
      return;
    }
    let current = true;
    setChaptersLoading(true);
    setChapterError(false);
    getChaptersForSubject(selectedSubject.code, student.grade)
      .then((rows) => { if (current) setChapters(rows); })
      .catch(() => { if (current) setChapterError(true); })
      .finally(() => { if (current) setChaptersLoading(false); });
    return () => { current = false; };
  }, [selectedSubject, student?.grade]);

  return (
    <StudentAuthBoundary>
      <section className="v3-page" data-testid="student-v3-learn">
        <header className="v3-page-header">
          <div><p className="v3-eyebrow">{copy(isHi, `Grade ${student?.grade ?? '—'}`, `कक्षा ${student?.grade ?? '—'}`)}</p><h1>{selectedSubject ? selectedSubject.name : copy(isHi, 'Learn', 'सीखें')}</h1><p>{copy(isHi, 'Build understanding concept by concept.', 'एक-एक अवधारणा समझकर आगे बढ़ें।')}</p></div>
          <Link className="v3-icon-action" href={`/foxy?from=learn${selectedSubject ? `&subject=${encodeURIComponent(selectedSubject.code)}` : ''}`}>🦊</Link>
        </header>
        {selectedSubject ? <V3Button variant="ghost" onClick={() => router.replace('/learn')}>← {copy(isHi, 'All subjects', 'सभी विषय')}</V3Button> : null}
        {isLoading || chaptersLoading ? <State title={copy(isHi, 'Loading curriculum…', 'पाठ्यक्रम लोड हो रहा है…')} /> : null}
        {error ? <State title={copy(isHi, 'Subjects are unavailable', 'विषय उपलब्ध नहीं हैं')} action={<V3Button variant="secondary" onClick={refresh}>{copy(isHi, 'Try again', 'फिर कोशिश करें')}</V3Button>} /> : null}
        {chapterError ? <State title={copy(isHi, 'Chapters are unavailable', 'अध्याय उपलब्ध नहीं हैं')} detail={copy(isHi, 'No replacement or estimated chapters are shown.', 'कोई अनुमानित या बदला हुआ अध्याय नहीं दिखाया गया है।')} /> : null}
        {!selectedSubject && !isLoading && !error ? <div className="v3-card-grid">{subjects.map((subject) => subject.isLocked ? <article className="v3-card locked" key={subject.code}><span>{subject.icon}</span><h2>{isHi ? subject.nameHi : subject.name}</h2><p>{copy(isHi, 'Not included in the current plan', 'वर्तमान योजना में शामिल नहीं')}</p></article> : <Link className="v3-card" key={subject.code} href={`/learn?subject=${encodeURIComponent(subject.code)}`}><span>{subject.icon}</span><h2>{isHi ? subject.nameHi : subject.name}</h2><p>{copy(isHi, 'Browse concepts', 'अवधारणाएँ देखें')} →</p></Link>)}</div> : null}
        {selectedSubject && !chaptersLoading && !chapterError ? <div className="v3-list">{chapters.length ? chapters.map((chapter) => <Link className="v3-list-row" href={`/learn/${encodeURIComponent(selectedSubject.code)}/${chapter.chapter_number}`} key={chapter.chapter_number}><span><small>{copy(isHi, 'Chapter', 'अध्याय')} {chapter.chapter_number}</small><strong>{chapter.title}</strong></span><span aria-hidden="true">→</span></Link>) : <State title={copy(isHi, 'No chapters available', 'कोई अध्याय उपलब्ध नहीं')} />}</div> : null}
      </section>
    </StudentAuthBoundary>
  );
}

export function StudentPracticeV3() {
  const { isHi } = useAuth();
  const search = useSearchParams();
  const reviewMode = search?.get('mode') === 'review';
  const modes = [
    { href: '/quiz', title: copy(isHi, 'Adaptive practice', 'अनुकूली अभ्यास'), text: copy(isHi, 'Questions selected by your current learning state.', 'आपकी वर्तमान सीखने की स्थिति से चुने गए प्रश्न।') },
    { href: '/practice?mode=review', title: copy(isHi, 'Review due concepts', 'देय अवधारणाओं का रिव्यू'), text: copy(isHi, 'Strengthen learning before it fades.', 'भूलने से पहले सीख को मजबूत करें।') },
    { href: '/practice/exam', title: copy(isHi, 'Exam plan', 'परीक्षा योजना'), text: copy(isHi, 'Prepare by subject, paper and time available.', 'विषय, पेपर और उपलब्ध समय के अनुसार तैयारी करें।') },
  ];
  return <StudentAuthBoundary><section className="v3-page" data-testid="student-v3-practice"><header className="v3-page-header"><div><p className="v3-eyebrow">{copy(isHi, 'Practice with purpose', 'उद्देश्यपूर्ण अभ्यास')}</p><h1>{reviewMode ? copy(isHi, 'Review', 'रिव्यू') : copy(isHi, 'Practice', 'अभ्यास')}</h1><p>{copy(isHi, 'Choose a mode. Your results feed the next adaptive recommendation.', 'एक मोड चुनें। आपके परिणाम अगला अनुकूली सुझाव तय करेंगे।')}</p></div><Link className="v3-icon-action" href="/foxy?from=practice">🦊</Link></header>{reviewMode ? <RecommendationCard accent="student" eyebrow={copy(isHi, 'Due review', 'देय रिव्यू')} title={copy(isHi, 'Strengthen concepts before they fade', 'भूलने से पहले अवधारणाएँ मजबूत करें')} description={copy(isHi, 'Review the material currently due from your saved learning state.', 'अपनी सुरक्षित सीखने की स्थिति से अभी देय सामग्री का रिव्यू करें।')} reason={copy(isHi, 'Reviewing now protects mastery before memory decay increases.', 'अभी रिव्यू करने से भूलने की दर बढ़ने से पहले मास्टरी सुरक्षित रहती है।')} reasonLabel={copy(isHi, 'Why this is next:', 'यह अगला क्यों है:')} primaryAction={{ label: copy(isHi, 'Start review', 'रिव्यू शुरू करें'), href: '/quiz?mode=srs' }} /> : null}<div className="v3-card-grid">{modes.map((mode) => <Link className="v3-card" href={mode.href} key={mode.href}><h2>{mode.title}</h2><p>{mode.text}</p><strong>{copy(isHi, 'Open', 'खोलें')} →</strong></Link>)}</div></section></StudentAuthBoundary>;
}

export function StudentProgressV3() {
  const { snapshot, isHi } = useAuth();
  const rows = [
    [copy(isHi, 'Topics mastered', 'मास्टर्ड विषय'), snapshot?.topics_mastered],
    [copy(isHi, 'Topics in progress', 'जारी विषय'), snapshot?.topics_in_progress],
    [copy(isHi, 'Average quiz score', 'औसत क्विज़ स्कोर'), snapshot?.avg_score, '%'],
    [copy(isHi, 'Quizzes completed', 'पूरे क्विज़'), snapshot?.quizzes_taken],
  ] as const;
  return <StudentAuthBoundary><section className="v3-page" data-testid="student-v3-progress"><header className="v3-page-header"><div><p className="v3-eyebrow">{copy(isHi, 'Evidence, not estimates', 'अनुमान नहीं, प्रमाण')}</p><h1>{copy(isHi, 'Progress', 'प्रगति')}</h1><p>{copy(isHi, 'Mastery, effort and the next useful action in one place.', 'मास्टरी, प्रयास और अगला उपयोगी कदम एक ही जगह।')}</p></div></header><div className="v3-metrics">{rows.map(([label, value, suffix]) => <Metric key={label} label={label} value={value} suffix={suffix ?? ''} />)}</div><RecommendationCard accent="student" eyebrow={copy(isHi, 'Next action', 'अगला कदम')} title={copy(isHi, 'Continue from Today', 'Today से आगे बढ़ें')} description={copy(isHi, 'Open the single ranked recommendation for your current learning state.', 'अपनी वर्तमान सीखने की स्थिति के लिए एक प्राथमिक सुझाव खोलें।')} reason={copy(isHi, 'Today uses the latest available learning evidence.', 'Today नवीनतम उपलब्ध सीखने के प्रमाण का उपयोग करता है।')} reasonLabel={copy(isHi, 'Why this is next:', 'यह अगला क्यों है:')} primaryAction={{ label: copy(isHi, 'View today’s plan', 'आज की योजना देखें'), href: '/today' }} /></section></StudentAuthBoundary>;
}

export function StudentExamV3() {
  const { isHi } = useAuth();
  return (
    <StudentAuthBoundary>
      <section className="v3-page" data-testid="student-v3-exam-plan">
        <header className="v3-page-header">
          <div><p className="v3-eyebrow">{copy(isHi, 'Exam preparation', 'परीक्षा तैयारी')}</p><h1>{copy(isHi, 'Exam plan', 'परीक्षा योजना')}</h1><p>{copy(isHi, 'Use your existing preparation plan or take a timed mock paper.', 'अपनी मौजूदा तैयारी योजना देखें या समयबद्ध मॉक पेपर दें।')}</p></div>
          <Link className="v3-icon-action" href="/foxy?from=exam">🦊</Link>
        </header>
        <div className="v3-card-grid">
          <Link className="v3-card" href="/exam-prep"><h2>{copy(isHi, 'Preparation plan', 'तैयारी योजना')}</h2><p>{copy(isHi, 'Continue the governed subject and chapter plan.', 'विषय और अध्याय की नियंत्रित योजना जारी रखें।')}</p><strong>{copy(isHi, 'Open plan', 'योजना खोलें')} →</strong></Link>
          <Link className="v3-card" href="/practice/exam/mock"><h2>{copy(isHi, 'Mock exam', 'मॉक परीक्षा')}</h2><p>{copy(isHi, 'Practise under exam conditions and review evidence.', 'परीक्षा जैसी परिस्थितियों में अभ्यास और प्रमाण का रिव्यू करें।')}</p><strong>{copy(isHi, 'Choose a paper', 'पेपर चुनें')} →</strong></Link>
        </div>
      </section>
    </StudentAuthBoundary>
  );
}

function Metric({ label, value, suffix }: { label: string; value: number | null | undefined; suffix: string }) {
  return <article className="v3-metric"><small>{label}</small><strong>{value == null ? '—' : `${value.toLocaleString('en-IN')}${suffix}`}</strong></article>;
}

function State({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="v3-state" role="status"><strong>{title}</strong>{detail ? <p>{detail}</p> : null}{action}</div>;
}
