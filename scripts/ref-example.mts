/**
 * The worked REF example (H6): a new circuit that uses one of Lingxi's rule circuits by REF, the way another project
 * would. It takes 16 input pins (the trust rule reads the low 10), REFs Lingxi's trust circuit on X Layer, and gives its 8 answer bits
 * back; a builder copies it and puts their own gates between the REF and the outputs. REF'd gates burn no transistors:
 * only the 16 NOT gates here are new.
 *
 *   npx tsx scripts/ref-example.mts             build it and prove it on every input against the trust circuit read
 *                                               from X Layer (resolved locally, nothing sent)
 *   npx tsx scripts/ref-example.mts --tapeout   also tape it out (needs LINGXI_EXAMPLE_KEY_FILE: a funded key, and the
 *                                               processor's TAPEOUT_FEE), then read it back and run it on X Layer
 */

import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Element, NAND, REF, beat, bitsToWord, encode, hexToBytes, load, wordToBits } from "@lingxi/brain";
import { RULES, processorAbi, xLayer, type Deployment } from "@lingxi/chain";

const RPC = "https://rpc.xlayer.tech";
const TRUST_RULE = RULES.find((r) => r.name === "trust")!;
const d = JSON.parse(readFileSync(new URL("../packages/chain/deployments/xlayer.json", import.meta.url), "utf8")) as Deployment & { rules: Record<string, { id: string }> };
const pub = createPublicClient({ chain: { ...xLayer, rpcUrls: { default: { http: [RPC] } } }, transport: http(RPC) });
const processor = (d.processor as string).toLowerCase() as Address;
const target = { cpu: processor, id: BigInt(d.rules.trust!.id) };
/** every rule circuit has the brain's 16 input pins (the trust rule reads the low 10) */
const N_IN = 16;
const N_OUT = 8;

/** Signals: 0 and 1 are constants, 2.. the inputs, then the REF's 8 outputs, then the glue; the last 8 are the outputs. */
function build(): { bytes: Uint8Array; elements: Element[] } {
  const inputs = Array.from({ length: N_IN }, (_, i) => 2 + i);
  const refOut = 2 + N_IN;
  const els: Element[] = [{ op: REF, ins: inputs, cpu: target.cpu, id: target.id, nOut: N_OUT, firstOut: refOut }];
  let next = refOut + N_OUT;
  const not = (a: number) => {
    const s = next++;
    els.push({ op: NAND, ins: [a, a], nOut: 1, firstOut: s });
    return s;
  };
  // your own gates go here; this example passes the answer through, inverted twice so the outputs are the last 8 signals
  const inverted = Array.from({ length: N_OUT }, (_, k) => not(refOut + k));
  for (const s of inverted) not(s);
  return { bytes: encode(els), elements: els };
}

const { bytes } = build();
const stored = hexToBytes((await pub.readContract({ address: processor, abi: processorAbi, functionName: "netlist", args: [target.id] })) as Hex);
const trust = load(stored, N_IN, N_OUT);
const example = load(bytes, N_IN, N_OUT, (cpu, id) => (cpu.toLowerCase() === target.cpu && id === target.id ? trust : null));
let wrong = 0;
for (let w = 0; w < 2 ** TRUST_RULE.inBits; w++) {
  const [, outs] = beat(example, [], wordToBits(w, N_IN));
  if (Number(bitsToWord(outs)) !== TRUST_RULE.reference(w)) wrong++;
}
console.log(`example circuit: ${bytes.length} bytes, keccak256 ${keccak256(bytes)}, REF to Lingxi's trust circuit #${target.id} on ${processor}`);
console.log(wrong === 0 ? `every one of the ${2 ** TRUST_RULE.inBits} inputs gives the trust rule's answer, with the trust circuit read from X Layer` : `${wrong} inputs disagree`);
if (wrong) process.exit(1);

if (process.argv.includes("--tapeout")) {
  const keyFile = process.env.LINGXI_EXAMPLE_KEY_FILE;
  if (!keyFile) throw new Error("--tapeout needs LINGXI_EXAMPLE_KEY_FILE: a file holding the funded key's K=0x… line");
  const key = /K=(0x[0-9a-fA-F]{64})/.exec(readFileSync(keyFile, "utf8"))?.[1] as Hex | undefined;
  if (!key) throw new Error("no K=0x… key in that file");
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: { ...xLayer, rpcUrls: { default: { http: [RPC] } } }, transport: http(RPC) });
  const fee = (await pub.readContract({ address: processor, abi: processorAbi, functionName: "TAPEOUT_FEE" })) as bigint;
  const { result: id, request } = await pub.simulateContract({ account: wallet.account, address: processor, abi: processorAbi, functionName: "tapeout", args: [`0x${Buffer.from(bytes).toString("hex")}`, N_IN, N_OUT], value: fee });
  const tx = await wallet.writeContract(request);
  await pub.waitForTransactionReceipt({ hash: tx });
  const back = (await pub.readContract({ address: processor, abi: processorAbi, functionName: "netlist", args: [id as bigint] })) as Hex;
  console.log(`taped out as circuit #${id} in ${tx}; read back ${keccak256(back) === keccak256(bytes) ? "identical" : "DIFFERENT"}`);
}
