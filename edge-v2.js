/* Dudes Being Dudes — private commissioner decision-support dashboard v2 */
(function(){
  if(!new URLSearchParams(location.search).get('commish')) return;

  const edge={playerPerf:new Map(),projections:new Map(),currentRows:[],lineup:null,waivers:[],drops:[],trades:[],buyLow:[],sellHigh:[],handcuffs:[],streamers:[],health:null,opponent:null,window:null};
  const n=v=>Number(v||0), mean=a=>a.length?a.reduce((s,x)=>s+n(x),0)/a.length:0, clamp=(v,min,max)=>Math.max(min,Math.min(max,v)), e=(s='')=>esc(s);
  const severe=new Set(['IR','OUT','PUP','SUSPENDED']);

  function tool(id,icon,title,desc){return `<details class="panel edge-tool" id="tool-${id}"><summary><span>${icon}</span><div><strong>${title}</strong><small>${desc}</small></div><b>⌄</b></summary><div class="edge-tool-body" id="edge-${id}"><div class="skeleton tall"></div></div></details>`;}
  function injectShell(){
    if(document.getElementById('edge')) return;
    const section=document.createElement('section');section.id='edge';section.className='wrap section commish-only edge-section';
    section.innerHTML=`<div class="section-head edge-head"><div><span class="kicker">PRIVATE • COMMISSIONER ONLY</span><h2>Steve's Edge</h2><p class="section-copy">Your action board for lineup, waivers, trades, streaming and roster management.</p></div><button class="btn btn-secondary" id="edgeRefresh" type="button">↻ Recalculate</button></div>
      <div class="edge-top edge-rail"><article class="panel edge-action-card"><span class="kicker">WHAT SHOULD I DO TODAY?</span><div id="edgeToday" class="edge-actions"><div class="skeleton tall"></div></div></article><article class="panel edge-score-card"><span class="kicker">TEAM HEALTH</span><div id="edgeHealth"><div class="skeleton tall"></div></div></article><article class="panel panel-dark edge-score-card"><span class="kicker">CHAMPIONSHIP WINDOW</span><div id="edgeWindow"><div class="skeleton tall"></div></div></article></div>
      <div class="edge-accordion edge-rail" id="edgeTools">
        ${tool('lineup','🧠','Start / Sit Optimizer','Best lineup from recent scoring, injuries and slot eligibility.')}
        ${tool('waiverPro','🎯','Waiver Priority Engine','Add/drop recommendations with roster fit and suggested FAAB aggression.')}
        ${tool('tradeFinder','🤝','Trade Target Finder','Managers with surplus where you are weak, plus an asset to shop.')}
        ${tool('market','📈','Buy Low / Sell High','Scoring trend gaps that may indicate overreaction opportunities.')}
        ${tool('handcuffs','🩹','Handcuff & Injury Board','High-leverage backups tied to your roster and current injury risk.')}
        ${tool('opponent','🎮','Opponent Exploiter','Compare current opponent strength and choose a floor or ceiling strategy.')}
        ${tool('streamers','🌊','Streaming Planner','QB / TE / K / DEF options using projections when available and recent form otherwise.')}
        ${tool('drops','🗑️','Drop Risk Analyzer','Bench players ranked from safest hold to most cuttable.')}
        ${tool('deadline','⏰','Trade Deadline Mode','Best upgrade areas, expendable assets and urgency before the deadline.')}
      </div>`;
    const waivers=document.getElementById('waivers');(waivers?.parentNode||document.querySelector('main')).insertBefore(section,waivers||document.getElementById('standings'));
    const heroActions=document.querySelector('.hero-actions');if(heroActions&&!document.getElementById('edgeJump'))heroActions.insertAdjacentHTML('beforeend','<a id="edgeJump" class="btn btn-secondary commish-only" href="#edge">⚡ Steve\'s Edge</a>');
    const nav=document.querySelector('.nav');if(nav&&!nav.querySelector('a[href="#edge"]'))nav.insertAdjacentHTML('beforeend','<a class="commish-only" href="#edge">Steve\'s Edge</a>');
    document.getElementById('edgeRefresh')?.addEventListener('click',()=>build(true));
    document.getElementById('commissionerRosterSelect')?.addEventListener('change',()=>setTimeout(()=>build(true),50));
  }

  function player(id){return state.playerMap?.[String(id)]||{};}
  function pName(id){const p=player(id);return p.full_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||p.team||String(id);}
  function pPos(id){const p=player(id);return candidatePosition(p)||p.position||'—';}
  function pTeam(id){return player(id).team||'FA';}
  function injury(id){return String(player(id).injury_status||'').toUpperCase();}
  function rosteredSet(){return new Set(state.rosters.flatMap(r=>r.players||[]).map(String));}
  function myRoster(){return state.rostersById.get(Number(state.commissionerRosterId));}
  function myPlayers(){return (myRoster()?.players||[]).map(String);}
  function currentRow(rosterId){return edge.currentRows.find(r=>Number(r.roster_id)===Number(rosterId))||null;}

  function slotEligible(id,slot){const p=player(id),ps=(p.fantasy_positions||[p.position]).filter(Boolean);if(['QB','RB','WR','TE','K','DEF'].includes(slot))return ps.includes(slot)||p.position===slot;if(String(slot).includes('FLEX')||['W/R/T','REC_FLEX'].includes(slot))return ps.some(x=>['RB','WR','TE'].includes(x));if(['SUPER_FLEX','SUPERFLEX','Q/W/R/T'].includes(slot))return ps.some(x=>['QB','RB','WR','TE'].includes(x));return false;}

  async function buildPlayerPerf(){
    await loadPlayerMap();
    const weeks=Array.from({length:Math.max(1,state.currentWeek)},(_,i)=>i+1),stats=await Promise.all(weeks.map(fetchStatsWeek)),field=scoringField();
    Object.keys(state.playerMap||{}).forEach(id=>{const scores=stats.map(s=>n(s[id]?.[field]??s[id]?.pts_ppr??s[id]?.pts_half_ppr??s[id]?.pts_std));const season=mean(scores),recent=mean(scores.slice(-3));let model=recent*.65+season*.35;const inj=injury(id);if(severe.has(inj))model*=.15;else if(inj==='DOUBTFUL')model*=.55;else if(inj==='QUESTIONABLE')model*=.88;edge.playerPerf.set(String(id),{scores,season,recent,last:n(scores.at(-1)),model});});
  }
  function perf(id){return edge.playerPerf.get(String(id))||{scores:[],season:0,recent:0,last:0,model:0};}

  async function optimizeLineup(){
    const roster=myRoster();if(!roster)return null;const row=currentRow(roster.roster_id),ids=(roster.players||[]).map(String).filter(id=>!severe.has(injury(id))),slots=starterSlots();
    const order=slots.map((slot,index)=>({slot,index})).sort((a,b)=>Number(String(a.slot).includes('FLEX'))-Number(String(b.slot).includes('FLEX'))),used=new Set(),picks=[];
    order.forEach(s=>{const id=ids.filter(id=>!used.has(id)&&slotEligible(id,s.slot)).sort((a,b)=>perf(b).model-perf(a).model)[0];if(id){used.add(id);picks.push({...s,id,score:perf(id).model});}});picks.sort((a,b)=>a.index-b.index);
    const current=(row?.starters||[]).map(String),swaps=[];picks.forEach((pick,i)=>{const cur=current[i];if(cur&&pick.id!==cur&&perf(pick.id).model>perf(cur).model+1)swaps.push({slot:pick.slot,in:pick.id,out:cur,edge:perf(pick.id).model-perf(cur).model});});
    return {picks,current,swaps,currentScore:current.reduce((s,id)=>s+perf(id).model,0),optimizedScore:picks.reduce((s,x)=>s+x.score,0)};
  }

  function positionRank(pos){try{const r=positionRanking(pos),idx=r.findIndex(x=>x.roster_id===state.commissionerRosterId);return {rank:idx+1,total:r.length};}catch(_){return {rank:0,total:state.rosters.length};}}
  function dropCandidates(){const starters=new Set((currentRow(state.commissionerRosterId)?.starters||[]).map(String));return myPlayers().filter(id=>!starters.has(id)).map(id=>{const p=perf(id),inj=injury(id),pos=pPos(id);let value=p.model;if(severe.has(inj))value-=3;if(pos==='RB'&&Number(player(id).depth_chart_order||99)<=2)value+=2;return {id,pos,value,recent:p.recent,season:p.season,injury:inj};}).sort((a,b)=>a.value-b.value);}
  function waiverRecommendations(){const drops=dropCandidates();return (state.waiverPlayers||[]).slice(0,15).map((x,i)=>{const drop=drops.find(d=>d.pos===x.pos)||drops[0],faab=clamp(Math.round(x.score*.32+Math.max(0,12-i)),2,35);return {...x,drop,faab};}).sort((a,b)=>b.score-a.score);}
  function rosterPosPlayers(roster,pos){return (roster.players||[]).map(String).filter(id=>pPos(id)===pos).sort((a,b)=>perf(b).model-perf(a).model);}
  function tradeTargets(){
    const weak=['QB','RB','WR','TE'].map(pos=>({pos,...positionRank(pos)})).sort((a,b)=>(b.rank/b.total)-(a.rank/a.total)).slice(0,2),strong=['QB','RB','WR','TE'].map(pos=>({pos,...positionRank(pos)})).sort((a,b)=>(a.rank/a.total)-(b.rank/b.total))[0];
    const myStarters=new Set((currentRow(state.commissionerRosterId)?.starters||[]).map(String)),offer=myPlayers().filter(id=>pPos(id)===strong?.pos&&!myStarters.has(id)).sort((a,b)=>perf(b).model-perf(a).model)[0],out=[];
    weak.forEach(w=>state.rosters.filter(r=>r.roster_id!==state.commissionerRosterId).forEach(r=>{const list=rosterPosPlayers(r,w.pos);if(list.length<2)return;const starts=new Set((currentRow(r.roster_id)?.starters||[]).map(String)),target=list.find(id=>!starts.has(id))||list[1];if(target)out.push({partner:r.roster_id,pos:w.pos,target,offer,score:perf(target).model+list.length*1.5});}));return out.sort((a,b)=>b.score-a.score).slice(0,6);
  }
  function marketSignals(){const others=state.rosters.filter(r=>r.roster_id!==state.commissionerRosterId).flatMap(r=>(r.players||[]).map(id=>({id:String(id),roster_id:r.roster_id}))),buy=others.map(x=>({...x,...perf(x.id)})).filter(x=>x.season>=6&&x.recent<x.season*.75&&!severe.has(injury(x.id))).sort((a,b)=>(a.recent/a.season)-(b.recent/b.season)).slice(0,6),sell=myPlayers().map(id=>({id,...perf(id)})).filter(x=>x.season>=5&&x.recent>x.season*1.28).sort((a,b)=>(b.recent/b.season)-(a.recent/a.season)).slice(0,5);return {buy,sell};}
  function teamHealth(){const ranks=['QB','RB','WR','TE','FLEX'].map(positionRank).filter(x=>x.rank),posScore=ranks.length?mean(ranks.map(x=>100*(1-(x.rank-1)/Math.max(1,x.total-1)))):50,starters=new Set((currentRow(state.commissionerRosterId)?.starters||[]).map(String)),bench=myPlayers().filter(id=>!starters.has(id)),benchScore=clamp(mean(bench.map(id=>perf(id).model))/12*100,0,100),injured=myPlayers().filter(id=>severe.has(injury(id))).length,q=myPlayers().filter(id=>injury(id)==='QUESTIONABLE').length,availability=clamp(100-injured*14-q*4,0,100);return {score:Math.round(posScore*.55+benchScore*.25+availability*.20),posScore,benchScore,availability,injured,q};}
  function handcuffBoard(){const rostered=rosteredSet(),out=[];myPlayers().filter(id=>pPos(id)==='RB').forEach(starter=>{const team=pTeam(starter);if(!team||team==='FA')return;Object.entries(state.playerMap||{}).forEach(([id,p])=>{if(rostered.has(id)||id===starter||candidatePosition(p)!=='RB'||p.team!==team)return;const order=Number(p.depth_chart_order||99);if(order>3)return;const tr=(state.waiverPlayers||[]).find(x=>String(x.id)===id);out.push({id,starter,team,order,score:(4-order)*10+n(tr?.score)+perf(id).recent});});});return out.sort((a,b)=>b.score-a.score).slice(0,8);}
  async function opponentModel(){const mine=currentRow(state.commissionerRosterId);if(!mine)return null;const opp=edge.currentRows.find(r=>r.matchup_id===mine.matchup_id&&r.roster_id!==mine.roster_id);if(!opp)return null;const myP=state.powerRankings?.find(x=>x.roster_id===mine.roster_id)?.power||50,opP=state.powerRankings?.find(x=>x.roster_id===opp.roster_id)?.power||50,diff=myP-opP;return {opp:opp.roster_id,myPower:myP,oppPower:opP,diff,strategy:diff>=8?'Protect the favorite: favor floor, health and secure workloads.':diff<=-8?'You need variance: favor ceiling and explosive roles.':'Near coin flip: use the best median lineup and avoid unnecessary gambles.'};}

  async function fetchProjectionWeek(week){if(edge.projections.has(week))return edge.projections.get(week);try{const r=await fetch(`https://api.sleeper.com/projections/nfl/regular/${state.league.season}/${week}?season_type=regular`,{cache:'no-store'});if(!r.ok)throw 0;const data=await r.json(),map=Array.isArray(data)?Object.fromEntries(data.map(x=>[String(x.player_id),x.stats||x])):data||{};edge.projections.set(week,map);return map;}catch(_){edge.projections.set(week,{});return {};}}
  async function streamingPlanner(){const rostered=rosteredSet(),candidates=Object.entries(state.playerMap||{}).filter(([id,p])=>!rostered.has(id)&&['QB','TE','K','DEF'].includes(candidatePosition(p)||p.position)),weeks=[state.currentWeek,state.currentWeek+1,state.currentWeek+2].filter(w=>w<=18),proj=await Promise.all(weeks.map(fetchProjectionWeek)),field=scoringField();return ['QB','TE','K','DEF'].map(pos=>({pos,rows:candidates.filter(([id,p])=>(candidatePosition(p)||p.position)===pos).map(([id])=>{const projected=proj.reduce((s,m)=>s+n(m[id]?.[field]??m[id]?.pts_ppr??m[id]?.pts_half_ppr??m[id]?.pts_std),0),form=perf(id).recent;return {id,pos,projected,form,score:projected>0?projected:form*weeks.length,hasProj:projected>0};}).sort((a,b)=>b.score-a.score).slice(0,3)}));}

  function championshipWindow(health){const power=state.powerRankings?.find(x=>x.roster_id===state.commissionerRosterId)?.power||50,score=Math.round(power*.60+health.score*.40);let label,advice;if(score>=76){label='ALL-IN WINDOW';advice='Consolidate bench depth into elite starters. Pay a premium for meaningful upgrades.';}else if(score>=62){label='CONTENDER';advice='Be selective. Upgrade weak starters without draining every depth piece.';}else if(score>=47){label='BUBBLE';advice='Chase upside. Prioritize waivers, buy-lows and 2-for-1 trades that raise your ceiling.';}else{label='NEED VOLATILITY';advice='Play aggressively. Turn replaceable depth into upside and seek asymmetrical trades.';}return {score,label,advice,power,health:health.score};}
  function tradeDeadline(){const week=Number(state.league?.settings?.trade_deadline||0);return {week,left:week?week-state.currentWeek:null};}
  function renderList(target,rows,empty='Nothing urgent right now.'){const el=document.getElementById(target);if(el)el.innerHTML=rows.length?rows.join(''):`<div class="edge-empty">${e(empty)}</div>`;}
  function card(title,detail,badge){return `<div class="edge-card"><span>${e(badge)}</span><div><strong>${e(title)}</strong><small>${e(detail)}</small></div></div>`;}

  function renderHealth(){const h=edge.health,cls=h.score>=75?'great':h.score>=55?'ok':'risk';document.getElementById('edgeHealth').innerHTML=`<div class="edge-big-score ${cls}">${h.score}<small>/100</small></div><strong>${h.score>=75?'Strong roster':h.score>=55?'Competitive but fixable':'Needs work'}</strong><p>Position strength ${Math.round(h.posScore)} • bench ${Math.round(h.benchScore)} • availability ${Math.round(h.availability)}</p>`;}
  function renderWindow(){const w=edge.window;document.getElementById('edgeWindow').innerHTML=`<div class="edge-big-score dark">${w.score}<small>/100</small></div><strong>${e(w.label)}</strong><p>${e(w.advice)}</p><small>Power ${round(w.power)} • team health ${Math.round(w.health)}</small>`;}
  function renderToday(){const actions=[];if(edge.lineup?.swaps?.[0]){const s=edge.lineup.swaps[0];actions.push(card(`Start ${pName(s.in)} over ${pName(s.out)}`,`${s.slot} • model edge +${round(s.edge)}`,'DO NOW'));}if(edge.waivers[0]){const x=edge.waivers[0];actions.push(card(`Claim ${playerName(x)}`,`${x.pos} • ~${x.faab}% FAAB${x.drop?` • drop ${pName(x.drop.id)}`:''}`,'DO NOW'));}if(edge.trades[0]){const x=edge.trades[0];actions.push(card(`Open trade talks for ${pName(x.target)}`,`${teamName(x.partner)} has surplus at ${x.pos}.`,'WATCH'));}if(edge.handcuffs[0])actions.push(card(`Consider stashing ${pName(edge.handcuffs[0].id)}`,`Protects ${pName(edge.handcuffs[0].starter)} exposure.`,'WATCH'));if(edge.opponent)actions.push(card('Set lineup risk profile',edge.opponent.strategy,'THIS WEEK'));renderList('edgeToday',actions.slice(0,6),'No urgent moves. Hold your edge and monitor injuries.');}

  function renderAll(){
    if(edge.lineup)renderList('edge-lineup',[`<div class="edge-metric"><strong>${round(edge.lineup.optimizedScore)} model pts</strong><span>optimized form score • +${round(edge.lineup.optimizedScore-edge.lineup.currentScore)} vs current</span></div>`,...edge.lineup.swaps.map(s=>card(`Start ${pName(s.in)}`,`${s.slot}: bench ${pName(s.out)} • model edge +${round(s.edge)}`,'START'))],'Your current starters already match the model lineup.');
    renderList('edge-waiverPro',edge.waivers.slice(0,6).map(x=>card(`Add ${playerName(x)}`,`${x.pos} • bid ~${x.faab}% FAAB${x.drop?` • drop ${pName(x.drop.id)}`:''} • ${round(x.recentAvg)} recent pts/g`,'CLAIM')),'No strong waiver upgrades found.');
    renderList('edge-tradeFinder',edge.trades.map(x=>card(`Target ${pName(x.target)}`,`${teamName(x.partner)} has ${x.pos} depth${x.offer?` • shop ${pName(x.offer)}`:''}`,'TRADE')),'No obvious surplus/need trade matchups found.');
    renderList('edge-market',[...edge.buyLow.map(x=>card(`Buy low: ${pName(x.id)}`,`${teamName(x.roster_id)} • recent ${round(x.recent)} vs season ${round(x.season)} pts/g`,'BUY')),...edge.sellHigh.map(x=>card(`Sell high: ${pName(x.id)}`,`recent ${round(x.recent)} vs season ${round(x.season)} pts/g`,'SELL'))],'No strong regression signals right now.');
    renderList('edge-handcuffs',edge.handcuffs.map(x=>card(`${pName(x.id)} — ${x.team}`,`Backup to your ${pName(x.starter)} • depth chart #${x.order}`,'STASH')),'No clear unrostered handcuffs tied to your RB room.');
    if(edge.opponent)renderList('edge-opponent',[`<div class="edge-metric"><strong>${e(teamName(edge.opponent.opp))}</strong><span>Your power ${round(edge.opponent.myPower)} vs ${round(edge.opponent.oppPower)} • ${edge.opponent.diff>=0?'+':''}${round(edge.opponent.diff)} edge</span></div>`,card('Game plan',edge.opponent.strategy,'STRATEGY')]);
    renderList('edge-streamers',edge.streamers.flatMap(g=>g.rows.slice(0,2).map(x=>card(`${g.pos}: ${pName(x.id)}`,`${x.hasProj?`${round(x.projected)} next-3 projected pts`:`${round(x.form)} recent pts/g`} • ${pTeam(x.id)}`,'STREAM'))),'No streaming data available yet.');
    renderList('edge-drops',edge.drops.slice(0,8).map((x,i)=>card(`${i<3?'Cuttable':'Hold'}: ${pName(x.id)}`,`${x.pos} • recent ${round(x.recent)} • season ${round(x.season)}${x.injury?` • ${x.injury}`:''}`,i<3?'DROP':'HOLD')));
    const td=tradeDeadline(),weak=['QB','RB','WR','TE','FLEX'].map(pos=>({pos,...positionRank(pos)})).sort((a,b)=>(b.rank/b.total)-(a.rank/a.total)).slice(0,2);renderList('edge-deadline',[`<div class="edge-metric"><strong>${td.week?`Week ${td.week} deadline`:'No Sleeper deadline set'}</strong><span>${td.left==null?'Trade when the value is right.':td.left>=0?`${td.left} week(s) left`:'Deadline passed'}</span></div>`,...weak.map(x=>card(`Upgrade ${x.pos}`,`Your season positional rank is ${x.rank}/${x.total}.`,'UPGRADE')),...edge.drops.slice(0,2).map(x=>card(`Shop before cutting: ${pName(x.id)}`,'Try a 2-for-1 or throw-in before releasing the asset.','ASSET'))]);
    renderHealth();renderWindow();renderToday();
  }

  async function build(force=false){
    injectShell();if(force){edge.playerPerf.clear();edge.projections.clear();}
    document.querySelectorAll('#edge .edge-tool-body,#edgeToday,#edgeHealth,#edgeWindow').forEach(x=>x.innerHTML='<div class="skeleton tall"></div>');
    try{
      if(!state.playerMap||force||!edge.playerPerf.size)await buildPlayerPerf();if(!state.waiverPlayers?.length||force)await loadWaivers(force);edge.currentRows=await getMatchups(state.currentWeek);
      edge.lineup=await optimizeLineup();edge.drops=dropCandidates();edge.waivers=waiverRecommendations();edge.trades=tradeTargets();const market=marketSignals();edge.buyLow=market.buy;edge.sellHigh=market.sell;edge.health=teamHealth();edge.handcuffs=handcuffBoard();edge.opponent=await opponentModel();edge.streamers=await streamingPlanner();edge.window=championshipWindow(edge.health);renderAll();toast("Steve's Edge recalculated.");
    }catch(err){console.error(err);const box=document.getElementById('edgeToday');if(box)box.innerHTML=`<div class="error-banner">Could not finish private analysis: ${e(err.message||err)}</div>`;}
  }

  const ready=setInterval(()=>{if(document.body.classList.contains('commish')&&state?.league&&state?.rosters?.length&&state?.commissionerRosterId&&state?.powerRankings?.length){clearInterval(ready);build();}},120);
  setTimeout(()=>clearInterval(ready),20000);
})();
