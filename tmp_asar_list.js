const fs = require("node:fs");
const [asarPath, pattern] = process.argv.slice(2);
const buf = fs.readFileSync(asarPath);
const headerLen = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + headerLen).toString("utf8"));
const rx = pattern ? new RegExp(pattern) : null;
const out = [];
(function walk(node, rel) {
  const files = node.files || {};
  for (const [name, child] of Object.entries(files)) {
    const r = rel ? rel + "/" + name : name;
    if (child.type === "directory") walk(child, r);
    else if (child.type === "file") out.push({ r, size: Number(child.size) });
  }
})(header, "");
const shown = out.filter((e) => !rx || rx.test(e.r));
console.log("total files:", out.length, "matched:", shown.length);
for (const e of shown.slice(0, 400)) console.log(e.size, e.r);
