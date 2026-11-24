// Modul requisiten der WebGL-Gasse. Vertrag: stimmung/VERTRAG.md
// Baut die ganze Nummer 13 (Fassade, Ladenfront mit den echten Fotos, Schild, Hausnummer, Markise, Kranz,
// Laterne, Kartenständer, Bänke mit Töpfen, Tännchen, im Winter Schlitten), die Blumenkästen an den
// Fensterbänken der Gasse (Strohblumen, Christrosen, im Winter Tannenzweige) und den Schnee.
// Lichtquellen baut dieses Modul keine: warme Flächen gehen als Anker an licht (anker.leuchten).
import { zufall } from './gemeinsam.js';

// Farben aus der Website (style.css) und aus den Fotos des Ladens
const F = {
  rahmen: '#7f8b88',      // graugrün gestrichenes Holz der Ladenfront (aus laden-winter.jpg gemessen)
  rahmenHell: '#94a09c',
  rahmenTief: '#5e6b69',
  putz: '#f3eee4',
  gewaende: '#e7e0d2',
  heu: '#ddd1b3',
  traufe: '#5b4d3e',
  dach: '#4a3c33',
  laden: '#5f7466',       // Fensterläden der 13
  kasten: '#7a5a43',
  tinte: '#1e1e1e',
  weiss: '#fbfaf6',
  gassenblau: '#1f3d82',
  tanne: '#3f5a55',
  band: '#7d7836',
  zapfen: '#7a5638',
  schnee: '#f2f5fa',
  messing: '#c9a95c',
  stein: '#bdb5a6',
  bank: '#8c9592',
  topf: '#b46f4c',
};
// Strohblumen wie in strohblume.svg: [aussen, mitte, innen, linie]
const STROH = [
  ['#a62c54', '#cb567d', '#e07f9b', '#752538'],
  ['#e2aca0', '#efc4c2', '#f6dcda', '#a8656e'],
  ['#efe7e1', '#f7f2ee', '#ffffff', '#a8968e'],
  ['#752538', '#a62c54', '#cb567d', '#42171e'],
];

// Ausschnitte aus den Fotos (Pixel im Original): links, oben, rechts, unten
const FOTO = {
  fenster: { url: 'bilder/schaufenster-abend.jpg', b: 800, h: 450 },
  innen: { url: 'bilder/laden-innen.jpg', b: 450, h: 600 },
  tag: { url: 'bilder/schaufenster.jpg', b: 600, h: 800 },
};
// Fünfter Wert: Mittelfarbe des Ausschnitts (linear gemittelt, aus dem Foto gemessen), Ersatz bis das Foto eingesetzt ist
const AUS = {
  links: [8, 15, 188, 335, '#706650'],
  rechts: [362, 30, 762, 425, '#69614a'],
  oberlicht: [212, 48, 340, 122, '#796842'],
  tuer: [60, 0, 367, 600, '#816a56'],
  tuerFoto: [208, 128, 342, 436, '#665846'],
  rechtsTag: [0, 40, 600, 566, '#887b74'],
};

let schriftLaden = null;   // Open Sans 600 für die Hausnummer, einmal pro Seite

export function bauen(ctx) {
  const { THREE, szene, T } = ctx;
  const S = ctx.S === 'abend' ? 'abend' : 'tag';
  const abend = S === 'abend';
  const schnee = !!ctx.schnee || T.schnee > 0;
  const q = ctx.q || 'hoch';
  const tief = q === 'tief';
  const stufe = tief ? 0 : q === 'mittel' ? 1 : 2;
  const jeStufe = (werte) => werte[stufe];   // [tief, mittel, hoch]
  const KL = tief ? 0.5 : 1;                 // kleine Leinwände auf dem Telefon halb so gross
  const ruhig = !!ctx.ruhig;
  const basis = ctx.basis || '../assets/';
  const anker = ctx.anker || (ctx.anker = {});
  if (!anker.leuchten) anker.leuchten = [];
  const meineLeuchten = [];
  let weg = false;
  const malen = () => { if (!weg) ctx.malen?.(); };

  const wurzel = new THREE.Group(); wurzel.name = 'requisiten';
  szene.add(wurzel);
  const frei = new Set();
  const halt = (x) => { frei.add(x); return x; };
  let texBytes = 0;

  // ---------- kleine Helfer ----------
  const matCache = new Map();
  function mat(farbe, opt = {}) {
    const key = farbe + JSON.stringify(opt);
    if (!matCache.has(key)) matCache.set(key, halt(new THREE.MeshStandardMaterial(Object.assign({ color: farbe, roughness: 0.85 }, opt))));
    return matCache.get(key);
  }
  function teil(geo, material, x, y, z, eltern = wurzel) {
    const m = new THREE.Mesh(halt(geo), material); m.position.set(x, y, z); eltern.add(m); return m;
  }
  const kiste = (b, h, t, material, x, y, z, eltern) => teil(new THREE.BoxGeometry(b, h, t), material, x, y, z, eltern);
  // lesen: Leinwand für getImageData (Rauschen) im Hauptspeicher halten, sonst wartet das Auslesen auf die Grafikkarte
  function flaeche(b, h, lesen = false) {
    const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(b)); c.height = Math.max(2, Math.round(h));
    return [c, c.getContext('2d', lesen ? { willReadFrequently: true } : undefined)];
  }
  const texGroesse = (c, mip) => c.width * c.height * 4 * (mip ? 4 / 3 : 1);
  function canvasTex(c, farbe = true, mip = true, zaehlen = true) {
    const t = halt(new THREE.CanvasTexture(c));
    if (farbe) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = tief ? 2 : 8;
    if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    if (zaehlen) texBytes += texGroesse(c, mip);
    return t;
  }
  function rauschen(g, w, h, r, staerke) {
    const d = g.getImageData(0, 0, w, h), a = d.data;
    for (let i = 0; i < a.length; i += 4) { const k = (r() - 0.5) * staerke; a[i] += k; a[i + 1] += k; a[i + 2] += k; }
    g.putImageData(d, 0, 0);
  }

  // ---------- Gestaffeltes Laden (VERTRAG, «Gestaffeltes Laden (Runde 3, korrigiert)») ----------
  // bauen legt nur Geometrie und Materialien an. Jede grössere Leinwand bekommt zuerst eine winzige Ersatzkarte: derselbe Maler
  // auf wenigen Pixeln, ohne Rauschen. So stimmt die Mittelfarbe für Stufe 1, und bei alphaTest steht die Form schon.
  // Die richtigen Leinwände malen die Schritte in stufen[3]: Schild und Nr. 13, Fotos, Ladenfront mit Markise,
  // Obergeschoss, Pflanzen. Jeder Schritt lädt seine Texturen hoch, setzt sie überblendet ein und gibt den Ersatz frei.
  // Ohne die Stufen von haupt.js (Prüfseite) laufen dieselben Schritte gleich nach bauen nacheinander.
  const stufig = typeof ctx.tauschen === 'function';
  const hochladen = (l) => (stufig && ctx.hochladen ? ctx.hochladen(l) : Promise.resolve());
  const tauschen = (fn) => { if (stufig) ctx.tauschen(fn); else { fn(); malen(); } };
  const rast = () => (stufig && ctx.rast ? ctx.rast() : Promise.resolve());
  const ersatz = (c) => canvasTex(c, true, false, false);
  function ersatzFarbe(farbe) { const [c, g] = flaeche(4, 4); g.fillStyle = farbe; g.fillRect(0, 0, 4, 4); return ersatz(c); }
  // paare: [material, [schlüssel…], neue textur]
  // Neue Texturen, die nicht mehr eingesetzt werden (abgebrochen oder entsorgt), gleich wieder freigeben
  const wegwerfen = (paare) => { for (const p of paare) { frei.delete(p[2]); p[2].dispose(); } return false; };
  async function einsetzen(paare) {
    if (weg) return wegwerfen(paare);
    try { await hochladen(paare.map((p) => p[2])); } catch (e) { wegwerfen(paare); throw e; }
    if (weg) return wegwerfen(paare);
    const alt = new Set();
    tauschen(() => { for (const [m, keys, t] of paare) for (const k of keys) { if (m[k] && m[k] !== t) alt.add(m[k]); m[k] = t; } });
    for (const t of alt) { frei.delete(t); t.dispose(); }
    infoSetzen();
    return true;
  }
  // Ein Schritt aus einer Liste von Malern (je einer liefert ein Paar), zwischen den Malern Pause für den Hauptfaden
  const ausListe = (liste) => async () => {
    const paare = [];
    try { for (const f of liste) { paare.push(f()); await rast(); if (weg) return wegwerfen(paare); } } catch (e) { wegwerfen(paare); throw e; }
    return einsetzen(paare);
  };
  // Höchstens ms warten: die Schritte aller Module laufen nacheinander, keiner soll die anderen aufhalten
  const hoechstens = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
  const front = [], oben = [];
  let schrittSchild = null, schrittFotos = null, schrittPflanzen = null;

  function leuchte(pos, farbe, staerke, radius) {
    const l = { pos, farbe, staerke, radius, von: 'requisiten' };
    anker.leuchten.push(l); meineLeuchten.push(l);
  }
  const zeit = { value: 0 };
  const PXM = jeStufe([11, 30, 44]);   // Pixel pro Meter für Wandtexturen

  // ---------- Fotos ----------
  // Jeder Ausschnitt bekommt eine eigene Leinwand in der Grösse, die er auf dem Bild braucht (keine Klone des ganzen Fotos).
  // Zwei Stufen: «fern» (klein, mit Mipmaps) während der Fahrt, «nah» (scharf) erst, wenn die Kamera vor der 13 steht.
  // Die jeweils andere Stufe gibt ihren Grafikspeicher frei; die Leinwand bleibt für den Rückweg.
  const FOTO_PXM = jeStufe([42, 100, 160]);     // Pixel pro Meter Scheibe in der Nähe
  const FERN_FAK = jeStufe([0.38, 0.4, 0.4]);   // Anteil davon während der Fahrt
  const NAH_AB = 26, FERN_AB = 29;              // Abstand Kamera–Front in m, mit Spielraum gegen Hin und Her
  const bilder = {};
  function bild(name, fertig) {
    let e = bilder[name];
    if (!e) {
      e = bilder[name] = { bild: null, warte: [] };
      const roh = ctx.lader.load(basis + FOTO[name].url, () => {
        if (weg) return;
        e.bild = roh.image; roh.dispose();
        for (const w of e.warte) w(e.bild);
        e.warte.length = 0; malen();
      });
    }
    if (e.bild) fertig(e.bild); else e.warte.push(fertig);
  }
  const scheiben = [];
  let fotoNah = false;
  function fotoMass(s, nah) {
    const sw = s.a[2] - s.a[0], sh = s.a[3] - s.a[1];
    const dichte = FOTO_PXM * (nah ? 1 : FERN_FAK);
    const fak = Math.min(1, Math.max(dichte * s.wM / sw, dichte * s.hM / sh));   // nie grösser als das Original
    const w = Math.max(2, Math.round(sw * fak)), h = Math.max(2, Math.round(sh * fak)), mip = !(nah && tief);
    return { sw, sh, w, h, mip, bytes: w * h * 4 * (mip ? 4 / 3 : 1) };
  }
  function fotoTex(s, nah) {
    const a = s.a, m = fotoMass(s, nah), { sw, sh } = m;
    const [c, g] = flaeche(m.w, m.h);
    g.fillStyle = a[4] || (abend ? '#5a4430' : '#9a9a92'); g.fillRect(0, 0, c.width, c.height);
    const t = canvasTex(c, true, m.mip, false);
    bild(s.name, (b) => { g.drawImage(b, a[0], a[1], sw, sh, 0, 0, c.width, c.height); t.needsUpdate = true; });
    return t;
  }
  function fotoStufe(nah) {
    if (nah === fotoNah) return;
    fotoNah = nah;
    for (const s of scheiben) {
      const k = nah ? 'nah' : 'fern';
      if (!s[k]) s[k] = fotoTex(s, nah);
      s.mat.map = s[k]; if (s.mat.emissiveMap) s.mat.emissiveMap = s[k];
      s[nah ? 'fern' : 'nah']?.dispose();
    }
    infoSetzen(); malen();
  }
  let fotosDa = false;                          // erst nach dem Schritt in stufen[3] zwischen nah und fern wechseln
  function fotoPruefen() {
    if (!fotosDa) return;
    const d = ctx.kamera ? ctx.kamera.position.z - nr.z : 0;
    if (!fotoNah && d < NAH_AB) fotoStufe(true);
    else if (fotoNah && d > FERN_AB) fotoStufe(false);
  }
  function fotoMaterial(map, staerke = 1) {
    if (abend) return halt(new THREE.MeshBasicMaterial({ map, color: new THREE.Color(1.12 * staerke, 1.04 * staerke, 0.94 * staerke), toneMapped: false }));
    return halt(new THREE.MeshStandardMaterial({ map, emissive: '#fff6ea', emissiveMap: map, emissiveIntensity: (0.28 + 0.5 * T.laden) * staerke, roughness: 0.1, metalness: 0, color: '#d9dcdc' }));
  }

  // Spiegelung auf dem Glas (Himmel oben hell, unten dunkler, ein schräger Lichtstreif)
  let glasSpiegel = null;
  function spiegelMaterial() {
    if (glasSpiegel) return glasSpiegel;
    const [c, g] = flaeche(32 * KL, 64 * KL); g.scale(KL, KL);
    const gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, T.horizont); gr.addColorStop(0.45, T.mitte); gr.addColorStop(1, abend ? '#000000' : T.zenit);
    g.fillStyle = gr; g.fillRect(0, 0, 32, 64);
    g.globalAlpha = 0.5; g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(5, 0); g.lineTo(15, 0); g.lineTo(0, 30); g.lineTo(0, 10); g.fill();
    g.beginPath(); g.moveTo(22, 0); g.lineTo(25, 0); g.lineTo(9, 64); g.lineTo(6, 64); g.fill();
    glasSpiegel = halt(new THREE.MeshBasicMaterial({ map: canvasTex(c, true, false), transparent: true, opacity: abend ? 0.06 : (schnee ? 0.2 : 0.26), depthWrite: false, blending: THREE.NormalBlending }));
    return glasSpiegel;
  }

  // ---------- Atlas für Blüten, Blätter, Zweige (4 × 2 Felder) ----------
  const ZELLE = jeStufe([32, 96, 128]);
  // Maler für den Atlas, Z = Pixel je Feld (12 für den Ersatz, ZELLE im Schritt)
  function malAtlas(Z) {
    const [c, g] = flaeche(Z * 4, Z * 2), r = zufall(4711);
    const feld = (i) => [(i % 4) * Z, Math.floor(i / 4) * Z];
    // Strohblumen: drei Kränze aus Hüllblättern und ein gelbes Körbchen
    STROH.forEach((fb, i) => {
      const [ox, oy] = feld(i), cx = ox + Z / 2, cy = oy + Z / 2, s = Z / 48;
      for (const [n, rad, len, breit, farbe] of [[13, 13, 10, 5.2, fb[0]], [11, 10.5, 8.5, 4.4, fb[1]], [9, 8, 6.5, 3.6, fb[2]]]) {
        for (let k = 0; k < n; k++) {
          const w = (k / n) * Math.PI * 2 + r() * 0.2;
          g.save(); g.translate(cx + Math.cos(w) * rad * s, cy + Math.sin(w) * rad * s); g.rotate(w);
          g.fillStyle = farbe; g.strokeStyle = fb[3]; g.lineWidth = 0.7 * s;
          g.beginPath(); g.ellipse(0, 0, len * s, breit * s, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore();
        }
      }
      g.fillStyle = '#e8c22a'; g.strokeStyle = '#9b7414'; g.lineWidth = 0.6 * s;
      g.beginPath(); g.arc(cx, cy, 7.6 * s, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#b8861a';
      for (let k = 0; k < 18; k++) { const w = k * 2.4, rr = Math.sqrt(k / 18) * 6 * s; g.beginPath(); g.arc(cx + Math.cos(w) * rr, cy + Math.sin(w) * rr, 0.9 * s, 0, 7); g.fill(); }
    });
    // Christrose: fünf breite weisse Blütenblätter, grünliche Mitte mit Staubgefässen
    {
      const [ox, oy] = feld(4), cx = ox + Z / 2, cy = oy + Z / 2, s = Z / 48;
      for (let k = 0; k < 5; k++) {
        const w = k / 5 * Math.PI * 2 - Math.PI / 2;
        g.save(); g.translate(cx + Math.cos(w) * 10 * s, cy + Math.sin(w) * 10 * s); g.rotate(w);
        const gr = g.createRadialGradient(-8 * s, 0, 1, 0, 0, 14 * s);
        gr.addColorStop(0, '#e9eedb'); gr.addColorStop(0.5, '#fbf8f1'); gr.addColorStop(1, '#f1dfe1');
        g.fillStyle = gr; g.strokeStyle = '#c9c3b3'; g.lineWidth = 0.6 * s;
        g.beginPath(); g.ellipse(0, 0, 12 * s, 9.5 * s, 0, 0, Math.PI * 2); g.fill(); g.stroke(); g.restore();
      }
      g.fillStyle = '#b7c56a'; g.beginPath(); g.arc(cx, cy, 4 * s, 0, 7); g.fill();
      g.fillStyle = '#e8c22a';
      for (let k = 0; k < 22; k++) { const w = k * 0.9, rr = 4.5 * s + (k % 3) * s; g.beginPath(); g.arc(cx + Math.cos(w) * rr, cy + Math.sin(w) * rr, 0.9 * s, 0, 7); g.fill(); }
    }
    // Blätter: graugrüne Büschel
    {
      const [ox, oy] = feld(5), cx = ox + Z / 2, cy = oy + Z * 0.95, s = Z / 48;
      for (let k = 0; k < 9; k++) {
        const w = -Math.PI / 2 + (r() - 0.5) * 2.2, len = (16 + r() * 8) * s;
        g.save(); g.translate(cx, cy); g.rotate(w);
        g.fillStyle = ['#5f7a5a', '#6f8a5f', '#4f6a4c', '#7d9470'][k % 4];
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -5 * s, len, 0); g.quadraticCurveTo(len * 0.5, 5 * s, 0, 0); g.fill();
        g.strokeStyle = 'rgba(30,45,25,.5)'; g.lineWidth = 0.5 * s; g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.9, 0); g.stroke();
        g.restore();
      }
    }
    // Tannenzweig: Mittelrippe mit dichten Nadeln
    {
      const [ox, oy] = feld(6), s = Z / 48;
      g.strokeStyle = '#4a3a2a'; g.lineWidth = 1.2 * s; g.beginPath(); g.moveTo(ox + 4 * s, oy + Z / 2); g.lineTo(ox + Z - 4 * s, oy + Z / 2); g.stroke();
      for (let k = 0; k < 70; k++) {
        const x = ox + (6 + r() * 36) * s, seite = k % 2 ? 1 : -1, len = (5 + r() * 4) * s * (1 - (x - ox) / Z * 0.4);
        g.strokeStyle = ['#2f4a3c', '#3f5a55', '#36503f', '#4c6a58'][k % 4]; g.lineWidth = 1.1 * s;
        g.beginPath(); g.moveTo(x, oy + Z / 2); g.lineTo(x + len * 0.5, oy + Z / 2 + seite * len); g.stroke();
      }
      if (schnee) { g.fillStyle = 'rgba(245,248,252,.9)'; for (let k = 0; k < 14; k++) { g.beginPath(); g.ellipse(ox + (8 + r() * 32) * s, oy + Z / 2 - (2 + r() * 4) * s, (2 + r() * 2.5) * s, 1.4 * s, 0, 0, 7); g.fill(); } }
    }
    // Schneeglöckchen-Büschel für die Töpfe vor dem Laden
    {
      const [ox, oy] = feld(7), s = Z / 48;
      for (let k = 0; k < 12; k++) {
        const x = ox + (10 + r() * 28) * s, top = oy + (10 + r() * 14) * s;
        g.strokeStyle = '#5f7a5a'; g.lineWidth = 1.6 * s; g.beginPath(); g.moveTo(x, oy + Z); g.quadraticCurveTo(x + (r() - 0.5) * 6 * s, top + 10 * s, x, top); g.stroke();
      }
      for (let k = 0; k < 9; k++) {
        const x = ox + (10 + r() * 28) * s, y = oy + (8 + r() * 14) * s;
        g.fillStyle = '#fbfaf6'; g.strokeStyle = '#c9cfc0'; g.lineWidth = 0.5 * s;
        g.beginPath(); g.ellipse(x, y + 3 * s, 2.4 * s, 4 * s, 0, 0, 7); g.fill(); g.stroke();
        g.fillStyle = '#9db06a'; g.beginPath(); g.arc(x, y, 1 * s, 0, 7); g.fill();
      }
    }
    return c;
  }
  const atlasErsatz = ersatz(malAtlas(12));

  // Wiegen im Vertex-Shader: oben stärker als unten, Phase aus der Lage der Instanz
  function wiegen(m) {
    if (ruhig) return m;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uZeit = zeit;
      sh.vertexShader = 'uniform float uZeit;\n' + sh.vertexShader.replace('#include <project_vertex>', `
        vec4 mvPosition = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          vec3 ip = instanceMatrix[3].xyz;
          float ph = dot( ip, vec3( 1.7, 0.6, 1.1 ) );
          float hub = clamp( length( position.xy ), 0.0, 1.0 );   // am Ansatz still, an der Spitze am stärksten
          float boe = 0.6 + 0.4 * sin( uZeit * 0.35 + ip.z * 0.15 );
          mvPosition.xyz += vec3( sin( uZeit * 1.6 + ph ), 0.15 * sin( uZeit * 2.3 + ph ), cos( uZeit * 1.2 + ph * 1.3 ) ) * 0.016 * hub * boe;
        #endif
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    };
    m.customProgramCacheKey = () => 'requisiten-wiegen';
    return m;
  }
  const pflanzenMat = wiegen(halt(new THREE.MeshStandardMaterial({
    map: atlasErsatz, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9,
    emissive: '#ffffff', emissiveMap: atlasErsatz, emissiveIntensity: abend ? 0.07 : 0,
  })));
  schrittPflanzen = () => einsetzen([[pflanzenMat, ['map', 'emissiveMap'], canvasTex(malAtlas(ZELLE))]]);
  // Ebene mit UV auf ein Atlasfeld; Ursprung unten (für Zweige: links)
  const feldGeo = {};
  function zellenGeo(i, anker = 'unten') {
    const key = i + anker;
    if (feldGeo[key]) return feldGeo[key];
    const g = halt(new THREE.PlaneGeometry(1, 1));
    const uv = g.attributes.uv, u0 = (i % 4) / 4, v0 = 1 - (Math.floor(i / 4) + 1) / 2;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) / 4, v0 + uv.getY(k) / 2);
    if (anker === 'unten') g.translate(0, 0.5, 0);
    if (anker === 'links') g.translate(0.5, 0, 0);
    return (feldGeo[key] = g);
  }

  // Instanzen sammeln, am Ende je Art ein InstancedMesh
  const sammel = new Map();
  const hilf = new THREE.Object3D();
  function instanz(art, p, blick, dreh, sx, sy = sx) {
    hilf.position.copy(p); hilf.up.set(0, 1, 0); hilf.lookAt(blick); hilf.rotateZ(dreh); hilf.scale.set(sx, sy, 1); hilf.updateMatrix();
    if (!sammel.has(art)) sammel.set(art, []);
    sammel.get(art).push(hilf.matrix.clone());
  }
  function kistenInstanz(liste, p, rotY, sx, sy, sz) {
    hilf.position.copy(p); hilf.rotation.set(0, rotY, 0); hilf.scale.set(sx, sy, sz); hilf.updateMatrix();
    liste.push(hilf.matrix.clone());
  }
  const kaesten = [], kastenHauben = [], kastenFarben = [];
  const KASTENFARBEN = ['#7a5a43', '#6b4a35', '#5f7466', '#8a6a4f'];

  // Ein Blumenkasten auf einer Fensterbank: pos = Mitte vorne auf dem Sims, normal zeigt von der Wand weg
  function blumenkasten(pos, normal, breite, seed) {
    const r = zufall(seed * 7919 + 17);
    const n = new THREE.Vector3(normal.x, 0, normal.z).normalize();
    const tang = new THREE.Vector3(-n.z, 0, n.x);
    const rotY = Math.atan2(n.x, n.z);
    const b = Math.max(0.5, breite * 0.92), hk = 0.19, tk = 0.2;
    const mitte = pos.clone().addScaledVector(n, tk / 2 + 0.02); mitte.y += hk / 2;
    kistenInstanz(kaesten, mitte, rotY, b, hk, tk);
    kastenFarben.push(KASTENFARBEN[Math.floor(r() * KASTENFARBEN.length)]);
    const oben = pos.y + hk;
    if (schnee) kistenInstanz(kastenHauben, new THREE.Vector3(mitte.x, oben + 0.012, mitte.z).addScaledVector(n, 0.005), rotY, b + 0.03, 0.035, tk + 0.03);
    // Blickrichtung der Blüten: von der Wand weg, etwas nach oben und die Gasse hinunter (zur Kamera)
    const vorne = new THREE.Vector3(0, 0, 1);
    const blickRicht = n.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, 0.55, 0)).addScaledVector(vorne, Math.abs(n.z) > 0.7 ? 0.2 : 0.75).normalize();
    const punkt = (u, tiefe, hoehe) => mitte.clone().addScaledVector(tang, u).addScaledVector(n, tiefe).setY(oben + hoehe);
    const nb = Math.round(b * 13), nl = Math.round(b * 12), nc = Math.max(1, Math.round(b * 3.2));
    for (let i = 0; i < nl; i++) {
      // Blattbüschel: teils aufrecht, teils über den vorderen Rand hängend
      const vorn = r() < 0.45;
      const p = punkt((r() - 0.5) * b * 0.98, vorn ? tk * 0.45 : (r() - 0.5) * 0.12, vorn ? 0.0 : -0.03);
      const ziel = p.clone().add(n.clone().multiplyScalar(0.6 + r())).addScaledVector(tang, (r() - 0.5) * 1.5);
      instanz('blatt', p, ziel, vorn ? Math.PI + (r() - 0.5) * 1.6 : (r() - 0.5) * 0.7, 0.26 + r() * 0.1, 0.28 + r() * 0.14);
    }
    for (let i = 0; i < nb; i++) {
      const p = punkt((r() - 0.5) * b * 0.95, (r() - 0.25) * 0.14, 0.08 + r() * 0.2);
      const ziel = p.clone().add(blickRicht).add(new THREE.Vector3((r() - 0.5) * 0.5, (r() - 0.5) * 0.4, (r() - 0.5) * 0.5));
      const s = 0.12 + r() * 0.06;
      const art = r() < 0.12 ? 3 : r() < 0.45 ? 0 : r() < 0.7 ? 1 : 2;
      instanz('stroh' + art, p.addScaledVector(blickRicht, -s * 0.2).setY(p.y - s * 0.5), ziel, r() * 6.3, s);
    }
    for (let i = 0; i < nc; i++) {
      const p = punkt((r() - 0.5) * b * 0.85, 0.04 + r() * 0.05, 0.05 + r() * 0.1);
      const ziel = p.clone().add(blickRicht).add(new THREE.Vector3(0, -0.15, 0));
      instanz('christ', p, ziel, r() * 6.3, 0.13 + r() * 0.04);
    }
    if (schnee) {
      // Tannenzweige hängen vorne über den Kastenrand
      const nz = Math.round(b * 9);
      for (let i = 0; i < nz; i++) {
        const u = (i + 0.5) / nz - 0.5 + (r() - 0.5) * 0.06;
        const p = mitte.clone().addScaledVector(tang, u * b).addScaledVector(n, tk / 2 + 0.015).setY(oben + 0.01);
        const ziel = p.clone().add(n).add(new THREE.Vector3(0, 0.6, 0));
        const s = 0.32 + r() * 0.14;
        // abwechselnd schräg nach unten hängend und flach dem Rand entlang
        const w = i % 3 === 2 ? (u > 0 ? -0.15 : Math.PI + 0.15) : -Math.PI / 2 + (u > 0 ? -1 : 1) * (0.35 + r() * 0.5);
        instanz('zweig', p, ziel, w, s, s * 0.62);
      }
    }
    return { oben, mitte };
  }

  // ---------- Die Nummer 13 ----------
  const nr = ctx.nr13 || { x: 0, z: ctx.strasse?.ENDE ?? -44, breite: 8.6, hoehe: 13.5, eg: 5.0 };
  const B = nr.breite, H = nr.hoehe, EG = nr.eg;
  const haus = new THREE.Group(); haus.position.set(nr.x, 0, nr.z); wurzel.add(haus);
  const welt = (x, y, z) => new THREE.Vector3(nr.x + x, y, nr.z + z);
  // sichtbare Breite: die Nachbarhäuser stehen bei ±BREITE/2 und verdecken die Ränder der Fassade
  const BV = Math.min(B, (ctx.strasse?.BREITE ?? B + 1) - 0.1);
  const k = Math.min(1.15, BV / 8.6 * 1.03);
  const randB = Math.max(0.45, (BV - 6.92 * k) / 2);
  const wl = 1.9 * k, wt = 1.3 * k, wr = 3.4 * k, steg = 0.16 * k;
  const xL0 = -BV / 2 + randB, xL1 = xL0 + wl, xT0 = xL1 + steg, xT1 = xT0 + wt, xR0 = xT1 + steg, xR1 = xR0 + wr;
  const GL0 = 0.62, GL1 = 3.6, TUER = 2.72, ZG = -0.14, ZT = -0.32;
  const OEFF = { L: [xL0, xL1, GL0, GL1], T: [xT0, xT1, 0, GL1], R: [xR0, xR1, GL0, GL1] };

  // Ladenfront: gestrichene Holzverkleidung mit drei Öffnungen
  {
    const form = new THREE.Shape();
    form.moveTo(0, 0); form.lineTo(B, 0); form.lineTo(B, EG); form.lineTo(0, EG); form.lineTo(0, 0);
    for (const [x0, x1, y0, y1] of Object.values(OEFF)) {
      const loch = new THREE.Path(); loch.moveTo(x0 + B / 2, y0); loch.lineTo(x0 + B / 2, y1); loch.lineTo(x1 + B / 2, y1); loch.lineTo(x1 + B / 2, y0); loch.lineTo(x0 + B / 2, y0);
      form.holes.push(loch);
    }
    const geo = new THREE.ShapeGeometry(form); geo.translate(-B / 2, 0, 0);
    // m = Pixel pro Meter; fein: mit Wasserflecken und Rauschen (nur im Schritt, nicht im Ersatz)
    const malHolz = (m, fein) => {
    const [c, g] = flaeche(B * m, EG * m, fein), W = c.width, Hh = c.height;
    const r = zufall(1313);
    g.fillStyle = F.rahmen; g.fillRect(0, 0, W, Hh);
    // senkrechte Bretter
    for (let x = 0; x < W; x += 0.14 * m) { g.fillStyle = 'rgba(30,40,40,.16)'; g.fillRect(x, 0, Math.max(1, 0.012 * m), Hh); g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x + 0.014 * m, 0, Math.max(1, 0.01 * m), Hh); }
    // Fries oben (Schildfeld) und Sockel
    const yF = Hh - GL1 * m;
    g.fillStyle = F.rahmenHell; g.fillRect(0, 0, W, yF - 0.18 * m);
    g.fillStyle = 'rgba(20,30,30,.28)'; g.fillRect(0, yF - 0.18 * m, W, 0.04 * m); g.fillRect(0, 0.12 * m, W, 0.03 * m);
    g.fillStyle = F.rahmenTief; g.fillRect(0, Hh - GL0 * m, W, GL0 * m);
    // Wetterspuren unten und Wasserflecken
    const sp = g.createLinearGradient(0, Hh - 0.9 * m, 0, Hh); sp.addColorStop(0, 'rgba(40,40,35,0)'); sp.addColorStop(1, 'rgba(40,40,35,.35)');
    g.fillStyle = sp; g.fillRect(0, Hh - 0.9 * m, W, 0.9 * m);
    if (fein) {
      for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '40,50,50' : '230,240,235'},${0.03 + r() * 0.05})`; g.beginPath(); g.ellipse(r() * W, r() * Hh, 6 + r() * 30, 4 + r() * 18, 0, 0, 7); g.fill(); }
      rauschen(g, W, Hh, r, 10);
    }
    return c;
    };
    const wand = (t) => { t.repeat.set(1 / B, 1 / EG); t.offset.set(0.5, 0); return t; };
    const holz = halt(new THREE.MeshStandardMaterial({ map: wand(ersatz(malHolz(3, false))), roughness: 0.75 }));
    teil(geo, holz, 0, 0, 0, haus);
    front.push(() => [holz, ['map'], wand(canvasTex(malHolz(PXM, true)))]);
  }

  // Rahmen und Laibungen um die Öffnungen (echte Tiefe)
  const rahmenMat = mat(F.rahmenHell, { roughness: 0.6 });
  const laibungMat = mat(F.rahmenTief, { roughness: 0.8 });
  function rahmen(x0, x1, y0, y1, zGlas, breite = 0.1) {
    const tiefe = -zGlas + 0.07, zc = zGlas / 2 + 0.035;
    kiste(breite, y1 - y0 + breite, tiefe, laibungMat, x0 + breite / 2 - 0.02, (y0 + y1) / 2, zc, haus);
    kiste(breite, y1 - y0 + breite, tiefe, laibungMat, x1 - breite / 2 + 0.02, (y0 + y1) / 2, zc, haus);
    kiste(x1 - x0, breite, tiefe, laibungMat, (x0 + x1) / 2, y1 - breite / 2 + 0.02, zc, haus);
    // vorstehende Deckleisten
    kiste(0.07, y1 - y0 + 0.14, 0.05, rahmenMat, x0 - 0.035, (y0 + y1) / 2 + 0.035, 0.03, haus);
    kiste(0.07, y1 - y0 + 0.14, 0.05, rahmenMat, x1 + 0.035, (y0 + y1) / 2 + 0.035, 0.03, haus);
    kiste(x1 - x0 + 0.14, 0.07, 0.05, rahmenMat, (x0 + x1) / 2, y1 + 0.035, 0.03, haus);
  }
  rahmen(xL0, xL1, GL0, GL1, ZG); rahmen(xR0, xR1, GL0, GL1, ZG); rahmen(xT0, xT1, 0, GL1, ZT, 0.08);
  // Blechsims unter den Schaufenstern
  for (const [x0, x1] of [[xL0, xL1], [xR0, xR1]]) {
    kiste(x1 - x0 + 0.16, 0.05, 0.26, mat('#9aa3a3', { roughness: 0.45, metalness: 0.3 }), (x0 + x1) / 2, GL0 - 0.02, 0.04, haus);
    if (schnee) kiste(x1 - x0 + 0.14, 0.03, 0.22, mat(F.schnee, { roughness: 1 }), (x0 + x1) / 2, GL0 + 0.02, 0.05, haus);
  }
  // Wandfelder mit Andreaskreuz links und rechts (wie am Laden)
  for (const [x0, x1] of [[-BV / 2, xL0 - 0.07], [xR1 + 0.07, BV / 2]]) {
    const b = x1 - x0 - 0.2, h = GL1 - GL0 - 0.3, cx = (x0 + x1) / 2, cy = (GL0 + GL1) / 2 + 0.05;
    if (b < 0.25) continue;
    const lm = mat(F.rahmenHell, { roughness: 0.65 });
    kiste(b, 0.06, 0.04, lm, cx, cy - h / 2, 0.02, haus); kiste(b, 0.06, 0.04, lm, cx, cy + h / 2, 0.02, haus);
    kiste(0.06, h, 0.04, lm, cx - b / 2, cy, 0.02, haus); kiste(0.06, h, 0.04, lm, cx + b / 2, cy, 0.02, haus);
    const diag = Math.hypot(b, h), w = Math.atan2(h, b);
    kiste(diag, 0.06, 0.03, lm, cx, cy, 0.015, haus).rotation.z = w;
    kiste(diag, 0.06, 0.03, lm, cx, cy, 0.015, haus).rotation.z = -w;
  }

  // Schaufenster und Tür mit den echten Fotos
  function scheibe(name, a, x0, x1, y0, y1, z, staerke) {
    const w = x1 - x0, h = y1 - y0;
    const sch = { name, a, wM: w, hM: h, fern: null, nah: null, mat: null };
    sch.mat = fotoMaterial(ersatzFarbe(a[4] || '#5a4430'), staerke);
    bild(name, () => {});                       // das Foto lädt schon im Hintergrund, eingesetzt wird es in stufen[3]
    scheiben.push(sch);
    teil(new THREE.PlaneGeometry(w, h), sch.mat, (x0 + x1) / 2, (y0 + y1) / 2, z, haus);
    teil(new THREE.PlaneGeometry(w, h), spiegelMaterial(), (x0 + x1) / 2, (y0 + y1) / 2, z + 0.004, haus);
  }
  scheibe('fenster', AUS.links, xL0, xL1, GL0, GL1, ZG, 1);
  scheibe(abend ? 'fenster' : 'tag', abend ? AUS.rechts : AUS.rechtsTag, xR0, xR1, GL0, GL1, ZG, abend ? 1 : 0.8);
  scheibe('fenster', AUS.oberlicht, xT0 + 0.06, xT1 - 0.06, TUER + 0.1, GL1 - 0.06, ZG, 1);
  // Kämpfer zwischen Tür und Oberlicht
  kiste(wt, 0.1, 0.24, rahmenMat, (xT0 + xT1) / 2, TUER + 0.05, ZG - 0.02, haus);
  // Türflügel: Rahmen, Füllung unten, Glas mit Blick in den Laden, Griff
  {
    const tx = (xT0 + xT1) / 2, tb = wt - 0.1, zT = ZT;
    const fm = mat(F.rahmen, { roughness: 0.6 });
    kiste(tb, 0.55, 0.06, fm, tx, 0.275 + 0.02, zT, haus);
    kiste(0.12, TUER - 0.02, 0.06, fm, tx - tb / 2 + 0.06, TUER / 2, zT, haus);
    kiste(0.12, TUER - 0.02, 0.06, fm, tx + tb / 2 - 0.06, TUER / 2, zT, haus);
    kiste(tb, 0.12, 0.06, fm, tx, TUER - 0.07, zT, haus);
    kiste(tb - 0.2, 0.04, 0.03, mat(F.rahmenHell), tx, 0.45, zT + 0.04, haus);
    scheibe(tief ? 'fenster' : 'innen', tief ? AUS.tuerFoto : AUS.tuer, tx - tb / 2 + 0.12, tx + tb / 2 - 0.12, 0.57, TUER - 0.13, zT + 0.005, 0.95);
    const griff = mat(F.messing, { roughness: 0.35, metalness: 0.8 });
    kiste(0.03, 0.26, 0.03, griff, tx + tb / 2 - 0.16, 1.05, zT + 0.07, haus);
    kiste(0.06, 0.1, 0.02, griff, tx + tb / 2 - 0.16, 0.92, zT + 0.04, haus);
    // Schwelle und Stufe aus Stein
    kiste(wt + 0.3, 0.12, 0.55, mat(F.stein, { roughness: 0.9 }), tx, 0.06, -0.06, haus);
    if (schnee) kiste(wt + 0.28, 0.02, 0.2, mat(F.schnee, { roughness: 1 }), tx, 0.13, 0.12, haus);
  }
  schrittFotos = async () => {
    const namen = [...new Set(scheiben.map((s) => s.name))];
    await hoechstens(Promise.all(namen.map((n) => new Promise((r) => bild(n, r)))), 6000);
    if (weg) return false;
    // gleich die passende Stufe: am Ende der Fahrt scharf, unterwegs die kleine
    fotoNah = (ctx.kamera ? ctx.kamera.position.z - nr.z : 0) < NAH_AB;
    const paare = scheiben.map((s) => {
      const t = s[fotoNah ? 'nah' : 'fern'] = fotoTex(s, fotoNah);
      return [s.mat, s.mat.emissiveMap ? ['map', 'emissiveMap'] : ['map'], t];
    });
    const ok = await einsetzen(paare);
    fotosDa = true;
    return ok;
  };
  // Warme Flächen für licht (Bloom, Spiegelung im Pflaster)
  {
    const l = T.laden ?? (abend ? 1 : 0.45);
    leuchte(welt((xL0 + xL1) / 2, (GL0 + GL1) / 2, ZG + 0.1), '#ffb45c', 1.1 * l, wl / 2);
    leuchte(welt((xR0 + xR1) / 2, (GL0 + GL1) / 2, ZG + 0.1), '#ffb45c', 1.2 * l, wr / 2);
    leuchte(welt((xT0 + xT1) / 2, 1.6, ZT + 0.1), '#ffb866', 0.9 * l, wt / 2);
    // Kugellampen im Schaufenster (im Foto rechts oben und links)
    leuchte(welt(xR0 + wr * 0.72, GL1 - 0.55, ZG + 0.05), '#fff0d0', 1.4 * l, 0.22);
    leuchte(welt(xR0 + wr * 0.35, GL1 - 1.1, ZG + 0.05), '#ffe2b0', 1.0 * l, 0.14);
    leuchte(welt(xL0 + wl * 0.62, GL1 - 1.55, ZG + 0.05), '#ffe2b0', 1.0 * l, 0.14);
  }

  // Fries mit Schild (Logo) und blauer Hausnummer
  const schildB = Math.min(3.9, xR1 - xL0 - 1.2), schildH = schildB * 0.15, schildY = (GL1 + EG) / 2 + 0.08;
  const SCHRIFT_EIGEN = '"Requisiten Sans", "Open Sans", sans-serif', SCHRIFT = '"Open Sans", "Helvetica Neue", Arial, sans-serif';
  let schildVorn = null, nummerMat = null;
  const logo = new Image();
  const logoGeladen = new Promise((r) => { logo.onload = () => r(true); logo.onerror = () => r(false); });
  logo.src = basis + 'logo.png';                // lädt im Hintergrund, gemalt wird im ersten Schritt
  if (!schriftLaden && typeof FontFace !== 'undefined') {
    const f = new FontFace('Requisiten Sans', `url(${basis}fonts/open-sans-600.woff2)`, { weight: '600' });
    schriftLaden = f.load().then((x) => { document.fonts.add(x); return true; }).catch(() => false);
  }
  function schildMalen(W) {
    const [c, g] = flaeche(W, W * 0.15), Hh = c.height; W = c.width;
    g.fillStyle = F.weiss; g.fillRect(0, 0, W, Hh);
    g.strokeStyle = F.tinte; g.lineWidth = Math.max(1, W / 400); g.strokeRect(W * 0.012, Hh * 0.08, W * 0.976, Hh * 0.84);
    const mitLogo = () => { const w = W * 0.84, h = w * logo.naturalHeight / logo.naturalWidth; g.drawImage(logo, (W - w) / 2, (Hh - h) / 2, w, h); };
    return [c, mitLogo];
  }
  function nummerMalen(W) {
    const [c, g] = flaeche(W, W * 0.76), Hh = c.height; W = c.width;
    return [c, (schrift) => {
      g.clearRect(0, 0, W, Hh);
      g.fillStyle = F.gassenblau; g.beginPath(); g.roundRect(0, 0, W, Hh, W * 0.08); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = W * 0.045; g.beginPath(); g.roundRect(W * 0.07, W * 0.07, W - W * 0.14, Hh - W * 0.14, W * 0.05); g.stroke();
      g.fillStyle = '#ffffff'; g.font = `600 ${Math.round(Hh * 0.56)}px ${schrift}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('13', W / 2, Hh * 0.54);
    }];
  }
  // Erster Schritt: Schild und Nr. 13. Logo und Schrift höchstens 4 s abwarten, sonst später nachmalen.
  schrittSchild = async () => {
    const da = await hoechstens(Promise.all([logoGeladen, schriftLaden || Promise.resolve(false)]), 4000);
    if (weg) return false;
    const [c1, logoAuf] = schildMalen(jeStufe([320, 768, 1024]));
    const t1 = canvasTex(c1, true, !tief);
    if (da && da[0]) logoAuf();
    else logoGeladen.then((ok) => { if (ok && !weg) { logoAuf(); t1.needsUpdate = true; malen(); } });
    const [c2, zahl] = nummerMalen(jeStufe([64, 224, 320]));
    const t2 = canvasTex(c2, true, !tief);
    zahl(da && da[1] ? SCHRIFT_EIGEN : SCHRIFT);
    if (!(da && da[1])) schriftLaden?.then((ok) => { if (ok && !weg) { zahl(SCHRIFT_EIGEN); t2.needsUpdate = true; malen(); } });
    return einsetzen([[schildVorn, ['map', 'emissiveMap'], t1], [nummerMat, ['map', 'emissiveMap'], t2]]);
  };
  {
    const t = ersatz(schildMalen(32)[0]);
    const holz = mat(F.rahmenTief, { roughness: 0.6 });
    const vorn = schildVorn = halt(new THREE.MeshStandardMaterial({ map: t, roughness: 0.45, emissive: '#fff4e0', emissiveMap: t, emissiveIntensity: abend ? 0.32 : 0.04 }));
    const s = teil(new THREE.BoxGeometry(schildB, schildH, 0.05), [holz, holz, holz, holz, vorn, holz], (xL0 + xR1) / 2, schildY, 0.06, haus);
    s.name = 'schild';
    if (schnee) kiste(schildB, 0.025, 0.06, mat(F.schnee, { roughness: 1 }), s.position.x, schildY + schildH / 2 + 0.012, 0.07, haus);
  }
  {
    const [c, zahl] = nummerMalen(16); zahl(SCHRIFT);
    const t = ersatz(c);
    const nb = Math.min(0.5, randB - 0.12), nh = nb * 0.76;
    const nx = (xR1 + 0.07 + BV / 2) / 2, ny = schildY + 0.02;
    kiste(nb + 0.02, nh + 0.02, 0.025, mat('#c9cfd8', { roughness: 0.5, metalness: 0.4 }), nx, ny, 0.035, haus);
    const schild = teil(new THREE.PlaneGeometry(nb, nh), nummerMat = halt(new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: abend ? 0.12 : 0 })), nx, ny, 0.049, haus);
    schild.name = 'hausnummer';
  }

  // Markise: schwarz-weiss gestreift, vorne mit Bogenkante (wie markise.svg)
  {
    const mx0 = xL0 - 0.12, mx1 = xR1 + 0.12, mb = mx1 - mx0, mxc = (mx0 + mx1) / 2;
    const yOben = GL1 + 0.32, aus = 0.95, fall = 0.36, lang = Math.hypot(aus, fall), alpha = Math.atan2(fall, aus);
    const streifen = Math.max(8, Math.round(mb / 0.26)), sb = mb / streifen;
    const ppm = jeStufe([24, 90, 128]);
    // Dach der Markise
    const malTuch = (p) => {
      const [c1, g1] = flaeche(mb * p, 8);
      for (let i = 0; i < streifen; i++) { g1.fillStyle = i % 2 ? F.weiss : F.tinte; g1.fillRect(i * sb * p, 0, sb * p + 1, 8); }
      return c1;
    };
    const tuch = halt(new THREE.MeshStandardMaterial({ map: ersatz(malTuch(6)), side: THREE.DoubleSide, roughness: 0.9 }));
    front.push(() => [tuch, ['map'], canvasTex(malTuch(ppm))]);
    const dach = teil(new THREE.PlaneGeometry(mb, lang, 1, 1), tuch, mxc, yOben - fall / 2, aus / 2 + 0.02, haus);
    dach.rotation.x = -(Math.PI / 2 - alpha);
    // Volant mit Bogen
    const vh = 0.3, bog = sb / 2;
    const malVolant = (P) => {
    const [c2, g2] = flaeche(mb * P, (vh + bog) * P);
    for (let i = 0; i < streifen; i++) {
      const x = i * sb * P, w = sb * P;
      g2.fillStyle = i % 2 ? F.weiss : F.tinte;
      g2.beginPath(); g2.moveTo(x, 0); g2.lineTo(x + w, 0); g2.lineTo(x + w, vh * P); g2.arc(x + w / 2, vh * P, w / 2, 0, Math.PI); g2.closePath(); g2.fill();
      if (i % 2) { g2.strokeStyle = F.tinte; g2.lineWidth = Math.max(1, P * 0.012); g2.beginPath(); g2.arc(x + w / 2, vh * P, w / 2 - g2.lineWidth / 2, 0, Math.PI); g2.stroke(); }
    }
    g2.fillStyle = 'rgba(0,0,0,.18)'; g2.fillRect(0, 0, c2.width, Math.max(1, 0.03 * P));
    return c2;
    };
    const volant = halt(new THREE.MeshStandardMaterial({ map: ersatz(malVolant(16)), side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.9 }));
    front.push(() => [volant, ['map'], canvasTex(malVolant(ppm))]);
    const vy = yOben - fall - (vh + bog) / 2;
    teil(new THREE.PlaneGeometry(mb, vh + bog), volant, mxc, vy, aus + 0.02, haus);
    // Gestänge
    const eisen = mat('#2a2622', { roughness: 0.5, metalness: 0.6 });
    for (const x of [mx0 + 0.05, mx1 - 0.05]) {
      const arm = kiste(0.03, 0.03, lang, eisen, x, yOben - fall / 2 - 0.03, aus / 2 + 0.02, haus); arm.rotation.x = alpha;
    }
    kiste(mb, 0.05, 0.05, eisen, mxc, yOben - fall - 0.02, aus + 0.01, haus);
    kiste(mb + 0.1, 0.12, 0.12, mat(F.rahmenTief), mxc, yOben + 0.02, 0.06, haus);
    if (schnee) {
      // Schneedecke mit unregelmässigem Rand auf dem Tuch
      const malDecke = (w, h) => {
        const [c3, g3] = flaeche(w, h), r = zufall(99);
        g3.scale(1, c3.height / 64); g3.fillStyle = F.schnee; g3.beginPath(); g3.moveTo(0, 64);
        for (let x = 0; x <= c3.width; x += 8) g3.lineTo(x, 10 + r() * 14);
        g3.lineTo(c3.width, 64); g3.fill();
        for (let i = 0; i < 40; i++) { g3.fillStyle = 'rgba(200,210,225,.5)'; g3.beginPath(); g3.ellipse(r() * c3.width, 30 + r() * 30, 4 + r() * 10, 2, 0, 0, 7); g3.fill(); }
        return c3;
      };
      const deckeMat = halt(new THREE.MeshStandardMaterial({ map: ersatz(malDecke(32, 8)), alphaTest: 0.5, roughness: 1, color: '#ffffff' }));
      front.push(() => [deckeMat, ['map'], canvasTex(malDecke(jeStufe([64, 256, 512]), tief ? 16 : 64))]);
      const decke = teil(new THREE.PlaneGeometry(mb, lang * 0.96), deckeMat, mxc, yOben - fall / 2 + 0.035, aus / 2 + 0.04, haus);
      decke.rotation.x = -(Math.PI / 2 - alpha);
      kiste(mb, 0.035, 0.05, mat(F.schnee, { roughness: 1 }), mxc, yOben - fall + 0.01, aus + 0.02, haus);
    }
  }

  // Gurtgesims, Obergeschosse, Traufe und Dach
  const obenH = H - EG;
  const stock = Math.max(1, Math.min(3, Math.floor((obenH - 1.6) / 3.0)));
  const achsen = Math.max(2, Math.min(4, Math.round(B / 2.8)));
  const fb = 1.1, fh = 1.7;
  const fensterOben = [];
  for (let s = 0; s < stock; s++) for (let a = 0; a < achsen; a++) {
    const cx = -B / 2 + (a + 0.5) * B / achsen, y0 = EG + 1.0 + s * 3.0;
    fensterOben.push([cx - fb / 2, cx + fb / 2, y0, y0 + fh]);
  }
  {
    const form = new THREE.Shape();
    form.moveTo(0, 0); form.lineTo(B, 0); form.lineTo(B, obenH); form.lineTo(0, obenH); form.lineTo(0, 0);
    for (const [x0, x1, y0, y1] of fensterOben) {
      const loch = new THREE.Path(); loch.moveTo(x0 + B / 2, y0 - EG); loch.lineTo(x0 + B / 2, y1 - EG); loch.lineTo(x1 + B / 2, y1 - EG); loch.lineTo(x1 + B / 2, y0 - EG); loch.lineTo(x0 + B / 2, y0 - EG);
      form.holes.push(loch);
    }
    const geo = new THREE.ShapeGeometry(form); geo.translate(-B / 2, EG, 0);
    const malPutz = (m, fein) => {
    const [c, g] = flaeche(B * m, obenH * m, fein), W = c.width, Hh = c.height, r = zufall(1314);
    g.fillStyle = F.putz; g.fillRect(0, 0, W, Hh);
    if (fein) for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '120,100,80' : '255,252,245'},${0.03 + r() * 0.04})`; g.beginPath(); g.ellipse(r() * W, r() * Hh, 8 + r() * 40, 5 + r() * 26, 0, 0, 7); g.fill(); }
    // Schmutzfahnen unter den Fenstern
    for (const [x0, x1, y0] of fensterOben) {
      const gx = (x0 + B / 2) * m, gy = Hh - (y0 - EG) * m, gw = (x1 - x0) * m;
      const gr = g.createLinearGradient(0, gy, 0, gy + 0.9 * m); gr.addColorStop(0, 'rgba(110,95,75,.18)'); gr.addColorStop(1, 'rgba(110,95,75,0)');
      g.fillStyle = gr; g.fillRect(gx, gy, gw, 0.9 * m);
    }
    const kanten = g.createLinearGradient(0, 0, 0, Hh); kanten.addColorStop(0, 'rgba(60,50,40,.22)'); kanten.addColorStop(0.08, 'rgba(60,50,40,0)'); kanten.addColorStop(0.94, 'rgba(60,50,40,0)'); kanten.addColorStop(1, 'rgba(60,50,40,.18)');
    g.fillStyle = kanten; g.fillRect(0, 0, W, Hh);
    if (fein) rauschen(g, W, Hh, r, 9);
    return c;
    };
    const wand = (t) => { t.repeat.set(1 / B, 1 / obenH); t.offset.set(0.5, -EG / obenH); return t; };
    const putz = halt(new THREE.MeshStandardMaterial({ map: wand(ersatz(malPutz(2, false))), roughness: 0.92 }));
    teil(geo, putz, 0, 0, 0, haus);
    oben.push(() => [putz, ['map'], wand(canvasTex(malPutz(PXM * 0.6, true)))]);
  }
  kiste(B + 0.1, 0.24, 0.2, mat(F.heu, { roughness: 0.8 }), 0, EG, 0.08, haus);
  if (schnee) kiste(B + 0.1, 0.03, 0.2, mat(F.schnee, { roughness: 1 }), 0, EG + 0.135, 0.08, haus);
  // Fenster der Obergeschosse
  {
    const r = zufall(1315);
    const gewaende = mat(F.gewaende, { roughness: 0.8 });
    const sprosse = mat('#f7f4ee', { roughness: 0.5 });
    const ladenMat = (() => {
      const [c, g] = flaeche(tief ? 16 : 64, tief ? 32 : 128), W = c.width, Hh = c.height;
      g.fillStyle = F.laden; g.fillRect(0, 0, W, Hh);
      for (let y = 4; y < Hh - 4; y += Hh / 26) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(3, y, W - 6, Hh / 70 + 1); g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(3, y + Hh / 70 + 1, W - 6, 1); }
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, Hh - 2);
      return halt(new THREE.MeshStandardMaterial({ map: canvasTex(c), roughness: 0.75 }));
    })();
    // Glas: am Tag spiegelt der Himmel, am Abend brennt in einigen Fenstern Licht hinter Vorhängen
    const glasTag = (() => {
      const [c, g] = flaeche(32 * KL, 64 * KL); g.scale(KL, KL);
      const gr = g.createLinearGradient(0, 0, 0, 64); gr.addColorStop(0, T.horizont); gr.addColorStop(0.5, '#6f86a3'); gr.addColorStop(1, '#2f3a48');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 64);
      g.fillStyle = 'rgba(250,240,225,.45)'; g.fillRect(0, 0, 7, 64); g.fillRect(25, 0, 7, 64);
      return halt(new THREE.MeshStandardMaterial({ map: canvasTex(c, true, false), roughness: 0.08, metalness: 0.1 }));
    })();
    const glasWarm = (() => {
      const [c, g] = flaeche(32 * KL, 64 * KL); g.scale(KL, KL);
      const gr = g.createRadialGradient(16, 22, 2, 16, 32, 40); gr.addColorStop(0, '#ffd89a'); gr.addColorStop(1, '#a8541c');
      g.fillStyle = gr; g.fillRect(0, 0, 32, 64);
      g.fillStyle = 'rgba(255,236,200,.6)'; g.fillRect(0, 0, 8, 64); g.fillRect(24, 0, 8, 64);
      const t = canvasTex(c, true, false);
      return halt(new THREE.MeshStandardMaterial({ color: '#2a1a10', emissive: '#ffb860', emissiveMap: t, emissiveIntensity: 2.0, roughness: 0.2 }));
    })();
    const glasDunkel = mat('#1b222d', { roughness: 0.1, metalness: 0.1 });
    const warm = abend ? Math.max(1, Math.round(fensterOben.length * (T.fenster ?? 0.5))) : 0;
    const reihen = fensterOben.map((_, i) => i).sort(() => r() - 0.5).slice(0, warm);
    fensterOben.forEach(([x0, x1, y0, y1], i) => {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, h = y1 - y0, zg = -0.2;
      const istWarm = reihen.includes(i);
      teil(new THREE.PlaneGeometry(w, h), abend ? (istWarm ? glasWarm : glasDunkel) : glasTag, cx, cy, zg, haus);
      if (istWarm) leuchte(welt(cx, cy, zg + 0.1), '#ffb860', 1.0, w * 0.6);
      // Gewände (Laibung) und Fensterkreuz
      kiste(0.14, h + 0.14, 0.26, gewaende, x0 - 0.05, cy, -0.08, haus); kiste(0.14, h + 0.14, 0.26, gewaende, x1 + 0.05, cy, -0.08, haus);
      kiste(w + 0.24, 0.14, 0.26, gewaende, cx, y1 + 0.05, -0.08, haus);
      kiste(0.05, h, 0.05, sprosse, cx, cy, zg + 0.03, haus); kiste(w, 0.05, 0.05, sprosse, cx, y0 + h * 0.62, zg + 0.03, haus);
      kiste(w, 0.06, 0.05, sprosse, cx, y0 + 0.03, zg + 0.03, haus);
      // Sims aus Stein
      kiste(w + 0.34, 0.08, 0.26, gewaende, cx, y0 - 0.04, 0.05, haus);
      if (schnee) kiste(w + 0.3, 0.03, 0.24, mat(F.schnee, { roughness: 1 }), cx, y0 + 0.015, 0.06, haus);
      // offene Läden
      for (const sx of [x0 - 0.12 - 0.29, x1 + 0.12 + 0.29]) kiste(0.56, h + 0.04, 0.035, ladenMat, sx, cy, 0.025, haus);
      // Blumenkasten
      blumenkasten(welt(cx, y0, 0.08), new THREE.Vector3(0, 0, 1), w + 0.1, 1300 + i);
    });
  }
  // Traufe mit Sparrenköpfen und Dach
  {
    const tr = mat(F.traufe, { roughness: 0.8 });
    kiste(B + 1.0, 0.32, 1.0, tr, 0, H + 0.16, 0.42, haus);
    for (let x = -B / 2 - 0.3; x <= B / 2 + 0.3; x += 0.62) kiste(0.1, 0.12, 0.9, tr, x, H - 0.05, 0.42, haus);
    const dach = kiste(B + 1.0, 0.12, 5.5, mat(schnee ? '#e9edf3' : F.dach, { roughness: 0.95 }), 0, H + 0.32 + Math.sin(0.62) * 2.6, -1.9, haus);
    dach.rotation.x = 0.62;
    if (schnee) kiste(B + 1.0, 0.06, 1.0, mat(F.schnee, { roughness: 1 }), 0, H + 0.35, 0.42, haus);
  }

  // ---------- Vor dem Laden ----------
  // Kranz an der Tür: Tannengrün, Band, weisse Rosen, Zapfen
  {
    const tx = (xT0 + xT1) / 2, ky = 1.98, kz = ZT + 0.08;
    const kranz = new THREE.Group(); kranz.position.set(tx, ky, kz); haus.add(kranz);
    teil(new THREE.TorusGeometry(0.25, 0.075, 8, 28), mat(F.tanne, { roughness: 0.95 }), 0, 0, 0, kranz);
    const r = zufall(77);
    for (let i = 0; i < 26; i++) {
      const w = (i / 26) * Math.PI * 2;
      const p = new THREE.Vector3(Math.cos(w) * 0.25 + nr.x + tx, Math.sin(w) * 0.25 + ky, nr.z + kz + 0.04);
      instanz('zweigKranz', p, p.clone().add(new THREE.Vector3(Math.cos(w) * 0.6, Math.sin(w) * 0.6, 1)), w + Math.PI / 2 + (r() - 0.5) * 0.5, 0.2, 0.09);
    }
    const rose = mat('#fbf8f1', { roughness: 0.7 }), zapfen = mat(F.zapfen, { roughness: 0.9 });
    for (const w of [0.3, 1.0, 2.2, 3.0, 4.3]) teil(new THREE.SphereGeometry(0.05, 10, 8), rose, Math.cos(w) * 0.25, Math.sin(w) * 0.25, 0.07, kranz).scale.set(1, 1, 0.6);
    for (const w of [0.65, 2.6, 3.7, 5.2]) teil(new THREE.SphereGeometry(0.04, 8, 6), zapfen, Math.cos(w) * 0.27, Math.sin(w) * 0.27, 0.06, kranz).scale.set(0.8, 1.3, 0.8);
    const band = mat(F.band, { roughness: 0.7, side: THREE.DoubleSide });
    kiste(0.1, 0.08, 0.03, band, 0, -0.27, 0.08, kranz);
    for (const s of [-1, 1]) { const e = kiste(0.05, 0.3, 0.01, band, s * 0.05, -0.42, 0.08, kranz); e.rotation.z = s * 0.25; }
    kiste(0.025, 0.3, 0.01, band, 0, 0.42, 0.0, kranz);
    if (schnee) teil(new THREE.TorusGeometry(0.25, 0.05, 6, 16, Math.PI * 0.8), mat(F.schnee, { roughness: 1 }), 0, 0.04, 0.03, kranz).rotation.z = Math.PI * 0.1;
  }

  // Laterne mit Kerze vor der Tür
  {
    const lx = xT1 - 0.24, lz = 0.06, unten = 0.12;
    const lat = new THREE.Group(); lat.position.set(lx, unten, lz); haus.add(lat);
    const weissM = mat('#eef0ee', { roughness: 0.5, metalness: 0.3 });
    const lb = 0.2, lh = 0.42;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kiste(0.018, lh, 0.018, weissM, sx * lb / 2, lh / 2, sz * lb / 2, lat);
    for (const y of [0.01, lh]) { kiste(lb + 0.02, 0.025, lb + 0.02, weissM, 0, y, 0, lat); }
    teil(new THREE.ConeGeometry(lb * 0.78, 0.13, 4), weissM, 0, lh + 0.075, 0, lat).rotation.y = Math.PI / 4;
    teil(new THREE.TorusGeometry(0.045, 0.008, 6, 16), weissM, 0, lh + 0.18, 0, lat);
    teil(new THREE.BoxGeometry(lb, lh - 0.04, lb), halt(new THREE.MeshStandardMaterial({ color: '#dfe7ea', transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false })), 0, lh / 2, 0, lat);
    teil(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 14), mat('#f6f1e4', { roughness: 0.6, emissive: '#ffcf8a', emissiveIntensity: 0.25 }), 0, 0.12, 0, lat);
    var flamme = teil(new THREE.SphereGeometry(0.018, 8, 6), halt(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.6, 0.7), toneMapped: false })), 0, 0.245, 0, lat);
    flamme.scale.set(1, 1.9, 1);
    leuchte(welt(lx, unten + 0.25, lz), '#ffc070', abend ? 1.6 : 0.6, 0.18);
    if (schnee) teil(new THREE.ConeGeometry(lb * 0.7, 0.05, 4), mat(F.schnee, { roughness: 1 }), 0, lh + 0.13, 0, lat).rotation.y = Math.PI / 4;
  }

  // Kartenständer aus Draht mit Postkarten, links an der Tür
  {
    const kx = xT0 + 0.26, kz = 0.12;
    const st = new THREE.Group(); st.position.set(kx, 0.12, kz); haus.add(st);
    const [c, g] = flaeche(40 * KL, 120 * KL); g.scale(KL, KL);
    g.strokeStyle = '#d7dad6'; g.lineWidth = 1.5;
    for (let x = 1; x < 40; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 120); g.stroke(); }
    for (let y = 1; y < 120; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(40, y); g.stroke(); }
    teil(new THREE.PlaneGeometry(0.42, 1.3), halt(new THREE.MeshStandardMaterial({ map: canvasTex(c, true), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.5 })), 0, 0.75, 0, st);
    const r = zufall(31);
    const KARTEN = ['#a62c54', '#e2aca0', '#3f5a55', '#e8c22a', '#6f86a3', '#f2b25c', '#cb567d', '#556b4f'];
    for (let i = 0; i < 6; i++) {
      const [cc, gg] = flaeche(24 * KL, 34 * KL); gg.scale(KL, KL);
      gg.fillStyle = '#fbfaf6'; gg.fillRect(0, 0, 24, 34);
      gg.fillStyle = KARTEN[Math.floor(r() * KARTEN.length)]; gg.fillRect(2, 2, 20, 22);
      gg.fillStyle = KARTEN[Math.floor(r() * KARTEN.length)]; gg.beginPath(); gg.arc(12, 13, 5, 0, 7); gg.fill();
      const karte = teil(new THREE.PlaneGeometry(0.15, 0.21), halt(new THREE.MeshStandardMaterial({ map: canvasTex(cc, true, false), roughness: 0.7 })), (i % 2 ? 0.09 : -0.09) + (r() - 0.5) * 0.02, 1.25 - Math.floor(i / 2) * 0.27, 0.03, st);
      karte.rotation.x = -0.12; karte.rotation.z = (r() - 0.5) * 0.08;
    }
    kiste(0.02, 1.42, 0.02, mat('#b9bdb9', { metalness: 0.6, roughness: 0.4 }), -0.21, 0.71, 0, st);
    kiste(0.02, 1.42, 0.02, mat('#b9bdb9', { metalness: 0.6, roughness: 0.4 }), 0.21, 0.71, 0, st);
  }

  // Töpfe und Bänke vor den Schaufenstern
  const topfGeo = halt(new THREE.CylinderGeometry(0.12, 0.09, 0.16, 16));
  const topfFarben = [mat(F.topf, { roughness: 0.85 }), mat('#e9e6df', { roughness: 0.5 }), mat('#9e9a90', { roughness: 0.8 })];
  function topf(x, y, z, art, seed, gross = 1) {
    const r = zufall(seed);
    const t = new THREE.Mesh(topfGeo, topfFarben[Math.floor(r() * 3)]); t.position.set(x, y + 0.08 * gross, z); t.scale.setScalar(gross); haus.add(t);
    teil(new THREE.CylinderGeometry(0.105 * gross, 0.105 * gross, 0.01, 12), mat('#3a2c22'), x, y + 0.155 * gross, z, haus);
    const p0 = welt(x, y + 0.15 * gross, z);
    const blick = (p) => p.clone().add(new THREE.Vector3((r() - 0.5) * 0.6, 0.35, 1));
    if (art === 'glocke') {
      for (let i = 0; i < 3; i++) { const p = p0.clone().add(new THREE.Vector3((r() - 0.5) * 0.12, 0, (r() - 0.5) * 0.08)); instanz('glocke', p, blick(p), (r() - 0.5) * 0.3, 0.26 * gross, 0.3 * gross); }
    } else if (art === 'christ') {
      for (let i = 0; i < 4; i++) { const p = p0.clone().add(new THREE.Vector3((r() - 0.5) * 0.14, -0.02, (r() - 0.5) * 0.1)); instanz('blatt', p, blick(p), (r() - 0.5) * 0.8, 0.24 * gross, 0.24 * gross); }
      for (let i = 0; i < 5; i++) { const p = p0.clone().add(new THREE.Vector3((r() - 0.5) * 0.18, 0.06 + r() * 0.1, (r() - 0.5) * 0.1 + 0.03)); instanz('christ', p, blick(p), r() * 6, 0.1 * gross); }
    } else {
      for (let i = 0; i < 4; i++) { const p = p0.clone().add(new THREE.Vector3((r() - 0.5) * 0.14, -0.02, (r() - 0.5) * 0.1)); instanz('blatt', p, blick(p), (r() - 0.5) * 0.8, 0.22 * gross, 0.22 * gross); }
      for (let i = 0; i < 6; i++) { const p = p0.clone().add(new THREE.Vector3((r() - 0.5) * 0.2, 0.05 + r() * 0.12, (r() - 0.5) * 0.1 + 0.03)); instanz('stroh' + Math.floor(r() * 4), p, blick(p), r() * 6, 0.085 * gross); }
    }
    if (schnee) teil(new THREE.CylinderGeometry(0.1 * gross, 0.12 * gross, 0.03, 12), mat(F.schnee, { roughness: 1 }), x, y + 0.165 * gross, z, haus);
  }
  function bank(x0, x1, z, seed) {
    const bm = mat(F.bank, { roughness: 0.7 }), hb = 0.42, tb = 0.36, cx = (x0 + x1) / 2, b = x1 - x0;
    kiste(b, 0.05, tb, bm, cx, hb, z, haus);
    for (const x of [x0 + 0.08, x1 - 0.08]) { kiste(0.05, hb, tb - 0.04, bm, x, hb / 2, z, haus); }
    kiste(b - 0.1, 0.04, 0.03, bm, cx, 0.12, z, haus);
    if (schnee) kiste(b, 0.03, tb, mat(F.schnee, { roughness: 1 }), cx, hb + 0.04, z, haus);
    return hb + 0.025;
  }
  {
    const zb = 0.34;
    // links: Bank mit Korb voller Zapfen und Töpfen
    const yL = bank(xL0 + 0.05, xL1 - 0.05, zb, 1);
    {
      const kx = xL0 + 0.38, korb = mat('#a07a4a', { roughness: 0.95 });
      teil(new THREE.CylinderGeometry(0.24, 0.18, 0.16, 18, 1, true), korb, kx, yL + 0.08, zb, haus);
      teil(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 18), korb, kx, yL + 0.01, zb, haus);
      const zm = mat(F.zapfen, { roughness: 0.9 }), r = zufall(5);
      for (let i = 0; i < 9; i++) teil(new THREE.SphereGeometry(0.055, 7, 6), zm, kx + (r() - 0.5) * 0.3, yL + 0.15 + r() * 0.04, zb + (r() - 0.5) * 0.2, haus).scale.set(0.8, 1.2, 0.8);
      const henkel = teil(new THREE.TorusGeometry(0.2, 0.012, 6, 20, Math.PI), korb, kx, yL + 0.15, zb, haus);
      henkel.rotation.y = 0.3;
      if (schnee) for (let i = 0; i < 4; i++) teil(new THREE.SphereGeometry(0.04, 6, 5), mat(F.schnee, { roughness: 1 }), kx + (r() - 0.5) * 0.25, yL + 0.2, zb + (r() - 0.5) * 0.15, haus).scale.set(1.4, 0.5, 1.4);
      topf(xL0 + 0.85, yL, zb, 'glocke', 11); topf(xL0 + 1.2, yL, zb, 'christ', 12); topf(xL1 - 0.3, yL, zb - 0.02, 'stroh', 13);
    }
    // rechts: lange Bank mit Schneeglöckchen, Christrosen und Strohblumen
    const yR = bank(xR0 + 0.1, xR1 - 0.1, zb, 2);
    {
      const arten = ['glocke', 'christ', 'glocke', 'stroh', 'glocke', 'christ', 'glocke'];
      const n = Math.max(3, Math.round((wr - 0.4) / 0.42));
      for (let i = 0; i < n; i++) topf(xR0 + 0.3 + i * (wr - 0.6) / (n - 1), yR, zb + (i % 2 ? -0.05 : 0.04), arten[i % arten.length], 20 + i);
    }
    // am Boden vor der Tür: zwei Töpfe
    topf(xT0 + 0.62, 0.12, 0.2, 'christ', 31, 1.2);
    topf(xR0 + 0.25, 0, 0.75, 'glocke', 32, 1.3);
    topf(xL1 - 0.25, 0, 0.72, 'christ', 33, 1.3);
  }

  // Tännchen in Töpfen an beiden Rändern (im Winter verschneit)
  {
    const r = zufall(2024);
    const nadel = mat('#2f4a3c', { roughness: 0.95, flatShading: true });
    const nadelHell = mat(F.tanne, { roughness: 0.95, flatShading: true });
    const schneeM = mat(F.schnee, { roughness: 1, flatShading: true });
    const kegel = (rad, hoehe, seed) => {
      const g = new THREE.ConeGeometry(rad, hoehe, 11, 3);
      const p = g.attributes.position, rr = zufall(seed);
      for (let i = 0; i < p.count; i++) { if (p.getY(i) < hoehe / 2 - 0.01) { const f = 1 + (rr() - 0.5) * 0.35; p.setX(i, p.getX(i) * f); p.setZ(i, p.getZ(i) * f); p.setY(i, p.getY(i) + (rr() - 0.5) * 0.04); } }
      g.computeVertexNormals(); return g;
    };
    for (const s of [-1, 1]) {
      const x = s * (BV / 2 - randB / 2 + 0.02), z = 0.5;
      const pot = teil(new THREE.CylinderGeometry(0.3, 0.24, 0.5, 18), mat('#8f948f', { roughness: 0.8 }), x, 0.25, z, haus);
      pot.name = 'tannentopf';
      teil(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), mat('#4a3626'), x, 0.6, z, haus);
      const stufen = 5, hoeheBaum = 1.65;
      for (let i = 0; i < stufen; i++) {
        const f = i / stufen, rad = 0.52 * (1 - f * 0.78), h = 0.55 * (1 - f * 0.35);
        const y = 0.62 + f * hoeheBaum * 0.82 + h / 2;
        const k1 = teil(kegel(rad, h, 300 + i + (s + 1) * 10), i % 2 ? nadelHell : nadel, x, y, z, haus);
        k1.rotation.y = r() * 3;
        if (schnee) { const k2 = teil(kegel(rad * 0.86, h * 0.45, 400 + i + (s + 1) * 10), schneeM, x, y + h * 0.3, z, haus); k2.rotation.y = r() * 3; }
      }
      if (schnee) teil(new THREE.CylinderGeometry(0.27, 0.28, 0.05, 14), schneeM, x, 0.52, z, haus);
    }
  }

  // Schlitten im Winter, an die linke Bank gelehnt (wie auf dem Winterfoto)
  if (schnee) {
    const hz = mat('#b5834f', { roughness: 0.7 });
    const sl = new THREE.Group(); sl.position.set(xL0 + 0.05, 0, 0.75); sl.rotation.set(-0.95, 0.35, 0); haus.add(sl);
    for (const sx of [-0.17, 0.17]) {
      const kurve = new THREE.CatmullRomCurve3([new THREE.Vector3(sx, 0, 0), new THREE.Vector3(sx, 0, 0.75), new THREE.Vector3(sx, 0.06, 0.9), new THREE.Vector3(sx, 0.18, 0.92), new THREE.Vector3(sx, 0.2, 0.8)]);
      teil(new THREE.TubeGeometry(kurve, 20, 0.018, 6), hz, 0, 0, 0, sl);
      for (const zz of [0.12, 0.62]) kiste(0.03, 0.2, 0.03, hz, sx, 0.1, zz, sl);
    }
    for (let i = 0; i < 5; i++) kiste(0.42, 0.02, 0.08, hz, 0, 0.21, 0.08 + i * 0.13, sl);
    kiste(0.42, 0.02, 0.2, mat(F.schnee, { roughness: 1 }), 0, 0.23, 0.35, sl);
  }

  // ---------- Blumenkästen an den Fensterbänken der Gasse ----------
  const baenke = Array.isArray(anker.fensterbaenke) ? anker.fensterbaenke : [];
  baenke.forEach((fb, i) => {
    if (!fb || !fb.pos || !fb.normal) return;
    blumenkasten(fb.pos, fb.normal, fb.breite || 1.1, i + 1);
  });

  // Kästen und Schneehauben als InstancedMesh (eine Zeichnung je Art)
  if (kaesten.length) {
    const g = halt(new THREE.BoxGeometry(1, 1, 1));
    const im = new THREE.InstancedMesh(g, mat('#ffffff', { roughness: 0.8 }), kaesten.length);
    const farbe = new THREE.Color();
    kaesten.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, farbe.set(kastenFarben[i])); });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.name = 'blumenkaesten';
    wurzel.add(im);
  }
  if (kastenHauben.length) {
    const g = halt(new THREE.BoxGeometry(1, 1, 1));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setY(i, p.getY(i) + 0.6);   // gewölbte Haube
    const im = new THREE.InstancedMesh(g, mat(F.schnee, { roughness: 1 }), kastenHauben.length);
    kastenHauben.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere(); wurzel.add(im);
  }
  // Blüten, Blätter, Zweige
  const ARTEN = { stroh0: [0, 'unten'], stroh1: [1, 'unten'], stroh2: [2, 'unten'], stroh3: [3, 'unten'], christ: [4, 'unten'], blatt: [5, 'unten'], zweig: [6, 'links'], zweigKranz: [6, 'mitte'], glocke: [7, 'unten'] };
  for (const [art, liste] of sammel) {
    const [zelle, ank] = ARTEN[art];
    const im = new THREE.InstancedMesh(zellenGeo(zelle, ank), pflanzenMat, liste.length);
    liste.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere(); im.name = 'pflanzen-' + art;
    wurzel.add(im);
  }

  // ---------- Schneeflocken: folgen der Kamera, fallen im Vertex-Shader ----------
  let flocken = null;
  if (schnee) {
    const n = q === 'hoch' ? 6000 : q === 'mittel' ? 3500 : 1800;
    const BOX = new THREE.Vector3(26, 16, 44);
    const pos = new Float32Array(n * 3), zuf = new Float32Array(n), r = zufall(5);
    for (let i = 0; i < n; i++) { pos[i * 3] = r() * BOX.x; pos[i * 3 + 1] = r() * BOX.y; pos[i * 3 + 2] = r() * BOX.z; zuf[i] = r(); }
    const geo = halt(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aZufall', new THREE.BufferAttribute(zuf, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const farbe = abend ? new THREE.Color('#c9d2e2') : new THREE.Color('#ffffff');
    const fm = halt(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uZeit: { value: 0 }, uMitte: { value: new THREE.Vector3() }, uBox: { value: BOX }, uGroesse: { value: 300 },
        uFarbe: { value: farbe }, uDeckung: { value: 0 },   // unsichtbar bis stufen[4], dann eingeblendet
      }]),
      vertexShader: `
        uniform float uZeit, uGroesse; uniform vec3 uMitte, uBox;
        attribute float aZufall; varying float vA;
        #include <fog_pars_vertex>
        void main() {
          vec3 p = position;
          p.y -= uZeit * (0.55 + aZufall * 0.55);
          p.x += sin(uZeit * 0.6 + aZufall * 31.0) * 0.45 + uZeit * 0.12;
          p.z += cos(uZeit * 0.45 + aZufall * 17.0) * 0.3;
          vec3 w = uMitte - uBox * 0.5 + mod(p - (uMitte - uBox * 0.5), uBox);
          vec4 mvPosition = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float d = max(0.3, -mvPosition.z);
          float px = uGroesse * (0.55 + aZufall * 0.9) / d;
          gl_PointSize = clamp(px, 1.0, 40.0);
          vA = clamp(px / 1.6, 0.0, 1.0) * smoothstep(0.3, 1.6, d);
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform vec3 uFarbe; uniform float uDeckung; varying float vA;
        #include <fog_pars_fragment>
        void main() {
          vec2 c = gl_PointCoord - 0.5; float r2 = dot(c, c);
          if (r2 > 0.25) discard;
          float a = smoothstep(0.25, 0.02, r2) * vA * uDeckung;
          gl_FragColor = vec4(uFarbe, a);
          #include <fog_fragment>
        }`,
    }));
    flocken = new THREE.Points(geo, fm);
    flocken.frustumCulled = false; flocken.renderOrder = 10; flocken.name = 'schneeflocken';
    flocken.userData.keinSchatten = true;
    wurzel.add(flocken);
  }
  const blick = new THREE.Vector3();
  const groessePx = new THREE.Vector2();
  function flockenNachfuehren() {
    if (!flocken) return;
    const k = ctx.kamera, u = flocken.material.uniforms;
    k.getWorldDirection(blick); blick.y = 0; if (blick.lengthSq() < 1e-4) blick.set(0, 0, -1); blick.normalize();
    u.uMitte.value.set(k.position.x + blick.x * 18, 8, k.position.z + blick.z * 18);
    ctx.renderer.getDrawingBufferSize(groessePx);
    u.uGroesse.value = 0.035 * groessePx.y * 0.5 / Math.tan(THREE.MathUtils.degToRad((k.fov || 50) / 2));
    u.uZeit.value = zeit.value;
  }
  flockenNachfuehren();

  // Zählung für den Bericht: feste Texturen plus die gerade benutzte Fotostufe; dazu beide Stufen einzeln
  function infoSetzen() {
    const fern = scheiben.reduce((n, s) => n + fotoMass(s, false).bytes, 0);
    const nah = scheiben.reduce((n, s) => n + fotoMass(s, true).bytes, 0);
    const kb = (x) => Math.round(x / 1024);
    ctx.requisitenInfo = { texturKB: kb(texBytes + (fotoNah ? nah : fern)), fernKB: kb(texBytes + fern), nahKB: kb(texBytes + nah), leuchten: meineLeuchten.length, kaesten: kaesten.length };
  }
  infoSetzen();

  // Stufe 4: die Flocken über 1.5 s einblenden (nach Uhrzeit, damit es auch mit wenigen Bildern fertig wird)
  const flockenZiel = abend ? 0.75 : 0.9;
  let flockenAb = null;
  const schrittFlocken = () => {
    if (!flocken || weg) return false;
    if (ruhig) flocken.material.uniforms.uDeckung.value = flockenZiel; else flockenAb = performance.now();
    return true;
  };
  const stufen = { 3: [schrittSchild, schrittFotos, ausListe(front), ausListe(oben), schrittPflanzen], 4: [schrittFlocken] };
  if (!stufig) {
    (async () => {
      for (const n of [3, 4]) for (const fn of stufen[n]) {
        if (weg) return;
        try { await fn(ctx); } catch (e) { console.error('requisiten.stufen', e); }
      }
    })();
  }

  let flackern = 0;
  return {
    stufen: stufig ? stufen : undefined,
    aktualisieren(t, dt) {
      if (weg) return false;
      flockenNachfuehren();
      fotoPruefen();
      let weiter = false;
      if (flockenAb !== null) {
        const f = Math.min(1, (performance.now() - flockenAb) / 1500);
        flocken.material.uniforms.uDeckung.value = flockenZiel * f * f * (3 - 2 * f);
        if (f >= 1) flockenAb = null; else weiter = true;
      }
      if (ruhig) return weiter;
      let d = Number.isFinite(dt) ? dt : 0.016;
      if (d > 1) d /= 1000;                 // falls Millisekunden
      zeit.value += Math.min(0.1, Math.max(0, d));
      flackern += d;
      if (flamme) { const f = 1 + Math.sin(flackern * 13) * 0.08 + Math.sin(flackern * 7.3) * 0.06; flamme.scale.set(1, 1.9 * f, 1); }
      flockenNachfuehren();
      return true;
    },
    entsorgen() {
      weg = true;
      wurzel.removeFromParent();
      wurzel.traverse((o) => {
        if (o.geometry) frei.add(o.geometry);
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) frei.add(m);
        if (o.isInstancedMesh) o.dispose();
      });
      for (const x of frei) x.dispose?.();
      frei.clear(); matCache.clear();
      for (const l of meineLeuchten) { const i = anker.leuchten.indexOf(l); if (i >= 0) anker.leuchten.splice(i, 1); }
      meineLeuchten.length = 0;
    },
  };
}
