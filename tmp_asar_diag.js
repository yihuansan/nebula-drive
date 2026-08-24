const fs = require("node:fs");
const [asarPath] = process.argv.slice(2);
const buf = fs.readFileSync(asarPath);
const headerLen = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + headerLen).toString("utf8"));
console.log("top-level keys:", Object.keys(header));
if (header.files) {
  const names = Object.keys(header.files);
  console.log("files count:", names.length);
  console.log(names.slice(0, 30).join(", "));
}
