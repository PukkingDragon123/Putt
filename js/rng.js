// Seeded, deterministic RNG (mulberry32) — same seed, same run (§12.1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a hole RNG from a run seed and a hole index — independent per hole.
export function holeRng(runSeed, holeIndex) {
  return mulberry32((runSeed ^ Math.imul(holeIndex + 1, 2654435761)) >>> 0);
}

export const rngHelpers = {
  range: (r, lo, hi) => lo + (hi - lo) * r(),
  int: (r, lo, hi) => Math.floor(lo + (hi - lo + 1) * r()),
  pick: (r, arr) => arr[Math.floor(r() * arr.length)],
  chance: (r, p) => r() < p,
  shuffle: (r, arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },
};
