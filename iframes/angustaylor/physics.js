// A small rigid-body physics engine (XPBD: "Detailed Rigid Body Simulation with Extended Position Based Dynamics").
//
// Bodies are boxes, spheres and capsules with real mass and inertia. Every step is split into sub-steps; in each one
// bodies are integrated, contacts (ground and body-vs-body) and joints are solved on positions, velocities are rebuilt
// from the position change, then restitution and Coulomb friction are applied. Joints are ball-and-socket (with a swing
// cone and twist limits) or hinges (with an angle range), which is all a ragdoll needs.
//
// The road is a moving conveyor: `world.groundVel` is how fast it slides under everything, so friction drags debris along
// it the way a real surface would, and the air moves with it (`airVel`) so light things flutter relative to the wind.
//
// Nothing here touches the scene. Give a body a `mesh` and call world.sync() to copy transforms across.
import { THREE } from './gfx.js';

const { Vector3: V3, Quaternion: Q4 } = THREE;

const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _e = new V3(), _f = new V3();
const _ra = new V3(), _rb = new V3(), _n = new V3(), _t = new V3(), _p = new V3(), _w = new V3();
const _q = new Q4();
const _ap1 = new V3(), _ap2 = new V3(), _ap3 = new V3(), _ar1 = new V3(), _ar2 = new V3();
const _sc1 = new V3(), _sc2 = new V3();
const _sv1 = new V3(), _sv2 = new V3(), _sv3 = new V3(), _sv4 = new V3(), _sv5 = new V3(), _sv6 = new V3();
const _j1 = new V3(), _j2 = new V3(), _j3 = new V3(), _j4 = new V3(), _l1 = new V3(), _l2 = new V3(), _l3 = new V3();
const _gx = new V3(), _gq = new Q4();
const _q1 = new V3(), _q2 = new V3(), _q3 = new V3(), _q4 = new V3(), _qa = new V3(), _qb = new V3(), _s1 = new V3(), _s2 = new V3(), _s3 = new V3();

/** closest point to p on the segment a-b */
function segPointClosest(a, b, p, out) {
  _s1.copy(b).sub(a);
  const l2 = _s1.lengthSq();
  const t = l2 > 1e-12 ? Math.max(0, Math.min(1, _s2.copy(p).sub(a).dot(_s1) / l2)) : 0;
  return out.copy(a).addScaledVector(_s1, t);
}
/** closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection) */
function segSegClosest(p1, q1, p2, q2, c1, c2) {
  const d1 = _s1.copy(q1).sub(p1), d2 = _s2.copy(q2).sub(p2), r = _s3.copy(p1).sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) { c1.copy(p1); c2.copy(p2); return; }
  if (a <= 1e-9) { s = 0; t = Math.max(0, Math.min(1, f / e)); }
  else {
    const c = d1.dot(r);
    if (e <= 1e-9) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
    else {
      const b = d1.dot(d2), denom = a * e - b * b;
      s = denom > 1e-9 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); } else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  c1.copy(p1).addScaledVector(d1, s); c2.copy(p2).addScaledVector(d2, t);
}

/** Generalised inverse mass of a body at offset r along the unit direction n: 1/m + (r x n)^T I^-1 (r x n). */
function genInvMass(b, r, n) {
  if (b.invMass === 0) return 0;
  _gx.copy(r).cross(n);
  const q = b.quat;
  _gq.set(-q.x, -q.y, -q.z, q.w);
  _gx.applyQuaternion(_gq);
  return b.invMass + _gx.x * _gx.x * b.invI.x + _gx.y * _gx.y * b.invI.y + _gx.z * _gx.z * b.invI.z;
}

/** q += 0.5 * (w, 0) * q, then renormalise: rotate q by the world-space rotation vector (wx, wy, wz). */
function rotateQ(q, wx, wy, wz) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  q.x += 0.5 * (w * wx + wy * z - wz * y);
  q.y += 0.5 * (w * wy + wz * x - wx * z);
  q.z += 0.5 * (w * wz + wx * y - wy * x);
  q.w += 0.5 * -(wx * x + wy * y + wz * z);
  q.normalize();
}

export class Body {
  /**
   * shape: { type: 'box', hx, hy, hz } (half extents), { type: 'sphere', r } or { type: 'capsule', r, hh } (hh: half length of the straight part along local y).
   * mass 0 makes a static body.
   */
  constructor(shape, mass, o = {}) {
    this.shape = shape;
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.pos = new V3();
    this.quat = new Q4();
    this.prevPos = new V3();
    this.prevQuat = new Q4();
    this.vel = new V3();
    this.omega = new V3();
    this.restitution = o.restitution ?? 0.3;
    this.friction = o.friction ?? 0.6;
    this.linDamp = o.linDamp ?? 0.05;
    this.angDamp = o.angDamp ?? 0.1;
    this.gravityScale = o.gravityScale ?? 1;
    this.group = o.group ?? 0;         // bodies sharing a non-zero group never collide with each other (a ragdoll's limbs)
    this.noBodyContacts = !!o.noBodyContacts;   // collides with the ground only
    this.aero = o.aero ?? 0;           // > 0: a flat sheet whose local y is its normal; pushed by the air like paper
    this.aeroArea = o.aeroArea ?? 0;
    this.mesh = null;
    this.userData = {};
    this.age = 0;
    this.asleep = false;
    this.sleepT = 0;
    this.radius = 0;                   // bounding radius, for the broad phase
    this.invI = new V3();              // principal inverse inertia, in local space
    this.setShape(shape);
  }

  setShape(shape) {
    this.shape = shape;
    const m = this.mass;
    let ix, iy, iz;
    if (shape.type === 'box') {
      const { hx, hy, hz } = shape;
      ix = (m / 3) * (hy * hy + hz * hz); iy = (m / 3) * (hx * hx + hz * hz); iz = (m / 3) * (hx * hx + hy * hy);
      this.radius = Math.hypot(hx, hy, hz);
    } else if (shape.type === 'sphere') {
      ix = iy = iz = 0.4 * m * shape.r * shape.r;
      this.radius = shape.r;
    } else {   // capsule: treated as a box for inertia
      const hx = shape.r, hy = shape.hh + shape.r;
      ix = iz = (m / 3) * (hx * hx + hy * hy) * 0.8; iy = (m / 3) * (2 * hx * hx) * 0.8;
      this.radius = shape.hh + shape.r;
    }
    this.invI.set(m > 0 ? 1 / ix : 0, m > 0 ? 1 / iy : 0, m > 0 ? 1 / iz : 0);
  }

  /** out = world-space inverse inertia * v */
  invIApply(v, out) {
    const q = this.quat;
    _q.set(-q.x, -q.y, -q.z, q.w);
    out.copy(v).applyQuaternion(_q);
    out.x *= this.invI.x; out.y *= this.invI.y; out.z *= this.invI.z;
    return out.applyQuaternion(q);
  }
  /** n^T * I^-1 * n for a unit n */
  invIDot(n) {
    const q = this.quat;
    _q.set(-q.x, -q.y, -q.z, q.w);
    _w.copy(n).applyQuaternion(_q);
    return _w.x * _w.x * this.invI.x + _w.y * _w.y * this.invI.y + _w.z * _w.z * this.invI.z;
  }
  toWorld(local, out) { return out.copy(local).applyQuaternion(this.quat).add(this.pos); }
  /** velocity of the material point at world offset r from the centre */
  pointVel(r, out) { return out.copy(this.omega).cross(r).add(this.vel); }
}

class Contact {
  constructor() {
    this.a = null; this.b = null;
    this.ra = new V3(); this.rb = new V3();   // anchors in the bodies' local spaces (b null: world point)
    this.n = new V3();                        // points from b towards a
    this.depth = 0; this.vn0 = 0; this.lambda = 0;
  }
}

export class Joint {
  /**
   * type 'ball': swing cone (half angle `swing`) between axisA (in a) and axisB (in b), plus a twist range about that axis using refA/refB.
   * type 'hinge': rotates about axisA/axisB (kept aligned), angle between refA and refB limited to [lo, hi].
   */
  constructor(a, b, o) {
    this.a = a; this.b = b;
    this.ra = o.ra.clone(); this.rb = o.rb.clone();
    this.type = o.type ?? 'ball';
    this.axisA = (o.axisA ?? new V3(0, -1, 0)).clone().normalize();
    this.axisB = (o.axisB ?? new V3(0, -1, 0)).clone().normalize();
    this.refA = (o.refA ?? new V3(1, 0, 0)).clone().normalize();
    this.refB = (o.refB ?? new V3(1, 0, 0)).clone().normalize();
    this.swing = o.swing ?? Math.PI;
    this.lo = o.lo ?? -Math.PI; this.hi = o.hi ?? Math.PI;   // twist range (ball) or hinge range
    this.stiff = o.stiff ?? 1;
    this.drive = null;   // optional: { target: Quaternion (b relative to a), k }: a soft angular spring (a muscle)
  }
}

export class World {
  constructor() {
    this.gravity = new V3(0, -20, 0);
    this.groundVel = new V3();
    this.airVel = new V3();
    this.groundY = 0;
    this.bodies = [];
    this.joints = [];
    this.contacts = [];
    this.nContacts = 0;
    this.targetStep = 1 / 240;
    this.maxSub = 8;
    this.jointIters = 2;
    this.time = 0;
    this.turbulence = 0;   // gusts that shake light, flat things
  }

  add(body, mesh) { if (mesh) body.mesh = mesh; this.bodies.push(body); return body; }
  remove(body) { const i = this.bodies.indexOf(body); if (i >= 0) this.bodies.splice(i, 1); }
  addJoint(j) { this.joints.push(j); return j; }
  clear() { this.bodies.length = 0; this.joints.length = 0; this.nContacts = 0; }

  /** Push everything within `radius` of `at` away with `impulse` (a velocity change at the centre for a unit mass, scaled by 1/(1+d²)); lever off-centre so things spin. */
  blast(at, radius, impulse, lever = 0.6) {
    for (const b of this.bodies) {
      if (b.invMass === 0) continue;
      _a.copy(b.pos).sub(at);
      const d = _a.length();
      if (d > radius) continue;
      const fall = 1 - d / radius;
      _a.multiplyScalar(1 / Math.max(d, 0.05));
      const mag = impulse * fall * fall * (1 + 0.3 * (Math.random() - 0.5));
      b.asleep = false; b.sleepT = 0;
      b.vel.addScaledVector(_a, mag);
      b.vel.y += mag * 0.35;
      // an off-centre push: a random lever arm turns it into spin
      _b.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(lever * Math.max(0.3, b.radius));
      _c.copy(_a).multiplyScalar(mag * b.mass);
      _d.copy(_b).cross(_c);
      b.invIApply(_d, _e);
      b.omega.add(_e);
    }
  }

  /** Apply an impulse (momentum change) at a world point. */
  impulseAt(b, imp, point) {
    if (b.invMass === 0) return;
    b.asleep = false;
    b.vel.addScaledVector(imp, b.invMass);
    _a.copy(point).sub(b.pos).cross(imp);
    b.invIApply(_a, _b);
    b.omega.add(_b);
  }

  step(dt) {
    if (dt <= 0) return;
    const n = Math.max(1, Math.min(this.maxSub, Math.ceil(dt / this.targetStep)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h);
    this.time += dt;
  }

  substep(h) {
    const g = this.gravity, bodies = this.bodies;
    const gv = this.groundVel;
    // --- integrate
    for (const b of bodies) {
      if (b.invMass === 0) continue;
      b.age += h;
      if (b.asleep) {   // resting on the road: it rides along with it
        b.pos.addScaledVector(gv, h);
        b.prevPos.copy(b.pos); b.prevQuat.copy(b.quat);
        continue;
      }
      b.prevPos.copy(b.pos);
      b.prevQuat.copy(b.quat);
      b.vel.addScaledVector(g, h * b.gravityScale);
      if (b.aero > 0) this.aeroForce(b, h);
      const ld = Math.max(0, 1 - b.linDamp * h);
      b.vel.multiplyScalar(ld);
      b.omega.multiplyScalar(Math.max(0, 1 - b.angDamp * h));
      b.pos.addScaledVector(b.vel, h);
      rotateQ(b.quat, b.omega.x * h, b.omega.y * h, b.omega.z * h);
    }

    // --- contacts, detected on the predicted positions
    this.nContacts = 0;
    this.collideGround();
    this.collideBodies();

    // --- joints, then contacts, on positions
    for (let it = 0; it < this.jointIters; it++) for (const j of this.joints) this.solveJoint(j, h);
    for (let i = 0; i < this.nContacts; i++) this.solveContact(this.contacts[i]);

    // --- velocities from the position change
    for (const b of bodies) {
      if (b.invMass === 0 || b.asleep) continue;
      b.vel.copy(b.pos).sub(b.prevPos).multiplyScalar(1 / h);
      _q.copy(b.prevQuat).invert();
      _q.premultiply(b.quat);   // dq = q * prevQ^-1
      const s = _q.w < 0 ? -2 / h : 2 / h;
      b.omega.set(_q.x * s, _q.y * s, _q.z * s);
    }

    // --- restitution and friction
    for (let i = 0; i < this.nContacts; i++) this.solveVelocity(this.contacts[i], h);
    for (const j of this.joints) if (j.drive) this.driveJoint(j, h);

    // --- sleeping on the road
    for (const b of bodies) {
      if (b.invMass === 0 || b.asleep || b.noSleep) continue;
      _a.copy(b.vel).sub(gv);
      if (_a.lengthSq() < 0.12 && b.omega.lengthSq() < 0.6 && b.pos.y - b.radius < this.groundY + 0.35 * Math.max(0.05, b.radius)) b.sleepT += h; else b.sleepT = 0;
      if (b.sleepT > 0.35) { b.asleep = true; b.vel.copy(gv); b.omega.set(0, 0, 0); }
    }
  }

  /** Flat sheets (paper, tape, cloth scraps): drag on the face, so they flutter and glide, plus gusts. */
  aeroForce(b, h) {
    _a.copy(b.vel).sub(this.airVel);
    _n.set(0, 1, 0).applyQuaternion(b.quat);
    const vn = _a.dot(_n);
    const k = b.aero * (b.aeroArea || 1) / b.mass;
    // normal drag (quadratic) and a little skin friction along the face
    b.vel.addScaledVector(_n, -k * vn * Math.abs(vn) * h);
    _b.copy(_a).addScaledVector(_n, -vn);
    b.vel.addScaledVector(_b, -0.15 * k * h);
    // the centre of pressure trails behind: a fluttering torque that turns the sheet to face the airflow
    _c.copy(_n).cross(_a).multiplyScalar(k * 0.9 * Math.sign(vn || 1));
    b.omega.addScaledVector(_c, h * 0.8);
    b.omega.multiplyScalar(Math.max(0, 1 - 1.6 * h));
    if (this.turbulence > 0) {
      const t = this.time * 9 + b.pos.x * 1.7 + b.pos.z * 1.3;
      b.vel.x += Math.sin(t * 1.3 + b.pos.y) * this.turbulence * h;
      b.vel.y += Math.sin(t * 0.9 + b.pos.x * 2.1) * this.turbulence * 0.6 * h;
      b.vel.z += Math.cos(t * 1.1 + b.pos.y * 1.9) * this.turbulence * h;
    }
  }

  newContact() {
    if (this.nContacts >= this.contacts.length) this.contacts.push(new Contact());
    return this.contacts[this.nContacts++];
  }

  /** Record a contact. point: world point on a; n: from b to a; depth > 0. */
  addContact(a, b, point, n, depth) {
    const c = this.newContact();
    c.a = a; c.b = b;
    c.n.copy(n);
    c.depth = depth;
    c.lambda = 0;
    _ra.copy(point).sub(a.pos);
    _q.set(-a.quat.x, -a.quat.y, -a.quat.z, a.quat.w);
    c.ra.copy(_ra).applyQuaternion(_q);
    if (b) {
      _rb.copy(point).addScaledVector(n, depth).sub(b.pos);   // the matching point on b, on its surface
      _q.set(-b.quat.x, -b.quat.y, -b.quat.z, b.quat.w);
      c.rb.copy(_rb).applyQuaternion(_q);
    }
    // approach speed along the normal before the solve (for restitution)
    a.pointVel(_ra, _a);
    if (b) { b.pointVel(_rb, _b); _a.sub(_b); }
    c.vn0 = _a.dot(n);
  }

  collideGround() {
    const gy = this.groundY;
    for (const b of this.bodies) {
      if (b.invMass === 0 || b.asleep) continue;
      const s = b.shape;
      if (b.pos.y - b.radius > gy + 0.02) continue;
      _n.set(0, 1, 0);
      if (s.type === 'sphere') {
        const d = gy - (b.pos.y - s.r);
        if (d > 0) this.addContact(b, null, _p.set(b.pos.x, gy, b.pos.z), _n, d);
      } else if (s.type === 'capsule') {
        for (const sg of [-1, 1]) {
          _c.set(0, sg * s.hh, 0).applyQuaternion(b.quat).add(b.pos);
          const d = gy - (_c.y - s.r);
          if (d > 0) this.addContact(b, null, _p.set(_c.x, gy, _c.z), _n, d);
        }
      } else {
        for (let i = 0; i < 8; i++) {
          _c.set(i & 1 ? s.hx : -s.hx, i & 2 ? s.hy : -s.hy, i & 4 ? s.hz : -s.hz).applyQuaternion(b.quat).add(b.pos);
          const d = gy - _c.y;
          if (d > 0) this.addContact(b, null, _c, _n, d);
        }
      }
    }
  }

  collideBodies() {
    const bs = this.bodies, N = bs.length;
    for (let i = 0; i < N; i++) {
      const A = bs[i];
      if (A.noBodyContacts) continue;
      for (let j = i + 1; j < N; j++) {
        const B = bs[j];
        if (B.noBodyContacts) continue;
        if (A.invMass === 0 && B.invMass === 0) continue;
        if (A.group && A.group === B.group) continue;
        if (A.asleep && B.asleep) continue;
        const dx = A.pos.x - B.pos.x, dy = A.pos.y - B.pos.y, dz = A.pos.z - B.pos.z, rr = A.radius + B.radius;
        if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
        const sa = A.shape.type, sb = B.shape.type;
        if (sa === 'sphere' && sb === 'sphere') this.sphereSphere(A, B);
        else if (sa === 'box' && sb === 'box') { this.boxVerts(A, B); this.boxVerts(B, A); }
        else if (sa === 'sphere' && sb === 'box') this.sphereBox(A, B);
        else if (sa === 'box' && sb === 'sphere') this.sphereBox(B, A);
        else if (sa === 'capsule' || sb === 'capsule') this.capsuleVs(A, B);
      }
    }
  }

  sphereSphere(A, B) {
    _n.copy(A.pos).sub(B.pos);
    const d = _n.length(), pen = A.shape.r + B.shape.r - d;
    if (pen <= 0) return;
    if (d < 1e-6) _n.set(0, 1, 0); else _n.multiplyScalar(1 / d);
    _p.copy(A.pos).addScaledVector(_n, -A.shape.r);
    this.addContact(A, B, _p, _n, pen);
  }

  /** closest point of box B to the sphere A's centre */
  sphereBox(S, B) {
    _q.set(-B.quat.x, -B.quat.y, -B.quat.z, B.quat.w);
    _c.copy(S.pos).sub(B.pos).applyQuaternion(_q);   // sphere centre in the box's space
    const { hx, hy, hz } = B.shape;
    _d.set(Math.max(-hx, Math.min(hx, _c.x)), Math.max(-hy, Math.min(hy, _c.y)), Math.max(-hz, Math.min(hz, _c.z)));
    _e.copy(_c).sub(_d);
    const dist = _e.length();
    if (dist > S.shape.r || dist < 1e-6) return;   // (centre inside the box: ignored, the faces below catch it next step)
    _n.copy(_e).multiplyScalar(1 / dist).applyQuaternion(B.quat);
    _p.copy(S.pos).addScaledVector(_n, -S.shape.r);
    this.addContact(S, B, _p, _n, S.shape.r - dist);
  }

  /** end points of a capsule's axis, in world space */
  capsuleEnds(b, p0, p1) {
    _c.set(0, b.shape.hh, 0).applyQuaternion(b.quat);
    p0.copy(b.pos).add(_c); p1.copy(b.pos).sub(_c);
  }

  /** a capsule against a sphere, another capsule or a box: spheres swept along its axis */
  capsuleVs(A, B) {
    const ca = A.shape.type === 'capsule', cb = B.shape.type === 'capsule';
    if (ca && cb) {   // the closest points of the two axes
      this.capsuleEnds(A, _q1, _q2); this.capsuleEnds(B, _q3, _q4);
      segSegClosest(_q1, _q2, _q3, _q4, _qa, _qb);
      _n.copy(_qa).sub(_qb);
      const d = _n.length(), pen = A.shape.r + B.shape.r - d;
      if (pen <= 0) return;
      if (d < 1e-6) _n.set(0, 1, 0); else _n.multiplyScalar(1 / d);
      _p.copy(_qa).addScaledVector(_n, -A.shape.r);
      this.addContact(A, B, _p, _n, pen);
      return;
    }
    const cap = ca ? A : B, other = ca ? B : A;
    this.capsuleEnds(cap, _q1, _q2);
    if (other.shape.type === 'sphere') {   // sphere vs the nearest point on the axis
      segPointClosest(_q1, _q2, other.pos, _qa);
      _n.copy(other.pos).sub(_qa);   // from the capsule towards the sphere
      const d = _n.length(), pen = cap.shape.r + other.shape.r - d;
      if (pen <= 0) return;
      if (d < 1e-6) _n.set(0, 1, 0); else _n.multiplyScalar(1 / d);
      if (ca) { _n.multiplyScalar(-1); _p.copy(_qa).addScaledVector(_n, -cap.shape.r); this.addContact(cap, other, _p, _n, pen); }   // a = capsule: n from the sphere to the capsule
      else { _p.copy(other.pos).addScaledVector(_n, -other.shape.r); this.addContact(other, cap, _p, _n, pen); }
      return;
    }
    // a box: test five spheres along the axis against it
    _q.set(-other.quat.x, -other.quat.y, -other.quat.z, other.quat.w);
    const { hx, hy, hz } = other.shape;
    for (let k = 0; k < 5; k++) {
      _qa.lerpVectors(_q1, _q2, k / 4);
      _c.copy(_qa).sub(other.pos).applyQuaternion(_q);
      _d.set(Math.max(-hx, Math.min(hx, _c.x)), Math.max(-hy, Math.min(hy, _c.y)), Math.max(-hz, Math.min(hz, _c.z)));
      _e.copy(_c).sub(_d);
      const dist = _e.length();
      if (dist > cap.shape.r || dist < 1e-6) continue;
      _n.copy(_e).multiplyScalar(1 / dist).applyQuaternion(other.quat);   // from the box towards the capsule
      if (ca) { _p.copy(_qa).addScaledVector(_n, -cap.shape.r); this.addContact(cap, other, _p, _n, cap.shape.r - dist); }
      else { _n.multiplyScalar(-1); _p.copy(other.pos).add(_d.applyQuaternion(other.quat)); this.addContact(other, cap, _p, _n, cap.shape.r - dist); }
    }
  }

  /** Corners of A that are inside B (a contact for each, pushed out along B's nearest face). */
  boxVerts(A, B) {
    const sa = A.shape, sb = B.shape;
    _q.set(-B.quat.x, -B.quat.y, -B.quat.z, B.quat.w);
    for (let i = 0; i < 8; i++) {
      _c.set(i & 1 ? sa.hx : -sa.hx, i & 2 ? sa.hy : -sa.hy, i & 4 ? sa.hz : -sa.hz).applyQuaternion(A.quat).add(A.pos);
      _d.copy(_c).sub(B.pos).applyQuaternion(_q);   // in B's space
      const px = sb.hx - Math.abs(_d.x), py = sb.hy - Math.abs(_d.y), pz = sb.hz - Math.abs(_d.z);
      if (px <= 0 || py <= 0 || pz <= 0) continue;
      // the face it is closest to leaving through
      if (px < py && px < pz) { _n.set(Math.sign(_d.x) || 1, 0, 0); this.pushContact(A, B, _c, px); }
      else if (py < pz) { _n.set(0, Math.sign(_d.y) || 1, 0); this.pushContact(A, B, _c, py); }
      else { _n.set(0, 0, Math.sign(_d.z) || 1); this.pushContact(A, B, _c, pz); }
    }
  }
  pushContact(A, B, point, depth) {   // _n is in B's local space here; A is the body whose vertex penetrates
    _n.applyQuaternion(B.quat);
    this.addContact(A, B, point, _n, depth);
  }

  /** Move a (and b, the opposite way) along the unit vector dir to remove `mag` of error at anchors rA/rB, weighted by generalised inverse mass. Returns the applied impulse size. */
  applyPos(A, B, dir, mag, rA, rB) {
    const w = genInvMass(A, rA, dir) + (B ? genInvMass(B, rB, dir) : 0);
    if (w < 1e-12) return 0;
    const lam = mag / w;
    _ap1.copy(dir).multiplyScalar(lam);
    if (A.invMass > 0) {
      A.pos.addScaledVector(_ap1, A.invMass);
      _ap2.copy(rA).cross(_ap1);
      A.invIApply(_ap2, _ap3);
      rotateQ(A.quat, _ap3.x, _ap3.y, _ap3.z);
    }
    if (B && B.invMass > 0) {
      B.pos.addScaledVector(_ap1, -B.invMass);
      _ap2.copy(rB).cross(_ap1);
      B.invIApply(_ap2, _ap3);
      rotateQ(B.quat, -_ap3.x, -_ap3.y, -_ap3.z);
    }
    return lam;
  }

  /** Rotate a by `theta` (a rotation vector, magnitude = angle) and b the opposite way, weighted by inverse inertia. */
  applyRot(A, B, theta, stiff = 1) {
    const c = theta.length();
    if (c < 1e-9) return;
    _ar1.copy(theta).multiplyScalar(1 / c);
    const wA = A.invMass > 0 ? A.invIDot(_ar1) : 0, wB = B && B.invMass > 0 ? B.invIDot(_ar1) : 0;
    const w = wA + wB;
    if (w < 1e-12) return;
    const lam = (c * stiff) / w;
    if (A.invMass > 0) { A.invIApply(_ar1, _ar2); rotateQ(A.quat, _ar2.x * lam, _ar2.y * lam, _ar2.z * lam); }
    if (B && B.invMass > 0) { B.invIApply(_ar1, _ar2); rotateQ(B.quat, -_ar2.x * lam, -_ar2.y * lam, -_ar2.z * lam); }
  }

  solveContact(c) {
    const A = c.a, B = c.b;
    _ra.copy(c.ra).applyQuaternion(A.quat);
    _sc1.copy(A.pos).add(_ra);   // a's point
    let depth;
    if (B) {
      _rb.copy(c.rb).applyQuaternion(B.quat);
      _sc2.copy(B.pos).add(_rb);   // b's point
      depth = _sc2.sub(_sc1).dot(c.n);   // > 0: a's point has gone inside b
    } else {
      _rb.set(0, 0, 0);
      depth = this.groundY - _sc1.y;
    }
    if (depth <= 0) { c.lambda = 0; return; }
    c.lambda = this.applyPos(A, B, c.n, depth, _ra, _rb);
  }

  /** apply a velocity impulse p (momentum change) at the contact offsets: a gets +p, b gets -p */
  velImpulse(A, B, rA, rB, p) {
    if (A.invMass > 0) { A.vel.addScaledVector(p, A.invMass); _sv1.copy(rA).cross(p); A.invIApply(_sv1, _sv2); A.omega.add(_sv2); }
    if (B && B.invMass > 0) { B.vel.addScaledVector(p, -B.invMass); _sv1.copy(rB).cross(p); B.invIApply(_sv1, _sv2); B.omega.sub(_sv2); }
  }

  solveVelocity(c, h) {
    const A = c.a, B = c.b;
    _ra.copy(c.ra).applyQuaternion(A.quat);
    if (B) _rb.copy(c.rb).applyQuaternion(B.quat); else _rb.set(0, 0, 0);
    A.pointVel(_ra, _sv1);
    if (B) B.pointVel(_rb, _sv2); else _sv2.copy(this.groundVel);
    _sv3.copy(_sv1).sub(_sv2);   // relative velocity at the contact
    const vn = _sv3.dot(c.n);
    // Coulomb friction: stop the sliding, but never push harder than mu times the normal force
    _sv4.copy(_sv3).addScaledVector(c.n, -vn);
    const vt = _sv4.length();
    if (vt > 1e-6 && c.lambda > 0) {
      const mu = B ? Math.sqrt(A.friction * B.friction) : A.friction;
      _sv5.copy(_sv4).multiplyScalar(-1 / vt);
      const w = genInvMass(A, _ra, _sv5) + (B ? genInvMass(B, _rb, _sv5) : 0);
      if (w > 1e-12) {
        const P = Math.min(vt / w, (mu * c.lambda) / h);
        _sv6.copy(_sv5).multiplyScalar(P);
        this.velImpulse(A, B, _ra, _rb, _sv6);
      }
    }
    // restitution: give back a share of the approach speed (not for tiny speeds, or everything would jitter forever)
    A.pointVel(_ra, _sv1);
    if (B) B.pointVel(_rb, _sv2); else _sv2.copy(this.groundVel);
    const vn2 = _sv1.sub(_sv2).dot(c.n);
    const e = B ? Math.min(A.restitution, B.restitution) : A.restitution;
    const thresh = 2 * Math.abs(this.gravity.y) * h;
    const target = c.vn0 < -thresh ? -e * c.vn0 : 0;
    if (vn2 < target) {
      const w = genInvMass(A, _ra, c.n) + (B ? genInvMass(B, _rb, c.n) : 0);
      if (w > 1e-12) { _sv6.copy(c.n).multiplyScalar((target - vn2) / w); this.velImpulse(A, B, _ra, _rb, _sv6); }
    }
    if (!B) A.omega.multiplyScalar(Math.max(0, 1 - 2.2 * h));   // rolling resistance: things on the road stop rolling
  }

  solveJoint(j, h) {
    const A = j.a, B = j.b;
    // anchors together
    _ra.copy(j.ra).applyQuaternion(A.quat);
    _rb.copy(j.rb).applyQuaternion(B.quat);
    _j1.copy(A.pos).add(_ra).sub(B.pos).sub(_rb);   // want zero
    const len = _j1.length();
    if (len > 1e-7) {
      _j1.multiplyScalar(-1 / len);   // a should move towards b
      this.applyPos(A, B, _j1, len * j.stiff, _ra, _rb);
    }
    // axes: after the position fix the bodies have rotated a little, so read them again
    _j2.copy(j.axisA).applyQuaternion(A.quat);
    _j3.copy(j.axisB).applyQuaternion(B.quat);
    if (j.type === 'hinge') {
      _j4.copy(_j2).cross(_j3);   // rotate a so that its axis lines up with b's
      this.applyRot(A, B, _j4, j.stiff);
      _j2.copy(j.axisA).applyQuaternion(A.quat);
      this.limitTwist(j, A, B, _j2);
    } else {
      _j4.copy(_j2).cross(_j3);   // swing cone
      const s = _j4.length();
      if (s > 1e-7) {
        const phi = Math.atan2(s, _j2.dot(_j3));
        if (phi > j.swing) { _j4.multiplyScalar((phi - j.swing) / s); this.applyRot(A, B, _j4, j.stiff); }
      }
      if (j.hi - j.lo < Math.PI * 1.99) {
        _j2.copy(j.axisA).applyQuaternion(A.quat);
        this.limitTwist(j, A, B, _j2);
      }
    }
  }

  /** the angle of refB around the axis, measured from refA, kept inside [lo, hi] */
  limitTwist(j, A, B, axis) {
    _l1.copy(j.refA).applyQuaternion(A.quat);
    _l2.copy(j.refB).applyQuaternion(B.quat);
    // flatten both into the plane perpendicular to the axis
    _l1.addScaledVector(axis, -_l1.dot(axis)); _l2.addScaledVector(axis, -_l2.dot(axis));
    const l1 = _l1.length(), l2 = _l2.length();
    if (l1 < 1e-6 || l2 < 1e-6) return;
    _l1.multiplyScalar(1 / l1); _l2.multiplyScalar(1 / l2);
    const phi = Math.atan2(_l3.copy(_l1).cross(_l2).dot(axis), _l1.dot(_l2));
    if (phi >= j.lo && phi <= j.hi) return;
    const clamped = phi < j.lo ? j.lo : j.hi;
    _l3.copy(axis).multiplyScalar(phi - clamped);   // a turns by the overshoot
    this.applyRot(A, B, _l3, j.stiff);
  }

  /** a soft angular spring pulling b's orientation (relative to a) towards drive.target; strength drive.k in 1/s */
  driveJoint(j, h) {
    const { target, k } = j.drive;
    if (!(k > 0)) return;
    const A = j.a, B = j.b;
    // desired world orientation of b = a.quat * target
    _q.copy(A.quat).multiply(target);
    // error rotation: q_err = desired * b^-1
    const qe = _q.clone().multiply(new Q4(-B.quat.x, -B.quat.y, -B.quat.z, B.quat.w));
    const s = qe.w < 0 ? -2 : 2;
    _f.set(qe.x * s, qe.y * s, qe.z * s);   // rotation vector: how b should turn
    const gain = 1 - Math.exp(-k * h);
    B.omega.addScaledVector(_f, gain / h * 0.5);
    A.omega.addScaledVector(_f, -gain / h * 0.5 * (A.invMass > 0 ? 0.35 : 0));
    B.omega.multiplyScalar(Math.max(0, 1 - 4 * h));
  }

  /** copy body transforms into their meshes */
  sync() {
    for (const b of this.bodies) {
      if (!b.mesh) continue;
      b.mesh.position.copy(b.pos);
      b.mesh.quaternion.copy(b.quat);
    }
  }
}
