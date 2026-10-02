// Captures 1280×800 pour le Chrome Web Store, sur le faux Moodle.
// Usage : node screenshots.js  → store/screenshots/*.png
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), os = require("os");
const { start, ROOT } = require("./mock-moodle");

const OUT = path.join(__dirname, "out"), EXT = path.join(OUT, "ext-shots"), PROFILE = path.join(OUT, "shots-profile");
const SHOTS = path.join(__dirname, "..", "store", "screenshots");
const CHROME = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Habillage : la popup (360 px) posée au centre d'un fond, avec une légende
const frame = (title, sub) => `
  html{background:linear-gradient(135deg,#fff7ed,#fed7aa);min-height:100%}
  body{margin:0 !important;position:absolute;left:50%;top:125px;transform:translateX(-50%) scale(1.05);transform-origin:top center;
       box-shadow:0 20px 50px #0003;border-radius:12px;background:#fff}
  html::before{content:${JSON.stringify(title)};position:fixed;top:36px;left:0;right:0;text-align:center;
       font:700 34px system-ui,sans-serif;color:#7c2d12}
  html::after{content:${JSON.stringify(sub)};position:fixed;top:86px;left:0;right:0;text-align:center;
       font:18px system-ui,sans-serif;color:#9a3412}`;

(async () => {
  fs.rmSync(EXT, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, "..", "extension"), EXT, { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json")));
  man.host_permissions = ["http://localhost/*"];
  fs.writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(man));
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await start();
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined, headless: false, colorScheme: "light",
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--window-position=-2400,0"],
  });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  const m = ctx.pages()[0];
  await m.goto(`${ROOT}/course/view.php?id=2`);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost/*" }))[0].id);

  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.goto(`chrome-extension://${id}/popup.html?tab=${tabId}&test=opfs`);
  await p.waitForSelector("#setup:not([hidden])");
  await p.click('[data-f=""]'); await p.click("#all");
  await p.evaluate(() => { document.getElementById("dirName").textContent = "📁 Mon Drive › Cours";
    document.getElementById("host").textContent = "https://moodle.univ.fr";
    document.getElementById("root").value = "moodle.univ.fr"; });
  await p.addStyleTag({ content: frame("Tous tes cours Moodle, en un clic", "Choisis les cours, les types de fichiers et le dossier de destination") });
  await sleep(300);
  await p.screenshot({ path: path.join(SHOTS, "1-popup.png") });

  await p.click("#go");
  await sleep(500);
  const s = ctx.pages().find((x) => x.url().includes("/sync.html"));
  await s.setViewportSize({ width: 1280, height: 800 });
  await s.waitForFunction(() => /Terminé/.test(document.getElementById("phase").textContent), null, { timeout: 30000 });
  await s.evaluate(() => {
    document.getElementById("dir").textContent = "📁 Mon Drive › Cours";
    const l = document.getElementById("log"); l.textContent = l.textContent.replace(/localhost_8765/g, "moodle.univ.fr");
  });
  await sleep(1500); // fin de l'animation de la barre
  await s.screenshot({ path: path.join(SHOTS, "2-synchro.png") });

  // index.html hors-ligne généré
  const html = await s.evaluate(async () => {
    let d = await navigator.storage.getDirectory();
    for (const x of ["moodle.univ.fr", "Biochimie_ L3_S1"]) d = await d.getDirectoryHandle(x);
    return (await (await d.getFileHandle("index.html")).getFile()).text();
  });
  const ix = await ctx.newPage();
  await ix.setViewportSize({ width: 1280, height: 800 });
  await ix.setContent(html.replace(/http:\/\/localhost:8765/g, "https://moodle.univ.fr"));
  await ix.screenshot({ path: path.join(SHOTS, "3-index-hors-ligne.png") });

  await ctx.close(); server.close();
  console.log("Captures :", fs.readdirSync(SHOTS).join(", "));
})();
