// Small three.js helpers shared by every module: cached materials, meshes, canvas textures.
import * as THREE from './vendor/three.module.min.js';

export { THREE };

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
export const hexCss = (n) => '#' + n.toString(16).padStart(6, '0');
export const rgbHex = (r, g, b) => (r << 16) | (g << 8) | b;

const matCache = new Map();
/** Flat-shaded standard material, cached by colour and options so clones share it. */
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...opts }));
  return matCache.get(key);
}

export function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

export function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function signTex(lines, bg, fg, w, h) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fg;
    g.lineWidth = h * 0.05;
    g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
    g.fillStyle = fg;
    g.font = `900 ${Math.floor(h * (lines.length > 1 ? 0.27 : 0.4))}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((t, i) => g.fillText(t, w / 2, h * (lines.length > 1 ? 0.33 + i * 0.36 : 0.5)));
  });
}

export function labelTex(text) {
  return canvasTex(384, 96, (g, w, h) => {
    g.fillStyle = 'rgba(0, 0, 0, 0.6)';
    g.fillRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 46;
    g.font = `900 ${size}px system-ui, sans-serif`;
    while (g.measureText(text).width > w - 24 && size > 20) {
      size -= 2;
      g.font = `900 ${size}px system-ui, sans-serif`;
    }
    g.fillText(text, w / 2, h / 2 + 2);
  });
}

/** Load an image; resolves to null (never rejects) so a missing asset degrades instead of crashing. */
export function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
