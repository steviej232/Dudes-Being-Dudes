# Dudes Being Dudes

A custom fantasy-football league companion for Sleeper league `1395115881683484672`.

This is intentionally **not** a replacement for Sleeper. Sleeper remains the source of truth for rosters, scores, matchups, standings, waivers, and league management. This site adds the league-specific entertainment layer that Sleeper does not know how to create for your group.

## Included in v1

- Live Sleeper league metadata, managers, rosters and standings
- Week selector and live weekly matchup cards
- Fantasy Olympics generated automatically from weekly results
  - High Score
  - Photo Finish
  - Bench Press when Sleeper returns per-player point detail
  - Luck event / cold shower fallback events
- All-play standings for the selected week
- Weekly luck score (actual matchup result vs all-play win rate)
- Automatic weekly awards
- Commissioner recap editor with automatic weekly facts
- Local recap archive and draft persistence
- Responsive mobile/desktop UI
- Zero API keys required

## Run locally

Because browsers can restrict `fetch()` from `file://` pages, serve the directory with any local web server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Or use:

```bash
npx serve .
```

## Deploy

This is a zero-build static site and can be deployed directly to GitHub Pages, Vercel, Netlify, Cloudflare Pages, or any static host.

### GitHub Pages

1. Push these files to the repository root.
2. Open **Settings → Pages**.
3. Set **Deploy from a branch**.
4. Select `main` and `/ (root)`.

## Sleeper integration

The league ID is configured in `app.js`:

```js
leagueId: '1395115881683484672'
```

The site reads the public Sleeper API directly:

- `/league/{league_id}`
- `/league/{league_id}/users`
- `/league/{league_id}/rosters`
- `/league/{league_id}/matchups/{week}`

Sleeper's public API is read-only and does not require an API key.

## Recommended next phases

### Phase 2 — persistent league content
Replace localStorage recaps with Supabase or Firebase so commissioner posts sync across devices and are visible to everyone.

### Phase 3 — league history
Walk `previous_league_id` season by season, save historical matchups, and build:

- All-time head-to-head records
- Rivalries
- Career ELO
- Championships / playoff history
- All-time records
- Manager DNA
- Trade regret

### Phase 4 — Tuesday content engine
Generate a structured weekly payload that can feed:

- The commissioner recap
- AI-written matchup blurbs
- Weekly graphics
- Fantasy Olympics
- A 90–150 second recap video workflow

### Phase 5 — social games
Add Receipt Keeper, anonymous preseason predictions, league trivia / immaculate grid, and season-long Olympic medal standings.

## Notes

Bench Press uses per-player matchup point data if Sleeper returns `players_points`. If that field is unavailable for a week, the UI automatically substitutes a luck-based event instead of showing incorrect data.

## Commissioner recap workflow

The public site contains no visible editing controls. The commissioner view is enabled with:

```text
?commish=1
```

For the GitHub Pages URL that will be:

```text
https://steviej232.github.io/Dudes-Being-Dudes/?commish=1
```

In commissioner mode:

1. Choose a week.
2. Click **Write the recap for me**.
3. The browser generates a complete editable draft from live Sleeper matchup, all-play and luck data.
4. Edit the headline, intro or body.
5. Click **Publish to league site**.
6. Submit the prefilled GitHub issue that opens.

`.github/workflows/publish-recap.yml` verifies the GitHub actor is exactly `steviej232`. Only that account can cause `data/recaps.json` to be updated. Other users cannot publish even if they discover the commissioner URL or manually create a similarly formatted issue.

Because GitHub Pages is a static site, `?commish=1` is a UI gate rather than identity authentication. The actual authorization boundary is the GitHub workflow actor check.
