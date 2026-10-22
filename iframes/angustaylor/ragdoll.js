// A physics ragdoll for any person built by person.js.
//
// The body is 11 rigid bodies (pelvis, torso, head, two upper arms, two forearms, two thighs, two shins) joined by
// ball-and-socket joints with swing and twist limits, and hinges with angle ranges at the knees and elbows (so
// knees fold the right way and nothing bends backwards). It starts from whatever pose the person is in, carries
// that pose's momentum, and is then thrown, tumbles, hits the road and skids along it (the road is a conveyor, see physics.js).
// Every frame `apply()` writes the bodies' orientations back onto the person's joints, so the same mesh just goes limp.
import { THREE } from './gfx.js';
import { Body, Joint } from './physics.js';

const { Vector3: V3, Quaternion: Q4 } = THREE;

const J = ['legL', 'legR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'armL', 'armR', 'elbowL', 'elbowR', 'spine', 'head'];

// shape of every segment, in person-local units (a person is ~2.9 tall before its own scale)
// `at`: where the body's centre is, relative to the joint group that drives it (in that group's own axes)
const SEG = {
  pelvis: { group: null, at: [0, 1.12, 0], box: [0.23, 0.17, 0.15], mass: 9 },
  torso: { group: 'spine', at: [0, 0.5, 0], box: [0.33, 0.5, 0.17], mass: 15 },
  head: { group: 'head', at: [0, 0, 0], sphere: 0.34, mass: 5.5 },
  armL: { group: 'armL', at: [0, -0.285, 0], cap: [0.085, 0.2], mass: 2.2 },
  armR: { group: 'armR', at: [0, -0.285, 0], cap: [0.085, 0.2], mass: 2.2 },
  foreL: { group: 'elbowL', at: [0, -0.34, 0], cap: [0.075, 0.26], mass: 1.8 },
  foreR: { group: 'elbowR', at: [0, -0.34, 0], cap: [0.075, 0.26], mass: 1.8 },
  thighL: { group: 'legL', at: [0, -0.255, 0], cap: [0.115, 0.15], mass: 6 },
  thighR: { group: 'legR', at: [0, -0.255, 0], cap: [0.115, 0.15], mass: 6 },
  shinL: { group: 'kneeL', at: [0, -0.28, 0], cap: [0.09, 0.2], mass: 3.6 },
  shinR: { group: 'kneeR', at: [0, -0.28, 0], cap: [0.09, 0.2], mass: 3.6 },
};

export function createRagdoll(person, world, { gravityScale = 1 } = {}) {
  const s = person.scale.x;
  const named = {};
  for (const n of J) named[n] = person.getObjectByName(n);
  const head = named.head;
  const headS = head.scale.x;
  const bodies = {};
  const joints = [];
  const v = (a) => new V3(a[0] * s, a[1] * s, a[2] * s);

  function makeBody(name, seg) {
    let shape;
    if (seg.box) shape = { type: 'box', hx: seg.box[0] * s, hy: seg.box[1] * s, hz: seg.box[2] * s };
    else if (seg.sphere) shape = { type: 'sphere', r: seg.sphere * headS * s * 0.95 };
    else shape = { type: 'capsule', r: seg.cap[0] * s, hh: seg.cap[1] * s };
    const b = new Body(shape, seg.mass * s * s * s * 0.55, { restitution: 0.18, friction: 0.85, linDamp: 0.04, angDamp: 0.5, gravityScale, group: 77, noBodyContacts: false });
    b.userData.seg = name;
    b.noSleep = true;
    bodies[name] = b;
    return b;
  }
  for (const [n, seg] of Object.entries(SEG)) makeBody(n, seg);

  // where the head's centre sits relative to the neck base (torso top), for the joint anchor
  const headCentreY = 2.26 + 0.33 * headS;   // person-local, as built in person.js
  const X = new V3(1, 0, 0), Zv = new V3(0, 0, 1), Yd = new V3(0, -1, 0);
  const ball = (a, b, ra, rb, swing, lo, hi, axisA, axisB) => joints.push(new Joint(bodies[a], bodies[b], { type: 'ball', ra: v(ra), rb: v(rb), axisA: axisA ?? Yd, axisB: axisB ?? Yd, swing, lo, hi, refA: X, refB: X }));
  const hinge = (a, b, ra, rb, lo, hi) => joints.push(new Joint(bodies[a], bodies[b], { type: 'hinge', ra: v(ra), rb: v(rb), axisA: X, axisB: X, refA: Zv, refB: Zv, lo, hi }));

  const UP = new V3(0, 1, 0);
  ball('pelvis', 'torso', [0, 0.18, 0], [0, -0.5, 0], 0.55, -0.55, 0.55, UP, UP);                 // the spine
  ball('torso', 'head', [0, 0.5, 0], [0, 2.3 - headCentreY, 0], 0.75, -1.0, 1.0, UP, UP);       // the neck
  for (const k of ['L', 'R']) {
    const sx = k === 'L' ? -1 : 1;
    ball('torso', 'arm' + k, [sx * 0.37, 0.35, 0], [0, 0.285, 0], 2.3, -1.3, 1.3);               // shoulders
    hinge('arm' + k, 'fore' + k, [0, -0.285, 0], [0, 0.34, 0], -2.5, 0.08);                      // elbows fold forwards only
    ball('pelvis', 'thigh' + k, [sx * 0.14, -0.1, 0], [0, 0.255, 0], 1.6, -0.9, 0.9);            // hips
    hinge('thigh' + k, 'shin' + k, [0, -0.255, 0], [0, 0.28, 0], 0.0, 2.55);                     // knees fold backwards only
  }

  const qa = new Q4(), qb = new Q4(), tmp = new V3(), tq = new Q4();
  const wp = new V3(), wq = new Q4();
  let active = false;
  const snap = {};   // joint name -> quaternion at the moment it was released (for blending back)

  /** Put every body where the person's joints are right now, carrying `vel` (world velocity of the whole person). */
  function start(vel = new V3()) {
    person.updateMatrixWorld(true);
    const rootQ = person.getWorldQuaternion(new Q4());
    const rootP = person.getWorldPosition(new V3());
    for (const [n, seg] of Object.entries(SEG)) {
      const b = bodies[n];
      if (seg.group === null) { b.quat.copy(rootQ); b.pos.copy(rootP); }
      else { const g = named[seg.group]; g.getWorldQuaternion(b.quat); g.getWorldPosition(b.pos); }
      b.pos.add(tmp.set(seg.at[0] * s, seg.at[1] * s, seg.at[2] * s).applyQuaternion(b.quat));
      b.vel.copy(vel);
      b.omega.set(0, 0, 0);
      b.prevPos.copy(b.pos); b.prevQuat.copy(b.quat);
      b.asleep = false; b.sleepT = 0;
      world.add(b);
    }
    for (const j of joints) world.addJoint(j);
    active = true;
  }

  function stop() {
    if (!active) return;
    for (const b of Object.values(bodies)) world.remove(b);
    for (const j of joints) { const i = world.joints.indexOf(j); if (i >= 0) world.joints.splice(i, 1); }
    active = false;
  }

  /** Write the bodies' orientations onto the person's joints (and the root). */
  function apply() {
    if (!active) return;
    const B = bodies;
    // root = pelvis
    person.quaternion.copy(B.pelvis.quat);
    person.position.copy(B.pelvis.pos).sub(tmp.set(0, 1.12 * s, 0).applyQuaternion(B.pelvis.quat));
    const rel = (joint, parentQ, childQ) => { tq.copy(parentQ).invert().multiply(childQ); joint.quaternion.copy(tq); };
    rel(named.spine, B.pelvis.quat, B.torso.quat);
    rel(named.head, B.torso.quat, B.head.quat);
    rel(named.armL, B.torso.quat, B.armL.quat); rel(named.armR, B.torso.quat, B.armR.quat);
    rel(named.elbowL, B.armL.quat, B.foreL.quat); rel(named.elbowR, B.armR.quat, B.foreR.quat);
    rel(named.legL, B.pelvis.quat, B.thighL.quat); rel(named.legR, B.pelvis.quat, B.thighR.quat);
    rel(named.kneeL, B.thighL.quat, B.shinL.quat); rel(named.kneeR, B.thighR.quat, B.shinR.quat);
    // feet: let the ankles hang slightly limp
    named.ankleL.rotation.x *= 0.9; named.ankleR.rotation.x *= 0.9;
  }

  /** Remember the ragdoll pose, then ease every joint back into the animated one over `t` seconds (see blend()). */
  function release() {
    for (const n of J) snap[n] = named[n].quaternion.clone();
    snap.rootQ = person.quaternion.clone();
    snap.rootP = person.position.clone();
    stop();
  }
  /** After release(): k 0..1 moves from the remembered pose to the one the animation system has just written. */
  function blend(k) {
    for (const n of J) { tq.copy(named[n].quaternion); named[n].quaternion.copy(snap[n]).slerp(tq, k); }
    person.quaternion.copy(snap.rootQ).slerp(person.quaternion.clone(), k);
    person.position.lerpVectors(snap.rootP, person.position.clone(), k);
  }

  /** every joint back to neutral (before the animation system writes its own rotations onto them) */
  function resetJoints() { for (const n of J) named[n].quaternion.identity(); }

  return {
    bodies, joints, start, stop, apply, release, blend, resetJoints,
    get active() { return active; },
    /** The pelvis, for following with a camera. */
    get centre() { return bodies.pelvis.pos; },
    /** the whole thing's average velocity */
    avgVel(out = new V3()) { out.set(0, 0, 0); let m = 0; for (const b of Object.values(bodies)) { out.addScaledVector(b.vel, b.mass); m += b.mass; } return out.multiplyScalar(1 / m); },
    /** Throw the whole body: `vel` for everything, plus tumble about `spinAxis` at `spin` rad/s, plus a different kick for each limb. */
    launch(vel, spinAxis, spin, flail = 6) {
      // a rigid spin about the centre of mass: every body also gets the linear velocity w x r of its place on the spinning whole
      const com = new V3();
      let m = 0;
      for (const b of Object.values(bodies)) { com.addScaledVector(b.pos, b.mass); m += b.mass; }
      com.multiplyScalar(1 / m);
      const w = spinAxis.clone().multiplyScalar(spin), r = new V3(), wr = new V3();
      for (const b of Object.values(bodies)) {
        r.copy(b.pos).sub(com);
        wr.crossVectors(w, r);
        b.vel.add(vel).add(wr);
        b.omega.copy(w);
        b.omega.x += (Math.random() - 0.5) * flail; b.omega.y += (Math.random() - 0.5) * flail; b.omega.z += (Math.random() - 0.5) * flail;
      }
      // the limbs lag behind the torso as it is flung: add a small opposite kick to hands and feet
      for (const n of ['foreL', 'foreR', 'shinL', 'shinR']) bodies[n].vel.addScaledVector(vel, -0.12);
    },
    /** Hit the body at a world point (a big impulse is a punch, a blast spreads it over the body: see World.blast). */
    impulse(imp, point, name = 'torso') { world.impulseAt(bodies[name], imp, point); },
  };
}
