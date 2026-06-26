# Numeric thresholds (frozen before code — §0.6)

## Performance budget (weakest platform: mid mobile)
- Target 60 fps; hard floor 30 fps on worst-case scene.
- devicePixelRatio capped at 1.5.
- Draw objects per frame ≤ ~120 (procedural primitives, shared buffers).
- Zero allocations in the steady-state frame loop (reuse vectors/matrices).

## Simulation
- Fixed timestep: 1000/60 ms. Logic is frame-rate independent.
- Seeded RNG: mulberry32(runSeed ^ holeIndex*2654435761).

## Agency metrics (frozen before content)
- Ball radius: 0.35 world units. Hole radius: 0.6.
- Course tile: built on a grid; green spans ~16–30 units wide by floor.
- Max putt speed: 26 u/s at full power. Rolling friction: 1.6 u/s^2 + damping 0.992/step.
- Sink capture: ball center within hole radius AND speed < 10 u/s.
- Sand friction multiplier: 4x. Water/out-of-bounds: reset to last rest, +1 stroke.

## Buckshot / combat
- Start HP 5, max HP 6. Spike-mine hit: −1 HP. Live shell: −1 HP.
- Out of shells without sinking: −2 HP, concede hole, advance.
- Chamber size = par + 2. Live ratio scales 0.33 → 0.6 over floors 1..12 (capped).
- Par per hole: 2–4 by floor/layout.

## Input tolerance
- Power meter oscillation period ~1.1 s; lock on press.
- Aim rotation: 2.2 rad/s held; analog stick scaled.
- Restart accepted any time on game-over screen.
