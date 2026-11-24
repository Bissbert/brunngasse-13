// Modul licht der WebGL-Gasse. Vertrag: stimmung/VERTRAG.md
// Himmel (Verlauf, Wolken, Sterne, Sonne, Mond), Nebel, Grundlicht und Umgebung, Sonnenschatten am Tag,
// Laternen aus ctx.lampen (Körper, Licht, Hof, Lichtkegel), Lichtkegel aus dem Laden, nasse Spiegelung
// auf dem Pflaster und eine eigene Nachbearbeitung (Bloom nur auf warmen Lichtern, Farbkorrektur, Vignette, Korn).
// Ohne zeichnen() (wenn haupt.js direkt renderer.render ruft) sieht alles richtig aus, nur ohne Bloom und Korn.

// ---------- kleine Helfer ----------
const VOLLBILD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const RAUSCHEN = `
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float rausch(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
  float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 5; i++){ s += a * rausch(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
`;

function radialTextur(THREE, stufen, groesse = 128) {
  const c = document.createElement('canvas'); c.width = c.height = groesse;
  const g = c.getContext('2d'), m = groesse / 2;
  const rg = g.createRadialGradient(m, m, 0, m, m, m);
  for (const [o, a] of stufen) rg.addColorStop(o, `rgba(255,255,255,${a})`);
  g.fillStyle = rg; g.fillRect(0, 0, groesse, groesse);
  const t = new THREE.CanvasTexture(c); return t;
}

export function bauen(ctx) {
  const { THREE, renderer, szene, kamera, S, T } = ctx;
  const q = ctx.q || 'hoch';
  const tag = S === 'tag';
  const schnee = !!T.schnee;
  const BREITE = (ctx.strasse && ctx.strasse.BREITE) || 7.8;
  const ENDE = (ctx.strasse && ctx.strasse.ENDE) || -44;
  const nass = 1 - T.nass;                                   // T.nass ist die Rauheit: tief = nass
  // Gestaffeltes Laden (VERTRAG, Runde 3): mit ctx.kompilieren liefert licht Stufen 2 und 4 nach;
  // ohne (älteres haupt.js) wird alles sofort fertig gebaut wie bisher.
  const gestaffelt = typeof ctx.kompilieren === 'function';
  let entsorgt = false;
  // Überblendungen: fn(a) mit a von 0 nach 1, getrieben aus aktualisieren()
  const blenden = [];
  const weich = x => x * x * (3 - 2 * x);
  function blende(dauer, fn) {
    if (!gestaffelt || !(dauer > 0)) { fn(1); return; }
    fn(0); blenden.push({ t0: 0, dauer, fn });
  }

  const gruppe = new THREE.Group(); gruppe.name = 'licht'; szene.add(gruppe);
  const frei = [];                                           // alles, was entsorgt werden muss
  const merk = o => { frei.push(o); return o; };
  const eigen = o => { o.userData.lichtEigen = true; return o; };
  const farbe = h => new THREE.Color(h);

  // ---------- Renderer-Grundwerte ----------
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = T.belichtung;
  const schatten = tag && q !== 'tief' && !ctx.keineSchatten;
  renderer.shadowMap.enabled = schatten && !gestaffelt;          // gestaffelt: erst in Stufe 4, vorkompiliert
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // ---------- Nebel ----------
  const nebelAlt = szene.fog;
  // Bei Schnee etwas lichter als der Rohwert, damit die 13 am Ende der Gasse lesbar bleibt
  szene.fog = new THREE.FogExp2(farbe(T.nebel), T.dichte * (schnee ? 0.65 : 1));

  // ---------- Richtungen von Sonne und Mond ----------
  // Sonne hoch von links vorn: die rechte Häuserzeile und die 13 bekommen Licht, auf dem Pflaster bleibt rechts ein Sonnenstreifen.
  const sonneRichtung = new THREE.Vector3(-0.36, 0.86, 0.36).normalize();
  // Mond über der 13, gerade noch im Himmelsstreifen sichtbar
  const mondRichtung = new THREE.Vector3(0.07, 0.50, -1).normalize();

  // ---------- Himmel ----------
  const himmelUni = {
    zenit: { value: farbe(T.zenit) }, mitte: { value: farbe(T.mitte) }, horizont: { value: farbe(T.horizont) },
    glut: { value: farbe(T.glut) }, sterne: { value: T.sterne || 0 }, schnee: { value: T.schnee || 0 },
    tag: { value: tag ? 1 : 0 }, zeit: { value: 0 },
    sonneR: { value: sonneRichtung }, sonne: { value: tag ? Math.min(1, T.sonne / 3.2) : 0 },
    mondR: { value: mondRichtung }, mond: { value: !tag && !schnee ? 1 : 0 },
    umgebung: { value: 0 }, voll: { value: 1 }, wand: { value: farbe(tag ? '#b9ab97' : '#2a1d14') },
  };
  const himmelMat = merk(new THREE.ShaderMaterial({
    uniforms: himmelUni, depthWrite: false, depthTest: true, fog: false, side: THREE.BackSide,
    vertexShader: `
      varying vec3 vR;
      void main(){ vR = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 zenit, mitte, horizont, glut, sonneR, mondR, wand;
      uniform float sterne, schnee, tag, zeit, sonne, mond, umgebung, voll;
      varying vec3 vR;
      ${RAUSCHEN}
      vec3 lin(vec3 c){ return c * c; }                         // Stimmungsfarben wie im abgenommenen Bild: kräftiger, tiefer
      void main(){
        vec3 r = normalize(vR);
        float y = clamp(r.y, 0., 1.);
        // Verlauf
        vec3 c = mix(horizont, mitte, smoothstep(0., .25, y));
        c = mix(c, zenit, smoothstep(.2, .8, y));
        // Glut über dem Ende der Gasse (Abendrot / Stadtlicht)
        c += glut * (.35 + .25 * (1. - tag)) * pow(1. - y, 5.) * smoothstep(-.5, .7, -r.z);
        // Sonne: Scheibe und Dunst
        float ds = max(dot(r, sonneR), 0.);
        c += vec3(1., .86, .62) * sonne * (.18 * pow(ds, 8.) + .35 * pow(ds, 64.) + 30. * smoothstep(.99965, .99985, ds)) * (1. - .8 * schnee);
        // Wolken: zwei Schichten mit verzerrtem Rauschen, langsam ziehend
        // Stufe 1 (ohne VOLL): mittlere Bewölkung als Fläche, tonal wie das volle Bild; VOLL blendet die Wolken über 'voll' ein
        vec2 uv = r.xz / (y + .18);
        float wolke = .5, dicht = (.3 + .2 * schnee) * smoothstep(.0, .22, y), rand = 0.;
        #ifdef VOLL
        vec2 w1 = uv * .55 + vec2(zeit * .004, zeit * .0015);
        float warp = fbm(w1 * 1.7 + 3.);
        wolke = mix(.5, fbm(w1 + warp * .6), voll);
        float dv = smoothstep(.48 - .18 * schnee, .82 - .1 * schnee, wolke);
        float fein = fbm(uv * 2.4 + vec2(zeit * .007, 0.) + warp);
        dv = clamp(dv + .25 * smoothstep(.55, .8, fein) * (1. - dv), 0., 1.) * smoothstep(.0, .22, y);
        dicht = mix(dicht, dv, voll);
        rand = (smoothstep(.3, .9, dv) - smoothstep(.9, 1., dv)) * voll;
        #endif
        // Wolkenfarbe: am Tag hell mit grauer Unterseite, nachts vom Stadtlicht warm angestrahlt
        vec3 wTag = mix(horizont * 1.06, mix(mitte, vec3(.62, .64, .7), .6), smoothstep(.55, .95, wolke)) + vec3(1., .9, .75) * sonne * .25 * pow(ds, 4.);
        vec3 wNacht = mix(mitte * 1.6 + glut * .5, horizont * .9, .4 + .4 * schnee) + glut * .35 * pow(1. - y, 2.);
        vec3 wFarbe = mix(wNacht, wTag, tag);
        c = mix(c, wFarbe, dicht * (.62 + .3 * schnee));
        // Schneenacht: tiefe, geschlossene Decke, von unten orange vom Stadtlicht angestrahlt
        float decke = schnee * (1. - tag);
        float deckeR = .5;
        #ifdef VOLL
        deckeR = mix(.5, fbm(uv * 1.3 + vec2(zeit * .01, 0.)), voll);
        #endif
        vec3 stadt = vec3(.42, .27, .17) * pow(1. - y, 1.6) + vec3(.13, .13, .17) + vec3(.05, .04, .04) * deckeR;
        c = mix(c, stadt, decke * .9);
        #ifdef VOLL
        // Mond: Scheibe mit Zeichnung und Hof
        float dm = max(dot(r, mondR), 0.);
        vec3 mt = normalize(cross(mondR, vec3(0., 1., 0.))); vec3 mb = cross(mt, mondR);
        vec2 mp = vec2(dot(r - mondR, mt), dot(r - mondR, mb)) / .013;
        float scheibe = smoothstep(1., .93, length(mp));
        float zeichnung = .78 + .22 * fbm(mp * 2.2 + 4.);
        c += mond * voll * (vec3(.95, .93, .86) * 2.2 * scheibe * zeichnung * (1. - .7 * dicht)
                     + vec3(.55, .62, .78) * (.05 * pow(dm, 900.) + .03 * pow(dm, 90.)) * (1. - .3 * dicht));
        c += mond * voll * rand * vec3(.5, .55, .65) * .25 * pow(dm, 40.);
        // Sterne: rund, verschieden hell, dichter zum Zenit, hinter Wolken verborgen
        vec3 sz = r * 260.; vec3 zelle = floor(sz); vec3 f = fract(sz) - .5;
        float hz = h21(zelle.xy + zelle.z * 17.31);
        vec3 mitteStern = vec3(h21(zelle.yz + 3.1), h21(zelle.zx + 7.7), h21(zelle.xy + 1.3)) - .5;
        float st = step(.985 - .012 * y, hz) * smoothstep(.22, .0, length(f - mitteStern * .6));
        float glanz = pow(h21(zelle.xz + 9.2), 3.) * 2.2 + .25;
        c += vec3(.86, .9, 1.) * st * glanz * sterne * voll * smoothstep(.12, .5, y) * (1. - smoothstep(.05, .5, dicht));
        #endif
        // Für die Umgebungsspiegelung: unten Hauswände (nachts mit warmen Fenstern) statt Himmel
        if (umgebung > .5) {
          float unten = 1. - smoothstep(.18, .42, r.y);
          vec3 wd = wand;
          vec2 fz = vec2(atan(r.z, r.x) * 9., r.y * 14.);
          float fe = step(.72, h21(floor(fz))) * step(.2, fract(fz.x)) * step(.25, fract(fz.y)) * step(-.2, r.y);
          wd += vec3(1., .62, .3) * fe * (1. - tag) * 1.6;
          c = mix(c, wd, unten);
        }
        // feines Zittern gegen Stufen im Verlauf
        c += (h21(gl_FragCoord.xy) - .5) / 255.;
        gl_FragColor = vec4(lin(max(c, 0.)), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  const himmelGeo = merk(new THREE.SphereGeometry(1, 48, 24));
  // volle Fassung (Wolken, Mond, Sterne) teilt die Uniforms; gestaffelt erst ab Stufe 2, über 'voll' eingeblendet
  const himmelVoll = merk(himmelMat.clone()); himmelVoll.uniforms = himmelUni; himmelVoll.defines = { VOLL: '' };
  const himmel = eigen(new THREE.Mesh(himmelGeo, gestaffelt ? himmelMat : himmelVoll));
  if (gestaffelt) himmelUni.voll.value = 0;
  himmel.frustumCulled = false; himmel.renderOrder = -1000; himmel.name = 'himmel';
  gruppe.add(himmel);

  // ---------- Umgebung (PMREM): Glas und nasse Steine spiegeln den Himmel ----------
  // Aus der einfachen Himmelsfassung (ohne Wolken): schnell zu kompilieren, in der Spiegelung kaum ein Unterschied.
  let umgebungRT = null;
  const umgebungStaerke = tag ? (schnee ? 0.45 : 0.4) : 0.55;
  const envSzene = new THREE.Scene();
  const envMat = merk(himmelMat.clone()); envMat.uniforms.umgebung.value = 1;
  const envMesh = new THREE.Mesh(himmelGeo, envMat); envMesh.frustumCulled = false; envSzene.add(envMesh);
  function umgebungBauen() {
    if (umgebungRT || entsorgt) return umgebungRT;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      umgebungRT = pmrem.fromScene(envSzene, 0.02);
      pmrem.dispose();
    } catch (e) { umgebungRT = null; info.pmremFehler = String(e && e.message); }
    return umgebungRT;
  }
  if (!gestaffelt && umgebungBauen()) { szene.environment = umgebungRT.texture; szene.environmentIntensity = umgebungStaerke; }

  // ---------- Grundlicht ----------
  const himmelLicht = farbe(T.mitte).lerp(farbe(tag ? '#fff4e2' : '#c8d4ff'), tag ? 0.6 : 0.25);
  const boden = tag ? farbe(schnee ? '#c9ccd4' : '#8c7a66') : farbe('#1c1a20');
  const hemi = eigen(new THREE.HemisphereLight(himmelLicht, boden, T.hell * (tag ? 1.55 : 1.9)));
  gruppe.add(hemi);
  // Stufe 1 ohne Umgebungskarte: das Halbkugellicht hebt die Wände so weit an, wie es später die Umgebung tut,
  // und geht beim Einblenden der Umgebung auf seinen Wert zurück (kein Helligkeitssprung zwischen Stufe 1 und 4)
  const hemiBasis = hemi.intensity, hemiErsatz = gestaffelt ? (tag ? 1.0 : (schnee ? 1.3 : 2.2)) : 1;   // Schnee wirft selbst viel zurück: weniger Ersatz
  const hemiFarbe = [hemi.color.clone(), hemi.groundColor.clone()];
  const hemiWarm = [farbe(tag ? '#ffffff' : '#e0b088'), farbe(tag ? '#ffffff' : '#6a4228')];
  const hemiMisch = gestaffelt && !tag ? 0.75 : 0;          // Abend: Umgebung ist warm (Fenster, Wände)
  function hemiSetzen(a) {                                  // a = Anteil der echten Umgebung (0 … 1)
    hemi.intensity = hemiBasis * (hemiErsatz + (1 - hemiErsatz) * a);
    hemi.color.copy(hemiFarbe[0]).lerp(hemiWarm[0], hemiMisch * (1 - a));
    hemi.groundColor.copy(hemiFarbe[1]).lerp(hemiWarm[1], hemiMisch * (1 - a));
  }
  hemiSetzen(0);
  const mond = eigen(new THREE.DirectionalLight(farbe(tag ? T.horizont : '#9fb2d8'), T.hell * (tag ? 0.55 : 1.1)));
  mond.position.copy(tag ? new THREE.Vector3(12, 30, 10) : mondRichtung.clone().multiplyScalar(40).add(new THREE.Vector3(0, 0, ENDE / 2)));
  mond.target.position.set(0, 0, ENDE / 2);
  gruppe.add(mond, mond.target);
  let sonne = null, prall = null, schattenStaerke = 0;
  if (T.sonne) {
    sonne = eigen(new THREE.DirectionalLight(farbe(schnee ? '#fff1e0' : '#ffe2b8'), T.sonne * (schnee ? 1 : 1.05)));
    sonne.target.position.set(0, 0, ENDE / 2 + 2);
    sonne.position.copy(sonneRichtung).multiplyScalar(60).add(sonne.target.position);
    if (schatten) {
      sonne.castShadow = !gestaffelt;
      const s = sonne.shadow, gr = q === 'hoch' ? 2048 : 1024;
      s.mapSize.set(gr, gr);
      Object.assign(s.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 5, far: 130 });
      s.camera.updateProjectionMatrix();
      s.bias = -0.0004; s.normalBias = 0.035; s.radius = 3;
      schattenStaerke = schnee ? 0.55 : 0.9;
      if ('intensity' in s) s.intensity = schattenStaerke;
    }
    gruppe.add(sonne, sonne.target);
    // Rückstrahlung der besonnten rechten Häuserzeile in die schattige Gasse
    prall = eigen(new THREE.DirectionalLight(farbe('#ffd9b0'), T.sonne * 0.16));
    prall.position.set(20, 6, -10); prall.target.position.set(0, 2, ENDE / 2);
    gruppe.add(prall, prall.target);
  }

  // ---------- Texturen für Höfe ----------
  const hofTex = merk(radialTextur(THREE, [[0, 1], [0.08, 0.85], [0.25, 0.32], [0.55, 0.08], [1, 0]]));
  const poolTex = merk(radialTextur(THREE, [[0, 0.9], [0.35, 0.45], [0.7, 0.1], [1, 0]]));
  const warm = farbe('#ffb35c');

  // ---------- einfache Materialien für Stufe 1 (schnell kompiliert), Tausch in Stufe 2 ----------
  const einfachMap = new Map(), tausch = [];
  function einfach(m) {
    if (!gestaffelt || m.isMeshBasicMaterial || m.isMeshLambertMaterial) return m;
    if (einfachMap.has(m)) return einfachMap.get(m);
    let e = null;
    try { e = ctx.einfach ? ctx.einfach(m) : null; } catch (err) { e = null; }
    if (!e || e === m) e = new THREE.MeshLambertMaterial({ color: m.color, emissive: m.emissive || 0x000000, emissiveIntensity: m.emissiveIntensity ?? 1 });
    merk(e); einfachMap.set(m, e); return e;
  }
  function stufe1(o, echt) { o.material = einfach(echt); if (o.material !== echt) tausch.push({ o, echt }); return o; }

  // ---------- Laternen ----------
  const lampen = ctx.lampen || [];
  const an = !tag && T.lampe > 0;
  const lampenLichter = [], kegelListe = [];
  let kegelMat = null;
  const anker = ctx.anker || (ctx.anker = {});
  anker.leuchten = anker.leuchten || [];
  if (lampen.length) {
    const eisen = merk(new THREE.MeshStandardMaterial({ color: '#191613', roughness: 0.42, metalness: 0.65 }));
    const glas = merk(an
      ? new THREE.MeshStandardMaterial({ color: '#ffe0b0', emissive: '#ffb057', emissiveIntensity: 5.5 * T.lampe, roughness: 0.4 })
      : new THREE.MeshStandardMaterial({ color: '#2b2a27', roughness: 0.06, metalness: 0.2, envMapIntensity: 1.6 }));
    const kern = merk(new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1d6').multiplyScalar(an ? 9 : 0.4) }));
    // Teile im Laternenraum: Ursprung = Mitte des Glases, +x zeigt zur Wand
    const teile = [];
    const teil = (geo, mat, mats) => { teile.push({ geo: merk(geo), mat, mats }); };
    const M = () => new THREE.Matrix4();
    const ecke = 6, rU = 0.115, rO = 0.165, hG = 0.38;
    teil(new THREE.CylinderGeometry(rO - 0.008, rU - 0.008, hG, ecke, 1), glas, [M()]);
    teil(new THREE.SphereGeometry(0.045, 10, 8), kern, [M().makeTranslation(0, -0.05, 0)]);
    teil(new THREE.ConeGeometry(0.235, 0.17, ecke), eisen, [M().makeTranslation(0, hG / 2 + 0.085, 0)]);
    teil(new THREE.CylinderGeometry(0.19, 0.19, 0.03, ecke), eisen, [M().makeTranslation(0, hG / 2 + 0.005, 0)]);
    teil(new THREE.CylinderGeometry(rU + 0.01, 0.06, 0.09, ecke), eisen, [M().makeTranslation(0, -hG / 2 - 0.04, 0)]);
    teil(new THREE.SphereGeometry(0.035, 8, 6), eisen, [M().makeTranslation(0, hG / 2 + 0.2, 0), M().makeTranslation(0, -hG / 2 - 0.1, 0)]);
    // Streben an den Kanten, nach oben auswärts geneigt
    const neig = Math.atan((rO - rU) / hG), streben = [];
    for (let i = 0; i < ecke; i++) {
      const a = (i / ecke) * Math.PI * 2 + Math.PI / 2;     // Ecken des Sechsecks wie bei CylinderGeometry
      const r = (rO + rU) / 2;
      const m = M().makeTranslation(Math.sin(a) * r, 0, Math.cos(a) * r);
      m.multiply(M().makeRotationY(a)).multiply(M().makeRotationX(neig));
      streben.push(m);
    }
    teil(new THREE.BoxGeometry(0.02, hG + 0.02, 0.02), eisen, streben);
    // Arm: wird pro Laterne gestreckt (Abstand zur Wand)
    const armGeo = merk(new THREE.BoxGeometry(1, 0.035, 0.035));
    const schnoerkelGeo = merk(new THREE.TorusGeometry(0.075, 0.011, 6, 18, Math.PI * 1.6));
    const platteGeo = merk(new THREE.BoxGeometry(0.035, 0.34, 0.16));

    const n = lampen.length;
    const inst = teile.map(t => {
      const im = eigen(new THREE.InstancedMesh(t.geo, t.mat, n * t.mats.length)); stufe1(im, t.mat);
      im.castShadow = schatten; gruppe.add(im); frei.push(im); return im;
    });
    const armI = stufe1(eigen(new THREE.InstancedMesh(armGeo, eisen, n * 3)), eisen); armI.castShadow = schatten; gruppe.add(armI); frei.push(armI);
    const schnI = stufe1(eigen(new THREE.InstancedMesh(schnoerkelGeo, eisen, n)), eisen); gruppe.add(schnI); frei.push(schnI);
    const platI = stufe1(eigen(new THREE.InstancedMesh(platteGeo, eisen, n)), eisen); gruppe.add(platI); frei.push(platI);

    const tmp = new THREE.Object3D();
    lampen.forEach((l, i) => {
      const seite = l.seite || Math.sign(l.x) || 1;
      const wandX = seite * BREITE / 2;
      const d = Math.max(0.25, Math.abs(wandX - l.x));
      const basis = new THREE.Matrix4().makeTranslation(l.x, l.y, l.z).multiply(new THREE.Matrix4().makeRotationY(seite > 0 ? 0 : Math.PI));
      teile.forEach((t, k) => t.mats.forEach((m, j) => inst[k].setMatrixAt(i * t.mats.length + j, basis.clone().multiply(m))));
      // Arm waagrecht, Strebe schräg, Haken
      const yA = hG / 2 + 0.3;
      const setz = (idx, x, y, len, rot) => {
        tmp.position.set(x, y, 0); tmp.rotation.set(0, 0, rot); tmp.scale.set(len, 1, 1); tmp.updateMatrix();
        armI.setMatrixAt(idx, basis.clone().multiply(tmp.matrix));
      };
      setz(i * 3, d / 2, yA, d + 0.02, 0);
      const sx = d * 0.55, sy = 0.32; const sl = Math.hypot(d - sx, sy);
      setz(i * 3 + 1, (d + sx) / 2, yA - sy / 2, sl, Math.atan2(sy, d - sx));
      tmp.position.set(0, yA - 0.05, 0); tmp.rotation.set(0, 0, Math.PI / 2); tmp.scale.set(0.12, 1, 1); tmp.updateMatrix();
      armI.setMatrixAt(i * 3 + 2, basis.clone().multiply(tmp.matrix));
      tmp.position.set(d * 0.62, yA - 0.1, 0); tmp.rotation.set(0, 0, 0.6); tmp.scale.set(1, 1, 1); tmp.updateMatrix();
      schnI.setMatrixAt(i, basis.clone().multiply(tmp.matrix));
      tmp.position.set(d, yA - 0.1, 0); tmp.rotation.set(0, 0, 0); tmp.updateMatrix();
      platI.setMatrixAt(i, basis.clone().multiply(tmp.matrix));
      if (an) anker.leuchten.push({ pos: new THREE.Vector3(l.x, l.y, l.z), farbe: '#ffb35c', staerke: T.lampe, radius: 0.5, laterne: true, seite });
    });
    [...inst, armI, schnI, platI].forEach(im => { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); });

    if (an) {
      // Echte Lichter: so viele, wie die Qualität erlaubt, gleichmässig über die Gasse verteilt
      const max = q === 'hoch' ? 10 : q === 'mittel' ? 6 : 3;
      const sortiert = lampen.map((l, i) => ({ l, i })).sort((a, b) => b.l.z - a.l.z);
      const wahl = new Set();
      if (sortiert.length <= max) sortiert.forEach(o => wahl.add(o.i));
      else for (let k = 0; k < max; k++) wahl.add(sortiert[Math.round(k * (sortiert.length - 1) / (max - 1))].i);
      const kegelGeo = merk(new THREE.ConeGeometry(1, 1, 28, 1, true));
      kegelMat = merk(new THREE.ShaderMaterial({
        uniforms: { farbe: { value: warm.clone() }, staerke: { value: (0.05 + 0.1 * schnee + 1.2 * T.dichte) * T.lampe } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: `varying float vH; varying vec3 vN, vV;
          void main(){ vH = .5 - position.y; vec4 w = modelViewMatrix * vec4(position, 1.); vV = normalize(-w.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * w; }`,
        fragmentShader: `uniform vec3 farbe; uniform float staerke; varying float vH; varying vec3 vN, vV;
          void main(){ float rand = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
            float a = staerke * rand * (1. - smoothstep(.0, 1., vH)) * smoothstep(.0, .08, vH);
            gl_FragColor = vec4(farbe * a, 1.); }`,
      }));
      lampen.forEach((l, i) => {
        const seite = l.seite || Math.sign(l.x) || 1;
        // Hof um die Laterne
        const hof = eigen(new THREE.Sprite(merk(new THREE.SpriteMaterial({ map: hofTex, color: warm, transparent: true, opacity: 0.55 * T.lampe, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }))));
        hof.position.set(l.x, l.y - 0.02, l.z); hof.scale.set(1.5 + 0.8 * schnee, 1.5 + 0.8 * schnee, 1); gruppe.add(hof);
        // Lichtkegel im Dunst
        const kegel = eigen(new THREE.Mesh(kegelGeo, kegelMat));
        const h = l.y - 0.2; kegel.scale.set(1.25 + 0.15 * h, h, 1.25 + 0.15 * h); kegel.position.set(l.x, h / 2, l.z);
        kegel.renderOrder = 5; kegel.visible = !gestaffelt; kegelListe.push(kegel); gruppe.add(kegel);
        if (wahl.has(i)) {
          const p = eigen(new THREE.PointLight(farbe('#ffa850'), 6 * T.lampe, 10, 1.7));
          p.position.set(l.x, l.y - 0.12, l.z); gruppe.add(p); lampenLichter.push(p);
        } else {
          // ohne eigenes Licht: weicher Schein an der Wand und auf dem Pflaster
          const wand = eigen(new THREE.Mesh(merk(new THREE.PlaneGeometry(2.6, 2.6)), merk(new THREE.MeshBasicMaterial({ map: poolTex, color: warm.clone().multiplyScalar(0.55 * T.lampe), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))));
          wand.position.set(seite * (BREITE / 2 - 0.03), l.y - 0.2, l.z); wand.rotation.y = -seite * Math.PI / 2; gruppe.add(wand);
          const pool = eigen(new THREE.Mesh(merk(new THREE.PlaneGeometry(4.2, 4.2)), merk(new THREE.MeshBasicMaterial({ map: poolTex, color: warm.clone().multiplyScalar(0.4 * T.lampe), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))));
          pool.rotation.x = -Math.PI / 2; pool.position.set(l.x - seite * 0.6, 0.016, l.z); gruppe.add(pool);
        }
      });
    }
  }

  // ---------- Spiegelung auf dem nassen Pflaster ----------
  let spiegel = null, spiegelUni = null;
  const spiegelStaerke = (tag ? 0.22 : 0.62) * nass * (schnee ? 0.6 : 1);
  function spiegelBauen() {
    let x0 = -BREITE / 2, x1 = BREITE / 2, z0 = ENDE, z1 = 8;
    const pf = ctx.pflaster && (ctx.pflaster.isMesh ? ctx.pflaster : ctx.pflaster.mesh);
    if (pf && pf.geometry) {
      pf.geometry.computeBoundingBox(); pf.updateMatrixWorld();
      const bb = pf.geometry.boundingBox.clone().applyMatrix4(pf.matrixWorld);
      x0 = Math.max(x0 - 0.5, bb.min.x); x1 = Math.min(x1 + 0.5, bb.max.x); z0 = Math.max(ENDE - 2, bb.min.z); z1 = bb.max.z;
    }
    const geo = merk(new THREE.PlaneGeometry(x1 - x0, z1 - z0));
    const echt = q !== 'tief';
    const ziel = echt ? merk(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType })) : null;
    const spiegelKam = new THREE.PerspectiveCamera();
    const texMat = new THREE.Matrix4();
    const uni = {
      bild: { value: ziel ? ziel.texture : null }, texMat: { value: texMat }, staerke: { value: spiegelStaerke },
      schnee: { value: T.schnee || 0 }, tag: { value: tag ? 1 : 0 }, texel: { value: new THREE.Vector2(1 / 4, 1 / 4) },
    };
    const mat = merk(new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: `uniform mat4 texMat; varying vec4 vP; varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vP = texMat * w; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D bild; uniform float staerke, schnee, tag; uniform vec2 texel; varying vec4 vP; varying vec3 vW;
        ${RAUSCHEN}
        void main(){
          vec3 v = cameraPosition - vW; float dist = length(v); v /= dist;
          float fres = mix(.25, 1., pow(1. - clamp(v.y, 0., 1.), 4.));
          // Steinfugen und Pfützen: die Spiegelung bricht zwischen den Bollensteinen und sammelt sich in Mulden
          vec2 s = vW.xz * 4.2; vec2 zz = fract(s + vec2(floor(s.y) * .5, 0.)) - .5;
          float stein = smoothstep(.5, .28, max(abs(zz.x), abs(zz.y)) + .08 * rausch(vW.xz * 9.));
          float pfuetze = smoothstep(.45, .75, fbm(vW.xz * .32 + 2.));
          float rinne = 1. - smoothstep(.25, .5, abs(vW.x));
          float maske = mix(.35 + .35 * stein, 1., max(pfuetze, rinne));
          maske *= mix(1., .25 + .75 * max(pfuetze * .6, rinne), schnee);
          vec2 uv = vP.xy / vP.w;
          vec2 wackel = (vec2(rausch(vW.xz * 6.), rausch(vW.zx * 6. + 3.)) - .5) * vec2(.006, .012) * (1. - pfuetze * .7);
          uv += wackel;
          // senkrecht verschmiert: lange Lichtstreifen wie auf nassem Stein
          float sp = (2. + 6. * (1. - pfuetze)) * texel.y * (1. + dist * .04);
          vec3 c = vec3(0.); float wsum = 0.;
          for (int k = -4; k <= 4; k++) { float fk = float(k); float g = exp(-fk * fk * .12); c += texture2D(bild, uv + vec2(0., fk * sp)).rgb * g; wsum += g; }
          c /= wsum;
          gl_FragColor = vec4(c * staerke * fres * maske, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    spiegelUni = uni;
    const m = eigen(new THREE.Mesh(geo, mat));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.012, (z0 + z1) / 2); m.renderOrder = 2;
    m.name = 'spiegelung';
    if (!echt) { m.visible = false; return null; }
    // Spiegelkamera wie beim Reflector aus den three-Beispielen, mit schräger Nahebene
    const ebene = new THREE.Plane(), clip = new THREE.Vector4(), qv = new THREE.Vector4();
    const N = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3(), cP = new THREE.Vector3(), rot = new THREE.Matrix4();
    const blick = new THREE.Vector3(), ziel3 = new THREE.Vector3(), oben = new THREE.Vector3();
    const groesse = new THREE.Vector2();
    let aktiv = false;
    const faktor = q === 'hoch' ? 0.5 : 0.35;
    m.onBeforeRender = (r, sc, cam) => {
      if (aktiv) return;
      r.getDrawingBufferSize(groesse);
      const w = Math.max(4, Math.round(groesse.x * faktor)), h = Math.max(4, Math.round(groesse.y * faktor));
      if (ziel.width !== w || ziel.height !== h) { ziel.setSize(w, h); uni.texel.value.set(1 / w, 1 / h); }
      P.setFromMatrixPosition(m.matrixWorld); cP.setFromMatrixPosition(cam.matrixWorld);
      if (cP.y < P.y) return;
      rot.extractRotation(cam.matrixWorld);
      blick.set(0, 0, -1).applyMatrix4(rot).add(cP);
      const sp = P.clone().sub(cP).reflect(N).negate().add(P);
      ziel3.subVectors(P, blick).reflect(N).negate().add(P);
      spiegelKam.position.copy(sp);
      oben.set(0, 1, 0).applyMatrix4(rot).reflect(N);
      spiegelKam.up.copy(oben); spiegelKam.lookAt(ziel3);
      spiegelKam.far = cam.far; spiegelKam.updateMatrixWorld(); spiegelKam.projectionMatrix.copy(cam.projectionMatrix);
      texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      texMat.multiply(spiegelKam.projectionMatrix).multiply(spiegelKam.matrixWorldInverse);
      // schräge Nahebene: nur, was über dem Pflaster liegt, wird gespiegelt
      ebene.setFromNormalAndCoplanarPoint(N, P).applyMatrix4(spiegelKam.matrixWorldInverse);
      clip.set(ebene.normal.x, ebene.normal.y, ebene.normal.z, ebene.constant);
      const pm = spiegelKam.projectionMatrix;
      qv.x = (Math.sign(clip.x) + pm.elements[8]) / pm.elements[0];
      qv.y = (Math.sign(clip.y) + pm.elements[9]) / pm.elements[5];
      qv.z = -1; qv.w = (1 + pm.elements[10]) / pm.elements[14];
      clip.multiplyScalar(2 / clip.dot(qv));
      pm.elements[2] = clip.x; pm.elements[6] = clip.y; pm.elements[10] = clip.z + 1 - 0.003; pm.elements[14] = clip.w;
      aktiv = true; m.visible = false;
      const altZiel = r.getRenderTarget(), altXR = r.xr.enabled, altSchatten = r.shadowMap.autoUpdate;
      r.xr.enabled = false; r.shadowMap.autoUpdate = false;
      r.setRenderTarget(ziel); r.state.buffers.depth.setMask(true);
      if (r.autoClear === false) r.clear();
      r.render(sc, spiegelKam);
      r.xr.enabled = altXR; r.shadowMap.autoUpdate = altSchatten; r.setRenderTarget(altZiel);
      const vp = cam.viewport; if (vp !== undefined) r.state.viewport(vp);
      m.visible = true; aktiv = false;
    };
    m.visible = !gestaffelt;                                   // gestaffelt: Stufe 4
    gruppe.add(m);
    return m;
  }

  // Obergrenze für den direkten Glanz der Lichter im Pflaster (lineare Szenenfarbe, weiches Knie, Farbton bleibt):
  // die glatte Rinne vor dem Laden spiegelte sonst als grellweisser, ausgefressener Streifen (ACES entsättigt sehr helle Werte zu Weiss)
  // ?glanz=… nur im Prüfmodus (zum Abstimmen)
  const GLANZ_MAX = (() => { const l = typeof location !== 'undefined' ? location.search : '';
    const v = /[?&](fahrt|stufe)=/.test(l) && parseFloat(new URLSearchParams(l).get('glanz')); return v > 0 ? v : 0.45; })();
  const glanzUni = { value: GLANZ_MAX };

  // Streifen-Spiegelung (Telefon, oder zusätzlich als Glanz): pro Licht ein Streifen auf dem Boden,
  // dort, wo die Spiegelung des Lichts im Pflaster erscheint, zur Kamera hin gezogen.
  let streifen = null, streifenStaerke = 0;
  function streifenBauen(liste) {
    if (!liste.length) return;
    const n = liste.length;
    const geo = merk(new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const lp = new Float32Array(n * 3), lf = new Float32Array(n * 3), lg = new Float32Array(n * 2);
    liste.forEach((l, i) => {
      lp.set([l.pos.x, l.pos.y, l.pos.z], i * 3);
      const c = farbe(l.farbe || '#ffb35c'); lf.set([c.r, c.g, c.b], i * 3);
      // dicht beieinander liegende Lichter (Laden) teilen sich einen Glanz, sonst addiert er sich zum grellen Fleck
      const nachbarn = liste.filter(k => Math.hypot(k.pos.x - l.pos.x, k.pos.z - l.pos.z) < 3).length;
      lg.set([Math.min(2.5, l.staerke || 1) * (nachbarn > 2 ? 0.7 / nachbarn : 1), Math.max(0.25, Math.min(2.5, l.radius || 0.5))], i * 2);
    });
    geo.setAttribute('lp', new THREE.InstancedBufferAttribute(lp, 3));
    geo.setAttribute('lf', new THREE.InstancedBufferAttribute(lf, 3));
    geo.setAttribute('lg', new THREE.InstancedBufferAttribute(lg, 2));
    geo.instanceCount = n;
    const mat = merk(new THREE.ShaderMaterial({
      uniforms: { staerke: { value: streifenStaerke = (tag ? 0.15 : 0.3) * nass * (schnee ? 0.55 : 1) }, grenze: glanzUni },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec3 lp, lf; attribute vec2 lg; varying vec2 vQ; varying vec3 vF; varying vec3 vW;
        void main(){
          // Spiegelpunkt: wo die Linie von der Kamera zum gespiegelten Licht den Boden trifft
          vec3 c = cameraPosition; vec3 m = vec3(lp.x, -lp.y, lp.z);
          float t = c.y / max(c.y + lp.y, .01);
          vec3 p = c + (m - c) * t; p.y = .014;
          vec2 d = normalize(c.xz - p.xz + 1e-4); vec2 q = vec2(-d.y, d.x);
          float dist = length(c.xz - p.xz);
          float lang = (1.2 + lp.y * .55) * (1. + dist * .02), breit = .25 + lg.y * .35;
          vec3 w = p + vec3(q.x, 0., q.y) * position.x * breit + vec3(d.x, 0., d.y) * (position.y - .55) * lang * 2.;
          vQ = vec2(position.x * 2., (position.y - .55) * 2.); vF = lf * lg.x; vW = w;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
        }`,
      fragmentShader: `uniform float staerke, grenze; varying vec2 vQ; varying vec3 vF; varying vec3 vW;
        ${RAUSCHEN}
        void main(){
          float a = exp(-vQ.x * vQ.x * 3.) * exp(-vQ.y * vQ.y * 1.8);
          // leise, grossflächige Unruhe statt feinem Funkeln
          float bruch = .8 + .2 * rausch(vec2(vW.x * 1.5, vW.z * .6));
          vec3 g = vF * a * bruch * staerke; float m = max(max(g.r, g.g), g.b);
          gl_FragColor = vec4(g * (grenze * (1. - exp(-m / grenze)) / max(m, 1e-5)), 1.);   // wie der Glanz im Pflaster: warm statt weiss
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    const m = eigen(new THREE.Mesh(geo, mat)); m.frustumCulled = false; m.renderOrder = 3; m.name = 'streifen'; m.visible = !gestaffelt;
    gruppe.add(m); return m;
  }

  // ---------- Pflaster nass machen (Material gehört buehne; wir setzen nur Werte) ----------
  let pflasterAlt = null;
  // Untergrenze als Uniform: gestaffelt bis Stufe 4 weicher (ohne Spiegel wäre der Glanz sonst eine harte Linie), dann eingeblendet
  const rauUni = { value: 0 }; let rauZiel = 0;
  function pflasterNass() {
    const pf = ctx.pflaster && (ctx.pflaster.isMesh ? ctx.pflaster : ctx.pflaster.mesh);
    const mat = pf && pf.material;
    if (!mat || Array.isArray(mat)) return;
    if (mat.uniforms) { for (const k of ['nass', 'uNass']) if (mat.uniforms[k]) mat.uniforms[k].value = nass; return; }
    if (!mat.isMeshStandardMaterial) return;
    pflasterAlt = { mat, envMapIntensity: mat.envMapIntensity, roughness: mat.roughness, obc: mat.onBeforeCompile, key: mat.customProgramCacheKey };
    mat.envMapIntensity = 0.45 + nass * 0.6;
    // Untergrenze der Rauheit: Pfützen sind in der Rauheitskarte fast schwarz, das gäbe harte Glanzpunkte
    // jedes Lichts und jedes Pflastersteins (Funkeln im Bloom). Mit Untergrenze wird daraus ein weicher Lichtteppich;
    // die scharfe Spiegelung liefert auf hoch/mittel der Spiegel, auf tief die Streifen.
    const rauMin = tag ? 0.0 : (q === 'tief' ? 0.34 : 0.14);
    rauZiel = rauMin; rauUni.value = gestaffelt ? Math.max(rauMin, 0.34) : rauMin;
    if (rauMin > 0) {
      const altObc = pflasterAlt.obc, altKey = pflasterAlt.key;
      mat.onBeforeCompile = function (shader, renderer) {
        if (altObc) altObc.call(this, shader, renderer);
        shader.uniforms.lichtRauMin = rauUni; shader.uniforms.lichtGlanzMax = glanzUni;
        shader.fragmentShader = 'uniform float lichtRauMin, lichtGlanzMax;\n' + shader.fragmentShader.replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n\troughnessFactor = max(roughnessFactor, lichtRauMin);').replace('#include <lights_fragment_end>',
          '#include <lights_fragment_end>\n\t{ vec3 g = reflectedLight.directSpecular; float m = max(max(g.r, g.g), g.b);\n' +
          '\t  reflectedLight.directSpecular = g * (lichtGlanzMax * (1. - exp(-m / lichtGlanzMax)) / max(m, 1e-5)); }');
      };
      mat.customProgramCacheKey = function () { return (altKey ? altKey.call(this) : '') + '|licht-rau-glanz'; };
    }
    mat.needsUpdate = true;
  }

  // ---------- Nachbearbeitung ----------
  const post = (() => {
    const quad = new THREE.Mesh(merk(new THREE.PlaneGeometry(2, 2)));
    quad.frustumCulled = false;
    const quadSzene = new THREE.Scene(); quadSzene.add(quad);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const halb = { type: THREE.HalfFloatType, depthBuffer: false };
    const szeneRT = merk(new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: q === 'hoch' ? 4 : 0 }));
    const stufen = q === 'hoch' ? 6 : q === 'mittel' ? 5 : 4;
    const ab = [], auf = [];
    for (let i = 0; i < stufen; i++) { ab.push(merk(new THREE.WebGLRenderTarget(4, 4, halb))); auf.push(merk(new THREE.WebGLRenderTarget(4, 4, halb))); }
    const hellMat = merk(new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, px: { value: new THREE.Vector2() }, schwelle: { value: tag ? 2.2 : 0.95 }, knie: { value: 0.5 } },
      vertexShader: VOLLBILD_VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tex; uniform vec2 px; uniform float schwelle, knie; varying vec2 vUv;
        vec3 hell(vec3 c){
          float l = max(c.r, max(c.g, c.b));
          float weich = clamp(l - schwelle + knie, 0., 2. * knie); weich = weich * weich / (4. * knie + 1e-4);
          float b = max(weich, l - schwelle) / max(l, 1e-4);
          // nur warme Lichter: Rot deutlich über Blau
          float warm = smoothstep(.04, .3, (c.r - c.b) / max(c.r, 1e-3));
          return c * b * warm;
        }
        // gewichtetes Mittel (1/(1+L)): einzelne sehr helle Pixel (Glanzpunkte) blühen nicht als Funken auf
        vec4 probe(vec2 o){ vec3 c = hell(min(texture2D(tex, vUv + px * o).rgb, vec3(24.))); float w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4(c * w, w); }
        void main(){
          vec4 s = probe(vec2(-.5, -.5)) + probe(vec2(.5, -.5)) + probe(vec2(-.5, .5)) + probe(vec2(.5, .5));
          gl_FragColor = vec4(min(s.rgb / max(s.a, 1e-4), vec3(12.)), 1.);
        }`,
    }));
    const abMat = merk(new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, px: { value: new THREE.Vector2() } }, vertexShader: VOLLBILD_VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tex; uniform vec2 px; varying vec2 vUv;
        void main(){ vec3 s = texture2D(tex, vUv).rgb * 4. + texture2D(tex, vUv - px).rgb + texture2D(tex, vUv + px).rgb
          + texture2D(tex, vUv + vec2(px.x, -px.y)).rgb + texture2D(tex, vUv - vec2(px.x, -px.y)).rgb; gl_FragColor = vec4(s / 8., 1.); }`,
    }));
    const aufMat = merk(new THREE.ShaderMaterial({
      uniforms: { tex: { value: null }, dazu: { value: null }, px: { value: new THREE.Vector2() } }, vertexShader: VOLLBILD_VS, depthTest: false, depthWrite: false,
      fragmentShader: `uniform sampler2D tex, dazu; uniform vec2 px; varying vec2 vUv;
        void main(){ vec2 h = px * .5;
          vec3 s = texture2D(tex, vUv + vec2(-h.x * 2., 0.)).rgb + texture2D(tex, vUv + vec2(-h.x, h.y)).rgb * 2. + texture2D(tex, vUv + vec2(0., h.y * 2.)).rgb
            + texture2D(tex, vUv + vec2(h.x, h.y)).rgb * 2. + texture2D(tex, vUv + vec2(h.x * 2., 0.)).rgb + texture2D(tex, vUv + vec2(h.x, -h.y)).rgb * 2.
            + texture2D(tex, vUv + vec2(0., -h.y * 2.)).rgb + texture2D(tex, vUv + vec2(-h.x, -h.y)).rgb * 2.;
          gl_FragColor = vec4(s / 12. + texture2D(dazu, vUv).rgb, 1.); }`,
    }));
    // Farbkorrektur je Stimmung (im Bildraum nach dem Tonemapping)
    const G = tag
      ? (schnee ? { bloom: 0.35, tiefen: [-0.004, 0.0, 0.016], lichter: [0.012, 0.008, 0.0], saett: 0.94, kontrast: 0.08, vign: 0.28, korn: 0.028, weiss: [0.98, 1.0, 1.03] }
                : { bloom: 0.25, tiefen: [-0.006, 0.002, 0.018], lichter: [0.022, 0.012, -0.006], saett: 1.06, kontrast: 0.1, vign: 0.3, korn: 0.026, weiss: [1.02, 1.0, 0.97] })
      : (schnee ? { bloom: 1.15, tiefen: [-0.006, 0.006, 0.028], lichter: [0.028, 0.012, -0.004], saett: 0.97, kontrast: 0.1, vign: 0.42, korn: 0.04, weiss: [1.0, 0.99, 1.0] }
                : { bloom: 0.95, tiefen: [-0.008, 0.008, 0.026], lichter: [0.034, 0.014, -0.012], saett: 1.08, kontrast: 0.12, vign: 0.48, korn: 0.042, weiss: [1.03, 0.99, 0.95] });
    const bloomVoll = G.bloom / stufen * 2.2;
    let anteil = gestaffelt ? 0 : 1;                          // Bloom und Korn (Stufe 4)
    // ohne Bloom wirkt das Bild dunkler: bis zum Einblenden etwas mehr Belichtung (am Abend), dann zurück
    const belichtungErsatz = gestaffelt ? (tag ? 1.0 : 1.25) : 1;
    function effekte(a) {
      anteil = a; endMat.uniforms.bloom.value = bloomVoll * a; endMat.uniforms.korn.value = G.korn * a;
      endMat.uniforms.belichtung.value = T.belichtung * (belichtungErsatz + (1 - belichtungErsatz) * a);
    }
    const endMat = merk(new THREE.ShaderMaterial({
      uniforms: {
        szeneT: { value: szeneRT.texture }, bloomT: { value: null }, bloom: { value: gestaffelt ? 0 : bloomVoll },
        belichtung: { value: T.belichtung * belichtungErsatz }, weiss: { value: new THREE.Vector3(...G.weiss) },
        tiefen: { value: new THREE.Vector3(...G.tiefen) }, lichter: { value: new THREE.Vector3(...G.lichter) },
        saett: { value: G.saett }, kontrast: { value: G.kontrast }, vign: { value: G.vign }, korn: { value: gestaffelt ? 0 : G.korn },
        zeit: { value: 0 }, aufl: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VOLLBILD_VS, depthTest: false, depthWrite: false, toneMapped: false,
      fragmentShader: `uniform sampler2D szeneT, bloomT; uniform float bloom, belichtung, saett, kontrast, vign, korn, zeit;
        uniform vec3 weiss, tiefen, lichter; uniform vec2 aufl; varying vec2 vUv;
        vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + .0245786) - .000090537; vec3 b = v * (.983729 * v + .4329510) + .238081; return a / b; }
        vec3 aces(vec3 c){
          const mat3 ein = mat3(vec3(.59719, .07600, .02840), vec3(.35458, .90834, .13383), vec3(.04823, .01566, .83777));
          const mat3 aus = mat3(vec3(1.60475, -.10208, -.00327), vec3(-.53108, 1.10813, -.07276), vec3(-.07367, -.00605, 1.07602));
          c *= belichtung / .6; c = ein * c; c = RRTAndODTFit(c); c = aus * c; return clamp(c, 0., 1.); }
        vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
        float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
        void main(){
          vec3 c = texture2D(szeneT, vUv).rgb;
          c += texture2D(bloomT, vUv).rgb * bloom;
          c *= weiss;
          c = srgb(aces(c));
          float l = dot(c, vec3(.2126, .7152, .0722));
          c += tiefen * pow(1. - l, 2.) + lichter * smoothstep(.25, 1., l);
          c = mix(vec3(l), c, saett);
          c = mix(c, c * c * (3. - 2. * c), kontrast);
          vec2 d = (vUv - .5) * vec2(aufl.x / aufl.y, 1.);
          c *= 1. - vign * smoothstep(.25, 1.05, length(d) * 1.15);
          float n = h(vUv * aufl + zeit * 61.7) + h(vUv * aufl * 1.37 - zeit * 23.1) - 1.;
          c += n * korn * (1. - .55 * l);
          gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
        }`,
    }));
    let w = 0, h = 0, bild = 0;
    const gr = new THREE.Vector2();
    function anpassen() {
      renderer.getDrawingBufferSize(gr);
      if (gr.x === w && gr.y === h) return;
      w = gr.x; h = gr.y;
      szeneRT.setSize(w, h);
      let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
      if (q === 'tief') { bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); }
      for (let i = 0; i < stufen; i++) { ab[i].setSize(bw, bh); auf[i].setSize(bw, bh); bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1); }
      endMat.uniforms.aufl.value.set(w, h);
    }
    function pass(mat, ziel) { quad.material = mat; renderer.setRenderTarget(ziel); renderer.render(quadSzene, ortho); }
    function zeichnen() {
      anpassen();
      const ausgabe = renderer.getRenderTarget();
      const altAuto = renderer.autoClear; renderer.autoClear = true;
      renderer.setRenderTarget(szeneRT); renderer.render(szene, kamera);
      // Bloom: Hellpass, dann Kette hinunter und wieder hinauf (erst ab Stufe 4)
      if (anteil > 0) {
      hellMat.uniforms.tex.value = szeneRT.texture; hellMat.uniforms.px.value.set(1 / w, 1 / h); pass(hellMat, ab[0]);
      for (let i = 1; i < stufen; i++) { abMat.uniforms.tex.value = ab[i - 1].texture; abMat.uniforms.px.value.set(1 / ab[i - 1].width, 1 / ab[i - 1].height); pass(abMat, ab[i]); }
      let quelle = ab[stufen - 1];
      for (let i = stufen - 2; i >= 0; i--) {
        aufMat.uniforms.tex.value = quelle.texture; aufMat.uniforms.dazu.value = ab[i].texture;
        aufMat.uniforms.px.value.set(1 / quelle.width, 1 / quelle.height); pass(aufMat, auf[i]); quelle = auf[i];
      }
      endMat.uniforms.bloomT.value = quelle.texture;
      }
      endMat.uniforms.zeit.value = (bild++ % 64) / 64;
      pass(endMat, ausgabe);
      renderer.autoClear = altAuto;
    }
    // Bloom-Shader zum Vorkompilieren (Stufe 2)
    const vorrat = new THREE.Group();
    for (const m of [hellMat, abMat, aufMat]) { const v = new THREE.Mesh(quad.geometry, m); v.frustumCulled = false; vorrat.add(v); }
    // Wie endMat ohne Bloom, Vignette und Korn: aus linearer Szenenfarbe die Farbe auf dem Schirm (0..1, sRGB)
    function anzeige(v) {
      const e = endMat.uniforms.belichtung.value / 0.6;
      let c = [v[0] * G.weiss[0] * e, v[1] * G.weiss[1] * e, v[2] * G.weiss[2] * e];
      const ein = [[.59719, .35458, .04823], [.07600, .90834, .01566], [.02840, .13383, .83777]];
      const aus = [[1.60475, -.53108, -.07367], [-.10208, 1.10813, -.00605], [-.00327, -.07276, 1.07602]];
      const mal = (m, x) => m.map(r => r[0] * x[0] + r[1] * x[1] + r[2] * x[2]);
      c = mal(ein, c).map(x => (x * (x + .0245786) - .000090537) / (x * (.983729 * x + .4329510) + .238081));
      c = mal(aus, c).map(x => Math.min(1, Math.max(0, x)));
      c = c.map(x => x < .0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - .055);
      const l = .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
      const ss = Math.min(1, Math.max(0, (l - .25) / .75)), lt = ss * ss * (3 - 2 * ss);
      c = c.map((x, i) => x + G.tiefen[i] * (1 - l) * (1 - l) + G.lichter[i] * lt);
      c = c.map(x => l + (x - l) * G.saett);
      c = c.map(x => x + (x * x * (3 - 2 * x) - x) * G.kontrast);
      return c.map(x => Math.min(1, Math.max(0, x)));
    }
    return { zeichnen, groesse: anpassen, ziel: szeneRT, effekte, vorrat, ortho, anzeige };
  })();
  ctx.kompilierZiel = post.ziel;                              // für ctx.kompilieren: gleiche Programmvariante wie beim Zeichnen

  // ---------- Himmelsfarben für Stufe 1 ----------
  // haupt.js zeigt in Stufe 1 statt des Shader-Himmels einen flachen Verlauf (Zenit 0 %, Mitte 34 %, Horizont ab 62 % der Bildhöhe).
  // Die Farben rechnen wir hier aus demselben Himmel wie ab Stufe 2 (mit Wolken, ohne Mond und Sterne), gemittelt über die
  // jeweilige Bildzeile aus der Kamera. Der Verlauf landet als Hintergrund im selben Szenenziel und geht durch dieselbe Nachbearbeitung.
  // Rauschen wie RAUSCHEN im Shader (h21, rausch, fbm), für den Mittelwert der Wolken
  const fr = x => x - Math.floor(x);
  const h21 = (x, y) => { x = fr(x * 123.34); y = fr(y * 456.21); const d = x * (x + 45.32) + y * (y + 45.32); x += d; y += d; return fr(x * y); };
  const rausch = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const fbm = (x, y) => { let a = .5, s = 0; for (let i = 0; i < 5; i++) { s += a * rausch(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 17.1; a *= .5; } return s; };
  // Farbe des vollen Himmels (Stufe 2, Zeit 0) in Richtung r, linear wie im Szenenziel; ohne Mond und Sterne
  function himmelLinear(r) {
    const U = himmelUni, y = Math.min(1, Math.max(0, r.y));
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const v = c => [c.r, c.g, c.b], mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
    const Z = v(U.zenit.value), M = v(U.mitte.value), H = v(U.horizont.value), Gl = v(U.glut.value);
    const sn = U.schnee.value, tg = U.tag.value, so = U.sonne.value;
    let c = mix(mix(H, M, ss(0, .25, y)), Z, ss(.2, .8, y));
    const gk = (.35 + .25 * (1 - tg)) * Math.pow(1 - y, 5) * ss(-.5, .7, -r.z);
    c = c.map((x, i) => x + Gl[i] * gk);
    const ds = Math.max(0, r.dot(U.sonneR.value));
    const sk = so * (.18 * Math.pow(ds, 8) + .35 * Math.pow(ds, 64) + 30 * ss(.99965, .99985, ds)) * (1 - .8 * sn);
    c = c.map((x, i) => x + [1, .86, .62][i] * sk);
    const ux = r.x / (y + .18), uz = r.z / (y + .18), w1x = ux * .55, w1z = uz * .55;
    const warp = fbm(w1x * 1.7 + 3, w1z * 1.7 + 3), wolke = fbm(w1x + warp * .6, w1z + warp * .6);
    let dv = ss(.48 - .18 * sn, .82 - .1 * sn, wolke);
    const fein = fbm(ux * 2.4 + warp, uz * 2.4 + warp);
    dv = Math.min(1, Math.max(0, dv + .25 * ss(.55, .8, fein) * (1 - dv))) * ss(0, .22, y);
    const wTag = mix(H.map(x => x * 1.06), mix(M, [.62, .64, .7], .6), ss(.55, .95, wolke)).map((x, i) => x + [1, .9, .75][i] * so * .25 * Math.pow(ds, 4));
    const wNacht = mix(M.map((x, i) => x * 1.6 + Gl[i] * .5), H.map(x => x * .9), .4 + .4 * sn).map((x, i) => x + Gl[i] * .35 * (1 - y) * (1 - y));
    c = mix(c, mix(wNacht, wTag, tg), dv * (.62 + .3 * sn));
    const deckeR = fbm(ux * 1.3, uz * 1.3);
    const stadt = [.42, .27, .17].map((x, i) => x * Math.pow(1 - y, 1.6) + [.13, .13, .17][i] + [.05, .04, .04][i] * deckeR);
    c = mix(c, stadt, sn * (1 - tg) * .9);
    return c.map(x => Math.max(0, x) * Math.max(0, x));
  }
  // Mittel über eine Bildzeile (lineare Farbe), damit die Wolkenflecken als Fläche zählen
  function zeileLinear(k, f) {
    const s = [0, 0, 0], n = 41, p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      p.set(-1 + 2 * i / (n - 1), 1 - 2 * f, 0.5).unproject(k).sub(k.position).normalize();
      himmelLinear(p).forEach((x, j) => { s[j] += x / n; });
    }
    return s;
  }
  const hex = c => '#' + new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace).getHexString();
  const hexS = c => '#' + c.map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  function himmelVerlaufRechnen() {
    try {
      // Beim Bau steht die Kamera noch nicht: Blick wie kameraSetzen in haupt.js an der Stelle der Fahrt (ohne Schritt und Seitenversatz)
      const B = ctx.breite || innerWidth, Hh = ctx.hoehe || innerHeight, schmal = B < Hh * 0.9, fov = schmal ? 60 : 46;
      const ende = (ctx.strasse && ctx.strasse.ENDE) || -44, f0 = Math.min(1, Math.max(0, ctx.fahrt || 0));
      const gl = x => x * x * (3 - 2 * x), e = gl(f0) * 0.35 + f0 * 0.65;
      const z1 = ende + (schmal ? Math.min(19, 4.9 / Math.tan(Math.atan(Math.tan(fov * Math.PI / 360) * B / Hh))) : 10.5);
      const k = new THREE.PerspectiveCamera(fov, B / Hh, 0.1, 400);
      k.position.set(0, schmal ? 1.85 : 2.05, 7 + (z1 - 7) * e);
      k.lookAt(0, (schmal ? 4.6 : 4.9) - gl(f0) * (schmal ? 1.55 : 1.85), ende); k.updateMatrixWorld();
      const lin = [0, .34, .62].map(f => zeileLinear(k, f));
      ctx.himmelVerlauf = lin.map(hex);                         // für den Hintergrund (lineare Szenenfarbe als sRGB-Hex)
      info.himmelVerlauf = ctx.himmelVerlauf; info.himmelFahrt = f0; info.himmelAnzeige = lin.map(c => hexS(post.anzeige(c)));   // Farbe auf dem Schirm
    } catch (e) { info.himmelFehler = String(e && e.message); }
  }

  // ---------- Laufzeit ----------
  const start = performance.now();
  function aktualisieren() {
    // Wolken ziehen nur, wenn ohnehin gezeichnet wird; selbst fordern wir kein Bild an (ausser während einer Überblendung)
    const jetzt = performance.now();
    if (!ctx.ruhig) himmelUni.zeit.value = (jetzt - start) / 1000;
    for (let i = blenden.length - 1; i >= 0; i--) {
      const b = blenden[i];
      if (!b.t0) b.t0 = jetzt;
      const a = Math.min(1, (jetzt - b.t0) / b.dauer);
      b.fn(weich(a));
      if (a >= 1) blenden.splice(i, 1);
    }
    return blenden.length > 0 || bildFolgt;
  }
  let bildFolgt = false;                                     // nach einem Tausch noch ein Bild, damit aktualisieren sicher läuft

  // ---------- Prüfwerte (nur im Prüfmodus sichtbar): Dauer der Schritte, neu kompilierte Programme je Bild ----------
  const pruef = typeof location !== 'undefined' && /[?&](fahrt|stufe)=/.test(location.search);
  const info = { stand: 'stufe1', schritte: [], neu: [] };
  ctx.lichtInfo = info;
  if (gestaffelt) himmelVerlaufRechnen();
  function melden() { if (pruef && renderer.domElement && renderer.domElement.dataset) renderer.domElement.dataset.licht = JSON.stringify(info); }
  function zeichnenMitMessung(r, sc, ka) {
    const vor = renderer.info.programs ? renderer.info.programs.length : 0, t0 = performance.now();
    post.zeichnen(r, sc, ka);
    bildFolgt = false;
    const nach = renderer.info.programs ? renderer.info.programs.length : 0;
    if (pruef && nach > vor && info.neu.length < 40) {
      // welche Objekte die neuen Programme brauchen (nur im Prüfmodus)
      const neuP = new Set(renderer.info.programs.slice(vor)), obj = [];
      szene.traverse(o => { for (const m of [].concat(o.material || [])) { const cp = renderer.properties.get(m).currentProgram; if (cp && neuP.has(cp) && obj.length < 6) obj.push((o.parent ? (o.parent.name || o.parent.type) + '/' : '') + (o.name || o.type) + (o.isInstancedMesh ? '[inst]' : '')); } });
      const namen = obj.join(', ') || 'ausserhalb der Szene';
      info.neu.push([info.stand, nach - vor, Math.round(performance.now() - t0), namen]); melden();
    }
  }

  // ---------- Stufen (gestaffeltes Laden) ----------
  // haupt.js kompiliert in Stufe 2 die ganze Szene (auch Unsichtbares) und nach jedem Modulschritt alles nach, ein Programm
  // pro Zeitschlitz. Darum kompiliert licht nicht selbst: Was später gebraucht wird, steht unsichtbar im Vorrat; ein Schritt
  // schaltet den neuen Zustand sofort ein (Schatten, Umgebung, Bloom) und blendet nur die Stärken weich auf.
  const vorrat = new THREE.Group(); vorrat.name = 'licht-vorrat'; vorrat.visible = false;
  if (gestaffelt) {
    const v = new THREE.Mesh(himmelGeo, himmelVoll); v.frustumCulled = false; vorrat.add(v);   // voller Himmel
    // echte Laternenmaterialien in derselben Form (InstancedMesh), sonst fehlt beim Tausch die Instanz-Variante
    for (const t of tausch) {
      if (vorrat.children.some(x => x.material === t.echt && x.isInstancedMesh === !!t.o.isInstancedMesh)) continue;
      const x = t.o.isInstancedMesh ? new THREE.InstancedMesh(t.o.geometry, t.echt, 1) : new THREE.Mesh(t.o.geometry, t.echt);
      x.frustumCulled = false; x.castShadow = t.o.castShadow; x.receiveShadow = t.o.receiveShadow; vorrat.add(x);
    }
    gruppe.add(vorrat);
  }
  // Shader ausserhalb der Szene (Bloom, Himmel der Umgebungskarte) laufen ohne Lichter: einzeln gegen ihre eigene Szene
  // kompilieren, je eines pro Zeitschlitz (ohne paralleles Kompilieren blockiert jedes Programm)
  const pause = () => ctx.rast ? ctx.rast() : new Promise(r => setTimeout(r, 0));
  async function einzelnKompilieren(liste) {
    for (const [obj, sz, kam] of liste) {
      if (entsorgt) return;
      const alt = renderer.getRenderTarget();
      try { renderer.setRenderTarget(post.ziel); renderer.compile(obj, kam, sz); } catch (e) {} finally { renderer.setRenderTarget(alt); }
      await pause();
    }
  }
  const bloomListe = () => post.vorrat.children.map(m => [m, post.vorrat, post.ortho]);
  function schritt(name, fn) {
    return async () => {
      if (entsorgt) return false;
      if (!nachgebaut) nachbauen(ctx);
      const t0 = performance.now();
      let synchron = 0;
      try { synchron = await fn(); } catch (e) { info.schritte.push([name, 'fehler', String(e && e.message)]); melden(); return false; }
      if (entsorgt) return false;
      info.stand = name; info.schritte.push([name, Math.round(performance.now() - t0), Math.round(synchron || 0)]); melden();
      bildFolgt = true;
      if (ctx.malen) ctx.malen();
      return true;
    };
  }
  const takt = fn => { const t = performance.now(); fn(); return performance.now() - t; };
  // Stufe 2: Vorrat sicher kompiliert (haupt.js hat ihn meist schon), dann echte Laternen, voller Himmel, Lichtkegel
  const stufe2 = schritt('shader', async () => {
    if (ctx.kompilieren) await ctx.kompilieren(vorrat);
    await einzelnKompilieren([...bloomListe(), [envMesh, envSzene, kamera]]);   // für Stufe 4 vorbereiten
    if (entsorgt) return 0;
    return takt(() => {
      const tauschen = () => { for (const t of tausch) t.o.material = t.echt; };
      if (ctx.tauschen) ctx.tauschen(tauschen); else tauschen();
      himmel.material = himmelVoll;                          // gleiche Uniforms, bei voll = 0 gleiches Bild
      blende(900, a => { himmelUni.voll.value = a; });
      if (kegelMat) {
        const z = kegelMat.userData.voll ?? (kegelMat.userData.voll = kegelMat.uniforms.staerke.value);
        kegelListe.forEach(k => { k.visible = true; }); blende(900, a => { kegelMat.uniforms.staerke.value = z * a; });
      }
    });
  });
  // Stufe 4a: Sonnenschatten (Tag, nicht auf tief); die Schattenstärke steigt von 0
  const schattenEin = schritt('schatten', async () => {
    if (!schatten || !sonne) return 0;
    return takt(() => {
      renderer.shadowMap.enabled = true; sonne.castShadow = true;
      if ('intensity' in sonne.shadow) blende(900, a => { sonne.shadow.intensity = schattenStaerke * a; });
    });
  });
  // Stufe 4b: PMREM-Umgebung (fromScene läuft synchron, darum ein eigener Schritt); das Halbkugellicht geht dabei zurück
  const umgebungEin = schritt('umgebung', async () => {
    let ms = takt(() => umgebungBauen());
    info.pmrem = Math.round(ms);
    if (!umgebungRT || entsorgt) return ms;
    const tex = umgebungRT.texture;
    ms += takt(() => { szene.environment = tex; blende(1200, a => { szene.environmentIntensity = umgebungStaerke * a; hemiSetzen(a); }); });
    return ms;
  });
  // Stufe 4c: Spiegelung bzw. Streifen, Lichtteppich, Bloom und Korn (Bloom-Durchgänge laufen ab hier, Stärke steigt von 0)
  const effekteEin = schritt('effekte', async () => takt(() => {
    if (spiegel && spiegelUni) { spiegel.visible = true; blende(1200, a => { spiegelUni.staerke.value = spiegelStaerke * a; }); }
    if (streifen) { streifen.visible = true; blende(1200, a => { streifen.material.uniforms.staerke.value = streifenStaerke * a; }); }
    if (teppich) { teppich.mesh.visible = true; blende(1200, a => { teppich.mesh.material.color.copy(teppich.farbe).multiplyScalar(a); }); }
    if (rauZiel > 0) { const r0 = rauUni.value; blende(1200, a => { rauUni.value = r0 + (rauZiel - r0) * a; }); }
    post.effekte(1e-4); blende(1200, a => post.effekte(Math.max(1e-4, a)));
  }));

  function entsorgen() {
    entsorgt = true; blenden.length = 0;
    if (ctx.kompilierZiel === post.ziel) ctx.kompilierZiel = null;
    szene.remove(gruppe);
    gruppe.traverse(o => { if (o.isInstancedMesh) o.dispose(); if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose(); });
    for (const o of frei) if (o && o.dispose) o.dispose();
    if (umgebungRT) { if (szene.environment === umgebungRT.texture) szene.environment = null; umgebungRT.dispose(); }
    if (szene.fog && szene.fog.isFogExp2) szene.fog = nebelAlt || null;
    if (pflasterAlt) {
      Object.assign(pflasterAlt.mat, { envMapIntensity: pflasterAlt.envMapIntensity, roughness: pflasterAlt.roughness });
      pflasterAlt.mat.onBeforeCompile = pflasterAlt.obc || function () {};
      if (pflasterAlt.key) pflasterAlt.mat.customProgramCacheKey = pflasterAlt.key; else delete pflasterAlt.mat.customProgramCacheKey;
      pflasterAlt.mat.needsUpdate = true;
    }
    renderer.shadowMap.enabled = false;
  }

  // ---------- nach fassaden und requisiten: Anker lesen ----------
  let nachgebaut = false, teppich = null;
  function nachbauen(c2 = ctx) {
    if (nachgebaut) return; nachgebaut = true;
    const nr = c2.nr13 || { x: 0, z: ENDE, breite: 8.6, hoehe: 13.5, eg: 5.0 };
    // Licht aus dem Laden auf das Pflaster
    const L = T.laden || 0;
    // Schnee wirft fast alles Licht zurück: Ladenlicht dort schwächer, sonst frisst der Teppich ins Weisse aus
    const weissBoden = schnee ? 0.4 : 1;
    if (L > 0) {
      const spot = eigen(new THREE.SpotLight(farbe('#ffb35c'), 50 * L * L * weissBoden, 20, 0.95, 0.8, 1.4));
      spot.position.set(nr.x, 2.7, nr.z + 0.35); spot.target.position.set(nr.x, 0, nr.z + 7.5);
      const fuell = eigen(new THREE.PointLight(farbe('#ffb866'), 5 * L * weissBoden, 12, 1.4));
      fuell.position.set(nr.x, 2.6, nr.z + 0.7);
      gruppe.add(spot, spot.target, fuell);
      if (!tag || L > 0.6) {
        const lichtTeppich = eigen(new THREE.Mesh(merk(new THREE.PlaneGeometry(9, 7)), merk(new THREE.MeshBasicMaterial({ map: poolTex, color: warm.clone().multiplyScalar(0.26 * L * weissBoden), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))));
        lichtTeppich.rotation.x = -Math.PI / 2; lichtTeppich.position.set(nr.x, 0.015, nr.z + 3.2); gruppe.add(lichtTeppich);
        teppich = { mesh: lichtTeppich, farbe: lichtTeppich.material.color.clone() };
        lichtTeppich.visible = !gestaffelt;
      }
    }
    // Höfe für alle warmen Lichtpunkte der anderen Module
    const fremde = (anker.leuchten || []).filter(l => !l.laterne && l.pos);
    if (!tag || (T.laden || 0) > 0.6) for (const l of fremde) {
      const s = Math.min(1.2, (l.staerke || 1));
      const r = Math.max(0.3, l.radius || 0.6);
      const hof = eigen(new THREE.Sprite(merk(new THREE.SpriteMaterial({ map: hofTex, color: farbe(l.farbe || '#ffb35c'), transparent: true, opacity: 0.22 * s, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }))));
      hof.position.copy(l.pos); hof.scale.set(r * 2.6, r * 2.2, 1); gruppe.add(hof);
    }
    // Spiegelung
    if (spiegelStaerke > 0.01 && !ctx.keineSpiegelung) spiegel = spiegelBauen();
    if (!spiegel && !tag) streifen = streifenBauen((anker.leuchten || []).filter(l => l.pos && l.pos.y > 0.6 && (l.laterne || l.pos.y < 4)));
    pflasterNass();
    // Schatten: alles Feste wirft und empfängt
    if (schatten) szene.traverse(o => {
      if (!o.isMesh || o.userData.lichtEigen || o.isSprite) return;
      const m = o.material; if (!m || (m.transparent && m.opacity < 0.9) || m.blending === THREE.AdditiveBlending || m.isShaderMaterial && !m.lights) return;
      o.castShadow = true; o.receiveShadow = true;
    });
    if (ctx.malen) ctx.malen();
  }

  const modul = { aktualisieren, entsorgen, nachbauen, zeichnen: zeichnenMitMessung, groesse: post.groesse };
  if (gestaffelt) modul.stufen = { 2: [stufe2], 4: [schattenEin, umgebungEin, effekteEin] };
  ctx.lichtModul = modul;
  return modul;
}

// Auch als Modulfunktion, falls haupt.js licht.nachbauen?.(ctx) am Modul aufruft
export function nachbauen(ctx) { if (ctx && ctx.lichtModul) ctx.lichtModul.nachbauen(ctx); }
