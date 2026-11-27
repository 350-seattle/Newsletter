# Build progress (handoff notes)

Working notes so anyone (or any session) can pick up where the last one
stopped. Updated and committed after every milestone. The plan this
follows is the "Newsletter Builder" brief; decisions are listed below.

## Where it lives

Repository: https://github.com/350-seattle/Newsletter (remote `origin`, GitHub organization 350-seattle). Moved there on 2026-11-23 with full history and the reference/ folder. The old copy, cody-trinkaus/NewsletterBuilder (remote `personal`), is no longer updated.
Addresses in config.js, README and dist/ already point at the new site.
Site once GitHub Pages is on: https://350-seattle.github.io/Newsletter/

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
- [x] (Owner) GitHub Pages on; APPS_SCRIPT_URL, GOOGLE_CLIENT_ID and SHEET_URL set in config.js (2026-11-27)

### Done: weekly summary (requested 2026-11-16)
The volunteer writes "everything happening this week" in the builder.
- [x] render-board.js: `issue.weekSummary` (sanitized, emails removed) rendered as an "In summary…" section under the grid (`.n350-recap`); added to the top of the email text; validate warns if empty, over 120 words, or contains web addresses (untracked)
- [x] board.css: `.n350-recap` styles
- [x] index.html/app.js: textarea in step 2 above the arrange list (static, not rebuilt), live word count, saved in sessionStorage as `state.weekSummary`; optional prefill from `issue.weekSummary` in the Apps Script reply
- [x] tests (28 unit; e2e check 1 types, refreshes, checks preview/email/download), README, dist rebuild, commit

### Done: Google Sheet panel (requested 2026-11-19)
Embed the submissions Sheet in the builder so the volunteer can review/approve without leaving it. No Sheet login yet, so it must work as a placeholder.
- [x] config.js `SHEET_URL` (blank = placeholder). Only normal private links (`/spreadsheets/d/<id>/...`); refuse "Publish to web" links (`/d/e/`, `pubhtml`) because they make the whole Sheet, including submitter emails, public
- [x] render-board.js `sheetLinks(url)`: pure, returns embed src (`/edit?rm=minimal`, keeps `#gid`) + open-in-new-tab link, or a reason
- [x] index.html/app.js/app.css: collapsible panel in step 1 under the load form (iframe loads only when opened); placeholder box when unset; "Open the Google Sheet" link in step 2 text
- [x] tests: unit for sheetLinks; e2e extra check (placeholder; iframe src/title with a faked SHEET_URL); README; commit

### Done: sign in with 350 email instead of access token (requested 2026-11-19)
Replaces the pasted token everywhere.
- [x] Google OpenID sign-in without any Google script (no-CDN rule): popup to `GOOGLE_AUTH_URL` with `response_type=id_token`, `hd=EMAIL_DOMAIN`, random `state` + `nonce`; `auth-callback.html/.js` (same origin) sends the result back via BroadcastChannel + opener.postMessage, clears its own URL, closes
- [x] app.js: credential `{idToken, name, domain, exp}` in memory only; checks state, nonce, aud, exp, email domain (UX only; server must verify); requests send `idToken` instead of `token`; sign in again when expired; sign out button; popup-blocked and wrong-account messages
- [x] config.js: `GOOGLE_CLIENT_ID` (blank = sign-in not set up yet), `EMAIL_DOMAIN` ('350seattle.org', assumed), `GOOGLE_AUTH_URL` (tests override)
- [x] README: volunteer wording; one-time Google Cloud setup (OAuth client, origins, redirect URIs); Apps Script must verify the ID token via tokeninfo (aud, email_verified, hd)
- [x] tests: app-safety (no credential in storage/URL/log), e2e fake Google sign-in endpoint on the test server; checks 8/9 use sign-in; wrong-domain test

## Last known results (browser checks)

All 13 PASS (10 from the brief; 11 Sheet step and 350-only sign-in; 12 publishing as a post; 13 whole EveryAction email). Lighthouse a11y 100/100. 34 unit tests pass. (2026-11-27)

## Decisions made (approved plan)

- Collapsed tile: image plus a caption strip (team, category, headline). No-image items are solid Clean Ocean tiles.
- Open tile spans the full row in Clean Ocean, image left, text right (`<details>`, no JavaScript).
- Featured tile is first and spans 2 columns.
- Link text uses `#0068A5` (Clean Air darkened) because `#0081CC` fails WCAG AA on Foggy.
- Fonts: Cal Sans (real, OFL), Fraunces and Montserrat as stand-ins, vendored into `fonts/`. The licensed fonts can be switched on in `config.js`.
- The sign-in (Google ID token) lives in memory only (not sessionStorage). The access token was replaced by 350 email sign-in on 2026-11-19.
- `styles/board.css` is the single source for the board's look; `dist/` is generated.

## Open questions for the owner

- Is 350 Seattle's email domain `350seattle.org`, and are those Google Workspace accounts? Sign-in assumes both (`EMAIL_DOMAIN` in config.js).
- Google Cloud OAuth client (see README "One-time setup") and the Apps Script's ID-token check still need to be done by someone with 350 Workspace access.
- The Sheet holds submitter emails; it shows inside the builder only to people it is shared with. Consider moving contact emails to a separate tab.

### Done: five steps, Sheet as step 2 (requested 2026-11-19)
New order: 1 Sign in, 2 Review in the Sheet (+ "Load approved blurbs" at the bottom), 3 Arrange, 4 Final check, 5 Publish and share.
- [x] index.html: split step 1; renumber sections/ids/data-step/data-goto (old 2,3,4 -> 3,4,5)
- [x] app.js: steps 1-2 always reachable, 3-5 need data; loading goes to 3; saved-state version 2 (old saves are ignored); clamps to 5
- [x] app.css: 5-step indicator (wraps on phones)
- [x] tests/e2e/run.mjs: renumber steps; README: five steps
- [x] full test run, commit

### Done: Sheet protected by sign-in (requested 2026-11-19)
- [x] app.js renderSheetPanel: three modes, placeholder (no SHEET_URL) / locked (signed out: sign-in button, no iframe, no Sheet link anywhere) / frame (signed in). Re-render only when the mode changes; sign-out and expiry (timer at exp) remove the iframe
- [x] e2e check 11: locked with SHEET_URL set and signed out (no iframe, no docs.google.com request), unlocks after signing in from the panel, locks again on sign out
- [x] README; commit

### Done: publishing as WordPress posts (2026-11-25)
Backend now publishes each issue as a post in the Newsletters category; reply `{ok, url, postId, status}` ("publish" | "draft"); dated addresses (e.g. /2026/12/06/dec-26-newsletter/); drafts return `?p=123` preview links; slugs like `dec-26-newsletter`; re-publish updates within 45 days, refused after (plain error).
- [x] Remove BOARD_BASE_URL (config, README, app). `boardUrl()` = `state.publishedUrl` or null. Step 5 image link: "Publish first…" message until published (live); no guessed link anywhere
- [x] `status`: draft (or `?p=` in url) → draft message + "Draft" label, never "live", no image link for the email; missing status = published. Saved as `state.publishedStatus`
- [x] Demo: made-up dated example.org address. Confirm dialog: 45-day wording
- [x] Slugs `dec-26-newsletter` in sample data, docs, tests (utm_campaign); download names avoid "newsletter-…-newsletter"
- [x] Tests: utm.test, e2e mock reply with dated url + status; new e2e check 12 (no link before publishing; draft message; live message + link)
- [x] README, full test run, commit, push

Also fixed on 2026-11-25: step numbers left over from the five-step change in messages ("fix the problems in step 3" now step 4, "leave items out / write the summary in step 2" now step 3).

### Done: Google sign-in client added (2026-11-25)
- GOOGLE_CLIENT_ID set in config.js (public ID, not a secret). Checked against Google: the live redirect URI https://350-seattle.github.io/Newsletter/auth-callback.html is accepted; http://localhost:8000/auth-callback.html is NOT registered (only needed for local testing).
- Browser check 11 now blanks the client ID itself to test the "not set up yet" state.
- Still open: confirm volunteers sign in with @350seattle.org (EMAIL_DOMAIN); the Apps Script needs the same client ID for its token check.

### Done: Sheet address added (2026-11-25)
- SHEET_URL set in config.js. Signed out of Google, the Sheet answers 401 (sharing is restricted, good) and sends no frame-blocking header, so it can show in the step 2 panel for signed-in volunteers with access.

### Done: page scrolls while the cursor is over the Sheet (requested 2026-11-25)
Wheel scrolling over the Sheet frame chains to the page when Google's Sheet doesn't use it. Fix: while a mouse/pen pointer is over the frame (pointerover/pointerout on the iframe, plus any pointermove or wheel in the page outside it), add `nb-scroll-locked` to <html> (overflow hidden; `scrollbar-gutter: stable` so nothing shifts). Unlock on leaving step 2 or when the frame is removed. Touch is unchanged.
- [x] e2e check 11: wheel over the Sheet doesn't move the page; wheel elsewhere still does (write first, confirm it fails)
- [x] app.js + app.css fix, tests pass, README note, commit
- Result: the browser test reproduced it (page moved 301px under the Sheet); after the fix it moves 0px, the page still scrolls elsewhere, and nothing shifts sideways. 31 unit tests, 12/12 browser checks pass.

### Done: Apps Script connected (2026-11-27)
- APPS_SCRIPT_URL set. Checked from outside Google: a text/plain POST is redirected to script.googleusercontent.com, answers JSON with Access-Control-Allow-Origin: *, and refuses a fake idToken with {ok:false, error:"Please sign in again.", reauth:true}.
- Earlier the deployment was limited (answered 401 "Page Not Found"); fixed by redeploying with Who has access: Anyone.
- Next: a real end-to-end run (sign in, load approved blurbs, publish as draft, check on WordPress).

### Done: preview image = news board tiles only (requested 2026-11-27)
- [x] makePng captures only `.n350-grid` (the rounded tile panel) at 600 CSS px, 2x = 1200 px; no masthead, date, "News Board" heading or "In summary…"
- [x] help text + README; e2e check 6 also checks the image starts and ends inside the tile panel (Foggy background), not on the white masthead/summary
- [x] tests, commit
- Note: the image tool paints its background colour onto the captured element, so the panel is wrapped in a white div and the wrapper is captured (otherwise the Foggy panel came out white). Result 1200 x 2568 px for the sample. 31 unit tests, 12/12 browser checks.

### Done: full EveryAction email HTML (requested 2026-11-27)
Builder writes a complete email per issue: masthead + issue title, the board image (links to the published board), "In summary…" + weekly summary, items by category (headline, summary, Read more), and a bottom button to the newsletter on the website.
- [x] render-board.js `buildEmailHtml(issue, items, {boardUrl, imageUrl, imageAlt})`: full email document, tables + inline styles, 600px, escaped, https image only; button link `utm_content=newsletter-button` (everyaction/email/<slug>); image link = preview-image rule; items = existing Read more rule
- [x] step 5 card "E. Email for EveryAction": image-address field (uploaded PNG's https address, saved in session), Copy email HTML, Download email HTML, sandboxed preview; disabled with a plain reason until the board is published (live) and the image address is set
- [x] tests: unit (structure, safety, UTM rules incl. button), e2e (live publish → image address → download → links); README; commit
- Result: 34 unit tests; 13/13 browser checks (new check 13 downloads the email and checks title, linked image, Read more count, button last). Screenshot reviewed (tests/e2e/output/everyaction-email.png).
