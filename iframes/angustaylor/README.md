# Angus Taylah: Fighting Taxes (New 3D Edition)

A low-poly 3D lane runner (three.js r160, no build step). Dodge tax stacks, red tape and the bosses,
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
| `fx.js` | Pooled particle system (pickups, landings, hits) |
| `audio.js` | Web Audio synthesised effects and music (no audio files) |
| `ticker.js` | Satirical news ticker and its headlines |
| `glass.js` | The final pass: rain on the window, wet reflective floor, bloom and vignette (one shader) |
| `rain.js` | Rain streaks and road splashes in the world |
| `gfx.js` | Small three.js helpers |
| `faces/` | The three baked face textures |
| `vendor/` | three.js, self-hosted so the game has no CDN dependency |

## What's new in v3 (merged with the rally-stage build)

* **Graphics:** the scene is drawn to a texture and seen through rain-spattered glass with a wet floor that reflects the lights and LED screens (the world is a Liberal blue; red is kept for hazards: tape, tax stacks, orbs), plus a vignette. Nothing is blurred: no bloom, canvas textures are painted at 2x, the game renders at the screen's native resolution, and a light sharpen runs in the final pass. Alley walls with lit windows, a huge LED wall and crowd at the horizon, scrolling edge lights, richer tax stacks, red-tape barriers and spinning coins, and more detailed people (creases, soles, pocket squares, watches). Static meshes are baked together to keep draw calls low.
* **Gameplay:** golden SURPLUS cuts (worth 10), ribbon-cutting scissors (cut through hazards for 6 s), a consultant (takes the blame for one hit), streak call-outs, ranks and game-over titles, a camera that leans into lane changes.
* **Settings:** "Rain on the window" and "Rain in the world & wet floor" can each be switched off. Add `?noadapt` to the URL to stop the game lowering quality automatically while you test.
* **Dynamic resolution:** every ~0.75 s the average frame time is checked. Slower than 60 fps: the render scale drops a step (down to 0.6x, and the window drops go off at the low end). Comfortably fast for a few seconds: it probes a step back up. It starts at the screen's native resolution (up to 2x).
* The menu stage no longer adds or removes lights or fog when switching to the road, which used to recompile every shader and cause a hitch.

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
and `__game.manual = true` to drive the simulation by hand (`__game.update(dt)`).

## Credits and disclaimer

three.js is MIT licensed (`vendor/three.LICENSE`). This is an unofficial fan-made parody, not affiliated with or
endorsed by any political party or any person depicted. Make sure you have the right to use the portraits.
