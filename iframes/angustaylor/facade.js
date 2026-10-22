// A procedural brick-and-window building facade as a set of PBR textures (albedo, emissive, normal, roughness), made once at start-up.
//
// The bricks are laid in running bond with raised faces and recessed mortar (a height map turned into a normal map), every brick is
// tinted a little differently, the windows have frames, mullions and a recessed pane, some of them are lit (those go into the emissive
// map, so they glow and bloom), rain streaks run down from the sills, and the bottom of the wall is wet and glossy.
import { THREE } from './gfx.js';

const N = 1024;
const hash = (a, b, c = 0) => { let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

export function createFacade() {
  const albedo = new Uint8Array(N * N * 4), emis = new Uint8Array(N * N * 4), rough = new Uint8Array(N * N * 4), norm = new Uint8Array(N * N * 4);
  const height = new Float32Array(N * N);
  const put = (buf, x, y, r, g, b) => { const i = ((N - 1 - y) * N + x) * 4; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; };   // y counts from the top

  const BW = 32, BH = 12, MORTAR = 2;
  const COLS = 8, ROWS = 5, CW = N / COLS, CH = N / ROWS;
  const WIN_W = 74, WIN_H = 128;
  const LIT = [[42, 92, 200], [255, 106, 120], [90, 200, 255], [255, 214, 160], [120, 140, 255]];

  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const row = Math.floor(y / BH), off = (row % 2) * (BW / 2);
    const bxi = Math.floor((x + off) / BW), bx = (x + off) % BW, by = y % BH;
    const mortar = bx < MORTAR || by < MORTAR;
    const t = hash(bxi, row), t2 = hash(bxi, row, 9);
    let r, g, b, h, ro;
    if (mortar) { r = 20; g = 22; b = 28; h = 0; ro = 0.95; }
    else {
      const base = 26 + t * 26;
      r = base * (0.9 + t2 * 0.3); g = (base + 2) * (0.95 + t2 * 0.2); b = (base + 10 + t2 * 6) * 1.05;
      if (t > 0.93) { r *= 1.5; g *= 1.1; b *= 0.9; }   // an odd warm brick
      h = 0.55 + t2 * 0.2 + (Math.sin(x * 1.7 + y * 2.3) * 0.5 + 0.5) * 0.08; ro = 0.82 + t * 0.15;
    }
    // grime and rain streaks: darker towards the bottom of each row of windows, and long vertical runs
    const streak = hash(x >> 3, 3) > 0.82 ? hash(x >> 3, y >> 5, 4) * 0.5 : 0;
    const dirt = 1 - 0.22 * streak - 0.1 * hash(x >> 2, y >> 2, 5);
    r *= dirt; g *= dirt; b *= dirt;
    // the bottom of the wall is wet
    const wet = Math.max(0, 1 - y / 180) * 0 + Math.max(0, (y - (N - 220)) / 220);
    ro *= 1 - 0.55 * wet; r *= 1 - 0.25 * wet; g *= 1 - 0.2 * wet;
    put(albedo, x, y, r, g, b); put(emis, x, y, 0, 0, 0); put(rough, x, y, 0, ro * 255, 0);
    height[y * N + x] = h;
  }

  // windows
  for (let gy = 0; gy < ROWS; gy++) for (let gx = 0; gx < COLS; gx++) {
    const cx = gx * CW + CW / 2, cy = gy * CH + CH / 2 - 8;
    const x0 = Math.round(cx - WIN_W / 2), y0 = Math.round(cy - WIN_H / 2);
    const v = hash(gx, gy, 77);
    const lit = v < 0.42 ? LIT[Math.floor(hash(gx, gy, 5) * LIT.length)] : null;
    const curtain = hash(gx, gy, 6) < 0.45;
    for (let y = y0 - 8; y < y0 + WIN_H + 16; y++) for (let x = x0 - 8; x < x0 + WIN_W + 8; x++) {
      if (x < 0 || x >= N || y < 0 || y >= N) continue;
      const lx = x - x0, ly = y - y0, i = y * N + x;
      const inFrame = lx >= -6 && lx < WIN_W + 6 && ly >= -6 && ly < WIN_H + 6;
      const inGlass = lx >= 4 && lx < WIN_W - 4 && ly >= 4 && ly < WIN_H - 4;
      const sill = ly >= WIN_H + 6 && ly < WIN_H + 14 && lx >= -10 && lx < WIN_W + 10;
      if (sill) { put(albedo, x, y, 58, 62, 74); put(rough, x, y, 0, 0.55 * 255, 0); height[i] = 0.95; continue; }
      if (!inFrame) continue;
      if (!inGlass) { put(albedo, x, y, 46, 52, 66); put(rough, x, y, 0, 0.4 * 255, 0); height[i] = 0.9; continue; }
      const mull = Math.abs(lx - WIN_W / 2) < 2 || Math.abs(ly - WIN_H * 0.42) < 2;
      if (mull) { put(albedo, x, y, 46, 52, 66); put(rough, x, y, 0, 0.4 * 255, 0); height[i] = 0.88; continue; }
      // the glass: a dark, glossy, slightly reflective pane, recessed
      const grad = 0.6 + 0.4 * (1 - ly / WIN_H);
      put(albedo, x, y, 8 * grad, 14 * grad, 30 * grad);
      put(rough, x, y, 0, 0.08 * 255, 0);
      height[i] = 0.28;
      if (lit) {
        let k = 0.55 + 0.45 * Math.sin((lx / WIN_W) * Math.PI) * (0.7 + 0.3 * (1 - ly / WIN_H));
        if (curtain && ly < WIN_H * 0.5 && (lx < 14 || lx > WIN_W - 14)) k *= 0.35;   // curtains at the sides
        put(emis, x, y, lit[0] * k, lit[1] * k, lit[2] * k);
        put(albedo, x, y, lit[0] * 0.12, lit[1] * 0.12, lit[2] * 0.12);
      }
    }
  }
  // a neon strip along the base
  for (let y = N - 70; y < N - 64; y++) for (let x = 40; x < 480; x++) { put(emis, x, y, 30, 90, 230); put(albedo, x, y, 20, 40, 90); height[y * N + x] = 0.7; }

  // height -> normal map
  const S = 3.2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = height[y * N + (x + 1) % N] - height[y * N + (x + N - 1) % N], hy = height[((y + 1) % N) * N + x] - height[((y + N - 1) % N) * N + x];
    const nx = -hx * S, ny = hy * S, nz = 1, l = Math.hypot(nx, ny, nz);
    const i = ((N - 1 - y) * N + x) * 4;
    norm[i] = (nx / l * 0.5 + 0.5) * 255; norm[i + 1] = (ny / l * 0.5 + 0.5) * 255; norm[i + 2] = (nz / l * 0.5 + 0.5) * 255; norm[i + 3] = 255;
  }

  const tex = (data, srgb) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  return { map: tex(albedo, true), emissiveMap: tex(emis, true), normalMap: tex(norm, false), roughnessMap: tex(rough, false) };
}
