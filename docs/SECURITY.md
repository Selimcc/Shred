# Security audit

Audit of the whole app (Worker, Durable Objects, web app, iPhone shell, CI) on 16 November 2026, version 0.17.1. Each finding has a severity, its status, and where it lives in the code.

## Fixed in this pass

| Severity | Finding | Fix |
|---|---|---|
| High | The admin code (`ADMIN_CODE`) could create an admin account any number of times. It travels in a link (`?invite=…`), so it ends up in browser history and chat logs. Anyone holding it could become admin and read every account's overview, create invites, reset passwords and delete accounts. | The admin code only works while no admin account exists (`worker/auth.ts`, register). Afterwards it is refused like a wrong invite and counts as a failed attempt. |
| Medium | No security headers on the app. A script injected one day through any bug could read the session token from `localStorage`. The app could be framed by another site (clickjacking). | `public/_headers` (static files, served by Cloudflare without the Worker) and `secureAsset` in `worker/index.ts` (Worker responses): Content-Security-Policy with `script-src 'self'` only, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy` (camera and location for the app only). Checked in a browser against a local Worker: no violation from sign-up to every tab. |
| Medium | Push subscriptions accepted any `https://` endpoint. The Worker would then send signed requests to an address chosen by a member, every 15 minutes. | `pushHostOk` only accepts Apple, Google, Mozilla and Microsoft push services. |
| Medium | No per-member limits on club writes and external searches. One member (or a stolen session) could burn the free plan's 1,000 daily KV writes for everyone, fill storage with photos, or get the Worker banned by Overpass, Nominatim, Apple or Deezer. | Daily caps per member in the `USAGE` Durable Object (no KV write): 30 posts, 150 comments, 300 sparks, 15 profile photos, 20 challenges, 200 follows, 120 gym searches, 400 music searches (`DAILY_CAPS` in `worker/usage.ts`). |
| Low | `Access-Control-Allow-Origin: *` on the API. Bearer tokens are not sent automatically, so this was not a CSRF hole, but any site could call the API with a token it had obtained. | CORS is only answered for the iPhone app (`capacitor://localhost`, `https://localhost`) and local development. The web app is same-origin and needs none. |
| Bug | The Worker only ran for `/api/*` (`run_worker_first`): the invite-aware manifest (installed app opening with the code filled in) and the `X-Robots-Tag` header never applied. | `/manifest.webmanifest` added to `run_worker_first`; robots header moved to `_headers`. |

## Checked and sound

- **Passwords.** Never sent. The phone derives two keys with PBKDF2-SHA-256 (600,000 iterations, OWASP 2023) then HKDF: one to sign in, one to encrypt the backup. The server stores an HMAC of the sign-in key with a random salt and compares in constant time (`sameBytes`).
- **Backup.** End-to-end encrypted with AES-GCM and a random 96-bit IV per save. The data key never leaves the phone; the server cannot read backups.
- **Sessions.** 256-bit random tokens; only their SHA-256 is stored (`sess:<hash>`), expiring after 180 days. Changing the password bumps the account epoch and closes every other session. Logout deletes the session.
- **Login.** Same work whether the email exists or not (no timing oracle). Attempts limited per email and per IP (10 per 15 min), as are sign-ups and reset codes.
- **Invites and reset codes.** 10 random characters from a 31-letter alphabet (≈ 50 bits), single or limited use, expiring. Brute force is capped by the attempt limits.
- **Shortcut keys.** Stored as a hash, only accepted on the three Shortcut routes (`DEVICE_ROUTES`), refused everywhere else.
- **Club authorization.** Feed, post, comments and sparks check visibility (all, followers, private) inside the Durable Object. Only the author (or an admin) deletes a post; only the author of a comment or of the post deletes a comment. Mentions are checked against real members.
- **Photos.** Only JPEG, PNG or WebP data URLs, size-capped, served with their stored type and `nosniff`. No SVG, so no script in an image.
- **Music and places.** The Worker only calls fixed hosts (Overpass, Nominatim, Apple, Deezer, SoundCloud oEmbed). A post only keeps Apple, Deezer or SoundCloud URLs (`sanitizeTrack`); the SoundCloud player URL is built from that checked link. The gym search rounds the position to about 100 m.
- **Strava.** OAuth with a one-time `state` stored server-side for 10 minutes; tokens stay on the server; disconnect revokes them. The callback page only shows fixed text.
- **Rendering.** No `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere; React escapes every text.
- **Secrets.** None in the repository or its history (`.dev.vars`, `.shred-secrets.json` and `.env.native` are ignored). Production secrets are Worker secrets on Cloudflare; deployment uses Cloudflare's Git integration, so no token is stored in GitHub.
- **Account deletion.** Removes the account, its sessions, its data, its Strava link, its club posts, photos, comments, follows and challenges.
- **Dependencies.** `npm audit --omit=dev`: 0 vulnerabilities in what ships.

## Remaining, accepted or to plan

| Severity | Finding | Recommendation |
|---|---|---|
| Low | The session token lives in `localStorage`, readable by a script running in the page. | Acceptable with the new CSP (no foreign script can run). An `HttpOnly` cookie would need CSRF protection and breaks the iPhone app's cross-origin calls. |
| Low | A club photo is served to any signed-in member who knows its 96-bit id, without re-checking the post's visibility. Ids only appear to people allowed to see the post. | Fine for a private club. To harden, check visibility in the photo route (one extra Durable Object call per image). |
| Low | Strava tokens and emails are stored unencrypted in KV. | Only someone with access to the Cloudflare account could read them. Keep the account protected with 2FA. |
| Low | Two sign-ups at the exact same moment on a group link could both take the last place (KV is not transactional). | At most one extra account; move invites to the Durable Object if it matters. |
| Low | Dev tools (`wrangler` → `undici`) have known advisories. They never ship to users. | Update `wrangler` when convenient (`npm audit fix`). |
| Info | The AI coach receives the member's own notes and messages. A member can only steer the answers they receive themselves; the API key and daily quota stay server-side. | Nothing to do. |

## For the admin

- Protect the Cloudflare and GitHub accounts with two-factor authentication: they hold everything.
- A Shortcut key that was shown on screen (a screen recording, a screenshot) should be recreated in Settings, Connections, Apple Health (button « Nouvelle »).
- `ADMIN_CODE` no longer needs to stay secret once the admin account exists, but rotating it costs nothing (`wrangler secret put ADMIN_CODE`).
