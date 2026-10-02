// Vérifie l'alerte quand Chrome a "Demander où enregistrer chaque fichier" activé.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), os = require("os");
const { start, ROOT } = require("./mock-moodle");
const OUT = path.join(__dirname, "out"), EXT = path.join(OUT, "ext"), PROFILE = path.join(OUT, "ask-profile");
(async () => {
  fs.rmSync(EXT, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, "..", "extension"), EXT, { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json")));
  man.host_permissions = ["http://localhost/*"];
  fs.writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(man));
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(path.join(PROFILE, "Default"), { recursive: true });
  fs.writeFileSync(path.join(PROFILE, "Default", "Preferences"), JSON.stringify({ download: { prompt_for_download: true } }));
  const server = await start();
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false,
    executablePath: path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe"),
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--window-position=-2400,0"] });
  let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const m = ctx.pages()[0];
  await (await ctx.newCDPSession(m)).send("Browser.setDownloadBehavior", { behavior: "default" });
  await m.goto(`${ROOT}/course/view.php?id=2`);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost/*" }))[0].id);
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${sw.url().split("/")[2]}/popup.html?tab=${tabId}`);
  await p.waitForSelector("#setup:not([hidden])");
  await p.check('[name=dest][value=downloads]');
  await p.click("#here"); await p.click("#go");
  try {
    await p.waitForSelector("#warn:not([hidden])", { timeout: 12000 });
    console.log("PASS  Alerte 'Demander où enregistrer' affichée");
  } catch (e) { console.log("FAIL  Alerte non affichée"); }
  await ctx.close(); server.close(); process.exit(0);
})();
