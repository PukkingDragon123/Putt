// Pure-logic smoke test (no browser): course generation + determinism.
import { genHole } from "../js/course.js";
import { mulberry32, holeRng } from "../js/rng.js";

let fail = 0;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); fail++; } };

// determinism: same seed -> identical hole
const a = genHole(12345, 3), b = genHole(12345, 3);
assert(JSON.stringify(a) === JSON.stringify(b), "genHole deterministic for same seed/index");

// different index -> different hole (very likely)
const c = genHole(12345, 4);
assert(JSON.stringify(a) !== JSON.stringify(c), "different index yields different hole");

// structural checks across many floors
for (let seed = 1; seed <= 5; seed++) {
  for (let i = 0; i < 14; i++) {
    const h = genHole(seed * 777, i);
    assert(h.par >= 2 && h.par <= 4, `par in [2,4] (seed ${seed} hole ${i}) got ${h.par}`);
    assert(h.chamber.length >= 2, `chamber non-trivial (got ${h.chamber.length})`);
    assert(h.blankCount >= 1, "at least one blank shell");
    assert(h.liveCount >= 1, "at least one live shell");
    assert(h.liveCount + h.blankCount === h.chamber.length, "shell counts add up");
    // tee and cup inside bounds with margin
    assert(h.tee.x > h.bounds.minX && h.tee.x < h.bounds.maxX, "tee in x bounds");
    assert(h.cup.z > h.bounds.minZ && h.cup.z < h.bounds.maxZ, "cup in z bounds");
    // tee/cup not buried in an obstacle
    const clearOf = (arr, kx = "x", kz = "z") => arr.every(o =>
      Math.hypot(h.tee.x - o[kx], h.tee.z - o[kz]) > 2 && Math.hypot(h.cup.x - o[kx], h.cup.z - o[kz]) > 2);
    assert(clearOf(h.boxes) && clearOf(h.pillars) && clearOf(h.mines), `tee/cup lane clear (seed ${seed} hole ${i})`);
    // live ratio grows with depth (monotone-ish, not strict)
    assert(h.floor === i + 1, "floor = index+1");
  }
}

// liveRatio escalation sanity: deep holes generally hotter than shallow
let shallowLive = 0, deepLive = 0;
for (let s = 0; s < 40; s++) { shallowLive += genHole(s, 0).liveCount / genHole(s, 0).chamber.length; deepLive += genHole(s, 11).liveCount / genHole(s, 11).chamber.length; }
assert(deepLive > shallowLive, `deep floors hotter (shallow ${(shallowLive/40).toFixed(2)} deep ${(deepLive/40).toFixed(2)})`);

// rng spread
const r = mulberry32(42); let min = 1, max = 0;
for (let i = 0; i < 10000; i++) { const v = r(); min = Math.min(min, v); max = Math.max(max, v); }
assert(min < 0.01 && max > 0.99, "rng covers [0,1)");
assert(holeRng(1, 0)() !== holeRng(1, 1)(), "holeRng differs by index");

console.log(fail === 0 ? "ALL LOGIC TESTS PASSED" : `${fail} FAILURES`);
process.exit(fail ? 1 : 0);
