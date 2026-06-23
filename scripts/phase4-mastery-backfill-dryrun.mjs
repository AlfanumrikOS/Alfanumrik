// Phase 4 mastery-backfill DRY RUN — read-only. No writes.
// Computes: the 9 quiz-takers with ZERO concept_mastery rows, the (student,topic)
// pairs to backfill, responses per pair, NULL-topic responses skipped, and the
// pre-snapshot of SUM(xp_total)/SUM(score_percent)/COUNT(quiz_sessions).
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : ''; };
const SUPABASE_URL = get('NEXT_PUBLIC_SUPABASE_URL');
const SERVICE_KEY = get('SUPABASE_SERVICE_ROLE_KEY');
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('missing env'); process.exit(1); }

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// page through a table selecting given columns, optional filter via builder fn
async function fetchAll(table, columns, build) {
  const pageSize = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    let q = sb.from(table).select(columns).range(from, from + pageSize - 1);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

(async () => {
  // 1. Students who HAVE concept_mastery rows (to exclude)
  const cm = await fetchAll('concept_mastery', 'student_id');
  const studentsWithMastery = new Set(cm.map(r => r.student_id));

  // 2. Students who have quiz_sessions (quiz history)
  const sessions = await fetchAll('quiz_sessions', 'id,student_id,score_percent,is_completed');
  const studentsWithSessions = new Set(sessions.map(s => s.student_id));

  // 3. quiz-takers with ZERO concept_mastery rows
  const quizTakersNoMastery = [...studentsWithSessions].filter(s => !studentsWithMastery.has(s));
  quizTakersNoMastery.sort();

  // 4. quiz_responses for those students
  const responses = await fetchAll(
    'quiz_responses',
    'id,student_id,question_id,is_correct,time_taken_seconds,created_at,question_number',
    (q) => q.in('student_id', quizTakersNoMastery)
  );

  // 5. question_bank for the referenced questions (topic_id, bloom, difficulty, subject, grade, chapter)
  const qids = [...new Set(responses.map(r => r.question_id).filter(Boolean))];
  const questions = {};
  for (let i = 0; i < qids.length; i += 300) {
    const chunk = qids.slice(i, i + 300);
    const qb = await fetchAll('question_bank', 'id,topic_id,bloom_level,difficulty,subject,grade,chapter_number', (q) => q.in('id', chunk));
    qb.forEach(q => { questions[q.id] = q; });
  }

  // 5b. fetch curriculum_topics + subjects for NULL topic_id fallback
  const topics = await fetchAll('curriculum_topics', 'id,subject_id,grade,chapter_number,is_active,display_order');
  const subjects = await fetchAll('subjects', 'id,code');
  const subjById = {}; subjects.forEach(s => subjById[s.id] = s.code);
  // build fallback index: key subject_code|grade|chapter -> sorted active topics by display_order
  const fbIndex = {};
  for (const t of topics) {
    if (t.is_active !== true) continue;
    const code = subjById[t.subject_id];
    if (!code) continue;
    const key = `${code}|${t.grade}|${t.chapter_number}`;
    (fbIndex[key] ||= []).push(t);
  }
  for (const k of Object.keys(fbIndex)) {
    fbIndex[k].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  }
  const resolveTopic = (qb) => {
    if (!qb) return null;
    if (qb.topic_id) return qb.topic_id;
    const key = `${qb.subject}|${qb.grade}|${qb.chapter_number}`;
    const arr = fbIndex[key];
    return arr && arr.length ? arr[0].id : null;
  };

  // 6. Build (student, topic) groups; count mappable vs null-topic-skipped & null-is_correct-skipped
  const pairs = new Map(); // key student|topic -> {count, correct}
  let nullTopicSkipped = 0;
  let nullIsCorrectSkipped = 0;
  let noQuestionRow = 0;
  let mappable = 0;
  for (const r of responses) {
    if (r.is_correct === null || r.is_correct === undefined) { nullIsCorrectSkipped++; continue; }
    const qb = questions[r.question_id];
    if (!qb) { noQuestionRow++; nullTopicSkipped++; continue; }
    const topicId = resolveTopic(qb);
    if (!topicId) { nullTopicSkipped++; continue; }
    mappable++;
    const key = `${r.student_id}|${topicId}`;
    const cur = pairs.get(key) || { count: 0, correct: 0 };
    cur.count++; if (r.is_correct === true) cur.correct++;
    pairs.set(key, cur);
  }

  const distinctStudents = new Set([...pairs.keys()].map(k => k.split('|')[0]));
  const distinctTopics = new Set([...pairs.keys()].map(k => k.split('|')[1]));

  // 7. Pre-snapshot for the quiz-takers-no-mastery cohort
  const studs = await fetchAll('students', 'id,xp_total', (q) => q.in('id', quizTakersNoMastery));
  const sumXp = studs.reduce((a, s) => a + (Number(s.xp_total) || 0), 0);
  const cohortSessions = sessions.filter(s => quizTakersNoMastery.includes(s.student_id));
  const sumScorePercent = cohortSessions.reduce((a, s) => a + (Number(s.score_percent) || 0), 0);

  console.log('=== PHASE 4 BACKFILL DRY RUN (read-only) ===');
  console.log('Students with >=1 concept_mastery row:', studentsWithMastery.size);
  console.log('Students with quiz_sessions:', studentsWithSessions.size);
  console.log('Quiz-takers with ZERO concept_mastery rows:', quizTakersNoMastery.length);
  console.log('  ids:', JSON.stringify(quizTakersNoMastery));
  console.log('Total quiz_responses for cohort:', responses.length);
  console.log('  mappable responses:', mappable);
  console.log('  NULL-topic responses skipped:', nullTopicSkipped, '(of which missing question_bank row:', noQuestionRow + ')');
  console.log('  NULL is_correct responses skipped:', nullIsCorrectSkipped);
  console.log('(student,topic) pairs to backfill:', pairs.size);
  console.log('  distinct students in pairs:', distinctStudents.size);
  console.log('  distinct topics in pairs:', distinctTopics.size);
  console.log('Per-pair responses & correct:');
  const sortedKeys = [...pairs.keys()].sort();
  for (const k of sortedKeys) {
    const v = pairs.get(k);
    console.log(`  ${k}  attempts=${v.count} correct=${v.correct}`);
  }
  console.log('--- PRE SNAPSHOT (P1/P2 freeze proof) ---');
  console.log('SUM(students.xp_total):', sumXp);
  console.log('SUM(quiz_sessions.score_percent):', sumScorePercent);
  console.log('COUNT(quiz_sessions):', cohortSessions.length);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
