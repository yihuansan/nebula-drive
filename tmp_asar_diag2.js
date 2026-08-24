const fs = require("node:fs");
const [asarPath] = process.argv.slice(2);
const buf = fs.readFileSync(asarPath);
const headerLen = buf.readUInt32LE(12);
const header = JSON.parse(buf.subarray(16, 16 + headerLen).toString("utf8"));
const lib = header.files.lib;
console.log("lib type:", lib && lib.type);
console.log("lib keys:", lib ? Object.keys(lib) : "none");
if (lib && lib.files) {
  const names = Object.keys(lib.files);
  console.log("lib files count:", names.length);
  console.log(names.join(", "));
}
