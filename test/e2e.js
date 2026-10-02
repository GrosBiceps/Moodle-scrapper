// Test bout en bout : vrai Chromium + extension + faux Moodle.
// Usage : node e2e.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { start, state, ROOT } = require("./mock-moodle");

const EXT_SRC = path.join(__dirname, "..", "extension");
const OUT = path.join(__dirname, "out");
const EXT = path.join(OUT, "ext");
const DL = path.join(OUT, "downloads");
const PROFILE = path.join(OUT, "profile");
const CHROME = path.join(os.homedir(), "AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe");

const results = [];
const check = (name, ok, info = "") => {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tree(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? tree(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  // copie de test : seule différence = permission localhost (activeTab n'existe pas sans clic réel)
  fs.cpSync(EXT_SRC, EXT, { recursive: true });
  const man = JSON.parse(fs.readFileSync(path.join(EXT, "manifest.json")));
  man.host_permissions = ["http://localhost/*"];
  fs.writeFileSync(path.join(EXT, "manifest.json"), JSON.stringify(man, null, 2));

  // préférences Chrome : dossier de téléchargement + pas de boîte "Enregistrer sous"
  fs.mkdirSync(path.join(PROFILE, "Default"), { recursive: true });
  fs.writeFileSync(path.join(PROFILE, "Default", "Preferences"), JSON.stringify({
    download: { default_directory: DL, prompt_for_download: false, directory_upgrade: true },
  }));
  const server = await start();
  const launch = () => chromium.launchPersistentContext(PROFILE, {
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--window-position=-2400,0"],
  });
  let ctx = await launch();
  const errors = [];
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent("serviceworker");
    const extId = sw.url().split("/")[2];

    const moodle = ctx.pages()[0] || (await ctx.newPage());
    moodle.on("console", (m) => m.type() === "error" && !/40[4]|500/.test(m.text()) && errors.push("page: " + m.text()));
    const cdp = await ctx.newCDPSession(moodle);
    await cdp.send("Browser.setDownloadBehavior", { behavior: "default" });
    await moodle.goto(`${ROOT}/course/view.php?id=2`);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost/*" }))[0].id);

    const popup = await ctx.newPage();
    popup.on("console", (m) => m.type() === "error" && errors.push("popup: " + m.text()));
    popup.on("pageerror", (e) => errors.push("popup exception: " + e.message));
    const popupUrl = `chrome-extension://${extId}/popup.html?tab=${tabId}`;
    await popup.goto(popupUrl);
    const txt = (sel) => popup.locator(sel).innerText();
    const waitEnd = async (re = /Terminé|Annulé|Erreur/, timeout = 30000) => {
      await popup.waitForFunction((r) => new RegExp(r).test(document.getElementById("phase").textContent), re.source, { timeout });
      await sleep(800); // laisse finir l'écriture du journal
    };
    const newRun = async () => {
      await popup.click("#cancel"); // "Nouveau"
      await popup.waitForSelector("#setup:not([hidden])");
    };

    // ---------- 1. Audit UI : écran de configuration ----------
    await popup.waitForSelector("#setup:not([hidden])", { timeout: 10000 });
    check("Détection Moodle + wwwroot affiché", (await txt("#host")) === ROOT, await txt("#host"));
    const items = () => popup.locator("#list label").count();
    check("Filtre 'En cours' présélectionné", await popup.locator('[data-f="inprogress"].on').count() === 1);
    check("Liste filtrée = 1 cours en cours", (await items()) === 1, `${await items()} visibles`);
    check("Compteur sélection", (await txt("#count")).startsWith("1 cours sélectionné(s) sur 2"), await txt("#count"));
    check("Badge classification 'en cours'", (await txt("#list")).includes("en cours"));
    await popup.click('[data-f="past"]');
    check("Filtre 'Passés'", (await items()) === 1 && (await txt("#list")).includes("Génétique"));
    await popup.click('[data-f=""]');
    check("Filtre 'Tous' = 2 cours", (await items()) === 2);
    await popup.fill("#q", "bioch");
    check("Recherche", (await items()) === 1);
    await popup.fill("#q", "");
    await popup.click("#none");
    check("Bouton ✗ (désélection visible)", (await txt("#count")).startsWith("0 cours"));
    await popup.click("#go");
    check("Refus si aucun cours", (await txt("#msg")).includes("au moins un cours"));
    check("Bouton 'Ce cours' visible sur page de cours", await popup.locator("#here").isVisible());
    await popup.click("#here");
    check("'Ce cours' → 1 cours (id 2)", (await txt("#count")).startsWith("1 cours"));
    await popup.click("#all");
    check("Bouton ✓ tout", (await txt("#count")).startsWith("2 cours"));
    check("Destination par défaut = dossier choisi", await popup.isChecked('[name=dest][value=folder]'));
    check("Sous-dossier par défaut (mode dossier) = <host>", (await popup.inputValue("#root")) === "localhost:8765");
    await popup.check('[name=dest][value=downloads]');
    check("Mode Téléchargements : sous-dossier = Moodle/<host>", (await popup.inputValue("#root")) === "Moodle/localhost:8765");
    const defaults = await popup.evaluate(() => ["pages", "pageFiles", "assign", "index", "number", "force"].map((k) => document.getElementById(k).checked));
    check("Options par défaut", JSON.stringify(defaults) === JSON.stringify([true, false, true, true, true, false]), JSON.stringify(defaults));
    check("Parallèle = 3", (await popup.inputValue("#parallel")) === "3");

    // ---------- 2. Premier scrap ----------
    await popup.click("#go");
    await popup.waitForSelector("#run:not([hidden])");
    await waitEnd();
    const root = "Moodle/localhost_8765";
    const files = tree(DL);
    console.log("   fichiers :\n     " + files.join("\n     "));
    const C2 = `${root}/Biochimie_ L3_S1`;
    const expect = [
      `${C2}/00 - Généralités/cours1.pdf`,
      `${C2}/00 - Généralités/img.png`,
      `${C2}/01 - Chapitre 1 _ Intro/Documents TD/sub/a.txt`,
      `${C2}/01 - Chapitre 1 _ Intro/Documents TD/b.png`,
      `${C2}/01 - Chapitre 1 _ Intro/Page info.html`,
      `${C2}/01 - Chapitre 1 _ Intro/Livre.html`,
      `${C2}/01 - Chapitre 1 _ Intro/Devoir 1/consignes.html`,
      `${C2}/01 - Chapitre 1 _ Intro/Devoir 1/sujet.pdf`,
      `${C2}/02 - TD_ séance 1_2 __/notes.pdf`,
      `${C2}/02 - TD_ séance 1_2 __/notes (2).pdf`,
      `${C2}/index.html`,
      `${root}/Génétique (ancien)/01 - Partie 1/diapo.pdf`,
      `${root}/Génétique (ancien)/index.html`,
      `${root}/_nouveautes.html`,
    ];
    for (const f of expect) check("Fichier : " + f.replace(root + "/", ""), files.includes(f));
    check("Logo du thème NON téléchargé", !files.some((f) => f.endsWith("logo.png")));
    check("Pas de fichier parasite", files.length === expect.length, `${files.length} fichiers`);
    const read = (f) => fs.readFileSync(path.join(DL, f), "utf8");
    check("Contenu PDF rev 1", read(expect[0]) === "PDF rev 1");
    check("Collision de noms : 2 contenus distincts", read(expect[8]) !== read(expect[9]));
    check("Page HTML en UTF-8", read(expect[4]).includes("Contenu de la page é"));
    const idx = read(expect[10]);
    check("index.html : lien local vers fichier", idx.includes('href="00%20-%20G%C3%A9n%C3%A9ralit%C3%A9s/cours1.pdf"'));
    check("index.html : vraie URL du lien externe", idx.includes("https://example.com/ressource"));
    check("index.html : forum listé en ligne", idx.includes("Forum") && idx.includes("en ligne"));
    check("_nouveautes.html liste les fichiers", read(`${root}/_nouveautes.html`).includes("cours1.pdf"));
    const stats1 = await txt("#stats");
    check("Stats run 1", /Cours 2\/2/.test(stats1) && /0 échecs/.test(stats1), stats1);
    check("Barre à 100 %", (await popup.evaluate(() => document.getElementById("bar").style.width)) === "100%");
    check("Bouton Pause caché à la fin", !(await popup.locator("#pause").isVisible()));
    check("Bouton 'Nouveau' à la fin", (await txt("#cancel")) === "Nouveau");
    const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
    check("Badge icône ✓", badge === "✓", badge);
    check("Encart de progression dans la page Moodle", (await moodle.locator("text=/Terminé — cours 2\\/2/").count()) === 1);

    // ---------- 3. Re-sync sans changement ----------
    await newRun();
    check("Options conservées après 'Nouveau'", (await popup.inputValue("#root")) === "Moodle/localhost:8765");
    check("Date de dernière synchro affichée", (await txt("#list")).includes("✓"));
    await popup.click('[data-f=""]'); await popup.click("#all");
    await popup.click("#go");
    await waitEnd();
    const stats2 = await txt("#stats");
    check("Re-sync : 0 nouveau (pages/consignes/index stables)", /· 0 nouveaux/.test(stats2), stats2);
    check("Re-sync : aucun fichier en plus", tree(DL).length === expect.length);

    // ---------- 4. Changements côté Moodle + suppression locale ----------
    state.rev = 2;                         // nouvelle révision (URL change)
    state.files["a.txt"] = "contenu A v2"; // même URL, ETag change
    await newRun();
    await popup.click('[data-f=""]'); await popup.click("#all");
    await popup.click("#go");
    await waitEnd();
    const stats3 = await txt("#stats");
    check("Sync incrémentale : 2 changements détectés", /· 2 nouveaux/.test(stats3), stats3);
    check("cours1.pdf mis à jour (rev 2)", read(expect[0]) === "PDF rev 2");
    check("a.txt mis à jour via ETag", read(expect[2]) === "contenu A v2");
    const journal = read(`${root}/_nouveautes.html`);
    check("Journal : entrée 'mis à jour'", journal.includes("mis à jour"));
    check("Journal : 2 synchros avec changements", (journal.match(/<h2>/g) || []).length === 2);
    check("Pas de doublon type 'cours1 (1).pdf'", tree(DL).length === expect.length);

    // ---------- 5. Échec + réessai ----------
    state.files["b.png"] = "PNG v2";
    state.fail.add("b.png");
    await newRun();
    await popup.click('[data-f=""]'); await popup.click("#all");
    await popup.click("#go");
    await waitEnd();
    check("Échec compté", /1 échecs/.test(await txt("#stats")), await txt("#stats"));
    check("Bouton 'Réessayer les échecs' visible", await popup.locator("#retry").isVisible());
    state.fail.delete("b.png");
    await popup.click("#retry");
    await popup.waitForFunction(() => /0 échecs/.test(document.getElementById("stats").textContent) && /Terminé/.test(document.getElementById("phase").textContent), null, { timeout: 15000 });
    check("Réessai réussi", read(`${C2}/01 - Chapitre 1 _ Intro/Documents TD/b.png`) === "PNG v2");

    // ---------- 6. Pause / reprise / annulation ----------
    state.delay = 1500;
    await newRun();
    await popup.click('[data-f=""]'); await popup.click("#all");
    await popup.check("#force");
    await popup.fill("#parallel", "1");
    await popup.click("#go");
    await sleep(1200);
    await popup.click("#pause");
    await sleep(700);
    check("Pause affichée", (await txt("#phase")).includes("(pause)") && (await txt("#pause")) === "Reprendre");
    await sleep(4000); const f1 = await txt("#stats"); await sleep(3500); const f2 = await txt("#stats");
    check("Pause : plus de progression", f1 === f2, `${f1} | ${f2}`);
    await popup.click("#pause");
    await sleep(500);
    check("Reprise", !(await txt("#phase")).includes("(pause)"));
    await popup.click("#cancel");
    await waitEnd(/Annulé/, 10000);
    check("Annulation", (await txt("#phase")) === "Annulé" && (await txt("#cancel")) === "Nouveau");
    state.delay = 0;
    await newRun();
    check("'Tout re-télécharger' décoché après usage", !(await popup.isChecked("#force")));
    check("Parallèle mémorisé", (await popup.inputValue("#parallel")) === "1");

    // ---------- 8. Page non-Moodle ----------
    const other = await ctx.newPage();
    await other.goto("data:text/html,<p>pas moodle</p>").catch(() => {});
    await other.goto(`${ROOT}/introuvable`);
    const otherId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost/introuvable" }))[0].id);
    const p2 = await ctx.newPage();
    await p2.goto(`chrome-extension://${extId}/popup.html?tab=${otherId}`);
    await p2.waitForFunction(() => document.getElementById("msg").textContent.length > 0);
    check("Page non-Moodle détectée", (await p2.locator("#msg").innerText()).includes("pas un Moodle"));

    // ---------- 9. Fichier supprimé du disque + redémarrage de Chrome ----------
    await ctx.close();
    fs.rmSync(path.join(DL, expect[1])); // img.png
    ctx = await launch();
    let [sw2] = ctx.serviceWorkers();
    if (!sw2) sw2 = await ctx.waitForEvent("serviceworker");
    const m2 = ctx.pages()[0] || (await ctx.newPage());
    await (await ctx.newCDPSession(m2)).send("Browser.setDownloadBehavior", { behavior: "default" });
    await m2.goto(`${ROOT}/my/`);
    const t2 = await sw2.evaluate(async () => (await chrome.tabs.query({ url: "http://localhost/*" }))[0].id);
    const pp = await ctx.newPage();
    await pp.goto(`chrome-extension://${extId}/popup.html?tab=${t2}`);
    await pp.waitForSelector("#setup:not([hidden])");
    check("'Ce cours' caché hors page de cours", !(await pp.locator("#here").isVisible()));
    await pp.click('[data-f=""]'); await pp.click("#all");
    await pp.click("#go");
    await pp.waitForFunction(() => /Terminé/.test(document.getElementById("phase").textContent), null, { timeout: 30000 });
    const st9 = await pp.locator("#stats").innerText();
    check("Après redémarrage : fichier supprimé re-téléchargé", fs.existsSync(path.join(DL, expect[1])), st9);
    check("Après redémarrage : seul ce fichier est repris", /· 1 nouveaux/.test(st9), st9);
    check("Cookie de session envoyé (mode Téléchargements)", !state.log.some((l) => l.startsWith("NOCOOKIE")));

    // ---------- 10. Mode "Dossier choisi" (File System Access, ici dossier privé OPFS) ----------
    const pf = await ctx.newPage();
    pf.on("pageerror", (e) => errors.push("popup(folder) exception: " + e.message));
    const syncPage = () => ctx.pages().find((p) => p.url().includes("/sync.html"));
    const runFolder = async () => {
      await pf.goto(`chrome-extension://${extId}/popup.html?tab=${t2}&test=opfs`);
      await pf.waitForSelector("#setup:not([hidden]), #run:not([hidden])");
      if (await pf.locator("#cancel").isVisible()) { await pf.click("#cancel"); await pf.waitForSelector("#setup:not([hidden])"); }
      await pf.check('[name=dest][value=folder]');
      await pf.click('[data-f=""]'); await pf.click("#all");
      await pf.click("#go");
      await pf.waitForFunction(() => /Terminé|Erreur/.test(document.getElementById("phase").textContent), null, { timeout: 30000 });
      await sleep(1000);
      return pf.locator("#stats").innerText();
    };
    const opfs = () => syncPage().evaluate(async () => {
      const out = {};
      async function walk(d, pre) {
        for await (const [n, h] of d.entries()) {
          if (h.kind === "directory") await walk(h, pre + n + "/");
          else out[pre + n] = await (await h.getFile()).text();
        }
      }
      await walk(await navigator.storage.getDirectory(), "");
      return out;
    });
    state.log.length = 0;
    const s10 = await runFolder();
    check("Mode dossier : onglet de synchro ouvert", !!syncPage());
    const F = await opfs();
    const R = "localhost_8765";
    console.log("   dossier :\n     " + Object.keys(F).join("\n     "));
    const fexp = expect.map((f) => f.replace("Moodle/localhost_8765", R));
    check("Mode dossier : 14 fichiers aux bons chemins", fexp.every((f) => f in F) && Object.keys(F).length === 14, s10);
    check("Mode dossier : contenu fichier (rev 2)", F[fexp[0]] === "PDF rev 2");
    check("Mode dossier : cookie de session envoyé depuis l'onglet extension", !state.log.some((l) => l.startsWith("NOCOOKIE")), state.log.filter((l) => l.startsWith("NOCOOKIE")).slice(0, 2).join(" "));
    check("Mode dossier : page de connexion jamais enregistrée comme fichier", !Object.values(F).some((t) => t.includes("id=login")));
    const s10b = await runFolder();
    check("Mode dossier : re-sync = 0 nouveau", /· 0 nouveaux/.test(s10b), s10b);
    await syncPage().evaluate(async (p) => {
      const parts = p.split("/"); const name = parts.pop();
      let d = await navigator.storage.getDirectory();
      for (const x of parts) d = await d.getDirectoryHandle(x);
      await d.removeEntry(name);
    }, fexp[1]);
    const s10c = await runFolder();
    check("Mode dossier : fichier supprimé repris SANS redémarrage", /· 1 nouveaux/.test(s10c) && fexp[1] in (await opfs()), s10c);
    // ---------- 7. Vider l'historique ----------
    await pp.click("#cancel"); await pp.waitForSelector("#setup:not([hidden])");
    await pp.click("#clr");
    check("Lien 'Vider l'historique'", (await pp.locator("#msg").innerText()).includes("vidé"));
    await sleep(800);
    const h = await sw2.evaluate(async () => Object.keys((await chrome.storage.local.get("hist")).hist || {}).length);
    check("Historique vide en stockage", h === 0, `${h} entrées`);


  } catch (e) {
    check("Exception du test", false, e.stack.split("\n").slice(0, 3).join(" | "));
  } finally {
    check("Aucune erreur JS console", errors.length === 0, errors.slice(0, 5).join(" || "));
    const ok = results.filter((r) => r.ok).length;
    console.log(`\n${ok}/${results.length} OK`);
    fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
    await ctx.close();
    server.close();
  }
})();
