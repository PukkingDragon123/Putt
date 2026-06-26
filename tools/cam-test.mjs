import { chromium } from "playwright-core";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = "/tmp/claude-0/-home-user-Putt/1bc6d0db-2c06-5ff4-8f66-be6cf2cc218f/scratchpad";
const b = await chromium.launch({ executablePath: EXE, headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto("http://localhost:8000/index.html", { waitUntil: "networkidle" });
await p.waitForTimeout(400);
const info = await p.evaluate(() => {
  const g = window.__game; g.start();
  // jam ball against the +X wall, aim toward -X (away from that wall) — worst case
  g.ball.x = g.hole.bounds.maxX - 0.4; g.ball.z = g.hole.bounds.maxZ / 2;
  g.aimAngle = Math.PI; // points toward -X
  g.snapCamera();
  for (let i = 0; i < 30; i++) g.render();
  return { maxX: g.hole.bounds.maxX, eyeX: g.cam.ex, eyeZ: g.cam.ez, maxZ: g.hole.bounds.maxZ };
});
console.log("CAM:", JSON.stringify(info), "eyeX<=maxX-0.5?", info.eyeX <= info.maxX - 0.5 + 1e-6);
await p.screenshot({ path: OUT + "/cam-occlusion.png" });
await b.close();
