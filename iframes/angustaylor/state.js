// Shared mutable game state, plus localStorage persistence that never throws.

const KEYS = { best: 'angusDodgeBest', wallet: 'angusWallet', settings: 'angusSettings', seen: 'angusSeenHelp' };

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : raw;
    } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, String(value)); } catch { /* private mode or quota: ignore */ } },
};

function readJson(key, fallback) {
  try { return { ...fallback, ...JSON.parse(store.get(key, '{}')) }; } catch { return { ...fallback }; }
}

export const loadBest = () => Number(store.get(KEYS.best, 0)) || 0;
export const saveBest = (v) => store.set(KEYS.best, v);

/** Wallet: tax cuts carried between runs, what you own and what you are wearing. */
export const W = readJson(KEYS.wallet, { coins: 0, owned: {}, equipped: {} });
export const saveWallet = () => store.set(KEYS.wallet, JSON.stringify(W));

/** Player settings. reduceMotion defaults to the OS preference. */
const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const settings = readJson(KEYS.settings, { sfx: true, music: true, shake: !prefersReduced, glass: false, rain: true });   // glass: drops on the window. rain: rain in the world and the wet floor
export const saveSettings = () => store.set(KEYS.settings, JSON.stringify(settings));
// One-time migration: window drops used to be on by default and softened the picture, so they are off for everyone now (still a toggle in Settings).
if (store.get('angusDropsOffV1', '') !== '1') { settings.glass = false; store.set('angusDropsOffV1', '1'); saveSettings(); }

export const helpSeen = () => store.get(KEYS.seen, '') === '1';
export const markHelpSeen = () => store.set(KEYS.seen, '1');

export const S = {
  mode: 'loading',          // loading | menu | playing | paused | dying | over
  time: 0, speed: 14, dist: 0,
  taxCuts: 0, cutScore: 0, streak: 0, bestStreak: 0, mult: 1,
  lives: 3,
  lane: 1, vx: 0, y: 0, vy: 0, onGround: true, airT: 0, fastFalling: false,
  invuln: 0, shake: 0, hitStop: 0, runT: 0, slow: 1, recovery: 0,
  rowTimer: 0, sceneryTimer: 0, nextBossDist: 180, bossCount: 0,
  thrown: 0, tapeLeft: 0, throwDir: 1, throwAir: 0, noSpin: false,
  budgetT: 0, cutT: 0, shield: 0, glance: 0, wasAir: false, settle: 0, recover: 0,
  jumpBufferT: 0, laneBuffer: 0, laneBufferDir: 0,
  hitBy: '', best: loadBest(), overAt: 0, newBest: false,
};
