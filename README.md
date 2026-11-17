# Newsletter Builder

A small website for 350 Seattle volunteers. It takes the newsletter blurbs that were approved in the Google Sheet and turns them into the **news board**: the grid of photo tiles that readers click to open each team's update. You arrange the board, check it, publish it to the 350 website, and get everything you need for the EveryAction email.

You don't need to install anything or know any code to use it.

- **No passwords live here.** The builder never sees the WordPress password. You paste an *access token* (ask the newsletter coordinator), and it's forgotten when you close or refresh the tab.
- **No email addresses are shown or published.** If one turns up in a blurb, the builder removes it and tells you.

---

## Opening the builder

Go to **https://cody-trinkaus.github.io/NewsletterBuilder/**

Want to look around first? Open **https://cody-trinkaus.github.io/NewsletterBuilder/?demo=1**, or click **Try with sample data** on the first screen. Everything works with made-up blurbs, and nothing is sent anywhere.

---

## The four steps

The bar across the top shows where you are. Once blurbs are loaded you can jump between steps at any time. Your arrangement is kept if you refresh the page, but not if you close the tab.

### 1. Load
Paste the access token and click **Load approved blurbs**. Only rows ticked *Approved* in the Sheet come through.

### 2. Arrange
First, write **This week in summary**: a few friendly sentences about everything happening this week. It appears as an "In summary…" section under the board and at the top of the email. Leave a blank line between paragraphs. Aim for 120 words or fewer, and don't paste links or email addresses into it (put links in the items instead). If the Sheet sends a draft summary, it's filled in for you to edit. What you write is kept if you refresh or reload the blurbs.

Then arrange the items. They're grouped by category (Take action, Events, and so on).
- **Include**: untick to leave an item off this issue.
- **Featured**: tick one item to make it the big first tile.
- **Up / Down**: change the order of items, or of whole groups.

The live preview shows the board as you go. To change any wording, fix it in the Google Sheet and load again; your choices are kept.

### 3. Final check
You'll see the board exactly as it will be published, a list of problems and warnings, and every link so you can click each one and make sure it works.

### 4. Publish and share
Do these in order:
- **A. Publish to website.** You'll be asked to confirm. When it's done you get the page's address and a **Copy link** button.
- **B. Download preview image.** A picture of the board (1200 pixels wide) for the top of the email. Also copy the **image link** (make the image link to it in EveryAction) and the **alt text**.
- **C. Copy email text.** Copies the summary (a heading per category, then each headline, its one-sentence summary and a "Read more" link) ready to paste into EveryAction. The box below the button shows exactly what will be pasted, including the full links, so you can spot-check them.
- **D. Download HTML.** Only needed if publishing fails. In WordPress, add a **Custom HTML** block to a new post and paste in the downloaded file's contents.

The links include tracking tags (`utm_...`) so EveryAction and the website can show which items people clicked. Don't remove them.

---

## What the problems and warnings mean

**Problems** must be fixed before you can publish. Fix them in the Google Sheet and load again, or leave that item out in step 2.

| Problem | What to do |
|---|---|
| has no headline / no one-sentence summary / no link | Fill in that column in the Sheet. |
| has a link that is not a secure web address | The link must start with `https://`. Open it in a browser and copy the address from the address bar. |
| Two items share the id | Each Sheet row needs its own id. Ask whoever looks after the Sheet. |
| No items are included | Tick **Include** on at least one item in step 2. |

**Warnings** are fine to publish with, but worth a look.

| Warning | What it means |
|---|---|
| summary of more than 160 characters | It will look long in the email. Try to trim it to one short sentence. |
| blurb of more than 150 words | Long blurbs are skimmed. Consider shortening. |
| has no image | It shows as a solid blue tile with the headline. That's fine; it just stands out less. |
| has an image but no alt text | Add a short description of the picture in the Sheet so people using screen readers know what it shows. |
| Only 1 or 2 items are included | Boards look best with at least 3. |
| There is no weekly summary yet | Write one in step 2. Without it, the board and email skip the "In summary…" section. |
| The weekly summary is more than 120 words | Try to keep it short; readers skim. |
| The weekly summary contains a web address | Links there show as plain text and aren't tracked. Put the link on an item instead. |
| An email address was removed | Someone put an address in a blurb. It was taken out automatically; check the wording still makes sense. |

### If something goes wrong
The builder explains what happened in plain words and **never throws away your arrangement**. Common messages:
- *You appear to be offline* / *couldn't reach the newsletter sheet*: check your internet connection and try again.
- *sent back something unexpected*: usually the access token is wrong or has expired. Ask the coordinator for a fresh one.
- *had a problem (error 500)*: the Google side had a hiccup. Wait a minute and try again.
- Publishing keeps failing: use **Download HTML** (step 4D) and paste it into WordPress yourself.

---

## Changing the settings (`config.js`)

All settings are in `config.js`. You can edit it right on GitHub: open the file, click the pencil icon, change the text between the quotes, then click **Commit changes**. The site updates within a few minutes.

| Setting | What it is |
|---|---|
| `APPS_SCRIPT_URL` | The address of the Google Apps Script web app (ends in `/exec`). Leave it blank to use sample data only. |
| `BOARD_BASE_URL` | Where newsletter issues live on the 350 website, e.g. `https://350seattle.org/newsletter/`. Only used for the email image link before you publish. |
| `FONT_BASE_URL` | Where the board's font files are hosted. Leave it as this site's `fonts/` address. |
| `REAL_FONTS` | Switches for the licensed brand fonts (see below). |

The board's colors and fonts are set at the top of `styles/board.css`.

---

## Putting the site online (GitHub Pages)

Only needed once, or if the site moves.

1. On GitHub, open the repository, then **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute or two the site is live at `https://<your-github-name>.github.io/NewsletterBuilder/`.
4. If that address differs from the one in `config.js` → `FONT_BASE_URL`, update it to `https://<your-github-name>.github.io/NewsletterBuilder/fonts/`.

If the WordPress site removes the `<style>` part of the board, paste the contents of `dist/board.css` into WordPress under **Appearance → Customize → Additional CSS** (one time only).

---

## Using the real brand fonts

The board uses the real header font, **Cal Sans** (free). The other two brand fonts are paid fonts, so free look-alikes stand in for them:

| Brand font | Used for | Stand-in now |
|---|---|---|
| New Kansas ExtraSwash | The italic "Newsletter" line | Fraunces Italic |
| ITC Avant Garde Gothic Pro Medium | Body text | Montserrat |

To use the real ones (only if 350's font license allows web use):
1. Get the fonts as `.woff2` web font files.
2. Name them exactly as below and put them in the **`fonts/`** folder:
   - `fonts/new-kansas-extraswash.woff2`
   - `fonts/itc-avant-garde-gothic-pro-medium.woff2`
3. In `config.js`, change `newKansas: false` and/or `avantGarde: false` to `true`.

---

## For whoever maintains this

Plain HTML, CSS and JavaScript: no framework, no build step, nothing loaded from other websites at run time.

| File | What it does |
|---|---|
| `index.html`, `app.js`, `styles/app.css` | The builder pages and behavior |
| `render-board.js` | Pure function: issue + items in, board HTML and CSS out (also UTM tagging, validation, email removal). Runs in the browser and in Node. |
| `styles/board.css` | The board's look; the single place for brand colors and fonts |
| `config.js` | Settings (no secrets) |
| `sample-data.json`, `samples/` | Demo data and placeholder images |
| `fonts/`, `vendor/` | Self-hosted fonts and html-to-image 1.11.11 (for the PNG), each with its license |
| `dist/` | Generated: `board.css` for WordPress and a sample board |
| `tests/` | Unit tests and browser acceptance checks |
| `reference/` | The process book, workflow deck, brand guide and images this is based on |

**The Apps Script contract:** every call is a `POST` to `APPS_SCRIPT_URL` with `Content-Type: text/plain` and a JSON body that includes the token. `{"action":"items"}` returns `{ok, issue, items}` (`issue.weekSummary` is optional; if present it pre-fills the weekly summary box); `{"action":"publish", slug, title, html}` returns `{ok, url, postId}`. On failure: `{ok:false, error}`.

### Running it on your own computer

The builder must be opened from a web address, not by double-clicking `index.html`. From the project folder:

```
python -m http.server 8000
```

Then open http://localhost:8000/?demo=1 (Node users can run `npx http-server -p 8000` instead).

### Tests

```
node tools/build-dist.js            # regenerate dist/ after changing board.css or config.js
node --test tests/                  # unit tests: board safety, UTM rules, no-console/no-storage rules
cd tests/e2e
npm install                         # once; dev-only (puppeteer-core, lighthouse)
node run.mjs                        # 10 browser acceptance checks, using installed Chrome
```

The browser checks write screenshots, the PNG and Lighthouse reports to `tests/e2e/output/` (not committed). Set `CHROME_PATH` if Chrome is somewhere unusual. Progress notes for ongoing work are in `PROGRESS.md`.
