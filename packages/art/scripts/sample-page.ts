/** Fills the art-sample page template with the atlas built by sample.ts. */
import { readFileSync, writeFileSync } from "node:fs";

const atlas = JSON.parse(readFileSync(new URL("../out/sample-atlas.json", import.meta.url), "utf8"));
const tpl = readFileSync(new URL("./sample-page.html", import.meta.url), "utf8");
const out = tpl.replace("__ATLAS__", JSON.stringify(atlas));
const dest = process.argv[2];
if (!dest) throw new Error("usage: tsx sample-page.ts <output.html>");
writeFileSync(dest, out);
console.log("page", out.length);
