// Gemeinsam genutzt von allen Modulen der WebGL-Gasse. Besitzer: buehne. Andere Module lesen nur.
import * as THREE from '../vendor/three.module.min.js';
export { THREE };

// Grundstimmungen: helles Thema = tag, dunkles Thema = abend. Werte aus den abgenommenen Stimmungsbildern.
export const GRUND = {
  tag:   { zenit: '#4f86cc', mitte: '#8db6e2', horizont: '#e6ecf0', glut: '#f6dfb8', nebel: '#d8dde2', dichte: 0.009, hell: 1.5, fenster: 0.04, sterne: 0, lampe: 0, laden: 0.45, nass: 0.85, sonne: 3.2, belichtung: 0.95 },
  abend: { zenit: '#03050c', mitte: '#0a1222', horizont: '#1a2538', glut: '#2e2a3a', nebel: '#14100d', dichte: 0.035, hell: 0.16, fenster: 0.55, sterne: 1, lampe: 0.9, laden: 1, nass: 0.22, sonne: 0, belichtung: 1.15 },
};
// Schnee legt sich ueber beide Stimmungen.
export const WINTER = {
  tag:   { zenit: '#7f93ad', mitte: '#a9b6c6', horizont: '#e3e7ec', glut: '#efe3d6', nebel: '#d3d9e1', dichte: 0.03, hell: 1.35, sonne: 0.6, nass: 0.7 },
  abend: { zenit: '#0b1020', mitte: '#1c2638', horizont: '#3a4558', glut: '#4a4048', nebel: '#283244', dichte: 0.04, sterne: 0.15, hell: 0.3, nass: 0.4 },
};

// Schnee automatisch vom 1. Dezember bis Ende Februar (Datum des Besuchs). ?schnee=1|0 erzwingt.
export function istWinter(d = new Date()) {
  const q = new URLSearchParams(location.search).get('schnee');
  if (q === '1') return true; if (q === '0') return false;
  const m = d.getMonth(); return m === 11 || m <= 1;
}
export function stimmung(thema, schnee = istWinter()) {
  const S = thema === 'dark' ? 'abend' : 'tag';
  const T = Object.assign({ schnee: 0 }, GRUND[S], schnee ? Object.assign({ schnee: 1 }, WINTER[S]) : {});
  return { S, T, schnee };
}

// Zufall mit Samen, damit die Gasse jedes Mal gleich steht
export function zufall(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Texturen aus Canvas
export const PX = 48;                                    // Pixel pro Meter
// px: Pixel pro Meter, auf Qualitaet 'tief' ctx.px (= PX / 2) mitgeben
export function leinwand(w, h, px = PX) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * px)); c.height = Math.max(1, Math.round(h * px)); return [c, c.getContext('2d', { willReadFrequently: false })]; }
export function tex(c, farbe) { const t = new THREE.CanvasTexture(c); if (farbe) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
export function koernung(g, w, h, r, staerke) {
  const d = g.getImageData(0, 0, w, h), a = d.data;
  for (let i = 0; i < a.length; i += 4) { const k = (r() - 0.5) * staerke; a[i] += k; a[i + 1] += k; a[i + 2] += k; }
  g.putImageData(d, 0, 0);
}


// ---------- Ergaenzungen der Buehne (nur hinzugefuegt, nichts umbenannt) ----------
// Strassenmasse, fuer alle gleich
export const STRASSE = { BREITE: 7.8, ENDE: -44 };
// Pixel pro Meter je Qualitaet
export function pxFuer(q) { return q === 'tief' ? PX / 2 : PX; }
// Farbe aus Hex als THREE.Color, mit Mischung: mische('#fff', '#000', 0.3)
export function mische(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }
// Gibt alles in einem Objektbaum frei (Geometrien, Materialien, Texturen)
export function freigeben(wurzel) {
  if (!wurzel) return;
  const tex = new Set();
  wurzel.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material; if (!m) return;
    for (const mm of Array.isArray(m) ? m : [m]) {
      for (const k in mm) { const v = mm[k]; if (v && v.isTexture) tex.add(v); }
      if (mm.uniforms) for (const k in mm.uniforms) { const v = mm.uniforms[k].value; if (v && v.isTexture) tex.add(v); }
      mm.dispose();
    }
  });
  tex.forEach(t => t.dispose());
}
// Weicher Lichtfleck (fuer Hoefe, Flocken): Canvas-Textur, einmal pro Groesse
const _flecken = {};
export function fleck(n = 64) {
  if (_flecken[n] && _flecken[n].image) return _flecken[n];
  const c = document.createElement('canvas'); c.width = c.height = n; const g = c.getContext('2d');
  const rg = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,.45)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, n, n);
  return (_flecken[n] = new THREE.CanvasTexture(c));
}
