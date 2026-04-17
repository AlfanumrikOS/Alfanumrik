// daily-cron v27 — adds nightly Performance Score recalculation.
// Previous: leaderboard gate >=50->>=2 students; all P5 steps: streaks, leaderboard, parent digest,
// task cleanup, platform health snapshot, ml retrain trigger.
// Secret: CRON_SECRET env var OR get_cron_secret() DB RPC fallback.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

async function resetMissedStreaks(supabase: ReturnType<typeof createClient>): Promise<number> {
  const y = new Date(); y.setUTCDate(y.getUTCDate()-1); y.setUTCHours(0,0,0,0)
  const { data, error } = await supabase.from('student_learning_profiles').select('student_id,subject').gt('streak_days',0).lt('last_session_at',y.toISOString())
  if (error) throw new Error(`resetMissedStreaks: ${error.message}`)
  if (!data?.length) return 0
  await Promise.all(data.map((p: {student_id:string;subject:string}) => supabase.from('student_learning_profiles').update({streak_days:0,updated_at:new Date().toISOString()}).eq('student_id',p.student_id).eq('subject',p.subject)))
  return new Set(data.map((p:{student_id:string})=>p.student_id)).size
}

async function recalculateLeaderboards(supabase: ReturnType<typeof createClient>): Promise<number> {
  const { data, error } = await supabase.from('students').select('id,grade,xp_total').eq('is_active',true).is('deleted_at',null)
  if (error) throw new Error(`recalculateLeaderboards: ${error.message}`)
  if (!data?.length) return 0
  const gm = new Map<string,Array<{id:string;xp_total:number}>>()
  for (const s of data as {id:string;grade:string;xp_total:number}[]) { const g=s.grade?? 'unknown'; const a=gm.get(g)??[]; a.push({id:s.id,xp_total:s.xp_total??0}); gm.set(g,a) }
  const now = new Date().toISOString()
  const entries: {student_id:string;grade:string;total_xp:number;rank:number;updated_at:string}[] = []
  for (const [grade,list] of gm.entries()) { list.sort((a,b)=>b.xp_total-a.xp_total); list.forEach((s,i)=>entries.push({student_id:s.id,grade,total_xp:s.xp_total,rank:i+1,updated_at:now})) }
  if (!entries.length) return 0
  const { error: e } = await supabase.from('leaderboard_snapshots').upsert(entries,{onConflict:'student_id'})
  if (e) throw new Error(`recalculateLeaderboards upsert: ${e.message}`)
  // Auto-enable leaderboard at >=2 students (was 50 — too high for early-stage, hid the feature from all users).
  // With only 10 students in DB, >=50 means leaderboard is permanently disabled.
  // >=2 ensures the leaderboard activates as soon as there is someone to compete with.
  if (entries.length >= 2) await supabase.from('feature_flags').update({is_enabled:true,updated_at:now}).in('flag_name',['leaderboard_global','wave1_leaderboard']).eq('is_enabled',false)
  return entries.length
}

async function generateParentDigests(supabase: ReturnType<typeof createClient>): Promise<number> {
  const { data: links, error: le } = await supabase.from('guardian_student_links').select('guardian_id,student_id').in('status',['approved','active'])
  if (le) throw new Error(`generateParentDigests: ${le.message}`)
  if (!links?.length) return 0
  const y = new Date(); y.setUTCDate(y.getUTCDate()-1); y.setUTCHours(0,0,0,0)
  const notes: Record<string,unknown>[] = []
  for (const {guardian_id,student_id} of links as {guardian_id:string;student_id:string}[]) {
    const { data: ss } = await supabase.from('quiz_sessions').select('id,subject,score_percent,xp_earned').eq('student_id',student_id).eq('is_completed',true).gte('created_at',y.toISOString())
    const list = (ss??[]) as {subject:string;score_percent:number;xp_earned:number}[]
    const base = {recipient_type:'guardian',recipient_id:guardian_id,is_read:false,created_at:new Date().toISOString()}
    if (!list.length) { const b='Your child did not complete any quizzes yesterday.'; notes.push({...base,type:'parent_digest_no_activity',title:'No study activity yesterday',message:b,body:b,data:{quizzes:0,student_id}}) }
    else {
      const xp=list.reduce((s,q)=>s+(q.xp_earned??0),0); const sc=Math.round(list.reduce((s,q)=>s+(q.score_percent??0),0)/list.length)
      const sub=[...new Set(list.map(q=>q.subject))].join(', '); const b=`Subjects: ${sub}. Avg score: ${sc}%. XP: +${xp}.`
      notes.push({...base,type:'parent_digest',title:`Yesterday: ${list.length} quiz${list.length>1?'zes':''} completed`,message:b,body:b,data:{quizzes:list.length,avg_score:sc,total_xp:xp,subjects:sub,student_id}})
    }
  }
  if (notes.length) { const {error:ie}=await supabase.from('notifications').insert(notes); if(ie) throw new Error(`generateParentDigests insert: ${ie.message}`) }
  return notes.length
}

async function cleanupTaskQueue(supabase: ReturnType<typeof createClient>): Promise<number> {
  const s7=new Date(Date.now()-7*86400000).toISOString(); const s30=new Date(Date.now()-30*86400000).toISOString()
  const {count:c1,error:e1}=await supabase.from('task_queue').delete({count:'exact'}).eq('status','completed').lt('completed_at',s7); if(e1) throw new Error(`cleanup completed: ${e1.message}`)
  const {count:c2,error:e2}=await supabase.from('task_queue').delete({count:'exact'}).eq('status','failed').lt('created_at',s30); if(e2) throw new Error(`cleanup failed: ${e2.message}`)
  return (c1??0)+(c2??0)
}

async function recordHealthSnapshot(supabase: ReturnType<typeof createClient>): Promise<number> {
  const {data,error}=await supabase.rpc('record_platform_health_snapshot')
  if(error) throw new Error(`recordHealthSnapshot: ${error.message}`)
  console.log(`daily-cron: health snapshot=${data}`)
  return 1
}

async function triggerModelRetrainIfNeeded(supabase: ReturnType<typeof createClient>): Promise<number> {
  const since=new Date(Date.now()-86400000).toISOString()
  const {count:n,error:e}=await supabase.from('quiz_responses').select('*',{count:'exact',head:true}).gte('created_at',since)
  if(e) throw new Error(`retrain count: ${e.message}`)
  if((n??0)<100){console.log(`daily-cron: retrain skip — ${n??0} new responses`);return 0}
  const {error:qe}=await supabase.from('task_queue').insert({queue_name:'ml_retrain',payload:{trigger:'daily_cron',new_responses:n,triggered_at:new Date().toISOString(),notes:'IRT calibration + BKT prior update'},status:'pending',max_attempts:3})
  if(qe) throw new Error(`retrain enqueue: ${qe.message}`)
  console.log(`daily-cron: ml_retrain queued — ${n} responses`)
  return n??0
}

// ──────────────────────────────────────────────────────────────────────────
// Performance Score nightly recalculation
// Computes 0-100 per student×subject from concept_mastery + behavior signals,
// upserts into performance_scores, snapshots into score_history, and creates
// notifications when scores cross significant thresholds.
// Idempotent: safe to run multiple times per day (upserts use ON CONFLICT).
// ──────────────────────────────────────────────────────────────────────────

// Grade floor: minimum retention value by grade (younger students retain more with support)
const GRADE_FLOOR: Record<string, number> = {
  '6': 0.30, '7': 0.30, '8': 0.20, '9': 0.20, '10': 0.15, '11': 0.10, '12': 0.10,
}

// Bloom ceiling: max contribution by bloom level (higher-order = higher ceiling)
const BLOOM_CEILING: Record<string, number> = {
  remember: 0.45, understand: 0.60, apply: 0.75,
  analyze: 0.85, evaluate: 0.95, create: 1.00,
}

// Score level names by range
function levelName(score: number): string {
  if (score >= 90) return 'Star Explorer'
  if (score >= 75) return 'Rising Champion'
  if (score >= 60) return 'Steady Learner'
  if (score >= 40) return 'Brave Beginner'
  return 'Curious Cub'
}

// Derive the highest bloom level achieved from the bloom_mastery JSONB
// bloom_mastery: {"remember":0.8,"understand":0.5,"apply":0.1,...}
function highestBloomLevel(bloomMastery: Record<string, number> | null): string {
  if (!bloomMastery) return 'remember'
  const order = ['create', 'evaluate', 'analyze', 'apply', 'understand', 'remember']
  for (const level of order) {
    if ((bloomMastery[level] ?? 0) > 0.3) return level
  }
  return 'remember'
}

interface ConceptRow {
  student_id: string
  topic_id: string
  p_know: number
  mastery_probability: number
  last_attempted_at: string | null
  retention_half_life: number
  current_retention: number
  bloom_mastery: Record<string, number> | null
}

async function recalculatePerformanceScores(supabase: ReturnType<typeof createClient>): Promise<number> {
  const now = Date.now()

  // 1. Fetch all concept_mastery rows (bulk — efficient for early-stage and scales to 10K)
  const { data: conceptRows, error: cmErr } = await supabase
    .from('concept_mastery')
    .select('student_id,topic_id,p_know,mastery_probability,last_attempted_at,retention_half_life,current_retention,bloom_mastery')
  if (cmErr) throw new Error(`recalcPerformanceScores concept_mastery: ${cmErr.message}`)
  if (!conceptRows?.length) { console.log('daily-cron: performance_scores — 0 concept rows, skipping'); return 0 }

  // 2. Collect unique topic_ids and fetch their subject/grade mapping
  const topicIds = [...new Set((conceptRows as ConceptRow[]).map(r => r.topic_id).filter(Boolean))]
  if (!topicIds.length) { console.log('daily-cron: performance_scores — no topic_ids, skipping'); return 0 }

  // Fetch chapter_topics -> chapters -> subjects mapping in batches (Supabase .in() limit ~300)
  const topicMap = new Map<string, { subject_code: string; grade: string }>()
  const BATCH = 200
  for (let i = 0; i < topicIds.length; i += BATCH) {
    const batch = topicIds.slice(i, i + BATCH)
    const { data: topicData, error: tErr } = await supabase
      .from('chapter_topics')
      .select('id, chapter:chapters!inner(grade, subject:subjects!inner(code))')
      .in('id', batch)
    if (tErr) throw new Error(`recalcPerformanceScores topic lookup: ${tErr.message}`)
    if (topicData) {
      for (const t of topicData as any[]) {
        const ch = t.chapter
        if (ch?.subject?.code && ch.grade) {
          topicMap.set(t.id, { subject_code: ch.subject.code, grade: ch.grade })
        }
      }
    }
  }

  // 3. Fetch student grades for grade-floor calculation
  const studentIds = [...new Set((conceptRows as ConceptRow[]).map(r => r.student_id))]
  const studentGrades = new Map<string, string>()
  for (let i = 0; i < studentIds.length; i += BATCH) {
    const batch = studentIds.slice(i, i + BATCH)
    const { data: sData, error: sErr } = await supabase
      .from('students')
      .select('id,grade')
      .in('id', batch)
    if (sErr) throw new Error(`recalcPerformanceScores students: ${sErr.message}`)
    if (sData) for (const s of sData as { id: string; grade: string }[]) studentGrades.set(s.id, s.grade)
  }

  // 4. Compute performance component per student×subject
  // Key: `${student_id}::${subject_code}`
  type Accumulator = { total: number; count: number; grade: string }
  const perfMap = new Map<string, Accumulator>()

  for (const row of conceptRows as ConceptRow[]) {
    const mapping = topicMap.get(row.topic_id)
    if (!mapping) continue // topic not found in catalog, skip
    const grade = studentGrades.get(row.student_id) ?? mapping.grade
    const key = `${row.student_id}::${mapping.subject_code}`

    // Calculate retention decay: exp(-days_since / half_life_in_days)
    let retention = row.current_retention ?? 0
    if (row.last_attempted_at) {
      const daysSince = (now - new Date(row.last_attempted_at).getTime()) / 86400000
      const halfLife = Math.max(row.retention_half_life ?? 48, 0.5)
      // Exponential decay with half-life model: retention = exp(-ln(2) * days / halfLife)
      const decayedRetention = Math.exp(-0.693 * daysSince / halfLife)
      const floor = GRADE_FLOOR[grade] ?? 0.10
      retention = Math.max(decayedRetention, floor)
    }

    // Bloom ceiling from the topic's highest mastered bloom level
    const bloom = highestBloomLevel(row.bloom_mastery)
    const ceiling = BLOOM_CEILING[bloom] ?? 0.45

    // Effective mastery for this concept
    const pKnow = row.p_know ?? row.mastery_probability ?? 0
    const effective = pKnow * retention * ceiling

    const acc = perfMap.get(key) ?? { total: 0, count: 0, grade }
    acc.total += effective
    acc.count += 1
    perfMap.set(key, acc)
  }

  // 5. Compute behavior signals per student×subject
  // Consistency: distinct activity days in last 14 days / 14
  const fourteenDaysAgo = new Date(now - 14 * 86400000).toISOString().slice(0, 10)
  const { data: activityData, error: aErr } = await supabase
    .from('daily_activity')
    .select('student_id,subject,activity_date')
    .gte('activity_date', fourteenDaysAgo)
  if (aErr) console.warn(`daily-cron: performance_scores activity fetch warning: ${aErr.message}`)

  const consistencyMap = new Map<string, number>() // key -> distinct days count
  if (activityData) {
    const daySet = new Map<string, Set<string>>()
    for (const a of activityData as { student_id: string; subject: string; activity_date: string }[]) {
      const key = `${a.student_id}::${a.subject}`
      const s = daySet.get(key) ?? new Set()
      s.add(a.activity_date)
      daySet.set(key, s)
    }
    for (const [key, days] of daySet) consistencyMap.set(key, days.size)
  }

  // Persistence: completed quizzes / started quizzes in last 30 days
  const thirtyDaysAgo = new Date(now - 30 * 86400000).toISOString()
  const { data: quizData, error: qErr } = await supabase
    .from('quiz_sessions')
    .select('student_id,subject,is_completed')
    .gte('created_at', thirtyDaysAgo)
  if (qErr) console.warn(`daily-cron: performance_scores quiz fetch warning: ${qErr.message}`)

  const persistenceMap = new Map<string, { started: number; completed: number }>()
  if (quizData) {
    for (const q of quizData as { student_id: string; subject: string; is_completed: boolean }[]) {
      const key = `${q.student_id}::${q.subject}`
      const p = persistenceMap.get(key) ?? { started: 0, completed: 0 }
      p.started += 1
      if (q.is_completed) p.completed += 1
      persistenceMap.set(key, p)
    }
  }

  // Velocity: compare this week's mastery average vs last week's
  // Use topic_mastery for weekly comparison (simpler than concept_mastery aggregation)
  const { data: recentMastery, error: rmErr } = await supabase
    .from('topic_mastery')
    .select('student_id,subject,mastery_level,updated_at')
  if (rmErr) console.warn(`daily-cron: performance_scores topic_mastery warning: ${rmErr.message}`)

  const velocityMap = new Map<string, number>()
  if (recentMastery) {
    // Group by key, separate into this-week vs last-week by updated_at
    const weekBuckets = new Map<string, { thisWeek: number[]; lastWeek: number[] }>()
    const sevenDaysMs = 7 * 86400000
    for (const tm of recentMastery as { student_id: string; subject: string; mastery_level: number; updated_at: string }[]) {
      const key = `${tm.student_id}::${tm.subject}`
      const bucket = weekBuckets.get(key) ?? { thisWeek: [], lastWeek: [] }
      const age = now - new Date(tm.updated_at).getTime()
      if (age <= sevenDaysMs) bucket.thisWeek.push(tm.mastery_level ?? 0)
      else if (age <= 2 * sevenDaysMs) bucket.lastWeek.push(tm.mastery_level ?? 0)
      weekBuckets.set(key, bucket)
    }
    for (const [key, b] of weekBuckets) {
      const avgThis = b.thisWeek.length ? b.thisWeek.reduce((s, v) => s + v, 0) / b.thisWeek.length : 0
      const avgLast = b.lastWeek.length ? b.lastWeek.reduce((s, v) => s + v, 0) / b.lastWeek.length : 0
      // Velocity as a 0-100 score: 50 = no change, >50 = improving, <50 = declining
      // Clamp between 0-100
      const delta = avgThis - avgLast // range roughly -1 to +1
      velocityMap.set(key, Math.max(0, Math.min(100, 50 + delta * 50)))
    }
  }

  // 6. Build upsert rows for performance_scores and score_history
  const perfRows: Record<string, unknown>[] = []
  const historyRows: Record<string, unknown>[] = []
  const today = new Date().toISOString().slice(0, 10)

  // Fetch previous scores for threshold notifications
  const prevScoresMap = new Map<string, number>()
  const { data: prevScores } = await supabase
    .from('performance_scores')
    .select('student_id,subject,overall_score')
  if (prevScores) {
    for (const ps of prevScores as { student_id: string; subject: string; overall_score: number }[]) {
      prevScoresMap.set(`${ps.student_id}::${ps.subject}`, ps.overall_score)
    }
  }

  const notifications: Record<string, unknown>[] = []

  for (const [key, acc] of perfMap) {
    const [studentId, subject] = key.split('::')
    const perfScore = acc.count > 0 ? (acc.total / acc.count) * 100 : 0

    // Behavior sub-scores
    const consistencyDays = consistencyMap.get(key) ?? 0
    const consistencyScore = Math.min(100, (consistencyDays / 14) * 100)

    const pers = persistenceMap.get(key)
    const persistenceScore = pers && pers.started > 0 ? Math.min(100, (pers.completed / pers.started) * 100) : 50

    const velocityScore = velocityMap.get(key) ?? 50

    // Neutral defaults for signals not yet tracked
    const challengeScore = 50
    const revisionScore = 50
    const breadthScore = 50

    // Behavior component: weighted average of sub-scores
    // Weights from BEHAVIOR_WEIGHTS in score-config.ts: consistency=4, challenge=3, revision=4, persistence=3, breadth=3, velocity=3 (sum=20)
    const behaviorScore =
      consistencyScore * (4 / 20) +
      challengeScore * (3 / 20) +
      revisionScore * (4 / 20) +
      persistenceScore * (3 / 20) +
      breadthScore * (3 / 20) +
      velocityScore * (3 / 20)

    // Overall: 80% performance + 20% behavior
    const overallScore = Math.max(0, Math.min(100, perfScore * 0.80 + behaviorScore * 0.20))

    perfRows.push({
      student_id: studentId,
      subject,
      overall_score: Math.round(overallScore * 100) / 100,
      performance_component: Math.round(perfScore * 100) / 100,
      behavior_component: Math.round(behaviorScore * 100) / 100,
      consistency_score: Math.round(consistencyScore * 100) / 100,
      challenge_score: challengeScore,
      revision_score: revisionScore,
      persistence_score: Math.round(persistenceScore * 100) / 100,
      breadth_score: breadthScore,
      velocity_score: Math.round(velocityScore * 100) / 100,
      level_name: levelName(overallScore),
      updated_at: new Date().toISOString(),
    })

    historyRows.push({
      student_id: studentId,
      subject,
      score: Math.round(overallScore * 100) / 100,
      performance_component: Math.round(perfScore * 100) / 100,
      behavior_component: Math.round(behaviorScore * 100) / 100,
      recorded_at: today,
    })

    // Check notification thresholds
    const prevScore = prevScoresMap.get(key) ?? null
    if (prevScore !== null) {
      const rounded = Math.round(overallScore * 100) / 100
      const drop = prevScore - rounded
      // Notify on 5+ point drop
      if (drop >= 5) {
        notifications.push({
          recipient_type: 'student',
          recipient_id: studentId,
          type: 'score_milestone',
          title: `Your ${subject} score dropped by ${Math.round(drop)} points`,
          body: `Your Performance Score went from ${Math.round(prevScore)} to ${Math.round(rounded)}. Review some topics to bring it back up!`,
          data: { subject, previous: prevScore, current: rounded, change: -drop },
          is_read: false,
          created_at: new Date().toISOString(),
        })
      }
      // Crossed above 80 (achievement)
      if (prevScore < 80 && rounded >= 80) {
        notifications.push({
          recipient_type: 'student',
          recipient_id: studentId,
          type: 'score_milestone',
          title: `Great job! ${subject} score reached ${Math.round(rounded)}`,
          body: `You've crossed 80 in ${subject}. Keep up the excellent work!`,
          data: { subject, previous: prevScore, current: rounded, milestone: 80 },
          is_read: false,
          created_at: new Date().toISOString(),
        })
      }
      // Dropped below 50 (warning)
      if (prevScore >= 50 && rounded < 50) {
        notifications.push({
          recipient_type: 'student',
          recipient_id: studentId,
          type: 'score_milestone',
          title: `${subject} score needs attention`,
          body: `Your score dropped below 50. A quick revision session can help bring it back up!`,
          data: { subject, previous: prevScore, current: rounded, milestone: 50 },
          is_read: false,
          created_at: new Date().toISOString(),
        })
      }
    }
  }

  // 7. Upsert performance_scores in batches
  let upserted = 0
  for (let i = 0; i < perfRows.length; i += BATCH) {
    const batch = perfRows.slice(i, i + BATCH)
    const { error: uErr } = await supabase
      .from('performance_scores')
      .upsert(batch, { onConflict: 'student_id,subject' })
    if (uErr) throw new Error(`recalcPerformanceScores upsert perf: ${uErr.message}`)
    upserted += batch.length
  }

  // 8. Upsert score_history in batches
  for (let i = 0; i < historyRows.length; i += BATCH) {
    const batch = historyRows.slice(i, i + BATCH)
    const { error: hErr } = await supabase
      .from('score_history')
      .upsert(batch, { onConflict: 'student_id,subject,recorded_at' })
    if (hErr) throw new Error(`recalcPerformanceScores upsert history: ${hErr.message}`)
  }

  // 9. Insert notifications
  if (notifications.length) {
    const { error: nErr } = await supabase.from('notifications').insert(notifications)
    if (nErr) console.warn(`daily-cron: performance score notifications warning: ${nErr.message}`)
    else console.log(`daily-cron: performance_scores — ${notifications.length} notifications sent`)
  }

  console.log(`daily-cron: performance_scores — ${upserted} student×subject scores recalculated in ${Date.now() - now}ms`)
  return upserted
}

Deno.serve(async (req) => {
  if (req.method==='OPTIONS') return new Response('ok',{headers:corsHeaders})
  const t0=Date.now()
  const sb=createClient(Deno.env.get('SUPABASE_URL')??'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',{auth:{persistSession:false}})
  try {
    let secret=Deno.env.get('CRON_SECRET')??null
    if(!secret){const{data,error:re}=await sb.rpc('get_cron_secret');if(re||!data){console.error('daily-cron: secret unavailable:',re?.message);return new Response(JSON.stringify({error:'Server misconfiguration'}),{status:500,headers:{...corsHeaders,'Content-Type':'application/json'}})}; secret=data as string}
    if(req.headers.get('x-cron-secret')!==secret) return new Response(JSON.stringify({error:'Unauthorized'}),{status:401,headers:{...corsHeaders,'Content-Type':'application/json'}})
    const steps:[string,()=>Promise<number>][]=[
      ['streaks_reset',()=>resetMissedStreaks(sb)],
      ['leaderboard_entries',()=>recalculateLeaderboards(sb)],
      ['parent_digests_sent',()=>generateParentDigests(sb)],
      ['task_queue_rows_deleted',()=>cleanupTaskQueue(sb)],
      ['health_snapshot',()=>recordHealthSnapshot(sb)],
      ['ml_retrain_new_responses',()=>triggerModelRetrainIfNeeded(sb)],
      ['performance_scores_recalculated',()=>recalculatePerformanceScores(sb)],
    ]
    const settled=await Promise.allSettled(steps.map(([,fn])=>fn()))
    const results:Record<string,number>={};const errors:Record<string,string>={}
    for(let i=0;i<steps.length;i++){const[name]=steps[i];const r=settled[i];if(r.status==='fulfilled')results[name]=r.value;else{const m=r.reason instanceof Error?r.reason.message:String(r.reason);errors[name]=m;console.error(`daily-cron [${name}]:`,m)}}
    const hasErr=Object.keys(errors).length>0
    return new Response(JSON.stringify({run_at:new Date().toISOString(),elapsed_ms:Date.now()-t0,results,...(hasErr?{errors}:{})}),{status:hasErr?207:200,headers:{...corsHeaders,'Content-Type':'application/json'}})
  } catch(err){const m=err instanceof Error?err.message:String(err);console.error('daily-cron fatal:',m);return new Response(JSON.stringify({error:m}),{status:500,headers:{...corsHeaders,'Content-Type':'application/json'}})}
})
