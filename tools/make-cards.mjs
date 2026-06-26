import { chromium } from "playwright-core";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = "/tmp/claude-0/-home-user-Putt/1bc6d0db-2c06-5ff4-8f66-be6cf2cc218f/scratchpad";
const browser = await chromium.launch({ executablePath: EXE, headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--force-device-scale-factor=1"] });

const thumb = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await thumb.goto("http://localhost:8000/tools/poster.html?mode=thumb", { waitUntil: "networkidle" });
await thumb.waitForTimeout(300);
await thumb.screenshot({ path: OUT + "/card-thumbnail.png" });

const icon = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
await icon.goto("http://localhost:8000/tools/poster.html?mode=icon", { waitUntil: "networkidle" });
await icon.waitForTimeout(300);
await icon.screenshot({ path: OUT + "/card-favicon.png" });

console.log("cards written");
await browser.close();
