/*
 * Newsletter Builder settings. This file holds NO passwords or secrets.
 * See README.md, "Changing the settings".
 */
window.N350_CONFIG = {
  // The Google Apps Script web app address (ends in /exec).
  // Leave blank to use the sample data only.
  APPS_SCRIPT_URL: '',

  // Where published issues live on the WordPress site. The issue slug is
  // added to the end, e.g. https://350seattle.org/newsletter/2026-12/
  // Only used for the email image link before you publish; after
  // publishing, the builder uses the address WordPress sends back.
  BOARD_BASE_URL: 'https://350seattle.org/newsletter/',

  // Where the board's font files are hosted (this site's fonts/ folder).
  // Published boards load fonts from here, so it must be a full https
  // address. Blank = the fonts/ folder next to this page.
  FONT_BASE_URL: 'https://cody-trinkaus.github.io/NewsletterBuilder/fonts/',

  // Switch to true after adding the licensed font files to fonts/
  // (see README.md, "Using the real brand fonts").
  REAL_FONTS: {
    newKansas: false,  // fonts/new-kansas-extraswash.woff2
    avantGarde: false  // fonts/itc-avant-garde-gothic-pro-medium.woff2
  }
};
