# Dudes Being Dudes

A mobile-first fantasy-football companion for Sleeper league `1395115881683484672`.

Sleeper remains the source of truth for rosters, scores, standings and league management. This site adds the custom league layer: Power Rankings, Fantasy Olympics, positional analysis, weekly recaps and private commissioner decision tools.

## Current experience

### Public league site
- Live Sleeper matchups and week selector
- Composite Power Rankings with week-over-week movement
- Power-vs-standings storylines
- Fantasy Olympics and weekly awards
- Season-to-date positional leaderboards
- League standings
- Published weekly recap archive

### Commissioner mode
Open the site with `?commish=1`.

Private tools include:
- Steve's Edge action board
- Start / Sit Optimizer
- Waiver Priority Engine
- Trade Target Finder
- Buy Low / Sell High signals
- Team Health and Championship Window
- Handcuff / Injury Board
- Opponent strategy
- Streaming Planner
- Drop Risk Analyzer
- Trade Deadline Mode
- Concise weekly recap prompt exporter for ChatGPT

The commissioner URL is a UI gate, not account authentication. Publishing recaps is protected by `.github/workflows/publish-recap.yml`, which only accepts publication from the authorized GitHub actor.

## Mobile-first design

The phone experience is intentionally vertical rather than carousel-heavy:

1. League hero
2. This Week
3. Steve's Edge in commissioner mode
4. Power Rankings
5. Fantasy Olympics
6. Position Room
7. Waivers in commissioner mode
8. Standings
9. Weekly Recaps

The UI includes a compact bottom navigation bar, active-section state, scroll progress, subtle section/card reveals and reduced-motion support. Horizontal scrolling is limited to small controls only when useful.

## Sleeper integration

The league ID is configured in `app.js`:

```js
const LEAGUE_ID = "1395115881683484672";
```

The site reads Sleeper's public read-only API directly. No API key or paid backend is required.

Core data includes league metadata, users, rosters, weekly matchups, player data, trending adds, stats and available projections.

## Weekly recap workflow

1. Open commissioner mode.
2. Tap **Build recap prompt**.
3. Choose the week and build/copy the concise prompt.
4. Paste it into ChatGPT for the finished write-up.
5. Paste the finished recap back into the site.
6. Publish through GitHub.

The recap prompt intentionally focuses on matchup results, weekly awards, Power Rankings, model storylines and position leaders rather than dumping every available statistic.

## Deployment

The site is deployed free through GitHub Pages using `.github/workflows/pages.yml`.

The Pages workflow validates the canonical JavaScript files before publishing:
- `app.js`
- `lab.js`
- `edge.js`
- `experience.js`

There is no Yahoo/ESPN connector, scheduled private-league sync or provider-auth code in the current project.

## Local development

Serve the repository directory with any static web server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
