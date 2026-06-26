// PUTT OR DIE — game core: deterministic fixed-step simulation, ball physics &
// collisions, the Buckshot "chamber" rules, camera, WebGL scene draw, input
// (keyboard / touch / gamepad) and HUD. Logic is split from rendering (§6.4).
import { Renderer } from "./gl.js";
import { Audio } from "./audio.js";
import { genHole, BALL_R } from "./course.js";
import { ITEMS, ITEM_KEYS } from "./items.js";
import { mulberry32 } from "./rng.js";
import { mat4 } from "./math.js";
import { STR } from "../strings.js";

// ---- tuning (design/thresholds.md) ----
const STEP = 1000 / 60, DT = STEP / 1000;
const MAX_PUTT = 26, ROLL_FRICTION = 1.6, SAND_FRICTION = 7.5, DAMP = 0.992;
const STOP_EPS = 0.3, SINK_SPEED = 10, RESTITUTION = 0.62, AIM_SPEED = 2.2, POWER_PERIOD = 1.1;
const CAM_DIST = 8.5, CAM_HEIGHT = 6.2, LOOK_AHEAD = 2.5, LOOK_HEIGHT = 0.5;
const START_HP = 5, MAX_HP = 6;
const ROOM_H = 8.0, CEIL_Y = 8.4; // basement shell — above the low-angle camera

// ---- palette (STYLE FORMULA block 3, by role) ----
const COL = {
  felt: [0.62, 0.82, 0.6], floor: [0.42, 0.42, 0.48], wall: [0.6, 0.6, 0.66],
  crate: [0.36, 0.22, 0.1], block: [0.2, 0.2, 0.22], pillar: [0.22, 0.21, 0.24],
  bar: [0.28, 0.1, 0.1], mine: [0.85, 0.12, 0.08], water: [0.04, 0.12, 0.18],
  sand: [0.46, 0.4, 0.24], ball: [0.86, 0.84, 0.78], flag: [0.72, 0.06, 0.06],
  pole: [0.3, 0.3, 0.32], cup: [0.015, 0.015, 0.02], aim: [0.95, 0.82, 0.3],
  pickup: { beer: [0.72, 0.45, 0.08], pills: [0.4, 0.72, 0.2], smoke: [0.7, 0.7, 0.6],
            glass: [0.3, 0.6, 0.75], saw: [0.7, 0.5, 0.15], cuffs: [0.6, 0.6, 0.66] },
  // ---- basement environment + grimy improvised-course props ----
  concrete: [0.84, 0.84, 0.9], ceiling: [0.52, 0.52, 0.6], cord: [0.05, 0.05, 0.05],
  bulb: [1.0, 0.86, 0.62], pipe: [0.5, 0.42, 0.36], drain: [0.06, 0.06, 0.07],
  cardboard: [0.5, 0.46, 0.4], cardWet: [0.32, 0.26, 0.2], rust: [0.5, 0.4, 0.34],
  rustHot: [0.55, 0.16, 0.07], wood: [0.5, 0.42, 0.34], steel: [0.45, 0.45, 0.5],
  blood: [1.0, 1.0, 1.0], chain: [0.28, 0.28, 0.3], feltFlat: [0.12, 0.25, 0.14],
};

export class Game {
  constructor(canvas, els) {
    this.canvas = canvas; this.els = els;
    this.renderer = new Renderer(canvas);
    this.renderer.loadPrimitives();
    this.renderer.loadTextures();
    this.TEX = this.renderer.textures;
    this.renderer.resize();
    this.renderer.setJitter(220); // subtle PS1 wobble
    this.audio = new Audio();
    // scratch
    this.proj = mat4.create(); this.view = mat4.create(); this.vp = mat4.create();
    this._uv = [1, 1]; // reused per textured draw (zero per-frame alloc)
    this._eye = [0, 0, 0]; this._ctr = [0, 0, 0]; this._up = [0, 1, 0];
    this.cam = { ex: 0, ey: 10, ez: -10, tx: 0, ty: 0, tz: 0 };
    this.shake = 0; this.flash = 0; this.simTime = 0;
    this.aimHeld = { left: false, right: false };
    this._padA = false;
    this.best = parseInt(localStorage.getItem("putt_best") || "0", 10) || 0;
    this.state = "title";
    this.bindInput();
    this.newRun();
    this.state = "title";
    this.updateHUD();
    this.showOverlay("title");
  }

  rand() { return this.runRng(); }

  // ---------- run / hole setup ----------
  newRun() {
    this.runSeed = (Math.random() * 4294967296) >>> 0;
    this.runRng = mulberry32(this.runSeed);
    this.hp = START_HP; this.maxHp = MAX_HP; this.tokens = 0; this.depth = 0;
    this.bag = []; this.holeIndex = 0; this.powerShot = false;
    this.setupHole();
  }

  setupHole() {
    this.hole = genHole(this.runSeed, this.holeIndex);
    this.floor = this.hole.floor; this.chamber = this.hole.chamber;
    this.shellIndex = 0; this.strokes = 0; this.cuffed = false; this.wobble = false;
    const t = this.hole.tee;
    this.ball = { x: t.x, z: t.z, vx: 0, vz: 0, roll: 0 };
    this.lastRest = { x: t.x, z: t.z };
    const c = this.hole.cup;
    this.aimAngle = Math.atan2(c.z - t.z, c.x - t.x);
    this.snapCamera();
    this.state = "aiming";
    this.dealerBark();
    this.hideOverlays();
    this.updateHUD();
  }

  nextHole() { this.holeIndex++; this.setupHole(); }

  // ---------- core flow ----------
  start() {
    if (this.state !== "title") return;
    this.audio.resume(); this.audio.ensure(); this.audio.ambientStart();
    this.state = "aiming"; this.hideOverlays(); this.updateHUD();
  }
  restart() { if (this.state !== "over") return; this.newRun(); this.audio.ambientStart(); }

  onAction() {
    switch (this.state) {
      case "title": this.start(); break;
      case "aiming": this.beginCharge(); break;
      case "charging": this.lockPutt(); break;
      case "over": this.restart(); break;
    }
  }

  beginCharge() { this.state = "charging"; this.chargeT = 0; this.power = 0; this.audio.resume(); }

  lockPutt() {
    if (this.state !== "charging") return;
    let a = this.aimAngle;
    if (this.wobble) { a += (this.rand() - 0.5) * 0.5; this.wobble = false; }
    const speed = (0.15 + this.power * 0.85) * MAX_PUTT * (this.powerShot ? 1.4 : 1);
    this.ball.vx = Math.cos(a) * speed; this.ball.vz = Math.sin(a) * speed;
    this.strokes++;
    this.activePowerShot = this.powerShot; this.powerShot = false;
    this.state = "rolling";
    this.audio.putt(this.power);
    this.els.power.classList.remove("show");
    this.updateHUD();
  }

  // ---------- fixed-step update ----------
  update() {
    this.simTime += DT;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - DT * 2.2);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - DT * 2.5);
    // spinning bars (frozen when cuffed)
    if (this.hole && !this.cuffed) for (const b of this.hole.bars) b.angle += b.speed * DT;

    this.pollGamepad();

    if (this.state === "aiming") {
      const d = (this.aimHeld.right ? 1 : 0) - (this.aimHeld.left ? 1 : 0);
      if (d) this.aimAngle += d * AIM_SPEED * DT;
    } else if (this.state === "charging") {
      this.chargeT += DT;
      const ph = (this.chargeT % POWER_PERIOD) / POWER_PERIOD;
      this.power = ph < 0.5 ? ph * 2 : 2 - ph * 2;
    } else if (this.state === "rolling") {
      this.stepBall();
    }
  }

  stepBall() {
    const b = this.ball, h = this.hole;
    let speed = Math.hypot(b.vx, b.vz);
    if (speed > 0) {
      const f = this.inSand(b.x, b.z) ? SAND_FRICTION : ROLL_FRICTION;
      let ns = speed - f * DT; if (ns < 0) ns = 0;
      b.vx *= ns / speed; b.vz *= ns / speed;
      b.vx *= DAMP; b.vz *= DAMP;
    }
    b.x += b.vx * DT; b.z += b.vz * DT;
    b.roll += Math.hypot(b.vx, b.vz) * DT * 1.6;

    // boundary walls
    if (b.x < h.bounds.minX + BALL_R) { b.x = h.bounds.minX + BALL_R; b.vx = -b.vx * RESTITUTION; this.clack(); }
    if (b.x > h.bounds.maxX - BALL_R) { b.x = h.bounds.maxX - BALL_R; b.vx = -b.vx * RESTITUTION; this.clack(); }
    if (b.z < h.bounds.minZ + BALL_R) { b.z = h.bounds.minZ + BALL_R; b.vz = -b.vz * RESTITUTION; this.clack(); }
    if (b.z > h.bounds.maxZ - BALL_R) { b.z = h.bounds.maxZ - BALL_R; b.vz = -b.vz * RESTITUTION; this.clack(); }

    for (const bx of h.boxes) {
      if (bx.broken) continue;
      const hit = this.circleAABB(b.x, b.z, bx.x, bx.z, bx.w / 2, bx.d / 2);
      if (!hit) continue;
      if (this.activePowerShot && bx.breakable && Math.hypot(b.vx, b.vz) > 8) {
        bx.broken = true; this.audio.spike(); b.vx *= 0.7; b.vz *= 0.7; continue;
      }
      this.resolveHit(hit);
    }
    for (const p of h.pillars) {
      const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz), rr = p.r + BALL_R;
      if (d < rr && d > 1e-4) this.resolveHit({ nx: dx / d, nz: dz / d, pen: rr - d });
    }
    for (const bar of h.bars) this.barCollide(bar);

    // mines (instant damage, ends stroke)
    for (const m of h.mines) {
      if (!m.armed) continue;
      if (Math.hypot(b.x - m.x, b.z - m.z) < m.r + BALL_R) {
        m.armed = false; b.vx = 0; b.vz = 0;
        this.damage(1); this.shake = 0.7; this.flash = 0.6; this.audio.spike();
        this.toast(STR.spike, "bad");
        this.endRoll("stopped"); return;
      }
    }

    // water → reset + penalty stroke
    for (const w of h.water) {
      if (b.x > w.minX && b.x < w.maxX && b.z > w.minZ && b.z < w.maxZ) { this.endRoll("water"); return; }
    }

    // pickups
    for (const pk of h.pickups) {
      if (pk.taken) continue;
      if (Math.hypot(b.x - pk.x, b.z - pk.z) < pk.r + BALL_R) { pk.taken = true; this.grab(pk.itemKey); }
    }

    // clamp runaway energy from movers
    const sp = Math.hypot(b.vx, b.vz);
    if (sp > MAX_PUTT * 1.3) { const k = (MAX_PUTT * 1.3) / sp; b.vx *= k; b.vz *= k; }

    // sink
    const c = h.cup, dc = Math.hypot(b.x - c.x, b.z - c.z);
    if (dc < c.r * 0.92 && sp < SINK_SPEED) { this.endRoll("sunk"); return; }

    if (sp < STOP_EPS) { b.vx = 0; b.vz = 0; this.endRoll("stopped"); }
  }

  circleAABB(cx, cz, bx, bz, hw, hd) {
    const qx = Math.max(bx - hw, Math.min(cx, bx + hw));
    const qz = Math.max(bz - hd, Math.min(cz, bz + hd));
    let dx = cx - qx, dz = cz - qz, d2 = dx * dx + dz * dz;
    if (d2 >= BALL_R * BALL_R) return null;
    let d = Math.sqrt(d2);
    if (d > 1e-4) return { nx: dx / d, nz: dz / d, pen: BALL_R - d };
    const px = hw - Math.abs(cx - bx), pz = hd - Math.abs(cz - bz);
    return px < pz ? { nx: Math.sign(cx - bx) || 1, nz: 0, pen: px + BALL_R }
                   : { nx: 0, nz: Math.sign(cz - bz) || 1, pen: pz + BALL_R };
  }

  resolveHit(hit) {
    const b = this.ball;
    b.x += hit.nx * hit.pen; b.z += hit.nz * hit.pen;
    const vd = b.vx * hit.nx + b.vz * hit.nz;
    if (vd < 0) {
      b.vx -= (1 + RESTITUTION) * vd * hit.nx; b.vz -= (1 + RESTITUTION) * vd * hit.nz;
      if (-vd > 2) this.clack();
    }
  }

  barCollide(bar) {
    const b = this.ball;
    const rx = b.x - bar.x, rz = b.z - bar.z;
    if (Math.hypot(rx, rz) > bar.len / 2 + 1) return;
    const ca = Math.cos(bar.angle), sa = Math.sin(bar.angle);
    const lx = rx * ca + rz * sa, lz = -rx * sa + rz * ca;
    const hit = this.circleAABB(lx, lz, 0, 0, bar.len / 2, bar.w / 2);
    if (!hit) return;
    const nx = hit.nx * ca - hit.nz * sa, nz = hit.nx * sa + hit.nz * ca;
    this.resolveHit({ nx, nz, pen: hit.pen });
    // tangential whack from rotation
    const dist = Math.hypot(rx, rz) || 1;
    b.vx += -rz * bar.speed * 0.4; b.vz += rx * bar.speed * 0.4;
  }

  inSand(x, z) {
    for (const s of this.hole.sand) if (x > s.minX && x < s.maxX && z > s.minZ && z < s.maxZ) return true;
    return false;
  }
  clack() { this.audio.wall(); }

  // ---------- stroke resolution ----------
  endRoll(outcome) {
    if (this.state !== "rolling") return;
    if (outcome === "water") {
      this.ball.x = this.lastRest.x; this.ball.z = this.lastRest.z; this.ball.vx = 0; this.ball.vz = 0;
      this.strokes++; this.audio.splash(); this.toast(STR.splash, "warn");
      this.snapCamera(); this.state = "aiming"; this.updateHUD(); return;
    }
    if (outcome === "sunk") { this.onSink(); return; }
    // stopped
    this.ball.vx = 0; this.ball.vz = 0; this.lastRest = { x: this.ball.x, z: this.ball.z };
    if (this.strokes > this.hole.par) {
      if (this.shellIndex < this.chamber.length) {
        const shell = this.chamber[this.shellIndex]; shell.drawn = true; this.shellIndex++;
        if (shell.type === "live") {
          this.damage(1); this.shake = 0.8; this.flash = 0.7; this.audio.bang(); this.toast(STR.bang, "bad");
        } else { this.audio.blank(); this.toast(STR.click, "ok"); }
      } else {
        this.damage(2); this.shake = 0.9; this.flash = 0.8; this.audio.bang(); this.toast(STR.dry, "bad");
        if (this.hp > 0) { this.updateHUD(); this.nextHole(); } else this.gameOver();
        return;
      }
    }
    if (this.hp <= 0) { this.gameOver(); return; }
    this.snapCamera(); this.state = "aiming"; this.updateHUD();
  }

  onSink() {
    this.audio.sink();
    const under = this.hole.par - this.strokes;
    this.toast(under > 0 ? STR.birdie : STR.sunk, "good"); this.flash = 0.3;
    const dodged = this.chamber.length - this.shellIndex;
    this.tokens += 10 + Math.max(0, under) * 5 + dodged * 2;
    this.depth++;
    if (this.depth > this.best) { this.best = this.depth; localStorage.setItem("putt_best", String(this.best)); }
    this.buildRewards(); this.state = "reward"; this.updateHUD(); this.showOverlay("reward");
  }

  gameOver() {
    this.state = "over";
    if (this.depth > this.best) { this.best = this.depth; localStorage.setItem("putt_best", String(this.best)); }
    this.els.overStats.innerHTML =
      `${STR.depth} <b>${this.depth}</b> · ${STR.chips} <b>${this.tokens}</b> · ${STR.best} <b>${this.best}</b>`;
    this.showOverlay("over");
  }

  damage(n) { this.hp = Math.max(0, this.hp - n); this.flash = Math.max(this.flash, 0.5); this.updateHUD(); }
  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); this.updateHUD(); }

  grab(key) {
    if (this.bag.length >= 4) { this.toast(STR.bagFull, "warn"); return; }
    this.bag.push(key); this.audio.item();
    this.toast(STR.gotItem.replace("%s", ITEMS[key].name), "ok"); this.updateHUD();
  }

  useItem(i) {
    if (this.state !== "aiming" && this.state !== "charging") return;
    const key = this.bag[i]; if (!key) return;
    const res = ITEMS[key].apply(this);
    if (res === null) return; // couldn't use — keep it
    this.bag.splice(i, 1);
    this.toast(res, "ok"); this.updateHUD();
  }

  // ---------- rewards ----------
  buildRewards() {
    const itemKey = ITEM_KEYS[Math.floor(this.rand() * ITEM_KEYS.length)];
    const opts = [
      { kind: "item", key: itemKey },
      this.hp < this.maxHp ? { kind: "heal" } : { kind: "item", key: ITEM_KEYS[Math.floor(this.rand() * ITEM_KEYS.length)] },
      { kind: "tokens", n: 10 + this.floor * 2 },
    ];
    this._rewards = opts;
    this.els.rewardCards.innerHTML = "";
    opts.forEach((o, idx) => {
      const card = document.createElement("button"); card.className = "card";
      let glyph, name, sub;
      if (o.kind === "item") { glyph = ITEMS[o.key].glyph; name = ITEMS[o.key].name; sub = ITEMS[o.key].blurb; }
      else if (o.kind === "heal") { glyph = "❤"; name = STR.reward.heal; sub = STR.reward.healSub; }
      else { glyph = "🪙"; name = STR.reward.tokens; sub = STR.reward.tokensSub.replace("%n", o.n); }
      card.innerHTML = `<div class="cg">${glyph}</div><div class="cn">${name}</div><div class="cs">${sub}</div>`;
      card.onclick = () => this.chooseReward(idx);
      this.els.rewardCards.appendChild(card);
    });
  }

  chooseReward(idx) {
    if (this.state !== "reward") return;
    const o = this._rewards[idx];
    if (o.kind === "item") { if (this.bag.length < 4) this.bag.push(o.key); else this.heal(1); }
    else if (o.kind === "heal") this.heal(2);
    else this.tokens += o.n;
    this.audio.item(); this.nextHole();
  }

  dealerBark() {
    const line = STR.dealer[Math.floor(this.rand() * STR.dealer.length)];
    const d = this.els.dealer; d.textContent = line;
    d.classList.remove("show"); void d.offsetWidth; d.classList.add("show");
  }

  // ---------- camera ----------
  desiredCam() {
    const b = this.ball, dx = Math.cos(this.aimAngle), dz = Math.sin(this.aimAngle);
    return {
      ex: b.x - dx * CAM_DIST, ey: CAM_HEIGHT, ez: b.z - dz * CAM_DIST,
      tx: b.x + dx * LOOK_AHEAD, ty: LOOK_HEIGHT, tz: b.z + dz * LOOK_AHEAD,
    };
  }
  snapCamera() { const d = this.desiredCam(); Object.assign(this.cam, d); }

  // ---------- render ----------
  render() {
    const R = this.renderer, gl = R.gl;
    // title: slow orbit; else follow
    if (this.state === "title") {
      // slow swaying view from behind the tee, down the course — inside the basement
      const t = this.hole.tee, sway = Math.sin(this.simTime * 0.4) * 0.28;
      const dx = Math.cos(this.aimAngle + sway), dz = Math.sin(this.aimAngle + sway);
      this.cam.ex = t.x - dx * CAM_DIST; this.cam.ey = CAM_HEIGHT - 1.2; this.cam.ez = t.z - dz * CAM_DIST;
      this.cam.tx = t.x + dx * 8; this.cam.ty = LOOK_HEIGHT; this.cam.tz = t.z + dz * 8;
    } else {
      const d = this.desiredCam(), k = 0.16;
      this.cam.ex += (d.ex - this.cam.ex) * k; this.cam.ey += (d.ey - this.cam.ey) * k; this.cam.ez += (d.ez - this.cam.ez) * k;
      this.cam.tx += (d.tx - this.cam.tx) * k; this.cam.ty += (d.ty - this.cam.ty) * k; this.cam.tz += (d.tz - this.cam.tz) * k;
    }
    // Keep the eye inside the room so a tall side/far wall never fills the view
    // when aiming away from a nearby wall. The near (minZ) wall is a low curb, so
    // the eye is free to sit behind the tee (no lower-z clamp).
    const cb = this.hole.bounds;
    this.cam.ex = Math.max(cb.minX + 0.5, Math.min(cb.maxX - 0.5, this.cam.ex));
    this.cam.ez = Math.min(cb.maxZ - 0.5, this.cam.ez);
    const sh = this.shake;
    const sx = sh ? (Math.random() - 0.5) * sh : 0, sy = sh ? (Math.random() - 0.5) * sh : 0;
    this._eye[0] = this.cam.ex + sx; this._eye[1] = this.cam.ey + sy; this._eye[2] = this.cam.ez;
    this._ctr[0] = this.cam.tx; this._ctr[1] = this.cam.ty; this._ctr[2] = this.cam.tz;

    mat4.perspective(this.proj, 1.05, R.aspect || 1.6, 0.1, 200);
    mat4.lookAt(this.view, this._eye, this._ctr, this._up);
    mat4.multiply(this.vp, this.proj, this.view);
    R.beginFrame(this.vp, this._eye[0], this._eye[1], this._eye[2], this.simTime);

    const h = this.hole, M = R.meshes, T = this.TEX, uv = this._uv, bn = h.bounds, cz = bn.maxZ / 2;

    // surrounding concrete basement floor + the textured green
    uv[0] = (h.W + 40) / 4; uv[1] = (h.L + 40) / 4;
    R.draw(M.plane, 0, -0.06, cz, 0, h.W + 40, 1, h.L + 40, COL.floor, 0, T.concrete, uv);
    uv[0] = h.W / 3; uv[1] = h.L / 3;
    R.draw(M.plane, 0, 0, cz, 0, h.W, 1, h.L, COL.felt, 0, T.felt, uv);

    // bloodstain / warning decals on the felt (alpha-blended, flush)
    R.blend(true);
    for (const dc of h.decals) { uv[0] = 1; uv[1] = 1; R.draw(M.plane, dc.x, 0.012, dc.z, dc.rot, dc.s, 1, dc.s, COL.blood, 0, T.blood, uv); }
    R.blend(false);

    // sand & water (flush quads)
    for (const s of h.sand) R.draw(M.plane, (s.minX + s.maxX) / 2, 0.02, (s.minZ + s.maxZ) / 2, 0, s.maxX - s.minX, 1, s.maxZ - s.minZ, COL.sand, 0);
    for (const w of h.water) R.draw(M.plane, (w.minX + w.maxX) / 2, 0.02, (w.minZ + w.maxZ) / 2, 0, w.maxX - w.minX, 1, w.maxZ - w.minZ, COL.water, 0.22 + 0.1 * Math.sin(this.simTime * 2));

    // basement room shell: tall side + far walls + dark ceiling slab. The NEAR
    // (minZ) wall is left low — a tall one sits right in front of the camera
    // (which orbits behind the tee) and would block the course.
    uv[0] = (h.L + 2) / 4; uv[1] = ROOM_H / 4;
    R.draw(M.box, bn.minX - 0.6, ROOM_H / 2, cz, 0, 0.6, ROOM_H, h.L + 2, COL.concrete, 0, T.concrete, uv);
    R.draw(M.box, bn.maxX + 0.6, ROOM_H / 2, cz, 0, 0.6, ROOM_H, h.L + 2, COL.concrete, 0, T.concrete, uv);
    uv[0] = (h.W + 2) / 4; uv[1] = ROOM_H / 4;
    R.draw(M.box, 0, ROOM_H / 2, bn.maxZ + 0.6, 0, h.W + 2, ROOM_H, 0.6, COL.concrete, 0, T.concrete, uv);
    uv[0] = (h.W + 2) / 4; uv[1] = (h.L + 2) / 4;
    R.draw(M.plane, 0, CEIL_Y, cz, 0, h.W + 2, 1, h.L + 2, COL.ceiling, 0, T.concrete, uv);

    // short play-edge curb at the physics boundary (the ball bounces here)
    const wh = 0.55;
    uv[0] = (h.L + 1) / 3; uv[1] = 1;
    R.draw(M.box, bn.minX - 0.25, wh / 2, cz, 0, 0.5, wh, h.L + 1, COL.concrete, 0, T.concrete, uv);
    R.draw(M.box, bn.maxX + 0.25, wh / 2, cz, 0, 0.5, wh, h.L + 1, COL.concrete, 0, T.concrete, uv);
    uv[0] = (h.W + 1) / 3;
    R.draw(M.box, 0, wh / 2, bn.minZ - 0.25, 0, h.W + 1, wh, 0.5, COL.concrete, 0, T.concrete, uv);
    R.draw(M.box, 0, wh / 2, bn.maxZ + 0.25, 0, h.W + 1, wh, 0.5, COL.concrete, 0, T.concrete, uv);

    // swinging bare bulb over the course
    {
      const swing = Math.sin(this.simTime * 1.3) * 0.5, cordLen = 2.6, pY = CEIL_Y - 0.1;
      const bx = Math.sin(swing) * cordLen, by = pY - Math.cos(swing) * cordLen;
      R.draw(M.cyl, bx / 2, (pY + by) / 2, cz, 0, 0.04, cordLen, 0.04, COL.cord, 0);
      R.draw(M.ball, bx, by, cz, 0, 0.5, 0.5, 0.5, COL.bulb, 0.95);
    }

    // rusted iron pipes along the side walls + a floor drain near the tee
    uv[0] = h.L * 0.35; uv[1] = 1;
    R.draw(M.box, bn.minX - 0.25, 3.2, cz, 0, 0.3, 0.3, h.L * 0.7, COL.pipe, 0, T.iron, uv);
    uv[0] = h.L * 0.25;
    R.draw(M.box, bn.maxX + 0.25, 4.6, cz, 0, 0.28, 0.28, h.L * 0.5, COL.pipe, 0, T.iron, uv);
    R.draw(M.cyl, h.tee.x + 1.5, -0.18, h.tee.z + 1.0, 0, 0.9, 0.4, 0.9, COL.drain, 0);
    R.draw(M.cyl, h.tee.x + 1.5, -0.02, h.tee.z + 1.0, 0, 1.05, 0.08, 1.05, COL.steel, 0);

    // cup + flag
    const c = h.cup;
    R.draw(M.cyl, c.x, -0.3, c.z, 0, c.r * 2, 0.6, c.r * 2, COL.cup, 0);
    R.draw(M.cyl, c.x, 1.25, c.z, 0, 0.08, 2.5, 0.08, COL.pole, 0);
    R.draw(M.box, c.x + 0.45, 2.1, c.z, 0, 0.9, 0.55, 0.08, COL.flag, 0.25);

    // obstacles — boxes become water-stained cardboard or welded metal-scrap piles
    for (const bx of h.boxes) {
      if (bx.broken) continue;
      uv[0] = bx.w; uv[1] = bx.h;
      if (bx.propType === "cardboard") {
        R.draw(M.box, bx.x, bx.h / 2, bx.z, bx.yaw, bx.w, bx.h, bx.d, COL.cardboard, 0, T.cardboard, uv);
        R.draw(M.box, bx.x, bx.h * 0.18, bx.z, bx.yaw, bx.w * 1.01, bx.h * 0.3, bx.d * 1.01, COL.cardWet, 0, T.cardboard, uv);
        R.draw(M.box, bx.x, bx.h + 0.04, bx.z, bx.yaw + 0.3, bx.w * 0.6, 0.08, bx.d * 0.9, COL.cardboard, 0, T.cardboard, uv);
      } else {
        R.draw(M.box, bx.x, bx.h / 2, bx.z, bx.yaw, bx.w, bx.h, bx.d, COL.rust, 0.03, T.iron, uv);
        R.draw(M.box, bx.x - bx.w * 0.2, bx.h * 0.85, bx.z + bx.d * 0.15, bx.yaw + 0.5, bx.w * 0.5, bx.h * 0.4, bx.d * 0.5, COL.rust, 0.04, T.iron, uv);
        R.draw(M.cone, bx.x + bx.w * 0.25, bx.h * 0.8, bx.z - bx.d * 0.1, bx.yaw, bx.w * 0.4, bx.h * 0.7, bx.d * 0.4, COL.steel, 0);
      }
    }
    // pillars become rusty barrels with hot-rust bands
    for (const p of h.pillars) {
      uv[0] = 3; uv[1] = p.h;
      R.draw(M.cyl, p.x, p.h / 2, p.z, 0, p.r * 2, p.h, p.r * 2, COL.rust, 0.04, T.iron, uv);
      R.draw(M.cyl, p.x, p.h * 0.75, p.z, 0, p.r * 2.06, p.h * 0.08, p.r * 2.06, COL.rustHot, 0.18);
      R.draw(M.cyl, p.x, p.h * 0.30, p.z, 0, p.r * 2.06, p.h * 0.08, p.r * 2.06, COL.rustHot, 0.18);
    }
    // bars become spinning spiked wheels on a steel hub (collision unchanged)
    for (const bar of h.bars) {
      R.draw(M.cyl, bar.x, 0.55, bar.z, 0, 0.5, 1.1, 0.5, COL.steel, 0);
      R.draw(M.wheel, bar.x, 0.9, bar.z, -bar.angle, bar.len, bar.len, bar.len, COL.rust, this.cuffed ? 0 : 0.2);
      R.draw(M.wheel, bar.x, 0.9, bar.z, -bar.angle + 0.4, bar.len * 0.7, bar.len * 0.7, bar.len * 0.7, COL.rustHot, this.cuffed ? 0 : 0.14);
    }
    // mines become a bench saw-blade or a rusty spike cluster
    const minePulse = 0.35 + 0.4 * Math.abs(Math.sin(this.simTime * 5));
    for (const m of h.mines) {
      if (m.variant === "saw") {
        uv[0] = 1; uv[1] = 1;
        R.draw(M.box, m.x, 0.25, m.z, 0, m.r * 2.4, 0.5, m.r * 1.2, COL.wood, 0, T.wood, uv);
        R.draw(M.saw, m.x, 0.6, m.z, m.armed ? this.simTime * 6 : 0, m.r * 2, m.r * 2, m.r * 2, COL.steel, m.armed ? minePulse * 0.6 : 0);
      } else {
        R.draw(M.cone, m.x, 0.45, m.z, this.simTime, m.r * 1.4, 0.9, m.r * 1.4, COL.rust, m.armed ? minePulse : 0);
        R.draw(M.cone, m.x + 0.2, 0.35, m.z - 0.15, this.simTime, m.r * 0.9, 0.7, m.r * 0.9, COL.rustHot, m.armed ? minePulse : 0);
        R.draw(M.cone, m.x - 0.18, 0.35, m.z + 0.18, this.simTime, m.r * 0.9, 0.7, m.r * 0.9, COL.rust, m.armed ? minePulse : 0);
      }
    }

    // decorative chains + a spiked rack board on the back wall
    R.draw(M.cyl, bn.maxX - 1.2, CEIL_Y - 1.8, cz + 3, 0, 0.06, 3.4, 0.06, COL.chain, 0);
    R.draw(M.cyl, bn.maxX - 1.6, CEIL_Y - 2.4, cz + 3.4, 0, 0.06, 4.6, 0.06, COL.chain, 0);
    uv[0] = 2; uv[1] = 1;
    R.draw(M.box, 0, 2.0, bn.maxZ + 0.3, 0, 4.0, 2.4, 0.2, COL.wood, 0, T.wood, uv);
    for (let i = -1; i <= 1; i++) R.draw(M.cone, i * 1.0, 2.0, bn.maxZ + 0.05, 0, 0.4, 0.8, 0.4, COL.steel, 0.05);

    // pickups
    for (const pk of h.pickups) {
      if (pk.taken) continue;
      const col = COL.pickup[pk.itemKey] || COL.aim;
      R.draw(M.cyl, pk.x, 0.35 + 0.12 * Math.sin(this.simTime * 3), pk.z, this.simTime, pk.r * 1.6, 0.35, pk.r * 1.6, col, 0.5);
    }

    // aim indicator
    if (this.state === "aiming" || this.state === "charging") {
      const dx = Math.cos(this.aimAngle), dz = Math.sin(this.aimAngle);
      const pw = this.state === "charging" ? this.power : 0.45;
      const len = 2 + pw * 6;
      R.draw(M.box, this.ball.x + dx * (len / 2 + BALL_R), 0.06, this.ball.z + dz * (len / 2 + BALL_R),
        -this.aimAngle, len, 0.06, 0.16, this.activePowerShot || this.powerShot ? COL.flag : COL.aim, 0.6);
    }

    // ball
    R.draw(M.ball, this.ball.x, BALL_R, this.ball.z, this.ball.roll, BALL_R * 2, BALL_R * 2, BALL_R * 2, COL.ball, 0.06);

    // resolve the low-res scene buffer to the canvas with the PSX/CRT post pass
    R.present(this.simTime);

    // damage flash + power meter via DOM
    this.els.flash.style.opacity = this.flash ? Math.min(0.6, this.flash) : 0;
    if (this.state === "charging") {
      this.els.power.classList.add("show");
      this.els.powerFill.style.width = (this.power * 100) + "%";
    }
  }

  // ---------- HUD ----------
  updateHUD() {
    const e = this.els;
    let hearts = "";
    for (let i = 0; i < this.maxHp; i++) hearts += i < this.hp ? `<span class="hf">❤</span>` : `<span class="he">♡</span>`;
    e.hp.innerHTML = hearts;
    e.status.innerHTML = `${STR.hud.floor} <b>${this.floor}</b> · ${STR.hud.par} <b>${this.hole.par}</b> · ${STR.hud.stroke} <b>${this.strokes}</b>`;
    e.score.innerHTML = `${STR.depth} <b>${this.depth}</b> · ${STR.chips} <b>${this.tokens}</b> · ${STR.best} <b>${this.best}</b>`;

    let live = 0, blank = 0, shells = "";
    for (const s of this.chamber) {
      let cls = "shell";
      if (s.drawn) cls += " spent";
      else { (s.type === "live" ? (live++) : (blank++)); if (s.revealed) cls += s.type === "live" ? " live" : " blank"; }
      shells += `<span class="${cls}"></span>`;
    }
    e.chamber.innerHTML = `<div class="shells">${shells}</div><div class="cc"><span class="lv">${STR.hud.live} ${live}</span> · <span class="bk">${STR.hud.blank} ${blank}</span></div>`;

    let bag = "";
    for (let i = 0; i < 4; i++) {
      const k = this.bag[i];
      bag += k
        ? `<button class="slot" data-i="${i}" title="${ITEMS[k].name}: ${ITEMS[k].blurb}"><span class="g">${ITEMS[k].glyph}</span><span class="n">${i + 1}</span></button>`
        : `<div class="slot empty"></div>`;
    }
    e.bag.innerHTML = bag;
    e.bag.querySelectorAll("button.slot").forEach(btn => btn.onclick = () => this.useItem(parseInt(btn.dataset.i, 10)));
  }

  toast(text, kind) {
    const t = document.createElement("div"); t.className = "toast " + (kind || ""); t.textContent = text;
    this.els.toast.appendChild(t);
    setTimeout(() => t.remove(), 1900);
  }

  showOverlay(which) {
    this.hideOverlays();
    if (which === "title") this.els.title.classList.add("show");
    if (which === "reward") this.els.reward.classList.add("show");
    if (which === "over") this.els.over.classList.add("show");
  }
  hideOverlays() { this.els.title.classList.remove("show"); this.els.reward.classList.remove("show"); this.els.over.classList.remove("show"); }

  // ---------- input ----------
  bindInput() {
    const BIND_AIM = { ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
    addEventListener("keydown", (e) => {
      if (BIND_AIM[e.code]) { this.aimHeld[BIND_AIM[e.code]] = true; e.preventDefault(); return; }
      if (e.code === "Space" || e.code === "Enter") { if (!e.repeat) this.onAction(); e.preventDefault(); return; }
      if (/^Digit[1-4]$/.test(e.code)) { this.useItem(parseInt(e.code.slice(5), 10) - 1); return; }
      if (e.code === "KeyR") this.restart();
      if (e.code === "KeyM") { this.muted = !this.muted; this.audio.setMuted(this.muted); this.els.mute.textContent = this.muted ? "🔇" : "🔊"; }
    });
    addEventListener("keyup", (e) => { if (BIND_AIM[e.code]) { this.aimHeld[BIND_AIM[e.code]] = false; e.preventDefault(); } });

    // pointer: drag to aim, tap to act (on the canvas)
    let downX = 0, downY = 0, lastX = 0, moved = 0, dragging = false;
    const cv = this.canvas;
    const onDown = (x, y) => { downX = lastX = x; downY = y; moved = 0; dragging = true; this.audio.resume(); };
    const onMove = (x, y) => {
      if (!dragging) return;
      const dx = x - lastX; lastX = x; moved += Math.abs(dx) + Math.abs(y - downY) * 0;
      if (this.state === "aiming") this.aimAngle += dx * 0.008;
    };
    const onUp = () => { if (dragging && moved < 8) this.onAction(); dragging = false; };
    cv.addEventListener("mousedown", (e) => onDown(e.clientX, e.clientY));
    addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
    addEventListener("mouseup", onUp);
    cv.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; onDown(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    cv.addEventListener("touchmove", (e) => { const t = e.changedTouches[0]; onMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
    cv.addEventListener("touchend", (e) => { onUp(); e.preventDefault(); }, { passive: false });

    // DOM buttons
    this.els.start.onclick = () => this.start();
    this.els.again.onclick = () => this.restart();
    this.els.putt.onclick = () => this.onAction();
    this.els.mute.onclick = () => { this.muted = !this.muted; this.audio.setMuted(this.muted); this.els.mute.textContent = this.muted ? "🔇" : "🔊"; };

    addEventListener("resize", () => this.renderer.resize());
    addEventListener("orientationchange", () => this.renderer.resize());
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.25 && this.state === "aiming") this.aimAngle += ax * AIM_SPEED * DT;
      if (gp.buttons[14] && gp.buttons[14].pressed && this.state === "aiming") this.aimAngle -= AIM_SPEED * DT;
      if (gp.buttons[15] && gp.buttons[15].pressed && this.state === "aiming") this.aimAngle += AIM_SPEED * DT;
      const a = !!(gp.buttons[0] && gp.buttons[0].pressed);
      if (a && !this._padA) this.onAction();
      this._padA = a;
      return;
    }
  }

  // ---------- main loop ----------
  boot() {
    let last = performance.now(), acc = 0, paused = false;
    addEventListener("blur", () => paused = true);
    addEventListener("focus", () => { paused = false; last = performance.now(); });
    const frame = (now) => {
      requestAnimationFrame(frame);
      if (paused) { last = now; return; }
      acc += now - last; last = now;
      if (acc > 250) acc = 250; // avoid spiral after a stall
      while (acc >= STEP) { this.update(); acc -= STEP; }
      this.render();
    };
    requestAnimationFrame(frame);
  }
}
