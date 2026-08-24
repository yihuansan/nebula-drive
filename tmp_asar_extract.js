// Minimal asar reader: extract files from an .asar archive to a destination dir.
const fs = require("node:fs");
const path = require("node:path");

const [asarPath, outDir, ...wanted] = process.argv.slice(2);
const buf = fs.readFileSync(asarPath);

// Envelope (verified empirically):
//   [0..4)  uint32 = 4
//   [4..8)  uint32 = padded header size (larger)
//   [8..12) uint32 = data section start offset (relative to byte 16)
//   [12..16) uint32 = JSON header length
//   [16..)  JSON header
const f0 = buf.readUInt32LE(0);
const f1 = buf.readUInt32LE(4);
const f2 = buf.readUInt32LE(8);
const headerLen = buf.readUInt32LE(12);
console.log("envelope:", { f0, f1, f2, headerLen });
const header = JSON.parse(buf.subarray(16, 16 + headerLen).toString("utf8"));
// Data section starts after the padded header. Probe: first file entry's offset
// should yield its real content. Try candidate bases.
const entries = [];
(function walk(node, rel) {
  const files = node.files || {};
  for (const [name, child] of Object.entries(files)) {
    const childRel = rel ? rel + "/" + name : name;
    if (child.type === "directory") walk(child, childRel);
    else if (child.type === "file" && child.offset !== undefined) entries.push({ rel: childRel, offset: Number(child.offset), size: Number(child.size) });
  }
})(header, "");
entries.sort((a, b) => a.offset - b.offset);
const first = entries[0];
console.log("first file:", first.rel, "offset", first.offset, "size", first.size);

// candidate data bases: 16 + f2, 16 + f1, 16 + headerLen
const candidates = [16 + f2, 16 + f1, 16 + headerLen];
let dataStart = null;
for (const base of candidates) {
  const probe = buf.subarray(base + first.offset, base + first.offset + Math.min(64, first.size));
  console.log("base", base, "probe:", probe.toString("utf8").slice(0, 60).replace(/\n/g, "\\n"));
  if (dataStart === null && probe.toString("utf8").slice(0, 1) !== "\u0000") dataStart = base;
}
if (dataStart === null) { console.error("could not determine data start"); process.exit(1); }
console.log("dataStart =", dataStart);

const want = new Set(wanted);
let extracted = 0;
for (const e of entries) {
  if (want.size > 0 && !want.has(e.rel)) continue;
  const content = buf.subarray(dataStart + e.offset, dataStart + e.offset + e.size);
  const dest = path.join(outDir, e.rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  extracted++;
  console.log("extracted:", e.rel, e.size);
}
console.log("done, extracted", extracted);
