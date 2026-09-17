/* Dudes Being Dudes — private commissioner decision-support dashboard */
(function(){
  if(!new URLSearchParams(location.search).get('commish')) return;

  const edge = {
    playerPerf:new Map(), projections:new Map(), lineup:null, waivers:[], drops:[], trades:[], buyLow:[], sellHigh:[], handcuffs:[], streamers:[], playoff:null, health:null, opponent:null, window:null
  };

  const n=(v)=>Number(v||0);
  const mean=(a)=>a.length?a.reduce((s,x)=>s+n(x),0)/a.length:0;
  const sd=(a)=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(mean(a.map(x=>(n(x)-m)**2)));};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const e=(s='')=>esc(s);
  const severe=new Set(['IR','OUT','PUP','SUSPENDED']);

  function injectShell(){
    if(document.getElementById('edge')) return;
    const section=document.createElement('section');
    section.id='edge'; section.className='wrap section commish-only edge-section';
    section.innerHTML=`
      <div class="section-head edge-head">
        <div><span class="kicker">PRIVATE • COMMISSIONER ONLY</span><h2>Steve's Edge</h2><p class="section-copy">Decision support built from the same league data every manager can access — just analyzed harder.</p></div>
        <button class="btn btn-secondary" id="edgeRefresh" type="button">↻ Recalculate</button>
      </div>
      <div class="edge-top">
        <article class="panel edge-action-card"><span class="kicker">WHAT SHOULD I DO TODAY?</span><div id="edgeToday" class="edge-actions"><div class="skeleton tall"></div></div></article>
        <article class="panel edge-score-card"><span class="kicker">TEAM HEALTH</span><div id="edgeHealth"><div class="skeleton tall"></div></div></article>
        <article class="panel panel-dark edge-score-card"><span class="kicker">CHAMPIONSHIP WINDOW</span><div id="edgeWindow"><div class="skeleton tall"></div></div></article>
      </div>
      <div class="edge-accordion" id="edgeTools">
        ${tool('lineup','🧠','Start / Sit Optimizer','Best lineup from recent scoring, injuries and slot eligibility.')}
        ${tool('waiverPro','🎯','Waiver Priority Engine','Add/drop recommendations with roster fit and suggested FAAB aggression.')}
        ${tool('tradeFinder','🤝','Trade Target Finder','Managers with surplus where you are weak, plus an asset to shop.')}
        ${tool('market','📈','Buy Low / Sell High','Scoring trend gaps that may indicate overreaction opportunities.')}
        ${tool('handcuffs','🩹','Handcuff & Injury Board','High-leverage backups tied to your roster and current injury risk.')}
        ${tool('opponent','🎮','Opponent Exploiter','How your current opponent compares and whether to favor floor or ceiling.')}
        ${tool('streamers','🌊','Streaming Planner','QB / TE / K / DEF options, using projections when available and recent form otherwise.')}
        ${tool('drops','🗑️','Drop Risk Analyzer','Bench players ranked from safest hold to most cuttable.')}
        ${tool('playoffs','🏁','Playoff Odds + Scenario Tool','Monte Carlo estimate using your league schedule and each team’s scoring distribution.')}
        ${tool('deadline','⏰','Trade Deadline Mode','Best upgrade areas, expendable assets and urgency before the deadline.')}
      </div>`;
    const waivers=document.getElementById('waivers');
    (waivers?.parentNode||document.querySelector('main')).insertBefore(section,waivers||document.getElementById('standings'));
    const heroActions=document.querySelector('.hero-actions');
    if(heroActions && !document.getElementById('edgeJump')) heroActions.insertAdjacentHTML('beforeend','<a id="edgeJump" class="btn btn-secondary commish-only" href="#edge">⚡ Steve\'s Edge</a>');
    const nav=document.querySelector('.nav');
    if(nav && !nav.querySelector('a[href="#edge"]')) nav.insertAdjacentHTML('beforeend','<a class="commish-only" href="#edge">Steve\'s Edge</a>');
    document.getElementById('edgeRefresh')?.addEventListener('click',()=>build(true));
  }

  function tool(id,icon,title,desc){return `<details class="panel edge-tool" id="tool-${id}"><summary><span>${icon}</span><div><strong>${title}</strong><small>${desc}</small></div><b>⌄</b></summary><div class="edge-tool-body" id="edge-${id}"><div class="skeleton tall"></div></div></details>`;}

  function player(id){ return state.playerMap?.[String(id)] || {}; }
  function pName(id){ const p=player(id); return p.full_name || [p.first_name,p.last_name].filter(Boolean).join(' ') || p.team || String(id); }
  function pPos(id){ const p=player(id); return candidatePosition(p) || p.position || '—'; }
  function pTeam(id){ return player(id).team || 'FA'; }
  function injury(id){ return String(player(id).injury_status||'').toUpperCase(); }
  function rosteredSet(){ return new Set(state.rosters.flatMap(r=>r.players||[]).map(String)); }
  function myRoster(){ return state.rostersById.get(Number(state.commissionerRosterId)); }
  function myPlayers(){ return (myRoster()?.players||[]).map(String); }

  function slotEligible(id,slot){
    const p=player(id); const ps=(p.fantasy_positions||[p.position]).filter(Boolean);
    if(slot==='QB'||slot==='RB'||slot==='WR'||slot==='TE'||slot==='K'||slot==='DEF') return ps.includes(slot)||p.position===slot;
    if(String(slot).includes('FLEX')||['W/R/T','REC_FLEX'].includes(slot)) return ps.some(x=>['RB','WR','TE'].includes(x));
    if(['SUPER_FLEX','SUPERFLEX','Q/W/R/T'].includes(slot)) return ps.some(x=>['QB','RB','WR','TE'].includes(x));
    return false;
  }

  async function buildPlayerPerf(){
    await loadPlayerMap();
    const weeks=Array.from({length:Math.max(1,state.currentWeek)},(_,i)=>i+1);
    const stats=await Promise.all(weeks.map(fetchStatsWeek));
    const field=scoringField();
    const ids=Object.keys(state.playerMap||{});
    ids.forEach(id=>{
      const scores=stats.map(s=>n(s[id]?.[field] ?? s[id]?.pts_ppr ?? s[id]?.pts_half_ppr ?? s[id]?.pts_std));
      const played=scores.filter(x=>Number.isFinite(x));
      const last3=scores.slice(-3); const season=mean(played); const recent=mean(last3);
      const trend=last3.length>=2?last3.at(-1)-last3[0]:0;
      let score=recent*.65+season*.35;
      const inj=injury(id); if(severe.has(inj)) score*=.15; else if(inj==='DOUBTFUL') score*=.55; else if(inj==='QUESTIONABLE') score*=.88;
      edge.playerPerf.set(String(id),{scores,season,recent,last:n(scores.at(-1)),trend,model:score});
    });
  }

  function perf(id){ return edge.playerPerf.get(String(id)) || {scores:[],season:0,recent:0,last:0,trend:0,model:0}; }
  function currentRow(rosterId){ const rows=state.matchups.get(Number(state.currentWeek)); return Array.isArray(rows)?rows.find(r=>Number(r.roster_id)===Number(rosterId)):null; }

  async function optimizeLineup(){
    const roster=myRoster(); if(!roster) return null;
    const row=(await getMatchups(state.currentWeek)).find(r=>r.roster_id===roster.roster_id);
    const ids=(roster.players||[]).map(String).filter(id=>!severe.has(injury(id)));
    const slots=starterSlots(); const exact=slots.map((slot,index)=>({slot,index}));
    const order=[...exact].sort((a,b)=>{ const af=String(a.slot).includes('FLEX'), bf=String(b.slot).includes('FLEX'); return Number(af)-Number(bf); });
    const used=new Set(); const picks=[];
    order.forEach(s=>{ const options=ids.filter(id=>!used.has(id)&&slotEligible(id,s.slot)).sort((a,b)=>perf(b).model-perf(a).model); const id=options[0]; if(id){used.add(id);picks.push({...s,id,score:perf(id).model});} });
    picks.sort((a,b)=>a.index-b.index);
    const current=(row?.starters||[]).map(String); const swaps=[];
    picks.forEach((pick,i)=>{ const cur=current[i]; if(cur && pick.id!==cur && perf(pick.id).model>perf(cur).model+1){swaps.push({slot:pick.slot,in:pick.id,out:cur,edge:perf(pick.id).model-perf(cur).model});} });
    return {picks,current,swaps,currentScore:current.reduce((s,id)=>s+perf(id).model,0),optimizedScore:picks.reduce((s,x)=>s+x.score,0)};
  }

  function positionRank(pos){ try{const r=positionRanking(pos);const idx=r.findIndex(x=>x.roster_id===state.commissionerRosterId);return {rank:idx+1,total:r.length};}catch(_){return {rank:0,total:state.rosters.length};} }

  function dropCandidates(){
    const row=currentRow(state.commissionerRosterId); const starters=new Set((row?.starters||[]).map(String));
    return myPlayers().filter(id=>!starters.has(id)).map(id=>{ const p=perf(id), inj=injury(id), pos=pPos(id); let value=p.model; if(severe.has(inj)) value-=3; if(pos==='RB'&&Number(player(id).depth_chart_order||99)<=2)value+=2; return {id,pos,value,recent:p.recent,season:p.season,injury:inj}; }).sort((a,b)=>a.value-b.value);
  }

  function waiverRecommendations(){
    const drops=dropCandidates();
    return (state.waiverPlayers||[]).slice(0,15).map((x,i)=>{ const drop=drops.find(d=>d.pos===x.pos)||drops[0]; const faab=clamp(Math.round(x.score*.32 + Math.max(0,12-i)),2,35); return {...x,drop,faab,upgrade:drop?x.recentAvg-drop.recent:x.recentAvg}; }).sort((a,b)=>b.score-a.score);
  }

  function rosterPosPlayers(roster,pos){ return (roster.players||[]).map(String).filter(id=>pPos(id)===pos).sort((a,b)=>perf(b).model-perf(a).model); }

  function tradeTargets(){
    const weak=['QB','RB','WR','TE'].map(pos=>({pos,...positionRank(pos)})).sort((a,b)=>(b.rank/b.total)-(a.rank/a.total)).slice(0,2);
    const strong=['QB','RB','WR','TE'].map(pos=>({pos,...positionRank(pos)})).sort((a,b)=>(a.rank/a.total)-(b.rank/b.total))[0];
    const myRow=currentRow(state.commissionerRosterId); const myStarters=new Set((myRow?.starters||[]).map(String));
    const offer=myPlayers().filter(id=>pPos(id)===strong?.pos&&!myStarters.has(id)).sort((a,b)=>perf(b).model-perf(a).model)[0]; const out=[];
    weak.forEach(w=>{ state.rosters.filter(r=>r.roster_id!==state.commissionerRosterId).forEach(r=>{ const list=rosterPosPlayers(r,w.pos); if(list.length<2) return; const row=currentRow(r.roster_id); const starts=new Set((row?.starters||[]).map(String)); const target=list.find(id=>!starts.has(id))||list[1]; if(!target)return; out.push({partner:r.roster_id,pos:w.pos,target,offer,score:perf(target).model + list.length*1.5}); }); });
    return out.sort((a,b)=>b.score-a.score).slice(0,6);
  }

  function marketSignals(){
    const others=state.rosters.filter(r=>r.roster_id!==state.commissionerRosterId).flatMap(r=>(r.players||[]).map(id=>({id:String(id),roster_id:r.roster_id})));
    const buy=others.map(x=>({...x,...perf(x.id)})).filter(x=>x.season>=6&&x.recent<x.season*.75&&!severe.has(injury(x.id))).sort((a,b)=>(a.recent/a.season)-(b.recent/b.season)).slice(0,6);
    const sell=myPlayers().map(id=>({id,...perf(id)})).filter(x=>x.season>=5&&x.recent>x.season*1.28).sort((a,b)=>(b.recent/b.season)-(a.recent/a.season)).slice(0,5);
    return {buy,sell};
  }

  function teamHealth(){
    const ranks=['QB','RB','WR','TE','FLEX'].map(pos=>positionRank(pos)).filter(x=>x.rank); const posScore=ranks.length?mean(ranks.map(x=>100*(1-(x.rank-1)/Math.max(1,x.total-1)))):50;
    const row=currentRow(state.commissionerRosterId); const starters=new Set((row?.starters||[]).map(String)); const bench=myPlayers().filter(id=>!starters.has(id)); const benchScore=clamp(mean(bench.map(id=>perf(id).model))/12*100,0,100);
    const injured=myPlayers().filter(id=>severe.has(injury(id))).length; const q=myPlayers().filter(id=>injury(id)==='QUESTIONABLE').length; const availability=clamp(100-injured*14-q*4,0,100); const score=Math.round(posScore*.55+benchScore*.25+availability*.20);
    return {score,posScore,benchScore,availability,injured,q};
  }

  function handcuffBoard(){
    const rostered=rosteredSet(); const myRB=myPlayers().filter(id=>pPos(id)==='RB'); const out=[];
    myRB.forEach(starter=>{ const team=pTeam(starter); if(!team||team==='FA')return; Object.entries(state.playerMap||{}).forEach(([id,p])=>{ if(rostered.has(id)||id===starter||candidatePosition(p)!=='RB'||p.team!==team)return; const order=Number(p.depth_chart_order||99); if(order>3)return; const tr=(state.waiverPlayers||[]).find(x=>String(x.id)===id); out.push({id,starter,team,order,score:(4-order)*10+n(tr?.score)+perf(id).recent}); }); });
    return out.sort((a,b)=>b.score-a.score).slice(0,8);
  }

  async function opponentModel(){
    const rows=await getMatchups(state.currentWeek); const mine=rows.find(r=>r.roster_id===state.commissionerRosterId); if(!mine)return null; const opp=rows.find(r=>r.matchup_id===mine.matchup_id&&r.roster_id!==mine.roster_id); if(!opp)return null;
    const myPower=state.powerRankings?.find(x=>x.roster_id===mine.roster_id); const opPower=state.powerRankings?.find(x=>x.roster_id===opp.roster_id); const myP=myPower?.power||50, opP=opPower?.power||50, diff=myP-opP;
    const strategy=diff>=8?'Protect the favorite: favor floor, health and secure workloads.':diff<=-8?'You need variance: favor ceiling, explosive roles and late-game upside.':'Near coin flip: use best median lineup and avoid unnecessary gambles.';
    return {opp:opp.roster_id,myPower:myP,oppPower:opP,diff,strategy};
  }

  async function fetchProjectionWeek(week){
    if(edge.projections.has(week))return edge.projections.get(week);
    try{ const url=`https://api.sleeper.com/projections/nfl/regular/${state.league.season}/${week}?season_type=regular`; const r=await fetch(url,{cache:'no-store'}); if(!r.ok)throw 0; const data=await r.json(); const map=Array.isArray(data)?Object.fromEntries(data.map(x=>[String(x.player_id),x.stats||x])):data||{}; edge.projections.set(week,map); return map; }catch(_){edge.projections.set(week,{});return {};}
  }

  async function streamingPlanner(){
    const rostered=rosteredSet(); const candidates=Object.entries(state.playerMap||{}).filter(([id,p])=>!rostered.has(id)&&['QB','TE','K','DEF'].includes(candidatePosition(p)||p.position));
    const weeks=[state.currentWeek,state.currentWeek+1,state.currentWeek+2].filter(w=>w<=18); const proj=await Promise.all(weeks.map(fetchProjectionWeek)); const field=scoringField();
    return ['QB','TE','K','DEF'].map(pos=>{ const rows=candidates.filter(([id,p])=>(candidatePosition(p)||p.position)===pos).map(([id])=>{ const projected=proj.reduce((s,m)=>s+n(m[id]?.[field]??m[id]?.pts_ppr??m[id]?.pts_half_ppr??m[id]?.pts_std),0); const hasProj=projected>0; const form=perf(id).recent; return {id,pos,projected,form,score:hasProj?projected:form*weeks.length,hasProj}; }).sort((a,b)=>b.score-a.score).slice(0,3); return {pos,rows}; });
  }

  async function playoffSimulation(){
    const playoffStart=Number(state.league?.settings?.playoff_week_start||15); const regEnd=Math.max(state.currentWeek,playoffStart-1); const playoffTeams=Number(state.league?.settings?.playoff_teams||6); const future=[];
    for(let w=state.currentWeek+1;w<=regEnd;w++){ try{future.push({week:w,rows:await getMatchups(w)});}catch(_){} }
    const base=new Map(state.rosters.map(r=>[r.roster_id,{wins:n(r.settings?.wins),pf:pointsFromSettings(r.settings||{},'fpts')} ])); const distributions=new Map();
    state.rosters.forEach(r=>{ const m=state.seasonAnalytics?.metrics?.find(x=>x.roster_id===r.roster_id); distributions.set(r.roster_id,{mean:m?.ppg||pointsFromSettings(r.settings||{},'fpts')/Math.max(1,state.currentWeek),sd:Math.max(8,sd(m?.weeklyScores||[]))}); });
    const counts=new Map(state.rosters.map(r=>[r.roster_id,{playoffs:0,top2:0,first:0}])); const sims=900;
    const gaussian=(mu,s)=>{let u=0,v=0;while(!u)u=Math.random();while(!v)v=Math.random();return Math.max(0,mu+s*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v));};
    for(let sim=0;sim<sims;sim++){ const t=new Map([...base].map(([id,x])=>[id,{...x}])); future.forEach(({rows})=>groupMatchups(rows).filter(p=>p.length===2).forEach(pair=>{ const a=pair[0].roster_id,b=pair[1].roster_id, da=distributions.get(a),db=distributions.get(b); const sa=gaussian(da.mean,da.sd),sb=gaussian(db.mean,db.sd); t.get(a).pf+=sa;t.get(b).pf+=sb;if(sa>sb)t.get(a).wins++;else if(sb>sa)t.get(b).wins++;else{t.get(a).wins+=.5;t.get(b).wins+=.5;} })); const ranked=[...t].sort((a,b)=>b[1].wins-a[1].wins||b[1].pf-a[1].pf); ranked.forEach(([id],i)=>{const c=counts.get(id);if(i<playoffTeams)c.playoffs++;if(i<2)c.top2++;if(i===0)c.first++;}); }
    return [...counts].map(([roster_id,c])=>({roster_id,playoffs:c.playoffs/sims,top2:c.top2/sims,first:c.first/sims})).sort((a,b)=>b.playoffs-a.playoffs);
  }

  function championshipWindow(health,playoffs){
    const p=state.powerRankings?.find(x=>x.roster_id===state.commissionerRosterId); const power=p?.power||50; const odds=playoffs?.find(x=>x.roster_id===state.commissionerRosterId)?.playoffs||.5; const score=Math.round(power*.45+health.score*.30+odds*100*.25);
    let label,advice;if(score>=76){label='ALL-IN WINDOW';advice='Consolidate bench depth into elite starters. Pay a premium for meaningful upgrades.';}else if(score>=62){label='CONTENDER';advice='Be selective. Upgrade weak starters without draining every depth piece.';}else if(score>=47){label='BUBBLE';advice='Chase upside. Prioritize waivers, buy-lows and 2-for-1 trades that raise your ceiling.';}else{label='NEED VOLATILITY';advice='Play aggressively. Turn replaceable depth into upside and seek asymmetrical trades.';} return {score,label,advice,power,odds};
  }

  function tradeDeadline(){ const week=Number(state.league?.settings?.trade_deadline||0); return {week,left:week?week-state.currentWeek:null}; }
  function renderList(target,rows,empty='Nothing urgent right now.'){ document.getElementById(target).innerHTML=rows.length?rows.join(''):`<div class="edge-empty">${e(empty)}</div>`; }
  function card(title,detail,badge){return `<div class="edge-card"><span>${e(badge)}</span><div><strong>${e(title)}</strong><small>${e(detail)}</small></div></div>`;}

  function renderAll(){
    edge.lineup && renderList('edge-lineup',[`<div class="edge-metric"><strong>${round(edge.lineup.optimizedScore)} model pts</strong><span>optimized form score • +${round(edge.lineup.optimizedScore-edge.lineup.currentScore)} vs current</span></div>`,...edge.lineup.swaps.map(s=>card(`Start ${pName(s.in)}`,`${s.slot}: bench ${pName(s.out)} • model edge +${round(s.edge)}`,'START'))],'Your current starters already match the model lineup.');
    renderList('edge-waiverPro',edge.waivers.slice(0,6).map(x=>card(`Add ${playerName(x)}`,`${x.pos} • bid ~${x.faab}% FAAB${x.drop?` • drop ${pName(x.drop.id)}`:''} • ${round(x.recentAvg)} recent pts/g`,'CLAIM')),'No strong waiver upgrades found.');
    renderList('edge-tradeFinder',edge.trades.map(x=>card(`Target ${pName(x.target)}`,`${teamName(x.partner)} has ${x.pos} depth${x.offer?` • shop ${pName(x.offer)}`:''}`,'TRADE')),'No obvious surplus/need trade matchups found.');
    const marketRows=[...edge.buyLow.map(x=>card(`Buy low: ${pName(x.id)}`,`${teamName(x.roster_id)} • recent ${round(x.recent)} vs season ${round(x.season)} pts/g`,'BUY')),...edge.sellHigh.map(x=>card(`Sell high: ${pName(x.id)}`,`recent ${round(x.recent)} vs season ${round(x.season)} pts/g`,'SELL'))]; renderList('edge-market',marketRows,'No strong regression signals right now.');
    renderList('edge-handcuffs',edge.handcuffs.map(x=>card(`${pName(x.id)} — ${x.team}`,`Backup to your ${pName(x.starter)} • depth chart #${x.order}`,'STASH')),'No clear unrostered handcuffs tied to your RB room.');
    if(edge.opponent) renderList('edge-opponent',[`<div class="edge-metric"><strong>${e(teamName(edge.opponent.opp))}</strong><span>Your power ${round(edge.opponent.myPower)} vs ${round(edge.opponent.oppPower)} • ${edge.opponent.diff>=0?'+':''}${round(edge.opponent.diff)} edge</span></div>`,card('Game plan',edge.opponent.strategy,'STRATEGY')]);
    const streamRows=edge.streamers.flatMap(g=>g.rows.slice(0,2).map(x=>card(`${g.pos}: ${pName(x.id)}`,`${x.hasProj?`${round(x.projected)} next-3 projected pts`:`${round(x.form)} recent pts/g`} • ${pTeam(x.id)}`,'STREAM'))); renderList('edge-streamers',streamRows,'No streaming data available yet.');
    renderList('edge-drops',edge.drops.slice(0,8).map((x,i)=>card(`${i<3?'Cuttable':'Hold'}: ${pName(x.id)}`,`${x.pos} • recent ${round(x.recent)} • season ${round(x.season)}${x.injury?` • ${x.injury}`:''}`,i<3?'DROP':'HOLD')));
    if(edge.playoff) renderList('edge-playoffs',edge.playoff.map((x,i)=>`<div class="edge-rank"><b>${i+1}</b><span>${e(teamName(x.roster_id))}</span><strong>${Math.round(x.playoffs*100)}%</strong><small>playoffs • ${Math.round(x.top2*100)}% top-2</small></div>`));
    const td=tradeDeadline(); const weak=['QB','RB','WR','TE','FLEX'].map(pos=>({pos,...positionRank(pos)})).sort((a,b)=>(b.rank/b.total)-(a.rank/a.total)).slice(0,2); renderList('edge-deadline',[`<div class="edge-metric"><strong>${td.week?`Week ${td.week} deadline`:'No Sleeper deadline set'}</strong><span>${td.left==null?'Trade when the value is right.':td.left>=0?`${td.left} week(s) left`:'Deadline passed'}</span></div>`,...weak.map(x=>card(`Upgrade ${x.pos}`,`Your season positional rank is ${x.rank}/${x.total}. This is where a deadline deal helps most.`,'UPGRADE')),...edge.drops.slice(0,2).map(x=>card(`Shop before cutting: ${pName(x.id)}`,'Try a 2-for-1 or throw-in before releasing the asset.','ASSET'))]);
    renderHealth(); renderWindow(); renderToday();
  }

  function renderHealth(){ const h=edge.health; const cls=h.score>=75?'great':h.score>=55?'ok':'risk'; document.getElementById('edgeHealth').innerHTML=`<div class="edge-big-score ${cls}">${h.score}<small>/100</small></div><strong>${h.score>=75?'Strong roster':h.score>=55?'Competitive but fixable':'Needs work'}</strong><p>Position strength ${Math.round(h.posScore)} • bench ${Math.round(h.benchScore)} • availability ${Math.round(h.availability)}</p>`; }
  function renderWindow(){ const w=edge.window; document.getElementById('edgeWindow').innerHTML=`<div class="edge-big-score dark">${w.score}<small>/100</small></div><strong>${e(w.label)}</strong><p>${e(w.advice)}</p><small>Power ${round(w.power)} • modeled playoff odds ${Math.round(w.odds*100)}%</small>`; }

  function renderToday(){
    const actions=[];
    if(edge.lineup?.swaps?.[0]){const s=edge.lineup.swaps[0];actions.push(card(`Start ${pName(s.in)} over ${pName(s.out)}`,`${s.slot} • model edge +${round(s.edge)}`,'DO NOW'));}
    if(edge.waivers[0]){const x=edge.waivers[0];actions.push(card(`Claim ${playerName(x)}`,`${x.pos} • ~${x.faab}% FAAB${x.drop?` • drop ${pName(x.drop.id)}`:''}`,'DO NOW'));}
    if(edge.trades[0]){const x=edge.trades[0];actions.push(card(`Open trade talks for ${pName(x.target)}`,`${teamName(x.partner)} has surplus at ${x.pos}.`,'WATCH'));}
    if(edge.handcuffs[0])actions.push(card(`Consider stashing ${pName(edge.handcuffs[0].id)}`,`Protects ${pName(edge.handcuffs[0].starter)} exposure.`,'WATCH'));
    if(edge.opponent)actions.push(card('Set lineup risk profile',edge.opponent.strategy,'THIS WEEK'));
    renderList('edgeToday',actions.slice(0,6),'No urgent moves. Hold your edge and monitor injuries.');
  }

  async function build(force=false){
    injectShell();
    if(force){edge.playerPerf.clear();edge.projections.clear();}
    document.querySelectorAll('#edge .edge-tool-body,#edgeToday,#edgeHealth,#edgeWindow').forEach(x=>x.innerHTML='<div class="skeleton tall"></div>');
    try{
      if(!state.playerMap||force) await buildPlayerPerf(); else if(!edge.playerPerf.size) await buildPlayerPerf();
      if(!state.waiverPlayers?.length||force) await loadWaivers(force);
      edge.lineup=await optimizeLineup(); edge.drops=dropCandidates(); edge.waivers=waiverRecommendations(); edge.trades=tradeTargets();
      const market=marketSignals(); edge.buyLow=market.buy; edge.sellHigh=market.sell; edge.health=teamHealth(); edge.handcuffs=handcuffBoard(); edge.opponent=await opponentModel(); edge.streamers=await streamingPlanner(); edge.playoff=await playoffSimulation(); edge.window=championshipWindow(edge.health,edge.playoff); renderAll();
      toast('Steve\'s Edge recalculated.');
    }catch(err){console.error(err); document.getElementById('edgeToday').innerHTML=`<div class="error-banner">Could not finish private analysis: ${e(err.message||err)}</div>`;}
  }

  const ready=setInterval(()=>{ if(document.body.classList.contains('commish')&&state?.league&&state?.rosters?.length&&state?.commissionerRosterId){clearInterval(ready);build();} },120);
  setTimeout(()=>clearInterval(ready),20000);
})();