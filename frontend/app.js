"use strict";
const $ = s => document.querySelector(s);
const fmtMoney = n => n==null?'—':(n>=1e6?'$'+(n/1e6).toFixed(1)+'M':n>=1e3?'$'+Math.round(n/1e3)+'k':'$'+Math.round(n));
const fmtFull = n => n==null?'—':'$'+Math.round(n).toLocaleString();
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Safe to interpolate into a single-quoted inline-JS attribute (onclick="fn('...')")
const attrStr = s => (s==null?'':String(s)).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
const fmtDate = d => d?new Date(d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'2-digit'}):'—';
function commPill(sub){ const m={Email:['Email','p-gray'],Call:['Call','p-amber'],ListEmail:['Bulk email','p-gray'],Task:['Note','p-gray'],Meeting:['Meeting','p-green'],Event:['Meeting','p-green']}; const x=m[sub]||[sub||'Activity','p-gray']; return `<span class="pill ${x[1]}">${x[0]}</span>`; }
function commSubject(s){ s=(s||'').replace(/^Email:\s*/i,''); return s.trim()||'(no subject)'; }
function cleanComm(d){ if(!d) return ''; let s=String(d); const bi=s.indexOf('Body:'); if(bi>=0 && bi<500) s=s.slice(bi+5); s=s.replace(/thread::[\s\S]*$/,'').replace(/---+\s*Original Message\s*---+[\s\S]*$/i,''); return s.replace(/\s+/g,' ').trim(); }
const PRODMAP={SAAS:'SaaS / Software (Evidence.com)',Cart:'Cartridges',Training:'Training',INTERVIEW:'Axon Interview','FLEX 2':'Flex 2',X26:'X26',COMMANDER:'Commander',BODYCAM3:'Axon Body Camera',FLEET:'Axon Fleet',AIR:'Axon Air'};
function prodName(f){ if(f==null||f==='') return 'Uncategorized'; if(PRODMAP[f]) return PRODMAP[f]; return String(f).toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()); }
function daysSince(d){ if(!d) return null; return Math.round((new Date()-new Date(d))/86400000); }

// ---------- persisted settings ----------
// Namespaced per logged-in user (window.CURRENT_USER, injected server-side before
// this script loads - see render_app_shell in backend/app/main.py) so teammates
// sharing a machine don't clobber each other's CTAs/plans/notes. This is the one
// line that changes when this moves to real backend storage later: swap the
// localStorage calls below for API calls, keep every LS.get/LS.set call site as-is.
function _lsKey(k){ const u=(window.CURRENT_USER&&window.CURRENT_USER.username)||'shared'; return 'axoncs_'+u+'_'+k; }
const LS = {
  get(k,d){try{const v=localStorage.getItem(_lsKey(k));return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem(_lsKey(k),JSON.stringify(v))}catch(e){}}
};
const DEFAULT_WEIGHTS={openCase:2,highSev:9,proxNear:22,proxMid:10,stageRisk:12,engage:16};
let WEIGHTS = Object.assign({}, DEFAULT_WEIGHTS, LS.get('weights',{}));
let escState = LS.get('escState',{});     // acctId -> {status, log:[]}
let csat = LS.get('csat',{});             // acctId -> number 0-100 (manual override)
let plans = LS.get('plans',{});           // acctId -> plan object
function savePlans(){ LS.set('plans',plans); }
let ctas = LS.get('ctas',[]);             // Calls to Action (action items for CSMs)
function saveCtas(){ LS.set('ctas',ctas); }
let ownerFilter = (window.CURRENT_USER && window.CURRENT_USER.role==='csm' && window.CURRENT_USER.csmName) || ''; // "View as CSM" auto-filter (owner name), session only — defaults to the logged-in CSM's own book
let hierFilter = {segment:'', managers:[]}; // Org Drill-down: segment + a chosen set of managers, session only
let tapState = LS.get('tapState',{});     // acctId -> {steps:[{id,label,done}], notes:'', refreshedAt}
function saveTapState(){ LS.set('tapState',tapState); }

// ---------- customer insights (per-account log) ----------
// A CSM-facing place to capture and distil what the team is learning about a
// customer - not tied to a case or escalation. Straight from CS-leadership
// guidance (see NOTES.md): "capturing and distilling what we're learning about
// those customers" is one of the core things a CS org should be measured on.
let insights = LS.get('insights',{});     // acctId -> [{t,note}]
function saveInsights(){ LS.set('insights',insights); }
function addInsight(acctId,note){ if(!note) return; const arr=insights[acctId]=insights[acctId]||[]; arr.push({t:new Date().toISOString(),note}); saveInsights(); }
function insightCountSince(acctId,days){ const arr=insights[acctId]||[]; if(days==null) return arr.length; const cut=Date.now()-days*864e5; return arr.filter(n=>new Date(n.t).getTime()>=cut).length; }

// ---------- quarterly customer surveys (optional CSM-run cadence) ----------
// Distinct from the official biannual NPS survey (a.nps/a.npsDate, sourced from
// Salesforce/Snowflake per Leana) — this tracks whether a CSM sent a per-account
// survey this quarter and what came back, for teams that want to run that cadence.
// Same boundary as Email Outreach: this app never sends anything itself, only
// tracks that it happened and logs the result.
let surveyState = LS.get('surveyState',{}); // acctId -> [{id,quarter,sentAt,status,score,notes}]
function saveSurveyState(){ LS.set('surveyState',surveyState); }
function currentQuarter(d){ d=d||new Date(); return d.getFullYear()+'-Q'+(Math.floor(d.getMonth()/3)+1); }
// ---- Quarter split: mock book = Q2, live Test 10 pilot = this quarter (Q3 today) ----
// Date-driven throughout: quarterKeyForDate buckets any timestamp into "YYYY-Qn",
// and every quarter-aware view (CSAT, Customer Insights, Managed NPS) filters by
// this same key so switching quarters is consistent everywhere.
function quarterKeyForDate(d){ return currentQuarter(d instanceof Date ? d : new Date(d)); }
function shiftQuarter(qKey,delta){
  let [y,q]=qKey.split('-Q'); y=+y; q=+q+delta;
  while(q<1){ q+=4; y--; } while(q>4){ q-=4; y++; }
  return y+'-Q'+q;
}
const PILOT_QUARTER=currentQuarter();      // this quarter — where the live Sheet pilot lives
const MOCK_QUARTER=shiftQuarter(PILOT_QUARTER,-1); // prior quarter — where the seeded full-book mock data lives
// A real calendar date inside the given quarter (not "today"), so anything
// date-filtered (Customer Insights, quarter buckets) actually lands in that
// quarter instead of just carrying a matching label while the real timestamp
// says otherwise.
function randomDateInQuarter(qKey,rnd){
  const [y,q]=qKey.split('-Q').map(Number);
  const startMonth=(q-1)*3;
  const start=new Date(y,startMonth,1).getTime();
  const end=new Date(y,startMonth+3,1).getTime();
  return new Date(start+rnd()*(end-start));
}
// Deterministically seeds every account with a Q2-quarter CSAT send/receive
// status (if it doesn't already have one), so the "before the pilot" view has
// real, populated numbers instead of mostly zeros. Runs once at load.
function seedMockCsatQuarter(){
  // Purge any seeded mock entries that ended up tagged with the *live* quarter
  // (an artifact of the quarter constants having been swapped back and forth
  // during testing) — Q3/PILOT_QUARTER must only ever hold real Sheet-backed
  // data, never seeded placeholders. Entries from before the `seeded` flag
  // existed are caught by the fallback: no real notes = not a genuine
  // CSM-entered survey response.
  Object.values(surveyState).forEach(arr=>{
    for(let i=arr.length-1;i>=0;i--){
      const s=arr[i];
      if(s.quarter===PILOT_QUARTER && (s.seeded || !s.notes || !s.notes.trim())) arr.splice(i,1);
    }
  });
  const rnd=mulberry32(9001);
  STATE.accounts.forEach(a=>{
    const arr=surveyState[a.id]=surveyState[a.id]||[];
    const existing=arr.find(s=>s.quarter===MOCK_QUARTER);
    // Repair entries from before the sentAt/quarter mismatch fix — a Q2-labeled
    // entry whose real date doesn't fall in Q2 gets dropped and reseeded below.
    if(existing){
      if(!existing.sentAt || quarterKeyForDate(existing.sentAt)===MOCK_QUARTER) return;
      arr.splice(arr.indexOf(existing),1);
    }
    const r=rnd();
    const status = r<0.08?'Not sent' : r<0.22?'Sent' : 'Completed';
    arr.push({id:cid(),quarter:MOCK_QUARTER,seeded:true,sentAt:status!=='Not sent'?randomDateInQuarter(MOCK_QUARTER,rnd).toISOString():null,status,score:status==='Completed'?Math.floor(rnd()*101):null,notes:''});
  });
  saveSurveyState();
}
// Generic quarter-toggle bar + date-based row filter, reused by CSAT (Test 10),
// Customer Insights, and Managed-Account NPS so the three stay consistent.
function quarterToggleHtml(sel,setYearFn,setQFn,extraYears){
  const years=[...new Set([+MOCK_QUARTER.split('-Q')[0],+PILOT_QUARTER.split('-Q')[0],sel.year,...(extraYears||[])])].sort((a,b)=>b-a);
  return `<div class="row-actions" style="margin-bottom:12px;flex-wrap:wrap;align-items:center">
    <label class="mini">Year
      <select class="select sm" style="display:block;margin-top:4px" onchange="${setYearFn}(this.value)">${years.map(y=>`<option value="${y}"${sel.year===y?' selected':''}>${y}</option>`).join('')}</select>
    </label>
    <div class="row-actions" style="gap:6px">
      ${[1,2,3,4].map(q=>`<button type="button" class="btn sm${sel.q===q?' primary':''}" onclick="${setQFn}(${q})">Q${q}${(sel.year+'-Q'+q)===PILOT_QUARTER?' · live':(sel.year+'-Q'+q)===MOCK_QUARTER?' · pre-pilot':''}</button>`).join('')}
    </div>
  </div>`;
}
function quarterKeyOf(sel){ return sel.year+'-Q'+sel.q; }
function surveysFor(acctId){ return surveyState[acctId]||[]; }
function currentSurvey(acctId){ const q=currentQuarter(); return surveysFor(acctId).find(s=>s.quarter===q); }
function ensureCurrentSurvey(acctId){
  const q=currentQuarter();
  const arr=surveyState[acctId]=surveyState[acctId]||[];
  let s=arr.find(x=>x.quarter===q);
  if(!s){ s={id:cid(),quarter:q,sentAt:null,status:'Not sent',score:null,notes:''}; arr.push(s); }
  return s;
}
function logSurveySent(acctId){
  const s=ensureCurrentSurvey(acctId);
  s.status='Sent'; s.sentAt=new Date().toISOString();
  saveSurveyState();
  pushActivityEntry(acctId,'Note',`Quarterly survey sent (${s.quarter})`,'Logged via the account\'s quarterly survey tracker.');
  toast('Survey marked sent for '+s.quarter+'.');
  openAcct(acctId);
}
function setSurveyScore(acctId,val){
  const s=ensureCurrentSurvey(acctId);
  s.score = val===''?null:Math.max(0,Math.min(10,+val));
  if(s.score!=null) s.status='Completed';
  saveSurveyState();
}
function setSurveyNotes(acctId,val){ const s=ensureCurrentSurvey(acctId); s.notes=val; saveSurveyState(); }
function surveyCard(a){
  const q=currentQuarter();
  const s=currentSurvey(a.id);
  const past=surveysFor(a.id).filter(x=>x.quarter!==q).sort((x,y)=>y.quarter<x.quarter?-1:1);
  const pill=st=>{ const m={'Not sent':'p-gray',Sent:'p-amber',Completed:'p-green'}; return `<span class="pill ${m[st]||'p-gray'}">${esc(st)}</span>`; };
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Quarterly customer survey <span class="hint">optional — separate from the official biannual NPS survey above</span></h3>
    <p class="mini">This app doesn't send the survey for you (same boundary as Email Outreach) — it's a place to track whether one went out this quarter and log what came back, if your team runs this cadence.</p>
    <div class="row-actions" style="margin:10px 0;align-items:center">
      <b class="mini">${esc(q)}:</b> ${pill(s?s.status:'Not sent')}
      <button class="btn sm" onclick="logSurveySent('${a.id}')">${s&&s.status!=='Not sent'?'Mark re-sent':'Mark sent'}</button>
    </div>
    <div class="row-actions" style="align-items:center;flex-wrap:wrap">
      <label class="mini">Score (0–10)</label>
      <input type="number" min="0" max="10" value="${s&&s.score!=null?s.score:''}" style="width:70px;border:1px solid var(--line);padding:6px 8px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setSurveyScore('${a.id}',this.value);openAcct('${a.id}')">
      <input type="text" placeholder="Notes on the response…" value="${esc((s&&s.notes)||'')}" style="flex:1;min-width:180px;border:1px solid var(--line);padding:6px 8px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setSurveyNotes('${a.id}',this.value)">
    </div>
    ${past.length?`<div class="mini" style="margin-top:10px"><b>History:</b> ${past.map(p=>`${esc(p.quarter)}: ${pill(p.status)}${p.score!=null?' · score '+p.score:''}`).join(' · ')}</div>`:''}
  </div>`;
}
function surveyCoverageCard(accts){
  const q=currentQuarter();
  let completed=0, sent=0, notSent=0;
  accts.forEach(a=>{ const s=currentSurvey(a.id); if(!s||s.status==='Not sent') notSent++; else if(s.status==='Completed') completed++; else sent++; });
  return `<div class="card"><h3>Quarterly survey coverage <span class="hint">${esc(q)} · optional cadence — only meaningful if your team runs it</span></h3>
  <div class="kpis">
    <div class="kpi"><div class="l">Completed</div><div class="v" style="color:var(--green)">${completed}</div><div class="d">of ${accts.length} in scope</div></div>
    <div class="kpi"><div class="l">Sent, awaiting response</div><div class="v" style="color:var(--amber)">${sent}</div><div class="d">follow up if it's gone stale</div></div>
    <div class="kpi"><div class="l">Not sent yet</div><div class="v">${notSent}</div><div class="d">this quarter</div></div>
  </div></div>`;
}

// ---------- rep activity log (calls, notes, next steps) ----------
// Lets CSMs document outreach themselves — log a call/email/meeting/note and
// capture the next action — without waiting on Salesforce write-back. Persists
// in localStorage for now (same pattern as CTAs / insights); bumps lastAct so
// Engagement cadence reflects the touch.
const ACT_TYPES=['Call','Email','Meeting','Note'];
let acctActivity = LS.get('acctActivity',{}); // acctId -> {log:[{id,type,subject,notes,t}], next:{text,due,updatedAt}|null}
function saveAcctActivity(){ LS.set('acctActivity',acctActivity); }
function activityFor(acctId){ return acctActivity[acctId] || {log:[], next:null}; }
function syncLastActFromActivity(acctId){
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
  const log=(acctActivity[acctId]&&acctActivity[acctId].log)||[];
  if(!log.length) return;
  const newest=log.reduce((best,e)=> (!best||e.t>best.t)?e:best, null);
  if(newest && (!a.lastAct || newest.t.slice(0,10) > String(a.lastAct).slice(0,10))){
    a.lastAct=newest.t.slice(0,10);
  }
}
// ---- Salesforce write-back for logged activity ----
// Pushes a call/email/meeting/note onto the account's activity log, then fires an
// async Task write-back to Salesforce (real write in live mode, clearly-labeled
// simulation in mock mode - see /api/write in backend/app/main.py). The entry's
// sfSync status updates in place once the write settles, and re-renders Account
// 360 only if that same account's sheet is still open.
const ACT_SUBTYPE={Call:'Call',Email:'Email',Meeting:'Meeting',Note:'Task'};
function pushActivityEntry(acctId,type,subject,notes){
  const cur=acctActivity[acctId]=acctActivity[acctId]||{log:[],next:null};
  cur.log=cur.log||[];
  const entry={id:cid(),type,subject:subject||type,notes:notes||'',t:new Date().toISOString(),sfSync:'pending'};
  cur.log.push(entry);
  if(cur.log.length>80) cur.log=cur.log.slice(-80);
  saveAcctActivity();
  syncActivityToSalesforce(acctId,entry);
  return entry;
}
async function syncActivityToSalesforce(acctId,entry){
  const res=await sfWrite('Task',{
    Subject:entry.subject, Description:entry.notes, ActivityDate:sfDate(new Date(entry.t)),
    Status:'Completed', TaskSubtype:ACT_SUBTYPE[entry.type]||'Task', WhatId:acctId
  });
  entry.sfSync = res.written ? 'synced' : (res.error ? 'error' : 'simulated');
  entry.sfDetail = res.detail || res.error || '';
  saveAcctActivity();
  delete commsCache[acctId];
  if(currentAcctView===acctId) openAcct(acctId);
}
function logActivity(acctId){
  const type=($('#actType')&&$('#actType').value)||'Call';
  const subject=($('#actSubject')&&$('#actSubject').value||'').trim();
  const notes=($('#actNotes')&&$('#actNotes').value||'').trim();
  if(!subject && !notes){ toast('Add a subject or notes for this activity.'); return; }
  pushActivityEntry(acctId,type,subject,notes);
  delete commsCache[acctId];
  syncLastActFromActivity(acctId);
  const a=STATE.accounts.find(x=>x.id===acctId); if(a) scoreAccount(a);
  toast(type+' logged — syncing to Salesforce…');
  openAcct(acctId);
}
function delActivity(acctId,aid){
  const cur=acctActivity[acctId]; if(!cur||!cur.log) return;
  cur.log=cur.log.filter(e=>e.id!==aid);
  saveAcctActivity(); delete commsCache[acctId]; openAcct(acctId);
}
function saveNextStep(acctId){
  const text=($('#nextStepText')&&$('#nextStepText').value||'').trim();
  const due=($('#nextStepDue')&&$('#nextStepDue').value)||'';
  if(!text){ toast('Describe the next step first.'); return; }
  const cur=acctActivity[acctId]=acctActivity[acctId]||{log:[],next:null};
  cur.next={text,due:due||null,updatedAt:new Date().toISOString()};
  saveAcctActivity();
  toast('Next step saved.');
  openAcct(acctId);
}
function clearNextStep(acctId){
  const cur=acctActivity[acctId]; if(!cur) return;
  cur.next=null; saveAcctActivity(); openAcct(acctId);
}
function nextStepOpen(acctId){ const n=activityFor(acctId).next; return n&&n.text?n:null; }
function nextStepOverdue(n){ if(!n||!n.due) return false; const ds=daysSince(n.due); return ds!=null&&ds>0; }

// ---------- account team roster ("who's on this account") ----------
// Per stakeholder findings: Leana's cross-team blindness complaint ("no visibility
// into who's talking to a customer or why") and Mark's "Axon Team" section, which
// he called "probably the biggest issue with customers" — nobody knows who to
// contact. Tracks both the Axon-side team (CSM, TAM, engagement specialist, fleet
// installer, etc.) and the customer-side contacts, per account.
let teamRoster = LS.get('teamRoster',{});   // acctId -> {axon:[{id,role,name}], customer:[{id,role,name}]}
function saveTeamRoster(){ LS.set('teamRoster',teamRoster); }
function teamFor(acctId){ return teamRoster[acctId] || {axon:[],customer:[]}; }
function addTeamMember(acctId,side,role,name,email){
  if(!name||!name.trim()) return;
  const t=teamRoster[acctId]=teamRoster[acctId]||{axon:[],customer:[]};
  t[side]=t[side]||[];
  t[side].push({id:cid(),role:(role||'').trim()||'Contact',name:name.trim(),email:(email||'').trim()});
  saveTeamRoster(); openAcct(acctId);
}
function delTeamMember(acctId,side,mid){
  const t=teamRoster[acctId]; if(!t) return;
  t[side]=(t[side]||[]).filter(m=>m.id!==mid);
  saveTeamRoster(); openAcct(acctId);
}
function teamSideList(acctId,side,members){
  const inputRole=`tr_${side}_role_${acctId}`, inputName=`tr_${side}_name_${acctId}`, inputEmail=`tr_${side}_email_${acctId}`;
  const addFn=`addTeamMember('${acctId}','${side}',document.getElementById('${inputRole}').value,document.getElementById('${inputName}').value,document.getElementById('${inputEmail}').value)`;
  return `${members.length?`<div class="reslist">${members.map(m=>`<div class="resrow"><span style="display:inline-flex;align-items:center;gap:8px">${avatarChip(m.name)}<span class="pill p-blue">${esc(m.role)}</span><b>${esc(m.name)}</b>${m.email?`<span class="mini">${esc(m.email)}</span>`:''}</span><button class="btn sm" onclick="delTeamMember('${acctId}','${side}','${m.id}')">✕</button></div>`).join('')}</div>`:'<p class="mini">Nobody documented yet.</p>'}
  <div class="row-actions" style="margin-top:10px;flex-wrap:wrap">
    <input id="${inputRole}" placeholder="${side==='axon'?'Role (CSM, TAM…)':'Role (Chief, IT Admin…)'}" style="flex:1;min-width:110px;border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
    <input id="${inputName}" placeholder="Name" style="flex:1;min-width:110px;border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
    <input id="${inputEmail}" type="email" placeholder="Email (for outreach)" style="flex:1.2;min-width:140px;border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onkeydown="if(event.key==='Enter'){${addFn};}">
    <button class="btn sm" onclick="${addFn}">+ Add</button>
  </div>`;
}
function teamRosterCard(a){
  const t=teamFor(a.id);
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Who's on this account <span class="hint">every role touching this account, Axon-side and customer-side</span></h3>
  <p class="mini">Named repeatedly in stakeholder research as one of the biggest gaps: cross-team blindness into who's talking to a customer, and customers not knowing who to contact. Document it here so it's visible to anyone who opens this account.</p>
  <div class="grid2" style="margin-top:12px">
    <div><h4 style="margin:0 0 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Axon team</h4>${teamSideList(a.id,'axon',t.axon||[])}</div>
    <div><h4 style="margin:0 0 8px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Customer-side team</h4>${teamSideList(a.id,'customer',t.customer||[])}</div>
  </div>
  </div>`;
}

// ---------- resource library (guides / SOPs / internal resources) ----------
// Global, topic-based links (not per-account) so guidance doesn't "get lost" —
// anyone can edit these in real time and they live inside the execution tool.
// These are real, standalone pages served by this same backend (frontend/resources/*.html) —
// not placeholder example.com links — so "open a resource" actually opens something useful.
const DEFAULT_RESOURCES=[
  {id:'r1',category:'Onboarding',title:'Onboarding SOP Template',url:'/assets/resources/onboarding-sop.html'},
  {id:'r2',category:'RMAs',title:'RMA Process Guide',url:'/assets/resources/rma-guide.html'},
  {id:'r3',category:'Training',title:'Axon Academy Training Catalog',url:'/assets/resources/training-catalog.html'},
  {id:'r4',category:'Use Cases',title:'Body-Worn Camera Use Case Playbook',url:'/assets/resources/use-case-playbook.html'},
  {id:'r5',category:'Renewals',title:'Renewal Value Recap Deck Template',url:'/assets/resources/renewal-recap-template.html'},
];
let resources = LS.get('resources', DEFAULT_RESOURCES);
// One-time migration for anyone who already had the old placeholder example.com
// links saved locally before real pages existed behind them.
(function migrateResourceUrls(){
  let changed=false;
  resources.forEach(r=>{
    const d=DEFAULT_RESOURCES.find(x=>x.id===r.id);
    if(d && /^https?:\/\/example\.com/i.test(r.url||'')){ r.url=d.url; changed=true; }
  });
  if(changed) LS.set('resources',resources);
})();
function saveResources(){ LS.set('resources',resources); }
function addResource(category,title,url){ if(!title||!url) return; resources.push({id:cid(),category:category||'General',title,url}); saveResources(); route(); }
function delResource(id){ resources=resources.filter(r=>r.id!==id); saveResources(); route(); }
function resourceCategories(){ return [...new Set(resources.map(r=>r.category))].sort(); }

// ---------- CSM scorecard targets ----------
let scoreTargets = LS.get('scoreTargets', {engagementPct:80, growthPerCsm:150000, insightsPerCsm:8});
function saveTargets(){ LS.set('scoreTargets',scoreTargets); }
function setTarget(k,v){ scoreTargets[k]=+v||0; saveTargets(); route(); }

// ---------- usage / adoption thresholds ----------
// Per Beatrice's (CSM) stakeholder finding, the #1 thing missing from Gainsight
// is usage/adoption data — and crucially, the definition of "adopting vs. not"
// is a business rule that varies by team. These cutoffs are editable (like the
// scorecard targets / health weights) so a team can set what counts as adoption.
// adoptingPct: at/above = "Adopting" · atRiskPct: below = "Not adopting".
let adoptionCfg = LS.get('adoptionCfg', {adoptingPct:60, atRiskPct:35});
function saveAdoptionCfg(){ LS.set('adoptionCfg',adoptionCfg); }
function setAdoptionCfg(k,v){
  adoptionCfg[k]=Math.max(0,Math.min(100,Math.round(+v)||0));
  if(adoptionCfg.atRiskPct>adoptionCfg.adoptingPct) adoptionCfg.atRiskPct=adoptionCfg.adoptingPct;
  saveAdoptionCfg(); route();
}
// Classify an account's adoption against the configurable cutoffs.
function adoptionTier(a){
  const u=a.usage; if(!u||u.adoptionPct==null) return 'none';
  if(u.adoptionPct>=adoptionCfg.adoptingPct) return 'adopting';
  if(u.adoptionPct<adoptionCfg.atRiskPct) return 'low';
  return 'ramping';
}
const ADOPT_META={adopting:['p-green','Adopting'],ramping:['p-amber','Ramping'],low:['p-red','Not adopting'],none:['p-gray','No usage data']};
function adoptionPill(a){
  const t=adoptionTier(a); const [cls,lbl]=ADOPT_META[t];
  if(t==='none') return `<span class="pill ${cls}">${lbl}</span>`;
  return `<span class="pill ${cls}">${lbl} · ${a.usage.adoptionPct}%</span>`;
}
function adoptionColor(t){ return t==='adopting'?'var(--green)':t==='ramping'?'var(--amber)':t==='low'?'var(--red)':'var(--muted)'; }
function usageTrendHtml(t){ if(t==null) return '<span class="mini">—</span>'; const up=t>0,flat=t===0; const c=up?'var(--green)':flat?'var(--muted)':'var(--red)'; return `<span style="color:${c};font-weight:700">${up?'▲ +':flat?'· ':'▼ '}${t}%</span>`; }
function commissionPct(a){ const u=a.usage; if(!u||!u.commTarget) return null; return Math.round(u.commAttained/u.commTarget*100); }
function commissionPill(a){ const p=commissionPct(a); if(p==null) return '<span class="pill p-gray">No target</span>'; const cls=p>=100?'p-green':p>=70?'p-amber':'p-red'; return `<span class="pill ${cls}">${p}% to goal</span>`; }

// ---------- engagement cadence (segment-based outreach requirement) ----------
// Required outreach cadence varies by book segment. An account "falls out of
// cadence" when nobody has logged a touch inside that window — the #1 thing a
// CSM should see the moment they open their day view, per CS-leadership guidance.
const SEGMENT_CADENCE = {Strategic:30, Enterprise:45, 'Mid-Market':60, SMB:90};
function cadenceInfo(a){
  const req = SEGMENT_CADENCE[a.segment] || 60;
  const ds = a.dsAct;
  if(ds==null) return {req, ds:null, status:'No engagement logged', tier:'red'};
  if(ds>req) return {req, ds, status:'Out of cadence', tier:'red'};
  if(ds>req*0.7) return {req, ds, status:'Due soon', tier:'amber'};
  return {req, ds, status:'In cadence', tier:'green'};
}
function cadencePill(a){ const c=cadenceInfo(a); const cls=c.tier==='green'?'p-green':c.tier==='amber'?'p-amber':'p-red'; return `<span class="pill ${cls}">${esc(c.status)}</span>`; }
function segmentPill(a){ return `<span class="pill p-gray" style="text-transform:none">${esc(a.segment||'Mid-Market')}</span>`; }

// ---------- data call ----------
// The frontend business logic issues plain SOQL strings, exactly as it would against
// a real Salesforce org. The backend (mock or live Salesforce) always answers with
// the same {records:[...]} shape, so nothing below this function needs to know or
// care which data source is actually serving it.
function goToLogin(){ window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); }
async function soql(q,retry=2){
  try{
    const res = await fetch('/api/soql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
    if(res.status===401){ goToLogin(); throw new Error('Session expired — redirecting to sign in.'); }
    if(!res.ok){
      let detail = 'Backend error '+res.status;
      try{ const body = await res.json(); if(body && body.detail) detail = body.detail; }catch(e){}
      throw new Error(detail);
    }
    const data = await res.json();
    return (data && data.records) || [];
  }catch(e){
    if(retry>0){ await new Promise(r=>setTimeout(r,1200)); return soql(q,retry-1); }
    throw e;
  }
}
function sfDate(d){return d.toISOString().slice(0,10);}
// Write-back helper: really writes when running against live Salesforce, clearly
// reports a simulated result in mock mode rather than pretending it worked.
async function sfWrite(sobject,fields){
  try{
    const res=await fetch('/api/write',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sobject,fields})});
    if(res.status===401){ goToLogin(); return {written:false,error:'Session expired.'}; }
    if(!res.ok){ let detail='Backend error '+res.status; try{ const b=await res.json(); if(b&&b.detail) detail=b.detail; }catch(e){} return {written:false,error:detail}; }
    return await res.json();
  }catch(e){ return {written:false,error:String((e&&e.message)||e)}; }
}
async function doLogout(){
  try{ await fetch('/api/auth/logout',{method:'POST'}); }catch(e){}
  window.location.href = '/login';
}

// ---------- state ----------
let STATE = { accounts:[], users:{}, tree:null, nodeIndex:{}, scope:'ROOT', tab:'home' };
let charts = {};
let acctCharts = {};
let currentAcctView = null;
let commsCache = {};
let intelCache = {};

// ---------- load pipeline ----------
async function load(){
  const today = new Date();
  const end = new Date(); end.setMonth(end.getMonth()+18);
  const q1 = `SELECT Id, Name, Amount, CloseDate, StageName, AccountId, Account.Name, Account.BillingState, Account.LastActivityDate, Account.Segment, OwnerId, Owner.Name, Owner.Title
    FROM Opportunity
    WHERE Type='Renewal' AND IsClosed=false AND Amount!=null AND Amount>0
      AND CloseDate>=${sfDate(today)} AND CloseDate<=${sfDate(end)}
      AND Owner.Name!='Axon IT SFDC' AND (NOT Account.Name LIKE '%TEST%')
    ORDER BY Amount DESC LIMIT 300`;
  const opps = await soql(q1);
  if(!opps.length){ renderError('No open renewal opportunities returned in the 18-month window.'); return; }

  const acctMap = {};
  const ownerIds = new Set();
  opps.forEach(o=>{
    ownerIds.add(o.OwnerId);
    let a = acctMap[o.AccountId];
    if(!a){ a = acctMap[o.AccountId] = {
      id:o.AccountId, name:(o.Account&&o.Account.Name)||'(unknown)',
      state:(o.Account&&o.Account.BillingState)||'', ownerId:o.OwnerId,
      ownerName:(o.Owner&&o.Owner.Name)||'', ownerTitle:(o.Owner&&o.Owner.Title)||'',
      segment:(o.Account&&o.Account.Segment)||'Mid-Market',
      renewalAmount:0, opps:[], nextClose:null, openCases:0, highCases:0, byPri:{},
      lastAct:(o.Account&&o.Account.LastActivityDate)||null,
      ltv:0, pastDeals:0, firstPurchase:null, lastPurchase:null,
      lifeCases:0, lifeHigh:0, lifeEsc:0, sentiment:null, sentTier:'none',
      casesBlocked:0, casesAging:0, growth:{Renewal:0,Expansion:0,Transactional:0}, usage:null
    };}
    a.renewalAmount += o.Amount||0;
    a.opps.push({name:o.Name, amount:o.Amount, close:o.CloseDate, stage:o.StageName});
    if(!a.nextClose || o.CloseDate < a.nextClose) a.nextClose = o.CloseDate;
  });
  const accounts = Object.values(acctMap);
  const acctIds = accounts.map(a=>a.id);
  const idList = a => a.map(x=>`'${x}'`).join(',');

  const q3 = `SELECT AccountId, Priority, COUNT(Id) cnt FROM Case
    WHERE AccountId IN (${idList(acctIds)}) AND IsClosed=false GROUP BY AccountId, Priority`;
  const qDeals = `SELECT AccountId, COUNT(Id) c, SUM(Amount) s, MIN(CloseDate) mn, MAX(CloseDate) mx
    FROM Opportunity WHERE IsWon=true AND AccountId IN (${idList(acctIds)}) GROUP BY AccountId`;
  const qSent = `SELECT AccountId, Priority, IsEscalated, COUNT(Id) c
    FROM Case WHERE AccountId IN (${idList(acctIds)}) GROUP BY AccountId, Priority, IsEscalated`;
  // Blocked vs. aging cases, tracked as their own flags — per CS-leadership guidance,
  // these are the two things a CSM needs to jump on and escalate (see NOTES.md).
  const qBlocked = `SELECT AccountId, COUNT(Id) c FROM Case
    WHERE AccountId IN (${idList(acctIds)}) AND IsClosed=false AND Status='Blocked' GROUP BY AccountId`;
  const qAging = `SELECT AccountId, COUNT(Id) c FROM Case
    WHERE AccountId IN (${idList(acctIds)}) AND IsClosed=false AND IsAging__c=true GROUP BY AccountId`;
  // Growth split into organic/renewal, expansion (net-new product) and transactional
  // (more of what they already have) instead of one lump "growth" number.
  const qGrowth = `SELECT AccountId, GrowthType__c, SUM(Amount) amt, COUNT(Id) c
    FROM Opportunity WHERE IsWon=true AND AccountId IN (${idList(acctIds)}) AND GrowthType__c!=null GROUP BY AccountId, GrowthType__c`;
  // NPS is a real biannual survey (10% of CSM comp, per CS-leadership sponsor
  // guidance) already landing in a Salesforce report - not a placeholder like
  // CSAT. Not every account has a respondent each cycle.
  const qNps = `SELECT AccountId, NPS_Score__c, SurveyDate__c FROM Account
    WHERE Id IN (${idList(acctIds)}) AND NPS_Score__c!=null`;
  // TAP (hardware warranty refresh) tracking, per Leana's stakeholder finding:
  // refresh is due at the 2.5-year midpoint of a 5-year hardware contract.
  const qTap = `SELECT AccountId, MIN(CloseDate) HwFirstPurchase__c FROM OpportunityLineItem
    WHERE AccountId IN (${idList(acctIds)}) AND Family__c IN ('Cart','FLEX 2','X26','BODYCAM3','FLEET','AIR','INTERVIEW') GROUP BY AccountId`;
  // Usage / adoption. This data lives in the product-analytics Snowflake and is
  // surfaced via Sigma today (per Beatrice's CSM finding) — not native Salesforce —
  // so it's modeled here as a ProductUsage__c object fed by a periodic export.
  const qUsage = `SELECT AccountId, SeatsLicensed__c, SeatsActive__c, AdoptionPct__c, UsageTrendPct__c,
    CommissionTarget__c, CommissionAttained__c, LastUsageSync__c, (SELECT Family, Licensed, Active, Pct FROM Products)
    FROM ProductUsage__c WHERE AccountId IN (${idList(acctIds)})`;
  async function fetchOrgChain(seedIds){
    const map={}; let frontier=[...new Set(seedIds)].filter(Boolean); let depth=0;
    while(frontier.length && depth<10){
      const batch=frontier.filter(id=>!map[id]); if(!batch.length) break;
      const rows=await soql(`SELECT Id, Name, Title, ManagerId FROM User WHERE Id IN (${idList(batch)})`);
      rows.forEach(u=>{ map[u.Id]=u; });
      frontier=rows.map(u=>u.ManagerId).filter(id=>id && !map[id]);
      depth++;
    }
    return map;
  }
  const [userMap, cases, dealAgg, sentAgg, blockedAgg, agingAgg, growthAgg, npsAgg, tapAgg, usageAgg] = await Promise.all([
    fetchOrgChain([...ownerIds]), soql(q3), soql(qDeals), soql(qSent), soql(qBlocked), soql(qAging), soql(qGrowth), soql(qNps), soql(qTap), soql(qUsage)
  ]);

  cases.forEach(c=>{
    const a = acctMap[c.AccountId]; if(!a) return;
    const p = c.Priority||'None'; const n = c.cnt||0;
    a.byPri[p] = (a.byPri[p]||0)+n; a.openCases += n;
    if(p==='High'||p==='Urgent'||p==='Critical') a.highCases += n;
  });
  dealAgg.forEach(r=>{ const a=acctMap[r.AccountId]; if(!a) return; a.ltv=r.s||0; a.pastDeals=r.c||0; a.firstPurchase=r.mn||null; a.lastPurchase=r.mx||null; });
  sentAgg.forEach(r=>{ const a=acctMap[r.AccountId]; if(!a) return; const n=r.c||0; a.lifeCases+=n; if(r.IsEscalated) a.lifeEsc+=n; if(r.Priority==='High'||r.Priority==='Urgent'||r.Priority==='Critical') a.lifeHigh+=n; });
  blockedAgg.forEach(r=>{ const a=acctMap[r.AccountId]; if(a) a.casesBlocked=r.c||0; });
  agingAgg.forEach(r=>{ const a=acctMap[r.AccountId]; if(a) a.casesAging=r.c||0; });
  growthAgg.forEach(r=>{ const a=acctMap[r.AccountId]; if(a && r.GrowthType) a.growth[r.GrowthType]=r.amt||0; });
  npsAgg.forEach(r=>{ const a=acctMap[r.AccountId]; if(a){ a.nps=r.NPS_Score__c; a.npsDate=r.SurveyDate__c; } });
  tapAgg.forEach(r=>{ const a=acctMap[r.AccountId]; if(a) a.tapHwStart=r.HwFirstPurchase__c||null; });
  usageAgg.forEach(r=>{ const a=acctMap[r.AccountId]; if(!a) return;
    const rawProds=(r.Products&&r.Products.records)||r.Products||[];
    a.usage={
      licensed:r.SeatsLicensed__c, active:r.SeatsActive__c, adoptionPct:r.AdoptionPct__c, trend:r.UsageTrendPct__c,
      commTarget:r.CommissionTarget__c, commAttained:r.CommissionAttained__c, sync:r.LastUsageSync__c,
      products:rawProds.map(p=>({family:p.family!=null?p.family:p.Family, licensed:p.licensed!=null?p.licensed:p.Licensed, active:p.active!=null?p.active:p.Active, pct:p.pct!=null?p.pct:p.Pct}))
    };
  });
  accounts.forEach(computeSentiment);
  accounts.forEach(computeTap);

  const nodes = {};
  Object.values(userMap).forEach(u=>{ nodes[u.Id]={id:u.Id,name:u.Name,title:u.Title||'',managerId:u.ManagerId||null,children:{},accounts:[]}; });
  accounts.forEach(a=>{ const o=nodes[a.ownerId]; if(o) o.accounts.push(a); });
  Object.values(nodes).forEach(n=>{ if(n.managerId && n.managerId!==n.id && nodes[n.managerId]) nodes[n.managerId].children[n.id]=nodes[n.id]; });
  const roots = Object.values(nodes).filter(n=>!n.managerId || !nodes[n.managerId]);
  const root = {id:'ROOT', name:'Axon Customer Success', title:'All teams', children:{}, accounts:[], synthetic:true};
  roots.forEach(r=> root.children[r.id]=r);

  STATE.accounts = accounts; STATE.users = nodes; STATE.tree = root; STATE.nodeIndex = Object.assign({ROOT:root}, nodes);
  computeAll();
  $('#asof').textContent = 'As of '+today.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  route();
}

// ---------- sentiment ----------
function computeSentiment(a){
  const total=a.lifeCases||0;
  if(total===0){ a.sentiment=null; a.sentTier='none'; return; }
  const highRate=(a.lifeHigh||0)/total, escRate=(a.lifeEsc||0)/total;
  let pen=0;
  pen += Math.min(highRate*100*0.45, 35);
  pen += Math.min(escRate*100*0.90, 30);
  pen += Math.min(total/250*15, 15);
  pen += Math.min((a.highCases||0)*4, 20);
  const s=Math.max(0,Math.min(100,Math.round(100-pen)));
  a.sentiment=s; a.sentTier = s>=70?'pos':s>=45?'neu':'neg';
}
// ---------- TAP (hardware warranty refresh) ----------
// Per Leana's stakeholder finding: TAP refresh is due at the 2.5-year midpoint
// of a 5-year hardware contract (Cart/FLEX2/X26/BODYCAM3/FLEET/AIR/INTERVIEW —
// not the SAAS/Training/software side of the book, which doesn't carry a
// hardware warranty cycle).
const TAP_TERM_YEARS=5, TAP_REFRESH_AT_YEARS=2.5;
function addYears(iso,years){ const d=new Date(iso); d.setDate(d.getDate()+Math.round(years*365.25)); return d; }
function computeTap(a){
  if(!a.tapHwStart){ a.tapRefreshDate=null; a.tapContractEnd=null; a.tapStatus='none'; a.tapDays=null; return; }
  const refresh=addYears(a.tapHwStart,TAP_REFRESH_AT_YEARS);
  const end=addYears(a.tapHwStart,TAP_TERM_YEARS);
  a.tapRefreshDate=sfDate(refresh);
  a.tapContractEnd=sfDate(end);
  const daysToRefresh=Math.round((refresh-new Date())/864e5);
  a.tapDays=daysToRefresh;
  const done = tapState[a.id]&&tapState[a.id].refreshedAt;
  a.tapStatus = done ? 'done' : daysToRefresh<0 ? 'overdue' : daysToRefresh<=90 ? 'duesoon' : 'ontrack';
}
function tapStatusPill(a){
  const m={overdue:['p-red','Overdue'],duesoon:['p-amber','Due soon'],ontrack:['p-green','On track'],done:['p-gray','Refreshed'],none:['p-gray','No hardware on file']};
  const [cls,lbl]=m[a.tapStatus]||m.none; return `<span class="pill ${cls}">${lbl}</span>`;
}
function sentPill(a){
  if(a.sentiment==null) return '<span class="pill p-gray">No history</span>';
  const cls=a.sentTier==='pos'?'p-green':a.sentTier==='neu'?'p-amber':'p-red';
  const lbl=a.sentTier==='pos'?'Positive':a.sentTier==='neu'?'Neutral':'Strained';
  return `<span class="pill ${cls}">${lbl} · ${a.sentiment}</span>`;
}

// ---------- CSAT (placeholder — swap in survey data later) ----------
// No native CSAT/survey object exists in this org yet. Until surveys are wired up,
// CSAT shows a placeholder: a manual value if a CSM has set one, otherwise a
// derived stand-in from the sentiment signal. Clearly flagged as a placeholder.
function csatVal(a){
  if(csat[a.id]!=null) return {v:csat[a.id], src:'manual'};
  if(a.sentiment!=null) return {v:a.sentiment, src:'placeholder'};
  return {v:null, src:'none'};
}
function setCsat(id,v){ if(v===''||v==null){ delete csat[id]; } else { csat[id]=Math.max(0,Math.min(100,Math.round(+v))); } LS.set('csat',csat); refreshCsat(); }
function refreshCsat(){ STATE.accounts.forEach(a=>{ a.csat=csatVal(a).v; }); }
function csatFace(v){ return v>=80?'Very satisfied':v>=60?'Satisfied':v>=40?'Neutral':v>=20?'Dissatisfied':'At risk'; }
function csatColor(v){ return v==null?'var(--muted)':v>=75?'var(--green)':v>=50?'var(--amber)':'var(--red)'; }
function csatPill(a){ const c=csatVal(a); if(c.v==null) return '<span class="pill p-gray">CSAT —</span>'; const cls=c.v>=75?'p-green':c.v>=50?'p-amber':'p-red'; return `<span class="pill ${cls}">CSAT ${c.v}%${c.src==='placeholder'?'*':''}</span>`; }

// ---------- NPS (real biannual survey — 10% of CSM comp, per CS sponsor's
// consolidated stakeholder findings; NOT a placeholder like CSAT since it
// already lands in a Salesforce report today) ----------
function npsClassify(score){ return score>=9?'promoter':score>=7?'passive':'detractor'; }
function npsPill(a){
  if(a.nps==null) return '<span class="pill p-gray">NPS — (no response)</span>';
  const cls=a.nps>=9?'p-green':a.nps>=7?'p-amber':'p-red';
  return `<span class="pill ${cls}">NPS ${a.nps}/10</span>`;
}
function npsRollup(accts){
  const responded = accts.filter(a=>a.nps!=null);
  if(!responded.length) return null;
  const promoters = responded.filter(a=>npsClassify(a.nps)==='promoter').length;
  const detractors = responded.filter(a=>npsClassify(a.nps)==='detractor').length;
  const score = Math.round(((promoters-detractors)/responded.length)*100);
  return {score, n:responded.length, promoters, detractors, passives:responded.length-promoters-detractors};
}
function npsRollupPill(rollup){
  if(!rollup) return '<span class="pill p-gray">No survey data</span>';
  const cls=rollup.score>=30?'p-green':rollup.score>=0?'p-amber':'p-red';
  return `<span class="pill ${cls}">NPS ${rollup.score}</span>`;
}

// ---------- health scoring ----------
function daysTo(d){ if(!d) return 9999; return Math.round((new Date(d)-new Date())/86400000); }
const EARLY = new Set(['Discovering','Pre Sales','Interest','Qualifying','Evaluation/Scoping','Prospecting']);
function scoreAccount(a){
  const comps=[]; let pen=0;
  if(a.openCases>0){ const p=Math.min(a.openCases*WEIGHTS.openCase,26); pen+=p; comps.push(['Open support cases ('+a.openCases+')',-Math.round(p)]); }
  if(a.highCases>0){ const p=Math.min(a.highCases*WEIGHTS.highSev,30); pen+=p; comps.push(['High/urgent cases ('+a.highCases+')',-Math.round(p)]); }
  const d=daysTo(a.nextClose);
  if(d<=90){ pen+=WEIGHTS.proxNear; comps.push(['Renewal within 90 days',-WEIGHTS.proxNear]); }
  else if(d<=180){ pen+=WEIGHTS.proxMid; comps.push(['Renewal within 180 days',-WEIGHTS.proxMid]); }
  const earlyStage = a.opps.some(o=>EARLY.has(o.stage));
  if(d<=120 && earlyStage){ pen+=WEIGHTS.stageRisk; comps.push(['Near renewal still in early stage',-WEIGHTS.stageRisk]); }
  const dsAct = a.lastAct ? Math.round((new Date()-new Date(a.lastAct))/86400000) : null;
  a.dsAct = dsAct;
  if(dsAct==null || dsAct>180){ pen+=WEIGHTS.engage; comps.push([dsAct==null?'No engagement logged on account':('No activity in '+dsAct+' days'),-WEIGHTS.engage]); }
  else if(dsAct>90){ const p=Math.round(WEIGHTS.engage*0.5); pen+=p; comps.push(['Light engagement ('+dsAct+'d since last touch)',-p]); }
  const score=Math.max(0,Math.min(100,Math.round(100-pen)));
  a.health=score; a.comps=comps; a.dclose=d;
  a.tier = score>=75?'healthy':score>=50?'watch':'atrisk';
  a.riskARR = a.renewalAmount*(100-score)/100;
  return a;
}
function computeAll(){ STATE.accounts.forEach(a=>{ syncLastActFromActivity(a.id); scoreAccount(a); }); refreshCsat(); rebuildEsc(); seedMockCsatQuarter(); }

// ---------- account tiering beyond size ----------
// Segment (Strategic/Enterprise/Mid-Market/SMB) is purely a size tier (renewal $).
// This is a second axis — is there real expansion opportunity here, or is this a
// churn-risk account to protect first — in the same spirit as the health-scoring
// system, but answering "what's the play on this account" rather than "is it
// healthy". Combines existing health/tier with growth-mix "attach depth" (how much
// of lifetime value is Expansion/Transactional vs. pure Renewal) and NPS.
function opportunityTier(a){
  const g=a.growth||{Renewal:0,Expansion:0,Transactional:0};
  const nonRenewal=(g.Expansion||0)+(g.Transactional||0);
  const attachDepth = a.ltv>0 ? nonRenewal/a.ltv : 0; // 0 = pure-renewal book so far, closer to 1 = already heavily cross/up-sold
  const detractor = a.nps!=null && a.nps<=6;
  const promoter = a.nps!=null && a.nps>=9;
  if(a.tier==='atrisk' && a.renewalAmount>=250000) return 'protect'; // big $ + churn risk — defend before anything else
  if(a.tier==='atrisk') return 'nurture'; // at-risk but smaller — still needs attention, not a portfolio-level fire drill
  if(attachDepth<0.15 && !detractor) return 'expand'; // healthy/watch, little cross-sell yet — room to grow
  if(promoter && attachDepth<0.35) return 'expand';
  return 'steady';
}
const OPP_TIER_LABELS={expand:'Expansion ready',protect:'Protect & retain',nurture:'Nurture',steady:'Steady / core'};
const OPP_TIER_PILL={expand:'p-green',protect:'p-red',nurture:'p-amber',steady:'p-gray'};
function opportunityPill(a){ const t=opportunityTier(a); return `<span class="pill ${OPP_TIER_PILL[t]}">${esc(OPP_TIER_LABELS[t])}</span>`; }

// ---------- new-logo detection ----------
function newLogo(a){ const ds=daysSince(a.firstPurchase); return ds!=null && ds<=365; }

// ---------- escalations ----------
// Escalations are distinct from routine support tickets, per Leana's stakeholder
// finding: they need a reason code, a product tag, a standardized set of
// actionable next steps, and days-open/staleness tracking so leadership can see
// the portfolio rollup rather than reading every account one by one.
function autoSeverity(a){ if(a.health<40||a.highCases>=3) return 'Critical'; if(a.health<55||a.highCases>=1) return 'High'; if(a.health<70) return 'Medium'; return 'Low'; }
const ESC_REASONS=['Technical','Support Experience','Feature Request','Other'];
const ESC_PRODUCTS=['SAAS','Cart','Training','INTERVIEW','FLEX 2','X26','COMMANDER','BODYCAM3','FLEET','AIR','Other'];
const ESC_STEPS_TEMPLATE=[
  'Acknowledge issue with customer',
  'Identify root cause / confirm reason code',
  'Loop in product or engineering if needed',
  'Provide resolution or workaround',
  'Confirm customer satisfaction with outcome',
  'Close out and log resolution',
];
// Deterministic ids (index-based, not random) so a step checked before the
// escState record exists yet still resolves to the same id once ensureEscState
// persists the template - see peekEscState below.
const freshEscSteps=()=>ESC_STEPS_TEMPLATE.map((label,i)=>({id:'s'+i,label,done:false}));
function ensureEscState(acctId){
  let cur=escState[acctId]; let changed=false;
  if(!cur){ cur=escState[acctId]={status:'Open',log:[],reasonCode:null,product:null,steps:freshEscSteps(),openedAt:new Date().toISOString(),resolvedAt:null}; changed=true; }
  else{
    if(!cur.log){ cur.log=[]; changed=true; }
    if(!cur.steps||!cur.steps.length){ cur.steps=freshEscSteps(); changed=true; }
    if(cur.reasonCode===undefined){ cur.reasonCode=null; changed=true; }
    if(cur.product===undefined){ cur.product=null; changed=true; }
    if(!cur.openedAt){ cur.openedAt=new Date().toISOString(); changed=true; }
    if(cur.resolvedAt===undefined){ cur.resolvedAt=null; changed=true; }
  }
  if(changed) LS.set('escState',escState);
  return cur;
}
// Read-only lookup for rendering (e.g. a healthy account's 360 view) that never
// creates/persists a phantom "Open" escalation just because the account was viewed.
// Mutating actions (checking a step, tagging a reason/product, adding a note)
// still go through ensureEscState so the record is created at the point of intent.
function peekEscState(acctId){
  const cur=escState[acctId];
  if(cur) return {status:cur.status||'Open',log:cur.log||[],reasonCode:cur.reasonCode||null,product:cur.product||null,
    steps:(cur.steps&&cur.steps.length)?cur.steps:freshEscSteps(),openedAt:cur.openedAt||null};
  return {status:null,log:[],reasonCode:null,product:null,steps:freshEscSteps(),openedAt:null};
}
function rebuildEsc(){
  STATE.escList = STATE.accounts.filter(a=> a.tier!=='healthy' && (a.highCases>0 || a.health<60 || (a.dclose<=90)))
    .map(a=>{
      const st = ensureEscState(a.id);
      const sev = autoSeverity(a);
      const issue = a.highCases>0 ? `${a.highCases} high/urgent case(s) open` :
                    a.dclose<=90 ? `Renewal in ${a.dclose}d, health ${a.health}` :
                    `Health ${a.health} — ${a.openCases} open cases`;
      const daysOpen = st.openedAt ? Math.floor((Date.now()-new Date(st.openedAt).getTime())/864e5) : null;
      return {acctId:a.id, acct:a, sev, issue, status:st.status, log:st.log, reasonCode:st.reasonCode, product:st.product, steps:st.steps, daysOpen};
    })
    .sort((x,y)=> (sevRank(y.sev)-sevRank(x.sev)) || (y.acct.riskARR-x.acct.riskARR));
  STATE.escOpenCount = STATE.escList.filter(e=>e.status!=='Resolved').length;
}
function sevRank(s){return {Critical:4,High:3,Medium:2,Low:1}[s]||0;}
function setEscStatus(acctId,status){
  const cur = ensureEscState(acctId);
  cur.status=status;
  if(status==='In Progress' && !cur.openedAt) cur.openedAt=new Date().toISOString();
  if(status==='Resolved') cur.resolvedAt=new Date().toISOString();
  else if(cur.resolvedAt) cur.resolvedAt=null; // reopened — clear so time-to-resolve only counts real resolutions
  cur.log.push({t:new Date().toISOString(), note:'Status → '+status});
  LS.set('escState',escState);
  try{ rebuildEsc(); }catch(e){ console.warn(e); }
  if(STATE.tab==='escalations') route();
}
function startEscalation(acctId){
  setEscStatus(acctId,'In Progress');
  toast('Escalation started — status is In Progress.');
  openAcct(acctId);
  setTimeout(()=>{
    const el=document.getElementById('acctEscalation');
    if(el) el.scrollIntoView({behavior:'smooth',block:'start'});
  },80);
}
function addEscNote(acctId,note){ if(!note) return; const cur=ensureEscState(acctId); cur.log.push({t:new Date().toISOString(),note}); LS.set('escState',escState); }
function setEscReason(acctId,val){ const cur=ensureEscState(acctId); cur.reasonCode=val||null; LS.set('escState',escState); rebuildEsc(); if(STATE.tab==='escalations') route(); }
function setEscProduct(acctId,val){ const cur=ensureEscState(acctId); cur.product=val||null; LS.set('escState',escState); rebuildEsc(); if(STATE.tab==='escalations') route(); }
function toggleEscStep(acctId,stepId,done){ const cur=ensureEscState(acctId); const s=cur.steps.find(x=>x.id===stepId); if(s) s.done=done; LS.set('escState',escState); openAcct(acctId); }
function escStepProgress(steps){ if(!steps||!steps.length) return 0; return Math.round(steps.filter(s=>s.done).length/steps.length*100); }

// ---------- roll-ups ----------
function accountsUnder(nodeId){
  const node = STATE.nodeIndex[nodeId]; if(!node) return [];
  const out=[], seen=new Set();
  (function walk(n){ if(!n||seen.has(n.id)) return; seen.add(n.id);   // guard against manager-chain cycles
    (n.accounts||[]).forEach(a=>out.push(a)); Object.values(n.children||{}).forEach(walk); })(node);
  return out;
}
function rollup(accts){
  const r={arr:0,risk:0,cases:0,high:0,n:accts.length,renewals:0,red:0,amber:0,green:0,wsum:0,ltv:0,
    growth:{Renewal:0,Expansion:0,Transactional:0}, inCadence:0, blocked:0, aging:0};
  accts.forEach(a=>{ r.arr+=a.renewalAmount; r.risk+=a.riskARR; r.cases+=a.openCases; r.high+=a.highCases; r.renewals+=a.opps.length; r.ltv+=a.ltv||0;
    r.wsum+=a.health*a.renewalAmount; if(a.tier==='atrisk')r.red++; else if(a.tier==='watch')r.amber++; else r.green++;
    const g=a.growth||{}; r.growth.Renewal+=g.Renewal||0; r.growth.Expansion+=g.Expansion||0; r.growth.Transactional+=g.Transactional||0;
    if(cadenceInfo(a).tier==='green') r.inCadence++;
    r.blocked+=a.casesBlocked||0; r.aging+=a.casesAging||0; });
  r.health = r.arr>0? Math.round(r.wsum/r.arr) : Math.round(accts.reduce((s,a)=>s+a.health,0)/(accts.length||1));
  const cv=accts.map(a=>csatVal(a).v).filter(v=>v!=null); r.csat = cv.length?Math.round(cv.reduce((s,v)=>s+v,0)/cv.length):null;
  r.engagementPct = r.n? Math.round(r.inCadence/r.n*100) : 0;
  r.growthTotal = r.growth.Renewal+r.growth.Expansion+r.growth.Transactional;
  return r;
}
function crumbPath(nodeId){
  const path=[]; let cur=STATE.nodeIndex[nodeId];
  while(cur){ path.unshift(cur); cur = cur.managerId?STATE.nodeIndex[cur.managerId]:null; if(cur&&path.includes(cur))break; }
  if(STATE.tree && path[0]!==STATE.tree) path.unshift(STATE.tree);
  return path.filter(Boolean);
}

// ---------- shared cells ----------
const TAB_LABELS={home:'Home',overview:'Command Center',hierarchy:'Org Drill-down',renewals:'Renewals & Contract Value',tap:'TAP Refreshes',scorecard:'CSM Scorecard',usage:'Usage & Adoption',ctas:'CTAs',escalations:'Escalations',casewatch:'Case Watch',engagement:'Engagement Cadence',plans:'Success Plans',emails:'Email Outreach',worklist:'My Worklist',model:'Configurable Health Model',resources:'Resource Library',execreport:'Executive Report',
  gong:'Meeting Notes / Gong Intelligence',acctoutcomes:'Account Outcomes',prodoutcomes:'Product Outcomes',
  npsmanaged:'Managed-Account NPS',npsagency:'Agency NPS',csat:'NPS & CSAT Management',insights:'Customer Insights',
  acctscorecard:'Account Scorecard',prodscorecard:'Product Scorecard',integrations:'Integrations & Data Sources'};

// ---------- nav: icon rail + category flyout ----------
// Categories group the 28 tabs into 8 icons. A category with a single tab
// navigates straight there on click; a category with multiple tabs opens a
// pinned flyout of its sub-items to the right of the rail (stays open across
// selections, like VS Code's activity bar + sidebar) instead of collapsing
// after each pick.
const NAV_CATEGORIES=[
  {id:'home',label:'Home',icon:'<path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5H10v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',tabs:['home']},
  {id:'cockpit',label:'My Book',icon:'<path d="M12 6C10 4.3 6.8 3.8 3.5 4.3v13.8c3.3-.5 6.5 0 8.5 1.7 2-1.7 5.2-2.2 8.5-1.7V4.3C17.2 3.8 14 4.3 12 6Z"/><path d="M12 6v13.8"/>',tabs:['overview','worklist','hierarchy']},
  {id:'pulse',label:'Customer Pulse',icon:'<path d="M3 12h4l2-7 4 14 2-7h6"/>',tabs:['npsagency','npsmanaged','csat','insights']},
  {id:'risk',label:'Accounts & Risk',icon:'<path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3Z"/><path d="M12 8v5M12 16h.01"/>',tabs:['renewals','tap','casewatch','escalations']},
  {id:'engagement',label:'Engagement',icon:'<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',tabs:['engagement','ctas','emails','gong']},
  {id:'journey',label:'Customer Success Journey',icon:'<path d="M6 3v18"/><path d="M6 5h12l-3 4 3 4H6"/>',tabs:['plans','acctoutcomes','prodoutcomes','usage']},
  {id:'performance',label:'Performance',icon:'<path d="M4 20h16M7 20V10m5 10V4m5 16v-7"/>',tabs:['scorecard','acctscorecard','prodscorecard','execreport','model']},
  {id:'resources',label:'Resources',icon:'<path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2Z"/><path d="M20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2Z"/>',tabs:['resources','integrations']},
];
function categoryForTab(tab){ return NAV_CATEGORIES.find(c=>c.tabs.includes(tab)) || NAV_CATEGORIES[0]; }
let navOpenCat = categoryForTab(STATE.tab).id;
function renderNav(){
  const rail=$('#iconRail'), fly=$('#flyout'); if(!rail) return;
  const activeCat=navOpenCat||categoryForTab(STATE.tab).id;
  rail.innerHTML=NAV_CATEGORIES.map(c=>`<button class="rail-btn${activeCat===c.id?' active':''}" data-cat="${c.id}" title="${esc(c.label)}"><svg class="ic" viewBox="0 0 24 24">${c.icon}</svg></button>`).join('');
  rail.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>onRailClick(b.dataset.cat)));
  renderFlyout();
}
function onRailClick(catId){
  const cat=NAV_CATEGORIES.find(c=>c.id===catId);
  if(cat.tabs.length===1){ setTab(cat.tabs[0]); return; }
  if(navOpenCat===catId){ navOpenCat=null; renderNav(); return; }
  // Opening a category jumps straight to its first sub-item instead of just
  // revealing the flyout with nothing selected — clicking the icon should
  // always do something to the page, not just show a list.
  setTab(cat.tabs[0]);
}
function renderFlyout(){
  const fly=$('#flyout'); if(!fly) return;
  const cat=NAV_CATEGORIES.find(c=>c.id===navOpenCat);
  if(!cat || cat.tabs.length<=1){ fly.classList.add('hidden'); fly.innerHTML=''; document.body.classList.remove('flyout-open'); return; }
  document.body.classList.add('flyout-open');
  fly.classList.remove('hidden');
  fly.innerHTML=`
    <div class="flyout-top">
      <span class="flyout-h">${esc(cat.label)}</span>
      <button type="button" class="flyout-collapse" id="flyoutCollapse" title="Collapse">&laquo;</button>
    </div>
    <input type="text" class="flyout-search" id="flyoutSearch" placeholder="Search…" autocomplete="off">
    <div class="flyout-list" id="flyoutList"></div>`;
  $('#flyoutCollapse').addEventListener('click',()=>{ navOpenCat=null; renderNav(); });
  $('#flyoutSearch').addEventListener('input',e=>renderFlyoutList(cat,e.target.value));
  renderFlyoutList(cat,'');
}
// Rebuilds only the item list (not the search input itself) on each keystroke,
// so typing doesn't blow away cursor position/focus the way a full re-render would.
function renderFlyoutList(cat,q){
  const list=$('#flyoutList'); if(!list) return;
  const qq=(q||'').toLowerCase();
  const items=cat.tabs.filter(t=>!qq||(TAB_LABELS[t]||t).toLowerCase().includes(qq));
  list.innerHTML = items.length
    ? items.map(t=>`<button class="flyout-btn${STATE.tab===t?' active':''}" data-tab="${t}"><span class="flabel">${esc(TAB_LABELS[t]||t)}</span><span class="b" data-badge="${t}"></span></button>`).join('')
    : `<div class="mini" style="padding:8px 10px">No matches</div>`;
  list.querySelectorAll('button[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
  applyBadges();
}
function scaffoldView(title,hint,bullets){
  return `<div class="card"><h3>${esc(title)} <span class="hint">${esc(hint)}</span></h3>
  <p class="mini" style="line-height:1.7">Planned addition — not yet wired to live data. Requirements captured for this view:</p>
  <ul style="margin:8px 0 0;padding-left:18px;line-height:1.8">${bullets.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>
  </div>`;
}
function viewGong(){ return scaffoldView('Meeting Notes / Gong Intelligence','call intelligence and note-taking, including Axon-specific terminology',[
  'Gong-sourced call notes and highlights surfaced per account','Support for Axon-specific terminology (e.g. ALPR) in transcription/tagging','Tie into Engagement cadence so a Gong-logged call counts toward cadence tracking']); }
function viewAcctOutcomes(){ return scaffoldView('Account Outcomes','goal and outcome tracking at the account level',[
  'Account-level goals distinct from product-level goals','Progress toward outcomes, not just milestone completion','Feeds the Account Scorecard under Performance']); }
function viewProdOutcomes(){ return scaffoldView('Product Outcomes','goal and outcome tracking at the product level',[
  'Per-product goals and health, independent of overall account health','An account can be green overall while one product line (e.g. Fusus) is red','Feeds the Product Scorecard under Performance']); }
// ---- NPS (Managed-Account & Agency) ----
// Two independent populations per Rui's requirement: Managed-Account NPS is the
// real per-account NPS already modeled on STATE.accounts; Agency NPS simulates
// the broader, larger agency-wide population (multiple divisions per customer,
// not just the primary contact a CSM talks to) — built from the same accounts
// so it stays grounded in real mock entities rather than inventing new ones.
// Kudos is intentionally omitted per instruction; this focuses on what's
// driving scores below 9 so a CSM knows exactly what to act on.
function mulberry32(seed){ return function(){ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
const NPS_CATS=['Pricing & Contract Value','Product Reliability','Support Responsiveness','Missing Features','Onboarding & Training','Account Communication','Hardware / TAP Issues','Integration & Technical'];
const NPS_COMMENTS={
  'Pricing & Contract Value':["Renewal pricing increased more than we expected for the value delivered.","Contract terms feel rigid compared to alternatives we've evaluated.","Budget approval is getting harder to justify at this price point."],
  'Product Reliability':["We've had recurring stability issues during peak usage.","Too many bugs have surfaced since the last release.","Performance has degraded noticeably over the past few months."],
  'Support Responsiveness':["Support tickets take too long to get a first response.","Had to escalate multiple times before getting traction.","First-contact resolution has been inconsistent."],
  'Missing Features':["Reporting doesn't cover what our command staff actually needs.","We've requested key functionality multiple times without movement.","Feature parity with competitors is lacking in a few critical areas."],
  'Onboarding & Training':["New hires aren't getting ramped up fast enough on the platform.","Initial rollout training didn't cover enough real-world scenarios.","We need more refresher training resources for existing users."],
  'Account Communication':["We don't hear from our CSM often enough to feel supported.","Nobody proactively flagged the renewal timeline to us.","Turnover on the account team has hurt continuity."],
  'Hardware / TAP Issues':["The hardware refresh process has been slower than expected.","Device reliability in the field has been inconsistent.","RMA turnaround time needs improvement."],
  'Integration & Technical':["Integration with our records system keeps breaking.","API reliability has been a recurring headache for our IT team.","Single sign-on has caused repeated login issues."]
};
let npsDatasets={};
const AXON_DESCRIPTIONS=['Strategic Partner','Supplier','Vendor'];
const RELATIONSHIP_INTENTS=['Grow','Stay the same','Decline'];
function pickDescription(rnd,score){
  const r=rnd();
  if(score>=9) return r<0.64?'Strategic Partner':r<0.94?'Vendor':'Supplier';
  if(score>=7) return r<0.45?'Strategic Partner':r<0.85?'Vendor':'Supplier';
  return r<0.2?'Strategic Partner':r<0.6?'Vendor':'Supplier';
}
function pickRelationshipIntent(rnd,score){
  const r=rnd();
  if(score>=9) return r<0.88?'Grow':'Stay the same';
  if(score>=7) return r<0.6?'Grow':r<0.97?'Stay the same':'Decline';
  return r<0.25?'Grow':r<0.85?'Stay the same':'Decline';
}
function getNpsDataset(kind){
  if(npsDatasets[kind]) return npsDatasets[kind];
  const rnd=mulberry32(kind==='managed'?1337:7331);
  const pick=(arr)=>arr[Math.floor(rnd()*arr.length)];
  let rows=[];
  if(kind==='managed'){
    rows=STATE.accounts.filter(a=>a.nps!=null).map(a=>({id:a.id,label:a.name,owner:a.ownerName,score:a.nps,date:a.npsDate||''}));
  }else{
    const roles=['Patrol Operations','Records & Evidence','IT / Systems','Command Staff','Training Division'];
    STATE.accounts.forEach(a=>{
      const n=1+Math.floor(rnd()*3);
      for(let i=0;i<n;i++){
        const base=a.nps!=null?a.nps:6;
        const score=Math.max(0,Math.min(10,Math.round(base+Math.round((rnd()-0.5)*6))));
        rows.push({id:a.id,label:a.name+' — '+pick(roles),owner:a.ownerName,score,date:a.npsDate||''});
      }
    });
  }
  rows.forEach(r=>{
    if(r.score<=9){ r.category=pick(NPS_CATS); r.comment=pick(NPS_COMMENTS[r.category]); }
    r.description=pickDescription(rnd,r.score);
    r.relationshipIntent=pickRelationshipIntent(rnd,r.score);
    Object.assign(r,maybeCsatComplaint(rnd,r.score));
  });
  npsDatasets[kind]={rows,promoters:rows.filter(r=>r.score>9),detractors:rows.filter(r=>r.score<=9)};
  return npsDatasets[kind];
}
// CSAT is a real 1-10 satisfaction score (the form's "CSAT CSM" question is a
// misleading label for it) plus a free-text comment — feedback about the
// account's real assigned CSM, which we already know via r.owner, so there's
// no separate "who" field needed.
const CSM_COMPLAINT_COMMENTS=["Feels like we're an afterthought — hard to get a response.","Turnover on our account team has made this relationship inconsistent.","Follow-through on commitments has been inconsistent.","We've had to escalate more than we should have to get attention.","Communication has been reactive instead of proactive."];
function maybeCsatComplaint(rnd,score){
  const p=score<=6?0.35:score<=8?0.12:0.03;
  if(rnd()>=p) return {csatScore:null,csatComments:''};
  const csatScore=Math.max(0,Math.min(10,score+Math.round((rnd()-0.5)*3)));
  return {csatScore,csatComments:CSM_COMPLAINT_COMMENTS[Math.floor(rnd()*CSM_COMPLAINT_COMMENTS.length)]};
}
function categoryCounts(rows,field){
  const counts={};
  rows.forEach(r=>{ const v=r[field]; if(!v) return; counts[v]=(counts[v]||0)+1; });
  return Object.entries(counts).map(([k,n])=>({k,n}));
}
function npsCategoryCounts(detractors){
  const counts={};
  detractors.forEach(d=>{ counts[d.category]=(counts[d.category]||0)+1; });
  return Object.entries(counts).map(([cat,n])=>({cat,n})).sort((a,b)=>b.n-a.n);
}
function npsSlug(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function scrollToNpsDriver(kind,cat){
  const el=document.getElementById('npsdrv-'+kind+'-'+npsSlug(cat));
  if(el){ el.open=true; el.scrollIntoView({behavior:'smooth',block:'start'}); }
}
function scrollToCsmDriver(kind,csm){
  const el=document.getElementById('csmdrv-'+kind+'-'+npsSlug(csm));
  if(el){ el.open=true; el.scrollIntoView({behavior:'smooth',block:'start'}); }
}
function scrollToSection(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }
function destroyChartKey(key){ if(charts[key]){ try{charts[key].destroy()}catch(e){} delete charts[key]; } }

// ---- Test 10 (real Google Form pilot) ----
// 10 hand-picked accounts (chosen for disparity in segment/contract value/NPS)
// wired to a real Google Form -> Sheet, read via GET /api/survey/responses
// (backend/app/sheets_client.py, service-account auth - see NOTES.md). Until a
// real response lands for an account, that row is filled with seeded mock data
// (same generator style as Agency NPS) so the views are demonstrable end to
// end; each row is tagged source:'sheet' or source:'mock' so it's always
// clear which is real. Manual refresh only (no auto-poll), per instruction.
const TEST10_ACCOUNTS=['Springfield Fire & Rescue','Union City Correctional Facility','Zionsville Highway Patrol','Kingsley Fire & Rescue','Westgate Correctional Facility','Harborview Fire & Rescue','Georgetown Public Safety Dept.',"Jasper County Sheriff's Office",'Thornbury Highway Patrol','Lakewood Correctional Facility'];
let sheetDataCache=null, sheetFetchError=null, sheetLastFetch=null;
async function refreshSheetData(){
  sheetFetchError=null;
  try{
    const res=await fetch('/api/survey/responses',{credentials:'same-origin'});
    if(res.status===401){ goToLogin(); return; }
    const data=await res.json();
    if(data.configured===false){ sheetFetchError='Google Sheets isn’t configured on the backend yet (missing service account key).'; sheetDataCache=[]; }
    else{ sheetDataCache=data.records||[]; }
    sheetLastFetch=new Date();
  }catch(e){ sheetFetchError='Could not reach the backend: '+(e.message||e); }
  route();
}

// ---- Automation Batch (email automation demo) ----
// Two configurable automations shown as connected bubbles: "Automation Settings"
// (the recurring NPS/CSAT outreach schedule) and "Escalation Automations" (a
// follow-up trigger relative to the first send). No real recipient list or
// scheduler exists yet - clicking "Send now (demo)" fires one real email via
// Gmail (backend/app/gmail_client.py) to axongainsightrp@gmail.com so the team
// can see exactly what the automated message will look like end to end. A bubble
// stays amber (configured, not yet sent) until it actually sends, then turns
// green with an italic confirmation.
let automationConfig=LS.get('automationConfig',{month:1,day:1,sentAt:null,sending:false});
let escalationConfig=LS.get('escalationConfig',{days:15,sentAt:null,sending:false});
let automationPanelOpen=null; // 'settings' | 'escalation' | null
function saveAutomationConfig(){ LS.set('automationConfig',automationConfig); }
function saveEscalationConfig(){ LS.set('escalationConfig',escalationConfig); }
function toggleAutomationPanel(which){ automationPanelOpen=automationPanelOpen===which?null:which; route(); }
function setAutomationMonth(v){ automationConfig.month=Math.min(3,Math.max(1,parseInt(v,10)||1)); automationConfig.sentAt=null; saveAutomationConfig(); }
function setAutomationDay(v){ automationConfig.day=Math.min(31,Math.max(1,parseInt(v,10)||1)); automationConfig.sentAt=null; saveAutomationConfig(); }
function setEscalationDays(v){ escalationConfig.days=Math.max(0,parseInt(v,10)||0); escalationConfig.sentAt=null; saveEscalationConfig(); }
const ORDINAL=n=>({1:'1st',2:'2nd',3:'3rd'}[n]||n+'th');
function automationScheduleLabel(){ return `${ORDINAL(automationConfig.month)} month of each quarter, day ${automationConfig.day}`; }
function escalationScheduleLabel(){ return escalationConfig.days?`${escalationConfig.days} days after first email`:'No delay set yet'; }

// Real Google Form used by the NPS/CSAT pilot (see NOTES.md / memory) - the
// same survey link the automated outreach email points recipients to.
const AUTOMATION_SURVEY_LINK='https://docs.google.com/forms/d/e/1FAIpQLSdNjXXb1-RgUeQ54LkG-UInfP0KLSGFMHomdnIUoiK_P0MGFw/viewform?usp=publish-editor';
// Picks one real example (a live Test 10 respondent's contact name if one has
// come in, otherwise the first account in the book) so the preview shows a
// genuinely-resolved email rather than a raw template - "client name" is
// whoever the account's actual contact/user is, not the agency name itself.
function automationSampleContext(){
  const real=(sheetDataCache||[]).find(r=>r.account && r.contactName);
  if(real){ const a=STATE.accounts.find(x=>x.name===real.account); return {clientName:real.contactName,csmName:(a&&a.ownerName)||'the Axon team',acctName:real.account}; }
  const a=(STATE.accounts||[])[0];
  return {clientName:a?('the team at '+a.name):'Valued Customer',csmName:(a&&a.ownerName)||'the Axon team',acctName:a?a.name:'your organization'};
}
function automationEmailTemplate(which,sample){
  if(which==='settings') return {
    subject:'Axon Customer Survey — quick check-in',
    bodyHtml:`<p>Dear ${esc(sample.clientName)},</p><p>I'm ${esc(sample.csmName)}, from Axon, and just wanted to check in on your experience with Axon products so far. It would be very helpful for us to better serve you with our Axon products and services if you fill out this survey: <a href="${AUTOMATION_SURVEY_LINK}">AXON Customer Survey</a></p><p>Thank you,<br>${esc(sample.csmName)}<br>Axon Customer Success</p>`
  };
  return {
    subject:'Following up — Axon Customer Survey',
    bodyHtml:`<p>Dear ${esc(sample.clientName)},</p><p>I'm ${esc(sample.csmName)}, from Axon. I wanted to follow up as we haven't yet heard back on the survey we sent over — your feedback genuinely helps us serve you better. If you have a couple of minutes, we'd appreciate you completing it here: <a href="${AUTOMATION_SURVEY_LINK}">AXON Customer Survey</a></p><p>Thank you,<br>${esc(sample.csmName)}<br>Axon Customer Success</p>`
  };
}
// Circular "send" button: a ring traces clockwise starting at 6 o'clock: once
// it laps back to 6, the button snaps to solid green with a checkmark that
// fades out a moment later, leaving the green (the persisted "sent" state).
function sendRingHtml(which){
  return `<div class="send-fab-wrap">
    <button type="button" class="send-fab" id="sendFab-${which}" onclick="confirmSendAutomation('${which}')">
      <svg class="send-ring" viewBox="0 0 48 48"><circle class="send-ring-fg" id="sendRing-${which}" cx="24" cy="24" r="19"/></svg>
      <svg class="send-icon-svg" viewBox="0 0 48 48">
        <path class="send-icon-arrow" d="M20 16 L31 24 L20 32 Z"/>
        <path class="send-icon-check" d="M16 24 L21.5 30 L33 17" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <span class="mini">Preview shown above — click to send this exact email now (demo)</span>
  </div>`;
}
function openAutomationPreview(which){
  const sample=automationSampleContext();
  const tpl=automationEmailTemplate(which,sample);
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2>${which==='settings'?'Automation Settings':'Escalation Automation'} — Email Preview</h2>
    <div class="mini">{Agency Contact Name}: <b>${esc(sample.clientName)}</b> · Account: <b>${esc(sample.acctName)}</b> — in this demo the send always goes to <b>axongainsightrp@gmail.com</b> so you can see exactly what it looks like; a live rollout would mass-send this to every agency contact.</div></div>
    <button class="x" onclick="closeSheet()">✕</button></div>
  <div class="bd">
    <div class="card" style="box-shadow:none;margin:0 0 16px">
      <div class="mini" style="margin-bottom:10px">Subject: <b>${esc(tpl.subject)}</b></div>
      <div style="border:1px solid var(--line);border-radius:8px;padding:18px;background:var(--panel2)">${tpl.bodyHtml}</div>
    </div>
    <div class="row-actions" style="align-items:center;gap:16px">${sendRingHtml(which)}</div>
  </div>`;
  showOverlay();
}
async function confirmSendAutomation(which){
  const cfg=which==='settings'?automationConfig:escalationConfig;
  const fab=$('#sendFab-'+which), ring=$('#sendRing-'+which);
  if(!fab || fab.classList.contains('sending') || fab.classList.contains('sent')) return;
  fab.classList.add('sending');
  requestAnimationFrame(()=>{ if(ring) ring.classList.add('animating'); });
  const sample=automationSampleContext();
  const tpl=automationEmailTemplate(which,sample);
  const RING_MS=1600;
  const sendPromise=fetch('/api/automation/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:'axongainsightrp@gmail.com',subject:tpl.subject,bodyHtml:tpl.bodyHtml})})
    .then(res=>res.status===401?{sent:false,unauth:true}:res.json()).catch(e=>({sent:false,detail:String(e.message||e)}));
  const [data]=await Promise.all([sendPromise,new Promise(r=>setTimeout(r,RING_MS))]);
  if(data.unauth){ goToLogin(); return; }
  fab.classList.remove('sending');
  if(data.sent){
    fab.classList.add('sent');
    cfg.sentAt=new Date().toISOString();
    setTimeout(()=>{ closeSheet(); route(); },1400);
  }else{
    fab.classList.remove('sending'); if(ring) ring.classList.remove('animating');
    alert('Send failed: '+(data.detail||'unknown error'));
  }
  if(which==='settings') saveAutomationConfig(); else saveEscalationConfig();
}
// Simulates the day a scheduled automation would actually fire: a pulsating
// red banner top-right (like a real notification), clicking it opens the
// same email-preview review window used by "Preview & send".
function showEmailDayNotification(){
  const old=$('#emailDayNotif'); if(old) old.remove();
  automationConfig.sentAt=null; saveAutomationConfig(); route();
  const d=document.createElement('div');
  d.id='emailDayNotif'; d.className='email-day-notif';
  d.innerHTML='<b>Scheduled Survey Emails, Please Review</b>';
  d.onclick=()=>{ d.remove(); openAutomationPreview('settings'); };
  document.body.appendChild(d);
}
function automationBatchHtml(kind){
  const bubble=(which,title,label,sentAt)=>`<div class="automation-bubble ${sentAt?'sent':'pending'}" onclick="toggleAutomationPanel('${which}')">
    <div class="automation-bubble-title">${title}</div>
    <div class="automation-bubble-sub">${esc(label)}</div>
    ${sentAt?`<div class="automation-bubble-confirm"><i>Sent ${fmtDate(sentAt)} to axongainsightrp@gmail.com</i></div>`:''}
  </div>`;
  const panel=(which)=>{
    if(!which) return '';
    if(which==='settings') return `<div class="automation-panel">
      <label class="mini" style="display:flex;align-items:center;gap:8px;margin-bottom:10px">Month of quarter
        <select onchange="setAutomationMonth(this.value)">
          ${[1,2,3].map(m=>`<option value="${m}" ${automationConfig.month===m?'selected':''}>${ORDINAL(m)} month</option>`).join('')}
        </select>
      </label>
      <label class="mini" style="display:flex;align-items:center;gap:8px;margin-bottom:10px">Day of month <input type="number" min="1" max="31" style="width:70px" value="${automationConfig.day}" onchange="setAutomationDay(this.value)" oninput="setAutomationDay(this.value)"></label>
      <button type="button" class="btn sm primary" onclick="openAutomationPreview('settings')">Preview &amp; send (demo)</button>
    </div>`;
    return `<div class="automation-panel">
      <label class="mini" style="display:flex;align-items:center;gap:8px;margin-bottom:10px">Days after first email <input type="number" min="0" style="width:70px" value="${escalationConfig.days}" onchange="setEscalationDays(this.value)" oninput="setEscalationDays(this.value)"></label>
      <button type="button" class="btn sm primary" onclick="openAutomationPreview('escalation')">Preview &amp; send (demo)</button>
    </div>`;
  };
  return `<div class="card" id="automationBatchCard-${kind}">
    <h3>Automation Batch<span class="sortbar"><button type="button" class="btn sm" onclick="showEmailDayNotification()">Demo Email Day Notification</button></span></h3>
    <div class="automation-flow">
      ${bubble('settings','Automation Settings',automationScheduleLabel(),automationConfig.sentAt)}
      <div class="automation-line"></div>
      ${bubble('escalation','Escalation Automations',escalationScheduleLabel(),escalationConfig.sentAt)}
    </div>
    ${panel(automationPanelOpen)}
  </div>`;
}
// No mock fallback here on purpose — the live pilot quarter must show exactly
// what's real, nothing else. It starts empty and grows one row at a time as
// actual Sheet responses land (via Refresh from Sheet), never pre-filled.
function getTest10Data(){
  const real=sheetDataCache||[];
  return TEST10_ACCOUNTS
    .map(name=>real.find(r=>r.account && r.account.trim().toLowerCase()===name.toLowerCase()))
    .filter(Boolean)
    .map(r=>({...r,source:'sheet'}));
}
// All 10 accounts with a received/not-received flag — used only for the
// per-account status table, where showing "not received yet" for every
// account is honest bookkeeping, not fabricated response data.
function getTest10StatusList(){
  const responses=getTest10Data();
  return TEST10_ACCOUNTS.map(name=>{
    const r=responses.find(x=>x.account.trim().toLowerCase()===name.toLowerCase());
    return r ? {...r,received:true} : {account:name,received:false,score:null,reason:'',comment:'',timestamp:null,description:'',relationshipIntent:'',contactName:'',contactTitle:'',csatScore:null,csatComments:''};
  });
}
// Managed-Account NPS respects the current Org Drill-down scope + "View as"
// CSM filter (so picking a CSM shows only their accounts' NPS); Agency NPS is
// always the full agency-wide population, per design.
function getNpsScoped(kind,accts){
  const full=getNpsDataset(kind);
  let rows=full.rows;
  if(kind==='managed' && accts){
    const idSet=new Set(accts.map(a=>a.id));
    rows=rows.filter(r=>idSet.has(r.id));
  }
  return {rows,promoters:rows.filter(r=>r.score>9),detractors:rows.filter(r=>r.score<=9)};
}
function drawNpsCharts(kind,accts){
  let d;
  const npsSel=npsManagedSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]};
  const npsQKey=quarterKeyOf(npsSel);
  if(kind==='managed' && npsManagedTest10){
    const rows=npsQKey===PILOT_QUARTER?test10AsNpsRows():[];
    d={rows,promoters:rows.filter(r=>r.score>9),detractors:rows.filter(r=>r.score<=9)};
  } else if(kind==='managed'){
    const rows=getNpsScoped(kind,accts).rows.filter(r=>r.date && quarterKeyForDate(r.date)===npsQKey);
    d={rows,promoters:rows.filter(r=>r.score>9),detractors:rows.filter(r=>r.score<=9)};
  } else {
    d=getNpsScoped(kind,accts);
  }
  const green=window.AXON_THEME?'#1a9e5c':'#3ddc97', red=window.AXON_THEME?'#d64545':'#ff6b6b';
  destroyChartKey('npsDonut'+kind); destroyChartKey('npsBar'+kind);
  const dEl=$('#nps'+kind+'Donut');
  if(dEl){ charts['npsDonut'+kind]=new Chart(dEl,{type:'doughnut',data:{labels:['10 (Promoters)','9 & below'],datasets:[{data:[d.promoters.length,d.detractors.length],backgroundColor:[green,red],borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',noScales:true})}); }
  const cats=npsCategoryCounts(d.detractors);
  const bEl=$('#nps'+kind+'Bar');
  if(bEl && cats.length){
    // Built fully standalone (not via chartBaseOptions) to rule out any
    // interaction with that helper's vertical-chart-oriented scale defaults.
    // Highest count renders at the top, lowest at the bottom (cats is already
    // sorted descending), with the actual category name as the axis label.
    const light=(window.CSCC_THEME||document.documentElement.getAttribute('data-theme'))==='light'
      || (!window.CSCC_THEME && !!window.AXON_THEME && document.documentElement.getAttribute('data-theme')!=='dark');
    const gridColor=light?'#e0e0e0':'#242634', textColor=light?'#5c5c5c':'#9a9ba8';
    const maxN=Math.max(...cats.map(c=>c.n));
    charts['npsBar'+kind]=new Chart(bEl,{
      type:'bar',
      data:{ labels:cats.map(c=>c.cat), datasets:[{ data:cats.map(c=>c.n), backgroundColor:red, borderRadius:window.AXON_THEME?0:5 }] },
      options:{
        indexAxis:'y',
        responsive:true, maintainAspectRatio:false,
        scales:{
          x:{ type:'linear', min:0, max:maxN+1, ticks:{ stepSize:1, color:textColor, callback:(v)=>v===0?'':v }, grid:{ color:gridColor } },
          y:{ type:'category', ticks:{ color:textColor }, grid:{ display:false } }
        },
        plugins:{
          legend:{ display:false },
          tooltip:{ callbacks:{ label:(item)=>'Detractor mentions: '+item.raw } }
        },
        onClick:(evt,elements)=>{ if(!elements.length) return; scrollToNpsDriver(kind,cats[elements[0].index].cat); },
        onHover:(evt,elements)=>{ evt.native.target.style.cursor=elements.length?'pointer':'default'; }
      }
    });
  }
  const complaints=d.rows.filter(r=>r.csatScore!=null && r.csatComments);
  destroyChartKey('npsCsatDonut'+kind); destroyChartKey('npsCsmBar'+kind);
  const csatDonutEl=$('#nps'+kind+'CsatDonut');
  if(csatDonutEl){
    // Real CSAT score now (not the NPS score) — same 10-green/9-and-below-red
    // threshold, applied to the subset of responses with CSAT feedback logged.
    const csatGreen=complaints.filter(r=>r.csatScore>9).length, csatRed=complaints.filter(r=>r.csatScore<=9).length;
    charts['npsCsatDonut'+kind]=new Chart(csatDonutEl,{type:'doughnut',data:{labels:['10 (Promoters)','9 & below'],datasets:[{data:[csatGreen,csatRed],backgroundColor:[green,red],borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',noScales:true})});
  }
  const csmCounts={};
  complaints.forEach(r=>{ csmCounts[r.owner]=(csmCounts[r.owner]||0)+1; });
  const csmCats=Object.entries(csmCounts).map(([csm,n])=>({csm,n})).sort((a,b)=>b.n-a.n);
  const csmBarEl=$('#nps'+kind+'CsmBar');
  if(csmBarEl && csmCats.length){
    const light2=(window.CSCC_THEME||document.documentElement.getAttribute('data-theme'))==='light'
      || (!window.CSCC_THEME && !!window.AXON_THEME && document.documentElement.getAttribute('data-theme')!=='dark');
    const gridColor2=light2?'#e0e0e0':'#242634', textColor2=light2?'#5c5c5c':'#9a9ba8';
    const maxN2=Math.max(...csmCats.map(c=>c.n));
    charts['npsCsmBar'+kind]=new Chart(csmBarEl,{
      type:'bar',
      data:{ labels:csmCats.map(c=>c.csm), datasets:[{ data:csmCats.map(c=>c.n), backgroundColor:(window.AXON_THEME?'#d4890a':'#ffb84d'), borderRadius:window.AXON_THEME?0:5 }] },
      options:{
        indexAxis:'y', responsive:true, maintainAspectRatio:false,
        scales:{
          x:{ type:'linear', min:0, max:maxN2+1, ticks:{ stepSize:1, color:textColor2, callback:(v)=>v===0?'':v }, grid:{ color:gridColor2 } },
          y:{ type:'category', ticks:{ color:textColor2 }, grid:{ display:false } }
        },
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(item)=>'Comments: '+item.raw } } },
        onClick:(evt,elements)=>{ if(!elements.length) return; scrollToCsmDriver(kind,csmCats[elements[0].index].csm); },
        onHover:(evt,elements)=>{ evt.native.target.style.cursor=elements.length?'pointer':'default'; }
      }
    });
  }
  const amber=window.AXON_THEME?'#d4890a':'#ffb84d';
  destroyChartKey('npsDesc'+kind); destroyChartKey('npsIntent'+kind);
  const descEl=$('#nps'+kind+'Desc');
  if(descEl){
    const dc=categoryCounts(d.rows,'description');
    const order=['Strategic Partner','Supplier','Vendor'], colors={'Strategic Partner':green,'Supplier':amber,'Vendor':red};
    const ordered=order.filter(k=>dc.find(x=>x.k===k)).map(k=>dc.find(x=>x.k===k));
    if(ordered.length) charts['npsDesc'+kind]=new Chart(descEl,{type:'doughnut',data:{labels:ordered.map(o=>o.k),datasets:[{data:ordered.map(o=>o.n),backgroundColor:ordered.map(o=>colors[o.k]),borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'55%',noScales:true})});
  }
  const intentEl=$('#nps'+kind+'Intent');
  if(intentEl){
    const ic=categoryCounts(d.rows,'relationshipIntent');
    const order2=['Grow','Stay the same','Decline'], colors2={'Grow':green,'Stay the same':amber,'Decline':red};
    const ordered2=order2.filter(k=>ic.find(x=>x.k===k)).map(k=>ic.find(x=>x.k===k));
    if(ordered2.length) charts['npsIntent'+kind]=new Chart(intentEl,{type:'doughnut',data:{labels:ordered2.map(o=>o.k),datasets:[{data:ordered2.map(o=>o.n),backgroundColor:ordered2.map(o=>colors2[o.k]),borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'55%',noScales:true})});
  }
}
let npsManagedTest10=false, npsManagedSel=null;
function setNpsManagedTest10(v){ npsManagedTest10=v; route(); }
function setNpsManagedYear(y){ const cur=npsManagedSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]}; npsManagedSel={year:+y,q:cur.q}; route(); }
function setNpsManagedQ(q){ const cur=npsManagedSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]}; npsManagedSel={year:cur.year,q:+q}; route(); }
function test10AsNpsRows(){
  return getTest10Data().map(r=>{
    const a=STATE.accounts.find(x=>x.name===r.account);
    return {id:a?a.id:r.account,label:r.account,owner:a?a.ownerName:'—',score:r.score,date:(r.timestamp||'').slice(0,10),category:r.reason,comment:r.comment,source:r.source,description:r.description,relationshipIntent:r.relationshipIntent,csatScore:r.csatScore??null,csatComments:r.csatComments||''};
  });
}
function npsView(kind,accts){
  const label=kind==='managed'?'Managed-Account NPS':'Agency NPS';
  let scope=kind==='managed'?'NPS from accounts actively managed by a CSM':'Broader agency-wide NPS across divisions/respondents — reported separately from managed accounts, not blended together — always shown across the whole agency regardless of "View as"';
  if(kind==='managed' && ownerFilter) scope=`NPS for ${esc(ownerFilter)}'s managed accounts`;
  const usingTest10=kind==='managed' && npsManagedTest10;
  const npsSel=npsManagedSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]};
  const npsQKey=quarterKeyOf(npsSel);
  let rows;
  if(kind!=='managed'){ rows=getNpsScoped(kind,accts).rows; }
  else if(usingTest10){ rows=npsQKey===PILOT_QUARTER?test10AsNpsRows():[]; }
  else{ rows=getNpsScoped(kind,accts).rows.filter(r=>r.date && quarterKeyForDate(r.date)===npsQKey); }
  const promoters=rows.filter(r=>r.score>9), detractors=rows.filter(r=>r.score<=9);
  const total=rows.length, below9=detractors.length;
  const cats=npsCategoryCounts(detractors);
  const grouped={};
  detractors.forEach(r=>{ (grouped[r.category]=grouped[r.category]||[]).push(r); });
  const complaints=rows.filter(r=>r.csatScore!=null && r.csatComments);
  const csmCounts={};
  complaints.forEach(r=>{ csmCounts[r.owner]=(csmCounts[r.owner]||0)+1; });
  const csmCats=Object.entries(csmCounts).map(([csm,n])=>({csm,n})).sort((a,b)=>b.n-a.n);
  const csmGrouped={};
  complaints.forEach(r=>{ (csmGrouped[r.owner]=csmGrouped[r.owner]||[]).push(r); });
  const test10Bar=kind==='managed'?`<div class="row-actions" style="margin:-4px 0 14px;flex-wrap:wrap">
    <button type="button" class="btn sm${npsManagedTest10?' primary':''}" onclick="setNpsManagedTest10(${npsManagedTest10?'false':'true'})">${npsManagedTest10?'← Back to full book':'Pull up Test 10 (live pilot)'}</button>
    ${npsManagedTest10?`<button type="button" class="btn sm" onclick="refreshSheetData()">Refresh from Sheet</button><span class="mini">${sheetLastFetch?'Last refreshed '+sheetLastFetch.toLocaleTimeString():'Not yet refreshed — showing mock placeholders'}</span>`:''}
  </div>`:'';
  return `${test10Bar}<div class="card"><h3>${esc(label)} <span class="hint">${usingTest10?'Test 10 pilot accounts — live Sheet responses where received, mock placeholder otherwise':scope}</span></h3>
    ${kind==='managed'?quarterToggleHtml(npsSel,'setNpsManagedYear','setNpsManagedQ'):''}
    ${usingTest10&&npsQKey!==PILOT_QUARTER?`<p class="mini">The live pilot began in <b>${esc(PILOT_QUARTER)}</b> — no pilot responses exist for ${npsSel.year} Q${npsSel.q}.</p>`:''}
    ${sheetFetchError&&usingTest10&&npsQKey===PILOT_QUARTER?`<p class="mini" style="color:var(--red)">${esc(sheetFetchError)}</p>`:''}
    <div class="kpis" style="margin:14px 0">
      <div class="kpi clickable" onclick="scrollToSection('npsSplitCard-${kind}')"><div class="l">Total responses</div><div class="v">${total}</div><div class="d">${kind==='managed'?'accounts with an NPS response':'respondents across the agency'}</div></div>
      <div class="kpi risk-green clickable" onclick="scrollToSection('npsSplitCard-${kind}')"><div class="l">10 (Promoters)</div><div class="v">${promoters.length}</div><div class="d">${total?Math.round(promoters.length/total*100):0}% of responses</div></div>
      <div class="kpi risk-red clickable" onclick="scrollToSection('npsDriversCard-${kind}')"><div class="l">9 &amp; Below</div><div class="v">${below9}</div><div class="d">${total?Math.round(below9/total*100):0}% of responses</div></div>
    </div>
    <div class="grid2" id="npsSplitCard-${kind}">
      <div class="card" style="box-shadow:none"><h3>NPS Response split</h3><div class="chartbox"><canvas id="nps${kind}Donut"></canvas></div></div>
      <div class="card" style="box-shadow:none"><h3>Why scores are below 9 <span class="hint">ranked high to low</span></h3><div class="chartbox" style="height:${Math.max(180,cats.length*38)}px"><canvas id="nps${kind}Bar"></canvas></div></div>
    </div>
    <div class="grid2" id="csatSplitCard-${kind}" style="margin-top:12px">
      <div class="card" style="box-shadow:none"><h3>CSAT Response split <span class="hint">same NPS score, just for the subset with CSAT feedback logged</span></h3><div class="chartbox"><canvas id="nps${kind}CsatDonut"></canvas></div></div>
      <div class="card" style="box-shadow:none"><h3>CSM Feedback <span class="hint">ranked high to low</span></h3><div class="chartbox" style="height:${Math.max(180,csmCats.length*38)}px"><canvas id="nps${kind}CsmBar"></canvas></div></div>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div class="card" style="box-shadow:none"><h3>How would you describe Axon to a colleague?</h3><div class="chartbox"><canvas id="nps${kind}Desc"></canvas></div></div>
      <div class="card" style="box-shadow:none"><h3>Do you intend to grow, stay the same, or decline your relationship?</h3><div class="chartbox"><canvas id="nps${kind}Intent"></canvas></div></div>
    </div>
  </div>
  <div class="card" id="npsDriversCard-${kind}"><h3>Non-promoter drivers</h3>
    ${cats.length? cats.map(c=>`<details class="disc" id="npsdrv-${kind}-${npsSlug(c.cat)}" style="margin-bottom:10px">
      <summary><h4 style="display:inline-flex;align-items:center;gap:8px;margin:0">${esc(c.cat)} <span class="pill p-red">${c.n}</span></h4></summary>
      <div style="margin-top:10px">${grouped[c.cat].map(r=>`<div class="next-step" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>${esc(r.label)}</b><span class="pill p-red">${r.score}/10</span></div><div class="mini" style="margin-top:4px">${esc(r.comment)}</div><div class="mini" style="color:var(--muted2);margin-top:4px">${r.date?esc(r.date):''}${r.owner?' · Owner '+esc(r.owner):''}</div></div>`).join('')}</div>
    </details>`).join('') : '<p class="mini">No responses below 9 in this scope.</p>'}
  </div>
  <div class="card" id="csmFeedbackCard-${kind}"><h3>CSM Feedback</h3>
    ${csmCats.length? csmCats.map(c=>`<details class="disc" id="csmdrv-${kind}-${npsSlug(c.csm)}" style="margin-bottom:10px">
      <summary><h4 style="display:inline-flex;align-items:center;gap:8px;margin:0">${esc(c.csm)} <span class="pill p-red">${c.n}</span></h4></summary>
      <div style="margin-top:10px">${csmGrouped[c.csm].map(r=>`<div class="next-step" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>${esc(r.label)}</b><span class="pill ${r.csatScore===10?'p-green':'p-red'}">${r.csatScore}/10</span></div><div class="mini" style="margin-top:4px">${esc(r.csatComments)}</div><div class="mini" style="color:var(--muted2);margin-top:4px">${r.date?esc(r.date):''}</div></div>`).join('')}</div>
    </details>`).join('') : '<p class="mini">No CSM feedback logged in this scope.</p>'}
  </div>`;
}
function viewNpsManaged(accts){ return npsView('managed',accts); }
function viewNpsAgency(accts){ return npsView('agency',accts); }
// ---- CSAT (send/receive funnel) ----
// UI preview only, per instruction — the three boxes and year/quarter filter
// are wired to existing surveyState so the shape is real, but the automated
// quarterly send + Customer-Insights ingestion described alongside this isn't
// built yet: All Accounts -> Surveys Sent -> Surveys Received per quarter.
let csatFilterSel=null, csatTest10=false, csatTest10Sel=null;
function setCsatFilterYear(y){ const cur=csatFilterSel||{year:+MOCK_QUARTER.split('-Q')[0],q:+MOCK_QUARTER.split('-Q')[1]}; csatFilterSel={year:+y,q:cur.q}; route(); }
function setCsatFilterQ(q){ const cur=csatFilterSel||{year:+MOCK_QUARTER.split('-Q')[0],q:+MOCK_QUARTER.split('-Q')[1]}; csatFilterSel={year:cur.year,q:+q}; route(); }
function setCsatTest10(v){ csatTest10=v; route(); }
function setCsatTest10Year(y){ const cur=csatTest10Sel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]}; csatTest10Sel={year:+y,q:cur.q}; route(); }
function setCsatTest10Q(q){ const cur=csatTest10Sel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]}; csatTest10Sel={year:cur.year,q:+q}; route(); }
// Forked funnel: All -> Sent -> (Received | Not received). The fork is drawn
// as two SVG bezier paths branching from the Sent box, each with its own
// animated dot, so the "sent" population visibly splits into exactly the two
// outcomes below it — receivedV + notReceivedV always equal sentV by
// construction at both call sites.
function funnelForkHtml(allV,allSub,sentV,sentSub,recV,recSub,notV,notSub,scrollTarget){
  const click=scrollTarget?` clickable" onclick="scrollToSection('${scrollTarget}')`:'';
  return `<div class="funnel">
    <div class="funnel-box${click}"><div class="l">All accounts</div><div class="v">${allV}</div><div class="d">${esc(allSub)}</div></div>
    <div class="funnel-conn"><span class="funnel-flow"></span></div>
    <div class="funnel-box risk-amber${click}"><div class="l">Surveys sent</div><div class="v">${sentV}</div><div class="d">${esc(sentSub)}</div></div>
    <div class="funnel-fork">
      <svg viewBox="0 0 60 80" preserveAspectRatio="none">
        <defs>
          <marker id="forkArrow" markerWidth="3" markerHeight="4" refX="3" refY="2" orient="auto">
            <path d="M0,0 L3,2 L0,4 Z" class="fork-arrowhead"/>
          </marker>
        </defs>
        <path class="fork-path" d="M0,40 Q30,40 54,14" marker-end="url(#forkArrow)"/>
        <path class="fork-path" d="M0,40 Q30,40 54,66" marker-end="url(#forkArrow)"/>
        <circle class="fork-dot" r="3.2"><animateMotion dur="1.8s" repeatCount="indefinite" path="M0,40 Q30,40 54,14"/></circle>
        <circle class="fork-dot" r="3.2"><animateMotion dur="1.8s" begin="0.9s" repeatCount="indefinite" path="M0,40 Q30,40 54,66"/></circle>
      </svg>
    </div>
    <div class="funnel-fork-boxes">
      <div class="funnel-box small risk-green${click}"><div class="l">Received</div><div class="v">${recV}</div><div class="d">${esc(recSub)}</div></div>
      <div class="funnel-box small risk-red${click}"><div class="l">Not received</div><div class="v">${notV}</div><div class="d">${esc(notSub)}</div></div>
    </div>
  </div>`;
}
function viewCsatTab(accts){
  const test10Bar=`<div class="row-actions" style="margin-bottom:16px;flex-wrap:wrap">
    <button type="button" class="btn sm${csatTest10?' primary':''}" onclick="setCsatTest10(${csatTest10?'false':'true'})">${csatTest10?'← Back to full book':'Test 10 (live pilot)'}</button>
    ${csatTest10?`<button type="button" class="btn sm" onclick="refreshSheetData()">Refresh from Sheet</button><span class="mini">${sheetLastFetch?'Last refreshed '+sheetLastFetch.toLocaleTimeString():'Not yet refreshed — showing mock placeholders'}</span>`:''}
  </div>`;

  if(csatTest10){
    const sel=csatTest10Sel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]};
    const qKey=quarterKeyOf(sel);
    const isLive=qKey===PILOT_QUARTER;
    const statusList=isLive?getTest10StatusList():[];
    const sentCount=isLive?10:0;
    const receivedCount=statusList.filter(r=>r.received).length;
    const notReceivedCount=sentCount-receivedCount;
    return `${test10Bar}<div class="card"><h3>NPS</h3>
      ${quarterToggleHtml(sel,'setCsatTest10Year','setCsatTest10Q')}
      ${sheetFetchError&&isLive?`<p class="mini" style="color:var(--red)">${esc(sheetFetchError)}</p>`:''}
      ${!isLive?`<p class="mini">The live pilot began in <b>${esc(PILOT_QUARTER)}</b> — no pilot responses exist before that.</p>`:''}
      ${funnelForkHtml(isLive?10:0,'pilot group',sentCount,'assumed sent',receivedCount,'real Sheet response',notReceivedCount,'no response yet','csatStatusCard')}
    </div>
    ${automationBatchHtml('csat')}
    <div class="card" id="csatStatusCard"><h3>Customer status</h3>
      ${statusList.length?`<table><thead><tr><th>Account</th><th>Status</th><th class="num">NPS Score</th><th>NPS Reason</th><th>NPS Comment</th><th class="num">CSAT Score</th><th>CSAT Comments</th><th>Date</th></tr></thead><tbody>
      ${statusList.map(r=>{ const a=STATE.accounts.find(x=>x.name===r.account); return `<tr onclick="${a?`openAcct('${a.id}')`:''}" style="cursor:${a?'pointer':'default'}"><td><b>${esc(r.account)}</b></td><td><span class="pill ${r.received?'p-green':'p-amber'}">${r.received?'Received':'Not received'}</span></td><td class="num">${r.score==null?'—':`<span class="pill ${r.score===10?'p-green':'p-red'}">${r.score}/10</span>`}</td><td>${esc(r.reason||'—')}</td><td class="mini">${esc(r.comment||'—')}</td><td class="num">${r.csatScore==null?'—':`<span class="pill ${r.csatScore===10?'p-green':'p-red'}">${r.csatScore}/10</span>`}</td><td class="mini">${esc(r.csatComments||'—')}</td><td class="mini">${r.timestamp?esc(r.timestamp.slice(0,10)):'—'}</td></tr>`; }).join('')}
      </tbody></table>`:'<p class="mini">No pilot data for this quarter.</p>'}
    </div>`;
  }

  const sel=csatFilterSel||{year:+MOCK_QUARTER.split('-Q')[0],q:+MOCK_QUARTER.split('-Q')[1]};
  const quarterKey=quarterKeyOf(sel);
  let sentCount=0, receivedCount=0;
  accts.forEach(a=>{
    const s=(surveyState[a.id]||[]).find(x=>x.quarter===quarterKey);
    if(s){ if(s.status==='Sent'||s.status==='Completed') sentCount++; if(s.status==='Completed') receivedCount++; }
  });
  return `${test10Bar}<div class="card"><h3>NPS</h3>
    ${quarterToggleHtml(sel,'setCsatFilterYear','setCsatFilterQ')}
    ${funnelForkHtml(accts.length,'in scope',sentCount,sel.year+' Q'+sel.q,receivedCount,sel.year+' Q'+sel.q,sentCount-receivedCount,'sent, awaiting response')}
  </div>
  ${automationBatchHtml('csat')}`;
}
// ---- Customer Insights (cross-account) ----
// Pulls together the per-account Customer Insight notes AND the quarterly
// survey notes/scores logged on Account 360 into one cross-account feed, so
// patterns across the book are visible instead of buried one account at a
// time — effectively the local "ingest point" for qualitative survey data
// until a real survey pipeline exists.
const INSIGHTS_STOPWORDS=new Set(['the','a','an','and','or','of','to','in','on','for','with','is','are','was','were','we','our','their','they','it','this','that','has','have','had','be','as','at','by','not','but','so','if','from','will','would','can','could','about','into','than','then','them','been','more','also','were']);
function getInsightsData(accts,quarterKey){
  const inScope=new Set((accts||[]).map(a=>a.id));
  let entries=[];
  Object.keys(insights).forEach(acctId=>{
    if(!inScope.has(acctId)) return;
    const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
    (insights[acctId]||[]).forEach(n=>entries.push({type:'insight',acctId,acctName:a.name,owner:a.ownerName,t:n.t,note:n.note}));
  });
  Object.keys(surveyState).forEach(acctId=>{
    if(!inScope.has(acctId)) return;
    const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
    (surveyState[acctId]||[]).forEach(s=>{ if(s.notes && s.notes.trim()) entries.push({type:'survey',acctId,acctName:a.name,owner:a.ownerName,t:s.sentAt||new Date().toISOString(),note:s.notes,score:s.score,quarter:s.quarter}); });
  });
  // Test 10 pilot responses are always real now (getTest10Data has no mock
  // fallback) — count them as genuine logged entries.
  getTest10Data().forEach(r=>{
    const a=STATE.accounts.find(x=>x.name===r.account);
    if(!a || !inScope.has(a.id)) return;
    entries.push({type:'survey-live',acctId:a.id,acctName:a.name,owner:a.ownerName,t:r.timestamp,note:r.comment||`NPS ${r.score}/10 — ${r.reason||'no reason given'}`,score:r.score});
  });
  if(quarterKey) entries=entries.filter(e=>quarterKeyForDate(e.t)===quarterKey);
  entries.sort((x,y)=>new Date(y.t)-new Date(x.t));
  const wordCounts={};
  entries.forEach(e=>{
    String(e.note||'').toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).forEach(w=>{
      if(w.length<4||INSIGHTS_STOPWORDS.has(w)) return;
      wordCounts[w]=(wordCounts[w]||0)+1;
    });
  });
  const themes=Object.entries(wordCounts).map(([w,n])=>({w,n})).filter(t=>t.n>1).sort((a,b)=>b.n-a.n).slice(0,8);
  const last30=entries.filter(e=>Date.now()-new Date(e.t).getTime()<=30*864e5).length;
  const acctsCovered=new Set(entries.map(e=>e.acctId)).size;
  return {entries,themes,last30,acctsCovered};
}
function drawInsightsChart(accts){
  const sel=insightsSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]};
  const {themes}=getInsightsData(accts,quarterKeyOf(sel));
  destroyChartKey('insightsTheme');
  const el=$('#insightsThemeChart'); if(!el||!themes.length) return;
  const light=(window.CSCC_THEME||document.documentElement.getAttribute('data-theme'))==='light'
    || (!window.CSCC_THEME && !!window.AXON_THEME && document.documentElement.getAttribute('data-theme')!=='dark');
  const gridColor=light?'#e0e0e0':'#242634', textColor=light?'#5c5c5c':'#9a9ba8';
  const violet=window.AXON_THEME?'#7a5af8':'#c08bff';
  const maxN=Math.max(...themes.map(t=>t.n));
  charts.insightsTheme=new Chart(el,{
    type:'bar',
    data:{ labels:themes.map(t=>t.w), datasets:[{ data:themes.map(t=>t.n), backgroundColor:violet, borderRadius:window.AXON_THEME?0:5 }] },
    options:{
      indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{
        x:{ type:'linear', min:0, max:maxN+1, ticks:{ stepSize:1, color:textColor, callback:(v)=>v===0?'':v }, grid:{ color:gridColor } },
        y:{ type:'category', ticks:{ color:textColor }, grid:{ display:false } }
      },
      plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(item)=>'Mentions: '+item.raw } } }
    }
  });
}
let insightsSel=null;
function setInsightsYear(y){ const cur=insightsSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]}; insightsSel={year:+y,q:cur.q}; route(); }
function setInsightsQ(q){ const cur=insightsSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]}; insightsSel={year:cur.year,q:+q}; route(); }
function viewInsightsTab(accts){
  const sel=insightsSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]};
  const qKey=quarterKeyOf(sel);
  const isLive=qKey===PILOT_QUARTER;
  const {entries,themes,last30,acctsCovered}=getInsightsData(accts,qKey);
  return `<div class="card"><h3>Customer Insights</h3>
    ${quarterToggleHtml(sel,'setInsightsYear','setInsightsQ')}
    <div class="kpis" style="margin:14px 0">
      <div class="kpi clickable" onclick="scrollToSection('insightsRecentCard')"><div class="l">Total entries</div><div class="v">${entries.length}</div><div class="d">insights + survey notes, ${sel.year} Q${sel.q}</div></div>
      <div class="kpi clickable" onclick="scrollToSection('insightsRecentCard')"><div class="l">Logged last 30 days</div><div class="v">${last30}</div><div class="d">recent activity</div></div>
      <div class="kpi clickable" onclick="scrollToSection('insightsMatrixCard')"><div class="l">Accounts covered</div><div class="v">${acctsCovered}</div><div class="d">of ${accts.length} in scope</div></div>
    </div>
    ${themes.length?`<h4 style="margin:14px 0 8px">Common themes</h4><div class="chartbox" style="height:${Math.max(160,themes.length*32)}px"><canvas id="insightsThemeChart"></canvas></div>`:''}
  </div>
  <div class="card" id="insightsMatrixCard"><h3>Live survey matrix</h3>
    ${isLive?(()=>{ const rows=getTest10Data(); return `<div class="row-actions" style="margin-bottom:12px"><button type="button" class="btn sm" onclick="refreshSheetData()">Refresh from Sheet</button><span class="mini">${sheetLastFetch?'Last refreshed '+sheetLastFetch.toLocaleTimeString()+' · '+rows.length+' of 10 received':'Not yet refreshed'}</span></div>
    ${sheetFetchError?`<p class="mini" style="color:var(--red)">${esc(sheetFetchError)}</p>`:''}
    ${rows.length?`<div style="overflow-x:auto"><table class="matrix-table"><thead><tr><th>Timestamp</th><th>Account</th><th>CSM</th><th class="num">NPS Score</th><th>Reason</th><th>Comment</th><th>Contact Name</th><th>Contact Title</th><th>Describes Axon as</th><th>Relationship Intent</th><th class="num">CSAT Score</th><th>CSAT Comments</th></tr></thead><tbody>
    ${rows.map(r=>{ const a=STATE.accounts.find(x=>x.name===r.account); return `<tr onclick="${a?`openAcct('${a.id}')`:''}" style="cursor:${a?'pointer':'default'}"><td class="mini">${r.timestamp?esc(r.timestamp):'—'}</td><td><b>${esc(r.account)}</b></td><td>${a?ownerCell(a.ownerName):'—'}</td><td class="num">${r.score==null?'—':`<span class="pill ${r.score===10?'p-green':'p-red'}">${r.score}/10</span>`}</td><td>${esc(r.reason||'—')}</td><td class="mini">${esc(r.comment||'—')}</td><td class="mini">${esc(r.contactName||'—')}</td><td class="mini">${esc(r.contactTitle||'—')}</td><td class="mini">${esc(r.description||'—')}</td><td class="mini">${esc(r.relationshipIntent||'—')}</td><td class="num">${r.csatScore==null?'—':`<span class="pill ${r.csatScore===10?'p-green':'p-red'}">${r.csatScore}/10</span>`}</td><td class="mini">${esc(r.csatComments||'—')}</td></tr>`; }).join('')}
    </tbody></table></div>`:'<p class="mini">No responses yet.</p>'}`; })():`<p class="mini">The live pilot began in <b>${esc(PILOT_QUARTER)}</b> — no pilot matrix data exists for ${sel.year} Q${sel.q}.</p>`}
  </div>
  <div class="card" id="insightsRecentCard"><h3>Recent entries</h3>
    ${entries.length? entries.slice(0,60).map(e=>`<div class="next-step" style="margin-bottom:8px;cursor:pointer" onclick="openAcct('${e.acctId}')">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <span style="display:flex;align-items:center;gap:8px">${avatarChip(e.acctName)}<b>${esc(e.acctName)}</b>${e.type==='survey-live'?'<span class="pill p-green">Live pilot response</span>':e.type==='survey'?`<span class="pill p-blue">Survey${e.quarter?' · '+esc(e.quarter):''}</span>`:'<span class="pill p-gray">Insight</span>'}${e.score!=null?`<span class="pill ${e.score>=9?'p-green':e.score>=7?'p-amber':'p-red'}">${e.score}/10</span>`:''}</span>
        <span class="mini" style="color:var(--muted2)">${new Date(e.t).toLocaleDateString()} · ${ownerCell(e.owner)}</span>
      </div>
      <div class="mini" style="margin-top:6px">${esc(e.note)}</div>
    </div>`).join('') : '<p class="mini">No insights or survey notes logged yet in this scope.</p>'}
  </div>`;
}
function viewAcctScorecard(){ return scaffoldView('Account Scorecard','quantitative graded rollup at the account level',[
  'Distinct from Account Outcomes — this is a graded snapshot, not goal-progress narrative','Mirrors the existing CSM Scorecard pattern at account grain']); }
function viewProdScorecard(){ return scaffoldView('Product Scorecard','quantitative graded rollup at the product level',[
  'Distinct from Product Outcomes — graded snapshot, not goal-progress narrative','Mirrors the existing CSM Scorecard pattern at product grain']); }
function viewIntegrations(){ return scaffoldView('Integrations & Data Sources','third-party system context and the real-Salesforce-server connection',[
  'Comparisons referenced: Enterprise, law enforcement, Prepared, Carbyne, Totango','Real Salesforce server connection is a backend/technical requirement, not a customer-facing feature']); }
const HUES=['ty','tb','tv','tg','ta','tr'];
function hueFor(s){ const str=String(s||''); let h=0; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))>>>0; return HUES[h%HUES.length]; }
function stateTag(a){ const st=a.state||'—'; return `<span class="tag ${hueFor(st)}">${esc(st)}</span>`; }
function initials(name){
  const parts=String(name||'').trim().split(/\s+/).filter(Boolean);
  if(!parts.length) return '?';
  return (parts[0][0]+(parts.length>1?parts[parts.length-1][0]:'')).toUpperCase();
}
function avatarChip(name){
  if(!name) return '';
  return `<span class="avatar ${hueFor(name)}" title="${esc(name)}">${esc(initials(name))}</span>`;
}
function ownerCell(name){
  if(!name) return '<span class="mini">—</span>';
  return `<span class="owner-cell">${avatarChip(name)}<span>${esc(name)}</span></span>`;
}
function catTag(cat,extra){ return `<span class="tag ${hueFor(cat)}"${extra?` style="${extra}"`:''}>${esc(cat)}</span>`; }
function healthCell(h){ const c=h>=75?'var(--green)':h>=50?'var(--amber)':'var(--red)'; return `<span class="hs"><span class="bar"><i style="width:${h}%;background:${c}"></i></span><b style="color:${c}">${h}</b></span>`; }
function tierPill(t){ return t==='healthy'?'<span class="pill p-green">Healthy</span>':t==='watch'?'<span class="pill p-amber">Watch</span>':'<span class="pill p-red">At risk</span>'; }
function sevPill(s){ const m={Critical:'p-red',High:'p-red',Medium:'p-amber',Low:'p-gray'}; return `<span class="pill ${m[s]||'p-gray'}">${s}</span>`; }
function statusPill(s){ const m={Open:'p-red','In Progress':'p-amber',Resolved:'p-green'}; return `<span class="pill ${m[s]||'p-gray'}">${s}</span>`; }

function renderCrumb(){
  const path = crumbPath(STATE.scope);
  $('#crumb').innerHTML = path.map((n,i)=> i===path.length-1
    ? `<span class="cur">${esc(n.name)}</span>`
    : `<button onclick="setScope('${n.id}')">${esc(n.name)}</button><span class="sep">›</span>`).join('');
  const node = STATE.nodeIndex[STATE.scope];
  $('#scoperole').textContent = node && node.title ? node.title : '';
  const va=$('#viewas');
  if(va){
    va.innerHTML = `<span class="mini" style="margin-right:6px">View as</span>
      <div class="email-dd" id="csmDd" style="width:210px">
        <button type="button" class="email-dd-btn${csmDdOpen?' open':''}" id="csmDdBtn" aria-haspopup="listbox" aria-expanded="${csmDdOpen?'true':'false'}" onclick="toggleCsmDd()">
          <span class="email-dd-btn-text">${ownerFilter?esc(ownerFilter):'All CSMs'}</span>
          <span class="email-dd-caret" aria-hidden="true">▾</span>
        </button>
        <div class="email-dd-menu" id="csmDdMenu" role="listbox"${csmDdOpen?'':' hidden'}>
          <div style="padding:6px 6px 2px"><input type="text" class="flyout-search" id="csmDdSearch" placeholder="Search CSM…" autocomplete="off"></div>
          <div id="csmDdList"></div>
        </div>
      </div>`;
    if(csmDdOpen){
      renderCsmDdList(csmDdFilter);
      const inp=$('#csmDdSearch');
      if(inp){ inp.value=csmDdFilter||''; inp.addEventListener('input',e=>renderCsmDdList(e.target.value)); inp.focus(); }
    }
  }
}
let csmDdOpen=false, csmDdFilter='';
function toggleCsmDd(){ csmDdOpen=!csmDdOpen; if(!csmDdOpen) csmDdFilter=''; renderCrumb(); }
function renderCsmDdList(q){
  csmDdFilter=q;
  const list=$('#csmDdList'); if(!list) return;
  const owners=[...new Set(STATE.accounts.map(a=>a.ownerName).filter(Boolean))].sort();
  const qq=(q||'').toLowerCase();
  const filtered=qq?owners.filter(o=>o.toLowerCase().includes(qq)):owners;
  list.innerHTML = `<button type="button" class="email-dd-item${!ownerFilter?' selected':''}" role="option" onclick="pickCsmDd('')"><span class="email-dd-item-title">All CSMs</span></button>`
    + filtered.map(o=>`<button type="button" class="email-dd-item${ownerFilter===o?' selected':''}" role="option" onclick="pickCsmDd('${attrStr(o)}')"><span class="email-dd-item-title">${esc(o)}</span></button>`).join('')
    + (filtered.length===0?'<p class="mini" style="padding:10px 12px">No matches.</p>':'');
}
function pickCsmDd(name){ csmDdOpen=false; csmDdFilter=''; setOwnerFilter(name); }

function setScope(id){ STATE.scope=id; route(); }
function setTab(t){ currentAcctView=null; STATE.tab=t; navOpenCat=categoryForTab(t).id; window.scrollTo(0,0); route(); }

function tabBadges(){
  return {
    ctas: ctas.filter(c=>c.status!=='Done').length,
    escalations: STATE.escOpenCount||0,
    casewatch: STATE.accounts.filter(a=>a.casesBlocked>0).length,
    engagement: STATE.accounts.filter(a=>cadenceInfo(a).tier==='red').length,
    tap: STATE.accounts.filter(a=>a.tapStatus==='overdue').length,
    usage: STATE.accounts.filter(a=>adoptionTier(a)==='low').length,
  };
}

function route(){
  if(!STATE.tree) return;
  if(!STATE.nodeIndex[STATE.scope]) STATE.scope='ROOT';
  if(currentAcctView){ renderAcctPage(); renderNav(); wrapWideTables(); return; }
  STATE.accounts.forEach(a=>a.readiness=readinessScore(a));
  const isHome = STATE.tab==='home';
  const hideScope = isHome || STATE.tab==='npsagency';
  $('#scopebar').style.display = hideScope ? 'none' : '';
  if(!hideScope) renderCrumb();
  const accts0 = accountsUnder(STATE.scope);
  const accts = ownerFilter ? accts0.filter(a=>a.ownerName===ownerFilter) : accts0;
  const app=$('#app');
  if(STATE.tab==='home') app.innerHTML=viewHome();
  else if(STATE.tab==='overview') app.innerHTML=viewOverview(accts);
  else if(STATE.tab==='hierarchy') app.innerHTML=viewHierarchy();
  else if(STATE.tab==='renewals') app.innerHTML=viewRenewals(accts);
  else if(STATE.tab==='tap') app.innerHTML=viewTap(accts);
  else if(STATE.tab==='scorecard') app.innerHTML=viewScorecard(accts);
  else if(STATE.tab==='usage') app.innerHTML=viewUsage(accts);
  else if(STATE.tab==='ctas') app.innerHTML=viewCTAs(accts);
  else if(STATE.tab==='escalations') app.innerHTML=viewEsc(accts);
  else if(STATE.tab==='casewatch') app.innerHTML=viewCaseWatch(accts);
  else if(STATE.tab==='engagement') app.innerHTML=viewEngagement(accts);
  else if(STATE.tab==='plans') app.innerHTML=viewPlans(accts);
  else if(STATE.tab==='emails') app.innerHTML=viewEmails(accts);
  else if(STATE.tab==='worklist') app.innerHTML=viewWork(accts);
  else if(STATE.tab==='model') app.innerHTML=viewModel(accts);
  else if(STATE.tab==='resources') app.innerHTML=viewResources();
  else if(STATE.tab==='execreport') app.innerHTML=viewExecReport(accts);
  else if(STATE.tab==='gong') app.innerHTML=viewGong();
  else if(STATE.tab==='acctoutcomes') app.innerHTML=viewAcctOutcomes();
  else if(STATE.tab==='prodoutcomes') app.innerHTML=viewProdOutcomes();
  else if(STATE.tab==='npsmanaged') app.innerHTML=viewNpsManaged(accts);
  else if(STATE.tab==='npsagency') app.innerHTML=viewNpsAgency(accts);
  else if(STATE.tab==='csat') app.innerHTML=viewCsatTab(accts);
  else if(STATE.tab==='insights') app.innerHTML=viewInsightsTab(accts);
  else if(STATE.tab==='acctscorecard') app.innerHTML=viewAcctScorecard();
  else if(STATE.tab==='prodscorecard') app.innerHTML=viewProdScorecard();
  else if(STATE.tab==='integrations') app.innerHTML=viewIntegrations();
  if(STATE.tab==='overview') drawOverviewCharts(accts);
  if(STATE.tab==='home') drawHomeChart();
  if(STATE.tab==='escalations') drawEscTrendChart(accts);
  if(STATE.tab==='npsmanaged') drawNpsCharts('managed',accts);
  if(STATE.tab==='npsagency') drawNpsCharts('agency',accts);
  if(STATE.tab==='insights') drawInsightsChart(accts);
  renderNav();
  applyBadges();
  wrapWideTables();
}
// Tables are built with a fixed column set (Account/Owner/Stage/.../Health etc.)
// that doesn't fit narrower/non-expanded windows. Rather than hand-wrap every
// table call site, wrap them all here, after every render, in a horizontally
// scrollable container so overflow scrolls within the card instead of bleeding
// out past its white background into the page underneath.
function wrapWideTables(){
  document.querySelectorAll('#app table, #sheet table').forEach(t=>{
    if(t.closest('.table-scroll')) return;
    if(t.parentElement && t.parentElement.style && t.parentElement.style.overflowX==='auto') return;
    const wrap=document.createElement('div');
    wrap.className='table-scroll';
    t.parentNode.insertBefore(wrap,t);
    wrap.appendChild(t);
  });
}
function applyBadges(){
  const badges=tabBadges();
  document.querySelectorAll('[data-badge]').forEach(el=>{ const n=badges[el.dataset.badge]; el.textContent = n==null?'':n; el.classList.toggle('hidden', !n); });
}

// ---- Home ----
function viewHome(){
  const accts=STATE.accounts, r=rollup(accts);
  const logos=accts.filter(newLogo);
  const planned=logos.filter(a=>plans[a.id]).length;
  const insightsRecent = accts.reduce((s,a)=>s+insightCountSince(a.id,30),0);
  const npsR=npsRollup(accts);
  const tapOverdue=accts.filter(a=>a.tapStatus==='overdue').length;
  const tapDueSoon=accts.filter(a=>a.tapStatus==='duesoon').length;
  // Ordered per CS-leadership guidance (see NOTES.md): lead with the 4 metrics a
  // CS org actually runs on — engagement, growth, insights — before health/ARR.
  // NPS added per the CS sponsor's consolidated stakeholder findings (10% of comp).
  // TAP status surfaced here too, per Leana's finding that hardware refresh status
  // belongs on the portfolio home dashboard, not just buried in a per-account view.
  const kpis=[
    ['Engagement rate',r.engagementPct+'%',r.inCadence+' of '+r.n+' accounts in outreach cadence','engagement'],
    ['Growth (organic + expansion + transactional)',fmtMoney(r.growthTotal),'Renewal '+fmtMoney(r.growth.Renewal)+' · Expansion '+fmtMoney(r.growth.Expansion)+' · Transactional '+fmtMoney(r.growth.Transactional),'scorecard'],
    ['Customer insights logged',insightsRecent,'last 30 days across the book','scorecard'],
    ['Book NPS',npsR?npsR.score:'—',npsR?(npsR.n+' survey responses · '+npsR.promoters+' promoters, '+npsR.detractors+' detractors'):'no biannual survey responses on file','scorecard'],
    ['Total Contract Value (book)',fmtMoney(r.arr),r.renewals+' open renewals','overview'],
    ['ARR at risk',fmtMoney(r.risk),Math.round(r.risk/(r.arr||1)*100)+'% risk-weighted','renewals'],
    ['New logos to onboard',logos.length,planned+' with a success plan','plans'],
    ['TAP refreshes due',tapOverdue+tapDueSoon,tapOverdue+' overdue · '+tapDueSoon+' due within 90 days','tap'],
  ];
  const features=[
    ['Command Center','overview','Book-level KPIs, ARR at risk, health distribution, and your top revenue-weighted risk accounts.'],
    ['Org Drill-down','hierarchy','Walk the exec → team → CSM → account hierarchy with roll-ups at every level.'],
    ['Renewals','renewals','Every open renewal, triaged by revenue exposure, health, sentiment, CSAT, renewal readiness and lifetime value.'],
    ['TAP Refreshes','tap','Hardware warranty refresh tracking — due at the 2.5-year mark of a 5-year contract — with a standardized, actionable checklist per account.'],
    ['CSM Scorecard','scorecard','Each CSM against the 4 metrics that actually matter: insights, engagement, and organic/expansion/transactional growth.'],
    ['CTAs','ctas','Calls to action for CSMs — onboarding, TAP refreshes, renewals and product requests, auto-suggested and manual.'],
    ['Escalations','escalations','Risk escalations auto-seeded from live signals — track each from open to resolved.'],
    ['Case Watch','casewatch','Blocked and aging support cases — the two case signals worth escalating before they turn into an executive email.'],
    ['Engagement','engagement','Outreach cadence by book segment — see who is falling out of cadence before they go quiet.'],
    ['Success Plans','plans','Auto-generate onboarding + risk-aware plans for new logos, or build a custom plan for any account.'],
    ['Email Outreach','emails','Filled customer and internal email templates — review, edit, then send yourself from Outlook/Gmail.'],
    ['My Worklist','worklist','A prioritized action list ranked by urgency and revenue.'],
    ['Health Model','model','Tune the health-score weights and the entire book re-scores instantly — no engineering ticket.'],
    ['Resource Library','resources','Guides, SOPs and internal resources CSMs actually need — editable in real time so links never go stale.'],
  ];
  return `
  <div class="hero">
    <div class="eyebrow">Customer Success · Command Center</div>
    <h2>Welcome to your CS Command Center</h2>
  </div>
  <div class="kpis">${kpis.map(k=>`<div class="kpi clickable${/at risk/i.test(k[0])?' accent':''}" onclick="setTab('${k[3]}')" title="Go to ${esc(TAB_LABELS[k[3]]||k[3])}"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  <div class="grid2">
    <div class="card"><h3>Where to start <span class="hint">click a section to open it</span></h3>
      <div class="features">${features.map(f=>`<div class="feature" onclick="setTab('${f[1]}')"><h4>${esc(f[0])}</h4><p>${esc(f[2])}</p><div class="go">Open →</div></div>`).join('')}</div>
    </div>
    <div class="card"><h3>Book health</h3><div class="chartbox"><canvas id="cHome"></canvas></div>
      <div class="legend"><span><i class="dot" style="background:var(--green)"></i>Healthy ≥75</span><span><i class="dot" style="background:var(--amber)"></i>Watch 50–74</span><span><i class="dot" style="background:var(--red)"></i>At risk &lt;50</span></div>
      ${logos.length?`<p class="mini" style="margin-top:14px"><b>${logos.length}</b> new-logo account${logos.length===1?'':'s'} to onboard. <a href="#" onclick="setTab('plans');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)"><b>Generate success plans →</b></a></p>`:''}
    </div>
  </div>`;
}
function drawHomeChart(){
  Object.values(charts).forEach(c=>{try{c.destroy()}catch(e){}}); charts={};
  const r=rollup(STATE.accounts);
  const hc=window.AXON_THEME?['#1a9e5c','#d4890a','#d64545']:['#3ddc97','#ffb84d','#ff6b6b'];
  const h=$('#cHome'); if(h){ charts.home=new Chart(h,{type:'doughnut',data:{labels:['Healthy','Watch','At risk'],datasets:[{data:[r.green,r.amber,r.red],backgroundColor:hc,borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',legend:false,noScales:true})}); }
}

// ---- Overview ----
function viewOverview(accts){
  const r=rollup(accts);
  const npsR=npsRollup(accts);
  const kpis=[
    ['Engagement rate',r.engagementPct+'%',r.inCadence+' of '+r.n+' in outreach cadence','engagement'],
    ['Growth in scope',fmtMoney(r.growthTotal),'Renewal '+fmtMoney(r.growth.Renewal)+' · Expansion '+fmtMoney(r.growth.Expansion)+' · Transactional '+fmtMoney(r.growth.Transactional),'scorecard'],
    ['Total Contract Value in scope',fmtMoney(r.arr),r.renewals+' open renewals','renewals'],
    ['ARR at risk',fmtMoney(r.risk),Math.round(r.risk/(r.arr||1)*100)+'% of book, risk-weighted','renewals'],
    ['Avg health (ARR-wtd)',r.health,r.red+' at-risk · '+r.amber+' watch · '+r.green+' healthy','model'],
    ['NPS in scope',npsR?npsR.score:'—',npsR?(npsR.n+' of '+accts.length+' accounts surveyed'):'no survey responses in scope','scorecard'],
    ['Open escalations',STATE.escList.filter(e=>accts.includes(e.acct)&&e.status!=='Resolved').length,r.high+' high/urgent · '+r.cases+' open cases','escalations'],
    ['Expansion-ready accounts',accts.filter(a=>opportunityTier(a)==='expand').length,accts.filter(a=>opportunityTier(a)==='protect').length+' to protect & retain instead','hierarchy'],
  ];
  const topRisk=[...accts].sort((a,b)=>b.riskARR-a.riskARR).slice(0,8);
  return `
  <div class="kpis">${kpis.map(k=>`<div class="kpi clickable${/at risk/i.test(k[0])?' accent':''}" onclick="setTab('${k[3]}')" title="Go to ${esc(TAB_LABELS[k[3]]||k[3])}"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  <div class="grid2">
    <div class="card"><h3>Total Contract Value by team <span class="hint">click a team in Org Drill-down to scope</span></h3><div class="chartbox"><canvas id="cTeam"></canvas></div></div>
    <div class="card"><h3>Book health distribution</h3><div class="chartbox"><canvas id="cHealth"></canvas></div>
      <div class="legend"><span><i class="dot" style="background:var(--green)"></i>Healthy ≥75</span><span><i class="dot" style="background:var(--amber)"></i>Watch 50–74</span><span><i class="dot" style="background:var(--red)"></i>At risk &lt;50</span></div>
    </div>
  </div>
  <div class="card"><h3>Top risk-weighted accounts <span class="hint">renewal ARR × risk — where attention protects the most revenue</span></h3>
    <table><thead><tr><th>Account</th><th>Owner</th><th class="num">Total Contract Value</th><th class="num">Annualized Revenue</th><th class="num">Close</th><th>CSAT</th><th>NPS</th><th>Health</th><th class="num">ARR at risk</th></tr></thead><tbody>
    ${topRisk.map(a=>`<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${fmtMoney(a.ltv)}</td><td class="num">${a.dclose>9000?'—':a.dclose+'d'}</td><td>${csatPill(a)}</td><td>${npsPill(a)}</td><td>${healthCell(a.health)} ${tierPill(a.tier)}</td><td class="num"><b>${fmtMoney(a.riskARR)}</b></td></tr>`).join('')}
    </tbody></table>
    <p class="mini" style="margin-top:8px">* CSAT is a placeholder derived from support sentiment until survey data is connected. NPS reflects the biannual survey where a response is on file.</p>
  </div>`;
}
function chartBaseOptions(opts){
  opts = opts||{};
  const light = (window.CSCC_THEME||document.documentElement.getAttribute('data-theme'))==='light'
    || (!window.CSCC_THEME && !!window.AXON_THEME && document.documentElement.getAttribute('data-theme')!=='dark');
  const axon=!!window.AXON_THEME;
  const grid = light?'#e0e0e0':'#242634', text = light?'#5c5c5c':'#9a9ba8';
  const base = {
    responsive:true, maintainAspectRatio:false,
    plugins:{
      legend:{ display: opts.legend!==false, position:'bottom', labels:{ color:text, font:{size:11}, usePointStyle:true, pointStyle:'rect' } },
      tooltip: axon
        ? { backgroundColor:'#000', borderColor:'#ffe600', borderWidth:1, titleColor:'#fff', bodyColor:'#fff', padding:10, cornerRadius:0 }
        : { backgroundColor: light?'#fff':'#1a1c26', borderColor: light?'#e0e0e0':'#33354a', borderWidth:1, titleColor: light?'#000':'#f4f4f7', bodyColor: light?'#333':'#d7d8e0', padding:10, cornerRadius: light?2:8 }
    },
    scales: opts.noScales ? undefined : {
      x:{ grid:{ display:false }, ticks:{ color:text } },
      y:{ ticks:{ color:text, callback: opts.moneyTicks ? (v)=>fmtMoney(v) : undefined }, grid:{ color: grid } }
    }
  };
  if(opts.cutout) base.cutout = opts.cutout;
  return base;
}
function chartBorder(){
  const light = (window.CSCC_THEME||document.documentElement.getAttribute('data-theme'))==='light';
  if(window.AXON_THEME) return light?'#ffffff':'#0a0a0a';
  return light?'#ffffff':'#141620';
}
function drawOverviewCharts(accts){
  Object.values(charts).forEach(c=>{try{c.destroy()}catch(e){}}); charts={};
  const node=STATE.nodeIndex[STATE.scope]; if(!node) return;
  let groups=[];
  const kids=Object.values(node.children||{});
  if(kids.length){ groups=kids.map(k=>({label:shortName(k.name),arr:rollup(accountsUnder(k.id)).arr,risk:rollup(accountsUnder(k.id)).risk})); }
  else { const byOwner={}; accts.forEach(a=>{ (byOwner[a.ownerName]=byOwner[a.ownerName]||{label:a.ownerName,arr:0,risk:0}); byOwner[a.ownerName].arr+=a.renewalAmount; byOwner[a.ownerName].risk+=a.riskARR;}); groups=Object.values(byOwner); }
  groups.sort((a,b)=>b.arr-a.arr); groups=groups.slice(0,8);
  const barMain=window.AXON_THEME?'#2a7de1':'#5ec8ff';
  const barRisk=window.AXON_THEME?'#d64545':'#ff6b6b';
  const radius=window.AXON_THEME?0:5;
  const t=$('#cTeam'); if(t){ charts.team=new Chart(t,{type:'bar',data:{labels:groups.map(g=>g.label),datasets:[
    {label:'Total Contract Value',data:groups.map(g=>Math.round(g.arr)),backgroundColor:barMain,borderRadius:radius},
    {label:'ARR at risk',data:groups.map(g=>Math.round(g.risk)),backgroundColor:barRisk,borderRadius:radius}]},
    options:chartBaseOptions({moneyTicks:true})}); }
  const r=rollup(accts);
  const hc=window.AXON_THEME?['#1a9e5c','#d4890a','#d64545']:['#3ddc97','#ffb84d','#ff6b6b'];
  const h=$('#cHealth'); if(h){ charts.health=new Chart(h,{type:'doughnut',data:{labels:['Healthy','Watch','At risk'],datasets:[{data:[r.green,r.amber,r.red],backgroundColor:hc,borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',legend:false,noScales:true})}); }
}

// ---- Account 360 charts ----
// Kept in a separate charts registry (acctCharts) from the page-level `charts`
// object so opening/closing the account overlay never tears down whatever
// chart is live on the page underneath it.
function destroyAcctCharts(){ Object.values(acctCharts).forEach(c=>{try{c.destroy()}catch(e){}}); acctCharts={}; }
function drawAcctSyncCharts(a){
  destroyAcctCharts();
  const radius=window.AXON_THEME?0:5;
  const green=window.AXON_THEME?'#1a9e5c':'#3ddc97', red=window.AXON_THEME?'#d64545':'#ff6b6b';
  const hEl=$('#acctHealthChart');
  if(hEl){
    const comps=a.comps||[];
    const labels=['Base',...comps.map(c=>c[0])];
    const data=[100,...comps.map(c=>c[1])];
    const colors=data.map(v=>v<0?red:green);
    acctCharts.health=new Chart(hEl,{type:'bar',data:{labels,datasets:[{label:'Impact on health score',data,backgroundColor:colors,borderRadius:radius}]},options:chartBaseOptions({legend:false})});
  }
  const cEl=$('#acctCaseChart');
  if(cEl && a.lifeCases!=null && a.lifeCases>0){
    const barMain=window.AXON_THEME?'#2a7de1':'#5ec8ff';
    acctCharts.cases=new Chart(cEl,{type:'bar',data:{labels:['All cases','High/urgent'],datasets:[
      {label:'Lifetime',data:[a.lifeCases||0,a.lifeHigh||0],backgroundColor:barMain,borderRadius:radius},
      {label:'Currently open',data:[a.openCases||0,a.highCases||0],backgroundColor:red,borderRadius:radius}
    ]},options:chartBaseOptions()});
  }
}
function drawAcctDealsChart(deals){
  const dEl=$('#acctDealsChart'); if(!dEl||!deals||!deals.length) return;
  const radius=window.AXON_THEME?0:5;
  const barMain=window.AXON_THEME?'#2a7de1':'#5ec8ff';
  const chrono=[...deals].reverse();
  try{acctCharts.deals&&acctCharts.deals.destroy()}catch(e){}
  acctCharts.deals=new Chart(dEl,{type:'bar',data:{labels:chrono.map(o=>o.CloseDate||''),datasets:[{label:'Deal amount',data:chrono.map(o=>o.Amount||0),backgroundColor:barMain,borderRadius:radius}]},options:chartBaseOptions({moneyTicks:true,legend:false})});
}
function drawAcctProdChart(fams){
  const pEl=$('#acctProdChart'); if(!pEl||!fams||!fams.length) return;
  const radius=window.AXON_THEME?0:5;
  const barViolet=window.AXON_THEME?'#7a5af8':'#c08bff';
  try{acctCharts.prod&&acctCharts.prod.destroy()}catch(e){}
  const opts=chartBaseOptions({legend:false}); opts.indexAxis='y';
  // Same axis-type swap as the NPS bar chart: indexAxis:'y' makes y the
  // category axis and x the value axis, so types/formatting must be assigned
  // to the correct one rather than the chartBaseOptions vertical-chart defaults.
  opts.scales.y.type='category';
  opts.scales.x.type='linear';
  opts.scales.x.ticks.callback=(v)=>fmtMoney(v);
  acctCharts.prod=new Chart(pEl,{type:'bar',data:{labels:fams.map(f=>prodName(f.fam)),datasets:[{label:'Revenue',data:fams.map(f=>f.amt||0),backgroundColor:barViolet,borderRadius:radius}]},options:opts});
}
function shortName(n){ return n.length>16?n.slice(0,15)+'…':n; }

// ---- Executive Report (Sigma-replacement candidate) ----
// Sigma today rolls up CS activity — TAP notes, other CTA activity, logged
// timeline/activity — into leadership reporting (see NOTES.md's open question
// "can we replace the executive reports as well?"). This environment has no
// Sigma/warehouse credentials to push into directly, so this view answers the
// question as far as it can: every number is computed live from the same
// underlying signals (renewals, TAP, CTAs, escalations, logged activity) rather
// than a synthetic stand-in, so it can serve as that report today. CSV export is
// the practical bridge into Sigma or any other BI tool until a real pipeline exists.
function execReportRows(accts){
  return accts.map(a=>({
    AccountId:a.id, Account:a.name, State:a.state||'', Owner:a.ownerName, Segment:a.segment||'', Tier:OPP_TIER_LABELS[opportunityTier(a)],
    Health:a.health, TotalContractValue:a.renewalAmount, ARRAtRisk:Math.round(a.riskARR), AnnualizedRevenue:a.ltv||0,
    OpenCases:a.openCases, HighUrgentCases:a.highCases, BlockedCases:a.casesBlocked||0, AgingCases:a.casesAging||0,
    NPS:a.nps==null?'':a.nps, OpenCTAs:ctas.filter(c=>c.acctId===a.id&&c.status!=='Done').length,
    TapStatus:a.tapStatus||'', EscalationStatus:peekEscState(a.id).status||'', LoggedActivityCount:(activityFor(a.id).log||[]).length,
  }));
}
function downloadCSV(filename,rows){
  if(!rows.length){ toast('Nothing to export.'); return; }
  const headers=Object.keys(rows[0]);
  const q=v=>{ const s=v==null?'':String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const csv=[headers.join(','),...rows.map(r=>headers.map(h=>q(r[h])).join(','))].join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a'); link.href=url; link.download=filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportExecReportCsv(){
  const accts=ownerFilter?accountsUnder(STATE.scope).filter(a=>a.ownerName===ownerFilter):accountsUnder(STATE.scope);
  downloadCSV('axon-cs-executive-report-'+sfDate(new Date())+'.csv',execReportRows(accts));
}
function viewExecReport(accts){
  const r=rollup(accts), npsR=npsRollup(accts), an=escAnalytics(accts);
  const rows=execReportRows(accts);
  const reasonEntries=Object.entries(an.reasonCounts).filter(([,n])=>n>0);
  const reasonMax=Math.max(1,...reasonEntries.map(([,n])=>n));
  const prodCounts={}; an.entries.forEach(e=>{ const p=e.product||'Untagged'; prodCounts[p]=(prodCounts[p]||0)+1; });
  const prodEntries=Object.entries(prodCounts).sort((a,b)=>b[1]-a[1]);
  const prodMax=Math.max(1,...prodEntries.map(([,n])=>n));
  const bar=(label,n,max)=>`<div class="rollrow"><div class="rl">${esc(label)}</div><div class="rbarwrap"><div class="rbar" style="width:${max?Math.round(n/max*100):0}%"></div></div><div class="rn">${n}</div></div>`;
  return `<div class="card"><h3>Executive report <span class="hint">candidate to replace the Sigma executive dashboard — computed live from this book, not a Sigma connection</span></h3>
  <p class="mini" style="line-height:1.7">Sigma today rolls up CS activity — TAP notes, other CTA activity, and logged timeline/activity — into leadership reporting. This app has no Sigma/warehouse credentials in this environment, so it can't push there directly yet — but every number below is computed live from the same underlying signals (renewals, TAP, CTAs, escalations, logged activity), so it can stand in for that report today. Use <b>Export CSV</b> as the practical bridge into Sigma or any other BI tool until a real pipeline exists.</p>
  <div class="kpis" style="margin:14px 0">
    <div class="kpi"><div class="l">Total Contract Value</div><div class="v">${fmtMoney(r.arr)}</div><div class="d">${r.renewals} open renewals</div></div>
    <div class="kpi accent"><div class="l">ARR at risk</div><div class="v">${fmtMoney(r.risk)}</div><div class="d">${Math.round(r.risk/(r.arr||1)*100)}% of book</div></div>
    <div class="kpi"><div class="l">Growth (all types)</div><div class="v">${fmtMoney(r.growthTotal)}</div><div class="d">Renewal ${fmtMoney(r.growth.Renewal)} · Expansion ${fmtMoney(r.growth.Expansion)} · Transactional ${fmtMoney(r.growth.Transactional)}</div></div>
    <div class="kpi"><div class="l">Engagement rate</div><div class="v">${r.engagementPct}%</div><div class="d">${r.inCadence} of ${r.n} in cadence</div></div>
    <div class="kpi"><div class="l">NPS</div><div class="v">${npsR?npsR.score:'—'}</div><div class="d">${npsR?npsR.n+' survey responses':'no responses in scope'}</div></div>
    <div class="kpi"><div class="l">Active escalations</div><div class="v">${an.active.length}</div><div class="d">mean time to resolve ${an.meanResolveDays==null?'—':an.meanResolveDays+'d'}</div></div>
  </div>
  <div class="row-actions" style="margin-bottom:4px">
    <button class="btn primary" onclick="exportExecReportCsv()">Export CSV</button>
    <span class="mini">${rows.length} account rows — renewal, health, cases, NPS, CTA/TAP/escalation counts and logged-activity volume per account.</span>
  </div>
  </div>
  <div class="card"><h3>Escalations by reason &amp; product <span class="hint">all-time, in scope — see Escalations tab for the full analytics view</span></h3>
  <div class="grid2">
    <div><p class="mini" style="margin-bottom:8px"><b>By reason code</b></p>${reasonEntries.length?reasonEntries.map(([k,n])=>bar(k,n,reasonMax)).join(''):'<p class="mini">Nothing tagged yet.</p>'}</div>
    <div><p class="mini" style="margin-bottom:8px"><b>By product</b></p>${prodEntries.length?prodEntries.map(([k,n])=>bar(k,n,prodMax)).join(''):'<p class="mini">Nothing tagged yet.</p>'}</div>
  </div>
  </div>
  <div class="card"><h3>Account-level detail <span class="hint">${rows.length} accounts in scope</span></h3>
  <div class="searchbar"><input id="xrsearch" placeholder="Filter accounts…" oninput="filterTable(this,'xrtbl')"></div>
  <table id="xrtbl"><thead><tr><th>Account</th><th>Owner</th><th>Segment</th><th>Tier</th><th class="num">Health</th><th class="num">Total Contract Value</th><th class="num">ARR at risk</th><th class="num">Open CTAs</th><th>TAP status</th><th>Escalation</th><th class="num">Logged activity</th></tr></thead><tbody>
  ${rows.map(row=>`<tr onclick="openAcct('${row.AccountId}')"><td><b>${esc(row.Account)}</b> <span class="tag ${hueFor(row.State||'—')}">${esc(row.State||'—')}</span></td><td>${ownerCell(row.Owner)}</td><td>${esc(row.Segment)}</td><td>${esc(row.Tier)}</td><td class="num">${row.Health}</td><td class="num">${fmtMoney(row.TotalContractValue)}</td><td class="num">${fmtMoney(row.ARRAtRisk)}</td><td class="num">${row.OpenCTAs}</td><td>${esc(row.TapStatus||'—')}</td><td>${esc(row.EscalationStatus||'—')}</td><td class="num">${row.LoggedActivityCount}</td></tr>`).join('')}
  </tbody></table>
  </div>`;
}

// ---- Hierarchy ----
// hierFilter (segment + a chosen set of managers) lets Org Drill-down be sliced
// by segment and/or restricted to a hand-picked set of managers, cutting across
// the strict exec→director→manager→CSM walk rather than only scoping one node
// at a time.
function hierAccountsUnder(nodeId){
  let accts=accountsUnder(nodeId);
  if(hierFilter.segment) accts=accts.filter(a=>(a.segment||'')===hierFilter.segment);
  return accts;
}
function allManagerNodes(){
  return Object.values(STATE.nodeIndex).filter(n=>n.title==='Manager, Customer Success').sort((a,b)=>a.name<b.name?-1:1);
}
function setHierSegment(v){ hierFilter.segment=v; route(); }
function toggleHierManager(id,checked){
  const s=new Set(hierFilter.managers);
  if(checked) s.add(id); else s.delete(id);
  hierFilter.managers=[...s]; route();
}
function clearHierFilters(){ hierFilter={segment:'',managers:[]}; route(); }
function hierFilterBar(){
  const segs=[...new Set(STATE.accounts.map(a=>a.segment).filter(Boolean))].sort();
  const mgrs=allManagerNodes();
  const active=!!(hierFilter.segment||hierFilter.managers.length);
  return `<div class="card" style="box-shadow:none;border-style:dashed;margin:0 0 16px"><h3 style="border:none;margin:0 0 10px">Filter this view <span class="hint">by segment and/or a chosen set of managers — cuts across the hierarchy walk</span></h3>
  <div class="row-actions" style="margin-bottom:10px;flex-wrap:wrap">
    <select class="select" onchange="setHierSegment(this.value)"><option value="">All segments</option>${segs.map(s=>`<option value="${esc(s)}"${hierFilter.segment===s?' selected':''}>${esc(s)}</option>`).join('')}</select>
    ${active?'<button class="btn sm" onclick="clearHierFilters()">Clear filters</button>':''}
  </div>
  <details${hierFilter.managers.length?' open':''}><summary class="mini" style="cursor:pointer;font-weight:700;color:var(--ink)">Choose managers ${hierFilter.managers.length?`(${hierFilter.managers.length} selected)`:'(all)'}</summary>
  <div class="bulk-list" style="margin-top:10px;max-height:180px">
    ${mgrs.map(m=>`<label class="bulk-row"><input type="checkbox" value="${m.id}"${hierFilter.managers.includes(m.id)?' checked':''} onchange="toggleHierManager('${m.id}',this.checked)"><span class="bulk-name">${esc(m.name)}</span><span class="mini">${esc(m.title||'')}</span></label>`).join('')}
  </div></details>
  </div>`;
}
function viewHierarchy(){
  const node=STATE.nodeIndex[STATE.scope];
  // A chosen set of managers overrides the normal parent→child walk entirely —
  // managers can be grandchildren (or deeper) of the current scope, not just
  // direct children, so this cuts across the hierarchy rather than nesting into it.
  let kids = hierFilter.managers.length
    ? hierFilter.managers.map(id=>STATE.nodeIndex[id]).filter(Boolean)
    : Object.values(node.children||{});
  kids=kids.map(k=>({node:k,r:rollup(hierAccountsUnder(k.id))})).sort((a,b)=>b.r.arr-a.r.arr);
  let html=`<div class="card"><h3>${esc(node.name)} <span class="hint">${esc(node.title||'')} — drill into a team, manager, or rep</span></h3></div>`;
  html+=hierFilterBar();
  html+=`<div class="card">`;
  if(kids.length){
    html+=`<div class="treewrap">`+kids.map(k=>{
      const r=k.r, isLeaf=Object.keys(k.node.children||{}).length===0;
      return `<div class="node"><div class="nhead" onclick="setScope('${k.node.id}')">
        <div>${avatarChip(k.node.name)} <span class="nname">${esc(k.node.name)}</span> <span class="ntitle">${esc(k.node.title||'')}</span></div>
        <div class="metric"><b>Total Contract Value</b>${fmtMoney(r.arr)}</div>
        <div class="metric"><b>At risk</b><span style="color:var(--red)">${fmtMoney(r.risk)}</span></div>
        <div class="metric"><b>Health</b>${healthCell(r.health)}</div>
        <div class="metric"><b>${isLeaf?'Accounts':'Reports'}</b>${isLeaf?r.n:Object.keys(k.node.children).length}</div>
      </div></div>`;
    }).join('')+`</div>`;
  }
  const direct=hierFilter.managers.length ? [] : (node.accounts||[]).filter(a=>!hierFilter.segment || (a.segment||'')===hierFilter.segment);
  if(direct.length){
    html+=`<h3 style="margin-top:18px">Accounts owned here (${direct.length})</h3>`+accountTable([...direct].sort((a,b)=>b.riskARR-a.riskARR));
  } else if(!kids.length){ html+=`<p class="mini">No sub-teams or accounts under this node match the current filters.</p>`; }
  html+=`</div>`;
  return html;
}
function accountTable(accts){
  return `<table><thead><tr><th>Account</th><th>Owner</th><th class="num">Total Contract Value</th><th class="num">Annualized Revenue</th><th class="num">Close</th><th class="num">Cases</th><th>CSAT</th><th>Health</th><th>Tier</th></tr></thead><tbody>
  ${accts.map(a=>`<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${fmtMoney(a.ltv)}</td><td class="num">${a.dclose>9000?'—':a.dclose+'d'}</td><td class="num">${a.openCases}${a.highCases?` <span class="pill p-red">${a.highCases}!</span>`:''}</td><td>${csatPill(a)}</td><td>${healthCell(a.health)} ${tierPill(a.tier)}</td><td>${opportunityPill(a)}</td></tr>`).join('')}
  </tbody></table>`;
}

// ---- Renewals ----
let renewSort={k:'riskARR',dir:-1};
const RENEW_SORT_FIELDS=[['dclose','Days to close'],['renewalAmount','Total Contract Value'],['ltv','Annualized Revenue'],['riskARR','ARR at risk'],['tier','Account Tier']];
function renewSortBar(){
  return `<div class="sortbar">
    <label class="mini" for="renewSortField">Sort by</label>
    <select class="select sm" id="renewSortField" onchange="setRenewSortField(this.value)">${RENEW_SORT_FIELDS.map(([k,l])=>`<option value="${k}"${renewSort.k===k?' selected':''}>${esc(l)}</option>`).join('')}</select>
    <button type="button" class="btn sm" onclick="setRenewSortDir()" title="Toggle sort direction">${renewSort.k==='tier'?(renewSort.dir<0?'Tier 4 → 1 ▼':'Tier 1 → 4 ▲'):(renewSort.dir<0?'High → Low ▼':'Low → High ▲')}</button>
  </div>`;
}
function setRenewSortField(k){ renewSort.k=k; if(renewSort.dir==null) renewSort.dir=-1; route(); }
function setRenewSortDir(){ renewSort.dir*=-1; route(); }
function setRenewSort(k){ if(renewSort.k===k)renewSort.dir*=-1; else {renewSort.k=k;renewSort.dir=(k==='name')?1:-1;} route(); }

// ---- Account Tier (contract-value ranking) ----
// A second, independent axis from Segment (which is size-based): purely a
// function of this renewal's Total Contract Value, so the same logic applies
// whether the account is Enterprise or SMB. Surfaced as a sort/group option in
// Renewals & Contract Value rather than its own tab — thresholds are business
// rules, kept in one place so they're easy to retune.
const CONTRACT_TIER_THRESHOLDS={t1:250000,t2:75000,t3:20000};
const CONTRACT_TIER_LABELS={1:'Tier 1 · Strategic',2:'Tier 2 · Maintain',3:'Tier 3 · Below-average',4:'Tier 4 · Reactive'};
function contractTier(a){
  const v=a.renewalAmount||0;
  if(v>=CONTRACT_TIER_THRESHOLDS.t1) return 1;
  if(v>=CONTRACT_TIER_THRESHOLDS.t2) return 2;
  if(v>=CONTRACT_TIER_THRESHOLDS.t3) return 3;
  return 4;
}
function renewTableHead(){
  const sc=(k,l)=>`<th class="num" onclick="setRenewSort('${k}')">${l}${renewSort.k===k?(renewSort.dir<0?' ▼':' ▲'):''}</th>`;
  return `<tr><th onclick="setRenewSort('name')">Account</th><th>Owner</th><th>Stage</th>${sc('dclose','Days to close')}${sc('renewalAmount','Total Contract Value')}${sc('ltv','Annualized Revenue')}${sc('openCases','Open cases')}${sc('csat','CSAT')}${sc('readiness','Renewal ready')}${sc('riskARR','ARR at risk')}<th>Health</th></tr>`;
}
function renewRowHtml(a){
  const st=a.opps[0]?a.opps[0].stage:''; const late=a.dclose<=90&&EARLY.has(st);
  return `<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td>${esc(st)}${late?' <span class="pill p-red">behind</span>':''}</td><td class="num">${a.dclose>9000?'—':a.dclose}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${fmtMoney(a.ltv)}</td><td class="num">${a.openCases}${a.highCases?` <span class="pill p-red">${a.highCases}!</span>`:''}</td><td>${csatPill(a)}</td><td class="num">${readyPill(a.readiness)}</td><td class="num"><b>${fmtMoney(a.riskARR)}</b></td><td>${healthCell(a.health)}</td></tr>`;
}
function viewRenewals(accts){
  if(renewSort.k==='tier'){
    const groups={1:[],2:[],3:[],4:[]};
    accts.forEach(a=>groups[contractTier(a)].push(a));
    const order = renewSort.dir<0 ? [4,3,2,1] : [1,2,3,4];
    const body = order.map(t=>{
      const list=[...groups[t]].sort((a,b)=>(b.renewalAmount||0)-(a.renewalAmount||0));
      if(!list.length) return '';
      return `<div class="tier-group"><h4 class="tier-h">${esc(CONTRACT_TIER_LABELS[t])} <span class="hint">${list.length} account${list.length===1?'':'s'} · ${fmtMoney(list.reduce((s,a)=>s+(a.renewalAmount||0),0))} TCV</span></h4>
      <table><thead>${renewTableHead()}</thead><tbody>${list.map(renewRowHtml).join('')}</tbody></table></div>`;
    }).join('');
    return `<div class="card"><h3>Renewal & risk triage <span class="hint">${accts.length} accounts · grouped by contract-value tier</span>${renewSortBar()}</h3>
    <div class="searchbar"><input id="rsearch" placeholder="Filter accounts…" oninput="filterTable(this,'rtbl')"></div>
    <div id="rtbl">${body||'<p class="mini">No accounts in scope.</p>'}</div></div>`;
  }
  const rows=[...accts].sort((a,b)=>{ const x=a[renewSort.k], y=b[renewSort.k]; const xn=x==null?-Infinity:x, yn=y==null?-Infinity:y; return renewSort.dir*((xn>yn)?1:(xn<yn)?-1:0); });
  return `<div class="card"><h3>Renewal & risk triage <span class="hint">${accts.length} accounts · prioritized by revenue exposure</span>${renewSortBar()}</h3>
  <div class="searchbar"><input id="rsearch" placeholder="Filter accounts…" oninput="filterTable(this,'rtbl')"></div>
  <table id="rtbl"><thead>${renewTableHead()}</thead><tbody>
  ${rows.map(renewRowHtml).join('')}
  </tbody></table></div>`;
}

// ---- Escalations ----
let escFilter='active';
let escKpiFilter=null; // null | 'critical' | 'open' | 'inprogress' | 'resolved' — set by clicking a KPI tile
const ESC_KPI_LABELS={critical:'Critical unresolved',open:'Open',inprogress:'In progress',resolved:'Resolved'};
function setEscKpi(k){ escKpiFilter = escKpiFilter===k?null:k; route(); }
function escRollupCard(rollupBase){
  const total=rollupBase.length;
  const reasonCounts={}; ESC_REASONS.forEach(r=>reasonCounts[r]=0);
  rollupBase.forEach(e=>{ const r=e.reasonCode||'Untagged'; reasonCounts[r]=(reasonCounts[r]||0)+1; });
  const prodCounts={};
  rollupBase.forEach(e=>{ const p=e.product||'Untagged'; prodCounts[p]=(prodCounts[p]||0)+1; });
  const stale=rollupBase.filter(e=>e.daysOpen!=null&&e.daysOpen>=14).length;
  const bar=(label,n)=>`<div class="rollrow"><div class="rl">${esc(label)}</div><div class="rbarwrap"><div class="rbar" style="width:${total?Math.round(n/total*100):0}%"></div></div><div class="rn">${n}</div></div>`;
  const reasonRows=Object.entries(reasonCounts).filter(([,n])=>n>0).map(([k,n])=>bar(k,n)).join('');
  const untaggedReason=reasonCounts['Untagged']||0;
  const prodRows=Object.entries(prodCounts).sort((a,b)=>b[1]-a[1]).map(([k,n])=>bar(k,n)).join('');
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Leadership rollup <span class="hint">${total} active escalation${total===1?'':'s'} in scope · ${stale} open 14+ days (stale)</span></h3>
  <div class="grid2">
    <div><p class="mini" style="margin-bottom:8px"><b>By reason code</b></p>${reasonRows||''}${untaggedReason?bar('Untagged',untaggedReason):''}${total?'':'<p class="mini">No active escalations in scope.</p>'}</div>
    <div><p class="mini" style="margin-bottom:8px"><b>By product</b></p>${prodRows||(total?'<p class="mini">Nothing tagged yet.</p>':'')}</div>
  </div>
  </div>`;
}
// ---- Escalation analytics (types, open duration, mean time-to-resolve, trend) ----
// Computed from escState directly (every account this app has ever tracked as
// escalated), not just STATE.escList (only accounts currently unhealthy) — so an
// account that recovered still counts toward "resolved (all time)" and the mean
// time-to-resolve. Per NOTES.md: the mock data has no real historical escalation
// log, so the weekly trend is built from real open/resolve timestamps captured in
// this browser rather than fabricated — thin at first, genuine as it accumulates.
function escAnalytics(accts){
  const inScope=new Set(accts.map(a=>a.id));
  const nameOf=id=>{ const a=STATE.accounts.find(x=>x.id===id); return a?a.name:id; };
  const entries=Object.keys(escState).filter(id=>inScope.has(id)).map(id=>Object.assign({acctId:id,name:nameOf(id)},escState[id]));
  const active=entries.filter(e=>e.status!=='Resolved');
  const resolved=entries.filter(e=>e.status==='Resolved');
  const reasonCounts={}; ESC_REASONS.forEach(r=>reasonCounts[r]=0); reasonCounts.Untagged=0;
  entries.forEach(e=>{ const r=e.reasonCode||'Untagged'; reasonCounts[r]=(reasonCounts[r]||0)+1; });
  const durBuckets=[['0–3d',0,3],['4–7d',4,7],['8–14d',8,14],['15–30d',15,30],['31d+',31,Infinity]].map(([label,lo,hi])=>{
    const n=active.filter(e=>{ if(!e.openedAt) return false; const d=Math.floor((Date.now()-new Date(e.openedAt).getTime())/864e5); return d>=lo&&d<=hi; }).length;
    return {label,n};
  });
  const resolveDays=resolved.filter(e=>e.openedAt&&e.resolvedAt).map(e=>Math.max(0,Math.round((new Date(e.resolvedAt)-new Date(e.openedAt))/864e5)));
  const meanResolveDays=resolveDays.length?Math.round(resolveDays.reduce((s,d)=>s+d,0)/resolveDays.length*10)/10:null;
  const weeks=8, buckets=[];
  const startOfWeek=d=>{ const x=new Date(d); const day=(x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-day); return x; };
  const thisWeekStart=startOfWeek(new Date());
  for(let i=weeks-1;i>=0;i--){ const ws=new Date(thisWeekStart); ws.setDate(ws.getDate()-i*7); const we=new Date(ws); we.setDate(we.getDate()+7); buckets.push({label:(ws.getMonth()+1)+'/'+ws.getDate(),start:ws,end:we,opened:0,resolved:0}); }
  entries.forEach(e=>{
    if(e.openedAt){ const d=new Date(e.openedAt); const b=buckets.find(b=>d>=b.start&&d<b.end); if(b)b.opened++; else if(d<buckets[0].start)buckets[0].opened++; }
    if(e.resolvedAt){ const d=new Date(e.resolvedAt); const b=buckets.find(b=>d>=b.start&&d<b.end); if(b)b.resolved++; else if(d<buckets[0].start)buckets[0].resolved++; }
  });
  return {entries,active,resolved,reasonCounts,durBuckets,meanResolveDays,resolveCount:resolveDays.length,weekly:buckets};
}
function escAnalyticsCard(an){
  const bar=(label,n,max)=>`<div class="rollrow"><div class="rl">${esc(label)}</div><div class="rbarwrap"><div class="rbar" style="width:${max?Math.round(n/max*100):0}%"></div></div><div class="rn">${n}</div></div>`;
  const durMax=Math.max(1,...an.durBuckets.map(b=>b.n));
  const reasonEntries=Object.entries(an.reasonCounts).filter(([,n])=>n>0);
  const reasonMax=Math.max(1,...reasonEntries.map(([,n])=>n));
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Escalation analytics <span class="hint">types, open duration, resolution time &amp; trend — across every escalation this app has tracked, not just what's active today</span></h3>
  <div class="kpis" style="margin-bottom:14px">
    <div class="kpi"><div class="l">Mean time to resolve</div><div class="v">${an.meanResolveDays==null?'—':an.meanResolveDays+'d'}</div><div class="d">${an.resolveCount} resolved with both timestamps</div></div>
    <div class="kpi"><div class="l">Active now</div><div class="v">${an.active.length}</div><div class="d">open + in progress</div></div>
    <div class="kpi"><div class="l">Resolved (all time)</div><div class="v">${an.resolved.length}</div><div class="d">since this app started tracking</div></div>
    <div class="kpi"><div class="l">Tracked (all time)</div><div class="v">${an.entries.length}</div><div class="d">distinct accounts ever escalated</div></div>
  </div>
  <div class="grid2">
    <div><p class="mini" style="margin-bottom:8px"><b>Open duration (active queue)</b></p>${an.durBuckets.map(b=>bar(b.label,b.n,durMax)).join('')}</div>
    <div><p class="mini" style="margin-bottom:8px"><b>By reason code (all-time)</b></p>${reasonEntries.length?reasonEntries.map(([k,n])=>bar(k,n,reasonMax)).join(''):'<p class="mini">Nothing tagged yet.</p>'}</div>
  </div>
  <p class="mini" style="margin:14px 0 6px"><b>Opened vs. resolved per week</b></p>
  <div class="chartbox" style="height:200px"><canvas id="cEscTrend"></canvas></div>
  <p class="mini" style="margin-top:8px;color:var(--muted)">Built from real open/resolve timestamps captured in your browser — thin until this app has been tracking escalations over real time. A Salesforce Escalation object with a true <code>CreatedDate</code> (see NOTES.md) would make this meaningful from day one instead of only going forward.</p>
  </div>`;
}
function drawEscTrendChart(accts){
  Object.values(charts).forEach(c=>{try{c.destroy()}catch(e){}}); charts={};
  const an=escAnalytics(accts);
  const el=$('#cEscTrend'); if(!el) return;
  const openedColor=window.AXON_THEME?'#d64545':'#ff6b6b', resolvedColor=window.AXON_THEME?'#1a9e5c':'#3ddc97';
  charts.escTrend=new Chart(el,{type:'bar',data:{labels:an.weekly.map(w=>w.label),datasets:[
    {label:'Opened',data:an.weekly.map(w=>w.opened),backgroundColor:openedColor,borderRadius:window.AXON_THEME?0:5},
    {label:'Resolved',data:an.weekly.map(w=>w.resolved),backgroundColor:resolvedColor,borderRadius:window.AXON_THEME?0:5}
  ]},options:chartBaseOptions({})});
}
function escReasonSelect(e){
  return `<select class="select sm" onclick="event.stopPropagation()" onchange="event.stopPropagation();setEscReason('${e.acctId}',this.value)">
    <option value=""${!e.reasonCode?' selected':''}>— reason —</option>
    ${ESC_REASONS.map(r=>`<option value="${esc(r)}"${e.reasonCode===r?' selected':''}>${esc(r)}</option>`).join('')}
  </select>`;
}
function escProductSelect(e){
  return `<select class="select sm" onclick="event.stopPropagation()" onchange="event.stopPropagation();setEscProduct('${e.acctId}',this.value)">
    <option value=""${!e.product?' selected':''}>— product —</option>
    ${ESC_PRODUCTS.map(p=>`<option value="${esc(p)}"${e.product===p?' selected':''}>${esc(p)}</option>`).join('')}
  </select>`;
}
function viewEsc(accts){
  const inScope = new Set(accts.map(a=>a.id));
  let list = STATE.escList.filter(e=>inScope.has(e.acctId));
  const rollupBase = list.filter(e=>e.status!=='Resolved');
  const crit=list.filter(e=>e.sev==='Critical'&&e.status!=='Resolved').length;
  const open=list.filter(e=>e.status==='Open').length, prog=list.filter(e=>e.status==='In Progress').length, res=list.filter(e=>e.status==='Resolved').length;
  if(escKpiFilter==='critical') list=list.filter(e=>e.sev==='Critical'&&e.status!=='Resolved');
  else if(escKpiFilter==='open') list=list.filter(e=>e.status==='Open');
  else if(escKpiFilter==='inprogress') list=list.filter(e=>e.status==='In Progress');
  else if(escKpiFilter==='resolved') list=list.filter(e=>e.status==='Resolved');
  else if(escFilter==='active') list=list.filter(e=>e.status!=='Resolved');
  else if(escFilter==='resolved') list=list.filter(e=>e.status==='Resolved');
  return `<div class="card"><h3>Escalations tracker <span class="hint">auto-seeded from live risk signals · status persists locally — click a tile below to filter</span></h3>
  <div class="kpis" style="margin-bottom:14px">
    <div class="kpi clickable${escKpiFilter==='critical'?' selected':''}" onclick="setEscKpi('critical')"><div class="l">Critical unresolved</div><div class="v" style="color:var(--red)">${crit}</div></div>
    <div class="kpi clickable${escKpiFilter==='open'?' selected':''}" onclick="setEscKpi('open')"><div class="l">Open</div><div class="v">${open}</div></div>
    <div class="kpi clickable${escKpiFilter==='inprogress'?' selected':''}" onclick="setEscKpi('inprogress')"><div class="l">In progress</div><div class="v">${prog}</div></div>
    <div class="kpi clickable${escKpiFilter==='resolved'?' selected':''}" onclick="setEscKpi('resolved')"><div class="l">Resolved</div><div class="v" style="color:var(--green)">${res}</div></div>
  </div>
  ${escKpiFilter?`<p class="mini" style="margin:-6px 0 12px">Filtered to <b>${esc(ESC_KPI_LABELS[escKpiFilter])}</b> · <a href="#" onclick="setEscKpi('${escKpiFilter}');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear filter</a></p>`:
  `<div class="searchbar"><select class="select" onchange="escFilter=this.value;route()">
    <option value="active"${escFilter==='active'?' selected':''}>Open + in progress</option>
    <option value="all"${escFilter==='all'?' selected':''}>All</option>
    <option value="resolved"${escFilter==='resolved'?' selected':''}>Resolved only</option></select></div>`}
  </div>
  ${escRollupCard(rollupBase)}
  ${escAnalyticsCard(escAnalytics(accts))}
  <div class="card"><table><thead><tr><th>Account</th><th>Issue</th><th>Severity</th><th>Reason</th><th>Product</th><th class="num">Days open</th><th>Status</th><th class="num">ARR at risk</th><th></th></tr></thead><tbody>
  ${list.map(e=>`<tr><td onclick="openAcct('${e.acctId}')" style="cursor:pointer"><b>${esc(e.acct.name)}</b> ${stateTag(e.acct)}<div class="mini">${ownerCell(e.acct.ownerName)}</div></td><td>${esc(e.issue)}</td><td>${sevPill(e.sev)}</td><td>${escReasonSelect(e)}</td><td>${escProductSelect(e)}</td><td class="num">${e.daysOpen==null?'—':`<span class="${e.daysOpen>=14?'neg':''}">${e.daysOpen}d${e.daysOpen>=14?' ⚠':''}</span>`}</td><td>${statusPill(e.status)}</td><td class="num">${fmtMoney(e.acct.riskARR)}</td><td class="row-actions">${e.status!=='In Progress'&&e.status!=='Resolved'?`<button class="btn" onclick="event.stopPropagation();setEscStatus('${e.acctId}','In Progress')">Start</button>`:''}${e.status!=='Resolved'?`<button class="btn primary" onclick="event.stopPropagation();setEscStatus('${e.acctId}','Resolved')">Resolve</button>`:`<button class="btn" onclick="event.stopPropagation();setEscStatus('${e.acctId}','Open')">Reopen</button>`}</td></tr>`).join('')}
  </tbody></table>
  ${list.length?'':'<p class="mini">Nothing here — no escalations match this scope/filter.</p>'}</div>`;
}

// ---- Success Plans ----
// Standardized discovery template, per Leana & Beatrice's stakeholder findings:
// every plan should capture the same structured deal/account context — not
// freeform, not left to whichever CSM remembers to ask — so a net-new CSM (or a
// manager reviewing the book) gets the same picture every time. Kept optional/
// collapsible so teams that don't need this depth (see Derek Frier in NOTES.md)
// aren't forced to fill it in.
const DISCOVERY_FIELDS=[
  {key:'purchasingStory',label:'Purchasing story',type:'textarea',hint:'How did this deal come together?'},
  {key:'stakeholders',label:'Stakeholders',type:'textarea',hint:"Who's involved, on both sides, and their role"},
  {key:'incumbent',label:'Incumbent',type:'text',hint:'What/who did we replace, if anything'},
  {key:'reasonForPurchase',label:'Reason for purchase',type:'textarea'},
  {key:'goals',label:'Specific goals / outcomes',type:'textarea'},
  {key:'painPoints',label:'Pain points',type:'textarea'},
  {key:'winningLooksLike',label:'What does winning look like?',type:'textarea'},
  {key:'blockers',label:'Blockers',type:'textarea'},
  {key:'politics',label:'Politics',type:'textarea',hint:'Internal dynamics that could affect this account'},
  {key:'contractTerms',label:'Irregular contract terms',type:'textarea'},
  {key:'welcomeDeck',label:'Welcome deck (link)',type:'text',hint:'https://…'},
  {key:'slaInfo',label:'SLA tracking info',type:'textarea'},
];
function setPlanDiscovery(id,key,v){ const p=plans[id]; if(!p) return; p.discovery=p.discovery||{}; p.discovery[key]=v; touchPlan(id); }
function discoveryCard(id,p){
  const d=p.discovery||{};
  const filled=DISCOVERY_FIELDS.filter(f=>d[f.key]&&d[f.key].trim()).length;
  return `<div class="card" style="box-shadow:none;margin:0 0 16px">
    <details class="disc"${filled?' open':''}>
      <summary><h3 style="display:inline;border:none;margin:0">Deal &amp; account discovery <span class="hint">standardized template · ${filled} of ${DISCOVERY_FIELDS.length} fields filled in</span></h3></summary>
      <p class="mini" style="margin:10px 0">Optional, but the same structure on every plan — purchasing story, stakeholders, blockers, politics and more, captured the same way regardless of which CSM owns the account.</p>
      <div class="disco-grid">
      ${DISCOVERY_FIELDS.map(f=>`<div class="disco-field"><label class="mini" style="font-weight:700;color:var(--ink);display:block;margin-bottom:6px">${esc(f.label)}</label>${
        f.type==='textarea'
          ? `<textarea class="notes-in" style="min-height:56px" placeholder="${esc(f.hint||'')}" oninput="setPlanDiscovery('${id}','${f.key}',this.value)">${esc(d[f.key]||'')}</textarea>`
          : `<input type="text" value="${esc(d[f.key]||'')}" placeholder="${esc(f.hint||'')}" style="width:100%;border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setPlanDiscovery('${id}','${f.key}',this.value)">`
      }</div>`).join('')}
      </div>
    </details>
  </div>`;
}
function planProgress(p){ if(!p||!p.milestones||!p.milestones.length) return 0; return Math.round(p.milestones.filter(m=>m.done).length/p.milestones.length*100); }
// ---- Talk tracks ----
// Short, reusable call scripts a CSM can open right from a plan step (or the
// resource library). Kept in-app so guidance is consistent regardless of tenure.
const TALK_TRACKS=[
  {id:'tt_kickoff',title:'Onboarding kickoff call',scenario:'First call with a new logo',
   script:`Opening: "Thanks for making the time — my job is to make sure your team gets real value from Axon fast, not just get it installed."\n\nConfirm the why: "Remind me what success looks like for you 90 days from now? What made you choose Axon?"\n\nSet the plan: walk through the onboarding milestones and the dates. Confirm the admins and the economic buyer.\n\nCadence: "I'll check in every couple of weeks during rollout, then we'll do a value review at 90 days."\n\nClose: agree on the very next step and who owns it.`},
  {id:'tt_qbr',title:'Quarterly value review / QBR',scenario:'Recurring executive check-in',
   script:`Frame: "The goal today is to line up what you've gotten out of Axon against the goals we set, and agree on next quarter."\n\nValue delivered: usage/adoption numbers, outcomes, support wins.\n\nGaps: where adoption is light, what's blocking it, what we'll do about it.\n\nForward look: roadmap items relevant to them, training needs, expansion where it genuinely helps.\n\nClose: confirm owners and dates for each next step.`},
  {id:'tt_renewal',title:'Renewal value conversation',scenario:'Ahead of a renewal',
   script:`Frame: "As we get close to renewal I want to make sure the value is obvious and there are no surprises."\n\nRecap: quantify outcomes since last renewal — adoption, cases resolved, time saved.\n\nConfirm process: "Who signs off, and what's the timeline on your side?"\n\nHandle risk early: "Anything that would make you hesitate to renew?" — surface it now.\n\nClose: agree on the paper process and the date.`},
  {id:'tt_tap',title:'TAP hardware refresh conversation',scenario:'2.5-year hardware refresh',
   script:`Frame: "You're coming up on your hardware refresh — this is included, and the goal is zero downtime for your officers."\n\nLogistics: confirm units, shipping, and the RMA/return of old devices.\n\nTiming: schedule around shifts so nobody is without a device.\n\nValue: use it as a touchpoint — any new use cases or teams to bring on?\n\nClose: confirm the refresh date and the point of contact on their side.`},
  {id:'tt_risk',title:'At-risk / save-play check-in',scenario:'Health or cases look strained',
   script:`Open honestly: "I noticed a few things I want to get ahead of — some open cases and lighter usage — and I'd rather talk about it directly."\n\nListen first: let them tell you what's actually going on before you pitch fixes.\n\nOwn it: name what Axon will do, with dates and owners.\n\nRebuild the plan: agree on 2-3 concrete steps that rebuild confidence.\n\nClose: set a short follow-up so they see momentum.`},
  {id:'tt_adoption',title:'Adoption / training nudge',scenario:'Usage is below target',
   script:`Frame: "You're paying for capabilities your team isn't fully using yet — let's fix that."\n\nSpecifics: point to the exact features/products with low adoption.\n\nRemove friction: offer Axon Academy training, office hours, or a quick enablement session.\n\nMake it easy: pick one workflow to drive this month rather than boiling the ocean.\n\nClose: schedule the training and identify a champion.`},
];
function talkTrackById(id){ return TALK_TRACKS.find(t=>t.id===id); }

// ---- Success plan templates (by task type) ----
// Each type seeds objectives + milestones. Milestones carry guidance and
// pre-attached resources (email templates, talk tracks, resource-library links)
// so the plan is actionable, not just a checklist. `day` = offset from creation.
const PLAN_TEMPLATES={
  onboarding:{ label:'Onboarding (new logo)', desc:'Stand up a new customer and drive first value.',
    objectives:[
      'Achieve first measurable value within 90 days of onboarding',
      'Drive adoption of purchased Axon products across the agency',
      'Establish executive alignment and a clear path to renewal'
    ],
    milestones:[
      {day:7,title:'Executive kickoff & welcome call',detail:'Introduce the CS team, confirm goals and success criteria, and set the check-in cadence.',resources:[{kind:'email',id:'cust_welcome'},{kind:'talktrack',id:'tt_kickoff'},{kind:'resource',id:'r1'}]},
      {day:14,title:'Map stakeholders & define success criteria',detail:'Identify the economic buyer, admins and champions; capture what success looks like in plan discovery.',resources:[{kind:'resource',id:'r1'}]},
      {day:30,title:'Deployment & provisioning',detail:'Confirm hardware/software provisioned, Evidence.com configured, and integrations in place.',resources:[{kind:'resource',id:'r4'}]},
      {day:45,title:'Admin & end-user training',detail:'Schedule Axon Academy training and confirm admins are certified.',resources:[{kind:'resource',id:'r3'},{kind:'email',id:'cust_product'}]},
      {day:60,title:'Go-live / first adoption checkpoint',detail:'Verify real usage, review adoption metrics, and clear any blockers.',resources:[{kind:'talktrack',id:'tt_adoption'}]},
      {day:90,title:'90-day value review & QBR',detail:'Recap value delivered against goals and align on the next quarter.',resources:[{kind:'talktrack',id:'tt_qbr'},{kind:'email',id:'cust_followup'}]},
    ]},
  renewal:{ label:'Renewal', desc:'Drive an on-time, full-value renewal.',
    objectives:[
      'Secure an on-time, full-value renewal',
      'Quantify and present the value delivered',
      'Surface and de-risk any blockers early'
    ],
    milestones:[
      {day:7,title:'Renewal readiness review',detail:'Run the renewal readiness checklist and confirm the opportunity is staged correctly.',resources:[{kind:'email',id:'int_renewal'}]},
      {day:14,title:'Build the value recap',detail:'Assemble usage, outcomes and support wins into a value recap deck.',resources:[{kind:'resource',id:'r5'},{kind:'talktrack',id:'tt_renewal'}]},
      {day:30,title:'Executive value conversation',detail:'Present the value recap; confirm budget, timeline and decision process.',resources:[{kind:'email',id:'cust_renewal'},{kind:'talktrack',id:'tt_renewal'}]},
      {day:45,title:'Proposal & paperwork',detail:'Send the renewal proposal and align procurement and legal.',resources:[{kind:'email',id:'int_renewal'},{kind:'resource',id:'r5'}]},
      {day:60,title:'Confirm renewal / next steps',detail:'Close the renewal or document the path forward and any risks.',resources:[{kind:'email',id:'int_renewal'}]},
    ]},
  tap:{ label:'TAP hardware refresh', desc:'Complete the 2.5-year hardware refresh cleanly.',
    objectives:[
      'Complete the hardware refresh before the warranty lapses',
      'Keep officers equipped with no downtime',
      'Use the refresh as a value & expansion touchpoint'
    ],
    milestones:[
      {day:7,title:'Confirm refresh eligibility & timeline',detail:'Verify contract dates and the units eligible for the TAP refresh.',resources:[{kind:'email',id:'int_tap'}]},
      {day:14,title:'Coordinate with the customer',detail:'Schedule the refresh conversation and set expectations on logistics.',resources:[{kind:'email',id:'cust_tap'},{kind:'talktrack',id:'tt_tap'}]},
      {day:30,title:'Align ops / fleet / logistics',detail:'Confirm shipping, provisioning and RMA of the old units.',resources:[{kind:'resource',id:'r2'}]},
      {day:45,title:'Execute the refresh',detail:'Ship/deploy the new hardware and confirm activation.',resources:[{kind:'resource',id:'r2'},{kind:'email',id:'cust_tap'}]},
      {day:60,title:'Confirm completion & capture value',detail:'Verify all units are refreshed, log the outcome, and look for expansion.',resources:[{kind:'talktrack',id:'tt_qbr'}]},
    ]},
};
const PLAN_TYPE_ORDER=['onboarding','renewal','tap'];
function planTypeLabel(t){ return (PLAN_TEMPLATES[t]||PLAN_TEMPLATES.onboarding).label; }
function planTypeFor(a){
  if(newLogo(a)) return 'onboarding';
  if(a.tapStatus==='overdue'||a.tapStatus==='duesoon') return 'tap';
  if(a.dclose!=null && a.dclose<=365) return 'renewal';
  return 'onboarding';
}
function generatePlan(id,type){
  const a=STATE.accounts.find(x=>x.id===id); if(!a) return;
  type = PLAN_TEMPLATES[type] ? type : planTypeFor(a);
  const tpl=PLAN_TEMPLATES[type];
  const base=new Date();
  const uid=()=>'m'+Math.random().toString(36).slice(2,9);
  const ms=tpl.milestones.map(m=>({
    id:uid(), title:m.title, detail:m.detail||'', note:'',
    resources:(m.resources||[]).map(r=>({kind:r.kind,id:r.id})),
    due:sfDate(new Date(base.getTime()+m.day*864e5)), done:false
  }));
  // Risk-aware addition: clear blocking support before other milestones.
  if(a.highCases>0 || a.health<60) ms.push({id:uid(),title:'Resolve open support escalations',detail:'Clear high/urgent cases that block progress before the other milestones.',note:'',resources:[{kind:'email',id:'int_escalation'}],due:sfDate(new Date(base.getTime()+21*864e5)),done:false});
  ms.sort((x,y)=> x.due<y.due?-1:1);
  plans[id]={acctId:id,planType:type,created:new Date().toISOString(),updatedAt:new Date().toISOString(),objectives:tpl.objectives.slice(),milestones:ms,notes:'',discovery:{},auto:true};
  savePlans();
}
function generateAllNewLogos(){
  const logos=STATE.accounts.filter(newLogo).filter(a=>!plans[a.id]);
  logos.forEach(a=>generatePlan(a.id));
  toast(`Generated ${logos.length} success plan${logos.length===1?'':'s'} for new-logo accounts.`);
  route();
}
function createOrOpenPlan(id,type){ if(!plans[id]) generatePlan(id,type); setTab('plans'); openPlan(id); }
function planDueSoonCount(p){ return (p&&p.milestones||[]).filter(m=>!m.done && daysSince(m.due)!=null && daysSince(m.due)>=-14).length; }
let plansKpiFilter=null; // null | 'active' | 'dueSoon' — set by clicking a KPI tile
function setPlansKpi(k){ plansKpiFilter = plansKpiFilter===k?null:k; route(); }
function viewPlans(accts){
  const logos=accts.filter(newLogo);
  const inScope=new Set(accts.map(a=>a.id));
  const active=Object.values(plans).filter(p=>inScope.has(p.acctId));
  const needPlan=logos.filter(a=>!plans[a.id]);
  const dueSoon=active.reduce((n,p)=>n+planDueSoonCount(p),0);
  const kpis=[
    ['New logos in scope',logos.length,'first purchase within 12 months',null],
    ['Plans active',active.length,needPlan.length+' new logos still need one','active'],
    ['Milestones due soon',dueSoon,'open & due within 2 weeks','dueSoon'],
  ];
  let html=`<div class="card"><h3>Success Plans <span class="hint">onboarding + risk-aware plans for new logos, and custom plans for any account — click a tile to filter</span></h3>
  <div class="kpis" style="margin-bottom:14px">${kpis.map(k=>`<div class="kpi clickable${k[3]&&plansKpiFilter===k[3]?' selected':''}" onclick="setPlansKpi(${k[3]?`'${k[3]}'`:'null'})"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  ${plansKpiFilter?`<p class="mini" style="margin:-6px 0 6px">Filtered to <b>${plansKpiFilter==='active'?'accounts with an active plan':'plans with milestones due soon'}</b> · <a href="#" onclick="setPlansKpi('${plansKpiFilter}');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear filter</a></p>`:''}
  <div class="row-actions" style="margin-bottom:6px">
    <button class="btn primary" onclick="generateAllNewLogos()" ${needPlan.length?'':'disabled'}>Generate plans for all new logos${needPlan.length?` (${needPlan.length})`:''}</button>
    <span class="mini">Auto-builds an onboarding + risk-aware plan, then you customize it.</span>
  </div></div>`;

  // New logos needing onboarding
  let logosShown=logos;
  if(plansKpiFilter==='active') logosShown=logos.filter(a=>plans[a.id]);
  else if(plansKpiFilter==='dueSoon') logosShown=logos.filter(a=>planDueSoonCount(plans[a.id])>0);
  html+=`<div class="card"><h3>New logos to onboard <span class="hint">${logosShown.length} of ${logos.length} account${logos.length===1?'':'s'} shown · newest customers first</span></h3>`;
  if(!logos.length){ html+=`<p class="mini">No new-logo accounts in this scope. A "new logo" is an account whose first closed-won deal landed within the last 12 months.</p>`; }
  else if(!logosShown.length){ html+=`<p class="mini">No new logos match this filter.</p>`; }
  else{
    const sorted=[...logosShown].sort((a,b)=> (b.firstPurchase||'').localeCompare(a.firstPurchase||''));
    html+=`<table><thead><tr><th>Account</th><th>Owner</th><th class="num">First purchase</th><th class="num">Annualized Revenue</th><th>Health</th><th>Plan</th><th></th></tr></thead><tbody>
    ${sorted.map(a=>{const p=plans[a.id];const prog=planProgress(p);return `<tr><td onclick="openAcct('${a.id}')" style="cursor:pointer"><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td class="num">${esc(a.firstPurchase||'—')}</td><td class="num">${fmtMoney(a.ltv)}</td><td>${healthCell(a.health)}</td><td>${p?`<span class="pill p-green">Plan · ${prog}%</span>`:'<span class="pill p-gray">None</span>'}</td><td class="row-actions">${p?`<button class="btn sm" onclick="openPlan('${a.id}')">Open</button>`:`<button class="btn primary sm" onclick="createOrOpenPlan('${a.id}')">Generate</button>`}</td></tr>`;}).join('')}
    </tbody></table>`;
  }
  html+=`</div>`;

  // Active plans (incl. custom, non-new-logo)
  let custom=active.filter(p=>{ const a=STATE.accounts.find(x=>x.id===p.acctId); return a && !newLogo(a); });
  if(plansKpiFilter==='dueSoon') custom=custom.filter(p=>planDueSoonCount(p)>0);
  if(custom.length){
    html+=`<div class="card"><h3>Other active plans <span class="hint">custom plans on established accounts</span></h3>
    <table><thead><tr><th>Account</th><th>Owner</th><th class="num">Total Contract Value</th><th>Progress</th><th></th></tr></thead><tbody>
    ${custom.map(p=>{const a=STATE.accounts.find(x=>x.id===p.acctId);const prog=planProgress(p);return `<tr><td onclick="openAcct('${a.id}')" style="cursor:pointer"><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td><div class="progress" style="width:120px"><i style="width:${prog}%"></i></div><span class="mini">${prog}%</span></td><td><button class="btn sm" onclick="openPlan('${a.id}')">Open</button></td></tr>`;}).join('')}
    </tbody></table></div>`;
  }
  html+=`<p class="mini" style="margin:2px 4px">Tip: open any account (from any tab) and use <b>Create / open success plan</b> to build a customized plan — it doesn't have to be a new logo.</p>`;
  return html;
}
function openPlan(id){
  if(!plans[id]) generatePlan(id);
  const p=plans[id]; const a=STATE.accounts.find(x=>x.id===id); if(!p||!a) return;
  const prog=planProgress(p);
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2>Success Plan — ${esc(a.name)} ${stateTag(a)}</h2><div class="mini" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">Owner ${ownerCell(a.ownerName)} · ${newLogo(a)?'New logo · first purchase '+esc(a.firstPurchase||''):'Established account'} · Renewal ${a.dclose>9000?'—':'in '+a.dclose+'d'}</div></div><button class="x" onclick="closeSheet()">✕</button></div>
  <div class="bd">
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Progress <span class="hint">${p.milestones.filter(m=>m.done).length} of ${p.milestones.length} milestones complete</span></h3>
      <div class="progress"><i style="width:${prog}%"></i></div>
      <div class="row-actions" style="margin-top:10px;align-items:center">
        <span class="pill p-blue">${esc(planTypeLabel(p.planType))} plan</span>
        <label class="mini" style="margin-left:4px">Switch template</label>
        <select class="select" onchange="if(this.value)regenPlanAs('${id}',this.value)">
          <option value="">Rebuild from…</option>
          ${PLAN_TYPE_ORDER.map(t=>`<option value="${t}">${esc(PLAN_TEMPLATES[t].label)}</option>`).join('')}
        </select>
      </div>
      <p class="mini" style="margin-top:8px">Plan ${p.auto?'auto-generated':'created'} ${new Date(p.created).toLocaleDateString()} · saved in your browser. Click a milestone's <b>Open</b> button for guidance, talk tracks and email templates.</p>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Objectives <span class="hint">one per line</span></h3>
      <textarea class="obj-in" id="planObj" oninput="setPlanObjectives('${id}',this.value)">${esc((p.objectives||[]).join('\n'))}</textarea>
    </div>
    ${discoveryCard(id,p)}
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Milestones</h3>
      <div id="planMs">${p.milestones.map(m=>msRow(id,m)).join('')}</div>
      <div class="row-actions" style="margin-top:10px"><button class="btn sm" onclick="addPlanMs('${id}')">+ Add milestone</button></div>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Notes</h3>
      <textarea class="notes-in" id="planNotes" placeholder="Context, stakeholders, risks, next steps…" oninput="setPlanNotes('${id}',this.value)">${esc(p.notes||'')}</textarea>
    </div>
    <div class="row-actions">
      <button class="btn" onclick="regenPlan('${id}')">Regenerate from template</button>
      <button class="btn" onclick="delPlan('${id}')" style="border-color:var(--red);color:var(--red)">Delete plan</button>
      <button class="btn primary" onclick="openAcct('${id}')">Open account 360</button>
    </div>
  </div>`;
  showOverlay();
}
function msRow(id,m){
  const rc=(m.resources||[]).length;
  return `<div class="milestone${m.done?' done':''}" data-ms="${m.id}">
    <input type="checkbox" ${m.done?'checked':''} onchange="togglePlanMs('${id}','${m.id}',this.checked)">
    <input type="text" value="${esc(m.title)}" onchange="editPlanMsTitle('${id}','${m.id}',this.value)">
    <input type="date" value="${esc(m.due||'')}" onchange="editPlanMsDue('${id}','${m.id}',this.value)">
    <button class="btn sm" onclick="openPlanStep('${id}','${m.id}')">Open${rc?` · ${rc}`:''}</button>
    <button class="btn sm" onclick="removePlanMs('${id}','${m.id}')">Remove</button>
  </div>`;
}
// ---- Plan step detail (click into a milestone) ----
const STEP_RES_KINDS={email:'Email template',talktrack:'Talk track',resource:'Resource'};
function resourceById(rid){ return resources.find(r=>r.id===rid); }
function stepResLabel(r){
  if(r.kind==='email'){ const t=EMAIL_TEMPLATES.find(x=>x.id===r.id); return t?t.name:'Email template'; }
  if(r.kind==='talktrack'){ const t=talkTrackById(r.id); return t?t.title:'Talk track'; }
  const res=resourceById(r.id); return res?res.title:'Resource';
}
function openPlanStep(id,mid){
  const p=plans[id]; const a=STATE.accounts.find(x=>x.id===id); if(!p||!a) return;
  const m=p.milestones.find(x=>x.id===mid); if(!m){ openPlan(id); return; }
  m.resources=m.resources||[];
  const overdue=!m.done && daysSince(m.due)!=null && daysSince(m.due)>0;
  const resRows=m.resources.length?m.resources.map((r,i)=>{
    let action='';
    if(r.kind==='email') action=`<button class="btn primary sm" onclick="planStepEmail('${id}','${r.id}')">Draft email</button>`;
    else if(r.kind==='talktrack') action=`<button class="btn sm" onclick="openTalkTrack('${r.id}','${id}','${mid}')">Open talk track</button>`;
    else { const res=resourceById(r.id); action=res?`<a class="btn sm" href="${esc(res.url)}" target="_blank" rel="noopener">Open</a>`:'<span class="mini">missing</span>'; }
    return `<div class="resrow"><span><span class="pill p-gray" style="margin-right:8px">${esc(STEP_RES_KINDS[r.kind]||r.kind)}</span><b>${esc(stepResLabel(r))}</b></span><span class="row-actions">${action}<button class="btn sm" onclick="removeStepResource('${id}','${mid}',${i})">✕</button></span></div>`;
  }).join(''):'<p class="mini">No resources attached yet — add an email template, talk track or resource below.</p>';
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2>${esc(m.title)}</h2><div class="mini">Success plan step · ${esc(a.name)} · <span class="pill ${m.done?'p-green':overdue?'p-red':'p-amber'}">${m.done?'Complete':overdue?'Overdue':(m.due?'Due '+esc(m.due):'Open')}</span></div></div><button class="x" onclick="closeSheet()">✕</button></div>
  <div class="bd">
    <div class="row-actions" style="margin-bottom:14px">
      <button class="btn" onclick="openPlan('${id}')">← Back to plan</button>
      <button class="btn ${m.done?'':'primary'}" onclick="togglePlanStepDone('${id}','${mid}',${!m.done})">${m.done?'Mark not done':'Mark done'}</button>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Step details</h3>
      <label class="mini" style="font-weight:700;color:var(--ink);display:block;margin:8px 0 4px">Title</label>
      <input type="text" value="${esc(m.title)}" onchange="editPlanMsTitle('${id}','${mid}',this.value)" style="width:100%;border:1px solid var(--line);padding:8px 10px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
      <label class="mini" style="font-weight:700;color:var(--ink);display:block;margin:12px 0 4px">Due</label>
      <input type="date" value="${esc(m.due||'')}" onchange="editPlanMsDue('${id}','${mid}',this.value)" style="border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink);color-scheme:dark">
      <label class="mini" style="font-weight:700;color:var(--ink);display:block;margin:12px 0 4px">Guidance</label>
      <textarea class="notes-in" style="min-height:60px" placeholder="What this step involves…" oninput="setStepDetail('${id}','${mid}',this.value)">${esc(m.detail||'')}</textarea>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Resources for this step <span class="hint">email templates, talk tracks &amp; guides — act on them right here</span></h3>
      <div class="reslist">${resRows}</div>
      <div class="row-actions" style="margin-top:12px;flex-wrap:wrap;align-items:center">
        <select class="select" id="stepResPick">
          <optgroup label="Email templates">${EMAIL_TEMPLATES.map(t=>`<option value="email:${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>
          <optgroup label="Talk tracks">${TALK_TRACKS.map(t=>`<option value="talktrack:${t.id}">${esc(t.title)}</option>`).join('')}</optgroup>
          <optgroup label="Resource library">${resources.map(r=>`<option value="resource:${r.id}">${esc(r.title)}</option>`).join('')}</optgroup>
        </select>
        <button class="btn primary sm" onclick="addStepResourceFromPicker('${id}','${mid}')">Attach</button>
      </div>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Step notes <span class="hint">what happened / what's next on this step</span></h3>
      <textarea class="notes-in" placeholder="Progress, blockers, who owns the next action…" oninput="setStepNote('${id}','${mid}',this.value)">${esc(m.note||'')}</textarea>
    </div>
  </div>`;
  showOverlay();
}
function setStepDetail(id,mid,v){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m){ m.detail=v; touchPlan(id); } }
function setStepNote(id,mid,v){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m){ m.note=v; touchPlan(id); } }
function togglePlanStepDone(id,mid,done){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m){ m.done=done; touchPlan(id); openPlanStep(id,mid); } }
function addStepResource(id,mid,kind,refId){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(!m)return; m.resources=m.resources||[]; if(m.resources.some(r=>r.kind===kind&&r.id===refId)){ toast('Already attached to this step.'); return; } m.resources.push({kind,id:refId}); touchPlan(id); openPlanStep(id,mid); }
function addStepResourceFromPicker(id,mid){ const sel=document.getElementById('stepResPick'); if(!sel||!sel.value) return; const [kind,refId]=sel.value.split(':'); addStepResource(id,mid,kind,refId); }
function removeStepResource(id,mid,idx){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(!m||!m.resources)return; m.resources.splice(idx,1); touchPlan(id); openPlanStep(id,mid); }
function planStepEmail(id,templateId){ const p=plans[id]; if(!p) return; closeSheet(); startEmailCompose(templateId,p.acctId); toast('Draft ready on Email Outreach — review, then send from your mail app.'); }
function openTalkTrack(ttId,backId,backMid){
  const t=talkTrackById(ttId); if(!t){ toast('Talk track not found.'); return; }
  const sheet=$('#sheet');
  const back=backId?`<button class="btn" onclick="openPlanStep('${backId}','${backMid}')">← Back to step</button>`:`<button class="btn" onclick="closeSheet()">Close</button>`;
  sheet.innerHTML=`<div class="hd"><div><h2>${esc(t.title)}</h2><div class="mini">Talk track · ${esc(t.scenario)}</div></div><button class="x" onclick="closeSheet()">✕</button></div>
  <div class="bd">
    <div class="row-actions" style="margin-bottom:14px">${back}<button class="btn primary" onclick="copyTalkTrack('${ttId}')">Copy script</button></div>
    <div class="card" style="box-shadow:none;margin:0"><pre style="white-space:pre-wrap;font:inherit;margin:0;color:var(--ink)">${esc(t.script)}</pre></div>
  </div>`;
  showOverlay();
}
async function copyTalkTrack(ttId){ const t=talkTrackById(ttId); if(!t) return; try{ await navigator.clipboard.writeText(t.title+'\n\n'+t.script); toast('Talk track copied.'); }catch(e){ toast('Could not copy — select the text manually.'); } }
function regenPlanAs(id,type){ if(!PLAN_TEMPLATES[type]) return; if(!confirm('Rebuild this plan from the '+PLAN_TEMPLATES[type].label+' template? Your edits to milestones, objectives and notes will be replaced.')) { openPlan(id); return; } delete plans[id]; generatePlan(id,type); openPlan(id); toast('Plan rebuilt from the '+PLAN_TEMPLATES[type].label+' template.'); }
function touchPlan(id){ if(plans[id]){ plans[id].updatedAt=new Date().toISOString(); savePlans(); } }
function setPlanObjectives(id,v){ if(!plans[id])return; plans[id].objectives=v.split('\n').map(s=>s.trim()).filter(Boolean); touchPlan(id); }
function setPlanNotes(id,v){ if(!plans[id])return; plans[id].notes=v; touchPlan(id); }
function togglePlanMs(id,mid,done){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m)m.done=done; touchPlan(id); openPlan(id); }
function editPlanMsTitle(id,mid,v){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m)m.title=v; touchPlan(id); }
function editPlanMsDue(id,mid,v){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m)m.due=v; touchPlan(id); openPlan(id); }
function addPlanMs(id){ const p=plans[id];if(!p)return; p.milestones.push({id:'m'+Math.random().toString(36).slice(2,9),title:'New milestone',due:sfDate(new Date(Date.now()+14*864e5)),done:false}); touchPlan(id); openPlan(id); }
function removePlanMs(id,mid){ const p=plans[id];if(!p)return; p.milestones=p.milestones.filter(x=>x.id!==mid); touchPlan(id); openPlan(id); }
function regenPlan(id){ if(!confirm('Regenerate this plan from the template? Your edits to milestones, objectives and notes will be replaced.')) return; delete plans[id]; generatePlan(id); openPlan(id); toast('Plan regenerated from template.'); }
function delPlan(id){ if(!confirm('Delete this success plan? This cannot be undone.')) return; delete plans[id]; savePlans(); closeSheet(); route(); }

// ---- Worklist ----
function viewWork(accts){
  const items=[];
  accts.forEach(a=>{
    const st=a.opps[0]?a.opps[0].stage:'';
    if(a.dclose<=90 && EARLY.has(st)) items.push({p:1,a,label:`Renewal closes in ${a.dclose}d but still "${st}" — advance the deal`,tag:'Renewal at risk',bucket:a.dclose<=0?'overdue':'upcoming'});
    if(a.highCases>0) items.push({p:2,a,label:`${a.highCases} high/urgent support case(s) open — coordinate resolution`,tag:'Support escalation',bucket:'overdue'});
    const ns=nextStepOpen(a.id);
    if(ns){
      const overdue=nextStepOverdue(ns);
      const isNew=ns.updatedAt && daysSince(ns.updatedAt)!=null && daysSince(ns.updatedAt)<=1;
      items.push({p:overdue?1:2,a,label:`Next step: ${ns.text}${ns.due?` (due ${ns.due})`:''}`,tag:overdue?'Next step overdue':'Next step',bucket:overdue?'overdue':(isNew?'new':'upcoming')});
    }
    if(newLogo(a) && !plans[a.id]){ const ds=daysSince(a.firstPurchase); items.push({p:2,a,label:`New logo (first purchase ${a.firstPurchase}) with no success plan — generate one`,tag:'Onboard',bucket:(ds!=null&&ds<=14)?'new':'upcoming'}); }
    if(a.sentTier==='neg') items.push({p:3,a,label:`Strained sentiment (${a.sentiment}) from support history — proactively check in`,tag:'Sentiment risk',bucket:'upcoming'});
    if(a.tier==='atrisk' && a.renewalAmount>1e6) items.push({p:3,a,label:`At-risk account with ${fmtMoney(a.renewalAmount)} renewal — build a save play`,tag:'Save play',bucket:'upcoming'});
    if(a.dclose<=180 && a.dclose>90 && a.tier!=='healthy') items.push({p:4,a,label:`Renewal in ${a.dclose}d, health ${a.health} — start early engagement`,tag:'Get ahead',bucket:'upcoming'});
  });
  items.sort((x,y)=> x.p-y.p || y.a.riskARR-x.a.riskARR);
  const overdue=items.filter(it=>it.bucket==='overdue');
  const freshItems=items.filter(it=>it.bucket==='new');
  const upcoming=items.filter(it=>it.bucket==='upcoming');
  const rows=list=>`<table><thead><tr><th>Priority action</th><th>Account</th><th>Owner</th><th class="num">Total Contract Value</th><th>Health</th></tr></thead><tbody>
    ${list.slice(0,50).map(it=>`<tr onclick="openAcct('${it.a.id}')"><td><span class="pill ${it.p<=2?'p-red':it.p===3?'p-amber':'p-gray'}">${esc(it.tag)}</span> ${esc(it.label)}</td><td><b>${esc(it.a.name)}</b> ${stateTag(it.a)}</td><td>${ownerCell(it.a.ownerName)}</td><td class="num">${fmtMoney(it.a.renewalAmount)}</td><td>${healthCell(it.a.health)}</td></tr>`).join('')}
    </tbody></table>`;
  const section=(title,hint,list)=> list.length?`<h3 style="margin-top:18px">${esc(title)} <span class="hint">${esc(hint)}</span></h3>${rows(list)}`:'';
  return `<div class="card"><h3>Prioritized worklist <span class="hint">${items.length} actions across scope · grouped overdue → new → upcoming, ranked by urgency then revenue within each</span></h3>
  <div class="kpis" style="margin-bottom:4px">
    <div class="kpi"><div class="l">Overdue</div><div class="v" style="color:var(--red)">${overdue.length}</div><div class="d">already past due — clear these first</div></div>
    <div class="kpi"><div class="l">New</div><div class="v" style="color:var(--amber)">${freshItems.length}</div><div class="d">surfaced in the last day or two</div></div>
    <div class="kpi"><div class="l">Upcoming</div><div class="v">${upcoming.length}</div><div class="d">on the radar, not yet urgent</div></div>
  </div>
  ${section('Overdue','clear these first',overdue)}
  ${section('New','freshly surfaced',freshItems)}
  ${section('Upcoming',"worth getting ahead of",upcoming)}
  ${items.length?'':'<p class="mini">Clear queue — nothing urgent in this scope.</p>'}</div>`;
}

// ---- Health model ----
function viewModel(accts){
  const sl=(k,l,max)=>`<div class="slider"><label>${l}</label><input type="range" min="0" max="${max}" step="1" value="${WEIGHTS[k]}" oninput="setWeight('${k}',this.value,this)"><span id="w_${k}">${WEIGHTS[k]}</span></div>`;
  const r=rollup(accts);
  return `<div class="card callout"><h3 style="border:none;margin:0 0 8px">A note on health scores</h3>
  <p class="mini" style="line-height:1.7">"I'm not a fan of health scores... health scores are not what they're cracked up to be." A single 0–100 number is easy to game and easy to misread — it's kept here for continuity and as one input among several, but it is intentionally <b>not</b> the headline metric anymore. The Home and Command Center views now lead with engagement, growth and customer insights instead. Use this tab to tune the score if it's still useful to your team, or largely ignore it in favor of the CSM Scorecard, Case Watch and Engagement tabs.</p>
  </div>
  <div class="card"><h3>Health-score model <span class="hint">CS Ops owns this — adjust weights and the whole book re-scores instantly</span></h3>
  <p class="mini">Every account starts at 100. These penalties subtract from it based on live signals. This transparency is the point: the score is never a black box.</p>
  ${sl('openCase','Per open case',5)}
  ${sl('highSev','Per high/urgent case',15)}
  ${sl('proxNear','Renewal ≤90 days',40)}
  ${sl('proxMid','Renewal ≤180 days',30)}
  ${sl('stageRisk','Near renewal, early stage',30)}
  ${sl('engage','Stale engagement (no touch 90d+)',30)}
  <div style="margin-top:14px" class="row-actions"><button class="btn primary" onclick="saveWeights()">Save model</button><button class="btn" onclick="resetWeights()">Reset defaults</button></div>
  <p class="mini" style="margin-top:14px">Current scope re-scored: <b>${r.green}</b> healthy · <b>${r.amber}</b> watch · <b>${r.red}</b> at risk · avg <b>${r.health}</b>.</p>
  <p class="mini" style="margin-top:10px;color:var(--muted)">Note: sentiment and CSAT are computed separately and are not affected by these health weights.</p>
  </div>`;
}
function setWeight(k,v,el){ WEIGHTS[k]=+v; document.getElementById('w_'+k).textContent=v; computeAll(); const p=el.closest('.card').querySelectorAll('.mini'); const r=rollup(accountsUnder(STATE.scope)); if(p.length) p[p.length-2].innerHTML=`Current scope re-scored: <b>${r.green}</b> healthy · <b>${r.amber}</b> watch · <b>${r.red}</b> at risk · avg <b>${r.health}</b>.`; }
function saveWeights(){ LS.set('weights',WEIGHTS); toast('Model saved — applies every time you open this dashboard.'); }
function resetWeights(){ WEIGHTS=Object.assign({},DEFAULT_WEIGHTS); LS.set('weights',WEIGHTS); computeAll(); route(); }

// ---- CSM Scorecard ----
// Modeled directly on the 4 metrics an enterprise CS org is actually run on, per
// CS-leadership guidance (see NOTES.md): customer insights, engagement rate, and
// growth split into organic/renewal, expansion, and transactional.
function csmMetrics(accts){
  const byOwner={};
  accts.forEach(a=>{
    const key=a.ownerName||'Unassigned';
    const o=byOwner[key]=byOwner[key]||{name:key,n:0,inCadence:0,growth:{Renewal:0,Expansion:0,Transactional:0},insights:0,arr:0,accts:[]};
    o.n++; o.arr+=a.renewalAmount; o.accts.push(a);
    if(cadenceInfo(a).tier==='green') o.inCadence++;
    const g=a.growth||{}; o.growth.Renewal+=g.Renewal||0; o.growth.Expansion+=g.Expansion||0; o.growth.Transactional+=g.Transactional||0;
    o.insights += insightCountSince(a.id,90);
  });
  return Object.values(byOwner).map(o=>{
    o.engagementPct=o.n?Math.round(o.inCadence/o.n*100):0;
    o.growthTotal=o.growth.Renewal+o.growth.Expansion+o.growth.Transactional;
    o.npsR=npsRollup(o.accts);
    o.stale=csmStaleWork(o.name);
    return o;
  }).sort((a,b)=>b.arr-a.arr);
}

// ---- Manager drill-down on stale/overdue work (Leana's ask: "a leader should be
// able to see exactly where a CSM is stuck, e.g. 7 tasks 6 months overdue") ----
function csmStaleWork(ownerName){
  const acctIds=new Set(STATE.accounts.filter(a=>a.ownerName===ownerName).map(a=>a.id));
  const items=[];
  ctas.forEach(c=>{
    if(c.status==='Done' || !c.acctId || !acctIds.has(c.acctId)) return;
    const overdue=daysSince(c.due);
    if(overdue!=null && overdue>0) items.push({type:'CTA',acctId:c.acctId,acctName:c.name,title:c.title,overdue,ctaId:c.id});
  });
  Object.keys(plans).forEach(pid=>{
    const p=plans[pid]; if(!acctIds.has(p.acctId)) return;
    (p.milestones||[]).forEach(m=>{
      if(m.done) return;
      const overdue=daysSince(m.due);
      if(overdue!=null && overdue>0){
        const a=STATE.accounts.find(x=>x.id===p.acctId);
        items.push({type:'Milestone',acctId:p.acctId,acctName:a?a.name:'',title:m.title,overdue,planId:p.acctId});
      }
    });
  });
  items.sort((x,y)=>y.overdue-x.overdue);
  return items;
}
// Build concrete improve-steps when a CSM is below target on any scorecard metric.
// Each step includes a one-click jump into the right tab/account so reps can act
// immediately instead of only seeing a red progress bar.
function csmTargetPct(actual, target){ return target ? Math.round((actual||0)/target*100) : 100; }
function csmImproveSteps(o){
  const steps=[];
  const engPct=csmTargetPct(o.engagementPct, scoreTargets.engagementPct);
  const insPct=csmTargetPct(o.insights, scoreTargets.insightsPerCsm);
  const grPct=csmTargetPct(o.growthTotal, scoreTargets.growthPerCsm);
  const outCadence=o.accts.filter(a=>cadenceInfo(a).tier==='red').sort((a,b)=>(b.dsAct||0)-(a.dsAct||0));
  const noInsights=o.accts.filter(a=>insightCountSince(a.id,90)===0).sort((a,b)=>b.renewalAmount-a.renewalAmount);
  const atRisk=o.accts.filter(a=>a.tier==='atrisk'||a.tier==='watch').sort((a,b)=>b.riskARR-a.riskARR);
  const detractors=o.accts.filter(a=>a.nps!=null&&a.nps<=6).sort((a,b)=>a.nps-b.nps);
  const renewSoon=o.accts.filter(a=>a.dclose<=180).sort((a,b)=>a.dclose-b.dclose);

  if(engPct<100){
    const focus=outCadence[0];
    steps.push({
      key:'engagement', metric:'Engagement', sev:engPct<60?'high':engPct<85?'med':'low',
      title: outCadence.length
        ? `Book ${outCadence.length} outreach touch${outCadence.length===1?'':'es'} on out-of-cadence accounts`
        : `Lift engagement from ${o.engagementPct}% toward the ${scoreTargets.engagementPct}% target`,
      detail: focus
        ? `Start with ${focus.name} (${focus.dsAct!=null?focus.dsAct+'d since last touch':'no activity on file'}). Log the call on Account 360 so cadence updates.`
        : `Filter to this CSM's book on Engagement and work the due-soon queue before it turns red.`,
      btn: focus ? 'Log activity on account' : 'Open Engagement',
      action: focus ? `acct:${focus.id}` : 'tab:engagement'
    });
  }
  if(insPct<100){
    const focus=noInsights[0]||o.accts[0];
    steps.push({
      key:'insights', metric:'Insights', sev:insPct<60?'high':insPct<85?'med':'low',
      title: `Log ${Math.max(1, (scoreTargets.insightsPerCsm||0)-o.insights)} customer insight${((scoreTargets.insightsPerCsm||0)-o.insights)===1?'':'s'} this week`,
      detail: focus
        ? `${o.insights} of ${scoreTargets.insightsPerCsm} target in 90 days. Capture what you're learning on ${focus.name} (Account 360 → Customer insights).`
        : `Insights roll into this scorecard — write down what you're learning after each meaningful conversation.`,
      btn: focus ? 'Open account to log insight' : 'Open book',
      action: focus ? `acct:${focus.id}` : 'tab:overview'
    });
  }
  if(grPct<100){
    const focus=renewSoon[0]||atRisk[0];
    steps.push({
      key:'growth', metric:'Growth', sev:grPct<60?'high':grPct<85?'med':'low',
      title: focus && focus.dclose<=180
        ? `Advance the ${focus.name} renewal (${focus.dclose}d out) and look for expansion`
        : `Build a growth plan — currently ${fmtMoney(o.growthTotal)} vs ${fmtMoney(scoreTargets.growthPerCsm)} target`,
      detail: `Review renewals in the next 180 days for upsell (expansion) or more of the same (transactional). Pair value recaps with the Renewal Recap resource.`,
      btn: focus ? 'Open renewal account' : 'Open Renewals',
      action: focus ? `acct:${focus.id}` : 'tab:renewals'
    });
  }
  const npsR=o.npsR;
  if(!npsR || !npsR.n || npsR.score<20 || (npsR.detractors>0 && npsR.detractors>=npsR.promoters)){
    const focus=detractors[0];
    steps.push({
      key:'nps', metric:'NPS', sev:(!npsR||!npsR.n||npsR.score<0)?'high':'med',
      title: focus
        ? `Save play for NPS detractor — ${focus.name} scored ${focus.nps}/10`
        : (!npsR||!npsR.n) ? 'Drive survey response coverage on this book' : `Improve NPS rollup (currently ${npsR.score})`,
      detail: focus
        ? `Schedule an executive check-in, document blockers, and log the next step on the account. Detractors drag the book score and often signal churn risk.`
        : `Confirm recent survey outreach and follow up with accounts that haven't responded.`,
      btn: focus ? 'Open detractor account' : 'Open book',
      action: focus ? `acct:${focus.id}` : 'tab:overview'
    });
  }
  if(o.stale.length){
    const worst=o.stale[0];
    steps.push({
      key:'overdue', metric:'Overdue work', sev:worst.overdue>90?'high':worst.overdue>30?'med':'low',
      title: `Clear ${o.stale.length} overdue CTA${o.stale.length===1?'':'s'}/milestone${o.stale.length===1?'':'s'} (worst ${worst.overdue}d)`,
      detail: `Start with "${worst.title}" on ${worst.acctName||'an account'} — complete it, reschedule with a real date, or escalate if blocked.`,
      btn: 'Jump to worst item',
      action: worst.type==='CTA' ? `acct:${worst.acctId}` : `plan:${worst.planId}`
    });
  }
  // Severity order: high → med → low
  const rank={high:0,med:1,low:2};
  steps.sort((a,b)=>(rank[a.sev]-rank[b.sev]));
  return steps;
}
function csmNeedsImprove(o){ return csmImproveSteps(o).some(s=>s.sev==='high'||s.sev==='med'); }
function runCsmImproveAction(name, action){
  closeSheet();
  setOwnerFilter(name);
  setTimeout(()=>{
    if(action.startsWith('tab:')) setTab(action.slice(4));
    else if(action.startsWith('acct:')) openAcct(action.slice(5));
    else if(action.startsWith('plan:')) openPlan(action.slice(5));
  }, 40);
}
function openCsmDrilldown(name){ openCsmImprove(name); }
function openCsmImprove(name){
  const rows=csmMetrics(STATE.accounts.filter(a=>!ownerFilter||a.ownerName===ownerFilter||a.ownerName===name));
  // Prefer the CSM's full book for coaching, not just current org-scope filter quirks
  const allForCsm=csmMetrics(STATE.accounts.filter(a=>a.ownerName===name))[0]
    || rows.find(r=>r.name===name)
    || csmMetrics(accountsUnder(STATE.scope)).find(r=>r.name===name);
  if(!allForCsm){ toast('Could not load coaching plan for that CSM.'); return; }
  const o=allForCsm;
  const steps=csmImproveSteps(o);
  const items=o.stale||csmStaleWork(name);
  const engPct=csmTargetPct(o.engagementPct, scoreTargets.engagementPct);
  const insPct=csmTargetPct(o.insights, scoreTargets.insightsPerCsm);
  const grPct=csmTargetPct(o.growthTotal, scoreTargets.growthPerCsm);
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2 style="display:flex;align-items:center;gap:10px">${avatarChip(name)} Improve plan — ${esc(name)}</h2><div class="mini">${o.n} accounts · Engagement ${o.engagementPct}% · Insights ${o.insights} · Growth ${fmtMoney(o.growthTotal)} · ${steps.length?steps.length+' action'+(steps.length===1?'':'s'):'on track'}</div></div><button class="x" onclick="closeSheet()">✕</button></div>
  <div class="bd">
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Score vs target</h3>
      <div class="comp" style="grid-template-columns:1fr auto">
        <div>Engagement</div><div>${o.engagementPct}% / ${scoreTargets.engagementPct}% ${targetBar(engPct)}</div>
        <div>Insights (90d)</div><div>${o.insights} / ${scoreTargets.insightsPerCsm} ${targetBar(insPct)}</div>
        <div>Growth</div><div>${fmtMoney(o.growthTotal)} / ${fmtMoney(scoreTargets.growthPerCsm)} ${targetBar(grPct)}</div>
        <div>NPS</div><div>${npsRollupPill(o.npsR)}</div>
        <div>Overdue items</div><div>${items.length?`<span class="pill ${items[0].overdue>90?'p-red':'p-amber'}">${items.length}</span>`:'<span class="pill p-green">0</span>'}</div>
      </div>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Actionable steps to improve <span class="hint">${steps.length? 'prioritized by impact':'no gaps vs current targets'}</span></h3>
      ${steps.length?`<div class="improve-list">${steps.map(s=>`<div class="improve-step ${s.sev}">
        <div class="improve-meta"><span class="pill ${s.sev==='high'?'p-red':s.sev==='med'?'p-amber':'p-gray'}">${esc(s.metric)}</span></div>
        <div class="improve-body"><b>${esc(s.title)}</b><p class="mini">${esc(s.detail)}</p>
          <div class="row-actions" style="margin-top:8px"><button class="btn primary sm" onclick="runCsmImproveAction('${attrStr(name)}','${attrStr(s.action)}')">${esc(s.btn)}</button></div>
        </div>
      </div>`).join('')}</div>`
      :`<p class="mini">This CSM is at or above target on engagement, insights, and growth, with no overdue CTAs/milestones and a healthy NPS signal. Keep the cadence going.</p>`}
    </div>
    <div class="card" style="box-shadow:none"><h3>Overdue items <span class="hint">CTAs &amp; Success Plan milestones past due</span></h3>
    <table><thead><tr><th>Type</th><th>Account</th><th>Item</th><th class="num">Overdue</th><th></th></tr></thead><tbody>
    ${items.map(it=>`<tr><td><span class="pill ${it.overdue>90?'p-red':it.overdue>30?'p-amber':'p-gray'}">${it.type}</span></td><td>${esc(it.acctName||'')}</td><td>${esc(it.title||'')}</td><td class="num"><b>${it.overdue}d</b></td><td><button class="btn sm" onclick="closeSheet();setTimeout(()=>${it.type==='CTA'?`openAcct('${it.acctId}')`:`openPlan('${it.planId}')`},50)">Open</button></td></tr>`).join('')}
    </tbody></table>
    ${items.length?'':'<p class="mini">Nothing overdue — clean book.</p>'}
    </div>
  </div>`;
  showOverlay();
}
function targetBar(pct){ const p=Math.max(0,Math.min(100,Math.round(pct||0))); const c=p>=100?'var(--green)':p>=60?'var(--amber)':'var(--red)'; return `<div class="progress" style="width:90px;display:inline-block;vertical-align:middle;margin-left:8px"><i style="width:${p}%;background:${c}"></i></div>`; }
function viewScorecard(accts){
  const rows=csmMetrics(accts).map(o=>{ o.steps=csmImproveSteps(o); o.needsImprove=csmNeedsImprove(o); return o; });
  const needing=rows.filter(o=>o.needsImprove);
  return `<div class="card"><h3>CSM Scorecard <span class="hint">4 metrics an enterprise CS org is actually run on, per CS-leadership guidance</span></h3>
  <p class="mini" style="line-height:1.7">Customer insights, engagement rate, and growth — split into <b>organic/renewal</b>, <b>expansion</b> (net-new product attach) and <b>transactional</b> (more of what they already have) — rather than one lump health score. Targets below are editable and apply to every CSM; progress bars show actual vs. target. Click <b>Improve</b> on any row for concrete next steps.</p>
  <div class="row-actions" style="margin:12px 0 4px;flex-wrap:wrap;gap:14px">
    <label class="mini">Engagement target %<br><input type="number" min="0" max="100" value="${scoreTargets.engagementPct}" style="width:70px;margin-top:4px;border:1px solid var(--line);padding:6px 8px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setTarget('engagementPct',this.value)"></label>
    <label class="mini">Growth target $ / CSM<br><input type="number" min="0" step="5000" value="${scoreTargets.growthPerCsm}" style="width:110px;margin-top:4px;border:1px solid var(--line);padding:6px 8px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setTarget('growthPerCsm',this.value)"></label>
    <label class="mini">Insights target / CSM (90d)<br><input type="number" min="0" value="${scoreTargets.insightsPerCsm}" style="width:70px;margin-top:4px;border:1px solid var(--line);padding:6px 8px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setTarget('insightsPerCsm',this.value)"></label>
  </div></div>

  ${surveyCoverageCard(accts)}

  ${needing.length?`<div class="card"><h3>Reps needing attention <span class="hint">${needing.length} below target — top action for each</span></h3>
  <div class="improve-list">${needing.map(o=>{ const top=o.steps[0]; return `<div class="improve-step ${top.sev}">
    <div class="improve-meta">${avatarChip(o.name)} <b>${esc(o.name)}</b><div class="mini" style="margin-top:4px">${o.steps.length} step${o.steps.length===1?'':'s'}</div></div>
    <div class="improve-body"><span class="pill ${top.sev==='high'?'p-red':top.sev==='med'?'p-amber':'p-gray'}">${esc(top.metric)}</span> <b>${esc(top.title)}</b>
      <div class="row-actions" style="margin-top:8px">
        <button class="btn primary sm" onclick="runCsmImproveAction('${attrStr(o.name)}','${attrStr(top.action)}')">${esc(top.btn)}</button>
        <button class="btn sm" onclick="openCsmImprove('${attrStr(o.name)}')">Full improve plan</button>
      </div>
    </div>
  </div>`; }).join('')}</div>
  </div>`:''}

  <div class="card"><h3>All CSMs in scope</h3>
  <table><thead><tr><th>CSM</th><th class="num">Accounts</th><th class="num">Engagement</th><th class="num">Insights (90d)</th><th class="num">NPS</th><th class="num">Renewal (organic)</th><th class="num">Expansion</th><th class="num">Transactional</th><th class="num">Total growth</th><th class="num">Overdue</th><th></th></tr></thead><tbody>
  ${rows.map(o=>`<tr style="cursor:default"><td>${ownerCell(o.name)}</td><td class="num">${o.n}</td><td class="num">${o.engagementPct}%${targetBar(o.engagementPct/(scoreTargets.engagementPct||1)*100)}</td><td class="num">${o.insights}${targetBar(o.insights/(scoreTargets.insightsPerCsm||1)*100)}</td><td class="num">${npsRollupPill(o.npsR)}</td><td class="num">${fmtMoney(o.growth.Renewal)}</td><td class="num">${fmtMoney(o.growth.Expansion)}</td><td class="num">${fmtMoney(o.growth.Transactional)}</td><td class="num"><b>${fmtMoney(o.growthTotal)}</b>${targetBar(o.growthTotal/(scoreTargets.growthPerCsm||1)*100)}</td><td class="num">${o.stale.length?`<span class="pill clickable ${o.stale[0].overdue>90?'p-red':'p-amber'}" onclick="openCsmImprove('${attrStr(o.name)}')" title="Open improve plan">${o.stale.length}</span>`:'<span class="pill p-gray">0</span>'}</td><td>${o.needsImprove||o.steps.length?`<button class="btn ${o.needsImprove?'primary':'sm'} sm" onclick="openCsmImprove('${attrStr(o.name)}')">${o.needsImprove?'Improve':'Plan'}</button>`:`<span class="pill p-green">On track</span>`}</td></tr>`).join('')}
  </tbody></table>
  ${rows.length?'':'<p class="mini">No CSMs with accounts in this scope.</p>'}
  <p class="mini" style="margin-top:12px;color:var(--muted)">Below-target metrics generate an improve plan with concrete next steps (book outreach, log insights, advance renewals, save NPS detractors, clear overdue work). Click <b>Improve</b> for the full plan, or run the top action from the attention list above.</p>
  </div>`;
}

// ---- Engagement (outreach cadence) ----
// Required outreach cadence varies by book segment (Strategic/Enterprise/Mid-Market/
// SMB) — the CS-leadership "Today View" surfaces logos falling out of cadence first,
// since that is the single most time-sensitive thing a CSM needs to see each day.
let engKpiFilter=null; // null | 'out' | 'due' | 'in' — set by clicking a KPI tile
function setEngKpi(k){ engKpiFilter = engKpiFilter===k?null:k; route(); }
function viewEngagement(accts){
  const rows=accts.map(a=>({a,c:cadenceInfo(a)}));
  const outCount=rows.filter(r=>r.c.tier==='red').length;
  const dueCount=rows.filter(r=>r.c.tier==='amber').length;
  const inCount=rows.length-outCount-dueCount;
  const bySeg={};
  rows.forEach(r=>{ const seg=r.a.segment||'Mid-Market'; bySeg[seg]=bySeg[seg]||{n:0,in:0}; bySeg[seg].n++; if(r.c.tier==='green') bySeg[seg].in++; });
  const segRows=Object.keys(SEGMENT_CADENCE).filter(s=>bySeg[s]).map(s=>({seg:s,...bySeg[s],req:SEGMENT_CADENCE[s]}));
  let sorted=[...rows].sort((x,y)=>{ const xo=x.c.ds==null?99999:(x.c.ds-x.c.req); const yo=y.c.ds==null?99999:(y.c.ds-y.c.req); return yo-xo; });
  if(engKpiFilter==='out') sorted=sorted.filter(r=>r.c.tier==='red');
  else if(engKpiFilter==='due') sorted=sorted.filter(r=>r.c.tier==='amber');
  else if(engKpiFilter==='in') sorted=sorted.filter(r=>r.c.tier==='green');
  const kpis=[
    ['Out of cadence',outCount,'need outreach now','out'],
    ['Due soon',dueCount,'approaching their cadence window','due'],
    ['In cadence',inCount,'of '+rows.length+' accounts','in'],
  ];
  return `<div class="card"><h3>Engagement cadence <span class="hint">required outreach cadence by book segment, per CS-leadership guidance</span></h3>
  <p class="mini">Strategic, Enterprise, Mid-Market and SMB accounts each carry a different required outreach cadence. An account falls out of cadence when nobody has logged a touch inside that window — the first thing to check each day, before it turns into a surprised customer.</p>
  <div class="kpis" style="margin:14px 0">${kpis.map(k=>`<div class="kpi clickable${/Out of/.test(k[0])?' accent':''}${engKpiFilter===k[3]?' selected':''}" onclick="setEngKpi('${k[3]}')"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  <table><thead><tr><th>Segment</th><th class="num">Required cadence</th><th class="num">In cadence</th><th class="num">Accounts</th></tr></thead><tbody>
  ${segRows.map(s=>`<tr style="cursor:default"><td><b>${esc(s.seg)}</b></td><td class="num">every ${s.req}d</td><td class="num">${s.in} (${Math.round(s.in/s.n*100)}%)</td><td class="num">${s.n}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="card"><h3>Accounts by cadence status <span class="hint">most overdue first${engKpiFilter?' · filtered — click the tile again to clear':''}</span></h3>
  <div class="searchbar"><input id="esearch" placeholder="Filter accounts…" oninput="filterTable(this,'etbl')"></div>
  <table id="etbl"><thead><tr><th>Account</th><th>Owner</th><th>Segment</th><th class="num">Last touch</th><th class="num">Required</th><th>Status</th></tr></thead><tbody>
  ${sorted.map(r=>`<tr onclick="openAcct('${r.a.id}')"><td><b>${esc(r.a.name)}</b> ${stateTag(r.a)}</td><td>${ownerCell(r.a.ownerName)}</td><td>${segmentPill(r.a)}</td><td class="num">${r.c.ds==null?'—':r.c.ds+'d ago'}</td><td class="num">every ${r.c.req}d</td><td>${cadencePill(r.a)}</td></tr>`).join('')}
  </tbody></table>${sorted.length?'':'<p class="mini">No accounts match this filter.</p>'}</div>`;
}

// ---- Case Watch (blocked vs. aging) ----
// Per CS-leadership guidance: of all open cases, blocked ("not happening") and
// aging ("open too long") are the two that need a CSM to jump on and escalate —
// left alone, either can block growth or trigger an executive-level complaint.
let caseKpiFilter=null; // null | 'blocked' | 'aging' — set by clicking a KPI tile
function setCaseKpi(k){ caseKpiFilter = caseKpiFilter===k?null:k; route(); }
function viewCaseWatch(accts){
  const withCases=accts.filter(a=>(a.casesBlocked||0)>0 || (a.casesAging||0)>0);
  const totalBlocked=accts.reduce((s,a)=>s+(a.casesBlocked||0),0);
  const totalAging=accts.reduce((s,a)=>s+(a.casesAging||0),0);
  let sorted=[...withCases].sort((x,y)=> (y.casesBlocked-x.casesBlocked) || (y.casesAging-x.casesAging));
  if(caseKpiFilter==='blocked') sorted=sorted.filter(a=>(a.casesBlocked||0)>0);
  else if(caseKpiFilter==='aging') sorted=sorted.filter(a=>(a.casesAging||0)>0);
  const kpis=[
    ['Blocked cases',totalBlocked,'not happening — escalate now','blocked'],
    ['Aging cases',totalAging,'open too long','aging'],
    ['Accounts affected',withCases.length,'of '+accts.length+' in scope',null],
  ];
  return `<div class="card"><h3>Case Watch <span class="hint">the two case signals worth escalating, per CS-leadership guidance — click a tile to filter</span></h3>
  <p class="mini">Of all open cases, two things need a CSM to jump on them: cases that are <b>blocked</b> (it's not happening) and cases that are <b>aging</b> (it's been open too long). Left unattended, either can block growth or send an executive escalation your way.</p>
  <div class="kpis" style="margin:14px 0">${kpis.map(k=>`<div class="kpi clickable${/Blocked/.test(k[0])?' accent':''}${caseKpiFilter===k[3]&&k[3]?' selected':''}" onclick="setCaseKpi(${k[3]?`'${k[3]}'`:'null'})"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  ${caseKpiFilter?`<p class="mini" style="margin:-4px 0 12px">Filtered to accounts with ${caseKpiFilter==='blocked'?'blocked':'aging'} cases · <a href="#" onclick="setCaseKpi('${caseKpiFilter}');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear filter</a></p>`:''}
  <table><thead><tr><th>Account</th><th>Owner</th><th class="num">Blocked</th><th class="num">Aging</th><th class="num">Total open</th><th>Health</th></tr></thead><tbody>
  ${sorted.map(a=>`<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td class="num">${a.casesBlocked?`<span class="pill p-red">${a.casesBlocked}</span>`:'—'}</td><td class="num">${a.casesAging?`<span class="pill p-amber">${a.casesAging}</span>`:'—'}</td><td class="num">${a.openCases}</td><td>${healthCell(a.health)}</td></tr>`).join('')}
  </tbody></table>
  ${sorted.length?'':'<p class="mini">Clear queue — no blocked or aging cases in this scope.</p>'}</div>`;
}

// ---- Usage & Adoption ----
// Beatrice (CSM): usage/adoption is the biggest gap in Gainsight — it lives in a
// separate Snowflake/Sigma world today. This tab brings it in one place, with the
// "adopting vs. not" cutoff and each account's progress toward its commission goal.
let usageKpiFilter=null; // null | 'adopting' | 'ramping' | 'low'
function setUsageKpi(k){ usageKpiFilter = usageKpiFilter===k?null:k; route(); }
function viewUsage(accts){
  const withU=accts.filter(a=>a.usage && a.usage.adoptionPct!=null);
  const noData=accts.length-withU.length;
  const adopting=withU.filter(a=>adoptionTier(a)==='adopting').length;
  const ramping=withU.filter(a=>adoptionTier(a)==='ramping').length;
  const low=withU.filter(a=>adoptionTier(a)==='low').length;
  const avgAdopt=withU.length?Math.round(withU.reduce((s,a)=>s+a.usage.adoptionPct,0)/withU.length):null;
  const commRows=withU.filter(a=>a.usage.commTarget);
  const targSum=commRows.reduce((s,a)=>s+a.usage.commTarget,0);
  const attSum=commRows.reduce((s,a)=>s+a.usage.commAttained,0);
  const commAttain=targSum?Math.round(attSum/targSum*100):null;
  let sorted=[...withU].sort((x,y)=>(x.usage.adoptionPct-y.usage.adoptionPct));
  if(usageKpiFilter) sorted=sorted.filter(a=>adoptionTier(a)===usageKpiFilter);
  const kpis=[
    ['Adopting',adopting,`≥ ${adoptionCfg.adoptingPct}% active`,'adopting'],
    ['Ramping',ramping,`${adoptionCfg.atRiskPct}–${adoptionCfg.adoptingPct}% active`,'ramping'],
    ['Not adopting',low,`< ${adoptionCfg.atRiskPct}% active — intervene`,'low'],
    ['Avg adoption',avgAdopt==null?'—':avgAdopt+'%',withU.length+' accounts with usage',null],
    ['Commission attainment',commAttain==null?'—':commAttain+'%',fmtMoney(attSum)+' of '+fmtMoney(targSum),null],
  ];
  return `<div class="card"><h3>Usage &amp; Adoption <span class="hint">product-analytics usage (Snowflake / Sigma), per CSM stakeholder guidance — click a tile to filter</span></h3>
  <p class="mini" style="line-height:1.7">The biggest gap CSMs called out: usage &amp; adoption data lives outside Gainsight (product-analytics Snowflake, surfaced via Sigma). This brings it in one place — active vs. licensed seats, adoption trend, and each account's progress toward its commission goal. What counts as <b>adopting vs. not</b> is a business rule, so it's editable below.</p>
  <div class="row-actions" style="margin:12px 0 4px;flex-wrap:wrap;gap:14px">
    <label class="mini">"Adopting" at/above %<br><input type="number" min="0" max="100" value="${adoptionCfg.adoptingPct}" style="width:80px;margin-top:4px;border:1px solid var(--line);padding:6px 8px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setAdoptionCfg('adoptingPct',this.value)"></label>
    <label class="mini">"Not adopting" below %<br><input type="number" min="0" max="100" value="${adoptionCfg.atRiskPct}" style="width:80px;margin-top:4px;border:1px solid var(--line);padding:6px 8px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setAdoptionCfg('atRiskPct',this.value)"></label>
    ${noData?`<span class="mini" style="align-self:flex-end;color:var(--muted)">${noData} account${noData===1?'':'s'} not yet in the usage export</span>`:''}
  </div>
  <div class="kpis" style="margin:14px 0 0">${kpis.map(k=>`<div class="kpi${k[3]?' clickable':''}${/Not adopting/.test(k[0])?' accent':''}${usageKpiFilter===k[3]&&k[3]?' selected':''}"${k[3]?` onclick="setUsageKpi('${k[3]}')"`:''}><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div></div>
  <div class="card"><h3>Accounts by adoption <span class="hint">lowest adoption first${usageKpiFilter?' · filtered — click the tile again to clear':''}</span></h3>
  <div class="searchbar"><input id="usearch" placeholder="Filter accounts…" oninput="filterTable(this,'utbl')"></div>
  <table id="utbl"><thead><tr><th>Account</th><th>Owner</th><th>Segment</th><th class="num">Adoption</th><th class="num">Active / Licensed</th><th class="num">Trend</th><th class="num">To goal</th><th class="num">Synced</th></tr></thead><tbody>
  ${sorted.map(a=>{const u=a.usage;const cp=commissionPct(a);return `<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td>${segmentPill(a)}</td><td class="num">${adoptionPill(a)}</td><td class="num">${(u.active||0).toLocaleString()} / ${(u.licensed||0).toLocaleString()}</td><td class="num">${usageTrendHtml(u.trend)}</td><td class="num">${cp==null?'—':commissionPill(a)}</td><td class="num">${u.sync?esc(fmtDate(u.sync)):'—'}</td></tr>`;}).join('')}
  </tbody></table>
  ${sorted.length?'':'<p class="mini">No accounts with usage data match this filter.</p>'}
  <p class="mini" style="margin-top:12px;color:var(--muted)">Source: product-analytics Snowflake → Sigma, modeled as a periodic export. Swap in the live connection later — nothing above needs to change since it reads the same <code>ProductUsage__c</code> shape.</p>
  </div>`;
}

// ---- TAP Refreshes (hardware warranty refresh cycle) ----
// Per Leana's stakeholder finding: TAP status belongs on the portfolio home
// dashboard, refresh due at the 2.5-year midpoint of a 5-year hardware
// contract. Built as its own tab (not just a KPI tile) with a standardized,
// actionable refresh checklist per account, per Beatrice's emphasis on
// actionable steps rather than a status number alone.
const TAP_STEPS_TEMPLATE=[
  'Confirm current hardware inventory & serials',
  'Send TAP refresh proposal / quote',
  'Confirm order & schedule replacement shipment',
  'Coordinate installation / device swap-out',
  'Confirm old units returned (RMA)',
  'Close out refresh in system',
];
function ensureTapState(acctId){
  let t=tapState[acctId];
  if(!t){ t=tapState[acctId]={steps:TAP_STEPS_TEMPLATE.map(label=>({id:cid(),label,done:false})),notes:'',refreshedAt:null}; saveTapState(); }
  return t;
}
function toggleTapStep(acctId,stepId,done){ const t=ensureTapState(acctId); const s=t.steps.find(x=>x.id===stepId); if(s) s.done=done; saveTapState(); openTap(acctId); }
function setTapNotes(acctId,v){ const t=ensureTapState(acctId); t.notes=v; saveTapState(); }
function markTapRefreshed(acctId){
  const t=ensureTapState(acctId); t.refreshedAt=t.refreshedAt?null:new Date().toISOString(); saveTapState();
  const a=STATE.accounts.find(x=>x.id===acctId); if(a) computeTap(a);
  openTap(acctId);
}
let tapKpiFilter=null; // null | 'overdue' | 'duesoon' — set by clicking a KPI tile
function setTapKpi(k){ tapKpiFilter = tapKpiFilter===k?null:k; route(); }
function viewTap(accts){
  const tracked=accts.filter(a=>a.tapHwStart);
  const overdue=tracked.filter(a=>a.tapStatus==='overdue');
  const dueSoon=tracked.filter(a=>a.tapStatus==='duesoon');
  let sorted=[...tracked].sort((x,y)=>(x.tapDays==null?99999:x.tapDays)-(y.tapDays==null?99999:y.tapDays));
  if(tapKpiFilter==='overdue') sorted=sorted.filter(a=>a.tapStatus==='overdue');
  else if(tapKpiFilter==='duesoon') sorted=sorted.filter(a=>a.tapStatus==='duesoon');
  const kpis=[
    ['Overdue refreshes',overdue.length,'past the 2.5-year mark — act now','overdue'],
    ['Due within 90 days',dueSoon.length,'get ahead of the refresh','duesoon'],
    ['Tracked TAP contracts',tracked.length,'of '+accts.length+' accounts with hardware on file',null],
  ];
  return `<div class="card"><h3>TAP Refreshes <span class="hint">hardware warranty refresh — due at the 2.5-year mark of a 5-year contract, per CS-leadership stakeholder guidance — click a tile to filter</span></h3>
  <p class="mini">Tracks every account with Axon hardware (body cameras, TASER, fleet, interview room, cartridges, drones) on file. TAP refresh is a distinct hardware-lifecycle motion from a software renewal — each account below gets a standardized checklist so nothing falls through between "it's due" and "it's done."</p>
  <div class="kpis" style="margin:14px 0">${kpis.map(k=>`<div class="kpi clickable${k[3]==='overdue'?' risk-red':k[3]==='duesoon'?' risk-amber':''}${k[3]&&tapKpiFilter===k[3]?' selected':''}" onclick="setTapKpi(${k[3]?`'${k[3]}'`:'null'})"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  ${tapKpiFilter?`<p class="mini" style="margin:-4px 0 12px">Filtered to <b>${tapKpiFilter==='overdue'?'overdue':'due within 90 days'}</b> · <a href="#" onclick="setTapKpi('${tapKpiFilter}');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear filter</a></p>`:''}
  <table><thead><tr><th>Account</th><th>Owner</th><th class="num">Hardware purchase</th><th class="num">Refresh due</th><th class="num">Contract end</th><th>Status</th><th></th></tr></thead><tbody>
  ${sorted.map(a=>{ const t=tapState[a.id]; const prog=t?Math.round(t.steps.filter(s=>s.done).length/t.steps.length*100):0; return `<tr onclick="openTap('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td class="num">${esc(a.tapHwStart||'—')}</td><td class="num">${esc(a.tapRefreshDate||'—')}${a.tapDays!=null?` <span class="mini">(${a.tapDays<0?Math.abs(a.tapDays)+'d overdue':a.tapDays+'d'})</span>`:''}</td><td class="num">${esc(a.tapContractEnd||'—')}</td><td>${tapStatusPill(a)}</td><td class="mini">${t?prog+'% checklist':''}</td></tr>`; }).join('')}
  </tbody></table>
  ${sorted.length?'':'<p class="mini">No tracked TAP contracts match this scope/filter.</p>'}
  ${accts.length-tracked.length>0?`<p class="mini" style="margin-top:10px;color:var(--muted)">${accts.length-tracked.length} account(s) in scope have no Axon hardware on file — TAP refresh doesn't apply to software-only accounts.</p>`:''}
  </div>`;
}
function openTap(acctId){
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
  const t=ensureTapState(acctId);
  const prog=Math.round(t.steps.filter(s=>s.done).length/t.steps.length*100);
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2>TAP Refresh — ${esc(a.name)} ${stateTag(a)}</h2><div class="mini" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">Owner ${ownerCell(a.ownerName)} · Hardware purchased ${esc(a.tapHwStart||'—')} · ${tapStatusPill(a)}</div></div><button class="x" onclick="closeSheet()">✕</button></div>
  <div class="bd">
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Refresh timeline</h3>
      <div class="comp" style="grid-template-columns:1fr auto">
        <div>Hardware purchase date</div><div><b>${esc(a.tapHwStart||'—')}</b></div>
        <div>Refresh due (2.5yr mark)</div><div><b>${esc(a.tapRefreshDate||'—')}</b></div>
        <div>Contract end (5yr mark)</div><div><b>${esc(a.tapContractEnd||'—')}</b></div>
        <div>Days ${a.tapDays!=null&&a.tapDays<0?'overdue':'remaining'}</div><div class="${a.tapDays!=null&&a.tapDays<0?'neg':''}"><b>${a.tapDays!=null?Math.abs(a.tapDays):'—'}</b></div>
      </div>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Refresh checklist <span class="hint">${prog}% complete · standardized across every TAP refresh</span></h3>
      <div class="progress"><i style="width:${prog}%"></i></div>
      <div style="margin-top:12px">${t.steps.map(s=>`<div class="tapstep${s.done?' done':''}"><input type="checkbox" ${s.done?'checked':''} onchange="toggleTapStep('${acctId}','${s.id}',this.checked)"><span>${esc(s.label)}</span></div>`).join('')}</div>
      <div class="row-actions" style="margin-top:12px">
        <button class="btn ${t.refreshedAt?'':'primary'}" onclick="markTapRefreshed('${acctId}')">${t.refreshedAt?'Reopen refresh':'Mark refresh complete'}</button>
        <button class="btn" onclick="quickTapCta('${acctId}')">+ Add TAP Refresh CTA</button>
        <button class="btn" onclick="closeSheet();setTimeout(()=>openAcct('${acctId}'),50)">Open account 360</button>
      </div>
    </div>
    <div class="card" style="box-shadow:none;margin:0"><h3>Notes</h3>
      <textarea class="notes-in" placeholder="Shipment tracking, install scheduling, customer contact for coordination…" oninput="setTapNotes('${acctId}',this.value)">${esc(t.notes||'')}</textarea>
    </div>
  </div>`;
  showOverlay();
}
function quickTapCta(id){
  const a=STATE.accounts.find(x=>x.id===id); if(!a) return;
  ctas.push({id:cid(),type:'TAP Refresh',acctId:id,name:a.name,priority:a.tapStatus==='overdue'?'High':'Medium',due:a.tapRefreshDate||sfDate(new Date(Date.now()+30*864e5)),title:'Coordinate TAP hardware refresh',status:'Open',source:'Manual',createdAt:new Date().toISOString()});
  saveCtas(); toast('TAP Refresh CTA added — see the CTAs tab.');
}

// ---- Resource Library (guides / SOPs / internal resources) ----
function viewResources(){
  const cats=resourceCategories();
  return `<div class="card"><h3>Resource Library <span class="hint">guides, SOPs &amp; internal resources — editable in real time so links never go stale</span></h3>
  <p class="mini">Topic-based resources any CSM can reach from any account, not tied to one specific customer. Add or update a link here and it's live everywhere immediately, on the account page too — the point is nothing gets lost in a Slack thread from eight months ago.</p>
  <div class="card" style="box-shadow:none;border-style:dashed;margin:14px 0"><h3 style="border:none;margin:0 0 10px">Add a resource</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input type="text" id="resCat" placeholder="Category (e.g. RMAs)" list="resCatList" style="width:160px;border:1px solid var(--line);padding:8px 12px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
      <datalist id="resCatList">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
      <input type="text" id="resTitle" placeholder="Title" style="flex:1;min-width:180px;border:1px solid var(--line);padding:8px 12px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
      <input type="text" id="resUrl" placeholder="https://…" style="flex:1;min-width:200px;border:1px solid var(--line);padding:8px 12px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
      <button class="btn primary" onclick="submitResource()">Add</button>
    </div>
  </div>
  ${cats.map(cat=>`<div style="margin-bottom:18px">${catTag(cat,'font-size:11px;padding:4px 10px;margin-bottom:8px;display:inline-block')}
    <div class="reslist">${resources.filter(r=>r.category===cat).map(r=>`<div class="resrow"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a><button class="btn sm" onclick="delResource('${r.id}')">Remove</button></div>`).join('')}</div>
  </div>`).join('')}
  ${resources.length?'':'<p class="mini">No resources yet — add one above.</p>'}
  </div>`;
}
function submitResource(){ const cat=($('#resCat').value||'').trim(), title=($('#resTitle').value||'').trim(), url=($('#resUrl').value||'').trim(); if(!title||!url){ toast('Add a title and a URL.'); return; } addResource(cat,title,url); toast('Resource added.'); }

// ---- Communications (Salesforce history + locally logged activity) ----
function sfSyncPill(status,detail){
  const m={synced:['p-green','Synced to Salesforce'],simulated:['p-gray','Not synced (mock mode)'],error:['p-red','Sync failed'],pending:['p-amber','Syncing…']};
  const x=m[status]; if(!x) return '';
  return ` <span class="pill ${x[0]}" title="${esc(detail||'')}">${x[1]}</span>`;
}
function renderCommItem(it){
  const full=cleanComm(it.desc); const long=full.length>200; const short=long?full.slice(0,200)+'…':full;
  const del=it.localId?` <button class="btn sm" onclick="delActivity('${it.acctId}','${it.localId}')" title="Remove logged activity">✕</button>`:'';
  const sync=it.local&&it.sfSync?sfSyncPill(it.sfSync,it.sfDetail):'';
  return `<div class="ev"><div class="t">${fmtDate(it.d)} · ${commPill(it.sub)} · ${esc(it.who||'')}${it.local?' · logged here':''}${sync}${del}</div><div><b>${esc(commSubject(it.subj))}</b></div>${full?`<div class="mini commtext"><span class="cs">${esc(short)}</span><span class="cf hidden">${esc(full)}</span>${long?` <a href="#" onclick="toggleComm(event,this)">more</a>`:''}</div>`:''}</div>`;
}
async function loadAcctComms(id){
  const box=$('#acctComms'); if(!box) return;
  const localLog=(activityFor(id).log||[]).map(e=>({d:e.t,sub:e.type,subj:e.subject,who:'You',desc:e.notes,local:true,localId:e.id,acctId:id,sfSync:e.sfSync,sfDetail:e.sfDetail}));
  try{
    const [tasks,events]=await Promise.all([
      soql(`SELECT Id,Subject,TaskSubtype,ActivityDate,CreatedDate,Owner.Name,Description FROM Task WHERE AccountId='${id}' ORDER BY CreatedDate DESC LIMIT 12`),
      soql(`SELECT Id,Subject,EventSubtype,StartDateTime,Owner.Name,Description FROM Event WHERE AccountId='${id}' ORDER BY StartDateTime DESC LIMIT 6`)
    ]);
    let items=tasks.map(t=>({d:t.CreatedDate||t.ActivityDate,sub:t.TaskSubtype,subj:t.Subject,who:(t.Owner&&t.Owner.Name),desc:t.Description}))
      .concat(events.map(e=>({d:e.StartDateTime,sub:'Meeting',subj:e.Subject,who:(e.Owner&&e.Owner.Name),desc:e.Description})))
      .concat(localLog);
    items.sort((a,b)=> (a.d<b.d?1:a.d>b.d?-1:0)); items=items.slice(0,16);
    let h;
    if(!items.length){ h='<p class="mini">No communications yet — log a call or note above to start the history.</p>'; }
    else h=`<div class="tl">${items.map(renderCommItem).join('')}</div>`;
    box.innerHTML=h;
  }catch(e){
    // Still show locally logged activity if Salesforce/mock history fails
    if(localLog.length){ localLog.sort((a,b)=> (a.d<b.d?1:-1)); box.innerHTML=`<div class="tl">${localLog.map(renderCommItem).join('')}</div><p class="mini" style="margin-top:8px;color:var(--muted)">Couldn\u2019t load Salesforce history — showing your logged activity only.</p>`; }
    else box.innerHTML='<div class="err">Couldn\u2019t load communications — '+esc(e.message||e)+'</div>';
  }
}
function toggleComm(ev,a){ ev.preventDefault(); const w=a.closest('.commtext'),cs=w.querySelector('.cs'),cf=w.querySelector('.cf'); const showFull=cf.classList.contains('hidden'); cf.classList.toggle('hidden',!showFull); cs.classList.toggle('hidden',showFull); a.textContent=showFull?'less':'more'; }
function activityCard(a){
  const act=activityFor(a.id);
  const next=act.next;
  const overdue=nextStepOverdue(next);
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Activity &amp; next steps <span class="hint">log a call, email, or meeting · document what happens next</span></h3>
  <p class="mini">Logging here counts toward engagement cadence immediately, and each entry attempts a Salesforce Task write-back — watch for the sync pill next to it below. In mock-data mode that sync is simulated and clearly labeled rather than pretending to succeed; switch to live Salesforce (see README) to have it write for real.</p>

  <div class="next-step${overdue?' overdue':''}" style="margin:12px 0 16px">
    <div class="mini" style="font-weight:700;color:var(--ink);margin-bottom:8px">Next step ${next?`<span class="pill ${overdue?'p-red':'p-amber'}" style="margin-left:6px">${overdue?'Overdue':(next.due?'Due '+esc(next.due):'Open')}</span>`:''}</div>
    <textarea class="notes-in" id="nextStepText" style="min-height:52px" placeholder="What needs to happen next? e.g. Follow up on quote, schedule QBR, send RMA label…">${esc(next&&next.text||'')}</textarea>
    <div class="row-actions" style="margin-top:8px">
      <label class="mini">Due</label>
      <input type="date" id="nextStepDue" value="${esc(next&&next.due||'')}" style="border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink);color-scheme:dark">
      <button class="btn primary sm" onclick="saveNextStep('${a.id}')">Save next step</button>
      ${next?`<button class="btn sm" onclick="clearNextStep('${a.id}')">Clear</button>`:''}
    </div>
  </div>

  <div class="mini" style="font-weight:700;color:var(--ink);margin-bottom:8px">Log activity</div>
  <div class="row-actions" style="margin-bottom:8px">
    <select class="select sm" id="actType">${ACT_TYPES.map(t=>`<option>${t}</option>`).join('')}</select>
    <input id="actSubject" placeholder="Subject (e.g. QBR prep call with Chief)" style="flex:1;min-width:160px;border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
  </div>
  <textarea class="notes-in" id="actNotes" style="min-height:56px" placeholder="What was discussed, decisions made, customer asks…"></textarea>
  <div class="row-actions" style="margin-top:8px;margin-bottom:14px">
    <button class="btn primary" onclick="logActivity('${a.id}')">Log activity</button>
    <button class="btn" onclick="quickCta('${a.id}')">+ Turn into CTA</button>
  </div>

  <div class="mini" style="font-weight:700;color:var(--ink);margin-bottom:8px">Past communications</div>
  <div id="acctComms"><div class="mini">Loading communications…</div></div>
  </div>`;
}

// ---- Purchase history & products ----
async function loadAcctIntel(id){
  const dBox=$('#acctDeals'), pBox=$('#acctProducts');
  if(intelCache[id]){
    if(dBox)dBox.innerHTML=intelCache[id].deals; if(pBox)pBox.innerHTML=intelCache[id].prod;
    drawAcctDealsChart(intelCache[id].dealsRaw); drawAcctProdChart(intelCache[id].famsRaw);
    return;
  }
  try{
    const [deals,fams,skus]=await Promise.all([
      soql(`SELECT Name,Amount,CloseDate,StageName FROM Opportunity WHERE IsWon=true AND AccountId='${id}' ORDER BY CloseDate DESC LIMIT 8`),
      soql(`SELECT Product2.Family fam, SUM(TotalPrice) amt, SUM(Quantity) qty FROM OpportunityLineItem WHERE Opportunity.IsWon=true AND Opportunity.AccountId='${id}' GROUP BY Product2.Family ORDER BY SUM(TotalPrice) DESC LIMIT 12`),
      soql(`SELECT Product2.Name n, SUM(TotalPrice) amt FROM OpportunityLineItem WHERE Opportunity.IsWon=true AND Opportunity.AccountId='${id}' GROUP BY Product2.Name ORDER BY SUM(TotalPrice) DESC LIMIT 8`)
    ]);
    const dealsHtml = deals.length
      ? `<table><thead><tr><th>Deal</th><th>Stage</th><th class="num">Amount</th><th class="num">Closed</th></tr></thead><tbody>${deals.map(o=>`<tr style="cursor:default"><td>${esc(o.Name)}</td><td>${esc(o.StageName)}</td><td class="num">${fmtMoney(o.Amount)}</td><td class="num">${esc(o.CloseDate||'')}</td></tr>`).join('')}</tbody></table><p class="mini" style="margin-top:8px">Showing 8 most recent closed-won deals.</p>`
      : '<p class="mini">No closed-won deals on record.</p>';
    let prodHtml;
    if(!fams.length){ prodHtml='<p class="mini">No product line items recorded for closed-won deals.</p>'; }
    else{
      const max=Math.max(...fams.map(f=>f.amt||0))||1;
      prodHtml=`<div class="prodlist">${fams.map(f=>`<div class="prow"><div class="pn" title="${esc(prodName(f.fam))}">${esc(prodName(f.fam))}</div><div class="pbar"><i style="width:${Math.round((f.amt||0)/max*100)}%"></i></div><div class="pv">${fmtMoney(f.amt)}</div></div>`).join('')}</div>`;
      if(skus.length) prodHtml+=`<p class="mini" style="margin-top:12px"><b>Top individual items purchased:</b><br>${skus.map(s=>esc(s.n)+' — '+fmtMoney(s.amt)).join('<br>')}</p>`;
      prodHtml+=`<p class="mini" style="margin-top:8px;color:var(--muted)">Grouped by Product2.Family across all closed-won line items.</p>`;
    }
    intelCache[id]={deals:dealsHtml,prod:prodHtml,dealsRaw:deals,famsRaw:fams};
    if(dBox)dBox.innerHTML=dealsHtml; if(pBox)pBox.innerHTML=prodHtml;
    drawAcctDealsChart(deals); drawAcctProdChart(fams);
  }catch(e){ if(dBox)dBox.innerHTML='<div class="err">Couldn\u2019t load purchase history — '+esc(e.message||e)+'</div>'; if(pBox)pBox.innerHTML=''; }
}

// ---- Usage & adoption card (Account 360) ----
// Beatrice (CSM): the biggest gap in Gainsight is usage/adoption living in a
// separate Snowflake/Sigma world. This brings it onto the account in one place:
// active vs. licensed seats, adoption % against the configurable cutoff, usage
// trend, per-product breakdown, and progress to the CSM's commission goal.
function usageCard(a){
  const u=a.usage;
  if(!u || u.adoptionPct==null){
    return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Usage &amp; adoption <span class="hint">from product analytics (Snowflake / Sigma)</span></h3>
      <p class="mini">No usage export has been synced for this account yet. Adoption, APAP and per-product usage live in the product-analytics Snowflake and are pulled in on a periodic export — this account wasn't in the latest pull.</p></div>`;
  }
  const tier=adoptionTier(a), col=adoptionColor(tier);
  const cp=commissionPct(a);
  const prods=(u.products||[]).slice().sort((x,y)=>(y.pct||0)-(x.pct||0));
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Usage &amp; adoption <span class="hint">${adoptionPill(a)}${u.sync?` · synced ${esc(u.sync)}`:''}</span></h3>
    <p class="mini">Active users vs. what's provisioned, from the product-analytics export. "Adopting" is defined as ≥ <b>${adoptionCfg.adoptingPct}%</b> active (editable in the <a href="#" onclick="setTab('usage');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">Usage &amp; Adoption</a> tab).</p>
    <div class="kpis" style="margin:12px 0">
      <div class="kpi"><div class="l">Adoption</div><div class="v" style="color:${col}">${u.adoptionPct}%</div><div class="d">${ADOPT_META[tier][1]}</div></div>
      <div class="kpi"><div class="l">Active seats</div><div class="v">${(u.active||0).toLocaleString()}</div><div class="d">of ${(u.licensed||0).toLocaleString()} licensed</div></div>
      <div class="kpi"><div class="l">Usage trend</div><div class="v" style="font-size:22px">${usageTrendHtml(u.trend)}</div><div class="d">vs. prior period</div></div>
      <div class="kpi"><div class="l">Last synced</div><div class="v" style="font-size:20px">${u.sync?esc(fmtDate(u.sync)):'—'}</div><div class="d">periodic export</div></div>
    </div>
    <div class="progress" title="${u.adoptionPct}% adoption"><i style="width:${Math.min(100,u.adoptionPct)}%;background:${col}"></i></div>
    ${cp!=null?`<div style="margin-top:16px">
      <div class="row-actions" style="justify-content:space-between;margin-bottom:6px"><span class="mini" style="font-weight:700;color:var(--ink)">Tracking toward commission goal</span> ${commissionPill(a)}</div>
      <div class="progress"><i style="width:${Math.min(100,cp)}%;background:${cp>=100?'var(--green)':cp>=70?'var(--amber)':'var(--red)'}"></i></div>
      <p class="mini" style="margin-top:6px">${fmtFull(u.commAttained)} attained of ${fmtFull(u.commTarget)} target${cp>=100?' — goal met':''}.</p>
    </div>`:''}
    ${prods.length?`<p class="mini" style="font-weight:700;color:var(--ink);margin:16px 0 6px">By product</p>
    <table><thead><tr><th>Product</th><th class="num">Active</th><th class="num">Licensed</th><th class="num">Adoption</th></tr></thead><tbody>
    ${prods.map(p=>{const pc=p.pct==null?null:(p.pct>=adoptionCfg.adoptingPct?'p-green':p.pct<adoptionCfg.atRiskPct?'p-red':'p-amber');return `<tr style="cursor:default"><td><b>${esc(prodName(p.family))}</b></td><td class="num">${(p.active||0).toLocaleString()}</td><td class="num">${(p.licensed||0).toLocaleString()}</td><td class="num">${p.pct==null?'—':`<span class="pill ${pc}">${p.pct}%</span>`}</td></tr>`;}).join('')}
    </tbody></table>`:''}
    <p class="mini" style="margin-top:10px;color:var(--muted)">Source: product-analytics Snowflake → Sigma. Modeled here as a periodic export; wire the live feed in later without touching this view.</p>
  </div>`;
}

// ---- Account 360 ----
// Opening an account is a real page, not a modal — it renders into #app
// alongside the normal icon-rail/flyout nav, at the same width as any other
// tab, rather than floating in the .sheet overlay used by TAP/Plan/etc.
function openAcct(id){ currentAcctView=id; route(); window.scrollTo(0,0); }
function closeAcctView(){ currentAcctView=null; route(); window.scrollTo(0,0); }
function renderAcctPage(){
  const a=STATE.accounts.find(x=>x.id===currentAcctView);
  if(!a){ currentAcctView=null; route(); return; }
  $('#scopebar').style.display='none';
  $('#app').innerHTML=acctPageHtml(a);
  drawAcctSyncCharts(a);
  loadAcctComms(a.id);
  loadAcctIntel(a.id);
}
function acctPageHtml(a){
  const id=a.id;
  a.readiness=readinessScore(a);
  const escStateForAcct=peekEscState(id);
  const escDaysOpen = escStateForAcct.openedAt ? Math.floor((Date.now()-new Date(escStateForAcct.openedAt).getTime())/864e5) : null;
  const c=csatVal(a);
  const compRows=a.comps.length?a.comps.map(c=>`<div>${esc(c[0])}</div><div class="${c[1]<0?'neg':'pos'}">${c[1]}</div>`).join(''):'<div class="mini">No penalties — full health.</div>';
  const opps=a.opps.slice().sort((x,y)=>(x.close>y.close?1:-1));
  const resolvedRate = a.lifeCases>0 ? Math.round((a.lifeCases-a.openCases)/a.lifeCases*100) : null;
  const sentColor = a.sentiment==null?'var(--muted)':a.sentTier==='pos'?'var(--green)':a.sentTier==='neu'?'var(--amber)':'var(--red)';
  const hasPlan=!!plans[id];
  return `<div class="card acct-hd"><div class="hd"><div><h2>${esc(a.name)} ${stateTag(a)}</h2><div class="mini" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">Owner ${ownerCell(a.ownerName)}${a.ownerTitle?' ('+esc(a.ownerTitle)+')':''}${newLogo(a)?' · <b>New logo</b>':''} · ${segmentPill(a)} ${cadencePill(a)} ${opportunityPill(a)}</div></div><button class="btn sm" onclick="closeAcctView()">← Back</button></div></div>
  <div class="bd">
    <div class="row-actions" style="margin-bottom:16px">
      <button type="button" class="btn primary" onclick="createOrOpenPlan('${a.id}')">${hasPlan?'Open success plan':'Create success plan'}</button>
      <button type="button" class="btn" onclick="event.stopPropagation();composeEmailForAcct('${a.id}')">Draft email</button>
      <button type="button" class="btn" onclick="document.getElementById('actSubject')&&document.getElementById('actSubject').focus()">Log activity</button>
      <button type="button" class="btn" onclick="quickCta('${a.id}')">+ Add CTA</button>
      ${a.tier!=='healthy'?`<button type="button" class="btn" onclick="event.stopPropagation();startEscalation('${a.id}')">Start escalation</button>`:''}
    </div>
    <div class="kpis" style="margin-bottom:16px">
      <div class="kpi"><div class="l">Health</div><div class="v" style="color:${a.health>=75?'var(--green)':a.health>=50?'var(--amber)':'var(--red)'}">${a.health}</div><div class="d">${tierPill(a.tier)}</div></div>
      <div class="kpi"><div class="l">CSAT</div><div class="v" style="color:${csatColor(c.v)}">${c.v==null?'—':c.v+'%'}</div><div class="d">${c.v==null?'no data':csatFace(c.v)+(c.src==='placeholder'?' · placeholder':' · set by CSM')}</div></div>
      <div class="kpi"><div class="l">NPS</div><div class="v" style="color:${a.nps==null?'var(--muted)':a.nps>=9?'var(--green)':a.nps>=7?'var(--amber)':'var(--red)'}">${a.nps==null?'—':a.nps+'/10'}</div><div class="d">${a.nps==null?'no survey response':npsClassify(a.nps)+(a.npsDate?' · '+esc(a.npsDate):'')}</div></div>
      <div class="kpi"><div class="l">Sentiment</div><div class="v" style="color:${sentColor}">${a.sentiment==null?'—':a.sentiment}</div><div class="d">${sentPill(a)}</div></div>
      <div class="kpi"><div class="l">Annualized revenue</div><div class="v">${fmtMoney(a.ltv)}</div><div class="d">${a.pastDeals} closed-won deals</div></div>
      <div class="kpi"><div class="l">Total Contract Value</div><div class="v">${fmtMoney(a.renewalAmount)}</div><div class="d">${a.dclose>9000?'—':'closes in '+a.dclose+' days'}</div></div>
      <div class="kpi"><div class="l">Open cases</div><div class="v">${a.openCases}</div><div class="d">${a.highCases} high/urgent</div></div>
      <div class="kpi${(a.casesBlocked||a.casesAging)?' accent':''}"><div class="l">Blocked / Aging</div><div class="v">${a.casesBlocked||0} / ${a.casesAging||0}</div><div class="d">cases to escalate</div></div>
      <div class="kpi"><div class="l">Growth (all-time)</div><div class="v">${fmtMoney((a.growth&&(a.growth.Renewal+a.growth.Expansion+a.growth.Transactional))||0)}</div><div class="d">Renewal/Expansion/Transactional</div></div>
      <div class="kpi"><div class="l">Adoption</div><div class="v" style="color:${adoptionColor(adoptionTier(a))}">${a.usage&&a.usage.adoptionPct!=null?a.usage.adoptionPct+'%':'—'}</div><div class="d">${a.usage&&a.usage.adoptionPct!=null?ADOPT_META[adoptionTier(a)][1]:'no usage data'}</div></div>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><details class="disc"><summary><h3 style="display:inline;border:none;margin:0">Where do I log this? <span class="hint">a quick guide to every input surface on this account</span></h3></summary>
      <div class="disco-grid" style="margin-top:10px">
        <div class="disco-field"><label class="mini" style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px">Customer insights</label><p class="mini">A synthesized takeaway about the customer — not a record of what happened, but what you learned (a competitive threat, an expansion signal, a champion change). Rolls up into this CSM's Scorecard insights count.</p></div>
        <div class="disco-field"><label class="mini" style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px">Activity &amp; next steps</label><p class="mini">The factual record — log the call/email/meeting itself and the next action with a due date. Counts toward engagement cadence and attempts a Salesforce write-back.</p></div>
        <div class="disco-field"><label class="mini" style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px">Escalation notes &amp; checklist</label><p class="mini">Only while this account has an active escalation — status, reason/product tags, the 6-step checklist, and a timestamped note log specific to that escalation.</p></div>
        <div class="disco-field"><label class="mini" style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px">TAP checklist &amp; notes</label><p class="mini">Hardware-refresh-specific progress (inventory → quote → ship → install → RMA → close-out) — open it from the TAP Refreshes tab or the account's TAP status.</p></div>
        <div class="disco-field"><label class="mini" style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px">Success Plan notes &amp; milestones</label><p class="mini">Plan-specific progress and context — objectives, milestone due dates/notes, and the optional discovery template. Open or create the plan above.</p></div>
        <div class="disco-field"><label class="mini" style="font-weight:700;color:var(--ink);display:block;margin-bottom:4px">Who's on this account</label><p class="mini">Not a note — a roster. Keep the Axon-side and customer-side contact list current so anyone can see who to talk to.</p></div>
      </div>
    </details></div>

    <div class="acct-grid">
    <div class="full">${usageCard(a)}</div>

    <div class="full">${teamRosterCard(a)}</div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Customer satisfaction (CSAT) <span class="hint">placeholder — set a real score or connect surveys later</span></h3>
      <div class="csat-wrap">
        <div class="csat-num" style="color:${csatColor(c.v)}">${c.v==null?'—':c.v+'%'}</div>
        <div><div class="csat-face" style="color:${csatColor(c.v)}">${c.v==null?'No rating':csatFace(c.v)}</div><div class="mini">${c.src==='manual'?'Set manually by a CSM':c.src==='placeholder'?'Placeholder derived from support sentiment':'No data yet'}</div></div>
      </div>
      <div class="row-actions" style="margin-top:12px">
        <label class="mini">Set CSAT %</label>
        <input type="number" min="0" max="100" value="${c.v==null?'':c.v}" style="width:90px;border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setCsat('${a.id}',this.value);openAcct('${a.id}')">
        ${csat[a.id]!=null?`<button class="btn sm" onclick="setCsat('${a.id}','');openAcct('${a.id}')">Clear override</button>`:''}
      </div>
      <p class="mini" style="margin-top:10px;color:var(--muted)">This org has no survey/CSAT object yet, so CSAT is a placeholder. When surveys (or an NPS/CSAT field) are added, wire them in here to replace the derived value.</p>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Renewal readiness <span class="hint">${a.readiness}% ready to renew</span></h3>
      <div class="progress"><i style="width:${a.readiness}%"></i></div>
      <div class="comp" style="grid-template-columns:1fr auto;margin-top:12px">
        ${readinessChecklist(a).map(c=>`<div>${esc(c[0])}</div><div class="${c[1]?'pos':'neg'}">${c[1]?'✓':'—'}</div>`).join('')}
      </div>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Purchase history & lifetime value <span class="hint">all closed-won opportunities</span></h3>
      <div class="comp" style="grid-template-columns:1fr auto;margin-bottom:12px">
        <div>Annualized revenue (closed-won)</div><div class="pos">${fmtFull(a.ltv)}</div>
        <div>Closed-won deals</div><div><b>${a.pastDeals}</b></div>
        <div>First purchase</div><div><b>${a.firstPurchase?esc(a.firstPurchase):'—'}</b></div>
        <div>Most recent purchase</div><div><b>${a.lastPurchase?esc(a.lastPurchase):'—'}</b></div>
      </div>
      <div class="chartbox" style="height:220px;margin-bottom:14px"><canvas id="acctDealsChart"></canvas></div>
      <div id="acctDeals"><div class="mini">Loading recent deals…</div></div>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Products purchased <span class="hint">by spend, from closed-won line items</span></h3>
      <div class="chartbox" style="height:220px;margin-bottom:14px"><canvas id="acctProdChart"></canvas></div>
      <div id="acctProducts"><div class="mini">Loading products…</div></div>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Customer insights <span class="hint">capture &amp; distil what the team is learning about this account</span></h3>
      <p class="mini">Not tied to a case or escalation — this is where the team writes down what they're actually learning about the customer, especially useful while building a net-new motion. Rolls up into each CSM's scorecard.</p>
      <textarea class="notes-in" id="insightIn" placeholder="What did we learn about this customer?"></textarea>
      <div class="row-actions" style="margin-top:6px"><button class="btn" onclick="addInsight('${a.id}',document.getElementById('insightIn').value);openAcct('${a.id}')">Log insight</button></div>
      <div class="tl" style="margin-top:12px">${(insights[a.id]&&insights[a.id].length)?insights[a.id].slice().reverse().map(n=>`<div class="ev"><div class="t">${new Date(n.t).toLocaleString()}</div><div>${esc(n.note)}</div></div>`).join(''):'<span class="mini">No insights logged yet for this account.</span>'}</div>
    </div>

    ${surveyCard(a)}

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Resources &amp; guides <span class="hint">shared library — <a href="#" onclick="setTab('resources');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">manage in Resource Library</a></span></h3>
      ${resources.length?`<div class="reslist">${resources.map(r=>`<div class="resrow">${catTag(r.category,'margin-right:8px')}<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></div>`).join('')}</div>`:'<p class="mini">No resources in the library yet.</p>'}
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Customer sentiment <span class="hint">derived from lifetime support-case signals</span></h3>
      ${a.sentiment==null
        ? '<p class="mini">No support-case history on record for this account.</p>'
        : `<div style="display:flex;align-items:center;gap:16px;margin-bottom:12px"><div style="font-size:34px;font-weight:800;color:${sentColor};font-variant-numeric:tabular-nums">${a.sentiment}</div><div>${sentPill(a)}<div class="mini" style="margin-top:4px">0 = heavy friction · 100 = smooth</div></div></div>
        <div class="chartbox" style="height:200px;margin-bottom:14px"><canvas id="acctCaseChart"></canvas></div>
        <div class="comp" style="grid-template-columns:1fr auto">
          <div>Lifetime support cases</div><div><b>${a.lifeCases.toLocaleString()}</b></div>
          <div>High / urgent tickets</div><div class="${a.lifeHigh>0?'neg':''}">${a.lifeHigh.toLocaleString()} (${Math.round(a.lifeHigh/a.lifeCases*100)}%)</div>
          <div>Escalated tickets</div><div class="${a.lifeEsc>0?'neg':''}">${a.lifeEsc.toLocaleString()} (${Math.round(a.lifeEsc/a.lifeCases*100)}%)</div>
          <div>Currently open high/urgent</div><div class="${a.highCases>0?'neg':''}">${a.highCases}</div>
          <div>Resolved rate</div><div class="${resolvedRate!=null&&resolvedRate>=90?'pos':''}">${resolvedRate==null?'—':resolvedRate+'%'}</div>
        </div>`}
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Health breakdown <span class="hint">why this number</span></h3>
      <div class="chartbox" style="height:200px;margin-bottom:14px"><canvas id="acctHealthChart"></canvas></div>
      <div class="comp"><div><b>Base</b></div><div class="pos">100</div>${compRows}<div style="border-top:1px solid var(--line-soft);padding-top:6px"><b>Score</b></div><div style="border-top:1px solid var(--line-soft);padding-top:6px"><b>${a.health}</b></div></div></div>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Open renewals</h3><table><tbody>${opps.map(o=>`<tr style="cursor:default"><td>${esc(o.name)}</td><td>${esc(o.stage)}</td><td class="num">${fmtMoney(o.amount)}</td><td class="num">${esc(o.close)}</td></tr>`).join('')}</tbody></table></div>
    ${activityCard(a)}
    <div class="card" id="acctEscalation" style="box-shadow:none;margin:0"><h3>Escalation <span class="hint">${escDaysOpen!=null?escDaysOpen+'d open':''}${escDaysOpen>=14?' · stale':''}</span></h3>
      <div class="row-actions" style="margin-bottom:10px">Status: ${statusPill(escStateForAcct.status||'—')} ${a.tier!=='healthy'?`<button type="button" class="btn" onclick="event.stopPropagation();startEscalation('${a.id}')">${escStateForAcct.status==='In Progress'?'Started':'Start'}</button><button type="button" class="btn primary" onclick="event.stopPropagation();setEscStatus('${a.id}','Resolved');toast('Escalation resolved.');openAcct('${a.id}')">Resolve</button>`:''}</div>
      <div class="row-actions" style="margin-bottom:12px">
        <label class="mini">Reason code</label>
        <select class="select sm" onchange="setEscReason('${a.id}',this.value);openAcct('${a.id}')">
          <option value=""${!escStateForAcct.reasonCode?' selected':''}>— reason —</option>
          ${ESC_REASONS.map(r=>`<option value="${esc(r)}"${escStateForAcct.reasonCode===r?' selected':''}>${esc(r)}</option>`).join('')}
        </select>
        <label class="mini">Product</label>
        <select class="select sm" onchange="setEscProduct('${a.id}',this.value);openAcct('${a.id}')">
          <option value=""${!escStateForAcct.product?' selected':''}>— product —</option>
          ${ESC_PRODUCTS.map(p=>`<option value="${esc(p)}"${escStateForAcct.product===p?' selected':''}>${esc(p)}</option>`).join('')}
        </select>
      </div>
      <p class="mini" style="font-weight:700;color:var(--ink);margin-bottom:6px">Actionable steps <span class="hint">${escStepProgress(escStateForAcct.steps)}% complete</span></p>
      <div class="progress" style="margin-bottom:10px"><i style="width:${escStepProgress(escStateForAcct.steps)}%"></i></div>
      ${(escStateForAcct.steps||[]).map(s=>`<div class="tapstep${s.done?' done':''}"><input type="checkbox" ${s.done?'checked':''} onchange="toggleEscStep('${a.id}','${s.id}',this.checked)"><span>${esc(s.label)}</span></div>`).join('')}
      <p class="mini" style="font-weight:700;color:var(--ink);margin:14px 0 6px">Notes &amp; event history</p>
      <textarea class="notes-in" id="noteIn" placeholder="Add an update note — what happened, what's next…"></textarea>
      <div class="row-actions" style="margin-top:6px"><button class="btn" onclick="addEscNote('${a.id}',document.getElementById('noteIn').value);openAcct('${a.id}')">Add note</button></div>
      <div class="tl" style="margin-top:12px">${(escStateForAcct.log&&escStateForAcct.log.length)?escStateForAcct.log.slice().reverse().map(l=>`<div class="ev"><div class="t">${new Date(l.t).toLocaleString()}</div><div>${esc(l.note)}</div></div>`).join(''):'<span class="mini">No updates logged yet.</span>'}</div>
    </div>
  </div>`;
}
function showOverlay(){ const o=$('#overlay'); if(o) o.classList.add('show'); const s=$('#sheet'); if(s&&s.parentElement) s.parentElement.scrollTop=0; wrapWideTables(); }
function closeSheet(){ const o=$('#overlay'); if(o) o.classList.remove('show'); }
(function bindOverlayClose(){
  const o=$('#overlay');
  if(!o) return;
  o.addEventListener('click',e=>{ if(e.target.id==='overlay') closeSheet(); });
})();

// ---- View-as-CSM auto-filter (Gainsight: dashboards auto-filter to the user) ----
function setOwnerFilter(v){ ownerFilter=v; route(); }

// ---- Renewal Readiness (Gainsight: Renewals / 'Renewal Readiness') ----
function readinessChecklist(a){
  const st=a.opps[0]?a.opps[0].stage:'';
  return [
    ['Active renewal opportunity', a.opps.length>0],
    ['Deal past early stage', !EARLY.has(st)],
    ['No open high/urgent cases', (a.highCases||0)===0],
    ['Engaged in last 90 days', a.dsAct!=null && a.dsAct<=90],
    ['Success plan created', !!plans[a.id]],
    ['Health 60 or above', a.health>=60]
  ];
}
function readinessScore(a){ const c=readinessChecklist(a); return Math.round(c.filter(x=>x[1]).length/c.length*100); }
function readyPill(v){ const cls=v>=80?'p-green':v>=50?'p-amber':'p-red'; return `<span class="pill ${cls}">${v}%</span>`; }

// ---- CTAs / Calls to Action (Gainsight: CTAs — TAP refreshes, CS-specific requests, onboarding, renewals) ----
const CTA_TYPES=['Onboarding','Renewal','TAP Refresh','CS Request','Risk','Adoption'];
function cid(){ return 'c'+Math.random().toString(36).slice(2,9); }
function autoCtas(accts){
  const out=[];
  accts.forEach(a=>{
    if(newLogo(a) && !plans[a.id]) out.push({acctId:a.id,name:a.name,type:'Onboarding',title:`Kick off onboarding for new logo ${a.name}`,priority:'High',reason:'New logo without a success plan'});
    if(a.dclose<=90 && a.readiness<70) out.push({acctId:a.id,name:a.name,type:'Renewal',title:`Advance renewal readiness for ${a.name}`,priority:'High',reason:`Renewal in ${a.dclose>9000?'—':a.dclose+'d'} · ${a.readiness}% ready`});
    if(a.highCases>0) out.push({acctId:a.id,name:a.name,type:'Risk',title:`Resolve ${a.highCases} high/urgent case(s) at ${a.name}`,priority:'High',reason:'Open high/urgent support cases'});
    if(a.dsAct!=null && a.dsAct>120 && a.tier!=='healthy') out.push({acctId:a.id,name:a.name,type:'Adoption',title:`Re-engage ${a.name}`,priority:'Medium',reason:`No activity in ${a.dsAct} days`});
  });
  return out.filter(o=>!ctas.some(c=>c.acctId===o.acctId && c.type===o.type && c.status!=='Done'));
}
function ctaTypePill(t){ return `<span class="pill p-gray">${esc(t)}</span>`; }
function ctaStPill(s){ const m={Open:'p-red','In Progress':'p-amber',Done:'p-green'}; return `<span class="pill ${m[s]||'p-gray'}">${s}</span>`; }
let ctaKpiFilter=null; // null | 'open' | 'high' | 'overdue' — set by clicking a KPI tile
function setCtaKpi(k){ ctaKpiFilter = ctaKpiFilter===k?null:k; route(); }
function focusSuggestions(){ const el=document.getElementById('ctaSuggestions'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }

// ---- Bulk-apply CTAs (admin / manager) ----
// Manager-controlled: pick a set of accounts (by filter and/or hand-picking) and
// stamp the same CTA on all of them at once — e.g. "kick off Q3 business reviews"
// across every Enterprise account, or a risk sweep across at-risk renewals.
let bulkAdmin = LS.get('adminMode', false);
let bulkFilter = {segment:'',tier:'',owner:'',flag:''};   // session-only
const BULK_FLAGS=[['','Any account'],['atrisk','At-risk / watch health'],['renew90','Renewal within 90 days'],['newlogo','New logos'],['highcases','Open high/urgent cases'],['opp','Has an open opportunity']];
function toggleAdmin(v){ bulkAdmin=!!v; LS.set('adminMode',bulkAdmin); route(); }
function setBulkFilter(k,v){ bulkFilter[k]=v; route(); }
function bulkCandidates(accts){
  return accts.filter(a=>{
    if(bulkFilter.segment && (a.segment||'')!==bulkFilter.segment) return false;
    if(bulkFilter.tier && a.tier!==bulkFilter.tier) return false;
    if(bulkFilter.owner && a.ownerName!==bulkFilter.owner) return false;
    switch(bulkFilter.flag){
      case 'atrisk': if(a.tier==='healthy') return false; break;
      case 'renew90': if(!(a.dclose!=null && a.dclose<=90)) return false; break;
      case 'newlogo': if(!newLogo(a)) return false; break;
      case 'highcases': if(!(a.highCases>0)) return false; break;
      case 'opp': if(!(a.opps&&a.opps.length>0)) return false; break;
    }
    return true;
  }).sort((a,b)=> b.riskARR-a.riskARR);
}
function bulkSelectAll(check){ document.querySelectorAll('#bulkCtaList input[type=checkbox]').forEach(cb=>{ cb.checked=!!check; }); }
function applyBulkCtas(){
  const type=$('#bulkCtaType').value, pri=$('#bulkCtaPri').value, due=$('#bulkCtaDue').value;
  const title=($('#bulkCtaTitle').value||'').trim();
  const ids=[...document.querySelectorAll('#bulkCtaList input[type=checkbox]:checked')].map(cb=>cb.value);
  if(!ids.length){ toast('Select at least one account.'); return; }
  if(!title){ toast('Add a short description for the CTA.'); return; }
  let added=0, skipped=0;
  ids.forEach(acctId=>{
    if(ctas.some(c=>c.acctId===acctId && c.type===type && c.status!=='Done')){ skipped++; return; }
    const a=STATE.accounts.find(x=>x.id===acctId);
    ctas.push({id:cid(),type,acctId,name:a?a.name:'',priority:pri,due,title,status:'Open',source:'Bulk',createdAt:new Date().toISOString()});
    added++;
  });
  saveCtas();
  toast(`Applied CTA to ${added} account${added===1?'':'s'}${skipped?` · skipped ${skipped} with an open ${type} CTA`:''}.`);
  route();
}
function bulkCtaCard(accts){
  if(!bulkAdmin){
    return `<div class="card" style="box-shadow:none;border-style:dashed;margin:0 0 16px"><h3 style="border:none;margin:0 0 6px">Bulk-apply CTAs <span class="hint">manager / admin</span></h3>
      <p class="mini" style="margin:0 0 10px">Stamp the same CTA across a set of accounts at once — filter by segment, health, owner or risk, then hand-pick. Turn on manager mode to use it.</p>
      <button class="btn" onclick="toggleAdmin(true)">Enable manager mode</button></div>`;
  }
  const segs=[...new Set(accts.map(a=>a.segment).filter(Boolean))].sort();
  const owners=[...new Set(accts.map(a=>a.ownerName).filter(Boolean))].sort();
  const cand=bulkCandidates(accts);
  const opt=(cur,list)=>list.map(([v,l])=>`<option value="${esc(v)}"${cur===v?' selected':''}>${esc(l)}</option>`).join('');
  return `<div class="card" id="bulkCtaCard" style="box-shadow:none;border:1px solid var(--line);margin:0 0 16px">
    <h3>Bulk-apply CTAs <span class="hint">manager / admin · one action across many accounts</span></h3>
    <div class="row-actions" style="margin:0 0 12px"><span class="mini">Manager mode on.</span><button class="btn sm" onclick="toggleAdmin(false)">Turn off</button></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <select class="select" onchange="setBulkFilter('segment',this.value)"><option value="">All segments</option>${segs.map(s=>`<option value="${esc(s)}"${bulkFilter.segment===s?' selected':''}>${esc(s)}</option>`).join('')}</select>
      <select class="select" onchange="setBulkFilter('tier',this.value)">${opt(bulkFilter.tier,[['','All health'],['healthy','Healthy'],['watch','Watch'],['atrisk','At-risk']])}</select>
      <select class="select" onchange="setBulkFilter('owner',this.value)"><option value="">All CSMs</option>${owners.map(o=>`<option value="${esc(o)}"${bulkFilter.owner===o?' selected':''}>${esc(o)}</option>`).join('')}</select>
      <select class="select" onchange="setBulkFilter('flag',this.value)">${opt(bulkFilter.flag,BULK_FLAGS)}</select>
    </div>
    <div class="row-actions" style="margin-bottom:6px"><b class="mini">${cand.length} account${cand.length===1?'':'s'} match</b><button class="btn sm" onclick="bulkSelectAll(true)">Select all</button><button class="btn sm" onclick="bulkSelectAll(false)">Clear</button></div>
    <div id="bulkCtaList" class="bulk-list">
      ${cand.length?cand.map(a=>`<label class="bulk-row"><input type="checkbox" value="${a.id}" checked><span class="bulk-name">${esc(a.name)} ${stateTag(a)}</span><span class="mini">${ownerCell(a.ownerName)} · ${segmentPill(a)} ${tierPill(a.tier)} · renewal ${a.dclose>9000?'—':a.dclose+'d'}</span></label>`).join(''):'<p class="mini">No accounts match these filters in the current scope.</p>'}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px">
      <select class="select" id="bulkCtaType">${CTA_TYPES.map(t=>`<option>${t}</option>`).join('')}</select>
      <select class="select" id="bulkCtaPri"><option>High</option><option selected>Medium</option><option>Low</option></select>
      <input type="date" class="select" id="bulkCtaDue" value="${sfDate(new Date(Date.now()+14*864e5))}">
      <input type="text" id="bulkCtaTitle" placeholder="What needs to happen on each account?" style="flex:1;min-width:240px;border:1px solid var(--line);padding:8px 12px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
      <button class="btn primary" onclick="applyBulkCtas()">Apply to selected</button>
    </div>
    <p class="mini" style="margin-top:8px;color:var(--muted)">Accounts that already have an open CTA of the same type are skipped automatically.</p>
  </div>`;
}
function viewCTAs(accts){
  const inS=new Set(accts.map(a=>a.id));
  const mine=ctas.filter(c=> !c.acctId || inS.has(c.acctId));
  const open=mine.filter(c=>c.status!=='Done');
  const high=open.filter(c=>c.priority==='High').length;
  const today=sfDate(new Date());
  const overdue=open.filter(c=>c.due && c.due<today).length;
  const suggestions=autoCtas(accts);
  const ownerAccts=[...accts].sort((a,b)=>a.name<b.name?-1:1);
  const kpis=[['Open CTAs',open.length,'assigned & in-flight','open'],['High priority',high,'open & urgent','high'],['Overdue',overdue,'past the due date','overdue'],['Auto-suggested',suggestions.length,'from live signals','suggested']];
  let rows=[...mine].sort((a,b)=> (a.status==='Done'?1:0)-(b.status==='Done'?1:0) || (a.due||'zzz').localeCompare(b.due||'zzz'));
  if(ctaKpiFilter==='open') rows=rows.filter(c=>c.status!=='Done');
  else if(ctaKpiFilter==='high') rows=rows.filter(c=>c.status!=='Done'&&c.priority==='High');
  else if(ctaKpiFilter==='overdue') rows=rows.filter(c=>c.due&&c.due<today&&c.status!=='Done');
  return `<div class="card"><h3>Calls to Action (CTAs) <span class="hint">action items for CSMs — onboarding, TAP refreshes, renewals, product requests · click a tile to filter</span></h3>
  <div class="kpis" style="margin-bottom:14px">${kpis.map(k=>`<div class="kpi clickable${ctaKpiFilter===k[3]?' selected':''}" onclick="${k[3]==='suggested'?'focusSuggestions()':`setCtaKpi('${k[3]}')`}"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  <div class="card" style="box-shadow:none;border-style:dashed;margin:0 0 16px"><h3 style="border:none;margin:0 0 10px">Log a CTA</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select class="select" id="ctaType">${CTA_TYPES.map(t=>`<option>${t}</option>`).join('')}</select>
      <select class="select" id="ctaAcct"><option value="">— account (optional) —</option>${ownerAccts.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
      <select class="select" id="ctaPri"><option>High</option><option selected>Medium</option><option>Low</option></select>
      <input type="date" class="select" id="ctaDue" value="${sfDate(new Date(Date.now()+14*864e5))}">
      <input type="text" id="ctaTitle" placeholder="What needs to happen?" style="flex:1;min-width:220px;border:1px solid var(--line);padding:8px 12px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
      <button class="btn primary" onclick="addCta()">Add CTA</button>
    </div>
    <p class="mini" style="margin-top:8px;color:var(--muted)">TAP refresh data isn't tracked here yet, so log TAP CTAs here manually for now.</p>
  </div>
  ${bulkCtaCard(accts)}
  ${suggestions.length?`<div class="card" id="ctaSuggestions" style="box-shadow:none;margin:0 0 16px"><h3>Suggested CTAs <span class="hint">auto-detected from live signals · add the ones worth tracking</span></h3>
    <table><thead><tr><th>Type</th><th>Action</th><th>Why</th><th></th></tr></thead><tbody>
    ${suggestions.slice(0,40).map(s=>`<tr><td>${ctaTypePill(s.type)}</td><td onclick="openAcct('${s.acctId}')" style="cursor:pointer"><b>${esc(s.title)}</b></td><td class="mini">${esc(s.reason)}</td><td><button class="btn sm" onclick="acceptAutoCta('${s.acctId}','${s.type}')">Add</button></td></tr>`).join('')}
    </tbody></table></div>`:''}
  <div class="card" style="box-shadow:none;margin:0"><h3>Tracked CTAs <span class="hint">${open.length} open of ${mine.length}${ctaKpiFilter?` · showing ${rows.length} filtered — `:''}${ctaKpiFilter?`<a href="#" onclick="setCtaKpi('${ctaKpiFilter}');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear filter</a>`:''}</span></h3>
    ${rows.length?`<table><thead><tr><th>Type</th><th>Action</th><th>Account</th><th>Priority</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(c=>`<tr><td>${ctaTypePill(c.type)}</td><td>${esc(c.title)}</td><td>${c.acctId?`<span onclick="openAcct('${c.acctId}')" style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)">${esc(c.name||'account')}</span>`:'<span class="mini">—</span>'}</td><td><span class="pill ${c.priority==='High'?'p-red':c.priority==='Medium'?'p-amber':'p-gray'}">${esc(c.priority)}</span></td><td class="mini" ${c.due&&c.due<today&&c.status!=='Done'?'style="color:var(--red);font-weight:700"':''}>${esc(c.due||'—')}</td><td>${ctaStPill(c.status)}</td><td class="row-actions">${c.status!=='Done'?`<button class="btn sm" onclick="ctaAction('${c.id}','${c.status==='Open'?'In Progress':'Done'}')">${c.status==='Open'?'Start':'Done'}</button>`:`<button class="btn sm" onclick="ctaAction('${c.id}','Open')">Reopen</button>`}<button class="btn sm" onclick="delCta('${c.id}')">✕</button></td></tr>`).join('')}
    </tbody></table>`:`<p class="mini">${ctaKpiFilter?'No tracked CTAs match this filter.':'No CTAs tracked yet. Add one above, or accept a suggestion.'}</p>`}
  </div>`;
}
function addCta(){
  const type=$('#ctaType').value, acctId=$('#ctaAcct').value, pri=$('#ctaPri').value, due=$('#ctaDue').value, title=($('#ctaTitle').value||'').trim();
  if(!title){ toast('Add a short description first.'); return; }
  const name = acctId ? ((STATE.accounts.find(a=>a.id===acctId)||{}).name||'') : '';
  ctas.push({id:cid(),type,acctId,name,priority:pri,due,title,status:'Open',source:'Manual',createdAt:new Date().toISOString()});
  saveCtas(); route();
}
function acceptAutoCta(acctId,type){
  const s=autoCtas(STATE.accounts).find(o=>o.acctId===acctId&&o.type===type);
  const a=STATE.accounts.find(x=>x.id===acctId);
  ctas.push({id:cid(),type,acctId,name:a?a.name:'',priority:s?s.priority:'Medium',due:sfDate(new Date(Date.now()+14*864e5)),title:s?s.title:(type+' action'),status:'Open',source:'Auto',createdAt:new Date().toISOString()});
  saveCtas(); route();
}
function ctaAction(id,status){ const c=ctas.find(x=>x.id===id); if(c){ c.status=status; saveCtas(); route(); } }
function delCta(id){ ctas=ctas.filter(x=>x.id!==id); saveCtas(); route(); }
function quickCta(id){ const t=prompt('New action item (CTA) for this account:'); if(!t) return; const a=STATE.accounts.find(x=>x.id===id); ctas.push({id:cid(),type:'CS Request',acctId:id,name:a?a.name:'',priority:'Medium',due:sfDate(new Date(Date.now()+14*864e5)),title:t.trim(),status:'Open',source:'Manual',createdAt:new Date().toISOString()}); saveCtas(); toast('CTA added — see the CTAs tab.'); }

// ---- Email Outreach (compose → review → send yourself) ----
// Suggests filled templates for customer + internal situations. The app never
// sends mail itself — CSMs edit the draft, confirm they've reviewed it, then
// copy or open in their mail client to send manually.
let emailDrafts = LS.get('emailDrafts',[]); // history of reviewed/copied drafts
function saveEmailDrafts(){ LS.set('emailDrafts',emailDrafts); }
let emailCompose = null; // {templateId,acctId,audience,to,cc,subject,body,confirmed}
let emailAudienceFilter = 'all'; // all | customer | internal
let emailTplMenuOpen = false;
function toggleEmailTplMenu(force){
  emailTplMenuOpen = force==null ? !emailTplMenuOpen : !!force;
  const menu=$('#emailTplMenu'), btn=$('#emailTplBtn');
  if(menu) menu.hidden=!emailTplMenuOpen;
  if(btn){ btn.setAttribute('aria-expanded', emailTplMenuOpen?'true':'false'); btn.classList.toggle('open', emailTplMenuOpen); }
}

const EMAIL_TEMPLATES=[
  {id:'cust_welcome',audience:'customer',name:'New logo welcome',desc:'Introduce yourself and kick off onboarding.',
    suggest:a=>newLogo(a),
    fill:ctx=>emailFillCustomer(ctx,'Welcome to Axon — next steps for '+ctx.accountName,
`Hi ${ctx.greetingName},

I'm ${ctx.csmName}, your Customer Success Manager at Axon. Welcome — we're glad ${ctx.accountName} is on board.

I'd like to schedule a short kickoff to:
• Confirm your goals for the first 90 days
• Introduce the Axon team supporting you
• Align on training, go-live, and how we'll measure success

Are you available for 30 minutes next week? Happy to work around your calendar.

Protect Life,
${ctx.csmName}${ctx.csmTitle}`)},
  {id:'cust_renewal',audience:'customer',name:'Renewal heads-up',desc:'Value recap as renewal approaches.',
    suggest:a=>a.dclose<=120&&a.dclose>0,
    fill:ctx=>emailFillCustomer(ctx,`${ctx.accountName} renewal — let's align ahead of ${ctx.renewalLabel}`,
`Hi ${ctx.greetingName},

I wanted to reach out ahead of your renewal (${ctx.renewalLabel}${ctx.renewalArr?`, ~${ctx.renewalArr} ARR`:''}).

Before paperwork starts, I'd like to schedule a value recap to:
• Review outcomes and adoption since last term
• Confirm priorities for the next period
• Surface any blockers early so we can clear them together

Would ${ctx.suggestWindow} work for a 30-minute working session?

Thanks,
${ctx.csmName}${ctx.csmTitle}`)},
  {id:'cust_tap',audience:'customer',name:'TAP refresh',desc:'Hardware warranty refresh outreach.',
    suggest:a=>a.tapStatus==='overdue'||a.tapStatus==='duesoon',
    fill:ctx=>emailFillCustomer(ctx,`TAP / hardware refresh for ${ctx.accountName}`,
`Hi ${ctx.greetingName},

I'm checking in on your TAP / hardware refresh for ${ctx.accountName}${ctx.tapLabel?` (${ctx.tapLabel})`:''}.

Refreshing on schedule protects warranty coverage and keeps devices in a supported state. I can walk through:
• What's due and recommended next steps
• Timing that minimizes operational impact
• Any RMAs or logistics we should line up now

Can we book 20 minutes this week to lock a plan?

Best,
${ctx.csmName}${ctx.csmTitle}`)},
  {id:'cust_save',audience:'customer',name:'Save play / risk check-in',desc:'Executive check-in when health or cases look strained.',
    suggest:a=>a.tier==='atrisk'||(a.casesBlocked||0)>0||(a.highCases||0)>0,
    fill:ctx=>emailFillCustomer(ctx,`Checking in — ${ctx.accountName}`,
`Hi ${ctx.greetingName},

I wanted to schedule a focused check-in on ${ctx.accountName}. A few signals suggest we should align sooner rather than later${ctx.riskBits?`: ${ctx.riskBits}`:'.'}.

My goals for the conversation:
• Understand what's getting in the way
• Align on owners and dates for the next actions
• Make sure the right Axon people are engaged

Would you be open to 30 minutes in the next few days?

Respectfully,
${ctx.csmName}${ctx.csmTitle}`)},
  {id:'cust_nps',audience:'customer',name:'NPS follow-up',desc:'Thank promoters or save detractors.',
    suggest:a=>a.nps!=null&&(a.nps<=6||a.nps>=9),
    fill:ctx=>{
      const det=ctx.nps!=null&&ctx.nps<=6;
      return emailFillCustomer(ctx, det?`Following up on your feedback — ${ctx.accountName}`:`Thank you for the feedback — ${ctx.accountName}`,
det?`Hi ${ctx.greetingName},

Thank you for taking the time on our recent survey (you scored us ${ctx.nps}/10). I take that feedback seriously and would like to understand what would make the partnership stronger.

Could we schedule a short call so I can listen, document the gaps, and come back with a concrete plan?

Appreciate you,
${ctx.csmName}${ctx.csmTitle}`
:`Hi ${ctx.greetingName},

Thank you for the ${ctx.nps}/10 on our recent survey — that means a lot to the team supporting ${ctx.accountName}.

If there's anyone else on your side who should hear about what's working (or a use case we should double down on), I'm happy to set that up.

Protect Life,
${ctx.csmName}${ctx.csmTitle}`);
    }},
  {id:'cust_product',audience:'customer',name:'Product / adoption update',desc:'Share a useful update or training nudge.',
    suggest:a=>a.dsAct!=null&&a.dsAct>90,
    fill:ctx=>emailFillCustomer(ctx,`Quick update for ${ctx.accountName}`,
`Hi ${ctx.greetingName},

Sharing a short update that may help ${ctx.accountName} get more value from the platform:

• [Insert product / feature / training highlight]
• Why it matters for teams like yours
• How we can help you roll it out (demo, office hours, or Academy path)

If useful, I can also pull a light usage snapshot and suggest 1–2 next steps.

Open to a brief sync?
${ctx.csmName}${ctx.csmTitle}`)},
  {id:'cust_followup',audience:'customer',name:'Meeting follow-up',desc:'Recap + next steps after a call.',
    suggest:()=>false,
    fill:ctx=>emailFillCustomer(ctx,`Follow-up — ${ctx.accountName}`,
`Hi ${ctx.greetingName},

Thanks for the time today. Quick recap and next steps:

Discussion highlights
• [Point 1]
• [Point 2]

Next steps
• ${ctx.csmName}: [action] — due [date]
• ${ctx.greetingName}: [action] — due [date]

I'll keep this on our success plan / next-step tracker as well. Ping me if I missed anything.

Thanks,
${ctx.csmName}${ctx.csmTitle}`)},
  {id:'int_handoff',audience:'internal',name:'Internal handoff / intro',desc:'Brief a TAM, AE, or peer on the account.',
    suggest:()=>false,
    fill:ctx=>emailFillInternal(ctx,`Handoff / context — ${ctx.accountName}`,
`Hi ${ctx.internalGreeting},

Sharing context on ${ctx.accountName} (CSM: ${ctx.csmName}).

Snapshot
• Renewal: ${ctx.renewalLabel}${ctx.renewalArr?` · ${ctx.renewalArr}`:''}
• Health: ${ctx.health}${ctx.nps!=null?` · NPS ${ctx.nps}/10`:''}
• Segment: ${ctx.segment}

What you need to know
• [Relationship / politics / blockers]
• [Open commitments]
• [Ask of you]

Happy to jump on a quick sync if useful.

Thanks,
${ctx.csmName}`)},
  {id:'int_escalation',audience:'internal',name:'Leadership escalation note',desc:'Internal alert when an account needs eyes.',
    suggest:a=>a.tier==='atrisk'||(a.casesBlocked||0)>0,
    fill:ctx=>emailFillInternal(ctx,`Escalation watch — ${ctx.accountName}`,
`Hi ${ctx.internalGreeting},

Flagging ${ctx.accountName} for awareness.

Why now
${ctx.riskBits?`• ${ctx.riskBits}`:'• Elevated risk signals on the book'}
• Renewal: ${ctx.renewalLabel}${ctx.renewalArr?` · ${ctx.renewalArr} ARR`:''}
• Health: ${ctx.health}

What I'm doing
• [Customer outreach / save play]
• [Support / product partners engaged]
• [Ask of leadership, if any]

I'll update after the next touch.

${ctx.csmName}`)},
  {id:'int_tap',audience:'internal',name:'TAP coordination (internal)',desc:'Align ops / fleet / TAM on a refresh.',
    suggest:a=>a.tapStatus==='overdue'||a.tapStatus==='duesoon',
    fill:ctx=>emailFillInternal(ctx,`TAP coordination — ${ctx.accountName}`,
`Hi ${ctx.internalGreeting},

Need help coordinating the TAP / hardware refresh for ${ctx.accountName}${ctx.tapLabel?` (${ctx.tapLabel})`:''}.

Ask
• Confirm logistics / owners
• Flag any known constraints from the field
• Align on customer-facing timing before I commit a date

Account CSM: ${ctx.csmName}

Thanks,
${ctx.csmName}`)},
  {id:'int_renewal',audience:'internal',name:'Renewal risk to manager',desc:'Internal heads-up on a soft renewal.',
    suggest:a=>a.dclose<=90&&a.readiness<70,
    fill:ctx=>emailFillInternal(ctx,`Renewal risk — ${ctx.accountName} (${ctx.renewalLabel})`,
`Hi ${ctx.internalGreeting},

Heads-up on ${ctx.accountName}: renewal is ${ctx.renewalLabel}${ctx.renewalArr?` (~${ctx.renewalArr})`:''} and readiness is currently soft (${ctx.readiness}% checklist).

Plan
• Customer value recap scheduled / to schedule
• Open risks: ${ctx.riskBits||'see Account 360'}
• Help needed: [coverage, exec sponsor, discounting guardrails, etc.]

I'll notify you if the forecast changes.

${ctx.csmName}`)},
  {id:'int_coaching',audience:'internal',name:'CSM coaching update',desc:'Manager ↔ rep note on scorecard / book health.',
    suggest:()=>false,
    fill:ctx=>emailFillInternal(ctx,`Coaching note — book update`,
`Hi ${ctx.internalGreeting},

Quick coaching / book update:

Wins
• [What went well]

Focus areas
• [Engagement / insights / growth / overdue work]

This week's commitments
• [1–3 concrete actions]

Account example (if useful): ${ctx.accountName||'—'}

${ctx.csmName}`)},
];

function emailFillCustomer(ctx,subject,body){
  const to=ctx.customerEmails.join(', ');
  return {to,cc:ctx.axonEmails.filter(e=>e!==to).slice(0,2).join(', '),subject,body};
}
function emailFillInternal(ctx,subject,body){
  // Prefer Axon roster emails; leave blank for the CSM to fill if none documented yet
  const to=ctx.axonEmails.join(', ')||ctx.ownerEmail||'';
  const cc=(ctx.csmEmail && ctx.axonEmails.indexOf(ctx.csmEmail)<0)?ctx.csmEmail:'';
  return {to,cc,subject,body};
}

function emailCtx(a){
  const t=a?teamFor(a.id):{axon:[],customer:[]};
  const cust=t.customer||[], axon=t.axon||[];
  const primary=cust[0];
  const greetingName=primary?primary.name.split(/\s+/)[0]:'there';
  const customerEmails=cust.map(m=>m.email).filter(Boolean);
  const axonEmails=axon.map(m=>m.email).filter(Boolean);
  const csmName=(a&&a.ownerName)||'Your CSM';
  const csmTitle=a&&a.ownerTitle?`, ${a.ownerTitle}`:'';
  const renewalLabel=a?(a.dclose>9000?'date TBD':(a.dclose<=0?'overdue':`in ${a.dclose} days`)):'—';
  const riskBits=[];
  if(a){
    if(a.tier==='atrisk') riskBits.push('account is at-risk on health');
    if(a.highCases) riskBits.push(`${a.highCases} high/urgent case(s)`);
    if(a.casesBlocked) riskBits.push(`${a.casesBlocked} blocked case(s)`);
    if(a.nps!=null&&a.nps<=6) riskBits.push(`NPS ${a.nps}/10`);
    if(a.dsAct!=null&&a.dsAct>90) riskBits.push(`${a.dsAct}d since last touch`);
  }
  const tapLabel=a&&a.tapStatus==='overdue'?'overdue':a&&a.tapStatus==='duesoon'?'due within 90 days':'';
  return {
    accountName:a?a.name:'[Account]',
    csmName, csmTitle, csmEmail:'',
    ownerEmail:'',
    greetingName,
    internalGreeting:axon[0]?axon[0].name.split(/\s+/)[0]:'team',
    customerEmails, axonEmails,
    renewalLabel,
    renewalArr:a&&a.renewalAmount?fmtMoney(a.renewalAmount):'',
    health:a?a.health:'—',
    nps:a?a.nps:null,
    readiness:a&&a.readiness!=null?a.readiness:a?readinessScore(a):null,
    segment:a?(a.segment||a.bookSegment||'—'):'—',
    riskBits:riskBits.join('; '),
    tapLabel,
    suggestWindow:'early next week',
  };
}

function buildEmailDraft(templateId,acctId){
  const tpl=EMAIL_TEMPLATES.find(t=>t.id===templateId); if(!tpl) return null;
  const a=acctId?STATE.accounts.find(x=>x.id===acctId):null;
  if(a) a.readiness=readinessScore(a);
  const filled=tpl.fill(emailCtx(a));
  return {
    templateId:tpl.id, audience:tpl.audience, acctId:acctId||'',
    to:filled.to||'', cc:filled.cc||'', subject:filled.subject||'', body:filled.body||'',
    confirmed:false
  };
}

function startEmailCompose(templateId,acctId){
  emailCompose=buildEmailDraft(templateId,acctId);
  if(!emailCompose){ toast('Template not found.'); return; }
  setTab('emails');
  // route() called by setTab; scroll to composer after paint
  setTimeout(()=>{ const el=document.getElementById('emailComposer'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); },60);
}
function composeEmailForAcct(acctId){
  try{
    const a=STATE.accounts.find(x=>x.id===acctId);
    if(!a){ toast('Account not found.'); return; }
    const suggested=EMAIL_TEMPLATES.find(t=>t.audience==='customer'&&typeof t.suggest==='function'&&t.suggest(a))
      || EMAIL_TEMPLATES.find(t=>t.id==='cust_followup');
    if(!suggested){ toast('No email template available.'); return; }
    closeSheet();
    startEmailCompose(suggested.id,acctId);
    toast('Draft ready — review it on Email Outreach, then send from your mail app.');
  }catch(err){
    console.error(err);
    toast('Could not open email draft — '+((err&&err.message)||err));
  }
}
function emailPickTemplate(templateId){
  if(!templateId) return;
  emailTplMenuOpen=false;
  const acctId=emailCompose&&emailCompose.acctId || ($('#emailAcctSel')&&$('#emailAcctSel').value)||'';
  emailCompose=buildEmailDraft(templateId,acctId);
  route();
  setTimeout(()=>{ const el=document.getElementById('emailComposer'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); },40);
}
function emailPickAcct(acctId){
  const templateId=(emailCompose&&emailCompose.templateId)||'cust_followup';
  emailCompose=buildEmailDraft(templateId,acctId||'');
  route();
}
function emailSetAudience(v){ emailAudienceFilter=v; route(); }
function emailSyncFields(){
  if(!emailCompose) return;
  const to=$('#emailTo'), cc=$('#emailCc'), sub=$('#emailSubject'), body=$('#emailBody'), conf=$('#emailConfirm');
  if(to) emailCompose.to=to.value;
  if(cc) emailCompose.cc=cc.value;
  if(sub) emailCompose.subject=sub.value;
  if(body) emailCompose.body=body.value;
  if(conf) emailCompose.confirmed=!!conf.checked;
}
function emailOnConfirmToggle(){
  emailSyncFields();
  const ready=!!(emailCompose&&emailCompose.confirmed);
  document.querySelectorAll('[data-email-send]').forEach(b=>{ b.disabled=!ready; });
}
function emailRequireConfirm(){
  emailSyncFields();
  if(!emailCompose){ toast('Pick a template first.'); return false; }
  if(!emailCompose.confirmed){ toast('Check the review box before sending yourself.'); return false; }
  if(!(emailCompose.subject||'').trim()){ toast('Add a subject line.'); return false; }
  if(!(emailCompose.body||'').trim()){ toast('Add a message body.'); return false; }
  return true;
}
function emailPlainText(){
  const d=emailCompose; if(!d) return '';
  return `To: ${d.to||'(add recipient)'}\nCc: ${d.cc||''}\nSubject: ${d.subject||''}\n\n${d.body||''}`.trim();
}
async function emailCopyAll(){
  if(!emailRequireConfirm()) return;
  const text=emailPlainText();
  try{
    await navigator.clipboard.writeText(text);
    emailRecordDraft('copied');
    toast('Copied — paste into Outlook or Gmail and send.');
  }catch(e){
    // Fallback for older browsers / insecure context
    const ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); emailRecordDraft('copied'); toast('Copied — paste into Outlook or Gmail and send.'); }
    catch(err){ toast('Could not copy — select the draft and copy manually.'); }
    ta.remove();
  }
}
function emailOpenMailto(){
  if(!emailRequireConfirm()) return;
  const d=emailCompose;
  const to=encodeURIComponent(d.to||'');
  const cc=encodeURIComponent(d.cc||'');
  const subject=encodeURIComponent(d.subject||'');
  let body=d.body||'';
  // mailto length safety — keep body reasonable
  if(body.length>1800) body=body.slice(0,1800)+'\n\n[Message truncated for mail app — use Copy if you need the full draft]';
  const href=`mailto:${to}?${cc?`cc=${cc}&`:''}subject=${subject}&body=${encodeURIComponent(body)}`;
  emailRecordDraft('mailto');
  window.location.href=href;
  toast('Opened your mail app — review once more, then send.');
}
function emailRecordDraft(action){
  if(!emailCompose) return;
  emailSyncFields();
  const a=STATE.accounts.find(x=>x.id===emailCompose.acctId);
  const tpl=EMAIL_TEMPLATES.find(t=>t.id===emailCompose.templateId);
  emailDrafts.unshift({
    id:cid(), t:new Date().toISOString(), action,
    templateId:emailCompose.templateId, templateName:tpl?tpl.name:emailCompose.templateId,
    audience:emailCompose.audience, acctId:emailCompose.acctId||'',
    acctName:a?a.name:'', subject:emailCompose.subject, to:emailCompose.to
  });
  emailDrafts=emailDrafts.slice(0,40);
  saveEmailDrafts();
  // Also log a light activity touch on the account when customer-facing, and
  // write it back to Salesforce the same way a manually-logged call/email is.
  if(emailCompose.audience==='customer'&&emailCompose.acctId){
    pushActivityEntry(emailCompose.acctId,'Email',emailCompose.subject||'(draft prepared)',`Prepared via Email Outreach (${action}) — sent manually by CSM after review.`);
    syncLastActFromActivity(emailCompose.acctId);
    if(a){ try{ scoreAccount(a); }catch(e){} }
  }
  route();
}
function emailClearCompose(){ emailCompose=null; route(); }

function emailSuggestedFor(accts){
  const out=[];
  accts.forEach(a=>{
    EMAIL_TEMPLATES.forEach(tpl=>{
      if(tpl.suggest(a)) out.push({a,tpl});
    });
  });
  // Prefer higher urgency templates first
  const rank={cust_save:0,int_escalation:1,cust_nps:2,cust_tap:3,int_tap:4,cust_renewal:5,int_renewal:6,cust_welcome:7,cust_product:8};
  out.sort((x,y)=>(rank[x.tpl.id]??99)-(rank[y.tpl.id]??99)||(y.a.riskARR||0)-(x.a.riskARR||0));
  // Dedupe account+template
  const seen=new Set();
  return out.filter(o=>{ const k=o.a.id+'|'+o.tpl.id; if(seen.has(k)) return false; seen.add(k); return true; });
}

function viewEmails(accts){
  const templates=EMAIL_TEMPLATES.filter(t=>emailAudienceFilter==='all'||t.audience===emailAudienceFilter);
  const ownerAccts=[...accts].sort((a,b)=>a.name<b.name?-1:1);
  const d=emailCompose;
  const tpl=d?EMAIL_TEMPLATES.find(t=>t.id===d.templateId):null;
  const hist=emailDrafts.slice(0,12);

  const custTpls=templates.filter(t=>t.audience==='customer');
  const intTpls=templates.filter(t=>t.audience==='internal');
  const menuGroup=(label,list)=>!list.length?'':`<div class="email-dd-group"><div class="email-dd-label">${esc(label)}</div>${list.map(t=>`<button type="button" class="email-dd-item${d&&d.templateId===t.id?' selected':''}" role="option" onclick="emailPickTemplate('${t.id}')"><span class="email-dd-item-title">${esc(t.name)}</span><span class="email-dd-item-desc">${esc(t.desc)}</span></button>`).join('')}</div>`;

  let html=`<div class="card"><h3>Email Outreach <span class="hint">filled templates · you review &amp; send yourself — the app never sends mail automatically</span></h3>
  <p class="mini" style="line-height:1.7">Open the template menu, scroll to pick one, choose an account, edit the draft, then check <b>I've reviewed this</b> to unlock Copy or Open in mail.</p>
  <div class="email-tpl-bar" style="margin-top:12px">
    <label class="mini">Show
      <select class="select" style="display:block;min-width:140px;margin-top:4px" onchange="emailTplMenuOpen=false;emailSetAudience(this.value)">
        <option value="all"${emailAudienceFilter==='all'?' selected':''}>All templates</option>
        <option value="customer"${emailAudienceFilter==='customer'?' selected':''}>Customer only</option>
        <option value="internal"${emailAudienceFilter==='internal'?' selected':''}>Internal only</option>
      </select>
    </label>
    <div class="email-dd" style="flex:1;min-width:260px">
      <span class="mini">Template</span>
      <button type="button" class="email-dd-btn${emailTplMenuOpen?' open':''}" id="emailTplBtn" aria-haspopup="listbox" aria-expanded="${emailTplMenuOpen?'true':'false'}" onclick="toggleEmailTplMenu()">
        <span class="email-dd-btn-text">${tpl?esc(tpl.name):'Choose a template…'}</span>
        <span class="email-dd-caret" aria-hidden="true">▾</span>
      </button>
      <div class="email-dd-menu" id="emailTplMenu" role="listbox"${emailTplMenuOpen?'':' hidden'}>
        ${menuGroup('Customer',custTpls)}
        ${menuGroup('Internal (Axon)',intTpls)}
        ${!templates.length?'<p class="mini" style="padding:12px">No templates in this filter.</p>':''}
      </div>
    </div>
  </div>
  ${tpl?`<p class="mini" style="margin-top:8px"><span class="pill ${tpl.audience==='customer'?'p-blue':'p-amber'}">${tpl.audience==='customer'?'Customer':'Internal'}</span> ${esc(tpl.desc)}</p>`:''}
  </div>`;

  html+=`<div class="card" id="emailComposer"><h3>Composer <span class="hint">${tpl?esc(tpl.name):'pick a template above to start'}${d&&d.acctId?` · ${esc((STATE.accounts.find(a=>a.id===d.acctId)||{}).name||'')}`:''}</span></h3>`;
  if(!d){
    html+=`<p class="mini">Choose a template from the dropdown above to generate a filled draft.</p></div>`;
  } else {
    html+=`<div class="email-compose">
      <label class="mini">Account<br>
        <select class="select" id="emailAcctSel" style="min-width:220px;margin-top:4px" onchange="emailPickAcct(this.value)">
          <option value="">— optional / general —</option>
          ${ownerAccts.map(a=>`<option value="${a.id}"${d.acctId===a.id?' selected':''}>${esc(a.name)}</option>`).join('')}
        </select>
      </label>
      <label class="mini">To<br><input id="emailTo" type="text" value="${esc(d.to)}" placeholder="name@agency.gov" style="width:100%;margin-top:4px;border:1px solid var(--line);padding:8px 10px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" oninput="emailSyncFields()"></label>
      <label class="mini">Cc<br><input id="emailCc" type="text" value="${esc(d.cc)}" placeholder="optional" style="width:100%;margin-top:4px;border:1px solid var(--line);padding:8px 10px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" oninput="emailSyncFields()"></label>
      <label class="mini">Subject<br><input id="emailSubject" type="text" value="${esc(d.subject)}" style="width:100%;margin-top:4px;border:1px solid var(--line);padding:8px 10px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" oninput="emailSyncFields()"></label>
      <label class="mini">Message<br><textarea id="emailBody" class="notes-in email-body" rows="14" oninput="emailSyncFields()">${esc(d.body)}</textarea></label>
      <label class="email-confirm"><input type="checkbox" id="emailConfirm"${d.confirmed?' checked':''} onchange="emailOnConfirmToggle()"> I've reviewed this draft and will send it myself from my email client</label>
      <div class="row-actions" style="margin-top:12px;flex-wrap:wrap">
        <button class="btn primary" data-email-send ${d.confirmed?'':'disabled'} onclick="emailCopyAll()">Copy for Outlook / Gmail</button>
        <button class="btn" data-email-send ${d.confirmed?'':'disabled'} onclick="emailOpenMailto()">Open in mail app</button>
        <button class="btn sm" onclick="emailClearCompose()">Clear</button>
      </div>
      <p class="mini" style="margin-top:10px;color:var(--muted)">Nothing is emailed from this app. After you send from your client, the draft is logged here${d.audience==='customer'?' and as Email activity on the account':''}.</p>
    </div></div>`;
  }

  if(hist.length){
    html+=`<div class="card"><h3>Recently prepared <span class="hint">local history — not proof of delivery</span></h3>
    <table><thead><tr><th>When</th><th>Template</th><th>Account</th><th>Subject</th><th>Action</th></tr></thead><tbody>
    ${hist.map(h=>`<tr><td class="mini">${new Date(h.t).toLocaleString()}</td><td><span class="pill ${h.audience==='customer'?'p-blue':'p-amber'}">${esc(h.templateName)}</span></td><td>${h.acctId?`<span onclick="openAcct('${h.acctId}')" style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)">${esc(h.acctName||'account')}</span>`:'<span class="mini">—</span>'}</td><td>${esc(h.subject)}</td><td class="mini">${esc(h.action)}</td></tr>`).join('')}
    </tbody></table></div>`;
  }
  return html;
}

// ---- misc ----
function filterTable(input,tblId){ const q=input.value.toLowerCase(); document.querySelectorAll('#'+tblId+' tbody tr').forEach(tr=>{ tr.style.display=tr.textContent.toLowerCase().includes(q)?'':'none'; }); }
function toast(m){ const host=$('#toastHost'); const d=document.createElement('div'); d.className='toast'; d.textContent=m; host.appendChild(d); setTimeout(()=>d.remove(),2600); }
function renderError(m){ $('#app').innerHTML=`<div class="err">${esc(m)}</div><p class="mini">This is usually a momentary hiccup. <button class="btn" onclick="boot()">Retry now</button></p>`; }

function loadingHTML(msg){ return '<div class="loading"><div class="spinner"></div><div>'+msg+'</div></div>'; }
function renderBackendErr(msg){
  $('#scopebar').style.display='none';
  $('#app').innerHTML=`<div class="err">Can\u2019t reach the Axon CS Command Center backend.</div>
  <div class="card" style="margin-top:8px"><h3>How to fix</h3>
  <p class="mini" style="line-height:1.8">${esc(msg||"The backend server isn't responding.")}</p>
  <p class="mini" style="line-height:1.8">1. Make sure the backend is running &mdash; from the project root, run <b>start.bat</b>, or from <b>axon-cs-command-center/backend</b> run <b>uvicorn app.main:app --reload --port 8420</b>.<br>
  2. View this page at the backend's own address (e.g. <b>http://127.0.0.1:8420/app.html</b>) rather than opening this file directly from disk.<br>
  3. For live Salesforce data, check <b>backend/.env</b> has <b>DATA_MODE=salesforce</b> plus <b>SF_USERNAME</b> / <b>SF_PASSWORD</b> / <b>SF_SECURITY_TOKEN</b> filled in, then restart the backend.</p>
  <button class="btn primary" onclick="restart()">Retry</button>
  </div>`;
}
let bootTries=0;
async function checkHealth(){
  const res = await fetch('/api/health');
  if(!res.ok) throw new Error('Health check failed ('+res.status+')');
  return res.json();
}
function setModeBadge(h){
  const el=$('#modeBadge'); if(!el) return;
  if(!h){ el.textContent='Backend unreachable'; el.className='modebadge down'; return; }
  if(h.dataMode==='salesforce'){ el.textContent='Live Salesforce'; el.className='modebadge live'; }
  else if(h.requestedMode==='salesforce' && !h.salesforceConfigured){ el.textContent='Mock data (Salesforce not configured)'; el.className='modebadge mock'; }
  else { el.textContent='Mock data'; el.className='modebadge mock'; }
}
function restart(){ bootTries=0; boot(); }
function boot(){
  $('#app').innerHTML=loadingHTML(bootTries?('Reconnecting to the backend… (attempt '+(bootTries+1)+' of 5)'):'Connecting — renewals, org hierarchy, purchase history &amp; support signals…');
  checkHealth().then(h=>{
    setModeBadge(h);
    bootTries=0;
    return load().catch(err=>{ err.isLoadError=true; throw err; });
  }).catch(e=>{
    console.error(e);
    const m=(e&&e.message)||String(e);
    if(e && e.isLoadError){ renderError('Could not load data — '+m+'.'); return; }
    setModeBadge(null);
    if(bootTries<4){ bootTries++; setTimeout(boot,2000); return; }
    renderBackendErr(m);
  });
}
window.boot=boot; window.restart=restart;

(function(){
  const who=$('#whoami');
  if(who && window.CURRENT_USER){
    const u=window.CURRENT_USER;
    who.textContent=(u.displayName||u.username)+(u.role&&u.role!=='csm'?' · '+u.role:'');
  }
})();

renderNav();
Object.assign(window,{setScope,openAcct,closeSheet,setRenewSort,setWeight,saveWeights,resetWeights,filterTable,toggleComm,addEscNote,setTab,
  setEscStatus,
  startEscalation,setEscReason,setEscProduct,toggleEscStep,
  setCsat,generateAllNewLogos,createOrOpenPlan,openPlan,setPlanObjectives,setPlanNotes,togglePlanMs,editPlanMsTitle,editPlanMsDue,addPlanMs,removePlanMs,regenPlan,delPlan,
  openPlanStep,setStepDetail,setStepNote,togglePlanStepDone,addStepResource,addStepResourceFromPicker,removeStepResource,planStepEmail,openTalkTrack,copyTalkTrack,regenPlanAs,
  setOwnerFilter,addCta,acceptAutoCta,ctaAction,delCta,quickCta,
  toggleAdmin,setBulkFilter,bulkSelectAll,applyBulkCtas,
  addInsight,delResource,submitResource,setTarget,setAdoptionCfg,setUsageKpi,
  logActivity,delActivity,saveNextStep,clearNextStep,
  openCsmDrilldown,openCsmImprove,runCsmImproveAction,
  startEmailCompose,composeEmailForAcct,emailPickTemplate,emailPickAcct,emailSetAudience,toggleEmailTplMenu,
  emailSyncFields,emailOnConfirmToggle,emailCopyAll,emailOpenMailto,emailClearCompose,toast});

boot();
