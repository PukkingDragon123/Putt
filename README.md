# 🩸 PUTT OR DIE

A **3D mini-golf roguelike** inspired by *Buckshot Roulette*. You're trapped in
the Dealer's basement golf den. Sink the putt fast — or the gun racks on you.

![Putt or Die](media/thumbnail.png)

> Built with hand-written WebGL (no engine, no libraries), procedural courses,
> and synthesized audio — it runs from a single static folder, fully offline.

---

## How it plays

Each hole is procedurally generated and gets nastier the deeper you go. The
twist is the **chamber**: before every hole the Dealer loads a shotgun with
LIVE and BLANK shells (you see the counts, not the order).

- Sink the ball **within par** and no shell is ever drawn — clean and safe.
- Every stroke **over par** draws one shell. **LIVE** = you eat lead (−1 ❤).
  **BLANK** = a lucky click.
- **Sink it** and you turn the gun on the Dealer: you survive instantly and
  bank chips for every live shell you dodged.
- Run dry without sinking and you're conceded — for two hearts.
- Spike-mines, water, sand and spinning bars are all trying to kill your run.
- Your hearts don't refill on their own. Hit **0 ❤** and the basement keeps you.

### The kit (Buckshot-style pickups, max 4 carried)

| | Item | Effect |
|---|---|---|
| 🍺 | **Beer** | Rack the gun — eject the next shell unfired. |
| 💊 | **Pills** | Expired meds: 50% heal +2 ❤, 50% it backfires (−1 ❤ + shaky aim). |
| 🚬 | **Cigarette** | Steady the nerves: +1 ❤. |
| 🔍 | **Magnifier** | Inspect the next shell in the chamber. |
| 🪚 | **Hand-Saw** | Saw the barrel: next putt is a power shot that smashes crates. |
| ⛓️ | **Handcuffs** | Cuff the machinery: freeze the spinning bars this hole. |

## Controls

| Action | Keyboard | Mouse / Touch | Gamepad |
|---|---|---|---|
| Aim | `A` / `D` or `←` / `→` | drag on the course | left stick / d-pad |
| Start power & putt | `Space` / `Enter` | tap course or **PUTT** | `A` |
| Use item 1–4 | `1`–`4` | tap the bag slot | — |
| Mute | `M` | 🔊 button | — |
| Restart (after death) | `R` | **BACK TO THE TABLE** | `A` |

Putting is two taps: the first starts an oscillating power meter, the second
locks it in. Aim around the obstacles — bouncing off walls is half the game.

## Run it locally

ES modules need to be served over HTTP (not `file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

That's the whole game — `index.html`, `logic.js`, `strings.js`, and `js/`.
No build step, no dependencies.

## Project layout

```
index.html        the game page: canvas, HUD, CSS, bootstrap
logic.js          solo rules-module stub (required by the apps engine)
strings.js        every player-visible string (localizable)
js/
  game.js         state machine, physics, collisions, camera, HUD
  gl.js           WebGL renderer: flat-shaded program + procedural meshes
  course.js       deterministic procedural hole generation
  items.js        the pickup kit and effects
  audio.js        WebAudio synthesized SFX + ambient drone
  rng.js          seeded mulberry32 RNG
  math.js         mat4 / mat3 / vec helpers
design/           plan, asset manifest, and numeric thresholds
media/            thumbnail / icon / screenshots
tools/            local test + capture scripts (not shipped)
```

## Tech notes

- **Pure WebGL1**, hand-rolled. The grimy PS1 look — flat faceting, warm key
  light, dark fog, film grain, vignette, subtle vertex jitter — is all in the
  shaders, so there are no texture or model files to ship.
- **Deterministic**: fixed 60 Hz timestep + seeded RNG. A run replays exactly
  from its seed.
- **Tested headless**: `tools/logic-test.mjs` checks generation/determinism and
  `tools/browser-test.mjs` drives a hole in Chromium and asserts a clean console.

## Hosted build

This was authored for the Higgsfield game pipeline (a one-click shareable play
link). The hosted deploy isn't wired up from this environment — the workspace
has no generation credits and the asset-upload host is blocked by the network
policy — but the game is complete and self-contained, so a deploy just needs
those two things available. The deploy card images are versioned in `media/`.
