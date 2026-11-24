// Bühne der WebGL-Gasse: Renderer, Kamera, Fahrt die Brunngasse hinauf bis vor die Nummer 13,
// Layout der Häuser und Laternen, Ablauf der Module, Themawechsel, Qualitätsstufen.
// Vertrag: stimmung/VERTRAG.md. Gestartet von start.js (mit WebGL 2; bei reduzierter Bewegung ruhig).
// Die Gasse baut sich in vier Stufen auf (Abschnitt «Gestaffeltes Laden» im Vertrag):
//   1 schlichte Materialien, Grundlicht, Nebel (erstes Bild)  2 eigene Shader, im Hintergrund kompiliert
//   3 Texturen nah → fern, dann die Schritte der Module       4 Nachbearbeitung und feine Details
import { THREE, stimmung, istWinter, zufall, pxFuer, STRASSE, freigeben } from './gemeinsam.js';
import * as welt from './buehne-welt.js';
import * as platz from './buehne-platzhalter.js';

// start.js lädt dieses Modul schon während die Seite noch gelesen wird
const zeitHaupt = Math.round(performance.now());                   // Messpunkte für __gasse.protokoll
if (document.readyState === 'loading') await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
const Q = new URLSearchParams(location.search);
const PRUEF = Q.has('fahrt');                                   // Prüfmodus für Stillbilder
const weg = document.querySelector('.gweg');
const buehne = weg.querySelector('.weg__buehne');
const hinweis = weg.querySelector('.weg__hinweis');
const kopf = document.querySelector('.kopf');
const BASIS = new URL('../', import.meta.url).href;               // site/assets/
const { BREITE, ENDE } = STRASSE;

// ---------- Fehler sichtbar machen (für alle Module) ----------
const fehler = [];
function melden(wer, e) {
  const text = wer + ': ' + (e && e.message ? e.message : e);
  fehler.push(text); console.error('[gasse3d]', text, e);
  weg.setAttribute('data-fehler', fehler.join(' | '));
  if (PRUEF) {
    let p = weg.querySelector('.gweg__fehler');
    if (!p) { p = document.createElement('p'); p.className = 'gweg__fehler'; buehne.appendChild(p); }
    p.textContent = fehler.join(' · ');
  }
}

// ---------- Qualität ----------
function qualitaet() {
  const w = Q.get('q'); if (w === 'hoch' || w === 'mittel' || w === 'tief') return w;
  const grob = matchMedia('(pointer: coarse)').matches, kurz = Math.min(innerWidth, innerHeight);
  if (innerWidth < 700 || (grob && kurz < 820)) return 'tief';
  if (innerWidth >= 1100 && !grob && (navigator.hardwareConcurrency || 4) >= 4 && (navigator.deviceMemory || 8) >= 4) return 'hoch';
  return 'mittel';
}
const q = qualitaet();
const PR_MAX = { hoch: 2, mittel: 1.5, tief: 1.5 }[q];
let pr = PR_MAX;
const ruhig = Q.get('ruhig') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Layout der Gasse: Häuserzeilen und Laternen (immer gleich, mit Samen) ----------
const PUTZ = ['#e9e2d4', '#e3cfa6', '#dcc3bd', '#d9d1c2', '#cdb79a', '#e6dccb', '#c9b9a8', '#e8d9b8', '#d6cbbd'];
const LADENFARBEN = ['#3f5a55', '#7d2e2e', '#556b4f', '#6b4a35', '#3b4a5c', '#8a7a5c'];
const ANFANG = 16;                                               // Gasse beginnt hinter der Kamera
function layout() {
  const haeuser = [];
  for (const seite of [-1, 1]) {
    const r = zufall(seite < 0 ? 11 : 23);
    let z = ANFANG, i = 0, vorher = -1;
    while (z > ENDE + 0.5) {
      let b = 5.2 + r() * 4.2;
      if (z - b < ENDE + 3.5) b = z - ENDE;                       // letztes Haus reicht genau bis ENDE
      let putz; do { putz = Math.floor(r() * PUTZ.length); } while (putz === vorher); vorher = putz;
      const eg = 3.9 + r() * 0.7;
      const hoehe = Math.min(15, eg + 1.2 + 3 * (2 + Math.floor(r() * 2.6)) + 0.3 + r() * 0.6);
      haeuser.push({
        seite, z0: z, z1: z - b, breite: b, hoehe, eg, stock: Math.floor((hoehe - eg - 1.2) / 3),
        x: seite * BREITE / 2, seed: (seite < 0 ? 1000 : 2000) + i * 37,
        putz: PUTZ[putz], laden: LADENFARBEN[Math.floor(r() * LADENFARBEN.length)],
      });
      z -= b; i++;
    }
  }
  // Laternen an den Wänden, abwechselnd, nicht direkt vor der Kamera und nicht vor der 13
  const lampen = [];
  let s = -1;
  for (let z = -3.5; z > ENDE + 5; z -= 7.6) { lampen.push({ x: s * (BREITE / 2 - 0.55), y: 4.3, z, seite: s }); s = -s; }
  return { haeuser, lampen };
}
const LAYOUT = layout();
const NR13 = { x: 0, z: ENDE, breite: 8.6, hoehe: 13.5, eg: 5.0 };

// ---------- Renderer, Leinwand, Überblendung ----------
// Den Kontext aus start.js übernehmen, wenn er passt (spart einen zweiten Kontext), sonst freigeben und neu anlegen
const GL_WUNSCH = { antialias: q !== 'tief' || devicePixelRatio < 2, preserveDrawingBuffer: PRUEF || Q.has('rollen') };
let glVor = window.__gasseKontext || null;
window.__gasseKontext = null;
if (glVor) {
  let a = null;
  try { a = !glVor.gl.isContextLost() && glVor.gl.getContextAttributes(); } catch (e) { a = null; }
  if (!a || a.antialias !== GL_WUNSCH.antialias || a.preserveDrawingBuffer !== GL_WUNSCH.preserveDrawingBuffer || a.alpha || a.stencil) {
    try { const ext = glVor.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) {}
    glVor = null;
  }
}
const leinwand = glVor ? glVor.leinwand : document.createElement('canvas');
leinwand.className = 'gweg__leinwand';
leinwand.setAttribute('aria-hidden', 'true');
buehne.prepend(leinwand);
const blende = document.createElement('canvas');
blende.className = 'gweg__blende';
blende.setAttribute('aria-hidden', 'true');
buehne.insertBefore(blende, leinwand.nextSibling);

const zeitDcl = Math.round(performance.now());
const renderer = new THREE.WebGLRenderer({ canvas: leinwand, context: glVor ? glVor.gl : undefined, antialias: q !== 'tief' || devicePixelRatio < 2, powerPreference: 'high-performance', preserveDrawingBuffer: PRUEF || Q.has('rollen') });
renderer.outputColorSpace = THREE.SRGBColorSpace;
const zeitRenderer = Math.round(performance.now());
const lader = new THREE.TextureLoader();
const kamera = new THREE.PerspectiveCamera(46, 1, 0.1, 400);
let szene = new THREE.Scene();

// ---------- Module laden, jedes für sich (ein Fehler in einem Modul legt die Bühne nicht lahm) ----------
async function laden(name) {
  try { return await import('./' + name + '.js'); } catch (e) { melden(name + ' (laden)', e); return null; }
}
const [mLicht, mFassaden, mRequisiten] = await Promise.all([laden('licht'), laden('fassaden'), laden('requisiten')]);

// ---------- Fahrt ----------
let ziel = 0, jetzt = 0, B = 1, H = 1;
const festeFahrt = PRUEF ? Math.max(0, Math.min(1, parseFloat(Q.get('fahrt')) || 0)) : null;
function fortschritt() {
  if (festeFahrt !== null) return festeFahrt;
  const r = weg.getBoundingClientRect(), weit = weg.offsetHeight - buehne.offsetHeight;
  return weit > 0 ? Math.max(0, Math.min(1, -r.top / weit)) : 0;
}
const glatt = x => x * x * (3 - 2 * x);
const ziel3 = new THREE.Vector3();
function kameraSetzen(p) {
  const schmal = B < H * 0.9;
  const fov = schmal ? 60 : 46;
  if (kamera.fov !== fov) { kamera.fov = fov; kamera.updateProjectionMatrix(); }
  const z0 = 7, z1 = ENDE + (schmal ? Math.min(19, 4.9 / Math.tan(Math.atan(Math.tan(fov * Math.PI / 360) * B / H))) : 10.5);   // hochkant: ganze Ladenfront im Bild
  const e = glatt(p) * 0.35 + p * 0.65;                           // weich anfahren, gleichmässig gehen
  const z = z0 + (z1 - z0) * e;
  const gehen = ruhig ? 0 : Math.sin((z0 - z) * 2.3) * 0.022 * (1 - p * p);   // ganz leises Auf und Ab der Schritte
  // hochkant weniger: die Aushänge stehen dort näher zur Mitte. Sie werden nur einmal gebaut, darum gilt das auch nach dem Drehen ins Querformat.
  const x = Math.sin(p * Math.PI * 1.4) * (schmal || (ctx && ctx.aushaengeSchmal) ? 0.15 : 0.35) * (1 - p);
  kamera.position.set(x, (schmal ? 1.85 : 2.05) + gehen, z);
  ziel3.set(x * 0.3, (schmal ? 4.6 : 4.9) - glatt(p) * (schmal ? 1.55 : 1.85), ENDE);
  kamera.lookAt(ziel3);
  ctx && (ctx.fahrt = p);
  if (PRUEF) weg.dataset.kamera = [B, H, kamera.fov, z.toFixed(2)].join(' ');
}

// ---------- Aufbau der Szene ----------
let ctx = null, teile = [], thema = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
const anzahl = () => szene.children.length;

function teil(name, fn, platzhalter, pruefen) {
  let h = null, vor = anzahl(), fogVor = szene.fog, bgVor = szene.background;
  if (fn) { try { h = messe(name + '.bauen', () => fn(ctx)); } catch (e) { melden(name + '.bauen', e); h = null; } }
  const geliefert = h && (anzahl() > vor || (pruefen && (szene.fog !== fogVor || szene.background !== bgVor)));
  if (!geliefert && platzhalter) {
    if (h) { try { h.entsorgen?.(); } catch (e) { melden(name + '.entsorgen', e); } }
    try { h = platzhalter(ctx); h.platzhalter = true; } catch (e) { melden(name + ' (Platzhalter)', e); h = null; }
  }
  if (h) { h.name = name; h.kinder = szene.children.slice(vor); teile.push(h); }
  return h;
}

// ---------- Gestaffeltes Laden (Vertrag, Abschnitt «Gestaffeltes Laden») ----------
// Stufe 1: alle Module bauen, gezeichnet wird mit schlichten Ersatzmaterialien (ohne Texturen), Grundlicht, Nebel.
// Stufe 2: die echten Materialien werden im Hintergrund kompiliert und eingesetzt, soweit sie keine neuen Texturen brauchen.
// Stufe 3: Texturen von nah nach fern hochladen, danach die Schritte stufen[3] der Module.
// Stufe 4: stufen[4] der Module, Nachbearbeitung (zeichnen) und alles Übrige.
// Jeder Tausch wird überblendet. Zwischen den Arbeiten gibt haupt.js den Hauptfaden frei.
// ?stufe=1..4 hält den Aufbau nach dieser Stufe an (Prüfbilder).
const ZIEL = Math.max(1, Math.min(4, parseInt(Q.get('stufe'), 10) || 4));
const KHR = renderer.extensions.has('KHR_parallel_shader_compile');
weg.dataset.khr = KHR ? 'ja' : 'nein';
const ABBRUCH = new Error('abgebrochen');                         // Themawechsel oder Abbau: offene Schritte verfallen
let gen = 0, stufe = 0, zeichnenAn = false, alleEcht = false, blendeHaelt = false;
let einfachVorrat = new Map(), echt = new Set(), kompiliert = new Set(), tauschListe = null, himmel = null;
let stufenZeiten = [], programme = [], letzteRast = 0;
const vorbei = g => g !== gen;
// Protokoll: jeder Arbeitsschritt über 40 ms (Name, Dauer, Zeitpunkt), lesbar über __gasse.protokoll
const protokoll = ['webgl-pruefung ' + (window.__gasseStart || []).join('–') + (glVor ? ' (übernommen)' : ' (neu angelegt)'), 'haupt @' + zeitHaupt, 'seite gelesen @' + zeitDcl, 'renderer @' + zeitRenderer, 'module @' + Math.round(performance.now())];
function messe(name, fn) { const a = performance.now(); try { return fn(); } finally { const d = performance.now() - a; if (d > 40) protokoll.push(name + ' ' + Math.round(d) + '@' + Math.round(a)); } }
const freigabe = () => (window.scheduler && scheduler.yield) ? scheduler.yield() : new Promise(r => setTimeout(r, 0));
// Gibt den Hauptfaden frei, sobald seit der letzten Pause 30 ms vergangen sind (immer: sofort)
async function rast(g, immer) {
  if (immer || performance.now() - letzteRast > 30) { await freigabe(); letzteRast = performance.now(); }
  if (vorbei(g)) throw ABBRUCH;
}
const warten = (ms, g) => new Promise((r, f) => setTimeout(() => vorbei(g) ? f(ABBRUCH) : r(), ms));

// Schlichte Ersatzmaterialien für Stufe 1: gleiche Grundfarbe (mal Mittelwert der Farbkarte), keine Texturen, keine eigenen Shader.
// ShaderMaterial erscheint nur mit userData.grundfarbe (dann einfarbig), Punkte, Linien und Sprites bleiben bis dahin weg.
const UNSICHTBAR = new THREE.MeshBasicMaterial({ visible: false });
const GLEICH = ['transparent', 'opacity', 'side', 'fog', 'vertexColors', 'alphaTest', 'depthWrite', 'depthTest', 'blending', 'toneMapped',
  'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'flatShading', 'premultipliedAlpha', 'colorWrite'];
const mittelVorrat = new WeakMap();
const klein = document.createElement('canvas'); klein.width = klein.height = 8;
const kleinG = klein.getContext('2d', { willReadFrequently: true });
function mittelfarbe(t) {
  if (mittelVorrat.has(t)) return mittelVorrat.get(t);
  const i = t.image;
  const ok = i && ((i instanceof HTMLCanvasElement) || (i instanceof HTMLImageElement && i.complete && i.naturalWidth) || (window.ImageBitmap && i instanceof ImageBitmap));
  if (!ok) return null;                                          // Bild noch nicht da: später nochmals
  let c = null;
  try {
    kleinG.clearRect(0, 0, 8, 8); kleinG.drawImage(i, 0, 0, 8, 8);
    const d = kleinG.getImageData(0, 0, 8, 8).data, srgb = t.colorSpace === THREE.SRGBColorSpace;
    const lin = v => srgb ? THREE.MathUtils.clamp(v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4), 0, 1) : v;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let j = 0; j < d.length; j += 4) { const a = d[j + 3] / 255; r += lin(d[j] / 255) * a; gg += lin(d[j + 1] / 255) * a; b += lin(d[j + 2] / 255) * a; n += a; }
    if (n > 0) c = new THREE.Color(r / n, gg / n, b / n);           // linear gemittelt, wie es die Mipmaps aus der Ferne zeigen
  } catch (e) { c = null; }
  mittelVorrat.set(t, c);
  return c;
}
const GRAU = new THREE.Color(0.32, 0.32, 0.32);
const erzeugt = new WeakSet();                                    // selbst erzeugte Ersatzmaterialien bleiben, wie sie sind
function einfach(m) {
  if (!m || m === UNSICHTBAR || erzeugt.has(m)) return m;
  let e = einfachVorrat.get(m);
  if (e !== undefined) return e;
  const gf = m.userData && m.userData.grundfarbe;
  e = null;
  if (m.isShaderMaterial || m.isRawShaderMaterial) { if (gf != null) e = new THREE.MeshBasicMaterial({ color: gf }); }
  else if (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial) {
    // Lambert: viel kleinerer Shader als Standard, matte Flächen sehen fast gleich aus
    e = new THREE.MeshLambertMaterial(); e.emissive.copy(m.emissive); e.emissiveIntensity = m.emissiveIntensity;
  } else if (m.isMeshBasicMaterial) e = new THREE.MeshBasicMaterial();
  else if (m.isPointsMaterial || m.isLineBasicMaterial || m.isSpriteMaterial || m.isMeshMatcapMaterial) e = null;
  else e = m;                                                     // alles andere bleibt, wie es ist
  if (e && e !== m) {
    for (const k of GLEICH) if (k in m && k in e) e[k] = m[k];
    if (e.color && gf == null && m.color) e.color.copy(m.color);
    // Die Farbkarte bleibt, wo sie die Form schneidet (alphaTest, Transparenz) oder ein Modul eine kleine Vorschau
    // dafür vorsieht (userData.einfachKarte, z. B. Pflaster und Aushänge); sonst zählt ihr Mittelwert
    if (m.map && (m.alphaTest > 0 || m.transparent || (m.userData && m.userData.einfachKarte))) e.map = m.map;
    else if (m.map && e.color && gf == null) e.color.multiply(mittelfarbe(m.map) || GRAU);
    if (m.alphaMap) e.alphaMap = m.alphaMap;
    if (m.emissiveMap && e.emissive && e.map === m.emissiveMap) e.emissiveMap = m.emissiveMap;      // Vorschau leuchtet wie später
    else if (m.emissiveMap && e.emissive) e.emissive.multiply(mittelfarbe(m.emissiveMap) || GRAU);
    e.name = (m.name || m.type) + ' (einfach)';
    erzeugt.add(e);
  }
  if (!m.map || (e && e.map === m.map) || mittelVorrat.has(m.map)) einfachVorrat.set(m, e);    // mit nicht geladener Karte später neu bestimmen
  return e;
}
// Himmel als flacher Verlauf, solange der eigene Himmel (ShaderMaterial) noch fehlt: gleiche Farben wie die leere Bühne
function verlauf(T) { return `linear-gradient(180deg,${T.zenit} 0%,${T.mitte} 34%,${T.horizont} 62%,${T.horizont} 100%)`; }
function himmelBild(T) {
  const c = document.createElement('canvas'); c.width = 2; c.height = 64;
  const k = c.getContext('2d'), v = k.createLinearGradient(0, 0, 0, 64);
  v.addColorStop(0, T.zenit); v.addColorStop(0.34, T.mitte); v.addColorStop(0.62, T.horizont); v.addColorStop(1, T.horizont);
  k.fillStyle = v; k.fillRect(0, 0, 2, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// Zeichnet mit Ersatz für alle Materialien, die noch nicht echt sind. Die Originale bleiben an den Objekten, ausser während des Zeichnens.
function mitEinfachen(fn) {
  if (alleEcht) return fn();
  if (!tauschListe) { tauschListe = []; szene.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.material) tauschListe.push(o); }); }
  const alt = [];
  for (const o of tauschListe) {
    const m = o.material;
    if (Array.isArray(m)) {
      let neu = null;
      for (let i = 0; i < m.length; i++) { if (echt.has(m[i])) continue; const e = einfach(m[i]) || UNSICHTBAR; if (e !== m[i]) { neu = neu || m.slice(); neu[i] = e; } }
      if (neu) { alt.push(o, m); o.material = neu; }
    } else if (!echt.has(m)) { const e = einfach(m) || UNSICHTBAR; if (e !== m) { alt.push(o, m); o.material = e; } }
  }
  const bg = szene.background;
  if (!bg && himmel) szene.background = himmel;
  try { fn(); } finally { for (let i = 0; i < alt.length; i += 2) alt[i].material = alt[i + 1]; szene.background = bg; }
}

// Texturen eines Materials und ob sie schon auf der GPU sind
function texturen(m) {
  const l = [];
  for (const k in m) { const v = m[k]; if (v && v.isTexture) l.push(v); }
  if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) l.push(v); }
  return l;
}
function geladen(t) {
  if (t.isRenderTargetTexture || t.isFramebufferTexture) return true;
  if (!t.version) return false;
  return renderer.properties.get(t).__version === t.version;
}
async function hochladen(liste, g) {
  for (const t of [].concat(liste)) {
    if (!t || !t.isTexture || geladen(t) || !t.version) continue;
    try { renderer.initTexture(t); } catch (e) { melden('hochladen', e); }
    await rast(g);
  }
}

// Kompiliert die echten Materialien der Objekte (je einmal, für den Bildschirm und für Renderziele wie Bloom und Spiegelung).
// Ohne KHR_parallel_shader_compile blockiert das Binden: dann ein Material pro Zeitschlitz.
const rtSonde = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
// ersatz: statt der Materialien ihre Ersatzmaterialien aus Stufe 1 (für das erste Bild, damit es nicht alle Programme auf einmal bindet)
async function kompilieren(objekte, g, alle, ersatz) {
  const vertreter = new Map();
  for (const w of [].concat(objekte)) {
    if (!w || !w.traverse) continue;
    w.traverse(o => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material) return;
      for (let m of [].concat(o.material)) {
        if (ersatz) { if (!m || echt.has(m)) continue; m = einfach(m); if (!m || m === UNSICHTBAR) continue; }
        if (m && (alle || !kompiliert.has(m)) && !vertreter.has(m)) vertreter.set(m, o);
      }
    });
  }
  const fertig = new Set();
  if (!vertreter.size) return fertig;
  // Programmvariante wie beim Zeichnen: über das Ziel eines Moduls (ctx.kompilierZiel, kein Tonemapping) oder direkt auf den Bildschirm
  const post = teile.find(t => t.zeichnen), ziel = (ctx && ctx.kompilierZiel) || rtSonde;
  const mitRT = !!post, mitSchirm = !post || !post.stufen;            // ein Modul ohne stufen zeichnet erst ab Stufe 4 selbst
  for (const [m, o] of vertreter) {
    if (fertig.has(m)) continue;
    // Eigene Kinder (z. B. Lichter an einer Laterne) würden doppelt gezählt: dann eine Kopie ohne Kinder
    let s = o;
    if (o.children.length || ersatz) { try { s = o.clone(false); } catch (e) { s = o; } }
    if (ersatz) { if (s === o) continue; s.material = m; }
    const vorher = (renderer.info.programs || []).length;
    try {
      messe('compile ' + (m.name || m.type), () => {
        if (mitSchirm) for (const x of renderer.compile(s, kamera, szene)) fertig.add(x);
        if (mitRT) { const vor = renderer.getRenderTarget(); renderer.setRenderTarget(ziel); try { for (const x of renderer.compile(s, kamera, szene)) fertig.add(x); } finally { renderer.setRenderTarget(vor); } }
      });
    } catch (e) { melden('kompilieren ' + (m.name || m.type), e); }
    fertig.add(m);
    if (!KHR) {
      await binden(g);                                             // ohne paralleles Kompilieren: jedes neue Programm in eigenem Schlitz
      // Software-Grafik (SwiftShader) übersetzt den Shader erst beim ersten Zeichnen noch einmal: einmal winzig vorzeichnen
      // Zusätzliche Ziele eines Moduls (z. B. die Spiegelung von licht) haben einen eigenen Zustand: dort ebenfalls
      const neu = (renderer.info.programs || []).length > vorher;
      let erledigt = vorgezeichnet.get(m);
      if (!erledigt || neu) vorgezeichnet.set(m, erledigt = new Set());
      const ziele = !mitRT || !ctx ? [] : [ctx.kompilierZiel].concat(Array.isArray(ctx.kompilierZiele) ? ctx.kompilierZiele : [])
        .filter(z => z && z.isRenderTarget && !erledigt.has(z));
      const kopie = ziele.length && (s === o ? o.clone(false) : s);
      for (const z of ziele) {
        await rast(g, true);
        messe('vorzeichnen ' + (m.name || m.type), () => vorzeichnen(kopie, z));
        erledigt.add(z);
      }
    }
    await rast(g);
  }
  if (KHR) await binden(g);
  if (!ersatz) for (const m of fertig) kompiliert.add(m);
  return fertig;
}
// Ein Objekt allein in einen Bildpunkt des Ziels zeichnen (eigene Ebene 31, die Lichter der Szene zählen mit, damit der Programmschlüssel gleich bleibt).
// Das Ziel wird beim nächsten echten Bild ohnehin neu gezeichnet; der Bildschirm bleibt unberührt.
const vorgezeichnet = new WeakMap();                              // Material → Ziele, in die es schon gezeichnet wurde
function vorzeichnen(s, ziel) {
  const lichter = [];
  szene.traverse(o => { if (o.isLight) { lichter.push(o, o.layers.mask); o.layers.enable(31); } });
  const km = kamera.layers.mask, vp = ziel.viewport.clone(), sc = ziel.scissor.clone(), st = ziel.scissorTest, vor = renderer.getRenderTarget();
  s.layers.set(31); s.frustumCulled = false; szene.add(s);           // die Kopie liegt ohne Eltern evtl. anderswo: nie wegschneiden
  try {
    kamera.layers.set(31);
    ziel.viewport.set(0, 0, 1, 1); ziel.scissor.set(0, 0, 1, 1); ziel.scissorTest = true;
    renderer.setRenderTarget(ziel);
    renderer.render(szene, kamera);
  } catch (e) { melden('vorzeichnen', e); }
  finally {
    szene.remove(s); kamera.layers.mask = km;
    for (let i = 0; i < lichter.length; i += 2) lichter[i].layers.mask = lichter[i + 1];
    ziel.viewport.copy(vp); ziel.scissor.copy(sc); ziel.scissorTest = st;
    renderer.setRenderTarget(vor);
  }
}
// Neue Programme fertig binden (erste Benutzung wartet sonst beim nächsten Bild). Mit KHR erst, wenn sie bereit sind.
const gebunden = new Set();
async function binden(g) {
  for (const p of renderer.info.programs || []) {
    if (gebunden.has(p)) continue;
    if (KHR && p.isReady) {
      await new Promise((r, f) => { const pruefen = () => vorbei(g) ? f(ABBRUCH) : p.isReady() ? r() : setTimeout(pruefen, 10); pruefen(); });
    }
    messe('binden ' + (p.name || p.id), () => { try { p.getUniforms(); } catch (e) {} });
    gebunden.add(p);
    await rast(g, !KHR);
  }
}
// Für Module: was ein Modul selbst kompiliert, tauscht es auch selbst ein. Diese Materialien gelten danach als echt
// (Texturen vorher hochgeladen), haupt.js zeichnet sie also nicht noch einmal mit Ersatz.
async function kompilierenFuerModul(objekte, g) {
  const mats = await kompilieren(objekte, g);
  for (const w of [].concat(objekte)) if (w && w.traverse) w.traverse(o => { for (const m of [].concat(o.material || [])) if (m && kompiliert.has(m)) mats.add(m); });
  for (const m of mats) { await hochladen(texturen(m), g); echt.add(m); }
  tauschListe = null;
}

// Reihenfolge nah → fern: sichtbare Materialien nach Abstand zur Kamera, unsichtbare zuletzt
const fr = new THREE.Frustum(), frM = new THREE.Matrix4(), kugel = new THREE.Sphere();
function reihenfolge() {
  kamera.updateMatrixWorld(); szene.updateMatrixWorld();
  fr.setFromProjectionMatrix(frM.multiplyMatrices(kamera.projectionMatrix, kamera.matrixWorldInverse));
  const abst = new Map();
  szene.traverse(o => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material) return;
    let d = 5000;
    try {
      if (o.isInstancedMesh) { o.boundingSphere || o.computeBoundingSphere(); kugel.copy(o.boundingSphere); }
      else { const gm = o.geometry; gm.boundingSphere || gm.computeBoundingSphere(); kugel.copy(gm.boundingSphere); }
      kugel.applyMatrix4(o.matrixWorld);
      d = Math.max(0, kugel.center.distanceTo(kamera.position) - kugel.radius) + (fr.intersectsSphere(kugel) ? 0 : 1000);
    } catch (e) {}
    for (const m of [].concat(o.material)) if (!(abst.get(m) <= d)) abst.set(m, d);
  });
  return [...abst].sort((a, b) => a[1] - b[1]).map(x => x[0]);
}
// Lädt die Texturen der noch schlichten Materialien hoch (nah zuerst) und schaltet fertige Materialien echt, in überblendeten Gruppen
let letzterTausch = 0;
async function hochladenRunde(g) {
  let neu = [], offen = 0;
  const schalten = () => { const l = neu; neu = []; if (l.length) { ueberblenden(() => { for (const m of l) echt.add(m); }); letzterTausch = performance.now(); } };
  for (const m of reihenfolge()) {
    if (echt.has(m) || m === UNSICHTBAR) continue;
    if (!kompiliert.has(m)) { offen++; continue; }
    let ok = true;
    for (const t of texturen(m)) {
      if (geladen(t)) continue;
      if (!t.version) { ok = false; continue; }                  // Bild lädt noch
      try { messe('textur ' + ((t.image && t.image.width) || '?') + 'x' + ((t.image && t.image.height) || '?'), () => renderer.initTexture(t)); } catch (e) { melden('hochladen', e); }
      if (!geladen(t)) ok = false;
      await rast(g);
    }
    if (ok) neu.push(m); else offen++;
    if (neu.length && performance.now() - letzterTausch > 700) schalten();
  }
  schalten();
  return offen;
}

// Weicher Tausch: altes Bild auf die Blende, ändern, neues Bild zeichnen, Blende ausblenden (nicht im Prüfmodus)
function ueberblenden(aenderung) {
  const weich = !PRUEF && sichtbar && stufe >= 1 && !blendeHaelt && weg.classList.contains('gweg--bereit');
  if (weich) {
    kameraSetzen(jetzt); zeichnen();
    const k = blende.getContext('2d'); k.clearRect(0, 0, blende.width, blende.height); k.drawImage(leinwand, 0, 0, blende.width, blende.height);
    blende.style.transition = 'none'; blende.style.opacity = '1';
  }
  aenderung();
  if (weich) {
    kameraSetzen(jetzt); zeichnen();
    requestAnimationFrame(() => requestAnimationFrame(() => { blende.style.transition = ''; blende.style.opacity = '0'; }));
  }
  malen();
}

// Ein Schritt eines Moduls (stufen[3] oder stufen[4]); höchstens 20 s, danach geht es ohne ihn weiter
let halten = false;                                                 // während ein Modulschritt neue Programme braucht: altes Bild stehen lassen
async function schritt(h, fn, g, n) {
  halten = true;
  try {
    let uhr = 0;
    const r = await Promise.race([Promise.resolve().then(() => messe(h.name + '.stufe', () => fn(ctx))), new Promise(r2 => { uhr = setTimeout(() => r2('zeit'), 20000); })]);
    clearTimeout(uhr);
    if (r === 'zeit') melden(h.name + '.stufen', 'Schritt nach 20 s übersprungen');
    if (vorbei(g)) throw ABBRUCH;
    tauschListe = null;
  } catch (e) { if (e === ABBRUCH || vorbei(g)) throw ABBRUCH; melden(h.name + '.stufen', e); }
  try {
    await rast(g, true);
    // Alle Materialien neu prüfen: ein Schritt kann Schlüssel ändern (Schatten, Umgebung). Vorhandene Programme kosten dabei nichts.
    await kompilieren(szene, g, true);
    // Was das Modul eben eingesetzt hat (kompiliert, Texturen schon da), blendet es selbst ein: ab jetzt echt zeichnen
    for (const m of kompiliert) if (!echt.has(m) && texturen(m).every(geladen)) echt.add(m);
  } finally { halten = false; }
  malen();
  if (n >= 3) await hochladenRunde(g);                             // Texturen erst ab Stufe 3
}
// Schritte reihum: der erste jedes Moduls, dann der zweite usw. Jedes Modul ordnet seine Schritte selbst von nah nach fern.
function schritte(n) {
  const listen = teile.map(h => [].concat((h.stufen && h.stufen[n]) || []).filter(f => typeof f === 'function').map(f => [h, f]));
  const aus = [];
  for (let i = 0; listen.some(l => l.length > i); i++) for (const l of listen) if (l[i]) aus.push(l[i]);
  return aus;
}

function stufeSetzen(n) {
  stufe = n; if (ctx) ctx.stufe = n;
  kameraSetzen(jetzt); zeichnen();
  stufenZeiten[n] = Math.round(performance.now());
  programme[n] = renderer.info.programs ? renderer.info.programs.length : 0;
  try { performance.mark('gasse-stufe-' + n); } catch (e) {}
  weg.dataset.stufe = n;
  wechselPruefen();
  weg.dataset.zeiten = stufenZeiten.map((v, i) => v != null ? i + ':' + v : '').filter(Boolean).join(' ');
  weg.dataset.programme = programme.map((v, i) => v != null ? i + ':' + v : '').filter(Boolean).join(' ');
  malen();
}
function zeigen() {
  if (!weg.classList.contains('gweg--bereit')) weg.classList.add('gweg--bereit');
  if (blendeHaelt) {
    blendeHaelt = false;
    requestAnimationFrame(() => requestAnimationFrame(() => { blende.style.transition = ''; blende.style.opacity = '0'; }));
  }
}

async function aufbauen() {
  const g = gen, t0 = performance.now();
  protokoll.push('aufbau @' + Math.round(t0));
  const { S, T, schnee } = stimmung(thema, istWinter());
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = T.belichtung;
  renderer.shadowMap.enabled = false;
  szene = new THREE.Scene();
  stufe = 0; zeichnenAn = false; alleEcht = false; stufenZeiten = []; programme = [];
  himmel = himmelBild(T);
  ctx = {
    THREE, renderer, szene, kamera, S, T, schnee, q, ruhig, basis: BASIS, px: pxFuer(q),
    strasse: { BREITE, ENDE }, haeuser: LAYOUT.haeuser.map(h => ({ ...h })), nr13: { ...NR13 }, lampen: LAYOUT.lampen.map(l => ({ ...l })),
    anker: { fensterbaenke: [], gesimse: [], leuchten: [] },
    malen, lader: new THREE.TextureLoader(), fahrt: jetzt, breite: B, hoehe: H, pflaster: null, stufe: 0,
    // Gestaffeltes Laden
    einfach, kompilieren: o => kompilierenFuerModul(o, g), hochladen: t => hochladen(t, g), rast: () => rast(g),
    tauschen: fn => { if (!vorbei(g)) { ueberblenden(fn); tauschListe = null; } },
  };
  ctx.lader.load = ((orig) => function (url, onLoad, onProgress, onError) {
    return orig.call(this, url, t => { onLoad && onLoad(t); malen(); }, onProgress, e => { melden('Bild ' + url, 'nicht geladen'); onError && onError(e); });
  })(ctx.lader.load);
  buehne.style.setProperty('--gweg-grund', verlauf(T));
  teile = [];
  // ----- Stufe 1: bauen, mit einer Pause nach jedem Modul -----
  teil('buehne', welt.bauen, null); await rast(g, true);           // Pflaster, Rinne, Silhouetten, Aushänge (ctx.pflaster)
  teil('licht', mLicht && mLicht.bauen, platz.licht, true); await rast(g, true);
  teil('fassaden', mFassaden && mFassaden.bauen, platz.fassaden); await rast(g, true);
  teil('requisiten', mRequisiten && mRequisiten.bauen, platz.requisiten); await rast(g, true);
  // licht.nachbauen schon hier: Lichter, Schatten und Spiegelung stehen fest, bevor in Stufe 2 kompiliert wird
  if (mLicht && mLicht.nachbauen) {
    try { const h = messe('licht.nachbauen', () => mLicht.nachbauen(ctx)); if (h && h.aktualisieren) { h.name = 'licht.nachbauen'; teile.push(h); } } catch (e) { melden('licht.nachbauen', e); }
  }
  weg.dataset.stimmung = S + (schnee ? '-schnee' : '');
  weg.dataset.platzhalter = teile.filter(t => t.platzhalter).map(t => t.name).join(' ');
  for (const t of teile) if (t.groesse) { try { t.groesse(B, H, pr); } catch (e) { melden(t.name + '.groesse', e); } }
  weg.dataset.bauzeit = Math.round(performance.now() - t0) + ' ms';
  tauschListe = null;
  // licht darf für Stufe 1 die Farben seines Himmels angeben ([zenit, mitte, horizont]), damit Stufe 2 nicht die Farbe wechselt
  const hv = ctx.himmelVerlauf;
  if (Array.isArray(hv) && hv.length === 3 && hv.every(f => typeof f === 'string')) { himmel.dispose(); himmel = himmelBild({ zenit: hv[0], mitte: hv[1], horizont: hv[2] }); }
  // Programme der Ersatzmaterialien einzeln vorbinden: das erste Bild bindet sonst alle in einem einzigen langen Block
  const pz = () => (renderer.info.programs || []).length;
  const pv = pz();
  await kompilieren(szene, g, true, true);
  protokoll.push('programme ' + pv + '→' + pz() + ' vor dem ersten Bild @' + Math.round(performance.now()));
  stufeSetzen(1);
  protokoll.push('programme ' + pz() + ' nach dem ersten Bild');
  zeigen();
  if (ZIEL < 2) return fertig(g);
  // ----- Stufe 2: eigene Shader im Hintergrund kompilieren, Materialien ohne neue Texturen einsetzen -----
  await rast(g, true);
  for (const h of teile) if (h.kinder && h.kinder.length) await kompilieren(h.kinder, g);
  await kompilieren(szene, g);
  const bereit = [...kompiliert].filter(m => texturen(m).every(geladen));
  ueberblenden(() => { for (const m of bereit) echt.add(m); });
  for (const [h, fn] of schritte(2)) await schritt(h, fn, g, 2);
  stufeSetzen(2);
  if (ZIEL < 3) return fertig(g);
  // ----- Stufe 3: Texturen nah → fern, dann die Schritte der Module -----
  await hochladenRunde(g);
  for (const [h, fn] of schritte(3)) await schritt(h, fn, g, 3);
  for (const bis = performance.now() + 8000; await hochladenRunde(g) > 0 && performance.now() < bis;) await warten(200, g);   // Bilder, die noch laden
  stufeSetzen(3);
  if (ZIEL < 4) return fertig(g);
  // ----- Stufe 4: feine Details der Module, Nachbearbeitung, alles Übrige -----
  for (const [h, fn] of schritte(4)) await schritt(h, fn, g, 4);
  await kompilieren(szene, g);
  await hochladenRunde(g);
  const post = teile.find(t => t.zeichnen && !t.stufen);         // ältere Module: Nachbearbeitung erst jetzt
  if (post) {
    // Die Nachbearbeitung einmal unsichtbar vorzeichnen (kompiliert ihre Shader), danach überblendet einschalten
    zeichnenAn = true; alleEcht = true;
    try { post.zeichnen(renderer, szene, kamera); } catch (e) { melden(post.name + '.zeichnen', e); post.zeichnen = null; }
    zeichnenAn = false; alleEcht = false;
    renderer.setRenderTarget(null); kameraSetzen(jetzt); zeichnen();
    await rast(g, true);
  }
  ueberblenden(() => { alleEcht = true; zeichnenAn = true; groesse(); });   // volle Auflösung unter der Überblendung
  stufeSetzen(4);
  fertig(g);
}
function fertig(g) {
  if (vorbei(g)) return;
  weg.dataset.fertig = Math.round(performance.now());
  if (PRUEF) {
    texturenMessen();
    // Im Prüfmodus noch einige Bilder zeichnen, bis Bilder und Schrift sicher geladen sind
    let n = 0; const iv = setInterval(() => {
      if (vorbei(g)) return clearInterval(iv);
      kameraSetzen(festeFahrt); for (const h of teile) { try { h.aktualisieren && h.aktualisieren(n * 0.1, 0.016); } catch (e) {} }
      zeichnen(); if (++n > 6) clearInterval(iv);
    }, 300);
  }
}
function start() {
  aufbauen().catch(e => {
    if (e === ABBRUCH) return;
    melden('buehne', e);
    if (stufe < 1 && !weg.classList.contains('gweg--bereit')) window.__gasseZurueck && window.__gasseZurueck('buehne: ' + (e && e.message));
  });
}

function abbauen() {
  gen++; stufe = 0; if (ctx) ctx.stufe = 0; zeichnenAn = false; alleEcht = false;
  for (const t of teile) { try { t.entsorgen && t.entsorgen(); } catch (e) { melden(t.name + '.entsorgen', e); } }
  teile = [];
  freigeben(szene);
  szene.clear(); szene.fog = null; szene.background = null; szene.environment = null;
  for (const [m, e] of einfachVorrat) if (e && e !== m && e !== UNSICHTBAR) e.dispose();
  einfachVorrat = new Map(); echt = new Set(); kompiliert = new Set(); tauschListe = null;
  if (himmel) { himmel.dispose(); himmel = null; }
  delete weg.dataset.fertig;
}

// ---------- Zeichnen nur bei Bedarf und nur wenn sichtbar ----------
let geplant = 0, tAlt = 0, sichtbar = true, zeiten = [];
function malen() { if (!geplant && sichtbar) geplant = requestAnimationFrame(bild); }
function zeichnen() {
  if (stufe < 1) return;
  messe('zeichnen s' + stufe, () => mitEinfachen(() => {
    const t = teile.find(t => t.zeichnen && (zeichnenAn || t.stufen));
    if (t) { try { t.zeichnen(renderer, szene, kamera); return; } catch (e) { melden(t.name + '.zeichnen', e); t.zeichnen = null; } }
    renderer.render(szene, kamera);
  }));
}
function bild(ms) {
  geplant = 0;
  if (stufe < 1 || halten) return;
  const t = ms / 1000, dt = tAlt ? Math.min(0.05, t - tAlt) : 0.016; tAlt = t;
  ziel = fortschritt();
  const k = 1 - Math.exp(-dt * 7);
  jetzt += (ziel - jetzt) * k;
  const faehrt = Math.abs(ziel - jetzt) > 0.0003;
  if (!faehrt) jetzt = ziel;
  kameraSetzen(jetzt);
  let weiter = faehrt;
  for (const h of teile) {
    if (!h.aktualisieren) continue;
    try { if (h.aktualisieren(t, dt)) weiter = true; } catch (e) { melden(h.name + '.aktualisieren', e); h.aktualisieren = null; }
  }
  zeichnen();
  if (hinweis) hinweis.style.opacity = jetzt < 0.035 ? 1 : 0;
  anpassen(dt);
  if (weiter) malen(); else tAlt = 0;
}

// Wird es zäh, sinkt die Auflösung schrittweise (nicht im Prüfmodus und erst, wenn die Gasse fertig ist)
function anpassen(dt) {
  if (PRUEF || pr <= 1 || stufe < 4) { zeiten = []; return; }
  zeiten.push(dt); if (zeiten.length < 40) return;
  const mittel = zeiten.reduce((a, b) => a + b, 0) / zeiten.length; zeiten = [];
  if (mittel > 0.026) { pr = Math.max(1, pr - 0.25); groesse(); }
}

function groesse() {
  const kh = kopf && getComputedStyle(kopf).position === 'sticky' ? kopf.offsetHeight : 0;
  weg.style.setProperty('--kopf-h', kh + 'px');
  B = buehne.clientWidth || innerWidth; H = buehne.clientHeight || innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, pr, stufe < 4 && !alleEcht ? 1 : 99));   // bis Stufe 4 höchstens 1: schnelleres erstes Bild
  renderer.setSize(B, H, false);
  kamera.aspect = B / H; kamera.updateProjectionMatrix();
  blende.width = Math.round(B * Math.min(devicePixelRatio, 1.5)); blende.height = Math.round(H * Math.min(devicePixelRatio, 1.5));
  if (ctx) { ctx.breite = B; ctx.hoehe = H; }
  for (const t of teile) if (t.groesse) { try { t.groesse(B, H, pr); } catch (e) { melden(t.name + '.groesse', e); } }
  kameraSetzen(jetzt);
  malen();
}

// ---------- Themawechsel: altes Bild festhalten, offene Schritte verwerfen, neu aufbauen, weich überblenden ----------
function wechseln(neu) {
  if (neu === thema) return;
  thema = neu;
  const weich = !PRUEF && sichtbar && stufe >= 1 && weg.classList.contains('gweg--bereit');
  if (weich) {
    kameraSetzen(jetzt); zeichnen();
    const g = blende.getContext('2d'); g.clearRect(0, 0, blende.width, blende.height); g.drawImage(leinwand, 0, 0, blende.width, blende.height);
    blende.style.transition = 'none'; blende.style.opacity = '1';
    blendeHaelt = true;                                            // hält das alte Bild, bis Stufe 1 der neuen Stimmung steht
  }
  abbauen(); start();
}
document.addEventListener('thema', e => wechseln(e.detail && e.detail.thema === 'dark' ? 'dark' : 'light'));

// ---------- Start ----------
if (PRUEF) weg.classList.add('gweg--pruef');
// Prüfbilder: Fenster unter 500 px Breite sind dort nicht möglich, &b=390&h=844 setzt die Bühne im Prüfmodus auf genau diese Grösse
if (PRUEF && Q.has('b')) Object.assign(buehne.style, { width: (+Q.get('b') || 390) + 'px', height: (+Q.get('h') || 844) + 'px', right: 'auto', bottom: 'auto' });
leinwand.addEventListener('webglcontextlost', e => { e.preventDefault(); melden('webgl', 'Kontext verloren'); });
leinwand.addEventListener('webglcontextrestored', () => { abbauen(); start(); groesse(); });

try {
  groesse();
  jetzt = ziel = PRUEF ? festeFahrt : fortschritt();
  kameraSetzen(jetzt);
} catch (e) {
  melden('buehne', e);
  window.__gasseZurueck && window.__gasseZurueck('buehne: ' + (e && e.message));
  throw e;
}
start();

new IntersectionObserver(es => { sichtbar = es[0].isIntersecting; if (sichtbar) malen(); }, { rootMargin: '100px' }).observe(weg);
addEventListener('scroll', malen, { passive: true });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(groesse, 120); });
addEventListener('load', groesse);
document.fonts && document.fonts.ready.then(() => malen());
window.__gasse = { get ctx() { return ctx; }, fehler, malen, q, protokoll, get stufe() { return stufe; } };
window.__fertig = true;
// Prüfmodus: geschätzter Textur-Upload je Teil (Breite × Höhe × 4 Byte, mit Mipmaps × 4/3), wenn der Aufbau fertig ist.
// Renderziele wie die PMREM-Umgebung von licht entstehen auf der GPU und zählen nicht als Upload.
function texturenMessen() {
  const gesehen = new Set();
  const groesse = t => {
    if (!t || !t.isTexture || t.isRenderTargetTexture || gesehen.has(t)) return 0; gesehen.add(t);
    const i = t.image || {}, w = i.width || 0, h = i.height || 0;
    return w * h * 4 * (t.generateMipmaps !== false && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1);
  };
  const ausMaterial = m => Object.values(m || {}).reduce((s, v) => s + groesse(v), 0) + Object.values(m?.uniforms || {}).reduce((s, u) => s + groesse(u && u.value), 0);
  const ausBaum = wurzeln => { let s = 0; for (const w of wurzeln) w.traverse(o => { for (const m of [].concat(o.material || [])) s += ausMaterial(m); }); return s; };
  const kb = n => Math.round(n / 1024);
  const teileKb = teile.filter(t => t.kinder).map(t => t.name + ':' + kb(ausBaum(t.kinder)));
  gesehen.clear(); const upload = ausBaum(szene.children);
  const gpu = [szene.background, szene.environment].filter(t => t && t.isRenderTargetTexture).length;
  weg.dataset.texturen = teileKb.join(' ') + ' upload:' + kb(upload) + ' KB (' + q + ')' + (gpu ? ' + ' + gpu + ' GPU-Umgebung' : '');
}
// Prüfhilfe für den Themawechsel: &wechsel=1 drückt beim Erreichen von Stufe 2 einmal den echten Themaknopf (mitten im Aufbau:
// prüft das Verwerfen). Nicht über einen Zeitgeber: der Aufbau gibt mit scheduler.yield frei, das geht Zeitgebern vor.
let wechselPruefung = Q.get('wechsel') === '1';
function wechselPruefen() {
  if (!wechselPruefung || stufe !== 2) return;
  wechselPruefung = false;
  const alt = thema, k = document.querySelector('.themaknopf');
  queueMicrotask(() => { k && k.click(); weg.dataset.gewechselt = alt + ' → ' + thema + ' bei Stufe 2 @' + Math.round(performance.now()); });
}
// Prüfhilfe für die echte Scrollfahrt: ?rollen=0..1 scrollt an diese Stelle der Gasse
if (Q.has('rollen') && !PRUEF) {
  const f = Math.max(0, Math.min(1, parseFloat(Q.get('rollen')) || 0));
  const hin = () => { scrollTo(0, weg.getBoundingClientRect().top + scrollY + f * (weg.offsetHeight - buehne.offsetHeight)); malen(); const b = buehne.getBoundingClientRect(); weg.dataset.rollen = [Math.round(scrollY), Math.round(weg.getBoundingClientRect().top), Math.round(b.top), Math.round(b.height), weg.offsetHeight, getComputedStyle(buehne).position, innerHeight].join(' '); };
  hin(); setTimeout(hin, 400); setTimeout(hin, 1500);
  setTimeout(() => {
    const gl = renderer.getContext(), px = new Uint8Array(4), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, werte = [];
    for (const [x, y] of [[0.5, 0.5], [0.5, 0.15], [0.2, 0.6], [0.8, 0.3]]) { gl.readPixels(Math.round(w * x), Math.round(h * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); werte.push(px.slice(0, 3).join(',')); }
    weg.dataset.pixel = werte.join(' ') + ' f=' + jetzt.toFixed(3) + ' sichtbar=' + sichtbar + ' opac=' + getComputedStyle(leinwand).opacity;
  }, 4000);
}
