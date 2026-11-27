# Security audit

**Reporting a vulnerability:** please use GitHub's private reporting (Security tab, « Report a vulnerability »), not a public issue.

Audit of the whole app (Worker, Durable Objects, web app, iPhone shell, CI) on 16 November 2026, version 0.17.1, then fixed in 0.17.2. Each finding has a severity, its status, and where it lives in the code.

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

## Fixed in the second pass

| Severity | Finding | Fix |
|---|---|---|
| Low | The session token lived in `localStorage`, readable by any script running in the page. | The web app now uses an `HttpOnly; Secure; SameSite=Strict` cookie limited to `/api`; the page never sees the token (only the marker `cookie` stays on the phone). Writes made with the cookie must carry the `X-Shred: 1` header, which another site cannot add (CORS refused): no CSRF. Phones signed in before are moved to the cookie at the next launch (`POST /api/auth/cookie`), and their stored token is erased. The iPhone app keeps a bearer token (different origin). |
| Low | A club photo was served to any signed-in member who knew its id, whatever the post's visibility. | The photo route asks the Club Durable Object whether the viewer can see the post (`/photo-check`, photo → post index, rebuilt once for older photos), cached 5 minutes per viewer and photo. |
| Low | Strava tokens and emails were stored in clear in KV. | Encrypted at rest with AES-GCM (`worker/seal.ts`), key derived by HKDF from `DATA_KEY` or, by default, the VAPID private key. Old clear values stay readable and are encrypted at their next write. Adding `DATA_KEY` later is safe: values sealed with the VAPID key still open. The admin CLI decrypts emails with the local secrets file. |
| Low | Two sign-ups at the same instant could both take the last place of a group link. | Places are reserved with an atomic counter in the `USAGE` Durable Object before the account is created. |
| Low | Dev tools (`wrangler` → `undici`) had known advisories. | `npm audit fix`: 0 vulnerabilities, shipped or dev. |

## Injections (0.17.3)

Review of every place where text from outside can reach code, a database or the AI.

| Vector | Finding | Status |
|---|---|---|
| SQL injection | No SQL anywhere. KV and the Durable Objects use key-value calls; every id in a key comes from a strict route pattern (`[a-f0-9]{24}`, `[0-9a-f]{16}`…). | Not applicable |
| Prompt injection, coach | The member's notes and program were written inside the coach's instructions. The day's state and history can contain product names from Open Food Facts, a base anyone can edit: a product named « ignore tes règles… » would have reached the AI. | Fixed. Instructions and data are separated: notes, program, day state, history and chat messages go in `<donnees>` blocks, the instructions say these blocks are never orders, and `cleanData` removes control and invisible characters and any tag that could close the block. The coach stays on sport, nutrition, sleep and recovery and does not reveal its instructions. |
| Prompt injection, meal photo | Text on the photo (a label, a screen) or in the note could try to steer the analysis. | Fixed. The instructions say this text is data; the answer is forced through the `report_meal` tool, then every field is clamped (`sanitizeMeal`). Worst case: a wrong calorie estimate on the member's own meal. |
| Barcodes and QR codes | The scanner only decodes EAN-13, EAN-8, UPC-A and UPC-E; a QR code is never read. A code is only used when it is all digits with a valid check digit, then twice in a row. | Sound |
| Open Food Facts data | Name, brand and image of a product were used as sent. | Fixed. Text without control characters or `<>`, bounded length; images only from `https://…openfoodfacts.org`; nutrition values clamped (`offText`, `offImage` in `src/lib/barcode.ts`). |
| Prototype pollution | The Health Shortcut body is copied key by key; a `__proto__` key could change that object's prototype. | Fixed. `__proto__`, `constructor`, `prototype` and long keys are ignored, at most 60 keys, nesting depth limited. |
| Identity in club calls | The member's identity was merged before the request fields when calling the club. No route passed client fields there, but the order is now safe by construction. | Hardened |
| HTML / XSS | React escapes every text; no `innerHTML`. The weekly report mail only goes to the member's own address. Strava pages only show fixed text. | Sound |
| Regex and Overpass queries | Mention names and gym search text are escaped before entering a pattern or an Overpass query. | Sound |

Tests: `scripts/test-injection.mjs`.

## Public repository (0.17.4)

The repository is public (it hosts the demo on GitHub Pages), so anyone can read the code and every past commit, including commits that are no longer on `main` after a history rewrite: GitHub keeps them reachable by their id.

| Question | Answer |
|---|---|
| Is a secret in the code or the history? | No. The 65 commits on GitHub and the older commits rewritten out of `main` were scanned for key formats (Anthropic, Resend, GitHub, Cloudflare, AWS, Google, private keys, VAPID, Strava) and secrets files (`.dev.vars`, `.shred-secrets.json`, `.env`). Only placeholder test values were found (`admin-code-123`…), which do not work in production. |
| Can someone use what the code shows? | The code shows how the app works, not how to get in: every check runs on the server and depends on secrets kept in Cloudflare (API key, VAPID key, encryption root, `ADMIN_CODE`). The KV id in `wrangler.jsonc` is useless without the Cloudflare account. |
| Can someone run an old, weaker version of the server? | Not any more. Cloudflare could serve older versions and test branches at preview addresses sharing the same data. `preview_urls: false` in `wrangler.jsonc`: only the production version answers. |
| Can an old version of the app on a phone get round the fixes? | No. Every protection is on the server, which refuses what it must refuse whatever the app's version. The app also updates itself at launch. |
| Can a new secret slip in by mistake? | Three barriers: `.gitignore` covers secrets files and key formats; a pre-commit hook (`.githooks/pre-commit`, enabled by `npm install`) blocks the commit; CI scans the tree and the whole history on every push (`scripts/check-secrets.mjs`). |
| Outdated dependencies | Dependabot (`.github/dependabot.yml`) proposes updates for npm packages and GitHub Actions each week. |
| Pull requests from strangers | CI runs them with a read-only token and no secrets. Deployment is done by Cloudflare from `main` only. |

If a secret is ever pushed, deleting the commit is not enough: it has already been readable. Change the secret first (`wrangler secret put …`, or the provider's dashboard), then clean up.

## Identity (0.18.0)

- Handles are unique and checked against look-alikes and reserved names (admin, shred, coach, support…), so a member cannot pose as another member or as the app. A released handle stays reserved for its owner for 14 days.
- Nickname and bio are cleaned on the server (control and invisible characters, length, at most 4 lines) and shown as plain text by React; links in a bio are not clickable.
- Changing the login email requires the password, refuses an email used by another account, keeps it encrypted at rest, closes the other sessions and is limited to 10 per day.
- The live handle check is limited to 400 requests per member per day.

## Club privacy (0.19.0)

- The member directory is gone: a member only receives their own relations. Others are found by handle, with a daily search cap, so the whole club cannot be listed in one call.
- Private accounts: posts, strength chart and stats only reach accepted followers; the check happens inside the Club Durable Object for every read (feed, post, photo, spark, comment).

## Version 0.22

| Severity | Finding | Fix |
|---|---|---|
| Low | `GET /api/profiles` still listed every visible profile of the club to any member, bypassing the end of the member directory (0.19). Unused by the app. | Admin only. |
| Design | Weekly leaderboard (`/api/club/leaderboard`). | Only the member and the people they follow (follow accepted for private accounts) appear. The published figures are three bounded integers and the Monday of the week (`sanitizeBoard`), opt-out in Settings, Profil public. 300 reads a day per member. |
| Design | Food search sends the typed words to Open Food Facts from the phone. | Results are cleaned and bounded like scanned products (`offText`, `offImage`, nutrition clamped). Nothing goes through the Worker. |
| Design | Story card, trophies, water, exercise history. | Computed and drawn on the phone; nothing new is sent to the server. |

## Version 0.23

| Severity | Finding | Fix |
|---|---|---|
| Low | `POST /api/push/rest` (rest timer push) had no daily cap: one account could rewrite its timer alarm without limit. | `capDaily('rest')`, 800 a day. The workout mode also waits 0.7 s after the last +30 s / −15 s tap before rescheduling, and still sends the pending change when it closes. |
| Low | A malformed synced state (muscle list that is not an array of strings, trophy date that is not a string) could break the readiness card or the monthly recap. | `regionsOf` and the recap check the shape before reading. |
| Design | Readiness score, muscle recovery map, workout mode, monthly recap. | Computed on the phone from data the app already has; no new endpoint, nothing new sent to the server. The recap image is drawn locally and only leaves the phone through the share sheet. |
| Design | Workout mode keeps the screen on (Wake Lock) and beeps (Web Audio). | Both only while the full screen is open; the lock is released on exit and requested again when the app comes back to the front. No permission prompt, no microphone. |

## Version 0.24

| Severity | Finding | Fix |
|---|---|---|
| Design | Seasonal themes read an identifier from three places: the calendar, the `season` setting (synced with the backup) and `?saison=` in the address. | Only an identifier of the fixed list is applied (own-property check, so `__proto__` or `toString` are refused); anything else falls back to the calendar. The value ends up in a `data-season` attribute and a `theme-color`, both from the list. |
| Design | The coach is told the season. | The client sends an identifier; the server appends one of its own fixed sentences when it is on the list and ignores anything else, so no free text reaches the system prompt this way. Tested with free text and inherited property names. |

## Version 0.26

| Severity | Finding | Fix |
|---|---|---|
| Design | Editing a post (`PUT /api/club/posts/:id`). | Author only: an admin can delete a post but never rewrite someone's words. Text trimmed and capped at 1,000 characters, mentions checked again against real accounts (10 at most), an empty text refused when there is no photo, video, music or session. Only newly added people are notified, and edits are capped at 60 a day, so an edit cannot be used to send the same notification over and over. The post keeps `editedAt` and shows « (modifié) ». Photos, session, sparks and comments are untouched. |
| Low | Sheets opened from inside an animated card were trapped in its stacking context: the edit sheet ended up under the tab bar. | Sheets render in a portal at the root of the document. |
| Design | Admin season lab. | Client side only, kept in memory for the session, never saved nor synced; the season id still comes from the fixed list. |

## Version 0.27

| Severity | Finding | Fix |
|---|---|---|
| Low | Two `@keyframes` shared a name; the one declared last silently replaced the other (sheet and end-of-day entrances since 0.24, the club feed skeleton). | Renamed; a test refuses duplicate keyframe names across the stylesheets. |
| Design | The once-a-day scene remembers `season:date` in `localStorage`. | Nothing personal, never synced or sent; an unknown value only means the scene plays again. |
| Design | Sheets can be dragged down to close. | Touch handling on the sheet only; a scrolled area, a slider or a sideways gesture keeps its own behaviour, and closing goes through the same `onClose` as the button (unsaved drafts follow the same rules as before). |

## Version 0.28

| Severity | Finding | Fix |
|---|---|---|
| Design | The weekly leaderboard also publishes the days of the week with a validated session (`board.days`). | A 7-bit integer bounded by `sanitizeBoard`; anything else is dropped and never stored. Seen only by the member and the people they follow, like the other figures, and returned as « none » when the figures are not from the requested week. Same opt-out as before (Settings, Profil public). Tested. |
| Design | Monthly recap: profile of the month, calendar, heaviest session. | Computed on the phone from data the app already has; nothing new is sent. The share image is still drawn locally and only leaves the phone through the share sheet. |

## Version 0.29

| Severity | Finding | Fix |
|---|---|---|
| Design | Claude reads a member's data through the connector, which needs the backup key the server never had. | Handed over only on an explicit consent in the app, checked against the backup, and stored by the OAuth provider in the grant's props, encrypted with a key wrapped by the token; tokens and codes are stored as hashes. A copy of KV alone reveals nothing. Read-only scope, read-only tools, 800 calls a day. Tested: neither the key nor a token appears anywhere in KV. |
| Design | OAuth for third-party clients (dynamic registration, CIMD). | `@cloudflare/workers-oauth-provider`: PKCE S256 required, exact redirect URIs, tokens bound to the MCP resource (audience), refresh rotation, CIMD fetched on the public internet only (`global_fetch_strictly_public`). Errors before the client is validated render a local page and never redirect. |
| Design | Consent page. | The request is bound to the browser that opened it (`__Host-` cookie, single use, 10 minutes), the page cannot be framed, the decision is an authenticated POST with `X-Shred`. The app shows the client's name, its verified domain when there is one, and the host the tokens go to (with a warning for a local app). Tested: no cookie, wrong key, no session, second use, unknown client. |
| Design | A grant outliving a password change. | The grant records the account's epoch; a mismatch revokes the grant and answers `401 invalid_token`. Members can also disconnect a client in Settings, AI. Tested. |
| Low | Card HTML rendered by the host. | Self-contained, no external script, data rendered with `textContent`, colours checked against a pattern before use, only `https://assets.claude.ai` allowed (Claude's font). |

## Version 0.30

| Severity | Finding | Fix |
| --- | --- | --- |
| Design | A currency that the app earns by declaring validated days. | The balance lives in the club Durable Object and only the server moves it, in the same transaction as the challenge it pays for. A claim is accepted for today or yesterday (UTC ± 1 day), once per day; milestone bonuses need a streak that advances no faster than the calendar since the previous claim; the balance is capped at 30. Faking the streak (which the club already trusts for the leaderboard) cannot earn more than a perfect streak. Tested over a simulated calendar. |
| Design | Challenge outcomes decided by the client. | Success needs the challenged member, an open challenge, and a validation time inside the window (offline validations count only if they reach the server within 30 minutes of the deadline). Failure is decided by the server's clock (lazy on read, and the cron). Stakes, refunds, the Nulos cap and the record are written by the Durable Object only. A rematch is free only for the loser, against the winner, once, while the cap is on. Tested with a moving clock. |
| Low | Forfeit text written by another member. | 80 characters, trimmed, shown with `textContent` like comments; notifications and pushes carry it as plain text. Only people who can already be challenged (public accounts, or private ones you follow) can receive one. |
| Design | Warm-ups. | Computed on the phone from the program; `warmup` is a two-value field in the backup. Nothing new is sent, except a line in the connector's `get_today` for the member's own Claude. |

## Version 0.31

| Severity | Finding | Fix |
| --- | --- | --- |
| Low | A language header and a stored preference. | `X-Shred-Lang` and `Accept-Language` only ever select one of six codes (`isLang`, `pickLang`); any other value is ignored. The per-account `lang` key holds one of those codes and nothing else. |
| Low | Translated strings with placeholders. | Dictionaries are static JSON bundled at build time, never fetched from elsewhere. Placeholders are filled with plain text: React escapes it in the app; in the weekly email, text that comes from the member (name, exercise names, advice) is escaped (`esc`) and the only values placed inside the translated HTML snippets are numbers; pushes are plain text. `npm test` rejects a translation whose placeholders differ from the French key. |

## Version 0.32

| Severity | Finding | Fix |
| --- | --- | --- |
| Low | A new outbound route (`/api/food/search`) that relays a search to Open Food Facts. | Signed-in members only, 300 searches a day each (`capDaily`), a query of 60 characters at most, two fixed hosts (`search.openfoodfacts.org`, `world.openfoodfacts.org`) with timeouts. Nothing about the member is sent: the User-Agent names the app and its version, not the person. Answers are cached by query and language, never per member. |
| Low | Product data written by anyone on Open Food Facts. | Parsed by the same code on the server and in the app (`shared/food.ts`): names and brands stripped of control characters and angle brackets and capped, numbers clamped, images accepted only from Open Food Facts hosts; the app checks the server's answer again before showing it. Image requests send no referrer. |
| Low | Meal slots in the day summary. | `/api/state` keeps only known meal ids (`breakfast`, `lunch`, `snack`, `dinner`, `extra`); the notification link is built by the server from that fixed list. |
| Info | Activities logged by hand. | Stored in the member's own encrypted backup like imported ones; nothing new reaches the server. |

## Version 0.33

| Severity | Finding | Fix |
| --- | --- | --- |
| Info | Visual redesign. | No new route, data or permission. The typeface ships inside the app bundle (`@fontsource-variable/bricolage-grotesque`, served from the app's own origin, `font-src 'self'`), the floor texture is an inline SVG data URI (`img-src data:`, no script). Nothing is loaded from a third party. |

## Version 0.34

| Severity | Finding | Fix |
| --- | --- | --- |
| Info | Variety and catch-up. | Computed on the phone from the program and the logged sets; two new fields in the encrypted backup (`settings.variety`, `DayLog.noCatchUp`), nothing new reaches the server. |
| Info | 3D muscle map. | The mesh is a static file of the app (`/assets/body3d-*.bin`, same origin, `connect-src 'self'`), parsed with a fixed format check; WebGL only draws, no script or data comes from elsewhere. `meshoptimizer` is a development dependency used by the mesh script, not shipped. |

## Accepted

| Severity | Finding | Why |
|---|---|---|
| Info | The backup key (`dataKey`) stays in the phone's storage: the app needs it to encrypt and decrypt. | With the CSP, no foreign script can run to read it, and the server never has it. |
| Info | A member can still try to talk the coach out of its role in their own chat. | They only affect their own answers; the coach refuses off-topic requests, and the API key and daily quota stay server-side. |

## For the admin

GitHub settings to switch on once (Settings of the repository; this cannot be done from the code):

- **Code security:** enable *Secret scanning* and *Push protection* (GitHub then refuses a push containing a known key), *Dependabot alerts*, and *Private vulnerability reporting*.
- **Rules, Rulesets:** a ruleset on `main` that blocks deletion and force pushes, with yourself as the only bypass (so you can still rewrite history on purpose).
- **Actions, General:** « Require approval for all external contributors » for workflows from forks.
- **Cloudflare, Workers Builds:** keep « Builds for non-production branches » off, or at least never for pull requests from forks.

- Protect the Cloudflare and GitHub accounts with two-factor authentication: they hold everything.
- A Shortcut key that was shown on screen (a screen recording, a screenshot) should be recreated in Settings, Connections, Apple Health (button « Nouvelle »).
- `ADMIN_CODE` no longer needs to stay secret once the admin account exists, but rotating it costs nothing (`wrangler secret put ADMIN_CODE`).
- Optional: a dedicated encryption root (`wrangler secret put DATA_KEY`, any long random string). Without it, the VAPID private key is used. Never delete a root that values were sealed with: those values (emails, Strava links) could no longer be read.
