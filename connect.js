(() => {
  const qs = new URLSearchParams(location.search);
  const provider = qs.get('provider');
  const leagueId = qs.get('league') || '';
  const title = document.getElementById('title');
  const intro = document.getElementById('intro');
  const content = document.getElementById('content');
  const status = document.getElementById('status');
  const REDIRECT = `${location.origin}${location.pathname}`;
  const HOME = new URL('index.html?commish=1#myLeagues', location.href).href;

  const setStatus = (text, tone='') => { status.className = `status ${tone}`.trim(); status.textContent = text; };
  const cacheKey = (p,id) => `dbd_private_league_${p}_${id}`;
  const saveLeague = (p,id,data) => localStorage.setItem(cacheKey(p,id), JSON.stringify(data));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const randomString = (len=64) => b64url(crypto.getRandomValues(new Uint8Array(len))).slice(0,len);
  async function challenge(verifier){ return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }

  function flattenParts(raw){
    if(!Array.isArray(raw)) return raw && typeof raw==='object' ? raw : {};
    return raw.reduce((o,part)=>{ if(part && typeof part==='object' && !Array.isArray(part)) Object.assign(o,part); return o; },{});
  }
  function findAll(obj,key,out=[]){
    if(Array.isArray(obj)) obj.forEach(v=>findAll(v,key,out));
    else if(obj && typeof obj==='object') { if(Object.prototype.hasOwnProperty.call(obj,key)) out.push(obj[key]); Object.values(obj).forEach(v=>findAll(v,key,out)); }
    return out;
  }

  function normalizeEspn(data,id){
    const currentWeek = Number(data.scoringPeriodId || data.status?.currentMatchupPeriod || 1);
    const teams = (data.teams||[]).map(t => {
      const r=t.record?.overall||{};
      return {id:String(t.id),name:t.name||[t.location,t.nickname].filter(Boolean).join(' ')||`Team ${t.id}`,logo:t.logo||null,wins:r.wins||0,losses:r.losses||0,ties:r.ties||0,pointsFor:r.pointsFor||0,pointsAgainst:r.pointsAgainst||0};
    });
    const matchups=(data.schedule||[]).filter(m=>Number(m.matchupPeriodId||0)===currentWeek).map(m=>({homeTeamId:m.home?.teamId!=null?String(m.home.teamId):null,awayTeamId:m.away?.teamId!=null?String(m.away.teamId):null,homeScore:m.home?.totalPoints||0,awayScore:m.away?.totalPoints||0}));
    return {provider:'espn',leagueId:String(id),season:2026,name:data.settings?.name||`ESPN ${id}`,currentWeek,teams,matchups,status:'connected',source:'browser-session',updatedAt:new Date().toISOString()};
  }

  async function tryEspn(id){
    const views=['mTeam','mRoster','mMatchup','mSettings','mStandings'].map(v=>`view=${v}`).join('&');
    const url=`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/${encodeURIComponent(id)}?${views}`;
    const r=await fetch(url,{credentials:'include',cache:'no-store'});
    if(!r.ok) throw new Error(`ESPN returned ${r.status}.`);
    const data=await r.json();
    const league=normalizeEspn(data,id);
    saveLeague('espn',id,league);
    return league;
  }

  async function espnFlow(){
    title.textContent=`Connect ESPN ${leagueId}`;
    intro.textContent='Sign in with your normal ESPN account. This page will then test whether ESPN allows the fantasy league request from your browser session.';
    content.innerHTML=`<div class="steps"><div class="step"><strong>1. Sign in to ESPN</strong><span>The login happens on ESPN, not on this site.</span></div><div class="step"><strong>2. Return here</strong><span>Tap Check connection. If ESPN permits browser-session API access, the league connects immediately.</span></div></div><div class="actions"><button class="btn primary" id="espnLogin">Sign in to ESPN</button><button class="btn secondary" id="espnCheck">Check connection</button></div>`;
    document.getElementById('espnLogin').onclick=()=>{
      window.open('https://secure.web.plus.espn.com/identity/login','_blank','noopener');
      setStatus('ESPN login opened. Finish signing in, return to this tab, then tap Check connection.');
    };
    document.getElementById('espnCheck').onclick=async()=>{
      setStatus('Checking your ESPN browser session…');
      try{
        const league=await tryEspn(leagueId);
        setStatus(`${league.name} connected. Returning to My Teams…`,'good');
        await sleep(700); location.href=HOME;
      }catch(err){
        setStatus(`Automatic browser connection was blocked (${err.message}). ESPN does not provide a supported Fantasy OAuth flow, so the secure GitHub-secret fallback is still required for this browser.`,'bad');
      }
    };
  }

  async function fetchYahooLeague(token){
    const headers={Authorization:`Bearer ${token}`};
    const gameRes=await fetch('https://fantasysports.yahooapis.com/fantasy/v2/game/nfl?format=json',{headers,cache:'no-store'});
    if(!gameRes.ok) throw new Error(`Yahoo game lookup returned ${gameRes.status}`);
    const game=await gameRes.json();
    const gameKey=findAll(game,'game_key').map(String).find(Boolean);
    if(!gameKey) throw new Error('Could not determine Yahoo NFL game key.');
    const key=`${gameKey}.l.${leagueId}`;
    const r=await fetch(`https://fantasysports.yahooapis.com/fantasy/v2/league/${encodeURIComponent(key)};out=standings,teams?format=json`,{headers,cache:'no-store'});
    if(!r.ok) throw new Error(`Yahoo league request returned ${r.status}`);
    const data=await r.json();
    const leagueArrays=findAll(data,'league');
    let meta={};
    for(const raw of leagueArrays){const x=flattenParts(raw);if(String(x.league_key||'')===key||String(x.league_id||'')===String(leagueId)){meta=x;break;}}
    const teams=[];
    for(const raw of findAll(data,'team')){
      const x=flattenParts(raw); if(!x.team_key) continue;
      const st=x.team_standings||{}; const o=st.outcome_totals||{};
      if(!teams.some(t=>t.id===String(x.team_key))) teams.push({id:String(x.team_key),name:x.name||String(x.team_key),wins:Number(o.wins||0),losses:Number(o.losses||0),ties:Number(o.ties||0),pointsFor:Number(st.points_for||x.team_points?.total||0)});
    }
    return {provider:'yahoo',leagueId:String(leagueId),leagueKey:key,season:2026,name:meta.name||`Yahoo ${leagueId}`,currentWeek:Number(meta.current_week||1),teams,matchups:[],status:'connected',source:'browser-oauth',updatedAt:new Date().toISOString()};
  }

  async function exchangeYahooCode(code){
    const clientId=localStorage.getItem('dbd_yahoo_client_id');
    const verifier=sessionStorage.getItem('dbd_yahoo_pkce_verifier');
    const expected=sessionStorage.getItem('dbd_yahoo_oauth_state');
    if(!clientId||!verifier) throw new Error('Yahoo connection state expired. Start the login again.');
    if(expected && qs.get('state')!==expected) throw new Error('Yahoo OAuth state mismatch.');
    const body=new URLSearchParams({client_id:clientId,redirect_uri:REDIRECT,code,grant_type:'authorization_code',code_verifier:verifier});
    const r=await fetch('https://api.login.yahoo.com/oauth2/get_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
    if(!r.ok) throw new Error(`Yahoo token exchange returned ${r.status}`);
    const tok=await r.json();
    localStorage.setItem('dbd_yahoo_tokens',JSON.stringify({access_token:tok.access_token,refresh_token:tok.refresh_token,expires_at:Date.now()+Number(tok.expires_in||3600)*1000}));
    return tok.access_token;
  }

  async function startYahoo(){
    const clientId=localStorage.getItem('dbd_yahoo_client_id');
    if(!clientId){
      content.querySelector('#yahooSetup')?.classList.remove('hidden');
      setStatus('Yahoo requires a Client ID for its OAuth flow. Create the Yahoo app once, paste the public Client ID below, then tap Save & Connect.','bad');
      return;
    }
    const verifier=randomString(86), state=randomString(28); sessionStorage.setItem('dbd_yahoo_pkce_verifier',verifier); sessionStorage.setItem('dbd_yahoo_oauth_state',state);
    const ch=await challenge(verifier);
    const u=new URL('https://api.login.yahoo.com/oauth2/request_auth');
    u.search=new URLSearchParams({client_id:clientId,redirect_uri:REDIRECT,response_type:'code',scope:'openid',state,code_challenge:ch,code_challenge_method:'S256'}).toString();
    location.href=u.href;
  }

  async function yahooFlow(){
    title.textContent=`Connect Yahoo ${leagueId}`;
    intro.textContent='Yahoo supports a real OAuth authorization flow. Your Yahoo password stays with Yahoo; this page only receives the OAuth result.';
    content.innerHTML=`<div class="steps"><div class="step"><strong>One-time Yahoo app setup</strong><span>Yahoo requires an app Client ID before any site can start OAuth. Use your existing Yahoo account; no paid hosting or new account is needed.</span></div></div><div class="actions"><button class="btn primary" id="yahooConnect">Connect Yahoo</button><a class="btn secondary" href="https://developer.yahoo.com/apps/" target="_blank" rel="noopener">Open Yahoo Apps</a></div><div id="yahooSetup" class="hidden"><label>Yahoo Client ID<input id="yahooClientId" autocomplete="off" placeholder="Paste the Consumer Key / Client ID"></label><div class="actions"><button class="btn primary" id="saveYahoo">Save & Connect</button></div></div>`;
    const style=document.createElement('style'); style.textContent='.hidden{display:none!important}'; document.head.appendChild(style);
    document.getElementById('yahooConnect').onclick=startYahoo;
    document.getElementById('saveYahoo').onclick=()=>{const v=document.getElementById('yahooClientId').value.trim();if(!v){setStatus('Paste the Yahoo Client ID first.','bad');return;}localStorage.setItem('dbd_yahoo_client_id',v);startYahoo();};
    const code=qs.get('code');
    if(code){
      setStatus('Yahoo authorization returned. Exchanging the code…');
      try{
        const token=await exchangeYahooCode(code); const league=await fetchYahooLeague(token); saveLeague('yahoo',leagueId,league);
        setStatus(`${league.name} connected. Returning to My Teams…`,'good'); await sleep(700); location.href=HOME;
      }catch(err){setStatus(`Yahoo login completed but the browser could not finish the API connection: ${err.message}. If Yahoo blocks this client-side exchange, use the secure GitHub Actions secret fallback.`,'bad');}
    }
  }

  if(provider==='espn' && leagueId) espnFlow();
  else if(provider==='yahoo' && leagueId) yahooFlow();
  else { title.textContent='Choose a league from My Teams'; intro.textContent='Open the commissioner dashboard and tap Connect on Yahoo or ESPN.'; content.innerHTML=`<div class="actions"><a class="btn primary" href="${HOME}">Back to My Teams</a></div>`; }
})();
