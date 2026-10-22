// Image-based lighting: a small procedural "night rally" panorama (a dark blue sky, a bright LED wall, a few lamps) baked into a
// PMREM so every glossy material (shoes, the bomb, the wet road's specular) reflects something believable instead of black.
import { THREE } from './gfx.js';

export function createEnvironment(renderer, scene) {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; void main() {
      float h = normalize(vP).y;
      vec3 top = vec3(0.012, 0.03, 0.09), mid = vec3(0.05, 0.11, 0.30), low = vec3(0.01, 0.015, 0.04);
      vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.5)) : mix(mid, low, pow(-h, 0.5));
      gl_FragColor = vec4(c, 1.0); }`,
  }));
  env.add(sky);
  const lamp = (w, h, x, y, z, r, g, b, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.y = ry; env.add(m);
  };
  lamp(34, 14, 0, 12, -45, 0.9, 1.5, 3.8);              // the LED wall at the end of the street
  lamp(34, 3, 0, 4, -44, 3.4, 0.6, 0.8);                // its red band
  lamp(5, 5, -14, 22, 4, 2.0, 2.0, 2.8, Math.PI / 2);  // a cool lamp over the left wall
  lamp(5, 5, 14, 20, 0, 3, 1.8, 1.3, -Math.PI / 2);      // a warm one on the right
  lamp(10, 1.2, 0, 28, -10, 2.4, 2.4, 3.0);                  // an overhead strip
  lamp(3, 3, 0, 8, 40, 1.5, 1.8, 3);                     // a soft glow behind the camera
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.03);
  scene.environment = rt.texture;
  pm.dispose();
  return rt.texture;
}
