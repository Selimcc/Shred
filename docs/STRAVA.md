# Strava

Members link their Strava account in Settings, Connections, Strava. Their runs, rides and swims are imported each time the app opens (at most every 15 minutes); an activity of the same sport as the day's session ticks it off and counts for the streak.

## One-time setup (server admin)

1. Create an application on <https://www.strava.com/settings/api>.
   - **Authorization Callback Domain**: the host of your Worker, without `https://` (for example `shred.your-subdomain.workers.dev`).
   - The website and the icon are up to you.
2. Copy the **Client ID** and **Client Secret**, then add them to the Worker:

   ```bash
   npx wrangler secret put STRAVA_CLIENT_ID
   npx wrangler secret put STRAVA_CLIENT_SECRET
   ```

3. That's it. Each member then taps **Se connecter avec Strava** and approves access to their activities.

A new Strava application starts with a small rate limit (a few hundred requests per 15 minutes for the whole app, shared by all members). For a group of friends syncing every 15 minutes at most, it is plenty.

## How it works

- `POST /api/strava/connect` returns the Strava authorization link with a one-time `state` (10 minutes).
- Strava redirects to `GET /api/strava/callback`, which exchanges the code for tokens. Tokens stay on the server (`u:<id>:strava`), because they must be refreshed every 6 hours; the app never sees them.
- `POST /api/strava/sync` refreshes the access token when needed, fetches the activities since the last sync (minus a day, to catch late uploads) and returns a short summary of each: sport, name, start time, moving time, distance, elevation, heart rate, energy.
- Unlinking calls Strava's deauthorize endpoint and deletes the tokens. Deleting a Shred account does the same.

## Strava's rules

Strava's API agreement only allows showing a user's Strava data to that user. Imported activities therefore stay in your own stats and never go into the club feed: a club post shows what you logged in Shred, not the Strava numbers.

Scope requested: `read,activity:read_all` (to include activities marked private on Strava, which are still yours).
