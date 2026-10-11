// Tuning, characters and shop items. Everything you would want to balance lives here.

export const LANES = [-2.4, 0, 2.4];
export const SPAWN_Z = -95;
export const DESPAWN_Z = 9;

/** Movement physics. Jumps rise slowly and fall fast, which feels snappier than a symmetric arc. */
export const PHYS = {
  gravityUp: 27,
  gravityDown: 48,
  jumpHeight: 4.7,           // high enough to clear a boss
  fastFall: -30,             // vertical speed while holding down in the air
  laneOmega: 24,             // lane-change spring stiffness (critically damped)
  jumpBuffer: 0.13,          // seconds a jump press is remembered before landing
  laneBuffer: 0.16,          // same for a lane change pressed during a toss
  hitInvuln: 1.6,
  playerHeight: 2.9,
  playerHalfW: 0.26,
  playerHalfD: 0.2,
};
export const JUMP_V = Math.sqrt(2 * PHYS.gravityUp * PHYS.jumpHeight);

/** Difficulty ramp. speed eases from START to MAX; rows are spaced by distance but never closer than MIN_GAP seconds. */
export const RUN = { startSpeed: 14, maxSpeed: 34, rampTime: 75, minRowGap: 0.66 };

export const BUDGET_AT = 200;     // tax cuts in ONE run that trigger the budget
export const BUDGET_SECS = 30;
export const SKIN_FALLBACK = 0xd9a07c;

/**
 * The three characters. `face` is a baked portrait (soft-edged RGBA, see faces/README.md).
 * skin / hair colours were sampled from the portraits so the hands, neck and back of the head match.
 * noseX / noseY place the 3D nose bump on the head (-1..1 across the face; y up).
 */
export const CHARACTERS = {
  ANGUS: {
    id: 'ANGUS', name: 'Angus Taylah', label: 'MP ANGUS',
    face: 'faces/angus.webp', skin: 0xd78f74, hair: { color: 0x4a4638, style: 'short' }, noseX: 0.0, noseY: -0.3, headScale: 1.35,
    outfit: { pants: 0x2b2f3a, shirt: 0xc4dcf2, tie: 0x1f3f8f, flapTie: true, briefcase: true },
  },
  ALBO: {
    id: 'ALBO', name: 'PM Albo', label: 'PM ALBO',
    face: 'faces/albo.webp', skin: 0xc7937e, hair: { color: 0x7d7d76, style: 'short' }, noseX: -0.07, noseY: -0.2, headScale: 1.45, scale: 1.15,
    outfit: { suit: 0x3d4a5c, pants: 0x2a2f3a, tie: 0xc0392b, mic: true },
  },
  HANSON: {
    id: 'HANSON', name: 'Sen. Hanson', label: 'SEN. HANSON',
    face: 'faces/hanson.webp', skin: 0xcf916a, hair: { color: 0x6e2612, style: 'bob' }, noseX: -0.1, noseY: -0.22, headScale: 1.45, scale: 1.15,
    outfit: { suit: 0x9b2f4f, pants: 0x4a2530, tie: 0x222222, mic: true },
  },
};
export const BOSS_ORDER = ['ALBO', 'HANSON'];

export const ITEMS = [   // placeholder prices: change freely
  { id: 'tag', name: '"Great job, well done Angus" speech bubble', price: 20 },
  { id: 'balloon', name: 'Liberal party balloon', price: 50 },
  { id: 'tape', name: 'Angus covered in red tape', price: 100 },
  { id: 'cap', name: 'Blue campaign cap', price: 30, slots: ['head'] },
  { id: 'hivis', name: 'Hi-vis vest & hard hat', price: 60, slots: ['head', 'body'] },
  { id: 'sash', name: 'Opposition leader sash', price: 80, slots: ['body'] },
  { id: 'cape', name: 'Free-market cape', price: 120, slots: ['back'] },
  { id: 'megaphone', name: 'Campaign megaphone', price: 40, slots: ['rhand'] },
  { id: 'scissors', name: 'Giant red-tape scissors', price: 90, slots: ['rhand'] },
  { id: 'sausage', name: 'Democracy sausage', price: 25, slots: ['lhand'] },
  { id: 'sign', name: '"Vote 1" campaign sign', price: 40, slots: ['lhand'] },
];
