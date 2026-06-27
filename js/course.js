// Procedural hole generation (v3). Deterministic from (runSeed, holeIndex).
// Produces an elevation height-field, a naturally-placed clutter of realistic
// basement junk (heavy solid props + light knockable props + decor), scurrying
// rats, and golf hazards (dirt/water). No more Buckshot chamber, mines or bars.
import { holeRng, rngHelpers as R } from "./rng.js";

export const BALL_R = 0.35;
export const HOLE_R = 0.6;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- elevation: analytic height field + exact gradient (physics == visuals) ----
export function terrainHeight(t, x, z) {
  let y = t.base + t.tiltX * x + t.tiltZ * z;
  for (let i = 0; i < t.mounds.length; i++) {
    const m = t.mounds[i], dx = x - m.x, dz = z - m.z, inv = 1 / (m.s * m.s);
    y += m.A * Math.exp(-(dx * dx + dz * dz) * inv);
  }
  if (t.ramp) {
    const r = t.ramp;
    const u = (x - r.x0) * r.dirx + (z - r.z0) * r.dirz;
    const v = (x - r.x0) * -r.dirz + (z - r.z0) * r.dirx;
    const a = clamp01(u / r.len), sm = a * a * (3 - 2 * a), wf = Math.exp(-(v * v) / (r.w * r.w));
    y += r.rise * sm * wf;
  }
  return y;
}
export function terrainSlope(t, x, z, out) {
  let gx = t.tiltX, gz = t.tiltZ;
  for (let i = 0; i < t.mounds.length; i++) {
    const m = t.mounds[i], dx = x - m.x, dz = z - m.z, inv = 1 / (m.s * m.s);
    const g = m.A * Math.exp(-(dx * dx + dz * dz) * inv);
    gx += g * (-2 * dx * inv); gz += g * (-2 * dz * inv);
  }
  if (t.ramp) {
    const r = t.ramp;
    const u = (x - r.x0) * r.dirx + (z - r.z0) * r.dirz;
    const v = (x - r.x0) * -r.dirz + (z - r.z0) * r.dirx;
    const a = clamp01(u / r.len), sm = a * a * (3 - 2 * a), wf = Math.exp(-(v * v) / (r.w * r.w));
    const dsm = (u <= 0 || u >= r.len) ? 0 : (6 * a * (1 - a)) / r.len;
    const dwf = wf * (-2 * v / (r.w * r.w));
    const dYdu = r.rise * dsm * wf, dYdv = r.rise * sm * dwf;
    gx += dYdu * r.dirx + dYdv * -r.dirz;
    gz += dYdu * r.dirz + dYdv * r.dirx;
  }
  out.gx = gx; out.gz = gz; return out;
}

function makeTerrain(r, bounds, tee, cup, df) {
  const tiltX = R.range(r, -0.035, 0.035), tiltZ = R.range(r, -0.03, 0.03);
  const mounds = [];
  const nM = R.int(r, 1, 3 + Math.min(2, Math.floor(df / 4)));
  for (let i = 0; i < nM; i++) {
    const x = R.range(r, bounds.minX + 2.5, bounds.maxX - 2.5);
    const z = R.range(r, bounds.minZ + 5, bounds.maxZ - 5);
    const dish = R.chance(r, 0.3);
    const A = dish ? -R.range(r, 0.2, 0.4) : R.range(r, 0.25, 0.7);
    mounds.push({ x, z, A, s: R.range(r, 1.8, 3.2) });
  }
  let ramp = null;
  if (df >= 2 && R.chance(r, 0.4)) {
    const ang = R.range(r, 0, Math.PI * 2);
    ramp = { x0: R.range(r, bounds.minX + 2, bounds.maxX - 2), z0: R.range(r, bounds.minZ + 6, bounds.maxZ - 10),
      dirx: Math.cos(ang), dirz: Math.sin(ang), len: R.range(r, 4, 7), rise: R.range(r, 0.4, 0.9), w: R.range(r, 2.5, 4) };
  }
  const t = { tiltX, tiltZ, base: 0, mounds, ramp };
  // flatten near tee & cup so launches/sinks aren't on a steep face
  for (const m of mounds) {
    if (Math.hypot(m.x - tee.x, m.z - tee.z) < 2.5) m.A *= 0.35;
    if (Math.hypot(m.x - cup.x, m.z - cup.z) < 2.5) m.A *= 0.35;
  }
  const cx = (tee.x + cup.x) / 2, cz = (tee.z + cup.z) / 2;
  t.base = -terrainHeight(t, cx, cz);
  return t;
}

// realistic basement junk. light:true props are knockable; the rest are solid.
const HEAVY = [
  { kind: "crate",   shape: "box", tex: "wood",     light: false },
  { kind: "drum",    shape: "cyl", tex: "iron",     light: false },
  { kind: "heater",  shape: "cyl", tex: "iron",     light: false },
  { kind: "furni",   shape: "box", tex: "wood",     light: false },
  { kind: "bricks",  shape: "box", tex: "concrete", light: false },
];
const LIGHT = [
  { kind: "paint",     shape: "cyl", tex: "iron",      light: true },
  { kind: "bucket",    shape: "cyl", tex: "iron",      light: true },
  { kind: "cardboard", shape: "box", tex: "cardboard", light: true },
  { kind: "tire",      shape: "cyl", tex: "iron",      light: true },
];

export function genHole(runSeed, holeIndex) {
  const r = holeRng(runSeed, holeIndex);
  const floor = holeIndex + 1, df = Math.min(floor, 12);

  const W = Math.round(R.range(r, 20, 14 + Math.max(0, 8 - df))) || 14;
  const L = Math.round(R.range(r, 22, 34));
  const bounds = { minX: -W / 2, maxX: W / 2, minZ: 0, maxZ: L };
  const tee = { x: R.range(r, -W / 2 + 3, W / 2 - 3), z: 3 };
  const cup = { x: R.range(r, -W / 2 + 3, W / 2 - 3), z: L - 3, r: HOLE_R };

  const terrain = makeTerrain(r, bounds, tee, cup, df);
  tee.y = terrainHeight(terrain, tee.x, tee.z);
  cup.y = terrainHeight(terrain, cup.x, cup.z);

  const placed = [{ x: tee.x, z: tee.z, r: 3.6 }, { x: cup.x, z: cup.z, r: 3.2 }];
  const fits = (x, z, rad, gap) => {
    if (x < bounds.minX + 1.5 || x > bounds.maxX - 1.5) return false;
    if (z < bounds.minZ + 4.5 || z > bounds.maxZ - 4.5) return false;
    for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < rad + p.r + gap) return false;
    return true;
  };
  const spotNear = (rad, gap, bias) => {
    for (let i = 0; i < 24; i++) {
      let x, z;
      if (bias > 0 && R.chance(r, bias)) {
        const side = R.chance(r, 0.5) ? -1 : 1;
        x = side * (bounds.maxX - 1.5 - R.range(r, 0, 2.6));
        z = R.range(r, bounds.minZ + 5, bounds.maxZ - 5);
      } else {
        x = R.range(r, bounds.minX + 1.5, bounds.maxX - 1.5);
        z = R.range(r, bounds.minZ + 5, bounds.maxZ - 5);
      }
      if (fits(x, z, rad, gap)) { placed.push({ x, z, r: rad }); return { x, z }; }
    }
    return null;
  };

  const clutter = [];
  const addClutter = (def, dims, bias) => {
    const rad = def.shape === "cyl" ? dims.r : Math.max(dims.w, dims.d) / 2;
    const s = spotNear(rad + 0.4, 0.6, bias); if (!s) return;
    clutter.push({ ...def, ...dims, x: s.x, z: s.z, y: terrainHeight(terrain, s.x, s.z),
      yaw: R.range(r, -0.18, 0.18), vx: 0, vz: 0, spin: 0, settled: true });
  };

  const nHeavy = R.int(r, 2, Math.min(7, 3 + Math.floor(df / 2)));
  const nLight = R.int(r, 2, Math.min(8, 3 + Math.floor(df / 2)));
  const nDecor = R.int(r, 1, 4);

  for (let i = 0; i < nHeavy; i++) {
    const def = R.pick(r, HEAVY);
    let dims;
    if (def.kind === "heater") dims = { r: R.range(r, 0.7, 0.85), h: R.range(r, 2.6, 3.4) };
    else if (def.kind === "drum") dims = { r: R.range(r, 0.55, 0.66), h: R.range(r, 1.5, 1.8) };
    else if (def.kind === "crate") { const w = R.range(r, 1.6, 2.6); dims = { w, d: R.range(r, 1.6, 2.6), h: R.range(r, 1.3, 1.9) }; }
    else if (def.kind === "furni") dims = { w: R.range(r, 1.4, 2.2), d: R.range(r, 1.0, 1.6), h: R.range(r, 0.9, 1.3) };
    else dims = { w: R.range(r, 1.2, 2.0), d: R.range(r, 0.9, 1.5), h: R.range(r, 0.5, 0.8) }; // bricks
    addClutter(def, dims, R.range(r, 0.75, 0.85));
  }
  for (let i = 0; i < nLight; i++) {
    const def = R.pick(r, LIGHT);
    let dims;
    if (def.kind === "paint") dims = { r: 0.28, h: 0.38 };
    else if (def.kind === "bucket") dims = { r: 0.36, h: 0.5 };
    else if (def.kind === "tire") dims = { r: 0.52, h: 0.34 };
    else dims = { w: R.range(r, 0.9, 1.6), d: R.range(r, 0.9, 1.6), h: R.range(r, 0.8, 1.4) }; // cardboard
    addClutter(def, dims, R.chance(r, 0.55) ? 0.7 : 0);
  }
  for (let i = 0; i < nDecor; i++) {
    if (R.chance(r, 0.5)) {
      const len = R.range(r, 2.0, 4.5);
      addClutter({ kind: "pipe", shape: "box", tex: "iron", light: false }, { w: len, d: 0.32, h: 0.32 }, 0.6);
    } else {
      addClutter({ kind: "bricks", shape: "box", tex: "concrete", light: false },
        { w: R.range(r, 1.0, 1.8), d: R.range(r, 0.8, 1.3), h: R.range(r, 0.4, 0.7) }, 0.6);
    }
  }

  const sand = [], water = [];
  const nSand = floor >= 2 ? R.int(r, 0, 2) : 0;
  for (let i = 0; i < nSand; i++) {
    const s = spotNear(2.0, 0.2, 0); if (!s) continue;
    const w = R.range(r, 2.5, 5), d = R.range(r, 2.5, 5);
    sand.push({ minX: s.x - w / 2, maxX: s.x + w / 2, minZ: s.z - d / 2, maxZ: s.z + d / 2 });
  }
  const nWater = floor >= 2 ? R.int(r, 0, 2) : 0;
  for (let i = 0; i < nWater; i++) {
    const s = spotNear(1.8, 0.4, 0); if (!s) continue;
    const w = R.range(r, 2, 4), d = R.range(r, 2, 4);
    water.push({ minX: s.x - w / 2, maxX: s.x + w / 2, minZ: s.z - d / 2, maxZ: s.z + d / 2 });
  }

  // rats: scurry along the side walls, pause, flee from the ball
  const rats = [];
  const nRats = R.int(r, 2, 4);
  for (let i = 0; i < nRats; i++) {
    const side = R.chance(r, 0.5) ? -1 : 1;
    const x = side * (bounds.maxX - 1.2 - R.range(r, 0, 1.4));
    const z = R.range(r, bounds.minZ + 4, bounds.maxZ - 4);
    rats.push({ x, z, y: terrainHeight(terrain, x, z), vx: 0, vz: 0, dir: R.range(r, 0, 6.28),
      phase: R.range(r, 0, 6.28), state: "pause", timer: R.range(r, 0.3, 1.2),
      home: side * (bounds.maxX - 1.2), spook: false });
  }

  // faint grime/oil decals on the floor (cosmetic)
  const decals = [];
  const nDecal = R.int(r, 1, 3);
  for (let i = 0; i < nDecal; i++)
    decals.push({ x: R.range(r, bounds.minX + 2, bounds.maxX - 2), z: R.range(r, 6, L - 4),
      s: R.range(r, 1.4, 2.8), rot: R.range(r, 0, Math.PI) });

  const dist = Math.hypot(cup.x - tee.x, cup.z - tee.z);
  let par = Math.round(dist / 11) + (clutter.length >= 9 ? 1 : 0);
  par = Math.max(2, Math.min(4, par));

  return { index: holeIndex, floor, par, W, L, bounds, tee, cup, terrain, clutter, rats, sand, water, decals };
}
