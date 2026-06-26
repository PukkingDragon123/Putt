import { chromium } from "playwright-core";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = "/tmp/claude-0/-home-user-Putt/1bc6d0db-2c06-5ff4-8f66-be6cf2cc218f/scratchpad";
const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("http://localhost:8000/index.html", { waitUntil: "networkidle" });
await page.waitForTimeout(500);

// Hole 1, aiming view
await page.evaluate(() => { const g = window.__game; g.start(); for (let i=0;i<40;i++) g.update(); for (let i=0;i<40;i++) g.render(); });
await page.screenshot({ path: OUT + "/scene-hole1.png" });

// Jump to a deep, hazard-rich hole and let the camera settle + bars spin
await page.evaluate(() => { const g = window.__game; g.holeIndex = 8; g.setupHole(); for (let i=0;i<120;i++){g.update();} for (let i=0;i<60;i++) g.render(); });
await page.screenshot({ path: OUT + "/scene-deep.png" });

// Charging view (power meter + aim line)
await page.evaluate(() => { const g = window.__game; g.beginCharge(); g.chargeT=0.35; for(let i=0;i<2;i++) g.update(); for (let i=0;i<10;i++) g.render(); });
await page.screenshot({ path: OUT + "/scene-charge.png" });

const info = await page.evaluate(() => { const g=window.__game; const h=g.hole; return {floor:h.floor,par:h.par,boxes:h.boxes.length,pillars:h.pillars.length,bars:h.bars.length,mines:h.mines.length,sand:h.sand.length,water:h.water.length,pickups:h.pickups.length,W:h.W,L:h.L}; });
console.log("deep hole:", JSON.stringify(info));
await browser.close();
