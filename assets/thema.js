/* Thema: folgt dem System, bis der Besuch selbst umschaltet. Die Wahl bleibt in diesem Browser. */
(function () {
  var SCHLUESSEL = 'bergmann-thema';
  var wurzel = document.documentElement;
  var mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function gespeichert() { try { return localStorage.getItem(SCHLUESSEL); } catch (e) { return null; } }
  function merken(w) { try { localStorage.setItem(SCHLUESSEL, w); } catch (e) {} }
  var q = /[?&]thema=(nacht|tag)/.exec(location.search);
  function wunsch() {
    if (q) return q[1] === 'nacht' ? 'dark' : 'light';
    var g = gespeichert();
    if (g === 'dark' || g === 'light') return g;
    return mq && mq.matches ? 'dark' : 'light';
  }
  function setzen(t, weich) {
    if (weich && !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      wurzel.classList.add('thema-wechsel');
      setTimeout(function () { wurzel.classList.remove('thema-wechsel'); }, 450);
    }
    wurzel.dataset.theme = t;
    var k = document.querySelector('.themaknopf');
    if (k) {
      var nacht = t === 'dark';
      k.setAttribute('aria-pressed', nacht ? 'true' : 'false');
      k.title = nacht ? 'Zur Tagansicht wechseln' : 'Zur Nachtansicht wechseln';
    }
    document.dispatchEvent(new CustomEvent('thema', { detail: { thema: t } }));
  }
  setzen(wunsch(), false);
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!q && !gespeichert()) setzen(wunsch(), true); });
  document.addEventListener('DOMContentLoaded', function () {
    var k = document.querySelector('.themaknopf');
    if (!k) return;
    k.hidden = false;
    setzen(wurzel.dataset.theme, false);
    k.addEventListener('click', function () {
      var neu = wurzel.dataset.theme === 'dark' ? 'light' : 'dark';
      q = null; merken(neu); setzen(neu, true);
    });
  });
})();
