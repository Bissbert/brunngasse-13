// Start der WebGL-Gasse. Läuft als klassisches Skript direkt nach dem öffnenden Tag von .weg,
// also bevor die Bilder darin gezeichnet werden: Der Besuch sieht nie die Bildergalerie aufblitzen.
// Mit WebGL 2: .weg wird zu .gweg, die Bühne steht leer in der Himmelsfarbe der Stimmung, bis haupt.js das erste 3D-Bild zeigt.
// Ohne WebGL 2, mit ?gl=0 oder bei einem Fehler: die schlichte Bildergalerie (wie ohne Skript).
// Reduzierte Bewegung: ebenfalls die 3D-Gasse, haupt.js setzt dann ctx.ruhig.
(function () {
  var q = new URLSearchParams(location.search);
  var weg = document.querySelector('.weg');
  if (!weg || q.get('gl') === '0' || !window.Promise) return;
  // Der Prüfkontext wird gleich mit den Eigenschaften angelegt, die haupt.js braucht, und weitergereicht:
  // Ein WebGL-Kontext kostet ohne Grafikkarte (Software-Darstellung) mehrere Sekunden, so nur einmal.
  // Gleiche Regel wie qualitaet() in haupt.js, soweit sie die Kantenglättung bestimmt ('tief' oder nicht).
  var stufe = q.get('q');
  if (stufe !== 'hoch' && stufe !== 'mittel' && stufe !== 'tief') {
    var grob = matchMedia('(pointer: coarse)').matches, kurz = Math.min(innerWidth, innerHeight);
    stufe = (innerWidth < 700 || (grob && kurz < 820)) ? 'tief' : 'anders';
  }
  var ok = false, t0 = performance.now(), c = null, gl = null;
  try {
    c = document.createElement('canvas');
    gl = c.getContext('webgl2', {
      failIfMajorPerformanceCaveat: q.get('gl') !== '1' && !q.has('fahrt'),
      alpha: false, depth: true, stencil: false, premultipliedAlpha: true, powerPreference: 'high-performance',
      antialias: stufe !== 'tief' || devicePixelRatio < 2, preserveDrawingBuffer: q.has('fahrt') || q.has('rollen'),
    });
    ok = !!gl;
  } catch (e) { ok = false; }
  window.__gasseStart = [Math.round(t0), Math.round(performance.now())];   // Messpunkt: Dauer der Prüfung
  if (!ok) return;
  window.__gasseKontext = { leinwand: c, gl: gl };
  weg.classList.remove('weg');
  weg.classList.add('gweg');
  if (q.has('fahrt')) weg.classList.add('gweg--pruef');

  // Leere Bühne in der Himmelsfarbe der Stimmung (gleiche Werte wie GRUND/WINTER in gemeinsam.js)
  var dunkel = document.documentElement.dataset.theme === 'dark';
  var s = q.get('schnee'), m = new Date().getMonth();
  var winter = s === '1' ? true : s === '0' ? false : (m === 11 || m <= 1);
  var H = winter
    ? (dunkel ? ['#0b1020', '#1c2638', '#3a4558'] : ['#7f93ad', '#a9b6c6', '#e3e7ec'])
    : (dunkel ? ['#03050c', '#0a1222', '#1a2538'] : ['#4f86cc', '#8db6e2', '#e6ecf0']);
  weg.style.setProperty('--gweg-grund', 'linear-gradient(180deg,' + H[0] + ' 0%,' + H[1] + ' 34%,' + H[2] + ' 62%,' + H[2] + ' 100%)');

  // Zurück zur schlichten Bildergalerie (wie ohne Skript), falls die 3D-Gasse nicht laden kann
  window.__gasseZurueck = function (grund) {
    weg.classList.remove('gweg', 'gweg--bereit', 'gweg--pruef');
    weg.classList.add('weg');
    weg.style.removeProperty('--gweg-grund');
    weg.setAttribute('data-fehler', String(grund || 'unbekannt'));
    var k = window.__gasseKontext; window.__gasseKontext = null;      // nicht übernommener Kontext: freigeben
    if (k) { try { var x = k.gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) {} }
    var alt = weg.querySelectorAll('.gweg__leinwand, .gweg__blende, .gweg__fehler');
    for (var i = 0; i < alt.length; i++) alt[i].remove();
  };

  // Alle Module gleich anfordern, damit sie parallel statt nacheinander laden
  var basis = document.currentScript ? document.currentScript.src.replace(/start\.js.*$/, '') : '../assets/gasse3d/';
  ['haupt', 'gemeinsam', 'buehne-welt', 'buehne-platzhalter', 'licht', 'fassaden', 'requisiten', '../vendor/three.module.min'].forEach(function (n) {
    var l = document.createElement('link'); l.rel = 'modulepreload'; l.href = basis + n + '.js'; document.head.appendChild(l);
  });
  import(basis + 'haupt.js').catch(function (e) { window.__gasseZurueck('haupt: ' + (e && e.message)); });
})();
