// Headless-browser smoke test: load the game, catch console/page errors,
// confirm WebGL initialized, drive a full hole, and screenshot.
import { chromium } from "playwright-core";

const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = "/tmp/claude-0/-home-user-Putt/1bc6d0db-2c06-5ff4-8f66-be6cf2cc218f/scratchpad";
const URL = "http://localhost:8000/index.html";

const browser = await chromium.launch({
  executablePath: EXE,
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader",
         "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [], logs = [];
page.on("console", m => { logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// title showing + game constructed + WebGL up
const titleShown = await page.evaluate(() => document.getElementById("title").classList.contains("show"));
const diag = await page.evaluate(() => {
  const g = window.__game;
  const gl = g && g.renderer && g.renderer.gl;
  return {
    hasGame: !!g, state: g && g.state, hp: g && g.hp,
    glOK: !!gl, glErr: gl ? gl.getError() : "no-gl",
    holePar: g && g.hole && g.hole.par, clutter: g && g.hole && g.hole.clutter.length, money: g && g.money,
    meshes: g && g.renderer && Object.keys(g.renderer.meshes),
  };
});
console.log("TITLE shown:", titleShown);
console.log("DIAG:", JSON.stringify(diag));
await page.screenshot({ path: OUT + "/shot-title.png" });

// start + drive several putts toward the cup, stepping the fixed loop manually
const result = await page.evaluate(async () => {
  const g = window.__game;
  g.start();
  const log = [];
  const stepFor = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) g.update(); };
  for (let s = 0; s < 6 && g.state !== "shop" && g.state !== "over"; s++) {
    if (g.state !== "aiming") break;
    // aim straight at the cup, full-ish power
    g.aimAngle = Math.atan2(g.hole.cup.z - g.ball.z, g.hole.cup.x - g.ball.x);
    g.beginCharge();
    g.power = 0.62; g.lockPutt();
    let guard = 0;
    while (g.state === "rolling" && guard++ < 600) g.update();
    log.push(`putt${s + 1}: state=${g.state} strokes=${g.strokes} hp=${g.hp} ball=(${g.ball.x.toFixed(1)},${g.ball.z.toFixed(1)})`);
  }
  return { state: g.state, hp: g.hp, depth: g.depth, log };
});
console.log("DRIVE:", JSON.stringify(result, null, 0));
g_render_check: {
  await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__game.render(); });
}
await page.screenshot({ path: OUT + "/shot-play.png" });

const glErr2 = await page.evaluate(() => window.__game.renderer.gl.getError());
console.log("GL error after play:", glErr2);
console.log("CONSOLE (last 20):"); logs.slice(-20).forEach(l => console.log("  " + l));
console.log("ERRORS:", errors.length ? errors : "none");

await browser.close();
process.exit(errors.length ? 1 : 0);
