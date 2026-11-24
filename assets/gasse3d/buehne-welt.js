// Welt der Bühne: Pflaster mit Rinne, Schneewälle, Silhouetten der Altstadt hinter der 13
// und die Bildaushänge der Laden-Seite als Aufsteller in der Gasse. Besitzer: buehne.
import { THREE, zufall, freigeben } from './gemeinsam.js';

// Gestaffeltes Laden: bauen legt alles mit kleinen Vorschautexturen hin (gleiche Shader wie später, ab Stufe 1 sichtbar:
// userData.einfachKarte), die scharfen Texturen entstehen in stufen[3]: zuerst das Pflaster, dann die Aushänge von nah nach fern.
export function bauen(ctx) {
  const g = new THREE.Group(); g.name = 'buehne-welt'; ctx.szene.add(g);
  const teile = [pflaster(ctx, g), silhouetten(ctx, g), aushaenge(ctx, g)];
  const stufe3 = teile.flatMap(p => (p && p.stufe3) || []);
  // Ohne gestaffelten Aufbau (kein ctx.tauschen): alles sofort
  if (!ctx.tauschen) { for (const f of stufe3) f(ctx); }
  return {
    stufen: ctx.tauschen ? { 3: stufe3 } : undefined,
    aktualisieren(t, dt) { let w = false; for (const p of teile) if (p && p.aktualisieren && p.aktualisieren(t, dt)) w = true; return w; },
    entsorgen() { for (const p of teile) p && p.entsorgen && p.entsorgen(); freigeben(g); g.removeFromParent(); },
  };
}

// ---------- Hilfen ----------
function wert(r, a, b) { return a + (b - a) * r(); }
function rauschen2(seed) {
  // Wertrauschen, glatt, für Fleckigkeit
  const P = new Float32Array(256 * 256), r = zufall(seed); for (let i = 0; i < P.length; i++) P[i] = r();
  const h = (x, y) => P[((y & 255) << 8) | (x & 255)];
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v; };
}
const tauschen = (ctx, fn) => ctx.tauschen ? ctx.tauschen(fn) : fn();
const hochladen = (ctx, l) => ctx.hochladen ? ctx.hochladen(l) : Promise.resolve();
const rast = ctx => ctx.rast ? ctx.rast() : Promise.resolve();
// Normalenkarte aus einer Höhenkarte (Graustufen-Canvas)
async function normalen(hc, staerke, ctx) {
  const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), out = g.createImageData(w, h), d = out.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) { if (y % 16 === 0) await rast(ctx); for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * staerke, dy = (H(x, y + 1) - H(x, y - 1)) * staerke;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  } }
  g.putImageData(out, 0, 0); return c;
}

// ---------- Pflaster: Bollensteine, Rinne aus Platten in der Mitte, Randsteine ----------
// Gezeichnet wird die ganze Gassenbreite; als Textur dient nur die rechte Hälfte (Mitte der Rinne bis zur Wand, 4 m lang).
// Die linke Hälfte zeigt sie gespiegelt und um VERSATZ Kacheln längs verschoben: halber Textur-Upload, keine sichtbare Symmetrie.
function pflaster(ctx, g) {
  const { T, q, strasse } = ctx, BR = strasse.BREITE + 1.2, LA = 4;
  const px = q === 'hoch' ? 96 : q === 'mittel' ? 80 : 44;   // Pixel pro Meter, klein gehalten wegen des Textur-Uploads
  const W = Math.round(BR * px), Hh = Math.round(LA * px);
  const schnee = !!T.schnee, abend = ctx.S === 'abend';
  // Bis Stufe 3 eine kleine Vorschau derselben Zeichnung (VP Pixel pro Meter): gleiche Fugen, Rinne, Pfützen und Trittspur,
  // nur ohne Feinheiten. Sie ist nach wenigen Millisekunden fertig, noch bevor das erste Bild entsteht. Stufe 3 bringt nur Detail dazu.
  const VP = 24, vW = Math.round(BR * VP), vB = vW - Math.round(vW / 2), vH = Math.round(LA * VP);
  const vorschau = (farbe, srgb) => {
    const c = document.createElement('canvas'); c.width = vB; c.height = vH;
    const k = c.getContext('2d'); k.fillStyle = farbe; k.fillRect(0, 0, vB, vH);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
  };
  const mat = new THREE.MeshStandardMaterial({
    map: vorschau(schnee ? '#9a9da2' : '#6f685e', true), normalMap: vorschau('#8080ff'), normalScale: new THREE.Vector2(1, 1),
    roughnessMap: vorschau(abend ? '#555555' : '#c4c4c4'),
    roughness: Math.min(1, T.nass + (abend ? 0.25 : 0.1)), metalness: 0,
  });
  mat.userData.einfachKarte = true;                                  // Stufe 1 zeigt die Vorschau statt einer Einheitsfarbe
  if (ctx.tauschen) {
    // Ohne echte Pausen (leerer ctx): läuft ganz in Mikroaufgaben, also vor dem nächsten Zeichnen
    karten(VP, {}).then(k => {
      for (const [t, c] of [[mat.map, k.farbe], [mat.normalMap, k.normal], [mat.roughnessMap, k.rauheit]]) {
        t.image.getContext('2d').drawImage(c, 0, 0, vB, vH); t.needsUpdate = true;
      }
      ctx.malen && ctx.malen();
    }).catch(() => {});
  }
  // Die echten Karten: in Stufe 3, mit Pausen zwischen den Abschnitten
  async function zeichnen() {
  const k = await karten(px, ctx);
  await rast(ctx);
  const verkleinert = (c, f) => { const k = document.createElement('canvas'); k.width = Math.round(c.width / f); k.height = Math.round(c.height / f); const g = k.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, k.width, k.height); return k; };
  const wieder = (c, farbe) => { const t = new THREE.CanvasTexture(c); if (farbe) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = q === 'tief' ? 4 : 8; return t; };
  // Pfützen und Fugenglanz sind grob: ein Viertel ('tief') bzw. die Hälfte der Auflösung genügt
  const neu = { map: wieder(k.farbe, true), normalMap: wieder(k.normal), roughnessMap: wieder(verkleinert(k.rauheit, q === 'tief' ? 4 : 2)) };
  await hochladen(ctx, Object.values(neu));
  tauschen(ctx, () => {
    const alt = [mat.map, mat.normalMap, mat.roughnessMap];
    Object.assign(mat, neu);                                        // gleiche Art Karten: kein neues Kompilieren
    Object.assign(ctx.pflaster.karten, { farbe: neu.map, normal: neu.normalMap, rauheit: neu.roughnessMap });
    for (const t of alt) t.dispose();
  });
  return true;
  }
  // Zeichnet Farbe, Höhe/Normale und Rauheit mit px Pixeln pro Meter; gibt die rechten Hälften zurück
  async function karten(px, ctx) {
  const W = Math.round(BR * px), Hh = Math.round(LA * px);
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = Hh; return [c, c.getContext('2d')]; };
  const [cF, gF] = mk(), [cH, gH] = mk(), [cR, gR] = mk();
  const r = zufall(77), n = rauschen2(9);
  const mitte = W / 2, rinneB = 0.62 * px, rand = 0.6 * px;
  // Fugen: dunkel, tief, rau (tag) bzw. nass glänzend (abend)
  gF.fillStyle = schnee ? '#b9bdc4' : '#4a453e'; gF.fillRect(0, 0, W, Hh);
  gH.fillStyle = '#000'; gH.fillRect(0, 0, W, Hh);
  gR.fillStyle = abend ? '#5a5a5a' : '#f0f0f0'; gR.fillRect(0, 0, W, Hh);
  const stein = (x, y, rx, ry, rot, ton, wand) => {
    for (const dy of [-Hh, 0, Hh]) {
      const yy = y + dy; if (yy < -ry * 2 || yy > Hh + ry * 2) continue;
      gF.fillStyle = ton; gF.beginPath(); gF.ellipse(x, yy, rx, ry, rot, 0, 7); gF.fill();
      // Hell oben links, dunkel unten rechts: weiche Rundung
      const gr = gF.createRadialGradient(x - rx * 0.3, yy - ry * 0.35, 0, x, yy, Math.max(rx, ry) * 1.05);
      gr.addColorStop(0, 'rgba(255,248,235,.20)'); gr.addColorStop(0.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.25)');
      gF.fillStyle = gr; gF.beginPath(); gF.ellipse(x, yy, rx, ry, rot, 0, 7); gF.fill();
      const hg = gH.createRadialGradient(x, yy, 0, x, yy, Math.max(rx, ry));
      hg.addColorStop(0, wand ? '#cfcfcf' : '#ffffff'); hg.addColorStop(0.6, wand ? '#b8b8b8' : '#d8d8d8'); hg.addColorStop(1, '#202020');
      gH.fillStyle = hg; gH.beginPath(); gH.ellipse(x, yy, rx, ry, rot, 0, 7); gH.fill();
      const rv = abend ? 40 + r() * 70 : 150 + r() * 80;
      gR.fillStyle = `rgb(${rv},${rv},${rv})`; gR.beginPath(); gR.ellipse(x, yy, rx * 0.9, ry * 0.9, rot, 0, 7); gR.fill();
    }
  };
  const tonStein = () => {
    const t = r(), k = 0.85 + r() * 0.3;
    // Bollensteine: grau, sandig, ab und zu rötlich oder bläulich
    const basis = t < 0.12 ? [134, 118, 104] : t < 0.25 ? [116, 117, 118] : t < 0.6 ? [140, 133, 121] : [122, 116, 106];
    return `rgb(${basis.map(v => Math.round(v * k)).join(',')})`;
  };
  // Bollensteine in Reihen quer zur Gasse (Bogenpflaster angedeutet)
  const d = 0.15 * px;
  for (let y = -d; y < Hh + d; y += d * 0.92) {
    await rast(ctx);
    for (let x = rand * 0.5; x < W - rand * 0.5; x += d * wert(r, 0.95, 1.15)) {
      if (Math.abs(x - mitte) < rinneB / 2 + d * 0.4) continue;
      const bog = Math.cos((x - mitte) / W * Math.PI) * d * 0.9;      // Reihen leicht gebogen
      stein(x + wert(r, -2, 2), y + bog + wert(r, -2, 2), d * wert(r, 0.5, 0.62), d * wert(r, 0.44, 0.56), r() * 3, tonStein(), false);
    }
  }
  // Rinne: zwei Reihen flacher Granitplatten, längs
  const pl = 0.42 * px;
  for (const sx of [-1, 1]) for (let y = 0; y < Hh; y += pl * wert(r, 0.95, 1.2)) {
    const x0 = mitte + (sx < 0 ? -rinneB / 2 : 0) + 2, w = rinneB / 2 - 4, h = pl - 4;
    const ton = Math.round(wert(r, 100, 125));
    for (const dy of [-Hh, 0, Hh]) {
      gF.fillStyle = `rgb(${ton},${ton - 3},${ton - 8})`; gF.fillRect(x0, y + dy, w, h);
      gH.fillStyle = '#9a9a9a'; gH.fillRect(x0, y + dy, w, h);
      gR.fillStyle = abend ? '#202020' : '#b0b0b0'; gR.fillRect(x0, y + dy, w, h);
    }
  }
  // Rinne leicht vertieft: Verlauf in der Höhe, Wasser glänzt in der Mitte
  const rg = gH.createLinearGradient(mitte - rinneB / 2, 0, mitte + rinneB / 2, 0);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.5, 'rgba(0,0,0,.35)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  gH.fillStyle = rg; gH.fillRect(mitte - rinneB / 2, 0, rinneB, Hh);
  // Randsteine längs der Hauswände
  for (const sx of [0, W - rand]) for (let y = 0; y < Hh; y += 0.55 * px) {
    const ton = Math.round(wert(r, 108, 130));
    for (const dy of [-Hh, 0, Hh]) {
      gF.fillStyle = `rgb(${ton},${ton - 4},${ton - 10})`; gF.fillRect(sx + 2, y + dy + 2, rand - 4, 0.55 * px - 4);
      gH.fillStyle = '#a0a0a0'; gH.fillRect(sx + 2, y + dy + 2, rand - 4, 0.55 * px - 4);
    }
  }
  await rast(ctx);
  // Schmutz, Moos in den Fugen, Feuchte: grosse Flecken
  const fd = gF.getImageData(0, 0, W, Hh), a = fd.data, rd = gR.getImageData(0, 0, W, Hh), ra = rd.data;
  for (let y = 0; y < Hh; y++) { if (y % 8 === 0) await rast(ctx); for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, f = n(x / px * 1.3, y / px * 1.3) * 0.6 + n(x / px * 5, y / px * 5) * 0.4;
    const k = (f - 0.5) * 34 + (r() - 0.5) * 16;
    a[i] += k; a[i + 1] += k; a[i + 2] += k * 0.9;
    // Pfützen am Abend: Flecken mit sehr glatter Oberfläche
    if (abend && !schnee) { const p = n(x / px * 0.7 + 30, y / px * 0.7); if (p > 0.62) { const m = Math.min(1, (p - 0.62) * 10); ra[i] = ra[i + 1] = ra[i + 2] = ra[i] * (1 - m) + 8 * m; a[i] *= 1 - 0.35 * m; a[i + 1] *= 1 - 0.33 * m; a[i + 2] *= 1 - 0.3 * m; } }
    // Rand zur Wand hin dunkler (Spritzwasser)
    const wd = Math.min(x, W - x) / px; if (wd < 0.5) { const m = (1 - wd / 0.5) * 0.25; a[i] *= 1 - m; a[i + 1] *= 1 - m; a[i + 2] *= 1 - m; }
  } }
  gF.putImageData(fd, 0, 0); gR.putImageData(rd, 0, 0);
  // Schnee: liegende Decke, in der Mitte festgetreten und grau, an den Wänden hoch und weiss
  if (schnee) {
    const sd = gF.getImageData(0, 0, W, Hh), s = sd.data, hd = gH.getImageData(0, 0, W, Hh), hh = hd.data, rr = gR.getImageData(0, 0, W, Hh), ro = rr.data;
    for (let y = 0; y < Hh; y++) { if (y % 8 === 0) await rast(ctx); for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, xm = Math.abs(x - mitte) / (W / 2);
      const spur = Math.exp(-Math.pow((Math.abs(x - mitte) / px - 1.3) / 0.7, 2));     // zwei Gehspuren
      const decke = Math.min(1, 0.55 + xm * 0.6 + n(x / px * 2, y / px * 2) * 0.35 - spur * 0.45 - hh[i] / 255 * 0.12);
      const m = Math.max(0, Math.min(1, (decke - 0.35) * 2.2));
      const w = 236 + n(x / px * 8, y / px * 8) * 18 - spur * 30;
      s[i] = s[i] * (1 - m) + (w - 6) * m; s[i + 1] = s[i + 1] * (1 - m) + (w - 3) * m; s[i + 2] = s[i + 2] * (1 - m) + (w + 6) * m;
      hh[i] = hh[i + 1] = hh[i + 2] = hh[i] * (1 - m) + (150 + n(x / px * 6, y / px * 6) * 60) * m;
      ro[i] = ro[i + 1] = ro[i + 2] = ro[i] * (1 - m) + 225 * m;
    } }
    gF.putImageData(sd, 0, 0); gH.putImageData(hd, 0, 0); gR.putImageData(rr, 0, 0);
  }
  // Normalenstärke gilt pro Pixel: bei kleinerer Auflösung entsprechend schwächer, damit die Vorschau gleich hell wirkt
  const nc = await normalen(cH, (q === 'tief' ? 2.2 : 3.2) * Math.min(1, px / (q === 'hoch' ? 96 : q === 'mittel' ? 80 : 44)), ctx);
  const haelfte = c => { const k = document.createElement('canvas'); k.width = W - Math.round(mitte); k.height = c.height; k.getContext('2d').drawImage(c, -Math.round(mitte), 0); return k; };
  return { farbe: haelfte(cF), normal: haelfte(nc), rauheit: haelfte(cR) };
  }
  const lange = 66, z0 = 18;
  // Zwei Hälften mit eigenen UV: u = Abstand von der Mitte (gespiegelt), v in Kachellängen, links versetzt.
  // Die Normalen der Spiegelung stimmen, weil three.js den Tangentenraum ohne Tangenten aus den UV-Ableitungen bildet.
  const VERSATZ = 0.37;
  const geo = new THREE.PlaneGeometry(BR, lange, 2, 1).toNonIndexed(), pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i += 3) {
    const links = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) < 0;
    for (let j = i; j < i + 3; j++) uv.setXY(j, Math.abs(pos.getX(j)) / (BR / 2), (pos.getY(j) + lange / 2) / LA + (links ? VERSATZ : 0));
  }
  const boden = new THREE.Mesh(geo, mat);
  boden.rotation.x = -Math.PI / 2; boden.position.set(0, 0, z0 - lange / 2); boden.name = 'pflaster';
  g.add(boden);
  ctx.pflaster = { mesh: boden, material: mat, karten: { farbe: mat.map, normal: mat.normalMap, rauheit: mat.roughnessMap }, kachel: { breite: BR / 2, laenge: LA, gespiegelt: true } };
  // Schneewälle an den Hauswänden
  if (schnee) {
    const sm = new THREE.MeshStandardMaterial({ color: '#f1f4f8', roughness: 0.95 });
    const rn = rauschen2(31);
    for (const s of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(0.9, lange, 4, Math.round(lange * 2));
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / 0.9 + 0.5, v = p.getY(i);
        const hoch = (0.06 + rn(v * 0.8, s * 10) * 0.18) * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.5) ** 1.5;
        p.setZ(i, hoch);
      }
      geo.computeVertexNormals();
      const w = new THREE.Mesh(geo, sm);
      w.rotation.x = -Math.PI / 2; w.rotation.z = s < 0 ? Math.PI : 0;
      w.position.set(s * (strasse.BREITE / 2 - 0.42), 0.005, z0 - lange / 2);
      g.add(w);
    }
  }
  return { stufe3: [zeichnen] };
}

// ---------- Silhouetten: Dächer und ein Turm der Altstadt hinter der Nummer 13 ----------
function silhouetten(ctx, g) {
  const { T, strasse, S } = ctx, r = zufall(4242), E = strasse.ENDE;
  const schnee = !!T.schnee, abend = S === 'abend';
  const fern = new THREE.Color(T.nebel).lerp(new THREE.Color(abend ? '#06080d' : '#6f7480'), abend ? 0.55 : 0.6);
  const wandM = new THREE.MeshLambertMaterial({ color: fern.clone().lerp(new THREE.Color(abend ? '#2a2420' : '#d8d0c4'), 0.35) });
  const dachM = new THREE.MeshLambertMaterial({ color: schnee ? new THREE.Color('#e9edf3').lerp(fern, abend ? 0.6 : 0.15) : fern.clone().lerp(new THREE.Color(abend ? '#1a100c' : '#6e3f30'), 0.7) });
  const fensterM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb15c').multiplyScalar(0.85), fog: false, transparent: true, opacity: 0.8 });
  const fensterGeo = new THREE.PlaneGeometry(0.9, 1.3);
  const haus = (x, z, b, h, tief, giebelVorn, kamin) => {
    const k = new THREE.Mesh(new THREE.BoxGeometry(b, h, tief), wandM); k.position.set(x, h / 2, z); g.add(k);
    const dh = (giebelVorn ? b : tief) * 0.55;
    const s = new THREE.Shape(); const w = giebelVorn ? b : tief;
    s.moveTo(-w / 2 - 0.4, 0); s.lineTo(0, dh); s.lineTo(w / 2 + 0.4, 0); s.lineTo(-w / 2 - 0.4, 0);
    const dg = new THREE.ExtrudeGeometry(s, { depth: (giebelVorn ? tief : b) + 0.6, bevelEnabled: false });
    dg.translate(0, 0, -((giebelVorn ? tief : b) + 0.6) / 2);
    const d = new THREE.Mesh(dg, [wandM, dachM]); d.position.set(x, h, z); if (!giebelVorn) d.rotation.y = Math.PI / 2; g.add(d);
    if (kamin) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.7), wandM); c.position.set(x + wert(r, -b * 0.3, b * 0.3), h + dh * 0.6, z + wert(r, -tief * 0.2, tief * 0.2)); g.add(c); }
    // Einige erleuchtete Fenster am Abend
    if (abend) for (let st = 0; st < Math.floor(h / 3.2) - 1; st++) for (let a = 0; a < Math.floor(b / 2.4); a++) {
      if (r() > 0.22) continue;
      const f = new THREE.Mesh(fensterGeo, fensterM); f.position.set(x - b / 2 + 1.3 + a * 2.4, 3.6 + st * 3.2, z + tief / 2 + 0.02); g.add(f);
    }
  };
  // Zeile direkt hinter der 13 (höher, damit sie über Dach und Traufen schaut)
  for (let x = -26; x < 26;) { const b = wert(r, 7, 11); haus(x + b / 2, E - wert(r, 13, 17), b, wert(r, 11.5, 15.5), 9, r() < 0.35, r() < 0.6); x += b + wert(r, 0.2, 1.5); }
  // Zweite Zeile, weiter weg
  for (let x = -40; x < 40;) { const b = wert(r, 8, 13); haus(x + b / 2, E - wert(r, 30, 38), b, wert(r, 15, 22), 10, r() < 0.3, r() < 0.5); x += b + wert(r, 0.5, 3); }
  // Ein Kirchturm in der Ferne
  {
    const x = 13, z = E - 58, b = 6, h = 38;
    const t = new THREE.Mesh(new THREE.BoxGeometry(b, h, b), wandM); t.position.set(x, h / 2, z); g.add(t);
    const helm = new THREE.Mesh(new THREE.ConeGeometry(b * 0.75, 13, 4), dachM); helm.position.set(x, h + 6.5, z); helm.rotation.y = Math.PI / 4; g.add(helm);
    for (const dx of [-1.4, 1.4]) { const sl = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.6), new THREE.MeshBasicMaterial({ color: fern.clone().multiplyScalar(0.6) })); sl.position.set(x + dx, h - 4, z + b / 2 + 0.02); g.add(sl); }
  }
  // Rückseiten der Häuserzeilen: Dächer, die über die Traufen der Gasse schauen
  for (const s of [-1, 1]) for (let z = 10; z > E - 6;) { const b = wert(r, 6, 10); haus(s * wert(r, 13, 17), z - b / 2, 8, wert(r, 13, 18), b, false, r() < 0.5); z -= b + wert(r, 0, 1); }
  return null;
}

// ---------- Aushänge: die Fotos der Laden-Seite als Aufsteller mit Bildunterschrift ----------
function aushaenge(ctx, g) {
  const weg = document.querySelector('.gweg');
  const lis = weg ? [...weg.querySelectorAll('.aushaenge > li')] : [];
  if (!lis.length) return null;
  const { T, q, S } = ctx, abend = S === 'abend';
  // Nur Karten kurz vor der Kamera brauchen eine grosse Textur, ferne bekommen eine kleine. Der Wechsel geschieht beim Gehen in aktualisieren.
  // Beide behalten Mipmaps: Beim Wechsel erscheint die grosse Karte noch etwa halb so gross, ohne Mipmaps flimmerte die Schrift.
  // Hochkant (schmal): Tafeln 1.6× so gross, tiefer, näher zur Mitte und mehr zur Kamera gedreht, Foto füllt mehr der Tafel.
  // Damit das Textur-Budget hält, ist dort nur scharf, was VORN bis NAH m vor der Kamera steht: das Fenster samt Spielraum (7.1 m) ist kürzer als
  // zwei Tafelabstände (7.3 m), also höchstens zwei scharfe Tafeln.
  const schmal = ctx.breite < ctx.hoehe * 0.9, F = schmal ? 1.6 : 1;
  const GROSS = q === 'hoch' ? 512 : q === 'mittel' ? 384 : schmal ? 240 : 192, KLEIN = q === 'hoch' ? 192 : q === 'mittel' ? 128 : 96;
  // Hochkant stehen die Tafeln X_SCHMAL m neben der Mitte. Die letzten zwei stehen weiter aussen (X_VORLETZTE, X_LETZTE), sonst stünden sie
  // gegen Ende der Fahrt vor der Ladenfront von Nr. 13 und ihren Requisiten. Die Kamera schwankt hochkant nur ±0.15 m (haupt.js) und bleibt
  // so mindestens 0.45 m von jeder Tafel.
  const X_SCHMAL = 1.45, X_VORLETZTE = 1.8, X_LETZTE = 1.9;
  if (schmal) ctx.aushaengeSchmal = true;                          // haupt.js hält damit das Kameraschwanken klein, auch nach dem Drehen
  // VORN hängt am Bildausschnitt (Blickwinkel 60° senkrecht wie in haupt.js): Die Innenkante der Tafel liegt etwa 0.65 m näher zur Mitte
  // als ihre Mitte; ist die halbe Bildbreite schmaler, ist die Tafel fast ganz draussen. Auf 390×844 sind das 3.0 m. NAH liegt 6.5 m dahinter.
  const tH = Math.tan(Math.PI / 6) * ctx.breite / ctx.hoehe;
  const VORN = schmal ? Math.max(1, (X_SCHMAL - 0.65) / tH) : -1, SP = schmal ? 0.3 : 1.5;   // bis wohin sie scharf bleibt; Spielraum gegen Hin- und Herschalten
  const NAH = schmal ? VORN + 6.5 : 9;                             // Meter vor der Kamera, ab denen eine Karte scharf wird
  const VORSCHAU = 32;                                             // Breite der Vorschau bis Stufe 3 (Pixel)
  const KB = 1.0 * F, KH = 1.08 * F;                               // Karte in Metern
  const UK = schmal ? 0.45 : 1.0;                                  // Unterkante der Karte: hochkant tiefer, damit die nahen Tafeln die Wandlaternen nicht verdecken
  const RAND = schmal ? 0.035 : 0.06, FOTO = schmal ? 0.84 : 0.75, SCHRIFT = schmal ? 0.082 : 0.075;   // Anteile an der Kartenbreite
  const holz = new THREE.MeshStandardMaterial({ color: '#3a2c22', roughness: 0.7 });
  const schneeM = new THREE.MeshStandardMaterial({ color: '#f2f5f9', roughness: 0.95 });
  const serif = getComputedStyle(document.documentElement).getPropertyValue('--serif') || 'serif';
  const n = lis.length, karten = [];
  lis.forEach((li, i) => {
    const dom = li.querySelector('img'), img = new Image(), cap = (li.querySelector('figcaption') || {}).textContent || dom.alt || '';
    img.decoding = 'async'; img.src = dom.currentSrc || dom.src;
    const s = i % 2 ? 1 : -1, z = -3 - (25.5 * i) / (n - 1), x = s * (schmal ? (i === n - 1 ? X_LETZTE : i === n - 2 ? X_VORLETZTE : X_SCHMAL) : 2.45);
    const st = { z, gross: null, c: null, t: null };
    const zeichne = () => {
      if (!st.c) return;
      const c = st.c, t = st.t, k = c.getContext('2d'), W = c.width, H = c.height, m = W * RAND;
      k.fillStyle = '#fbf8f1'; k.fillRect(0, 0, W, H);
      const pw = W - 2 * m, ph = pw * FOTO;
      if (img.complete && img.naturalWidth) {
        const sr = img.naturalWidth / img.naturalHeight, dr = pw / ph;
        let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
        if (sr > dr) { sw = sh * dr; sx = (img.naturalWidth - sw) / 2; } else { sh = sw / dr; sy = (img.naturalHeight - sh) / 2; }
        k.drawImage(img, sx, sy, sw, sh, m, m, pw, ph);
      } else { k.fillStyle = '#8d8778'; k.fillRect(m, m, pw, ph); }
      k.fillStyle = '#2a2622'; k.textAlign = 'center'; k.textBaseline = 'middle';
      let fs = Math.round(W * SCHRIFT); k.font = `${fs}px ${serif}`;
      while (k.measureText(cap).width > pw && fs > 8) { fs--; k.font = `${fs}px ${serif}`; }
      k.fillText(cap, W / 2, m + ph + (H - m - ph) / 2);
      // Klebstreifen oben
      k.fillStyle = 'rgba(221,209,179,.9)'; k.save(); k.translate(W / 2, m * 0.45); k.rotate(-0.04); k.fillRect(-W * 0.12, -m * 0.35, W * 0.24, m * 0.7); k.restore();
      t.needsUpdate = true; ctx.malen && ctx.malen();
    };
    // Bis Stufe 3: dieselbe Karte winzig (VORSCHAU Pixel breit) als Vorschau, ab Stufe 1 sichtbar.
    // Ist das Foto noch nicht da, steht ein mittlerer Bildton; beim Laden des Fotos wird sie neu gezeichnet.
    const vc = document.createElement('canvas'); vc.width = VORSCHAU; vc.height = Math.round(VORSCHAU * KH / KB);
    const vt = new THREE.CanvasTexture(vc); vt.colorSpace = THREE.SRGBColorSpace;
    st.c = vc; st.t = vt; zeichne();
    const karte = new THREE.Mesh(new THREE.PlaneGeometry(KB, KH), new THREE.MeshStandardMaterial({
      map: vt, emissiveMap: vt, roughness: 0.85, emissive: '#ffffff', emissiveIntensity: abend ? 0.16 : 0.0,
    }));
    karte.material.userData.einfachKarte = true;
    // Neue Textur zeichnen (gross oder klein); einsetzen erst mit setzen()
    st.neu = gross => {
      const w = gross ? GROSS : KLEIN, c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * KH / KB);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      const alt = st.t; st.c = c; st.t = t; st.gross = gross; zeichne();
      return () => { karte.material.map = karte.material.emissiveMap = t; if (alt) alt.dispose(); };
    };
    st.stufe = gross => { if (!st.bereit || st.gross === gross) return false; st.neu(gross)(); return true; };
    // Stufe 3: Foto abwarten (höchstens 4 s), zeichnen, hochladen, überblendet einsetzen
    st.laden = async () => {
      if (!(img.complete && img.naturalWidth)) await new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); setTimeout(r, 4000); });
      const setzen = st.neu(nah(z, ctx.kamera.position.z, false));
      await hochladen(ctx, [st.t]);
      tauschen(ctx, setzen);
      st.bereit = true; melden();
      return true;
    };
    if (!(img.complete && img.naturalWidth)) img.addEventListener('load', () => zeichne(), { once: true });
    if (document.fonts) document.fonts.ready.then(() => zeichne());
    karten.push(st);
    const a = new THREE.Group(); a.position.set(x, 0, z); a.rotation.y = -s * (schmal ? 0.45 : 0.42); g.add(a);
    karte.position.set(0, UK + KH / 2, 0.035); a.add(karte);
    // Rahmen und Rückwand
    const rw = new THREE.Mesh(new THREE.BoxGeometry(KB + 0.12, KH + 0.12, 0.05), holz); rw.position.set(0, UK + KH / 2, 0); a.add(rw);
    // Zwei Beine
    for (const bx of [-KB / 2 + 0.06, KB / 2 - 0.06]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, UK + 0.05, 0.06), holz); b.position.set(bx, (UK + 0.05) / 2 - 0.005, -0.02); a.add(b); }
    // Kleines Dach gegen Regen
    const dach = new THREE.Mesh(new THREE.BoxGeometry(KB + 0.26, 0.05, 0.24), holz); dach.position.set(0, UK + KH + 0.1, 0.06); dach.rotation.x = 0.25; a.add(dach);
    if (T.schnee) { const sh = new THREE.Mesh(new THREE.BoxGeometry(KB + 0.22, 0.07, 0.2), schneeM); sh.position.set(0, UK + KH + 0.16, 0.06); sh.rotation.x = 0.25; a.add(sh); }
  });
  // Prüfmodus: Breite der Kartentexturen an .gweg (data-aushaenge), damit der Wechsel nachprüfbar ist
  const pruef = weg.classList.contains('gweg--pruef') || new URLSearchParams(location.search).has('rollen');
  const melden = () => { if (pruef) weg.dataset.aushaenge = karten.map(k => k.bereit && k.c ? k.c.width : 0).join(' '); };
  melden();
  // Reihenfolge der Fotos: von nah nach fern (Abstand vor der Kamera; schon passierte zuletzt)
  const kz = ctx.kamera.position.z, abstand = k => k.z <= kz + 1 ? kz - k.z : 1000 + k.z;
  const stufe3 = [...karten].sort((a, b) => abstand(a) - abstand(b)).map(k => () => k.laden());
  return { stufe3, entsorgen() { for (const k of karten) k.t && k.t.dispose(); }, aktualisieren() { let w = false; for (const k of karten) if (k.stufe(nah(k.z, ctx.kamera.position.z, k.gross))) w = true; if (w) melden(); return w; } };
  // Scharf, solange die Karte zwischen VORN und NAH m vor der Kamera steht (mit SP m Spielraum gegen Hin- und Herschalten)
  function nah(z, kz, jetzt) { const d = kz - z, sp = jetzt ? SP : 0; return d > VORN - sp && d < NAH + sp; }
}
