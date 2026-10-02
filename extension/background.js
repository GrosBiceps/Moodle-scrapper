// Mode "Téléchargements Chrome" : transfert via chrome.downloads. Badge de l'icône.
importScripts("engine.js");

const pending = new Map(); // downloadId -> { res, rej }

// Existence sur disque : search() déclenche la vérification de Chrome (~1–2 s plus tard).
// Limite Chrome : une seule vérification par fichier et par session.
let primedAt = Date.now();
chrome.downloads.search({ limit: 0 });
async function onDisk(id) {
  if (id === undefined) return true;
  const wait = primedAt + 2500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const [it] = await chrome.downloads.search({ id });
  return !it || it.exists !== false;
}

function b64utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const engine = createEngine({
  mode: "downloads",
  histKey: "hist",
  onReset() {
    chrome.downloads.search({ limit: 0 }); // amorce la vérification d'existence
    primedAt = Date.now();
  },
  transfer: (it, job) => new Promise((res, rej) => {
    chrome.downloads.download(
      { url: it.url, filename: it.filename, conflictAction: "overwrite", saveAs: false },
      (id) => {
        if (id === undefined) return rej(new Error(chrome.runtime.lastError?.message || "download"));
        job.id = id;
        if (job.dead) { chrome.downloads.cancel(id); return; }
        pending.set(id, { res: () => res({ id }), rej });
        // Boîte "Enregistrer sous" = réglage Chrome "Demander où enregistrer" actif
        if (!engine.flag("ask")) setTimeout(async () => {
          const [x] = await chrome.downloads.search({ id });
          if (x && x.state === "in_progress" && !x.filename) engine.setFlag("ask", true);
        }, 3000);
      }
    );
  }),
  abort: (job) => { if (job.id !== undefined) chrome.downloads.cancel(job.id); },
  exists: (e) => onDisk(e.id),
  writeText: (path, text) => chrome.downloads.download({
    url: "data:text/html;base64," + b64utf8(text), filename: path, conflictAction: "overwrite", saveAs: false,
  }),
});

chrome.downloads.onChanged.addListener((d) => {
  const p = pending.get(d.id);
  if (!p || !d.state) return;
  if (d.state.current === "complete") p.res();
  else if (d.state.current === "interrupted") p.rej(new Error(d.error ? d.error.current : "interrupted"));
  else return;
  pending.delete(d.id);
});

chrome.runtime.onMessage.addListener((m, sender) => {
  if (m.type === "badge") {
    if (sender.tab) chrome.action.setBadgeText({ tabId: sender.tab.id, text: m.text });
    chrome.action.setBadgeBackgroundColor({ color: "#f98012" });
    return;
  }
  engine.handle(m, sender); // "ping" : simple réveil du service worker
});
