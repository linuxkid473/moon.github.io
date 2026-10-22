// A planar reflection of the street for the wet road.
//
// The scene is drawn a second time, at half the resolution, from a camera mirrored in the road's plane (the road itself is left
// out of that pass). The road material then looks that picture up at the screen position where the mirrored camera sees the same
// spot, so the lamps, the signs, the explosion and Angus all appear upside down in the asphalt. Fresnel (grazing angles reflect
// more), puddles that ride along with the road, ripples and a roughness blur are added in the road's own shader.
import { THREE } from './gfx.js';

const SCALE = 0.5;

export function createReflection(renderer, scene) {
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, samples: 0 });
  const cam = new THREE.PerspectiveCamera();
  const uniforms = {
    uRefl: { value: rt.texture }, uReflVP: { value: new THREE.Matrix4() }, uReflAmt: { value: 1 }, uScroll: { value: 0 }, uWetTime: { value: 0 },
  };
  const hidden = [];
  const p = new THREE.Vector3(), d = new THREE.Vector3(), up = new THREE.Vector3(), q = new THREE.Quaternion();
  let on = true;

  const NOISE = `
    float wh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float wn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y); }
    float wfbm(vec2 p) { return 0.5 * wn(p) + 0.25 * wn(p * 2.03 + 7.0) + 0.125 * wn(p * 4.1 + 3.0) + 0.0625 * wn(p * 8.3); }`;

  return {
    uniforms,
    /** leave this mesh out of the mirrored pass (the road itself and the floor) */
    hide(mesh) { hidden.push(mesh); },
    set enabled(v) { on = v; uniforms.uReflAmt.value = v ? 1 : 0; },
    get enabled() { return on; },
    resize(w, h) { rt.setSize(Math.max(2, Math.round(w * SCALE)), Math.max(2, Math.round(h * SCALE))); },
    render(camera) {
      if (!on) return;
      camera.updateMatrixWorld();
      camera.getWorldPosition(p);
      camera.getWorldDirection(d);
      up.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(q));
      cam.position.set(p.x, -p.y, p.z);
      cam.up.set(up.x, -up.y, up.z);
      cam.lookAt(p.x + d.x, -(p.y + d.y), p.z + d.z);
      cam.fov = camera.fov; cam.aspect = camera.aspect; cam.near = camera.near; cam.far = camera.far;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      uniforms.uReflVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      uniforms.uWetTime.value = performance.now() / 1000;
      for (const m of hidden) { m.userData.rv = m.visible; m.visible = false; }
      const shadowAuto = renderer.shadowMap.autoUpdate;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      for (const m of hidden) m.visible = m.userData.rv;
    },
    /** make a MeshStandardMaterial reflect the mirrored street, like wet asphalt */
    applyWet(material, { amount = 1 } = {}) {
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWetPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform sampler2D uRefl; uniform mat4 uReflVP; uniform float uReflAmt; uniform float uScroll; uniform float uWetTime;
            varying vec3 vWetPos;
            ${NOISE}`)
          .replace('#include <opaque_fragment>', `
            if (uReflAmt > 0.0) {
              vec2 wp = vec2(vWetPos.x, vWetPos.z - uScroll);                   // puddles ride along with the road
              float pud = wfbm(wp * vec2(0.34, 0.16) + 3.0);
              float puddle = smoothstep(0.46, 0.64, pud);
              vec4 rq = uReflVP * vec4(vWetPos, 1.0);
              vec2 ruv = rq.xy / rq.w * 0.5 + 0.5;
              vec2 rip = (vec2(wn(wp * 1.7 + uWetTime * 0.5), wn(wp * 1.7 + 19.0 - uWetTime * 0.4)) - 0.5) * 0.0045;
              ruv += rip * (0.35 + puddle);
              float blur = mix(0.0055, 0.0011, puddle);                         // rough asphalt blurs the mirror; puddles are sharp
              vec3 refl = texture2D(uRefl, ruv).rgb * 0.36
                + (texture2D(uRefl, ruv + vec2(blur, 0.0)).rgb + texture2D(uRefl, ruv - vec2(blur, 0.0)).rgb
                 + texture2D(uRefl, ruv + vec2(0.0, blur)).rgb + texture2D(uRefl, ruv - vec2(0.0, blur)).rgb) * 0.16;
              vec3 V = normalize(cameraPosition - vWetPos);
              float fr = pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);               // Fresnel: grazing angles reflect more
              float k = (mix(0.10, 0.62, puddle) + 0.5 * fr) * ${amount.toFixed(2)} * uReflAmt;
              outgoingLight = outgoingLight * (1.0 - 0.35 * puddle) + refl * clamp(k, 0.0, 0.95);
            }
            #include <opaque_fragment>`);
      };
      material.customProgramCacheKey = () => 'wet-road';
    },
  };
}
