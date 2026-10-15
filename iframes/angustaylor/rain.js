// Real rain in the world: streaks that fall (and rush past as you run) and little splashes on the road.
// The drops on the window and the wet floor are in glass.js.
import { THREE, rand } from './gfx.js';

const RAIN_N = 260, SPL_N = 200;   // steady rain

export function createRain(scene, dotTex) {
  const rainPos = new Float32Array(RAIN_N * 6);    // two ends per streak
  const rainHead = new Float32Array(RAIN_N * 3);   // the lower end of each streak
  for (let i = 0; i < RAIN_N; i++) { rainHead[i * 3] = rand(-16, 16); rainHead[i * 3 + 1] = rand(0, 16); rainHead[i * 3 + 2] = rand(-75, 14); }
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xc9d6ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  lines.geometry.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  lines.frustumCulled = false;
  scene.add(lines);

  const splashLife = new Float32Array(SPL_N), splashPos = new Float32Array(SPL_N * 3).fill(-999), splashCol = new Float32Array(SPL_N * 3);
  const splashes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.24, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  splashes.geometry.setAttribute('position', new THREE.BufferAttribute(splashPos, 3));
  splashes.geometry.setAttribute('color', new THREE.BufferAttribute(splashCol, 3));
  splashes.frustumCulled = false;
  scene.add(splashes);
  let splashNext = 0;

  return {
    setVisible(v) { lines.visible = splashes.visible = v; },
    /** dt: seconds. speed: how fast the road is running, which the rain rushes towards you at. */
    step(dt, speed) {
      const fall = 20;
      for (let i = 0; i < RAIN_N; i++) {
        let x = rainHead[i * 3], y = rainHead[i * 3 + 1] - fall * dt, z = rainHead[i * 3 + 2] + speed * dt;
        if (y < 0) {   // it has hit the ground: now and then a splash on the road
          if (Math.abs(x) < 6.5 && z < 6 && z > -45 && Math.random() < 0.08) { const k = splashNext++ % SPL_N; splashPos[k * 3] = x; splashPos[k * 3 + 1] = 0.05; splashPos[k * 3 + 2] = z; splashLife[k] = 0.28; }
          y += 16; x = rand(-16, 16);
        }
        if (z > 14) z -= 89;
        rainHead[i * 3] = x; rainHead[i * 3 + 1] = y; rainHead[i * 3 + 2] = z;
        rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
        rainPos[i * 6 + 3] = x; rainPos[i * 6 + 4] = y + 0.9; rainPos[i * 6 + 5] = z - speed * 0.03;   // the tail trails up and away
      }
      lines.geometry.attributes.position.needsUpdate = true;
      for (let k = 0; k < SPL_N; k++) {
        if (splashLife[k] <= 0) continue;
        splashLife[k] -= dt;
        const f = Math.max(0, splashLife[k] / 0.28);
        splashCol[k * 3] = splashCol[k * 3 + 1] = splashCol[k * 3 + 2] = f;
        if (splashLife[k] <= 0) splashPos[k * 3 + 1] = -999;
      }
      splashes.geometry.attributes.position.needsUpdate = true;
      splashes.geometry.attributes.color.needsUpdate = true;
    },
  };
}
