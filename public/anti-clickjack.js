// Clickjacking fallback. Lovable hosting cannot send X-Frame-Options / CSP frame-ancestors headers, so the app
// hides itself when it is framed by an origin that is not on this allow-list. Top-level pages are never affected,
// and if this file fails to load the app simply behaves as before (fail-open for availability).
(function () {
  try {
    if (window.top === window.self) return;
    var allowed = /^https:\/\/([a-z0-9-]+\.)*(lovable\.dev|lovable\.app|lovableproject\.com|aisapsupportnow\.com|aisupport360\.com)$/i;
    var parents = [];
    var ancestors = window.location.ancestorOrigins;
    if (ancestors && ancestors.length) {
      for (var i = 0; i < ancestors.length; i++) parents.push(ancestors[i]);
    } else if (document.referrer) {
      parents.push(new URL(document.referrer).origin);
    }
    var ok = parents.length > 0 && parents.every(function (o) { return allowed.test(o); });
    if (!ok) document.documentElement.style.setProperty('display', 'none', 'important');
  } catch (e) {
    document.documentElement.style.setProperty('display', 'none', 'important');
  }
})();
