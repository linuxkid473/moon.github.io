// Rigid debris: every piece is a real body in the physics world (physics.js), so it tumbles with proper inertia,
// bounces and skids on the moving road, and sheets of paper flutter on the air instead of flying like bullets.
//   spawn({ geo, material, x, y, z, vel, omega, size: [hx, hy, hz], mass, life, ... })  one piece
//   fromMesh(src, ...)                                                                    a piece that looks like an existing mesh
import { THREE } from './gfx.js';
import { Body } from './physics.js';

export function createDebris(scene, phys) {
  const live = [];

  function spawn(o) {
    const [hx, hy, hz] = o.size;
    const body = new Body({ type: 'box', hx, hy, hz }, o.mass ?? 1, {
      restitution: o.restitution ?? 0.3, friction: o.friction ?? 0.55, linDamp: o.linDamp ?? 0.08, angDamp: o.angDamp ?? 0.15,
      aero: o.aero ?? 0, aeroArea: o.aeroArea ?? 0, gravityScale: o.gravityScale ?? 1,
    });
    body.pos.set(o.x, o.y, o.z);
    if (o.quat) body.quat.copy(o.quat);
    body.vel.copy(o.vel);
    if (o.omega) body.omega.copy(o.omega);
    body.prevPos.copy(body.pos); body.prevQuat.copy(body.quat);
    const mesh = new THREE.Mesh(o.geo, o.glow ? o.material.clone() : o.material);
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.position.copy(body.pos); mesh.quaternion.copy(body.quat);
    scene.add(mesh);
    phys.add(body, mesh);
    const piece = { body, mesh, age: 0, life: o.life ?? 3, glow: o.glow ?? 0, own: !!o.glow, s0: new THREE.Vector3(1, 1, 1) };
    live.push(piece);
    return piece;
  }

  /** a piece shaped and coloured like `src` (a mesh), sized by its geometry's bounding box (scaled by src.scale) */
  function fromMesh(src, o) {
    src.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    src.matrixWorld.decompose(p, q, sc);
    if (!src.geometry.boundingBox) src.geometry.computeBoundingBox();
    const bb = src.geometry.boundingBox, c = bb.getCenter(new THREE.Vector3()), d = bb.getSize(new THREE.Vector3());
    const centre = c.clone().multiply(sc).applyQuaternion(q).add(p);
    // the geometry may not be centred on its origin: wrap it so it is
    const geo = c.lengthSq() < 1e-8 ? src.geometry : src.geometry.clone().translate(-c.x, -c.y, -c.z);
    const piece = spawn({ ...o, geo, material: src.material, x: centre.x, y: centre.y, z: centre.z, quat: q, size: [Math.max(0.02, d.x * sc.x / 2), Math.max(0.02, d.y * sc.y / 2), Math.max(0.02, d.z * sc.z / 2)] });
    piece.mesh.scale.copy(sc);
    piece.s0.copy(sc);
    return piece;
  }

  function update(dt) {
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.age += dt;
      const left = p.life - p.age;
      if (left <= 0 || p.body.pos.z > 16 || p.body.pos.y < -20) {
        phys.remove(p.body);
        scene.remove(p.mesh);
        if (p.own) p.mesh.material.dispose();
        live.splice(i, 1);
        continue;
      }
      if (left < 0.5) p.mesh.scale.copy(p.s0).multiplyScalar(Math.max(0.01, left / 0.5));   // shrinks away at the end
      if (p.glow > 0 && p.mesh.material.emissive) {   // burning: glows hot, then cools
        const g = Math.max(0, 1 - p.age / 1.1) * p.glow;
        p.mesh.material.emissiveIntensity = g;
      }
    }
  }

  function clear() {
    for (const p of live) { phys.remove(p.body); scene.remove(p.mesh); if (p.own) p.mesh.material.dispose(); }
    live.length = 0;
  }

  return { spawn, fromMesh, update, clear, get count() { return live.length; } };
}
