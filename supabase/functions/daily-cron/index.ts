// daily-cron v26 — leaderboard gate >=50->>=2 students; all P5 steps: streaks, leaderboard, parent digest,
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
    ]
    const settled=await Promise.allSettled(steps.map(([,fn])=>fn()))
    const results:Record<string,number>={};const errors:Record<string,string>={}
    for(let i=0;i<steps.length;i++){const[name]=steps[i];const r=settled[i];if(r.status==='fulfilled')results[name]=r.value;else{const m=r.reason instanceof Error?r.reason.message:String(r.reason);errors[name]=m;console.error(`daily-cron [${name}]:`,m)}}
    const hasErr=Object.keys(errors).length>0
    return new Response(JSON.stringify({run_at:new Date().toISOString(),elapsed_ms:Date.now()-t0,results,...(hasErr?{errors}:{})}),{status:hasErr?207:200,headers:{...corsHeaders,'Content-Type':'application/json'}})
  } catch(err){const m=err instanceof Error?err.message:String(err);console.error('daily-cron fatal:',m);return new Response(JSON.stringify({error:m}),{status:500,headers:{...corsHeaders,'Content-Type':'application/json'}})}
})
