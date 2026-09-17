# Private league connections

The site and sync jobs are already configured. No paid hosting or additional hosting account is required.

## ESPN — leagues 688845290 and 1726232411

Both leagues returned ESPN `401 AUTH_LEAGUE_NOT_VISIBLE`, so they are private.

Use the same existing ESPN account that can view both leagues. In GitHub repository settings, add these **Actions secrets**:

- `ESPN_SWID`
- `ESPN_S2`

Get them from your logged-in ESPN browser session (Developer Tools → Application/Storage → Cookies for ESPN). Treat both values like passwords. Never commit them, paste them into an issue, or put them in the website JavaScript.

The scheduled `Sync private fantasy leagues` workflow will automatically use them on its next run. One pair should work for both ESPN leagues as long as that ESPN account can see both leagues.

## Yahoo — league 772644

Yahoo returned `401`, so anonymous access is not available for this league.

Yahoo's official Fantasy API uses OAuth. If Yahoo grants Fantasy API access to an app under your existing Yahoo account, add these GitHub Actions secrets:

- `YAHOO_CLIENT_ID`
- `YAHOO_CLIENT_SECRET`
- `YAHOO_REFRESH_TOKEN`

The sync workflow automatically exchanges the refresh token for short-lived access tokens, so you do not need to keep updating the site.

`YAHOO_ACCESS_TOKEN` is also supported for testing, but access tokens expire and are not the recommended permanent setup.

## Sync schedule

`.github/workflows/sync-private-leagues.yml` runs every four hours and can also be run manually from GitHub Actions.

It writes sanitized fantasy data only to `data/private-leagues.json`. Provider credentials stay in GitHub Actions secrets and are never written to the public site.

## Public vs private

- Sleeper league `1395115881683484672`: public site + commissioner tools
- Yahoo `772644`: commissioner-only
- ESPN `688845290`: commissioner-only
- ESPN `1726232411`: commissioner-only

Open the private command center with `?commish=1`. The My Teams carousel lets you swipe between all four leagues and remembers the team you select for each provider in the browser.
