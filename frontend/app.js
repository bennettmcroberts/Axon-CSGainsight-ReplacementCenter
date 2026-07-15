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
const LS = {
  get(k,d){try{const v=localStorage.getItem('axoncs_'+k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem('axoncs_'+k,JSON.stringify(v))}catch(e){}}
};
const DEFAULT_WEIGHTS={openCase:2,highSev:9,proxNear:22,proxMid:10,stageRisk:12,engage:16};
let WEIGHTS = Object.assign({}, DEFAULT_WEIGHTS, LS.get('weights',{}));
let escState = LS.get('escState',{});     // acctId -> {status, log:[]}
let csat = LS.get('csat',{});             // acctId -> number 0-100 (manual override)
let plans = LS.get('plans',{});           // acctId -> plan object
function savePlans(){ LS.set('plans',plans); }
let ctas = LS.get('ctas',[]);             // Calls to Action (action items for CSMs)
function saveCtas(){ LS.set('ctas',ctas); }
let journeyState = LS.get('journeyState',{}); // {journeyId:{acctId:status}}
function saveJourneys(){ LS.set('journeyState',journeyState); }
let journeyOpen = LS.get('journeyOpen','welcome');
let ownerFilter = '';                     // "View as CSM" auto-filter (owner name), session only
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
function logActivity(acctId){
  const type=($('#actType')&&$('#actType').value)||'Call';
  const subject=($('#actSubject')&&$('#actSubject').value||'').trim();
  const notes=($('#actNotes')&&$('#actNotes').value||'').trim();
  if(!subject && !notes){ toast('Add a subject or notes for this activity.'); return; }
  const cur=acctActivity[acctId]=acctActivity[acctId]||{log:[],next:null};
  cur.log=cur.log||[];
  cur.log.push({id:cid(),type,subject:subject||type,notes,t:new Date().toISOString()});
  saveAcctActivity();
  delete commsCache[acctId];
  syncLastActFromActivity(acctId);
  const a=STATE.accounts.find(x=>x.id===acctId); if(a) scoreAccount(a);
  toast(type+' logged.');
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
function addTeamMember(acctId,side,role,name){
  if(!name||!name.trim()) return;
  const t=teamRoster[acctId]=teamRoster[acctId]||{axon:[],customer:[]};
  t[side]=t[side]||[]; t[side].push({id:cid(),role:(role||'').trim()||'Contact',name:name.trim()});
  saveTeamRoster(); openAcct(acctId);
}
function delTeamMember(acctId,side,mid){
  const t=teamRoster[acctId]; if(!t) return;
  t[side]=(t[side]||[]).filter(m=>m.id!==mid);
  saveTeamRoster(); openAcct(acctId);
}
function teamSideList(acctId,side,members){
  const inputRole=`tr_${side}_role_${acctId}`, inputName=`tr_${side}_name_${acctId}`;
  return `${members.length?`<div class="reslist">${members.map(m=>`<div class="resrow"><span><span class="pill p-blue" style="margin-right:8px">${esc(m.role)}</span><b>${esc(m.name)}</b></span><button class="btn sm" onclick="delTeamMember('${acctId}','${side}','${m.id}')">✕</button></div>`).join('')}</div>`:'<p class="mini">Nobody documented yet.</p>'}
  <div class="row-actions" style="margin-top:10px">
    <input id="${inputRole}" placeholder="${side==='axon'?'Role (CSM, TAM, Fleet Installer…)':'Role (Chief, IT Admin…)'}" style="flex:1;min-width:120px;border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)">
    <input id="${inputName}" placeholder="Name" style="flex:1;min-width:120px;border:1px solid var(--line);padding:7px 9px;border-radius:8px;font:inherit;background:var(--panel2);color:var(--ink)" onkeydown="if(event.key==='Enter'){addTeamMember('${acctId}','${side}',document.getElementById('${inputRole}').value,this.value);}">
    <button class="btn sm" onclick="addTeamMember('${acctId}','${side}',document.getElementById('${inputRole}').value,document.getElementById('${inputName}').value)">+ Add</button>
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
async function soql(q,retry=2){
  try{
    const res = await fetch('/api/soql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})});
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

// ---------- state ----------
let STATE = { accounts:[], users:{}, tree:null, nodeIndex:{}, scope:'ROOT', tab:'home' };
let charts = {};
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
      casesBlocked:0, casesAging:0, growth:{Renewal:0,Expansion:0,Transactional:0}
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
  const [userMap, cases, dealAgg, sentAgg, blockedAgg, agingAgg, growthAgg, npsAgg, tapAgg] = await Promise.all([
    fetchOrgChain([...ownerIds]), soql(q3), soql(qDeals), soql(qSent), soql(qBlocked), soql(qAging), soql(qGrowth), soql(qNps), soql(qTap)
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
function computeAll(){ STATE.accounts.forEach(a=>{ syncLastActFromActivity(a.id); scoreAccount(a); }); refreshCsat(); rebuildEsc(); }

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
  if(!cur){ cur=escState[acctId]={status:'Open',log:[],reasonCode:null,product:null,steps:freshEscSteps(),openedAt:new Date().toISOString()}; changed=true; }
  else{
    if(!cur.log){ cur.log=[]; changed=true; }
    if(!cur.steps||!cur.steps.length){ cur.steps=freshEscSteps(); changed=true; }
    if(cur.reasonCode===undefined){ cur.reasonCode=null; changed=true; }
    if(cur.product===undefined){ cur.product=null; changed=true; }
    if(!cur.openedAt){ cur.openedAt=new Date().toISOString(); changed=true; }
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
  const open = STATE.escList.filter(e=>e.status!=='Resolved').length;
  $('#escBadge').textContent = open;
}
function sevRank(s){return {Critical:4,High:3,Medium:2,Low:1}[s]||0;}
function setEscStatus(acctId,status){
  const cur = ensureEscState(acctId);
  cur.status=status;
  cur.log.push({t:new Date().toISOString(), note:'Status → '+status});
  LS.set('escState',escState); rebuildEsc();
  if(STATE.tab==='escalations') route();
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
const TAB_LABELS={home:'Home',overview:'Command Center',hierarchy:'Org Drill-down',renewals:'Renewals',tap:'TAP Refreshes',scorecard:'CSM Scorecard',ctas:'CTAs',escalations:'Escalations',casewatch:'Case Watch',engagement:'Engagement',plans:'Success Plans',journeys:'Journeys',worklist:'My Worklist',model:'Health Model',resources:'Resource Library'};
const HUES=['ty','tb','tv','tg','ta','tr'];
function hueFor(s){ const str=String(s||''); let h=0; for(let i=0;i<str.length;i++) h=(h*31+str.charCodeAt(i))>>>0; return HUES[h%HUES.length]; }
function stateTag(a){ const st=a.state||'—'; return `<span class="tag ${hueFor(st)}">${esc(st)}</span>`; }
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
    const owners=[...new Set(STATE.accounts.map(a=>a.ownerName).filter(Boolean))].sort();
    va.innerHTML = `View as
      <input list="csmSearchList" id="csmSearch" class="select" style="text-transform:none;font-weight:600;width:190px" placeholder="Search CSM…" autocomplete="off" value="${esc(ownerFilter)}" oninput="onOwnerSearchInput(this.value)">
      <datalist id="csmSearchList">${owners.map(o=>`<option value="${esc(o)}">`).join('')}</datalist>
      ${ownerFilter?` <button class="btn sm" onclick="setOwnerFilter('')">Clear</button>`:''}`;
  }
}
// Type-to-search "View as CSM" combobox. Only commits the filter (and re-renders)
// once the typed text is blank or exactly matches a real CSM name — selecting a
// suggestion from the <datalist> dropdown does this naturally — so partial typing
// doesn't trigger a re-render mid-keystroke and steal focus from the input.
function onOwnerSearchInput(v){
  const owners=new Set(STATE.accounts.map(a=>a.ownerName).filter(Boolean));
  if(v===''||owners.has(v)) setOwnerFilter(v);
}

function setScope(id){ STATE.scope=id; route(); }
function setTab(t){ STATE.tab=t; document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===t)); window.scrollTo(0,0); route(); }

function route(){
  if(!STATE.tree) return;
  if(!STATE.nodeIndex[STATE.scope]) STATE.scope='ROOT';
  STATE.accounts.forEach(a=>a.readiness=readinessScore(a));
  const isHome = STATE.tab==='home';
  $('#scopebar').style.display = isHome ? 'none' : '';
  if(!isHome) renderCrumb();
  const accts0 = accountsUnder(STATE.scope);
  const accts = ownerFilter ? accts0.filter(a=>a.ownerName===ownerFilter) : accts0;
  const app=$('#app');
  if(STATE.tab==='home') app.innerHTML=viewHome();
  else if(STATE.tab==='overview') app.innerHTML=viewOverview(accts);
  else if(STATE.tab==='hierarchy') app.innerHTML=viewHierarchy();
  else if(STATE.tab==='renewals') app.innerHTML=viewRenewals(accts);
  else if(STATE.tab==='tap') app.innerHTML=viewTap(accts);
  else if(STATE.tab==='scorecard') app.innerHTML=viewScorecard(accts);
  else if(STATE.tab==='ctas') app.innerHTML=viewCTAs(accts);
  else if(STATE.tab==='escalations') app.innerHTML=viewEsc(accts);
  else if(STATE.tab==='casewatch') app.innerHTML=viewCaseWatch(accts);
  else if(STATE.tab==='engagement') app.innerHTML=viewEngagement(accts);
  else if(STATE.tab==='plans') app.innerHTML=viewPlans(accts);
  else if(STATE.tab==='journeys') app.innerHTML=viewJourneys(accts);
  else if(STATE.tab==='worklist') app.innerHTML=viewWork(accts);
  else if(STATE.tab==='model') app.innerHTML=viewModel(accts);
  else if(STATE.tab==='resources') app.innerHTML=viewResources();
  if(STATE.tab==='overview') drawOverviewCharts(accts);
  if(STATE.tab==='home') drawHomeChart();
  const cb=$('#ctaBadge'); if(cb) cb.textContent = ctas.filter(c=>c.status!=='Done').length;
  const caseB=$('#caseBadge'); if(caseB) caseB.textContent = STATE.accounts.filter(a=>a.casesBlocked>0).length;
  const cadB=$('#cadenceBadge'); if(cadB) cadB.textContent = STATE.accounts.filter(a=>cadenceInfo(a).tier==='red').length;
  const tapB=$('#tapBadge'); if(tapB) tapB.textContent = STATE.accounts.filter(a=>a.tapStatus==='overdue').length;
  $('#foot').innerHTML = isHome
    ? `Axon Customer Success Command Center · an internal replacement for Gainsight.`
    : `Scope: <b>${esc(STATE.nodeIndex[STATE.scope].name)}</b>${ownerFilter?` · filtered to CSM <b>${esc(ownerFilter)}</b>`:''} · ${accts.length} accounts with an active renewal · Health = live cases + renewal timing (tunable in Health Model). LTV & products from closed-won deals. Sentiment from lifetime support signals. CSAT, CTAs, journeys & success plans persist in your browser.`;
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
    ['Renewal ARR (book)',fmtMoney(r.arr),r.renewals+' open renewals','overview'],
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
    ['Journeys','journeys','Lifecycle outreach journeys (welcome, renewal, save play, adoption) with live membership and progress tracking.'],
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
    ['Renewal ARR in scope',fmtMoney(r.arr),r.renewals+' open renewals','renewals'],
    ['ARR at risk',fmtMoney(r.risk),Math.round(r.risk/(r.arr||1)*100)+'% of book, risk-weighted','renewals'],
    ['Avg health (ARR-wtd)',r.health,r.red+' at-risk · '+r.amber+' watch · '+r.green+' healthy','model'],
    ['NPS in scope',npsR?npsR.score:'—',npsR?(npsR.n+' of '+accts.length+' accounts surveyed'):'no survey responses in scope','scorecard'],
    ['Open escalations',STATE.escList.filter(e=>accts.includes(e.acct)&&e.status!=='Resolved').length,r.high+' high/urgent · '+r.cases+' open cases','escalations'],
  ];
  const topRisk=[...accts].sort((a,b)=>b.riskARR-a.riskARR).slice(0,8);
  return `
  <div class="kpis">${kpis.map(k=>`<div class="kpi clickable${/at risk/i.test(k[0])?' accent':''}" onclick="setTab('${k[3]}')" title="Go to ${esc(TAB_LABELS[k[3]]||k[3])}"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  <div class="grid2">
    <div class="card"><h3>Renewal ARR by team <span class="hint">click a team in Org Drill-down to scope</span></h3><div class="chartbox"><canvas id="cTeam"></canvas></div></div>
    <div class="card"><h3>Book health distribution</h3><div class="chartbox"><canvas id="cHealth"></canvas></div>
      <div class="legend"><span><i class="dot" style="background:var(--green)"></i>Healthy ≥75</span><span><i class="dot" style="background:var(--amber)"></i>Watch 50–74</span><span><i class="dot" style="background:var(--red)"></i>At risk &lt;50</span></div>
    </div>
  </div>
  <div class="card"><h3>Top risk-weighted accounts <span class="hint">renewal ARR × risk — where attention protects the most revenue</span></h3>
    <table><thead><tr><th>Account</th><th>Owner</th><th class="num">Renewal ARR</th><th class="num">Lifetime $</th><th class="num">Close</th><th>CSAT</th><th>NPS</th><th>Health</th><th class="num">ARR at risk</th></tr></thead><tbody>
    ${topRisk.map(a=>`<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${esc(a.ownerName)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${fmtMoney(a.ltv)}</td><td class="num">${a.dclose>9000?'—':a.dclose+'d'}</td><td>${csatPill(a)}</td><td>${npsPill(a)}</td><td>${healthCell(a.health)} ${tierPill(a.tier)}</td><td class="num"><b>${fmtMoney(a.riskARR)}</b></td></tr>`).join('')}
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
    {label:'Renewal ARR',data:groups.map(g=>Math.round(g.arr)),backgroundColor:barMain,borderRadius:radius},
    {label:'ARR at risk',data:groups.map(g=>Math.round(g.risk)),backgroundColor:barRisk,borderRadius:radius}]},
    options:chartBaseOptions({moneyTicks:true})}); }
  const r=rollup(accts);
  const hc=window.AXON_THEME?['#1a9e5c','#d4890a','#d64545']:['#3ddc97','#ffb84d','#ff6b6b'];
  const h=$('#cHealth'); if(h){ charts.health=new Chart(h,{type:'doughnut',data:{labels:['Healthy','Watch','At risk'],datasets:[{data:[r.green,r.amber,r.red],backgroundColor:hc,borderColor:chartBorder(),borderWidth:3}]},options:chartBaseOptions({cutout:'62%',legend:false,noScales:true})}); }
}
function shortName(n){ return n.length>16?n.slice(0,15)+'…':n; }

// ---- Hierarchy ----
function viewHierarchy(){
  const node=STATE.nodeIndex[STATE.scope];
  const kids=Object.values(node.children||{}).map(k=>({node:k,r:rollup(accountsUnder(k.id))})).sort((a,b)=>b.r.arr-a.r.arr);
  let html=`<div class="card"><h3>${esc(node.name)} <span class="hint">${esc(node.title||'')} — drill into a team, manager, or rep</span></h3>`;
  if(kids.length){
    html+=`<div class="treewrap">`+kids.map(k=>{
      const r=k.r, isLeaf=Object.keys(k.node.children||{}).length===0;
      return `<div class="node"><div class="nhead" onclick="setScope('${k.node.id}')">
        <div><span class="nname">${esc(k.node.name)}</span> <span class="ntitle">${esc(k.node.title||'')}</span></div>
        <div class="metric"><b>Renewal ARR</b>${fmtMoney(r.arr)}</div>
        <div class="metric"><b>At risk</b><span style="color:var(--red)">${fmtMoney(r.risk)}</span></div>
        <div class="metric"><b>Health</b>${healthCell(r.health)}</div>
        <div class="metric"><b>${isLeaf?'Accounts':'Reports'}</b>${isLeaf?r.n:Object.keys(k.node.children).length}</div>
      </div></div>`;
    }).join('')+`</div>`;
  }
  const direct=node.accounts||[];
  if(direct.length){
    html+=`<h3 style="margin-top:18px">Accounts owned here (${direct.length})</h3>`+accountTable([...direct].sort((a,b)=>b.riskARR-a.riskARR));
  } else if(!kids.length){ html+=`<p class="mini">No sub-teams or accounts under this node in the current renewal book.</p>`; }
  html+=`</div>`;
  return html;
}
function accountTable(accts){
  return `<table><thead><tr><th>Account</th><th>Owner</th><th class="num">Renewal ARR</th><th class="num">Lifetime $</th><th class="num">Close</th><th class="num">Cases</th><th>CSAT</th><th>Health</th></tr></thead><tbody>
  ${accts.map(a=>`<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${esc(a.ownerName)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${fmtMoney(a.ltv)}</td><td class="num">${a.dclose>9000?'—':a.dclose+'d'}</td><td class="num">${a.openCases}${a.highCases?` <span class="pill p-red">${a.highCases}!</span>`:''}</td><td>${csatPill(a)}</td><td>${healthCell(a.health)} ${tierPill(a.tier)}</td></tr>`).join('')}
  </tbody></table>`;
}

// ---- Renewals ----
let renewSort={k:'riskARR',dir:-1};
function viewRenewals(accts){
  const rows=[...accts].sort((a,b)=>{ const x=a[renewSort.k], y=b[renewSort.k]; const xn=x==null?-Infinity:x, yn=y==null?-Infinity:y; return renewSort.dir*((xn>yn)?1:(xn<yn)?-1:0); });
  const sc=(k,l)=>`<th class="num" onclick="setRenewSort('${k}')">${l}${renewSort.k===k?(renewSort.dir<0?' ▼':' ▲'):''}</th>`;
  return `<div class="card"><h3>Renewal & risk triage <span class="hint">${accts.length} accounts · prioritized by revenue exposure</span></h3>
  <div class="searchbar"><input id="rsearch" placeholder="Filter accounts…" oninput="filterTable(this,'rtbl')"></div>
  <table id="rtbl"><thead><tr><th onclick="setRenewSort('name')">Account</th><th>Owner</th><th>Stage</th>${sc('dclose','Days to close')}${sc('renewalAmount','Renewal ARR')}${sc('ltv','Lifetime $')}${sc('openCases','Open cases')}${sc('csat','CSAT')}${sc('readiness','Renewal ready')}${sc('riskARR','ARR at risk')}<th>Health</th></tr></thead><tbody>
  ${rows.map(a=>{const st=a.opps[0]?a.opps[0].stage:'';const late=a.dclose<=90&&EARLY.has(st);return `<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${esc(a.ownerName)}</td><td>${esc(st)}${late?' <span class="pill p-red">behind</span>':''}</td><td class="num">${a.dclose>9000?'—':a.dclose}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td class="num">${fmtMoney(a.ltv)}</td><td class="num">${a.openCases}${a.highCases?` <span class="pill p-red">${a.highCases}!</span>`:''}</td><td>${csatPill(a)}</td><td class="num">${readyPill(a.readiness)}</td><td class="num"><b>${fmtMoney(a.riskARR)}</b></td><td>${healthCell(a.health)}</td></tr>`;}).join('')}
  </tbody></table></div>`;
}
function setRenewSort(k){ if(renewSort.k===k)renewSort.dir*=-1; else {renewSort.k=k;renewSort.dir=(k==='name')?1:-1;} route(); }

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
  <div class="card"><table><thead><tr><th>Account</th><th>Issue</th><th>Severity</th><th>Reason</th><th>Product</th><th class="num">Days open</th><th>Status</th><th class="num">ARR at risk</th><th></th></tr></thead><tbody>
  ${list.map(e=>`<tr><td onclick="openAcct('${e.acctId}')" style="cursor:pointer"><b>${esc(e.acct.name)}</b><div class="mini">${esc(e.acct.ownerName)}</div></td><td>${esc(e.issue)}</td><td>${sevPill(e.sev)}</td><td>${escReasonSelect(e)}</td><td>${escProductSelect(e)}</td><td class="num">${e.daysOpen==null?'—':`<span class="${e.daysOpen>=14?'neg':''}">${e.daysOpen}d${e.daysOpen>=14?' ⚠':''}</span>`}</td><td>${statusPill(e.status)}</td><td class="num">${fmtMoney(e.acct.riskARR)}</td><td class="row-actions">${e.status!=='In Progress'&&e.status!=='Resolved'?`<button class="btn" onclick="event.stopPropagation();setEscStatus('${e.acctId}','In Progress')">Start</button>`:''}${e.status!=='Resolved'?`<button class="btn primary" onclick="event.stopPropagation();setEscStatus('${e.acctId}','Resolved')">Resolve</button>`:`<button class="btn" onclick="event.stopPropagation();setEscStatus('${e.acctId}','Open')">Reopen</button>`}</td></tr>`).join('')}
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
function generatePlan(id){
  const a=STATE.accounts.find(x=>x.id===id); if(!a) return;
  const base=new Date();
  const ms=[]; const uid=()=>'m'+Math.random().toString(36).slice(2,9);
  const add=(days,title)=>ms.push({id:uid(),title,due:sfDate(new Date(base.getTime()+days*864e5)),done:false});
  add(7,'Executive kickoff & welcome call');
  add(14,'Map stakeholders & define success criteria');
  add(30,'Deployment & provisioning');
  add(45,'Admin & end-user training');
  add(60,'Go-live / first adoption checkpoint');
  add(90,'90-day value review & QBR');
  if(a.highCases>0 || a.health<60) add(21,'Resolve open support escalations before onboarding milestones');
  if(a.dclose<=365) add(Math.max(30,a.dclose-60),'Early renewal planning & value recap');
  ms.sort((x,y)=> x.due<y.due?-1:1);
  const objectives=[
    'Achieve first measurable value within 90 days of onboarding',
    'Drive adoption of purchased Axon products across the agency',
    'Establish executive alignment and a clear path to renewal'
  ];
  plans[id]={acctId:id,created:new Date().toISOString(),updatedAt:new Date().toISOString(),objectives,milestones:ms,notes:'',discovery:{},auto:true};
  savePlans();
}
function generateAllNewLogos(){
  const logos=STATE.accounts.filter(newLogo).filter(a=>!plans[a.id]);
  logos.forEach(a=>generatePlan(a.id));
  toast(`Generated ${logos.length} success plan${logos.length===1?'':'s'} for new-logo accounts.`);
  route();
}
function createOrOpenPlan(id){ if(!plans[id]) generatePlan(id); setTab('plans'); openPlan(id); }
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
    html+=`<table><thead><tr><th>Account</th><th>Owner</th><th class="num">First purchase</th><th class="num">Lifetime $</th><th>Health</th><th>Plan</th><th></th></tr></thead><tbody>
    ${sorted.map(a=>{const p=plans[a.id];const prog=planProgress(p);return `<tr><td onclick="openAcct('${a.id}')" style="cursor:pointer"><b>${esc(a.name)}</b> ${stateTag(a)}</td><td>${esc(a.ownerName)}</td><td class="num">${esc(a.firstPurchase||'—')}</td><td class="num">${fmtMoney(a.ltv)}</td><td>${healthCell(a.health)}</td><td>${p?`<span class="pill p-green">Plan · ${prog}%</span>`:'<span class="pill p-gray">None</span>'}</td><td class="row-actions">${p?`<button class="btn sm" onclick="openPlan('${a.id}')">Open</button>`:`<button class="btn primary sm" onclick="createOrOpenPlan('${a.id}')">Generate</button>`}</td></tr>`;}).join('')}
    </tbody></table>`;
  }
  html+=`</div>`;

  // Active plans (incl. custom, non-new-logo)
  let custom=active.filter(p=>{ const a=STATE.accounts.find(x=>x.id===p.acctId); return a && !newLogo(a); });
  if(plansKpiFilter==='dueSoon') custom=custom.filter(p=>planDueSoonCount(p)>0);
  if(custom.length){
    html+=`<div class="card"><h3>Other active plans <span class="hint">custom plans on established accounts</span></h3>
    <table><thead><tr><th>Account</th><th>Owner</th><th class="num">Renewal ARR</th><th>Progress</th><th></th></tr></thead><tbody>
    ${custom.map(p=>{const a=STATE.accounts.find(x=>x.id===p.acctId);const prog=planProgress(p);return `<tr><td onclick="openAcct('${a.id}')" style="cursor:pointer"><b>${esc(a.name)}</b></td><td>${esc(a.ownerName)}</td><td class="num">${fmtMoney(a.renewalAmount)}</td><td><div class="progress" style="width:120px"><i style="width:${prog}%"></i></div><span class="mini">${prog}%</span></td><td><button class="btn sm" onclick="openPlan('${a.id}')">Open</button></td></tr>`;}).join('')}
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
  sheet.innerHTML=`<div class="hd"><div><h2>Success Plan — ${esc(a.name)}</h2><div class="mini">Owner ${esc(a.ownerName)} · ${newLogo(a)?'New logo · first purchase '+esc(a.firstPurchase||''):'Established account'} · Renewal ${a.dclose>9000?'—':'in '+a.dclose+'d'}</div></div><button class="x" onclick="closeSheet()">✕</button></div>
  <div class="bd">
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Progress <span class="hint">${p.milestones.filter(m=>m.done).length} of ${p.milestones.length} milestones complete</span></h3>
      <div class="progress"><i style="width:${prog}%"></i></div>
      <p class="mini" style="margin-top:8px">Plan ${p.auto?'auto-generated':'created'} ${new Date(p.created).toLocaleDateString()} · saved in your browser.</p>
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
  return `<div class="milestone${m.done?' done':''}" data-ms="${m.id}">
    <input type="checkbox" ${m.done?'checked':''} onchange="togglePlanMs('${id}','${m.id}',this.checked)">
    <input type="text" value="${esc(m.title)}" onchange="editPlanMsTitle('${id}','${m.id}',this.value)">
    <input type="date" value="${esc(m.due||'')}" onchange="editPlanMsDue('${id}','${m.id}',this.value)">
    <button class="btn sm" onclick="removePlanMs('${id}','${m.id}')">Remove</button>
  </div>`;
}
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
    if(a.dclose<=90 && EARLY.has(st)) items.push({p:1,a,label:`Renewal closes in ${a.dclose}d but still "${st}" — advance the deal`,tag:'Renewal at risk'});
    if(a.highCases>0) items.push({p:2,a,label:`${a.highCases} high/urgent support case(s) open — coordinate resolution`,tag:'Support escalation'});
    const ns=nextStepOpen(a.id);
    if(ns){
      const overdue=nextStepOverdue(ns);
      items.push({p:overdue?1:2,a,label:`Next step: ${ns.text}${ns.due?` (due ${ns.due})`:''}`,tag:overdue?'Next step overdue':'Next step'});
    }
    if(newLogo(a) && !plans[a.id]) items.push({p:2,a,label:`New logo (first purchase ${a.firstPurchase}) with no success plan — generate one`,tag:'Onboard'});
    if(a.sentTier==='neg') items.push({p:3,a,label:`Strained sentiment (${a.sentiment}) from support history — proactively check in`,tag:'Sentiment risk'});
    if(a.tier==='atrisk' && a.renewalAmount>1e6) items.push({p:3,a,label:`At-risk account with ${fmtMoney(a.renewalAmount)} renewal — build a save play`,tag:'Save play'});
    if(a.dclose<=180 && a.dclose>90 && a.tier!=='healthy') items.push({p:4,a,label:`Renewal in ${a.dclose}d, health ${a.health} — start early engagement`,tag:'Get ahead'});
  });
  items.sort((x,y)=> x.p-y.p || y.a.riskARR-x.a.riskARR);
  return `<div class="card"><h3>Prioritized worklist <span class="hint">${items.length} actions across scope · ranked by urgency then revenue</span></h3>
  <table><thead><tr><th>Priority action</th><th>Account</th><th>Owner</th><th class="num">Renewal ARR</th><th>Health</th></tr></thead><tbody>
  ${items.slice(0,50).map(it=>`<tr onclick="openAcct('${it.a.id}')"><td><span class="pill ${it.p<=2?'p-red':it.p===3?'p-amber':'p-gray'}">${esc(it.tag)}</span> ${esc(it.label)}</td><td><b>${esc(it.a.name)}</b></td><td>${esc(it.a.ownerName)}</td><td class="num">${fmtMoney(it.a.renewalAmount)}</td><td>${healthCell(it.a.health)}</td></tr>`).join('')}
  </tbody></table>${items.length?'':'<p class="mini">Clear queue — nothing urgent in this scope.</p>'}</div>`;
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
  sheet.innerHTML=`<div class="hd"><div><h2>Improve plan — ${esc(name)}</h2><div class="mini">${o.n} accounts · Engagement ${o.engagementPct}% · Insights ${o.insights} · Growth ${fmtMoney(o.growthTotal)} · ${steps.length?steps.length+' action'+(steps.length===1?'':'s'):'on track'}</div></div><button class="x" onclick="closeSheet()">✕</button></div>
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

  ${needing.length?`<div class="card"><h3>Reps needing attention <span class="hint">${needing.length} below target — top action for each</span></h3>
  <div class="improve-list">${needing.map(o=>{ const top=o.steps[0]; return `<div class="improve-step ${top.sev}">
    <div class="improve-meta"><b>${esc(o.name)}</b><div class="mini" style="margin-top:4px">${o.steps.length} step${o.steps.length===1?'':'s'}</div></div>
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
  ${rows.map(o=>`<tr style="cursor:default"><td><b>${esc(o.name)}</b></td><td class="num">${o.n}</td><td class="num">${o.engagementPct}%${targetBar(o.engagementPct/(scoreTargets.engagementPct||1)*100)}</td><td class="num">${o.insights}${targetBar(o.insights/(scoreTargets.insightsPerCsm||1)*100)}</td><td class="num">${npsRollupPill(o.npsR)}</td><td class="num">${fmtMoney(o.growth.Renewal)}</td><td class="num">${fmtMoney(o.growth.Expansion)}</td><td class="num">${fmtMoney(o.growth.Transactional)}</td><td class="num"><b>${fmtMoney(o.growthTotal)}</b>${targetBar(o.growthTotal/(scoreTargets.growthPerCsm||1)*100)}</td><td class="num">${o.stale.length?`<span class="pill clickable ${o.stale[0].overdue>90?'p-red':'p-amber'}" onclick="openCsmImprove('${attrStr(o.name)}')" title="Open improve plan">${o.stale.length}</span>`:'<span class="pill p-gray">0</span>'}</td><td>${o.needsImprove||o.steps.length?`<button class="btn ${o.needsImprove?'primary':'sm'} sm" onclick="openCsmImprove('${attrStr(o.name)}')">${o.needsImprove?'Improve':'Plan'}</button>`:`<span class="pill p-green">On track</span>`}</td></tr>`).join('')}
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
  ${sorted.map(r=>`<tr onclick="openAcct('${r.a.id}')"><td><b>${esc(r.a.name)}</b></td><td>${esc(r.a.ownerName)}</td><td>${segmentPill(r.a)}</td><td class="num">${r.c.ds==null?'—':r.c.ds+'d ago'}</td><td class="num">every ${r.c.req}d</td><td>${cadencePill(r.a)}</td></tr>`).join('')}
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
  ${sorted.map(a=>`<tr onclick="openAcct('${a.id}')"><td><b>${esc(a.name)}</b></td><td>${esc(a.ownerName)}</td><td class="num">${a.casesBlocked?`<span class="pill p-red">${a.casesBlocked}</span>`:'—'}</td><td class="num">${a.casesAging?`<span class="pill p-amber">${a.casesAging}</span>`:'—'}</td><td class="num">${a.openCases}</td><td>${healthCell(a.health)}</td></tr>`).join('')}
  </tbody></table>
  ${sorted.length?'':'<p class="mini">Clear queue — no blocked or aging cases in this scope.</p>'}</div>`;
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
  <div class="kpis" style="margin:14px 0">${kpis.map(k=>`<div class="kpi clickable${/Overdue/.test(k[0])?' accent':''}${k[3]&&tapKpiFilter===k[3]?' selected':''}" onclick="setTapKpi(${k[3]?`'${k[3]}'`:'null'})"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="d">${esc(k[2])}</div></div>`).join('')}</div>
  ${tapKpiFilter?`<p class="mini" style="margin:-4px 0 12px">Filtered to <b>${tapKpiFilter==='overdue'?'overdue':'due within 90 days'}</b> · <a href="#" onclick="setTapKpi('${tapKpiFilter}');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">clear filter</a></p>`:''}
  <table><thead><tr><th>Account</th><th>Owner</th><th class="num">Hardware purchase</th><th class="num">Refresh due</th><th class="num">Contract end</th><th>Status</th><th></th></tr></thead><tbody>
  ${sorted.map(a=>{ const t=tapState[a.id]; const prog=t?Math.round(t.steps.filter(s=>s.done).length/t.steps.length*100):0; return `<tr onclick="openTap('${a.id}')"><td><b>${esc(a.name)}</b></td><td>${esc(a.ownerName)}</td><td class="num">${esc(a.tapHwStart||'—')}</td><td class="num">${esc(a.tapRefreshDate||'—')}${a.tapDays!=null?` <span class="mini">(${a.tapDays<0?Math.abs(a.tapDays)+'d overdue':a.tapDays+'d'})</span>`:''}</td><td class="num">${esc(a.tapContractEnd||'—')}</td><td>${tapStatusPill(a)}</td><td class="mini">${t?prog+'% checklist':''}</td></tr>`; }).join('')}
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
  sheet.innerHTML=`<div class="hd"><div><h2>TAP Refresh — ${esc(a.name)}</h2><div class="mini">Owner ${esc(a.ownerName)} · Hardware purchased ${esc(a.tapHwStart||'—')} · ${tapStatusPill(a)}</div></div><button class="x" onclick="closeSheet()">✕</button></div>
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
function renderCommItem(it){
  const full=cleanComm(it.desc); const long=full.length>200; const short=long?full.slice(0,200)+'…':full;
  const del=it.localId?` <button class="btn sm" onclick="delActivity('${it.acctId}','${it.localId}')" title="Remove logged activity">✕</button>`:'';
  return `<div class="ev"><div class="t">${fmtDate(it.d)} · ${commPill(it.sub)} · ${esc(it.who||'')}${it.local?' · logged here':''}${del}</div><div><b>${esc(commSubject(it.subj))}</b></div>${full?`<div class="mini commtext"><span class="cs">${esc(short)}</span><span class="cf hidden">${esc(full)}</span>${long?` <a href="#" onclick="toggleComm(event,this)">more</a>`:''}</div>`:''}</div>`;
}
async function loadAcctComms(id){
  const box=$('#acctComms'); if(!box) return;
  const localLog=(activityFor(id).log||[]).map(e=>({d:e.t,sub:e.type,subj:e.subject,who:'You',desc:e.notes,local:true,localId:e.id,acctId:id}));
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
  <p class="mini">Reps can keep the account current here — past outreach and the next action — without waiting on a Salesforce write-back. Logged touches also count toward engagement cadence.</p>

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
  if(intelCache[id]){ if(dBox)dBox.innerHTML=intelCache[id].deals; if(pBox)pBox.innerHTML=intelCache[id].prod; return; }
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
    intelCache[id]={deals:dealsHtml,prod:prodHtml};
    if(dBox)dBox.innerHTML=dealsHtml; if(pBox)pBox.innerHTML=prodHtml;
  }catch(e){ if(dBox)dBox.innerHTML='<div class="err">Couldn\u2019t load purchase history — '+esc(e.message||e)+'</div>'; if(pBox)pBox.innerHTML=''; }
}

// ---- Account 360 ----
function openAcct(id){
  const a=STATE.accounts.find(x=>x.id===id); if(!a) return;
  a.readiness=readinessScore(a);
  const escStateForAcct=peekEscState(id);
  const escDaysOpen = escStateForAcct.openedAt ? Math.floor((Date.now()-new Date(escStateForAcct.openedAt).getTime())/864e5) : null;
  const c=csatVal(a);
  const compRows=a.comps.length?a.comps.map(c=>`<div>${esc(c[0])}</div><div class="${c[1]<0?'neg':'pos'}">${c[1]}</div>`).join(''):'<div class="mini">No penalties — full health.</div>';
  const opps=a.opps.slice().sort((x,y)=>(x.close>y.close?1:-1));
  const resolvedRate = a.lifeCases>0 ? Math.round((a.lifeCases-a.openCases)/a.lifeCases*100) : null;
  const sentColor = a.sentiment==null?'var(--muted)':a.sentTier==='pos'?'var(--green)':a.sentTier==='neu'?'var(--amber)':'var(--red)';
  const hasPlan=!!plans[id];
  const sheet=$('#sheet');
  sheet.innerHTML=`<div class="hd"><div><h2>${esc(a.name)}</h2><div class="mini">${esc(a.state||'')} · Owner ${esc(a.ownerName)}${a.ownerTitle?' ('+esc(a.ownerTitle)+')':''}${newLogo(a)?' · <b>New logo</b>':''} · ${segmentPill(a)} ${cadencePill(a)}</div></div><button class="x" onclick="closeSheet()">✕</button></div>
  <div class="bd">
    <div class="row-actions" style="margin-bottom:14px">
      <button class="btn primary" onclick="createOrOpenPlan('${a.id}')">${hasPlan?'Open success plan':'Create success plan'}</button>
      <button class="btn" onclick="document.getElementById('actSubject')&&document.getElementById('actSubject').focus()">Log activity</button>
      <button class="btn" onclick="quickCta('${a.id}')">+ Add CTA</button>
      ${a.tier!=='healthy'?`<button class="btn" onclick="setEscStatus('${a.id}','In Progress');openAcct('${a.id}')">Start escalation</button>`:''}
    </div>
    <div class="kpis" style="margin-bottom:16px">
      <div class="kpi"><div class="l">Health</div><div class="v" style="color:${a.health>=75?'var(--green)':a.health>=50?'var(--amber)':'var(--red)'}">${a.health}</div><div class="d">${tierPill(a.tier)}</div></div>
      <div class="kpi"><div class="l">CSAT</div><div class="v" style="color:${csatColor(c.v)}">${c.v==null?'—':c.v+'%'}</div><div class="d">${c.v==null?'no data':csatFace(c.v)+(c.src==='placeholder'?' · placeholder':' · set by CSM')}</div></div>
      <div class="kpi"><div class="l">NPS</div><div class="v" style="color:${a.nps==null?'var(--muted)':a.nps>=9?'var(--green)':a.nps>=7?'var(--amber)':'var(--red)'}">${a.nps==null?'—':a.nps+'/10'}</div><div class="d">${a.nps==null?'no survey response':npsClassify(a.nps)+(a.npsDate?' · '+esc(a.npsDate):'')}</div></div>
      <div class="kpi"><div class="l">Sentiment</div><div class="v" style="color:${sentColor}">${a.sentiment==null?'—':a.sentiment}</div><div class="d">${sentPill(a)}</div></div>
      <div class="kpi"><div class="l">Lifetime value</div><div class="v">${fmtMoney(a.ltv)}</div><div class="d">${a.pastDeals} closed-won deals</div></div>
      <div class="kpi"><div class="l">Renewal ARR</div><div class="v">${fmtMoney(a.renewalAmount)}</div><div class="d">${a.dclose>9000?'—':'closes in '+a.dclose+' days'}</div></div>
      <div class="kpi"><div class="l">Open cases</div><div class="v">${a.openCases}</div><div class="d">${a.highCases} high/urgent</div></div>
      <div class="kpi${(a.casesBlocked||a.casesAging)?' accent':''}"><div class="l">Blocked / Aging</div><div class="v">${a.casesBlocked||0} / ${a.casesAging||0}</div><div class="d">cases to escalate</div></div>
      <div class="kpi"><div class="l">Growth (all-time)</div><div class="v">${fmtMoney((a.growth&&(a.growth.Renewal+a.growth.Expansion+a.growth.Transactional))||0)}</div><div class="d">Renewal/Expansion/Transactional</div></div>
    </div>

    ${teamRosterCard(a)}

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
        <div>Lifetime value (closed-won)</div><div class="pos">${fmtFull(a.ltv)}</div>
        <div>Closed-won deals</div><div><b>${a.pastDeals}</b></div>
        <div>First purchase</div><div><b>${a.firstPurchase?esc(a.firstPurchase):'—'}</b></div>
        <div>Most recent purchase</div><div><b>${a.lastPurchase?esc(a.lastPurchase):'—'}</b></div>
      </div>
      <div id="acctDeals"><div class="mini">Loading recent deals…</div></div>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Products purchased <span class="hint">by spend, from closed-won line items</span></h3>
      <div id="acctProducts"><div class="mini">Loading products…</div></div>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Customer insights <span class="hint">capture &amp; distil what the team is learning about this account</span></h3>
      <p class="mini">Not tied to a case or escalation — this is where the team writes down what they're actually learning about the customer, especially useful while building a net-new motion. Rolls up into each CSM's scorecard.</p>
      <textarea class="notes-in" id="insightIn" placeholder="What did we learn about this customer?"></textarea>
      <div class="row-actions" style="margin-top:6px"><button class="btn" onclick="addInsight('${a.id}',document.getElementById('insightIn').value);openAcct('${a.id}')">Log insight</button></div>
      <div class="tl" style="margin-top:12px">${(insights[a.id]&&insights[a.id].length)?insights[a.id].slice().reverse().map(n=>`<div class="ev"><div class="t">${new Date(n.t).toLocaleString()}</div><div>${esc(n.note)}</div></div>`).join(''):'<span class="mini">No insights logged yet for this account.</span>'}</div>
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Resources &amp; guides <span class="hint">shared library — <a href="#" onclick="closeSheet();setTab('resources');return false" style="text-decoration:underline;text-decoration-color:var(--yellow)">manage in Resource Library</a></span></h3>
      ${resources.length?`<div class="reslist">${resources.map(r=>`<div class="resrow">${catTag(r.category,'margin-right:8px')}<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></div>`).join('')}</div>`:'<p class="mini">No resources in the library yet.</p>'}
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Customer sentiment <span class="hint">derived from lifetime support-case signals</span></h3>
      ${a.sentiment==null
        ? '<p class="mini">No support-case history on record for this account.</p>'
        : `<div style="display:flex;align-items:center;gap:16px;margin-bottom:12px"><div style="font-size:34px;font-weight:800;color:${sentColor};font-variant-numeric:tabular-nums">${a.sentiment}</div><div>${sentPill(a)}<div class="mini" style="margin-top:4px">0 = heavy friction · 100 = smooth</div></div></div>
        <div class="comp" style="grid-template-columns:1fr auto">
          <div>Lifetime support cases</div><div><b>${a.lifeCases.toLocaleString()}</b></div>
          <div>High / urgent tickets</div><div class="${a.lifeHigh>0?'neg':''}">${a.lifeHigh.toLocaleString()} (${Math.round(a.lifeHigh/a.lifeCases*100)}%)</div>
          <div>Escalated tickets</div><div class="${a.lifeEsc>0?'neg':''}">${a.lifeEsc.toLocaleString()} (${Math.round(a.lifeEsc/a.lifeCases*100)}%)</div>
          <div>Currently open high/urgent</div><div class="${a.highCases>0?'neg':''}">${a.highCases}</div>
          <div>Resolved rate</div><div class="${resolvedRate!=null&&resolvedRate>=90?'pos':''}">${resolvedRate==null?'—':resolvedRate+'%'}</div>
        </div>`}
    </div>

    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Health breakdown <span class="hint">why this number</span></h3><div class="comp"><div><b>Base</b></div><div class="pos">100</div>${compRows}<div style="border-top:1px solid var(--line-soft);padding-top:6px"><b>Score</b></div><div style="border-top:1px solid var(--line-soft);padding-top:6px"><b>${a.health}</b></div></div></div>
    <div class="card" style="box-shadow:none;margin:0 0 16px"><h3>Open renewals</h3><table><tbody>${opps.map(o=>`<tr style="cursor:default"><td>${esc(o.name)}</td><td>${esc(o.stage)}</td><td class="num">${fmtMoney(o.amount)}</td><td class="num">${esc(o.close)}</td></tr>`).join('')}</tbody></table></div>
    ${activityCard(a)}
    <div class="card" style="box-shadow:none;margin:0"><h3>Escalation <span class="hint">${escDaysOpen!=null?escDaysOpen+'d open':''}${escDaysOpen>=14?' · stale':''}</span></h3>
      <div class="row-actions" style="margin-bottom:10px">Status: ${statusPill(escStateForAcct.status||'—')} ${a.tier!=='healthy'?`<button class="btn" onclick="setEscStatus('${a.id}','In Progress');openAcct('${a.id}')">Start</button><button class="btn primary" onclick="setEscStatus('${a.id}','Resolved');openAcct('${a.id}')">Resolve</button>`:''}</div>
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
  showOverlay();
  loadAcctComms(a.id);
  loadAcctIntel(a.id);
}
function showOverlay(){ $('#overlay').classList.add('show'); $('#sheet').parentElement.scrollTop=0; }
function closeSheet(){ $('#overlay').classList.remove('show'); }
$('#overlay').addEventListener('click',e=>{ if(e.target.id==='overlay') closeSheet(); });

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

// ---- Journeys / Journey Orchestrator (Gainsight: Email Outreach) ----
const JOURNEYS=[
  {id:'welcome',name:'New Logo Welcome Series',desc:'Automated onboarding outreach to new-logo POCs.',steps:['Day 0 — Welcome & CSM introduction','Day 3 — Onboarding kickoff scheduling','Day 14 — Getting-started resources','Day 30 — First value check-in'],match:a=>newLogo(a)},
  {id:'renewal90',name:'Renewal 90-Day Outreach',desc:'Proactive renewal outreach as the date approaches.',steps:['T-90 — Value recap & renewal heads-up','T-60 — Renewal proposal review','T-30 — Confirm paperwork & stakeholders'],match:a=>a.dclose<=90},
  {id:'save',name:'At-Risk Save Play',desc:'Targeted retention outreach for at-risk accounts.',steps:['Executive check-in','Risk & escalation review','Success-plan reset'],match:a=>a.tier==='atrisk'},
  {id:'adopt',name:'Product Adoption Nudge',desc:'Nudge stale accounts toward deeper product adoption.',steps:['Share usage insights','Feature spotlight','Offer a training session'],match:a=>a.dsAct!=null && a.dsAct>120}
];
function jStatus(jid,acctId){ return (journeyState[jid]&&journeyState[jid][acctId])||'Not started'; }
function setJourneyStatus(jid,acctId,s){ journeyState[jid]=journeyState[jid]||{}; journeyState[jid][acctId]=s; saveJourneys(); }
function toggleJourney(jid){ journeyOpen = journeyOpen===jid?'':jid; LS.set('journeyOpen',journeyOpen); route(); }
function viewJourneys(accts){
  let html=`<div class="card"><h3>Journey Orchestrator <span class="hint">automated CS/product outreach · membership auto-derived from live signals</span></h3>
  <p class="mini">Define the outreach a customer should get at each lifecycle moment. Membership is computed live from account signals; track each account's progress below. <b>Emails send from your outreach tool</b> (Hubspot / Clari / Sales Outreach) — this orchestrates and tracks them.</p></div>`;
  JOURNEYS.forEach(j=>{
    const members=accts.filter(j.match);
    const done=members.filter(m=>jStatus(j.id,m.id)==='Done').length, prog=members.filter(m=>jStatus(j.id,m.id)==='In progress').length;
    const isOpen=journeyOpen===j.id;
    html+=`<div class="card" style="margin:0 0 12px"><h3 style="cursor:pointer;border:none;margin:0 0 4px" onclick="toggleJourney('${j.id}')">${esc(j.name)} <span class="hint">${members.length} accounts · ${done} done · ${prog} in progress · ${isOpen?'▲ hide':'▼ show'}</span></h3>
    <p class="mini" style="margin:2px 0 10px">${esc(j.desc)}</p>
    <div class="row-actions" style="margin-bottom:10px">${j.steps.map((s,i)=>`<span class="pill p-gray" style="text-transform:none;font-weight:600">${i+1}. ${esc(s)}</span>`).join(' ')}</div>
    ${isOpen?`<table><thead><tr><th>Account</th><th>Owner</th><th class="num">Renewal ARR</th><th>Status</th></tr></thead><tbody>
      ${members.length?[...members].sort((a,b)=>b.renewalAmount-a.renewalAmount).map(m=>`<tr><td onclick="openAcct('${m.id}')" style="cursor:pointer"><b>${esc(m.name)}</b></td><td>${esc(m.ownerName)}</td><td class="num">${fmtMoney(m.renewalAmount)}</td><td><select class="select" onchange="setJourneyStatus('${j.id}','${m.id}',this.value)"><option${jStatus(j.id,m.id)==='Not started'?' selected':''}>Not started</option><option${jStatus(j.id,m.id)==='In progress'?' selected':''}>In progress</option><option${jStatus(j.id,m.id)==='Done'?' selected':''}>Done</option></select></td></tr>`).join(''):'<tr><td colspan="4" class="mini">No accounts match this journey in the current scope.</td></tr>'}
    </tbody></table>`:''}
    </div>`;
  });
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

document.querySelectorAll('#tabs button').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
Object.assign(window,{setScope,openAcct,closeSheet,setRenewSort,setWeight,saveWeights,resetWeights,filterTable,toggleComm,addEscNote,setTab,
  setEscStatus:(i,s)=>{setEscStatus(i,s);route();},
  setCsat,generateAllNewLogos,createOrOpenPlan,openPlan,setPlanObjectives,setPlanNotes,togglePlanMs,editPlanMsTitle,editPlanMsDue,addPlanMs,removePlanMs,regenPlan,delPlan,
  setOwnerFilter,addCta,acceptAutoCta,ctaAction,delCta,quickCta,setJourneyStatus,toggleJourney,
  addInsight,delResource,submitResource,setTarget,
  logActivity,delActivity,saveNextStep,clearNextStep,
  openCsmDrilldown,openCsmImprove,runCsmImproveAction});

boot();
