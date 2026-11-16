# Security audit

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

## Accepted

| Severity | Finding | Why |
|---|---|---|
| Info | The backup key (`dataKey`) stays in the phone's storage: the app needs it to encrypt and decrypt. | With the CSP, no foreign script can run to read it, and the server never has it. |
| Info | A member can still try to talk the coach out of its role in their own chat. | They only affect their own answers; the coach refuses off-topic requests, and the API key and daily quota stay server-side. |

## For the admin

- Protect the Cloudflare and GitHub accounts with two-factor authentication: they hold everything.
- A Shortcut key that was shown on screen (a screen recording, a screenshot) should be recreated in Settings, Connections, Apple Health (button « Nouvelle »).
- `ADMIN_CODE` no longer needs to stay secret once the admin account exists, but rotating it costs nothing (`wrangler secret put ADMIN_CODE`).
- Optional: a dedicated encryption root (`wrangler secret put DATA_KEY`, any long random string). Without it, the VAPID private key is used. Never delete a root that values were sealed with: those values (emails, Strava links) could no longer be read.
