// Procedural, seamless 256x256 textures drawn to offscreen 2D canvases at load
// time. No image files, no libs (network + credits are blocked). Deterministic
// per name so the grimy basement look is stable. Each edge-touching stamp is
// also drawn wrapped +/-256 (3x3 via wrap()) so REPEAT tiling shows no seam;
// value-noise wraps modulo a period dividing 256. Honors the STYLE FORMULA.
const SZ = 256;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function newCanvas() {
  const c = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(SZ, SZ) : document.createElement("canvas");
  c.width = SZ; c.height = SZ;
  return c;
}
function wrap(fn, x, y) { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) fn(x + dx * SZ, y + dy * SZ); }

// tileable value noise (period divides 256 so it wraps under REPEAT)
function tileNoise(seed, period, octaves) {
  const out = new Float32Array(SZ * SZ);
  let amp = 1, totalAmp = 0, p = period;
  const r = rng(seed);
  for (let o = 0; o < octaves; o++) {
    const g = new Float32Array(p * p);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const cell = SZ / p;
    for (let y = 0; y < SZ; y++) {
      const fy = y / cell, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = iy % p, y1 = (iy + 1) % p;
      for (let x = 0; x < SZ; x++) {
        const fx = x / cell, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % p, x1 = (ix + 1) % p;
        const a = g[y0 * p + x0], b = g[y0 * p + x1], c = g[y1 * p + x0], d = g[y1 * p + x1];
        const top = a + (b - a) * sx, bot = c + (d - c) * sx;
        out[y * SZ + x] += (top + (bot - top) * sy) * amp;
      }
    }
    totalAmp += amp; amp *= 0.5; p *= 2; if (p > SZ) p = SZ;
  }
  for (let i = 0; i < out.length; i++) out[i] /= totalAmp;
  return out;
}
function mottle(ctx, noise, strength, tint) {
  const img = ctx.getImageData(0, 0, SZ, SZ), d = img.data;
  for (let i = 0, n = 0; i < d.length; i += 4, n++) {
    const m = 1 + (noise[n] - 0.5) * 2 * strength;
    d[i]   = Math.max(0, Math.min(255, d[i]   * m + tint[0]));
    d[i+1] = Math.max(0, Math.min(255, d[i+1] * m + tint[1]));
    d[i+2] = Math.max(0, Math.min(255, d[i+2] * m + tint[2]));
  }
  ctx.putImageData(img, 0, 0);
}
function fill(ctx, r, g, b) { ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`; ctx.fillRect(0, 0, SZ, SZ); }

function texConcrete() {
  const c = newCanvas(), ctx = c.getContext("2d");
  fill(ctx, 44, 44, 50);
  mottle(ctx, tileNoise(hashSeed("concrete-a"), 4, 5), 0.35, [0, 0, 2]);
  mottle(ctx, tileNoise(hashSeed("concrete-b"), 16, 4), 0.18, [0, 0, 0]);
  const r = rng(hashSeed("concrete-spk"));
  for (let i = 0; i < 900; i++) {
    const x = r() * SZ, y = r() * SZ, rad = 0.4 + r() * 1.4, v = r() < 0.5 ? 22 : 70;
    ctx.fillStyle = `rgba(${v},${v},${v+4},${0.25 + r() * 0.35})`;
    wrap((px, py) => { ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill(); }, x, y);
  }
  ctx.strokeStyle = "rgba(15,15,18,0.5)"; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    let x = r() * SZ, y = r() * SZ;
    const seg = () => { ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < 10; s++) { x += (r() - 0.5) * 30; y += (r() - 0.3) * 26; ctx.lineTo(x, y); } ctx.stroke(); };
    wrap((px, py) => { const sx = x, sy = y; x = px; y = py; seg(); x = sx; y = sy; }, x, y);
  }
  return c;
}
function texIron() {
  const c = newCanvas(), ctx = c.getContext("2d");
  fill(ctx, 58, 56, 60);
  mottle(ctx, tileNoise(hashSeed("iron-base"), 8, 4), 0.22, [0, 0, 0]);
  const noise = tileNoise(hashSeed("iron-rust"), 5, 4);
  const img = ctx.getImageData(0, 0, SZ, SZ), d = img.data;
  for (let y = 0, n = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, n++) {
    const rustMask = Math.max(0, noise[n] - 0.45) * 2.6;
    if (rustMask <= 0) continue;
    const k = Math.min(1, rustMask), i = n * 4;
    d[i]   = d[i]   * (1 - k) + (110 + 40 * k) * k;
    d[i+1] = d[i+1] * (1 - k) + (55  + 10 * k) * k;
    d[i+2] = d[i+2] * (1 - k) + (28) * k;
  }
  ctx.putImageData(img, 0, 0);
  const r = rng(hashSeed("iron-pit"));
  for (let i = 0; i < 1100; i++) {
    const x = r() * SZ, y = r() * SZ, rad = 0.5 + r() * 2;
    ctx.fillStyle = `rgba(20,12,8,${0.2 + r() * 0.4})`;
    wrap((px, py) => { ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill(); }, x, y);
  }
  return c;
}
function texCardboard() {
  const c = newCanvas(), ctx = c.getContext("2d");
  fill(ctx, 92, 64, 36);
  mottle(ctx, tileNoise(hashSeed("card-fiber"), 32, 3), 0.12, [0, 0, 0]);
  const period = 16;
  for (let x = 0; x < SZ; x++) {
    const ph = (x % period) / period, shade = Math.sin(ph * Math.PI * 2);
    ctx.fillStyle = `rgba(${shade > 0 ? 255 : 0},${shade > 0 ? 230 : 0},${shade > 0 ? 200 : 0},${Math.abs(shade) * 0.12})`;
    ctx.fillRect(x, 0, 1, SZ);
  }
  const r = rng(hashSeed("card-stain"));
  for (let i = 0; i < 6; i++) {
    const x = r() * SZ, y = r() * SZ, rad = 18 + r() * 40;
    wrap((px, py) => {
      const g = ctx.createRadialGradient(px, py, rad * 0.3, px, py, rad);
      g.addColorStop(0, "rgba(50,30,14,0.0)"); g.addColorStop(0.8, "rgba(40,22,10,0.30)"); g.addColorStop(1, "rgba(60,38,18,0.0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
    }, x, y);
  }
  return c;
}
function texFelt() {
  const c = newCanvas(), ctx = c.getContext("2d");
  fill(ctx, 31, 64, 36);
  mottle(ctx, tileNoise(hashSeed("felt-nap"), 64, 2), 0.10, [0, 0, 0]);
  mottle(ctx, tileNoise(hashSeed("felt-wear"), 6, 3), 0.20, [-4, -2, -6]);
  const r = rng(hashSeed("felt-grime"));
  for (let i = 0; i < 2600; i++) {
    const x = r() * SZ, y = r() * SZ, dark = r() < 0.7;
    ctx.fillStyle = dark ? `rgba(12,28,14,${0.2 + r() * 0.3})` : `rgba(60,90,55,${0.15 + r() * 0.2})`;
    wrap((px, py) => ctx.fillRect(px, py, 1, 1), x, y);
  }
  return c;
}
function texWood() {
  const c = newCanvas(), ctx = c.getContext("2d");
  fill(ctx, 48, 32, 20);
  const warp = tileNoise(hashSeed("wood-warp"), 8, 3);
  const img = ctx.getImageData(0, 0, SZ, SZ), d = img.data;
  for (let y = 0, n = 0; y < SZ; y++) for (let x = 0; x < SZ; x++, n++) {
    const i = n * 4, wy = y + (warp[n] - 0.5) * 14, ring = Math.sin(wy * 0.55) * 0.5 + 0.5, g = (ring * 0.5 + 0.5);
    d[i] *= 0.7 + g * 0.6; d[i+1] *= 0.7 + g * 0.55; d[i+2] *= 0.7 + g * 0.5;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = "rgba(10,6,3,0.7)";
  for (let y = 0; y < SZ; y += 64) ctx.fillRect(0, y, SZ, 1.5);
  const r = rng(hashSeed("wood-knot"));
  for (let i = 0; i < 5; i++) {
    const x = r() * SZ, y = r() * SZ, rad = 3 + r() * 5;
    wrap((px, py) => {
      const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, "rgba(8,5,3,0.8)"); g.addColorStop(1, "rgba(8,5,3,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, rad, 0, 7); ctx.fill();
    }, x, y);
  }
  return c;
}
function texBlood() {
  const c = newCanvas(), ctx = c.getContext("2d");
  ctx.clearRect(0, 0, SZ, SZ);
  const r = rng(hashSeed("blood"));
  const blob = (x, y, rad, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(95,6,8,${a})`); g.addColorStop(0.7, `rgba(70,3,5,${a * 0.85})`); g.addColorStop(1, "rgba(40,0,2,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
  };
  blob(128, 128, 70, 0.95);
  for (let i = 0; i < 24; i++) { const ang = r() * 7, dist = 30 + r() * 90; blob(128 + Math.cos(ang) * dist, 128 + Math.sin(ang) * dist, 3 + r() * 14, 0.7 + r() * 0.3); }
  for (let i = 0; i < 40; i++) { const x = r() * SZ, y = r() * SZ; ctx.fillStyle = `rgba(80,4,6,${0.5 + r() * 0.4})`; ctx.beginPath(); ctx.arc(x, y, 0.6 + r() * 1.8, 0, 7); ctx.fill(); }
  return c;
}

export const TEX_BUILDERS = {
  concrete: texConcrete, iron: texIron, cardboard: texCardboard,
  felt: texFelt, wood: texWood, blood: texBlood,
};
