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

/** Every canvas texture is painted at this many pixels per drawing unit, so text and lines stay sharp up close and on big LED screens. Drawing code keeps working in the logical w x h. */
export const TEX_SCALE = 2;
export const MAX_ANISOTROPY = 16;   // the GPU clamps this to what it supports
export function canvasTex(w, h, draw, scale = TEX_SCALE) {
  const s = Math.min(scale, 4096 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const g = c.getContext('2d');
  g.scale(s, s);
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = MAX_ANISOTROPY;
  tex.generateMipmaps = true;
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

/** A cheap soft shadow: a dark disc flat on the road. It replaces real shadow mapping, which cost a second pass over the whole scene. */
const BLOB_GEO = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
const blobMats = new Map();
export function blobShadow(rx, rz, opacity = 0.4) {
  if (!blobMats.has(opacity)) blobMats.set(opacity, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false }));
  const m = new THREE.Mesh(BLOB_GEO, blobMats.get(opacity));
  m.scale.set(rx, 1, rz);
  m.position.y = 0.035;
  m.userData.keep = true;   // not baked into its neighbours (it is a different, transparent material)
  m.renderOrder = 1;
  return m;
}

/* ---------- draw-call savers ---------- */
/** Bake a list of indexed geometries (already in their final space) into one. Carries position, normal, uv and, when every part has it, colour. */
export function mergeGeos(list) {
  const withColor = list.every((g) => g.attributes.color);
  let vN = 0, iN = 0;
  for (const g of list) { vN += g.attributes.position.count; iN += g.index.count; }
  const pos = new Float32Array(vN * 3), nor = new Float32Array(vN * 3), uv = new Float32Array(vN * 2), idx = new Uint32Array(iN);
  const col = withColor ? new Float32Array(vN * 3) : null;
  let v = 0, i = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, v * 3);
    nor.set(g.attributes.normal.array, v * 3);
    uv.set(g.attributes.uv.array, v * 2);
    if (col) col.set(g.attributes.color.array, v * 3);
    for (let k = 0; k < g.index.count; k++) idx[i + k] = g.index.array[k] + v;
    v += g.attributes.position.count;
    i += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * Merge a group's rigid child meshes that share a material into one mesh each. Joint groups stay separate,
 * so animation is unaffected. A mesh with `userData.keep` (it moves on its own), a material array, or no index is left alone.
 */
export function mergeStatic(group) {
  const byMat = new Map();
  for (const ch of [...group.children]) {
    if (!ch.isMesh || Array.isArray(ch.material) || !ch.geometry.index || ch.userData.keep || ch.name) continue;
    ch.updateMatrix();
    const geo = ch.geometry.clone().applyMatrix4(ch.matrix);
    if (!byMat.has(ch.material)) byMat.set(ch.material, { geos: [], shadow: false });
    const e = byMat.get(ch.material);
    e.geos.push(geo);
    e.shadow ||= ch.castShadow;
    group.remove(ch);
  }
  for (const [material, { geos, shadow }] of byMat) {
    const m = new THREE.Mesh(geos.length > 1 ? mergeGeos(geos) : geos[0], material);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
  }
}
/** mergeStatic on a group and every group below it. */
export function mergeTree(root) {
  const gs = [];
  root.traverse((n) => { if (n.isGroup) gs.push(n); });
  gs.forEach(mergeStatic);
}

/**
 * Make a material tag its own pixels (alpha 0.5, everything else is 1.0) so the final pass knows which pixels are
 * reflective floor, instead of guessing from darkness (which also caught dark clothes).
 */
export function markFloor(m) {
  m.onBeforeCompile = (shader) => { shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'gl_FragColor = vec4( outgoingLight, 0.5 );'); };
  m.customProgramCacheKey = () => 'floor-mark';
}
