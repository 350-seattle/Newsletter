# Build progress (handoff notes)

Working notes so anyone (or any session) can pick up where the last one
stopped. Updated and committed after every milestone. The plan this
follows is the "Newsletter Builder" brief; decisions are listed below.

## How to check the state quickly

```
git status && git log --oneline -5
node --test tests/                 # unit tests (expect all pass)
node tools/build-dist.js           # regenerates dist/
cd tests/e2e && npm install && node run.mjs   # browser checks 1-10
```

## Milestones

- [x] Reference materials and brand guide (`reference/`)
- [x] Board renderer, styles, sample data, fonts, vendored html-to-image
- [x] Builder page (4 steps), app logic
- [x] Unit tests (`tests/*.test.js`) for checks 2 and 7
- [x] Browser test runner (`tests/e2e/run.mjs`) for checks 1-10
- [x] Check 9 fixed (the test read the previous scenario's message; app behavior was correct)
- [x] README.md for volunteers
- [x] Visual review: fixed category overflow in narrow tiles, centered text tiles, capped open-tile image height
- [x] Final full run: 25/25 unit tests, 10/10 browser checks; committed and pushed
- [ ] (Owner) Turn on GitHub Pages; set APPS_SCRIPT_URL and confirm BOARD_BASE_URL once the Apps Script side exists

### Done: weekly summary (requested 2026-11-16)
The volunteer writes "everything happening this week" in the builder.
- [x] render-board.js: `issue.weekSummary` (sanitized, emails removed) rendered as an "In summary…" section under the grid (`.n350-recap`); added to the top of the email text; validate warns if empty, over 120 words, or contains web addresses (untracked)
- [x] board.css: `.n350-recap` styles
- [x] index.html/app.js: textarea in step 2 above the arrange list (static, not rebuilt), live word count, saved in sessionStorage as `state.weekSummary`; optional prefill from `issue.weekSummary` in the Apps Script reply
- [x] tests (28 unit; e2e check 1 types, refreshes, checks preview/email/download), README, dist rebuild, commit

### In progress: Google Sheet panel (requested 2026-11-19)
Embed the submissions Sheet in the builder so the volunteer can review/approve without leaving it. No Sheet login yet, so it must work as a placeholder.
- [ ] config.js `SHEET_URL` (blank = placeholder). Only normal private links (`/spreadsheets/d/<id>/...`); refuse "Publish to web" links (`/d/e/`, `pubhtml`) because they make the whole Sheet, including submitter emails, public
- [ ] render-board.js `sheetLinks(url)`: pure, returns embed src (`/edit?rm=minimal`, keeps `#gid`) + open-in-new-tab link, or a reason
- [ ] index.html/app.js/app.css: collapsible panel in step 1 under the load form (iframe loads only when opened); placeholder box when unset; "Open the Google Sheet" link in step 2 text
- [ ] tests: unit for sheetLinks; e2e extra check (placeholder; iframe src/title with a faked SHEET_URL); README; commit

### In progress: sign in with 350 email instead of access token (requested 2026-11-19)
Replaces the pasted token everywhere.
- [ ] Google OpenID sign-in without any Google script (no-CDN rule): popup to `GOOGLE_AUTH_URL` with `response_type=id_token`, `hd=EMAIL_DOMAIN`, random `state` + `nonce`; `auth-callback.html/.js` (same origin) sends the result back via BroadcastChannel + opener.postMessage, clears its own URL, closes
- [ ] app.js: credential `{idToken, name, domain, exp}` in memory only; checks state, nonce, aud, exp, email domain (UX only; server must verify); requests send `idToken` instead of `token`; sign in again when expired; sign out button; popup-blocked and wrong-account messages
- [ ] config.js: `GOOGLE_CLIENT_ID` (blank = sign-in not set up yet), `EMAIL_DOMAIN` ('350seattle.org', assumed), `GOOGLE_AUTH_URL` (tests override)
- [ ] README: volunteer wording; one-time Google Cloud setup (OAuth client, origins, redirect URIs); Apps Script must verify the ID token via tokeninfo (aud, email_verified, hd)
- [ ] tests: app-safety (no credential in storage/URL/log), e2e fake Google sign-in endpoint on the test server; checks 8/9 use sign-in; wrong-domain test

## Last known results (browser checks)

All 10 PASS (Lighthouse a11y 100/100 on the preview and the published board)

## Decisions made (approved plan)

- Collapsed tile: image plus a caption strip (team, category, headline). No-image items are solid Clean Ocean tiles.
- Open tile spans the full row in Clean Ocean, image left, text right (`<details>`, no JavaScript).
- Featured tile is first and spans 2 columns.
- Link text uses `#0068A5` (Clean Air darkened) because `#0081CC` fails WCAG AA on Foggy.
- Fonts: Cal Sans (real, OFL), Fraunces and Montserrat as stand-ins, vendored into `fonts/`. The licensed fonts can be switched on in `config.js`.
- The token lives in memory only (not sessionStorage).
- `styles/board.css` is the single source for the board's look; `dist/` is generated.
