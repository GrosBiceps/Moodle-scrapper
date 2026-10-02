// Injecté à la demande par la popup dans l'onglet Moodle actif.
// Tourne avec les cookies de la page → marche avec SSO/CAS/Shibboleth.
(() => {
  if (window.__courseDownloader) return;
  window.__courseDownloader = true;

  // ---------- détection Moodle ----------
  const page = document.documentElement.innerHTML;
  const cfg = (k) => {
    const m = page.match(new RegExp(`"${k}":"([^"]*)"`));
    return m ? m[1].replace(/\\\//g, "/") : null;
  };
  // wwwroot gère les Moodle installés en sous-dossier (https://site.fr/moodle)
  const ROOT = (cfg("wwwroot") || location.origin).replace(/\/$/, "");
  const IS_MOODLE = !!cfg("wwwroot") && /M\.cfg|moodle/i.test(page);
  const LOGGED = !document.body.classList.contains("notloggedin");
  const pageCourse = (() => {
    const m = document.body.className.match(/\bcourse-(\d+)\b/);
    return m && m[1] !== "1" ? m[1] : null;
  })();

  // ---------- utilitaires ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const safe = (s, max = 100) =>
    (s || "_").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim().slice(0, max).replace(/[ .]+$/, "") || "_";
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  const abs = (href, base = ROOT + "/") => new URL(href, base).href;
  const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
  async function getText(url) {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  }
  const mainOf = (doc) => doc.querySelector("#region-main, [role=main]") || doc.body || doc;

  const EXT = {
    docs: "pdf doc docx odt rtf txt md tex ppt pptx pps ppsx odp key xls xlsx ods csv epub djvu",
    images: "png jpg jpeg gif svg webp bmp tif tiff heic",
    media: "mp4 mkv avi mov webm mp3 wav ogg m4a flac wmv",
    archives: "zip rar 7z tar gz tgz bz2 xz",
  };
  function allowed(file, types) {
    const ext = (file.includes(".") ? file.split(".").pop() : "").toLowerCase();
    for (const [g, list] of Object.entries(EXT)) if (list.split(" ").includes(ext)) return !!types[g];
    return !!types.other;
  }

  // ---------- état + UI ----------
  const st = { phase: "", running: false, finished: false, scanDone: 0, scanTotal: 0, found: 0, done: 0, failed: 0, skipped: 0, paused: false };
  const ctl = { cancel: false };
  let box, bar, label, hb, lastBadge = "";

  function pct() {
    const scan = st.scanTotal ? st.scanDone / st.scanTotal : 0;
    const fin = st.done + st.failed + st.skipped;
    const dl = st.found ? fin / st.found : scan >= 1 ? 1 : 0;
    return Math.min(100, Math.round((scan * 0.5 + dl * 0.5 * scan) * 100));
  }
  function render() {
    if (!box) {
      box = document.createElement("div");
      box.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;background:#1f2937;color:#f9fafb;padding:10px 12px;font:12px/1.4 system-ui,sans-serif;border-radius:8px;width:330px;box-shadow:0 4px 16px #0005";
      const x = document.createElement("span");
      x.textContent = "×";
      x.style.cssText = "float:right;cursor:pointer;font-size:16px;line-height:12px;margin-left:8px";
      x.onclick = () => (box.style.display = "none");
      label = document.createElement("div");
      const track = document.createElement("div");
      track.style.cssText = "height:8px;background:#4b5563;border-radius:4px;margin-top:6px;overflow:hidden";
      bar = document.createElement("div");
      bar.style.cssText = "height:100%;width:0;background:#f98012;transition:width .2s";
      track.appendChild(bar);
      box.append(x, label, track);
      document.body.appendChild(box);
    }
    const p = pct();
    bar.style.width = p + "%";
    label.textContent =
      `${st.phase}${st.paused ? " (pause)" : ""} — cours ${st.scanDone}/${st.scanTotal} — fichiers ${st.done + st.skipped}/${st.found}` +
      (st.skipped ? ` (${st.skipped} déjà là)` : "") + (st.failed ? ` (${st.failed} échecs)` : "") + ` — ${p}%`;
    const badge = st.finished ? (st.failed ? "!" : "✓") : st.phase ? p + "%" : "";
    if (badge !== lastBadge) { lastBadge = badge; chrome.runtime.sendMessage({ type: "badge", text: badge }); }
  }
  function checkFinished() {
    if (st.running || st.finished || ctl.cancel || st.scanDone < st.scanTotal) return;
    if (st.done + st.failed + st.skipped < st.found) return;
    st.finished = true;
    st.phase = "Terminé";
    clearInterval(hb);
    // le background écrit _nouveautes.html et notifie
    chrome.runtime.sendMessage({
      type: "finished", root: st.root,
      summary: `${st.skipped} déjà à jour` + (st.failed ? `, ${st.failed} échecs` : ""),
    });
  }
  async function gate() {
    while (st.paused && !ctl.cancel) await sleep(300);
    if (ctl.cancel) throw new Error("cancel");
  }
  async function pool(tasks, n) {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => {
      while (i < tasks.length) {
        const t = tasks[i++];
        await gate();
        try { await t(); } catch (e) { if (e.message === "cancel") throw e; console.warn("[Course Downloader]", e); }
      }
    }));
  }

  // ---------- liste des cours ----------
  async function getCourses() {
    const html = await getText(`${ROOT}/my/`);
    const key = (html.match(/"sesskey":"([^"]+)"/) || [])[1];
    if (!key || /<body[^>]*class="[^"]*notloggedin/.test(html)) throw new Error("Non connecté");
    const courses = {};
    const method = "core_course_get_enrolled_courses_by_timeline_classification";
    // l'ordre compte : la dernière classification trouvée gagne
    for (const cls of ["allincludinghidden", "all", "hidden", "future", "past", "inprogress"]) {
      try {
        const r = await fetch(`${ROOT}/lib/ajax/service.php?sesskey=${key}&info=${method}`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ index: 0, methodname: method, args: { offset: 0, limit: 0, classification: cls, sort: "fullname" } }]),
        }).then((x) => x.json());
        if (r[0].error) continue;
        for (const c of r[0].data.courses) {
          const tag = ["allincludinghidden", "all"].includes(cls) ? (courses[c.id]?.cls || "") : cls;
          courses[c.id] = { name: c.fullname, cls: tag };
        }
      } catch (e) {}
    }
    // repli pour vieux Moodle (< 3.6) : liens de la page "Mes cours"
    if (!Object.keys(courses).length) {
      for (const u of [`${ROOT}/my/courses.php`, `${ROOT}/my/`]) {
        try {
          const d = parse(await getText(u));
          d.querySelectorAll('a[href*="course/view.php?id="]').forEach((a) => {
            const id = (a.getAttribute("href").match(/id=(\d+)/) || [])[1];
            const name = a.textContent.replace(/\s+/g, " ").trim();
            if (id && id !== "1" && name && !courses[id]) courses[id] = { name, cls: "" };
          });
        } catch (e) {}
      }
    }
    return courses;
  }

  // ---------- résolution des fichiers ----------
  function pluginLinks(el, base) {
    const urls = new Set();
    el.querySelectorAll(
      'a[href*="pluginfile.php"], object[data*="pluginfile.php"], iframe[src*="pluginfile.php"], embed[src*="pluginfile.php"], video[src*="pluginfile.php"], source[src*="pluginfile.php"]'
    ).forEach((n) => {
      const u = n.getAttribute("href") || n.getAttribute("data") || n.getAttribute("src");
      if (u) urls.add(abs(u, base));
    });
    return [...urls];
  }
  async function resolve(url) {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    if (!(r.headers.get("content-type") || "").includes("text/html")) {
      r.body && r.body.cancel(); // redirigé direct vers le fichier
      return [r.url];
    }
    // ressource affichée "intégrée" ou dossier : fichiers dans la zone principale uniquement (pas le logo du thème)
    return pluginLinks(mainOf(parse(await r.text())), r.url);
  }
  // Chemin relatif ; garde les sous-dossiers d'un module "dossier".
  function relPath(url, keepSub) {
    const p = new URL(url).pathname;
    const m = keepSub && p.match(/mod_folder\/content\/\d+\/(.+)$/);
    const dec = (x) => { try { return decodeURIComponent(x); } catch (e) { return x; } };
    return (m ? m[1] : p.split("/").pop()).split("/").map((x) => safe(dec(x))).join("/");
  }

  // ---------- file d'envoi vers le background ----------
  let used, queued, opts;
  function uniq(path, url) {
    let p = path, n = 2;
    while (used.has(p.toLowerCase()) && used.get(p.toLowerCase()) !== url) {
      p = path.replace(/(\.[^./]+)?$/, (ext) => ` (${n})${ext}`);
      n++;
    }
    used.set(p.toLowerCase(), url);
    return p;
  }
  // Limiteur de requêtes HEAD simultanées (un dossier peut contenir des centaines de fichiers)
  let headSlots = 4;
  const headWait = [];
  async function headVer(url) {
    while (headSlots <= 0) await new Promise((r) => headWait.push(r));
    headSlots--;
    try {
      const r = await fetch(url, { method: "HEAD", credentials: "include" });
      // Moodle renvoie l'ETag = hash du contenu du fichier → change dès que le fichier change
      return r.headers.get("etag") || r.headers.get("last-modified") || r.headers.get("content-length") || "";
    } catch (e) {
      return "";
    } finally {
      headSlots++;
      headWait.shift()?.();
    }
  }
  // Les URL mod_resource contiennent déjà la révision (…/content/<rev>/…) : pas besoin de HEAD.
  const hasRevision = (url) => /\/content\/[1-9]\d*\//.test(new URL(url).pathname);

  function queueFile(url, dir, keepSub = false) {
    if (queued.has(url)) return queued.get(url);
    const rel = relPath(url, keepSub);
    if (!allowed(rel.split("/").pop(), opts.types)) return null;
    const path = uniq(`${dir}/${rel}`, url);
    queued.set(url, path);
    st.found++;
    render();
    (async () => {
      const ver = hasRevision(url) ? "" : await headVer(url);
      if (!ctl.cancel) chrome.runtime.sendMessage({ type: "dl", url, ver, filename: path });
    })();
    return path;
  }
  // Empreinte stable d'une page : on retire ce qui change à chaque affichage (ids aléatoires, sesskey…)
  async function pageHash(text) {
    const norm = text
      .replace(/\b(id|for|aria-[a-z]+|data-[a-z-]+)="[^"]*"/g, "")
      .replace(/yui_[\w-]+/g, "")
      .replace(/sesskey=\w+/g, "");
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(norm));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // base64 par blocs : UTF-8 correct et pas de dépassement de pile sur les grosses pages
  function b64utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function saveDataSafe(path, mime, text) {
    path = uniq(path, "data:" + path);
    st.found++;
    render();
    pageHash(text).then((ver) =>
      chrome.runtime.sendMessage({ type: "dl", url: `data:${mime};base64,${b64utf8(text)}`, ver, filename: path })
    );
    return path;
  }
  const htmlDoc = (title, body) =>
    `<!doctype html><meta charset="utf-8"><base href="${esc(ROOT)}/"><title>${esc(title)}</title>` +
    `<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:2em auto;padding:0 1em}img{max-width:100%}</style>` +
    `<h1>${esc(title)}</h1>${body}`;

  // ---------- parcours d'un cours ----------
  function activityName(a) {
    const n = (a.querySelector(".instancename") || a).cloneNode(true);
    n.querySelectorAll(".accesshide, .sr-only, .visually-hidden").forEach((x) => x.remove());
    return n.textContent.replace(/\s+/g, " ").trim() || "sans titre";
  }
  const sectionTitle = (s) =>
    (s.querySelector(".sectionname, .section-title, h3")?.textContent || "").replace(/\s+/g, " ").trim();

  async function getSections(doc, id) {
    const secs = [...doc.querySelectorAll("li.section, li.course-section")];
    if (!secs.length) return [{ title: "General", el: mainOf(doc) }];
    const out = [];
    for (const s of secs) {
      const title = sectionTitle(s) || "General";
      let el = s;
      // format "une section par page" : la section est vide ici, il faut charger sa page
      if (!s.querySelector('a[href*="/mod/"]')) {
        const link = s.querySelector(`a[href*="course/section.php?id="], a[href*="course/view.php?id=${id}&section="]`);
        if (link) {
          try {
            const d = parse(await getText(abs(link.getAttribute("href"))));
            const cands = [...d.querySelectorAll("li.section, li.course-section")];
            el = cands.find((c) => sectionTitle(c) === title) || cands.find((c) => c.querySelector('a[href*="/mod/"]')) || mainOf(d);
          } catch (e) {}
        }
      }
      out.push({ title, el });
    }
    return out;
  }

  async function scrapeCourse(id, name, root) {
    const cname = safe(name, 80);
    const cdir = `${root}/${cname}`;
    const rel = (p) => (p ? p.slice(cdir.length + 1) : null);
    const doc = parse(await getText(`${ROOT}/course/view.php?id=${id}`));
    const sections = await getSections(doc, id);
    const seenCm = new Set();
    const index = [];
    const tasks = [];

    sections.forEach(({ title, el }, i) => {
      const sname = opts.number ? `${String(i).padStart(2, "0")} - ${safe(title, 70)}` : safe(title, 80);
      const sdir = `${cdir}/${sname}`;
      const entry = { title, items: [] };
      index.push(entry);

      for (const a of el.querySelectorAll('a[href*="/mod/"], a[href*="pluginfile.php"]')) {
        const href = abs(a.getAttribute("href"));
        // fichiers directs dans les étiquettes / résumés de section
        if (href.includes("pluginfile.php")) {
          if (seenCm.has(href)) continue;
          seenCm.add(href);
          const it = { name: activityName(a), kind: "fichier", url: href, files: [] };
          entry.items.push(it);
          const p = queueFile(href, sdir);
          if (p) it.files.push(rel(p));
          continue;
        }
        const m = href.match(/\/mod\/(\w+)\/view\.php\?id=(\d+)/);
        if (!m || seenCm.has(m[2])) continue;
        seenCm.add(m[2]);
        const [, mod, cmid] = m;
        const it = { name: activityName(a), kind: mod, url: href, files: [] };
        entry.items.push(it);
        const adir = `${sdir}/${safe(it.name, 80)}`;

        if (mod === "resource") {
          tasks.push(async () => {
            for (const f of await resolve(href)) { const p = queueFile(f, sdir); if (p) it.files.push(rel(p)); }
          });
        } else if (mod === "folder") {
          tasks.push(async () => {
            for (const f of await resolve(href)) { const p = queueFile(f, adir, true); if (p) it.files.push(rel(p)); }
          });
        } else if (mod === "url") {
          tasks.push(async () => {
            // "redirect: manual" évite le CORS quand Moodle redirige direct vers le site externe
            const r = await fetch(href, { credentials: "include", redirect: "manual" });
            if (r.type === "opaqueredirect" || !r.ok) return;
            const d = parse(await r.text());
            const l = d.querySelector(".urlworkaround a, #region-main iframe, #region-main object");
            const u = l && (l.getAttribute("href") || l.getAttribute("src") || l.getAttribute("data"));
            if (u) it.url = abs(u);
          });
        } else if (opts.pages && (mod === "page" || mod === "book")) {
          tasks.push(async () => {
            let html;
            if (mod === "book") {
              try { html = await getText(`${ROOT}/mod/book/tool/print/index.php?id=${cmid}`); } catch (e) {}
            }
            html = html || (await getText(href));
            const d = parse(html);
            const body = (mod === "book" && !d.querySelector("#region-main") ? d.body : mainOf(d)).innerHTML;
            it.files.push(rel(saveDataSafe(`${sdir}/${safe(it.name, 80)}.html`, "text/html", htmlDoc(it.name, body))));
            if (opts.pageFiles) for (const f of pluginLinks(d, href)) { const p = queueFile(f, adir); if (p) it.files.push(rel(p)); }
          });
        } else if (opts.assign && mod === "assign") {
          tasks.push(async () => {
            const d = parse(await getText(href));
            const main = mainOf(d);
            // "Temps restant" change à chaque visite → retiré pour ne pas re-télécharger les consignes pour rien
            main.querySelectorAll("tr, .timeremaining").forEach((r) => {
              if (r.classList.contains("timeremaining") || /temps restant|time remaining/i.test(r.querySelector("th, td")?.textContent || "")) r.remove();
            });
            // consignes + pièces jointes + ton rendu + fichiers de retour
            it.files.push(rel(saveDataSafe(`${adir}/consignes.html`, "text/html", htmlDoc(it.name, main.innerHTML))));
            for (const f of pluginLinks(main, href)) { const p = queueFile(f, adir); if (p) it.files.push(rel(p)); }
          });
        }
      }
    });

    await pool(tasks, 4);

    if (opts.index) {
      const body = index
        .filter((s) => s.items.length)
        .map((s) => `<h2>${esc(s.title)}</h2><ul>` + s.items.map((it) => {
          const files = it.files.filter(Boolean);
          const main = files.length === 1 ? encPath(files[0]) : it.url;
          const sub = files.length > 1 ? `<ul>${files.map((f) => `<li><a href="${encPath(f)}">${esc(f.split("/").pop())}</a></li>`).join("")}</ul>` : "";
          return `<li><a href="${esc(main)}">${esc(it.name)}</a> <small>${esc(it.kind)}${files.length ? "" : " · en ligne"}</small>${sub}</li>`;
        }).join("") + "</ul>")
        .join("");
      const html = `<!doctype html><meta charset="utf-8"><title>${esc(name)}</title>` +
        `<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:2em auto;padding:0 1em}small{color:#888}h2{border-bottom:1px solid #ddd}</style>` +
        `<h1>${esc(name)}</h1><p><a href="${esc(ROOT)}/course/view.php?id=${id}">Ouvrir sur Moodle</a> · <a href="../_nouveautes.html">Nouveautés</a></p>${body}`;
      saveDataSafe(`${cdir}/index.html`, "text/html", html);
    }
    chrome.storage.local.get("sync").then(({ sync = {} }) => {
      sync[`${location.host}:${id}`] = Date.now();
      chrome.storage.local.set({ sync });
    });
  }

  // ---------- orchestration ----------
  async function run(list, o) {
    if (st.running) return;
    opts = o;
    used = new Map(); queued = new Map();
    Object.assign(st, { running: true, finished: false, done: 0, failed: 0, skipped: 0, found: 0, scanDone: 0, scanTotal: list.length, paused: false, phase: "Démarrage" });
    ctl.cancel = false;
    if (box) box.style.display = "block";
    const root = (o.root || `Moodle/${location.host}`).split(/[\\/]+/).filter(Boolean).map((s) => safe(s)).join("/");
    st.root = root;
    chrome.runtime.sendMessage({ type: "reset", force: o.force, parallel: o.parallel, mode: o.mode || "downloads" });
    clearInterval(hb);
    hb = setInterval(() => chrome.runtime.sendMessage({ type: "ping" }), 10000); // garde le service worker éveillé
    try {
      for (const { id, name } of list) {
        await gate();
        st.phase = name.slice(0, 45);
        render();
        try { await scrapeCourse(id, name, root); } catch (e) { if (e.message === "cancel") throw e; console.warn(e); }
        st.scanDone++;
        render();
      }
      st.phase = "Téléchargements en cours";
    } catch (e) {
      st.phase = e.message === "cancel" ? "Annulé" : "Erreur : " + e.message;
      clearInterval(hb);
    }
    st.running = false;
    checkFinished();
    render();
  }

  chrome.runtime.onMessage.addListener((m, _s, reply) => {
    switch (m.type) {
      case "detect":
        reply({ moodle: IS_MOODLE, logged: LOGGED, root: ROOT, host: location.host, course: pageCourse });
        break;
      case "prog":
        Object.assign(st, { done: m.done, failed: m.failed, skipped: m.skipped, paused: m.paused, news: m.news, ask: m.ask });
        checkFinished();
        render();
        break;
      case "getCourses":
        getCourses().then((c) => reply({ courses: c }), (e) => reply({ error: e.message }));
        return true;
      case "start": run(m.courses, m.opts); reply(true); break;
      case "pause": st.paused = true; chrome.runtime.sendMessage({ type: "pause" }); render(); reply(true); break;
      case "resume": st.paused = false; chrome.runtime.sendMessage({ type: "resume" }); render(); reply(true); break;
      case "retry":
        st.finished = false; st.phase = "Nouvel essai des échecs";
        clearInterval(hb);
        hb = setInterval(() => chrome.runtime.sendMessage({ type: "ping" }), 10000);
        chrome.runtime.sendMessage({ type: "retry" });
        render(); reply(true); break;
      case "cancel":
        ctl.cancel = true; st.paused = false;
        chrome.runtime.sendMessage({ type: "cancel" });
        st.phase = "Annulé"; clearInterval(hb); render();
        reply(true); break;
      case "status": reply({ ...st, pct: pct() }); break;
      case "clear":
        if (!st.running) { st.phase = ""; st.finished = false; if (box) box.style.display = "none"; render(); }
        reply(true); break;
    }
  });
})();
