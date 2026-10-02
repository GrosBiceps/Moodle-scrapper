// Mode "Dossier choisi" : écrit les fichiers directement dans un dossier (File System Access API).
// Contourne le réglage Chrome "Demander où enregistrer chaque fichier" et permet de viser un Drive.
const $ = (id) => document.getElementById(id);
let dir = null, pendingStart = null;

let TEST_OPFS = false;
/* test:start — ?test=opfs : dossier privé du navigateur pour les tests automatisés (pas de sélecteur natif) */
TEST_OPFS = new URLSearchParams(location.search).get("test") === "opfs";
/* test:end */

async function getDir() {
  if (TEST_OPFS) return navigator.storage.getDirectory();
  return dir || (dir = await idb.get("dir"));
}
async function fileHandle(path, create) {
  let d = await getDir();
  const parts = path.split("/");
  const name = parts.pop();
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return d.getFileHandle(name, { create });
}

const log = (s) => {
  const l = $("log");
  l.textContent = (s + "\n" + l.textContent).split("\n").slice(0, 300).join("\n");
};

const engine = createEngine({
  mode: "folder",
  histKey: "hist_fs",
  async transfer(it, job) {
    const r = await fetch(it.url, { credentials: "include", signal: job.ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // session expirée : Moodle renvoie la page de connexion au lieu du fichier
    if (/\/login\/index\.php/.test(r.url)) throw new Error("Session Moodle expirée");
    const fh = await fileHandle(it.filename, true);
    const w = await fh.createWritable(); // écrit dans un fichier temporaire, remplacé à la fin (atomique)
    try {
      await r.body.pipeTo(w, { signal: job.ctl.signal });
    } catch (e) {
      try { await w.abort(); } catch (_) {}
      throw e;
    }
    return {};
  },
  abort: (job) => job.ctl.abort(),
  async exists(e) {
    try { await fileHandle(e.path, false); return true; } catch (_) { return false; }
  },
  async writeText(path, text) {
    const w = await (await fileHandle(path, true)).createWritable();
    await w.write(text);
    await w.close();
  },
  onFile: (path, kind) => log(`${kind === "maj" ? "↻" : "+"} ${path}`),
});
chrome.runtime.onMessage.addListener((m, sender) => { engine.handle(m, sender); });

async function showDir() {
  const d = await getDir();
  $("dir").textContent = d ? `📁 ${d.name || "(dossier privé de test)"}` : "Aucun dossier choisi.";
  $("dir").classList.toggle("mut", !d);
}

$("pick").onclick = async () => {
  try {
    const d = await showDirectoryPicker({ id: "moodle-scrapper", mode: "readwrite" });
    await idb.set("dir", d);
    dir = d;
    $("err").textContent = "";
    showDir();
  } catch (e) {
    if (e.name !== "AbortError") $("err").textContent = e.message;
  }
};

async function ensureAccess() {
  // 1) accès au site Moodle depuis cet onglet (cookies de session) — avant le sélecteur qui consomme le clic
  const u = new URL(pendingStart.root);
  const origins = [`${u.protocol}//${u.hostname}/*`];
  if (!(await chrome.permissions.contains({ origins }))) {
    if (!(await chrome.permissions.request({ origins }))) throw new Error("Accès au site Moodle refusé.");
  }
  // 2) dossier
  let d = await getDir();
  if (!d) {
    d = await showDirectoryPicker({ id: "moodle-scrapper", mode: "readwrite" });
    await idb.set("dir", d);
    dir = d;
    showDir();
  }
  if (!TEST_OPFS && (await d.queryPermission({ mode: "readwrite" })) !== "granted") {
    if ((await d.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("Accès au dossier refusé.");
  }
}

$("start").onclick = async () => {
  $("err").textContent = "";
  try {
    await ensureAccess();
  } catch (e) {
    $("err").textContent = e.message;
    return;
  }
  const { tabId, courses, opts } = pendingStart;
  await chrome.storage.session.remove("pendingStart");
  chrome.tabs.sendMessage(tabId, { type: "start", courses, opts }, () => {
    if (chrome.runtime.lastError) { $("err").textContent = "Onglet Moodle introuvable : rouvre la popup sur Moodle."; return; }
    $("startCard").hidden = true;
    $("runCard").hidden = false;
    poll(tabId);
  });
};

function poll(tabId) {
  const t = setInterval(() => {
    chrome.tabs.sendMessage(tabId, { type: "status" }, (s) => {
      if (chrome.runtime.lastError || !s) { $("phase").textContent = "Onglet Moodle fermé ou rechargé."; clearInterval(t); return; }
      $("phase").textContent = s.phase + (s.paused ? " (pause)" : "");
      $("bar").style.width = s.pct + "%";
      $("stats").textContent = `Cours ${s.scanDone}/${s.scanTotal} · ${s.done} nouveaux/mis à jour · ${s.skipped} déjà à jour · ${s.failed} échecs · ${s.found} trouvés`;
      document.title = `${s.pct}% — Course Downloader for Moodle™`;
    });
  }, 500);
}

(async function init() {
  await showDir();
  pendingStart = (await chrome.storage.session.get("pendingStart")).pendingStart;
  if (pendingStart) {
    $("startCard").hidden = false;
    $("pendingTxt").textContent = `${pendingStart.courses.length} cours prêts à synchroniser depuis ${new URL(pendingStart.root).host}.`;
    // Accès déjà accordés (dossier + site) : démarrage direct, sans clic supplémentaire
    const u = new URL(pendingStart.root);
    const d = await getDir();
    const ok = d && (TEST_OPFS || (await d.queryPermission({ mode: "readwrite" })) === "granted") &&
      (await chrome.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] }));
    if (ok) $("start").click();
  }
})();
