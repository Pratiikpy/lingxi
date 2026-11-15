import { keccak_256 } from "@noble/hashes/sha3";
import { composeChild } from "../src/compose";
import { bytesToHex } from "../src/tap02";
const c = composeChild({ cpu: "0x" + "11".repeat(20), id: 1n }, { cpu: "0x" + "22".repeat(20), id: 2n });
const head = 2 * (1 + 20 + 8 + 1 + 1 + 16 * 3);
const glue = c.bytes.slice(head);
console.log("head bytes", head, "glue bytes", glue.length, "glue gates", glue.length / 7);
console.log("glue keccak", bytesToHex(keccak_256(glue)));
console.log("child total bytes", c.bytes.length);
