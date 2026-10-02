const $ = (id) => document.getElementById(id);
const DEF = {
  types: { docs: true, images: true, media: true, archives: true, other: true },
  pages: true, pageFiles: false, assign: true, index: true,
  number: true, force: false, parallel: 3, roots: {}, mode: "folder",
};
const CLS = { inprogress: "en cours", past: "passé", future: "futur", hidden: "masqué" };
const sel = new Set();
let tab, info, courses = {}, filter = "", sync = {}, saved, timer;

const send = (m) => new Promise((res) => chrome.tabs.sendMessage(tab.id, m, (r) => res(chrome.runtime.lastError ? null : r)));
const BOOLS = ["pages", "pageFiles", "assign", "index", "number", "force"];

function readOpts() {
  const types = {};
  document.querySelectorAll("[data-t]").forEach((c) => (types[c.dataset.t] = c.checked));
  const o = { types, parallel: +$("parallel").value || 3, root: $("root").value.trim(), mode: mode() };
  BOOLS.forEach((k) => (o[k] = $(k).checked));
  return o;
}
function applyOpts(o) {
  document.querySelectorAll("[data-t]").forEach((c) => (c.checked = !!o.types[c.dataset.t]));
  BOOLS.forEach((k) => ($(k).checked = !!o[k]));
  $("parallel").value = o.parallel || 3;
  document.querySelector(`[name=dest][value="${o.mode || "folder"}"]`).checked = true;
  destChanged();
}
const mode = () => document.querySelector("[name=dest]:checked").value;
// sous-dossier mémorisé par site et par mode ; défaut : <site> dans le dossier choisi, Moodle/<site> dans Téléchargements
function destChanged() {
  const m = mode();
  $("root").value = (saved.roots || {})[`${m}:${info.host}`] || (m === "folder" ? info.host : `Moodle/${info.host}`);
  $("rootHint").textContent = m === "folder" ? "Relatif au dossier choisi." : "Relatif au dossier Téléchargements.";
}
document.querySelectorAll("[name=dest]").forEach((r) => (r.onchange = destChanged));
let TEST = null;
/* test:start */ TEST = new URLSearchParams(location.search).get("test"); /* test:end */
async function openSync(extra = "") {
  const base = chrome.runtime.getURL("sync.html");
  const url = base + (TEST ? `?test=${TEST}` : "") + extra;
  const [t] = await chrome.tabs.query({ url: base + "*" });
  if (t) await chrome.tabs.update(t.id, { url, active: true });
  else await chrome.tabs.create({ url });
}

function visible() {
  const q = $("q").value.toLowerCase();
  return Object.entries(courses).filter(([, c]) => (!filter || c.cls === filter) && c.name.toLowerCase().includes(q));
}
function drawList() {
  $("list").innerHTML = "";
  for (const [id, c] of visible()) {
    const l = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = sel.has(id);
    cb.onchange = () => { cb.checked ? sel.add(id) : sel.delete(id); count(); };
    const n = document.createElement("span"); n.className = "n"; n.textContent = c.name;
    const s = document.createElement("small");
    const t = sync[`${info.host}:${id}`];
    s.textContent = [CLS[c.cls], t && "✓ " + new Date(t).toLocaleDateString()].filter(Boolean).join(" · ");
    l.append(cb, n, s);
    $("list").appendChild(l);
  }
  document.querySelectorAll("[data-f]").forEach((b) => b.classList.toggle("on", b.dataset.f === filter));
  count();
}
const count = () => ($("count").textContent = `${sel.size} cours sélectionné(s) sur ${Object.keys(courses).length}`);
const show = (v) => { $("setup").hidden = v !== "setup"; $("run").hidden = v !== "run"; };

async function poll() {
  const s = await send({ type: "status" });
  if (!s || !s.phase) return false;
  show("run");
  $("phase").textContent = s.phase + (s.paused ? " (pause)" : "");
  $("bar").style.width = s.pct + "%";
  $("stats").textContent = `Cours ${s.scanDone}/${s.scanTotal} · ${s.done} nouveaux/mis à jour · ${s.skipped} déjà à jour · ${s.failed} échecs · ${s.found} trouvés`;
  $("pause").textContent = s.paused ? "Reprendre" : "Pause";
  $("warn").hidden = !s.ask;
  const end = !s.running && /Terminé|Annulé|Erreur/.test(s.phase);
  $("pause").hidden = end;
  $("retry").hidden = !(s.finished && s.failed);
  $("cancel").textContent = end ? "Nouveau" : "Annuler";
  return true;
}

(async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  /* test:start — ?tab=<id> : popup ouverte comme page sur un onglet donné (tests automatisés) */
  const forced = new URLSearchParams(location.search).get("tab");
  if (forced) tab = await chrome.tabs.get(+forced);
  /* test:end */
  if (!tab || !/^https?:/.test(tab.url || "")) { $("msg").textContent = "Ouvre une page de ton Moodle dans l'onglet actif."; return; }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
  } catch (e) { $("msg").textContent = "Impossible d'accéder à cette page."; return; }
  info = await send({ type: "detect" });
  if (!info || !info.moodle) { $("msg").textContent = "Cette page n'est pas un Moodle."; return; }
  $("host").textContent = info.root;
  if (!info.logged) { $("msg").textContent = "Connecte-toi d'abord sur ce Moodle, puis rouvre."; return; }

  const st = await chrome.storage.local.get(["opts", "sync"]);
  saved = { ...DEF, ...(st.opts || {}) };
  sync = st.sync || {};
  applyOpts(saved);
  const d = await idb.get("dir");
  $("dirName").textContent = d ? `📁 ${d.name}` : "aucun dossier choisi";
  if (await poll()) { timer = setInterval(poll, 500); return; }

  $("msg").textContent = "Chargement des cours…";
  const r = await send({ type: "getCourses" });
  if (!r || r.error) { $("msg").textContent = (r && r.error) || "Erreur de communication, recharge la page (F5)."; return; }
  courses = r.courses;
  if (!Object.keys(courses).length) { $("msg").textContent = "Aucun cours trouvé."; return; }
  if (info.course && courses[info.course]) {
    $("here").hidden = false;
    $("here").title = courses[info.course].name;
  }
  // présélection : cours en cours s'il y en a, sinon tous
  const cur = Object.keys(courses).filter((id) => courses[id].cls === "inprogress");
  (cur.length ? cur : Object.keys(courses)).forEach((id) => sel.add(id));
  filter = cur.length ? "inprogress" : "";
  $("msg").textContent = "";
  show("setup");
  drawList();
})();

document.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; drawList(); }));
$("q").oninput = drawList;
$("all").onclick = () => { visible().forEach(([id]) => sel.add(id)); drawList(); };
$("none").onclick = () => { visible().forEach(([id]) => sel.delete(id)); drawList(); };
$("here").onclick = () => { sel.clear(); sel.add(info.course); filter = ""; $("q").value = ""; drawList(); };
$("clr").onclick = (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: "clearHistory" }); $("msg").textContent = "Historique vidé."; };
$("go").onclick = async () => {
  if (!sel.size) { $("msg").textContent = "Sélectionne au moins un cours."; return; }
  const opts = readOpts();
  saved.roots = { ...(saved.roots || {}), [`${opts.mode}:${info.host}`]: opts.root };
  await chrome.storage.local.set({ opts: { ...saved, ...opts, roots: saved.roots, force: false } });
  const list = [...sel].map((id) => ({ id, name: courses[id].name }));
  if (opts.mode === "folder") {
    // l'écriture se fait dans l'onglet de synchro (la popup se ferme dès qu'on clique ailleurs)
    await chrome.storage.session.set({ pendingStart: { tabId: tab.id, courses: list, opts, root: info.root } });
    await openSync();
  } else {
    await send({ type: "start", courses: list, opts });
  }
  show("run");
  timer = setInterval(poll, 500);
  poll();
};
$("pause").onclick = () => send({ type: $("pause").textContent === "Pause" ? "pause" : "resume" });
$("retry").onclick = () => send({ type: "retry" });
$("open").onclick = () => (saved.mode === "folder" ? openSync() : chrome.downloads.showDefaultFolder());
$("pickDir").onclick = (e) => { e.preventDefault(); openSync(); };
const openSettings = (e) => { e && e.preventDefault(); chrome.tabs.create({ url: "chrome://settings/downloads" }); };
$("settings").onclick = openSettings;
$("settings2").onclick = openSettings;
$("cancel").onclick = async () => {
  if ($("cancel").textContent === "Nouveau") { clearInterval(timer); await send({ type: "clear" }); location.reload(); return; }
  await send({ type: "cancel" });
};
