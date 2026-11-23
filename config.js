/*
 * Newsletter Builder settings. This file holds NO passwords or secrets.
 * See README.md, "Changing the settings".
 */
window.N350_CONFIG = {
  // The Google Apps Script web app address (ends in /exec).
  // Leave blank to use the sample data only.
  APPS_SCRIPT_URL: '',

  // Sign-in with a 350 Seattle Google account. The client ID is public
  // (it is not a password). Leave blank until it's set up; see README,
  // "One-time setup: signing in with 350 email".
  GOOGLE_CLIENT_ID: '',

  // Only accounts with this email domain can sign in.
  EMAIL_DOMAIN: '350seattle.org',

  // Google's sign-in address. Leave as is.
  GOOGLE_AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',

  // The newsletter Google Sheet, shown inside the builder so you can
  // review and approve blurbs without leaving it. Paste the Sheet's
  // normal address from the browser bar, e.g.
  //   https://docs.google.com/spreadsheets/d/1AbC.../edit#gid=0
  // Leave blank to show a placeholder. Do NOT use a "Publish to web"
  // link: that makes the whole Sheet, emails included, public.
  SHEET_URL: '',

  // Where published issues live on the WordPress site. The issue slug is
  // added to the end, e.g. https://350seattle.org/newsletter/2026-12/
  // Only used for the email image link before you publish; after
  // publishing, the builder uses the address WordPress sends back.
  BOARD_BASE_URL: 'https://350seattle.org/newsletter/',

  // Where the board's font files are hosted (this site's fonts/ folder).
  // Published boards load fonts from here, so it must be a full https
  // address. Blank = the fonts/ folder next to this page.
  FONT_BASE_URL: 'https://350seattle.github.io/Newsletter/fonts/',

  // Switch to true after adding the licensed font files to fonts/
  // (see README.md, "Using the real brand fonts").
  REAL_FONTS: {
    newKansas: false,  // fonts/new-kansas-extraswash.woff2
    avantGarde: false  // fonts/itc-avant-garde-gothic-pro-medium.woff2
  }
};
