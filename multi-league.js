/* Private multi-league command center: Sleeper public + Yahoo/ESPN private views */
(function(){
  if(!new URLSearchParams(location.search).get('commish')) return;
  const configs=[
    {key:'sleeper',provider:'Sleeper',leagueId:'1395115881683484672',public:true},
    {key:'yahoo',provider:'Yahoo',leagueId:'772644'},
    {key:'espn-688845290',provider:'ESPN',leagueId:'688845290'},
    {key:'espn-1726232411',provider:'ESPN',leagueId:'1726232411'},
  ];
  const MANUAL_SYNC_URL='https://github.com/steviej232/Dudes-Being-Dudes/actions/workflows/sync-private-leagues.yml';
  let cache={leagues:[]};

  function teamNameLocal(id){ try{return teamName(Number(id));}catch(_){return `Team ${id}`;} }
  function sleeperTeams(){
    return (state.rosters||[]).map(r=>({id:String(r.roster_id),name:teamNameLocal(r.roster_id),wins:Number(r.settings?.wins||0),losses:Number(r.settings?.losses||0),ties:Number(r.settings?.ties||0),pointsFor:pointsFromSettings(r.settings||{},'fpts'),pointsAgainst:pointsFromSettings(r.settings||{},'fpts_against')}));
  }
  function sleeperLeague(){return {provider:'sleeper',leagueId:configs[0].leagueId,name:state.league?.name||'Dudes Being Dudes',currentWeek:state.currentWeek,teams:sleeperTeams(),status:'connected',public:true};}
  function browserLeague(c){
    if(c.key==='sleeper') return null;
    const p=c.provider.toLowerCase();
    try{
      const raw=localStorage.getItem(`dbd_private_league_${p}_${c.leagueId}`);
      const parsed=raw?JSON.parse(raw):null;
      return parsed?.status==='connected'?parsed:null;
    }catch(_){ return null; }
  }
  function providerLeague(c){
    if(c.key==='sleeper') return sleeperLeague();
    return browserLeague(c) || (cache.leagues||[]).find(x=>String(x.leagueId)===String(c.leagueId)) || {provider:c.provider.toLowerCase(),leagueId:c.leagueId,name:`${c.provider} ${c.leagueId}`,teams:[],status:'syncing'};
  }
  function savedTeam(c,league){ const key=`dbd_myteam_${c.key}`; const saved=localStorage.getItem(key); return saved || league.teams?.[0]?.id || ''; }
  function record(t){return `${t?.wins||0}-${t?.losses||0}${t?.ties?`-${t.ties}`:''}`;}
  function opponentFor(league,teamId){ const m=(league.matchups||[]).find(x=>String(x.homeTeamId)===String(teamId)||String(x.awayTeamId)===String(teamId)); if(!m)return null; const opp=String(m.homeTeamId)===String(teamId)?m.awayTeamId:m.homeTeamId; return league.teams?.find(t=>String(t.id)===String(opp))||null; }
  function connectHref(c){ return `connect.html?provider=${encodeURIComponent(c.provider.toLowerCase())}&league=${encodeURIComponent(c.leagueId)}`; }
  function updatedLabel(){
    if(!cache.updatedAt) return 'Not synced yet';
    const d=new Date(cache.updatedAt);
    if(Number.isNaN(d.getTime())) return 'Last sync available';
    return `Last private sync ${d.toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`;
  }

  function statusCopy(league){
    if(league.status==='connected') return league.source?.startsWith('browser')?'Connected on this device':'Connected';
    if(league.status==='needs_auth') return 'Sign-in needed';
    if(league.status==='error') return 'Connection issue';
    return 'Checking…';
  }

  function page(c,league){
    const selected=savedTeam(c,league); const team=league.teams?.find(t=>String(t.id)===String(selected)); const opp=team?opponentFor(league,team.id):null;
    const options=(league.teams||[]).map(t=>`<option value="${esc(t.id)}" ${String(t.id)===String(selected)?'selected':''}>${esc(t.name)}</option>`).join('');
    const connected=league.status==='connected';
    const authHelp=c.provider==='ESPN' ? 'Sign in with your existing ESPN account, then the site will test your browser session automatically. If ESPN blocks browser-session API access, the secure GitHub-secret fallback remains available.' : c.provider==='Yahoo' ? 'Yahoo uses OAuth. The Connect button starts the authorization flow; the first time, Yahoo requires a Client ID from a free app under your existing Yahoo account.' : '';
    const reconnect=!c.public?`<a class="league-reconnect" href="${connectHref(c)}">↻ Reconnect</a>`:'';
    return `<article class="league-page" data-league="${esc(c.key)}">
      <div class="league-page-head"><div><span class="provider-pill ${c.provider.toLowerCase()}">${esc(c.provider)}</span><h3>${esc(league.name||`${c.provider} ${c.leagueId}`)}</h3><small>League ${esc(c.leagueId)} • ${statusCopy(league)}</small></div><div class="league-head-actions">${reconnect}${c.public?'<span class="visibility public">PUBLIC</span>':'<span class="visibility private">PRIVATE</span>'}</div></div>
      ${connected?`<label class="league-team-select">My team<select data-team-select="${esc(c.key)}">${options}</select></label>
      <div class="league-team-hero">
        <div><span>RECORD</span><strong>${team?record(team):'—'}</strong></div>
        <div><span>POINTS FOR</span><strong>${team?round(team.pointsFor||0):'—'}</strong></div>
        <div><span>THIS WEEK</span><strong>${opp?`vs ${esc(opp.name)}`:`Week ${league.currentWeek||state.currentWeek||'—'}`}</strong></div>
      </div>
      <div class="league-quick-rail">
        <div class="mini-tool"><b>⚡ Do Now</b><span>Use this league's lineup, waiver and opponent data.</span></div>
        <div class="mini-tool"><b>🧠 Lineup</b><span>Start/sit decisions for this roster.</span></div>
        <div class="mini-tool"><b>🎯 Waivers</b><span>Best adds for this team's needs.</span></div>
        <div class="mini-tool"><b>🤝 Trades</b><span>Find surplus/need matches.</span></div>
      </div>`:`<div class="league-connect-card"><strong>${statusCopy(league)}</strong><p>${esc(authHelp||'Run a manual private-league sync when you want fresh cached data.')}</p>${c.public?'':`<a class="league-connect-btn" href="${connectHref(c)}">Connect ${esc(c.provider)}</a>`}<small>The provider login happens on ${esc(c.provider)}. This site never asks for or stores your provider password.</small></div>`}
    </article>`;
  }

  function render(){
    let section=document.getElementById('myLeagues');
    if(!section){
      section=document.createElement('section'); section.id='myLeagues'; section.className='wrap section commish-only my-leagues';
      const edge=document.getElementById('edge'); (edge?.parentNode||document.querySelector('main')).insertBefore(section,edge||document.querySelector('main').firstChild);
    }
    const leagues=configs.map(c=>providerLeague(c));
    section.innerHTML=`<div class="section-head"><div><span class="kicker">PRIVATE COMMAND CENTER</span><h2>My Teams</h2><p class="section-copy">Swipe between leagues. Sleeper remains the only public-facing league.</p><small class="private-sync-meta">${esc(updatedLabel())}</small></div><div class="private-sync-actions"><a class="btn btn-secondary" href="${MANUAL_SYNC_URL}" target="_blank" rel="noopener">↻ Refresh private leagues</a><span class="pill">4 leagues</span></div></div>
      <div class="league-switcher">${configs.map((c,i)=>{const l=leagues[i];return `<button class="league-chip ${i===0?'active':''}" data-go="${esc(c.key)}"><span>${esc(c.provider)}</span><strong>${esc((l.name||c.leagueId).slice(0,26))}</strong><small>${statusCopy(l)}</small></button>`;}).join('')}</div>
      <div class="league-pages" id="leaguePages">${configs.map((c,i)=>page(c,leagues[i])).join('')}</div>`;
    const pages=document.getElementById('leaguePages');
    section.querySelectorAll('[data-go]').forEach(btn=>btn.addEventListener('click',()=>{ const target=section.querySelector(`[data-league="${btn.dataset.go}"]`); target?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'start'}); }));
    section.querySelectorAll('[data-team-select]').forEach(sel=>sel.addEventListener('change',()=>{localStorage.setItem(`dbd_myteam_${sel.dataset.teamSelect}`,sel.value);render();}));
    pages?.addEventListener('scroll',()=>{ const cards=[...pages.children]; if(!cards.length)return; const x=pages.scrollLeft; let best=cards[0],dist=Infinity; cards.forEach(c=>{const d=Math.abs(c.offsetLeft-x);if(d<dist){dist=d;best=c;}}); section.querySelectorAll('.league-chip').forEach(b=>b.classList.toggle('active',b.dataset.go===best.dataset.league)); },{passive:true});
  }

  async function load(){
    try{ const r=await fetch(`data/private-leagues.json?ts=${Date.now()}`,{cache:'no-store'}); if(r.ok) cache=await r.json(); }catch(_){}
    render();
  }
  window.addEventListener('focus',()=>load());
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') load(); });
  const ready=setInterval(()=>{ if(state?.league&&state?.rosters?.length){clearInterval(ready);load();} },100);
  setTimeout(()=>clearInterval(ready),15000);
})();
