// News ticker: satirical headlines that react to what you do.
// Add or change headlines in HEADLINES. Each key is an event; a headline is a string, or a function
// returning a string. The tone is consistently Liberal-friendly satire (jokes land on the Government,
// red tape and taxes), with real events referenced at party level and no quotes about named people.
import { pick } from './gfx.js';

export const HEADLINES = {
  start: [
    "BREAKING: Opposition arrives with a tax cut and a plan; Government reportedly 'checking if that's allowed'",
    "Liberals hit the road for aspiration; red tape braces for impact",
    "Taxpayers told help is on the way, and it's wearing a blue tie",
    "Liberals launch 'no more small target' campaign; the Government confirms it can see it from there",
    "Cost of living: Government has a committee, Opposition has a tax cut; voters 'prefer the one that shows up'",
    "Opposition promises to cut red tape; red tape 'seeking legal advice'",
  ],
  idle: [
    "POLLS: Morgan has the Coalition on 22.5, within four points of first; Government 'not worried', worriedly",
    "MORGAN: Labor 26, One Nation 25.5, Coalition 22.5; a three-horse race, and only one horse has a tax cut",
    "MIGRATION: Opposition unveils plan billed as 'largest cut in history'; spreadsheet reportedly 'very busy'",
    "COSTING: Opposition asks Parliamentary Budget Office to check its sums; the Government's sums 'remain a surprise to everyone'",
    "CPAC: Liberals vow 'no more small target'; Government spotted checking the size of its own",
    "ATO: Opposition demands tax office reverse credit card ban; taxpayers 'would like their points'",
    "TRUSTS: Proposed 30 per cent trust tax; accountants 'cautiously busy', taxpayers 'cautiously unimpressed'",
    "PETROL: Prices, inflation and rate fears pile on pressure; Government unveils committee, Opposition unveils tax cut",
    "RATES: Reserve Bank lifts rates; borrowers 'concerned, with interest', Government 'concerned, with a press release'",
    "COALITION: Liberals and Nationals sit down together; the biscuits are endorsed unanimously",
    "WEATHER: Mostly red tape, with a chance of consultation",
    "FINANCE: Economists agree on one thing: more tax cuts would be nice",
  ],
  taxcut: [
    "Tax cut collected; Government says it's 'looking at it', which is what it says about everything",
    "Another tax cut: Treasury asks how it'll be paid for; Opposition says 'growth', Treasury says 'noted'",
    "TAX CUT: cost to the budget, nothing. Value to voters, considerable",
    "Voter enthusiastically backs tax cut, in a development the Government didn't see coming",
    "Tax cut found on road; Government 'not sure how it got there, but will form a task force'",
  ],
  tc1: ["FIRST TAX CUT: Liberals call it 'the start of the comeback'; pundits 'will be watching, with interest'"],
  tc10: ["TEN TAX CUTS: Opposition calls it 'aspiration', Government calls it 'a lot of numbers'"],
  tc25: ["25 TAX CUTS: Liberals now cutting taxes faster than the Government can announce a review"],
  tc50: ["50 TAX CUTS: Liberals poll 'surging' in the only poll that matters: this one"],
  tc100: ["100 TAX CUTS: War on aspiration officially over, says the runner holding all the tax cuts"],
  tc150: ["150 TAX CUTS: Economists call it 'unprecedented'; Treasury calls it 'unavailable for comment'"],
  budget: [
    "THE LIBERAL BUDGET: Surplus found down the back of the couch; Treasury 'surprised', Opposition 'always said so'",
    "Liberal budget activates: tax cuts drawn to runner; economists call it 'trickle-up'",
  ],
  boss: [
    "Government front bench enters the road; Opposition 'noting the size of the entourage'",
    "Senior figure steps onto the course; red tape reportedly 'on standby'",
  ],
  hitTape: [
    "Runner snared by red tape; Opposition vows to cut it, Government vows to review it",
    "Red tape claims another victim; Government says it's cutting red tape by adding a form to cut red tape",
    "Man tangled in regulation, forms committee to investigate the tangle",
  ],
  hitTax: [
    "Runner crushed by tax stack; Opposition says 'war on aspiration', Government says 'it's a stack'",
    "Tax stack hits man; Liberals brand it 'a Labor pile-on'",
    "Man buried in tax, thanks the Government for 'the opportunity to contribute'",
  ],
  hitBoss: [
    "Runner collides with the Government; Government unharmed, blames Opposition",
    "Man smacks into high office; 'it's been doing that to voters for years', says bystander",
  ],
  hitShot: [
    "Red tape fired at runner; man wrapped, thrown and 'fast-tracked'",
    "Runner tethered by bureaucracy; 'it's all in the paperwork', says whoever fired it",
    "Man launched by red tape, lands in a different lane, 'processed'",
  ],
  lastLife: [
    "One life left; the comeback is still on, according to the people who've staked everything on it",
    "Final life at risk; advisers suggest a tax cut",
  ],
  jump: [
    "Runner leaps red tape in a single bound; Government to introduce a bill about bounding",
    "Man leaps over problem rather than solving it, a time-honoured tradition of the Government",
    "Runner clears hurdle; Opposition calls it 'aspiration', Government calls it 'unscheduled'",
  ],
  lane: [
    "Runner moves right; economists say it's 'where the growth is'",
    "Man changes lanes to avoid a levy; 'sensible', says everyone except the levy",
    "Swerve announced as 'decisive action'; Government 'monitoring the swerve'",
  ],
  over: [
    (ctx) => `Runner finishes on ${ctx.score} points; Liberals call it 'a strong base to build from'`,
    "Government sets up review of the run; results due 'in the fullness of time'",
    "Opposition learns the lessons of the run and plans to win the next one, as is traditional",
    "Final result: tax cuts remain, services unverified, Government 'noting the result'",
  ],
};

const TK_SPEED = 110, TK_GAP = 70;   // pixels per second, and the space left between headlines

/**
 * Headlines ride a moving belt, one after another. The next one is only launched once the last one's
 * tail has actually moved clear of the right edge (measured on screen, not by a timer), so headlines
 * can't overlap or be cut off, even if the page was hidden, throttled or still loading.
 */
export function createTicker(view, reduceMotion = false) {
  const q = [], last = {};
  let cool = 0;

  function spawn(vw) {
    const text = q.length ? q.shift() : pick(HEADLINES.idle);
    const el = document.createElement('span');
    el.className = 'tk-item';
    el.textContent = text;
    el.style.setProperty('--vw', vw + 'px');
    view.appendChild(el);
    const w = el.offsetWidth;
    if (!w) { el.remove(); q.unshift(text); return; }   // not laid out yet: try again next frame
    el.style.animation = `tk ${(vw + w) / (reduceMotion ? TK_SPEED * 0.7 : TK_SPEED)}s linear forwards`;
    el.addEventListener('animationend', () => el.remove());
  }

  function loop() {
    const vw = view.clientWidth;
    if (vw > 0 && !document.hidden) {
      const tail = view.lastElementChild;
      if (!tail || tail.getBoundingClientRect().right <= view.getBoundingClientRect().right - TK_GAP) spawn(vw);
      while (view.children.length > 6) view.firstElementChild.remove();   // safety net
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  /** Urgent headlines go to the front of the queue (they never cut off the one on screen); the rest are rate-limited. */
  return function news(key, urgent = false, ctx = {}) {
    const pool = HEADLINES[key];
    if (!pool) return;
    const now = performance.now();
    if (!urgent && now - cool < 3500) return;
    let h;
    do { h = pick(pool); } while (pool.length > 1 && h === last[key]);
    last[key] = h;
    const text = typeof h === 'function' ? h(ctx) : h;
    cool = now;
    if (urgent) { q.unshift(text); q.length = Math.min(q.length, 3); } else if (q.length < 2) q.push(text);
  };
}
