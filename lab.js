/* Dudes Being Dudes — Power Rankings + concise recap prompt */
(function(){
  const avg = (values=[]) => values.length ? values.reduce((sum,v)=>sum + Number(v||0),0) / values.length : 0;
  const stdDev = (values=[]) => {
    if(values.length < 2) return 0;
    const mean = avg(values);
    return Math.sqrt(avg(values.map(v => Math.pow(Number(v||0)-mean,2))));
  };
  const percentile = (value, values) => {
    const clean = values.map(Number).filter(Number.isFinite);
    if(clean.length <= 1) return .5;
    const below = clean.filter(v => v < value).length;
    const equal = Math.max(0, clean.filter(v => v === value).length - 1);
    return (below + equal * .5) / (clean.length - 1);
  };

  function aggregateSeason(weekEntries){
    const byTeam = new Map();
    state.rosters.forEach(r => byTeam.set(r.roster_id, {
      roster_id:r.roster_id, games:0, points:0, actualWins:0,
      allPlayWins:0, allPlayGames:0, weeklyScores:[], weeklyAllPlay:[]
    }));

    weekEntries.forEach(({week,rows}) => {
      if(!rows?.length) return;
      const ap = allPlay(rows);
      const denom = Math.max(rows.length - 1, 1);
      rows.forEach(team => {
        const stat = byTeam.get(team.roster_id);
        if(!stat) return;
        const pts = Number(team.points || 0);
        const apRow = ap.find(x => x.roster_id === team.roster_id);
        const apPct = apRow ? (apRow.wins + apRow.ties * .5) / denom : 0;
        stat.games += 1;
        stat.points += pts;
        stat.actualWins += actualWeekResult(rows, team.roster_id);
        stat.allPlayWins += apRow ? apRow.wins + apRow.ties * .5 : 0;
        stat.allPlayGames += denom;
        stat.weeklyScores.push(pts);
        stat.weeklyAllPlay.push({week,pct:apPct,points:pts});
      });
    });

    return [...byTeam.values()].filter(x=>x.games>0).map(x => {
      const ppg = x.points / x.games;
      return {
        ...x,
        ppg,
        allPlayPct:x.allPlayGames ? x.allPlayWins / x.allPlayGames : 0,
        recordPct:x.games ? x.actualWins / x.games : 0,
        recentPct:avg(x.weeklyAllPlay.slice(-3).map(w=>w.pct)),
        consistency:Math.max(0, 1 - (stdDev(x.weeklyScores) / Math.max(ppg,1)))
      };
    });
  }

  function scorePower(metrics){
    if(!metrics.length) return [];
    const allPlayVals=metrics.map(x=>x.allPlayPct);
    const ppgVals=metrics.map(x=>x.ppg);
    const recentVals=metrics.map(x=>x.recentPct);
    const recordVals=metrics.map(x=>x.recordPct);
    const consistencyVals=metrics.map(x=>x.consistency);
    return metrics.map(x => {
      const components={
        allPlay:percentile(x.allPlayPct,allPlayVals),
        scoring:percentile(x.ppg,ppgVals),
        recent:percentile(x.recentPct,recentVals),
        record:percentile(x.recordPct,recordVals),
        consistency:percentile(x.consistency,consistencyVals),
      };
      const power=100*(components.allPlay*.35 + components.scoring*.30 + components.recent*.20 + components.record*.10 + components.consistency*.05);
      return {...x,components,power:round(power,1)};
    }).sort((a,b)=>b.power-a.power || b.allPlayPct-a.allPlayPct || b.ppg-a.ppg);
  }

  function movementLabel(move){
    if(move > 0) return `<span class="power-move up">▲${move}</span>`;
    if(move < 0) return `<span class="power-move down">▼${Math.abs(move)}</span>`;
    return `<span class="power-move flat">—</span>`;
  }

  function standingsRanks(metrics){
    const ordered=[...metrics].sort((a,b)=>b.actualWins-a.actualWins || b.points-a.points);
    return new Map(ordered.map((x,i)=>[x.roster_id,i+1]));
  }

  function recommendationInsights(metrics,power){
    const standingRanks=standingsRanks(metrics);
    const rows=power.map(x=>{
      const standingRank=standingRanks.get(x.roster_id) || metrics.length;
      return {...x,standingRank,powerRank:x.rank,rankGap:x.rank-standingRank};
    });
    const fraud=[...rows].sort((a,b)=>b.rankGap-a.rankGap)[0];
    const better=[...rows].sort((a,b)=>a.rankGap-b.rankGap)[0];
    const worse=fraud;
    return {better,worse,fraud};
  }

  function ensureRecommendationPanel(){
    const powerPanel=document.getElementById('allPlayList')?.closest('article');
    if(!powerPanel || document.getElementById('recommendationsList')) return;
    const wrap=document.createElement('div');
    wrap.className='power-storylines';
    wrap.innerHTML=`<div class="power-storylines-head"><small>MODEL CALLS</small><span>Power vs. standings</span></div><div id="recommendationsList" class="recommendation-list"></div>`;
    powerPanel.appendChild(wrap);
  }

  function renderRecommendations(metrics,power){
    ensureRecommendationPanel();
    const box=document.getElementById('recommendationsList');
    if(!box) return;
    const {better,worse,fraud}=recommendationInsights(metrics,power);
    const cards=[];
    if(fraud && fraud.rankGap>0) cards.push({icon:'🚨',label:'FRAUD WATCH',tone:'warn',team:teamName(fraud.roster_id),copy:`Standing #${fraud.standingRank}, but only #${fraud.powerRank} in Power Rankings.`});
    if(better && better.rankGap<0) cards.push({icon:'📈',label:'BETTER THAN RECORD',tone:'good',team:teamName(better.roster_id),copy:`Power rank #${better.powerRank} vs standings #${better.standingRank}. Underlying strength is better than the record.`});
    if(worse && worse.rankGap>0) cards.push({icon:'📉',label:'WORSE THAN RECORD',tone:'bad',team:teamName(worse.roster_id),copy:`Standing #${worse.standingRank} vs power rank #${worse.powerRank}. The record is ahead of the model.`});
    box.innerHTML=cards.length ? cards.map(c=>`<div class="recommendation-card ${c.tone}"><span class="rec-icon">${c.icon}</span><div><small>${c.label}</small><strong>${esc(c.team)}</strong><p>${esc(c.copy)}</p></div></div>`).join('') : '<div class="edge-empty">Standings and Power Rankings are closely aligned.</div>';
    state.modelRecommendations={better,worse,fraud};
  }

  function renderWeeklyAwards(rows){
    if(!rows?.length){ $("awardsList").innerHTML='<div class="edge-empty">No completed scores yet.</div>'; return; }
    const sorted=[...rows].sort((a,b)=>Number(b.points||0)-Number(a.points||0));
    const pairs=groupMatchups(rows).filter(x=>x.length===2);
    const biggest=pairs.map(p=>({p,margin:Math.abs(Number(p[0].points||0)-Number(p[1].points||0))})).sort((a,b)=>b.margin-a.margin)[0];
    const closest=[...pairs].sort((a,b)=>Math.abs(a[0].points-a[1].points)-Math.abs(b[0].points-b[1].points))[0];
    const items=[
      ['Top score',`${teamName(sorted[0].roster_id)} — ${round(sorted[0].points)}`],
      ['Lowest score',`${teamName(sorted.at(-1).roster_id)} — ${round(sorted.at(-1).points)}`],
      biggest ? ['Biggest beatdown',`${teamName([...biggest.p].sort((a,b)=>b.points-a.points)[0].roster_id)} — +${round(biggest.margin)}`] : null,
      closest ? ['Closest finish',`${teamName(closest[0].roster_id)} vs ${teamName(closest[1].roster_id)} — ${round(Math.abs(closest[0].points-closest[1].points))}`] : null
    ].filter(Boolean);
    $("awardsList").innerHTML=items.map(([a,b])=>`<div class="award-item"><strong>${esc(a)}</strong><span>${esc(b)}</span></div>`).join('');
  }

  function renderSeasonLab(){
    if(!state.seasonAnalytics) return;
    const power=state.powerRankings || [];
    const expanded=!!state.powerExpanded;
    const visible=expanded ? power : power.slice(0,5);
    $("allPlayList").innerHTML = visible.map(x=>`<div class="power-row"><span class="power-rank">${x.rank}</span><div class="power-team"><strong>${esc(teamName(x.roster_id))}</strong><small>${round(x.ppg)} PPG • ${Math.round(x.allPlayPct*100)}% all-play • last 3 ${Math.round(x.recentPct*100)}%</small></div><div class="power-score"><strong>${x.power}</strong><span>POWER</span></div>${movementLabel(x.movement)}</div>`).join('') +
      (power.length>5?`<button class="inline-expand power-expand" type="button" id="powerExpandBtn">${expanded?'Show top 5':'View all teams'}</button>`:'');
    $("powerExpandBtn")?.addEventListener("click",()=>{state.powerExpanded=!state.powerExpanded;renderSeasonLab();});
    renderRecommendations(state.seasonAnalytics.metrics,power);
    const badge=$("labThroughWeek");
    if(badge) badge.textContent=`Through Week ${state.seasonAnalytics.latestWeek}`;
  }

  async function buildSeasonAnalytics(){
    const weeks=Array.from({length:Math.max(1,state.currentWeek)},(_,i)=>i+1);
    const all=await Promise.all(weeks.map(async week=>({week,rows:await getMatchups(week)})));
    const completed=all.filter(({rows})=>rows?.length && rows.some(r=>Number(r.points||0)>0));
    if(!completed.length) return;
    const metrics=aggregateSeason(completed);
    const power=scorePower(metrics);
    const previous=completed.length>1 ? scorePower(aggregateSeason(completed.slice(0,-1))) : power;
    const previousRanks=new Map(previous.map((x,i)=>[x.roster_id,i+1]));
    power.forEach((x,i)=>{x.rank=i+1;x.previousRank=previousRanks.get(x.roster_id)||i+1;x.movement=x.previousRank-x.rank;});
    state.seasonAnalytics={weeks:completed.map(x=>x.week),latestWeek:completed.at(-1).week,metrics};
    state.powerRankings=power;
    renderSeasonLab();
  }

  function weeklyAwardsForPrompt(rows){
    if(!rows?.length) return [];
    const sorted=[...rows].sort((a,b)=>Number(b.points||0)-Number(a.points||0));
    const pairs=groupMatchups(rows).filter(p=>p.length===2);
    const closest=[...pairs].sort((a,b)=>Math.abs(a[0].points-a[1].points)-Math.abs(b[0].points-b[1].points))[0];
    const biggest=[...pairs].map(p=>({p,margin:Math.abs(Number(p[0].points||0)-Number(p[1].points||0))})).sort((a,b)=>b.margin-a.margin)[0];
    const out=[`High score: ${teamName(sorted[0].roster_id)} ${round(sorted[0].points)}`];
    if(closest) out.push(`Closest: ${teamName(closest[0].roster_id)} vs ${teamName(closest[1].roster_id)} (${round(Math.abs(closest[0].points-closest[1].points))} pts)`);
    if(biggest){const winner=[...biggest.p].sort((a,b)=>b.points-a.points)[0];out.push(`Blowout: ${teamName(winner.roster_id)} by ${round(biggest.margin)}`);}
    return out;
  }

  function modelCallsForPrompt(){
    const r=state.modelRecommendations;if(!r)return [];
    const out=[];
    if(r.fraud?.rankGap>0) out.push(`Fraud: ${teamName(r.fraud.roster_id)} standings #${r.fraud.standingRank}, power #${r.fraud.powerRank}`);
    if(r.better?.rankGap<0) out.push(`Better than record: ${teamName(r.better.roster_id)} standings #${r.better.standingRank}, power #${r.better.powerRank}`);
    return out;
  }

  async function buildRecapPrompt(){
    const week=Number($("recapWeek")?.value || state.selectedWeek || state.currentWeek);
    const rows=await getMatchups(week);
    const matchups=groupMatchups(rows).filter(p=>p.length===2).map(pair=>{const [w,l]=[...pair].sort((a,b)=>Number(b.points||0)-Number(a.points||0));return `${teamName(w.roster_id)} ${round(w.points)} def. ${teamName(l.roster_id)} ${round(l.points)}`;});
    const awards=weeklyAwardsForPrompt(rows);
    const power=(state.powerRankings||[]).map(x=>`#${x.rank} ${teamName(x.roster_id)} (${x.power}${x.movement?`, ${x.movement>0?'↑':'↓'}${Math.abs(x.movement)}`:''})`);
    const calls=modelCallsForPrompt();
    const positions=POSITIONS.map(pos=>{const x=positionRanking(pos)?.[0];return x?`${pos} ${teamName(x.roster_id)} ${round(x.total)}`:null;}).filter(Boolean);
    return `Write the Week ${week} recap for "${state.league?.name || 'Dudes Being Dudes'}". Funny, roast-heavy friend-group tone; do not invent facts. Use 2–4 sentences per matchup, then Power Rankings/storylines, awards, 3 next-week takeaways, and a commissioner closing line.\n\nMATCHUPS\n${matchups.join('\n')}\n\nAWARDS\n${awards.join('\n')}\n\nPOWER RANKINGS\n${power.join('\n')}\n${calls.length?`\nSTORYLINES\n${calls.join('\n')}`:''}\n\nPOSITION LEADERS\n${positions.join(' • ')}\n\nKeep names and numbers exact.`;
  }

  async function copyText(text){
    try{await navigator.clipboard.writeText(text);return true;}catch(_){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok;}
  }

  function setupRecapPromptUI(){
    if(!document.body.classList.contains('commish')) return;
    const generator=document.querySelector('.commish-generator');
    if(!generator || generator.dataset.promptMode==='v2') return;
    generator.dataset.promptMode='v2';
    generator.innerHTML=`<div><strong>Build a concise ChatGPT prompt</strong><span>Matchups, awards, Power Rankings and the few storylines worth mentioning.</span></div><button class="btn btn-primary" type="button" id="buildPromptBtn">📋 Build prompt</button>`;
    const formGrid=document.querySelector('#recapForm .form-grid');
    if(formGrid && !document.getElementById('recapPrompt')){
      const wrapper=document.createElement('div');wrapper.className='prompt-export full';
      wrapper.innerHTML=`<label>Prompt for ChatGPT<textarea id="recapPrompt" rows="7" readonly placeholder="Choose a week and tap Build prompt."></textarea></label><div class="prompt-actions"><button class="btn btn-primary" type="button" id="copyPromptBtn">Copy prompt</button><span id="promptStatus">Nothing generated yet.</span></div>`;
      formGrid.insertBefore(wrapper,formGrid.children[2]||null);
    }
    document.getElementById('generateRecapBtn')?.remove();
    document.getElementById('buildPromptBtn')?.addEventListener('click',async()=>{const prompt=await buildRecapPrompt();const area=document.getElementById('recapPrompt');if(area)area.value=prompt;const copied=await copyText(prompt);const status=document.getElementById('promptStatus');if(status)status.textContent=copied?'Copied — paste it into ChatGPT.':'Prompt ready.';toast(copied?'Concise recap prompt copied.':'Prompt ready.');});
    document.getElementById('copyPromptBtn')?.addEventListener('click',async()=>{const text=document.getElementById('recapPrompt')?.value||'';if(!text){toast('Build the prompt first.');return;}toast(await copyText(text)?'Prompt copied.':'Select and copy the prompt manually.');});
  }

  renderLab=function(rows){renderWeeklyAwards(rows);if(state.seasonAnalytics)renderSeasonLab();};
  setupRecapPromptUI();
  const ready=setInterval(()=>{if(state?.league&&state?.rosters?.length&&state?.currentWeek){clearInterval(ready);buildSeasonAnalytics().catch(console.error);setupRecapPromptUI();}},80);
  setTimeout(()=>clearInterval(ready),15000);
})();
