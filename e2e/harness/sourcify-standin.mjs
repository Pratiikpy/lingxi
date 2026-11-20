// A stand-in for Sourcify's server in the browser suite (A71). It gives Sourcify's own answers, recorded from Sourcify
// for the mainnet deployment's addresses (record-sourcify.mts, sourcify-recorded.json), and 404 for anything else, as
// Sourcify does for contracts deployed only on the fork. The suite's server asks it, so no spec depends on Sourcify
// being up; how the server words each kind of Sourcify answer is held by its unit tests.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const port = Number(process.argv[2]);
const { answers } = JSON.parse(readFileSync(new URL("./sourcify-recorded.json", import.meta.url), "utf8"));
createServer((req, res) => {
  const m = /^\/server\/v2\/contract\/196\/(0x[0-9a-fA-F]{40})$/.exec(req.url ?? "");
  const known = m ? answers[m[1].toLowerCase()] : undefined;
  res.writeHead(known?.status ?? 404, { "content-type": "application/json" });
  res.end(JSON.stringify(known?.body ?? { customCode: "not_found", message: "Contract not found" }));
}).listen(port, "127.0.0.1");
