// Moteur commun : file (N en parallèle), pause/annulation/réessai, historique pour sync incrémentale,
// journal des nouveautés. Utilisé par background.js (mode Téléchargements) et sync.js (mode Dossier).
// cfg = { mode, histKey, transfer(it, job) → Promise<{id?}>, abort(job), exists(entry) → Promise<bool>,
//         writeText(path, text) → Promise, onFile?(path, kind) }
function createEngine(cfg) {
  let MAX = 3, queue = [], active = 0, paused = false, force = false, tab = null, cancelled = false, on = false;
  let done = 0, failed = 0, skipped = 0, failedItems = [], runNew = [];
  const flags = {};
  const jobs = new Set();
  let hist = null, saveTimer;

  async function loadHist() {
    if (!hist) hist = (await chrome.storage.local.get(cfg.histKey))[cfg.histKey] || {};
    return hist;
  }
  const saveHist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => chrome.storage.local.set({ [cfg.histKey]: hist }), 500);
  };
  const isData = (u) => u.startsWith("data:");
  // L'URL pluginfile contient la révision ; sinon "ver" = ETag (fichiers) ou empreinte (pages).
  const keyOf = (m) => (isData(m.url) ? "data:" + m.filename : m.url.split("?")[0] + (m.ver ? "|" + m.ver : ""));

  // null = à jour ; sinon "nouveau" | "maj"
  async function needed(m) {
    const h = await loadHist();
    const k = keyOf(m);
    let e = h[k];
    if (!e && m.ver && !isData(m.url) && h[m.url.split("?")[0]]) e = h[k] = { path: m.filename }; // migration
    if (e === 1) e = h[k] = { path: m.filename };
    if (force || !e) return Object.values(h).some((x) => x && x.path === m.filename) ? "maj" : "nouveau";
    if (isData(m.url) && e.v !== m.ver) return "maj";
    if (e.path !== m.filename) return "nouveau"; // déplacé (autre section / autre dossier)
    if (!(await cfg.exists(e))) return "nouveau"; // supprimé du disque
    return null;
  }

  function push() {
    if (tab === null) return;
    chrome.tabs
      .sendMessage(tab, { type: "prog", done, failed, skipped, pending: queue.length + active, paused, news: runNew.length, ask: !!flags.ask })
      .catch(() => {});
  }
  function fail(it) { failed++; failedItems.push(it); }

  function pump() {
    while (!paused && !cancelled && active < MAX && queue.length) {
      const it = queue.shift();
      const job = { it, ctl: new AbortController(), dead: false };
      jobs.add(job);
      active++;
      cfg.transfer(it, job).then(
        (res) => {
          if (job.dead) return;
          done++;
          loadHist().then((h) => { h[keyOf(it)] = { id: res && res.id, path: it.filename, v: it.ver }; saveHist(); });
          runNew.push({ path: it.filename, kind: it.kind });
          cfg.onFile && cfg.onFile(it.filename, it.kind);
        },
        (err) => { if (!job.dead) { console.warn("[Course Downloader]", it.filename, err); fail(it); } }
      ).finally(() => {
        if (job.dead) return;
        jobs.delete(job); active--; pump();
      });
    }
    push();
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

  // <racine>/_nouveautes.html : fichiers nouveaux / mis à jour, par synchro (50 dernières)
  async function writeJournal(root, summary) {
    const jk = "journal_" + cfg.mode;
    const journal = (await chrome.storage.local.get(jk))[jk] || [];
    const mine = runNew.filter((x) => x.path.startsWith(root + "/"));
    if (mine.length) journal.unshift({ t: Date.now(), items: mine });
    const kept = journal.filter((r) => r.items.length).slice(0, 50);
    await chrome.storage.local.set({ [jk]: kept });
    if (mine.length) {
      const body = kept.map((r) => {
        const rows = r.items.map((x) => {
          const rel = x.path.slice(root.length + 1);
          return `<li><span class="${x.kind}">${x.kind === "maj" ? "mis à jour" : "nouveau"}</span> <a href="${esc(encPath(rel))}">${esc(rel)}</a></li>`;
        }).join("");
        return `<h2>${esc(new Date(r.t).toLocaleString())} — ${r.items.length} fichier(s)</h2><ul>${rows}</ul>`;
      }).join("");
      const html = `<!doctype html><meta charset="utf-8"><title>Nouveautés Moodle</title>` +
        `<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1000px;margin:2em auto;padding:0 1em}` +
        `span{font-size:11px;padding:1px 6px;border-radius:8px;color:#fff;background:#16a34a}span.maj{background:#f98012}</style>` +
        `<h1>Nouveautés</h1>${body}`;
      try { await cfg.writeText(`${root}/_nouveautes.html`, html); } catch (e) { console.warn(e); }
    }
    const news = mine.filter((x) => !x.path.endsWith("/index.html")).length;
    chrome.notifications.create({
      type: "basic", iconUrl: "icons/icon128.png", title: chrome.runtime.getManifest().name,
      message: (news ? `${news} nouveau(x) / mis à jour. ` : "Rien de nouveau. ") + summary,
    });
    runNew = []; // évite les doublons après "Réessayer les échecs"
  }

  function handle(m, sender) {
    if (m.type === "reset") {
      on = (m.mode || "downloads") === cfg.mode;
      if (!on) return;
      queue = []; active = 0; paused = false; done = failed = skipped = 0; failedItems = []; runNew = [];
      force = !!m.force; tab = sender.tab.id; jobs.clear(); cancelled = false;
      for (const k in flags) delete flags[k];
      MAX = Math.min(8, Math.max(1, m.parallel || 3));
      cfg.onReset && cfg.onReset();
      return;
    }
    if (m.type === "clearHistory") {
      hist = {}; saveHist(); chrome.storage.local.remove("journal_" + cfg.mode); return;
    }
    if (!on) return;
    switch (m.type) {
      case "dl":
        if (cancelled) break;
        needed(m).then((kind) => {
          if (cancelled) return; // arrivé après l'annulation (HEAD encore en vol)
          if (!kind) { skipped++; push(); return; }
          queue.push({ url: m.url, filename: m.filename, ver: m.ver, kind }); pump();
        });
        break;
      case "retry":
        failed -= failedItems.length;
        queue.push(...failedItems); failedItems = []; pump();
        break;
      case "pause": paused = true; push(); break;
      case "resume": paused = false; pump(); break;
      case "cancel":
        cancelled = true; queue = [];
        for (const job of jobs) { job.dead = true; try { cfg.abort(job); } catch (e) {} }
        jobs.clear(); active = 0; paused = false; push();
        break;
      case "finished":
        writeJournal(m.root, m.summary);
        break;
    }
  }

  return { handle, setFlag: (k, v) => { flags[k] = v; push(); }, flag: (k) => flags[k] };
}
