// Platzhalter der Bühne: Teile des abgenommenen Prototyps (site/stimmung/szene.js), die laufen,
// solange ein Modul noch nichts liefert. haupt.js schaltet einen Platzhalter nur ein, wenn das
// zugehörige Modul der Szene nichts hinzugefügt hat. Wird entfernt, sobald alle Module liefern.
import { THREE, zufall, leinwand, tex, koernung, freigeben, fleck } from './gemeinsam.js';

function gruppe(ctx, name) { const g = new THREE.Group(); g.name = name; ctx.szene.add(g); return g; }
function fertig(g, extra) { return { aktualisieren: extra || (() => false), entsorgen() { freigeben(g); g.removeFromParent(); } }; }

// ---------- licht: Himmel, Nebel, Grundlicht, Laternen ----------
export function licht(ctx) {
  const { szene, T, S } = ctx, g = gruppe(ctx, 'platzhalter-licht');
  szene.fog = new THREE.FogExp2(new THREE.Color(T.nebel), T.dichte);
  ctx.renderer.toneMappingExposure = T.belichtung;
  g.add(new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zenit: { value: new THREE.Color(T.zenit) }, mitte: { value: new THREE.Color(T.mitte) }, horizont: { value: new THREE.Color(T.horizont) },
                glut: { value: new THREE.Color(T.glut) }, sterne: { value: T.sterne }, schnee: { value: T.schnee } },
    vertexShader: `varying vec3 vR; void main(){ vR = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 zenit, mitte, horizont, glut; uniform float sterne, schnee; varying vec3 vR;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
      void main(){
        float y = clamp(vR.y, 0., 1.);
        vec3 c = mix(horizont, mitte, smoothstep(0., .22, y));
        c = mix(c, zenit, smoothstep(.18, .75, y));
        c += glut * .35 * pow(1. - y, 6.) * smoothstep(-.4, .6, -vR.z);
        vec2 uv = vR.xz / (y + .25) * 2.2;
        float w = fbm(uv * .9 + vec2(3.1, 1.7));
        c = mix(c, mix(c, horizont * 1.05, .5), smoothstep(.45, .85, w) * (.55 + .35 * schnee) * smoothstep(.02, .3, y));
        float st = step(.9965, h(floor(vR.xy * 420.) + floor(vR.z * 420.))) * smoothstep(.15, .6, y) * (1. - smoothstep(.4, .8, w));
        c += vec3(.9, .92, 1.) * st * sterne;
        gl_FragColor = vec4(c, 1.);
      }`
  })));
  g.add(new THREE.HemisphereLight(new THREE.Color(T.mitte).lerp(new THREE.Color(S === 'tag' ? '#fff4e2' : '#c8d4ff'), S === 'tag' ? 0.6 : 0.25), new THREE.Color('#1c1a20'), T.hell * 1.9));
  const mond = new THREE.DirectionalLight(new THREE.Color(T.horizont), T.hell * 0.9); mond.position.set(-12, 30, 10); g.add(mond);
  if (T.sonne) { const s = new THREE.DirectionalLight('#ffe7c2', T.sonne); s.position.set(-18, 26, -6); g.add(s); }
  // Laternen an den Plätzen aus ctx.lampen
  const an = T.lampe > 0, BREITE = ctx.strasse.BREITE;
  const eisen = new THREE.MeshStandardMaterial({ color: '#16130f', roughness: 0.5 });
  const glas = new THREE.MeshStandardMaterial({ color: '#2a2018', emissive: '#ffb45a', emissiveIntensity: an ? 3 : 0, transparent: !an, opacity: an ? 1 : 0.55 });
  for (const { x, y, z } of ctx.lampen) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.09, 0.32, 6), glas); k.position.set(x, y, z); g.add(k);
    const d = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.16, 6), eisen); d.position.set(x, y + 0.24, z); g.add(d);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(Math.abs(x) - BREITE / 2) + 0.05, 0.04, 0.04), eisen); arm.position.set((x + Math.sign(x) * BREITE / 2) / 2, y + 0.32, z); g.add(arm);
    if (!an) continue;
    const l = new THREE.PointLight('#ffae55', 6 * T.lampe, 6.5, 1.8); l.position.set(x, y - 0.2, z); g.add(l);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fleck(128), color: '#ffb860', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(x, y, z); sp.scale.set(1.1, 0.77, 1); g.add(sp);
  }
  return fertig(g);
}

// ---------- fassaden: Fassadentextur des Prototyps je Haus aus ctx.haeuser ----------
const LADEN = ['#3f5a55', '#7d2e2e', '#556b4f', '#6b4a35', '#3b4a5c', '#8a7a5c'];
const BLUMEN = ['#a62c54', '#e2aca0', '#f3ebe5', '#cb567d', '#752538'];
function fassade(ctx, b, h, seed, opt = {}) {
  const { T, S } = ctx, px = ctx.px, m = px;
  const r = zufall(seed);
  const [cF, gF] = leinwand(b, h, px), [cB, gB] = leinwand(b, h, px), [cE, gE] = leinwand(b, h, px);
  const W = cF.width, H = cF.height, s = px / 48;
  const putz = opt.putz, laden = opt.laden || LADEN[Math.floor(r() * LADEN.length)];
  gF.fillStyle = putz; gF.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) { gF.fillStyle = `rgba(${r() < .5 ? '90,70,50' : '255,250,240'},${0.03 + r() * 0.04})`; gF.beginPath(); gF.ellipse(r() * W, r() * H, (20 + r() * 90) * s, (10 + r() * 60) * s, 0, 0, 7); gF.fill(); }
  koernung(gF, W, H, r, 14);
  gB.fillStyle = '#808080'; gB.fillRect(0, 0, W, H); koernung(gB, W, H, r, 26);
  gE.fillStyle = '#000'; gE.fillRect(0, 0, W, H);
  const eg = opt.eg || 4.2;
  gF.fillStyle = 'rgba(70,60,50,.35)'; gF.fillRect(0, H - 0.7 * m, W, 0.7 * m);
  for (const [y, d] of [[H - eg * m, 0.28], [0.25 * m, 0.45]]) {
    gF.fillStyle = 'rgba(255,255,255,.35)'; gF.fillRect(0, y - d * m, W, d * m * 0.5);
    gF.fillStyle = 'rgba(60,45,30,.25)'; gF.fillRect(0, y - d * m * 0.5, W, d * m * 0.5);
    gB.fillStyle = '#e0e0e0'; gB.fillRect(0, y - d * m, W, d * m);
    if (T.schnee) { gF.fillStyle = '#f4f6fa'; gF.fillRect(0, y - d * m - 3 * s, W, 6 * s); }
  }
  const achsen = Math.max(2, Math.round(b / 2.6)), fb = 1.05, fh = 1.6, stock = Math.floor((h - eg - 1.2) / 3.0);
  for (let st = 0; st < stock; st++) for (let a = 0; a < achsen; a++) {
    const cx = (a + 0.5) * W / achsen, y = H - (eg + 0.9 + st * 3.0 + fh) * m, x = cx - fb * m / 2, w = fb * m, hh = fh * m;
    const hell = r() < T.fenster && T.fenster > 0.1;
    for (const sx of [x - 0.62 * m, x + w + 0.06 * m]) { gF.fillStyle = laden; gF.fillRect(sx, y - 2 * s, 0.56 * m, hh + 4 * s); for (let l = y + 4 * s; l < y + hh; l += 7 * s) { gF.fillStyle = 'rgba(0,0,0,.22)'; gF.fillRect(sx + 3 * s, l, 0.56 * m - 6 * s, 2 * s); } }
    gF.fillStyle = '#efe9dd'; gF.fillRect(x - 6 * s, y - 6 * s, w + 12 * s, hh + 12 * s);
    gB.fillStyle = '#c8c8c8'; gB.fillRect(x - 6 * s, y - 6 * s, w + 12 * s, hh + 12 * s);
    const gr = gF.createLinearGradient(0, y, 0, y + hh);
    if (hell) { gr.addColorStop(0, '#f6c77a'); gr.addColorStop(0.6, '#d9893f'); gr.addColorStop(1, '#8a4e25'); }
    else if (S === 'tag') { gr.addColorStop(0, '#b9cbe0'); gr.addColorStop(0.5, '#6f86a3'); gr.addColorStop(1, '#3a4656'); }
    else { gr.addColorStop(0, '#5d6a7c'); gr.addColorStop(1, '#232a35'); }
    gF.fillStyle = gr; gF.fillRect(x, y, w, hh); gB.fillStyle = '#202020'; gB.fillRect(x, y, w, hh);
    if (hell) { const ge = gE.createRadialGradient(cx, y + hh * 0.35, 4 * s, cx, y + hh * 0.5, hh * 0.8); ge.addColorStop(0, '#ffcf86'); ge.addColorStop(1, '#a8541c'); gE.fillStyle = ge; gE.fillRect(x, y, w, hh); }
    gF.fillStyle = '#f4efe6'; gF.fillRect(cx - 2 * s, y, 4 * s, hh); gF.fillRect(x, y + hh * 0.42, w, 4 * s);
    gE.fillStyle = '#000'; gE.fillRect(cx - 2 * s, y, 4 * s, hh); gE.fillRect(x, y + hh * 0.42, w, 4 * s);
    gF.fillStyle = '#d8cfbf'; gF.fillRect(x - 10 * s, y + hh + 2 * s, w + 20 * s, 6 * s);
    if (r() < 0.75) {
      gF.fillStyle = '#6b4a35'; gF.fillRect(x - 4 * s, y + hh - 10 * s, w + 8 * s, 14 * s);
      for (let k = 0; k < 9; k++) { const bx = x + 2 * s + k * (w - 4 * s) / 8, by = y + hh - (12 + r() * 8) * s; gF.fillStyle = BLUMEN[Math.floor(r() * BLUMEN.length)]; gF.beginPath(); gF.arc(bx, by, 3.4 * s, 0, 7); gF.fill(); }
      if (T.schnee) { gF.fillStyle = '#f4f6fa'; gF.fillRect(x - 6 * s, y + hh - 14 * s, w + 12 * s, 4 * s); }
    }
  }
  if (!opt.ohneEG) {
    const ty = H - (eg - 0.5) * m, th = (eg - 1.2) * m, tx = (0.2 + r() * 0.15) * W, tw = 1.2 * m;
    gF.fillStyle = '#3b2e23'; gF.beginPath(); gF.roundRect(tx, ty, tw, th, [tw / 2, tw / 2, 0, 0]); gF.fill();
    const ax = tx + tw + 0.6 * m, aw = Math.min(W - ax - 0.4 * m, 3.4 * m), ay = ty + 0.3 * m, ah = th - 0.9 * m;
    if (aw > m) {
      const lit = r() < T.fenster * 0.8 && T.fenster > 0.1;
      gF.fillStyle = '#3f3a35'; gF.fillRect(ax - 8 * s, ay - 8 * s, aw + 16 * s, ah + 16 * s);
      const g2 = gF.createLinearGradient(0, ay, 0, ay + ah);
      if (lit) { g2.addColorStop(0, '#f2c27f'); g2.addColorStop(1, '#7b4a28'); } else if (S === 'tag') { g2.addColorStop(0, '#aebfd2'); g2.addColorStop(1, '#3d4654'); } else { g2.addColorStop(0, '#556072'); g2.addColorStop(1, '#1d232c'); }
      gF.fillStyle = g2; gF.fillRect(ax, ay, aw, ah);
      if (lit) { gE.fillStyle = '#c9772e'; gE.fillRect(ax, ay, aw, ah); }
    }
  }
  return new THREE.MeshStandardMaterial({ map: tex(cF, true), bumpMap: tex(cB), bumpScale: 2.2, roughness: 0.92, emissive: new THREE.Color('#ffb860'), emissiveMap: tex(cE, true), emissiveIntensity: 1.25 });
}
export function fassaden(ctx) {
  const g = gruppe(ctx, 'platzhalter-fassaden'), { T } = ctx;
  const traufe = new THREE.MeshStandardMaterial({ color: T.schnee ? '#e9edf3' : '#4a3a2e', roughness: 0.8 });
  for (const h of ctx.haeuser) {
    const b = h.z0 - h.z1;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b, h.hoehe), fassade(ctx, b, h.hoehe, h.seed, { putz: h.putz, laden: h.laden, eg: h.eg }));
    mesh.position.set(h.x, h.hoehe / 2, (h.z0 + h.z1) / 2); mesh.rotation.y = -h.seite * Math.PI / 2; g.add(mesh);
    const tr = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, b + 0.05), traufe); tr.position.set(h.x - h.seite * 0.5, h.hoehe + 0.1, (h.z0 + h.z1) / 2); g.add(tr);
  }
  return fertig(g);
}

// ---------- requisiten: Nummer 13 und Schnee ----------
export function requisiten(ctx) {
  const g = gruppe(ctx, 'platzhalter-requisiten'), { T, lader, basis } = ctx, { x: X, z: Z, breite: B13, hoehe: H13, eg } = ctx.nr13;
  const bild = p => { const t = lader.load(basis + p); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const front = new THREE.Mesh(new THREE.PlaneGeometry(B13, H13), fassade(ctx, B13, H13, 1313, { putz: '#f5f1e8', ohneEG: true, eg }));
  front.position.set(X, H13 / 2, Z); g.add(front);
  const glas = (map, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.95 * T.laden + 0.1, roughness: 0.15 }));
  const sf = glas(bild('bilder/schaufenster-abend.jpg'), 5.0, 2.85); sf.position.set(X - 1.5, 2.15, Z + 0.02); g.add(sf);
  const tf = glas(bild('bilder/laden-innen.jpg'), 1.7, 2.85); tf.position.set(X + 2.85, 2.15, Z + 0.02); g.add(tf);
  const holz = new THREE.MeshStandardMaterial({ color: '#2b2723', roughness: 0.6 });
  for (const [w, h, x, y] of [[8.2, 0.25, 0, 3.7], [8.2, 0.5, 0, 0.47], [0.22, 3.4, -4.05, 2.1], [0.22, 3.4, 4.05, 2.1], [0.22, 3.4, 1.92, 2.1]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), holz); b.position.set(X + x, y, Z + 0.15); g.add(b);
  }
  const [cS, gS] = leinwand(4.8, 0.8); gS.fillStyle = '#fbfaf6'; gS.fillRect(0, 0, cS.width, cS.height);
  const schildTex = tex(cS, true);
  const logo = new Image(); logo.onload = () => { const w = cS.width * 0.86, h = w * 62 / 500; gS.drawImage(logo, (cS.width - w) / 2, (cS.height - h) / 2, w, h); schildTex.needsUpdate = true; ctx.malen(); };
  logo.src = basis + 'logo.png';
  const schild = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.8, 0.08), [holz, holz, holz, holz, new THREE.MeshStandardMaterial({ map: schildTex, emissive: '#fff3df', emissiveMap: schildTex, emissiveIntensity: 0.18, roughness: 0.5 }), holz]);
  schild.position.set(X - 0.5, 4.72, Z + 0.06); g.add(schild);
  const [cN, gN] = leinwand(0.5, 0.42); gN.fillStyle = '#1f3d82'; gN.fillRect(0, 0, cN.width, cN.height);
  gN.fillStyle = '#fff'; gN.font = 'bold 12px sans-serif'; gN.textAlign = 'center'; gN.fillText('13', cN.width / 2, cN.height / 2 + 4);
  const nr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.42), new THREE.MeshStandardMaterial({ map: tex(cN, true), roughness: 0.4 })); nr.position.set(X + 2.4, 4.72, Z + 0.06); g.add(nr);
  const [cM, gM] = leinwand(8.4, 1.4); const st = cM.width / 14;
  for (let k = 0; k < 14; k++) { gM.fillStyle = k % 2 ? '#f6f3ec' : '#141414'; gM.fillRect(k * st, 0, st, cM.height - st / 2); gM.beginPath(); gM.arc(k * st + st / 2, cM.height - st / 2, st / 2, 0, Math.PI); gM.fill(); }
  const markise = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 1.4), new THREE.MeshStandardMaterial({ map: tex(cM, true), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }));
  markise.position.set(X, 3.95, Z + 0.62); markise.rotation.x = -0.75; g.add(markise);
  const spot = new THREE.SpotLight('#ffb35c', 140 * T.laden * T.laden, 18, 0.9, 0.7, 1.4);
  spot.position.set(X, 2.6, Z + 0.3); spot.target.position.set(X, 0, Z + 7); g.add(spot, spot.target);
  const fill = new THREE.PointLight('#ffb866', 14 * T.laden, 12, 1.4); fill.position.set(X, 2.2, Z + 1.6); g.add(fill);
  const gruen = new THREE.MeshStandardMaterial({ color: '#3f5a55', roughness: 0.9 }), topf = new THREE.MeshStandardMaterial({ color: '#7a5638', roughness: 0.8 });
  const kranz = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.11, 10, 28), gruen); kranz.position.set(X + 2.85, 2.75, Z + 0.12); g.add(kranz);
  for (const x of [-3.7, -2.9, 3.9]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.45, 16), topf); t.position.set(X + x, 0.23, Z + 0.7); g.add(t);
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.4, 9), gruen); b.position.set(X + x, 1.1, Z + 0.7); g.add(b);
  }
  if (T.laden > 0.6) for (const [x, s] of [[-1.5, 6.4], [2.85, 3]]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fleck(128), color: '#ffb45c', transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.position.set(X + x, 2.15, Z + 0.3); sp.scale.set(s, s * 0.7, 1); g.add(sp);
  }
  // Schnee: Flocken
  let flocken = null;
  if (T.schnee) {
    const n = ctx.q === 'tief' ? 1200 : 2600, pos = new Float32Array(n * 3), r = zufall(5);
    for (let i = 0; i < n; i++) { pos[i * 3] = (r() - .5) * 12; pos[i * 3 + 1] = r() * 16; pos[i * 3 + 2] = 8 - r() * 54; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    flocken = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, map: fleck(32), transparent: true, depthWrite: false, opacity: 0.9 }));
    g.add(flocken);
  }
  return fertig(g, (t, dt) => {
    if (!flocken || ctx.ruhig) return false;
    const p = flocken.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) { p[i + 1] -= dt * 0.8; p[i] += Math.sin(t * 1.1 + i) * dt * 0.12; if (p[i + 1] < 0) p[i + 1] += 16; }
    flocken.geometry.attributes.position.needsUpdate = true;
    return true;
  });
}
