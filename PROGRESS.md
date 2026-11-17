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
- [ ] README.md for volunteers
- [x] Visual review: fixed category overflow in narrow tiles, centered text tiles, capped open-tile image height
- [ ] Final full run of both test suites, commit, push

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
