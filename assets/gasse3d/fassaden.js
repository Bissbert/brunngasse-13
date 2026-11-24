// Modul fassaden der WebGL-Gasse. Vertrag: stimmung/VERTRAG.md
// Baut die Häuserzeilen aus ctx.haeuser (die Nummer 13 baut requisiten):
// Putz mit Relief (Normalkarte), Schmutz- und Leuchtkarte je Haus, echte Laibungen, Gewände oder gemalte Faschen,
// Fensterbänke, Rahmen mit Sprossen, Jalousieläden, Türen mit Oberlicht, Auslagen, Gurt- und Traufgesimse,
// Dachvorsprung mit Sparren, Rinne und Fallrohr, Ziegeldach mit Gauben und Kaminen, Schneekanten im Winter.
// Hinter dem Glas liegen Räume (Interior Mapping im Shader, nur bei q='hoch'); tagsüber spiegelt das Glas
// Himmel und Gegenseite, am Abend leuchtet ein Teil der Fenster warm (Anteil T.fenster).
// Schreibt anker.fensterbaenke, anker.gesimse und warme Fenster in anker.leuchten.
import { zufall } from './gemeinsam.js';

const FARBEN = {
  laden: ['#3f5a55', '#7d2e2e', '#556b4f', '#6b4a35', '#3b4a5c', '#8a7a5c'],
  tuer: ['#2f4a3c', '#5a2626', '#4a3324', '#34404c', '#6b4a2e', '#3d3a36', '#44533f'],
  stein: ['#bcb39f', '#aaa696', '#c9c0ae', '#9e9b90', '#d3cbbb', '#b3a58c'],
  rahmen: ['#f1ece2', '#f1ece2', '#efe8da', '#e9e2d4', '#4b3a2c', '#3c4a42'],
};

export function bauen(ctx) {
  const { THREE, szene, S, T } = ctx;
  const q = ctx.q || 'hoch';
  const tag = S === 'tag';
  const schnee = !!T.schnee;
  const t0 = performance.now();
  const BREITE = ctx.strasse ? ctx.strasse.BREITE : 7.8;
  const anker = ctx.anker || (ctx.anker = {});
  anker.fensterbaenke = anker.fensterbaenke || [];
  anker.gesimse = anker.gesimse || [];
  anker.leuchten = anker.leuchten || [];

  const gruppe = new THREE.Group();
  gruppe.name = 'fassaden';
  const texturen = [];
  const materialien = [];
  let bytes = 0;
  let entsorgt = false;
  const liste = [];

  // ---------- Texturen aus Canvas ----------
  const leinwand = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
  function textur(c, farbe, kachel = true, mip = true) {
    const t = new THREE.CanvasTexture(c);
    if (farbe) t.colorSpace = THREE.SRGBColorSpace;
    if (kachel) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = q === 'tief' ? 2 : 8;
    if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
    texturen.push(t);
    bytes += c.width * c.height * 4 * (mip ? 4 / 3 : 1);
    liste.push(c.width + 'x' + c.height + (mip ? 'm' : ''));
    return t;
  }
  // Die Pixelschleifen sind Generatoren: alle 8 Zeilen ein yield. In stufen[3]/[4] laufen sie stückweise (ctx.rast),
  // in bauen am Stück (nur noch für winzige Karten).
  function sofort(gen) { let x; do x = gen.next(); while (!x.done); return x.value; }
  const AUS = new Error('fassaden entsorgt');
  async function stueckweise(gen) {
    let x;
    while (!(x = gen.next()).done) { if (ctx.rast) await ctx.rast(); if (entsorgt) throw AUS; }
    return x.value;
  }
  // Kachelbares Wertrauschen, n×n, Werte 0..1
  function* rauschen(n, r, zellen, oktaven, pers = 0.5) {
    const f = new Float32Array(n * n);
    let amp = 1, summe = 0;
    for (let o = 0; o < oktaven; o++) {
      const g = zellen << o, gitter = new Float32Array(g * g);
      for (let i = 0; i < gitter.length; i++) gitter[i] = r();
      for (let y = 0; y < n; y++) {
        const gy = y * g / n, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy), y1 = (y0 + 1) % g;
        for (let x = 0; x < n; x++) {
          const gx = x * g / n, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx), x1 = (x0 + 1) % g;
          const a = gitter[y0 * g + x0], b = gitter[y0 * g + x1], c = gitter[y1 * g + x0], d = gitter[y1 * g + x1];
          const o1 = a + (b - a) * sx, o2 = c + (d - c) * sx;
          f[y * n + x] += amp * (o1 + (o2 - o1) * sy);
        }
        if ((y & 7) === 7) yield;
      }
      summe += amp; amp *= pers;
    }
    for (let i = 0; i < f.length; i++) f[i] /= summe;
    return f;
  }
  // Normalkarte aus einem kachelbaren Höhenfeld (Breite n, Höhe m); Canvas-Zeilen laufen nach unten = v nach unten
  function* normalKarte(hf, n, m, staerke) {
    const [c, g] = leinwand(n, m), d = g.createImageData(n, m), a = d.data;
    for (let y = 0; y < m; y++) {
      for (let x = 0; x < n; x++) {
        const l = hf[y * n + (x - 1 + n) % n], rr = hf[y * n + (x + 1) % n];
        const o = hf[((y - 1 + m) % m) * n + x], u = hf[((y + 1) % m) * n + x];
        let nx = (l - rr) * staerke, ny = (u - o) * staerke, nz = 1;
        const k = 1 / Math.hypot(nx, ny, nz); nx *= k; ny *= k; nz *= k;
        const i = (y * n + x) * 4;
        a[i] = (nx * 0.5 + 0.5) * 255; a[i + 1] = (ny * 0.5 + 0.5) * 255; a[i + 2] = (nz * 0.5 + 0.5) * 255; a[i + 3] = 255;
      }
      if ((y & 7) === 7) yield;
    }
    g.putImageData(d, 0, 0);
    return c;
  }
  function grauKarte(werte, n, m) {
    const [c, g] = leinwand(n, m), d = g.createImageData(n, m), a = d.data;
    for (let i = 0; i < n * m; i++) {
      const v = Math.max(0, Math.min(255, werte[i] * 255));
      a[i * 4] = v; a[i * 4 + 1] = v; a[i * 4 + 2] = v; a[i * 4 + 3] = 255;
    }
    g.putImageData(d, 0, 0);
    return c;
  }

  const groesse = { hoch: 1, mittel: 0.5, tief: 0.25 }[q] || 0.5;

  // ---------- Kacheln (geteilt). Jede hat ihren eigenen Zufall, damit die Reihenfolge der Schritte nichts ändert.
  // Rückgabe: { farbe: Leinwand oder null, hf: Höhenfeld, n, m, staerke } – die Normalkarte entsteht erst in stufen[4].

  // Putz: 1.25 m Kachel, Kellenspuren, Körnung, kleine Löcher. Gleiche Pixel pro Meter wie früher die 2.5-m-Kachel
  // (hoch 205 px/m), aber ein Viertel des Speichers. Die Wiederholung verdeckt der Farbwechsel aus der Weltlage im Putz-Shader.
  const PUTZ_KACHEL = 1.25;
  function* putzG() {
    const R = zufall(4711);
    const dichte = 512 * groesse;                               // Pixel auf 2.5 m, bestimmt die Stärke der Normalen
    const n = Math.round(dichte / 2);
    const a = yield* rauschen(n, R, 3, 4), b = yield* rauschen(n, R, 20, 2), hf = new Float32Array(n * n);
    for (let i = 0; i < hf.length; i++) hf[i] = a[i] * 0.55 + b[i] * 0.35 + R() * 0.1;
    for (let k = 0; k < 225 * groesse; k++) {                   // Poren
      const x = Math.floor(R() * n), y = Math.floor(R() * n), rad = 1 + R() * 1.5 * groesse * 2;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const d = Math.hypot(dx, dy); if (d > rad) continue;
        hf[((y + dy + n) % n) * n + (x + dx + n) % n] -= 0.25 * (1 - d / (rad + 0.01));
      }
    }
    return { farbe: null, hf, n, m: n, staerke: 3.2 * dichte / 256 };
  }

  // Sandstein für Gewände, Simse, Sockel, Gesimse: 1 m Kachel, Farbe (grau, mit Eigenfarbe je Haus) und Relief
  function* steinG() {
    const R = zufall(4712);
    const n = q === 'tief' ? 32 : Math.round(256 * groesse);   // auf dem Telefon sind Gewände und Simse nur wenige Pixel breit
    const a = yield* rauschen(n, R, 4, 4), b = yield* rauschen(n, R, 32, 2), f = new Float32Array(n * n), hf = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x, scharriert = Math.sin(y / n * Math.PI * 2 * 60 + a[i] * 6) * 0.5 + 0.5;
        hf[i] = a[i] * 0.5 + b[i] * 0.3 + scharriert * 0.12 + R() * 0.08;
        f[i] = 0.82 + (a[i] - 0.5) * 0.22 + (b[i] - 0.5) * 0.12 + (R() < 0.02 ? -0.12 : 0) + (R() - 0.5) * 0.05;
      }
      if ((y & 7) === 7) yield;
    }
    return { farbe: grauKarte(f, n, n), hf, n, m: n, staerke: 2.2 * n / 256 };
  }

  // Jalousieläden: 0.5 m Kachel, 7 Brettchen
  function* ladenG() {
    const R = zufall(4713);
    const n = Math.round(128 * groesse * 2) / 2 | 0 || 32, f = new Float32Array(n * n), hf = new Float32Array(n * n), maser = yield* rauschen(n, R, 8, 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x, ph = (y / n * 7) % 1;
      hf[i] = ph * 0.9 + maser[i] * 0.1;
      f[i] = ph > 0.88 ? 0.28 : 0.66 + (1 - ph) * 0.3 + (maser[i] - 0.5) * 0.12;
    }
    return { farbe: grauKarte(f, n, n), hf, n, m: n, staerke: 6 * n / 128 };
  }

  // Haustür: Kassetten (2 × 3) mit Fase, uv 0..1 über das Türblatt
  function* tuerG() {
    const R = zufall(4714);
    const n = Math.max(32, Math.round(128 * groesse)), m = n * 2, f = new Float32Array(n * m), hf = new Float32Array(n * m), maser = yield* rauschen(n, R, 6, 3);
    const felder = [[0.12, 0.47, 0.06, 0.36], [0.53, 0.88, 0.06, 0.36], [0.12, 0.47, 0.41, 0.66], [0.53, 0.88, 0.41, 0.66], [0.12, 0.47, 0.71, 0.94], [0.53, 0.88, 0.71, 0.94]];
    for (let y = 0; y < m; y++) {
      for (let x = 0; x < n; x++) {
        const u = x / n, v = 1 - y / m, i = y * n + x;
        let h = 1, ton = 0.82;
        for (const [u0, u1, v0, v1] of felder) {
          if (u > u0 && u < u1 && v > v0 && v < v1) {
            const rand = Math.min(u - u0, u1 - u, (v - v0) * 0.5, (v1 - v) * 0.5);
            h = rand < 0.035 ? 0.35 + rand / 0.035 * 0.45 : 0.8; ton = rand < 0.035 ? 0.7 : 0.86;
          }
        }
        hf[i] = h; f[i] = ton + (maser[(y % n) * n + x] - 0.5) * 0.18 * (1 + Math.sin(u * 60 + maser[(y % n) * n + x] * 8) * 0.3);
      }
      if ((y & 7) === 7) yield;
    }
    return { farbe: grauKarte(f, n, m), hf, n, m, staerke: 10 * n / 128 };
  }

  // Biberschwanzziegel: 0.9 m Kachel, 5 Ziegel breit, 6 Reihen
  function* ziegelG() {
    const R = zufall(4715);
    const n = Math.round(256 * groesse), [c, g] = leinwand(n, n), hf = new Float32Array(n * n), d = g.createImageData(n, n), a = d.data;
    const reihen = 6, quer = 5, farbe = [];
    for (let k = 0; k < reihen * quer * 2; k++) farbe.push([0.85 + R() * 0.3, R() < 0.12 ? 0.75 : 1, R()]);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = y / n * reihen, row = Math.floor(v), ph = v - row;
        const u = x / n * quer + (row % 2) * 0.5, col = Math.floor(u), pu = u - col;
        // runde Unterkante: Abstand vom Ziegelrand
        const dx = Math.abs(pu - 0.5) * 2, rund = ph > 0.7 ? Math.sqrt(Math.max(0, 1 - dx * dx)) * 0.3 + 0.7 : 1;
        const fuge = pu < 0.04 || pu > 0.96 || ph > rund;
        const [hell, moos, z] = farbe[(row * quer + ((col % quer) + quer) % quer) % farbe.length];
        const i = y * n + x;
        hf[i] = fuge ? 0 : 0.3 + ph * 0.7;
        const s = fuge ? 0.35 : (0.75 + ph * 0.3) * hell;
        a[i * 4] = Math.min(255, (moos < 1 ? 92 : 148) * s + z * 10); a[i * 4 + 1] = Math.min(255, (moos < 1 ? 84 : 76) * s); a[i * 4 + 2] = Math.min(255, (moos < 1 ? 60 : 54) * s); a[i * 4 + 3] = 255;
      }
      if ((y & 7) === 7) yield;
    }
    g.putImageData(d, 0, 0);
    return { farbe: c, hf, n, m: n, staerke: 5 * n / 256 };
  }

  // Holzmaserung für Sparren, Untersicht und Rahmen der Auslagen (nur Farbe)
  function* holzG() {
    const R = zufall(4716);
    const n = Math.max(32, Math.round(128 * groesse)), m = yield* rauschen(n, R, 4, 3), f = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = y * n + x; f[i] = 0.78 + Math.sin(y / n * 70 + m[i] * 9) * 0.08 + (m[i] - 0.5) * 0.2; }
    return { farbe: grauKarte(f, n, n), hf: null };
  }

  // ---------- Ersatzkarten für Stufe 1 und 2 ----------
  // Gleiche colorSpace und channel wie die echte Karte (gleiche Programmvariante). Mittelfarbe = gemessener linearer Mittelwert
  // der echten Kachel (8 × 8 verkleinert wie in haupt.js), hier als sRGB-Hex je Qualitätsstufe; Prüfmodus misst die Abweichung nach.
  const MITTEL = {
    stein: { hoch: '#d3d3d3', mittel: '#d3d3d3', tief: '#d3d3d3' },
    laden: { hoch: '#c9c9c9', mittel: '#cacaca', tief: '#cccccc' },
    tuer: { hoch: '#cacaca', mittel: '#c9c9c9', tief: '#c8c8c8' },
    ziegel: { hoch: '#7c432f', mittel: '#7c432f', tief: '#7d4330' },
    holz: { hoch: '#c6c6c6', mittel: '#c6c6c6', tief: '#c6c6c6' },
  };
  const ersatzListe = new Set();
  function ersatz(c, farbe, kanal = 0, kachel = true) {
    const t = new THREE.CanvasTexture(c);
    if (farbe) t.colorSpace = THREE.SRGBColorSpace;
    if (kachel) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.channel = kanal; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;
    ersatzListe.add(t);
    return t;
  }
  function flach(css, farbe, kanal = 0) { const [c, g] = leinwand(4, 4); g.fillStyle = css; g.fillRect(0, 0, 4, 4); return ersatz(c, farbe, kanal); }
  const NORMAL_FLACH = 'rgb(128,128,255)';
  const mittelVon = name => (MITTEL[name] && MITTEL[name][q]) || '#bbbbbb';
  // Ersatz freigeben, sobald kein Material ihn mehr trägt
  function freiErsatz(t) {
    if (!t || !ersatzListe.has(t)) return;
    if (materialien.some(m => m.map === t || m.normalMap === t || m.emissiveMap === t)) return;
    t.dispose(); ersatzListe.delete(t);
  }
  // Prüfmodus: linearer Mittelwert wie mittelfarbe() in haupt.js, für den Nachweis «kein Farbsprung»
  const PRUEF = typeof location !== 'undefined' && /[?&]fahrt=/.test(location.search);
  const sprung = { max: 0, wo: '', mittel: {}, alle: [] };
  const lin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const srgb = v => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  // Genauer linearer Mittelwert über alle Pixel (so zeigt die Mipmap die Wand aus der Ferne)
  function mittelGenau(c, farbig) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, f = farbig ? lin : v => v;
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < d.length; j += 4) { r += f(d[j] / 255); g += f(d[j + 1] / 255); b += f(d[j + 2] / 255); }
    const n = d.length / 4;
    return [r / n, g / n, b / n];
  }
  // Ersatz auf genau 8 × 8 Flächenmittel (linear) verkleinern: dann misst auch haupt.js (8 × 8) den genauen Mittelwert
  function auf8(c) {
    const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data;
    const s = new Float64Array(8 * 8 * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const zelle = (Math.floor(y * 8 / H) * 8 + Math.floor(x * 8 / W)) * 4, j = (y * W + x) * 4;
      s[zelle] += lin(d[j] / 255); s[zelle + 1] += lin(d[j + 1] / 255); s[zelle + 2] += lin(d[j + 2] / 255); s[zelle + 3]++;
    }
    const [k, g] = leinwand(8, 8), o = g.createImageData(8, 8);
    for (let z = 0; z < 64; z++) {
      const n = s[z * 4 + 3] || 1;
      o.data[z * 4] = srgb(s[z * 4] / n); o.data[z * 4 + 1] = srgb(s[z * 4 + 1] / n); o.data[z * 4 + 2] = srgb(s[z * 4 + 2] / n); o.data[z * 4 + 3] = 255;
    }
    g.putImageData(o, 0, 0);
    return k;
  }
  function pruefeSprung(wo, alt, neu, srgb) {
    if (!PRUEF || !alt || !neu) return;
    const a = mittelGenau(alt, srgb), b = mittelGenau(neu, srgb);
    const d = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    const hex = new THREE.Color(b[0], b[1], b[2]).getHexString();   // Color() nimmt linear, getHexString liefert sRGB
    if (!/^haus/.test(wo)) sprung.mittel[wo] = '#' + hex;
    sprung.alle.push([wo, Math.round(d * 1000) / 1000]);
    if (d > sprung.max) { sprung.max = d; sprung.wo = wo; }
  }

  // ---------- Geometrie-Bauer: alles in Weltkoordinaten, je Material eine Geometrie ----------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function welt(fr, u, v, w) { return fr.O.clone().addScaledVector(fr.U, u).addScaledVector(fr.V, v).addScaledVector(fr.W, w); }
  function richtung(fr, a, b, c) { return V3(0, 0, 0).addScaledVector(fr.U, a).addScaledVector(fr.V, b).addScaledVector(fr.W, c); }
  // Unterrahmen: neuer Ursprung (u,v,w) und neue Achsen U, V (in Koordinaten des alten Rahmens)
  function unter(fr, o, uL, vL) {
    const U = richtung(fr, ...uL).normalize(), V = richtung(fr, ...vL).normalize();
    return { O: welt(fr, ...o), U, V, W: V3(0, 0, 0).crossVectors(U, V) };
  }

  class Bau {
    constructor(skala = 1) { this.p = []; this.n = []; this.uv = []; this.uv1 = []; this.c = []; this.skala = skala; }
    ecke(p, n, uv, uv1, c) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(uv[0], uv[1]); this.uv1.push(uv1[0], uv1[1]); this.c.push(c.r, c.g, c.b); }
    metrisch(p, nL) {
      const [a, b, c] = nL.map(Math.abs);
      const s = this.skala;
      if (c >= a && c >= b) return [p[0] * s, p[1] * s];
      if (b >= a) return [p[0] * s, p[2] * s];
      return [p[2] * s, p[1] * s];
    }
    // Vieleck (konvex) in lokalen Koordinaten; Drehsinn wird an der gewünschten Normale ausgerichtet
    flaeche(fr, P, nL, farbe, uvf) {
      let pw = P.map(p => welt(fr, ...p));
      const n = richtung(fr, ...nL).normalize();
      const e1 = pw[1].clone().sub(pw[0]), e2 = pw[2].clone().sub(pw[0]);
      if (e1.cross(e2).dot(n) < 0) { pw = pw.slice().reverse(); P = P.slice().reverse(); }
      const uvs = P.map(p => uvf ? uvf(p, nL) : [this.metrisch(p, nL), this.metrisch(p, nL)]);
      for (let i = 1; i < pw.length - 1; i++) for (const k of [0, i, i + 1]) this.ecke(pw[k], n, uvs[k][0], uvs[k][1], farbe);
    }
    kiste(fr, u0, u1, v0, v1, w0, w1, farbe, ohne = '') {
      const F = [
        ['+w', [[u0, v0, w1], [u1, v0, w1], [u1, v1, w1], [u0, v1, w1]], [0, 0, 1]],
        ['-w', [[u0, v0, w0], [u1, v0, w0], [u1, v1, w0], [u0, v1, w0]], [0, 0, -1]],
        ['+u', [[u1, v0, w0], [u1, v1, w0], [u1, v1, w1], [u1, v0, w1]], [1, 0, 0]],
        ['-u', [[u0, v0, w0], [u0, v1, w0], [u0, v1, w1], [u0, v0, w1]], [-1, 0, 0]],
        ['+v', [[u0, v1, w0], [u1, v1, w0], [u1, v1, w1], [u0, v1, w1]], [0, 1, 0]],
        ['-v', [[u0, v0, w0], [u1, v0, w0], [u1, v0, w1], [u0, v0, w1]], [0, -1, 0]],
      ];
      for (const [k, P, n] of F) if (!ohne.includes(k)) this.flaeche(fr, P, n, farbe);
    }
    // Rohr entlang v (senkrecht), Mittelpunkt (u, w)
    rohr(fr, u, w, v0, v1, rad, farbe, seg = 8) {
      for (let k = 0; k < seg; k++) {
        const a1 = k / seg * Math.PI * 2, a2 = (k + 1) / seg * Math.PI * 2, am = (a1 + a2) / 2;
        this.flaeche(fr, [[u + rad * Math.cos(a1), v0, w + rad * Math.sin(a1)], [u + rad * Math.cos(a2), v0, w + rad * Math.sin(a2)],
          [u + rad * Math.cos(a2), v1, w + rad * Math.sin(a2)], [u + rad * Math.cos(a1), v1, w + rad * Math.sin(a1)]], [Math.cos(am), 0, Math.sin(am)], farbe);
      }
    }
    // Halbrohr entlang u (Dachrinne), offen nach oben
    rinne(fr, u0, u1, v, w, rad, farbe, seg = 6) {
      for (let k = 0; k < seg; k++) {
        const a1 = Math.PI + k / seg * Math.PI, a2 = Math.PI + (k + 1) / seg * Math.PI, am = (a1 + a2) / 2;
        const p = a => [v + rad * Math.sin(a), w + rad * Math.cos(a)];
        const [va, wa] = p(a1), [vb, wb] = p(a2);
        this.flaeche(fr, [[u0, va, wa], [u1, va, wa], [u1, vb, wb], [u0, vb, wb]], [0, Math.sin(am), Math.cos(am)], farbe);
      }
    }
    geometrie() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      g.computeBoundingSphere();
      return g;
    }
  }

  // Glas: eigene Attribute für den Raum dahinter
  class GlasBau {
    constructor() { this.p = []; this.n = []; this.a = []; this.m = []; this.d = []; this.t = []; }
    // poly: konvexes Vieleck [u,v] in der Ebene w; rechteck [u0,v0,u1,v1] bestimmt Fenstermass und uv
    flaeche(fr, poly, w, [u0, v0, u1, v1], daten) {
      const n = fr.W.clone().normalize(), t = fr.U.clone().normalize();
      const P = poly.map(([u, v]) => welt(fr, u, v, w));
      const e1 = P[1].clone().sub(P[0]), e2 = P[2].clone().sub(P[0]);
      let ord = poly.map((_, i) => i);
      if (e1.cross(e2).dot(n) < 0) ord = ord.reverse();
      for (let i = 1; i < ord.length - 1; i++) for (const k of [ord[0], ord[i], ord[i + 1]]) {
        const [u, v] = poly[k], p = P[k];
        this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.t.push(t.x, t.y, t.z);
        this.a.push((u - u0) / (u1 - u0), (v - v0) / (v1 - v0)); this.m.push(u1 - u0, v1 - v0); this.d.push(...daten);
      }
    }
    geometrie() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.a, 2));
      g.setAttribute('aMass', new THREE.Float32BufferAttribute(this.m, 2));
      g.setAttribute('aDaten', new THREE.Float32BufferAttribute(this.d, 4));
      g.setAttribute('aTan', new THREE.Float32BufferAttribute(this.t, 3));
      // Grundfarbe je Scheibe für das schlichte Material der Stufe 1 (MeshBasic mit Eckfarben): warm, wo Licht brennt
      const c = new Float32Array(this.p.length);
      for (let i = 0; i < this.d.length / 4; i++) glasGrund(this.d[i * 4 + 1], c, i * 3);
      g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
      g.computeBoundingSphere();
      return g;
    }
  }

  // ---------- Materialien ----------
  const mat = m => (materialien.push(m), m);
  // Feine Farbschwankung im Putz aus der Weltlage (kein Kachelmuster sichtbar)
  function putzShader(sh) {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWeltF;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeltF = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWeltF;
float fhz(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float frz(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(fhz(i), fhz(i + vec2(1., 0.)), f.x), mix(fhz(i + vec2(0., 1.)), fhz(i + vec2(1., 1.)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{ vec2 wq = vec2(vWeltF.z + vWeltF.x, vWeltF.y);
  float nn = frz(wq * 0.55) * 0.55 + frz(wq * 1.9 + 7.3) * 0.3 + frz(wq * 6.1 + 2.1) * 0.15;
  diffuseColor.rgb *= 0.9 + 0.2 * nn; }`);
  }
  const putzSchluessel = () => 'fassaden-putz';

  // Ersatzkarten: Farbe in der Mittelfarbe der echten Kachel, Normalen flach (eine je UV-Kanal)
  const nFlach0 = flach(NORMAL_FLACH, false, 0), nFlach1 = flach(NORMAL_FLACH, false, 1);
  const steinMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, map: flach(mittelVon('stein'), true), normalMap: nFlach0, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.88 }));
  const ladenMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, map: flach(mittelVon('laden'), true), normalMap: nFlach0, roughness: 0.62 }));
  const rahmenMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }));
  const holzMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, map: flach(mittelVon('holz'), true), roughness: 0.75 }));
  const tuerMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, map: flach(mittelVon('tuer'), true), normalMap: nFlach0, roughness: 0.5 }));
  const ziegelMat = mat(new THREE.MeshStandardMaterial({ map: flach(mittelVon('ziegel'), true), normalMap: nFlach0, roughness: 0.8, color: tag ? '#ffffff' : '#d8d0c8' }));
  const blechMat = mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.55 }));
  const schneeMat = mat(new THREE.MeshStandardMaterial({ color: '#f3f6fb', roughness: 0.92, emissive: tag ? '#000000' : '#1b2436', emissiveIntensity: tag ? 0 : 0.35 }));
  const dachSchneeMat = mat(new THREE.MeshStandardMaterial({ color: '#eef2f8', roughness: 0.95, normalMap: nFlach0, normalScale: new THREE.Vector2(0.35, 0.35), emissive: tag ? '#000000' : '#1b2436', emissiveIntensity: tag ? 0 : 0.3 }));
  const wandMats = [];

  // Glas mit Raum dahinter
  const raum = q === 'hoch';
  const glasUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    zenit: { value: new THREE.Color(T.zenit) }, mitte: { value: new THREE.Color(T.mitte) }, horizont: { value: new THREE.Color(T.horizont) },
    gegenFarbe: { value: tag ? new THREE.Color('#cfc4b2').multiplyScalar(schnee ? 0.75 : 0.95) : new THREE.Color('#2a221c').multiplyScalar(0.25 + T.hell) },
    lampe: { value: new THREE.Color('#ffa24a') },
    gegenH: { value: 12.5 }, breite: { value: BREITE }, tag: { value: tag ? 1 : 0 },
    innen: { value: tag ? 0.2 * T.hell : 0.0 }, schnee: { value: schnee ? 1 : 0 },
  }]);
  // Mittlere Scheibenfarbe (linear), am Bild der Stufe 2 abgeglichen: tagsüber Spiegelung von Himmel und Gegenseite,
  // abends dunkel oder warm (an = Helligkeit des Raums)
  const WARM = new THREE.Color(1, 0.75, 0.55), lampeLin = new THREE.Color('#ffa24a'), glasTag = new THREE.Color(T.horizont).lerp(glasUniforms.gegenFarbe.value, 0.5).multiplyScalar(0.3),
    glasNacht = new THREE.Color('#5a3412');                    // dunkles Glas spiegelt nachts die warme Gegenseite
  function glasGrund(an, c, o) {
    const f = an > 0 ? lampeLin.clone().multiplyScalar(an * 1.6).multiply(WARM) : tag ? glasTag : glasNacht;
    c[o] = f.r; c[o + 1] = f.g; c[o + 2] = f.b;
  }
  const glasMat = mat(new THREE.ShaderMaterial({
    uniforms: glasUniforms, fog: true, defines: raum ? { RAUM: 1 } : {},
    vertexShader: /* glsl */`
      attribute vec2 aUV; attribute vec2 aMass; attribute vec4 aDaten; attribute vec3 aTan;
      varying vec3 vWelt; varying vec3 vN; varying vec3 vT; varying vec2 vUV; varying vec2 vMass; varying vec4 vDaten;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWelt = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vT = normalize(mat3(modelMatrix) * aTan);
        vUV = aUV; vMass = aMass; vDaten = aDaten;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 zenit; uniform vec3 mitte; uniform vec3 horizont; uniform vec3 gegenFarbe; uniform vec3 lampe;
      uniform float gegenH; uniform float breite; uniform float tag; uniform float innen; uniform float schnee;
      varying vec3 vWelt; varying vec3 vN; varying vec3 vT; varying vec2 vUV; varying vec2 vMass; varying vec4 vDaten;
      #include <common>
      #include <fog_pars_fragment>
      float hz(float n) { return fract(sin(n * 91.73 + 0.31) * 43758.5453); }
      float hz2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float rz(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
        return mix(mix(hz2(i), hz2(i + vec2(1., 0.)), f.x), mix(hz2(i + vec2(0., 1.)), hz2(i + vec2(1., 1.)), f.x), f.y); }
      vec3 himmel(vec3 r) { float y = clamp(r.y, 0., 1.); vec3 c = mix(horizont, mitte, smoothstep(0., .22, y)); return mix(c, zenit, smoothstep(.18, .75, y)); }
      vec3 tapete(float s) {
        float k = hz(s * 5.1);
        return k < .2 ? vec3(.80, .70, .52) : k < .4 ? vec3(.56, .62, .48) : k < .6 ? vec3(.74, .55, .48) : k < .8 ? vec3(.52, .58, .66) : vec3(.84, .79, .68);
      }
      vec3 stoff(float s) {
        float k = hz(s * 12.3);
        return k < .3 ? vec3(.86, .80, .68) : k < .5 ? vec3(.55, .16, .13) : k < .7 ? vec3(.30, .40, .30) : k < .85 ? vec3(.72, .58, .34) : vec3(.35, .38, .55);
      }
      // Licht im Raum am Punkt p (Raumkoordinaten), Lampe bei L
      vec3 beleuchtung(vec3 p, vec3 L, float an) {
        if (an > 0.) { float dl = length(p - L); return lampe * an * (4.2 / (1. + dl * dl * .3) + .3); }
        return vec3(innen) * (.3 + .7 * exp(-p.z * .5)) + vec3(.003, .004, .007);
      }
      void main() {
        vec3 N = normalize(vN), T = normalize(vT), B = vec3(0., 1., 0.);
        vec3 V = normalize(vWelt - cameraPosition);
        float s = vDaten.x, an = vDaten.y, art = vDaten.z, vh = vDaten.w;
        vec2 m = vMass, q = vUV * m;
        // altes, leicht welliges Glas
        vec3 Nw = normalize(N + (T * (rz(q * vec2(2.5, 1.2) + s * 7.) - .5) + B * (rz(q * vec2(1.2, 2.5) + s * 3.) - .5)) * .045);
        // ---- Spiegelung: Himmel oder Gegenseite der Gasse
        vec3 Rf = reflect(V, Nw);
        vec3 sp = himmel(Rf);
        float rn = dot(Rf, N);
        if (rn > .03) {
          vec3 hp = vWelt + Rf * (breite / rn);
          float a = dot(hp, T);
          vec2 g = vec2(a / 2.6, (hp.y - .9) / 2.95), f = fract(g);
          float fen = step(.3, f.x) * step(f.x, .7) * step(.3, f.y) * step(f.y, .82) * step(4.3, hp.y);
          vec3 c = gegenFarbe * (.75 + .3 * rz(g * 2.3));
          float hellF = step(.5, hz2(floor(g) + 3.)) * (1. - tag);
          c = mix(c, mix(gegenFarbe * .3, lampe * .9, hellF), fen);
          c = hp.y < 0. ? gegenFarbe * .35 : c;
          sp = mix(sp, c, smoothstep(gegenH + .3, gegenH - .3, hp.y + hz(floor(a / 6.)) * 2.));
        }
        float cosT = clamp(dot(-V, Nw), 0., 1.);
        float F = .05 + .95 * pow(1. - cosT, 5.);
        F = mix(F, 1., tag * .12);
        if (an > 0.) F *= mix(1., .3, 1. - tag);
        // ---- Raum hinter dem Glas
        float wl = .4 + hz(s * 1.3) * 1.1, wr = .4 + hz(s * 2.7) * 1.1;
        float D = 3. + hz(s * 4.1) * 2.5, boden = -.9, decke = m.y + .45;
        if (art > .5 && art < 1.5) { D = 4.5 + hz(s * 4.1) * 2.; boden = -.6; decke = m.y + .7; wl = .6; wr = .6; }
        if (art > 1.5) { D = 2.5; boden = -2.6; decke = m.y + .3; wl = .2; wr = .2; }
        vec3 L = vec3(m.x * .5 + (hz(s * 9.1) - .5) * .7, decke - .6, D * (.35 + .25 * hz(s * 3.7)));
        vec3 innenF;
        #ifdef RAUM
          vec3 d = vec3(dot(V, T), dot(V, B), -dot(V, N));
          d.x = abs(d.x) < 1e-4 ? 1e-4 : d.x; d.y = abs(d.y) < 1e-4 ? 1e-4 : d.y; d.z = max(d.z, 1e-3);
          vec3 o = vec3(q, 0.);
          float tx = d.x > 0. ? (m.x + wr - o.x) / d.x : (-wl - o.x) / d.x;
          float ty = d.y > 0. ? (decke - o.y) / d.y : (boden - o.y) / d.y;
          float tz = D / d.z;
          float t = min(min(tx, ty), tz);
          vec3 p = o + d * t;
          float h = p.y - boden;
          vec3 tap = tapete(s), alb;
          if (t == tz) {
            alb = tap * (.92 + .08 * step(.5, fract(p.x * 4. + s)));
            // Bild an der Wand
            float bx = m.x * (.15 + .7 * hz(s * 6.3)), bw = .22 + .25 * hz(s * 7.7), by = 1.55 + .2 * hz(s * 8.1), bh = .18 + .2 * hz(s * 3.3);
            vec2 bq = abs(vec2(p.x - bx, h - by)) - vec2(bw, bh);
            if (max(bq.x, bq.y) < 0.) alb = max(bq.x, bq.y) > -.04 ? vec3(.28, .2, .1) : mix(vec3(.25, .32, .22), vec3(.6, .42, .3), hz(s * 9.9)) * (.6 + .4 * rz(p.xy * 5.));
            // Schrank oder Kommode
            float mx = m.x * hz(s * 2.2), mw = .45 + .45 * hz(s * 3.9), mh = hz(s * 4.4) < .55 ? .85 : 1.95;
            if (abs(p.x - mx) < mw && h < mh) alb = vec3(.2, .13, .08) * (.75 + .25 * step(.025, abs(fract(h * 2.4) - .5)));
            // offene Tür ins Nebenzimmer
            float tx0 = m.x * (1. - hz(s * 5.5)) - .2;
            if (hz(s * 6.6) < .4 && abs(p.x - tx0) < .45 && h < 2.1 && abs(p.x - mx) > mw) alb = tap * .25;
          } else if (t == ty) {
            alb = d.y < 0. ? vec3(.34, .21, .12) * (.72 + .28 * hz2(vec2(floor(p.x * 6.5), floor(p.z * .8 + hz(floor(p.x * 6.5)) * 3.)))) : vec3(.85, .82, .77);
          } else {
            alb = tap * .88;
            if (hz(s * 8.8) < .35 && h < 2.0 && h > .1 && abs(p.z - D * .5) < .6) alb = vec3(.25, .16, .1) * (.8 + .2 * step(.1, fract(h * 2.8)));
          }
          // Laden: Regale mit Waren
          if (art > .5 && art < 1.5 && !(t == ty && d.y < 0.) && h > .35 && h < 2.3) {
            float fr = fract(h / .55);
            float lauf = t == tz ? p.x : p.z;
            float ware = rz(vec2(lauf * 1.6, floor(h / .55) * 3.1 + s));
            vec3 wf = mix(vec3(.62, .36, .3), vec3(.72, .66, .45), rz(vec2(lauf * .7 + s, h)));
            alb = fr < .08 ? vec3(.3, .2, .12) : mix(alb * .8, wf, smoothstep(.45, .6, ware) * smoothstep(.75, .3, fr));
          }
          // Treppenhaus hinter dem Oberlicht
          if (art > 1.5) alb = vec3(.5, .45, .38) * (.7 + .3 * step(.5, fract(p.y * 3.)));
          innenF = alb * beleuchtung(p, L, an);
          // Lampenschirm: Nähe des Sehstrahls zur Lampe
          if (an > 0.) {
            float tl = dot(L - o, d);
            if (tl > 0. && tl < t) {
              float dd = length(o + d * tl - L);
              innenF = mix(innenF, lampe * an * 9. * mix(vec3(1.), stoff(s + 3.), .25), smoothstep(.2, .15, dd));
              // Aufhängung
              vec3 pk = o + d * tl; if (abs(pk.x - L.x) < .012 && pk.y > L.y && tl < t) innenF = vec3(.02);
            }
          }
        #else
          float g = clamp(vUV.y, 0., 1.);
          vec3 tap = tapete(s);
          innenF = an > 0. ? tap * lampe * an * (2.2 + 3.2 * g) * (1. - .35 * abs(vUV.x - .5)) : vec3(innen) * tap * (.25 + .3 * g) + vec3(.003, .004, .007);
          if (art > .5 && art < 1.5 && vUV.y > .15) innenF *= .65 + .35 * step(.15, fract(vUV.y * 4.));
        #endif
        // ---- Vorhänge, Gardinen, Stores
        float typ = vh;
        vec3 licht = an > 0. ? lampe * an * 2.6 : vec3(innen * 1.6 + .006);
        if (typ > .2) {
          float cl = m.x * (.1 + .16 * hz(s * 13.1)), cr = m.x * (.1 + .16 * hz(s * 14.2));
          float falten = .7 + .3 * sin(q.x * 42. + s * 10.) * sin(q.x * 17. + s);
          if (q.x < cl || q.x > m.x - cr) innenF = stoff(s) * falten * licht;
        }
        if (typ > .55 && vUV.y < .58 && art < .5) {
          float spitze = .65 + .35 * step(.45, hz2(floor(q * vec2(38., 30.))));
          float saum = smoothstep(.58, .54, vUV.y);
          innenF = mix(innenF, vec3(.92, .9, .86) * licht * spitze, .62 * saum);
        }
        if (typ > .8 && vUV.y > .72) innenF = vec3(.78, .7, .55) * licht * (.85 + .15 * step(.5, fract(q.y * 12.)));
        // ---- zusammen
        vec3 col = innenF * (1. - F) + sp * F;
        // Schmutz und Staub auf altem Glas
        col *= .94 + .06 * rz(q * 4. + s);
        gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  }));
  // Stufe 1: haupt.js zeichnet die Scheiben als MeshBasic in Weiss mal Eckfarbe (glasGrund); ab Stufe 2 der echte Shader mit Räumen
  glasMat.vertexColors = true; glasMat.userData.grundfarbe = '#ffffff';

  // ---------- Bauer je Material ----------
  const bSt = new Bau(1), bLa = new Bau(2), bRa = new Bau(1), bHo = new Bau(1), bTu = new Bau(1), bZi = new Bau(1 / 0.9), bBl = new Bau(1), bSc = new Bau(1), bDs = new Bau(1 / 0.9);
  const glas = new GlasBau();

  const pxm = { hoch: 12, mittel: 8, tief: 2 }[q] || 8;   // Schmutz ist weich (Flecken, Verläufe), braucht wenig Auflösung
  const KLEIN = 2;                                           // px/m der Ersatz-Schmutzkarten (Stufe 1 und 2)
  const kameraZ = ctx.kamera ? ctx.kamera.position.z : 0;
  const hausSchritte = [];                                   // je Haus ein Schritt in stufen[3]
  const farbe = h => new THREE.Color(h);
  const anteil = T.fenster > 0.1 ? T.fenster : 0;
  let leuchtenGesetzt = 0;
  const MAX_LEUCHTEN = q === 'tief' ? 14 : 30;
  const kandidaten = [];
  const leuchte = (pos, staerke, radius) => kandidaten.push({ pos, farbe: '#ffb466', staerke, radius });

  // ---------- Ein Haus ----------
  function haus(H, nr) {
    const r = zufall(H.seed * 7 + 13);
    const L = Math.abs(H.z0 - H.z1), h = H.hoehe, seite = H.seite;
    const zN = Math.max(H.z0, H.z1), zF = Math.min(H.z0, H.z1);
    r();                                                           // Samenfolge beibehalten
    const x = H.x != null ? H.x : seite * BREITE / 2;              // Bauflucht exakt: die Laternenarme reichen genau bis hier
    const W = V3(-seite, 0, 0), Vv = V3(0, 1, 0), U = V3(0, 0, 0).crossVectors(Vv, W);
    const fr = { O: V3(x, 0, U.z < 0 ? zN : zF), U, V: Vv, W };
    const putz = farbe(H.putz || '#e6dccb');
    const eg = H.eg || 4.2;

    const typ = {
      stein: r() < 0.55,
      quader: r() < 0.35,
      rahmen: FARBEN.rahmen[Math.floor(r() * FARBEN.rahmen.length)],
      steinFarbe: farbe(FARBEN.stein[Math.floor(r() * FARBEN.stein.length)]),
      tuer: FARBEN.tuer[Math.floor(r() * FARBEN.tuer.length)],
      bogen: r() < 0.5,
      winkel: 0.12 + r() * 0.45,
      sprossen: r() < 0.7,
      steil: 0.72 + r() * 0.16,
    };
    const ladenFarbe = typeof H.laden === 'string' ? farbe(H.laden) : H.laden ? farbe(FARBEN.laden[Math.floor(r() * FARBEN.laden.length)]) : null;
    const gesimsFarbe = putz.clone().lerp(farbe('#f4efe6'), 0.45);
    const sockelFarbe = typ.steinFarbe.clone().multiplyScalar(0.72);
    const rahmenFarbe = farbe(typ.rahmen);

    const wand = new Bau(1 / PUTZ_KACHEL);
    const wandUV = (p, nL) => [[p[0] / L, p[1] / h], wand.metrisch(p, nL)];
    const oeffnungen = [];                                         // für Wand und Schmutzkarte
    const fenster = [];

    // Geschosse und Achsen
    const stock = Math.max(1, H.stock || Math.floor((h - eg - 1.2) / 3));
    const gh = (h - eg - 0.9) / stock;
    const fh = Math.min(1.72, gh - 1.2), fb = 0.98 + r() * 0.16;
    const achsen = Math.max(1, Math.round(L / 2.55));
    const abst = L / achsen;
    const mitLaeden = !!ladenFarbe && abst > 2 * fb + 0.5;
    for (let s = 0; s < stock; s++) for (let a = 0; a < achsen; a++) {
      const uc = (a + 0.5) * abst + (r() - 0.5) * 0.04, v0 = eg + s * gh + 0.95;
      const o = { u0: uc - fb / 2, u1: uc + fb / 2, v0, v1: v0 + fh, art: 'fenster', s };
      oeffnungen.push(o); fenster.push(o);
    }
    // Erdgeschoss: Tür und Auslagen
    const tb = 1.12 + r() * 0.2, th = Math.min(eg - 1.1, 2.45 + r() * 0.25);
    const tu = Math.max(0.6, Math.min(L - tb - 0.6, 0.6 + r() * (L - tb - 1.2)));
    oeffnungen.push({ u0: tu, u1: tu + tb, v0: 0, v1: th, art: 'tuer', bogen: typ.bogen });
    for (const [a0, a1] of [[0.45, tu - 0.5], [tu + tb + 0.5, L - 0.45]]) {
      const span = a1 - a0; if (span < 1.5) continue;
      const n = span > 5 ? 2 : 1, w = Math.min(3.2, (span - (n - 1) * 0.6) / n);
      for (let k = 0; k < n; k++) {
        const u0 = a0 + (span - n * w - (n - 1) * 0.6) / 2 + k * (w + 0.6);
        oeffnungen.push({ u0, u1: u0 + w, v0: 0.62, v1: Math.min(eg - 0.9, 2.75), art: 'auslage' });
      }
    }
    for (const o of oeffnungen) {
      o.an = anteil && o.art !== 'tuer' && r() < (o.art === 'auslage' ? anteil * 0.9 : anteil) ? (o.art === 'auslage' ? 0.4 + r() * 0.3 : 0.55 + r() * 0.6) : 0;
      o.seed = r() * 100;
      o.vorhang = o.art === 'auslage' ? 0 : r();
    }

    // ---- Wand mit Löchern
    const form = new THREE.Shape();
    form.moveTo(0, 0); form.lineTo(L, 0); form.lineTo(L, h); form.lineTo(0, h); form.lineTo(0, 0);
    for (const o of oeffnungen) {
      const p = new THREE.Path();
      if (o.bogen) {
        const rad = (o.u1 - o.u0) / 2, vs = o.v1 - rad;
        p.moveTo(o.u0, o.v0); p.lineTo(o.u1, o.v0); p.lineTo(o.u1, vs); p.absarc((o.u0 + o.u1) / 2, vs, rad, 0, Math.PI, false); p.lineTo(o.u0, o.v0);
      } else { p.moveTo(o.u0, o.v0); p.lineTo(o.u1, o.v0); p.lineTo(o.u1, o.v1); p.lineTo(o.u0, o.v1); p.lineTo(o.u0, o.v0); }
      form.holes.push(p);
    }
    const sg = new THREE.ShapeGeometry(form, 10);
    const sp = sg.attributes.position.array, si = sg.index ? sg.index.array : null;
    const nTri = si ? si.length / 3 : sp.length / 9;
    for (let t = 0; t < nTri; t++) {
      const k = [0, 1, 2].map(j => (si ? si[t * 3 + j] : t * 3 + j));
      wand.flaeche(fr, k.map(i => [sp[i * 3], sp[i * 3 + 1], 0]), [0, 0, 1], farbe('#ffffff'), wandUV);
    }
    sg.dispose();
    const weiss = farbe('#ffffff');

    // ---- Laibungen (in Stein bei Gewänden, sonst Putz)
    function laibung(o, tiefe) {
      const ziel = typ.stein || o.art === 'tuer' ? bSt : wand, f = ziel === wand ? weiss : typ.steinFarbe;
      const uvf = ziel === wand ? wandUV : undefined;
      const { u0, u1, v0, v1 } = o;
      const vs = o.bogen ? v1 - (u1 - u0) / 2 : v1;
      ziel.flaeche(fr, [[u0, v0, -tiefe], [u1, v0, -tiefe], [u1, v0, 0], [u0, v0, 0]], [0, 1, 0], f, uvf);
      ziel.flaeche(fr, [[u0, v0, -tiefe], [u0, vs, -tiefe], [u0, vs, 0], [u0, v0, 0]], [1, 0, 0], f, uvf);
      ziel.flaeche(fr, [[u1, v0, -tiefe], [u1, vs, -tiefe], [u1, vs, 0], [u1, v0, 0]], [-1, 0, 0], f, uvf);
      if (o.bogen) {
        const rad = (u1 - u0) / 2, uc = (u0 + u1) / 2, seg = 10;
        for (let k = 0; k < seg; k++) {
          const a1 = k / seg * Math.PI, a2 = (k + 1) / seg * Math.PI, am = (a1 + a2) / 2;
          const p1 = [uc + rad * Math.cos(a1), vs + rad * Math.sin(a1)], p2 = [uc + rad * Math.cos(a2), vs + rad * Math.sin(a2)];
          ziel.flaeche(fr, [[...p1, -tiefe], [...p2, -tiefe], [...p2, 0], [...p1, 0]], [-Math.cos(am), -Math.sin(am), 0], f, uvf);
        }
      } else ziel.flaeche(fr, [[u0, v1, -tiefe], [u1, v1, -tiefe], [u1, v1, 0], [u0, v1, 0]], [0, -1, 0], f, uvf);
    }

    // ---- Fenster der Obergeschosse
    const TIEF = 0.26;
    for (const o of fenster) {
      const { u0, u1, v0, v1 } = o, uc = (u0 + u1) / 2, w = u1 - u0;
      laibung(o, TIEF);
      // Gewände aus Stein
      if (typ.stein) {
        bSt.kiste(fr, u0 - 0.15, u0, v0 - 0.02, v1, 0, 0.035, typ.steinFarbe, '-w');
        bSt.kiste(fr, u1, u1 + 0.15, v0 - 0.02, v1, 0, 0.035, typ.steinFarbe, '-w');
        bSt.kiste(fr, u0 - 0.15, u1 + 0.15, v1, v1 + 0.17, 0, 0.04, typ.steinFarbe, '-w');
        if (o.s === 0 && r() < 0.6) bSt.kiste(fr, uc - 0.12, uc + 0.12, v1 - 0.02, v1 + 0.2, 0.04, 0.07, typ.steinFarbe, '-w');  // Schlussstein
      }
      // Fensterbank
      const bankV = v0, bankW = 0.11;
      bSt.kiste(fr, u0 - 0.13, u1 + 0.13, bankV - 0.075, bankV, -TIEF + 0.02, bankW, typ.steinFarbe);
      if (schnee) {
        bSc.kiste(fr, u0 - 0.12, u1 + 0.12, bankV, bankV + 0.045 + r() * 0.03, -TIEF + 0.08, bankW + 0.02, weiss, '-v');
      }
      const bankPos = welt(fr, uc, bankV, bankW);
      anker.fensterbaenke.push({ pos: bankPos, normal: W.clone(), breite: w + 0.26, seite, stock: o.s, hell: o.an > 0, haus: nr });
      // Rahmen, Flügel, Sprossen
      const wr = -TIEF + 0.1, wR = [wr - 0.05, wr];
      bRa.kiste(fr, u0, u1, v0, v0 + 0.07, ...wR, rahmenFarbe);
      bRa.kiste(fr, u0, u1, v1 - 0.07, v1, ...wR, rahmenFarbe);
      bRa.kiste(fr, u0, u0 + 0.065, v0, v1, ...wR, rahmenFarbe);
      bRa.kiste(fr, u1 - 0.065, u1, v0, v1, ...wR, rahmenFarbe);
      bRa.kiste(fr, uc - 0.04, uc + 0.04, v0, v1, wR[0], wR[1] + 0.01, rahmenFarbe);
      const kaempfer = v0 + (v1 - v0) * 0.7;
      bRa.kiste(fr, u0, u1, kaempfer - 0.035, kaempfer + 0.035, ...wR, rahmenFarbe);
      if (typ.sprossen) {
        bRa.kiste(fr, u0, u1, v0 + (kaempfer - v0) * 0.5 - 0.015, v0 + (kaempfer - v0) * 0.5 + 0.015, wR[0] + 0.015, wR[1] - 0.01, rahmenFarbe);
        for (const su of [u0 + w * 0.25, u1 - w * 0.25]) bRa.kiste(fr, su - 0.013, su + 0.013, kaempfer, v1, wR[0] + 0.015, wR[1] - 0.01, rahmenFarbe);
      }
      glas.flaeche(fr, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], wr - 0.03, [u0, v0, u1, v1], [o.seed, o.an, 0, o.vorhang]);
      // Jalousieläden
      if (mitLaeden) {
        const lw = w / 2 + 0.06, lh = v1 - v0 + 0.06, li = typ.stein ? 0.16 : 0.05;
        for (const sgn of [-1, 1]) {
          const ang = typ.winkel + (r() - 0.5) * 0.15;
          const angel = sgn < 0 ? u0 - li : u1 + li;
          const uL = [sgn * Math.cos(ang), 0, Math.sin(ang)];
          const lf = unter(fr, [angel, v0 - 0.03, 0.04], uL, [0, 1, 0]);
          const lc = ladenFarbe.clone().multiplyScalar(0.92 + r() * 0.16);
          bLa.kiste(lf, 0, lw, 0, lh, -0.035, 0, lc);
          bRa.kiste(lf, 0, 0.05, 0, lh, -0.04, 0.008, lc);           // Rahmen des Ladens
          bRa.kiste(lf, lw - 0.05, lw, 0, lh, -0.04, 0.008, lc);
          bRa.kiste(lf, 0.05, lw - 0.05, lh - 0.06, lh, -0.04, 0.008, lc);
          bRa.kiste(lf, 0.05, lw - 0.05, 0, 0.06, -0.04, 0.008, lc);
          bRa.kiste(lf, 0.05, lw - 0.05, lh * 0.5 - 0.03, lh * 0.5 + 0.03, -0.04, 0.008, lc);
          if (schnee) bSc.kiste(lf, 0.01, lw - 0.01, lh, lh + 0.035, -0.04, 0.01, weiss, '-v');
          // Ladenhalter (Feststeller) an der Wand
          bBl.kiste(fr, (sgn < 0 ? u0 - li - lw * Math.cos(ang) - 0.02 : u1 + li + lw * Math.cos(ang) - 0.02), (sgn < 0 ? u0 - li - lw * Math.cos(ang) + 0.02 : u1 + li + lw * Math.cos(ang) + 0.02), v0 + 0.25, v0 + 0.29, 0, 0.06, farbe('#2a2622'));
        }
      }
      if (o.an && o.s === 0) leuchte(welt(fr, uc, (v0 + v1) / 2, -0.05), 0.55 * o.an, w * 0.9);
    }

    // ---- Erdgeschoss
    for (const o of oeffnungen) {
      if (o.art === 'tuer') {
        const { u0, u1, v1 } = o, rad = (u1 - u0) / 2, vs = o.bogen ? v1 - rad : v1, TT = 0.36;
        laibung(o, TT);
        // Gewände der Tür
        bSt.kiste(fr, u0 - 0.2, u0, 0, vs, 0, 0.04, typ.steinFarbe, '-w');
        bSt.kiste(fr, u1, u1 + 0.2, 0, vs, 0, 0.04, typ.steinFarbe, '-w');
        if (o.bogen) {
          const seg = 9;
          for (let k = 0; k < seg; k++) {
            const a1 = k / seg * Math.PI, a2 = (k + 1) / seg * Math.PI, uc = (u0 + u1) / 2;
            const P = [[uc + rad * Math.cos(a1), vs + rad * Math.sin(a1)], [uc + (rad + 0.2) * Math.cos(a1), vs + (rad + 0.2) * Math.sin(a1)],
              [uc + (rad + 0.2) * Math.cos(a2), vs + (rad + 0.2) * Math.sin(a2)], [uc + rad * Math.cos(a2), vs + rad * Math.sin(a2)]];
            bSt.flaeche(fr, P.map(p => [...p, 0.04]), [0, 0, 1], typ.steinFarbe);
            const am = (a1 + a2) / 2;
            bSt.flaeche(fr, [[...P[1], 0], [...P[2], 0], [...P[2], 0.04], [...P[1], 0.04]], [Math.cos(am), Math.sin(am), 0], typ.steinFarbe);
          }
        } else bSt.kiste(fr, u0 - 0.2, u1 + 0.2, v1, v1 + 0.22, 0, 0.05, typ.steinFarbe, '-w');
        // Türblatt und Oberlicht
        const blattH = o.bogen ? vs : v1 - 0.45;
        const tf = farbe(typ.tuer);
        bTu.flaeche(fr, [[u0, 0, -TT + 0.06], [u1, 0, -TT + 0.06], [u1, blattH, -TT + 0.06], [u0, blattH, -TT + 0.06]], [0, 0, 1], tf,
          p => [[(p[0] - u0) / (u1 - u0), p[1] / blattH], [(p[0] - u0) / (u1 - u0), p[1] / blattH]]);
        bRa.kiste(fr, u0, u1, blattH - 0.02, blattH + 0.06, -TT + 0.02, -TT + 0.1, tf);
        if (o.bogen) {
          const uc = (u0 + u1) / 2, seg = 10, poly = [[uc, vs]];
          for (let k = 0; k <= seg; k++) poly.push([uc + rad * Math.cos(k / seg * Math.PI), vs + 0.06 + rad * Math.sin(k / seg * Math.PI)]);
          const pp = [poly[0], ...poly.slice(1).reverse()];
          glas.flaeche(fr, pp, -TT + 0.03, [u0, vs, u1, v1], [o.seed, 0, 2, 0]);
          for (let k = 1; k < 4; k++) { const a = k / 4 * Math.PI; bRa.kiste(unter(fr, [uc, vs + 0.06, -TT + 0.06], [Math.cos(a), Math.sin(a), 0], [-Math.sin(a), Math.cos(a), 0]), 0, rad, -0.012, 0.012, -0.02, 0.02, tf); }
        } else glas.flaeche(fr, [[u0, blattH + 0.06], [u1, blattH + 0.06], [u1, v1], [u0, v1]], -TT + 0.03, [u0, blattH, u1, v1], [o.seed, 0, 2, 0]);
        // Türgriff und Stufe
        bBl.kiste(fr, u1 - 0.16, u1 - 0.08, 1.02, 1.06, -TT + 0.06, -TT + 0.12, farbe('#b08d4a'));
        bSt.kiste(fr, u0 - 0.1, u1 + 0.1, 0, 0.16, -TT, 0.3, sockelFarbe);
        if (schnee) bSc.kiste(fr, u0 - 0.08, u0 + 0.1, 0.16, 0.2, 0.1, 0.3, weiss, '-v');
      } else if (o.art === 'auslage') {
        const { u0, u1, v0, v1 } = o, TA = 0.24, w = u1 - u0;
        laibung(o, TA);
        const hf = farbe(typ.tuer).multiplyScalar(0.9);
        const wR = [-TA + 0.04, -TA + 0.12];
        bHo.kiste(fr, u0, u1, v0, v0 + 0.1, ...wR, hf);
        bHo.kiste(fr, u0, u1, v1 - 0.1, v1, ...wR, hf);
        bHo.kiste(fr, u0, u0 + 0.08, v0, v1, ...wR, hf);
        bHo.kiste(fr, u1 - 0.08, u1, v0, v1, ...wR, hf);
        const teile = Math.max(1, Math.round(w / 1.1));
        for (let k = 1; k < teile; k++) { const su = u0 + w * k / teile; bHo.kiste(fr, su - 0.04, su + 0.04, v0, v1, ...wR, hf); }
        bHo.kiste(fr, u0, u1, v1 - 0.55, v1 - 0.48, ...wR, hf);
        glas.flaeche(fr, [[u0, v0], [u1, v0], [u1, v1 - 0.55], [u0, v1 - 0.55]], wR[0] - 0.01, [u0, v0, u1, v1 - 0.55], [o.seed, o.an, 1, 0]);
        glas.flaeche(fr, [[u0, v1 - 0.48], [u1, v1 - 0.48], [u1, v1], [u0, v1]], wR[0] - 0.01, [u0, v1 - 0.48, u1, v1], [o.seed + 1, o.an * 0.8, 1, 0]);
        // Sims unter der Auslage
        bSt.kiste(fr, u0 - 0.1, u1 + 0.1, v0 - 0.08, v0, -TA, 0.1, typ.steinFarbe);
        if (schnee) bSc.kiste(fr, u0 - 0.09, u1 + 0.09, v0, v0 + 0.04, -TA + 0.05, 0.11, weiss, '-v');
        if (o.an) leuchte(welt(fr, (u0 + u1) / 2, (v0 + v1) / 2, -0.05), 0.7 * o.an, w * 0.6);
      }
    }

    // ---- Sockel (unterbrochen von Türen)
    const tueren = oeffnungen.filter(o => o.art === 'tuer').sort((a, b) => a.u0 - b.u0);
    let su = 0;
    for (const t of [...tueren, { u0: L, u1: L }]) {
      const e = t.u0 - (t.art ? 0.2 : 0);
      if (e > su + 0.05) bSt.kiste(fr, su, e, 0, 0.58, 0, 0.055, sockelFarbe, '-w');
      su = t.u1 + 0.2;
    }
    // ---- Gurtgesims über dem Erdgeschoss
    const gv = eg + 0.12;
    bSt.kiste(fr, 0, L, gv - 0.1, gv, 0, 0.07, gesimsFarbe, '-w');
    bSt.kiste(fr, 0, L, gv, gv + 0.1, 0, 0.15, gesimsFarbe, '-w');
    bSt.kiste(fr, 0, L, gv + 0.1, gv + 0.14, 0, 0.11, gesimsFarbe, '-w');
    if (schnee) bSc.kiste(fr, 0, L, gv + 0.14, gv + 0.19, 0.0, 0.13, weiss, '-v');
    anker.gesimse.push({ pos: welt(fr, L / 2, gv + 0.14, 0.11), normal: W.clone(), laenge: L, seite, art: 'gurt', haus: nr });
    // ---- Traufgesims
    bSt.kiste(fr, 0, L, h - 0.42, h - 0.3, 0, 0.08, gesimsFarbe, '-w');
    bSt.kiste(fr, 0, L, h - 0.3, h - 0.16, 0, 0.17, gesimsFarbe, '-w');
    bSt.kiste(fr, 0, L, h - 0.16, h, 0, 0.26, gesimsFarbe, '-w');
    // ---- Brandmauern an beiden Enden (sichtbar, wo der Nachbar niedriger ist)
    for (const [u, nu] of [[0, -1], [L, 1]]) wand.flaeche(fr, [[u, 0, 0], [u, h, 0], [u, h, -12], [u, 0, -12]], [nu, 0, 0], putz.clone().multiplyScalar(0.0).addScalar(0.82), wandUV);

    // ---- Dach: Aufschiebling flach, Hauptdach steil, Firstlinie
    const steil = typ.steil, flach = 0.36, KW = -0.5, KV = h + 0.32, EW = 0.95, EV = KV - (EW - KW) * Math.tan(flach);
    const FW = -6.4, FV = KV + (KW - FW) * Math.tan(steil);
    const aus = 0.25;
    const dach = schnee ? bDs : bZi;
    dach.flaeche(fr, [[-aus, EV, EW], [L + aus, EV, EW], [L + aus, KV, KW], [-aus, KV, KW]], [0, Math.cos(flach), Math.sin(flach)], weiss);
    dach.flaeche(fr, [[-aus, KV, KW], [L + aus, KV, KW], [L + aus, FV, FW], [-aus, FV, FW]], [0, Math.cos(steil), Math.sin(steil)], weiss);
    // Untersicht mit Sparren
    const holzU = farbe(tag ? '#6b5440' : '#5a4636'), sparren = farbe('#4a3628');
    const UV0 = h, UVE = EV - 0.14;
    bHo.flaeche(fr, [[-aus, UV0, 0], [L + aus, UV0, 0], [L + aus, UVE, EW], [-aus, UVE, EW]], [0, -1, 0.35], holzU);
    const neig = Math.atan2(UV0 - UVE, EW);
    for (let k = 0.15; k < L + aus; k += 0.72) {
      const sf = unter(fr, [k, UV0, 0], [0, 0, 1], [0, 1, 0]);
      const dl = Math.hypot(EW, UV0 - UVE);
      const sf2 = { O: sf.O, U: richtung(fr, 0, -Math.sin(neig), Math.cos(neig)).normalize(), V: richtung(fr, 0, Math.cos(neig), Math.sin(neig)).normalize(), W: fr.U.clone().negate() };
      bHo.kiste(sf2, 0, dl + 0.04, -0.16, 0, -0.05, 0.05, sparren, '+v');
    }
    // Stirnbrett, Rinne, Fallrohr
    bHo.kiste(fr, -aus, L + aus, UVE - 0.04, EV + 0.03, EW - 0.03, EW + 0.01, sparren);
    const zink = farbe(tag ? '#8e9599' : '#6a7074');
    bBl.rinne(fr, -aus, L + aus, EV - 0.02, EW + 0.09, 0.075, zink);
    const fu = r() < 0.5 ? 0.18 : L - 0.18;
    bBl.rohr(fr, fu, 0.13, 0.25, EV - 0.1, 0.05, zink);
    bBl.kiste(fr, fu - 0.04, fu + 0.04, EV - 0.12, EV - 0.06, 0.13, EW + 0.09, zink);
    for (const hv of [1.5, 4.5, 7.5, 10.5]) if (hv < EV - 0.5) bBl.kiste(fr, fu - 0.07, fu + 0.07, hv, hv + 0.05, 0, 0.13, farbe('#3a3836'));
    if (schnee) {
      bSc.flaeche(fr, [[-aus, EV + 0.02, EW + 0.02], [L + aus, EV + 0.02, EW + 0.02], [L + aus, EV + 0.14, EW + 0.02], [-aus, EV + 0.14, EW + 0.02]], [0, 0, 1], weiss);
      bSc.flaeche(fr, [[-aus, EV + 0.14, EW + 0.02], [L + aus, EV + 0.14, EW + 0.02], [L + aus, EV + 0.16, EW - 0.3], [-aus, EV + 0.16, EW - 0.3]], [0, 1, 0.2], weiss);
    }
    // Giebelwände an den Enden
    for (const [u, nu] of [[0, -1], [L, 1]]) {
      const P = [[u, h, 0], [u, KV, KW], [u, FV, FW], [u, h, FW]];
      wand.flaeche(fr, P, [nu, 0, 0], farbe('#d0ccc4'), wandUV);
      bHo.flaeche(fr, [[u + nu * aus, UV0, 0], [u + nu * aus, UVE, EW], [u + nu * aus, EV, EW], [u + nu * aus, KV, KW], [u + nu * aus, KV - 0.1, 0]], [nu, 0, 0], holzU);
    }
    // Gauben (Lukarnen) und Kamine
    const dachV = w => (w > KW ? KV - (w - KW) * Math.tan(flach) : KV + (KW - w) * Math.tan(steil));
    if (L > 4.5 && r() < 0.6) {
      const gw = 1.25, gu = L * (0.3 + r() * 0.4), w0 = -1.6, vb = dachV(w0) - 0.1, gt = 1.35, w1 = -3.8;
      const gf = putz.clone().multiplyScalar(0.95);
      wand.flaeche(fr, [[gu - gw / 2, vb, w0], [gu + gw / 2, vb, w0], [gu + gw / 2, vb + gt, w0], [gu - gw / 2, vb + gt, w0]], [0, 0, 1], weiss, wandUV);
      for (const sgn of [-1, 1]) wand.flaeche(fr, [[gu + sgn * gw / 2, vb, w0], [gu + sgn * gw / 2, vb + gt, w0], [gu + sgn * gw / 2, vb + gt, w1], [gu + sgn * gw / 2, vb, w1]], [sgn, 0, 0], weiss, wandUV);
      // Fenster der Gaube
      const fu0 = gu - 0.35, fu1 = gu + 0.35, fv0 = vb + 0.3, fv1 = vb + gt - 0.15;
      bRa.kiste(fr, fu0 - 0.06, fu1 + 0.06, fv0 - 0.06, fv1 + 0.04, w0, w0 + 0.04, rahmenFarbe);
      const gan = anteil && r() < anteil * 0.6 ? 0.6 + r() * 0.4 : 0;
      glas.flaeche(fr, [[fu0, fv0], [fu1, fv0], [fu1, fv1], [fu0, fv1]], w0 + 0.045, [fu0, fv0, fu1, fv1], [r() * 100, gan, 0, r() * 0.6]);
      bRa.kiste(fr, gu - 0.02, gu + 0.02, fv0, fv1, w0 + 0.04, w0 + 0.06, rahmenFarbe);
      // Satteldach der Gaube
      const firstV = vb + gt + 0.55;
      for (const sgn of [-1, 1]) {
        const ziel = schnee ? bDs : bZi;
        ziel.flaeche(fr, [[gu + sgn * (gw / 2 + 0.15), vb + gt - 0.05, w0 + 0.25], [gu, firstV, w0 + 0.25], [gu, firstV, w1], [gu + sgn * (gw / 2 + 0.15), vb + gt - 0.05, w1]], [sgn * 0.6, 0.8, 0], weiss);
      }
      wand.flaeche(fr, [[gu - gw / 2, vb + gt, w0], [gu + gw / 2, vb + gt, w0], [gu, firstV - 0.05, w0]], [0, 0, 1], weiss, wandUV);
      bHo.flaeche(fr, [[gu - gw / 2 - 0.15, vb + gt - 0.05, w0 + 0.25], [gu + gw / 2 + 0.15, vb + gt - 0.05, w0 + 0.25], [gu, firstV, w0 + 0.25]], [0, 0, 1], sparren);
    }
    if (r() < 0.75) {
      const ku = 0.6 + r() * Math.max(0.1, L - 1.2), kw0 = -5.6, kw1 = -4.9, top = FV + 0.9 + r() * 0.6;
      const kf = putz.clone().multiplyScalar(0.8);
      bSt.kiste(fr, ku - 0.3, ku + 0.3, dachV(kw0) - 0.3, top, kw0, kw1, kf, '-v');
      bSt.kiste(fr, ku - 0.36, ku + 0.36, top, top + 0.08, kw0 - 0.06, kw1 + 0.06, farbe('#59524a'));
      bBl.rohr(fr, ku - 0.1, (kw0 + kw1) / 2, top + 0.08, top + 0.35, 0.07, farbe('#3c3a38'), 6);
      if (schnee) bSc.kiste(fr, ku - 0.35, ku + 0.35, top + 0.08, top + 0.15, kw0 - 0.05, kw1 + 0.05, weiss, '-v');
    }

    // ---- Schmutzkarte (Farbe) und Leuchtkarte (warmer Schein um helle Fenster)
    // Der Zufall wird hier gezogen (gleiche Folge wie bisher), gezeichnet wird zweimal: klein als Ersatz (gleicher Mittelwert)
    // und in stufen[3] in voller Grösse. Dünne Striche behalten dabei ihre Breite in Metern.
    const SWr = Math.max(8, Math.round(L * pxm)), SHr = Math.max(8, Math.round(h * pxm)), Mr = SWr / L;
    const plan = [];
    for (let i = 0; i < 30; i++) {
      const t = r();
      const fs = t < 0.45 ? `rgba(120,98,78,${0.04 + r() * 0.06})` : t < 0.75 ? `rgba(255,250,240,${0.05 + r() * 0.06})` : `rgba(105,115,120,${0.03 + r() * 0.05})`;
      const ex = r(), ey = r(), rx = 0.4 + r() * 1.8, ry = 0.3 + r() * 1.4, dreh = r() * 3;
      plan.push(k => { k.g.fillStyle = fs; k.g.beginPath(); k.g.ellipse(ex * k.SW, ey * k.SH, rx * k.M, ry * k.M, dreh, 0, 7); k.g.fill(); });
    }
    plan.push(k => {
      const { g, SW, Y } = k;
      const verlauf = (y0, y1, farbeA) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, farbeA); gr.addColorStop(1, farbeA.replace(/[\d.]+\)$/, '0)')); return gr; };
      g.fillStyle = verlauf(Y(0), Y(1.4), 'rgba(72,60,48,0.5)'); g.fillRect(0, Y(1.4), SW, Y(0) - Y(1.4));
      g.fillStyle = verlauf(Y(h), Y(h - 1.4), 'rgba(48,40,36,0.45)'); g.fillRect(0, Y(h), SW, Y(h - 1.4) - Y(h));
      g.fillStyle = verlauf(Y(gv - 0.1), Y(gv - 0.7), 'rgba(48,40,36,0.32)'); g.fillRect(0, Y(gv - 0.1), SW, Y(gv - 0.7) - Y(gv - 0.1));
      // Eckquader
      if (typ.quader) for (const e of [0, 1]) for (let v = eg + 0.2, n = 0; v < h - 0.6; v += 0.42, n++) {
        const M = k.M, bw = (n % 2 ? 0.32 : 0.55) * M, x0 = e ? SW - bw : 0, px = k.dick(0);
        g.fillStyle = 'rgba(255,253,246,0.5)'; g.fillRect(x0, Y(v + 0.38), bw, 0.38 * M);
        g.fillStyle = 'rgba(80,66,52,0.35)'; g.fillRect(x0, Y(v + 0.38), bw, k.dick(0.025)); g.fillRect(e ? x0 : x0 + bw - px, Y(v + 0.38), k.dick(0.025), 0.38 * M);
      }
    });
    for (const o of oeffnungen) {
      const ow = o.u1 - o.u0;
      // gemalte Faschen um die Fenster
      if (!typ.stein && o.art === 'fenster') plan.push(({ g, X, Y, M, dick }) => {
        g.fillStyle = 'rgba(250,247,240,0.72)'; g.fillRect(X(o.u0 - 0.15), Y(o.v1 + 0.15), (ow + 0.3) * M, (o.v1 - o.v0 + 0.25) * M);
        g.strokeStyle = 'rgba(90,80,70,0.35)'; g.lineWidth = dick(0.02); g.strokeRect(X(o.u0 - 0.15), Y(o.v1 + 0.15), (ow + 0.3) * M, (o.v1 - o.v0 + 0.25) * M);
      });
      // Laufspuren unter Simsen
      if (o.art !== 'tuer') for (const ku of [o.u0 - 0.05, o.u0 + ow * 0.5, o.u1 + 0.05]) {
        if (r() < 0.35) continue;
        const lang = 0.4 + r() * 1.6, br = 0.05 + r() * 0.15;
        plan.push(({ g, X, Y, M }) => {
          const x0 = X(ku) - br * M / 2, y0 = Y(o.v0 - 0.08);
          const gr = g.createLinearGradient(0, y0, 0, y0 + lang * M); gr.addColorStop(0, 'rgba(70,58,46,0.22)'); gr.addColorStop(1, 'rgba(70,58,46,0)');
          g.fillStyle = gr; g.fillRect(x0, y0, br * M, lang * M);
        });
      }
      // Schatten unter Simsen und Gewänden
      plan.push(({ g, X, Y, M, dick }) => { g.fillStyle = 'rgba(40,32,26,0.28)'; g.fillRect(X(o.u0 - 0.15), Y(o.v0 - 0.08), (ow + 0.3) * M, dick(0.12)); });
    }
    const schmutzBild = (SW, SH) => {
      const [c, g] = leinwand(SW, SH), M = SW / L;
      const k = { g, SW, SH, M, X: u => u / L * SW, Y: v => SH - v / h * SH, dick: m => Math.max(1, m * Mr) * M / Mr };
      g.fillStyle = '#fff'; g.fillRect(0, 0, SW, SH);
      for (const op of plan) op(k);
      return c;
    };
    // Warmer Schein um helle Fenster, nur am Abend und nicht auf dem Telefon
    const schein = !tag && q !== 'tief' && oeffnungen.some(o => o.an);
    const ewR = Math.max(8, Math.round(L * pxm * 0.5)), ehR = Math.max(8, Math.round(h * pxm * 0.5));
    const scheinBild = (ew, eh) => {
      const [ce, ge] = leinwand(ew, eh), XE = u => u / L * ew, YE = v => eh - v / h * eh, ME = ew / L;
      ge.fillStyle = '#000'; ge.fillRect(0, 0, ew, eh);
      for (const o of oeffnungen) if (o.an) {
        const cx = XE((o.u0 + o.u1) / 2), cy = YE(o.v0 - (o.art === 'auslage' ? 0.3 : 0.15)), rad = (o.art === 'auslage' ? 1.8 : 1.15) * ME;
        const gr = ge.createRadialGradient(cx, cy, 0, cx, cy, rad);
        gr.addColorStop(0, `rgba(255,190,120,${0.5 * o.an})`); gr.addColorStop(1, 'rgba(255,190,120,0)');
        ge.fillStyle = gr; ge.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
      }
      return ce;
    };
    // Auf 'tief' (2 px/m) ist die Ersatzgrösse schon die echte Karte: dann gleich fertig
    const gleichEcht = pxm <= KLEIN;
    const kw = Math.max(4, Math.round(L * KLEIN)), kh = Math.max(4, Math.round(h * KLEIN));
    const wandMat = mat(new THREE.MeshStandardMaterial({
      color: putz, map: gleichEcht ? textur(schmutzBild(SWr, SHr), true, false, false) : ersatz(auf8(schmutzBild(kw, kh)), true, 0, false),
      normalMap: nFlach1, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.94,
    }));
    wandMat.onBeforeCompile = putzShader; wandMat.customProgramCacheKey = putzSchluessel;
    wandMats.push(wandMat);
    if (schein) { wandMat.emissive = farbe('#ffb060'); wandMat.emissiveMap = ersatz(auf8(scheinBild(kw, kh)), true, 0, false); wandMat.emissiveIntensity = 0.55; }
    if (!gleichEcht || schein) hausSchritte.push({
      abstand: Math.max(0, zF - kameraZ, kameraZ - zN) + Math.abs(x) * 0.01, nr,
      fn: async () => {
        const karten = [];                                                  // [Schlüssel, Leinwand, mip]
        if (!gleichEcht) karten.push(['map', schmutzBild(SWr, SHr), q !== 'tief']);
        if (schein) karten.push(['emissiveMap', scheinBild(ewR, ehR), false]);
        const neu = karten.map(([k, c, mip]) => [k, textur(c, true, false, mip), c]);
        await ctx.hochladen(neu.map(x => x[1]));
        if (entsorgt) { for (const x of neu) x[1].dispose(); return false; }
        const alt = neu.map(([k]) => wandMat[k]);
        ctx.tauschen(() => { for (const [k, t] of neu) wandMat[k] = t; });
        neu.forEach(([k, , c], i) => { pruefeSprung('haus' + nr + '.' + k, alt[i].image, c, true); freiErsatz(alt[i]); });
        zahlen();
        return true;
      },
    });
    const mesh = new THREE.Mesh(wand.geometrie(), wandMat);
    mesh.name = 'fassade-' + nr;
    gruppe.add(mesh);
  }

  const haeuser = ctx.haeuser || [];
  haeuser.forEach((H, i) => haus(H, i));
  // licht baut je Leuchte einen eigenen Hof: nur eine begrenzte Auswahl, gleichmässig über die sichtbare Gasse verteilt
  const sichtbar = kandidaten.filter(l => l.pos.z < 7).sort((a, b) => b.pos.z - a.pos.z);
  const schritt = Math.max(1, sichtbar.length / MAX_LEUCHTEN);
  for (let k = 0; k < sichtbar.length && leuchtenGesetzt < MAX_LEUCHTEN; k += schritt) { anker.leuchten.push(sichtbar[Math.floor(k)]); leuchtenGesetzt++; }

  // ---------- Meshes je Material ----------
  for (const [b, m, name] of [[bSt, steinMat, 'stein'], [bLa, ladenMat, 'laeden'], [bRa, rahmenMat, 'rahmen'], [bHo, holzMat, 'holz'], [bTu, tuerMat, 'tueren'],
    [bZi, ziegelMat, 'dach'], [bDs, dachSchneeMat, 'dach-schnee'], [bBl, blechMat, 'blech'], [bSc, schneeMat, 'schnee']]) {
    if (!b.p.length) continue;
    const me = new THREE.Mesh(b.geometrie(), m); me.name = 'fassaden-' + name; gruppe.add(me);
  }
  if (glas.p.length) {
    const gm = new THREE.Mesh(glas.geometrie(), glasMat); gm.name = 'fassaden-glas';
    gm.userData.keinSchatten = true; gm.castShadow = false; gm.receiveShadow = false;
    gruppe.add(gm);
  }
  szene.add(gruppe);

  // ---------- Gestaffelt ----------
  // Kachel-Schritt (stufen[3]): Farbe rechnen, hochladen, weich tauschen; das Höhenfeld bleibt für die Normalkarte in stufen[4]
  const relief = {};
  const kachelMats = { stein: [steinMat], laden: [ladenMat], tuer: [tuerMat], ziegel: [ziegelMat], holz: [holzMat], putz: wandMats };
  const normalMats = { putz: wandMats, stein: [steinMat], laden: [ladenMat], tuer: [tuerMat], ziegel: [ziegelMat, dachSchneeMat] };
  const geber = { putz: putzG, stein: steinG, laden: ladenG, tuer: tuerG, ziegel: ziegelG, holz: holzG };
  const sicher = fn => async () => { if (entsorgt) return false; try { return await fn(); } catch (e) { if (e === AUS) return false; throw e; } };
  const farbSchritt = name => sicher(async () => {
    const e = await stueckweise(geber[name]());
    relief[name] = e;
    if (!e.farbe) return false;
    const t = textur(e.farbe, true);
    await ctx.hochladen([t]);
    if (entsorgt) { t.dispose(); return false; }
    const mats = kachelMats[name], alt = mats[0].map;
    ctx.tauschen(() => { for (const m of mats) m.map = t; });
    pruefeSprung(name, alt && alt.image, e.farbe, true); freiErsatz(alt);
    zahlen();
    return true;
  });
  const normalSchritt = name => sicher(async () => {
    const e = relief[name] || await stueckweise(geber[name]());
    if (!e.hf) return false;
    const t = textur(await stueckweise(normalKarte(e.hf, e.n, e.m, e.staerke)), false);
    if (name === 'putz') t.channel = 1;
    relief[name] = null;
    await ctx.hochladen([t]);
    if (entsorgt) { t.dispose(); return false; }
    const mats = normalMats[name], alt = mats.map(m => m.normalMap);
    ctx.tauschen(() => { for (const m of mats) m.normalMap = t; });
    for (const a of alt) freiErsatz(a);
    zahlen();
    return true;
  });
  // stufen[3]: Häuser nah → fern (je Schritt ein Haus), die geteilten Farbkacheln dazwischen, sobald die ersten Häuser stehen.
  // Die Nummer 13 baut requisiten; sie steht am Ende der Gasse und kommt dort mit ihren Texturen früh.
  hausSchritte.sort((a, b) => a.abstand - b.abstand);
  const kacheln = ['stein', 'ziegel', 'laden', 'tuer', 'holz'].map(farbSchritt);
  const stufe3 = [];
  hausSchritte.forEach((hs, i) => { stufe3.push(sicher(hs.fn)); if (i >= 1 && kacheln.length) stufe3.push(kacheln.shift()); });
  stufe3.push(...kacheln);
  // stufen[4]: feine Details, das Relief (Normalkarten von Putz, Stein, Ziegel, Läden, Türen)
  const stufe4 = ['putz', 'stein', 'ziegel', 'laden', 'tuer'].map(normalSchritt);

  function zahlen() {
    if (typeof window === 'undefined' || entsorgt) return;
    window.__fassaden = { ms, hell: glas.d.filter((v, i) => i % 4 === 1 && v > 0).length / 6, bytes: Math.round(bytes), haeuser: haeuser.length, fensterbaenke: anker.fensterbaenke.length,
      leuchten: leuchtenGesetzt, q, ersatz: ersatzListe.size, sprung: Math.round(sprung.max * 1000) / 1000, sprungWo: sprung.wo, groesste: sprung.alle.slice().sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x.join(' ')).join(', '), mittel: sprung.mittel, liste: liste.join(' ') };
    if (PRUEF) document.documentElement.dataset.fassaden = JSON.stringify(window.__fassaden);
  }
  const ms = Math.round(performance.now() - t0);
  zahlen();

  return {
    aktualisieren() { return false; },
    stufen: { 3: stufe3, 4: stufe4 },
    entsorgen() {
      entsorgt = true;
      szene.remove(gruppe);
      gruppe.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      for (const m of materialien) m.dispose();
      for (const t of texturen) t.dispose();
      for (const t of ersatzListe) t.dispose();
      texturen.length = 0; materialien.length = 0; ersatzListe.clear();
    },
  };
}
