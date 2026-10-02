// Faux Moodle minimal pour tester l'extension de bout en bout.
// Imite : M.cfg, API ajax des cours, sections, resource/folder/page/book/assign/url/forum,
// format "une section par page", pluginfile avec ETag + HEAD, révisions, pannes simulées.
const http = require("http");
const crypto = require("crypto");

const PORT = 8765;
const ROOT = `http://localhost:${PORT}`;

// État modifiable par les tests
const state = {
  rev: 1,                       // révision de la ressource "cours1.pdf"
  files: {                      // contenu des fichiers sans révision (ETag)
    "a.txt": "contenu A v1",
    "b.png": "PNGDATA",
    "sujet.pdf": "SUJET v1",
    "img.png": "LABELIMG",
  },
  fail: new Set(),              // noms de fichiers qui renvoient 500
  delay: 0,                     // latence (ms) sur pluginfile
  log: [],                      // requêtes reçues
};

const shell = (title, body, bodyClass = "") => `<!doctype html><html><head><title>${title}</title>
<script>M.cfg = {"wwwroot":"http:\\/\\/localhost:${PORT}","sesskey":"abc123","themerev":"1"};</script></head>
<body class="${bodyClass}"><img src="${ROOT}/pluginfile.php/1/core_admin/logo/0/logo.png">
<div id="page"><div id="region-main" role="main">${body}</div></div></body></html>`;

const act = (mod, id, name) =>
  `<li class="activity ${mod}"><a href="${ROOT}/mod/${mod}/view.php?id=${id}"><span class="instancename">${name}<span class="accesshide"> Fichier</span></span></a></li>`;
const section = (n, title, inner) =>
  `<li class="section course-section" id="section-${n}"><h3 class="sectionname">${title}</h3><ul>${inner}</ul></li>`;

const COURSE2 = () => shell("Biochimie", `<ul class="topics">
  ${section(0, "Généralités",
    act("resource", 10, "Cours 1") + act("url", 11, "Site externe") +
    `<li class="activity label"><div>Voir <a href="${ROOT}/pluginfile.php/50/mod_label/intro/0/img.png">image</a></div></li>`)}
  ${section(1, "Chapitre 1 : Intro",
    act("folder", 12, "Documents TD") + act("page", 13, "Page info") + act("book", 14, "Livre") +
    act("assign", 15, "Devoir 1") + act("forum", 16, "Forum"))}
  ${section(2, 'TD: séance 1/2 *?', act("resource", 21, "Notes A") + act("resource", 22, "Notes B"))}
</ul>`, "path-course-view course-2");

const COURSE3 = () => shell("Génétique (ancien)", `<ul class="topics">
  ${section(0, "Généralités", "")}
  <li class="section course-section"><h3 class="sectionname"><a href="${ROOT}/course/view.php?id=3&section=1">Partie 1</a></h3></li>
</ul>`, "course-3");
const COURSE3_S1 = () => shell("Génétique", `<ul>${section(1, "Partie 1", act("resource", 20, "Diapo intégrée"))}</ul>`, "course-3");

function pluginfile(res, req, path) {
  const name = decodeURIComponent(path.split("/").pop().split("?")[0]);
  if (state.fail.has(name)) { res.writeHead(500); return res.end("err"); }
  let body;
  if (name === "cours1.pdf") body = `PDF rev ${state.rev}`;
  else if (name === "notes.pdf") body = `NOTES ${path}`;
  else if (name === "diapo.pdf") body = "DIAPO";
  else if (name === "logo.png") body = "LOGO";
  else body = state.files[name];
  if (body === undefined) { res.writeHead(404); return res.end(); }
  const etag = `"${crypto.createHash("sha1").update(body).digest("hex")}"`;
  setTimeout(() => {
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      ETag: etag, "Content-Length": Buffer.byteLength(body),
    });
    res.end(req.method === "HEAD" ? undefined : body);
  }, state.delay);
}

function handler(req, res) {
  const u = new URL(req.url, ROOT);
  const p = u.pathname, id = u.searchParams.get("id");
  state.log.push(`${req.method} ${p}${u.search}`);
  // session : cookie posé à la première page, SameSite par défaut (= Lax) comme un vrai Moodle
  const logged = /MoodleSession=ok/.test(req.headers.cookie || "");
  const html = (s) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "MoodleSession=ok; Path=/; HttpOnly" });
    res.end(s);
  };
  const redirect = (to) => { res.writeHead(303, { Location: to }); res.end(); };

  if (p === "/" || p === "/my/" || p === "/my/courses.php")
    return html(shell("Tableau de bord", `<p>Mes cours</p>`, "pagelayout-mydashboard"));
  if (p === "/lib/ajax/service.php") {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const [call] = JSON.parse(data);
      const cls = call.args.classification;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (cls === "allincludinghidden") return res.end(JSON.stringify([{ error: true, exception: { message: "invalid" } }]));
      const all = [{ id: 2, fullname: "Biochimie: L3/S1" }, { id: 3, fullname: "Génétique (ancien)" }];
      const pick = { all, inprogress: [all[0]], past: [all[1]], future: [], hidden: [] }[cls] || [];
      res.end(JSON.stringify([{ error: false, data: { courses: pick, nextoffset: 0 } }]));
    });
    return;
  }
  if (p === "/course/view.php" && id === "2") return html(COURSE2());
  if (p === "/course/view.php" && id === "3") return html(u.searchParams.get("section") === "1" ? COURSE3_S1() : COURSE3());
  if (p === "/mod/resource/view.php") {
    if (id === "10") return redirect(`${ROOT}/pluginfile.php/100/mod_resource/content/${state.rev}/cours1.pdf`);
    if (id === "21") return redirect(`${ROOT}/pluginfile.php/121/mod_resource/content/1/notes.pdf`);
    if (id === "22") return redirect(`${ROOT}/pluginfile.php/122/mod_resource/content/1/notes.pdf`);
    if (id === "20") return html(shell("Diapo", `<object data="${ROOT}/pluginfile.php/120/mod_resource/content/1/diapo.pdf"></object>`));
  }
  if (p === "/mod/folder/view.php")
    return html(shell("Dossier", `<ul>
      <li><a href="${ROOT}/pluginfile.php/101/mod_folder/content/0/sub/a.txt?forcedownload=1">a.txt</a></li>
      <li><a href="${ROOT}/pluginfile.php/101/mod_folder/content/0/b.png?forcedownload=1">b.png</a></li></ul>`));
  if (p === "/mod/page/view.php")
    return html(shell("Page", `<div id="yui_3_17_2_1_${Date.now()}"><p>Contenu de la page é</p>
      <a href="${ROOT}/login/logout.php?sesskey=${Math.random().toString(36).slice(2)}">x</a></div>`));
  if (p === "/mod/book/tool/print/index.php")
    return html(`<html><body><h1>Livre</h1><p>Chapitre 1</p></body></html>`);
  if (p === "/mod/assign/view.php")
    return html(shell("Devoir", `<p>Consignes</p>
      <a href="${ROOT}/pluginfile.php/115/mod_assign/introattachment/0/sujet.pdf?forcedownload=1">sujet.pdf</a>
      <table><tr><th>Temps restant</th><td>${Math.floor(Math.random() * 1e6)} secondes</td></tr></table>`));
  if (p === "/mod/url/view.php")
    return html(shell("URL", `<div class="urlworkaround">Cliquez <a href="https://example.com/ressource">ici</a></div>`));
  if (p.startsWith("/pluginfile.php/")) {
    if (!logged) { state.log.push("NOCOOKIE " + p); return redirect(`${ROOT}/login/index.php`); }
    return pluginfile(res, req, p);
  }
  if (p === "/login/index.php") return html(shell("Connexion", "<form id=login></form>", "notloggedin"));
  res.writeHead(404); res.end("404");
}

function start() {
  return new Promise((r) => { const s = http.createServer(handler).listen(PORT, () => r(s)); });
}
module.exports = { start, state, ROOT };
if (require.main === module) start().then(() => console.log("Mock Moodle sur " + ROOT));
