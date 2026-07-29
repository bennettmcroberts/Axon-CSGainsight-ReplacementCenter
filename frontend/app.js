"use strict";
const $ = s => document.querySelector(s);
const fmtMoney = n => n==null?'—':(n>=1e6?'$'+(n/1e6).toFixed(1)+'M':n>=1e3?'$'+Math.round(n/1e3)+'k':'$'+Math.round(n));
const fmtFull = n => n==null?'—':'$'+Math.round(n).toLocaleString();
const esc = s => (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Safe to interpolate into a single-quoted inline-JS attribute (onclick="fn('...')")
const attrStr = s => (s==null?'':String(s)).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
const fmtDate = d => d?new Date(d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'2-digit'}):'—';
// Deliberately just a snippet, not the full body - the Customer Contact
// Insights matrix is a scannable log of "an email happened," not a reader;
// full text still lives wherever the email itself was actually composed
// (the CTA/escalation detail page, Account 360's activity timeline).
const emailSnippet = text => { if(!text) return ''; const t=String(text).replace(/\s+/g,' ').trim(); return t.length>90?t.slice(0,90)+'…':t; };
function commPill(sub){ const m={Email:['Email','p-gray'],Call:['Call','p-amber'],ListEmail:['Bulk email','p-gray'],Task:['Note','p-gray'],Meeting:['Meeting','p-green'],Event:['Meeting','p-green']}; const x=m[sub]||[sub||'Activity','p-gray']; return `<span class="pill ${x[1]}">${x[0]}</span>`; }
function commSubject(s){ s=(s||'').replace(/^Email:\s*/i,''); return s.trim()||'(no subject)'; }
function cleanComm(d){ if(!d) return ''; let s=String(d); const bi=s.indexOf('Body:'); if(bi>=0 && bi<500) s=s.slice(bi+5); s=s.replace(/thread::[\s\S]*$/,'').replace(/---+\s*Original Message\s*---+[\s\S]*$/i,''); return s.replace(/\s+/g,' ').trim(); }
const PRODMAP={SAAS:'SaaS / Software (Evidence.com)',Cart:'Cartridges',Training:'Training',INTERVIEW:'Axon Interview','FLEX 2':'Flex 2',X26:'X26',COMMANDER:'Commander',BODYCAM3:'Axon Body Camera',FLEET:'Axon Fleet',AIR:'Axon Air'};
function prodName(f){ if(f==null||f==='') return 'Uncategorized'; if(PRODMAP[f]) return PRODMAP[f]; return String(f).toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()); }
function daysSince(d){ if(!d) return null; return Math.round((new Date()-new Date(d))/86400000); }

// ---------- chart colors ----------
// Validated categorical palette (dataviz skill's reference palette, re-stepped
// to this app's own light/dark surfaces - see NOTES.md). The first 5 slots
// mirror the --green/--blue/--amber/--violet/--red CSS tokens used everywhere
// else in the UI (styles.css / frontend-axon/styles.css); +magenta/aqua/orange
// extend to a full validated 8-hue set for the one wide categorical chart.
// window.AXON_THEME mirrors the existing branch used throughout this file
// (true = Axon primary UI's light-leaning values, false = classic UI's
// dark-leaning values) - not a live light/dark toggle.
const CHART_HUES = {
  green:   {light:'#008300', dark:'#008300'},
  blue:    {light:'#2a78d6', dark:'#3987e5'},
  amber:   {light:'#eda100', dark:'#c98500'},
  violet:  {light:'#4a3aa7', dark:'#9085e9'},
  red:     {light:'#e34948', dark:'#e66767'},
  magenta: {light:'#e87ba4', dark:'#d55181'},
  aqua:    {light:'#1baf7a', dark:'#199e70'},
  orange:  {light:'#eb6834', dark:'#d95926'},
  // Neutral "Other" bucket (see foldToOther) - matches the --muted2 token,
  // deliberately not one of the 8 identity hues above.
  gray:    {light:'#8a8a8a', dark:'#6f7080'},
};
const CATEGORICAL_ORDER = ['blue','green','magenta','amber','aqua','orange','violet','red'];
function chartHue(name){ return CHART_HUES[name][window.AXON_THEME?'light':'dark']; }
// hasOther=true forces the LAST color to the neutral gray (see foldToOther) -
// a folded "Other" bucket is never one of the 8 identity hues.
function categoricalPalette(n,hasOther){
  const arr=Array.from({length:n},(_,i)=>chartHue(CATEGORICAL_ORDER[i%CATEGORICAL_ORDER.length]));
  if(hasOther && n>0) arr[n-1]=chartHue('gray');
  return arr;
}
// Past ~8 categories, cycling a fixed hue set makes two unrelated categories
// share an identical color (misleading, not just "a lot of colors") - per the
// dataviz skill's rule, fold the long tail into a single "Other" bucket
// instead. list items must have {label, count}.
function foldToOther(list, maxSlots){
  if(list.length<=maxSlots) return {list, hasOther:false};
  const head=list.slice(0,maxSlots-1);
  const restCount=list.slice(maxSlots-1).reduce((s,b)=>s+b.count,0);
  return {list:[...head,{label:'Other',count:restCount}], hasOther:true};
}

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
  return `<div class="row-actions" style="margin-bottom:12px;flex-wrap:wrap;align-items:flex-end">
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
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Quarterly customer survey</h3>
    <p class="mini">This app doesn't send the survey for you — track whether one went out this quarter and log what came back.</p>
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
  return `<div class="card"><h3>Quarterly survey coverage <span class="hint">${esc(q)}</span></h3>
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
function productScorecardCardHtml(a){
  const fams=(intelCache[a.id]&&intelCache[a.id].famsRaw)||[];
  const rec=productScorecards[a.id]||{};
  if(!fams.length) return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Product-line scorecard</h3>
    <p class="mini">Open the Products Purchased card above once (loads real product-line data) to score goals/risk per product line here.</p>
  </div>`;
  const riskOpts=['healthy','watch','atrisk'];
  const riskLabel={healthy:'Healthy',watch:'Watch',atrisk:'At risk'};
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Product-line scorecard</h3>
    <table><thead><tr><th>Product family</th><th>Risk</th><th>Goal</th><th>Notes</th></tr></thead><tbody>
    ${fams.map(f=>{
      const fam=f.fam||'(unspecified)'; const r=rec[fam]||{goal:'',risk:'healthy',notes:''};
      return `<tr><td><b>${esc(prodName(fam))}</b></td>
        <td><select class="select" onchange="setProductScorecardField('${a.id}','${esc(fam)}','risk',this.value)">${riskOpts.map(o=>`<option value="${o}" ${o===r.risk?'selected':''}>${riskLabel[o]}</option>`).join('')}</select></td>
        <td><input type="text" class="select" value="${esc(r.goal)}" placeholder="What does the customer want from this product?" onchange="setProductScorecardField('${a.id}','${esc(fam)}','goal',this.value)"></td>
        <td><input type="text" class="select" value="${esc(r.notes)}" placeholder="Qualifying info" onchange="setProductScorecardField('${a.id}','${esc(fam)}','notes',this.value)"></td>
      </tr>`;
    }).join('')}
    </tbody></table>
  </div>`;
}
function teamRosterCard(a){
  const t=teamFor(a.id);
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Who's on this account</h3>
  <p class="mini">Named repeatedly in stakeholder research as one of the biggest gaps: cross-team blindness into who's talking to a customer, and customers not knowing who to contact. Document it here so it's visible to anyone who opens this account.</p>
  ${a.hasExecSponsor===false?`<div class="mini" style="color:var(--red);margin-bottom:8px">No executive sponsor on file — flagged on Accounts &amp; Risk.</div>`:''}
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
let currentCsmView = null; // CSM name of the profile page currently open, if one is
let currentRiskCardId = null; // acctId of the expanded risk card in #sheet, if one is open
let commsCache = {};
let intelCache = {};
// ---- Product-line scorecard (org-config-gated - orgFeatureFlags.productLineScorecard) ----
// LE's own ask: goals/risk/qualifying info tracked per product family, off
// the exact same real Product2.Family purchase data Account 360 already
// fetches (intelCache[id].famsRaw) - not a bulk N+1 fetch across the whole
// book, just what's been captured as CSMs actually visit accounts.
let productScorecards = LS.get('productScorecards',{}); // acctId -> {family:{goal,risk,notes,updatedAt}}
function saveProductScorecards(){ LS.set('productScorecards',productScorecards); }
function setProductScorecardField(acctId,family,field,value){
  productScorecards[acctId]=productScorecards[acctId]||{};
  productScorecards[acctId][family]=productScorecards[acctId][family]||{goal:'',risk:'healthy',notes:''};
  productScorecards[acctId][family][field]=value;
  productScorecards[acctId][family].updatedAt=new Date().toISOString();
  saveProductScorecards();
}
function acctProductRiskRollup(acctId){
  const rec=productScorecards[acctId]||{}; const fams=Object.keys(rec);
  return {total:fams.length, atRisk:fams.filter(f=>rec[f].risk==='atrisk').length, watch:fams.filter(f=>rec[f].risk==='watch').length, healthy:fams.filter(f=>rec[f].risk==='healthy').length};
}

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
      casesBlocked:0, casesAging:0, growth:{Renewal:0,Expansion:0,Transactional:0}, usage:null,
      // Account Foundations (industry/employee count) - informational only, not
      // sourced from a live query yet (no Industry/EmployeeCount SOQL column
      // confirmed in the org); derived deterministically from the account id so
      // it's stable across reloads instead of re-randomizing every render.
      industry:'Public Safety', employeeCount:50+Math.floor(mulberry32(hashStr(o.AccountId))()*4950),
      // Contact roster (Executive Sponsor persona) and Event (QBR cadence) and
      // Contract (notice period) - none of these are live-queried yet either;
      // default to "no signal" so real accounts never falsely fire these until
      // a real data source is wired up. Only the demo seed below (non-Test10
      // pilot accounts already used for the aging-trigger demo) sets them.
      hasExecSponsor:true, qbrDaysOverdue:null, contractEnd:null, noticePeriodDays:null
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
  if(riskTest10 && test10Snapshot && TEST10_ACCOUNTS.includes(a.name) && !(test10Revealed[a.id]&&test10Revealed[a.id].npsCsat)) return {v:null, src:'blanked'};
  if(csat[a.id]!=null) return {v:csat[a.id], src:'manual'};
  // Sandbox override: Test10 accounts never fall back to the mock sentiment
  // placeholder - CSAT for these 10 only ever comes from an actual synced
  // survey response (csat[a.id] above) or stays blank, same "no existing
  // data until it's actually fed in" rule as everything else in Test10.
  if(riskTest10 && TEST10_ACCOUNTS.includes(a.name)) return {v:null, src:'none'};
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
  // Account-level engagement descriptor fields (Client Engagement revamp) - plain
  // aliases over the existing dsAct/lastAct/SEGMENT_CADENCE computation above, so
  // there's exactly one source of truth for "how overdue is this account".
  a.lastEngagementDate = a.lastAct || null;
  a.expectedCadenceDays = SEGMENT_CADENCE[a.segment] || 60;
  a.daysSinceLastTouch = dsAct;
  if(dsAct==null || dsAct>180){ pen+=WEIGHTS.engage; comps.push([dsAct==null?'No engagement logged on account':('No activity in '+dsAct+' days'),-WEIGHTS.engage]); }
  else if(dsAct>90){ const p=Math.round(WEIGHTS.engage*0.5); pen+=p; comps.push(['Light engagement ('+dsAct+'d since last touch)',-p]); }
  const score=Math.max(0,Math.min(100,Math.round(100-pen)));
  a.health=score; a.comps=comps; a.dclose=d;
  a.tier = score>=75?'healthy':score>=50?'watch':'atrisk';
  a.riskARR = a.renewalAmount*(100-score)/100;
  return a;
}
function computeAll(){ STATE.accounts.forEach(a=>{ syncLastActFromActivity(a.id); scoreAccount(a); }); refreshCsat(); rebuildEsc(); seedMockCsatQuarter(); seedDemoObjectExtensions(); seedNpsHistoryForTrend(); evaluateRiskTriggers(); seedDemoAgingTriggers(); resetTest10RiskBaseline(); migrateCtaStepsForBranchCategories(); applyTest10DataBlanking(); }
// Guarantees the 10 NPS/CSAT pilot accounts always start Stable on the risk
// board, every session - wipes any triggers/overrides/churn status the
// engine or a prior session attached to them, so this is always a clean,
// reproducible starting point for walking through the 5 stages live.
function resetTest10RiskBaseline(){
  const ids=new Set(TEST10_ACCOUNTS.map(name=>{ const a=STATE.accounts.find(x=>x.name===name); return a?a.id:null; }).filter(Boolean));
  if(!ids.size) return;
  triggerEvents=triggerEvents.filter(t=>!ids.has(t.accountId));
  riskOverrides=riskOverrides.filter(o=>!ids.has(o.accountId));
  ids.forEach(id=>{ delete churnedAccounts[id]; delete escState[id]; }); // clear any stale escalation record too, not just the derived trigger
  // Also wipe any CTA/escalation records left over from a previous test
  // session - these live in their own store (engagementCtas) and are never
  // otherwise touched by a trigger-event wipe, so without this line old
  // CTAs kept accumulating forever even though the risk board itself reset
  // to a clean Stable baseline on every reload.
  engagementCtas=engagementCtas.filter(c=>!ids.has(c.accountId));
  // Success Plans auto-generate the moment anyone opens a Plans page for an
  // account with none on file (see openPlan) - without wiping them here too,
  // a plan created by simply viewing the tab once (in an earlier session, or
  // by accident) would sit in Worklist forever, contradicting the "clean
  // Test10 baseline every session, nothing until it's actually triggered"
  // guarantee this function otherwise provides for triggers/CTAs/escalations.
  ids.forEach(id=>{ delete plans[id]; });
  // Email Outreach, Customer Contact Insights and Customer Success Emails are
  // all just different filtered views over this one shared send/receive log
  // (see contactLogEntries/viewGong and viewCsEmails) - without wiping it
  // here too, a Test10 reset left every prior run's sent/received emails
  // sitting in all three views forever, even though the CTAs/escalations
  // that generated them had already been cleared above. Account Outcomes
  // needs no separate wipe - it's purely derived from plans + a.nps, both
  // already reset above/by the NPS blanking pipeline.
  emailDrafts=emailDrafts.filter(d=>!ids.has(d.acctId));
  // Predictive Insights (keyed acctId__quarter) are generated content too -
  // without wiping these, a Test10 reset left last run's "review of the
  // past"/timeline sitting there already-generated, so the demo couldn't
  // show the real "Generate predictive insight" moment again from scratch.
  Object.keys(predictiveInsights).forEach(key=>{ if(ids.has(key.split('__')[0])) delete predictiveInsights[key]; });
  saveTriggerEvents(); saveRiskOverrides(); saveChurnedAccounts(); LS.set('escState',escState);
  saveEngagementCtas(); savePlans(); saveEmailDrafts(); savePredictiveInsights();
  STATE.escList=(STATE.escList||[]).filter(e=>!ids.has(e.acctId));
}
// Predictive Insights (3rd prong, alongside reactive escalations / proactive
// CTAs): not an email-sending workflow - it's an analysis. Every account is
// in scope; "generating" an insight reviews the account's own history,
// compares it against similar accounts, and proposes a forward-looking
// relationship timeline. No risk trigger behind any of it, and no
// email/chevron stepper - just a review, an analysis, and a proposal.
// Keyed by "acctId__YYYY-Qn" (see predictiveKey) rather than just acctId -
// insights run on the same quarterly cycle as the survey/plan cadence, so
// each quarter gets its own generated insight instead of one that lasts forever.
let predictiveInsights = LS.get('predictiveInsights',{}); // key -> {quarter, generatedAt, pastReview, analysis, similar:[{name,note}], timeline:[{when,action,detail,emailTemplate}]}
function savePredictiveInsights(){ LS.set('predictiveInsights',predictiveInsights); }
function predictiveKey(acctId,qKey){ return acctId+'__'+qKey; }
function predictiveInsightFor(acctId,qKey){ return predictiveInsights[predictiveKey(acctId,qKey)]||null; }
// Smart default before the shared quarter toggle has ever been touched -
// tied to the same unified Test10 flag: Test10 on = live pilot quarter
// (where the pilot's real data lives), Test10 off = the prior quarter (where
// the seeded full-book mock data lives). Once a user picks any quarter via
// the toggle, globalQSel overrides this everywhere, uniformly.
function defaultQSel(){ const q=riskTest10?PILOT_QUARTER:MOCK_QUARTER; const [y,qq]=q.split('-Q'); return {year:+y,q:+qq}; }
const PREDICTIVE_TOUCH_TYPES=['a training session','an onboarding check-in','a support case follow-up','a renewal/contract call'];
const PREDICTIVE_PEER_OUTCOMES=[
  'a quarterly relationship check-in with no open agenda measurably improved renewal confidence',
  'proactively looping in a second stakeholder reduced single-threading risk before it became a problem',
  'an early value-recap conversation surfaced an expansion opportunity nobody had asked about',
  'scheduling the next QBR before it was overdue kept the account from ever showing a cadence gap',
];
// Deterministic per-account "review of the past" - reads the account's own
// real fields (last touch, sentiment, exec sponsor) rather than fabricating
// unrelated data, and only invents the one thing with no real source yet
// (what kind of contact it was).
function predictiveGeneratePastReview(a,rnd){
  const lastType=PREDICTIVE_TOUCH_TYPES[Math.floor(rnd()*PREDICTIVE_TOUCH_TYPES.length)];
  const touchLine = a.daysSinceLastTouch!=null ? `Last logged contact was ${a.daysSinceLastTouch} days ago (${lastType}).` : `No logged contact on file yet.`;
  return `${touchLine} Historically, engagement with this account has centered on transactional or support topics — there's a clear opening to shift toward a more proactive, relationship-first rhythm going forward.`;
}
function predictiveGenerateAnalysis(a){
  const sentLabel=a.sentTier==='pos'?'positive':a.sentTier==='neg'?'strained':a.sentTier==='neu'?'neutral':'unknown';
  const dealsLine=a.pastDeals?` and ${a.pastDeals} closed-won deal(s) already on the books`:'';
  return `Looking ahead, ${a.name} is well-positioned to deepen the relationship — ${sentLabel} sentiment${dealsLine} give a real foundation to build on.${a.hasExecSponsor===false?' Confirming an executive sponsor would strengthen that foundation further.':''}${a.qbrDaysOverdue?' A fresh QBR is a natural next step to re-anchor the cadence.':''}`;
}
// "Similar cases" - other real accounts in the same segment, each paired
// with a plausible relationship-building outcome (the one part with no real
// source yet, since there's no historical outcome-tracking system).
function predictiveGenerateSimilar(a,rnd){
  const peers=STATE.accounts.filter(x=>x.id!==a.id && x.segment===a.segment)
    .sort(()=>rnd()-0.5).slice(0,2);
  return peers.map((p,i)=>({name:p.name,note:PREDICTIVE_PEER_OUTCOMES[Math.floor(rnd()*PREDICTIVE_PEER_OUTCOMES.length)]}));
}
// Each step is tagged with the email template it implies sending, where the
// best next action really is "send an email" - reusing the same templates
// the risk-trigger engine already sends (cust_checkin/cust_product/
// cust_expansion), so a step that implies email jumps straight into a real
// draft. Steps with no natural email (an internal review, a scheduling
// check) carry no template - those open the plain step-detail view instead.
// If the account currently has a live risk signal on Accounts & Risk (Early
// Signal/Elevated/Active Risk - anything short of Stable/Churned), that
// becomes step one, ahead of any relationship-building step - you can't
// credibly propose "strengthen the relationship" while a real problem is
// sitting open. That step implies neither an email nor an internal task; it
// jumps straight into the account's actual escalation/CTA record.
// Shared between the local deterministic generator and the real-AI path -
// the "address the active risk signal" step is a routing/data fact (which
// account, which stage), never something worth asking the model to invent,
// so both paths prepend the exact same deterministic step rather than
// leaving it up to whatever the model happens to produce.
function predictiveRiskStepFor(a){
  const stage=getRiskStage(a);
  if(stage==='healthy'||stage==='churned') return [];
  return [{when:'Now',action:'Address the active risk signal',detail:`This account currently has an active ${RISK_STAGE_LABELS[stage]} signal on Accounts & Risk — worth closing out first so the relationship-building steps below land on solid ground.`,emailTemplate:null,impliesEngagement:true}];
}
function predictiveGenerateTimeline(a,similar){
  const riskStep=predictiveRiskStepFor(a);
  return [
    ...riskStep,
    {when:'Week 1',action:'Relationship check-in call',detail:'No agenda tied to any open issue — purely to strengthen the relationship.',emailTemplate:'cust_checkin'},
    {when:'Week 3',action:'Loop in a second stakeholder',detail:similar.length?`Reduce single-threading risk — ${similar[0].name} saw this help.`:'Reduce single-threading risk on this account.',emailTemplate:null},
    {when:'Week 5',action:'Share a value recap',detail:'Highlight adoption wins and ROI since the last renewal.',emailTemplate:'cust_product'},
    {when:'Week 7',action:'Confirm executive sponsor coverage',detail:a.hasExecSponsor===false?'No sponsor currently on file — identify and confirm one internally before reaching out.':'Internal check that the sponsor relationship is still current.',emailTemplate:null},
    {when:'Week 9',action:'Explore expansion interest',detail:'Low-pressure conversation, not a formal pitch.',emailTemplate:'cust_expansion'},
    {when:'Week 12',action:'Quarterly relationship touch',detail:'Repeat the cadence — no agenda tied to any open issue.',emailTemplate:'cust_checkin'},
  ];
}
function generatePredictiveInsight(acctId,qKey){
  qKey=qKey||currentQuarter();
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
  const rnd=mulberry32(hashStr(acctId+qKey));
  const similar=predictiveGenerateSimilar(a,rnd);
  predictiveInsights[predictiveKey(acctId,qKey)]={
    quarter:qKey,
    generatedAt:new Date().toISOString(),
    pastReview:predictiveGeneratePastReview(a,rnd),
    analysis:predictiveGenerateAnalysis(a),
    similar,
    timeline:predictiveGenerateTimeline(a,similar),
  };
  savePredictiveInsights();
}
// Demo-only: guarantees a few real (non-Test10) accounts always show the aging
// pill without needing to wait on actual elapsed time or paste a console
// script - backdates firedAt directly (bypassing the normal dedup-and-skip in
// fireTrigger) so this is idempotent across reloads and always visible.
// Demo-only: sets the new not-yet-live-queried fields (Contact Exec Sponsor
// persona / Event QBR cadence / Contract notice period) on a couple of the
// same demo accounts seedDemoAgingTriggers already uses - must run BEFORE
// evaluateRiskTriggers() in computeAll() so the normal trigger-firing logic
// picks these up naturally, same as any real field would.
function seedDemoObjectExtensions(){
  const set=(name,fields)=>{ const a=STATE.accounts.find(x=>x.name===name); if(a) Object.assign(a,fields); };
  set('Fairview Correctional Facility',{hasExecSponsor:false}); // pairs with its existing case load - too many tickets AND no champion
  set('Dunmore Police Department',{qbrDaysOverdue:RISK_QBR_OVERDUE_DAYS+45}); // pairs with its existing usage_drop - a broader disengagement story
  set('Ivywood Highway Patrol',{contractEnd:new Date(Date.now()+45*86400000).toISOString(),noticePeriodDays:30}); // sharper renewal-timing signal alongside its existing TAP refresh
}
// NPS trend (org-config gated: orgFeatureFlags.npsTrend, Law Enforcement's
// ask) - additive a.npsHistory, purely fabricated for Test10 accounts only,
// never touching the real a.nps field itself (the history's last point always
// equals whatever a.nps genuinely is right now). Only runs when the flag is
// on, and only ever on the 10 pilot accounts - no fake history invented for
// the real book.
function seedNpsHistoryForTrend(){
  if(!orgFeatureFlags.npsTrend) return;
  TEST10_ACCOUNTS.forEach(name=>{
    const a=STATE.accounts.find(x=>x.name===name); if(!a || a.npsHistory) return;
    const rnd=mulberry32(hashStr(a.id+'nps_trend'));
    const current=a.nps!=null?a.nps:7;
    const declining=rnd()<0.4; // ~40% of the 10 accounts show a real decline, rest are flat/stable
    const q3=current;
    const q2=declining?Math.min(10,q3+1+Math.floor(rnd()*2)):q3;
    const q1=declining?Math.min(10,q2+1+Math.floor(rnd()*2)):q3;
    a.npsHistory=[{quarter:'Q1',score:q1},{quarter:'Q2',score:q2},{quarter:'Q3',score:q3}];
  });
}
function seedDemoAgingTriggers(){
  const seeds=[
    {name:'Ivywood Highway Patrol',type:'tap_refresh_due',daysAgo:35,action:'schedule_tap_refresh'},
    {name:'Fairview Correctional Facility',type:'case_aging',daysAgo:35,action:'escalate_to_support_lead'},
    // Ticket-volume-spike + NPS drop co-firing, on the same account already
    // carrying case_aging - demonstrates the "high case volume now, NPS drop
    // follows" causal pattern without fabricating real Case/Account fields.
    {name:'Fairview Correctional Facility',type:'case_volume_spike',daysAgo:20,action:'escalate_to_support_lead'},
    {name:'Fairview Correctional Facility',type:'nps_csat_drop',daysAgo:10,action:'escalate_to_support_lead'},
    {name:'Dunmore Police Department',type:'usage_drop',daysAgo:45,action:'draft_adoption_email'},
  ];
  seeds.forEach(seed=>{
    const a=STATE.accounts.find(x=>x.name===seed.name);
    if(!a) return;
    const firedAt=new Date(Date.now()-seed.daysAgo*86400000).toISOString();
    const existing=triggerEvents.find(x=>x.accountId===a.id && x.triggerType===seed.type && x.status==='open');
    if(existing) existing.firedAt=firedAt;
    else triggerEvents.push({id:cid(),triggerType:seed.type,accountId:a.id,firedAt,sourceValue:'demo aging seed',thresholdValue:0,recommendedAction:seed.action,status:'open',actionNote:null,resolution:null});
  });
  saveTriggerEvents();
}

// ================= Accounts & Risk: kanban trigger engine =================
// v1 rule set - thresholds are deliberately simple constants, expected to be
// retuned later once real outcome data exists. Every trigger fires a generic,
// account-agnostic event object (see fireTrigger) so other sections (Engagement,
// Performance) can read this same log later without depending on kanban UI code.
const RISK_STAGES=['healthy','watch','atrisk','escalated','churned'];
const RISK_STAGE_LABELS={healthy:'Stable',watch:'Early Signal',atrisk:'Elevated Risk',escalated:'Active Risk',churned:'Churned'};
// Churn is a deliberate, permanent business fact (the account is actually
// lost), not something inferred just because an escalation happened to
// resolve - a resolved escalation with no other open triggers now correctly
// falls all the way back to Stable, making every other stage genuinely
// bidirectional. Kept separate from riskOverrides (which are meant to be
// temporary/reviewable) since churn should NOT get silently un-stuck the next
// time an unrelated trigger fires - it's terminal until explicitly undone.
let churnedAccounts=LS.get('churnedAccounts',{}); // acctId -> {at,reason,by}
function saveChurnedAccounts(){ LS.set('churnedAccounts',churnedAccounts); }
function isChurned(acctId){ return !!churnedAccounts[acctId]; }
// SLA (days a case may sit blocked before firing) varies by account tier -
// reuses the existing `segment` field (Enterprise/Mid-Market/SMB) rather than
// adding a duplicate tier field with the same meaning.
const RISK_SLA_DAYS_BY_SEGMENT={'Enterprise':5,'Mid-Market':10,'SMB':15};
const RISK_RENEWAL_PREP_WINDOW_DAYS=60; // fire if renewal is within this many days...
const RISK_CASE_VOLUME_SPIKE_THRESHOLD=6; // open-case count above this is a support-capacity signal, distinct from case_aging (age) / case_blocked (SLA)
const RISK_QBR_OVERDUE_DAYS=90;
const RISK_RENEWAL_PREP_STALE_DAYS=30;  // ...and no activity logged in this many days
const RISK_TRIGGER_LABELS_BASE={case_blocked:'Case blocked past SLA',usage_drop:'Usage below adoption target',renewal_prep_stale:'No renewal-prep activity',escalation_opened:'Escalation opened',nps_csat_drop:'NPS/CSAT drop',tap_refresh_due:'TAP refresh due',case_aging:'Case aging',renewal_stage_behind:'Renewal stuck in early stage',growth_mix_stalled:'No cross-sell/upsell ever',onboarding_stall:'Onboarding milestone overdue',cadence_gap:'Overdue for routine check-in',onboarding_no_plan:'New logo missing a success plan',negative_sentiment:'Negative customer sentiment',case_volume_spike:'Open case volume spike',no_exec_sponsor:'No executive sponsor on file',qbr_overdue:'QBR overdue',nps_trend_decline:'Sustained NPS decline (trend)'};
// ---------- Org config: per-org overrides on top of the fixed pipeline ----------
// The trigger -> category -> step-shape pipeline never changes per org (see
// "Org Config Reference" doc in the project root) - only whether a trigger
// is enabled, its label, its category routing, its weight, and entirely new
// custom triggers an org invents (which must still declare an existing
// category + weight, same shape as every built-in trigger). Everything below
// is intentionally additive: RISK_TRIGGER_LABELS/CTA_CATEGORY_BY_TRIGGER stay
// the exact names every existing call site already reads, they just become
// live Proxies over a mutable base so overrides apply everywhere at once
// without rewriting 35+ call sites individually.
let triggerEnabled=LS.get('triggerEnabled',{}); // key -> false (absent/true = enabled)
let triggerLabelOverrides=LS.get('triggerLabelOverrides',{}); // key -> label string
let triggerCategoryOverrides=LS.get('triggerCategoryOverrides',{}); // key -> category
let customTriggers=LS.get('customTriggers',[]); // [{key,label,category,weight}] - manual-simulate only, no bespoke fire condition
let orgFeatureFlags=LS.get('orgFeatureFlags',{productLineScorecard:false,npsTrend:false});
function customTriggerDef(key){ return customTriggers.find(c=>c.key===key); }
function triggerIsEnabled(key){ return triggerEnabled[key]!==false; }
const RISK_TRIGGER_LABELS=new Proxy(RISK_TRIGGER_LABELS_BASE,{
  get(target,key){
    if(typeof key!=='string') return target[key];
    if(triggerLabelOverrides[key]!=null) return triggerLabelOverrides[key];
    if(key in target) return target[key];
    const c=customTriggerDef(key); return c?c.label:undefined;
  },
  has(target,key){ return key in target || !!customTriggerDef(key); },
  ownKeys(target){ return [...new Set([...Reflect.ownKeys(target), ...customTriggers.map(c=>c.key)])]; },
  getOwnPropertyDescriptor(target,key){
    if(key in target) return Reflect.getOwnPropertyDescriptor(target,key);
    if(customTriggerDef(key)) return {enumerable:true,configurable:true,value:this.get(target,key)};
    return undefined;
  }
});
const RISK_ACTION_LABELS={draft_renewal_email:'Draft renewal check-in email',draft_adoption_email:'Draft adoption check-in email',escalate_to_support_lead:'Escalate to support lead',review_escalation:'Review escalation',schedule_tap_refresh:'Schedule TAP refresh',draft_expansion_email:'Draft expansion conversation email',draft_onboarding_email:'Draft onboarding check-in email',draft_cadence_email:'Draft cadence check-in email',draft_onboarding_nudge_email:'Draft onboarding milestone nudge email',draft_qbr_email:'Draft QBR scheduling email'};
// Weighted score model (replaces a hardcoded "any open escalation = worst
// stage" rule, which wrongly made escalating a MILD issue look more severe
// than an unescalated serious one). Every open trigger contributes points -
// escalation's own points scale with its real severity (autoSeverity, reused
// from the existing Escalations logic) instead of just "does one exist" -
// plus an aging bonus so a trigger sitting open longer keeps getting worse
// even with nothing new added. Same editable-config pattern as the existing
// Health Model tab (WEIGHTS): per-browser today (see note in UI), trivially
// portable to a shared backend config later since it's just one JSON blob.
const DEFAULT_RISK_WEIGHTS={
  weights:{case_blocked:3,nps_csat_drop:3,case_aging:2,renewal_stage_behind:2,onboarding_stall:2,usage_drop:1,tap_refresh_due:1,growth_mix_stalled:1,renewal_prep_stale:1,onboarding_no_plan:2,negative_sentiment:3,case_volume_spike:2,no_exec_sponsor:2,qbr_overdue:1,escalation_low:1,escalation_medium:2,escalation_high:4,escalation_critical:6},
  thresholds:{elevated:3,active:5}, // score>=active -> Active Risk; score>=elevated -> Elevated Risk; else (score>=1) -> Early Signal
  agingDays:21, agingBonus:2 // every N days a trigger stays open, add this many points to its contribution
};
let riskWeights=(()=>{ const saved=LS.get('riskWeights',{}); return {weights:Object.assign({},DEFAULT_RISK_WEIGHTS.weights,saved.weights||{}),thresholds:Object.assign({},DEFAULT_RISK_WEIGHTS.thresholds,saved.thresholds||{}),agingDays:saved.agingDays??DEFAULT_RISK_WEIGHTS.agingDays,agingBonus:saved.agingBonus??DEFAULT_RISK_WEIGHTS.agingBonus}; })();
function saveRiskWeights(){ LS.set('riskWeights',riskWeights); }
function resetRiskWeights(){ riskWeights=JSON.parse(JSON.stringify(DEFAULT_RISK_WEIGHTS)); saveRiskWeights(); route(); }
function setRiskWeight(key,v){ riskWeights.weights[key]=Math.max(0,+v||0); saveRiskWeights(); route(); }
function setRiskThreshold(key,v){ riskWeights.thresholds[key]=Math.max(0,+v||0); saveRiskWeights(); route(); }
function setRiskAging(key,v){ riskWeights[key]=Math.max(0,+v||0); saveRiskWeights(); route(); }
function riskWeightLabel(k){
  const escLabels={escalation_low:'Escalation (Low severity)',escalation_medium:'Escalation (Medium severity)',escalation_high:'Escalation (High severity)',escalation_critical:'Escalation (Critical severity)'};
  return escLabels[k]||RISK_TRIGGER_LABELS[k]||k;
}
// ---- Org config slots: named, switchable bundles of every setting above ----
// A "slot" is a snapshot of everything an org could plausibly want different -
// risk weights/thresholds, health weights, adoption cutoffs, per-trigger
// enabled/label/category overrides, and custom triggers. Switching slots just
// swaps these runtime variables and recomputes - the trigger engine itself
// never knows or cares which slot is active.
function currentConfigBundle(){
  return {
    riskWeights:JSON.parse(JSON.stringify(riskWeights)),
    WEIGHTS:Object.assign({},WEIGHTS),
    adoptionCfg:Object.assign({},adoptionCfg),
    triggerEnabled:Object.assign({},triggerEnabled),
    triggerLabelOverrides:Object.assign({},triggerLabelOverrides),
    triggerCategoryOverrides:Object.assign({},triggerCategoryOverrides),
    customTriggers:JSON.parse(JSON.stringify(customTriggers)),
    orgFeatureFlags:Object.assign({},orgFeatureFlags),
  };
}
function axonDefaultBundle(){
  return {
    riskWeights:JSON.parse(JSON.stringify(DEFAULT_RISK_WEIGHTS)),
    WEIGHTS:Object.assign({},DEFAULT_WEIGHTS),
    adoptionCfg:{adoptingPct:60,atRiskPct:35},
    triggerEnabled:{}, triggerLabelOverrides:{}, triggerCategoryOverrides:{}, customTriggers:[],
    orgFeatureFlags:{productLineScorecard:false,npsTrend:false},
  };
}
function applyConfigBundle(b){
  riskWeights=b.riskWeights; WEIGHTS=b.WEIGHTS; adoptionCfg=b.adoptionCfg;
  triggerEnabled=b.triggerEnabled; triggerLabelOverrides=b.triggerLabelOverrides; triggerCategoryOverrides=b.triggerCategoryOverrides;
  customTriggers=b.customTriggers; orgFeatureFlags=b.orgFeatureFlags;
  saveRiskWeights(); LS.set('weights',WEIGHTS); LS.set('adoptionCfg',adoptionCfg);
  LS.set('triggerEnabled',triggerEnabled); LS.set('triggerLabelOverrides',triggerLabelOverrides); LS.set('triggerCategoryOverrides',triggerCategoryOverrides);
  LS.set('customTriggers',customTriggers); LS.set('orgFeatureFlags',orgFeatureFlags);
  computeAll(); route();
}
// Pre-seeded directly from the 5 org_ref_*.md docs' trigger tables - the
// "clean fit" changes (weights/thresholds/enable-disable) that don't need a
// chat round-trip to demonstrate. Segment-conditional overrides some docs
// asked for (e.g. "disable QBR only for SMB") aren't representable in this
// schema yet - a known simplification, not silently dropped.
function seededOrgConfigBundle(overrides,featureFlags){
  const b=axonDefaultBundle();
  Object.keys(overrides.weights||{}).forEach(k=>{ b.riskWeights.weights[k]=overrides.weights[k]; });
  Object.assign(b.riskWeights.thresholds,overrides.thresholds||{});
  if(overrides.agingDays!=null) b.riskWeights.agingDays=overrides.agingDays;
  if(overrides.agingBonus!=null) b.riskWeights.agingBonus=overrides.agingBonus;
  (overrides.disabled||[]).forEach(k=>{ b.triggerEnabled[k]=false; });
  (overrides.customTriggers||[]).forEach(c=>b.customTriggers.push(c));
  if(featureFlags) Object.assign(b.orgFeatureFlags,featureFlags);
  return b;
}
function seedNamedOrgConfigs(){
  return {
    'Axon 911':seededOrgConfigBundle({
      weights:{case_blocked:4,negative_sentiment:4,case_aging:3,case_volume_spike:3,onboarding_stall:3,onboarding_no_plan:3,usage_drop:2,renewal_prep_stale:3},
      agingDays:14,
      customTriggers:[
        {key:'operational_incident',label:'Operational incident (CAD/dispatch outage)',category:'escalation',weight:6},
        {key:'go_live_readiness',label:'Go-live milestone overdue',category:'usage',weight:2},
      ],
    }),
    'Commercial':seededOrgConfigBundle({
      weights:{case_blocked:2,nps_csat_drop:1,no_exec_sponsor:1,usage_drop:0.5,growth_mix_stalled:2},
      customTriggers:[
        {key:'roi_not_documented',label:'No ROI/outcomes documented 90d post-go-live',category:'usage',weight:1},
        {key:'drone_data_gap',label:'Drone usage data unavailable — verify manually',category:'manual',weight:0},
      ],
    }),
    'Enterprise':seededOrgConfigBundle({
      weights:{case_blocked:4,case_aging:3,no_exec_sponsor:3,renewal_stage_behind:3,growth_mix_stalled:2,renewal_prep_stale:3},
      thresholds:{}, // renewal-prep window/QBR-days aren't in riskWeights - see RISK_RENEWAL_PREP_WINDOW_DAYS/RISK_QBR_OVERDUE_DAYS (global, not yet per-slot)
    }),
    'International':seededOrgConfigBundle({
      weights:{onboarding_stall:3,onboarding_no_plan:3},
      customTriggers:[
        {key:'localization_gap',label:'Customer-facing materials not localized',category:'manual',weight:1},
      ],
    }),
    'Law Enforcement':seededOrgConfigBundle({
      weights:{renewal_prep_stale:2},
      customTriggers:[
        {key:'contact_goals_stale',label:'Contact-level goals not updated',category:'cadence',weight:1},
      ],
    },{productLineScorecard:true,npsTrend:true}),
  };
}
let orgConfigSlots=LS.get('orgConfigSlots',null);
if(!orgConfigSlots){ orgConfigSlots=Object.assign({'Demo Baseline':axonDefaultBundle()},seedNamedOrgConfigs()); LS.set('orgConfigSlots',orgConfigSlots); }
let activeOrgConfigName=LS.get('activeOrgConfigName','Demo Baseline');
if(!orgConfigSlots[activeOrgConfigName]) activeOrgConfigName=Object.keys(orgConfigSlots)[0]||'Demo Baseline';
function saveOrgConfigSlots(){ LS.set('orgConfigSlots',orgConfigSlots); }
function setActiveOrgConfig(name){
  if(!orgConfigSlots[name]) return;
  activeOrgConfigName=name; LS.set('activeOrgConfigName',activeOrgConfigName);
  applyConfigBundle(JSON.parse(JSON.stringify(orgConfigSlots[name])));
  toast('Switched to "'+name+'".');
}
function saveCurrentConfigAs(name){
  name=(name||'').trim(); if(!name) return;
  orgConfigSlots[name]=currentConfigBundle(); saveOrgConfigSlots();
  activeOrgConfigName=name; LS.set('activeOrgConfigName',activeOrgConfigName);
  toast('Saved as "'+name+'".');
  route();
}
function resetActiveConfigToDefault(){
  applyConfigBundle(axonDefaultBundle());
  orgConfigSlots[activeOrgConfigName]=currentConfigBundle(); saveOrgConfigSlots();
  toast('Reset "'+activeOrgConfigName+'" to Axon Default.');
}
function deleteOrgConfigSlot(name){
  if(name==='Demo Baseline'){ toast('Demo Baseline can\'t be deleted.'); return; }
  if(!confirm('Delete saved config "'+name+'"? This cannot be undone.')) return;
  delete orgConfigSlots[name]; saveOrgConfigSlots();
  if(activeOrgConfigName===name) setActiveOrgConfig('Demo Baseline'); else route();
}
// Applies whatever slot was last active immediately at load - assignment
// only, no computeAll()/route() yet (STATE.accounts isn't populated until
// the real boot sequence's own load() finishes and calls computeAll() itself
// the normal way) - this just guarantees riskWeights/WEIGHTS/overrides
// reflect the right slot from the very first real computeAll() onward.
(function applyActiveConfigAtLoad(){
  const b=JSON.parse(JSON.stringify(orgConfigSlots[activeOrgConfigName]));
  riskWeights=b.riskWeights; WEIGHTS=b.WEIGHTS; adoptionCfg=b.adoptionCfg;
  triggerEnabled=b.triggerEnabled; triggerLabelOverrides=b.triggerLabelOverrides; triggerCategoryOverrides=b.triggerCategoryOverrides;
  customTriggers=b.customTriggers; orgFeatureFlags=b.orgFeatureFlags;
})();
// Parameterized by "as of" time so the timeline can show a trigger's exact
// contribution when it fired vs. now (still open) vs. the moment it was
// resolved (aging stops accruing once it's closed out). Returns base/aging
// split (not just the total) so the UI can flag when a score increase came
// from time elapsing on an unaddressed problem rather than a new issue -
// that distinction matters because aging is entirely preventable.
function triggerWeightParts(t,a,asOf){
  const base = t.triggerType==='escalation_opened'
    ? (riskWeights.weights['escalation_'+(autoSeverity(a)||'Low').toLowerCase()] ?? riskWeights.weights.escalation_low)
    : (riskWeights.weights[t.triggerType] ?? 1);
  const daysOpen=Math.max(0,Math.floor((new Date(asOf).getTime()-new Date(t.firedAt).getTime())/86400000));
  const agingBonus = riskWeights.agingDays>0 ? Math.floor(daysOpen/riskWeights.agingDays)*riskWeights.agingBonus : 0;
  return {base,agingBonus,total:base+agingBonus,daysOpen};
}
function triggerWeightAt(t,a,asOf){ return triggerWeightParts(t,a,asOf).total; }
function triggerEffectiveWeight(t,a){ return triggerWeightAt(t,a,new Date()); }
// 'open' and 'pending' both still count as a live, unresolved problem - taking
// the recommended action (drafting an email, escalating, etc.) only moves a
// trigger to 'pending', it does NOT resolve it. Only 'resolved' (via the
// explicit Resolved action) or 'dismissed' (false positive) stop counting.
function isTriggerLive(t){ return t.status==='open'||t.status==='pending'; }
function riskScore(a){
  return triggerEvents.filter(t=>t.accountId===a.id && isTriggerLive(t)).reduce((sum,t)=>sum+triggerEffectiveWeight(t,a),0);
}
// Structured, generically-named event log - not Accounts & Risk-specific by
// design, so other sections can consume it later without a rewrite.
let triggerEvents=LS.get('triggerEvents',[]); // {id,triggerType,accountId,firedAt,sourceValue,thresholdValue,recommendedAction,status:'open'|'pending'|'resolved'|'dismissed',actionNote:null|{label,at},resolution:null|{outcome,note,at}}
function saveTriggerEvents(){ LS.set('triggerEvents',triggerEvents); }
// Manual overrides (drag, or "mark reviewed") - first-class structured records
// (not a text blob) so this can feed a future override-rate scorecard and
// eventually retune the thresholds above.
let riskOverrides=LS.get('riskOverrides',[]); // {id,accountId,triggerEventId,fromStage,toStage,reason,by,at}
function saveRiskOverrides(){ LS.set('riskOverrides',riskOverrides); }
function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return Math.abs(h)||1; }
// Mock data only tracks a blocked-case COUNT, not per-case open dates - this
// derives a stable (not re-randomized every render) pseudo-random day count
// from the account id so the SLA trigger has something real to compare against.
function daysCaseBlocked(a){
  if(!a.casesBlocked) return 0;
  if(a._daysCaseBlocked==null){ const rnd=mulberry32(hashStr(a.id)); a._daysCaseBlocked=3+Math.floor(rnd()*40); }
  return a._daysCaseBlocked;
}
function riskSlaDays(a){ return RISK_SLA_DAYS_BY_SEGMENT[a.segment] ?? RISK_SLA_DAYS_BY_SEGMENT['Mid-Market']; }
// Baseline "read from the account's success plan" per spec - defaults to the
// existing global adoption config the first time a plan is touched, but from
// then on lives on the plan itself (so it can be negotiated per-account).
function planAdoptionTarget(a){
  const p=plans[a.id];
  if(p){ if(p.adoptionTarget==null){ p.adoptionTarget=adoptionCfg.adoptingPct; savePlans(); } return p.adoptionTarget; }
  return adoptionCfg.atRiskPct; // no plan yet - fall back to the "at risk" cutoff as an implicit baseline
}
function hasOpenTrigger(acctId,type){ return triggerEvents.some(t=>t.accountId===acctId && t.triggerType===type && isTriggerLive(t)); }
function fireTrigger(acctId,type,sourceValue,thresholdValue,recommendedAction){
  if(hasOpenTrigger(acctId,type)) return; // already flagged (open or pending) - don't spam duplicate events every recompute
  triggerEvents.push({id:cid(),triggerType:type,accountId:acctId,firedAt:new Date().toISOString(),sourceValue,thresholdValue,recommendedAction,status:'open',actionNote:null,resolution:null});
}
// The moment a trigger fires (which is what actually moves a card between
// risk stages - score-based, not click-based), it must show up somewhere:
// either the Escalations page or Active CTAs, per CS-leadership guidance
// that there are only ever two routes out of a trigger. So every fireTrigger
// call in evaluateRiskTriggers goes through this wrapper instead, which also
// creates the corresponding CTA/escalation record right away - the CSM's own
// "draft email" click (requestTriggerAction) just picks up this
// already-existing record rather than creating a fresh one.
function fireTriggerWithCta(acctId,type,sourceValue,thresholdValue,recommendedAction){
  // Single shared gate for every trigger type, built-in or custom - an org
  // that disables a trigger just stops it firing here, nothing upstream
  // needs to know or care which trigger types are currently active.
  if(!triggerIsEnabled(type)) return;
  const isNew=!hasOpenTrigger(acctId,type);
  fireTrigger(acctId,type,sourceValue,thresholdValue,recommendedAction);
  if(isNew){
    const a=STATE.accounts.find(x=>x.id===acctId);
    if(a) autoCreateCtaForNewTrigger(a,type,recommendedAction);
  }
}
function autoCreateCtaForNewTrigger(a,triggerType,recommendedAction){
  const category=CTA_CATEGORY_BY_TRIGGER[triggerType]||'manual';
  // Avoid stacking duplicates if this exact trigger already has a live CTA -
  // matters especially for the Test10 sandbox, which re-wipes trigger events
  // on every reload (resetTest10RiskBaseline), which would otherwise look
  // like a brand-new firing every time and spawn a fresh CTA each reload.
  // Escalations dedupe on category alone (only one live escalation per
  // account at a time), same rule ensureEscalationCta itself used.
  const existing = category==='escalation'
    ? engagementCtas.find(c=>c.accountId===a.id && c.category==='escalation' && engagementCtaEffectiveStatus(c)!=='dismissed' && engagementCtaEffectiveStatus(c)!=='done')
    : engagementCtas.find(c=>c.accountId===a.id && c.originatingTriggerType===triggerType && engagementCtaEffectiveStatus(c)!=='dismissed' && engagementCtaEffectiveStatus(c)!=='done');
  if(existing) return;
  if(category==='cadence'){ autoDraftCadenceCta(a); return; }
  // Escalations get a real, unsent, prefilled draft here too (same as every
  // other category) rather than ensureEscalationCta's auto-mark-sent
  // placeholder - a trigger-driven escalation should land the CSM on a real
  // "draft email - step 1" card to actually send, not a dead end that skips
  // straight to the checklist with nothing to send. ensureEscalationCta
  // itself is still used as-is for the manual "Start Escalation" button
  // (Account 360), where there's no recommended action/template to draft from.
  const emailTemplate=RISK_ACTION_EMAIL_TEMPLATE[recommendedAction];
  const draft=emailTemplate?buildEmailDraft(emailTemplate,a.id):null;
  const c=createEngagementCta(a.id,category,triggerType);
  if(draft){ c.steps[0].subject=draft.subject; c.steps[0].body=draft.body; c.steps[0].recipient=draft.to; }
  saveEngagementCtas();
}
function evaluateRiskTriggers(){
  STATE.accounts.forEach(a=>{
    // True sandbox for the 10 Test10 pilot accounts while Test10 is on: none
    // of the underlying mock Salesforce-shaped data (cases, TAP, renewal
    // stage, growth mix, onboarding, sentiment, cadence, QBR, exec sponsor)
    // is allowed to auto-fire a trigger. The only two ways a Test10 account
    // can move while sandboxed are (1) nps_csat_drop, driven purely by the
    // real synced survey score below, and (2) a CSM manually calling
    // simulateRiskTrigger from Surface Alert - that goes straight to
    // fireTriggerWithCta and never runs through this function at all, so it
    // still works untouched. Once Test10 is toggled off, the account's real
    // snapshotted data returns and normal auto-firing resumes for it.
    const sandboxed = riskTest10 && isTest10Account(a.id);
    if(!sandboxed){
    const blockedDays=daysCaseBlocked(a), sla=riskSlaDays(a);
    if(blockedDays>sla) fireTriggerWithCta(a.id,'case_blocked',blockedDays,sla,'escalate_to_support_lead');
    if(a.usage && a.usage.adoptionPct!=null){
      const target=planAdoptionTarget(a);
      if(a.usage.adoptionPct<target) fireTriggerWithCta(a.id,'usage_drop',a.usage.adoptionPct,target,'draft_adoption_email');
    }
    // Contract-based renewal precision: prefer real Contract End Date - Notice
    // Period ("days to renewal") over the Opportunity CloseDate proxy when a
    // Contract record is present - not yet a live-queried object (no confirmed
    // Contract fields in the org), so this only applies where contractEnd is
    // seeded on a demo account; every other real account falls back to the
    // existing dclose-based check unchanged.
    const daysToRenewal = a.contractEnd!=null ? Math.floor((new Date(a.contractEnd)-new Date())/86400000)-(a.noticePeriodDays||0) : a.dclose;
    if(daysToRenewal!=null && daysToRenewal<=RISK_RENEWAL_PREP_WINDOW_DAYS && (a.dsAct==null||a.dsAct>RISK_RENEWAL_PREP_STALE_DAYS)){
      fireTriggerWithCta(a.id,'renewal_prep_stale',a.dsAct,RISK_RENEWAL_PREP_STALE_DAYS,'draft_renewal_email');
    }
    const escNow=peekEscState(a.id);
    if(escNow.status && escNow.status!=='Resolved'){
      fireTriggerWithCta(a.id,'escalation_opened',escNow.status,null,'review_escalation');
    }else{
      // Escalation resolved (or never opened) - close out any lingering
      // open/pending escalation_opened event so a resolved escalation stops
      // contributing to the score forever (without this, it never actually
      // left the live list once fired, permanently inflating the score).
      triggerEvents.filter(t=>t.accountId===a.id && t.triggerType==='escalation_opened' && isTriggerLive(t))
        .forEach(t=>{ t.status='resolved'; t.resolution={outcome:'escalated-resolved',note:'Escalation resolved',at:new Date().toISOString()}; });
    }
    }
    // Consumes the NPS score straight from the Customer Pulse section (same
    // 3-tier threshold already established there: <9 = detractor). Escalates
    // rather than just drafting an email - a genuine detractor score usually
    // reflects a real unresolved problem a CSM can't personally fix by
    // emailing the customer; it needs to be routed to whoever actually can.
    // Deliberately NOT inside the sandboxed guard above - this is the one
    // signal Test10 sandbox mode is explicitly supposed to let through.
    if(a.nps!=null && a.nps<9) fireTriggerWithCta(a.id,'nps_csat_drop',a.nps,9,'escalate_to_support_lead');
    if(sandboxed) return;
    if(a.tapStatus==='overdue') fireTriggerWithCta(a.id,'tap_refresh_due',a.tapDays,0,'schedule_tap_refresh');
    // Escalates rather than just a CTA - unworked case backlog is a support
    // capacity problem, not something a CSM can personally clear by email.
    if(a.casesAging>0) fireTriggerWithCta(a.id,'case_aging',a.casesAging,0,'escalate_to_support_lead');
    if(a.dclose!=null && a.dclose<=120 && a.opps && a.opps.some(o=>EARLY.has(o.stage))){
      const stuckStage=(a.opps.find(o=>EARLY.has(o.stage))||{}).stage||'early stage';
      fireTriggerWithCta(a.id,'renewal_stage_behind',stuckStage,120,'draft_renewal_email');
    }
    // Growth-mix erosion: an established account (2+ past renewal cycles) with
    // essentially zero cross-sell/upsell ever - reuses the same attach-depth
    // calc as opportunityTier() elsewhere, just as its own trigger here.
    const g=a.growth||{Renewal:0,Expansion:0,Transactional:0};
    const attachDepth=a.ltv>0 ? ((g.Expansion||0)+(g.Transactional||0))/a.ltv : 0;
    if((a.pastDeals||0)>=2 && attachDepth<0.05) fireTriggerWithCta(a.id,'growth_mix_stalled',Math.round(attachDepth*100),5,'draft_expansion_email');
    // Onboarding stall: a new logo whose plan has a milestone whose target day
    // has passed without being marked done.
    if(newLogo(a)){
      const p=plans[a.id];
      const daysSincePurchase=daysSince(a.firstPurchase);
      const overdueMilestone = p && p.milestones && daysSincePurchase!=null ? p.milestones.find(m=>!m.done && m.day!=null && daysSincePurchase>m.day) : null;
      if(overdueMilestone) fireTriggerWithCta(a.id,'onboarding_stall',daysSincePurchase,overdueMilestone.day,'draft_onboarding_nudge_email');
      // A narrower, earlier case than onboarding_stall above (which needs a
      // plan to already exist with an overdue milestone) - this is a new
      // logo with no plan at all yet, previously only surfaced as a
      // disconnected "Onboard" worklist tag with no real record behind it.
      if(!p) fireTriggerWithCta(a.id,'onboarding_no_plan',daysSincePurchase,0,'draft_onboarding_email');
    }
    // Negative sentiment: same support-case-derived signal previously only
    // surfaced as a disconnected "Sentiment risk" worklist tag - escalation,
    // not just a CTA, since a negative sentiment trend usually reflects a
    // real unresolved problem, same reasoning as the NPS/CSAT drop trigger.
    if(a.sentTier==='neg') fireTriggerWithCta(a.id,'negative_sentiment',a.sentiment,50,'escalate_to_support_lead');
    // Cadence gap: reads directly off the account's own descriptor fields
    // (daysSinceLastTouch/expectedCadenceDays, set in scoreAccount) rather than
    // any separate cadence-tracking system - this is the "no engagement in N
    // days" trigger the Client Engagement revamp asks for. Renewal-prep
    // staleness above is a narrower, renewal-specific signal and stays as its
    // own trigger; this one is the general "overdue for a routine touch" case.
    if(a.daysSinceLastTouch!=null && a.daysSinceLastTouch>a.expectedCadenceDays){
      fireTriggerWithCta(a.id,'cadence_gap',a.daysSinceLastTouch,a.expectedCadenceDays,'draft_cadence_email');
    }
    // Open case volume spike: a real signal off the same Case data already
    // powering case_blocked/case_aging, just measuring COUNT rather than
    // age/SLA - the "high ticket volume now, NPS drop follows" pattern often
    // shows up together with nps_csat_drop on the same account.
    if(a.openCases>=RISK_CASE_VOLUME_SPIKE_THRESHOLD) fireTriggerWithCta(a.id,'case_volume_spike',a.openCases,RISK_CASE_VOLUME_SPIKE_THRESHOLD,'escalate_to_support_lead');
    // No executive sponsor on file: Contact-roster persona check - not yet a
    // live-queried field (no confirmed persona/role field on Contact in the
    // org), defaults true for every real account so this never falsely fires
    // until a real data source exists; only demo-seeded accounts set it false.
    if(a.hasExecSponsor===false) fireTriggerWithCta(a.id,'no_exec_sponsor','missing',null,'escalate_to_support_lead');
    // QBR overdue: Event-object cadence check, same caveat as above - only
    // fires where qbrDaysOverdue is demo-seeded, never for real accounts yet.
    if(a.qbrDaysOverdue!=null && a.qbrDaysOverdue>RISK_QBR_OVERDUE_DAYS) fireTriggerWithCta(a.id,'qbr_overdue',a.qbrDaysOverdue,RISK_QBR_OVERDUE_DAYS,'draft_qbr_email');
    // NPS trend (org-config gated: orgFeatureFlags.npsTrend) - fires on 2+
    // consecutive declining quarters, not a single below-threshold reading
    // like nps_csat_drop. Only ever has data to check on Test10 accounts
    // (see seedNpsHistoryForTrend) until a real historical NPS source exists.
    if(orgFeatureFlags.npsTrend && a.npsHistory && a.npsHistory.length>=3){
      const h=a.npsHistory;
      if(h[2].score<h[1].score && h[1].score<h[0].score) fireTriggerWithCta(a.id,'nps_trend_decline',h.map(x=>x.score).join('→'),null,'escalate_to_support_lead');
    }
  });
  saveTriggerEvents();
}
function activeOverrideFor(acctId){ const list=riskOverrides.filter(o=>o.accountId===acctId); return list.length?list[list.length-1]:null; }
function computedRiskStage(a){
  const openTriggers=triggerEvents.filter(t=>t.accountId===a.id && isTriggerLive(t));
  if(!openTriggers.length) return 'healthy';
  const score=riskScore(a);
  if(score>=riskWeights.thresholds.active) return 'escalated';
  if(score>=riskWeights.thresholds.elevated) return 'atrisk';
  return 'watch';
}
// An override "sticks" (shows the CSM's chosen stage instead of the computed
// one) until a NEWER trigger has fired since the override was made - at that
// point the engine takes back over rather than the override silently going
// stale forever. Churn is checked first and bypasses this entirely - it's a
// permanent fact, not a reviewable override, so a later trigger firing must
// never silently un-churn an account.
// An override only stays stuck while NOTHING has happened to this account's
// triggers since it was made. Originally this only checked for a brand-new
// trigger firing - but resolving/dismissing an EXISTING trigger is just as
// much "something changed" and must also release the override, otherwise an
// account that gets fully resolved back to a score of 0 stays visually stuck
// in whatever column it was overridden into, forever.
function overrideIsStale(a,ov){
  return triggerEvents.some(t=>t.accountId===a.id && (
    new Date(t.firedAt)>new Date(ov.at) ||
    (t.resolution && new Date(t.resolution.at)>new Date(ov.at))
  ));
}
function getRiskStage(a){
  if(isChurned(a.id)) return 'churned';
  const ov=activeOverrideFor(a.id);
  if(ov && !overrideIsStale(a,ov)) return ov.toStage;
  return computedRiskStage(a);
}
function daysInStage(a){
  const ov=activeOverrideFor(a.id);
  let since=null;
  if(ov && !overrideIsStale(a,ov)) since=ov.at;
  else{ const opens=triggerEvents.filter(t=>t.accountId===a.id && isTriggerLive(t)); if(opens.length) since=opens.map(t=>t.firedAt).sort().slice(-1)[0]; }
  if(!since) return 0;
  return Math.max(0,Math.floor((Date.now()-new Date(since).getTime())/86400000));
}
// Demo-only: since the underlying data is all mock, this lets a CSM force any
// of the 5 trigger types to fire right now on a given account, to show the
// card actually move columns without needing to wait on real data drift.
function simulateRiskTrigger(acctId,triggerType){
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
  const defs={
    case_blocked:{source:riskSlaDays(a)+7,threshold:riskSlaDays(a),action:'escalate_to_support_lead'},
    usage_drop:{source:Math.max(0,planAdoptionTarget(a)-15),threshold:planAdoptionTarget(a),action:'draft_adoption_email'},
    renewal_prep_stale:{source:RISK_RENEWAL_PREP_STALE_DAYS+10,threshold:RISK_RENEWAL_PREP_STALE_DAYS,action:'draft_renewal_email'},
    escalation_opened:{source:'Open',threshold:null,action:'review_escalation'},
    nps_csat_drop:{source:6,threshold:9,action:'escalate_to_support_lead'},
    tap_refresh_due:{source:14,threshold:0,action:'schedule_tap_refresh'},
    case_aging:{source:3,threshold:0,action:'escalate_to_support_lead'},
    renewal_stage_behind:{source:'Discovering',threshold:120,action:'draft_renewal_email'},
    growth_mix_stalled:{source:2,threshold:5,action:'draft_expansion_email'},
    onboarding_stall:{source:60,threshold:30,action:'draft_onboarding_nudge_email'},
    onboarding_no_plan:{source:45,threshold:0,action:'draft_onboarding_email'},
    negative_sentiment:{source:35,threshold:50,action:'escalate_to_support_lead'},
    case_volume_spike:{source:RISK_CASE_VOLUME_SPIKE_THRESHOLD+2,threshold:RISK_CASE_VOLUME_SPIKE_THRESHOLD,action:'escalate_to_support_lead'},
    no_exec_sponsor:{source:'missing',threshold:null,action:'escalate_to_support_lead'},
    qbr_overdue:{source:RISK_QBR_OVERDUE_DAYS+30,threshold:RISK_QBR_OVERDUE_DAYS,action:'draft_qbr_email'},
    nps_trend_decline:{source:'declining 3 quarters',threshold:null,action:'escalate_to_support_lead'},
  };
  // Custom triggers (org-invented, no bespoke fire condition) get a generic
  // demo source/threshold and whichever recommended action already fits
  // their declared category - same email-template machinery every built-in
  // trigger's action already uses, nothing new to build per custom trigger.
  const CUSTOM_TRIGGER_DEFAULT_ACTION={escalation:'escalate_to_support_lead',usage:'draft_adoption_email',renewal:'draft_renewal_email',case_watch:'schedule_tap_refresh',cadence:'draft_cadence_email',manual:'draft_cadence_email'};
  const cd=customTriggerDef(triggerType);
  const d=defs[triggerType] || (cd ? {source:'manual',threshold:null,action:CUSTOM_TRIGGER_DEFAULT_ACTION[cd.category]||'draft_cadence_email'} : null);
  if(!d) return;
  // Goes through the same fireTriggerWithCta path as every real engine-fired
  // trigger, not a bare push into triggerEvents - otherwise this demo button
  // moves the kanban card but never creates the CTA/escalation record behind
  // it, which is exactly the disconnect between Risk & Accounts and
  // Escalations/Active CTAs that broke the Test 10 demo.
  fireTriggerWithCta(acctId,triggerType,d.source,d.threshold,d.action);
  if(triggerType==='escalation_opened') setEscStatus(acctId,'Open');
  if(HEALTH_REVEALING_TRIGGERS.has(triggerType)) revealTest10Health(acctId);
  saveTriggerEvents();
  route(); if(currentRiskCardId===acctId) openRiskCard(acctId);
}
// ---- Reason modal (mandatory single-line comment for every manual action -
// resolve, take action, dismiss, drag, mark churned - all of it gets recorded
// on the timeline for record-keeping, good or bad. Only automated engine
// firing (fireTrigger) skips this - manual human input always requires one.) ----
let pendingRiskOverride=null; // {mode:'drag'|'dismiss'|'churn'|'resolve'|'action',acctId,fromStage,toStage,triggerEventId}
function openOverrideReasonModal(a,summary){
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2>Comment required</h2><div class="mini">${esc(a.name)}: ${esc(summary)}</div></div><button class="x" onclick="cancelRiskOverride()">✕</button></div>
  <div class="bd">
    <label class="mini" style="display:block;margin-bottom:6px">Comment (required) — recorded on the timeline</label>
    <input type="text" id="riskOverrideReason" class="select" style="width:100%" placeholder="Why? What's the context?" onkeydown="if(event.key==='Enter')confirmRiskOverride()">
    <div class="row-actions" style="margin-top:14px"><button type="button" class="btn primary" onclick="confirmRiskOverride()">Confirm</button><button type="button" class="btn" onclick="cancelRiskOverride()">Cancel</button></div>
  </div>`;
  showOverlay();
  setTimeout(()=>{ const el=$('#riskOverrideReason'); if(el) el.focus(); },50);
}
function requestRiskOverrideDrag(acctId,toStage){
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
  const fromStage=getRiskStage(a);
  if(fromStage===toStage) return;
  if(toStage==='churned'){ requestMarkChurned(acctId); return; } // permanent fact, not a reviewable override
  pendingRiskOverride={mode:'drag',acctId,fromStage,toStage,triggerEventId:null};
  openOverrideReasonModal(a,`${RISK_STAGE_LABELS[fromStage]||fromStage} → ${RISK_STAGE_LABELS[toStage]||toStage}`);
}
function requestMarkChurned(acctId){
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
  pendingRiskOverride={mode:'churn',acctId,fromStage:getRiskStage(a),toStage:'churned',triggerEventId:null};
  openOverrideReasonModal(a,'Mark account as churned (permanent - not a reviewable override)');
}
function unmarkChurned(acctId){
  delete churnedAccounts[acctId];
  saveChurnedAccounts();
  route(); if(currentRiskCardId===acctId) openRiskCard(acctId);
}
function requestResolveTrigger(acctId,triggerEventId){
  const a=STATE.accounts.find(x=>x.id===acctId); const t=triggerEvents.find(x=>x.id===triggerEventId); if(!a||!t) return;
  pendingRiskOverride={mode:'resolve',acctId,fromStage:getRiskStage(a),toStage:null,triggerEventId};
  openOverrideReasonModal(a,`Mark "${RISK_TRIGGER_LABELS[t.triggerType]||t.triggerType}" resolved`);
}
// Taking the recommended action does NOT resolve the trigger - it's still a
// live, unaddressed problem until someone confirms it's actually fixed
// (requestResolveTrigger). This only records that a next step is underway and
// moves the trigger to 'pending', which still counts toward the score exactly
// like 'open' does - what happens next depends on the real-world response to
// that action, not on the mere fact that an action was taken.
// Every recommended action starts the same way: an email (customer-facing or
// internal), so there's exactly one wiring pattern for all of them - even
// escalation starts with a client email (the resolution checklist's own first
// step is literally "Acknowledge issue with customer"), not an internal note.
const RISK_ACTION_EMAIL_TEMPLATE={
  draft_renewal_email:'cust_renewal',
  draft_adoption_email:'cust_product',
  draft_expansion_email:'cust_expansion',
  draft_onboarding_email:'cust_welcome',
  draft_onboarding_nudge_email:'cust_onboarding_nudge',
  schedule_tap_refresh:'cust_tap',
  escalate_to_support_lead:'cust_save',
  review_escalation:'cust_save',
  draft_cadence_email:'cust_checkin',
  draft_qbr_email:'cust_checkin',
};
// Jumps to wherever a trigger's action actually lives - the same destination
// whether it's still open ("needs to be taken") or already pending/resolved
// ("was taken, go see it"). Email Outreach has no permalink to one specific
// past send yet (a gap to close when this app's engagement/email tooling gets
// built out further) - closest available today is its history log. Escalation
// and TAP refresh both have a more specific downstream home (the escalation
// checklist, the created CTA) once their email has actually been sent.
// Finds (or, defensively, creates) the real CTA/escalation record a trigger's
// recommended action belongs to - reused by both goToActionDestination
// (clicking the trigger label) and requestTriggerAction (clicking the actual
// "Take action" button), so either entry point lands on the same chevron -
// never the separate Email Outreach composer. That chevron already has its
// own draft-email step (Send + AI-draft), so there's no need to route through
// a second, disconnected compose surface.
function ctaForTriggerAction(t){
  const a=STATE.accounts.find(x=>x.id===t.accountId); if(!a) return null;
  const category=CTA_CATEGORY_BY_TRIGGER[t.triggerType]||'manual';
  let engC = category==='escalation'
    ? engagementCtas.find(c=>c.accountId===a.id && c.category==='escalation' && engagementCtaEffectiveStatus(c)!=='dismissed' && engagementCtaEffectiveStatus(c)!=='done')
    : engagementCtas.find(c=>c.accountId===a.id && c.originatingTriggerType===t.triggerType && engagementCtaEffectiveStatus(c)!=='dismissed' && engagementCtaEffectiveStatus(c)!=='done');
  if(!engC){
    // Shouldn't normally happen (fireTriggerWithCta already auto-creates this
    // the moment the trigger fires) - created defensively so the action
    // always has somewhere real to land.
    engC=createEngagementCta(a.id,category,t.triggerType);
    const emailTemplate=RISK_ACTION_EMAIL_TEMPLATE[t.recommendedAction];
    const draft=emailTemplate?buildEmailDraft(emailTemplate,a.id):null;
    if(draft){ engC.steps[0].subject=draft.subject; engC.steps[0].body=draft.body; engC.steps[0].recipient=draft.to; }
    saveEngagementCtas();
  }
  return engC;
}
function goToActionDestination(triggerEventId){
  const t=triggerEvents.find(x=>x.id===triggerEventId); if(!t) return;
  closeRiskCard();
  const engC=ctaForTriggerAction(t);
  if(engC) openEngagementCta(engC.id); else setTab(t.recommendedAction==='schedule_tap_refresh'?'activectas':'escalations');
}
// Recommended actions land straight on the real CTA/escalation chevron -
// never the separate Email Outreach composer. The trigger only moves to
// pending once the CSM actually sends from that chevron (see
// sendEngagementCtaDraft), which is also where the score/risk-stage side
// effect fires - not before, so nothing "happens" until the email genuinely
// goes out.
function requestTriggerAction(triggerEventId){
  const t=triggerEvents.find(x=>x.id===triggerEventId); if(!t) return;
  closeRiskCard();
  const engC=ctaForTriggerAction(t);
  if(engC) openEngagementCta(engC.id);
}
function requestDismissTrigger(acctId,triggerEventId){
  const a=STATE.accounts.find(x=>x.id===acctId); const t=triggerEvents.find(x=>x.id===triggerEventId); if(!a||!t) return;
  pendingRiskOverride={mode:'dismiss',acctId,fromStage:getRiskStage(a),toStage:null,triggerEventId};
  openOverrideReasonModal(a,`Mark "${RISK_TRIGGER_LABELS[t.triggerType]||t.triggerType}" reviewed — false positive`);
}
function cancelRiskOverride(){
  const wasCard=pendingRiskOverride && currentRiskCardId===pendingRiskOverride.acctId;
  pendingRiskOverride=null;
  if(wasCard) openRiskCard(currentRiskCardId); else closeSheet();
}
function confirmRiskOverride(){
  const input=$('#riskOverrideReason'); const reason=(input&&input.value||'').trim();
  if(!reason){ if(input){ input.style.borderColor='var(--red)'; input.focus(); } return; }
  if(!pendingRiskOverride) return;
  const {mode,acctId,triggerEventId,fromStage}=pendingRiskOverride;
  const finish=()=>{ pendingRiskOverride=null; route(); if(currentRiskCardId===acctId) openRiskCard(acctId); else closeSheet(); };
  if(mode==='churn'){
    churnedAccounts[acctId]={at:new Date().toISOString(),reason,by:(window.CURRENT_USER&&window.CURRENT_USER.displayName)||'CSM'};
    saveChurnedAccounts();
    currentRiskCardId=null; finish();
    return;
  }
  if(mode==='resolve'){
    const t=triggerEvents.find(x=>x.id===triggerEventId);
    if(t){ t.status='resolved'; t.resolution={outcome:'resolved',note:reason,at:new Date().toISOString()}; saveTriggerEvents(); if(HEALTH_REVEALING_TRIGGERS.has(t.triggerType)) revealTest10Health(acctId); }
    finish();
    return;
  }
  if(mode==='dismiss'){
    const t=triggerEvents.find(x=>x.id===triggerEventId);
    if(t){ t.status='dismissed'; t.resolution={outcome:'false-positive',note:reason,at:new Date().toISOString()}; saveTriggerEvents(); }
  }
  const a=STATE.accounts.find(x=>x.id===acctId);
  const toStage = mode==='drag'?pendingRiskOverride.toStage:(a?computedRiskStage(a):fromStage);
  riskOverrides.push({id:cid(),accountId:acctId,triggerEventId:triggerEventId||null,fromStage,toStage,reason,by:(window.CURRENT_USER&&window.CURRENT_USER.displayName)||'CSM',at:new Date().toISOString()});
  saveRiskOverrides();
  if(mode!=='dismiss') currentRiskCardId=null;
  finish();
}

// ---------- Accounts & Risk: kanban board UI ----------
let riskSort='arr'; // 'arr' | 'days' - applied to all columns at once (simplest v1, per spec)
function setRiskSort(v){ riskSort=v; route(); }
// Sorts every column so accounts with the selected alert type surface first
// (stable sort - preserves the ARR/days ordering within each has/hasn't
// group), rather than hiding non-matching cards - lets a CSM work through
// every account carrying a specific alert without losing the rest of the board.
let riskAlertFilter='all';
function setRiskAlertFilter(v){ riskAlertFilter=v; route(); }
// Pinning - persisted per-browser like everything else, keeps specific
// accounts surfaced at the top of their column regardless of sort/filter.
let pinnedAccounts=LS.get('pinnedAccounts',{});
function savePinnedAccounts(){ LS.set('pinnedAccounts',pinnedAccounts); }
function isPinned(acctId){ return !!pinnedAccounts[acctId]; }
function togglePin(acctId,ev){
  if(ev){ ev.stopPropagation(); } // don't also trigger the card's own onclick (opens the card)
  if(pinnedAccounts[acctId]) delete pinnedAccounts[acctId]; else pinnedAccounts[acctId]=true;
  savePinnedAccounts();
  route();
  if(currentRiskCardId===acctId) openRiskCard(acctId);
}
function nextScheduledTouch(a){
  const open=ctas.filter(c=>c.acctId===a.id && c.status!=='Done' && c.due).sort((x,y)=>new Date(x.due)-new Date(y.due));
  if(!open.length) return null;
  return {date:open[0].due,type:open[0].title||open[0].type};
}
// Every active trigger always shows its own badge on the card (no "+N more"
// collapsing) - ordered by the same effective (weight + aging) score driving
// the stage itself, so the badge order and the stage are always consistent.
// Shared red/amber/green/gray coloring by stage, used both on the collapsed
// kanban card and the expanded card header, so the score reads consistently
// everywhere it shows up.
function riskStagePillClass(stage){ return stage==='escalated'?'p-red':stage==='atrisk'?'p-orange':stage==='watch'?'p-amber':stage==='churned'?'p-gray':'p-green'; }
// Session-only (not persisted - resets on reload, which is fine): the last
// stage/score seen for each account, purely to detect "this just changed"
// between renders so a genuine transition can flash, without re-flashing on
// every render for something that's been sitting in the same place a while.
let lastKnownRiskStage={}, lastKnownRiskScore={};
// A detected transition persists here (unacknowledged) until the CSM actually
// opens that card - this is a deliberate "did you see this" signal, not a
// timed toast that can fade before anyone notices, per spec: acknowledgment
// = opening the card, not a fixed number of seconds passing.
let unackStageChange={}; // acctId -> {worse:bool, delta:number}
// Runs for every account on every route(), not just when the kanban itself
// renders - so a trigger firing while a CSM is on a completely different tab
// still lights up the nav badge immediately, not only once they happen to
// visit Accounts & Risk next.
function detectRiskStageShifts(){
  STATE.accounts.forEach(a=>{
    if(isChurned(a.id)) return;
    const stage=getRiskStage(a), score=riskScore(a);
    const prevStage=lastKnownRiskStage[a.id], prevScore=lastKnownRiskScore[a.id];
    if(prevStage!=null && prevStage!==stage){
      unackStageChange[a.id]={worse:score>(prevScore??score),delta:Math.abs(score-(prevScore??score)),fromStage:prevStage,toStage:stage};
    }
    lastKnownRiskStage[a.id]=stage; lastKnownRiskScore[a.id]=score;
  });
}
function riskCardHtml(a){
  const stage=getRiskStage(a);
  const score=riskScore(a);
  const openTriggers=[...triggerEvents.filter(t=>t.accountId===a.id && isTriggerLive(t))]
    .sort((x,y)=>triggerEffectiveWeight(y,a)-triggerEffectiveWeight(x,a));
  const touch=nextScheduledTouch(a);
  const ov=activeOverrideFor(a.id);
  const isOverridden=ov && !overrideIsStale(a,ov);
  const filterMatch=riskAlertFilter!=='all' && openTriggers.some(t=>t.triggerType===riskAlertFilter);
  // Aging = the score got worse purely because a problem sat unaddressed, not
  // because anything new happened - entirely preventable, flagged distinctly
  // from "a new issue appeared" so a CSM can tell the two apart at a glance.
  const isAging=openTriggers.some(t=>triggerWeightParts(t,a,new Date()).agingBonus>0);
  const unack=unackStageChange[a.id];
  const flashClass=unack?(unack.worse?' flash-worse':' flash-better'):'';
  const flashBadge=unack?`<span class="risk-flash-badge ${unack.worse?'p-red':'p-green'}">${unack.worse?'+':'−'}${unack.delta}</span>`:'';
  const pinned=isPinned(a.id);
  return `<div class="risk-card${filterMatch?' alert-match':''}${flashClass}${pinned?' pinned':''}" draggable="true" data-acct="${a.id}" data-stage="${stage}" onclick="openRiskCard('${a.id}')">
    ${flashBadge}
    <div class="risk-card-hd">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="display:flex;align-items:center;gap:6px;min-width:0">
          ${pinned?`<span class="pin-indicator" title="Pinned to top">📌</span>`:''}
          <b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</b>
        </span>
        <span style="display:flex;gap:4px;flex:0 0 auto">${isAging?`<span class="pill p-amber" title="Score increased from time elapsed on an unaddressed problem, not a new issue - preventable">⏱ Unaddressed</span>`:''}<span class="pill ${riskStagePillClass(stage)}">RS:${score}</span></span>
      </div>
      <span class="mini">${fmtMoney(a.renewalAmount)} · renews ${a.dclose>9000?'—':a.dclose+'d'}</span>
    </div>
    <div class="risk-card-badges">
      ${(()=>{
        const triggerPill=t=>`<span class="pill ${t.triggerType===riskAlertFilter?'p-blue':t.status==='pending'?'p-amber':'p-red'}" title="${t.status==='pending'?'Pending - action taken, not yet confirmed resolved':'Open'}">${esc(RISK_TRIGGER_LABELS[t.triggerType]||t.triggerType)}</span>`;
        // Cards with many open triggers used to render every tag unbounded,
        // making card (and column) height wildly inconsistent - cap what
        // shows by default and let a click reveal the rest instead.
        const CAP=3;
        const shown=openTriggers.slice(0,CAP), hidden=openTriggers.slice(CAP);
        return shown.map(triggerPill).join('')
          + (hidden.length?`<span class="pill p-gray clickable" onclick="event.stopPropagation();this.nextElementSibling.style.display='contents';this.remove()">+${hidden.length} more</span><span style="display:none">${hidden.map(triggerPill).join('')}</span>`:'');
      })()}
      ${isOverridden?`<span class="pill p-blue">Overridden</span>`:''}
    </div>
    <div class="risk-card-touch">${touch?`Next touch: <b>${esc(fmtDate(touch.date))}</b> · ${esc(touch.type)}`:'No touch scheduled'}</div>
    <div class="mini" style="margin-top:2px;color:var(--muted2)">${esc(engagementDescriptorLine(a))}</div>
  </div>`;
}
function riskColumnHtml(stage,accts){
  let list=accts.filter(a=>getRiskStage(a)===stage);
  list = riskSort==='days' ? list.sort((a,b)=>daysInStage(b)-daysInStage(a)) : list.sort((a,b)=>(b.renewalAmount||0)-(a.renewalAmount||0));
  if(riskAlertFilter!=='all'){
    list=[...list].sort((a,b)=>(hasOpenTrigger(a.id,riskAlertFilter)?0:1)-(hasOpenTrigger(b.id,riskAlertFilter)?0:1));
  }
  // Pinning always wins, applied last (stable sort preserves everything
  // above within the pinned/unpinned groups) - a pinned account sits at the
  // top of its column regardless of sort mode or alert filter.
  list=[...list].sort((a,b)=>(isPinned(b.id)?1:0)-(isPinned(a.id)?1:0));
  return `<div class="risk-col" data-stage="${stage}">
    <div class="risk-col-hd"><span>${RISK_STAGE_LABELS[stage]}</span><span class="pill p-gray">${list.length}</span></div>
    <div class="risk-col-body">${list.map(riskCardHtml).join('')||'<p class="mini" style="padding:8px">No accounts</p>'}</div>
  </div>`;
}
// Shared across Accounts & Risk, Escalations and Active CTAs so toggling it
// on anywhere stays on when navigating between them - the whole point of the
// Test 10 sandbox is to demo a trigger firing on the risk board and watching
// it appear in Escalations/Active CTAs, which only works if all three pages
// agree on the same scoped set of accounts.
let riskTest10=false;
// Test10 "clean slate" - CSAT/NPS/Health start blank the moment Test10 is
// switched on (simulating "no data pulled yet"), and only un-blank per
// account once a real demo action represents a fresh pull for that specific
// account: a survey response for NPS/CSAT, or one of Health's own
// formula-relevant triggers (case_aging/case_blocked/cadence_gap/
// renewal_prep_stale/renewal_stage_behind) firing or resolving for Health.
// NPS-drop and TAP-refresh - this demo's other two triggers - deliberately
// do NOT reveal Health, since neither actually feeds Health's formula.
let test10Snapshot=LS.get('test10Snapshot',null); // {acctId:{nps,csat,health,tier,comps,riskARR}} while blanked, else null
let test10Revealed=LS.get('test10Revealed',{}); // acctId -> {npsCsat:bool, health:bool}
function saveTest10Snapshot(){ LS.set('test10Snapshot',test10Snapshot); }
function saveTest10Revealed(){ LS.set('test10Revealed',test10Revealed); }
const HEALTH_REVEALING_TRIGGERS=new Set(['case_aging','case_blocked','cadence_gap','renewal_prep_stale','renewal_stage_behind']);
function revealTest10Health(acctId){
  if(!isTest10Account(acctId)) return;
  test10Revealed[acctId]=test10Revealed[acctId]||{};
  if(!test10Revealed[acctId].health){ test10Revealed[acctId].health=true; saveTest10Revealed(); }
}
function revealTest10NpsCsat(acctId){
  if(!isTest10Account(acctId)) return;
  test10Revealed[acctId]=test10Revealed[acctId]||{};
  if(!test10Revealed[acctId].npsCsat){ test10Revealed[acctId].npsCsat=true; saveTest10Revealed(); }
}
function setRiskTest10(v){
  const wasOn=riskTest10;
  riskTest10=v;
  if(v && !wasOn){
    const snap={};
    TEST10_ACCOUNTS.forEach(name=>{
      const a=STATE.accounts.find(x=>x.name===name); if(!a) return;
      snap[a.id]={nps:a.nps,csatOverride:csat[a.id]??null,health:a.health,tier:a.tier,comps:a.comps,riskARR:a.riskARR};
    });
    test10Snapshot=snap; test10Revealed={};
    saveTest10Snapshot(); saveTest10Revealed();
    // Blanking otherwise only happens inside computeAll() (on the next full
    // reload) - without forcing it here too, toggling Test10 on mid-session
    // left every account's real nps/health/tier/comps/riskARR fully visible
    // (Account & CSM tabs kept showing real numbers) until a reload finally
    // ran computeAll() again.
    applyTest10DataBlanking();
  } else if(!v && wasOn && test10Snapshot){
    let csatChanged=false;
    Object.keys(test10Snapshot).forEach(id=>{
      const a=STATE.accounts.find(x=>x.id===id); if(!a) return;
      const s=test10Snapshot[id];
      a.nps=s.nps; a.health=s.health; a.tier=s.tier; a.comps=s.comps; a.riskARR=s.riskARR;
      if(s.csatOverride!=null) csat[id]=s.csatOverride; else delete csat[id];
      csatChanged=true;
    });
    if(csatChanged) LS.set('csat',csat);
    test10Snapshot=null; test10Revealed={};
    saveTest10Snapshot(); saveTest10Revealed();
  }
  route();
}
// Explicit, opt-in "start the demo over" action - deliberately NOT run
// automatically on every toggle-to-on (that was tried and reverted: it
// silently wiped in-progress CTAs/escalations any time someone flipped to
// Full book and back mid-session, which is a completely normal thing to do
// and broke click-through into records that should still have existed). This
// is the one place a full wipe + re-blank happens outside of a real page
// reload, and only when the CSM actually asks for it.
function resetTest10Demo(){
  if(!confirm('Reset the Test10 demo? This clears every CTA, escalation, and success plan for the 10 pilot accounts, and re-blanks NPS/health until revealed again.')) return;
  resetTest10RiskBaseline();
  const snap={};
  TEST10_ACCOUNTS.forEach(name=>{
    const a=STATE.accounts.find(x=>x.name===name); if(!a) return;
    const base=(test10Snapshot && test10Snapshot[a.id]) || {nps:a.nps,csatOverride:csat[a.id]??null,health:a.health,tier:a.tier,comps:a.comps,riskARR:a.riskARR};
    snap[a.id]=base;
  });
  test10Snapshot=snap; test10Revealed={};
  saveTest10Snapshot(); saveTest10Revealed();
  applyTest10DataBlanking();
  toast('Test10 demo reset — clean slate.');
  route();
}
// Runs at the end of every computeAll() - overwrites whatever scoreAccount()
// etc. just (re)computed for a Test10 account's still-blanked fields, so the
// blank state survives every recompute until that specific field is revealed.
function applyTest10DataBlanking(){
  if(!riskTest10 || !test10Snapshot) return;
  TEST10_ACCOUNTS.forEach(name=>{
    const a=STATE.accounts.find(x=>x.name===name); if(!a) return;
    const rev=test10Revealed[a.id]||{};
    if(!rev.npsCsat){ a.nps=null; a.csat=null; }
    if(!rev.health){ a.health=null; a.tier=null; a.comps=[]; a.riskARR=null; }
  });
}
// Single shared quarter toggle for the whole app - every page that used to
// keep its own independent {year,q} selection now reads/writes this one
// instead, so picking a quarter anywhere applies everywhere.
let globalQSel=null;
function setGlobalQYear(y){ const cur=globalQSel||defaultQSel(); globalQSel={year:+y,q:cur.q}; route(); }
function setGlobalQQ(q){ const cur=globalQSel||defaultQSel(); globalQSel={year:cur.year,q:+q}; route(); }
function viewRiskKanban(accts){
  const scopedAccts = riskTest10 ? STATE.accounts.filter(a=>TEST10_ACCOUNTS.includes(a.name)) : accts;
  const alertOpts=Object.keys(RISK_TRIGGER_LABELS).map(k=>`<option value="${k}"${riskAlertFilter===k?' selected':''}>${esc(RISK_TRIGGER_LABELS[k])}</option>`).join('');
  const triggerBreakdown=riskTriggerBreakdown(scopedAccts).filter(b=>b.count>0);
  const {list:triggerRows,hasOther:triggerHasOther}=foldToOther(triggerBreakdown,8);
  const triggerColors=categoricalPalette(triggerRows.length,triggerHasOther);
  return `<div class="card"><h3>Trigger types</h3>
    ${triggerRows.length?`<table style="margin-top:10px"><thead><tr><th>Trigger</th><th class="num">Count</th></tr></thead><tbody>
      ${triggerRows.map((b,i)=>`<tr><td><i class="dot" style="background:${triggerColors[i]}"></i> ${esc(b.label)}</td><td class="num"><b>${b.count}</b></td></tr>`).join('')}
      </tbody></table>`:`<p class="mini" style="margin-top:8px">No open alerts right now.</p>`}
  </div>
  <div class="card">
    <h3>Accounts & Risk<span class="sortbar">
      <label class="mini" style="display:flex;align-items:center;gap:6px">Sort
        <select onchange="setRiskSort(this.value)"><option value="arr"${riskSort==='arr'?' selected':''}>TCV (desc)</option><option value="days"${riskSort==='days'?' selected':''}>Days in stage (desc)</option></select>
      </label>
      <label class="mini" style="display:flex;align-items:center;gap:6px">Surface alert
        <select onchange="setRiskAlertFilter(this.value)"><option value="all"${riskAlertFilter==='all'?' selected':''}>All alerts</option>${alertOpts}</select>
      </label>
      <button type="button" class="btn sm${riskTest10?' primary':''}" onclick="setRiskTest10(${riskTest10?'false':'true'})">${riskTest10?'← Back to full book':'Test 10 (all Stable)'}</button>
      ${riskTest10?`<button type="button" class="btn sm" onclick="refreshSheetData()" title="Pull the latest NPS/CSAT survey responses and re-evaluate triggers">↻ Refresh from Sheet</button><span class="mini">${sheetLastFetch?'Last refreshed '+sheetLastFetch.toLocaleTimeString():''}</span><button type="button" class="btn sm" onclick="resetTest10Demo()" title="Clear every CTA/escalation/plan for the 10 pilot accounts and re-blank NPS/health">⟲ Reset demo</button>`:''}
    </span></h3>
    <div class="kanban-board">${RISK_STAGES.map((s,i)=>{
      const sepAfter={healthy:'var(--green)',atrisk:'var(--amber)',escalated:'var(--red)'};
      const sep=sepAfter[s]?`<div class="kanban-sep" style="background:${sepAfter[s]}"></div>`:'';
      return riskColumnHtml(s,scopedAccts)+sep;
    }).join('')}</div>
  </div>`;
}
// ---- Org config: slot switcher + full trigger editor (enable/label/category/
// weight) + custom trigger builder. This is the actual surface an org's
// settings change through - the chat feature (once built) just writes to the
// exact same functions a CSM clicking these controls would call.
function triggerWeight(key){ const c=customTriggerDef(key); return c ? c.weight : (riskWeights.weights[key]??1); }
function setTriggerWeight(key,v){
  const val=Math.max(0,+v||0); const c=customTriggerDef(key);
  if(c){ c.weight=val; LS.set('customTriggers',customTriggers); } else { riskWeights.weights[key]=val; saveRiskWeights(); }
  route();
}
function setTriggerEnabled(key,v){ triggerEnabled[key]=!!v; LS.set('triggerEnabled',triggerEnabled); route(); }
function setTriggerLabelOverride(key,v){
  v=(v||'').trim();
  if(v && v!==RISK_TRIGGER_LABELS_BASE[key]) triggerLabelOverrides[key]=v; else delete triggerLabelOverrides[key];
  LS.set('triggerLabelOverrides',triggerLabelOverrides); route();
}
function setTriggerCategoryOverride(key,v){ triggerCategoryOverrides[key]=v; LS.set('triggerCategoryOverrides',triggerCategoryOverrides); route(); }
function addCustomTrigger(){
  const keyEl=$('#newTriggerKey'),labelEl=$('#newTriggerLabel'),catEl=$('#newTriggerCategory'),wEl=$('#newTriggerWeight');
  let key=(keyEl&&keyEl.value||'').trim().toLowerCase().replace(/[^a-z0-9_]+/g,'_');
  const label=(labelEl&&labelEl.value||'').trim();
  if(!key||!label){ toast('Give the trigger a key and a label.'); return; }
  if(customTriggerDef(key)||RISK_TRIGGER_LABELS_BASE[key]){ toast('That trigger key already exists — pick a unique one.'); return; }
  customTriggers.push({key,label,category:(catEl&&catEl.value)||'manual',weight:Math.max(0,+(wEl&&wEl.value)||1)});
  LS.set('customTriggers',customTriggers);
  toast('Added "'+label+'" — enable it below, or fire it from any account\'s Simulate list.');
  route();
}
function removeCustomTrigger(key){
  if(!confirm('Remove custom trigger "'+key+'"? Any currently-open events of this type stay on the board but the trigger itself won\'t fire again.')) return;
  customTriggers=customTriggers.filter(c=>c.key!==key); LS.set('customTriggers',customTriggers);
  delete triggerEnabled[key]; delete triggerLabelOverrides[key]; delete triggerCategoryOverrides[key];
  LS.set('triggerEnabled',triggerEnabled); LS.set('triggerLabelOverrides',triggerLabelOverrides); LS.set('triggerCategoryOverrides',triggerCategoryOverrides);
  route();
}
const ORG_CONFIG_CATEGORY_OPTIONS=['escalation','renewal','usage','case_watch','cadence','manual'];
function orgConfigCategoryLabel(cat){ return cat==='escalation'?'Escalation':(CTA_CATEGORY_LABELS[cat]||cat); }
function orgConfigSlotSwitcherHtml(){
  const names=Object.keys(orgConfigSlots);
  return `<div class="card"><h3>Active configuration</h3>
    <div class="row-actions" style="flex-wrap:wrap;align-items:flex-end">
      <label class="mini">Config
        <select class="select" style="display:block;margin-top:4px;min-width:200px" onchange="setActiveOrgConfig(this.value)">
          ${names.map(n=>`<option value="${esc(n)}" ${n===activeOrgConfigName?'selected':''}>${esc(n)}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="btn sm" onclick="const n=prompt('Save current settings as a new config named:'); if(n) saveCurrentConfigAs(n)">Save current as new…</button>
      <button type="button" class="btn sm" onclick="resetActiveConfigToDefault()">Reset "${esc(activeOrgConfigName)}" to Axon Default</button>
      ${activeOrgConfigName!=='Demo Baseline'?`<button type="button" class="btn sm" style="border-color:var(--red);color:var(--red)" onclick="deleteOrgConfigSlot('${esc(activeOrgConfigName)}')">Delete this config</button>`:''}
    </div>
  </div>`;
}
function riskWeightsPanelHtml(){
  const allKeys=Object.keys(RISK_TRIGGER_LABELS);
  const rows=allKeys.map(k=>{
    const cust=customTriggerDef(k);
    const enabled=triggerIsEnabled(k);
    return `<tr style="${enabled?'':'opacity:.5'}">
      <td><input type="checkbox" ${enabled?'checked':''} onchange="setTriggerEnabled('${k}',this.checked)"></td>
      <td><input type="text" class="select" style="min-width:200px" value="${esc(RISK_TRIGGER_LABELS[k]||'')}" onchange="setTriggerLabelOverride('${k}',this.value)"></td>
      <td><select class="select" onchange="setTriggerCategoryOverride('${k}',this.value)">${ORG_CONFIG_CATEGORY_OPTIONS.map(c=>`<option value="${c}" ${c===CTA_CATEGORY_BY_TRIGGER[k]?'selected':''}>${esc(orgConfigCategoryLabel(c))}</option>`).join('')}</select></td>
      <td><input type="number" min="0" style="width:60px" value="${triggerWeight(k)}" onchange="setTriggerWeight('${k}',this.value)"></td>
      <td class="mini">${cust?'Custom':'Built-in'}</td>
      <td>${cust?`<button type="button" class="btn sm" style="border-color:var(--red);color:var(--red)" onclick="removeCustomTrigger('${k}')">Remove</button>`:''}</td>
    </tr>`;
  }).join('');
  return `<div class="card"><h3>Tune trigger weights, labels, routing & on/off</h3>
    <p class="mini" style="line-height:1.7">Every open, enabled trigger contributes points based on its weight (an open escalation's points scale with its real severity, not just whether one exists). Points also grow the longer a trigger stays open. Disabling a trigger stops it from firing at all - it simply never happens for this config, everywhere in the app.</p>
    <div style="overflow-x:auto"><table><thead><tr><th>On</th><th>Label</th><th>Routes to</th><th>Weight</th><th>Type</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="row-actions" style="margin-top:14px;flex-wrap:wrap">
      <label class="mini">Elevated Risk at score ≥ <input type="number" min="0" style="width:50px" value="${riskWeights.thresholds.elevated}" onchange="setRiskThreshold('elevated',this.value)"></label>
      <label class="mini">Active Risk at score ≥ <input type="number" min="0" style="width:50px" value="${riskWeights.thresholds.active}" onchange="setRiskThreshold('active',this.value)"></label>
      <label class="mini">Aging: +bonus every <input type="number" min="0" style="width:50px" value="${riskWeights.agingDays}" onchange="setRiskAging('agingDays',this.value)"> days a trigger stays open, bonus = <input type="number" min="0" style="width:50px" value="${riskWeights.agingBonus}" onchange="setRiskAging('agingBonus',this.value)"></label>
    </div>
  </div>
  <div class="card"><h3>Add a custom trigger</h3>
    <div class="row-actions" style="flex-wrap:wrap">
      <input type="text" id="newTriggerKey" class="select" placeholder="key (e.g. radio_refresh_due)" style="min-width:180px">
      <input type="text" id="newTriggerLabel" class="select" placeholder="Label shown in the app" style="min-width:220px">
      <select id="newTriggerCategory" class="select">${ORG_CONFIG_CATEGORY_OPTIONS.map(c=>`<option value="${c}">${esc(orgConfigCategoryLabel(c))}</option>`).join('')}</select>
      <input type="number" id="newTriggerWeight" class="select" min="0" value="1" style="width:70px">
      <button type="button" class="btn sm primary" onclick="addCustomTrigger()">Add trigger</button>
    </div>
    <p class="mini" style="margin-top:8px">Once added, enable it above - it'll appear in every Simulate list and Surface-alert filter automatically, and route into the same Escalation/CTA machinery as everything else.</p>
  </div>`;
}
// ---- Org config chat: a real model call, not the human-in-the-loop pattern -
// this needs actual judgment (which org's context applies, does the request
// fit the fixed pipeline) every time, so there's no manual fallback for it;
// it just requires ANTHROPIC_API_KEY to be set. ----
let orgConfigChatLog=[]; // session-only: [{role,text,matchedOrg,diff,limitation,applied}]
function orgConfigChatHtml(){
  const entries=orgConfigChatLog.map((e,i)=>{
    if(e.role==='user') return `<div class="mini" style="margin:10px 0 4px"><b>You:</b> ${esc(e.text)}</div>`;
    return `<div class="card" style="box-shadow:none;margin:4px 0 10px;background:var(--panel2);border:1px solid ${e.limitation?'var(--amber)':'var(--violet)'}">
      <div class="mini" style="margin-bottom:4px">${e.matchedOrg?`<span class="pill p-violet">${esc(e.matchedOrg)}</span>`:''}${e.limitation?' <span class="pill p-amber">Not supported as-is</span>':''}${e.applied?' <span class="pill p-green">Applied</span>':''}</div>
      <p class="mini" style="font-weight:600;color:var(--ink);margin-bottom:4px">${e.limitation?'Why this doesn\'t fit:':'What this changes:'}</p>
      <p class="mini">${esc(e.text)}</p>
      ${e.diff?`<p class="mini" style="margin:10px 0 4px;color:var(--muted2)">Config diff (JSON) — this is exactly what "Apply" will write:</p>
        <pre class="mini" style="white-space:pre-wrap;background:var(--panel);padding:8px;border-radius:6px;max-height:200px;overflow:auto">${esc(JSON.stringify(e.diff,null,2))}</pre>
        <div class="row-actions" style="margin-top:8px">${e.applied?'':`<button type="button" class="btn sm primary" onclick="applyOrgConfigChatDiff(${i})">Apply this change</button>`}</div>`:''}
    </div>`;
  }).join('');
  return `<div class="card"><h3>Ask about your org's settings <span class="hint">real model call — a running conversation, not one-shot: keep adding requests, each reply refines the same proposal, until you click Apply</span></h3>
    <div id="orgConfigChatLog">${entries||'<p class="mini">No requests yet — try "Weight a blocked case higher for our 911 team" or "We don\'t care about QBRs."</p>'}</div>
    <textarea id="orgConfigChatInput" class="select" rows="2" style="width:100%;margin-top:8px" placeholder="Describe what you want changed, or add to / adjust what's already proposed above…"></textarea>
    <div class="row-actions" style="margin-top:8px"><button type="button" class="btn sm primary" id="orgConfigChatBtn" onclick="requestOrgConfigChat()">Ask</button>${orgConfigChatLog.length?`<button type="button" class="btn sm" onclick="if(confirm('Clear this conversation? Nothing already applied is affected.')){orgConfigChatLog=[];route();}">Clear conversation</button>`:''}</div>
    <div id="orgConfigChatStatus" class="mini" style="margin-top:6px;color:var(--muted2)"></div>
  </div>`;
}
// Continuous conversation, not one-shot per message: every request sends the
// prior exchanges (text + whatever diff was on the table at that point) so a
// follow-up like "also weight X higher" or "actually make that a CTA not an
// escalation" refines the SAME running proposal instead of starting over.
// The backend is instructed to always return the full cumulative diff given
// this history, not just the delta implied by the newest message alone.
async function requestOrgConfigChat(){
  const input=$('#orgConfigChatInput'); const msg=(input&&input.value||'').trim();
  if(!msg) return;
  const btn=$('#orgConfigChatBtn'), statusEl=$('#orgConfigChatStatus');
  const history=orgConfigChatLog.map(e=>({role:e.role,text:e.text,diff:e.diff||null}));
  orgConfigChatLog.push({role:'user',text:msg});
  if(input) input.value='';
  if(btn){ btn.disabled=true; btn.textContent='Thinking…'; }
  route();
  try{
    const res=await fetch('/api/org-config-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,currentConfig:JSON.stringify(currentConfigBundle()),history})});
    const d=await res.json();
    if(!res.ok){ orgConfigChatLog.push({role:'assistant',text:d.detail||'Could not process that request.'}); }
    else{ orgConfigChatLog.push({role:'assistant',text:d.limitation||d.explanation,matchedOrg:d.matchedOrg,diff:d.diff,limitation:d.limitation}); }
  }catch(e){ orgConfigChatLog.push({role:'assistant',text:'Could not reach the backend.'}); }
  if(btn){ btn.disabled=false; btn.textContent='Ask'; }
  route();
  setTimeout(()=>{ const el=$('#orgConfigChatInput'); if(el) el.focus(); },50);
}
function applyOrgConfigChatDiff(idx){
  const e=orgConfigChatLog[idx]; if(!e||!e.diff) return;
  const diff=e.diff;
  if(diff.triggers) Object.keys(diff.triggers).forEach(key=>{
    const t=diff.triggers[key];
    if(t.enabled!=null) triggerEnabled[key]=!!t.enabled;
    if(t.label!=null){ if(t.label!==RISK_TRIGGER_LABELS_BASE[key]) triggerLabelOverrides[key]=t.label; else delete triggerLabelOverrides[key]; }
    if(t.category!=null) triggerCategoryOverrides[key]=t.category;
    if(t.weight!=null){ const c=customTriggerDef(key); if(c) c.weight=+t.weight; else riskWeights.weights[key]=+t.weight; }
  });
  if(diff.customTriggers) diff.customTriggers.forEach(ct=>{
    if(ct.key && !customTriggerDef(ct.key) && !RISK_TRIGGER_LABELS_BASE[ct.key]) customTriggers.push({key:ct.key,label:ct.label||ct.key,category:ct.category||'manual',weight:ct.weight??1});
  });
  LS.set('triggerEnabled',triggerEnabled); LS.set('triggerLabelOverrides',triggerLabelOverrides); LS.set('triggerCategoryOverrides',triggerCategoryOverrides);
  LS.set('customTriggers',customTriggers); saveRiskWeights();
  e.applied=true;
  toast('Applied — settings updated.');
  route();
  // Applying is the point this stops being a scratch conversation and
  // becomes a real, named config slot - same slot system Configure Org Data
  // already uses (orgConfigSlots), just prompted right at the moment of
  // commit instead of a separate "Save current as new…" step.
  setTimeout(()=>{
    const n=prompt('Save this configuration as (a new or existing config name):', activeOrgConfigName!=='Axon Default'?activeOrgConfigName:'');
    if(n) saveCurrentConfigAs(n);
  },50);
}
// HTML5 drag/drop, wired after every render (cards are recreated each time).
function wireRiskKanbanDnD(){
  document.querySelectorAll('.risk-card').forEach(card=>{
    card.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',card.dataset.acct); card.classList.add('dragging'); });
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  });
  document.querySelectorAll('.risk-col').forEach(col=>{
    col.addEventListener('dragover',e=>{ e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave',()=>col.classList.remove('drag-over'));
    col.addEventListener('drop',e=>{
      e.preventDefault(); col.classList.remove('drag-over');
      const acctId=e.dataTransfer.getData('text/plain');
      requestRiskOverrideDrag(acctId,col.dataset.stage);
    });
  });
}
// ---- Expanded card: dated activity timeline + recommended-action buttons ----
function riskTimelineFor(acctId){
  const entries=[];
  triggerEvents.filter(t=>t.accountId===acctId).forEach(t=>{
    entries.push({t:t.firedAt,kind:'trigger-fired',data:t});
    if(t.actionNote) entries.push({t:t.actionNote.at,kind:'trigger-pending',data:t});
    if(t.resolution) entries.push({t:t.resolution.at,kind:'trigger-resolved',data:t});
  });
  ctas.filter(c=>c.acctId===acctId).forEach(c=>entries.push({t:c.createdAt,kind:'cta',data:c}));
  // Active CTAs (non-escalation - escalation's own step tracking lives in
  // escState, handled separately below) each get their own dated entry per
  // step advance, same principle as the escalation checklist: every step
  // sent/done is a new timeline item, not an in-place update.
  engagementCtas.filter(c=>c.accountId===acctId && c.category!=='escalation').forEach(c=>{
    entries.push({t:c.createdAt,kind:'ce-cta-created',data:c});
    c.steps.forEach(s=>{
      if(s.sent && s.sentAt) entries.push({t:s.sentAt,kind:'ce-cta-step',data:{step:s,cta:c}});
      if(s.done && s.doneAt) entries.push({t:s.doneAt,kind:'ce-cta-step',data:{step:s,cta:c}});
    });
  });
  const esc0=escState[acctId];
  if(esc0 && esc0.openedAt) entries.push({t:esc0.openedAt,kind:'escalation',data:esc0});
  // Every checklist step completion is its own dated entry, not just an
  // in-place update to one static blob - so checking step 1 (with the rest
  // still unchecked) genuinely shows up as a new timeline item, and so does
  // step 2, and so on, until the whole thing is resolved.
  if(esc0 && esc0.steps) esc0.steps.forEach(s=>{ if(s.done && s.doneAt) entries.push({t:s.doneAt,kind:'esc-step',data:{step:s,acctId}}); });
  return entries.sort((a,b)=>new Date(a.t)-new Date(b.t));
}
// Live, interactive resolution checklist - shown on the current "pending"
// entry for an escalation-driven trigger so a CSM can check things off right
// from the risk board (mirrors Account 360). Checking a box doesn't just
// update this widget in place - it also logs its own new esc-step entry.
function escChecklistHtml(acctId){
  const st=peekEscState(acctId);
  const done=st.steps.filter(s=>s.done).length;
  return `<div class="esc-checklist" style="margin-top:8px">
    <div class="mini" style="margin-bottom:6px">Escalation in progress — ${done} of ${st.steps.length} steps complete</div>
    <div class="progress" style="margin-bottom:8px"><i style="width:${Math.round(done/st.steps.length*100)}%"></i></div>
    ${st.steps.map(s=>`<label class="mini" style="display:flex;align-items:center;gap:8px;margin-bottom:4px;cursor:pointer">
      <input type="checkbox" ${s.done?'checked':''} onchange="toggleEscStep('${acctId}','${s.id}',this.checked)">
      <span style="${s.done?'text-decoration:line-through;color:var(--muted2)':''}">${esc(s.label)}</span>
      ${s.done&&s.doneAt?`<span class="mini" style="color:var(--muted2);margin-left:auto">${esc(fmtDate(s.doneAt))}</span>`:''}
    </label>`).join('')}
  </div>`;
}
function goToEscalationPage(acctId){
  closeRiskCard();
  const engC=engagementCtas.find(c=>c.accountId===acctId && c.category==='escalation' && engagementCtaEffectiveStatus(c)!=='dismissed' && engagementCtaEffectiveStatus(c)!=='done');
  if(engC) openEngagementCta(engC.id); else setTab('escalations');
}
// Every entry that moves the score shows its exact contribution: red +X when
// a trigger fires (justifying why the score went up), green -X when it
// resolves/gets dismissed (justifying why it came back down) - so the
// timeline reads as a running ledger of why the account ended up where it is.
// Every entry's bolded title is clickable and takes you to wherever that
// specific thing actually lives (email history, the escalation page, CTAs -
// whatever applies), same destination logic as the recommended-action button.
function riskTimelineEntryHtml(e,a){
  const when=fmtDate(e.t);
  if(e.kind==='trigger-fired'){
    const t=e.data;
    const fired=triggerWeightParts(t,a,t.firedAt);
    const live=isTriggerLive(t);
    const now=live?triggerWeightParts(t,a,new Date()):null;
    const isAging=now && now.agingBonus>0;
    const statusPill2=t.status==='open'?'<span class="pill p-red">Open</span>':t.status==='pending'?'<span class="pill p-amber">Pending</span>':t.status==='dismissed'?'<span class="pill p-gray">Dismissed</span>':'<span class="pill p-green">Resolved</span>';
    return `<div class="timeline-entry">
      <div class="timeline-dot${isAging?' aging':''}"></div>
      <div class="timeline-body${isAging?' aging-flag':''}">
        <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0"><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="goToActionDestination('${t.id}')">Trigger fired: ${esc(RISK_TRIGGER_LABELS[t.triggerType]||t.triggerType)}</b> <span class="pill p-red">+${fired.total}</span> ${statusPill2}</div>
        ${isAging?`<div class="mini" style="margin-top:2px"><span class="pill p-amber">⏱ Now +${now.total} — includes +${now.agingBonus} from sitting open ${now.daysOpen}d unaddressed (preventable)</span></div>`:''}
        <div class="mini">Source value ${esc(String(t.sourceValue))}${t.thresholdValue!=null?' vs. threshold '+esc(String(t.thresholdValue)):''}</div>
        ${t.status==='open'?`<div class="row-actions" style="margin-top:8px">
          <button type="button" class="btn sm primary" onclick="requestTriggerAction('${t.id}')">${esc(RISK_ACTION_LABELS[t.recommendedAction]||'Take action')}</button>
          <button type="button" class="btn sm" style="background:var(--greenbg);color:var(--green);border-color:transparent" onclick="requestResolveTrigger('${t.accountId}','${t.id}')">Resolved</button>
          <button type="button" class="btn sm" onclick="requestDismissTrigger('${t.accountId}','${t.id}')">Mark reviewed, false positive</button>
        </div>`:''}
      </div>
    </div>`;
  }
  if(e.kind==='trigger-pending'){
    const t=e.data;
    const isEsc=t.recommendedAction==='escalate_to_support_lead'||t.recommendedAction==='review_escalation';
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--amber)"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0"><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="goToActionDestination('${t.id}')">${esc(t.actionNote.label)}</b><span class="pill p-amber">Pending</span></div>
      <div class="mini" style="font-style:italic">"${esc(t.actionNote.note||'')}" — still counts toward the score until confirmed resolved</div>
      ${t.status==='pending'?`<div class="row-actions" style="margin-top:8px">
        <button type="button" class="btn sm" style="background:var(--greenbg);color:var(--green);border-color:transparent" onclick="requestResolveTrigger('${t.accountId}','${t.id}')">Resolved</button>
        <button type="button" class="btn sm" onclick="requestDismissTrigger('${t.accountId}','${t.id}')">Mark reviewed, false positive</button>
      </div>`:''}
      ${t.status==='pending'&&isEsc?escChecklistHtml(t.accountId):''}
    </div></div>`;
  }
  if(e.kind==='esc-step'){
    const {step,acctId}=e.data;
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--blue)"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="goToEscalationPage('${acctId}')">Escalation step complete: ${esc(step.label)}</b></div>
    </div></div>`;
  }
  if(e.kind==='ce-cta-created'){
    const c=e.data;
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:${CTA_CATEGORY_COLOR[c.category]||'var(--line)'}"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="openEngagementCta('${c.id}')">${esc(CTA_CATEGORY_LABELS[c.category]||c.category)} CTA opened</b></div>
    </div></div>`;
  }
  if(e.kind==='ce-cta-step'){
    const {step,cta}=e.data;
    const label=step.type==='email'?(step.sent?'Email sent':'Email drafted'):step.label;
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:${CTA_CATEGORY_COLOR[cta.category]||'var(--line)'}"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="openEngagementCta('${cta.id}')">${esc(CTA_CATEGORY_LABELS[cta.category]||cta.category)}: ${esc(label)}</b></div>
    </div></div>`;
  }
  if(e.kind==='trigger-resolved'){
    const t=e.data;
    const w=triggerWeightAt(t,a,t.resolution.at);
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--green)"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0"><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="goToActionDestination('${t.id}')">${esc(RISK_TRIGGER_LABELS[t.triggerType]||t.triggerType)} resolved</b> <span class="pill p-green">-${w}</span></div>
      ${t.resolution.note?`<div class="mini" style="font-style:italic">${esc(t.resolution.note)}</div>`:''}
    </div></div>`;
  }
  if(e.kind==='cta'){
    const c=e.data;
    return `<div class="timeline-entry"><div class="timeline-dot"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="closeRiskCard();setTab('activectas')">CTA created: ${esc(c.title)}</b> <span class="pill p-gray">${esc(c.status)}</span></div>
    </div></div>`;
  }
  return `<div class="timeline-entry"><div class="timeline-dot"></div><div class="timeline-body">
    <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
    <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="goToEscalationPage('${e.data.acctId||a.id}')">Escalation raised</b> ${statusPill(e.data.status)}</div>
    ${(e.data.reasonCode||e.data.product)?`<div class="mini">${e.data.reasonCode?esc(e.data.reasonCode):''}${e.data.reasonCode&&e.data.product?' · ':''}${e.data.product?esc(e.data.product):''}</div>`:''}
  </div></div>`;
}
function riskSimulateControlsHtml(acctId){
  const opts=Object.keys(RISK_TRIGGER_LABELS).map(k=>`<option value="${k}">${esc(RISK_TRIGGER_LABELS[k])}</option>`).join('');
  return `<div class="row-actions" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
    <label class="mini">Demo: simulate a trigger firing
      <select id="riskSimSelect" class="select" style="margin-left:6px">${opts}</select>
    </label>
    <button type="button" class="btn sm" onclick="simulateRiskTrigger('${acctId}',$('#riskSimSelect').value)">Fire trigger</button>
  </div>`;
}
function openRiskCard(acctId){
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
  // Opening the card no longer clears the flash by itself - it only stops
  // once the CSM explicitly confirms the shift (see confirmStageShift), so
  // just glancing at a card doesn't silently swallow the notification.
  currentRiskCardId=acctId;
  const stage=getRiskStage(a);
  const timeline=riskTimelineFor(acctId);
  const score=riskScore(a);
  const unack=unackStageChange[acctId];
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2><span style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="closeRiskCard();openAcct('${a.id}')">${esc(a.name)}</span> <span class="pill p-blue">${esc(RISK_STAGE_LABELS[stage]||stage)}</span></h2>
    <div class="mini">${fmtMoney(a.renewalAmount)} TCV · renews in ${a.dclose>9000?'—':a.dclose+'d'} · Owner ${esc(a.ownerName||'—')}</div></div>
    <button class="x" onclick="closeRiskCard()">✕</button></div>
  <div class="bd">
    ${unack?`<div class="card" style="box-shadow:none;margin:0 0 16px;border:1px solid ${unack.worse?'var(--red)':'var(--green)'};background:${unack.worse?'var(--redbg)':'var(--greenbg)'}">
      <h4 style="margin:0 0 6px">Stage changed: ${esc(RISK_STAGE_LABELS[unack.fromStage]||unack.fromStage)} → ${esc(RISK_STAGE_LABELS[unack.toStage]||unack.toStage)} <span class="pill ${unack.worse?'p-red':'p-green'}">${unack.worse?'+':'−'}${unack.delta}</span></h4>
      <div class="row-actions"><button type="button" class="btn sm primary" onclick="confirmStageShift('${acctId}')">Confirm shift</button></div>
    </div>`:''}
    <div class="card" style="box-shadow:none;margin:0 0 16px;background:var(--panel2);opacity:.7">
      <h4 style="margin:0 0 6px">Likely root cause</h4>
      <p class="mini">Not enough historical data yet — this panel is reserved for a future root-cause suggestion feature once enough resolved-trigger outcomes exist to pattern-match against.</p>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px">
      <h4 style="margin:0 0 4px;display:flex;align-items:center;gap:8px">Current <span class="pill ${riskStagePillClass(stage)}" style="font-size:13px">RS:${score}</span> → ${esc(RISK_STAGE_LABELS[stage]||stage)}</h4>
      <p class="mini">Stable at 0 · Early Signal ≥1 · Elevated Risk ≥${riskWeights.thresholds.elevated} · Active Risk ≥${riskWeights.thresholds.active} — every +/- below adds up to this total.</p>
    </div>
    <h4 style="margin:0 0 10px">Activity timeline</h4>
    <div class="timeline">${timeline.length?timeline.map(e=>riskTimelineEntryHtml(e,a)).join(''):'<p class="mini">Nothing logged yet for this account.</p>'}</div>
    <div class="row-actions" style="margin-top:14px">
      <button type="button" class="btn sm${isPinned(acctId)?' primary':''}" onclick="togglePin('${acctId}')">${isPinned(acctId)?'📌 Unpin from top':'📌 Pin to top of column'}</button>
      ${isChurned(acctId)?`<span class="mini">Marked churned ${esc(fmtDate(churnedAccounts[acctId].at))}: "${esc(churnedAccounts[acctId].reason)}"</span><button type="button" class="btn sm" onclick="unmarkChurned('${acctId}')">Undo churned status</button>`
        :`<button type="button" class="btn sm" onclick="requestMarkChurned('${acctId}')">Mark account as churned</button>`}
    </div>
    ${riskSimulateControlsHtml(acctId)}
  </div>`;
  showOverlay();
}
function closeRiskCard(){ currentRiskCardId=null; closeSheet(); }
// The only thing that actually clears a pending flash - explicit CSM
// confirmation, not merely opening the card.
function confirmStageShift(acctId){
  delete unackStageChange[acctId];
  route();
  if(currentRiskCardId===acctId) openRiskCard(acctId);
}

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
function autoSeverity(a){ if((a.health!=null&&a.health<40)||a.highCases>=3) return 'Critical'; if((a.health!=null&&a.health<55)||a.highCases>=1) return 'High'; if(a.health!=null&&a.health<70) return 'Medium'; return 'Low'; }
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
// What actually completing each step means, so the Client Engagement stepper
// can point the CSM at the real next action instead of a bare checkbox:
// 'send' opens an editable email (customer-facing, except the internal
// engineering hand-off), 'receive' logs what came back from the customer,
// 'confirm' just closes the escalation out once everything above is done.
const ESC_STEP_ACTIONS=['send','receive','send','send','receive','confirm'];
const ESC_STEP_AUDIENCE=['customer',null,'internal','customer',null,null];
// Deterministic ids (index-based, not random) so a step checked before the
// escState record exists yet still resolves to the same id once ensureEscState
// persists the template - see peekEscState below.
const freshEscSteps=()=>ESC_STEPS_TEMPLATE.map((label,i)=>({id:'s'+i,label,done:false,doneAt:null}));
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
  // The 10 risk-board pilot accounts are deliberately exempt from this
  // health-based auto-seeding - they're meant to be a clean, reproducible
  // demo sandbox (see resetTest10RiskBaseline), not subject to the same
  // implicit "low health = auto-open an escalation" inference as the rest of
  // the book.
  STATE.escList = STATE.accounts.filter(a=> a.tier!=='healthy' && (a.highCases>0 || a.health<60 || (a.dclose<=90)) && !TEST10_ACCOUNTS.includes(a.name))
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
  // Single choke point for opening an escalation, no matter which surface
  // triggered it (risk-board recommended action, Account 360's "Start
  // Escalation" button, or the demo trigger simulator) - so every escalation
  // shows up in Client Engagement's Escalations tab, not just the ones opened
  // through the risk-board email flow.
  if(status==='Open'||status==='In Progress') ensureEscalationCta(acctId);
  try{ rebuildEsc(); }catch(e){ console.warn(e); }
  if(STATE.tab==='riskboard') route();
}
function setEscReason(acctId,val){ const cur=ensureEscState(acctId); cur.reasonCode=val||null; LS.set('escState',escState); rebuildEsc(); if(STATE.tab==='riskboard') route(); }
function setEscProduct(acctId,val){ const cur=ensureEscState(acctId); cur.product=val||null; LS.set('escState',escState); rebuildEsc(); if(STATE.tab==='riskboard') route(); }
// Raw mutation only, no navigation - shared by toggleEscStep (below, for the
// risk board's/Account 360's instant checkbox) and the Client Engagement
// confirm-to-complete flow (requestCompleteEscStep), which needs to redraw
// its own page/sheet instead of jumping to Account 360.
function setEscStepDone(acctId,stepId,done){
  const cur=ensureEscState(acctId); const s=cur.steps.find(x=>x.id===stepId);
  if(s){ s.done=done; s.doneAt=done?new Date().toISOString():null; }
  LS.set('escState',escState);
}
function toggleEscStep(acctId,stepId,done){
  setEscStepDone(acctId,stepId,done);
  // Checking a step from the risk board's inline checklist should refresh
  // that card in place, not navigate away to Account 360 (which is what this
  // function does when called from there instead).
  if(currentRiskCardId===acctId){ route(); openRiskCard(acctId); }
  else openAcct(acctId);
}
function escStepProgress(steps){ if(!steps||!steps.length) return 0; return Math.round(steps.filter(s=>s.done).length/steps.length*100); }

// ---------- Client Engagement: unified CTA record store ----------
// Every call-to-action a CSM takes - renewal outreach, an adoption nudge, a
// case-watch follow-up, an escalation, or a routine cadence check-in - is one
// record type in one store, not four separate objects. This is deliberately
// ADDITIVE: the existing flat `ctas` array (My Worklist/CTAs tab), `escState`
// (Account 360's escalation card) and `emailCompose`/`emailDrafts` (Email
// Outreach) all keep working exactly as they did - this store reads/writes
// alongside them (see requestTriggerAction/emailRecordDraft wiring below and
// sendEngagementCtaDraft) rather than replacing their underlying storage.
// {id, accountId, category, status:'open'|'in_progress'|'done'|'dismissed',
//  originatingTriggerType, createdAt, discardedReason, discardedAt,
//  steps:[{seq,type:'email',label,subject,body,recipient,sent,sentAt}, ...]}
// Step 1 is always the drafted email - every CTA follows this email-first
// sequence, escalations included (an escalation is just a CTA where
// category==='escalation', same schema, no separate object type - it just
// gets a red border and sorts first). Steps after step 1 are only meaningful
// for escalations today, and are read live from escState's own 6-step
// checklist rather than duplicated here, so there's exactly one place that
// checklist actually lives.
let engagementCtas = LS.get('engagementCtas',[]);
function saveEngagementCtas(){ LS.set('engagementCtas',engagementCtas); }
const CTA_CATEGORY_LABELS={renewal:'Renewal',usage:'Usage & Adoption',case_watch:'Case Watch',escalation:'Escalation',cadence:'Cadence check-in',manual:'Manual'};
// Which category a given risk-board trigger's action falls under, for when its
// email gets sent (see emailRecordDraft) - reuses the same "things that can't
// be solved by just an email must be escalation-coded" principle already
// applied to the A&R kanban's recommended-action mapping.
const CTA_CATEGORY_BY_TRIGGER_BASE={
  case_blocked:'escalation', case_aging:'escalation', nps_csat_drop:'escalation', escalation_opened:'escalation', negative_sentiment:'escalation',
  case_volume_spike:'escalation', no_exec_sponsor:'escalation', nps_trend_decline:'escalation',
  usage_drop:'usage', onboarding_stall:'usage', onboarding_no_plan:'usage',
  renewal_prep_stale:'renewal', renewal_stage_behind:'renewal', growth_mix_stalled:'renewal',
  tap_refresh_due:'case_watch',
  cadence_gap:'cadence', qbr_overdue:'cadence',
};
// Same live-Proxy pattern as RISK_TRIGGER_LABELS above - every existing
// CTA_CATEGORY_BY_TRIGGER[key] call site (routing, TRIGGER_SOURCES table,
// Active CTAs filters, etc.) automatically respects a category override or a
// custom trigger's declared category, with zero call-site changes.
const CTA_CATEGORY_BY_TRIGGER=new Proxy(CTA_CATEGORY_BY_TRIGGER_BASE,{
  get(target,key){
    if(typeof key!=='string') return target[key];
    if(triggerCategoryOverrides[key]!=null) return triggerCategoryOverrides[key];
    if(key in target) return target[key];
    const c=customTriggerDef(key); return c?c.category:undefined;
  },
  has(target,key){ return key in target || !!customTriggerDef(key); },
  ownKeys(target){ return [...new Set([...Reflect.ownKeys(target), ...customTriggers.map(c=>c.key)])]; },
  getOwnPropertyDescriptor(target,key){
    if(key in target) return Reflect.getOwnPropertyDescriptor(target,key);
    if(customTriggerDef(key)) return {enumerable:true,configurable:true,value:this.get(target,key)};
    return undefined;
  }
});
// Non-escalation CTAs get a simpler flow than escalation's 6-step checklist,
// all steps existing from the moment the CTA is created (same reasoning as
// escalation's freshEscSteps - every step is a real, clickable record from
// the start, never a locked placeholder waiting to be materialized).
// Two shapes:
//  - Standard (usage/cadence categories): email sent -> meeting scheduled ->
//    problem resolved. Purely CSM-to-customer, no other internal party has a
//    real stake in a usage check-in or a routine cadence touch.
//  - Branch (renewal/case_watch categories): email sent -> [Loop in sales]
//    and [Meeting scheduled] run in PARALLEL (order-independent, both
//    clickable/completable independently) -> problem resolved. These are the
//    triggers where sales/the AE has a real stake alongside the CSM - a
//    stalled or early-stage renewal affects their quota, a TAP refresh is
//    often a sales-driven procurement conversation - so the same email-sent
//    kickoff branches into an internal loop-in track and the customer-facing
//    track before converging on resolution.
const CTA_FOLLOWUP_STEPS=['Meeting scheduled','Problem resolved'];
const CTA_BRANCH_FOLLOWUP_STEPS=['Loop in sales','Meeting scheduled','Problem resolved'];
const CTA_BRANCH_CATEGORIES=['renewal','case_watch'];
function createEngagementCta(accountId,category,originatingTriggerType){
  // Branch categories (renewal/case_watch) auto-CC sales on the very first
  // email - sales has a stake in these from the start (quota-relevant
  // renewal, or a procurement conversation), not just once someone manually
  // works the separate "Loop in sales" step later.
  const cc=CTA_BRANCH_CATEGORIES.includes(category)?'sales@axon.com':'';
  const emailStep={id:'s0',seq:1,type:'email',label:'Email drafted',subject:'',body:'',recipient:'',cc,sent:false,sentAt:null,detail:null,notes:''};
  const followupLabels=CTA_BRANCH_CATEGORIES.includes(category)?CTA_BRANCH_FOLLOWUP_STEPS:CTA_FOLLOWUP_STEPS;
  const steps = category==='escalation' ? [emailStep] : [emailStep,...followupLabels.map((label,i)=>({id:'s'+(i+1),seq:i+2,type:'task',label,done:false,doneAt:null,detail:null,notes:''}))];
  const c={id:cid(),accountId,category,status:'open',originatingTriggerType:originatingTriggerType||null,createdAt:new Date().toISOString(),
    discardedReason:null,discardedAt:null,
    steps};
  engagementCtas.push(c);
  return c;
}
// Which real action a given step index means, category-aware since the
// branch categories insert an extra "Loop in sales" step at index 1 (pushing
// meeting/resolve to indexes 2/3) that the standard 3-step categories don't
// have.
function ctaStepActionType(c,stepIdx){
  if(stepIdx===0) return 'send';
  if(CTA_BRANCH_CATEGORIES.includes(c.category)){
    if(stepIdx===1) return 'sales_loop';
    if(stepIdx===2) return 'schedule';
    return 'confirm';
  }
  if(stepIdx===1) return 'schedule';
  return 'confirm';
}
// One-time upgrade for CTAs created before the branch flow existed - a
// renewal/case_watch CTA already sitting in localStorage still has the old
// 3-step shape (email, meeting, resolved) and would otherwise never pick up
// the new "Loop in sales" branch step just by editing the code, since
// createEngagementCta only runs once at creation time. Splices the new step
// in at index 1 and re-sequences the two steps after it - existing
// done/detail/notes on the meeting/resolved steps are preserved untouched.
function migrateCtaStepsForBranchCategories(){
  let changed=false;
  engagementCtas.forEach(c=>{
    if(c.category==='escalation') return;
    const isBranch=CTA_BRANCH_CATEGORIES.includes(c.category);
    // Covers two different legacy shapes a non-escalation CTA can still be
    // stuck in, neither of which the current createEngagementCta would ever
    // produce for a new record:
    //  - steps.length===1: predates even the old 3-step model - back when
    //    follow-up steps were appended lazily only once the first email
    //    sent (appendCtaFollowupSteps, since removed in favor of building
    //    every step upfront). A CTA that was created but never sent is
    //    stuck at just the email step forever with no code path left to
    //    grow it - every CTA must have at least 3 steps (or 4 if branch).
    //  - steps.length===3 on a branch-category CTA: predates the
    //    Loop-in-sales branch step existing at all.
    if(c.steps.length===1){
      const labels=isBranch?CTA_BRANCH_FOLLOWUP_STEPS:CTA_FOLLOWUP_STEPS;
      labels.forEach((label,i)=>{ c.steps.push({id:'s'+(i+1),seq:i+2,type:'task',label,done:false,doneAt:null,detail:null,notes:''}); });
      changed=true;
    } else if(isBranch && c.steps.length===3){
      const salesLoopStep={id:'s1',seq:2,type:'task',label:'Loop in sales',done:false,doneAt:null,detail:null,notes:''};
      const meeting=c.steps[1], resolved=c.steps[2];
      meeting.id='s2'; meeting.seq=3;
      resolved.id='s3'; resolved.seq=4;
      c.steps=[c.steps[0],salesLoopStep,meeting,resolved];
      changed=true;
    }
    // Also backfills the sales CC on step0 for CTAs that got a branch step
    // shape above (or were created before the auto-CC existed) but whose
    // first email hasn't been sent yet - once sent, the recipients are
    // locked in as a record of what actually went out, not silently rewritten.
    if(isBranch && !c.steps[0].sent && !c.steps[0].cc){ c.steps[0].cc='sales@axon.com'; changed=true; }
  });
  if(changed) saveEngagementCtas();
}
// Escalations can be opened from several places (risk-board recommended
// action, Account 360's "Start Escalation" button, the demo trigger
// simulator) - this is the one place that guarantees an escalation-category
// CTA exists for an account the moment its escalation opens, no matter which
// surface did it, so the Escalations tab never silently misses one. Reuses
// an existing open/in-progress escalation CTA for this account rather than
// stacking duplicates.
function ensureEscalationCta(acctId,originatingTriggerType){
  const existing=engagementCtas.find(c=>c.accountId===acctId && c.category==='escalation' && engagementCtaEffectiveStatus(c)!=='dismissed' && engagementCtaEffectiveStatus(c)!=='done');
  if(existing) return existing;
  const a=STATE.accounts.find(x=>x.id===acctId);
  const c=createEngagementCta(acctId,'escalation',originatingTriggerType||'escalation_opened');
  // No drafted-email flow necessarily happened (e.g. Account 360's own
  // "Start Escalation" button doesn't draft one) - mark step 1 sent so this
  // doesn't sit stranded in Drafts; the real record of what happened lives on
  // the escalation timeline entries below, same as the risk board.
  c.steps[0].sent=true; c.steps[0].sentAt=new Date().toISOString();
  c.steps[0].subject='Escalation opened — '+(a?a.name:'');
  c.status='in_progress';
  saveEngagementCtas();
  return c;
}
// A real, customer-facing email sent through the CTA's own step-1 draft flow
// (Client Engagement's Drafts tab, or the risk board's recommended action)
// satisfies the resolution checklist's own "Acknowledge issue with customer"
// step too - same email, so the CSM isn't asked to send two "first" emails.
// Only fires once (won't overwrite a step already completed) and never fires
// for the placeholder subject ensureEscalationCta stamps on - that one has no
// real content to show as an audit record.
function markEscAckStepDone(acctId,subject,body,recipient){
  const cur=ensureEscState(acctId);
  const s=cur.steps[0];
  if(s && !s.done){
    s.detail={subject,body,recipient,at:new Date().toISOString()};
    s.done=true; s.doneAt=s.detail.at;
    LS.set('escState',escState);
  }
}
// An escalation-category CTA isn't really "done" just because its first email
// went out - it's only done once the escalation is actually resolved (either
// its status is set to Resolved, or its whole resolution checklist is
// checked off) - computed live off escState rather than stored, so there's no
// risk of the two falling out of sync.
function engagementCtaEffectiveStatus(c){
  if(c.status==='dismissed') return 'dismissed';
  if(c.category==='escalation'){
    const st=peekEscState(c.accountId);
    if(st.status==='Resolved' || (st.steps.length && st.steps.every(s=>s.done))) return 'done';
    if(c.steps[0].sent) return 'in_progress';
    return 'open';
  }
  if(!c.steps[0].sent) return 'open';
  const followups=c.steps.slice(1);
  if(followups.length && !followups.every(s=>s.done)) return 'in_progress';
  return 'done';
}
// Lightweight, auto-generated check-in draft for the cadence trigger - built
// from the existing Meeting follow-up template's fill logic so the content is
// real (greeting, CSM name, account name), not a placeholder, but nothing here
// touches the Email Outreach composer's own in-flight draft.
function autoDraftCadenceCta(a){
  const draft=buildEmailDraft('cust_followup',a.id);
  const c=createEngagementCta(a.id,'cadence','cadence_gap');
  if(draft){ c.steps[0].subject='Checking in — '+a.name; c.steps[0].body=draft.body; c.steps[0].recipient=draft.to; }
  saveEngagementCtas();
}
function engagementCtasFor(accts){
  const ids=new Set(accts.map(a=>a.id));
  return engagementCtas.filter(c=>ids.has(c.accountId));
}
function ceDaysOpen(c){ return Math.max(0,Math.floor((Date.now()-new Date(c.createdAt).getTime())/864e5)); }
// Every fired trigger auto-creates its CTA/escalation record immediately
// (see fireTriggerWithCta below) - "active" means not done/dismissed yet,
// covering both a fresh unsent draft and one already in progress, so a
// trigger firing (which is what actually moves a card between risk stages)
// always shows up somewhere in Escalations or Active CTAs, not just Drafts.
function ceIsOpenOrInProgress(c){ const s=engagementCtaEffectiveStatus(c); return s==='open'||s==='in_progress'; }

// ---------- Client Engagement: mandatory-reason discard (no silent discarding,
// same override-logging principle as the A&R kanban's false-positive path) ----------
let pendingCtaDiscard=null;
function requestDiscardCta(ctaId){
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const a=STATE.accounts.find(x=>x.id===c.accountId);
  pendingCtaDiscard=ctaId;
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2>Discard draft</h2><div class="mini">${esc(a?a.name:'')} — a reason is required and stays on the record</div></div><button class="x" onclick="cancelCtaDiscard()">✕</button></div>
  <div class="bd">
    <label class="mini" style="display:block;margin-bottom:6px">Why discard this draft? (required)</label>
    <input type="text" id="ctaDiscardReason" class="select" style="width:100%" placeholder="e.g. duplicate, no longer relevant, handled another way" onkeydown="if(event.key==='Enter')confirmCtaDiscard()">
    <div class="row-actions" style="margin-top:14px"><button type="button" class="btn primary" onclick="confirmCtaDiscard()">Confirm discard</button><button type="button" class="btn" onclick="cancelCtaDiscard()">Cancel</button></div>
  </div>`;
  showOverlay();
  setTimeout(()=>{ const el=$('#ctaDiscardReason'); if(el) el.focus(); },50);
}
function cancelCtaDiscard(){ pendingCtaDiscard=null; closeSheet(); }
function confirmCtaDiscard(){
  const input=$('#ctaDiscardReason'); const reason=(input&&input.value||'').trim();
  if(!reason){ if(input){ input.style.borderColor='var(--red)'; input.focus(); } return; }
  const c=engagementCtas.find(x=>x.id===pendingCtaDiscard);
  if(c){ c.status='dismissed'; c.discardedReason=reason; c.discardedAt=new Date().toISOString(); saveEngagementCtas(); }
  pendingCtaDiscard=null;
  closeSheet();
  route();
}
// Sending a draft's step-1 email is the one choke point where the real side
// effects fire - mirrors the same principle already used for risk-triggered
// actions (emailRecordDraft): nothing happens until the CSM actually sends.
// Also marks the originating trigger "actioned" (status->pending) so it's
// queryable for a future "CTAs actioned in SLA" stat, and mirrors into the
// existing Email Outreach history log + account activity so this stays
// visible from those existing surfaces too, not just here.
function sendEngagementCtaDraft(ctaId){
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const step=c.steps[0];
  const subjEl=$('#ceDraftSubject_'+ctaId), bodyEl=$('#ceDraftBody_'+ctaId), toEl=$('#ceDraftTo_'+ctaId), ccEl=$('#ceDraftCc_'+ctaId);
  if(subjEl) step.subject=subjEl.value;
  if(bodyEl) step.body=bodyEl.value;
  if(toEl) step.recipient=toEl.value;
  if(ccEl) step.cc=ccEl.value;
  if(!(step.subject||'').trim() || !(step.body||'').trim()){ toast('Add a subject and message body before sending.'); return; }
  step.sent=true; step.sentAt=new Date().toISOString();
  c.status=engagementCtaEffectiveStatus(c);
  saveEngagementCtas();
  // Non-escalation CTAs get a per-CTA reference tag baked into the wire
  // subject (not the subject shown anywhere in the UI/history) - the
  // fabricated TAP "N months out" text is identical every time this demo
  // runs on a given account, so without a unique tag a reply after a rerun
  // could match a stale, already-superseded CTA's reply-watch too.
  const wireSubject = c.category!=='escalation' ? step.subject+ctaReplyRefTag(ctaId) : step.subject;
  sendTest10DemoEmail(c.accountId,wireSubject,step.body);
  const a=STATE.accounts.find(x=>x.id===c.accountId);
  emailDrafts.unshift({id:cid(),t:new Date().toISOString(),action:'sent',templateId:'engagement_'+c.category,templateName:'Client Engagement — '+(CTA_CATEGORY_LABELS[c.category]||c.category),audience:'customer',acctId:c.accountId,acctName:a?a.name:'',subject:step.subject,to:step.recipient,cc:step.cc||'',snippet:emailSnippet(step.body),ctaId:c.id,stage:step.label||'Email'});
  emailDrafts=emailDrafts.slice(0,40); saveEmailDrafts();
  if(a){
    pushActivityEntry(c.accountId,'Email',step.subject||'(sent)','Sent via Client Engagement ('+(CTA_CATEGORY_LABELS[c.category]||c.category)+').');
    syncLastActFromActivity(c.accountId);
    try{ scoreAccount(a); }catch(e){}
  }
  if(c.category==='escalation'){
    setEscStatus(c.accountId,'Open');
    markEscAckStepDone(c.accountId,step.subject,step.body,step.recipient);
  }
  if(c.originatingTriggerType){
    const t=[...triggerEvents].reverse().find(x=>x.accountId===c.accountId && x.triggerType===c.originatingTriggerType && isTriggerLive(x));
    if(t){ t.status='pending'; t.actionNote={label:RISK_ACTION_LABELS[t.recommendedAction]||'Email sent',at:new Date().toISOString(),note:`Email sent to ${step.recipient||'recipient'} — "${step.subject||''}"`}; saveTriggerEvents(); }
  }
  if(c.category!=='escalation') registerReplyWatch(ctaId);
  toast('Sent — see Sent history.');
  route();
}
// Short, unique-per-CTA suffix appended to the actual sent subject (never
// shown in the UI) - Gmail preserves the whole subject verbatim behind "Re:",
// so the backend poller can match on this tag alone instead of the full
// subject text, which stays identical across repeated demo runs on the same
// account.
function ctaReplyRefTag(ctaId){ return ' [ref:'+ctaId.slice(-6)+']'; }
// Test10 only - registers "this CTA is waiting on a reply" with the backend
// (backend/data/reply_watch/), then polls. A background poller on the
// backend (or, without an API key configured, a live Claude Code session)
// reads the actual Gmail reply and decides whether the CTA is resolved.
function registerReplyWatch(ctaId){
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const a=STATE.accounts.find(x=>x.id===c.accountId); if(!a||!isTest10Account(c.accountId)) return;
  const sentSubject=(c.steps[0].subject||'')+ctaReplyRefTag(ctaId);
  fetch('/api/reply-watch/'+ctaId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountName:a.name,ctaId,sentSubject,sentAt:c.steps[0].sentAt||new Date().toISOString()})})
    .then(r=>r.json()).then(()=>pollReplyWatch(ctaId,0)).catch(()=>{});
}
function pollReplyWatch(ctaId,attempt){
  if(attempt>240) return; // ~20 minutes at 5s intervals, then give up quietly
  fetch('/api/reply-watch/'+ctaId).then(r=>r.json()).then(d=>{
    if(d.status==='ready'){ applyReplyToCta(ctaId,d.note||'',d.replySnippet||''); return; }
    // "reading" = the backend found a matching reply and is actively
    // interpreting it (real, sometimes multi-second Claude call) - reflect
    // that on the CTA itself (transient, in-memory only) so the chevron can
    // show a real interim amber state instead of jumping straight to green.
    const c=engagementCtas.find(x=>x.id===ctaId);
    if(c){
      const wasReading=!!c.replyReading;
      c.replyReading = d.status==='reading';
      if(c.replyReading!==wasReading) route();
    }
    setTimeout(()=>pollReplyWatch(ctaId,attempt+1),5000);
  }).catch(()=>setTimeout(()=>pollReplyWatch(ctaId,attempt+1),5000));
}
// The actual "auto-complete the chevron chain" - marks every remaining step
// on the CTA done/sent, logs the reply itself into the same contact-log
// pipeline every other send/receive goes through (so it shows up in the
// matrix with a Stage/Status), and resolves the originating trigger so the
// account shifts back left on the kanban (prompting its own confirm-shift).
function applyReplyToCta(ctaId,note,replySnippet){
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  c.replyReading=false;
  const now=new Date().toISOString();
  c.steps.forEach((s,i)=>{
    if(i===0) return; // step 0 (the email) is already sent by this point
    if(s.type==='email'){ if(!s.sent){ s.sent=true; s.sentAt=now; s.detail={override:true,note:note||'Auto-completed from customer reply'}; } }
    else if(!s.done){ s.done=true; s.doneAt=now; s.detail={override:true,note:note||'Auto-completed from customer reply'}; }
  });
  c.status=engagementCtaEffectiveStatus(c);
  saveEngagementCtas();
  const a=STATE.accounts.find(x=>x.id===c.accountId);
  emailDrafts.unshift({id:cid(),t:now,direction:'received',action:'received',templateId:'reply_'+c.category,templateName:'Reply — '+(CTA_CATEGORY_LABELS[c.category]||c.category),audience:'customer',acctId:c.accountId,acctName:a?a.name:'',subject:'Re: '+(c.steps[0].subject||''),to:'',from:c.steps[0].recipient||TEST10_DEMO_INBOX,snippet:emailSnippet(replySnippet||note||''),ctaId:c.id,stage:'Reply received'});
  emailDrafts=emailDrafts.slice(0,40); saveEmailDrafts();
  if(c.originatingTriggerType){
    const t=[...triggerEvents].reverse().find(x=>x.accountId===c.accountId && x.triggerType===c.originatingTriggerType && isTriggerLive(x));
    if(t){ t.status='resolved'; t.resolution={outcome:'resolved',note:note||'Auto-completed from customer reply',at:now}; saveTriggerEvents(); if(HEALTH_REVEALING_TRIGGERS.has(t.triggerType)) revealTest10Health(c.accountId); }
  }
  toast('Reply read — CTA auto-completed.');
  route();
}

// ---------- roll-ups ----------
function accountsUnder(nodeId){
  const node = STATE.nodeIndex[nodeId]; if(!node) return [];
  const out=[], seen=new Set();
  (function walk(n){ if(!n||seen.has(n.id)) return; seen.add(n.id);   // guard against manager-chain cycles
    (n.accounts||[]).forEach(a=>out.push(a)); Object.values(n.children||{}).forEach(walk); })(node);
  return out;
}
function rollup(accts){
  const r={arr:0,risk:0,cases:0,high:0,n:accts.length,renewals:0,red:0,amber:0,green:0,wsum:0,healthArr:0,healthSum:0,healthN:0,ltv:0,
    growth:{Renewal:0,Expansion:0,Transactional:0}, inCadence:0, blocked:0, aging:0};
  accts.forEach(a=>{ r.arr+=a.renewalAmount; r.risk+=(a.riskARR||0); r.cases+=a.openCases; r.high+=a.highCases; r.renewals+=a.opps.length; r.ltv+=a.ltv||0;
    // Blanked Test10 accounts (health===null, not yet revealed) simply don't
    // contribute to the health average yet - same pattern npsRollup already
    // uses for a.nps - rather than corrupting the whole rollup with NaN.
    if(a.health!=null){ r.wsum+=a.health*a.renewalAmount; r.healthArr+=a.renewalAmount; r.healthSum+=a.health; r.healthN++; }
    if(a.tier==='atrisk')r.red++; else if(a.tier==='watch')r.amber++; else if(a.tier==='healthy')r.green++;
    const g=a.growth||{}; r.growth.Renewal+=g.Renewal||0; r.growth.Expansion+=g.Expansion||0; r.growth.Transactional+=g.Transactional||0;
    if(cadenceInfo(a).tier==='green') r.inCadence++;
    r.blocked+=a.casesBlocked||0; r.aging+=a.casesAging||0; });
  r.health = r.healthArr>0 ? Math.round(r.wsum/r.healthArr) : (r.healthN ? Math.round(r.healthSum/r.healthN) : null);
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
const TAB_LABELS={home:'Home',overview:'Command Center',hierarchy:'Org Drill-down',riskboard:'Accounts & Risk',scorecard:'CSM',usage:'Usage & Adoption',engagement:'Client Engagement',escalations:'Escalations',activectas:'Active CTAs',plans:'Success Plans',emails:'Email Outreach',worklist:'My Worklist',model:'Configure Org Data',resources:'Resource Library',execreport:'Executive Report',
  gong:'Customer Contact Insights',predictive:'Predictive Insights',csemails:'Customer Success Emails',acctoutcomes:'Account Outcomes',
  npsmanaged:'Managed Account NPS & CSAT',npsagency:'Agency NPS & CSAT',csat:'NPS & CSAT Management',insights:'Customer Insights',
  acctscorecard:'Account',prodscorecard:'Product',integrations:'Integrations & Data Sources'};

// ---------- nav: icon rail + category flyout ----------
// Categories group the 28 tabs into 8 icons. A category with a single tab
// navigates straight there on click; a category with multiple tabs opens a
// pinned flyout of its sub-items to the right of the rail (stays open across
// selections, like VS Code's activity bar + sidebar) instead of collapsing
// after each pick.
const NAV_CATEGORIES=[
  {id:'home',label:'Home',icon:'<path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5H10v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>',tabs:['home']},
  {id:'cockpit',label:'My Book',icon:'<path d="M12 6C10 4.3 6.8 3.8 3.5 4.3v13.8c3.3-.5 6.5 0 8.5 1.7 2-1.7 5.2-2.2 8.5-1.7V4.3C17.2 3.8 14 4.3 12 6Z"/><path d="M12 6v13.8"/>',tabs:['overview','worklist']},
  {id:'performance',label:'Performance',icon:'<path d="M4 20h16M7 20V10m5 10V4m5 16v-7"/>',tabs:['acctscorecard','scorecard','prodscorecard','execreport','model']},
  {id:'pulse',label:'Customer Pulse',icon:'<path d="M3 12h4l2-7 4 14 2-7h6"/>',tabs:['npsagency','npsmanaged','csat','insights','usage']},
  {id:'risk',label:'Accounts & Risk',icon:'<path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3Z"/><path d="M12 8v5M12 16h.01"/>',tabs:['riskboard']},
  {id:'engagement',label:'Engagement',icon:'<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',tabs:['engagement','escalations','activectas','emails','gong']},
  {id:'journey',label:'Customer Success Journey',icon:'<path d="M6 3v18"/><path d="M6 5h12l-3 4 3 4H6"/>',tabs:['predictive','plans','csemails','acctoutcomes']},
  {id:'resources',label:'Resources',icon:'<path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2Z"/><path d="M20 5a2 2 0 0 0-2-2h-6v18h6a2 2 0 0 0 2-2Z"/>',tabs:['resources','integrations']},
];
function categoryForTab(tab){ return NAV_CATEGORIES.find(c=>c.tabs.includes(tab)) || NAV_CATEGORIES[0]; }
let navOpenCat = categoryForTab(STATE.tab).id;
function renderNav(){
  const rail=$('#iconRail'), fly=$('#flyout'); if(!rail) return;
  const activeCat=navOpenCat||categoryForTab(STATE.tab).id;
  // unackStageChange already tracks exactly the "unconfirmed stage shift"
  // set the kanban's own flash badges use - one shared count, not a second
  // parallel notion of "unconfirmed."
  const unconfirmed=Object.keys(unackStageChange).length;
  rail.innerHTML=NAV_CATEGORIES.map(c=>`<button class="rail-btn${activeCat===c.id?' active':''}" data-cat="${c.id}" title="${esc(c.label)}"><svg class="ic" viewBox="0 0 24 24">${c.icon}</svg>${c.id==='risk'&&unconfirmed?`<span class="rail-badge">${unconfirmed>99?'99+':unconfirmed}</span>`:''}</button>`).join('');
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
  <ul style="margin:8px 0 0;padding-left:18px;line-height:1.8">${bullets.map(b=>`<li>${esc(b)}</li>`).join('')}</ul>
  </div>`;
}
// Every email that's gone out (emailDrafts - Email Outreach, CTA sends, the
// sales-loop step, escalation steps) plus every reply a CSM has logged back
// (escState's 'receive'-type steps), normalized into one chronological
// contact log. Deliberately snippet-only for the body (see emailSnippet) -
// this matrix is a scannable "who was contacted, when, about what" record,
// not a place to read full email text; that's more important later once
// this becomes the extraction point for pulling structured info out of
// actual email content, not just logging that contact happened.
// Resolves a stored ctaId to a live open/closed label - status is read fresh
// every time this runs (not frozen at send time), so a CTA that later closes
// out (e.g. auto-completed from a read reply) shows as Closed retroactively
// on every past entry tied to it, not just going forward.
function ctaStatusLabel(ctaId){
  if(!ctaId) return '';
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return '';
  return engagementCtaEffectiveStatus(c)==='done'?'Closed':'Open';
}
function contactLogEntries(accts){
  const idSet=new Set(accts.map(a=>a.id));
  const byId={}; accts.forEach(a=>byId[a.id]=a);
  const rows=[];
  emailDrafts.forEach(h=>{
    if(h.acctId && !idSet.has(h.acctId)) return;
    rows.push({t:h.t,acctId:h.acctId,acctName:h.acctName,direction:h.direction||'sent',audience:h.audience,subject:h.subject,snippet:h.snippet||'',contact:h.direction==='received'?h.from||'':h.to||'',stage:h.stage||h.templateName||'',status:ctaStatusLabel(h.ctaId)});
  });
  Object.keys(escState).forEach(acctId=>{
    if(!idSet.has(acctId)) return;
    const st=escState[acctId]; if(!st||!st.steps) return;
    const escCta=engagementCtas.find(c=>c.accountId===acctId && c.category==='escalation');
    st.steps.forEach((s,idx)=>{
      if(ESC_STEP_ACTIONS[idx]==='receive' && s.done && s.detail && s.detail.body){
        rows.push({t:s.detail.at||s.doneAt,acctId,acctName:(byId[acctId]||{}).name||'',direction:'received',audience:'customer',subject:s.label,snippet:emailSnippet(s.detail.body),contact:s.detail.from||'',stage:s.label,status:escCta?ctaStatusLabel(escCta.id):''});
      }
    });
  });
  return rows.sort((a,b)=>new Date(b.t)-new Date(a.t));
}
function viewGong(accts){
  const rows=contactLogEntries(accts);
  const last30=rows.filter(r=>r.t && (Date.now()-new Date(r.t).getTime())<=30*864e5).length;
  const acctsCovered=new Set(rows.map(r=>r.acctId).filter(Boolean)).size;
  const sentCount=rows.filter(r=>r.direction==='sent').length;
  const receivedCount=rows.filter(r=>r.direction==='received').length;
  return `<div class="card"><h3>Customer Contact Insights</h3>
    <div class="kpis" style="margin:14px 0">
      <div class="kpi clickable" onclick="scrollToSection('contactMatrixCard')"><div class="l">Total entries</div><div class="v">${rows.length}</div><div class="d">emails sent + received</div></div>
      <div class="kpi clickable" onclick="scrollToSection('contactMatrixCard')"><div class="l">Logged last 30 days</div><div class="v">${last30}</div><div class="d">recent activity</div></div>
      <div class="kpi clickable" onclick="scrollToSection('contactMatrixCard')"><div class="l">Accounts covered</div><div class="v">${acctsCovered}</div><div class="d">of ${accts.length} in scope</div></div>
      <div class="kpi clickable" onclick="scrollToSection('contactMatrixCard')"><div class="l">Sent</div><div class="v">${sentCount}</div><div class="d">outbound</div></div>
      <div class="kpi risk-green clickable" onclick="scrollToSection('contactMatrixCard')"><div class="l">Received</div><div class="v">${receivedCount}</div><div class="d">inbound / logged replies</div></div>
    </div>
  </div>
  <div class="card" id="contactMatrixCard"><h3>Contact matrix</h3>
    ${rows.length?`<div style="overflow-x:auto"><table class="matrix-table"><thead><tr><th>Timestamp</th><th>Account</th><th>Direction</th><th>Audience</th><th>Subject</th><th>Snippet</th><th>Contact</th><th>Stage</th><th>Status</th></tr></thead><tbody>
    ${rows.slice(0,200).map(r=>`<tr ${r.acctId?`onclick="openAcct('${r.acctId}')" style="cursor:pointer"`:''}><td class="mini">${r.t?esc(new Date(r.t).toLocaleString()):'—'}</td><td><b>${esc(r.acctName||'—')}</b></td><td><span class="pill ${r.direction==='sent'?'p-blue':'p-green'}">${r.direction==='sent'?'Sent':'Received'}</span></td><td><span class="pill ${r.audience==='customer'?'p-blue':'p-amber'}">${esc(r.audience||'—')}</span></td><td class="mini">${esc(r.subject||'—')}</td><td class="mini" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.snippet||'')}">${esc(r.snippet||'—')}</td><td class="mini">${esc(r.contact||'—')}</td><td class="mini">${esc(r.stage||'—')}</td><td>${r.status?`<span class="pill ${r.status==='Open'?'p-amber':'p-green'}">${esc(r.status)}</span>`:'<span class="mini">—</span>'}</td></tr>`).join('')}
    </tbody></table></div>`:'<p class="mini">No emails sent or received yet.</p>'}
  </div>`;
}
// Account Outcomes: measures whether a completed Success Plan actually
// worked - the same branching funnel visual as the CSAT send/receive funnel
// (funnelForkHtml), just forked on NPS instead of survey receipt. Clicking a
// branch does three things at once: filters the account list below to that
// group, votes on last quarter's plan (up/down), and drafts next quarter's
// predictive insight for every account in the group - for a disapproved
// account that draft leads with a diagnosis of the likely cause (reusing the
// same real fields the risk engine already tracks) instead of just repeating
// the same cadence blind.
let acctOutcomeFilter=null; // null | 'approved' | 'disapproved'
function outcomeFunnelHtml(allV,allSub,pendV,pendSub,doneV,doneSub,apprV,apprSub,disV,disSub){
  return `<div class="funnel">
    <div class="funnel-box"><div class="l">All accounts</div><div class="v">${allV}</div><div class="d">${esc(allSub)}</div></div>
    <div class="funnel-conn"><span class="funnel-flow"></span></div>
    <div class="funnel-box clickable" onclick="scrollToSection('outcomePending')"><div class="l">Pending completed</div><div class="v">${pendV}</div><div class="d">${esc(pendSub)}</div></div>
    <div class="funnel-conn"><span class="funnel-flow"></span></div>
    <div class="funnel-box risk-amber"><div class="l">Plans completed</div><div class="v">${doneV}</div><div class="d">${esc(doneSub)}</div></div>
    <div class="funnel-fork">
      <svg viewBox="0 0 60 80" preserveAspectRatio="none">
        <defs><marker id="outcomeForkArrow" markerWidth="3" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L3,2 L0,4 Z" class="fork-arrowhead"/></marker></defs>
        <path class="fork-path" d="M0,40 Q30,40 54,14" marker-end="url(#outcomeForkArrow)"/>
        <path class="fork-path" d="M0,40 Q30,40 54,66" marker-end="url(#outcomeForkArrow)"/>
        <circle class="fork-dot" r="3.2"><animateMotion dur="1.8s" repeatCount="indefinite" path="M0,40 Q30,40 54,14"/></circle>
        <circle class="fork-dot" r="3.2"><animateMotion dur="1.8s" begin="0.9s" repeatCount="indefinite" path="M0,40 Q30,40 54,66"/></circle>
      </svg>
    </div>
    <div class="funnel-fork-boxes">
      <div class="funnel-box small risk-green clickable" onclick="clickOutcomeBranch('approved')"><div class="l">NPS approved</div><div class="v">${apprV}</div><div class="d">${esc(apprSub)}</div></div>
      <div class="funnel-box small risk-red clickable" onclick="clickOutcomeBranch('disapproved')"><div class="l">NPS disapproved</div><div class="v">${disV}</div><div class="d">${esc(disSub)}</div></div>
    </div>
  </div>`;
}
function clickOutcomeBranch(verdict){
  const qKey=quarterKeyOf(globalQSel||defaultQSel());
  const nextQ=shiftQuarter(qKey,1);
  const list=STATE.accounts.filter(a=>{
    const p=plans[a.id]; if(!p||planProgress(p)!==100||a.nps==null) return false;
    return verdict==='approved' ? a.nps>=9 : a.nps<9;
  });
  let acted=0;
  list.forEach(a=>{
    const p=plans[a.id];
    if(p.lastOutcome && p.lastOutcome.quarter===qKey) return; // already voted this cycle - clicking again just re-filters
    p.lastOutcome={quarter:qKey,verdict,nps:a.nps,at:new Date().toISOString()};
    generatePredictiveInsight(a.id,nextQ);
    const ins=predictiveInsightFor(a.id,nextQ);
    if(ins){
      if(verdict==='disapproved'){
        const cause=[];
        if(a.hasExecSponsor===false) cause.push('no executive sponsor on file');
        if(a.qbrDaysOverdue) cause.push('an overdue QBR');
        if(a.sentTier==='neg') cause.push('strained support sentiment');
        if(a.casesAging) cause.push(`${a.casesAging} aging case(s)`);
        ins.analysis=`Last quarter's plan (${qKey}) was marked not approved — NPS came back ${a.nps}/10. ${cause.length?`Likely driver(s): ${cause.join(', ')}.`:'No specific driver stood out from current account data — a direct conversation is needed to find out why.'} ${ins.analysis}`;
        ins.timeline.unshift({when:'Now',action:"Address last quarter's shortfall",detail:cause.length?`Focus next quarter's plan on: ${cause.join(', ')}.`:"Have a direct conversation to identify what drove the low NPS before repeating last quarter's cadence.",emailTemplate:null});
      } else {
        ins.analysis=`Last quarter's plan (${qKey}) was approved — NPS came back ${a.nps}/10. Repeating a similar cadence next quarter. ${ins.analysis}`;
      }
    }
    acted++;
  });
  savePlans();
  if(acted) savePredictiveInsights();
  acctOutcomeFilter=verdict;
  route();
  scrollToSection(verdict==='approved'?'outcomeApproved':'outcomeDisapproved');
  toast(acted?`${verdict==='approved'?'Upvoted':'Downvoted'} ${acted} account plan${acted===1?'':'s'} — next quarter's insight drafted for each.`:'Already voted for this cycle — showing the group.');
}
function clearOutcomeFilter(){ acctOutcomeFilter=null; route(); }
function viewNextQuarterInsight(acctId){
  const nextQ=shiftQuarter(currentQuarter(),1);
  const [y,q]=nextQ.split('-Q');
  globalQSel={year:+y,q:+q};
  openPredictiveInsight(acctId);
}
function acctOutcomeRowsHtml(list,verdict,qKey){
  if(!list.length) return '<p class="mini">No accounts in this group.</p>';
  return `<table><thead><tr><th>Account</th><th>Owner</th><th class="num">NPS</th><th>Last outcome vote</th><th></th></tr></thead><tbody>
  ${list.map(a=>{
    const p=plans[a.id]; const voted=p.lastOutcome && p.lastOutcome.quarter===qKey;
    return `<tr><td onclick="openAcct('${a.id}')" style="cursor:pointer"><b>${esc(a.name)}</b></td><td>${ownerCell(a.ownerName)}</td><td class="num"><span class="pill ${npsTierPill(a.nps)}">${a.nps}/10</span></td><td>${voted?`<span class="pill ${verdict==='approved'?'p-green':'p-red'}">${verdict==='approved'?'Upvoted':'Downvoted'} ${esc(qKey)}</span>`:'<span class="pill p-gray">Not yet voted</span>'}</td><td><button class="btn sm" onclick="viewNextQuarterInsight('${a.id}')">View next quarter</button></td></tr>`;
  }).join('')}
  </tbody></table>`;
}
function acctOutcomePendingRowsHtml(list){
  if(!list.length) return '<p class="mini">No plans currently in progress.</p>';
  return `<table><thead><tr><th>Account</th><th>Owner</th><th>Progress</th><th></th></tr></thead><tbody>
  ${list.map(a=>{ const p=plans[a.id]; const prog=planProgress(p); return `<tr><td onclick="openAcct('${a.id}')" style="cursor:pointer"><b>${esc(a.name)}</b></td><td>${ownerCell(a.ownerName)}</td><td><div class="progress" style="width:100px"><i style="width:${prog}%"></i></div><span class="mini">${prog}%</span></td><td><button class="btn sm" onclick="openPlan('${a.id}')">Open plan</button></td></tr>`; }).join('')}
  </tbody></table>`;
}
function viewAcctOutcomes(accts){
  const sel=globalQSel||defaultQSel();
  const qKey=quarterKeyOf(sel);
  const pending=accts.filter(a=>{ const p=plans[a.id]; return p&&planProgress(p)<100; });
  const completed=accts.filter(a=>{ const p=plans[a.id]; return p&&planProgress(p)===100; });
  const approved=completed.filter(a=>a.nps!=null&&a.nps>=9);
  const disapproved=completed.filter(a=>a.nps!=null&&a.nps<9);
  let html=`<div class="card"><h3>Account Outcomes</h3>
    <p class="mini" style="margin-bottom:12px">Every account whose Success Plan is fully complete gets checked against its NPS score. Click a branch to vote on last quarter's plan and draft next quarter's — an approved branch repeats a similar cadence, a disapproved branch leads with the likely cause.</p>
    ${quarterToggleHtml(sel,'setGlobalQYear','setGlobalQQ')}
    ${outcomeFunnelHtml(accts.length,'in scope',pending.length,'plan in progress',completed.length,qKey+' cycle',approved.length,'NPS 9-10',disapproved.length,'NPS below 9')}
  </div>`;
  if(acctOutcomeFilter) html+=`<p class="mini" style="margin:0 4px 10px">Showing <b>${acctOutcomeFilter==='approved'?'NPS approved':'NPS disapproved'}</b> · <a href="#" onclick="clearOutcomeFilter();return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear</a></p>`;
  html+=`<div class="card" id="outcomePending"><h3>Pending completed <span class="hint">${pending.length} account${pending.length===1?'':'s'} with a plan in progress</span></h3>${acctOutcomePendingRowsHtml(pending)}</div>`;
  html+=`<div class="card" id="outcomeApproved"><h3>NPS approved <span class="hint">${approved.length} account${approved.length===1?'':'s'}</span></h3>${acctOutcomeRowsHtml(approved,'approved',qKey)}</div>`;
  html+=`<div class="card" id="outcomeDisapproved"><h3>NPS disapproved <span class="hint">${disapproved.length} account${disapproved.length===1?'':'s'}</span></h3>${acctOutcomeRowsHtml(disapproved,'disapproved',qKey)}</div>`;
  return html;
}
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
function isTest10Account(acctId){ const a=STATE.accounts.find(x=>x.id===acctId); return !!a && TEST10_ACCOUNTS.includes(a.name); }
// Test10 accounts are a live demo sandbox with a real Gmail send behind
// "Send" - every draft for one of these 10 accounts is redirected to the one
// real inbox available for the demo, regardless of what the template would
// otherwise have filled in for a customer contact.
const TEST10_DEMO_INBOX='axongainsightrp@gmail.com';
// Fires the actual send through /api/automation/send (backend/gmail_client.py) -
// fire-and-forget from the UI's perspective, since the step/CTA is already
// marked sent locally regardless; a failure here just means the real demo
// email didn't land, not that local state reverts.
function sendTest10DemoEmail(acctId,subject,body){
  if(!isTest10Account(acctId)) return;
  fetch('/api/automation/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:TEST10_DEMO_INBOX,subject:subject||'(no subject)',bodyHtml:(body||'').replace(/\n/g,'<br>')})})
    .then(r=>r.json()).then(d=>{ if(!d.sent) toast('Demo email failed to send — check Gmail auth.'); })
    .catch(()=>toast('Demo email failed to send — check Gmail auth.'));
}
// ---------- AI draft (human-in-the-loop, no LLM API key required) ----------
// "Create AI draft" writes a small hand-off file on the backend
// (backend/data/ai_drafts/<requestId>.json) with just the context needed -
// account name, category, a one-line reason - nothing else. A Claude Code
// session (asked directly, e.g. "process pending AI drafts") reads that one
// file and writes {status:'ready', draft:{subject,body}} back into it; this
// polls until it sees that. Deliberately limited to the 10 NPS/CSAT pilot
// accounts (enforced server-side too) while this stays a manual demo feature
// rather than a live API integration.
// Every AI draft click first prompts for optional extra context (a CSM might
// know something the auto-gathered context doesn't - a specific complaint, a
// prior conversation) before the request actually goes out. btnId/statusId
// are explicit (not derived from requestId) so this works for one-off
// surfaces like the Email Outreach composer, which only ever has one instance
// on screen at a time, not just the per-record CTA/escalation cards.
let pendingAiDraftRequest=null;
function requestAiDraft(requestId,accountName,category,contextText,ids,btnId,statusId){
  pendingAiDraftRequest={requestId,accountName,category,contextText,ids,btnId,statusId};
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2>Create AI draft</h2><div class="mini">${esc(accountName)}</div></div><button class="x" onclick="cancelAiDraftRequest()">✕</button></div>
  <div class="bd">
    <label class="mini" style="display:block;margin-bottom:6px">Anything else the draft should know? (optional)</label>
    <textarea id="aiDraftExtraContext" class="select" rows="5" style="font:inherit"></textarea>
    <div class="row-actions" style="margin-top:14px"><button type="button" class="btn primary" onclick="confirmAiDraftRequest()">Create draft</button><button type="button" class="btn" onclick="cancelAiDraftRequest()">Cancel</button></div>
  </div>`;
  showOverlay();
  setTimeout(()=>{ const el=$('#aiDraftExtraContext'); if(el) el.focus(); },50);
}
function cancelAiDraftRequest(){ pendingAiDraftRequest=null; closeSheet(); }
async function confirmAiDraftRequest(){
  if(!pendingAiDraftRequest) return;
  const {requestId,accountName,category,contextText,ids,btnId,statusId}=pendingAiDraftRequest;
  const extraEl=$('#aiDraftExtraContext');
  const extra=(extraEl&&extraEl.value||'').trim();
  pendingAiDraftRequest=null;
  closeSheet();
  const fullContext=extra?`${contextText}\n\nAdditional context from CSM: ${extra}`:contextText;
  const btn=document.getElementById(btnId);
  const statusEl=document.getElementById(statusId);
  if(btn){ btn.disabled=true; btn.textContent='Requesting…'; }
  try{
    const res=await fetch('/api/ai-draft/'+requestId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountName,category,context:fullContext})});
    if(!res.ok){ const d=await res.json().catch(()=>({})); toast(d.detail||'Could not request an AI draft.'); if(btn){ btn.disabled=false; btn.textContent='Create AI draft'; } return; }
  }catch(e){ toast('Could not reach the backend.'); if(btn){ btn.disabled=false; btn.textContent='Create AI draft'; } return; }
  if(statusEl) statusEl.textContent='Waiting on an AI draft — ask Claude Code to "process pending AI drafts" to fill this in.';
  pollAiDraft(requestId,ids,btnId,statusId,0);
}
function pollAiDraft(requestId,ids,btnId,statusId,attempt){
  if(attempt>120) return; // ~10 minutes at 5s intervals, then give up quietly
  fetch('/api/ai-draft/'+requestId).then(r=>r.json()).then(d=>{
    const statusEl=document.getElementById(statusId);
    if(d.status==='ready' && d.draft){
      const subjEl=document.getElementById(ids.subject), bodyEl=document.getElementById(ids.body);
      if(subjEl) subjEl.value=d.draft.subject||'';
      if(bodyEl) bodyEl.value=d.draft.body||'';
      if(ids.to && d.draft.to){ const toEl=document.getElementById(ids.to); if(toEl && !toEl.value) toEl.value=d.draft.to; }
      if(statusEl) statusEl.textContent='AI draft ready — review before sending.';
      const btn=document.getElementById(btnId); if(btn){ btn.disabled=false; btn.textContent='Create AI draft'; }
    }else{
      setTimeout(()=>pollAiDraft(requestId,ids,btnId,statusId,attempt+1),5000);
    }
  }).catch(()=>{ setTimeout(()=>pollAiDraft(requestId,ids,btnId,statusId,attempt+1),5000); });
}
function requestAiDraftForCta(ctaId){
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const a=STATE.accounts.find(x=>x.id===c.accountId); if(!a||!TEST10_ACCOUNTS.includes(a.name)) return;
  requestAiDraft('cta_'+ctaId,a.name,c.category,'Originating trigger: '+(RISK_TRIGGER_LABELS[c.originatingTriggerType]||'manual'),
    {subject:'ceDraftSubject_'+ctaId,body:'ceDraftBody_'+ctaId,to:'ceDraftTo_'+ctaId},'aiDraftBtn_cta_'+ctaId,'aiDraftStatus_cta_'+ctaId);
}
function requestAiDraftForEscStep(acctId,stepIdx){
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a||!TEST10_ACCOUNTS.includes(a.name)) return;
  const st=peekEscState(acctId); const step=st.steps[stepIdx];
  requestAiDraft('esc_'+acctId+'_'+stepIdx,a.name,'escalation','Escalation step: '+(step?step.label:''),
    {subject:'ceStepSubject_'+stepIdx,body:'ceStepBody_'+stepIdx,to:'ceStepTo_'+stepIdx},'aiDraftBtn_esc_'+acctId+'_'+stepIdx,'aiDraftStatus_esc_'+acctId+'_'+stepIdx);
}
// Email Outreach's composer is a single global slot (emailCompose) - reuses
// one stable request id per draft (generated once in buildEmailDraft) rather
// than a per-account id, since the same composer instance can be repointed at
// a different account/template without a page navigation.
function requestAiDraftForEmailCompose(){
  const d=emailCompose; if(!d) return;
  const a=d.acctId?STATE.accounts.find(x=>x.id===d.acctId):null;
  if(!a||!TEST10_ACCOUNTS.includes(a.name)){ toast('AI drafts are limited to the 10 pilot accounts for now.'); return; }
  const tpl=EMAIL_TEMPLATES.find(t=>t.id===d.templateId);
  requestAiDraft(d.aiRequestId,a.name,d.audience,'Email Outreach template: '+(tpl?tpl.name:d.templateId),
    {subject:'emailSubject',body:'emailBody',to:'emailTo'},'aiDraftBtn_emailCompose','aiDraftStatus_emailCompose');
}
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
    syncTest10SurveyIntoAccounts();
    // A freshly-synced NPS score should be able to fire nps_csat_drop the
    // moment it lands, same as any other real change would - without this,
    // a submitted survey response only revealed the number but the risk
    // stage itself wouldn't actually shift until the next full reload (the
    // only other place evaluateRiskTriggers() runs is inside computeAll()).
    // Deliberately NOT a full computeAll() here - that would also re-run
    // resetTest10RiskBaseline() and wipe every other CTA/escalation/plan
    // already built up this session for the Test10 accounts.
    evaluateRiskTriggers();
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
// Whether the quarterly outreach has actually "gone out" to all 10 Test 10
// pilot accounts yet this cycle - drives the Sent count on the live-pilot
// funnel (0 until sent, 10 once it has). Demo Email Day Notification resets
// this to null (Sent -> 0, simulating a fresh scheduled-send day); a
// successful "Automation Settings" send sets it (Sent -> 10), representing
// all 10 accounts being emailed simultaneously even though, in this demo,
// only one real email actually goes out (to axongainsightrp@gmail.com).
let test10SentAt=LS.get('test10SentAt',null);
function saveTest10SentAt(){ LS.set('test10SentAt',test10SentAt); }
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
// Template shown in the preview with literal {Agency Name}/{CSM} placeholders
// (not resolved to one example) - the actual send fills these in per-account
// and fires one real, separately-addressed email per account (see
// test10AutomationTargets/fillAutomationTemplate below), all landing in the
// same axongainsightrp@gmail.com inbox in this demo.
function automationEmailTemplate(which){
  if(which==='settings') return {
    subject:'Axon Customer Survey — quick check-in',
    bodyHtml:`<p>Dear {Agency Name},</p><p>I'm {CSM}, from Axon, and just wanted to check in on your experience with Axon products so far. It would be very helpful for us to better serve you with our Axon products and services if you fill out this survey: <a href="${AUTOMATION_SURVEY_LINK}">AXON Customer Survey</a></p><p>Thank you,<br>{CSM}<br>Axon Customer Success</p>`
  };
  return {
    subject:'Following up — Axon Customer Survey',
    bodyHtml:`<p>Dear {Agency Name},</p><p>I'm {CSM}, from Axon. I wanted to follow up as we haven't yet heard back on the survey we sent over — your feedback genuinely helps us serve you better. If you have a couple of minutes, we'd appreciate you completing it here: <a href="${AUTOMATION_SURVEY_LINK}">AXON Customer Survey</a></p><p>Thank you,<br>{CSM}<br>Axon Customer Success</p>`
  };
}
function fillAutomationTemplate(tpl,acctName,csmName){
  const fill=s=>s.split('{Agency Name}').join(esc(acctName)).split('{CSM}').join(esc(csmName));
  return {subject:tpl.subject+' — '+acctName, bodyHtml:fill(tpl.bodyHtml)};
}
// The 10 Test 10 accounts paired with their real assigned CSM. "settings"
// targets all 10 (a fresh quarterly send); "escalation" targets only accounts
// that haven't responded yet, since that's who a real escalation would chase.
function test10AutomationTargets(which){
  const pairs=TEST10_ACCOUNTS.map(name=>{ const a=STATE.accounts.find(x=>x.name===name); return {name,csm:(a&&a.ownerName)||'the Axon team'}; });
  if(which==='escalation'){
    const notReceived=new Set(getTest10StatusList().filter(s=>!s.received).map(s=>s.account));
    return pairs.filter(p=>notReceived.has(p.name));
  }
  return pairs;
}
// Circular "send" button: a ring traces clockwise starting at 6 o'clock: once
// it laps back to 6, the button snaps to solid green with a checkmark that
// fades out a moment later, leaving the green (the persisted "sent" state).
function sendRingHtml(which){
  return `<div class="send-fab-wrap">
    <button type="button" class="send-fab" id="sendFab-${which}" onclick="confirmSendAutomation('${which}')">
      <svg class="send-fab-svg" viewBox="0 0 48 48">
        <circle class="send-fab-bg" cx="24" cy="24" r="23"/>
        <circle class="send-ring-fg" id="sendRing-${which}" cx="24" cy="24" r="23"/>
        <path class="send-icon-check" d="M16 24 L21.5 30 L33 17" fill="none" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <span class="mini">Preview shown above — click to send this exact email now (demo)</span>
  </div>`;
}
function openAutomationPreview(which){
  const tpl=automationEmailTemplate(which);
  const targets=test10AutomationTargets(which);
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2>${which==='settings'?'Automation Settings':'Escalation Automation'} — Email Preview</h2>
    <div class="mini">${targets.length} personalized email${targets.length===1?'':'s'} — one per account, {Agency Name} and {CSM} filled in per-account (${esc(targets.map(t=>t.name).join(', ')||'none')}) — in this demo every one actually delivers to <b>axongainsightrp@gmail.com</b> so you can see all ${targets.length} versions land.</div></div>
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
  const targets=test10AutomationTargets(which);
  if(!targets.length){ alert('Nothing to send — every Test 10 account has already responded.'); return; }
  fab.classList.add('sending');
  requestAnimationFrame(()=>{ if(ring) ring.classList.add('animating'); });
  const tpl=automationEmailTemplate(which);
  const RING_MS=1600;
  const sendAllPromise=(async()=>{
    let sentCount=0;
    for(const t of targets){
      const filled=fillAutomationTemplate(tpl,t.name,t.csm);
      try{
        const res=await fetch('/api/automation/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({to:'axongainsightrp@gmail.com',subject:filled.subject,bodyHtml:filled.bodyHtml})});
        if(res.status===401) return {unauth:true};
        const d=await res.json();
        if(d.sent) sentCount++;
      }catch(e){ /* keep going - report the partial count below */ }
    }
    return {sent:sentCount>0,sentCount,total:targets.length};
  })();
  const [data]=await Promise.all([sendAllPromise,new Promise(r=>setTimeout(r,RING_MS))]);
  if(data.unauth){ goToLogin(); return; }
  fab.classList.remove('sending');
  if(data.sent){
    fab.classList.add('sent');
    cfg.sentAt=new Date().toISOString();
    if(which==='settings'){ test10SentAt=cfg.sentAt; saveTest10SentAt(); }
    const notif=$('#emailDayNotif'); if(notif) notif.remove();
    setTimeout(()=>{ closeSheet(); route(); },1400);
    if(data.sentCount<data.total) alert(`Sent ${data.sentCount} of ${data.total} emails — the rest failed partway through.`);
  }else{
    fab.classList.remove('sending'); if(ring) ring.classList.remove('animating');
    alert('Send failed: none of the '+data.total+' emails went out.');
  }
  if(which==='settings') saveAutomationConfig(); else saveEscalationConfig();
}
// Simulates the day a scheduled automation would actually fire: a pulsating
// red banner top-right (like a real notification), clicking it opens the
// same email-preview review window used by "Preview & send".
function showEmailDayNotification(){
  const old=$('#emailDayNotif'); if(old) old.remove();
  automationConfig.sentAt=null; saveAutomationConfig();
  escalationConfig.sentAt=null; saveEscalationConfig();
  test10SentAt=null; saveTest10SentAt();
  route();
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
  // .find() would only ever return an account's FIRST-ever response - if the
  // same account responds again later (a re-send, a correction), that newer
  // row was silently ignored. Sheets appends new submissions at the bottom, so
  // the last matching row is always the most recent one; take that instead.
  return TEST10_ACCOUNTS
    .map(name=>{ const matches=real.filter(r=>r.account && r.account.trim().toLowerCase()===name.toLowerCase()); return matches.length?matches[matches.length-1]:null; })
    .filter(Boolean)
    .map(r=>({...r,source:'sheet'}));
}
// All 10 accounts with a received/not-received flag — used only for the
// per-account status table, where showing "not received yet" for every
// account is honest bookkeeping, not fabricated response data.
// Every raw Sheet row matched to a Test 10 account, NOT deduped down to one
// per account - "Received" on the funnel counts total survey submissions, so
// an account that responds twice counts twice, and if a row is deleted from
// the Sheet, the next Refresh immediately reflects the lower count (this is a
// live read every time - see sheets_client.py - nothing is cached server-side).
function getTest10RawResponses(){
  const real=sheetDataCache||[];
  const names=new Set(TEST10_ACCOUNTS.map(n=>n.toLowerCase()));
  return real.filter(r=>r.account && names.has(r.account.trim().toLowerCase()));
}
// The Test10 pilot survey (Google Sheets, refreshed above) previously only
// fed the dedicated NPS/CSAT Management page's own Test10 view - it never
// touched the account's real nps/csat fields, so nothing outside that one
// page ever reflected a submitted response. This is what makes "submit a
// survey" actually act like a real data refresh everywhere else too
// (Command Center, Worklist, CSM, Account list).
function syncTest10SurveyIntoAccounts(){
  let csatChanged=false;
  getTest10RawResponses().forEach(r=>{
    const a=STATE.accounts.find(x=>x.name.trim().toLowerCase()===r.account.trim().toLowerCase());
    if(!a) return;
    if(r.score!=null) a.nps=r.score;
    // Written into the same manual-override map setCsat() uses (not a.csat
    // directly) - csatVal(a) checks this map first, so a synced response
    // takes effect wherever CSAT is actually displayed, not just a stale cache.
    if(r.csatScore!=null){ csat[a.id]=r.csatScore; csatChanged=true; }
    if(r.score!=null||r.csatScore!=null) revealTest10NpsCsat(a.id);
  });
  if(csatChanged) LS.set('csat',csat);
}
function getTest10StatusList(){
  const responses=getTest10Data();
  return TEST10_ACCOUNTS.map(name=>{
    const r=responses.find(x=>x.account.trim().toLowerCase()===name.toLowerCase());
    return r ? {...r,received:true} : {account:name,received:false,score:null,reason:'',comment:'',timestamp:null,description:'',relationshipIntent:'',contactName:'',contactTitle:'',csatScore:null,csatComments:''};
  });
}
// 3-tier scoring: only a 10 is a promoter, 9 is neutral/passive, anything
// below 9 is a detractor. Applies to both NPS score and CSAT score alike.
function npsTierPill(score){ return score===10?'p-green':score===9?'p-amber':'p-red'; }
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
  return {rows,promoters:rows.filter(r=>r.score===10),neutrals:rows.filter(r=>r.score===9),detractors:rows.filter(r=>r.score<9)};
}
function drawNpsCharts(kind,accts){
  let d;
  const npsSel=globalQSel||defaultQSel();
  const npsQKey=quarterKeyOf(npsSel);
  if(kind==='managed' && riskTest10){
    const rows=npsQKey===PILOT_QUARTER?test10AsNpsRows():[];
    d={rows,promoters:rows.filter(r=>r.score===10),neutrals:rows.filter(r=>r.score===9),detractors:rows.filter(r=>r.score<9)};
  } else if(kind==='managed'){
    const rows=getNpsScoped(kind,accts).rows.filter(r=>r.date && quarterKeyForDate(r.date)===npsQKey);
    d={rows,promoters:rows.filter(r=>r.score===10),neutrals:rows.filter(r=>r.score===9),detractors:rows.filter(r=>r.score<9)};
  } else {
    d=getNpsScoped(kind,accts);
  }
  const green=chartHue('green'), red=chartHue('red'), amber=chartHue('amber');
  destroyChartKey('npsDonut'+kind); destroyChartKey('npsBar'+kind);
  const dEl=$('#nps'+kind+'Donut');
  if(dEl){ charts['npsDonut'+kind]=new Chart(dEl,{type:'doughnut',data:{labels:['10 (Promoters)','9 (Neutral)','Below 9 (Detractors)'],datasets:[{data:[d.promoters.length,d.neutrals.length,d.detractors.length],backgroundColor:[green,amber,red],borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',noScales:true})}); }
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
    // Real CSAT score now (not the NPS score) — same 3-tier threshold as NPS
    // (10 promoter/9 neutral/below 9 detractor), applied to the subset of
    // responses with CSAT feedback logged.
    const csatGreen=complaints.filter(r=>r.csatScore===10).length, csatAmber=complaints.filter(r=>r.csatScore===9).length, csatRed=complaints.filter(r=>r.csatScore<9).length;
    charts['npsCsatDonut'+kind]=new Chart(csatDonutEl,{type:'doughnut',data:{labels:['10 (Promoters)','9 (Neutral)','Below 9 (Detractors)'],datasets:[{data:[csatGreen,csatAmber,csatRed],backgroundColor:[green,amber,red],borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',noScales:true})});
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
      data:{ labels:csmCats.map(c=>c.csm), datasets:[{ data:csmCats.map(c=>c.n), backgroundColor:chartHue('amber'), borderRadius:window.AXON_THEME?0:5 }] },
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
// Delegates to the single global Test10/quarter toggles (kept as named
// wrappers so the existing button markup below doesn't need to change).
function setNpsManagedTest10(v){ setRiskTest10(v); }
function setNpsManagedYear(y){ setGlobalQYear(y); }
function setNpsManagedQ(q){ setGlobalQQ(q); }
function test10AsNpsRows(){
  return getTest10Data().map(r=>{
    const a=STATE.accounts.find(x=>x.name===r.account);
    return {id:a?a.id:r.account,label:r.account,owner:a?a.ownerName:'—',score:r.score,date:(r.timestamp||'').slice(0,10),category:r.reason,comment:r.comment,source:r.source,description:r.description,relationshipIntent:r.relationshipIntent,csatScore:r.csatScore??null,csatComments:r.csatComments||''};
  });
}
// Cached per-kind so the click-through modals (openNpsDrivers/openNpsCsmFeedback)
// can access the same grouped comment data npsView() just computed, without
// recomputing it - the modal opens from a later, separate click event.
let NPS_DRIVER_CACHE={};
function npsDriverAccordionHtml(groups,pillClass){
  return groups.length?groups.map(g=>`<details class="disc" style="margin-bottom:10px">
    <summary><h4 style="display:inline-flex;align-items:center;gap:8px;margin:0">${esc(g.label)} <span class="pill ${pillClass(g)}">${g.rows.length}</span></h4></summary>
    <div style="margin-top:10px">${g.rows.map(r=>`<div class="next-step" style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><b>${esc(r.label)}</b><span class="pill ${npsTierPill(r.score!=null?r.score:r.csatScore)}">${r.score!=null?r.score:r.csatScore}/10</span></div><div class="mini" style="margin-top:4px">${esc(r.comment||r.csatComments||'')}</div><div class="mini" style="color:var(--muted2);margin-top:4px">${r.date?esc(r.date):''}${r.owner&&r.score!=null?' · Owner '+esc(r.owner):''}</div></div>`).join('')}</div>
  </details>`).join(''):'<p class="mini">Nothing logged in this scope.</p>';
}
function openNpsDrivers(kind){
  const d=NPS_DRIVER_CACHE[kind]; if(!d) return;
  const groups=d.nonPromoterCats.map(c=>({label:c.cat,rows:d.grouped[c.cat]}));
  $('#sheet').innerHTML=`<div class="hd"><div><h2>Non-promoter drivers</h2><div class="mini">Every NPS/CSAT response scored 9 or below, grouped by driver category</div></div><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="bd">${npsDriverAccordionHtml(groups,g=>g.rows.some(r=>r.score<9)?'p-red':'p-amber')}</div>`;
  showOverlay();
}
function openNpsCsmFeedback(kind){
  const d=NPS_DRIVER_CACHE[kind]; if(!d) return;
  const groups=d.csmCats.map(c=>({label:c.csm,rows:d.csmGrouped[c.csm]}));
  $('#sheet').innerHTML=`<div class="hd"><div><h2>CSM Feedback</h2><div class="mini">CSAT complaints grouped by the CSM they were logged against</div></div><button class="x" onclick="closeSheet()">✕</button></div>
    <div class="bd">${npsDriverAccordionHtml(groups,()=>'p-red')}</div>`;
  showOverlay();
}
function npsView(kind,accts){
  const label=kind==='managed'?'Managed Account NPS & CSAT':'Agency NPS & CSAT';
  let scope=kind==='managed'?'NPS from accounts actively managed by a CSM':'Broader agency-wide NPS across divisions/respondents — reported separately from managed accounts, not blended together — always shown across the whole agency regardless of "View as"';
  if(kind==='managed' && ownerFilter) scope=`NPS for ${esc(ownerFilter)}'s managed accounts`;
  const usingTest10=kind==='managed' && riskTest10;
  const npsSel=globalQSel||defaultQSel();
  const npsQKey=quarterKeyOf(npsSel);
  let rows;
  if(kind!=='managed'){ rows=getNpsScoped(kind,accts).rows; }
  else if(usingTest10){ rows=npsQKey===PILOT_QUARTER?test10AsNpsRows():[]; }
  else{ rows=getNpsScoped(kind,accts).rows.filter(r=>r.date && quarterKeyForDate(r.date)===npsQKey); }
  const promoters=rows.filter(r=>r.score===10), neutrals=rows.filter(r=>r.score===9), detractors=rows.filter(r=>r.score<9);
  const total=rows.length;
  // Top overview combines NPS + CSAT additively, not "whichever is worse": a
  // single response with, say, CSAT=9 and NPS=7 adds 1 to Neutral (from its
  // CSAT tier) AND 1 to Detractors (from its NPS tier) - each metric counts
  // toward its own tile independently, so these three tiles can add up to
  // more than Total responses (that's expected, by design).
  const complaints=rows.filter(r=>r.csatScore!=null && r.csatComments);
  const csatPromoters=complaints.filter(r=>r.csatScore===10), csatNeutrals=complaints.filter(r=>r.csatScore===9), csatDetractors=complaints.filter(r=>r.csatScore<9);
  const combinedTotal=total+complaints.length;
  const overallPromoters=[...promoters,...csatPromoters];
  const overallNeutrals=[...neutrals,...csatNeutrals];
  const overallDetractors=[...detractors,...csatDetractors];
  // The bar chart (drawn in drawNpsCharts) only covers true detractors (<9) -
  // "cats" here must match that same population so the chart height/click
  // targets line up. The "Non-promoter drivers" listing below is broader on
  // purpose (includes neutral 9s too) so no comment gets hidden, sorted from
  // lowest score to highest within each category.
  const cats=npsCategoryCounts(detractors);
  const nonPromoters=rows.filter(r=>r.score<=9);
  const nonPromoterCats=npsCategoryCounts(nonPromoters);
  const grouped={};
  nonPromoters.forEach(r=>{ (grouped[r.category]=grouped[r.category]||[]).push(r); });
  Object.values(grouped).forEach(list=>list.sort((a,b)=>a.score-b.score));
  const csmCounts={};
  complaints.forEach(r=>{ csmCounts[r.owner]=(csmCounts[r.owner]||0)+1; });
  const csmCats=Object.entries(csmCounts).map(([csm,n])=>({csm,n})).sort((a,b)=>b.n-a.n);
  const csmGrouped={};
  complaints.forEach(r=>{ (csmGrouped[r.owner]=csmGrouped[r.owner]||[]).push(r); });
  NPS_DRIVER_CACHE[kind]={nonPromoterCats,grouped,csmCats,csmGrouped};
  const test10Bar=kind==='managed'?`<div class="row-actions" style="margin:-4px 0 14px;flex-wrap:wrap">
    <button type="button" class="btn sm${riskTest10?' primary':''}" onclick="setNpsManagedTest10(${riskTest10?'false':'true'})">${riskTest10?'← Back to full book':'Pull up Test 10 (live pilot)'}</button>
    ${riskTest10?`<button type="button" class="btn sm" onclick="refreshSheetData()">Refresh from Sheet</button><span class="mini">${sheetLastFetch?'Last refreshed '+sheetLastFetch.toLocaleTimeString():''}</span>`:''}
  </div>`:'';
  return `${test10Bar}<div class="card"><h3>${esc(label)} <span class="hint">${usingTest10?'Test 10 pilot accounts':scope}</span></h3>
    ${kind==='managed'?quarterToggleHtml(npsSel,'setNpsManagedYear','setNpsManagedQ'):''}
    ${usingTest10&&npsQKey!==PILOT_QUARTER?`<p class="mini">The live pilot began in <b>${esc(PILOT_QUARTER)}</b> — no pilot responses exist for ${npsSel.year} Q${npsSel.q}.</p>`:''}
    ${sheetFetchError&&usingTest10&&npsQKey===PILOT_QUARTER?`<p class="mini" style="color:var(--red)">${esc(sheetFetchError)}</p>`:''}
    <div class="kpis" style="margin:14px 0">
      <div class="kpi clickable" onclick="scrollToSection('npsSplitCard-${kind}')"><div class="l">Total responses</div><div class="v">${total}</div><div class="d">${kind==='managed'?'accounts with an NPS response':'respondents across the agency'}</div></div>
      <div class="kpi risk-green clickable" onclick="scrollToSection('npsSplitCard-${kind}')"><div class="l">10 (Promoters)</div><div class="v">${overallPromoters.length}</div><div class="d">NPS + CSAT combined · ${combinedTotal?Math.round(overallPromoters.length/combinedTotal*100):0}%</div></div>
      <div class="kpi risk-amber clickable" onclick="scrollToSection('npsSplitCard-${kind}')"><div class="l">9 (Neutral)</div><div class="v">${overallNeutrals.length}</div><div class="d">NPS + CSAT combined · ${combinedTotal?Math.round(overallNeutrals.length/combinedTotal*100):0}%</div></div>
      <div class="kpi risk-red clickable" onclick="openNpsDrivers('${kind}')"><div class="l">Below 9 (Detractors)</div><div class="v">${overallDetractors.length}</div><div class="d">NPS + CSAT combined · ${combinedTotal?Math.round(overallDetractors.length/combinedTotal*100):0}%</div></div>
    </div>
    <div class="grid3" id="npsSplitCard-${kind}">
      <div class="card" style="box-shadow:none"><h3>NPS split</h3><div class="chartbox"><canvas id="nps${kind}Donut"></canvas></div></div>
      <div class="card" style="box-shadow:none" id="csatSplitCard-${kind}"><h3>CSAT split</h3><div class="chartbox"><canvas id="nps${kind}CsatDonut"></canvas></div></div>
      <div class="card" style="box-shadow:none"><h3>Why scores are below 9</h3><div class="chartbox" style="height:${Math.max(180,cats.length*38)}px"><canvas id="nps${kind}Bar"></canvas></div></div>
    </div>
    <div class="grid3" style="margin-top:12px">
      <div class="card" style="box-shadow:none"><h3>Complaints by CSM</h3><div class="chartbox" style="height:${Math.max(180,csmCats.length*38)}px"><canvas id="nps${kind}CsmBar"></canvas></div></div>
      <div class="card" style="box-shadow:none"><h3>Describe Axon to a colleague</h3><div class="chartbox"><canvas id="nps${kind}Desc"></canvas></div></div>
      <div class="card" style="box-shadow:none"><h3>Grow, stay, or decline?</h3><div class="chartbox"><canvas id="nps${kind}Intent"></canvas></div></div>
    </div>
  </div>
  <div class="grid2">
    <div class="card clickable" onclick="openNpsDrivers('${kind}')"><h3>Non-promoter drivers</h3>
      ${nonPromoterCats.length?`<div class="row-actions" style="margin-top:8px">${nonPromoterCats.map(c=>`<span class="pill ${grouped[c.cat].some(r=>r.score<9)?'p-red':'p-amber'}">${esc(c.cat)} · ${c.n}</span>`).join('')}</div><p class="mini" style="margin-top:10px">${nonPromoters.length} response${nonPromoters.length===1?'':'s'} scored 9 or below. Click to view comments →</p>`:'<p class="mini">No feedback logged at 9 or below in this scope.</p>'}
    </div>
    <div class="card clickable" onclick="openNpsCsmFeedback('${kind}')"><h3>CSM Feedback</h3>
      ${csmCats.length?`<div class="row-actions" style="margin-top:8px">${csmCats.map(c=>`<span class="pill p-red">${esc(c.csm)} · ${c.n}</span>`).join('')}</div><p class="mini" style="margin-top:10px">${complaints.length} complaint${complaints.length===1?'':'s'} logged. Click to view comments →</p>`:'<p class="mini">No CSM feedback logged in this scope.</p>'}
    </div>
  </div>`;
}
function viewNpsManaged(accts){ return npsView('managed',accts); }
function viewNpsAgency(accts){ return npsView('agency',accts); }
// ---- CSAT (send/receive funnel) ----
// UI preview only, per instruction — the three boxes and year/quarter filter
// are wired to existing surveyState so the shape is real, but the automated
// quarterly send + Customer-Insights ingestion described alongside this isn't
// built yet: All Accounts -> Surveys Sent -> Surveys Received per quarter.
// Delegates to the single global Test10/quarter toggles (kept as named
// wrappers so the existing button markup below doesn't need to change).
function setCsatFilterYear(y){ setGlobalQYear(y); }
function setCsatFilterQ(q){ setGlobalQQ(q); }
function setCsatTest10(v){ setRiskTest10(v); }
function setCsatTest10Year(y){ setGlobalQYear(y); }
function setCsatTest10Q(q){ setGlobalQQ(q); }
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
    <button type="button" class="btn sm${riskTest10?' primary':''}" onclick="setCsatTest10(${riskTest10?'false':'true'})">${riskTest10?'← Back to full book':'Test 10 (live pilot)'}</button>
    ${riskTest10?`<button type="button" class="btn sm" onclick="refreshSheetData()">Refresh from Sheet</button><span class="mini">${sheetLastFetch?'Last refreshed '+sheetLastFetch.toLocaleTimeString():'Not yet refreshed — showing mock placeholders'}</span>`:''}
  </div>`;

  if(riskTest10){
    const sel=globalQSel||defaultQSel();
    const qKey=quarterKeyOf(sel);
    const isLive=qKey===PILOT_QUARTER;
    const statusList=isLive?getTest10StatusList():[];
    const sentThisCycle=isLive&&test10SentAt;
    const sentCount=sentThisCycle?10:0;
    const receivedCount=sentThisCycle?getTest10RawResponses().length:0;
    const notReceivedCount=sentThisCycle?statusList.filter(r=>!r.received).length:0;
    return `${test10Bar}<div class="card"><h3>NPS</h3>
      ${quarterToggleHtml(sel,'setCsatTest10Year','setCsatTest10Q')}
      ${sheetFetchError&&isLive?`<p class="mini" style="color:var(--red)">${esc(sheetFetchError)}</p>`:''}
      ${!isLive?`<p class="mini">The live pilot began in <b>${esc(PILOT_QUARTER)}</b> — no pilot responses exist before that.</p>`:''}
      ${funnelForkHtml(isLive?10:0,'pilot group',sentCount,'assumed sent',receivedCount,'real Sheet response',notReceivedCount,'no response yet','csatStatusCard')}
    </div>
    ${automationBatchHtml('csat')}
    <div class="card" id="csatStatusCard"><h3>Customer status</h3>
      ${statusList.length?`<table><thead><tr><th>Account</th><th>Status</th><th class="num">NPS Score</th><th>NPS Reason</th><th>NPS Comment</th><th class="num">CSAT Score</th><th>CSAT Comments</th><th>Date</th></tr></thead><tbody>
      ${statusList.map(r=>{ const a=STATE.accounts.find(x=>x.name===r.account); return `<tr onclick="${a?`openAcct('${a.id}')`:''}" style="cursor:${a?'pointer':'default'}"><td><b>${esc(r.account)}</b></td><td><span class="pill ${r.received?'p-green':'p-amber'}">${r.received?'Received':'Not received'}</span></td><td class="num">${r.score==null?'—':`<span class="pill ${npsTierPill(r.score)}">${r.score}/10</span>`}</td><td>${esc(r.reason||'—')}</td><td class="mini">${esc(r.comment||'—')}</td><td class="num">${r.csatScore==null?'—':`<span class="pill ${npsTierPill(r.csatScore)}">${r.csatScore}/10</span>`}</td><td class="mini">${esc(r.csatComments||'—')}</td><td class="mini">${r.timestamp?esc(r.timestamp.slice(0,10)):'—'}</td></tr>`; }).join('')}
      </tbody></table>`:'<p class="mini">No pilot data for this quarter.</p>'}
    </div>`;
  }

  const sel=globalQSel||defaultQSel();
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
  const sel=globalQSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]};
  const {themes}=getInsightsData(accts,quarterKeyOf(sel));
  destroyChartKey('insightsTheme');
  const el=$('#insightsThemeChart'); if(!el||!themes.length) return;
  const light=(window.CSCC_THEME||document.documentElement.getAttribute('data-theme'))==='light'
    || (!window.CSCC_THEME && !!window.AXON_THEME && document.documentElement.getAttribute('data-theme')!=='dark');
  const gridColor=light?'#e0e0e0':'#242634', textColor=light?'#5c5c5c':'#9a9ba8';
  const violet=chartHue('violet');
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
function setInsightsYear(y){ setGlobalQYear(y); }
function setInsightsQ(q){ setGlobalQQ(q); }
function viewInsightsTab(accts){
  const sel=globalQSel||{year:+PILOT_QUARTER.split('-Q')[0],q:+PILOT_QUARTER.split('-Q')[1]};
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
    ${rows.map(r=>{ const a=STATE.accounts.find(x=>x.name===r.account); return `<tr onclick="${a?`openAcct('${a.id}')`:''}" style="cursor:${a?'pointer':'default'}"><td class="mini">${r.timestamp?esc(r.timestamp):'—'}</td><td><b>${esc(r.account)}</b></td><td>${a?ownerCell(a.ownerName):'—'}</td><td class="num">${r.score==null?'—':`<span class="pill ${npsTierPill(r.score)}">${r.score}/10</span>`}</td><td>${esc(r.reason||'—')}</td><td class="mini">${esc(r.comment||'—')}</td><td class="mini">${esc(r.contactName||'—')}</td><td class="mini">${esc(r.contactTitle||'—')}</td><td class="mini">${esc(r.description||'—')}</td><td class="mini">${esc(r.relationshipIntent||'—')}</td><td class="num">${r.csatScore==null?'—':`<span class="pill ${npsTierPill(r.csatScore)}">${r.csatScore}/10</span>`}</td><td class="mini">${esc(r.csatComments||'—')}</td></tr>`; }).join('')}
    </tbody></table></div>`:'<p class="mini">No responses yet.</p>'}`; })():`<p class="mini">The live pilot began in <b>${esc(PILOT_QUARTER)}</b> — no pilot matrix data exists for ${sel.year} Q${sel.q}.</p>`}
  </div>
  <div class="card" id="insightsRecentCard"><h3>Recent entries</h3>
    ${entries.length? entries.slice(0,60).map(e=>`<div class="next-step" style="margin-bottom:8px;cursor:pointer" onclick="openAcct('${e.acctId}')">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <span style="display:flex;align-items:center;gap:8px">${avatarChip(e.acctName)}<b>${esc(e.acctName)}</b>${e.type==='survey-live'?'<span class="pill p-green">Live pilot response</span>':e.type==='survey'?`<span class="pill p-blue">Survey${e.quarter?' · '+esc(e.quarter):''}</span>`:'<span class="pill p-gray">Insight</span>'}${e.score!=null?`<span class="pill ${npsTierPill(e.score)}">${e.score}/10</span>`:''}</span>
        <span class="mini" style="color:var(--muted2)">${new Date(e.t).toLocaleDateString()} · ${ownerCell(e.owner)}</span>
      </div>
      <div class="mini" style="margin-top:6px">${esc(e.note)}</div>
    </div>`).join('') : '<p class="mini">No insights or survey notes logged yet in this scope.</p>'}
  </div>`;
}
// Every account in scope, one row each - this is the real landing spot for
// account-level data going forward (per CS-leadership: any change to an
// account's data starts here), not just a read-only report. Clicking a row
// opens the same full Account 360 detail view used everywhere else in the
// app (openAcct), so there's exactly one place account data actually lives,
// not a second parallel "scorecard" copy of it.
function viewProductScorecard(accts){
  if(!orgFeatureFlags.productLineScorecard){
    return `<div class="card"><h3>Product <span class="sortbar">${ceTest10ToggleHtml()}</span></h3>
      <p class="mini" style="margin-bottom:12px">The active config doesn't have product-line scorecards turned on. Law Enforcement's config enables it (goals/risk/qualifying info tracked per product family, aggregating up to account level) - switch to that config in Configure Org Data, or turn the flag on for your current one.</p>
      <button type="button" class="btn sm" onclick="setTab('model')">Go to Configure Org Data</button>
    </div>`;
  }
  const scored=accts.filter(a=>productScorecards[a.id] && Object.keys(productScorecards[a.id]).length);
  const totalFamilies=scored.reduce((s,a)=>s+Object.keys(productScorecards[a.id]).length,0);
  const atRiskFamilies=scored.reduce((s,a)=>s+acctProductRiskRollup(a.id).atRisk,0);
  return `<div class="card"><h3>Product</h3>
    <div class="kpis" style="margin:14px 0">
      <div class="kpi"><div class="l">Accounts scored</div><div class="v">${scored.length}</div><div class="d">of ${accts.length} in scope</div></div>
      <div class="kpi"><div class="l">Product lines tracked</div><div class="v">${totalFamilies}</div><div class="d">across scored accounts</div></div>
      <div class="kpi risk-red"><div class="l">At-risk product lines</div><div class="v">${atRiskFamilies}</div><div class="d">needs attention</div></div>
    </div>
  </div>
  <div class="card"><h3>Accounts</h3>
    ${scored.length?`<table><thead><tr><th>Account</th><th>Owner</th><th class="num">Product lines</th><th class="num">Healthy</th><th class="num">Watch</th><th class="num">At risk</th></tr></thead><tbody>
    ${scored.map(a=>{ const r=acctProductRiskRollup(a.id); return `<tr onclick="openAcct('${a.id}')" style="cursor:pointer"><td><b>${esc(a.name)}</b></td><td>${ownerCell(a.ownerName)}</td><td class="num">${r.total}</td><td class="num">${r.healthy}</td><td class="num">${r.watch}</td><td class="num">${r.atRisk}</td></tr>`; }).join('')}
    </tbody></table>`:'<p class="mini">No accounts scored yet — open an account, view its Products Purchased card, then set goals/risk in the Product-line scorecard card that appears below it.</p>'}
  </div>`;
}
function viewAcctScorecard(accts){
  const sorted=[...accts].sort((a,b)=>b.renewalAmount-a.renewalAmount);
  const totalTcv=accts.reduce((s,a)=>s+(a.renewalAmount||0),0);
  const withHealth=accts.filter(a=>a.health!=null);
  const avgHealth=withHealth.length?Math.round(withHealth.reduce((s,a)=>s+a.health,0)/withHealth.length):null;
  const healthy=accts.filter(a=>a.tier==='healthy').length;
  const atRisk=accts.filter(a=>a.tier==='atrisk').length;
  const riskArr=accts.reduce((s,a)=>s+(a.riskARR||0),0);
  return `<div class="card"><h3>Account <span class="sortbar">${ceTest10ToggleHtml()}${riskTest10?`<button type="button" class="btn sm" onclick="refreshSheetData()" title="Pull the latest NPS/CSAT survey responses and re-evaluate triggers">↻ Refresh from Sheet</button><span class="mini">${sheetLastFetch?'Last refreshed '+sheetLastFetch.toLocaleTimeString():''}</span>`:''}</span></h3>
    <div class="kpis" style="margin:14px 0">
      <div class="kpi"><div class="l">Accounts</div><div class="v">${accts.length}</div><div class="d">in scope</div></div>
      <div class="kpi"><div class="l">Total Contract Value</div><div class="v">${fmtMoney(totalTcv)}</div><div class="d">across scope</div></div>
      <div class="kpi"><div class="l">Avg health</div><div class="v" style="color:${avgHealth==null?'var(--muted)':avgHealth>=75?'var(--green)':avgHealth>=50?'var(--amber)':'var(--red)'}">${avgHealth==null?'—':avgHealth}</div><div class="d">${healthy} healthy · ${atRisk} at risk</div></div>
      <div class="kpi risk-red"><div class="l">ARR at risk</div><div class="v">${fmtMoney(riskArr)}</div><div class="d">renewal ARR × risk</div></div>
    </div>
    <table><thead><tr><th>Account</th><th>Owner</th><th class="num">Total Contract Value</th><th class="num">Close</th><th>CSAT</th><th>NPS</th><th>Health</th></tr></thead><tbody>
    ${sorted.map(a=>`<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${a.dclose>9000?'—':a.dclose+'d'}</td><td>${csatPill(a)}</td><td>${npsPill(a)}</td><td>${healthWithTier(a.health,a.tier)}</td></tr>`).join('')}
    </tbody></table>
  </div>`;
}
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
function healthCell(h){ if(h==null) return `<span class="hs"><span class="bar"><i style="width:0%"></i></span><b style="color:var(--muted)">—</b></span>`; const c=h>=75?'var(--green)':h>=50?'var(--amber)':'var(--red)'; return `<span class="hs"><span class="bar"><i style="width:${h}%;background:${c}"></i></span><b style="color:${c}">${h}</b></span>`; }
function tierPill(t){ if(t==null) return '<span class="pill p-gray">No data</span>'; return t==='healthy'?'<span class="pill p-green">Healthy</span>':t==='watch'?'<span class="pill p-amber">Watch</span>':'<span class="pill p-red">At risk</span>'; }
// healthCell + tierPill always render as a single atomic unit - without this,
// the two sit as separate inline elements and wrap onto their own line only
// when the pill text happens to be just wide enough (e.g. "Healthy"), leaving
// some rows one line and others two for no visible reason.
function healthWithTier(h,t){ return `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap">${healthCell(h)}${tierPill(t)}</span>`; }
function sevPill(s){ const m={Critical:'p-red',High:'p-red',Medium:'p-amber',Low:'p-gray'}; return `<span class="pill ${m[s]||'p-gray'}">${s}</span>`; }
function statusPill(s){ const m={Open:'p-red','In Progress':'p-amber',Resolved:'p-green'}; return `<span class="pill ${m[s]||'p-gray'}">${s}</span>`; }

function renderCrumb(){
  // Root ("Axon Customer Success") carries no navigational value of its own -
  // drop it from the displayed trail; deeper drill-down crumbs still show.
  const path = crumbPath(STATE.scope).filter(n=>n.id!=='ROOT');
  $('#crumb').innerHTML = path.map((n,i)=> i===path.length-1
    ? `<span class="cur">${esc(n.name)}</span>`
    : `<button onclick="setScope('${n.id}')">${esc(n.name)}</button><span class="sep">›</span>`).join('');
  $('#scoperole').textContent = '';
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
function setTab(t){ currentAcctView=null; currentEngagementCtaId=null; currentCsmView=null; currentPredictiveAcctId=null; currentPlanAcctId=null; currentPlanMilestone=null; STATE.tab=t; navOpenCat=categoryForTab(t).id; window.scrollTo(0,0); route(); }

function tabBadges(){
  return {
    riskboard: triggerEvents.filter(isTriggerLive).length,
    engagement: engagementCtas.filter(ceIsOpenOrInProgress).length,
    escalations: engagementCtas.filter(c=>c.category==='escalation' && ceIsOpenOrInProgress(c)).length,
    activectas: engagementCtas.filter(c=>c.category!=='escalation' && ceIsOpenOrInProgress(c)).length,
    usage: STATE.accounts.filter(a=>adoptionTier(a)==='low').length,
  };
}

function route(){
  if(!STATE.tree) return;
  if(!STATE.nodeIndex[STATE.scope]) STATE.scope='ROOT';
  // Runs before any early-return branch so the nav badge stays current no
  // matter which page is actually open right now.
  detectRiskStageShifts();
  if(currentAcctView){ renderAcctPage(); renderNav(); wrapWideTables(); return; }
  if(currentEngagementCtaId){ renderEngagementCtaPage(); renderNav(); wrapWideTables(); return; }
  if(currentCsmView){ renderCsmProfilePage(); renderNav(); wrapWideTables(); return; }
  if(currentPredictiveAcctId){ renderPredictiveInsightPage(); renderNav(); wrapWideTables(); return; }
  if(currentPlanMilestone){ renderPlanMilestonePage(); renderNav(); wrapWideTables(); return; }
  if(currentPlanAcctId){ renderPlanPage(); renderNav(); wrapWideTables(); return; }
  STATE.accounts.forEach(a=>a.readiness=readinessScore(a));
  const isHome = STATE.tab==='home';
  const hideScope = isHome || STATE.tab==='npsagency';
  $('#scopebar').style.display = hideScope ? 'none' : '';
  if(!hideScope) renderCrumb();
  const accts0 = accountsUnder(STATE.scope);
  // riskTest10 is the single global Test 10 toggle - applied once here so every
  // view function fed by `accts` scopes to the 10 pilot accounts automatically,
  // rather than each page re-implementing its own Test10 filter. Test10 mode
  // always shows the same fixed 10 accounts regardless of "View as"/org scope
  // (same guarantee the risk-board sandbox already relied on), so it bypasses
  // ownerFilter/scope entirely rather than intersecting with them.
  const accts = riskTest10 ? STATE.accounts.filter(a=>TEST10_ACCOUNTS.includes(a.name))
    : (ownerFilter ? accts0.filter(a=>a.ownerName===ownerFilter) : accts0);
  const app=$('#app');
  if(STATE.tab==='home') app.innerHTML=viewHome();
  else if(STATE.tab==='overview') app.innerHTML=viewOverview(accts);
  else if(STATE.tab==='hierarchy') app.innerHTML=viewHierarchy();
  else if(STATE.tab==='riskboard') app.innerHTML=viewRiskKanban(accts);
  else if(STATE.tab==='scorecard') app.innerHTML=viewScorecard(accts);
  else if(STATE.tab==='usage') app.innerHTML=viewUsage(accts);
  else if(STATE.tab==='engagement') app.innerHTML=viewClientEngagement(accts);
  else if(STATE.tab==='escalations') app.innerHTML=viewEscalations(accts);
  else if(STATE.tab==='activectas') app.innerHTML=viewActiveCtas(accts);
  else if(STATE.tab==='predictive') app.innerHTML=viewPredictive(accts);
  else if(STATE.tab==='plans') app.innerHTML=viewPlans(accts);
  else if(STATE.tab==='csemails') app.innerHTML=viewCsEmails(accts);
  else if(STATE.tab==='emails') app.innerHTML=viewEmails(accts);
  else if(STATE.tab==='worklist') app.innerHTML=viewWork(accts);
  else if(STATE.tab==='model') app.innerHTML=viewModel(accts);
  else if(STATE.tab==='resources') app.innerHTML=viewResources();
  else if(STATE.tab==='execreport') app.innerHTML=viewExecReport(accts);
  else if(STATE.tab==='gong') app.innerHTML=viewGong(accts);
  else if(STATE.tab==='acctoutcomes') app.innerHTML=viewAcctOutcomes(accts);
  else if(STATE.tab==='npsmanaged') app.innerHTML=viewNpsManaged(accts);
  else if(STATE.tab==='npsagency') app.innerHTML=viewNpsAgency(accts);
  else if(STATE.tab==='csat') app.innerHTML=viewCsatTab(accts);
  else if(STATE.tab==='insights') app.innerHTML=viewInsightsTab(accts);
  else if(STATE.tab==='acctscorecard') app.innerHTML=viewAcctScorecard(accts);
else if(STATE.tab==='prodscorecard') app.innerHTML=viewProductScorecard(accts);
    else if(STATE.tab==='integrations') app.innerHTML=viewIntegrations();
  // renderNav() runs BEFORE chart drawing on purpose: it's what opens/closes
  // the flyout sidebar, which resizes the main content area. Chart.js measures
  // its canvas at creation time - drawing charts before the flyout finishes
  // opening/closing left them sized against the wrong (pre-flyout) width,
  // which is exactly the overlapping/stale-looking render seen the first time
  // navigating into a multi-tab category like Customer Pulse.
  renderNav();
  if(STATE.tab==='overview') drawOverviewCharts(accts);
  if(STATE.tab==='home') drawHomeChart();
  if(STATE.tab==='npsmanaged') drawNpsCharts('managed',accts);
  if(STATE.tab==='npsagency') drawNpsCharts('agency',accts);
  if(STATE.tab==='insights') drawInsightsChart(accts);
  if(STATE.tab==='riskboard'){ wireRiskKanbanDnD(); drawRiskEscalationCharts(accts); }
  if(STATE.tab==='engagement') drawClientEngagementCharts(accts);
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
  // 5th element is an importance tier (critical/high/normal), color-coded below -
  // critical = something actively losing revenue right now, high = a leading
  // indicator worth checking regularly, normal = informational/context.
  const kpis=[
    ['Engagement rate',r.engagementPct+'%',r.inCadence+' of '+r.n+' accounts in outreach cadence','engagement','high'],
    ['Growth',fmtMoney(r.growthTotal),'Renewal '+fmtMoney(r.growth.Renewal)+' · Expansion '+fmtMoney(r.growth.Expansion)+' · Transactional '+fmtMoney(r.growth.Transactional),'scorecard','normal'],
    ['Insights logged',insightsRecent,'last 30 days across the book','scorecard','normal'],
    ['Book NPS',npsR?npsR.score:'—',npsR?(npsR.n+' survey responses · '+npsR.promoters+' promoters, '+npsR.detractors+' detractors'):'no biannual survey responses on file','scorecard','high'],
    ['Total Contract Value',fmtMoney(r.arr),r.renewals+' open renewals','overview','normal'],
    ['ARR at risk',fmtMoney(r.risk),Math.round(r.risk/(r.arr||1)*100)+'% risk-weighted','riskboard','critical'],
    ['TAP refreshes due',tapOverdue+tapDueSoon,tapOverdue+' overdue · '+tapDueSoon+' due within 90 days','riskboard','high'],
  ];
  // Derived straight from NAV_CATEGORIES/TAB_LABELS (not a separately
  // hand-maintained list) so this can never drift out of sync with the real
  // nav rail again - a category renamed/removed there updates here for free.
  // Only the per-category description below needs a human touch, and only
  // when that category's actual purpose changes, not on routine tab shuffling.
  const categoryDescriptions={
    cockpit:'KPIs, ARR at risk, and your prioritized worklist.',
    performance:'CSM scorecards, executive report, and org config.',
    pulse:'NPS/CSAT tracking, Customer Insights, Usage & Adoption.',
    risk:'Kanban board of every account by risk stage.',
    engagement:'Escalations, Active CTAs, Email Outreach, and Insights.',
    journey:'Predictive Insights → Success Plans → Account Outcomes.',
    resources:'Guides, SOPs, and Salesforce object integrations.',
  };
  const features=NAV_CATEGORIES.filter(c=>c.id!=='home').map(c=>[c.label,c.tabs[0],categoryDescriptions[c.id]||'']);
  return `
  <div class="hero">
    <div class="eyebrow">Customer Success Command Center</div>
    <h2>Welcome ${esc((window.CURRENT_USER&&(window.CURRENT_USER.displayName||window.CURRENT_USER.username))||'there')}!</h2>
  </div>
  <div class="kpis kpis-7col">${kpis.map(k=>{
    const tier=k[4]==='critical'?' risk-red':k[4]==='high'?' risk-amber':'';
    return `<div class="kpi clickable${tier}" onclick="setTab('${k[3]}')" title="Go to ${esc(TAB_LABELS[k[3]]||k[3])}"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`;
  }).join('')}</div>
  <div class="grid2" style="margin-top:16px">
    <div class="card"><h3>Book health</h3><div class="chartbox"><canvas id="cHome"></canvas></div>
      <div class="legend"><span><i class="dot" style="background:var(--green)"></i>Healthy ≥75</span><span><i class="dot" style="background:var(--amber)"></i>Watch 50–74</span><span><i class="dot" style="background:var(--red)"></i>At risk &lt;50</span></div>
    </div>
    <div class="card"><h3>NPS response split</h3><div class="chartbox"><canvas id="homeNpsDonut"></canvas></div>
      ${npsR?`<div class="legend"><span><i class="dot" style="background:var(--green)"></i>Promoters (${npsR.promoters})</span><span><i class="dot" style="background:var(--amber)"></i>Passives (${npsR.passives})</span><span><i class="dot" style="background:var(--red)"></i>Detractors (${npsR.detractors})</span></div>`:'<p class="mini">No survey responses on file.</p>'}
    </div>
  </div>
  <div class="grid3" style="margin-top:16px">
    <div class="card"><h3>Trigger breakdown</h3><div class="chartbox"><canvas id="riskEscDonut"></canvas></div></div>
    <div class="card"><h3>Escalations vs Active CTAs</h3><div class="chartbox"><canvas id="ceSplitDonut"></canvas></div></div>
    <div class="card"><h3>Active, Pending, Resolved</h3><div class="chartbox"><canvas id="ceTotalProgDonut"></canvas></div></div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Where to start</h3>
    <div class="features" style="grid-template-columns:repeat(7,minmax(0,1fr))">${features.map(f=>`<div class="feature" onclick="setTab('${f[1]}')"><h4>${esc(f[0])}</h4><p>${esc(f[2])}</p><div class="go">Open →</div></div>`).join('')}</div>
  </div>`;
}
// Reuses the exact same chart-drawing functions as Accounts & Risk (trigger
// breakdown) and Client Engagement (escalations/CTAs split, progress donut) -
// same canvases, same data, no duplicated chart logic - plus one Home-only
// NPS response-split donut.
function drawHomeChart(){
  Object.values(charts).forEach(c=>{try{c.destroy()}catch(e){}}); charts={};
  const accts=STATE.accounts;
  const r=rollup(accts);
  const hc=[chartHue('green'),chartHue('amber'),chartHue('red')];
  const h=$('#cHome'); if(h){ charts.home=new Chart(h,{type:'doughnut',data:{labels:['Healthy','Watch','At risk'],datasets:[{data:[r.green,r.amber,r.red],backgroundColor:hc,borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',legend:false,noScales:true})}); }
  const npsR=npsRollup(accts);
  const nEl=$('#homeNpsDonut');
  if(nEl && npsR) charts.homeNps=new Chart(nEl,{type:'doughnut',data:{labels:['Promoters','Passives','Detractors'],datasets:[{data:[npsR.promoters,npsR.passives,npsR.detractors],backgroundColor:hc,borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',legend:false,noScales:true})});
  drawRiskEscalationCharts(accts);
  drawClientEngagementCharts(accts);
}

// ---- Overview ----
function viewOverview(accts){
  const r=rollup(accts);
  const npsR=npsRollup(accts);
  const kpis=[
    ['Engagement rate',r.engagementPct+'%',r.inCadence+' of '+r.n+' in outreach cadence','engagement'],
    ['Growth',fmtMoney(r.growthTotal),'Renewal '+fmtMoney(r.growth.Renewal)+' · Expansion '+fmtMoney(r.growth.Expansion)+' · Transactional '+fmtMoney(r.growth.Transactional),'scorecard'],
    ['Total Contract Value',fmtMoney(r.arr),r.renewals+' open renewals','riskboard'],
    ['ARR at risk',fmtMoney(r.risk),Math.round(r.risk/(r.arr||1)*100)+'% of book, risk-weighted','riskboard'],
    ['Avg health',r.health==null?'—':r.health,r.red+' at-risk · '+r.amber+' watch · '+r.green+' healthy','model'],
    ['NPS',npsR?npsR.score:'—',npsR?(npsR.n+' of '+accts.length+' accounts surveyed'):'no survey responses in scope','scorecard'],
    ['Open escalations',STATE.escList.filter(e=>accts.includes(e.acct)&&e.status!=='Resolved').length,r.high+' high/urgent · '+r.cases+' open cases','riskboard'],
    ['Expansion-ready accounts',accts.filter(a=>opportunityTier(a)==='expand').length,accts.filter(a=>opportunityTier(a)==='protect').length+' to protect & retain instead','hierarchy'],
  ];
  const topRisk=[...accts].sort((a,b)=>b.riskARR-a.riskARR).slice(0,8);
  const gSel=globalQSel||defaultQSel();
  return `
  <div class="card" style="margin-bottom:16px"><h3>Global controls</h3>
    <div class="row-actions" style="margin-bottom:10px">
      <button type="button" class="btn sm${riskTest10?' primary':''}" onclick="setRiskTest10(${riskTest10?'false':'true'})">${riskTest10?'← Back to full book (Test 10 off)':'Test 10 (whole app)'}</button>
      <span class="mini">${riskTest10?'Every tab is scoped to the 10 pilot accounts until you toggle this back.':'Scopes literally every tab — Accounts &amp; Risk, Engagement, Journey, Pulse, Performance — to just the 10 pilot accounts.'}</span>
    </div>
    ${quarterToggleHtml(gSel,'setGlobalQYear','setGlobalQQ')}
  </div>
  <div class="kpis kpis-8col">${kpis.map(k=>`<div class="kpi clickable${/at risk/i.test(k[0])?' accent':''}" onclick="setTab('${k[3]}')" title="Go to ${esc(TAB_LABELS[k[3]]||k[3])}"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  <div class="grid2">
    <div class="card"><h3>Total Contract Value by team</h3><div class="chartbox"><canvas id="cTeam"></canvas></div></div>
    <div class="card"><h3>Book health distribution</h3><div class="chartbox"><canvas id="cHealth"></canvas></div>
      <div class="legend"><span><i class="dot" style="background:var(--green)"></i>Healthy ≥75</span><span><i class="dot" style="background:var(--amber)"></i>Watch 50–74</span><span><i class="dot" style="background:var(--red)"></i>At risk &lt;50</span></div>
    </div>
  </div>
  <div class="card"><h3>Top risk-weighted accounts</h3>
    <table class="table-compact">
    <colgroup><col style="width:16%"><col style="width:9%"><col style="width:8%"><col style="width:8%"><col style="width:5%"><col style="width:10%"><col style="width:17%"><col style="width:17%"><col style="width:10%"></colgroup>
    <thead><tr><th>Account</th><th>Owner</th><th class="num">Total Contract Value</th><th class="num">Annualized Revenue</th><th class="num">Close</th><th>CSAT</th><th>NPS</th><th>Health</th><th class="num">ARR at risk</th></tr></thead><tbody>
    ${topRisk.map(a=>`<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${fmtMoney(a.ltv)}</td><td class="num">${a.dclose>9000?'—':a.dclose+'d'}</td><td>${csatPill(a)}</td><td>${npsPill(a)}</td><td>${healthWithTier(a.health,a.tier)}</td><td class="num"><b>${fmtMoney(a.riskARR)}</b></td></tr>`).join('')}
    </tbody></table>
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
// triggerEvents is the ground truth (see liveTriggerBreakdown above) - this
// is the same helper Escalations and Active CTAs use for their own bubble
// rows, just called with no type filter so it covers all 11 at once. One
// shared source means this chart, Escalations, and Active CTAs can never
// silently disagree with each other.
function riskTriggerBreakdown(scopedAccts){
  return liveTriggerBreakdown(scopedAccts);
}
// Donut + horizontal bar over every open trigger type, color-coded, same
// visual language as the NPS/CSAT donut+bar pages.
function drawRiskEscalationCharts(accts){
  const scopedAccts = riskTest10 ? STATE.accounts.filter(a=>TEST10_ACCOUNTS.includes(a.name)) : accts;
  const rawBreakdown=riskTriggerBreakdown(scopedAccts).filter(b=>b.count>0);
  destroyChartKey('riskEscDonut'); destroyChartKey('riskEscBar');
  if(!rawBreakdown.length) return;
  const {list:breakdown,hasOther}=foldToOther(rawBreakdown,8);
  const colors=categoricalPalette(breakdown.length,hasOther);
  const dEl=$('#riskEscDonut');
  if(dEl) charts.riskEscDonut=new Chart(dEl,{type:'doughnut',data:{labels:breakdown.map(b=>b.label),datasets:[{data:breakdown.map(b=>b.count),backgroundColor:colors,borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',noScales:true})});
  const bEl=$('#riskEscBar');
  if(bEl){
    const light=(window.CSCC_THEME||document.documentElement.getAttribute('data-theme'))==='light'
      || (!window.CSCC_THEME && !!window.AXON_THEME && document.documentElement.getAttribute('data-theme')!=='dark');
    const gridColor=light?'#e0e0e0':'#242634', textColor=light?'#5c5c5c':'#9a9ba8';
    const maxN=Math.max(...breakdown.map(b=>b.count));
    charts.riskEscBar=new Chart(bEl,{
      type:'bar',
      data:{ labels:breakdown.map(b=>b.label), datasets:[{ data:breakdown.map(b=>b.count), backgroundColor:colors, borderRadius:window.AXON_THEME?0:5 }] },
      options:{
        indexAxis:'y',
        responsive:true, maintainAspectRatio:false,
        scales:{
          x:{ type:'linear', min:0, max:maxN+1, ticks:{ stepSize:1, color:textColor, callback:(v)=>v===0?'':v }, grid:{ color:gridColor } },
          y:{ type:'category', ticks:{ color:textColor }, grid:{ display:false } }
        },
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{ label:(item)=>'Active escalations: '+item.raw } } }
      }
    });
  }
}
function drawOverviewCharts(accts){
  Object.values(charts).forEach(c=>{try{c.destroy()}catch(e){}}); charts={};
  const node=STATE.nodeIndex[STATE.scope]; if(!node) return;
  let groups=[];
  const kids=Object.values(node.children||{});
  if(kids.length){ groups=kids.map(k=>({label:shortName(k.name),arr:rollup(accountsUnder(k.id)).arr,risk:rollup(accountsUnder(k.id)).risk})); }
  else { const byOwner={}; accts.forEach(a=>{ (byOwner[a.ownerName]=byOwner[a.ownerName]||{label:a.ownerName,arr:0,risk:0}); byOwner[a.ownerName].arr+=a.renewalAmount; byOwner[a.ownerName].risk+=a.riskARR;}); groups=Object.values(byOwner); }
  groups.sort((a,b)=>b.arr-a.arr); groups=groups.slice(0,8);
  const barMain=chartHue('blue');
  const barRisk=chartHue('red');
  const radius=window.AXON_THEME?0:5;
  const t=$('#cTeam'); if(t){ charts.team=new Chart(t,{type:'bar',data:{labels:groups.map(g=>g.label),datasets:[
    {label:'Total Contract Value',data:groups.map(g=>Math.round(g.arr)),backgroundColor:barMain,borderRadius:radius},
    {label:'ARR at risk',data:groups.map(g=>Math.round(g.risk)),backgroundColor:barRisk,borderRadius:radius}]},
    options:chartBaseOptions({moneyTicks:true})}); }
  const r=rollup(accts);
  const hc=[chartHue('green'),chartHue('amber'),chartHue('red')];
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
  const green=chartHue('green'), red=chartHue('red');
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
    const barMain=chartHue('blue');
    acctCharts.cases=new Chart(cEl,{type:'bar',data:{labels:['All cases','High/urgent'],datasets:[
      {label:'Lifetime',data:[a.lifeCases||0,a.lifeHigh||0],backgroundColor:barMain,borderRadius:radius},
      {label:'Currently open',data:[a.openCases||0,a.highCases||0],backgroundColor:red,borderRadius:radius}
    ]},options:chartBaseOptions()});
  }
}
function drawAcctDealsChart(deals){
  const dEl=$('#acctDealsChart'); if(!dEl||!deals||!deals.length) return;
  const radius=window.AXON_THEME?0:5;
  const barMain=chartHue('blue');
  const chrono=[...deals].reverse();
  try{acctCharts.deals&&acctCharts.deals.destroy()}catch(e){}
  acctCharts.deals=new Chart(dEl,{type:'bar',data:{labels:chrono.map(o=>o.CloseDate||''),datasets:[{label:'Deal amount',data:chrono.map(o=>o.Amount||0),backgroundColor:barMain,borderRadius:radius}]},options:chartBaseOptions({moneyTicks:true,legend:false})});
}
function drawAcctProdChart(fams){
  const pEl=$('#acctProdChart'); if(!pEl||!fams||!fams.length) return;
  const radius=window.AXON_THEME?0:5;
  const barViolet=chartHue('violet');
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
    Health:a.health==null?'':a.health, TotalContractValue:a.renewalAmount, ARRAtRisk:a.riskARR==null?null:Math.round(a.riskARR), AnnualizedRevenue:a.ltv||0,
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
  const accts=riskTest10?STATE.accounts.filter(a=>TEST10_ACCOUNTS.includes(a.name))
    :(ownerFilter?accountsUnder(STATE.scope).filter(a=>a.ownerName===ownerFilter):accountsUnder(STATE.scope));
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
  return `<div class="card"><h3>Executive report <span class="sortbar">${ceTest10ToggleHtml()}</span></h3>
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
  ${(()=>{
    // A lone "Untagged" bucket isn't a real breakdown - it just means no one
    // has tagged an escalation yet. Show a pointer to actually do that instead
    // of a bar chart whose only bar says "Untagged".
    const onlyUntagged=es=>es.length===1 && es[0][0]==='Untagged';
    const reasonBody=!reasonEntries.length?'<p class="mini">No escalations in scope.</p>'
      :onlyUntagged(reasonEntries)?'<p class="mini">None tagged with a reason yet — tag them from the Escalations tab.</p>'
      :reasonEntries.map(([k,n])=>bar(k,n,reasonMax)).join('');
    const prodBody=!prodEntries.length?'<p class="mini">No escalations in scope.</p>'
      :onlyUntagged(prodEntries)?'<p class="mini">None tagged with a product yet — tag them from the Escalations tab.</p>'
      :prodEntries.map(([k,n])=>bar(k,n,prodMax)).join('');
    if(!reasonEntries.length && !prodEntries.length) return '';
    return `<div class="card"><h3>Escalations by reason &amp; product</h3>
    <div class="grid2">
      <div><p class="mini" style="margin-bottom:8px"><b>By reason code</b></p>${reasonBody}</div>
      <div><p class="mini" style="margin-bottom:8px"><b>By product</b></p>${prodBody}</div>
    </div>
    </div>`;
  })()}
  <div class="card"><h3>Account-level detail <span class="hint">${rows.length} accounts in scope</span></h3>
  <div class="searchbar"><input id="xrsearch" placeholder="Filter accounts…" oninput="filterTable(this,'xrtbl')"></div>
  <table id="xrtbl"><thead><tr><th>Account</th><th>Owner</th><th>Segment</th><th>Tier</th><th class="num">Health</th><th class="num">Total Contract Value</th><th class="num">ARR at risk</th><th class="num">Open CTAs</th><th>TAP status</th><th>Escalation</th><th class="num">Logged activity</th></tr></thead><tbody>
  ${rows.map(row=>`<tr onclick="openAcct('${row.AccountId}')"><td><b>${esc(row.Account)}</b> <span class="tag ${hueFor(row.State||'—')}">${esc(row.State||'—')}</span></td><td>${ownerCell(row.Owner)}</td><td>${esc(row.Segment)}</td><td>${esc(row.Tier)}</td><td class="num">${healthCell(row.Health===''?null:row.Health)}</td><td class="num">${fmtMoney(row.TotalContractValue)}</td><td class="num">${fmtMoney(row.ARRAtRisk)}</td><td class="num">${row.OpenCTAs}</td><td>${tapStatusPill({tapStatus:row.TapStatus})}</td><td>${row.EscalationStatus?statusPill(row.EscalationStatus):'<span class="pill p-gray">None</span>'}</td><td class="num">${row.LoggedActivityCount}</td></tr>`).join('')}
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
  return `<div class="card" style="box-shadow:none;border-style:dashed;margin:0 0 16px"><h3 style="border:none;margin:0 0 10px">Filter this view</h3>
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
  let html=`<div class="card"><h3>${esc(node.name)} <span class="hint">${esc(node.title||'')}</span></h3></div>`;
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
  ${accts.map(a=>`<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${fmtMoney(a.ltv)}</td><td class="num">${a.dclose>9000?'—':a.dclose+'d'}</td><td class="num">${a.openCases}${a.highCases?` <span class="pill p-red">${a.highCases}!</span>`:''}</td><td>${csatPill(a)}</td><td>${healthWithTier(a.health,a.tier)}</td><td>${opportunityPill(a)}</td></tr>`).join('')}
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
  return `<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td>${esc(st)}${late?' <span class="pill p-red">behind</span>':''}</td><td class="num">${a.dclose>9000?'—':a.dclose}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${fmtMoney(a.ltv)}</td><td class="num">${a.openCases}${a.highCases?` <span class="pill p-red">${a.highCases}!</span>`:''}</td><td>${csatPill(a)}</td><td>${readyPill(a.readiness)}</td><td class="num"><b>${fmtMoney(a.riskARR)}</b></td><td>${healthCell(a.health)}</td></tr>`;
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
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Escalation analytics</h3>
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
  const openedColor=chartHue('red'), resolvedColor=chartHue('green');
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
  return `<div class="card"><h3>Escalations tracker</h3>
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
      <summary><h3 style="display:inline;border:none;margin:0">Deal &amp; account discovery <span class="hint">${filled} of ${DISCOVERY_FIELDS.length} fields filled in</span></h3></summary>
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
function quarterLabel(qKey){ const [y,q]=(qKey||currentQuarter()).split('-Q'); return 'Q'+q+' '+y; }
// Success Plans run on the same quarterly cadence as the CSM-run customer
// surveys (surveyState/currentQuarter) - a plan "expires" into Pending again
// each new quarter unless it's fully complete, so the cycle keeps repeating
// rather than a plan generated once ever counting as done forever.
function planQuarterStatus(a,qKey){
  qKey=qKey||currentQuarter();
  const p=plans[a.id];
  if(!p) return 'pending';
  if(planProgress(p)===100) return 'completed';
  return p.quarter===qKey ? 'generated' : 'pending';
}
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
      {day:7,title:'Executive kickoff & welcome call',detail:'Open the relationship on the right foot: introduce the CS team, understand what success looks like to them, and set a cadence that keeps the conversation going.',resources:[{kind:'email',id:'cust_welcome'},{kind:'talktrack',id:'tt_kickoff'},{kind:'resource',id:'r1'}]},
      {day:14,title:'Map stakeholders & define success criteria',detail:'Get to know who matters on their side — economic buyer, admins, champions — and capture what success means to them, not just to us.',resources:[{kind:'resource',id:'r1'}]},
      {day:30,title:'Deployment & provisioning',detail:'Confirm hardware/software provisioned, Evidence.com configured, and integrations in place — a smooth deployment builds early trust.',resources:[{kind:'resource',id:'r4'}]},
      {day:45,title:'Admin & end-user training',detail:'Invest in their team\'s confidence with the product: schedule Axon Academy training and confirm admins are certified.',resources:[{kind:'resource',id:'r3'},{kind:'email',id:'cust_product'}]},
      {day:60,title:'Go-live / first adoption checkpoint',detail:'Check in on how it\'s actually landing with their team, review adoption together, and clear anything standing in the way.',resources:[{kind:'talktrack',id:'tt_adoption'}]},
      {day:90,title:'90-day value review & QBR',detail:'A relationship milestone, not just a status update — recap the value delivered and use it to deepen alignment on what\'s next.',resources:[{kind:'talktrack',id:'tt_qbr'},{kind:'email',id:'cust_followup'}]},
    ]},
  renewal:{ label:'Renewal', desc:'Drive an on-time, full-value renewal.',
    objectives:[
      'Secure an on-time, full-value renewal',
      'Quantify and present the value delivered',
      'Surface and de-risk any blockers early'
    ],
    milestones:[
      {day:7,title:'Renewal readiness review',detail:'Run the renewal readiness checklist so the actual renewal conversation can focus on value and the relationship, not scrambling on logistics.',resources:[{kind:'email',id:'int_renewal'}]},
      {day:14,title:'Build the value recap',detail:'Assemble usage, outcomes and support wins into a value recap that shows we\'ve been paying attention to their success.',resources:[{kind:'resource',id:'r5'},{kind:'talktrack',id:'tt_renewal'}]},
      {day:30,title:'Executive value conversation',detail:'A relationship conversation first, a renewal ask second: present the value recap and confirm budget/timeline together.',resources:[{kind:'email',id:'cust_renewal'},{kind:'talktrack',id:'tt_renewal'}]},
      {day:45,title:'Proposal & paperwork',detail:'Send the renewal proposal and align procurement and legal — keep it easy on their end.',resources:[{kind:'email',id:'int_renewal'},{kind:'resource',id:'r5'}]},
      {day:60,title:'Confirm renewal / next steps',detail:'Close the renewal, and use the moment to reaffirm the relationship heading into the next term.',resources:[{kind:'email',id:'int_renewal'}]},
    ]},
  tap:{ label:'TAP hardware refresh', desc:'Complete the 2.5-year hardware refresh cleanly.',
    objectives:[
      'Complete the hardware refresh before the warranty lapses',
      'Keep officers equipped with no downtime',
      'Use the refresh as a value & expansion touchpoint'
    ],
    milestones:[
      {day:7,title:'Confirm refresh eligibility & timeline',detail:'Verify contract dates and the units eligible for the TAP refresh — get ahead of it before it becomes a scramble for them.',resources:[{kind:'email',id:'int_tap'}]},
      {day:14,title:'Coordinate with the customer',detail:'Schedule the refresh conversation and set expectations on logistics — a proactive heads-up builds confidence going in.',resources:[{kind:'email',id:'cust_tap'},{kind:'talktrack',id:'tt_tap'}]},
      {day:30,title:'Align ops / fleet / logistics',detail:'Confirm shipping, provisioning and RMA of the old units so their officers never feel the transition.',resources:[{kind:'resource',id:'r2'}]},
      {day:45,title:'Execute the refresh',detail:'Ship/deploy the new hardware and confirm activation — check in during the process, not just at the end.',resources:[{kind:'resource',id:'r2'},{kind:'email',id:'cust_tap'}]},
      {day:60,title:'Confirm completion & capture value',detail:'Verify all units are refreshed, close the loop with the customer, and use the moment to talk about what\'s next for them.',resources:[{kind:'talktrack',id:'tt_qbr'}]},
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
  if(a.highCases>0 || (a.health!=null && a.health<60)) ms.push({id:uid(),title:'Resolve open support escalations',detail:'Clear high/urgent cases that block progress before the other milestones.',note:'',resources:[{kind:'email',id:'int_escalation'}],due:sfDate(new Date(base.getTime()+21*864e5)),done:false});
  ms.sort((x,y)=> x.due<y.due?-1:1);
  plans[id]={acctId:id,planType:type,quarter:currentQuarter(),created:new Date().toISOString(),updatedAt:new Date().toISOString(),objectives:tpl.objectives.slice(),milestones:ms,notes:'',discovery:{},auto:true};
  savePlans();
}
// A plan's milestones come from the account's Predictive Insight timeline -
// every entry point (this row action, Account 360's "Create Success Plan"
// button, etc.) enforces insight-first, not just the Success Plans list.
function createOrOpenPlan(id,type){
  if(!plans[id]){
    if(!predictiveInsightFor(id,currentQuarter())){ openPredictiveInsight(id); return; }
    generatePlan(id,type);
  }
  setTab('plans'); openPlan(id);
}
let plansKpiFilter=null; // null | 'generated' | 'pending' | 'completed' — set by clicking a KPI tile
function setPlansKpi(k){ plansKpiFilter = plansKpiFilter===k?null:k; route(); }
function setPlansYear(y){ setGlobalQYear(y); }
function setPlansQ(q){ setGlobalQQ(q); }
function viewPlans(accts){
  const sel=globalQSel||defaultQSel();
  const qKey=quarterKeyOf(sel);
  const isLive=qKey===currentQuarter();
  const statusOf=a=>planQuarterStatus(a,qKey);
  const generated=accts.filter(a=>statusOf(a)==='generated');
  const pending=accts.filter(a=>statusOf(a)==='pending');
  const completed=accts.filter(a=>statusOf(a)==='completed');
  const kpis=[
    ['Accounts in scope',accts.length,'all accounts',null],
    ['Plans generated',generated.length,sel.year+' Q'+sel.q+' cycle','generated'],
    ['Plans pending',pending.length,'not yet generated this cycle','pending'],
    ['Plans completed',completed.length,'all milestones done','completed'],
  ];
  let html=`<div class="card"><h3>Success Plans</h3>
  ${quarterToggleHtml(sel,'setPlansYear','setPlansQ')}
  <div class="kpis" style="margin-bottom:14px">${kpis.map(k=>`<div class="kpi clickable${k[3]&&plansKpiFilter===k[3]?' selected':''}" onclick="setPlansKpi(${k[3]?`'${k[3]}'`:'null'})"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  ${plansKpiFilter?`<p class="mini" style="margin:-6px 0 6px">Filtered to <b>${esc(plansKpiFilter)}</b> · <a href="#" onclick="setPlansKpi('${plansKpiFilter}');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear filter</a></p>`:''}
  ${!isLive?`<p class="mini" style="margin:6px 0 0">Viewing ${sel.year} Q${sel.q} — a past/future cycle. Generating a new plan or insight always applies to the live quarter (${quarterLabel(currentQuarter())}).</p>`:''}
  </div>`;

  let shown=accts;
  if(plansKpiFilter) shown=accts.filter(a=>statusOf(a)===plansKpiFilter);
  const sorted=[...shown].sort((a,b)=>a.name.localeCompare(b.name));
  html+=`<div class="card"><h3>All accounts <span class="hint">${sorted.length} of ${accts.length} shown</span></h3>
  <table><thead><tr><th>Account</th><th>Owner</th><th>Predictive insight</th><th>Plan status</th><th>Progress</th><th></th></tr></thead><tbody>
  ${sorted.map(a=>{
    const p=plans[a.id]; const prog=planProgress(p); const hasInsight=!!predictiveInsightFor(a.id,qKey);
    const st=statusOf(a);
    const stPill=st==='completed'?'<span class="pill p-green">Completed</span>':st==='generated'?'<span class="pill p-blue">Generated</span>':'<span class="pill p-gray">Pending</span>';
    const insightPill=hasInsight?'<span class="pill p-violet">Generated</span>':'<span class="pill p-gray">Not yet</span>';
    let action;
    if(!hasInsight) action=`<button class="btn sm" onclick="openPredictiveInsight('${a.id}')">Generate insights first</button>`;
    else if(!p) action=`<button class="btn primary sm" onclick="createOrOpenPlan('${a.id}')">Generate plan</button>`;
    else action=`<button class="btn sm" onclick="openPlan('${a.id}')">Open</button>`;
    return `<tr><td onclick="openAcct('${a.id}')" style="cursor:pointer"><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td>${insightPill}</td><td>${stPill}</td><td>${p?`<div class="progress" style="width:100px"><i style="width:${prog}%"></i></div><span class="mini">${prog}%</span>`:'—'}</td><td>${action}</td></tr>`;
  }).join('')}
  </tbody></table></div>`;
  html+=`<p class="mini" style="margin:2px 4px">A plan needs a Predictive Insight generated first — the timeline it proposes is what populates the plan's milestones.</p>`;
  return html;
}
// Full page (same pattern as Account 360/CTA chevron/Predictive Insight - a
// dedicated page with a "← Back" button, not a #sheet overlay), so a Success
// Plan is somewhere you navigate to and work in, not a half-screen drawer.
let currentPlanAcctId = null;
function openPlan(id){
  if(!plans[id]) generatePlan(id);
  currentAcctView=null; currentEngagementCtaId=null; currentCsmView=null; currentPredictiveAcctId=null; currentPlanMilestone=null;
  currentPlanAcctId=id;
  route();
  window.scrollTo(0,0);
}
function closePlan(){ currentPlanAcctId=null; route(); window.scrollTo(0,0); }
function renderPlanPage(){
  const p=plans[currentPlanAcctId]; const a=STATE.accounts.find(x=>x.id===currentPlanAcctId);
  if(!p||!a){ currentPlanAcctId=null; route(); return; }
  $('#scopebar').style.display='none';
  $('#app').innerHTML=planPageHtml(currentPlanAcctId,p,a);
}
function planPageHtml(id,p,a){
  const prog=planProgress(p);
  return `<div class="card acct-hd"><div class="hd"><div><h2><span style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="openAcct('${id}')">${esc(a.name)}</span> ${stateTag(a)}</h2>
    <div class="mini" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">Success Plan · Owner ${ownerCell(a.ownerName)} · ${newLogo(a)?'New logo · first purchase '+esc(a.firstPurchase||''):'Established account'} · Renewal ${a.dclose>9000?'—':'in '+a.dclose+'d'}</div></div>
    <button class="btn sm" onclick="closePlan()">← Back</button></div></div>
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
    ${msTimelineHtml(p)}
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
}
// Horizontal timeline view of a plan's milestones - a bubble per milestone,
// alternating above/below a date axis. Blue = the milestone carries an
// attached escalation/CTA (clicking jumps into the account's actual live
// engagement record - this is always the FIRST step when the account has an
// active risk signal), red = an attached email template (clicking jumps
// straight into that draft), black = anything else (clicking opens the
// plain step-detail drawer). This is the forward-looking view Predictive
// Insights populates into a plan; the vertical checklist below it remains
// the editable source of truth.
function msTlNodeKind(m){
  const rs=m.resources||[];
  if(rs.some(r=>r.kind==='engagement')) return 'engagement';
  if(rs.some(r=>r.kind==='email')) return 'email';
  return null;
}
// Status overrides the resource-kind color the moment there's real movement:
// black/red/blue (msTlNodeKind) describes what a NOT-YET-ACTED-ON step
// implies doing; once the email actually goes out it turns amber ("pending"
// - sent, awaiting the outcome), and once the milestone is marked done it
// turns green ("resolved") - same red/yellow/green progression an escalation
// or CTA already shows elsewhere, just driven by the plan's own send/done
// state instead of a separate trigger record.
function msTlStatusClass(m){
  if(m.done) return 'ms-resolved';
  if(m.emailDraft && m.emailDraft.sent) return 'ms-pending';
  return null;
}
function msTimelineHtml(p){
  if(!p.milestones.length) return '';
  const ms=[...p.milestones].sort((x,y)=>(x.due||'9999')<(y.due||'9999')?-1:1);
  const items=ms.map((m,i)=>{
    const pos=i%2===0?'above':'below';
    const kind=msTlNodeKind(m);
    const statusCls=msTlStatusClass(m);
    const colorCls=statusCls||kind;
    const cls=(colorCls?' '+colorCls:'')+(m.done?' done':'');
    const title=statusCls==='ms-resolved'?'Resolved':statusCls==='ms-pending'?'Pending — email sent, awaiting outcome':kind==='engagement'?'Opens the account\'s active escalation/CTA':kind==='email'?'Opens an email draft':'Opens step details';
    return `<div class="ms-tl-item ${pos}">
      <div class="ms-tl-box${cls}" onclick="openPlanMilestoneNode('${p.acctId}','${m.id}')" title="${title}">${m.source==='predictive'?'<span class="pill p-violet" style="margin-right:4px;font-size:10px">Predictive</span>':''}${esc(m.title)}</div>
      <div class="ms-tl-stem${colorCls?' '+colorCls:''}"></div>
      <div class="ms-tl-dot${cls}" onclick="openPlanMilestoneNode('${p.acctId}','${m.id}')"></div>
      <div class="ms-tl-date">${m.due?esc(fmtDate(m.due)):'no date'}</div>
    </div>`;
  }).join('');
  return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Timeline <span class="hint">blue = active escalation/CTA, red = email draft, amber = sent/pending, green = resolved · violet tag = from a Predictive Insight</span></h3>
    <div class="ms-timeline">${items}</div>
  </div>`;
}
// Where a forward-looking timeline node actually takes you - a milestone
// carrying an attached escalation/CTA jumps straight to that live record
// (that IS the step); everything else (email-carrying or plain) opens a
// full-page step detail - same chevron-like pattern as an engagement CTA,
// including a real inline draft-email card, not a trip to Email Outreach.
function openPlanMilestoneNode(acctId,mid){
  const p=plans[acctId]; if(!p) return;
  const m=p.milestones.find(x=>x.id===mid); if(!m) return;
  const engRes=(m.resources||[]).find(r=>r.kind==='engagement');
  if(engRes){ viewEngagementForAccount(engRes.id); return; }
  openPlanMilestonePage(acctId,mid);
}
function msRow(id,m){
  const rc=(m.resources||[]).length;
  return `<div class="milestone${m.done?' done':''}" data-ms="${m.id}">
    <input type="checkbox" ${m.done?'checked':''} onchange="togglePlanMs('${id}','${m.id}',this.checked)">
    ${m.source==='predictive'?'<span class="pill p-violet" style="font-size:10px">Predictive</span>':''}
    <input type="text" value="${esc(m.title)}" onchange="editPlanMsTitle('${id}','${m.id}',this.value)">
    <input type="date" value="${esc(m.due||'')}" onchange="editPlanMsDue('${id}','${m.id}',this.value)">
    <button class="btn sm" onclick="openPlanMilestoneNode('${id}','${m.id}')">Open${rc?` · ${rc}`:''}</button>
    <button class="btn sm" onclick="removePlanMs('${id}','${m.id}')">Remove</button>
  </div>`;
}
// ---- Plan milestone detail (click into a milestone) - full page, same
// pattern as the CTA chevron/Account 360/Predictive Insight ----
const STEP_RES_KINDS={email:'Email template',talktrack:'Talk track',resource:'Resource'};
function resourceById(rid){ return resources.find(r=>r.id===rid); }
function stepResLabel(r){
  if(r.kind==='email'){ const t=EMAIL_TEMPLATES.find(x=>x.id===r.id); return t?t.name:'Email template'; }
  if(r.kind==='talktrack'){ const t=talkTrackById(r.id); return t?t.title:'Talk track'; }
  const res=resourceById(r.id); return res?res.title:'Resource';
}
function planMilestoneEmailResource(m){ return (m.resources||[]).find(r=>r.kind==='email'); }
let currentPlanMilestone = null; // {acctId, mid}
function openPlanMilestonePage(acctId,mid){
  const p=plans[acctId]; if(!p) return;
  const m=p.milestones.find(x=>x.id===mid); if(!m) return;
  m.resources=m.resources||[];
  currentAcctView=null; currentEngagementCtaId=null; currentCsmView=null; currentPredictiveAcctId=null;
  currentPlanAcctId=acctId;
  currentPlanMilestone={acctId,mid};
  // Lazily seed a real, unsent draft the first time this step's page opens
  // (if it carries an email template) - same "prefilled, not blank" pattern
  // the CTA chevron and risk-board actions already use, so there's something
  // real to review/send right here instead of a trip to Email Outreach.
  const emailRes=planMilestoneEmailResource(m);
  if(emailRes && !m.emailDraft){
    const draft=buildEmailDraft(emailRes.id,acctId);
    m.emailDraft={subject:draft?draft.subject:'',body:draft?draft.body:'',recipient:draft?draft.to:'',sent:false,sentAt:null};
    touchPlan(acctId);
  }
  route();
  window.scrollTo(0,0);
}
function closePlanMilestone(){ currentPlanMilestone=null; route(); window.scrollTo(0,0); }
function renderPlanMilestonePage(){
  const {acctId,mid}=currentPlanMilestone||{};
  const p=plans[acctId]; const a=STATE.accounts.find(x=>x.id===acctId);
  const m=p&&p.milestones.find(x=>x.id===mid);
  if(!p||!a||!m){ currentPlanMilestone=null; route(); return; }
  $('#scopebar').style.display='none';
  $('#app').innerHTML=planMilestonePageHtml(acctId,p,a,m);
}
function planMilestonePageHtml(acctId,p,a,m){
  const overdue=!m.done && daysSince(m.due)!=null && daysSince(m.due)>0;
  const emailRes=planMilestoneEmailResource(m);
  const resRows=m.resources.length?m.resources.map((r,i)=>{
    let action='';
    if(r.kind==='talktrack') action=`<button class="btn sm" onclick="openTalkTrack('${r.id}','${acctId}','${m.id}')">Open talk track</button>`;
    else if(r.kind==='resource'){ const res=resourceById(r.id); action=res?`<a class="btn sm" href="${esc(res.url)}" target="_blank" rel="noopener">Open</a>`:'<span class="mini">missing</span>'; }
    return `<div class="resrow"><span><span class="pill p-gray" style="margin-right:8px">${esc(STEP_RES_KINDS[r.kind]||r.kind)}</span><b>${esc(stepResLabel(r))}</b></span><span class="row-actions">${action}<button class="btn sm" onclick="removeStepResource('${acctId}','${m.id}',${i})">✕</button></span></div>`;
  }).join(''):'<p class="mini">No resources attached yet — add an email template, talk track or resource below.</p>';
  return `<div class="card acct-hd"><div class="hd"><div><h2>${esc(m.title)} ${m.source==='predictive'?'<span class="pill p-violet">Predictive</span>':''}</h2>
    <div class="mini">Success plan step · <span style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="openPlan('${acctId}')">${esc(a.name)}</span> · <span class="pill ${m.done?'p-green':overdue?'p-red':'p-amber'}">${m.done?'Complete':overdue?'Overdue':(m.due?'Due '+esc(m.due):'Open')}</span></div></div>
    <button class="btn sm" onclick="openPlan('${acctId}')">← Back to plan</button></div></div>
  <div class="bd">
    ${emailRes && m.emailDraft && !m.emailDraft.sent?`<div class="card" style="box-shadow:none;margin:0 0 16px;border:1px solid var(--red)">
      <h4 style="margin:0 0 8px">Draft email — ${esc(stepResLabel(emailRes))}</h4>
      <div style="display:flex;flex-direction:column;gap:6px">
        <input type="text" id="msDraftTo_${m.id}" class="select" value="${esc(m.emailDraft.recipient||'')}" placeholder="Recipient">
        <input type="text" id="msDraftSubject_${m.id}" class="select" value="${esc(m.emailDraft.subject||'')}" placeholder="Subject">
        <textarea id="msDraftBody_${m.id}" class="select" rows="8" style="font:inherit">${esc(m.emailDraft.body||'')}</textarea>
      </div>
      <div class="row-actions" style="margin-top:10px">
        <button type="button" class="btn sm primary" onclick="sendPlanMilestoneEmail('${acctId}','${m.id}')">Send</button>
        ${TEST10_ACCOUNTS.includes(a.name)?`<button type="button" class="btn sm" id="aiDraftBtn_ms_${m.id}" onclick="requestAiDraftForPlanMilestone('${acctId}','${m.id}')">Create AI draft</button>`:''}
      </div>
      <div id="aiDraftStatus_ms_${m.id}" class="mini" style="margin-top:6px;color:var(--muted2)"></div>
    </div>`:''}
    ${emailRes && m.emailDraft && m.emailDraft.sent?`<div class="card" style="box-shadow:none;margin:0 0 16px;background:var(--panel2);opacity:.85">
      <h4 style="margin:0 0 6px">Email sent</h4>
      <p class="mini">Sent ${esc(fmtDate(m.emailDraft.sentAt))} to ${esc(m.emailDraft.recipient||'—')} — "${esc(m.emailDraft.subject||'')}"</p>
    </div>`:''}
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Step details</h3>
      <div class="row-actions" style="margin-bottom:10px">
        <button class="btn ${m.done?'':'primary'}" onclick="togglePlanStepDone('${acctId}','${m.id}',${!m.done})">${m.done?'Mark not done':'Mark done'}</button>
      </div>
      <label class="mini" style="font-weight:700;color:var(--ink);display:block;margin:8px 0 4px">Title</label>
      <input type="text" value="${esc(m.title)}" onchange="editPlanMsTitle('${acctId}','${m.id}',this.value)" style="width:100%;border:1px solid var(--line);padding:8px 10px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
      <label class="mini" style="font-weight:700;color:var(--ink);display:block;margin:12px 0 4px">Due</label>
      <input type="date" value="${esc(m.due||'')}" onchange="editPlanMsDue('${acctId}','${m.id}',this.value)" style="border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink);color-scheme:dark">
      <label class="mini" style="font-weight:700;color:var(--ink);display:block;margin:12px 0 4px">Guidance</label>
      <textarea class="notes-in" style="min-height:60px" placeholder="What this step involves…" oninput="setStepDetail('${acctId}','${m.id}',this.value)">${esc(m.detail||'')}</textarea>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Resources for this step</h3>
      <div class="reslist">${resRows}</div>
      <div class="row-actions" style="margin-top:12px;flex-wrap:wrap;align-items:center">
        <select class="select" id="stepResPick">
          <optgroup label="Email templates">${EMAIL_TEMPLATES.map(t=>`<option value="email:${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>
          <optgroup label="Talk tracks">${TALK_TRACKS.map(t=>`<option value="talktrack:${t.id}">${esc(t.title)}</option>`).join('')}</optgroup>
          <optgroup label="Resource library">${resources.map(r=>`<option value="resource:${r.id}">${esc(r.title)}</option>`).join('')}</optgroup>
        </select>
        <button class="btn primary sm" onclick="addStepResourceFromPicker('${acctId}','${m.id}')">Attach</button>
      </div>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Step notes <span class="hint">what happened / what's next on this step</span></h3>
      <textarea class="notes-in" placeholder="Progress, blockers, who owns the next action…" oninput="setStepNote('${acctId}','${m.id}',this.value)">${esc(m.note||'')}</textarea>
    </div>
  </div>`;
}
function setStepDetail(id,mid,v){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m){ m.detail=v; touchPlan(id); } }
function setStepNote(id,mid,v){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m){ m.note=v; touchPlan(id); } }
function togglePlanStepDone(id,mid,done){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m){ m.done=done; touchPlan(id); route(); } }
function addStepResource(id,mid,kind,refId){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(!m)return; m.resources=m.resources||[]; if(m.resources.some(r=>r.kind===kind&&r.id===refId)){ toast('Already attached to this step.'); return; } m.resources.push({kind,id:refId}); touchPlan(id); route(); }
function addStepResourceFromPicker(id,mid){ const sel=document.getElementById('stepResPick'); if(!sel||!sel.value) return; const [kind,refId]=sel.value.split(':'); addStepResource(id,mid,kind,refId); }
function removeStepResource(id,mid,idx){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(!m||!m.resources)return; m.resources.splice(idx,1); touchPlan(id); route(); }
// Real send, right from the milestone page - same logging pattern every
// other send in the app uses (emailDrafts entry so Customer Contact Insights
// picks it up, activity touch, health rescore), tagged 'journey' so it also
// surfaces on the Customer Success Emails tab.
function sendPlanMilestoneEmail(acctId,mid){
  const p=plans[acctId]; if(!p) return;
  const m=p.milestones.find(x=>x.id===mid); if(!m||!m.emailDraft) return;
  const subjEl=$('#msDraftSubject_'+mid), bodyEl=$('#msDraftBody_'+mid), toEl=$('#msDraftTo_'+mid);
  if(subjEl) m.emailDraft.subject=subjEl.value;
  if(bodyEl) m.emailDraft.body=bodyEl.value;
  if(toEl) m.emailDraft.recipient=toEl.value;
  if(!(m.emailDraft.subject||'').trim() || !(m.emailDraft.body||'').trim()){ toast('Add a subject and message body before sending.'); return; }
  m.emailDraft.sent=true; m.emailDraft.sentAt=new Date().toISOString();
  touchPlan(acctId);
  const a=STATE.accounts.find(x=>x.id===acctId);
  sendTest10DemoEmail(acctId,m.emailDraft.subject,m.emailDraft.body);
  emailDrafts.unshift({id:cid(),t:new Date().toISOString(),action:'sent',templateId:'plan_'+(planMilestoneEmailResource(m)||{}).id,templateName:'Success Plan — '+m.title,audience:'customer',acctId,acctName:a?a.name:'',subject:m.emailDraft.subject,to:m.emailDraft.recipient,snippet:emailSnippet(m.emailDraft.body),source:'journey',stage:m.title});
  emailDrafts=emailDrafts.slice(0,40); saveEmailDrafts();
  if(a){
    pushActivityEntry(acctId,'Email',m.emailDraft.subject||'(sent)','Sent via Success Plan milestone.');
    syncLastActFromActivity(acctId);
    try{ scoreAccount(a); }catch(e){}
  }
  toast('Sent — see Customer Contact Insights for the record.');
  route();
}
function requestAiDraftForPlanMilestone(acctId,mid){
  const p=plans[acctId]; if(!p) return; const m=p.milestones.find(x=>x.id===mid); if(!m) return;
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a||!TEST10_ACCOUNTS.includes(a.name)) return;
  requestAiDraft('plan_'+acctId+'_'+mid,a.name,'journey','Success Plan milestone: '+(m.title||'')+(m.detail?' — '+m.detail:''),
    {subject:'msDraftSubject_'+mid,body:'msDraftBody_'+mid,to:'msDraftTo_'+mid},'aiDraftBtn_ms_'+mid,'aiDraftStatus_ms_'+mid);
}
function openTalkTrack(ttId,backId,backMid){
  const t=talkTrackById(ttId); if(!t){ toast('Talk track not found.'); return; }
  const sheet=$('#sheet');
  const back=backId?`<button class="btn" onclick="closeSheet();openPlanMilestonePage('${backId}','${backMid}')">← Back to step</button>`:`<button class="btn" onclick="closeSheet()">Close</button>`;
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
function togglePlanMs(id,mid,done){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m)m.done=done; touchPlan(id); route(); }
function editPlanMsTitle(id,mid,v){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m)m.title=v; touchPlan(id); }
function editPlanMsDue(id,mid,v){ const p=plans[id];if(!p)return; const m=p.milestones.find(x=>x.id===mid); if(m)m.due=v; touchPlan(id); route(); }
function addPlanMs(id){ const p=plans[id];if(!p)return; p.milestones.push({id:'m'+Math.random().toString(36).slice(2,9),title:'New milestone',due:sfDate(new Date(Date.now()+14*864e5)),done:false}); touchPlan(id); route(); }
function removePlanMs(id,mid){ const p=plans[id];if(!p)return; p.milestones=p.milestones.filter(x=>x.id!==mid); touchPlan(id); route(); }
function regenPlan(id){ if(!confirm('Regenerate this plan from the template? Your edits to milestones, objectives and notes will be replaced.')) return; delete plans[id]; generatePlan(id); openPlan(id); toast('Plan regenerated from template.'); }
function delPlan(id){ if(!confirm('Delete this success plan? This cannot be undone.')) return; delete plans[id]; savePlans(); closePlan(); }

// ---- Worklist ----
function viewWork(accts){
  const items=[];
  const byId={}; accts.forEach(a=>byId[a.id]=a);
  // Every account-level signal that used to be computed here ad hoc
  // (renewal timing, open case counts, sentiment, save plays, onboarding
  // without a plan) now fires as a real trigger through evaluateRiskTriggers
  // and lands in engagementCtas like everything else - same record
  // Escalations/Active CTAs themselves read, so this is a genuinely combined
  // worklist, not a second parallel copy of the same conditions. Clicking a
  // row opens the actual CTA/escalation detail page directly, not just the
  // account.
  engagementCtasFor(accts).filter(ceIsOpenOrInProgress).forEach(c=>{
    const a=byId[c.accountId]; if(!a) return;
    const days=ceDaysOpen(c);
    const isEsc=c.category==='escalation';
    const reason=RISK_TRIGGER_LABELS[c.originatingTriggerType]||'Manually opened';
    const tag=isEsc?'Escalation':(CTA_CATEGORY_LABELS[c.category]||'CTA');
    items.push({
      p:isEsc?1:2, a, ctaId:c.id, tag,
      label:`${reason} — ${days}d open`,
      bucket:days>=14?'overdue':(days<=1?'new':'upcoming')
    });
  });
  // "Next step" now comes from Success Plan milestones (the plan itself is
  // the one real place a next step is tracked, since the old free-text
  // activity next-step field has no input surface left) - the earliest open
  // milestone per plan, overdue if its date has passed.
  Object.keys(plans).forEach(acctId=>{
    const a=byId[acctId]; if(!a) return;
    const p=plans[acctId];
    const open=(p.milestones||[]).filter(m=>!m.done).sort((x,y)=>(x.due||'9999')<(y.due||'9999')?-1:1);
    const next=open[0]; if(!next) return;
    const overdueDays=next.due?daysSince(next.due):null;
    const isOverdue=overdueDays!=null && overdueDays>0;
    items.push({
      p:isOverdue?1:2, a, planId:acctId, tag:isOverdue?'Next step overdue':'Next step',
      label:`${next.title}${next.due?` (due ${next.due})`:''}`,
      bucket:isOverdue?'overdue':'upcoming'
    });
  });
  items.sort((x,y)=> x.p-y.p || y.a.riskARR-x.a.riskARR);
  const overdue=items.filter(it=>it.bucket==='overdue');
  const freshItems=items.filter(it=>it.bucket==='new');
  const upcoming=items.filter(it=>it.bucket==='upcoming');
  const rows=list=>`<table><thead><tr><th>Priority action</th><th>Account</th><th>Owner</th><th class="num">Total Contract Value</th><th>Health</th></tr></thead><tbody>
    ${list.slice(0,50).map(it=>`<tr onclick="${it.ctaId?`openEngagementCta('${it.ctaId}')`:it.planId?`openPlan('${it.planId}')`:`openAcct('${it.a.id}')`}"><td><span class="pill ${it.p<=2?'p-red':it.p===3?'p-amber':'p-gray'}">${esc(it.tag)}</span> ${esc(it.label)}</td><td><b>${esc(it.a.name)}</b> ${stateTag(it.a)}</td><td>${ownerCell(it.a.ownerName)}</td><td class="num">${fmtMoney(it.a.renewalAmount)}</td><td>${healthCell(it.a.health)}</td></tr>`).join('')}
    </tbody></table>`;
  const section=(title,list)=> list.length?`<h3 style="margin-top:18px">${esc(title)}</h3>${rows(list)}`:'';
  return `<div class="card"><h3>Prioritized worklist <span class="hint">${items.length} actions across scope</span></h3>
  <div class="kpis" style="margin-bottom:4px">
    <div class="kpi"><div class="l">Overdue</div><div class="v" style="color:var(--red)">${overdue.length}</div></div>
    <div class="kpi"><div class="l">New</div><div class="v" style="color:var(--amber)">${freshItems.length}</div></div>
    <div class="kpi"><div class="l">Upcoming</div><div class="v">${upcoming.length}</div></div>
  </div>
  ${section('Overdue',overdue)}
  ${section('New',freshItems)}
  ${section('Upcoming',upcoming)}
  ${items.length?'':'<p class="mini">Clear queue — nothing urgent in this scope.</p>'}</div>`;
}

// ---- Object integrations reference ----
// A literal audit of every SOQL query in this app (see load(), loadAcctIntel,
// evaluateRiskTriggers' data sources) - not a marketing list of "what we
// could integrate," but what actually gets queried and where it shows up.
// Grouped by nav icon section, plus a "Foundational" bucket for the two
// objects (Account, User) that underpin literally every account list, and
// an Account 360 bucket for fields only ever shown on the account detail
// page rather than on any of the icon-rail sections themselves.
// Every one of the 13 trigger types evaluateRiskTriggers can fire, and
// exactly what real (or app-internal) data source causes it - the direct
// answer to "how does Salesforce data become a visible Escalation/CTA,"
// which the object-by-nav-section breakdown below only answered
// inconsistently (naming some triggers, not others). Two triggers
// (escalation_opened, onboarding_stall/onboarding_no_plan) are honestly
// flagged as app-internal rather than Salesforce-sourced, since that's what
// they actually are today.
const TRIGGER_SOURCES={
  case_blocked:{object:'Case',field:"Status='Blocked' on open cases"},
  case_aging:{object:'Case',field:'IsAging__c on open cases'},
  nps_csat_drop:{object:'Account',field:'NPS_Score__c < 9'},
  escalation_opened:{object:'App-internal',field:'Started by hand (Account 360 / demo) — not Salesforce-sourced'},
  usage_drop:{object:'ProductUsage__c',field:'AdoptionPct__c below the configured target'},
  onboarding_stall:{object:'App-internal + Opportunity',field:'Success Plan milestone overdue vs. Opportunity first-purchase date'},
  onboarding_no_plan:{object:'App-internal + Opportunity',field:'New logo (first-purchase Opportunity) with no plan created yet'},
  renewal_prep_stale:{object:'Opportunity + Account (+ Contract)',field:'CloseDate approaching while Account.LastActivityDate is stale — uses Contract EndDate minus Notice Period for "days to renewal" where a Contract record is present, else falls back to Opportunity CloseDate; Contract isn\'t yet a live query (demo-modeled only)'},
  renewal_stage_behind:{object:'Opportunity',field:'StageName still early relative to CloseDate'},
  growth_mix_stalled:{object:'Opportunity',field:'GrowthType__c — Expansion/Transactional share of lifetime value'},
  tap_refresh_due:{object:'OpportunityLineItem',field:'Hardware Family__c CloseDate + 2.5yr warranty mark'},
  cadence_gap:{object:'Account',field:'LastActivityDate vs. segment-expected cadence'},
  negative_sentiment:{object:'Case',field:'Priority/IsEscalated lifetime rate — a derived proxy, not a true Salesforce sentiment field'},
  case_volume_spike:{object:'Case',field:`Open case COUNT >= ${RISK_CASE_VOLUME_SPIKE_THRESHOLD} (same query as case_blocked/case_aging, measuring volume instead of age/SLA)`},
  no_exec_sponsor:{object:'Contact',field:'No contact with an Executive Sponsor role/persona — not yet a live query; no confirmed persona field on Contact in the org, demo-modeled only'},
  qbr_overdue:{object:'Event',field:'Days since last QBR meeting past due — not yet a live query; no confirmed QBR-tracking field in the org, demo-modeled only'},
};
function triggerSourcesTableHtml(){
  const rows=Object.keys(RISK_TRIGGER_LABELS).map(k=>{
    const cust=customTriggerDef(k);
    const src=TRIGGER_SOURCES[k]||(cust&&cust.sourceObject?{object:cust.sourceObject,field:cust.sourceField||'—'}:{object:'—',field:'—'});
    const cat=CTA_CATEGORY_BY_TRIGGER[k];
    const routesTo=cat==='escalation'?'Escalation':(CTA_CATEGORY_LABELS[cat]||'—')+' CTA';
    return `<tr><td><b>${esc(RISK_TRIGGER_LABELS[k])}</b></td><td>${esc(src.object)}</td><td class="mini">${esc(src.field)}</td><td><span class="pill ${cat==='escalation'?'p-red':'p-gray'}">${esc(routesTo)}</span></td></tr>`;
  }).join('');
  return `<div class="card"><h3>Trigger sources</h3>
    <table><thead><tr><th>Trigger</th><th>Source object</th><th>Field / condition</th><th>Routes to</th></tr></thead><tbody>${rows}</tbody></table>
  </div>`;
}
function objectIntegrationsHtml(){
  const catIcon=id=>{ const c=NAV_CATEGORIES.find(x=>x.id===id); return c?c.icon:''; };
  const catLabel=id=>{ const c=NAV_CATEGORIES.find(x=>x.id===id); return c?c.label:id; };
  const objRow=o=>`<div class="mini" style="margin-bottom:8px"><b>${esc(o.name)}</b> <span style="color:var(--muted2)">— ${esc(o.fields)}</span><br>${esc(o.note)}</div>`;
  const foundational=[
    {name:'Account',fields:'Name, BillingState, Segment, LastActivityDate, OwnerId',note:'The core account record every list and detail page in the app is keyed off.'},
    {name:'Account',fields:'Industry, EmployeeCount',note:'Shown on Account 360 for context (industry, company size) — not yet a live query; demo-derived, pending confirmation these fields are populated in the org.'},
    {name:'Opportunity',fields:'Amount, CloseDate, StageName, AccountId, OwnerId',note:'The open renewal pipeline — every account\'s renewal timing, stage, and Total Contract Value comes from here.'},
    {name:'User',fields:'Name, Title, ManagerId',note:'Owner attribution (every "Owner" column/avatar) and the org hierarchy walk behind CSM scoping.'},
    {name:'Contract',fields:'EndDate, Notice Period',note:'Sharpens renewal-prep timing to a real "days to renewal" calc where present — not yet a live query; demo-modeled only, falls back to Opportunity CloseDate otherwise.'},
    {name:'Contact',fields:'Executive Sponsor persona/role',note:'Feeds the no_exec_sponsor risk trigger — not yet a live query; demo-modeled only.'},
    {name:'Event',fields:'QBR meeting date',note:'Feeds the qbr_overdue risk trigger — not yet a live query; demo-modeled only.'},
  ];
  const sections=[
    ['pulse',[
      {name:'Account',fields:'NPS_Score__c, SurveyDate__c',note:'Biannual NPS survey score and date, per account.'},
      {name:'ProductUsage__c',fields:'AdoptionPct__c, SeatsLicensed__c, SeatsActive__c, UsageTrendPct__c, CommissionTarget__c, CommissionAttained__c, LastUsageSync__c',note:'Product-analytics export (Snowflake/Sigma, not native Salesforce) — the only thing powering Usage & Adoption.'},
    ]],
    ['risk',[
      {name:'Case',fields:"Priority, IsEscalated, Status='Blocked', IsAging__c, open COUNT",note:'Drives the case_blocked/case_aging/case_volume_spike escalation triggers and the health score\'s case penalty.'},
      {name:'Opportunity',fields:'GrowthType__c (won deals)',note:'Feeds the growth_mix_stalled trigger.'},
      {name:'OpportunityLineItem',fields:'Family__c (hardware families), CloseDate',note:'TAP hardware-refresh due-date calculation.'},
      {name:'ProductUsage__c',fields:'AdoptionPct__c',note:'Feeds the usage_drop trigger.'},
    ]],
    ['engagement',[
      {name:'Case',fields:'Priority, IsEscalated',note:'Same case signals, surfaced on the Escalation checklist once case_blocked/case_aging fires.'},
    ]],
    ['cockpit',[
      {name:'Opportunity',fields:'Amount, CloseDate, StageName',note:'Top risk-weighted accounts and renewal readiness on Command Center.'},
    ]],
    ['performance',[
      {name:'Opportunity',fields:'GrowthType__c, Amount (won)',note:'CSM growth metrics — organic/renewal, expansion, transactional.'},
      {name:'User',fields:'ManagerId chain',note:'Org hierarchy walk behind each CSM\'s profile page.'},
    ]],
  ];
  const acct360=[
    {name:'Opportunity',fields:'Amount, CloseDate, StageName (won deals)',note:'Purchase history & lifetime value card.'},
    {name:'OpportunityLineItem',fields:'Product2.Family, Product2.Name, TotalPrice, Quantity',note:'Products purchased card.'},
    {name:'Case',fields:'Priority, IsEscalated (lifetime counts)',note:'Customer sentiment card — a derived proxy, not a true Salesforce sentiment field.'},
  ];
  const plainField=label=>`<div class="disco-field">
        <label class="mini" style="font-weight:700;color:var(--ink);display:block;margin-bottom:6px">${esc(label)}</label>
        ${(label==='Foundational'?foundational:acct360).map(objRow).join('')}
      </div>`;
  return `<div class="card"><h3>Object integrations</h3>
    <div class="disco-grid">
      ${plainField('Foundational')}
      ${sections.map(([catId,objs])=>`<div class="disco-field">
        <label class="mini" style="font-weight:700;color:var(--ink);display:flex;align-items:center;gap:6px;margin-bottom:6px"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${catIcon(catId)}</svg>${esc(catLabel(catId))}</label>
        ${objs.map(objRow).join('')}
      </div>`).join('')}
      ${plainField('Account 360')}
    </div>
  </div>`;
}
// ---- Health model ----
function viewModel(accts){
  const sl=(k,l,max)=>`<div class="slider"><label>${l}</label><input type="range" min="0" max="${max}" step="1" value="${WEIGHTS[k]}" oninput="setWeight('${k}',this.value,this)"><span id="w_${k}">${WEIGHTS[k]}</span></div>`;
  const r=rollup(accts);
  return `${orgConfigSlotSwitcherHtml()}
  ${orgConfigChatHtml()}
  <div class="card"><h3>Health-score model <span class="sortbar">${ceTest10ToggleHtml()}</span></h3>
  <p class="mini" style="margin:-4px 0 8px">CS Ops owns this — adjust weights and the whole book re-scores instantly.</p>
  <p class="mini">Every account starts at 100. These penalties subtract from it based on live signals. This transparency is the point: the score is never a black box.</p>
  ${sl('openCase','Per open case',5)}
  ${sl('highSev','Per high/urgent case',15)}
  ${sl('proxNear','Renewal ≤90 days',40)}
  ${sl('proxMid','Renewal ≤180 days',30)}
  ${sl('stageRisk','Near renewal, early stage',30)}
  ${sl('engage','Stale engagement (no touch 90d+)',30)}
  <div style="margin-top:14px" class="row-actions"><button class="btn primary" onclick="saveWeights()">Save model</button><button class="btn" onclick="resetWeights()">Reset defaults</button></div>
  <p class="mini" style="margin-top:14px">Current scope re-scored: <b>${r.green}</b> healthy · <b>${r.amber}</b> watch · <b>${r.red}</b> at risk · avg <b>${r.health==null?'—':r.health}</b>.</p>
  <p class="mini" style="margin-top:10px;color:var(--muted)">Note: sentiment and CSAT are computed separately and are not affected by these health weights.</p>
  </div>
  <div class="card"><h3>Adoption thresholds</h3>
    <div class="row-actions" style="margin-top:8px;flex-wrap:wrap;gap:14px">
      <label class="mini">"Adopting" at/above %<br><input type="number" min="0" max="100" value="${adoptionCfg.adoptingPct}" style="width:80px;margin-top:4px;border:1px solid var(--line);padding:6px 8px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setAdoptionCfg('adoptingPct',this.value)"></label>
      <label class="mini">"Not adopting" below %<br><input type="number" min="0" max="100" value="${adoptionCfg.atRiskPct}" style="width:80px;margin-top:4px;border:1px solid var(--line);padding:6px 8px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setAdoptionCfg('atRiskPct',this.value)"></label>
    </div>
  </div>
  ${riskWeightsPanelHtml()}
  ${triggerSourcesTableHtml()}
  ${objectIntegrationsHtml()}`;
}
function setWeight(k,v,el){ WEIGHTS[k]=+v; document.getElementById('w_'+k).textContent=v; computeAll(); const p=el.closest('.card').querySelectorAll('.mini'); const r=rollup(riskTest10?STATE.accounts.filter(a=>TEST10_ACCOUNTS.includes(a.name)):accountsUnder(STATE.scope)); if(p.length) p[p.length-2].innerHTML=`Current scope re-scored: <b>${r.green}</b> healthy · <b>${r.amber}</b> watch · <b>${r.red}</b> at risk · avg <b>${r.health==null?'—':r.health}</b>.`; }
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
function openCsmDrilldown(name){ openCsmProfile(name); }
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
// Full-page CSM profile - same "opens into its own page you navigate to, not
// a modal" pattern as openAcct/renderAcctPage, just for a CSM instead of an
// account. Reuses every metric already computed for the old scorecard-modal
// (csmMetrics/csmImproveSteps/csmStaleWork) so this is the same underlying
// data, just given a real page instead of a drawer, plus the CSM's own book
// of accounts underneath so it reads as a genuine profile, not just a report.
function openCsmProfile(name){ currentAcctView=null; currentEngagementCtaId=null; currentPredictiveAcctId=null; currentPlanAcctId=null; currentPlanMilestone=null; currentCsmView=name; route(); window.scrollTo(0,0); }
function closeCsmProfile(){ currentCsmView=null; route(); window.scrollTo(0,0); }
function renderCsmProfilePage(){
  $('#scopebar').style.display='none';
  $('#app').innerHTML=csmProfilePageHtml(currentCsmView);
}
function csmProfilePageHtml(name){
  const allAccts=STATE.accounts.filter(a=>a.ownerName===name);
  if(!allAccts.length){
    return `<div class="card acct-hd"><div class="hd"><div><h2>${esc(name)}</h2><div class="mini">No accounts found for this CSM</div></div><button class="btn sm" onclick="closeCsmProfile()">← Back</button></div></div>`;
  }
  const o=csmMetrics(allAccts)[0];
  const steps=csmImproveSteps(o);
  const items=csmStaleWork(name);
  const engPct=csmTargetPct(o.engagementPct, scoreTargets.engagementPct);
  const insPct=csmTargetPct(o.insights, scoreTargets.insightsPerCsm);
  const grPct=csmTargetPct(o.growthTotal, scoreTargets.growthPerCsm);
  const sortedAccts=[...o.accts].sort((a,b)=>b.renewalAmount-a.renewalAmount);
  return `<div class="card acct-hd"><div class="hd"><div><h2 style="display:flex;align-items:center;gap:10px">${avatarChip(name)} ${esc(name)}</h2>
    <div class="mini">${o.n} account${o.n===1?'':'s'} · ${fmtMoney(o.arr)} total contract value</div></div>
    <button class="btn sm" onclick="closeCsmProfile()">← Back</button></div></div>
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
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Actionable steps to improve <span class="hint">${steps.length?'prioritized by impact':'no gaps vs current targets'}</span></h3>
      ${steps.length?`<div class="improve-list">${steps.map(s=>`<div class="improve-step ${s.sev}">
        <div class="improve-meta"><span class="pill ${s.sev==='high'?'p-red':s.sev==='med'?'p-amber':'p-gray'}">${esc(s.metric)}</span></div>
        <div class="improve-body"><b>${esc(s.title)}</b><p class="mini">${esc(s.detail)}</p>
          <div class="row-actions" style="margin-top:8px"><button class="btn primary sm" onclick="runCsmImproveAction('${attrStr(name)}','${attrStr(s.action)}')">${esc(s.btn)}</button></div>
        </div>
      </div>`).join('')}</div>`
      :`<p class="mini">This CSM is at or above target on engagement, insights, and growth, with no overdue CTAs/milestones and a healthy NPS signal. Keep the cadence going.</p>`}
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Overdue items <span class="hint">CTAs &amp; Success Plan milestones past due</span></h3>
    <table><thead><tr><th>Type</th><th>Account</th><th>Item</th><th class="num">Overdue</th><th></th></tr></thead><tbody>
    ${items.map(it=>`<tr><td><span class="pill ${it.overdue>90?'p-red':it.overdue>30?'p-amber':'p-gray'}">${it.type}</span></td><td>${esc(it.acctName||'')}</td><td>${esc(it.title||'')}</td><td class="num"><b>${it.overdue}d</b></td><td><button class="btn sm" onclick="${it.type==='CTA'?`openAcct('${it.acctId}')`:`openPlan('${it.planId}')`}">Open</button></td></tr>`).join('')}
    </tbody></table>
    ${items.length?'':'<p class="mini">Nothing overdue — clean book.</p>'}
    </div>
    <div class="card" style="box-shadow:none"><h3>Book of accounts</h3>
    <table><thead><tr><th>Account</th><th class="num">Total Contract Value</th><th class="num">Close</th><th>CSAT</th><th>NPS</th><th>Health</th></tr></thead><tbody>
    ${sortedAccts.map(a=>`<tr onclick="openAcct('${a.id}')" style="cursor:pointer"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${a.dclose>9000?'—':a.dclose+'d'}</td><td>${csatPill(a)}</td><td>${npsPill(a)}</td><td>${healthWithTier(a.health,a.tier)}</td></tr>`).join('')}
    </tbody></table>
    </div>
  </div>`;
}
function viewScorecard(accts){
  const rows=csmMetrics(accts).map(o=>{ o.steps=csmImproveSteps(o); o.needsImprove=csmNeedsImprove(o); return o; });
  const totalGrowth=rows.reduce((s,o)=>s+o.growthTotal,0);
  const avgEngagement=rows.length?Math.round(rows.reduce((s,o)=>s+o.engagementPct,0)/rows.length):0;
  const sentimented=accts.filter(a=>a.sentiment!=null);
  const avgSentiment=sentimented.length?Math.round(sentimented.reduce((s,a)=>s+a.sentiment,0)/sentimented.length):null;
  return `<div class="card"><h3>CSM <span class="sortbar">${ceTest10ToggleHtml()}${riskTest10?`<button type="button" class="btn sm" onclick="refreshSheetData()" title="Pull the latest NPS/CSAT survey responses and re-evaluate triggers">↻ Refresh from Sheet</button><span class="mini">${sheetLastFetch?'Last refreshed '+sheetLastFetch.toLocaleTimeString():''}</span>`:''}</span></h3>
  <div class="kpis" style="margin:14px 0">
    <div class="kpi"><div class="l">CSMs</div><div class="v">${rows.length}</div><div class="d">in scope</div></div>
    <div class="kpi"><div class="l">Accounts</div><div class="v">${accts.length}</div><div class="d">across all CSMs</div></div>
    <div class="kpi"><div class="l">Avg engagement</div><div class="v">${avgEngagement}%</div><div class="d">in cadence</div></div>
    <div class="kpi"><div class="l">Avg sentiment</div><div class="v" style="color:${avgSentiment==null?'var(--muted)':avgSentiment>=70?'var(--green)':avgSentiment>=45?'var(--amber)':'var(--red)'}">${avgSentiment==null?'—':avgSentiment}</div><div class="d">support-derived</div></div>
    <div class="kpi"><div class="l">Total growth</div><div class="v">${fmtMoney(totalGrowth)}</div><div class="d">renewal + expansion + transactional</div></div>
  </div>
  </div>

  <div class="card"><h3>All CSMs in scope</h3>
  <table><thead><tr><th>CSM</th><th class="num">Accounts</th><th class="num">Engagement</th><th class="num">Insights (90d)</th><th class="num">NPS</th><th class="num">Renewal (organic)</th><th class="num">Expansion</th><th class="num">Transactional</th><th class="num">Total growth</th><th class="num">Overdue</th><th></th></tr></thead><tbody>
  ${rows.map(o=>`<tr onclick="openCsmProfile('${attrStr(o.name)}')" style="cursor:pointer"><td>${ownerCell(o.name)}</td><td class="num">${o.n}</td><td class="num">${o.engagementPct}%${targetBar(o.engagementPct/(scoreTargets.engagementPct||1)*100)}</td><td class="num">${o.insights}${targetBar(o.insights/(scoreTargets.insightsPerCsm||1)*100)}</td><td>${npsRollupPill(o.npsR)}</td><td class="num">${fmtMoney(o.growth.Renewal)}</td><td class="num">${fmtMoney(o.growth.Expansion)}</td><td class="num">${fmtMoney(o.growth.Transactional)}</td><td class="num"><b>${fmtMoney(o.growthTotal)}</b>${targetBar(o.growthTotal/(scoreTargets.growthPerCsm||1)*100)}</td><td class="num">${o.stale.length?`<span class="pill clickable ${o.stale[0].overdue>90?'p-red':'p-amber'}" onclick="event.stopPropagation();openCsmImprove('${attrStr(o.name)}')" title="Open improve plan">${o.stale.length}</span>`:'<span class="pill p-gray">0</span>'}</td><td>${o.needsImprove||o.steps.length?`<button class="btn ${o.needsImprove?'primary':'sm'} sm" onclick="event.stopPropagation();openCsmImprove('${attrStr(o.name)}')">${o.needsImprove?'Improve':'Plan'}</button>`:`<span class="pill p-green">On track</span>`}</td></tr>`).join('')}
  </tbody></table>
  ${rows.length?'':'<p class="mini">No CSMs with accounts in this scope.</p>'}
  <p class="mini" style="margin-top:12px;color:var(--muted)">Below-target metrics generate an improve plan with concrete next steps (book outreach, log insights, advance renewals, save NPS detractors, clear overdue work). Click <b>Improve</b> for the full plan, or run the top action from the attention list above.</p>
  </div>`;
}

// ---- Client Engagement (four subsections, one shared CTA record store) ----
// Replaces the old standalone Engagement Cadence tab. Cadence is no longer its
// own section - it's a descriptor on the account itself (see
// engagementDescriptorLine below, and a.lastEngagementDate/expectedCadenceDays/
// daysSinceLastTouch on scoreAccount) and the trigger that used to feed this
// tab now creates a category='cadence' CTA into the same store as everything
// else. cadenceInfo()/SEGMENT_CADENCE themselves are untouched - Command
// Center, Org Drill-down, tabBadges and Account 360's header still use them.
let currentEngagementCtaId=null; // id of the CTA expanded in #sheet
function engagementDescriptorLine(a){
  const ds=a.daysSinceLastTouch, req=a.expectedCadenceDays;
  return `Last touch ${ds==null?'—':ds+'d ago'} · cadence every ${req}d`;
}
// Accent color used on ce-kanban-card rows (Escalations/Active CTAs pages),
// same visual language as the Accounts & Risk kanban's colored left border.
const CTA_CATEGORY_COLOR={escalation:'var(--red)',renewal:'var(--blue)',usage:'var(--yellow)',case_watch:'var(--amber)',cadence:'var(--green)',manual:'var(--muted2)'};
function ceStatusPill(c){
  const s=engagementCtaEffectiveStatus(c);
  return s==='done'?'<span class="pill p-green">Done</span>':s==='in_progress'?'<span class="pill p-amber">In progress</span>':s==='dismissed'?'<span class="pill p-gray">Discarded</span>':'<span class="pill p-blue">Open</span>';
}
function ceCategoryPill(c){
  const isEsc=c.category==='escalation';
  return `<span class="pill ${isEsc?'p-red':'p-gray'}">${esc(CTA_CATEGORY_LABELS[c.category]||c.category)}</span>`;
}
// Same card chrome as the A&R kanban's risk-card (hover-to-yellow border,
// stacked header/badges/footer), just with a category-colored left accent
// instead of a stage color - visually ties the two boards together. The
// chevron block stepper only ever lives on the detail page (click into the
// account) - rows/cards everywhere else just show the plain progress line,
// same as before.
function ceKanbanCardHtml(c,a){
  const color=CTA_CATEGORY_COLOR[c.category]||'var(--line)';
  const isEsc=c.category==='escalation';
  const progress=isEsc?escStepProgress(peekEscState(c.accountId).steps):(c.steps.length>1?Math.round(c.steps.slice(1).filter(s=>s.done).length/(c.steps.length-1)*100):null);
  return `<div class="risk-card" style="border-left:3px solid ${color};cursor:pointer" onclick="openEngagementCta('${c.id}')">
    <div class="risk-card-hd">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a?a.name:'—')}</b>
        ${ceStatusPill(c)}
      </div>
    </div>
    <div class="risk-card-badges">
      <span class="pill p-amber" title="What triggered this record">${esc(RISK_TRIGGER_LABELS[c.originatingTriggerType]||'Manually created')}</span>
      <span class="pill p-gray">${ceDaysOpen(c)}d open</span>
      ${a?`<span class="pill p-gray">${esc(engagementDescriptorLine(a))}</span>`:''}
    </div>
    ${progress!=null?`<div class="progress" style="margin:2px 0 4px"><i style="width:${progress}%"></i></div><div class="mini" style="margin-bottom:6px">${progress}% of ${isEsc?'resolution checklist':'follow-up steps'} complete</div>`:''}
    <div class="mini" style="font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.steps[0].subject||'(no subject yet)')}</div>
    <div class="risk-card-touch">${c.steps[0].sent?'Email sent '+esc(fmtDate(c.steps[0].sentAt)):'Awaiting send'}</div>
  </div>`;
}
function ceEscalationsHtml(list,accts){
  const byId={}; accts.forEach(a=>byId[a.id]=a);
  if(!list.length) return `<div style="text-align:center;padding:36px 0"><p class="mini">No active escalations — clear queue.</p></div>`;
  const sorted=[...list].sort((x,y)=>ceDaysOpen(y)-ceDaysOpen(x));
  return `<div class="risk-col-body" style="padding:0">${sorted.map(c=>ceKanbanCardHtml(c,byId[c.accountId])).join('')}</div>`;
}
// Escalations get their own top-level nav page (not just a filtered Client
// Engagement sub-tab) - still the exact same shared CTA store and the exact
// same detail/timeline view (openEngagementCta), just its own dedicated
// landing spot so it's never missed. Stays visible even with zero active
// escalations, with a clear empty state.
function ceTest10ToggleHtml(){
  // Re-render pulls fresh off the same live triggerEvents/engagementCtas
  // arrays the risk board itself reads - a plain route() is enough, no need
  // to touch computeAll() (which would re-run resetTest10RiskBaseline and
  // wipe whatever the demo just fired). This button exists purely so it's
  // obvious, mid-demo, that this screen is in fact reading live off the risk
  // board rather than some stale snapshot.
  const refreshBtn = riskTest10 ? `<button type="button" class="btn sm" onclick="route()" title="Re-pull the latest state from Accounts & Risk">↻ Refresh from Test 10</button>` : '';
  const resetBtn = riskTest10 ? `<button type="button" class="btn sm" onclick="resetTest10Demo()" title="Clear every CTA/escalation/plan for the 10 pilot accounts and re-blank NPS/health">⟲ Reset demo</button>` : '';
  return `${refreshBtn}${resetBtn}<button type="button" class="btn sm${riskTest10?' primary':''}" onclick="setRiskTest10(${riskTest10?'false':'true'})">${riskTest10?'← Back to full book':'Test 10 only'}</button>`;
}
// What actually caused each item - the same originatingTriggerType recorded
// the moment fireTriggerWithCta/ensureEscalationCta created the record, i.e.
// the exact granular reason from the risk board (Case blocked past SLA,
// Usage below adoption target, TAP refresh due, etc.), not just the coarser
// category it got routed into. No trigger at all (started by hand from
// Account 360 or Client Engagement) buckets as "Manually opened". One KPI
// bubble per distinct reason present, mirroring the NPS/CSAT page's
// count-bubble layout - clicking one filters the list below to just that
// reason and scrolls it into view; clicking it again clears the filter.
// The fixed set of trigger types that route to each page (per
// CTA_CATEGORY_BY_TRIGGER) - always rendered as a bubble even at 0, so the
// full shape of "what could show up here" is visible at a glance, not just
// whatever happens to be non-zero on any given day.
const ESCALATION_TRIGGER_TYPES=Object.keys(CTA_CATEGORY_BY_TRIGGER).filter(k=>CTA_CATEGORY_BY_TRIGGER[k]==='escalation');
const CTA_TRIGGER_TYPES=Object.keys(CTA_CATEGORY_BY_TRIGGER).filter(k=>CTA_CATEGORY_BY_TRIGGER[k]!=='escalation');
// The ground truth for "how many of each cause are active" is triggerEvents
// itself (same source the risk board's Trigger types chart uses) - NOT the
// engagementCtas records, since one CTA/escalation can be the landing spot
// for a trigger that later gets discarded or resolved independently of the
// trigger itself closing. Counting the live trigger directly is what keeps
// this bubble row, the Trigger types chart, and the actual open case list
// from ever silently disagreeing.
function liveTriggerBreakdown(scopedAccts,allowedTypes){
  const ids=new Set(scopedAccts.map(a=>a.id));
  const counts={};
  triggerEvents.filter(t=>ids.has(t.accountId) && isTriggerLive(t) && (!allowedTypes||allowedTypes.includes(t.triggerType))).forEach(t=>{ counts[t.triggerType]=(counts[t.triggerType]||0)+1; });
  const keys=allowedTypes||Object.keys(RISK_TRIGGER_LABELS);
  return keys.map(k=>({key:k,label:RISK_TRIGGER_LABELS[k],count:counts[k]||0})).sort((a,b)=>b.count-a.count);
}
// Which accounts have this exact trigger type currently live - used to
// populate the open-case list for a clicked bubble, so an account shows up
// under whichever trigger is actually driving it right now even if its
// CTA/escalation record's own originatingTriggerType was set by a different,
// earlier trigger.
function acctIdsWithLiveTrigger(triggerType){
  return new Set(triggerEvents.filter(t=>t.triggerType===triggerType && isTriggerLive(t)).map(t=>t.accountId));
}
// Self-heals any live trigger that somehow has no CTA/escalation record at
// all yet (shouldn't normally happen - fireTriggerWithCta creates one the
// moment a trigger first fires - but this is what guarantees "every account
// with a live trigger actually shows up as a row here" stays true even if
// that create-on-fire step was ever missed). Deliberately checks for ANY
// record regardless of status, not just an open one - a trigger whose CTA
// was already discarded or resolved already has a record on file and must
// NOT get a fresh one recreated out from under the CSM's decision.
function ensureCtasForLiveTriggers(scopedAccts,allowedTypes){
  const byId={}; scopedAccts.forEach(a=>byId[a.id]=a);
  let created=false;
  triggerEvents.filter(t=>byId[t.accountId] && isTriggerLive(t) && allowedTypes.includes(t.triggerType)).forEach(t=>{
    const category=CTA_CATEGORY_BY_TRIGGER[t.triggerType]||'manual';
    const hasAny = category==='escalation'
      ? engagementCtas.some(c=>c.accountId===t.accountId && c.category==='escalation')
      : engagementCtas.some(c=>c.accountId===t.accountId && c.originatingTriggerType===t.triggerType);
    if(hasAny) return;
    autoCreateCtaForNewTrigger(byId[t.accountId],t.triggerType,t.recommendedAction);
    created=true;
  });
  if(created) saveEngagementCtas();
}
function ceTriggerBreakdownKpisHtml(breakdown,filterVal,setFilterFn,unit){
  return breakdown.map(b=>`<div class="kpi clickable${filterVal===b.key?' selected':''}" onclick="${setFilterFn}('${b.key}')"><div class="l">${esc(b.label)}</div><div class="v">${b.count}</div><div class="d">active ${unit}${b.count===1?'':'s'}</div></div>`).join('');
}
function scrollToListAnchor(){ setTimeout(()=>{ const el=document.getElementById('ceListAnchor'); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); },30); }
// Trigger-type filter (which cause) and status filter (Active/Pending) are
// mutually exclusive - picking one clears the other, so the row list always
// reflects exactly one clicked KPI at a time, never a confusing overlap.
let escTriggerFilter=null;
let escStatusFilter=null; // null | 'open' | 'in_progress'
function setEscTriggerFilter(k){ escTriggerFilter = escTriggerFilter===k?null:k; escStatusFilter=null; route(); scrollToListAnchor(); }
function setEscStatusFilter(s){ escStatusFilter = escStatusFilter===s?null:s; escTriggerFilter=null; route(); scrollToListAnchor(); }
function clearEscFilters(){ escTriggerFilter=null; escStatusFilter=null; route(); }
let ctaTriggerFilter=null;
let ctaStatusFilter=null;
function setCtaTriggerFilter(k){ ctaTriggerFilter = ctaTriggerFilter===k?null:k; ctaStatusFilter=null; route(); scrollToListAnchor(); }
function setCtaStatusFilter(s){ ctaStatusFilter = ctaStatusFilter===s?null:s; ctaTriggerFilter=null; route(); scrollToListAnchor(); }
function clearCtaFilters(){ ctaTriggerFilter=null; ctaStatusFilter=null; route(); }
function viewEscalations(accts){
  const scopedAccts = riskTest10 ? STATE.accounts.filter(a=>TEST10_ACCOUNTS.includes(a.name)) : accts;
  ensureCtasForLiveTriggers(scopedAccts,ESCALATION_TRIGGER_TYPES);
  const all=engagementCtasFor(scopedAccts);
  const escOpen=all.filter(c=>c.category==='escalation' && ceIsOpenOrInProgress(c));
  const escPending=all.filter(c=>c.category==='escalation' && engagementCtaEffectiveStatus(c)==='in_progress');
  const escDone=all.filter(c=>c.category==='escalation' && engagementCtaEffectiveStatus(c)==='done');
  const breakdown=liveTriggerBreakdown(scopedAccts,ESCALATION_TRIGGER_TYPES);
  const activeTotal=breakdown.reduce((s,b)=>s+b.count,0);
  let shown=escOpen, filterLabel=null;
  if(escStatusFilter){ shown=escOpen.filter(c=>engagementCtaEffectiveStatus(c)===escStatusFilter); filterLabel=escStatusFilter==='open'?'Active (not yet started)':'Pending (in progress)'; }
  else if(escTriggerFilter){
    // Account-level match here is correct (unlike the CTA side below): every
    // escalation-cause trigger on an account collapses into ONE shared
    // escalation record (ensureEscalationCta), so surfacing that account
    // under whichever of its live causes was clicked is accurate, not
    // over-broad - there's only ever one escalation to show per account.
    shown=escOpen.filter(c=>acctIdsWithLiveTrigger(escTriggerFilter).has(c.accountId));
    filterLabel=RISK_TRIGGER_LABELS[escTriggerFilter]||'Manually opened';
  }
  return `<div class="card"><h3>Escalations <span class="sortbar">${ceTest10ToggleHtml()}</span></h3>
    <div class="kpis" style="margin-top:6px">
      <div class="kpi risk-red clickable${escStatusFilter==='open'?' selected':''}" onclick="setEscStatusFilter('open')"><div class="l">Active</div><div class="v">${activeTotal}</div><div class="d">live triggers behind ${escOpen.length} account${escOpen.length===1?'':'s'} — click to filter</div></div>
      <div class="kpi risk-amber clickable${escStatusFilter==='in_progress'?' selected':''}" onclick="setEscStatusFilter('in_progress')"><div class="l">Pending</div><div class="v">${escPending.length}</div><div class="d">at least one checklist step taken — click to filter</div></div>
      <div class="kpi risk-green clickable" onclick="scrollToSection('ceEscResolvedAnchor')"><div class="l">Resolved</div><div class="v">${escDone.length}</div><div class="d">closed out</div></div>
      ${ceTriggerBreakdownKpisHtml(breakdown,escTriggerFilter,'setEscTriggerFilter','escalation')}
    </div>
  </div>
  <div class="card" id="ceListAnchor">${filterLabel?`<div class="mini" style="margin-bottom:8px">Showing only <b>${esc(filterLabel)}</b> — <a href="#" onclick="clearEscFilters();return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear filter</a></div>`:''}${ceEscalationsHtml(shown,scopedAccts)}</div>
  <div class="card" id="ceEscResolvedAnchor"><h3>Resolved <span class="hint">most recently resolved first</span></h3>${ceSentHistoryHtml(escDone,scopedAccts)}</div>`;
}
// Its own top-level nav page for everything that's a CTA but NOT an
// escalation - rows of accounts (same card style as Escalations), each
// opening into the same progression-bar detail page (ctaStepperHtml) rather
// than only being reachable through Open Tasks' kanban board.
function viewActiveCtas(accts){
  const scopedAccts = riskTest10 ? STATE.accounts.filter(a=>TEST10_ACCOUNTS.includes(a.name)) : accts;
  ensureCtasForLiveTriggers(scopedAccts,CTA_TRIGGER_TYPES);
  const all=engagementCtasFor(scopedAccts);
  const ctaOpen=all.filter(c=>c.category!=='escalation' && ceIsOpenOrInProgress(c));
  const ctaPending=all.filter(c=>c.category!=='escalation' && engagementCtaEffectiveStatus(c)==='in_progress');
  const ctaDone=all.filter(c=>c.category!=='escalation' && engagementCtaEffectiveStatus(c)==='done');
  const byId={}; scopedAccts.forEach(a=>byId[a.id]=a);
  const breakdown=liveTriggerBreakdown(scopedAccts,CTA_TRIGGER_TYPES);
  const activeTotal=breakdown.reduce((s,b)=>s+b.count,0);
  let shown=ctaOpen, filterLabel=null;
  if(ctaStatusFilter){ shown=ctaOpen.filter(c=>engagementCtaEffectiveStatus(c)===ctaStatusFilter); filterLabel=ctaStatusFilter==='open'?'Active (not yet started)':'Pending (in progress)'; }
  else if(ctaTriggerFilter){
    // Record-level match, not account-level: unlike escalations, an account
    // can have two DIFFERENT CTA records live at once (e.g. a usage-drop CTA
    // and a separate TAP-refresh CTA both open on the same account), each
    // deduped independently per exact trigger type. Matching by account
    // membership would incorrectly pull in that account's other CTA too -
    // clicking "TAP refresh due" must show only TAP-refresh CTAs.
    shown=ctaOpen.filter(c=>c.originatingTriggerType===ctaTriggerFilter);
    filterLabel=RISK_TRIGGER_LABELS[ctaTriggerFilter]||'Manually opened';
  }
  const sorted=[...shown].sort((x,y)=>ceDaysOpen(y)-ceDaysOpen(x));
  return `<div class="card"><h3>Active CTAs <span class="sortbar">${ceTest10ToggleHtml()}</span></h3>
    <div class="kpis" style="margin-top:6px">
      <div class="kpi risk-red clickable${ctaStatusFilter==='open'?' selected':''}" onclick="setCtaStatusFilter('open')"><div class="l">Active</div><div class="v">${activeTotal}</div><div class="d">live triggers behind ${ctaOpen.length} CTA${ctaOpen.length===1?'':'s'} — click to filter</div></div>
      <div class="kpi risk-amber clickable${ctaStatusFilter==='in_progress'?' selected':''}" onclick="setCtaStatusFilter('in_progress')"><div class="l">Pending</div><div class="v">${ctaPending.length}</div><div class="d">at least one follow-up step taken — click to filter</div></div>
      <div class="kpi risk-green clickable" onclick="scrollToSection('ceCtaResolvedAnchor')"><div class="l">Resolved</div><div class="v">${ctaDone.length}</div><div class="d">done</div></div>
      ${ceTriggerBreakdownKpisHtml(breakdown,ctaTriggerFilter,'setCtaTriggerFilter','CTA')}
    </div>
  </div>
  <div class="card" id="ceListAnchor">${filterLabel?`<div class="mini" style="margin-bottom:8px">Showing only <b>${esc(filterLabel)}</b> — <a href="#" onclick="clearCtaFilters();return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear filter</a></div>`:''}${sorted.length?`<div class="risk-col-body" style="padding:0">${sorted.map(c=>ceKanbanCardHtml(c,byId[c.accountId])).join('')}</div>`:`<div style="text-align:center;padding:36px 0"><p class="mini">No active CTAs — clear queue.</p></div>`}</div>
  <div class="card" id="ceCtaResolvedAnchor"><h3>Resolved <span class="hint">most recent first</span></h3>${ceSentHistoryHtml(ctaDone,scopedAccts)}</div>`;
}
// Predictive Insights: an analysis tool, not an email workflow - every
// account in scope is listed here; clicking in and generating an insight
// reviews that account's own history, compares it to similar accounts, and
// proposes a forward-looking relationship timeline. Landing tab of the
// Customer Success Journey category.
function setPredictiveYear(y){ setGlobalQYear(y); }
function setPredictiveQ(q){ setGlobalQQ(q); }
function viewPredictive(accts){
  const scopedAccts = riskTest10 ? STATE.accounts.filter(a=>TEST10_ACCOUNTS.includes(a.name)) : accts;
  const sel=globalQSel||defaultQSel();
  const qKey=quarterKeyOf(sel);
  const generated=scopedAccts.filter(a=>predictiveInsightFor(a.id,qKey));
  const rows=[...scopedAccts].sort((x,y)=>x.name.localeCompare(y.name));
  return `<div class="card"><h3>Predictive Insights <span class="sortbar">${ceTest10ToggleHtml()}</span></h3>
    <p class="mini">Analyzes an account's own history and similar accounts to propose a forward-looking relationship timeline — no risk trigger, no problem signal, no email to send.</p>
    ${quarterToggleHtml(sel,'setPredictiveYear','setPredictiveQ')}
    <div class="kpis" style="margin-top:6px">
      <div class="kpi"><div class="l">Accounts in scope</div><div class="v">${scopedAccts.length}</div><div class="d">available for analysis</div></div>
      <div class="kpi risk-green"><div class="l">Insights generated</div><div class="v">${generated.length}</div><div class="d">${sel.year} Q${sel.q}</div></div>
    </div>
  </div>
  <div class="card"><div class="risk-col-body" style="padding:0">${rows.map(a=>predictiveAcctRowHtml(a,qKey)).join('')}</div></div>`;
}
function predictiveAcctRowHtml(a,qKey){
  const ins=predictiveInsightFor(a.id,qKey);
  return `<div class="risk-card" style="cursor:pointer" onclick="openPredictiveInsight('${a.id}')">
    <div class="risk-card-hd">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.name)}</b>
        ${ins?'<span class="pill p-green">Insight generated</span>':'<span class="pill p-gray">Not yet analyzed</span>'}
      </div>
    </div>
    <div class="risk-card-badges">
      <span class="pill p-gray">${esc(engagementDescriptorLine(a))}</span>
      ${ins?`<span class="pill p-gray">generated ${esc(fmtDate(ins.generatedAt))}</span>`:''}
    </div>
  </div>`;
}
// Full page (same pattern as Account 360/CSM profile - a dedicated page with
// a "← Back" button, not a #sheet overlay or the CTA chevron stepper).
let currentPredictiveAcctId = null;
function openPredictiveInsight(acctId){ currentAcctView=null; currentEngagementCtaId=null; currentCsmView=null; currentPlanAcctId=null; currentPlanMilestone=null; currentPredictiveAcctId=acctId; route(); window.scrollTo(0,0); }
function closePredictiveInsight(){ currentPredictiveAcctId=null; route(); window.scrollTo(0,0); }
function renderPredictiveInsightPage(){
  const a=STATE.accounts.find(x=>x.id===currentPredictiveAcctId);
  if(!a){ currentPredictiveAcctId=null; route(); return; }
  $('#scopebar').style.display='none';
  $('#app').innerHTML=predictiveInsightPageHtml(a);
}
// Test10 accounts: real human-in-the-loop AI generation, same hand-off
// pattern as ai_drafts (backend/data/predictive_insights/) - the backend
// embeds the account's own "Test10 background and current info for {name}"
// file content into the request, plus a live summary of its most recent
// trigger event, so a Claude Code session drafting the insight has both the
// fabricated history AND the account's actual current state to work from.
// Every other real account keeps the fast local deterministic generator.
function predictiveRecentEventSummary(a){
  const live=triggerEvents.filter(t=>t.accountId===a.id && isTriggerLive(t)).sort((x,y)=>new Date(y.firedAt)-new Date(x.firedAt))[0];
  if(live) return `Currently has an open ${RISK_TRIGGER_LABELS[live.triggerType]||live.triggerType} (${CTA_CATEGORY_BY_TRIGGER[live.triggerType]==='escalation'?'routed to Escalations':'routed to Active CTAs'}), status: ${live.status}.`;
  const resolved=triggerEvents.filter(t=>t.accountId===a.id && t.resolution).sort((x,y)=>new Date(y.resolution.at)-new Date(x.resolution.at))[0];
  if(resolved) return `Most recently, a ${RISK_TRIGGER_LABELS[resolved.triggerType]||resolved.triggerType} was resolved on ${fmtDate(resolved.resolution.at)} (outcome: ${resolved.resolution.outcome}).`;
  return 'No recent trigger activity on file for this account.';
}
function requestPredictiveInsight(acctId){
  const a=STATE.accounts.find(x=>x.id===acctId); if(!a) return;
  const qKey=quarterKeyOf(globalQSel||defaultQSel());
  if(!isTest10Account(acctId)){ generatePredictiveInsight(acctId,qKey); route(); return; }
  const requestId='pins_'+acctId+'_'+qKey.replace('-','');
  const btn=$('#predictiveGenBtn'), statusEl=$('#predictiveGenStatus');
  if(btn){ btn.disabled=true; btn.textContent='Requesting…'; }
  fetch('/api/predictive-insight/'+requestId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accountName:a.name,quarter:qKey,recentEventSummary:predictiveRecentEventSummary(a)})})
    .then(r=>{ if(!r.ok) throw new Error(); return r.json(); })
    .then(()=>{ if(statusEl) statusEl.textContent='Waiting on a predictive insight — ask Claude Code to "process pending predictive insights".'; pollPredictiveInsight(requestId,acctId,qKey,0); })
    .catch(()=>{ toast('Could not request a predictive insight.'); if(btn){ btn.disabled=false; btn.textContent='Generate predictive insight'; } });
}
function pollPredictiveInsight(requestId,acctId,qKey,attempt){
  if(attempt>240) return; // ~20 minutes at 5s intervals, then give up quietly
  fetch('/api/predictive-insight/'+requestId).then(r=>r.json()).then(d=>{
    if(d.status==='ready' && d.insight){
      const a=STATE.accounts.find(x=>x.id===acctId);
      // The model only ever produces the relationship-building steps - the
      // active-risk-signal step (if any) is always prepended here, same
      // deterministic logic as the local generator, never left to the model.
      if(a && Array.isArray(d.insight.timeline)) d.insight.timeline=[...predictiveRiskStepFor(a),...d.insight.timeline];
      predictiveInsights[predictiveKey(acctId,qKey)]=Object.assign({quarter:qKey,generatedAt:new Date().toISOString()},d.insight);
      savePredictiveInsights();
      route();
    }else{
      setTimeout(()=>pollPredictiveInsight(requestId,acctId,qKey,attempt+1),5000);
    }
  }).catch(()=>setTimeout(()=>pollPredictiveInsight(requestId,acctId,qKey,attempt+1),5000));
}
function predictiveInsightPageHtml(a){
  const sel=globalQSel||defaultQSel();
  const qKey=quarterKeyOf(sel);
  const ins=predictiveInsightFor(a.id,qKey);
  return `<div class="card acct-hd"><div class="hd"><div><h2>${esc(a.name)}</h2>
    <div class="mini">${esc(engagementDescriptorLine(a))}</div></div>
    <button class="btn sm" onclick="closePredictiveInsight()">← Back</button></div></div>
  <div class="bd">
    <div class="card" style="box-shadow:none;margin:0 0 16px">${quarterToggleHtml(sel,'setPredictiveYear','setPredictiveQ')}</div>
    ${!ins?`<div class="card" style="text-align:center;padding:36px 0">
      <p class="mini" style="margin-bottom:12px">No predictive insight generated yet for ${sel.year} Q${sel.q}.</p>
      <button type="button" class="btn primary" id="predictiveGenBtn" onclick="requestPredictiveInsight('${a.id}')">Generate predictive insight</button>
      <div id="predictiveGenStatus" class="mini" style="margin-top:8px;color:var(--muted2)"></div>
    </div>`:`
    <div class="card" style="box-shadow:none;margin:0 0 16px;border:1px solid var(--violet)">
      <h4 style="margin:0 0 8px">Review of the past</h4>
      <p class="mini">${esc(ins.pastReview)}</p>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px;border:1px solid var(--violet)">
      <h4 style="margin:0 0 8px">This account</h4>
      <p class="mini">${esc(ins.analysis)}</p>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px;border:1px solid var(--violet)">
      <h4 style="margin:0 0 8px">Similar cases</h4>
      ${ins.similar.length?ins.similar.map(s=>`<p class="mini">• <b>${esc(s.name)}</b> — ${esc(s.note)}</p>`).join(''):'<p class="mini">No comparable accounts on file.</p>'}
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px;border:1px solid var(--violet)">
      <h4 style="margin:0 0 8px">Proposed timeline <span class="hint">${sel.year} Q${sel.q}</span></h4>
      <div class="timeline">${ins.timeline.map(t=>`<div class="timeline-entry"><div class="mini" style="font-weight:700">${esc(t.when)} — ${esc(t.action)} ${t.impliesEngagement?'<span class="pill p-blue">Engagement</span>':t.emailTemplate?'<span class="pill p-red">Email</span>':'<span class="pill p-gray">Internal</span>'}</div><div class="mini">${esc(t.detail)}</div></div>`).join('')}</div>
      <p class="mini" style="margin-top:8px">Adding this to the Success Plan turns each step into a clickable timeline node there — blue jumps to the account's active escalation/CTA, red jumps to an email draft, black opens step details.</p>
      <div class="row-actions" style="margin-top:10px">
        <button type="button" class="btn sm" onclick="addPredictiveTimelineToPlan('${a.id}')">Add timeline to Success Plan</button>
        <button type="button" class="btn sm" id="predictiveGenBtn" onclick="requestPredictiveInsight('${a.id}')">Regenerate</button>
      </div>
      <div id="predictiveGenStatus" class="mini" style="margin-top:6px;color:var(--muted2)"></div>
    </div>`}
  </div>`;
}
// The concrete "connects the parts of Journey together" link: pushes the
// proposed timeline straight into a real Success Plan as milestones, reusing
// the exact same plans/generatePlan/savePlans store Success Plans is built on.
// Uses whichever quarter is currently selected on the Predictive Insights
// page, so a plan built from a past quarter's insight is possible too.
function addPredictiveTimelineToPlan(acctId){
  const qKey=quarterKeyOf(globalQSel||defaultQSel());
  const ins=predictiveInsightFor(acctId,qKey); if(!ins) return;
  if(!plans[acctId]) generatePlan(acctId);
  const base=new Date();
  ins.timeline.forEach((t,i)=>{
    const resources=t.impliesEngagement?[{kind:'engagement',id:acctId}]:t.emailTemplate?[{kind:'email',id:t.emailTemplate}]:[];
    const due=t.impliesEngagement?sfDate(base):sfDate(new Date(base.getTime()+(i+1)*21*864e5));
    plans[acctId].milestones.push({id:cid(),title:t.action,detail:t.detail,note:'',resources,due,done:false,source:'predictive'});
  });
  savePlans();
  closePredictiveInsight();
  setTab('plans');
  openPlan(acctId);
}
// Customer Success Emails: same automated pattern as Customer Contact
// Insights (contactLogEntries/viewGong) - a read-only matrix built from
// whatever was actually sent, not a manual compose/log-a-reply page. Scoped
// to just the relationship-building emails the Predictive/Success-Plan flow
// sends (source==='journey' on emailDrafts, tagged in sendPlanMilestoneEmail), so
// this is a filtered slice of the same automatic record, not a second
// parallel logging mechanism.
function viewCsEmails(accts){
  const idSet=new Set(accts.map(a=>a.id));
  const rows=emailDrafts.filter(h=>h.source==='journey' && (!h.acctId||idSet.has(h.acctId)))
    .map(h=>({t:h.t,acctId:h.acctId,acctName:h.acctName,direction:'sent',audience:h.audience,subject:h.subject,snippet:h.snippet||'',contact:h.to||'',stage:h.stage||h.templateName||''}))
    .sort((a,b)=>new Date(b.t)-new Date(a.t));
  const last30=rows.filter(r=>r.t && (Date.now()-new Date(r.t).getTime())<=30*864e5).length;
  const acctsCovered=new Set(rows.map(r=>r.acctId).filter(Boolean)).size;
  return `<div class="card"><h3>Customer Success Emails</h3>
    <div class="kpis" style="margin:14px 0">
      <div class="kpi clickable" onclick="scrollToSection('csEmailMatrix')"><div class="l">Total sent</div><div class="v">${rows.length}</div><div class="d">this cadence only</div></div>
      <div class="kpi clickable" onclick="scrollToSection('csEmailMatrix')"><div class="l">Logged last 30 days</div><div class="v">${last30}</div><div class="d">recent activity</div></div>
      <div class="kpi clickable" onclick="scrollToSection('csEmailMatrix')"><div class="l">Accounts covered</div><div class="v">${acctsCovered}</div><div class="d">of ${accts.length} in scope</div></div>
    </div>
  </div>
  <div class="card" id="csEmailMatrix"><h3>Contact matrix</h3>
    ${rows.length?`<div style="overflow-x:auto"><table class="matrix-table"><thead><tr><th>Timestamp</th><th>Account</th><th>Direction</th><th>Audience</th><th>Subject</th><th>Snippet</th><th>Contact</th><th>Stage</th></tr></thead><tbody>
    ${rows.slice(0,200).map(r=>`<tr ${r.acctId?`onclick="openAcct('${r.acctId}')" style="cursor:pointer"`:''}><td class="mini">${r.t?esc(new Date(r.t).toLocaleString()):'—'}</td><td><b>${esc(r.acctName||'—')}</b></td><td><span class="pill p-blue">Sent</span></td><td><span class="pill ${r.audience==='customer'?'p-blue':'p-amber'}">${esc(r.audience||'—')}</span></td><td class="mini">${esc(r.subject||'—')}</td><td class="mini" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.snippet||'')}">${esc(r.snippet||'—')}</td><td class="mini">${esc(r.contact||'—')}</td><td class="mini">${esc(r.stage||'—')}</td></tr>`).join('')}
    </tbody></table></div>`:'<p class="mini">No relationship-building emails sent yet.</p>'}
  </div>`;
}
// Sent history reads as its own dated timeline (same visual language as the
// CTA detail view below and the A&R kanban card) rather than a flat table -
// it's inherently chronological, so the timeline pattern fits directly.
function ceSentHistoryHtml(list,accts){
  const byId={}; accts.forEach(a=>byId[a.id]=a);
  const sorted=[...list].sort((x,y)=>new Date(y.steps[0].sentAt||y.createdAt)-new Date(x.steps[0].sentAt||x.createdAt));
  if(!sorted.length) return '<p class="mini">Nothing sent yet.</p>';
  return `<div class="timeline">${sorted.map(c=>{
    const a=byId[c.accountId];
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--green)"></div><div class="timeline-body" style="cursor:pointer" onclick="openEngagementCta('${c.id}')">
      <div class="mini" style="color:var(--muted2)">${esc(fmtDate(c.steps[0].sentAt))}</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:2px 0"><b style="text-decoration:underline;text-decoration-color:var(--yellow)">${esc(a?a.name:'—')}</b> ${ceCategoryPill(c)} ${ceStatusPill(c)}</div>
      <div class="mini" style="font-style:italic">"${esc(c.steps[0].subject||'')}" → ${esc(c.steps[0].recipient||'')}</div>
    </div></div>`;
  }).join('')}</div>`;
}
// Navigates a trigger-type bubble straight to wherever that trigger's
// account actually lives (Escalations vs Active CTAs, per
// CTA_CATEGORY_BY_TRIGGER) and pre-applies that page's own trigger filter, so
// landing there shows exactly the accounts behind that bubble - not the
// full unfiltered page.
function goToTriggerType(k){
  if(CTA_CATEGORY_BY_TRIGGER[k]==='escalation'){ escTriggerFilter=k; escStatusFilter=null; setTab('escalations'); }
  else { ctaTriggerFilter=k; ctaStatusFilter=null; setTab('activectas'); }
}
// Active/Pending/Resolved counts for a set of engagementCtas records -
// "Pending" is effective status 'in_progress', which (per
// engagementCtaEffectiveStatus) is set the moment the first chevron step is
// taken (the initial email send), same trigger point across both escalation
// and non-escalation CTAs alike.
function ceProgressCounts(list){
  return {
    open: list.filter(c=>engagementCtaEffectiveStatus(c)==='open').length,
    pending: list.filter(c=>engagementCtaEffectiveStatus(c)==='in_progress').length,
    resolved: list.filter(c=>engagementCtaEffectiveStatus(c)==='done').length,
  };
}
const CE_PROGRESS_COLORS=[chartHue('red'),chartHue('amber'),chartHue('green')];
// Client Engagement itself is now a pure statistical landing page, top to
// bottom: (1) Escalations vs Active CTAs split, next to (2) a combined
// Active/Pending/Resolved donut across both; (3) below that, the same
// Active/Pending/Resolved split broken out separately for Escalations-only
// and Active-CTAs-only; (4) further below, every trigger type across the
// book with one clickable bubble per trigger that jumps straight to its
// real home (Escalations or Active CTAs) with that exact filter already
// applied. The actual work (kanban, drafts, sent history) lives on those
// two dedicated pages now, not duplicated here.
function viewClientEngagement(accts){
  const allRecords=engagementCtasFor(accts).filter(c=>c.status!=='dismissed');
  const escRecords=allRecords.filter(c=>c.category==='escalation');
  const ctaRecords=allRecords.filter(c=>c.category!=='escalation');
  const breakdown=liveTriggerBreakdown(accts).filter(b=>b.count>0);
  return `<div class="card"><h3>Client Engagement</h3>
    <div class="grid2" style="margin-top:10px">
      <div class="card" style="box-shadow:none"><h3>Escalations vs Active CTAs</h3><div class="chartbox"><canvas id="ceSplitDonut"></canvas></div></div>
      <div class="card" style="box-shadow:none"><h3>Active, Pending, Resolved</h3><div class="chartbox"><canvas id="ceTotalProgDonut"></canvas></div></div>
    </div>
    <div class="grid2" style="margin-top:12px">
      <div class="card" style="box-shadow:none"><h3>Escalations only</h3><div class="chartbox"><canvas id="ceEscProgDonut"></canvas></div></div>
      <div class="card" style="box-shadow:none"><h3>Active CTAs only</h3><div class="chartbox"><canvas id="ceCtaProgDonut"></canvas></div></div>
    </div>
    <div class="kpis" style="margin-top:14px">${breakdown.length?breakdown.map(b=>{
      const isEsc=CTA_CATEGORY_BY_TRIGGER[b.key]==='escalation';
      return `<div class="kpi clickable" onclick="goToTriggerType('${b.key}')"><div class="l">${esc(b.label)}</div><div class="v">${b.count}</div><div class="d">${isEsc?'→ Escalations':'→ Active CTAs'}</div></div>`;
    }).join(''):'<p class="mini">No open triggers right now.</p>'}</div>
  </div>`;
}
// Same visual language as the Trigger types chart on Accounts & Risk - the
// split and progress donuts are new, the trigger donut reuses the exact same
// liveTriggerBreakdown/color-cycling approach as drawRiskEscalationCharts.
function drawClientEngagementCharts(accts){
  const allRecords=engagementCtasFor(accts).filter(c=>c.status!=='dismissed');
  const escRecords=allRecords.filter(c=>c.category==='escalation');
  const ctaRecords=allRecords.filter(c=>c.category!=='escalation');
  ['ceSplitDonut','ceTotalProgDonut','ceEscProgDonut','ceCtaProgDonut'].forEach(destroyChartKey);
  const progDonut=(id,list)=>{
    const el=$('#'+id); if(!el) return;
    const p=ceProgressCounts(list);
    charts[id]=new Chart(el,{type:'doughnut',data:{labels:['Active','Pending','Resolved'],datasets:[{data:[p.open,p.pending,p.resolved],backgroundColor:CE_PROGRESS_COLORS,borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',noScales:true})});
  };
  const sEl=$('#ceSplitDonut');
  if(sEl) charts.ceSplitDonut=new Chart(sEl,{type:'doughnut',data:{labels:['Escalations','Active CTAs'],datasets:[{data:[escRecords.filter(ceIsOpenOrInProgress).length,ctaRecords.filter(ceIsOpenOrInProgress).length],backgroundColor:[chartHue('red'),chartHue('blue')],borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',noScales:true})});
  progDonut('ceTotalProgDonut',allRecords);
  progDonut('ceEscProgDonut',escRecords);
  progDonut('ceCtaProgDonut',ctaRecords);
}
// ---- CTA detail view: reuses the same dated/expandable timeline pattern as
// the Accounts & Risk kanban card, so both sections feel like one system. ----
function engagementCtaTimelineFor(c){
  const entries=[{t:c.createdAt,kind:'ce-created',data:c}];
  const step=c.steps[0];
  if(step.sent) entries.push({t:step.sentAt,kind:'ce-sent',data:c});
  if(c.status==='dismissed' && c.discardedAt) entries.push({t:c.discardedAt,kind:'ce-discarded',data:c});
  // Escalation-category CTAs mirror the exact same escalation timeline shown
  // on the Accounts & Risk card (raised → each checklist step completed →
  // resolved) - same source (escState), same entries, so the two views never
  // disagree about what actually happened.
  if(c.category==='escalation'){
    const raw=escState[c.accountId];
    const st=peekEscState(c.accountId);
    if(raw && raw.openedAt) entries.push({t:raw.openedAt,kind:'ce-esc-raised',data:{acctId:c.accountId,status:st.status,reasonCode:st.reasonCode,product:st.product}});
    st.steps.forEach(s=>{ if(s.done && s.doneAt) entries.push({t:s.doneAt,kind:'ce-esc-step',data:{step:s,acctId:c.accountId}}); });
    if(raw && raw.resolvedAt) entries.push({t:raw.resolvedAt,kind:'ce-esc-resolved',data:{acctId:c.accountId}});
  }else{
    // Non-escalation follow-ups (meeting scheduled, problem resolved) live on
    // the CTA record itself, not escState - a simpler 2-step flow than
    // escalation's 6-step checklist, per how much lighter these CTAs are.
    c.steps.slice(1).forEach(s=>{ if(s.done && s.doneAt) entries.push({t:s.doneAt,kind:'ce-cta-step',data:{step:s}}); });
  }
  return entries.sort((x,y)=>new Date(x.t)-new Date(y.t));
}
function engagementCtaTimelineEntryHtml(e,c,a){
  const when=fmtDate(e.t);
  if(e.kind==='ce-created'){
    return `<div class="timeline-entry"><div class="timeline-dot"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b>CTA created</b> ${ceCategoryPill(c)}</div>
      <div class="mini">${esc(RISK_TRIGGER_LABELS[c.originatingTriggerType]||'Manually created')}</div>
    </div></div>`;
  }
  if(e.kind==='ce-sent'){
    const step=c.steps[0];
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--green)"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="closeEngagementCta();setTab('emails')">Email sent</b> to ${esc(step.recipient||'')}</div>
      <div class="mini" style="font-style:italic">"${esc(step.subject||'')}"</div>
    </div></div>`;
  }
  if(e.kind==='ce-esc-step'){
    const {step,acctId}=e.data;
    const d=step.detail;
    let detailHtml='';
    if(d){
      if(d.override) detailHtml+=`<div class="mini" style="margin-top:2px">Logged another way (not email)</div><div class="mini" style="font-style:italic;margin-top:2px">"${esc(d.note||'')}"</div>`;
      if(d.subject) detailHtml+=`<div class="mini" style="font-style:italic;margin-top:2px">"${esc(d.subject)}"${d.recipient?' → '+esc(d.recipient):''}</div>`;
      if(d.from) detailHtml+=`<div class="mini" style="margin-top:2px">From ${esc(d.from)}</div>`;
      if(d.body) detailHtml+=`<div class="mini" style="margin-top:2px;white-space:pre-wrap">${esc(d.body.slice(0,240))}${d.body.length>240?'…':''}</div>`;
    }
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--blue)"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="ceToggleStepPanel('${step.id}')">${esc(step.label)}</b></div>
      ${detailHtml}
    </div></div>`;
  }
  if(e.kind==='ce-cta-step'){
    const {step}=e.data;
    const d=step.detail;
    let detailHtml='';
    if(d){
      if(d.when) detailHtml+=`<div class="mini" style="margin-top:2px">${esc(d.when)}</div>`;
      if(d.note) detailHtml+=`<div class="mini" style="margin-top:2px;white-space:pre-wrap">${esc(d.note)}</div>`;
    }
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--blue)"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="ceToggleStepPanel('${step.id}')">${esc(step.label)}</b></div>
      ${detailHtml}
    </div></div>`;
  }
  if(e.kind==='ce-esc-raised'){
    const d=e.data;
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--red)"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="closeEngagementCta();goToEscalationPage('${d.acctId}')">Escalation raised</b> ${statusPill(d.status)}</div>
      ${(d.reasonCode||d.product)?`<div class="mini">${d.reasonCode?esc(d.reasonCode):''}${d.reasonCode&&d.product?' · ':''}${d.product?esc(d.product):''}</div>`:''}
    </div></div>`;
  }
  if(e.kind==='ce-esc-resolved'){
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--green)"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="closeEngagementCta();goToEscalationPage('${e.data.acctId}')">Escalation resolved</b></div>
    </div></div>`;
  }
  if(e.kind==='ce-discarded'){
    return `<div class="timeline-entry"><div class="timeline-dot" style="background:var(--muted2)"></div><div class="timeline-body">
      <div class="mini" style="color:var(--muted2)">${esc(when)}</div>
      <div><b>Discarded</b></div>
      <div class="mini" style="font-style:italic">"${esc(c.discardedReason||'')}"</div>
    </div></div>`;
  }
  return '';
}
// Full page (same pattern as Account 360's openAcct/renderAcctPage - a
// dedicated page with a "← Back" button, not a #sheet overlay), so an
// escalation opens into a real page you navigate to, not a drawer.
function openEngagementCta(ctaId){
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  currentAcctView=null;
  currentCsmView=null;
  currentPredictiveAcctId=null;
  currentPlanAcctId=null;
  currentPlanMilestone=null;
  currentEngagementCtaId=ctaId;
  ceExpandedStepId=null;
  route();
  window.scrollTo(0,0);
}
function closeEngagementCta(){ currentEngagementCtaId=null; ceExpandedStepId=null; route(); window.scrollTo(0,0); }
// The three "View X" links on Account 360 - each jumps into whichever
// dedicated section actually owns that workflow (Engagement, Accounts &
// Risk, Success Plans), scoped to this specific account rather than landing
// on an unscoped tab. Account 360 itself is deliberately just the reference
// data layer now (Salesforce-sourced fields + computed health/trigger
// inputs + NPS/CSAT outputs) - these three sections already own the actual
// workflows, so this account page doesn't duplicate them.
function viewEngagementForAccount(acctId){
  const c = engagementCtas.find(x=>x.accountId===acctId && x.category==='escalation' && ceIsOpenOrInProgress(x))
    || engagementCtas.find(x=>x.accountId===acctId && ceIsOpenOrInProgress(x));
  if(c) openEngagementCta(c.id); else setTab('engagement');
}
function viewRiskForAccount(acctId){
  setTab('riskboard');
  setTimeout(()=>openRiskCard(acctId),60);
}
function renderEngagementCtaPage(){
  const c=engagementCtas.find(x=>x.id===currentEngagementCtaId);
  if(!c){ currentEngagementCtaId=null; route(); return; }
  $('#scopebar').style.display='none';
  $('#app').innerHTML=engagementCtaPageHtml(c);
}
function engagementCtaPageHtml(c){
  const a=STATE.accounts.find(x=>x.id===c.accountId);
  const timeline=engagementCtaTimelineFor(c);
  const step=c.steps[0];
  const isEsc=c.category==='escalation';
  return `<div class="card acct-hd"><div class="hd"><div><h2><span style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--yellow)" onclick="openAcct('${c.accountId}')">${esc(a?a.name:'—')}</span> ${ceCategoryPill(c)} ${ceStatusPill(c)}</h2>
    <div class="mini">${a?esc(engagementDescriptorLine(a)):''}</div></div>
    <button class="btn sm" onclick="closeEngagementCta()">← Back</button></div></div>
  <div class="bd">
    ${isEsc && !step.sent?`<div class="card" style="box-shadow:none;margin:0 0 16px;border:1px solid var(--red)">
      <h4 style="margin:0 0 8px">Draft email — step 1</h4>
      <div style="display:flex;flex-direction:column;gap:6px">
        <input type="text" id="ceDraftTo_${c.id}" class="select" value="${esc(step.recipient||'')}" placeholder="Recipient">
        <input type="text" id="ceDraftSubject_${c.id}" class="select" value="${esc(step.subject||'')}" placeholder="Subject">
        <textarea id="ceDraftBody_${c.id}" class="select" rows="8" style="font:inherit">${esc(step.body||'')}</textarea>
      </div>
      <div class="row-actions" style="margin-top:10px">
        <button type="button" class="btn sm primary" onclick="sendEngagementCtaDraft('${c.id}')">Send</button>
        <button type="button" class="btn sm" onclick="requestDiscardCta('${c.id}')">Discard</button>
        ${a&&TEST10_ACCOUNTS.includes(a.name)?`<button type="button" class="btn sm" id="aiDraftBtn_cta_${c.id}" onclick="requestAiDraftForCta('${c.id}')">Create AI draft</button>`:''}
      </div>
      <div id="aiDraftStatus_cta_${c.id}" class="mini" style="margin-top:6px;color:var(--muted2)"></div>
    </div>`:''}
    ${isEsc ? engagementEscStepperHtml(c.accountId,c.id) : ''}
    ${!isEsc ? ctaStepperHtml(c) : ''}
    <h4 style="margin:14px 0 10px">Activity timeline</h4>
    <div class="timeline">${timeline.map(e=>engagementCtaTimelineEntryHtml(e,c,a)).join('')}</div>
  </div>`;
}
// Whether a CTA step is "done" - the email step tracks sent/sentAt, the two
// follow-up steps track done/doneAt - so every place that needs to treat all
// 3 steps uniformly (mirroring how escalation steps are uniform) goes
// through this instead of checking two different fields inline.
function ctaStepIsDone(s){ return s.type==='email' ? !!s.sent : !!s.done; }
// Non-escalation CTA stepper - literally mirrors engagementEscStepperHtml's
// structure (same iteration, same click-any-step-to-work-or-review-it
// model, same always-something-expanded default). Branch categories
// (renewal/case_watch) render steps 1 and 2 (Loop in sales / Meeting
// scheduled) stacked in one slot instead of in the main horizontal line -
// they're order-independent parallel tracks, not a strict sequence, so nether
// one visually blocks the other before the final "Problem resolved" step.
// 'current' turns into 'reading' the moment the backend reply-watch poller
// finds a matching reply and starts actively interpreting it (see
// pollReplyWatch/c.replyReading) - a real interim state between "waiting on
// a reply" and "resolved," instead of the chevron silently jumping straight
// to fully done once the (sometimes multi-second) AI interpretation finishes.
function ctaStepperHtml(c){
  const isBranch=CTA_BRANCH_CATEGORIES.includes(c.category) && c.steps.length===4;
  const done=c.steps.filter(ctaStepIsDone).length;
  let expandedIdx=c.steps.findIndex(s=>s.id===ceExpandedStepId);
  const reading=!!c.replyReading;
  const chevron=(s,i,cls)=>{
    const sDone=ctaStepIsDone(s);
    const isReading=cls==='reading';
    const label=isReading?'Reading reply…':(s.label==='Email drafted'?'Email sent':s.label);
    const marker=sDone?`<span class="ce-step-marker" title="Completed ${esc(fmtDate(s.doneAt||s.sentAt))}"></span>`:'';
    return `<div class="ce-step ${cls}${i===expandedIdx?' active':''}" onclick="ceToggleStepPanel('${s.id}')" title="${isReading?'Reply detected — interpreting it now':esc(label)}">${marker}${esc(label)}</div>`;
  };
  let stepperInner, firstOpenIdx;
  if(isBranch){
    // Steps 1 and 2 (Loop in sales / Meeting scheduled) are parallel, not
    // sequential - a plain "only the array-first unfinished step is current"
    // rule would wrongly gray out step 2 as if it were locked behind step 1.
    // Both are equally "current" (colored, actionable) the moment step 0
    // sends, independently of each other; step 3 only goes current once
    // BOTH of them are done.
    const emailDone=ctaStepIsDone(c.steps[0]), salesDone=ctaStepIsDone(c.steps[1]), meetingDone=ctaStepIsDone(c.steps[2]), resolvedDone=ctaStepIsDone(c.steps[3]);
    const curCls=reading?'reading':'current';
    const cls=[
      emailDone?'done':curCls,
      salesDone?'done':(emailDone?curCls:'pending-locked'),
      meetingDone?'done':(emailDone?curCls:'pending-locked'),
      resolvedDone?'done':((salesDone&&meetingDone)?curCls:'pending-locked'),
    ];
    firstOpenIdx = !emailDone?0 : !salesDone?1 : !meetingDone?2 : !resolvedDone?3 : -1;
    if(expandedIdx<0) expandedIdx=firstOpenIdx;
    stepperInner=`${chevron(c.steps[0],0,cls[0])}<div class="ce-branch-pair">${chevron(c.steps[1],1,cls[1])}${chevron(c.steps[2],2,cls[2])}</div>${chevron(c.steps[3],3,cls[3])}`;
  } else {
    firstOpenIdx=c.steps.findIndex(s=>!ctaStepIsDone(s));
    if(expandedIdx<0) expandedIdx=firstOpenIdx;
    stepperInner=c.steps.map((s,i)=>chevron(s,i,ctaStepIsDone(s)?'done':(i===firstOpenIdx?(reading?'reading':'current'):'pending-locked'))).join('');
  }
  return `<div class="mini" style="margin-bottom:2px">${done} of ${c.steps.length} steps complete · click any step to work it or review it${isBranch?' · loop-in and meeting run in parallel, either order':''}${reading?' · <b style="color:var(--amber)">reading the customer\'s reply now…</b>':''}</div>
  <div class="ce-stepper${isBranch?' ce-stepper-branch':''}" id="ceStepper">${stepperInner}</div>
  ${expandedIdx>=0?ctaStepPanelHtml(c,expandedIdx,c.steps[expandedIdx]):''}`;
}
function ctaStepPanelHtml(c,stepIdx,step){
  const type=ctaStepActionType(c,stepIdx);
  if(type==='send') return ctaSendStepPanelHtml(c,stepIdx,step);
  if(type==='sales_loop') return ctaSalesLoopStepPanelHtml(c,stepIdx,step);
  if(type==='schedule') return ctaScheduleStepPanelHtml(c,stepIdx,step);
  return ctaResolvedStepPanelHtml(c,stepIdx,step);
}
// Mirrors the escalation stepper's internal "Loop in product/engineering"
// pattern - defaults to a generic sales-team address, not a named AE, since
// there's no per-account sales-rep field in the data model (ownerName is
// already the CSM, not a separate AE). Same send/reopen/override/notes
// mechanics as every other step.
function ctaSalesLoopDefaultDraft(acctId){
  const a=STATE.accounts.find(x=>x.id===acctId);
  const ctx=emailCtx(a);
  return {
    to:'sales@axon.com',
    subject:`Loop-in needed — ${ctx.accountName}`,
    body:`Hi team,

Flagging ${ctx.accountName} for visibility on the sales side${ctx.riskBits.length?' — '+ctx.riskBits.join(', '):''}.

Account CSM: ${ctx.csmName}`
  };
}
function ctaSalesLoopStepPanelHtml(c,stepIdx,step){
  const overrideDone=step.done && step.detail && step.detail.override;
  const draft=step.detail || ctaSalesLoopDefaultDraft(c.accountId);
  return `<div class="card" style="box-shadow:none;margin:12px 0 0;background:var(--panel2)">
    <h4 style="margin:0 0 8px">${esc(step.label)} <span class="pill p-gray">Internal note</span> ${step.done?`<span class="pill p-green">${overrideDone?'Logged':'Sent'}</span>`:''}</h4>
    ${overrideDone
      ? `<div class="mini" style="font-style:italic">"${esc(step.detail.note)}"</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">
      <input type="text" id="ctaStepTo_${c.id}_${stepIdx}" class="select" value="${esc(step.detail?step.detail.to:(draft.to||''))}" placeholder="Recipient" ${step.done?'disabled':''}>
      <input type="text" id="ctaStepSubject_${c.id}_${stepIdx}" class="select" value="${esc(step.detail?step.detail.subject:(draft.subject||''))}" placeholder="Subject" ${step.done?'disabled':''}>
      <textarea id="ctaStepBody_${c.id}_${stepIdx}" class="select" rows="6" style="font:inherit" ${step.done?'disabled':''}>${esc(step.detail?step.detail.body:(draft.body||''))}</textarea>
    </div>`}
    <div class="row-actions" style="margin-top:10px">
      ${step.done
        ? `<button type="button" class="btn sm" onclick="reopenCtaStep('${c.id}','${step.id}')">Reopen this step</button>`
        : `<button type="button" class="btn sm primary" onclick="sendCtaSalesLoopEmail('${c.id}','${step.id}',${stepIdx})">Send</button>`}
    </div>
    ${step.done?`<div class="mini" style="margin-top:8px;color:var(--muted2)">${overrideDone?'Logged':'Sent'} ${esc(fmtDate(step.doneAt))}</div>`:''}
    ${ctaStepOverridePanelHtml(c,stepIdx,step)}
    ${ctaStepNotesHtml(c,stepIdx,step)}
  </div>`;
}
function sendCtaSalesLoopEmail(ctaId,stepId,stepIdx){
  saveCtaStepNotes(ctaId,stepIdx);
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const s=c.steps.find(x=>x.id===stepId); if(!s) return;
  const toEl=$('#ctaStepTo_'+ctaId+'_'+stepIdx), subjEl=$('#ctaStepSubject_'+ctaId+'_'+stepIdx), bodyEl=$('#ctaStepBody_'+ctaId+'_'+stepIdx);
  const to=(toEl&&toEl.value||'').trim(), subject=(subjEl&&subjEl.value||'').trim(), bodyText=(bodyEl&&bodyEl.value||'').trim();
  if(!subject||!bodyText){ toast('Add a subject and message body first.'); return; }
  s.detail={to,subject,body:bodyText,at:new Date().toISOString()};
  s.done=true; s.doneAt=s.detail.at;
  c.status=engagementCtaEffectiveStatus(c);
  saveEngagementCtas();
  const a=STATE.accounts.find(x=>x.id===c.accountId);
  emailDrafts.unshift({id:cid(),t:new Date().toISOString(),action:'sent',templateId:'cta_sales_loop',templateName:'Loop in sales',audience:'internal',acctId:c.accountId,acctName:a?a.name:'',subject,to,snippet:emailSnippet(bodyText)});
  emailDrafts=emailDrafts.slice(0,40); saveEmailDrafts();
  route();
}
// Mirrors ceEscSendStepPanelHtml exactly: editable fields pre-send, disabled
// fields + a Sent line post-send, a Reopen that un-sends it (rather than a
// dead end once you've moved past it), plus the same override/notes panels
// every other step gets. This is now the ONLY place the compose UI renders
// for a CTA's first step (no separate top-of-page draft card, which would
// otherwise duplicate this exact form) - the stepper defaults to expanding
// this step until it's sent, so it's visible immediately, no extra click.
function ctaSendStepPanelHtml(c,stepIdx,step){
  const overrideDone=step.sent && step.detail && step.detail.override;
  const a=STATE.accounts.find(x=>x.id===c.accountId);
  const isBranch=CTA_BRANCH_CATEGORIES.includes(c.category);
  return `<div class="card" style="box-shadow:none;margin:12px 0 0;background:var(--panel2)">
    <h4 style="margin:0 0 8px">${esc(step.label==='Email drafted'?'Email sent':step.label)} <span class="pill p-gray">Customer email</span> ${step.sent?`<span class="pill p-green">${overrideDone?'Logged':'Sent'}</span>`:''}</h4>
    ${overrideDone
      ? `<div class="mini" style="font-style:italic">"${esc(step.detail.note)}"</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">
      <input type="text" id="ceDraftTo_${c.id}" class="select" value="${esc(step.recipient||'')}" placeholder="Recipient" ${step.sent?'disabled':''}>
      ${isBranch?`<input type="text" id="ceDraftCc_${c.id}" class="select" value="${esc(step.cc||'')}" placeholder="Cc (sales)" ${step.sent?'disabled':''}>`:''}
      <input type="text" id="ceDraftSubject_${c.id}" class="select" value="${esc(step.subject||'')}" placeholder="Subject" ${step.sent?'disabled':''}>
      <textarea id="ceDraftBody_${c.id}" class="select" rows="8" style="font:inherit" ${step.sent?'disabled':''}>${esc(step.body||'')}</textarea>
    </div>`}
    <div class="row-actions" style="margin-top:10px">
      ${step.sent
        ? `<button type="button" class="btn sm" onclick="reopenCtaStep('${c.id}','${step.id}')">Reopen this step</button>`
        : `<button type="button" class="btn sm primary" onclick="sendEngagementCtaDraft('${c.id}')">Send</button>`}
      ${!step.sent?`<button type="button" class="btn sm" onclick="requestDiscardCta('${c.id}')">Discard</button>`:''}
      ${!step.sent&&a&&TEST10_ACCOUNTS.includes(a.name)?`<button type="button" class="btn sm" id="aiDraftBtn_cta_${c.id}" onclick="requestAiDraftForCta('${c.id}')">Create AI draft</button>`:''}
    </div>
    <div id="aiDraftStatus_cta_${c.id}" class="mini" style="margin-top:6px;color:var(--muted2)"></div>
    ${step.sent?`<div class="mini" style="margin-top:8px;color:var(--muted2)">${overrideDone?'Logged':'Sent'} ${esc(fmtDate(step.sentAt))}${step.cc?' · Cc: '+esc(step.cc):''}</div>`:''}
    ${ctaStepOverridePanelHtml(c,stepIdx,step)}
    ${ctaStepNotesHtml(c,stepIdx,step)}
  </div>`;
}
function ctaScheduleStepPanelHtml(c,stepIdx,step){
  const overrideDone=step.done && step.detail && step.detail.override;
  return `<div class="card" style="box-shadow:none;margin:12px 0 0;background:var(--panel2)">
    <h4 style="margin:0 0 8px">${esc(step.label)} ${step.done?`<span class="pill p-green">${overrideDone?'Logged':'Scheduled'}</span>`:''}</h4>
    ${step.done
      ? `<div class="mini" style="font-style:italic">${overrideDone?`"${esc(step.detail.note)}"`:`${step.detail&&step.detail.when?esc(step.detail.when)+' — ':''}${step.detail&&step.detail.note?esc(step.detail.note):''}`}</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">
        <input type="text" id="ctaStepWhen_${c.id}_${stepIdx}" class="select" placeholder="When (date/time)">
        <textarea id="ctaStepNote_${c.id}_${stepIdx}" class="select" rows="3" style="font:inherit" placeholder="Agenda / who's attending"></textarea>
      </div>`}
    <div class="row-actions" style="margin-top:10px">
      ${step.done
        ? `<button type="button" class="btn sm" onclick="reopenCtaStep('${c.id}','${step.id}')">Reopen this step</button>`
        : `<button type="button" class="btn sm primary" onclick="markCtaStepScheduled('${c.id}','${step.id}',${stepIdx})">Mark scheduled</button>`}
    </div>
    ${ctaStepOverridePanelHtml(c,stepIdx,step)}
    ${ctaStepNotesHtml(c,stepIdx,step)}
  </div>`;
}
function ctaResolvedStepPanelHtml(c,stepIdx,step){
  const overrideDone=step.done && step.detail && step.detail.override;
  return `<div class="card" style="box-shadow:none;margin:12px 0 0;background:var(--panel2)">
    <h4 style="margin:0 0 8px">${esc(step.label)} ${step.done?`<span class="pill p-green">${overrideDone?'Logged':'Resolved'}</span>`:''}</h4>
    ${step.done
      ? `<div class="mini" style="font-style:italic">"${esc((step.detail&&step.detail.note)||'')}"</div>`
      : `<textarea id="ctaStepNote_${c.id}_${stepIdx}" class="select" rows="4" style="font:inherit" placeholder="What was the resolution / outcome?"></textarea>`}
    <div class="row-actions" style="margin-top:10px">
      ${step.done
        ? `<button type="button" class="btn sm" onclick="reopenCtaStep('${c.id}','${step.id}')">Reopen this step</button>`
        : `<button type="button" class="btn sm primary" onclick="markCtaStepResolved('${c.id}','${step.id}',${stepIdx})">Confirm resolved</button>`}
    </div>
    ${ctaStepNotesHtml(c,stepIdx,step)}
  </div>`;
}
// Mirrors the escalation stepper's override mechanism - "did this a
// different way" (phone call, Slack, in person) logs a note and marks the
// step complete without going through the structured when/note fields above.
function ctaStepOverridePanelHtml(c,stepIdx,step){
  if(ctaStepIsDone(step)) return '';
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
    <div class="mini" style="margin-bottom:6px">Did this a different way (phone call, Slack, in person)? Log it here instead:</div>
    <textarea id="ctaStepOverrideNote_${c.id}_${stepIdx}" class="select" rows="2" style="font:inherit;width:100%;box-sizing:border-box"></textarea>
    <div class="row-actions" style="margin-top:8px">
      <button type="button" class="btn sm" onclick="logCtaStepOverride('${c.id}','${step.id}',${stepIdx})">Log &amp; mark complete</button>
    </div>
  </div>`;
}
// A plain running scratchpad per step, same as the escalation stepper's -
// separate from the schedule/resolve mechanics above, editable at any time
// including after the step is done. Same "select" class/width as the email
// draft fields above it, so it spans the full card width, not a narrow box.
function ctaStepNotesHtml(c,stepIdx,step){
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
    <div class="mini" style="margin-bottom:6px">Notes for this step</div>
    <textarea id="ctaStepNotes_${c.id}_${stepIdx}" class="select" rows="8" style="font:inherit;width:100%;box-sizing:border-box" onblur="saveCtaStepNotes('${c.id}',${stepIdx})">${esc(step.notes||'')}</textarea>
  </div>`;
}
function saveCtaStepNotes(ctaId,stepIdx){
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const el=$('#ctaStepNotes_'+ctaId+'_'+stepIdx); if(!el) return;
  const s=c.steps[stepIdx]; if(!s) return;
  s.notes=el.value;
  saveEngagementCtas();
}
function logCtaStepOverride(ctaId,stepId,stepIdx){
  saveCtaStepNotes(ctaId,stepIdx);
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const s=c.steps.find(x=>x.id===stepId); if(!s) return;
  const noteEl=$('#ctaStepOverrideNote_'+ctaId+'_'+stepIdx);
  const note=(noteEl&&noteEl.value||'').trim();
  if(!note){ toast('Add a quick note on what you actually did.'); return; }
  s.detail={override:true,note,at:new Date().toISOString()};
  if(s.type==='email'){ s.sent=true; s.sentAt=s.detail.at; } else { s.done=true; s.doneAt=s.detail.at; }
  c.status=engagementCtaEffectiveStatus(c);
  saveEngagementCtas();
  route();
}
function markCtaStepScheduled(ctaId,stepId,stepIdx){
  saveCtaStepNotes(ctaId,stepIdx);
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const s=c.steps.find(x=>x.id===stepId); if(!s) return;
  const whenEl=$('#ctaStepWhen_'+ctaId+'_'+stepIdx), noteEl=$('#ctaStepNote_'+ctaId+'_'+stepIdx);
  s.detail={when:(whenEl&&whenEl.value||'').trim(),note:(noteEl&&noteEl.value||'').trim(),at:new Date().toISOString()};
  s.done=true; s.doneAt=s.detail.at;
  c.status=engagementCtaEffectiveStatus(c);
  saveEngagementCtas();
  route();
}
function markCtaStepResolved(ctaId,stepId,stepIdx){
  saveCtaStepNotes(ctaId,stepIdx);
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const s=c.steps.find(x=>x.id===stepId); if(!s) return;
  const noteEl=$('#ctaStepNote_'+ctaId+'_'+stepIdx);
  s.detail={note:(noteEl&&noteEl.value||'').trim(),at:new Date().toISOString()};
  s.done=true; s.doneAt=s.detail.at;
  c.status=engagementCtaEffectiveStatus(c);
  saveEngagementCtas();
  route();
}
function reopenCtaStep(ctaId,stepId){
  const c=engagementCtas.find(x=>x.id===ctaId); if(!c) return;
  const s=c.steps.find(x=>x.id===stepId); if(!s) return;
  if(s.type==='email'){ s.sent=false; s.sentAt=null; } else { s.done=false; s.doneAt=null; }
  c.status=engagementCtaEffectiveStatus(c);
  saveEngagementCtas();
  route();
}
// Horizontal chevron stepper for the escalation resolution checklist -
// clickable fields, each one a distinct step in the flow: green = done,
// violet = the step you're on now, orange with a clock badge = you're on it
// and it's been sitting a while, gray = still ahead. Clicking an unfinished
// step opens the confirm-to-complete flow (requestCompleteEscStep) - it does
// not instantly toggle like the risk board's/Account 360's checkbox does.
// Which step's action panel is expanded on the currently-open CTA detail
// page - a step stays clickable whether it's done or not, so you can always
// jump back into it for context/audit trail, not just while it's pending.
let ceExpandedStepId=null;
function ceToggleStepPanel(stepId){
  ceExpandedStepId = ceExpandedStepId===stepId ? null : stepId;
  route();
  setTimeout(()=>{ const el=$('#ceStepper'); if(el) el.scrollIntoView({behavior:'smooth',block:'center'}); },30);
}
function engagementEscStepperHtml(acctId,ctaId){
  const st=peekEscState(acctId);
  const done=st.steps.filter(s=>s.done).length;
  const firstOpenIdx=st.steps.findIndex(s=>!s.done);
  const openedDaysAgo=st.openedAt?Math.floor((Date.now()-new Date(st.openedAt).getTime())/864e5):0;
  const expandedIdx=st.steps.findIndex(s=>s.id===ceExpandedStepId);
  return `<div class="mini" style="margin-bottom:2px">Escalation resolution — ${done} of ${st.steps.length} steps complete · click any step to work it or review it</div>
  <div class="ce-stepper" id="ceStepper">${st.steps.map((s,i)=>{
    const isCurrent=i===firstOpenIdx;
    const isOverdue=isCurrent && openedDaysAgo>=7;
    const cls=s.done?'done':isOverdue?'overdue':isCurrent?'current':'pending-locked';
    const marker=s.done?`<span class="ce-step-marker" title="Completed ${esc(fmtDate(s.doneAt))}"></span>`:isOverdue?`<span class="ce-step-marker clock" title="Sitting ${openedDaysAgo}d — needs attention">⏱</span>`:'';
    return `<div class="ce-step ${cls}${s.id===ceExpandedStepId?' active':''}" onclick="ceToggleStepPanel('${s.id}')" title="${esc(s.label)}">${marker}${esc(s.label)}</div>`;
  }).join('')}</div>
  ${expandedIdx>=0?ceEscStepPanelHtml(acctId,ctaId,expandedIdx,st.steps[expandedIdx]):''}`;
}
// Each step points at the real action it means, not a bare checkbox: send an
// editable email (customer-facing, or internal for the engineering hand-off),
// log what came back from the customer, or confirm the close-out - and once
// done, the panel switches to a read-only audit view with a way to reopen it.
function ceEscStepPanelHtml(acctId,ctaId,stepIdx,step){
  const type=ESC_STEP_ACTIONS[stepIdx]||'confirm';
  if(type==='send') return ceEscSendStepPanelHtml(acctId,ctaId,stepIdx,step);
  if(type==='receive') return ceEscReceiveStepPanelHtml(acctId,ctaId,stepIdx,step);
  return ceEscConfirmStepPanelHtml(acctId,ctaId,stepIdx,step);
}
// Internal steps (looping in product/engineering) shouldn't default to a
// customer template's recipient - they need a real internal address, not the
// customer's contact, so this fills a purpose-built draft addressed to
// engineering instead of reusing the customer-facing cust_save template.
function ceStepDefaultDraft(acctId,stepIdx){
  if(ESC_STEP_AUDIENCE[stepIdx]==='internal'){
    const a=STATE.accounts.find(x=>x.id===acctId);
    const ctx=emailCtx(a);
    return {
      to:'engineering@axon.com',
      subject:`Escalation — need product/engineering input on ${ctx.accountName}`,
      body:`Hi team,

Looping you in on an active escalation for ${ctx.accountName} that needs product/engineering input to move forward.

Context
${ctx.riskBits?`• ${ctx.riskBits}`:'• See escalation notes on Account 360'}

Ask
• Confirm feasibility / timeline for a fix or workaround
• Flag any known issues or in-flight work already covering this

Account CSM: ${ctx.csmName}

Thanks,
${ctx.csmName}`
    };
  }
  return buildEmailDraft('cust_save',acctId) || {};
}
// Shown on every send/receive step - not everything happens by email (a
// phone call, a Slack thread, an in-person conversation), so this lets the
// CSM record what actually happened in their own words and move on, instead
// of forcing an email/log entry that didn't really occur. Same completion
// state either way (step.detail.override marks which path was used) so the
// timeline and audit trail read the same regardless of how it was done.
function ceEscOverridePanelHtml(acctId,stepId,stepIdx,step){
  if(step.done) return '';
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
    <div class="mini" style="margin-bottom:6px">Did this a different way (phone call, Slack, in person)? Log it here instead:</div>
    <textarea id="ceStepOverrideNote_${stepIdx}" class="select" rows="2" style="font:inherit;width:100%;box-sizing:border-box"></textarea>
    <div class="row-actions" style="margin-top:8px">
      <button type="button" class="btn sm" onclick="logEscStepOverride('${acctId}','${step.id}',${stepIdx})">Log &amp; mark complete</button>
    </div>
  </div>`;
}
// A plain running scratchpad per step - separate from the send/receive/
// override mechanics above, kept regardless of how (or whether) the step
// gets marked complete, and editable at any time, including after it's done.
function ceEscNotesHtml(acctId,stepId,stepIdx,step){
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
    <div class="mini" style="margin-bottom:6px">Notes for this step</div>
    <textarea id="ceStepNotes_${stepIdx}" class="select" rows="8" style="font:inherit;width:100%;box-sizing:border-box" onblur="saveEscStepNotes('${acctId}','${stepId}',${stepIdx})">${esc(step.notes||'')}</textarea>
  </div>`;
}
function saveEscStepNotes(acctId,stepId,stepIdx){
  const el=$('#ceStepNotes_'+stepIdx); if(!el) return;
  const cur=ensureEscState(acctId); const s=cur.steps.find(x=>x.id===stepId); if(!s) return;
  s.notes=el.value;
  LS.set('escState',escState);
}
function ceEscSendStepPanelHtml(acctId,ctaId,stepIdx,step){
  const audience=ESC_STEP_AUDIENCE[stepIdx]||'customer';
  const draft=step.detail || ceStepDefaultDraft(acctId,stepIdx);
  const overrideDone=step.done && step.detail && step.detail.override;
  return `<div class="card" style="box-shadow:none;margin:12px 0 0;background:var(--panel2)">
    <h4 style="margin:0 0 8px">${esc(step.label)} <span class="pill p-gray">${audience==='internal'?'Internal note':'Customer email'}</span> ${step.done?`<span class="pill p-green">${overrideDone?'Logged':'Sent'}</span>`:''}</h4>
    ${overrideDone
      ? `<div class="mini" style="font-style:italic">"${esc(step.detail.note)}"</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">
      <input type="text" id="ceStepTo_${stepIdx}" class="select" value="${esc(step.detail?step.detail.recipient:(draft.to||''))}" placeholder="Recipient" ${step.done?'disabled':''}>
      <input type="text" id="ceStepSubject_${stepIdx}" class="select" value="${esc(step.detail?step.detail.subject:(draft.subject||''))}" placeholder="Subject" ${step.done?'disabled':''}>
      <textarea id="ceStepBody_${stepIdx}" class="select" rows="6" style="font:inherit" ${step.done?'disabled':''}>${esc(step.detail?step.detail.body:(draft.body||''))}</textarea>
    </div>`}
    <div class="row-actions" style="margin-top:10px">
      ${step.done
        ? `<button type="button" class="btn sm" onclick="reopenEscStep('${acctId}','${step.id}')">Reopen this step</button>`
        : `<button type="button" class="btn sm primary" onclick="sendEscStepEmail('${acctId}','${step.id}',${stepIdx})">Send</button>`}
      ${!step.done&&isTest10Account(acctId)?`<button type="button" class="btn sm" id="aiDraftBtn_esc_${acctId}_${stepIdx}" onclick="requestAiDraftForEscStep('${acctId}',${stepIdx})">Create AI draft</button>`:''}
    </div>
    <div id="aiDraftStatus_esc_${acctId}_${stepIdx}" class="mini" style="margin-top:6px;color:var(--muted2)"></div>
    ${step.done?`<div class="mini" style="margin-top:8px;color:var(--muted2)">${overrideDone?'Logged':'Sent'} ${esc(fmtDate(step.doneAt))}</div>`:''}
    ${ceEscOverridePanelHtml(acctId,step.id,stepIdx,step)}
    ${ceEscNotesHtml(acctId,step.id,stepIdx,step)}
  </div>`;
}
function ceEscReceiveStepPanelHtml(acctId,ctaId,stepIdx,step){
  const overrideDone=step.done && step.detail && step.detail.override;
  return `<div class="card" style="box-shadow:none;margin:12px 0 0;background:var(--panel2)">
    <h4 style="margin:0 0 8px">${esc(step.label)} <span class="pill p-gray">Log what came back</span> ${step.done?'<span class="pill p-green">Logged</span>':''}</h4>
    ${overrideDone
      ? `<div class="mini" style="font-style:italic">"${esc(step.detail.note)}"</div>`
      : `<div style="display:flex;flex-direction:column;gap:6px">
      <input type="text" id="ceStepFrom_${stepIdx}" class="select" value="${esc(step.detail?step.detail.from||'':'')}" placeholder="From (customer contact)" ${step.done?'disabled':''}>
      <textarea id="ceStepBody_${stepIdx}" class="select" rows="6" style="font:inherit" placeholder="Paste or summarize what they said back" ${step.done?'disabled':''}>${esc(step.detail?step.detail.body||'':'')}</textarea>
    </div>`}
    <div class="row-actions" style="margin-top:10px">
      ${step.done
        ? `<button type="button" class="btn sm" onclick="reopenEscStep('${acctId}','${step.id}')">Reopen this step</button>`
        : `<button type="button" class="btn sm primary" onclick="logEscStepReceived('${acctId}','${step.id}',${stepIdx})">Log received &amp; mark complete</button>`}
    </div>
    ${step.done?`<div class="mini" style="margin-top:8px;color:var(--muted2)">Logged ${esc(fmtDate(step.doneAt))}</div>`:''}
    ${ceEscOverridePanelHtml(acctId,step.id,stepIdx,step)}
    ${ceEscNotesHtml(acctId,step.id,stepIdx,step)}
  </div>`;
}
function ceEscConfirmStepPanelHtml(acctId,ctaId,stepIdx,step){
  return `<div class="card" style="box-shadow:none;margin:12px 0 0;background:var(--panel2)">
    <h4 style="margin:0 0 8px">${esc(step.label)} ${step.done?'<span class="pill p-green">Closed</span>':''}</h4>
    <p class="mini">Confirms the escalation is fully worked and closes it out — review the timeline below before confirming.</p>
    <div class="row-actions" style="margin-top:10px">
      ${step.done
        ? `<button type="button" class="btn sm" onclick="reopenEscStep('${acctId}','${step.id}')">Reopen this step</button>`
        : `<button type="button" class="btn sm primary" onclick="confirmCloseOutEscStep('${acctId}','${step.id}',${stepIdx})">Confirm close-out</button>`}
    </div>
    ${ceEscNotesHtml(acctId,step.id,stepIdx,step)}
  </div>`;
}
function logEscStepOverride(acctId,stepId,stepIdx){
  saveEscStepNotes(acctId,stepId,stepIdx);
  const noteEl=$('#ceStepOverrideNote_'+stepIdx);
  const note=(noteEl&&noteEl.value||'').trim();
  if(!note){ toast('Add a quick note on what you actually did.'); return; }
  const cur=ensureEscState(acctId); const s=cur.steps.find(x=>x.id===stepId); if(!s) return;
  s.detail={override:true,note,at:new Date().toISOString()};
  s.done=true; s.doneAt=s.detail.at;
  LS.set('escState',escState);
  route();
}
function sendEscStepEmail(acctId,stepId,stepIdx){
  saveEscStepNotes(acctId,stepId,stepIdx);
  const to=$('#ceStepTo_'+stepIdx), subj=$('#ceStepSubject_'+stepIdx), body=$('#ceStepBody_'+stepIdx);
  const subject=(subj&&subj.value||'').trim(), bodyText=(body&&body.value||'').trim(), recipient=(to&&to.value||'').trim();
  if(!subject||!bodyText){ toast('Add a subject and message body first.'); return; }
  const cur=ensureEscState(acctId); const s=cur.steps.find(x=>x.id===stepId); if(!s) return;
  s.detail={subject,body:bodyText,recipient,at:new Date().toISOString()};
  s.done=true; s.doneAt=s.detail.at;
  LS.set('escState',escState);
  const a=STATE.accounts.find(x=>x.id===acctId);
  const audience=ESC_STEP_AUDIENCE[stepIdx]||'customer';
  const escCta=engagementCtas.find(x=>x.accountId===acctId && x.category==='escalation');
  emailDrafts.unshift({id:cid(),t:new Date().toISOString(),action:'sent',templateId:'escalation_step',templateName:'Escalation — '+s.label,audience,acctId,acctName:a?a.name:'',subject,to:recipient,snippet:emailSnippet(bodyText),ctaId:escCta?escCta.id:null,stage:s.label});
  emailDrafts=emailDrafts.slice(0,40); saveEmailDrafts();
  if(audience==='customer') sendTest10DemoEmail(acctId,subject,bodyText);
  if(audience==='customer' && a){
    pushActivityEntry(acctId,'Email',subject,'Sent as part of escalation step: '+s.label);
    syncLastActFromActivity(acctId);
    try{ scoreAccount(a); }catch(e){}
  }
  route();
}
function logEscStepReceived(acctId,stepId,stepIdx){
  saveEscStepNotes(acctId,stepId,stepIdx);
  const from=$('#ceStepFrom_'+stepIdx), body=$('#ceStepBody_'+stepIdx);
  const bodyText=(body&&body.value||'').trim();
  if(!bodyText){ toast('Log what came back before marking this complete.'); return; }
  const cur=ensureEscState(acctId); const s=cur.steps.find(x=>x.id===stepId); if(!s) return;
  s.detail={from:(from&&from.value||'').trim(),body:bodyText,at:new Date().toISOString()};
  s.done=true; s.doneAt=s.detail.at;
  LS.set('escState',escState);
  route();
}
function confirmCloseOutEscStep(acctId,stepId,stepIdx){
  saveEscStepNotes(acctId,stepId,stepIdx);
  const cur=ensureEscState(acctId); const s=cur.steps.find(x=>x.id===stepId); if(!s) return;
  s.done=true; s.doneAt=new Date().toISOString();
  LS.set('escState',escState);
  route();
}
// Reopening un-does the checkbox but keeps the recorded content (detail) as
// an audit trail - so you can toggle a step back and forth without losing
// the record of what was actually sent or received.
function reopenEscStep(acctId,stepId){
  const cur=ensureEscState(acctId); const s=cur.steps.find(x=>x.id===stepId); if(!s) return;
  s.done=false; s.doneAt=null;
  LS.set('escState',escState);
  route();
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
  return `<div class="card"><h3>Case Watch</h3>
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
  return `<div class="card"><h3>Usage &amp; Adoption</h3>
  ${noData?`<p class="mini" style="color:var(--muted)">${noData} account${noData===1?'':'s'} not yet in the usage export</p>`:''}
  <div class="kpis" style="margin:14px 0 0">${kpis.map(k=>`<div class="kpi${k[3]?' clickable':''}${/Not adopting/.test(k[0])?' accent':''}${usageKpiFilter===k[3]&&k[3]?' selected':''}"${k[3]?` onclick="setUsageKpi('${k[3]}')"`:''}><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div></div>
  <div class="card"><h3>Accounts by adoption <span class="hint">lowest adoption first${usageKpiFilter?' · filtered':''}</span></h3>
  <div class="searchbar"><input id="usearch" placeholder="Filter accounts…" oninput="filterTable(this,'utbl')"></div>
  <table id="utbl"><thead><tr><th>Account</th><th>Owner</th><th class="num">Adoption</th><th class="num">Active / Licensed</th><th class="num">Trend</th><th class="num">To goal</th><th class="num">Synced</th></tr></thead><tbody>
  ${sorted.map(a=>{const u=a.usage;const cp=commissionPct(a);return `<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${ownerCell(a.ownerName)}</td><td>${adoptionPill(a)}</td><td class="num">${(u.active||0).toLocaleString()} / ${(u.licensed||0).toLocaleString()}</td><td class="num">${usageTrendHtml(u.trend)}</td><td>${cp==null?'—':commissionPill(a)}</td><td class="num">${u.sync?esc(fmtDate(u.sync)):'—'}</td></tr>`;}).join('')}
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
  return `<div class="card"><h3>TAP Refreshes</h3>
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
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Refresh checklist <span class="hint">${prog}% complete</span></h3>
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
  saveCtas(); toast('TAP Refresh CTA added.');
}

// ---- Resource Library (guides / SOPs / internal resources) ----
function viewResources(){
  const cats=resourceCategories();
  return `<div class="card"><h3>Resource Library</h3>
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
    return `<div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Usage &amp; adoption</h3>
      <p class="mini">No usage data available for this account.</p></div>`;
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
function openAcct(id){ currentAcctView=id; currentEngagementCtaId=null; currentCsmView=null; currentPredictiveAcctId=null; currentPlanAcctId=null; currentPlanMilestone=null; route(); window.scrollTo(0,0); }
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
  const c=csatVal(a);
  const compRows=a.comps.length?a.comps.map(c=>`<div>${esc(c[0])}</div><div class="${c[1]<0?'neg':'pos'}">${c[1]}</div>`).join(''):'<div class="mini">No penalties — full health.</div>';
  const opps=a.opps.slice().sort((x,y)=>(x.close>y.close?1:-1));
  const resolvedRate = a.lifeCases>0 ? Math.round((a.lifeCases-a.openCases)/a.lifeCases*100) : null;
  const sentColor = a.sentiment==null?'var(--muted)':a.sentTier==='pos'?'var(--green)':a.sentTier==='neu'?'var(--amber)':'var(--red)';
  const hasPlan=!!plans[id];
  return `<div class="card acct-hd"><div class="hd"><div><h2>${esc(a.name)} ${stateTag(a)}</h2><div class="mini" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">Owner ${ownerCell(a.ownerName)}${a.ownerTitle?' ('+esc(a.ownerTitle)+')':''}${newLogo(a)?' · <b>New logo</b>':''} · ${segmentPill(a)} ${cadencePill(a)} ${opportunityPill(a)}${a.industry?' · '+esc(a.industry)+(a.employeeCount?' · ~'+a.employeeCount.toLocaleString()+' employees':''):''}</div></div><button class="btn sm" onclick="closeAcctView()">← Back</button></div></div>
  <div class="bd">
    <div class="row-actions" style="margin-bottom:16px">
      <button type="button" class="btn" onclick="viewEngagementForAccount('${a.id}')">View Engagement</button>
      <button type="button" class="btn" onclick="viewRiskForAccount('${a.id}')">View Accounts &amp; Risk</button>
      <button type="button" class="btn primary" onclick="createOrOpenPlan('${a.id}')">${hasPlan?'View Success Plan':'Create Success Plan'}</button>
    </div>
    <div class="kpis" style="margin-bottom:16px">
      <div class="kpi"><div class="l">Health</div><div class="v" style="color:${a.health==null?'var(--muted)':a.health>=75?'var(--green)':a.health>=50?'var(--amber)':'var(--red)'}">${a.health==null?'—':a.health}</div><div class="d">${tierPill(a.tier)}</div></div>
      <div class="kpi"><div class="l">CSAT</div><div class="v" style="color:${csatColor(c.v)}">${c.v==null?'—':c.v+'%'}</div><div class="d">${c.v==null?'no data':csatFace(c.v)+(c.src==='placeholder'?' · placeholder':' · set by CSM')}</div></div>
      <div class="kpi"><div class="l">NPS</div><div class="v" style="color:${a.nps==null?'var(--muted)':a.nps>=9?'var(--green)':a.nps>=7?'var(--amber)':'var(--red)'}">${a.nps==null?'—':a.nps+'/10'}</div><div class="d">${a.nps==null?'no survey response':npsClassify(a.nps)+(a.npsDate?' · '+esc(a.npsDate):'')}${orgFeatureFlags.npsTrend&&a.npsHistory?' · trend '+a.npsHistory.map(h=>h.score).join('→'):''}</div></div>
      <div class="kpi"><div class="l">Sentiment</div><div class="v" style="color:${sentColor}">${a.sentiment==null?'—':a.sentiment}</div><div class="d">${sentPill(a)}</div></div>
      <div class="kpi"><div class="l">Annualized revenue</div><div class="v">${fmtMoney(a.ltv)}</div><div class="d">${a.pastDeals} closed-won deals</div></div>
      <div class="kpi"><div class="l">Total Contract Value</div><div class="v">${fmtMoney(a.renewalAmount)}</div><div class="d">${a.dclose>9000?'—':'closes in '+a.dclose+' days'}</div></div>
      <div class="kpi"><div class="l">Open cases</div><div class="v">${a.openCases}</div><div class="d">${a.highCases} high/urgent</div></div>
      <div class="kpi${(a.casesBlocked||a.casesAging)?' accent':''}"><div class="l">Blocked / Aging</div><div class="v">${a.casesBlocked||0} / ${a.casesAging||0}</div><div class="d">cases to escalate</div></div>
      <div class="kpi"><div class="l">Growth (all-time)</div><div class="v">${fmtMoney((a.growth&&(a.growth.Renewal+a.growth.Expansion+a.growth.Transactional))||0)}</div><div class="d">Renewal/Expansion/Transactional</div></div>
      <div class="kpi"><div class="l">Adoption</div><div class="v" style="color:${adoptionColor(adoptionTier(a))}">${a.usage&&a.usage.adoptionPct!=null?a.usage.adoptionPct+'%':'—'}</div><div class="d">${a.usage&&a.usage.adoptionPct!=null?ADOPT_META[adoptionTier(a)][1]:'no usage data'}</div></div>
    </div>


    <div class="acct-grid">
    <div class="full">${usageCard(a)}</div>

    <div class="full">${teamRosterCard(a)}</div>

    ${orgFeatureFlags.productLineScorecard?`<div class="full">${productScorecardCardHtml(a)}</div>`:''}

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Customer satisfaction (CSAT)</h3>
      <div class="csat-wrap">
        <div class="csat-num" style="color:${csatColor(c.v)}">${c.v==null?'—':c.v+'%'}</div>
        <div><div class="csat-face" style="color:${csatColor(c.v)}">${c.v==null?'No rating':csatFace(c.v)}</div><div class="mini">${c.src==='manual'?'Set manually by a CSM':c.src==='placeholder'?'Derived from support sentiment':'No data yet'}</div></div>
      </div>
      <div class="row-actions" style="margin-top:12px">
        <label class="mini">Set CSAT %</label>
        <input type="number" min="0" max="100" value="${c.v==null?'':c.v}" style="width:90px;border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onchange="setCsat('${a.id}',this.value);openAcct('${a.id}')">
        ${csat[a.id]!=null?`<button class="btn sm" onclick="setCsat('${a.id}','');openAcct('${a.id}')">Clear override</button>`:''}
      </div>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Renewal readiness <span class="hint">${a.readiness}% ready to renew</span></h3>
      <div class="progress"><i style="width:${a.readiness}%"></i></div>
      <div class="comp" style="grid-template-columns:1fr auto;margin-top:12px">
        ${readinessChecklist(a).map(c=>`<div>${esc(c[0])}</div><div class="${c[1]?'pos':'neg'}">${c[1]?'✓':'—'}</div>`).join('')}
      </div>
    </div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Purchase history & lifetime value</h3>
      <div class="comp" style="grid-template-columns:1fr auto;margin-bottom:12px">
        <div>Annualized revenue (closed-won)</div><div class="pos">${fmtFull(a.ltv)}</div>
        <div>Closed-won deals</div><div><b>${a.pastDeals}</b></div>
        <div>First purchase</div><div><b>${a.firstPurchase?esc(a.firstPurchase):'—'}</b></div>
        <div>Most recent purchase</div><div><b>${a.lastPurchase?esc(a.lastPurchase):'—'}</b></div>
      </div>
      <div class="chartbox" style="height:220px;margin-bottom:14px"><canvas id="acctDealsChart"></canvas></div>
      <div id="acctDeals"><div class="mini">Loading recent deals…</div></div>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Products purchased</h3>
      <div class="chartbox" style="height:220px;margin-bottom:14px"><canvas id="acctProdChart"></canvas></div>
      <div id="acctProducts"><div class="mini">Loading products…</div></div>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Customer insights</h3>
      <textarea class="notes-in" id="insightIn" placeholder="What did we learn about this customer?"></textarea>
      <div class="row-actions" style="margin-top:6px"><button class="btn" onclick="addInsight('${a.id}',document.getElementById('insightIn').value);openAcct('${a.id}')">Log insight</button></div>
      <div class="tl" style="margin-top:12px">${(insights[a.id]&&insights[a.id].length)?insights[a.id].slice().reverse().map(n=>`<div class="ev"><div class="t">${new Date(n.t).toLocaleString()}</div><div>${esc(n.note)}</div></div>`).join(''):'<span class="mini">No insights logged yet for this account.</span>'}</div>
    </div>

    ${surveyCard(a)}

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Resources &amp; guides <span class="hint">shared library — <a href="#" onclick="setTab('resources');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">manage in Resource Library</a></span></h3>
      ${resources.length?`<div class="reslist">${resources.map(r=>`<div class="resrow">${catTag(r.category,'margin-right:8px')}<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></div>`).join('')}</div>`:'<p class="mini">No resources in the library yet.</p>'}
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Customer sentiment</h3>
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

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Health breakdown</h3>
      <div class="chartbox" style="height:200px;margin-bottom:14px"><canvas id="acctHealthChart"></canvas></div>
      <div class="comp"><div><b>Base</b></div><div class="pos">100</div>${compRows}<div style="border-top:1px solid var(--line-soft);padding-top:6px"><b>Score</b></div><div style="border-top:1px solid var(--line-soft);padding-top:6px"><b>${a.health}</b></div></div></div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Open renewals</h3><table><tbody>${opps.map(o=>`<tr style="cursor:default"><td>${esc(o.name)}</td><td>${esc(o.stage)}</td><td class="num">${fmtMoney(o.amount)}</td><td class="num">${esc(o.close)}</td></tr>`).join('')}</tbody></table></div>
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

function cid(){ return 'c'+Math.random().toString(36).slice(2,9); }
// The old standalone "CTAs" nav page (viewCTAs, its bulk-admin tooling, and
// auto-suggestion engine) was removed - Escalations and Active CTAs now cover
// that ground with a real record/checklist per account instead of a flat
// to-do list. `ctas` itself (the underlying array) stays, since a few other
// surfaces still read/write it: nextScheduledTouch's "next due" badge on the
// risk card, quickCta/quickTapCta's quick-add buttons on Account 360, and the
// CSV export's OpenCTAs column.
function quickCta(id){ const t=prompt('New action item (CTA) for this account:'); if(!t) return; const a=STATE.accounts.find(x=>x.id===id); ctas.push({id:cid(),type:'CS Request',acctId:id,name:a?a.name:'',priority:'Medium',due:sfDate(new Date(Date.now()+14*864e5)),title:t.trim(),status:'Open',source:'Manual',createdAt:new Date().toISOString()}); saveCtas(); toast('CTA added.'); }

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
  {id:'cust_onboarding_nudge',audience:'customer',name:'Onboarding milestone nudge',desc:'Check in when an onboarding milestone has slipped - mid-rollout, not a first kickoff.',
    suggest:a=>newLogo(a)&&!!plans[a.id],
    fill:ctx=>emailFillCustomer(ctx,`Keeping ${ctx.accountName}'s onboarding on track`,
`Hi ${ctx.greetingName},

Checking in on where things stand with onboarding — [milestone] looks like it slipped past its target date, and I want to make sure nothing's blocking your team.

Could we grab 20 minutes to:
• Confirm what's still needed on both sides
• Reset a realistic date if the original one no longer works
• Clear any blockers before the next milestone comes up

What's your availability this week?

Thanks,
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
    fill:ctx=>emailFillCustomer(ctx,`TAP / hardware refresh for ${ctx.accountName} — ~${ctx.tapMonthsAway} month${ctx.tapMonthsAway===1?'':'s'} out`,
`Hi ${ctx.greetingName},

Our records show ${ctx.accountName}'s TAP (hardware warranty) refresh window opening in about ${ctx.tapMonthsAway} month${ctx.tapMonthsAway===1?'':'s'}${ctx.tapLabel?` (currently tracking as ${ctx.tapLabel})`:''}.

Getting ahead of it now protects warranty coverage and keeps devices in a supported state. I'd like to walk through:
• Exact unit counts and models due for refresh
• Timing that minimizes operational impact for your team
• Any RMAs or logistics we should line up now, well before the window opens

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
  {id:'cust_expansion',audience:'customer',name:'Cross-sell / expansion',desc:'Proactive pitch when an established account has never expanded.',
    suggest:a=>{ const g=a.growth||{}; const attach=a.ltv>0?((g.Expansion||0)+(g.Transactional||0))/a.ltv:0; return (a.pastDeals||0)>=2 && attach<0.05; },
    fill:ctx=>emailFillCustomer(ctx,`Growing with ${ctx.accountName}`,
`Hi ${ctx.greetingName},

You've been a valued partner, and I don't think we've properly explored where else Axon could help ${ctx.accountName} beyond what you're using today.

I'd like to walk through:
• Other teams or use cases at ${ctx.accountName} that might benefit
• Product lines we haven't discussed yet
• What a pilot or expansion could look like, on your timeline

Worth 20 minutes to explore, no pressure either way?

Thanks,
${ctx.csmName}${ctx.csmTitle}`)},
  {id:'cust_checkin',audience:'customer',name:'Overdue check-in',desc:'Proactive outreach when it has been too long since the last touch - not a post-meeting recap.',
    suggest:a=>a.dsAct!=null&&a.dsAct>(a.expectedCadenceDays||60),
    fill:ctx=>emailFillCustomer(ctx,`Checking in — it's been a while, ${ctx.accountName}`,
`Hi ${ctx.greetingName},

It's been a bit since we last connected, and I wanted to check in before too much time goes by.

Quick things I'd love to cover:
• How things are going day-to-day
• Anything blocking your team right now
• Whether there's a better regular cadence for us going forward

Do you have 20 minutes in the next week or two?

Best,
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
    if(a.casesAging) riskBits.push(`${a.casesAging} aging case(s)`);
    if(a.nps!=null&&a.nps<=6) riskBits.push(`NPS ${a.nps}/10`);
    if(a.sentTier==='neg') riskBits.push('strained sentiment from support history');
    if(a.dsAct!=null&&a.dsAct>90) riskBits.push(`${a.dsAct}d since last touch`);
    if(a.openCases>=RISK_CASE_VOLUME_SPIKE_THRESHOLD) riskBits.push(`${a.openCases} open cases (volume spike)`);
    if(a.hasExecSponsor===false) riskBits.push('no executive sponsor on file');
  }
  const tapLabel=a&&a.tapStatus==='overdue'?'overdue':a&&a.tapStatus==='duesoon'?'due within 90 days':'';
  // Fabricated but deterministic (per-account, not re-randomized every draft) -
  // a concrete "N months away" detail for TAP outreach, independent of the
  // real tapStatus field so a manually-simulated tap_refresh_due trigger still
  // gets a specific, crafted number rather than a generic label.
  const tapMonthsAway = a ? 1+(hashStr(a.id)%6) : null;
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
    tapLabel, tapMonthsAway,
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
    to:isTest10Account(acctId)?TEST10_DEMO_INBOX:(filled.to||''), cc:filled.cc||'', subject:filled.subject||'', body:filled.body||'',
    confirmed:false, aiRequestId:'email_'+cid()
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
    acctName:a?a.name:'', subject:emailCompose.subject, to:emailCompose.to,
    snippet:emailSnippet(emailCompose.body), source:emailCompose.source||'outreach',
    ctaId:null, stage:tpl?tpl.name:''
  });
  emailDrafts=emailDrafts.slice(0,40);
  saveEmailDrafts();
  // Test10 only - everywhere else this app deliberately never sends mail
  // itself (review yourself, then copy/open in your own client); Test10
  // accounts are the one sandboxed exception so the whole demo chain works
  // end to end against a real inbox.
  sendTest10DemoEmail(emailCompose.acctId,emailCompose.subject,emailCompose.body);
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
        ${d.acctId&&isTest10Account(d.acctId)?`<button type="button" class="btn sm" id="aiDraftBtn_emailCompose" onclick="requestAiDraftForEmailCompose()">Create AI draft</button>`:''}
      </div>
      <div id="aiDraftStatus_emailCompose" class="mini" style="margin-top:6px;color:var(--muted2)"></div>
      <p class="mini" style="margin-top:10px;color:var(--muted)">Nothing is emailed from this app. After you send from your client, the draft is logged here${d.audience==='customer'?' and as Email activity on the account':''}.</p>
    </div></div>`;
  }

  if(hist.length){
    html+=`<div class="card" id="emailHistoryCard"><h3>Recently prepared</h3>
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
Object.assign(window,{setScope,openAcct,closeSheet,setRenewSort,setWeight,saveWeights,resetWeights,filterTable,toggleComm,setTab,
  setEscStatus,
  setEscReason,setEscProduct,toggleEscStep,
  setCsat,createOrOpenPlan,openPlan,closePlan,setPlanObjectives,setPlanNotes,togglePlanMs,editPlanMsTitle,editPlanMsDue,addPlanMs,removePlanMs,regenPlan,delPlan,
  openPlanMilestoneNode,openPlanMilestonePage,closePlanMilestone,setStepDetail,setStepNote,togglePlanStepDone,addStepResource,addStepResourceFromPicker,removeStepResource,sendPlanMilestoneEmail,requestAiDraftForPlanMilestone,openTalkTrack,copyTalkTrack,regenPlanAs,
  setOwnerFilter,quickCta,
  addInsight,delResource,submitResource,setTarget,setAdoptionCfg,setUsageKpi,
  logActivity,delActivity,saveNextStep,clearNextStep,
  openCsmDrilldown,openCsmImprove,openCsmProfile,closeCsmProfile,runCsmImproveAction,
  startEmailCompose,composeEmailForAcct,emailPickTemplate,emailPickAcct,emailSetAudience,toggleEmailTplMenu,
  emailSyncFields,emailOnConfirmToggle,emailCopyAll,emailOpenMailto,emailClearCompose,toast});

boot();
