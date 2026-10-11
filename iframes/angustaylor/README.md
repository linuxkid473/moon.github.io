# Angus Taylah: Fighting Taxes

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
| `gfx.js` | Small three.js helpers |
| `faces/` | The three baked face textures |
| `vendor/` | three.js, self-hosted so the game has no CDN dependency |

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
