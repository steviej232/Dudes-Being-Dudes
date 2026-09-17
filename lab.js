/* Dudes Being Dudes — season luck + power ranking upgrade */
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

  function renderSeasonLab2(){
    if(!state.seasonAnalytics) return;
    const {metrics,latestWeek}=state.seasonAnalytics;
    const luck=[...metrics].sort((a,b)=>b.luckWins-a.luckWins || a.scheduleDiff-b.scheduleDiff);
    const power=state.powerRankings || [];

    $("luckList").innerHTML = luck.map((x,i)=>{
      const schedule = `${x.scheduleDiff>=0?'+':''}${round(x.scheduleDiff)} opp pts vs avg`;
      return `<div class="insight-row">
        <span class="insight-rank">${i+1}</span>
        <div class="insight-main"><strong>${esc(teamName(x.roster_id))}</strong><small>${round(x.actualWins,1)} actual wins • ${round(x.expectedWins,1)} expected • ${schedule}</small><em>${esc(luckLabel2(x.luckWins))}</em></div>
        <span class="metric ${luckClass2(x.luckWins)}">${x.luckWins>=0?'+':''}${round(x.luckWins,1)} W</span>
      </div>`;
    }).join("");

    $("allPlayList").innerHTML = power.map(x=>`<div class="power-row">
      <span class="power-rank">${x.rank}</span>
      <div class="power-team"><strong>${esc(teamName(x.roster_id))}</strong><small>${Math.round(x.allPlayPct*100)}% all-play • ${round(x.ppg)} PPG • last 3 ${Math.round(x.recentPct*100)}%</small></div>
      <div class="power-score"><strong>${x.power}</strong><span>POWER</span></div>
      ${movementLabel2(x.movement)}
    </div>`).join("");

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

  // Preserve weekly awards, but season Luck Watch and Power Rankings no longer change when browsing weeks.
  const originalRenderLab = renderLab;
  renderLab = function(rows){
    originalRenderLab(rows);
    if(state.seasonAnalytics) renderSeasonLab2();
  };

  const ready=setInterval(()=>{
    if(state?.league && state?.rosters?.length && state?.currentWeek){
      clearInterval(ready);
      buildSeasonAnalytics2().catch(console.error);
    }
  },80);
  setTimeout(()=>clearInterval(ready),15000);
})();
