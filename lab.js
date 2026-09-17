/* Dudes Being Dudes — season luck, power rankings, recommendations + recap prompt handoff */
(function(){
  const avg2 = (values=[]) => values.length ? values.reduce((sum,v)=>sum + Number(v||0),0) / values.length : 0;
  const stdDev2 = (values=[]) => {
    if(values.length < 2) return 0;
    const mean = avg2(values);
    return Math.sqrt(avg2(values.map(v => Math.pow(Number(v||0)-mean,2))));
  };
  const percentile2 = (value, values) => {
    const clean = values.map(Number).filter(Number.isFinite);
    if(clean.length <= 1) return .5;
    const below = clean.filter(v => v < value).length;
    const equal = Math.max(0, clean.filter(v => v === value).length - 1);
    return (below + equal * .5) / (clean.length - 1);
  };

  function aggregateSeason2(weekEntries){
    const byTeam = new Map();
    state.rosters.forEach(r => byTeam.set(r.roster_id, {
      roster_id:r.roster_id, games:0, points:0, actualWins:0, expectedWins:0,
      allPlayWins:0, allPlayGames:0, opponentPoints:0, opponentGames:0,
      weeklyScores:[], weeklyAllPlay:[]
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
        const actual = actualWeekResult(rows, team.roster_id);
        const opponent = rows.find(r => r.matchup_id != null && r.matchup_id === team.matchup_id && r.roster_id !== team.roster_id);

        stat.games += 1;
        stat.points += pts;
        stat.actualWins += actual;
        stat.expectedWins += apPct;
        stat.allPlayWins += apRow ? apRow.wins + apRow.ties * .5 : 0;
        stat.allPlayGames += denom;
        stat.weeklyScores.push(pts);
        stat.weeklyAllPlay.push({week,pct:apPct,points:pts});
        if(opponent){ stat.opponentPoints += Number(opponent.points||0); stat.opponentGames += 1; }
      });
    });

    const metrics = [...byTeam.values()].filter(x=>x.games>0).map(x => {
      const ppg = x.points / x.games;
      const allPlayPct = x.allPlayGames ? x.allPlayWins / x.allPlayGames : 0;
      const recordPct = x.games ? x.actualWins / x.games : 0;
      const recentPct = avg2(x.weeklyAllPlay.slice(-3).map(w=>w.pct));
      const consistency = Math.max(0, 1 - (stdDev2(x.weeklyScores) / Math.max(ppg,1)));
      const opponentAvg = x.opponentGames ? x.opponentPoints / x.opponentGames : 0;
      return {...x, ppg, allPlayPct, recordPct, recentPct, consistency, opponentAvg, luckWins:x.actualWins-x.expectedWins};
    });

    const leagueAvg = avg2(metrics.map(x=>x.ppg));
    metrics.forEach(x => x.scheduleDiff = x.opponentAvg - leagueAvg);
    return {metrics,leagueAvg};
  }

  function scorePower2(metrics){
    if(!metrics.length) return [];
    const allPlayVals=metrics.map(x=>x.allPlayPct);
    const ppgVals=metrics.map(x=>x.ppg);
    const recentVals=metrics.map(x=>x.recentPct);
    const recordVals=metrics.map(x=>x.recordPct);
    const consistencyVals=metrics.map(x=>x.consistency);
    return metrics.map(x => {
      const components={
        allPlay:percentile2(x.allPlayPct,allPlayVals),
        scoring:percentile2(x.ppg,ppgVals),
        recent:percentile2(x.recentPct,recentVals),
        record:percentile2(x.recordPct,recordVals),
        consistency:percentile2(x.consistency,consistencyVals),
      };
      const power=100*(components.allPlay*.35 + components.scoring*.30 + components.recent*.20 + components.record*.10 + components.consistency*.05);
      return {...x,components,power:round(power,1)};
    }).sort((a,b)=>b.power-a.power || b.allPlayPct-a.allPlayPct || b.ppg-a.ppg);
  }

  function luckLabel2(delta){
    if(delta >= .9) return 'Schedule darling';
    if(delta >= .35) return 'Running hot';
    if(delta <= -.9) return 'Absolutely robbed';
    if(delta <= -.35) return 'Tough breaks';
    return 'About right';
  }
  function luckClass2(delta){ return delta >= .35 ? 'good' : delta <= -.35 ? 'bad' : ''; }
  function movementLabel2(move){
    if(move > 0) return `<span class="power-move up">▲${move}</span>`;
    if(move < 0) return `<span class="power-move down">▼${Math.abs(move)}</span>`;
    return `<span class="power-move flat">—</span>`;
  }

  function standingsRanks2(metrics){
    const ordered=[...metrics].sort((a,b)=>b.actualWins-a.actualWins || b.points-a.points);
    return new Map(ordered.map((x,i)=>[x.roster_id,i+1]));
  }

  function recommendationInsights2(metrics,power){
    const standingRanks=standingsRanks2(metrics);
    const powerRanks=new Map(power.map(x=>[x.roster_id,x.rank]));
    const rows=metrics.map(x=>{
      const standingRank=standingRanks.get(x.roster_id) || metrics.length;
      const powerRank=powerRanks.get(x.roster_id) || metrics.length;
      const recordGap=standingRank-powerRank;
      const overRank=powerRank-standingRank;
      const fraudScore=overRank + Math.max(0,x.luckWins)*1.25;
      return {...x,standingRank,powerRank,recordGap,overRank,fraudScore};
    });
    const better=[...rows].sort((a,b)=>b.recordGap-a.recordGap || a.luckWins-b.luckWins)[0];
    const worse=[...rows].sort((a,b)=>b.overRank-a.overRank || b.luckWins-a.luckWins)[0];
    const fraud=[...rows].sort((a,b)=>b.fraudScore-a.fraudScore)[0];
    return {better,worse,fraud};
  }

  function ensureRecommendationPanel2(){
    const grid=document.querySelector('#analytics .lab-grid');
    if(!grid || document.getElementById('recommendationsList')) return;
    const article=document.createElement('article');
    article.className='panel lab-recommendations';
    article.innerHTML=`<div class="panel-title"><span>🧪</span><div><small>MODEL CALLS</small><h3>What the numbers are saying</h3></div></div>
      <p class="panel-explain">These compare actual standings with the power model and Luck Watch. They’re conversation starters, not predictions.</p>
      <div id="recommendationsList" class="recommendation-list"></div>`;
    grid.appendChild(article);
  }

  function renderRecommendations2(metrics,power){
    ensureRecommendationPanel2();
    const box=document.getElementById('recommendationsList');
    if(!box) return;
    const {better,worse,fraud}=recommendationInsights2(metrics,power);
    const cards=[];
    if(fraud) cards.push({icon:'🚨',label:'FRAUD WATCH',tone:'warn',team:teamName(fraud.roster_id),copy:`Sits #${fraud.standingRank} in the standings but #${fraud.powerRank} in Power Rankings with ${fraud.luckWins>=0?'+':''}${round(fraud.luckWins,1)} schedule-luck wins.`});
    if(better) cards.push({icon:'📈',label:'BETTER THAN RECORD',tone:'good',team:teamName(better.roster_id),copy:`Power rank #${better.powerRank} vs standings #${better.standingRank}. The underlying scoring and all-play profile is stronger than the record looks.`});
    if(worse) cards.push({icon:'📉',label:'WORSE THAN RECORD',tone:'bad',team:teamName(worse.roster_id),copy:`Standing #${worse.standingRank} vs power rank #${worse.powerRank}. Results have been better than the underlying team-strength profile.`});
    box.innerHTML=cards.map(c=>`<div class="recommendation-card ${c.tone}"><span class="rec-icon">${c.icon}</span><div><small>${c.label}</small><strong>${esc(c.team)}</strong><p>${esc(c.copy)}</p></div></div>`).join('');
    state.modelRecommendations={better,worse,fraud};
  }

  function renderSeasonLab2(){
    if(!state.seasonAnalytics) return;
    const {metrics,latestWeek}=state.seasonAnalytics;
    const luck=[...metrics].sort((a,b)=>b.luckWins-a.luckWins || a.scheduleDiff-b.scheduleDiff);
    const power=state.powerRankings || [];

    $("luckList").innerHTML = luck.map((x,i)=>{
      const schedule = `${x.scheduleDiff>=0?'+':''}${round(x.scheduleDiff)} opp pts vs avg`;
      return `<div class="insight-row"><span class="insight-rank">${i+1}</span><div class="insight-main"><strong>${esc(teamName(x.roster_id))}</strong><small>${round(x.actualWins,1)} actual wins • ${round(x.expectedWins,1)} expected • ${schedule}</small><em>${esc(luckLabel2(x.luckWins))}</em></div><span class="metric ${luckClass2(x.luckWins)}">${x.luckWins>=0?'+':''}${round(x.luckWins,1)} W</span></div>`;
    }).join("");

    $("allPlayList").innerHTML = power.map(x=>`<div class="power-row"><span class="power-rank">${x.rank}</span><div class="power-team"><strong>${esc(teamName(x.roster_id))}</strong><small>${Math.round(x.allPlayPct*100)}% all-play • ${round(x.ppg)} PPG • last 3 ${Math.round(x.recentPct*100)}%</small></div><div class="power-score"><strong>${x.power}</strong><span>POWER</span></div>${movementLabel2(x.movement)}</div>`).join("");

    renderRecommendations2(metrics,power);
    const badge=$("labThroughWeek");
    if(badge) badge.textContent=`Through Week ${latestWeek}`;
  }

  async function buildSeasonAnalytics2(){
    const weeks = Array.from({length:Math.max(1,state.currentWeek)},(_,i)=>i+1);
    const all = await Promise.all(weeks.map(async week=>({week,rows:await getMatchups(week)})));
    const completed = all.filter(({rows}) => rows?.length && rows.some(r=>Number(r.points||0)>0));
    if(!completed.length) return;
    const current = aggregateSeason2(completed);
    const power = scorePower2(current.metrics);
    const previous = completed.length > 1 ? scorePower2(aggregateSeason2(completed.slice(0,-1)).metrics) : power;
    const previousRanks = new Map(previous.map((x,i)=>[x.roster_id,i+1]));
    power.forEach((x,i)=>{ x.rank=i+1; x.previousRank=previousRanks.get(x.roster_id) || i+1; x.movement=x.previousRank-x.rank; });
    state.seasonAnalytics={weeks:completed.map(x=>x.week),latestWeek:completed.at(-1).week,metrics:current.metrics,leagueAvg:current.leagueAvg};
    state.powerRankings=power;
    renderSeasonLab2();
  }

  function weeklyAwardsForPrompt2(rows){
    if(!rows?.length) return [];
    const sorted=[...rows].sort((a,b)=>Number(b.points||0)-Number(a.points||0));
    const pairs=groupMatchups(rows).filter(p=>p.length===2);
    const closest=[...pairs].sort((a,b)=>Math.abs(a[0].points-a[1].points)-Math.abs(b[0].points-b[1].points))[0];
    const biggest=[...pairs].map(p=>({p,margin:Math.abs(Number(p[0].points||0)-Number(p[1].points||0))})).sort((a,b)=>b.margin-a.margin)[0];
    const bench=rows.map(r=>({roster_id:r.roster_id,points:benchPoints(r)})).filter(x=>x.points!=null).sort((a,b)=>b.points-a.points)[0];
    const out=[`High score: ${teamName(sorted[0].roster_id)} — ${round(sorted[0].points)} pts`,`Low score: ${teamName(sorted.at(-1).roster_id)} — ${round(sorted.at(-1).points)} pts`];
    if(closest) out.push(`Closest game: ${teamName(closest[0].roster_id)} vs ${teamName(closest[1].roster_id)} — ${round(Math.abs(closest[0].points-closest[1].points))} pt margin`);
    if(biggest){ const winner=[...biggest.p].sort((a,b)=>b.points-a.points)[0]; out.push(`Biggest blowout: ${teamName(winner.roster_id)} by ${round(biggest.margin)} pts`); }
    if(bench) out.push(`Most bench points: ${teamName(bench.roster_id)} — ${round(bench.points)} pts`);
    return out;
  }

  function positionLeadersForPrompt2(){
    if(!state.seasonPositionTotals?.size) return [];
    return POSITIONS.map(pos=>{ const x=positionRanking(pos)?.[0]; return x ? `${pos}: ${teamName(x.roster_id)} — ${round(x.total)} pts` : null; }).filter(Boolean);
  }

  function recommendationsForPrompt2(){
    const r=state.modelRecommendations; if(!r) return [];
    const lines=[];
    if(r.fraud) lines.push(`Fraud Watch: ${teamName(r.fraud.roster_id)} — standings #${r.fraud.standingRank}, power #${r.fraud.powerRank}, luck ${r.fraud.luckWins>=0?'+':''}${round(r.fraud.luckWins,1)} wins`);
    if(r.better) lines.push(`Better Than Record: ${teamName(r.better.roster_id)} — standings #${r.better.standingRank}, power #${r.better.powerRank}`);
    if(r.worse) lines.push(`Worse Than Record: ${teamName(r.worse.roster_id)} — standings #${r.worse.standingRank}, power #${r.worse.powerRank}`);
    return lines;
  }

  function waiverForPrompt2(){
    if(!state.waiverPlayers?.length) return [];
    return state.waiverPlayers.slice(0,5).map((x,i)=>`${i+1}. ${playerName(x)} (${x.pos}, ${x.player.team||'FA'}) — fit ${Math.max(1,Math.round(x.score))}, add trend #${x.trendRank}${x.recentAvg>0?`, ${round(x.recentAvg)} recent pts/g`:''}`);
  }

  async function buildRecapPrompt2(){
    const week=Number($("recapWeek")?.value || state.selectedWeek || state.currentWeek);
    const style=$("recapStyle")?.value || 'funny';
    const rows=await getMatchups(week);
    const matchupLines=groupMatchups(rows).filter(p=>p.length===2).map(pair=>{ const [winner,loser]=[...pair].sort((a,b)=>Number(b.points||0)-Number(a.points||0)); return `${teamName(winner.roster_id)} ${round(winner.points)} def. ${teamName(loser.roster_id)} ${round(loser.points)} (${round(Number(winner.points||0)-Number(loser.points||0))}-pt margin)`; });
    const ap=allPlay(rows);
    const allPlayLines=ap.map((x,i)=>`${i+1}. ${teamName(x.roster_id)} — ${x.wins}-${x.losses}${x.ties?`-${x.ties}`:''} all-play, ${round(x.points)} pts`);
    const luck=state.seasonAnalytics ? [...state.seasonAnalytics.metrics].sort((a,b)=>b.luckWins-a.luckWins) : [];
    const luckLines=luck.map(x=>`${teamName(x.roster_id)}: ${round(x.actualWins,1)} actual wins vs ${round(x.expectedWins,1)} expected (${x.luckWins>=0?'+':''}${round(x.luckWins,1)} luck wins), opponents ${x.scheduleDiff>=0?'+':''}${round(x.scheduleDiff)} pts vs league avg`);
    const powerLines=(state.powerRankings||[]).map(x=>`#${x.rank} ${teamName(x.roster_id)} — ${x.power} power, ${round(x.ppg)} PPG, ${Math.round(x.allPlayPct*100)}% all-play${x.movement?`, ${x.movement>0?'up':'down'} ${Math.abs(x.movement)}`:', unchanged'}`);
    const awards=weeklyAwardsForPrompt2(rows), positionLeaders=positionLeadersForPrompt2(), modelCalls=recommendationsForPrompt2(), waivers=waiverForPrompt2();
    const tone = style==='sportswriter' ? 'smart sportswriter tone with personality' : style==='balanced' ? 'fun, conversational tone with light roasting' : 'funny, roast-heavy friend-group tone without becoming mean or repetitive';
    return `I am the commissioner of a fantasy football league called "${state.league?.name || 'Dudes Being Dudes'}". Write our Week ${week} league recap using ONLY the factual data below.\n\nSTYLE\nUse a ${tone}. Make it feel like a recurring league column, not a generic AI summary. Call out surprising results, frauds, unlucky teams, power-ranking movement, and fun storylines. Do not invent injuries, player performances, quotes, trades, or motives that are not in the data. If context is missing, keep the joke about the numbers themselves.\n\nFORMAT\n- Strong funny headline\n- 2-paragraph opening\n- Matchup-by-matchup section with 2-4 sentences each\n- "What the numbers are saying" section using Luck Watch + Power Rankings\n- Weekly awards\n- Position-room note\n- 3 short takeaways for next week\n- End with one commissioner-style closing line\n\nWEEK ${week} MATCHUPS\n${matchupLines.join('\n') || 'No completed matchups yet.'}\n\nWEEK ${week} ALL-PLAY RESULTS\n${allPlayLines.join('\n') || 'Unavailable'}\n\nWEEKLY AWARDS / NOTABLES\n${awards.join('\n') || 'Unavailable'}\n\nSEASON LUCK WATCH\nLuck = actual wins minus expected wins based on how many teams each weekly score would have beaten. Positive means schedule helped; negative means schedule hurt.\n${luckLines.join('\n') || 'Unavailable'}\n\nCURRENT POWER RANKINGS\nFormula: 35% all-play strength, 30% points per game, 20% recent 3-week form, 10% actual record, 5% consistency.\n${powerLines.join('\n') || 'Unavailable'}\n\nMODEL RECOMMENDATIONS / STORYLINES\n${modelCalls.join('\n') || 'Unavailable'}\n\nPOSITION LEADERS — SEASON TO DATE\n${positionLeaders.join('\n') || 'Unavailable'}\n${waivers.length?`\nCOMMISSIONER-ONLY WAIVER CONTEXT (only mention if it makes the recap more interesting)\n${waivers.join('\n')}`:''}\n\nReturn the recap ready for me to paste into my league website. Keep names and numbers exact.`;
  }

  async function copyText2(text){
    try{ await navigator.clipboard.writeText(text); return true; }
    catch(_){ const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); const ok=document.execCommand('copy'); ta.remove(); return ok; }
  }

  function setupRecapPromptUI2(){
    if(!document.body.classList.contains('commish')) return;
    const generator=document.querySelector('.commish-generator');
    if(!generator || generator.dataset.promptMode==='1') return;
    generator.dataset.promptMode='1';
    generator.innerHTML=`<div><strong>Build a ChatGPT recap prompt</strong><span>Packages the selected week’s Sleeper results, awards, Luck Watch, Power Rankings, position leaders and model storylines into one prompt. Copy it, paste it into ChatGPT, then paste the finished recap back below to publish.</span></div><button class="btn btn-primary" type="button" id="buildPromptBtn">📋 Build prompt</button>`;
    const formGrid=document.querySelector('#recapForm .form-grid');
    if(formGrid && !document.getElementById('recapPrompt')){
      const wrapper=document.createElement('div'); wrapper.className='prompt-export full';
      wrapper.innerHTML=`<label>Prompt for ChatGPT<textarea id="recapPrompt" rows="10" readonly placeholder="Choose a week and tap Build prompt."></textarea></label><div class="prompt-actions"><button class="btn btn-primary" type="button" id="copyPromptBtn">Copy prompt</button><span id="promptStatus">Nothing generated yet.</span></div>`;
      formGrid.insertBefore(wrapper,formGrid.children[2] || null);
      const headline=formGrid.querySelector('label:has(#recapHeadline)'); if(headline) headline.insertAdjacentHTML('beforebegin','<div class="pasteback-label full"><span>STEP 2</span><strong>Paste the finished recap from ChatGPT below</strong></div>');
    }
    document.getElementById('buildPromptBtn')?.addEventListener('click',async()=>{ const prompt=await buildRecapPrompt2(); const area=document.getElementById('recapPrompt'); if(area) area.value=prompt; const copied=await copyText2(prompt); const status=document.getElementById('promptStatus'); if(status) status.textContent=copied?'Copied — paste it into ChatGPT.':'Prompt ready — tap Copy prompt.'; toast(copied?'Weekly data prompt copied. Paste it into ChatGPT.':'Weekly data prompt is ready.'); });
    document.getElementById('copyPromptBtn')?.addEventListener('click',async()=>{ const text=document.getElementById('recapPrompt')?.value || ''; if(!text){ toast('Build the prompt first.'); return; } const copied=await copyText2(text); toast(copied?'Prompt copied.':'Could not copy automatically. Select the prompt manually.'); });
  }

  const originalRenderLab = renderLab;
  renderLab = function(rows){ originalRenderLab(rows); if(state.seasonAnalytics) renderSeasonLab2(); };
  setupRecapPromptUI2();
  const ready=setInterval(()=>{ if(state?.league && state?.rosters?.length && state?.currentWeek){ clearInterval(ready); buildSeasonAnalytics2().catch(console.error); setupRecapPromptUI2(); } },80);
  setTimeout(()=>clearInterval(ready),15000);
})();
