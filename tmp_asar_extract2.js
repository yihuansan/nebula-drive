const fs = require("node:fs");
const path = require("node:path");
const [asarPath, outDir, ...wanted] = process.argv.slice(2);
const buf = fs.readFileSync(asarPath);
const headerLen = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + headerLen).toString("utf8"));
// directories have `files` (no offset); files have offset/size.
const entries = [];
(function walk(node, rel) {
  const files = node.files || {};
  for (const [name, child] of Object.entries(files)) {
    const r = rel ? rel + "/" + name : name;
    if (child.files) walk(child, r);
    else if (child.offset !== undefined) entries.push({ r, offset: Number(child.offset), size: Number(child.size) });
  }
})(header, "");
const want = new Set(wanted);
let n = 0;
for (const e of entries) {
  if (want.size > 0 && !want.has(e.r)) continue;
  const content = buf.subarray(16 + headerLen + e.offset, 16 + headerLen + e.offset + e.size);
  const dest = path.join(outDir, e.r);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  n++;
  console.log("extracted:", e.r, e.size);
}
console.log("done", n);
