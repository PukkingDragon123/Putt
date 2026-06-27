// PUTT OR DIE (v3) — golf-money roguelike in the Dealer's basement.
// Deterministic fixed-step sim, elevation/slope physics on a displaced green,
// realistic clutter + knockable props + rats, a money economy with a homeless
// shopkeeper selling better balls. Logic split from rendering (§6.4).
import { Renderer } from "./gl.js";
import { Audio } from "./audio.js";
import { genHole, terrainHeight, terrainSlope, BALL_R } from "./course.js";
import { BALLS, SHOP_POOL } from "./balls.js";
import { mulberry32 } from "./rng.js";
import { mat4 } from "./math.js";
import { STR } from "../strings.js";

// ---- tuning (design/thresholds.md) ----
const STEP = 1000 / 60, DT = STEP / 1000;
const MAX_PUTT = 26, ROLL_FRICTION = 1.6, SAND_FRICTION = 7.5, DAMP = 0.992;
const STOP_EPS = 0.3, SINK_SPEED = 10, RESTITUTION = 0.62, AIM_SPEED = 2.2, POWER_PERIOD = 1.1;
const CAM_DIST = 8.5, CAM_HEIGHT = 6.2, LOOK_AHEAD = 2.5, LOOK_HEIGHT = 0.5;
const ROOM_H = 8.0, CEIL_Y = 8.4;
const GRAVITY_ROLL = 16, SLOPE_FRICTION = 0.9;
const PROP_FRICTION = 7, PROP_DAMP = 0.985, PROP_BOUNCE = 0.3, PROP_SETTLE = 0.15;
const START_MONEY = 30, SHOP_EVERY = 2, FEE_BASE = 4, FEE_STEP = 3, STROKE_CAP = 3;
const PAYOUT = { ace: 40, eagle: 28, birdie: 18, par: 10, bogey: -8, double: -14, lost: -22 };
const GREEN_SEG = 28;

// ---- palette (neutral 0.5 = texture shows through uColor*texel*2; tinted = lit color) ----
const COL = {
  felt: [0.62, 0.82, 0.6], floor: [0.42, 0.42, 0.48], ball: [0.86, 0.84, 0.78],
  flag: [0.72, 0.06, 0.06], pole: [0.3, 0.3, 0.32], cup: [0.015, 0.015, 0.02],
  aim: [0.95, 0.82, 0.3], water: [0.04, 0.12, 0.18], sand: [0.46, 0.4, 0.24],
  concrete: [0.84, 0.84, 0.9], ceiling: [0.52, 0.52, 0.6], cord: [0.05, 0.05, 0.05],
  bulb: [1.0, 0.86, 0.62], drain: [0.06, 0.06, 0.07], steel: [0.5, 0.5, 0.56],
  wood: [0.66, 0.56, 0.44], iron: [0.66, 0.6, 0.56], cardboard: [0.7, 0.62, 0.5],
  rustHot: [0.55, 0.16, 0.07], rat: [0.16, 0.13, 0.12], shadow: [0.0, 0.0, 0.0],
  oil: [0.18, 0.14, 0.12], dust: [0.6, 0.58, 0.5],
};
const TEXNAME = { wood: "wood", iron: "iron", cardboard: "cardboard", concrete: "concrete" };

export class Game {
  constructor(canvas, els) {
    this.canvas = canvas; this.els = els;
    this.renderer = new Renderer(canvas);
    this.renderer.loadPrimitives();
    this.renderer.loadTextures();
    this.TEX = this.renderer.textures;
    this.renderer.resize();
    this.renderer.setJitter(220);
    this.audio = new Audio();
    this.proj = mat4.create(); this.view = mat4.create(); this.vp = mat4.create();
    this._uv = [1, 1]; this._uv1 = [1, 1]; this._slope = { gx: 0, gz: 0 };
    this._eye = [0, 0, 0]; this._ctr = [0, 0, 0]; this._up = [0, 1, 0];
    this.cam = { ex: 0, ey: 10, ez: -10, tx: 0, ty: 0, tz: 0 };
    this.shake = 0; this.flash = 0; this.simTime = 0; this.greenMesh = null;
    this.dust = Array.from({ length: 10 }, () => ({ x: 0, y: 0, z: 0, life: 0, s: 1 }));
    this.aimHeld = { left: false, right: false }; this._padA = false; this.sinkAnim = 0; this.rollTime = 0;
    this.best = parseInt(localStorage.getItem("putt_best") || "0", 10) || 0;
    this.state = "title";
    this.bindInput();
    this.newRun();
    this.state = "title";
    this.updateHUD();
    this.showOverlay("title");
  }

  rand() { return this.runRng(); }
  groundY(x, z) { return terrainHeight(this.hole.terrain, x, z); }

  // ---------- run / hole ----------
  newRun() {
    this.runSeed = (Math.random() * 4294967296) >>> 0;
    this.runRng = mulberry32(this.runSeed);
    this.money = START_MONEY; this.depth = 0; this.holeIndex = 0;
    this.owned = new Set(["range"]); this.applyBall("range");
    this.setupHole();
  }
  applyBall(key) { this.ballKey = key; this.mods = BALLS[key].mods; }

  setupHole() {
    this.hole = genHole(this.runSeed, this.holeIndex);
    this.floor = this.hole.floor; this.strokes = 0; this.sinkAnim = 0;
    this.buildGreenMesh();
    const t = this.hole.tee;
    this.ball = { x: t.x, z: t.z, y: this.groundY(t.x, t.z) + BALL_R, vx: 0, vz: 0, roll: 0 };
    this.lastRest = { x: t.x, z: t.z };
    const c = this.hole.cup;
    this.aimAngle = Math.atan2(c.z - t.z, c.x - t.x);
    for (const d of this.dust) d.life = 0;
    this.snapCamera();
    this.state = "aiming";
    this.bark(STR.dealer);
    this.hideOverlays();
    this.updateHUD();
  }
  nextHole() { this.holeIndex++; this.setupHole(); }

  buildGreenMesh() {
    const h = this.hole, t = h.terrain, b = h.bounds, seg = GREEN_SEG;
    const P = [], N = [], U = [], sl = { gx: 0, gz: 0 };
    const vert = (x, z) => {
      terrainSlope(t, x, z, sl);
      const nx = -sl.gx, nz = -sl.gz, l = Math.hypot(nx, 1, nz) || 1;
      P.push(x, terrainHeight(t, x, z), z);
      N.push(nx / l, 1 / l, nz / l);
      U.push((x - b.minX) / 3, (z - b.minZ) / 3);
    };
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
      const x0 = b.minX + (b.maxX - b.minX) * i / seg, x1 = b.minX + (b.maxX - b.minX) * (i + 1) / seg;
      const z0 = b.minZ + (b.maxZ - b.minZ) * j / seg, z1 = b.minZ + (b.maxZ - b.minZ) * (j + 1) / seg;
      vert(x0, z0); vert(x1, z0); vert(x1, z1);
      vert(x0, z0); vert(x1, z1); vert(x0, z1);
    }
    this.renderer.freeMesh(this.greenMesh);
    this.greenMesh = this.renderer.buildDynamicMesh(P, N, U);
  }

  // ---------- flow ----------
  start() { if (this.state !== "title") return; this.audio.resume(); this.audio.ensure(); this.audio.ambientStart(); this.state = "aiming"; this.hideOverlays(); this.updateHUD(); }
  restart() { if (this.state !== "over") return; this.newRun(); this.audio.ambientStart(); }
  onAction() {
    if (this.state === "title") this.start();
    else if (this.state === "aiming") this.beginCharge();
    else if (this.state === "charging") this.lockPutt();
    else if (this.state === "over") this.restart();
  }
  beginCharge() { this.state = "charging"; this.chargeT = 0; this.power = 0; this.audio.resume(); }
  lockPutt() {
    if (this.state !== "charging") return;
    const a = this.aimAngle, speed = (0.15 + this.power * 0.85) * MAX_PUTT * this.mods.powerMax;
    this.ball.vx = Math.cos(a) * speed; this.ball.vz = Math.sin(a) * speed;
    this.strokes++; this.state = "rolling"; this.rollTime = 0; this.shake = Math.max(this.shake, 0.15 * this.power);
    this.audio.putt(this.power); this.els.power.classList.remove("show"); this.updateHUD();
  }

  // ---------- fixed-step update ----------
  update() {
    this.simTime += DT;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - DT * 2.2);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - DT * 2.5);
    if (this.sinkAnim > 0) this.sinkAnim = Math.max(0, this.sinkAnim - DT);
    for (const d of this.dust) if (d.life > 0) { d.life -= DT; d.y += DT * 0.6; d.s += DT * 1.5; }
    if (this.hole) { this.stepProps(); this.updateRats(); }
    if (this.state === "aiming") {
      const d = (this.aimHeld.right ? 1 : 0) - (this.aimHeld.left ? 1 : 0);
      if (d) this.aimAngle += d * AIM_SPEED * DT;
    } else if (this.state === "charging") {
      this.chargeT += DT; const ph = (this.chargeT % POWER_PERIOD) / POWER_PERIOD;
      this.power = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    } else if (this.state === "rolling") this.stepBall();
  }

  stepBall() {
    const b = this.ball, h = this.hole, t = h.terrain;
    // safety guard: a stroke must always terminate, whatever the terrain does
    this.rollTime += DT;
    if (this.rollTime > 18) { b.vx = 0; b.vz = 0; this.endRoll("stopped"); return; }
    // slope acceleration (downhill) + friction
    terrainSlope(t, b.x, b.z, this._slope);
    const gx = this._slope.gx, gz = this._slope.gz, gmag = Math.hypot(gx, gz);
    b.vx += -GRAVITY_ROLL * gx * DT; b.vz += -GRAVITY_ROLL * gz * DT;
    let speed = Math.hypot(b.vx, b.vz);
    if (speed > 0) {
      const f = (this.inSand(b.x, b.z) ? SAND_FRICTION : ROLL_FRICTION) * this.mods.frict + SLOPE_FRICTION * gmag;
      let ns = speed - f * DT; if (ns < 0) ns = 0;
      b.vx *= ns / speed; b.vz *= ns / speed; b.vx *= DAMP; b.vz *= DAMP;
    }
    b.x += b.vx * DT; b.z += b.vz * DT;
    b.y = terrainHeight(t, b.x, b.z) + BALL_R;
    b.roll += Math.hypot(b.vx, b.vz) * DT * 1.6;

    const bn = h.bounds;
    if (b.x < bn.minX + BALL_R) { b.x = bn.minX + BALL_R; b.vx = -b.vx * RESTITUTION; this.clack(); }
    if (b.x > bn.maxX - BALL_R) { b.x = bn.maxX - BALL_R; b.vx = -b.vx * RESTITUTION; this.clack(); }
    if (b.z < bn.minZ + BALL_R) { b.z = bn.minZ + BALL_R; b.vz = -b.vz * RESTITUTION; this.clack(); }
    if (b.z > bn.maxZ - BALL_R) { b.z = bn.maxZ - BALL_R; b.vz = -b.vz * RESTITUTION; this.clack(); }

    for (const o of h.clutter) {
      const hit = o.shape === "cyl"
        ? (() => { const dx = b.x - o.x, dz = b.z - o.z, d = Math.hypot(dx, dz), rr = o.r + BALL_R;
            return (d < rr && d > 1e-4) ? { nx: dx / d, nz: dz / d, pen: rr - d } : null; })()
        : this.circleAABB(b.x, b.z, o.x, o.z, o.w / 2, o.d / 2);
      if (!hit) continue;
      if (o.light) this.knockProp(o, hit); else this.resolveHit(hit);
    }

    for (const w of h.water) if (b.x > w.minX && b.x < w.maxX && b.z > w.minZ && b.z < w.maxZ) { this.endRoll("water"); return; }

    const sp = Math.hypot(b.vx, b.vz);
    if (sp > MAX_PUTT * 1.3) { const k = MAX_PUTT * 1.3 / sp; b.vx *= k; b.vz *= k; }
    const c = h.cup, dc = Math.hypot(b.x - c.x, b.z - c.z);
    if (dc < c.r * this.mods.sinkR * 0.95 && sp < SINK_SPEED) { this.endRoll("sunk"); return; }
    if (sp < STOP_EPS) { b.vx = 0; b.vz = 0; this.endRoll("stopped"); }
  }

  circleAABB(cx, cz, bx, bz, hw, hd) {
    const qx = Math.max(bx - hw, Math.min(cx, bx + hw)), qz = Math.max(bz - hd, Math.min(cz, bz + hd));
    let dx = cx - qx, dz = cz - qz, d2 = dx * dx + dz * dz;
    if (d2 >= BALL_R * BALL_R) return null;
    let d = Math.sqrt(d2);
    if (d > 1e-4) return { nx: dx / d, nz: dz / d, pen: BALL_R - d };
    const px = hw - Math.abs(cx - bx), pz = hd - Math.abs(cz - bz);
    return px < pz ? { nx: Math.sign(cx - bx) || 1, nz: 0, pen: px + BALL_R } : { nx: 0, nz: Math.sign(cz - bz) || 1, pen: pz + BALL_R };
  }
  resolveHit(hit) {
    const b = this.ball;
    b.x += hit.nx * hit.pen; b.z += hit.nz * hit.pen;
    const vd = b.vx * hit.nx + b.vz * hit.nz;
    if (vd < 0) { b.vx -= (1 + RESTITUTION) * vd * hit.nx; b.vz -= (1 + RESTITUTION) * vd * hit.nz; if (-vd > 2) this.clack(); }
  }
  knockProp(o, hit) {
    const b = this.ball;
    b.x += hit.nx * hit.pen; b.z += hit.nz * hit.pen;
    const vd = b.vx * hit.nx + b.vz * hit.nz; // <0 = ball moving into prop
    if (vd < 0) {
      const speed = -vd, heavy = this.mods.smash > 0 && speed >= this.mods.smash;
      const give = heavy ? 1.1 : 0.85, keep = heavy ? 0.85 : 0.45;
      o.vx += -hit.nx * speed * give; o.vz += -hit.nz * speed * give; o.settled = false;
      b.vx -= (1 - keep) * vd * hit.nx; b.vz -= (1 - keep) * vd * hit.nz;
      if (speed > 9) this.audio.clatter(); else this.clack();
    }
  }
  stepProps() {
    for (const o of this.hole.clutter) {
      if (!o.light || o.settled) continue;
      let sp = Math.hypot(o.vx, o.vz);
      if (sp > 0) { let ns = Math.max(0, sp - PROP_FRICTION * DT); o.vx *= ns / sp; o.vz *= ns / sp; o.vx *= PROP_DAMP; o.vz *= PROP_DAMP; }
      o.x += o.vx * DT; o.z += o.vz * DT; o.spin += sp * DT * 2;
      const rr = (o.shape === "cyl" ? o.r : Math.max(o.w, o.d) / 2), bn = this.hole.bounds;
      if (o.x < bn.minX + rr) { o.x = bn.minX + rr; o.vx = -o.vx * PROP_BOUNCE; }
      if (o.x > bn.maxX - rr) { o.x = bn.maxX - rr; o.vx = -o.vx * PROP_BOUNCE; }
      if (o.z < bn.minZ + rr) { o.z = bn.minZ + rr; o.vz = -o.vz * PROP_BOUNCE; }
      if (o.z > bn.maxZ - rr) { o.z = bn.maxZ - rr; o.vz = -o.vz * PROP_BOUNCE; }
      o.y = this.groundY(o.x, o.z);
      if (Math.hypot(o.vx, o.vz) < PROP_SETTLE) { o.vx = 0; o.vz = 0; o.settled = true; }
    }
  }
  updateRats() {
    const b = this.ball, bn = this.hole.bounds, rolling = this.state === "rolling";
    for (const rat of this.hole.rats) {
      const db = Math.hypot(b.x - rat.x, b.z - rat.z);
      if (rolling && db < 2.0) {
        if (!rat.spook) { rat.spook = true; this.audio.squeak(); }
        rat.state = "flee"; rat.timer = 0.9;
        const a = Math.atan2(rat.z - b.z, rat.x - b.x); rat.dir = a;
        rat.vx = Math.cos(a) * 5.4; rat.vz = Math.sin(a) * 5.4;
      }
      rat.timer -= DT;
      if (rat.state === "pause") {
        rat.vx = 0; rat.vz = 0;
        if (rat.timer <= 0) { rat.state = "move"; rat.timer = 2 + Math.random() * 2;
          const tz = rat.z + (Math.random() - 0.5) * 8, sp = 2.4 + Math.random() * 1.2;
          const a = Math.atan2(tz - rat.z, rat.home - rat.x); rat.dir = a; rat.vx = Math.cos(a) * sp; rat.vz = Math.sin(a) * sp; }
      } else if (rat.state === "move") {
        if (rat.timer <= 0) { rat.state = "pause"; rat.timer = 0.5 + Math.random() * 1.2; }
      } else { // flee
        if (rat.timer <= 0) { rat.state = "pause"; rat.timer = 0.6 + Math.random(); rat.spook = false; }
      }
      rat.x += rat.vx * DT; rat.z += rat.vz * DT;
      rat.x = Math.max(bn.minX + 0.4, Math.min(bn.maxX - 0.4, rat.x));
      rat.z = Math.max(bn.minZ + 0.4, Math.min(bn.maxZ - 0.4, rat.z));
      rat.y = this.groundY(rat.x, rat.z);
      if (rat.vx || rat.vz) rat.dir = Math.atan2(rat.vz, rat.vx);
    }
  }
  inSand(x, z) { for (const s of this.hole.sand) if (x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ) return true; return false; }
  clack() { this.audio.wall(); }
  spawnDust(x, y, z) { const d = this.dust.find(p => p.life <= 0); if (d) { d.x = x; d.y = y; d.z = z; d.life = 0.35; d.s = 0.4; } }

  // ---------- resolution ----------
  endRoll(outcome) {
    if (this.state !== "rolling") return;
    const b = this.ball;
    if (outcome === "water") {
      b.x = this.lastRest.x; b.z = this.lastRest.z; b.y = this.groundY(b.x, b.z) + BALL_R; b.vx = 0; b.vz = 0;
      this.strokes++; this.audio.splash(); this.toast(STR.splash, "warn");
      if (this.strokes >= this.hole.par + STROKE_CAP) { this.resolveScore("lost"); return; }
      this.snapCamera(); this.state = "aiming"; this.updateHUD(); return;
    }
    if (outcome === "sunk") { this.onSink(); return; }
    b.vx = 0; b.vz = 0; this.lastRest = { x: b.x, z: b.z };
    if (this.strokes >= this.hole.par + STROKE_CAP) { this.toast(STR.lostBall, "bad"); this.resolveScore("lost"); return; }
    this.state = "aiming"; this.updateHUD();
  }
  onSink() {
    this.audio.sink(); this.flash = 0.3; this.sinkAnim = 0.4; this.shake = Math.max(this.shake, 0.2);
    const diff = this.strokes - this.hole.par;
    let bucket = "par", label = STR.score.par;
    if (this.strokes === 1) { bucket = "ace"; label = STR.score.ace; }
    else if (diff <= -2) { bucket = "eagle"; label = STR.score.eagle; }
    else if (diff === -1) { bucket = "birdie"; label = STR.score.birdie; }
    else if (diff === 0) { bucket = "par"; label = STR.score.par; }
    else if (diff === 1) { bucket = "bogey"; label = STR.score.bogey; }
    else { bucket = "double"; label = STR.score.double; }
    this.resolveScore(bucket, label);
  }
  resolveScore(bucket, label) {
    const amt = PAYOUT[bucket];
    this.money += amt; this.depth++;
    const lab = label || STR.score.lost;
    this.toast(`${lab}  ${amt >= 0 ? "+$" + amt : "-$" + (-amt)}`, amt >= 0 ? "good" : "bad");
    if (amt > 0) this.audio.cash();
    this.saveBest();
    this.updateHUD();
    if (this.money < 0) { this.gameOver(); return; }
    if (this.depth % SHOP_EVERY === 0) this.openShop(); else this.descend();
  }
  descend() {
    const fee = FEE_BASE + this.depth * FEE_STEP;
    this.money -= fee; this.updateHUD();
    if (this.money < 0) { this.gameOver(); return; }
    this.nextHole();
  }
  gameOver() {
    this.state = "over"; this.saveBest();
    this.els.overStats.innerHTML = `${STR.depth} <b>${this.depth}</b> · ${STR.cash} <b>$${Math.max(0, this.money)}</b> · ${STR.best} <b>${this.best}</b>`;
    this.showOverlay("over");
  }
  saveBest() { const s = this.depth * 100 + Math.max(0, this.money); if (s > this.best) { this.best = s; localStorage.setItem("putt_best", String(s)); } }

  // ---------- shop ----------
  openShop() {
    this.state = "shop";
    const pool = SHOP_POOL.filter(k => !this.owned.has(k));
    const n = pool.length <= 2 ? pool.length : (this.rand() < 0.5 ? 2 : 3);
    const stock = []; const p = pool.slice();
    for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let i = 0; i < n; i++) stock.push(p[i]);
    this._stock = stock;
    this.els.shopBark.textContent = STR.shopBarks[Math.floor(this.rand() * STR.shopBarks.length)];
    this.renderShop();
    this.showOverlay("shop");
  }
  renderShop() {
    const fee = FEE_BASE + this.depth * FEE_STEP;
    this.els.shopCash.innerHTML = `${STR.cash} <b>$${this.money}</b>`;
    this.els.shopDescend.textContent = STR.descend.replace("%n", fee);
    this.els.shopCards.innerHTML = "";
    for (const key of this._stock) {
      const ball = BALLS[key], card = document.createElement("button");
      const owned = this.owned.has(key), afford = this.money >= ball.price;
      card.className = "card" + (this.ballKey === key ? " equipped" : "");
      card.disabled = owned || !afford;
      card.innerHTML = `<div class="cg">${ball.glyph}</div><div class="cn">${ball.name}</div>` +
        `<div class="cs">${ball.blurb}</div><div class="cp">${owned ? STR.owned : "$" + ball.price}</div>`;
      card.onclick = () => this.buyBall(key);
      this.els.shopCards.appendChild(card);
    }
  }
  buyBall(key) {
    const ball = BALLS[key];
    if (this.owned.has(key) || this.money < ball.price) return;
    this.money -= ball.price; this.owned.add(key); this.applyBall(key); this.audio.cash();
    this.updateHUD(); this.renderShop();
  }

  bark(lines) { const l = lines[Math.floor(this.rand() * lines.length)]; const d = this.els.dealer; d.textContent = l; d.classList.remove("show"); void d.offsetWidth; d.classList.add("show"); }

  // ---------- camera ----------
  desiredCam() {
    const b = this.ball, dx = Math.cos(this.aimAngle), dz = Math.sin(this.aimAngle);
    return { ex: b.x - dx * CAM_DIST, ey: CAM_HEIGHT + b.y * 0.5, ez: b.z - dz * CAM_DIST,
      tx: b.x + dx * LOOK_AHEAD, ty: LOOK_HEIGHT + b.y, tz: b.z + dz * LOOK_AHEAD };
  }
  snapCamera() { Object.assign(this.cam, this.desiredCam()); }

  // ---------- render ----------
  render() {
    const R = this.renderer, M = R.meshes, h = this.hole, T = this.TEX, uv = this._uv, bn = h.bounds, cz = bn.maxZ / 2;
    if (this.state === "title") {
      const t = h.tee, sway = Math.sin(this.simTime * 0.4) * 0.28, dx = Math.cos(this.aimAngle + sway), dz = Math.sin(this.aimAngle + sway);
      this.cam.ex = t.x - dx * CAM_DIST; this.cam.ey = CAM_HEIGHT - 1.0 + t.y * 0.5; this.cam.ez = t.z - dz * CAM_DIST;
      this.cam.tx = t.x + dx * 8; this.cam.ty = LOOK_HEIGHT + t.y; this.cam.tz = t.z + dz * 8;
    } else {
      const d = this.desiredCam(), k = 0.16;
      this.cam.ex += (d.ex - this.cam.ex) * k; this.cam.ey += (d.ey - this.cam.ey) * k; this.cam.ez += (d.ez - this.cam.ez) * k;
      this.cam.tx += (d.tx - this.cam.tx) * k; this.cam.ty += (d.ty - this.cam.ty) * k; this.cam.tz += (d.tz - this.cam.tz) * k;
    }
    this.cam.ex = Math.max(bn.minX + 0.5, Math.min(bn.maxX - 0.5, this.cam.ex));
    this.cam.ez = Math.min(bn.maxZ - 0.5, this.cam.ez);
    const sh = this.shake, sx = sh ? (Math.random() - 0.5) * sh : 0, sy = sh ? (Math.random() - 0.5) * sh : 0;
    this._eye[0] = this.cam.ex + sx; this._eye[1] = this.cam.ey + sy; this._eye[2] = this.cam.ez;
    this._ctr[0] = this.cam.tx; this._ctr[1] = this.cam.ty; this._ctr[2] = this.cam.tz;
    mat4.perspective(this.proj, 1.05, R.aspect || 1.6, 0.1, 200);
    mat4.lookAt(this.view, this._eye, this._ctr, this._up);
    mat4.multiply(this.vp, this.proj, this.view);
    R.beginFrame(this.vp, this._eye[0], this._eye[1], this._eye[2], this.simTime);

    // surrounding concrete floor + the displaced textured green
    uv[0] = (h.W + 40) / 4; uv[1] = (h.L + 40) / 4;
    R.draw(M.plane, 0, -0.06, cz, 0, h.W + 40, 1, h.L + 40, COL.floor, 0, T.concrete, uv);
    R.draw(this.greenMesh, 0, 0, 0, 0, 1, 1, 1, COL.felt, 0, T.felt, this._uv1);

    // grime/oil decals + hazards (on the terrain), blended
    R.blend(true);
    for (const dc of h.decals) { this._uv1[0] = 1; this._uv1[1] = 1; R.draw(M.plane, dc.x, this.groundY(dc.x, dc.z) + 0.02, dc.z, dc.rot, dc.s, 1, dc.s, COL.oil, 0, T.blood, this._uv1); }
    R.blend(false);
    for (const s of h.sand) { const mx = (s.minX + s.maxX) / 2, mz = (s.minZ + s.maxZ) / 2; R.draw(M.plane, mx, this.groundY(mx, mz) + 0.03, mz, 0, s.maxX - s.minX, 1, s.maxZ - s.minZ, COL.sand, 0); }
    for (const w of h.water) { const mx = (w.minX + w.maxX) / 2, mz = (w.minZ + w.maxZ) / 2; R.draw(M.plane, mx, this.groundY(mx, mz) + 0.03, mz, 0, w.maxX - w.minX, 1, w.maxZ - w.minZ, COL.water, 0.22 + 0.1 * Math.sin(this.simTime * 2)); }

    // basement room: tall side+far walls + low curbs + dark ceiling
    uv[0] = (h.L + 2) / 4; uv[1] = ROOM_H / 4;
    R.draw(M.box, bn.minX - 0.6, ROOM_H / 2, cz, 0, 0.6, ROOM_H, h.L + 2, COL.concrete, 0, T.concrete, uv);
    R.draw(M.box, bn.maxX + 0.6, ROOM_H / 2, cz, 0, 0.6, ROOM_H, h.L + 2, COL.concrete, 0, T.concrete, uv);
    uv[0] = (h.W + 2) / 4; uv[1] = ROOM_H / 4;
    R.draw(M.box, 0, ROOM_H / 2, bn.maxZ + 0.6, 0, h.W + 2, ROOM_H, 0.6, COL.concrete, 0, T.concrete, uv);
    uv[0] = (h.W + 2) / 4; uv[1] = (h.L + 2) / 4;
    R.draw(M.plane, 0, CEIL_Y, cz, 0, h.W + 2, 1, h.L + 2, COL.ceiling, 0, T.concrete, uv);
    const cu = 0.55; uv[0] = (h.L + 1) / 3; uv[1] = 1;
    R.draw(M.box, bn.minX - 0.25, cu / 2, cz, 0, 0.5, cu, h.L + 1, COL.concrete, 0, T.concrete, uv);
    R.draw(M.box, bn.maxX + 0.25, cu / 2, cz, 0, 0.5, cu, h.L + 1, COL.concrete, 0, T.concrete, uv);
    uv[0] = (h.W + 1) / 3;
    R.draw(M.box, 0, cu / 2, bn.minZ - 0.25, 0, h.W + 1, cu, 0.5, COL.concrete, 0, T.concrete, uv);
    R.draw(M.box, 0, cu / 2, bn.maxZ + 0.25, 0, h.W + 1, cu, 0.5, COL.concrete, 0, T.concrete, uv);

    // swinging bulb + drain
    { const swing = Math.sin(this.simTime * 1.3) * 0.5, cordLen = 2.6, pY = CEIL_Y - 0.1, bx = Math.sin(swing) * cordLen, by = pY - Math.cos(swing) * cordLen;
      R.draw(M.cyl, bx / 2, (pY + by) / 2, cz, 0, 0.04, cordLen, 0.04, COL.cord, 0);
      R.draw(M.ball, bx, by, cz, 0, 0.5, 0.5, 0.5, COL.bulb, 0.95); }
    R.draw(M.cyl, h.tee.x + 1.5, this.groundY(h.tee.x + 1.5, h.tee.z + 1) - 0.16, h.tee.z + 1, 0, 0.9, 0.4, 0.9, COL.drain, 0);

    // cup recessed into the terrain + flag
    const c = h.cup;
    R.draw(M.cyl, c.x, c.y - 0.3, c.z, 0, c.r * 2, 0.6, c.r * 2, COL.cup, 0);
    R.draw(M.cyl, c.x, c.y + 1.25, c.z, 0, 0.08, 2.5, 0.08, COL.pole, 0);
    R.draw(M.box, c.x + 0.45, c.y + 2.1, c.z, 0, 0.9, 0.55, 0.08, COL.flag, 0.25);

    this.drawClutter(); this.drawRats();

    // ball shadow (blended dark disc on the terrain)
    R.blend(true);
    this._uv1[0] = 1; this._uv1[1] = 1;
    R.draw(M.cyl, this.ball.x, this.groundY(this.ball.x, this.ball.z) + 0.02, this.ball.z, 0, BALL_R * 2.3, 0.02, BALL_R * 2.3, COL.shadow, 0);
    for (const d of this.dust) if (d.life > 0) R.draw(M.ball, d.x, d.y, d.z, 0, d.s * 0.4, d.s * 0.4, d.s * 0.4, COL.dust, 0.2);
    R.blend(false);

    // aim indicator (length scaled by the equipped ball's guide)
    if (this.state === "aiming" || this.state === "charging") {
      const dx = Math.cos(this.aimAngle), dz = Math.sin(this.aimAngle), pw = this.state === "charging" ? this.power : 0.45;
      const len = (2 + pw * 6) * this.mods.aimGuide, gy = this.groundY(this.ball.x, this.ball.z) + 0.06;
      R.draw(M.box, this.ball.x + dx * (len / 2 + BALL_R), gy, this.ball.z + dz * (len / 2 + BALL_R), -this.aimAngle, len, 0.06, 0.16, COL.aim, 0.6);
    }

    // the ball (drops into the cup during the sink animation)
    const drop = this.sinkAnim > 0 ? (1 - this.sinkAnim / 0.4) * 0.45 : 0;
    R.draw(M.ball, this.ball.x, this.ball.y - drop, this.ball.z, this.ball.roll, BALL_R * 2, BALL_R * 2, BALL_R * 2, BALLS[this.ballKey].color, BALLS[this.ballKey].emissive);

    R.present(this.simTime);
    this.els.flash.style.opacity = this.flash ? Math.min(0.55, this.flash) : 0;
    if (this.state === "charging") { this.els.power.classList.add("show"); this.els.powerFill.style.width = (this.power * 100) + "%"; }
  }

  drawClutter() {
    const R = this.renderer, M = R.meshes, T = this.TEX, uv = this._uv;
    for (const o of this.hole.clutter) {
      const tex = T[o.tex], ry = o.yaw + (o.spin || 0), baseY = o.y;
      if (o.shape === "box") {
        uv[0] = o.w; uv[1] = o.h;
        if (o.kind === "pipe") R.draw(M.box, o.x, baseY + o.h / 2, o.z, ry, o.w, o.h, o.d, COL[o.tex] || COL.iron, 0, tex, uv);
        else { R.draw(M.box, o.x, baseY + o.h / 2, o.z, ry, o.w, o.h, o.d, COL[o.tex] || COL.wood, 0, tex, uv);
          if (o.kind === "crate") R.draw(M.box, o.x, baseY + o.h + 0.04, o.z, ry, o.w * 0.7, 0.08, o.d * 0.7, COL.wood, 0, tex, uv); }
      } else { // cyl
        uv[0] = 3; uv[1] = o.h;
        R.draw(M.cyl, o.x, baseY + o.h / 2, o.z, ry, o.r * 2, o.h, o.r * 2, COL[o.tex] || COL.iron, 0, tex, uv);
        if (o.kind === "drum") { R.draw(M.cyl, o.x, baseY + o.h * 0.78, o.z, 0, o.r * 2.05, o.h * 0.07, o.r * 2.05, COL.rustHot, 0.16); R.draw(M.cyl, o.x, baseY + o.h * 0.28, o.z, 0, o.r * 2.05, o.h * 0.07, o.r * 2.05, COL.rustHot, 0.16); }
        if (o.kind === "heater") R.draw(M.cyl, o.x, baseY + o.h, o.z, 0, o.r * 1.4, 0.3, o.r * 1.4, COL.steel, 0.05);
        if (o.kind === "paint") R.draw(M.cyl, o.x, baseY + o.h + 0.03, o.z, 0, o.r * 2.1, 0.06, o.r * 2.1, COL.steel, 0.04);
      }
    }
  }
  drawRats() {
    const R = this.renderer, M = R.meshes;
    for (const rat of this.hole.rats) {
      const bob = Math.abs(Math.sin(this.simTime * 14 + rat.phase)) * 0.06, y = rat.y + 0.11 + bob, dir = rat.dir;
      R.draw(M.box, rat.x, y, rat.z, -dir, 0.46, 0.22, 0.26, COL.rat, 0);
      R.draw(M.box, rat.x + Math.cos(dir) * 0.26, y + 0.02, rat.z + Math.sin(dir) * 0.26, -dir, 0.2, 0.2, 0.2, COL.rat, 0);
      R.draw(M.box, rat.x - Math.cos(dir) * 0.3, y, rat.z - Math.sin(dir) * 0.3, -dir, 0.34, 0.05, 0.05, COL.rat, 0);
    }
  }

  // ---------- HUD ----------
  updateHUD() {
    const e = this.els;
    e.money.innerHTML = `<b>$${this.money}</b>`;
    e.status.innerHTML = `${STR.hud.floor} <b>${this.floor}</b> · ${STR.hud.par} <b>${this.hole.par}</b> · ${STR.hud.stroke} <b>${this.strokes}</b>`;
    e.score.innerHTML = `${STR.hud.ball} <b>${BALLS[this.ballKey].name}</b> · ${STR.depth} <b>${this.depth}</b> · ${STR.best} <b>${this.best}</b>`;
  }
  toast(text, kind) { const t = document.createElement("div"); t.className = "toast " + (kind || ""); t.textContent = text; this.els.toast.appendChild(t); setTimeout(() => t.remove(), 1900); }
  showOverlay(which) { this.hideOverlays(); if (this.els[which]) this.els[which].classList.add("show"); }
  hideOverlays() { for (const k of ["title", "shop", "over"]) this.els[k].classList.remove("show"); }

  // ---------- input ----------
  bindInput() {
    const AIM = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
    addEventListener("keydown", (e) => {
      if (AIM[e.code]) { this.aimHeld[AIM[e.code]] = true; e.preventDefault(); return; }
      if (e.code === "Space" || e.code === "Enter") { if (!e.repeat) this.onAction(); e.preventDefault(); return; }
      if (e.code === "KeyR") this.restart();
      if (e.code === "KeyM") { this.muted = !this.muted; this.audio.setMuted(this.muted); this.els.mute.textContent = this.muted ? "🔇" : "🔊"; }
    });
    addEventListener("keyup", (e) => { if (AIM[e.code]) { this.aimHeld[AIM[e.code]] = false; e.preventDefault(); } });
    let downX = 0, lastX = 0, moved = 0, dragging = false;
    const cv = this.canvas;
    const onDown = (x) => { downX = lastX = x; moved = 0; dragging = true; this.audio.resume(); };
    const onMove = (x) => { if (!dragging) return; const dx = x - lastX; lastX = x; moved += Math.abs(dx); if (this.state === "aiming") this.aimAngle += dx * 0.008; };
    const onUp = () => { if (dragging && moved < 8) this.onAction(); dragging = false; };
    cv.addEventListener("mousedown", (e) => onDown(e.clientX));
    addEventListener("mousemove", (e) => onMove(e.clientX));
    addEventListener("mouseup", onUp);
    cv.addEventListener("touchstart", (e) => { onDown(e.changedTouches[0].clientX); e.preventDefault(); }, { passive: false });
    cv.addEventListener("touchmove", (e) => { onMove(e.changedTouches[0].clientX); e.preventDefault(); }, { passive: false });
    cv.addEventListener("touchend", (e) => { onUp(); e.preventDefault(); }, { passive: false });
    this.els.start.onclick = () => this.start();
    this.els.again.onclick = () => this.restart();
    this.els.putt.onclick = () => this.onAction();
    this.els.shopDescend.onclick = () => { if (this.state === "shop") this.descend(); };
    this.els.mute.onclick = () => { this.muted = !this.muted; this.audio.setMuted(this.muted); this.els.mute.textContent = this.muted ? "🔇" : "🔊"; };
    addEventListener("resize", () => this.renderer.resize());
    addEventListener("orientationchange", () => this.renderer.resize());
  }
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) { if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.25 && this.state === "aiming") this.aimAngle += ax * AIM_SPEED * DT;
      if (gp.buttons[14] && gp.buttons[14].pressed && this.state === "aiming") this.aimAngle -= AIM_SPEED * DT;
      if (gp.buttons[15] && gp.buttons[15].pressed && this.state === "aiming") this.aimAngle += AIM_SPEED * DT;
      const a = !!(gp.buttons[0] && gp.buttons[0].pressed); if (a && !this._padA) this.onAction(); this._padA = a; return; }
  }

  boot() {
    let last = performance.now(), acc = 0, paused = false;
    addEventListener("blur", () => paused = true);
    addEventListener("focus", () => { paused = false; last = performance.now(); });
    const frame = (now) => {
      requestAnimationFrame(frame);
      if (paused) { last = now; return; }
      acc += now - last; last = now; if (acc > 250) acc = 250;
      this.pollGamepad();
      while (acc >= STEP) { this.update(); acc -= STEP; }
      this.render();
    };
    requestAnimationFrame(frame);
  }
}
