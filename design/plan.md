# PUTT OR DIE — Design

A 3D roguelike that fuses skill-based mini-golf putting with the nerve-war of
*Buckshot Roulette*. You are trapped in the Dealer's basement golf den. Sink
the ball fast or the Dealer racks the gun on you.

## Profile
- **Time:** real-time during the ball roll, turn-based between strokes (aim at will).
- **Space:** continuous 3D.
- **Agency:** one hero — the ball / the putter.
- **Conflict:** vs system (the course + the Dealer's gun) and vs self (nerve).
- **Content:** procedural, seeded per run + hole index.
- **Outcome:** endless roguelike run; survive as deep as possible; die at 0 HP.
- **Players:** solo.
- **Session:** minutes per run.
- **Engagement:** execution (aim + power timing) + calculation (risk/reward of
  strokes, shells and items). Primary: execution; secondary: calculation.

## Experience formula
The player feels a gambler's nerve because the game constantly forces an
aim-and-commit putt where every stroke over par draws a live-or-blank shell,
and the pickups that could save them (beer, pills) might just as easily sink
them.

## Verbs
Aim · Charge (oscillating power) · Putt · Use item · Choose reward.

A few strong verbs: each object answers them differently — walls bounce, sand
drags, water resets, spike-mines bite, the hole captures, the gun fires.

## Core loop
1. A hole is generated. The Dealer loads a **chamber** of shells for it —
   some LIVE, some BLANK (counts shown, order hidden). Buckshot tension lives here.
2. Aim (rotate, camera orbits behind the ball), charge an oscillating power
   meter, putt. Ball rolls with friction + collisions.
3. The course bites: walls bounce, sand drags, water = reset + stroke,
   spike-mines = −1 HP, spinning bars knock the ball.
4. **The gun:** any stroke that does NOT sink draws one shell. LIVE → BANG, you
   lose HP. BLANK → click, safe. Sinking ends the hole immediately — you "turn
   the gun on the Dealer," survive, and every live shell you dodged pays tokens.
5. Clear the hole → choose 1 of 3 rewards (item / heal / tokens). Descend.
6. 0 HP → you die. Score = holes cleared + tokens. Restart.

## Items (max 4 carried) — the Buckshot kit, golf-flavored
- 🍺 **Beer** — rack the gun: eject the next shell from the chamber unfired.
- 💊 **Pills** — expired meds: 50% heal +2 HP, 50% −1 HP and the next aim wobbles.
- 🚬 **Cigarette** — steady the nerves: heal +1 HP.
- 🔍 **Magnifier** — inspect the next shell's type for this hole.
- 🪚 **Hand-saw** — saw off the barrel: next putt is a power shot that smashes
  breakable crates and carries far.
- ⛓️ **Handcuffs** — cuff the machinery: freeze all moving obstacles this hole.

## Loops & balance
- Negative loop (skill matters): sinking under par dodges shells and pays
  bonus, so good play is rewarded; bad play draws more shells.
- Positive loop guard: damage is capped at 1 HP per shell early; deeper floors
  raise live-shell ratio, not per-hit damage spikes — a soft slowdown, not a wall.
- Comeback: pickups + reward choices let a low-HP run recover.
- Non-transitive item value: Beer beats a hot chamber, Magnifier beats the
  unknown, Saw beats distance/obstacles — no single dominant pick.

## Information map
- Visible: HP, hole/floor, par, strokes, chamber composition (counts), item
  bag, aim line, power meter.
- Hidden with a trail: shell order (revealed by Magnifier, alterable by Beer);
  obstacle motion is fully observable before committing.

## Delivery context
Desktop + mobile browsers + gamepad. Keyboard bound to physical `event.code`.
Touch zones for aim/putt/items. All player strings external in `strings.js`.

## Tech
Self-contained WebGL renderer (no third-party libraries — egress blocks CDNs
and vendoring is impossible; raw WebGL keeps it dependency-free). Fixed-timestep
60 Hz simulation, seeded RNG (mulberry32). Procedural primitive geometry (the
PS1/Buckshot look is faceted low-poly by nature). Procedural WebAudio SFX +
ambient drone. Solo `logic.js` stub satisfies the engine's required code module.

## Honest limits (§13)
Geometry is primitives, not sculpted meshes — faithful to the gritty low-poly
target, not photoreal. Audio is synthesized in-engine, not composed. No
Meshy/3D-model generation (no API key + primitives are the right call here).
