// Pure-logic smoke test (no browser): v3 course generation + elevation.
import { genHole, terrainHeight, terrainSlope } from "../js/course.js";
import { mulberry32, holeRng } from "../js/rng.js";
import { BALLS, SHOP_POOL } from "../js/balls.js";

let fail = 0;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); fail++; } };

// determinism
const a = genHole(12345, 3), b = genHole(12345, 3);
assert(JSON.stringify(a) === JSON.stringify(b), "genHole deterministic for same seed/index");
assert(JSON.stringify(a) !== JSON.stringify(genHole(12345, 4)), "different index yields different hole");

for (let seed = 1; seed <= 5; seed++) {
  for (let i = 0; i < 14; i++) {
    const h = genHole(seed * 777, i);
    assert(h.par >= 2 && h.par <= 4, `par in [2,4] got ${h.par}`);
    assert(h.clutter.length >= 1, "clutter present");
    assert(h.rats.length >= 2 && h.rats.length <= 4, `rats 2..4 got ${h.rats.length}`);
    assert(h.terrain && h.terrain.mounds.length >= 1, "terrain has mounds");
    assert(typeof h.tee.y === "number" && typeof h.cup.y === "number", "tee/cup have elevation y");
    assert(h.floor === i + 1, "floor = index+1");
    // tee/cup lane kept clear of clutter
    const clear = h.clutter.every(o => Math.hypot(h.tee.x - o.x, h.tee.z - o.z) > 2 && Math.hypot(h.cup.x - o.x, h.cup.z - o.z) > 2);
    assert(clear, `tee/cup lane clear (seed ${seed} hole ${i})`);
    // every clutter item sits inside bounds and has a terrain y
    assert(h.clutter.every(o => typeof o.y === "number" && o.x > h.bounds.minX && o.x < h.bounds.maxX), "clutter inside bounds w/ y");
    // light props are knockable, heavy are not
    assert(h.clutter.some(o => o.light) || h.clutter.length < 2, "has at least one knockable light prop");
  }
}

// elevation: height continuous & gradient matches finite difference
{
  const h = genHole(999, 6), t = h.terrain, out = { gx: 0, gz: 0 };
  const eps = 1e-3; let maxErr = 0;
  for (let k = 0; k < 200; k++) {
    const x = (Math.sin(k) * h.W) / 3, z = (Math.cos(k * 1.7) * h.L) / 3 + h.L / 2;
    terrainSlope(t, x, z, out);
    const fdx = (terrainHeight(t, x + eps, z) - terrainHeight(t, x - eps, z)) / (2 * eps);
    const fdz = (terrainHeight(t, x, z + eps) - terrainHeight(t, x, z - eps)) / (2 * eps);
    maxErr = Math.max(maxErr, Math.abs(fdx - out.gx), Math.abs(fdz - out.gz));
    assert(Number.isFinite(terrainHeight(t, x, z)), "height finite");
  }
  assert(maxErr < 1e-2, `analytic gradient matches finite-diff (maxErr ${maxErr.toExponential(2)})`);
}

// balls
assert(BALLS.range.price === 0, "starter ball is free");
assert(SHOP_POOL.length === 5 && !SHOP_POOL.includes("range"), "shop pool is the 5 upgrades");
for (const k in BALLS) assert(BALLS[k].mods && typeof BALLS[k].mods.sinkR === "number", `${k} has mods`);

// rng
const r = mulberry32(42); let mn = 1, mx = 0;
for (let i = 0; i < 10000; i++) { const v = r(); mn = Math.min(mn, v); mx = Math.max(mx, v); }
assert(mn < 0.01 && mx > 0.99, "rng covers [0,1)");
assert(holeRng(1, 0)() !== holeRng(1, 1)(), "holeRng differs by index");

console.log(fail === 0 ? "ALL LOGIC TESTS PASSED" : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
