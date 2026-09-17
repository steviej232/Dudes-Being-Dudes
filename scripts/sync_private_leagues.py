#!/usr/bin/env python3
import base64, json, os, urllib.request, urllib.error, urllib.parse
from pathlib import Path
from datetime import datetime, timezone

YEAR = int(os.environ.get("FANTASY_SEASON", "2026"))
ESPN_LEAGUES = ["688845290", "1726232411"]
YAHOO_LEAGUE = "772644"
OUT = Path("data/private-leagues.json")
OUT.parent.mkdir(parents=True, exist_ok=True)


def now_iso(): return datetime.now(timezone.utc).isoformat()


def fetch_json(url, headers=None, timeout=25, data=None):
    req = urllib.request.Request(url, headers=headers or {"User-Agent":"DudesBeingDudes/1.0"}, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        try: body=e.read().decode("utf-8")[:500]
        except Exception: body=""
        return e.code, None, body
    except Exception as e: return 0, None, str(e)


def espn_team_name(t):
    return t.get("name") or " ".join(x for x in [t.get("location"),t.get("nickname")] if x).strip() or f"Team {t.get('id','?')}"


def normalize_espn(league_id,data):
    settings=data.get("settings") or {}; sched=data.get("schedule") or []
    current=int(data.get("scoringPeriodId") or data.get("status",{}).get("currentMatchupPeriod") or 1)
    teams=[]
    for t in data.get("teams") or []:
        overall=((t.get("record") or {}).get("overall") or {})
        teams.append({"id":str(t.get("id")),"name":espn_team_name(t),"abbrev":t.get("abbrev"),"logo":t.get("logo"),"wins":overall.get("wins",0),"losses":overall.get("losses",0),"ties":overall.get("ties",0),"pointsFor":overall.get("pointsFor",0),"pointsAgainst":overall.get("pointsAgainst",0),"playoffSeed":t.get("playoffSeed"),"roster":[{"playerId":str(((e.get("playerPoolEntry") or {}).get("player") or {}).get("id","")),"name":((e.get("playerPoolEntry") or {}).get("player") or {}).get("fullName"),"slot":e.get("lineupSlotId"),"injuryStatus":((e.get("playerPoolEntry") or {}).get("player") or {}).get("injuryStatus")} for e in (((t.get("roster") or {}).get("entries")) or [])]})
    matchups=[]
    for m in sched:
        if int(m.get("matchupPeriodId") or 0)!=current: continue
        h,a=m.get("home") or {},m.get("away") or {}
        matchups.append({"homeTeamId":str(h.get("teamId")) if h.get("teamId") is not None else None,"awayTeamId":str(a.get("teamId")) if a.get("teamId") is not None else None,"homeScore":h.get("totalPoints",0),"awayScore":a.get("totalPoints",0)})
    return {"provider":"espn","leagueId":league_id,"season":YEAR,"name":settings.get("name") or f"ESPN {league_id}","currentWeek":current,"teams":teams,"matchups":matchups,"status":"connected","updatedAt":now_iso()}


def sync_espn(league_id):
    base=f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{YEAR}/segments/0/leagues/{league_id}"
    url=base+"?"+"&".join("view="+v for v in ["mTeam","mRoster","mMatchup","mSettings","mStandings"])
    status,data,err=fetch_json(url); auth_used=False
    if status in (401,403) or not data:
        s2=os.environ.get("ESPN_S2","").strip(); swid=os.environ.get("ESPN_SWID","").strip()
        if s2 and swid:
            status,data,err=fetch_json(url,{"User-Agent":"DudesBeingDudes/1.0","Cookie":f"espn_s2={s2}; SWID={swid}"}); auth_used=True
    if data:
        out=normalize_espn(league_id,data); out["authUsed"]=auth_used; return out
    return {"provider":"espn","leagueId":league_id,"season":YEAR,"status":"needs_auth" if status in (401,403) else "error","httpStatus":status,"error":err,"updatedAt":now_iso()}


def recursive_find(obj,key):
    if isinstance(obj,dict):
        if key in obj: yield obj[key]
        for v in obj.values(): yield from recursive_find(v,key)
    elif isinstance(obj,list):
        for v in obj: yield from recursive_find(v,key)


def yahoo_flat_team(raw):
    if not isinstance(raw,list): return None
    merged={}
    for part in raw:
        if isinstance(part,dict): merged.update(part)
    key=merged.get("team_key")
    if not key: return None
    standings=merged.get("team_standings") or {}; outcome=standings.get("outcome_totals") or {}
    pts=standings.get("points_for") or merged.get("team_points",{}).get("total") or 0
    return {"id":key,"name":merged.get("name") or key,"logo":None,"wins":outcome.get("wins",0),"losses":outcome.get("losses",0),"ties":outcome.get("ties",0),"pointsFor":pts,"pointsAgainst":standings.get("points_against",0)}


def normalize_yahoo(data):
    league_name=None; league_key=None; teams=[]
    for league in recursive_find(data,"league"):
        if isinstance(league,list):
            meta={}
            for part in league:
                if isinstance(part,dict): meta.update(part)
            if str(meta.get("league_id",""))==YAHOO_LEAGUE or str(meta.get("league_key","")).endswith(f".l.{YAHOO_LEAGUE}"):
                league_name=meta.get("name") or league_name; league_key=meta.get("league_key") or league_key
    for t in recursive_find(data,"team"):
        flat=yahoo_flat_team(t)
        if flat and all(x.get("id")!=flat["id"] for x in teams): teams.append(flat)
    return {"provider":"yahoo","leagueId":YAHOO_LEAGUE,"season":YEAR,"leagueKey":league_key or f"nfl.l.{YAHOO_LEAGUE}","name":league_name or f"Yahoo {YAHOO_LEAGUE}","teams":teams,"matchups":[],"status":"connected","updatedAt":now_iso()}


def yahoo_access_token():
    direct=os.environ.get("YAHOO_ACCESS_TOKEN","").strip()
    if direct: return direct
    cid=os.environ.get("YAHOO_CLIENT_ID","").strip(); secret=os.environ.get("YAHOO_CLIENT_SECRET","").strip(); refresh=os.environ.get("YAHOO_REFRESH_TOKEN","").strip()
    if not (cid and secret and refresh): return None
    basic=base64.b64encode(f"{cid}:{secret}".encode()).decode()
    body=urllib.parse.urlencode({"grant_type":"refresh_token","refresh_token":refresh,"redirect_uri":"oob"}).encode()
    status,data,_=fetch_json("https://api.login.yahoo.com/oauth2/get_token",{"Authorization":f"Basic {basic}","Content-Type":"application/x-www-form-urlencoded","User-Agent":"DudesBeingDudes/1.0"},data=body)
    return data.get("access_token") if status==200 and data else None


def sync_yahoo():
    url=f"https://fantasysports.yahooapis.com/fantasy/v2/league/nfl.l.{YAHOO_LEAGUE};out=standings,teams?format=json"
    status,data,err=fetch_json(url)
    if data: return normalize_yahoo(data)
    token=yahoo_access_token()
    if token:
        status,data,err=fetch_json(url,{"User-Agent":"DudesBeingDudes/1.0","Authorization":f"Bearer {token}"})
        if data: return normalize_yahoo(data)
    return {"provider":"yahoo","leagueId":YAHOO_LEAGUE,"season":YEAR,"status":"needs_auth" if status in (401,403) else "error","httpStatus":status,"error":err,"updatedAt":now_iso()}


payload={"season":YEAR,"updatedAt":now_iso(),"leagues":[sync_espn(x) for x in ESPN_LEAGUES]+[sync_yahoo()]}
OUT.write_text(json.dumps(payload,indent=2))
print(json.dumps({"updatedAt":payload["updatedAt"],"statuses":[[x["provider"],x["leagueId"],x["status"]] for x in payload["leagues"]]},indent=2))
