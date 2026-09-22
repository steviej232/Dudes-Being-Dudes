const LEAGUE_ID = "1395115881683484672";
const SLEEPER = "https://api.sleeper.app/v1";
const REPO = "steviej232/Dudes-Being-Dudes";
const POSITIONS = ["QB","RB","WR","TE","FLEX","K","DEF"];

const state = {
  league: null,
  nfl: null,
  users: [],
  rosters: [],
  usersById: new Map(),
  rostersById: new Map(),
  matchups: new Map(),
  selectedWeek: 1,
  currentWeek: 1,
  seasonPositionTotals: new Map(),
  recaps: [],
  waiverPlayers: [],
  waiverFilter: "ALL",
  commissionerRosterId: null,
  playerMap: null,
};

const $ = (id) => document.getElementById(id);
const esc = (v="") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const round = (n, p=1) => Number(Number(n || 0).toFixed(p));

function toast(message){
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 2600);
}

async function api(path){
  const response = await fetch(`${SLEEPER}${path}`, { cache: "no-store" });
  if(!response.ok) throw new Error(`Sleeper ${response.status}: ${path}`);
  return response.json();
}

function pointsFromSettings(settings, prefix){
  const whole = Number(settings?.[prefix] || 0);
  const decimal = Number(settings?.[`${prefix}_decimal`] || 0) / 100;
  return whole + decimal;
}

function userForRoster(roster){
  return state.usersById.get(String(roster?.owner_id || "")) || null;
}

function teamName(rosterId){
  const roster = state.rostersById.get(Number(rosterId));
  const user = userForRoster(roster);
  return user?.metadata?.team_name || user?.display_name || user?.username || `Team ${rosterId}`;
}

function teamAvatar(rosterId){
  const roster = state.rostersById.get(Number(rosterId));
  const user = userForRoster(roster);
  if(user?.avatar) return `<img alt="" src="https://sleepercdn.com/avatars/thumbs/${esc(user.avatar)}">`;
  const initials = teamName(rosterId).split(/\s+/).slice(0,2).map(s=>s[0] || "").join("").toUpperCase();
  return esc(initials || "FF");
}

function actualRecord(roster){
  const s = roster.settings || {};
  return `${s.wins || 0}-${s.losses || 0}${s.ties ? `-${s.ties}` : ""}`;
}

function starterSlots(){
  return (state.league?.roster_positions || []).filter(p => !["BN","IR","TAXI"].includes(p));
}

function normalizeSlot(slot){
  if(slot === "QB") return "QB";
  if(slot === "RB") return "RB";
  if(slot === "WR") return "WR";
  if(slot === "TE") return "TE";
  if(slot === "K") return "K";
  if(slot === "DEF") return "DEF";
  if(String(slot).includes("FLEX")) return "FLEX";
  return null;
}

function starterPoint(matchup, playerId, index){
  if(matchup?.players_points && matchup.players_points[playerId] != null) return Number(matchup.players_points[playerId]) || 0;
  if(Array.isArray(matchup?.starters_points) && matchup.starters_points[index] != null) return Number(matchup.starters_points[index]) || 0;
  if(matchup?.starters_points && matchup.starters_points[playerId] != null) return Number(matchup.starters_points[playerId]) || 0;
  return 0;
}

function benchPoints(matchup){
  if(!matchup?.players_points) return null;
  const starters = new Set(matchup.starters || []);
  return round((matchup.players || []).filter(id => !starters.has(id)).reduce((sum,id)=>sum + Number(matchup.players_points?.[id] || 0), 0));
}

async function getMatchups(week){
  const w = Number(week);
  if(!state.matchups.has(w)) state.matchups.set(w, api(`/league/${LEAGUE_ID}/matchups/${w}`));
  return state.matchups.get(w);
}

function groupMatchups(rows){
  const grouped = new Map();
  rows.forEach(row => {
    const key = row.matchup_id == null ? `solo-${row.roster_id}` : String(row.matchup_id);
    if(!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  return [...grouped.values()];
}

function allPlay(rows){
  return [...rows].map(team => {
    let wins = 0, losses = 0, ties = 0;
    rows.forEach(other => {
      if(team.roster_id === other.roster_id) return;
      const a = Number(team.points || 0), b = Number(other.points || 0);
      if(a > b) wins++; else if(a < b) losses++; else ties++;
    });
    return { roster_id: team.roster_id, wins, losses, ties, points: Number(team.points || 0) };
  }).sort((a,b) => b.wins - a.wins || b.points - a.points);
}

function actualWeekResult(rows, rosterId){
  const team = rows.find(r => r.roster_id === rosterId);
  if(!team || team.matchup_id == null) return .5;
  const opponent = rows.find(r => r.matchup_id === team.matchup_id && r.roster_id !== rosterId);
  if(!opponent) return .5;
  if(Number(team.points||0) > Number(opponent.points||0)) return 1;
  if(Number(team.points||0) < Number(opponent.points||0)) return 0;
  return .5;
}

function luckRows(rows){
  const ap = allPlay(rows);
  const denom = Math.max(rows.length - 1, 1);
  return ap.map(x => {
    const allPlayPct = (x.wins + x.ties * .5) / denom;
    const actual = actualWeekResult(rows, x.roster_id);
    return {...x, allPlayPct, actual, luck: actual - allPlayPct};
  }).sort((a,b) => b.luck - a.luck);
}

function populateWeeks(){
  const max = Math.max(1, Math.min(18, Number(state.currentWeek || 1)));
  const picker = $("weekPicker");
  const selected = Math.max(1, Math.min(max, Number(state.selectedWeek || max)));
  state.selectedWeek = selected;
  picker.innerHTML = `
    <button type="button" class="week-step" data-week="${selected-1}" ${selected<=1?"disabled":""} aria-label="Previous week">←</button>
    <button type="button" class="week-current active" aria-current="true">Week ${selected}</button>
    <button type="button" class="week-step" data-week="${selected+1}" ${selected>=max?"disabled":""} aria-label="Next week">→</button>
    <label class="week-jump"><span>Choose</span><select id="weekJumpSelect" aria-label="Choose week">${Array.from({length:max},(_,i)=>`<option value="${i+1}" ${i+1===selected?"selected":""}>Week ${i+1}</option>`).join("")}</select></label>`;
  picker.querySelectorAll("[data-week]").forEach(btn=>btn.addEventListener("click",async()=>{
    if(btn.disabled) return;
    state.selectedWeek=Number(btn.dataset.week);
    populateWeeks();
    await renderWeek();
  }));
  $("weekJumpSelect")?.addEventListener("change",async event=>{
    state.selectedWeek=Number(event.target.value);
    populateWeeks();
    await renderWeek();
  });

  const select = $("recapWeek");
  select.innerHTML = Array.from({length:max},(_,i)=>`<option value="${i+1}" ${i+1===selected?"selected":""}>Week ${i+1}</option>`).join("");
}

async function renderWeek(){
  const rows = await getMatchups(state.selectedWeek);
  $("weekTitle").textContent = `Week ${state.selectedWeek} matchup board`;
  const top = [...rows].sort((a,b)=>Number(b.points||0)-Number(a.points||0))[0];
  if(top && state.selectedWeek===state.currentWeek && $("heroCallout")){
    $("heroCallout").textContent = `Week ${state.currentWeek} • ${teamName(top.roster_id)} leads with ${round(top.points)} • ${state.users.length} managers`;
  }
  renderMatchups(rows);
  renderOlympics(rows);
  renderLab(rows);
}

function renderMatchups(rows){
  const groups = groupMatchups(rows);
  $("matchupGrid").innerHTML = groups.map((pair,i) => {
    const sorted = [...pair].sort((a,b)=>Number(b.points||0)-Number(a.points||0));
    const high = sorted[0]?.points;
    return `<article class="match-card">
      <div class="match-label"><span>MATCHUP ${i+1}</span><span>Week ${state.selectedWeek}</span></div>
      ${pair.map(team => {
        const win = pair.length > 1 && Number(team.points||0) === Number(high) && Number(pair[0].points||0) !== Number(pair[1].points||0);
        return `<div class="team-row ${win ? "winner":""}">
          <div class="avatar">${teamAvatar(team.roster_id)}</div>
          <div><strong>${esc(teamName(team.roster_id))}</strong><small>${esc(actualRecord(state.rostersById.get(team.roster_id) || {}))}</small></div>
          <div class="score">${round(team.points)}</div>
        </div>`;
      }).join("")}
      ${pair.length === 2 ? `<div class="delta">${round(Math.abs(Number(pair[0].points||0)-Number(pair[1].points||0)))} point margin</div>` : ""}
    </article>`;
  }).join("") || `<div class="empty-card">No matchup data yet for Week ${state.selectedWeek}.</div>`;
}

function renderOlympics(rows){
  if(!rows.length){ $("olympicsGrid").innerHTML = `<div class="empty-card">No scores yet.</div>`; return; }
  const high = [...rows].sort((a,b)=>b.points-a.points)[0];
  const low = [...rows].sort((a,b)=>a.points-b.points)[0];
  const pairs = groupMatchups(rows).filter(p=>p.length===2);
  const closest = pairs.sort((a,b)=>Math.abs(a[0].points-a[1].points)-Math.abs(b[0].points-b[1].points))[0];
  const bench = rows.map(r=>({roster_id:r.roster_id, points:benchPoints(r)})).filter(x=>x.points!=null).sort((a,b)=>b.points-a.points)[0];
  const cards = [
    {emoji:"🥇", label:"HIGH SCORE", title:teamName(high.roster_id), value:`${round(high.points)} pts`, copy:"Set the pace for everybody else."},
    closest ? {emoji:"📸", label:"PHOTO FINISH", title:`${teamName(closest[0].roster_id)} vs ${teamName(closest[1].roster_id)}`, value:`${round(Math.abs(closest[0].points-closest[1].points))} pts`, copy:"Closest decision of the week."} : null,
    bench ? {emoji:"🪑", label:"BENCH PRESS", title:teamName(bench.roster_id), value:`${bench.points} pts`, copy:"A beautiful collection of unusable points."} : null,
    {emoji:"🥶", label:"COLD SHOWER", title:teamName(low.roster_id), value:`${round(low.points)} pts`, copy:"Somebody had to finish last this week."}
  ].filter(Boolean);
  $("olympicsGrid").innerHTML = cards.map(c=>`<article class="medal-card"><div class="medal-emoji">${c.emoji}</div><small>${c.label}</small><h3>${esc(c.title)}</h3><div class="value">${esc(c.value)}</div><p>${esc(c.copy)}</p></article>`).join("");
}

function renderLab(rows){
  const ap = allPlay(rows);
  const luck = luckRows(rows);
  $("allPlayList").innerHTML = ap.map((x,i)=>`<div class="rank-row"><span>${i+1}</span><div><strong>${esc(teamName(x.roster_id))}</strong><small>${round(x.points)} weekly points</small></div><span class="metric">${x.wins}-${x.losses}${x.ties ? `-${x.ties}`:""}</span></div>`).join("");
  $("luckList").innerHTML = luck.map((x,i)=>`<div class="rank-row"><span>${i+1}</span><div><strong>${esc(teamName(x.roster_id))}</strong><small>${Math.round(x.allPlayPct*100)}% all-play win rate</small></div><span class="metric ${x.luck>.15?"good":x.luck<-.15?"bad":""}">${x.luck>=0?"+":""}${Math.round(x.luck*100)}%</span></div>`).join("");
  const top = [...rows].sort((a,b)=>b.points-a.points)[0];
  const bottom = [...rows].sort((a,b)=>a.points-b.points)[0];
  const pairs = groupMatchups(rows).filter(x=>x.length===2);
  const biggest = pairs.map(p=>({p,margin:Math.abs(p[0].points-p[1].points)})).sort((a,b)=>b.margin-a.margin)[0];
  const items = [
    ["Top score", `${teamName(top.roster_id)} — ${round(top.points)}`],
    ["Lowest score", `${teamName(bottom.roster_id)} — ${round(bottom.points)}`],
    biggest ? ["Biggest beatdown", `${teamName(biggest.p.sort((a,b)=>b.points-a.points)[0].roster_id)} — +${round(biggest.margin)}`] : null,
    luck[0] ? ["Luckiest result", `${teamName(luck[0].roster_id)} — ${luck[0].luck>=0?"+":""}${Math.round(luck[0].luck*100)}%`] : null,
  ].filter(Boolean);
  $("awardsList").innerHTML = items.map(([a,b])=>`<div class="award-item"><strong>${esc(a)}</strong><span>${esc(b)}</span></div>`).join("");
}

function renderStandings(){
  const ordered = [...state.rosters].sort((a,b)=>{
    const sa=a.settings||{}, sb=b.settings||{};
    if((sb.wins||0)!==(sa.wins||0)) return (sb.wins||0)-(sa.wins||0);
    return pointsFromSettings(sb,"fpts")-pointsFromSettings(sa,"fpts");
  });
  const box=$("standingsList");
  if(!box) return;
  box.innerHTML = ordered.map((r,i)=>{
    const st=r.settings||{};
    const pf=pointsFromSettings(st,"fpts"), pa=pointsFromSettings(st,"fpts_against");
    return `<details class="standing-row ${i<3?"podium":""}">
      <summary>
        <span class="standing-rank">${i+1}</span>
        <div class="standing-team"><span class="avatar">${teamAvatar(r.roster_id)}</span><div><strong>${esc(teamName(r.roster_id))}</strong><small>${esc(actualRecord(r))}</small></div></div>
        <div class="standing-pf"><strong>${round(pf)}</strong><span>PF</span></div>
        <span class="standing-more">⌄</span>
      </summary>
      <div class="standing-detail"><span><b>${round(pa)}</b> PA</span><span><b>${esc(st.streak || "—")}</b> streak</span></div>
    </details>`;
  }).join("");
}

async function buildSeasonPositionTotals(){
  const totals = new Map();
  state.rosters.forEach(r => totals.set(r.roster_id, Object.fromEntries(POSITIONS.map(p=>[p,0]))));
  const weeks = Array.from({length:state.currentWeek},(_,i)=>i+1);
  const allWeeks = await Promise.all(weeks.map(getMatchups));
  const slots = starterSlots();
  let rowsWithPlayerPoints = 0;

  allWeeks.forEach(rows => rows.forEach(m => {
    if(m.players_points || m.starters_points) rowsWithPlayerPoints++;
    const teamTotals = totals.get(m.roster_id) || Object.fromEntries(POSITIONS.map(p=>[p,0]));
    (m.starters || []).forEach((playerId,index)=>{
      const bucket = normalizeSlot(slots[index]);
      if(!bucket || !POSITIONS.includes(bucket)) return;
      teamTotals[bucket] += starterPoint(m, playerId, index);
    });
    totals.set(m.roster_id, teamTotals);
  }));

  state.seasonPositionTotals = totals;
  state.positionDataAvailable = rowsWithPlayerPoints > 0;
  $("positionThroughWeek").textContent = `Through Week ${state.currentWeek}`;
  renderPositionPicker();
  renderPositionLeaderboard(state.positionSelected || "QB");
}

function renderPositionPicker(){
  const picker = $("positionPicker");
  picker.innerHTML = POSITIONS.map(pos=>`<button type="button" data-position="${pos}" class="${(state.positionSelected||"QB")===pos?"active":""}">${pos}</button>`).join("");
  picker.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{
    state.positionSelected=btn.dataset.position;
    state.positionExpanded=false;
    renderPositionPicker();
    renderPositionLeaderboard(state.positionSelected);
  }));
}

function positionRanking(pos){
  return state.rosters.map(r=>({
    roster_id:r.roster_id,
    total:Number(state.seasonPositionTotals.get(r.roster_id)?.[pos] || 0),
    totalTeam:POSITIONS.reduce((sum,p)=>sum+Number(state.seasonPositionTotals.get(r.roster_id)?.[p]||0),0)
  })).sort((a,b)=>b.total-a.total);
}

function renderPositionLeaderboard(pos){
  const ranking = positionRanking(pos);
  const leagueTotal = ranking.reduce((sum,x)=>sum+x.total,0);
  const avg = ranking.length ? leagueTotal/ranking.length : 0;
  const best = ranking[0];
  const myIndex = state.commissionerRosterId ? ranking.findIndex(x=>x.roster_id===state.commissionerRosterId) : -1;
  $("positionSummary").innerHTML = `
    <div><span>Leader</span><strong>${best ? esc(teamName(best.roster_id)) : "—"}</strong><small>${best ? `${round(best.total)} ${pos} pts` : ""}</small></div>
    <div><span>League avg</span><strong>${round(avg)}</strong><small>${pos} points</small></div>
    <div><span>${myIndex>=0?"Your rank":"Weeks"}</span><strong>${myIndex>=0?`${myIndex+1}/${ranking.length}`:state.currentWeek}</strong><small>${myIndex>=0?esc(teamName(state.commissionerRosterId)):"Season to date"}</small></div>`;
  if(!state.positionDataAvailable){
    $("positionLeaderboard").innerHTML = `<div class="empty-card">Sleeper has not returned player-level matchup points yet.</div>`;
    return;
  }
  const expanded=!!state.positionExpanded;
  const visible=expanded ? ranking : ranking.filter((x,i)=>i<3 || x.roster_id===state.commissionerRosterId);
  const rows=visible.map(x=>{
    const i=ranking.findIndex(r=>r.roster_id===x.roster_id);
    const share=x.totalTeam?x.total/x.totalTeam*100:0;
    const width=best?.total?Math.max(3,x.total/best.total*100):0;
    return `<div class="pos-row ${x.roster_id===state.commissionerRosterId?"is-mine":""}">
      <span class="pos-rank">${i+1}</span>
      <div class="pos-team"><span class="avatar">${teamAvatar(x.roster_id)}</span><div><strong>${esc(teamName(x.roster_id))}</strong><div class="bar"><i style="width:${width}%"></i></div></div></div>
      <strong>${round(x.total)}</strong><span>${round(x.total/state.currentWeek)}</span><span>${round(share)}%</span>
    </div>`;
  }).join("");
  const toggle=ranking.length>3?`<button class="inline-expand" type="button" id="positionExpandBtn">${expanded?"Show summary":"View full leaderboard"}</button>`:"";
  $("positionLeaderboard").innerHTML = `<div class="pos-head"><span>Rank</span><span>Team</span><span>Total</span><span>Avg/Wk</span><span>Share</span></div>${rows}${toggle}`;
  $("positionExpandBtn")?.addEventListener("click",()=>{state.positionExpanded=!state.positionExpanded;renderPositionLeaderboard(pos);});
}

function commissionerCandidates(){
  const owners = state.users.filter(u=>u.is_owner);
  const ownerIds = new Set(owners.map(u=>String(u.user_id)));
  const ownerRosters = state.rosters.filter(r=>ownerIds.has(String(r.owner_id)));
  return ownerRosters.length ? ownerRosters : state.rosters;
}

function setupCommissionerRoster(){
  const candidates = commissionerCandidates();
  const saved = Number(localStorage.getItem("dbd_commissioner_roster"));
  const chosen = candidates.some(r=>r.roster_id===saved) ? saved : candidates[0]?.roster_id;
  state.commissionerRosterId = chosen || null;
  const select = $("commissionerRosterSelect");
  if(select){
    select.innerHTML = candidates.map(r=>`<option value="${r.roster_id}">${esc(teamName(r.roster_id))}</option>`).join("");
    if(chosen) select.value=String(chosen);
    select.addEventListener("change",()=>{
      state.commissionerRosterId=Number(select.value);
      localStorage.setItem("dbd_commissioner_roster",select.value);
      renderRosterNeeds();
      loadWaivers(true);
      renderPositionLeaderboard(state.positionSelected || "QB");
    });
  }
  renderRosterNeeds();
  if(state.seasonPositionTotals.size) renderPositionLeaderboard(state.positionSelected || "QB");
}

function renderRosterNeeds(){
  if(!state.commissionerRosterId || !state.seasonPositionTotals.size) return;
  const html = ["QB","RB","WR","TE","FLEX","K","DEF"].map(pos=>{
    const ranking=positionRanking(pos);
    const idx=ranking.findIndex(x=>x.roster_id===state.commissionerRosterId);
    return `<div class="${idx>=Math.ceil(ranking.length*.6)?"need":""}"><span>${pos}</span><strong>${idx>=0?`${idx+1}/${ranking.length}`:"—"}</strong></div>`;
  }).join("");
  if($("rosterNeeds")) $("rosterNeeds").innerHTML=html;
}

async function loadPlayerMap(){
  if(state.playerMap) return state.playerMap;
  const data = await api("/players/nfl?active=true");
  state.playerMap = data || {};
  return state.playerMap;
}

function normalizeStatsPayload(payload){
  if(Array.isArray(payload)) return Object.fromEntries(payload.map(row=>[String(row.player_id || row.player?.player_id || ""), row.stats || row]));
  if(payload && typeof payload === "object") return payload;
  return {};
}

async function fetchStatsWeek(week){
  try{
    const response=await fetch(`${SLEEPER}/stats/nfl/regular/${state.league.season}/${week}`,{cache:"no-store"});
    if(!response.ok) throw new Error("stats unavailable");
    return normalizeStatsPayload(await response.json());
  }catch(_){
    try{
      const alt=await fetch(`https://api.sleeper.com/stats/nfl/${state.league.season}/${week}?season_type=regular`,{cache:"no-store"});
      if(!alt.ok) return {};
      return normalizeStatsPayload(await alt.json());
    }catch(_err){ return {}; }
  }
}

function scoringField(){
  const rec = Number(state.league?.scoring_settings?.rec || 0);
  if(rec >= .9) return "pts_ppr";
  if(rec >= .4) return "pts_half_ppr";
  return "pts_std";
}

function candidatePosition(player){
  const p=(player?.fantasy_positions || [player?.position]).filter(Boolean);
  if(p.includes("DEF") || player?.position==="DEF") return "DEF";
  return ["QB","RB","WR","TE","K"].find(x=>p.includes(x)) || null;
}

function needScoreFor(pos){
  if(!state.commissionerRosterId) return {score:0,rank:0,total:state.rosters.length};
  const ranking=positionRanking(pos);
  let idx=ranking.findIndex(x=>x.roster_id===state.commissionerRosterId);
  if(idx<0) idx=ranking.length-1;
  const denom=Math.max(ranking.length-1,1);
  let score=(idx/denom)*35;
  if(["RB","WR","TE"].includes(pos)){
    const flex=positionRanking("FLEX");
    const fi=Math.max(0,flex.findIndex(x=>x.roster_id===state.commissionerRosterId));
    score=Math.max(score,(fi/Math.max(flex.length-1,1))*26);
  }
  return {score,rank:idx+1,total:ranking.length};
}

async function loadWaivers(force=false){
  if(!document.body.classList.contains("commish")) return;
  const box=$("waiverList");
  const status=$("waiverStatus");
  if(status) status.textContent="Analyzing the waiver wire…";
  if(force) state.waiverPlayers=[];
  if(state.waiverPlayers.length){ if(box) renderWaivers(); return; }

  try{
    const [players,trending] = await Promise.all([
      loadPlayerMap(),
      api("/players/nfl/trending/add?lookback_hours=72&limit=100")
    ]);
    const rostered=new Set(state.rosters.flatMap(r=>r.players||[]).map(String));
    const recentWeeks=Array.from({length:Math.min(3,state.currentWeek)},(_,i)=>state.currentWeek-i).filter(w=>w>0);
    const statsRows=await Promise.all(recentWeeks.map(fetchStatsWeek));
    const field=scoringField();
    const maxTrend=Math.max(1,...trending.map(x=>Number(x.count||0)));

    const candidates=trending.map((trend,index)=>{
      const id=String(trend.player_id);
      if(rostered.has(id)) return null;
      const player=players[id];
      if(!player) return null;
      const pos=candidatePosition(player);
      if(!pos) return null;
      const weekly=statsRows.map(s=>Number(s[id]?.[field] ?? s[id]?.pts_ppr ?? s[id]?.pts_half_ppr ?? s[id]?.pts_std ?? 0));
      const avg=weekly.length ? weekly.reduce((a,b)=>a+b,0)/weekly.length : 0;
      const need=needScoreFor(pos);
      const injury=String(player.injury_status||"").toUpperCase();
      const injuryPenalty=["IR","OUT","PUP"].includes(injury)?20:injury==="DOUBTFUL"?10:injury==="QUESTIONABLE"?4:0;
      const trendScore=Number(trend.count||0)/maxTrend*40;
      const prodScore=Math.min(Math.max(avg,0)/22,1)*25;
      const score=trendScore+prodScore+need.score-injuryPenalty;
      return {id,pos,player,trend:Number(trend.count||0),trendRank:index+1,recentAvg:avg,needRank:need.rank,needTotal:need.total,score,injury};
    }).filter(Boolean).sort((a,b)=>b.score-a.score);
    state.waiverPlayers=candidates;
    if(box) renderWaivers();
  }catch(err){
    console.error(err);
    if(status) status.textContent="Could not load Sleeper waiver data.";
    if(box) box.innerHTML=`<div class="empty-card">Waiver recommendations are temporarily unavailable. Try Refresh after Sleeper updates.</div>`;
  }
}

function playerName(x){
  return x.player.full_name || [x.player.first_name,x.player.last_name].filter(Boolean).join(" ") || x.player.team || x.id;
}

function renderWaivers(){
  if(!$("waiverList")) return;
  const filter=state.waiverFilter;
  const rows=state.waiverPlayers.filter(x=>filter==="ALL"||x.pos===filter).slice(0,12);
  $("waiverStatus").textContent=`${rows.length} available targets • updated from Sleeper`;
  $("waiverList").innerHTML=rows.map((x,i)=>{
    const injury=x.injury?` • ${x.injury}`:"";
    const trendText=`#${x.trendRank} Sleeper add trend`;
    const recent=x.recentAvg>0?` • ${round(x.recentAvg)} recent pts/g`:"";
    const need=` • your ${x.pos} rank ${x.needRank}/${x.needTotal}`;
    return `<article class="waiver-row">
      <span class="waiver-rank">${i+1}</span>
      <div class="player-headshot"><img src="https://sleepercdn.com/content/nfl/players/${esc(x.id)}.jpg" alt="" onerror="this.style.display='none'"></div>
      <div class="waiver-player"><strong>${esc(playerName(x))}</strong><span>${esc(x.pos)} • ${esc(x.player.team || "FA")}${esc(injury)}</span><small>${esc(trendText+recent+need)}</small></div>
      <div class="pickup-score"><span>FIT</span><strong>${Math.max(1,Math.round(x.score))}</strong></div>
    </article>`;
  }).join("") || `<div class="empty-card">No unrostered ${esc(filter)} players found in Sleeper's current add trends.</div>`;
}

function setupWaiverFilters(){
  $("waiverPositionFilter")?.querySelectorAll("button").forEach(btn=>btn.addEventListener("click",()=>{
    state.waiverFilter=btn.dataset.pos;
    $("waiverPositionFilter").querySelectorAll("button").forEach(b=>b.classList.toggle("active",b===btn));
    renderWaivers();
  }));
  $("refreshWaiversBtn")?.addEventListener("click",()=>loadWaivers(true));
}

async function loadRecaps(){
  try{
    const res=await fetch(`data/recaps.json?ts=${Date.now()}`,{cache:"no-store"});
    state.recaps=res.ok?await res.json():[];
  }catch(_){ state.recaps=[]; }
  renderRecaps();
}

function renderRecaps(){
  const localDraft=JSON.parse(localStorage.getItem("dbd_recap_draft")||"null");
  const published=[...state.recaps].sort((a,b)=>Number(b.week||0)-Number(a.week||0));
  const draft=document.body.classList.contains("commish")&&localDraft?`<article class="recap-card draft-card"><span class="week">PRIVATE DRAFT • WEEK ${esc(localDraft.week)}</span><h3>${esc(localDraft.headline||"Untitled draft")}</h3><p>${esc(localDraft.intro||"Saved on this device.")}</p><time>Not published</time></article>`:"";
  if(!published.length){$("recapGrid").innerHTML=draft+`<div class="empty-card">No published recaps yet.</div>`;return;}
  const latest=published[0];
  const featured=`<article class="recap-card recap-featured"><span class="week">LATEST • WEEK ${esc(latest.week)}</span><h3>${esc(latest.headline)}</h3><p>${esc(latest.intro||"")}</p><details><summary class="read-more">Read recap</summary><p class="recap-full">${esc(latest.body||"")}</p></details><time>${esc(latest.date||"")}</time></article>`;
  const older=published.slice(1).map(r=>`<details class="recap-archive-row"><summary><span><b>Week ${esc(r.week)}</b><small>${esc(r.headline)}</small></span><time>${esc(r.date||"")}</time><i>⌄</i></summary><div><p>${esc(r.intro||"")}</p><p class="recap-full">${esc(r.body||"")}</p></div></details>`).join("");
  $("recapGrid").innerHTML=draft+featured+(older?`<div class="recap-archive">${older}</div>`:"");
}

function recapFacts(rows){
  if(!rows.length) return {};
  const sorted=[...rows].sort((a,b)=>b.points-a.points);
  const pairs=groupMatchups(rows).filter(x=>x.length===2);
  const close=[...pairs].sort((a,b)=>Math.abs(a[0].points-a[1].points)-Math.abs(b[0].points-b[1].points))[0];
  const blow=[...pairs].sort((a,b)=>Math.abs(b[0].points-b[1].points)-Math.abs(a[0].points-a[1].points))[0];
  const luck=luckRows(rows);
  return {high:sorted[0],low:sorted.at(-1),close,blow,luck};
}

function generateRecapText(rows,style){
  const f=recapFacts(rows);
  const w=Number($("recapWeek").value);
  const highName=f.high?teamName(f.high.roster_id):"Somebody";
  const lowName=f.low?teamName(f.low.roster_id):"somebody else";
  const funny=style==="funny";
  const sports=style==="sportswriter";
  const headline=funny?`Week ${w}: ${highName} cooked, ${lowName} needs answers`:sports?`Week ${w} Recap: Statement Wins and a Shifting League Picture`:`Week ${w} Recap: Winners, losers and everything in between`;
  const intro=funny?`Week ${w} is in the books, and the league gave us exactly what we deserved: one team feeling invincible, one team questioning every lineup decision, and several screenshots worth saving for later.`:sports?`Week ${w} delivered another meaningful set of results, with the league's top performers separating themselves while the middle of the standings tightened.`:`Week ${w} is complete. Here is what mattered most across every matchup, from the highest score to the closest finish and the teams whose records may not tell the whole story.`;

  const matchupText=groupMatchups(rows).filter(p=>p.length===2).map(pair=>{
    const [winner,loser]=[...pair].sort((a,b)=>b.points-a.points);
    const margin=round(winner.points-loser.points);
    return `${teamName(winner.roster_id)} ${round(winner.points)} – ${teamName(loser.roster_id)} ${round(loser.points)}\n${funny?`${teamName(winner.roster_id)} gets bragging rights after a ${margin}-point win. ${teamName(loser.roster_id)} can begin the standard Tuesday ritual of staring at the bench and blaming variance.`:`${teamName(winner.roster_id)} took the matchup by ${margin} points and added an important result to the season ledger.`}`;
  }).join("\n\n");

  const closest=f.close?`${teamName(f.close[0].roster_id)} vs ${teamName(f.close[1].roster_id)} was the photo finish at just ${round(Math.abs(f.close[0].points-f.close[1].points))} points.`:"";
  const blow=f.blow?`${teamName([...f.blow].sort((a,b)=>b.points-a.points)[0].roster_id)} delivered the biggest beatdown, winning by ${round(Math.abs(f.blow[0].points-f.blow[1].points))}.`:"";
  const lucky=f.luck?.[0]?`${teamName(f.luck[0].roster_id)} got the friendliest result relative to all-play performance this week.`:"";
  const posLeaders=POSITIONS.map(pos=>{const r=positionRanking(pos)[0];return r?`${pos}: ${teamName(r.roster_id)} (${round(r.total)} season pts)`:null}).filter(Boolean).join(" • ");
  const body=`THE WEEK IN ONE SENTENCE\n${intro}\n\nMATCHUPS\n${matchupText}\n\nWEEKLY HARDWARE\n🏆 High score: ${highName} — ${round(f.high?.points)}\n🥶 Low score: ${lowName} — ${round(f.low?.points)}\n📸 ${closest}\n💥 ${blow}\n🍀 ${lucky}\n\nPOSITION ROOM — SEASON TO DATE\n${posLeaders}\n\nLOOKING AHEAD\nAnother week means another opportunity for the power structure to change — or for the same people to continue talking like they invented fantasy football.`;
  return {headline,intro,body};
}

function openRecapDialog(){
  $("commissionerDialog").showModal();
  $("recapWeek").value=String(state.selectedWeek);
  const draft=JSON.parse(localStorage.getItem("dbd_recap_draft")||"null");
  if(draft && Number(draft.week)===Number(state.selectedWeek)){
    $("recapHeadline").value=draft.headline||"";
    $("recapIntro").value=draft.intro||"";
    $("recapBody").value=draft.body||"";
  }
  updateAutoSummary();
}

async function updateAutoSummary(){
  const week=Number($("recapWeek").value||state.selectedWeek);
  const rows=await getMatchups(week);
  const f=recapFacts(rows);
  $("autoSummary").innerHTML=f.high?`Sleeper facts ready: <strong>${esc(teamName(f.high.roster_id))}</strong> led the week with ${round(f.high.points)} points. ${f.close?`Closest game: ${round(Math.abs(f.close[0].points-f.close[1].points))} pts.`:""}`:"Waiting for matchup results.";
}

function saveDraft(){
  const data={week:Number($("recapWeek").value),headline:$("recapHeadline").value.trim(),intro:$("recapIntro").value.trim(),body:$("recapBody").value.trim(),style:$("recapStyle").value};
  localStorage.setItem("dbd_recap_draft",JSON.stringify(data));
  renderRecaps();
  toast("Private recap draft saved.");
}

async function copyRecapPublishPayload(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(_){
    const ta=document.createElement("textarea");
    ta.value=text;
    ta.setAttribute("readonly","");
    ta.style.position="fixed";
    ta.style.opacity="0";
    ta.style.pointerEvents="none";
    document.body.appendChild(ta);
    ta.select();
    const ok=document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

async function publishRecap(){
  const recap={week:Number($("recapWeek").value),headline:$("recapHeadline").value.trim(),intro:$("recapIntro").value.trim(),body:$("recapBody").value.trim(),date:new Date().toISOString().slice(0,10)};
  if(!recap.headline || !recap.body){ toast("Add a headline and recap first."); return; }

  const issueBody=`<!-- DBD_RECAP -->
Paste this entire payload as the issue body, then submit.

\`\`\`json
${JSON.stringify(recap,null,2)}
\`\`\``;

  const copied=await copyRecapPublishPayload(issueBody);
  if(!copied){
    toast("Could not copy the recap. Copy it manually before opening GitHub.");
    return;
  }

  const url=`https://github.com/${REPO}/issues/new?template=publish-recap.md&title=${encodeURIComponent(`Publish Recap: Week ${recap.week}`)}`;
  window.open(url,"_blank","noopener");
  toast("Recap copied. Paste it into GitHub, then Submit.");
}


function setupCommissionerUI(){
  if(!document.body.classList.contains("commish")) return;
  ["commissionerBtn","newRecapBtn"].forEach(id=>$(id)?.addEventListener("click",openRecapDialog));
  $("recapWeek")?.addEventListener("change",updateAutoSummary);
  $("generateRecapBtn")?.addEventListener("click",async()=>{
    const week=Number($("recapWeek").value);
    const rows=await getMatchups(week);
    const text=generateRecapText(rows,$("recapStyle").value);
    $("recapHeadline").value=text.headline;
    $("recapIntro").value=text.intro;
    $("recapBody").value=text.body;
    updateAutoSummary();
    toast("Full draft generated. Edit anything you want.");
  });
  $("saveDraftBtn")?.addEventListener("click",saveDraft);
  $("publishBtn")?.addEventListener("click",publishRecap);
}

async function init(){
  const params=new URLSearchParams(location.search);
  if(params.get("commish")==="1") document.body.classList.add("commish");
  $("refreshBtn").addEventListener("click",()=>location.reload());
  try{
    const [league,users,rosters,nfl]=await Promise.all([
      api(`/league/${LEAGUE_ID}`),
      api(`/league/${LEAGUE_ID}/users`),
      api(`/league/${LEAGUE_ID}/rosters`),
      api("/state/nfl"),
    ]);
    state.league=league; state.users=users; state.rosters=rosters; state.nfl=nfl;
    users.forEach(u=>state.usersById.set(String(u.user_id),u));
    rosters.forEach(r=>state.rostersById.set(Number(r.roster_id),r));
    state.currentWeek=Math.max(1,Math.min(18,Number(nfl?.week || league?.settings?.leg || 1)));
    state.selectedWeek=state.currentWeek;

    $("leagueStatus").textContent="LIVE FROM SLEEPER";
    $("leagueName").textContent=league.name || "Dudes Being Dudes";
    $("leagueIntro").textContent=`${league.name || "Your league"} is live. Scores, records, positional production and weekly nonsense update directly from Sleeper.`;
    $("teamCount").textContent=rosters.length;
    $("currentWeek").textContent=state.currentWeek;
    if($("heroWeekLabel")) $("heroWeekLabel").textContent=state.currentWeek;
    $("seasonYear").textContent=league.season || "—";
    $("heroCallout").textContent=`Week ${state.currentWeek} • ${users.length} managers • ${league.status?.replaceAll("_"," ") || "season live"}`;

    populateWeeks();
    renderStandings();
    await Promise.all([renderWeek(),loadRecaps(),buildSeasonPositionTotals()]);
    if(document.body.classList.contains("commish")){
      setupCommissionerRoster();
      setupCommissionerUI();
      await loadWaivers();
    }
  }catch(err){
    console.error(err);
    $("leagueStatus").textContent="SLEEPER CONNECTION ERROR";
    $("leagueIntro").insertAdjacentHTML("afterend",`<div class="error-banner">Could not load league data from Sleeper. ${esc(err.message)} Try Refresh Sleeper.</div>`);
  }
}

init();
