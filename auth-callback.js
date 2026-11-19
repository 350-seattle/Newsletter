/*
 * Google sends the sign-in result to this page (in the part of the
 * address after #). It passes the result straight to the builder tab,
 * wipes it from this window's address, and closes. Nothing is stored
 * or logged.
 */
(function () {
  'use strict';
  var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  var msg = {
    type: 'n350-auth',
    state: params.get('state') || '',
    idToken: params.get('id_token') || '',
    error: params.get('error') || ''
  };
  window.history.replaceState(null, '', window.location.pathname);

  // Google's sign-in pages can cut the link back to the builder tab, so
  // send the result two ways; the builder uses whichever arrives first.
  try {
    var channel = new BroadcastChannel('n350-auth');
    channel.postMessage(msg);
    channel.close();
  } catch (e) { /* older browser */ }
  try {
    if (window.opener) window.opener.postMessage(msg, window.location.origin);
  } catch (e) { /* tab was closed */ }

  document.getElementById('status').textContent = msg.idToken
    ? 'Signed in. You can close this window.'
    : 'Sign-in didn\'t finish. Close this window and try again.';
  window.setTimeout(function () { window.close(); }, 400);
})();
