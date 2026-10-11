// A single pooled particle system (one draw call) for pickups, landings and hits.
import { THREE, rand, canvasTex } from './gfx.js';

const MAX = 360;

export function createFx(scene) {
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 3);
  const vel = new Float32Array(MAX * 3), base = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX), maxLife = new Float32Array(MAX), grav = new Float32Array(MAX);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const dot = canvasTex(32, 32, (g) => {   // a soft round sprite, so sparks are glowing dots rather than squares
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  });
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.34, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.frustumCulled = false;
  points.renderOrder = 8;
  scene.add(points);
  pos.fill(1e6);   // park unused particles far away
  let cursor = 0;
  const c = new THREE.Color();

  /** Emit n particles at (x,y,z) with a colour, speed spread and lifetime. */
  function burst(x, y, z, color, n, { speed = 4, up = 2, life: l = 0.6, gravity = 9, spread = 1 } = {}) {
    c.set(color);
    for (let k = 0; k < n; k++) {
      const i = cursor;
      cursor = (cursor + 1) % MAX;
      const a = Math.random() * Math.PI * 2, s = rand(0.3, 1) * speed;
      pos.set([x, y, z], i * 3);
      vel.set([Math.cos(a) * s * spread, rand(0, 1) * up + s * 0.3, Math.sin(a) * s * spread], i * 3);
      base.set([c.r, c.g, c.b], i * 3);
      col.set([c.r, c.g, c.b], i * 3);
      life[i] = maxLife[i] = l * rand(0.7, 1.2);
      grav[i] = gravity;
    }
  }

  return {
    burst,
    landing(x, z) { burst(x, 0.1, z, 0xd9b7a8, 8, { speed: 2.4, up: 0.6, life: 0.45, gravity: 2, spread: 1.4 }); },
    hit(x, y, z) { burst(x, y, z, 0xff3040, 34, { speed: 7, up: 4, life: 0.8, gravity: 10 }); burst(x, y, z, 0xffffff, 10, { speed: 5, up: 3, life: 0.4 }); },
    stomp(x, y, z) { burst(x, y, z, 0xffd34d, 16, { speed: 4, up: 3, life: 0.6 }); },
    /** dt is real seconds; `scroll` moves particles with the world so pickups stay where the pickup was. */
    update(dt, scroll = 0) {
      for (let i = 0; i < MAX; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        const j = i * 3;
        if (life[i] <= 0) { pos[j] = pos[j + 1] = pos[j + 2] = 1e6; continue; }
        vel[j + 1] -= grav[i] * dt;
        pos[j] += vel[j] * dt;
        pos[j + 1] = Math.max(0.02, pos[j + 1] + vel[j + 1] * dt);
        pos[j + 2] += vel[j + 2] * dt + scroll;
        const f = life[i] / maxLife[i];   // additive blending, so fading to black is fading out
        col[j] = base[j] * f; col[j + 1] = base[j + 1] * f; col[j + 2] = base[j + 2] * f;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    },
    clear() { life.fill(0); pos.fill(1e6); geo.attributes.position.needsUpdate = true; },
  };
}
