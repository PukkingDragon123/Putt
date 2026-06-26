// Procedural hole generation. Deterministic from (runSeed, holeIndex) so a run
// always replays identically (§12.1). Difficulty scales with the floor; tee and
// cup lanes are kept clear so every hole is traversable by construction (§7.1).
import { holeRng, rngHelpers as R } from "./rng.js";
import { ITEM_KEYS } from "./items.js";

export const BALL_R = 0.35;
export const HOLE_R = 0.6;

export function genHole(runSeed, holeIndex) {
  const r = holeRng(runSeed, holeIndex);
  const floor = holeIndex + 1;
  const df = Math.min(floor, 12); // capped difficulty driver

  const W = Math.round(R.range(r, 20, 14 + Math.max(0, 8 - df)) ) || 14;
  const L = Math.round(R.range(r, 22, 34));
  const bounds = { minX: -W / 2, maxX: W / 2, minZ: 0, maxZ: L };

  const tee = { x: R.range(r, -W / 2 + 3, W / 2 - 3), z: 3 };
  const cup = { x: R.range(r, -W / 2 + 3, W / 2 - 3), z: L - 3, r: HOLE_R };

  const placed = [{ x: tee.x, z: tee.z, r: 3.6 }, { x: cup.x, z: cup.z, r: 3.2 }];
  const fits = (x, z, rad, gap) => {
    if (x < bounds.minX + 1.5 || x > bounds.maxX - 1.5) return false;
    if (z < bounds.minZ + 4.5 || z > bounds.maxZ - 4.5) return false;
    for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < rad + p.r + gap) return false;
    return true;
  };
  const spot = (rad, gap = 0.6) => {
    for (let i = 0; i < 24; i++) {
      const x = R.range(r, bounds.minX + 1.5, bounds.maxX - 1.5);
      const z = R.range(r, bounds.minZ + 5, bounds.maxZ - 5);
      if (fits(x, z, rad, gap)) { placed.push({ x, z, r: rad }); return { x, z }; }
    }
    return null;
  };

  const boxes = [], pillars = [], bars = [], mines = [], sand = [], water = [], pickups = [];

  const nBox = R.int(r, 1, Math.min(5, 1 + Math.floor(df / 2)));
  for (let i = 0; i < nBox; i++) {
    const w = R.range(r, 1.4, 3.0), d = R.range(r, 1.4, 3.0);
    const s = spot(Math.max(w, d) / 2 + 0.5); if (!s) continue;
    const breakable = R.chance(r, 0.5);
    // propType is visual only (cardboard crate vs welded metal-scrap pile);
    // breakable crates read as cardboard so the saw power-shot smashing them lands.
    boxes.push({ x: s.x, z: s.z, w, d, h: R.range(r, 1.0, 1.6), breakable, broken: false, wall: false,
      propType: breakable ? "cardboard" : "scrap", yaw: R.range(r, -0.25, 0.25) });
  }

  const nPil = R.int(r, 0, Math.min(4, Math.floor(df / 2)));
  for (let i = 0; i < nPil; i++) {
    const rad = R.range(r, 0.5, 1.0);
    const s = spot(rad + 0.4); if (!s) continue;
    pillars.push({ x: s.x, z: s.z, r: rad, h: R.range(r, 1.4, 2.0) });
  }

  const nBar = floor >= 3 ? R.int(r, 0, Math.min(2, Math.floor(df / 3))) : 0;
  for (let i = 0; i < nBar; i++) {
    const len = R.range(r, 4, 7);
    const s = spot(len / 2 + 0.6, 1.2); if (!s) continue;
    bars.push({ x: s.x, z: s.z, len, w: 0.6, h: 0.9,
      speed: (R.chance(r, 0.5) ? 1 : -1) * R.range(r, 0.8, 1.8 + df * 0.06), angle: R.range(r, 0, Math.PI) });
  }

  const nMine = R.int(r, floor >= 2 ? 1 : 0, Math.min(6, Math.floor(df / 1.4)));
  for (let i = 0; i < nMine; i++) {
    const s = spot(0.85, 0.5); if (!s) continue;
    // variant is visual only (bench saw-blade vs rusty spike cluster); same circle collision.
    mines.push({ x: s.x, z: s.z, r: 0.7, armed: true, variant: R.chance(r, 0.5) ? "saw" : "spikes" });
  }

  const nSand = floor >= 2 ? R.int(r, 0, 2) : 0;
  for (let i = 0; i < nSand; i++) {
    const s = spot(2.0, 0.2); if (!s) continue;
    const sw = R.range(r, 2.5, 5), sd = R.range(r, 2.5, 5);
    sand.push({ minX: s.x - sw / 2, maxX: s.x + sw / 2, minZ: s.z - sd / 2, maxZ: s.z + sd / 2 });
  }

  const nWater = floor >= 2 ? R.int(r, 0, 2) : 0;
  for (let i = 0; i < nWater; i++) {
    const s = spot(1.8, 0.4); if (!s) continue;
    const ww = R.range(r, 2, 4), wd = R.range(r, 2, 4);
    water.push({ minX: s.x - ww / 2, maxX: s.x + ww / 2, minZ: s.z - wd / 2, maxZ: s.z + wd / 2 });
  }

  if (R.chance(r, 0.55)) {
    const s = spot(0.8, 0.4);
    if (s) pickups.push({ x: s.x, z: s.z, r: 0.8, itemKey: R.pick(r, ITEM_KEYS), taken: false });
  }

  // Bloodstain / warning-paint decals on the felt — purely cosmetic, no collision.
  const decals = [];
  const nDecal = R.int(r, 1, 3);
  for (let i = 0; i < nDecal; i++)
    decals.push({ x: R.range(r, bounds.minX + 2, bounds.maxX - 2), z: R.range(r, 6, L - 4),
      s: R.range(r, 1.4, 2.8), rot: R.range(r, 0, Math.PI) });

  // Par from distance + obstacle density (§7.1 parameter cross-check).
  const dist = Math.hypot(cup.x - tee.x, cup.z - tee.z);
  const density = boxes.length + pillars.length + bars.length;
  let par = Math.round(dist / 11) + (density >= 4 ? 1 : 0);
  par = Math.max(2, Math.min(4, par));

  // The Dealer's chamber: more live shells the deeper you go (§9.4 variance).
  const size = par + 2;
  const liveRatio = Math.min(0.6, 0.33 + (floor - 1) * 0.025);
  let live = Math.max(1, Math.round(size * liveRatio));
  live = Math.min(live, size - 1); // always at least one blank
  const chamber = [];
  for (let i = 0; i < size; i++) chamber.push({ type: i < live ? "live" : "blank", drawn: false, revealed: false });
  R.shuffle(r, chamber);

  return {
    index: holeIndex, floor, par, seed: runSeed, W, L, bounds,
    tee, cup, boxes, pillars, bars, mines, sand, water, pickups, decals,
    chamber, liveCount: live, blankCount: size - live,
  };
}
