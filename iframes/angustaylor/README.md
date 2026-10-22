# Angus Taylah: Fighting Taxes (New 3D Edition)

A 3D lane runner (three.js r160, no build step) with a real physics engine, HDR rendering and ragdolls. Dodge tax stacks, red tape and the bosses,
grab the TAX CUT signs, buy cosmetics in the shop.

Entry point: `../angustaylor.html` (markup, styles, UI). It must be served over http(s), not opened from disk,
because the game is loaded as ES modules.

## Files

| File | What it does |
| --- | --- |
| `main.js` | Game loop, physics, spawning, boss AI, input, HUD, game flow |
| `config.js` | **All tuning**: lanes, gravity, jump, speed ramp, characters, shop items |
| `state.js` | Shared game state, settings, localStorage (never throws) |
| `person.js` | Low-poly people, the portrait-on-head builder, poses and animation |
| `cosmetics.js` | Shop items and the cloth-simulated cape |
| `world.js` | Road, arches, scenery templates, menu stage |
| `fx.js` | Physically simulated particles (instanced billboards): drag against the headwind, buoyancy, turbulence, bouncing and skidding sparks, black-body fire dissolving through noise, lit smoke |
| `explosion.js` | The tax bomb: flash, a real point light, shockwave, fireball, smoke column, bouncing sparks, embers, rigid debris, scorch |
| `crack.js` | What the blame shield does to obstacles (a crack runs down them, then they split open), and `shatter()`, which a blast uses to take them apart into rigid pieces |
| `audio.js` | Web Audio synthesised effects and music (no audio files) |
| `ticker.js` | Satirical news ticker and its headlines |
| `glass.js` | The final pass: HDR scene, bloom chain, ACES tone mapping, grading, rain on the window, speed blur, shockwave ripple, chromatic aberration |
| `rain.js` | Rain streaks and road splashes in the world |
| `gfx.js` | Small three.js helpers |
| `physics.js` | A rigid-body engine (XPBD): boxes, spheres, capsules, contacts with friction and restitution, joints with limits, a moving road under everything |
| `ragdoll.js` | An 11-body ragdoll with hinge knees/elbows and swing/twist limits, built on any `person.js` model |
| `car.js` | The Angus Tax Car model (paint, wheels that spin and steer, headlight beams, underglow, spring-damper body roll) |
| `debris.js` | Rigid pieces (paper that flutters on the air, stamps, coins, slabs) that tumble and skid |
| `reflection.js` | Planar reflection of the street in the wet road, with puddles, ripples and Fresnel |
| `env.js` | Image-based lighting (a small procedural night-rally panorama) |
| `facade.js` | Procedural PBR brick-and-window walls (albedo, emissive, normal, roughness) |
| `faces/` | The three baked face textures |
| `vendor/` | three.js, self-hosted so the game has no CDN dependency |

## What's new in v4 (physics and graphics)

* **Real physics (`physics.js`):** every blast, hit and break is simulated. Debris has mass, inertia, bounce and friction; the road is a conveyor, so things that land on it are dragged along at road speed; paper flutters on the air that is rushing past.
* **Ragdolls (`ragdoll.js`):** bosses launched by a bomb, a knockout, and Angus himself when a tax stack goes off in his face (with a soft tether to his lane and a blend back into the run) are all simulated bodies with joints and limits. When he is out of lives he tumbles in slow motion behind the game-over card.
* **Tax cut bomb (key B, or the bomb button):** thrown on a ballistic arc worked out to hit the nearest boss. The blast wave runs down the road wrecking tax stacks, red tape and orbs into rigid debris, and every boss it reaches is thrown sky-high ("HOMERUN!", +500, slow motion, camera follows him). You get one free per run; buy up to 5 in the shop (`BOMB` in `config.js`).
* **The Angus Tax Car (`car.js`):** buy it in the shop (100 tax cuts for 15 minutes of driving; `CAR` in `config.js`; you can hold up to 30 minutes). Press **C** or the 🚗 button to climb in. The minutes only run down while you are actually driving, so pausing or parking costs nothing; leave it on in the menu and the next run starts in the car. In the car nothing can hurt you: tax stacks, red tape and thrown orbs are smashed into rigid pieces and thrown forward (+25 each), and any boss it hits is thrown off the map as a ragdoll (+500, slow motion, the camera follows him). Bosses come twice as often while you drive, and hazards keep spawning in front of them so there is always something to hit.
* **Jump chain and boss knockout:** jumps in quick succession build a chain; 10 jumps arms a giant rogue tax-cut coin that knocks the next boss into the crowd.
* **Explosion:** a point light that lights the street, a fireball of buoyant turbulent fire coloured by temperature, a smoke column underlit by the fire, bouncing sparks, embers, a debris field, scorch marks, a shockwave ripple across the screen and chromatic aberration.
* **Graphics:** HDR rendering with bloom and ACES tone mapping, a wet reflective road (planar reflection with puddles), real sun shadows, image-based lighting, brick facades with glowing windows, smooth high-detail characters with cloth weave, sheen and glossy shoes.
* **Camera:** trauma-based smooth-noise shake, speed blur that grows with the run, a camera that follows a launched boss.
* **Ragdoll Mode (menu button):** a physics playground on the wet street. Angus stands facing you; anything fast that hits him, or a click with the Grab tool, turns him into a ragdoll. Tools: **Grab** (1: drag him, or a boss, by any limb and fling him), **Ball** (2), **Bomb** (3, also B), **Tax stack** (4: drops four heavy bundles from above), **Add boss** (5: up to three ragdoll bosses), **Reset** (R), **Slow-mo** (T), **Menu** (Esc). Right-drag (or Shift-drag) orbits, the wheel zooms, arrow keys orbit too. When he has lain still for a few seconds he gets back up on his own (the ragdoll blends into the animated pose). The street is walled in by invisible boxes so nothing leaves it.
* **Settings:** "Graphics: Auto / Max / Low". Auto gives up the street reflection, then bloom and particles, and only then the render resolution when the frame rate drops.
* **Source of the bomb and knockout features:** ported from the Moon Games build of the game (`moongames-live_angustaylor.html` in the project folder is a copy of that build).

## What's new in v3 (merged with the rally-stage build)

* **Graphics:** the scene is drawn to a texture and seen through rain-spattered glass (the world is a Liberal blue; red is kept for hazards: tape, tax stacks, orbs), plus a vignette. Nothing is blurred: no bloom, canvas textures are painted at 2x, the game renders at the screen's native resolution, and a light sharpen runs in the final pass. Alley walls with lit windows, a huge LED wall and crowd at the horizon, scrolling edge lights, richer tax stacks, red-tape barriers and spinning coins, and more detailed people (creases, soles, pocket squares, watches). Static meshes are baked together to keep draw calls low.
* **Gameplay:** golden SURPLUS cuts (worth 10), ribbon-cutting scissors (cut through hazards for 6 s), a consultant (takes the blame for one hit), streak call-outs, ranks and game-over titles, a camera that leans into lane changes.
* **Settings:** "Rain on the window" and "Rain in the world" can each be switched off. Add `?noadapt` to the URL to stop the game lowering quality automatically while you test.
* **Dynamic resolution:** every ~0.75 s the average frame time is checked. Slower than 60 fps: the render scale drops a step (down to 0.6x, and the window drops go off at the low end). Comfortably fast for a few seconds: it probes a step back up. It starts at the screen's native resolution (up to 2x).
* The menu stage no longer adds or removes lights or fog when switching to the road, which used to recompile every shader and cause a hitch.

## Latest changes

* **Dark Liberal blue:** the light blues (road lines, windows, LED strips, lights, UI accents, Angus's shirt) are now the deep Liberal blue family (`#0b2f86` / `#1f4fb8`).
* **Blame shield:** now lasts `POWER.shieldSecs` (10 s). While it's up, every tax stack, red-tape barrier and thrown tape orb he touches cracks open (`crack.js`) for `POWER.crackBonus` points. A boss's touch still pops it. The bubble is a dark-blue hex-grid sphere that flares on impact and flickers when it is about to run out.
* **Bodies:** rounded chest, waist, shoulder caps, bicep/forearm/thigh/calf masses, a seat, ankles and shoes. The upper body hangs from a `spine` pivot (`SPINE_Y`), so the chest twists against the hips and leans into the run. Poses are now 17 numbers (`POSE_N`): the extra five are chest twist/lean/sway and the two ankles. New run cycle (harder knee drive, heel-to-toe feet, bent-elbow arm pump), push-off stretch, tucked jump apex, chest-fold landing, a head that counter-rotates to keep looking down the road, and a wound-up boss throw.
* **Tax bomb:** a tax stack that hits him now detonates (`explosion.js`): flash, shockwave rings, billowing fireball, smoke column, embers and debris, with a camera shake, light flare, blast overlay (`#blast`) and a synthesised boom (`audio.sfx.explosion`). The blast throws him into the air.

## Physics and feel

* Jumps rise slowly and fall fast (`PHYS.gravityUp` / `gravityDown`), full height every time (a boss needs a full jump).
* Down / swipe-down in the air slams you to the ground.
* Jump and lane inputs are buffered for a moment, so an early press still counts when you land or finish a toss.
* Lane changes use a critically damped spring (no overshoot), and the same velocity drives the lean.
* Collisions are swept along z, so nothing tunnels through you at high speed or on a slow frame.
* The simulation runs in sub-steps of at most 1/90 s; a hit freezes the game for ~70 ms.
* Tax cuts always come in tidy lines of five. Rows are spaced by distance but never closer than `RUN.minRowGap` seconds, so speed can't make the game unfair.
  Every row pattern leaves a free lane; while a boss is on the road only pickups spawn.
* Bosses show a red strip on the road and draw their arm back for 0.55 s before throwing, and don't change lane during it.

## The faces

Each character's head is a vertex-coloured skull (hair colour on top and at the back, skin elsewhere)
plus a near-flat face plate that carries the portrait (so the whole face shows, undistorted, instead of wrapping round a sphere), ears, and a rear hair shell.
The plate is unlit, so the photo keeps its real colours under the red stage lighting.
If a portrait fails to load the game falls back to a painted cartoon face.

`faces/*.webp` are 512x624 RGBA (upscaled 2x and sharpened from the 256px sources): the head is cropped so its ellipse touches the image edges, and the alpha is
feathered from ~85% of the radius to the edge, which blends the photo into the skull and removes the photo background.

| File | Source |
| --- | --- |
| `albo.webp` | `resources/albanese-face.png` |
| `hanson.webp`, `angus.webp` | The portraits that were embedded in the previous `angustaylor.html` |

To change a face: replace the file with a similar crop, then adjust that character in `config.js`
(`skin` / `hair` are the sampled colours for hands, neck and back of head). The sources are small, so a higher-resolution portrait will look noticeably crisper.

## Debugging

Add `?debug` to the URL to get `window.__game` (state and helpers), a `[+50]` cheat in the shop,
and `__game.manual = true` to drive the simulation by hand (`__game.update(dt)`). The debug build does not pause when its window loses focus.

## Credits and disclaimer

three.js is MIT licensed (`vendor/three.LICENSE`). This is an unofficial fan-made parody, not affiliated with or
endorsed by any political party or any person depicted. Make sure you have the right to use the portraits.
