// Fabrique le paquet Chrome Web Store : dist/course-downloader-<version>.zip
// - copie extension/ en retirant les blocs /* test:start */ … /* test:end */ (crochets de tests)
// - vérifie la syntaxe des scripts et l'absence de crochets résiduels
// Usage : node scripts/build.js   (aucune dépendance)
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const SRC = path.join(__dirname, "..", "extension");
const DIST = path.join(__dirname, "..", "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
const OUT = path.join(DIST, `course-downloader-${manifest.version}.zip`);

function files(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p, base) : [path.relative(base, p).split(path.sep).join("/")];
  });
}

const STRIP = /\/\*\s*test:start[\s\S]*?test:end\s*\*\/\n?/g;
const entries = [];
for (const rel of files(SRC)) {
  let data = fs.readFileSync(path.join(SRC, rel));
  if (rel.endsWith(".js")) {
    const code = data.toString("utf8").replace(STRIP, "");
    if (/test:start|test:end|test=opfs/.test(code)) throw new Error(`Crochet de test résiduel dans ${rel}`);
    const tmp = path.join(DIST, ".check.js");
    fs.mkdirSync(DIST, { recursive: true });
    fs.writeFileSync(tmp, code);
    execFileSync(process.execPath, ["--check", tmp]); // lève une erreur si la syntaxe est cassée
    fs.rmSync(tmp);
    data = Buffer.from(code, "utf8");
  }
  entries.push({ name: rel, data });
}

// ---- écriture ZIP minimale (deflate) ----
const CRC = new Int32Array(256).map((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n;
});
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const parts = [], central = [];
let offset = 0;
for (const { name, data } of entries) {
  const nameBuf = Buffer.from(name, "utf8");
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
  parts.push(local, nameBuf, comp);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
  c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, nameBuf);
  offset += 30 + nameBuf.length + comp.length;
}
const cdSize = central.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(OUT, Buffer.concat([...parts, ...central, end]));
console.log(`OK ${path.relative(process.cwd(), OUT)} — ${entries.length} fichiers, ${(fs.statSync(OUT).size / 1024).toFixed(1)} Ko`);
