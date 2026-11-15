/**
 * TapeOut on X Layer: addresses, ABIs and the calls Lingxi makes.
 *
 * Function names and selectors were checked against the live contracts:
 *   circuitInfo(uint256) 0x084d60f1 → (nIn, nOut, nState, gateCount)
 *   netlist(uint256)     0x3fc4be56
 *   eval(uint256,bytes)  0x934d06ea  (reverts "has latch: use step" on stateful circuits)
 *   step(uint256,bytes,bytes) 0xe8281a1a → (bytes newState, bytes outputs)
 *   nextId()             0x61b8ce8c
 *   factory isCPU(address), cpuCount(), cpuAt(uint256), deployFee()
 * Circuits are ERC-721 tokens on their processor (ownerOf). Transistors are an
 * ERC-1155 (id 0 = NAND); mint(id, amount) costs mintPrice × amount + protocolFee.
 * Processors at index 415 and above charge BEM for minting and creation; tape-out
 * itself is paid in OKB (TAPEOUT_FEE).
 */

import { defineChain, type Address } from "viem";

export const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.xlayer.tech"] } },
  blockExplorers: { default: { name: "OKLink", url: "https://www.oklink.com/xlayer" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const FACTORY: Address = "0x1f09DAeFA827f02CBb40967cc91b259763760761";
export const ENTRYPOINT_V07: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
export const NAND_ID = 0n;

export const processorAbi = [
  { type: "function", name: "tapeout", stateMutability: "payable", inputs: [{ name: "nl", type: "bytes" }, { name: "nIn", type: "uint32" }, { name: "nOut", type: "uint32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "TAPEOUT_FEE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "transistors", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "nextId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "netlist", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "bytes" }] },
  {
    type: "function",
    name: "circuitInfo",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "nIn", type: "uint256" }, { name: "nOut", type: "uint256" }, { name: "nState", type: "uint256" }, { name: "gateCount", type: "uint256" }],
  },
  { type: "function", name: "eval", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }, { name: "inputs", type: "bytes" }], outputs: [{ type: "bytes" }] },
  {
    type: "function",
    name: "step",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }, { name: "state", type: "bytes" }, { name: "inputs", type: "bytes" }],
    outputs: [{ name: "newState", type: "bytes" }, { name: "outputs", type: "bytes" }],
  },
] as const;

export const transistorsAbi = [
  { type: "function", name: "mint", stateMutability: "payable", inputs: [{ name: "id", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "mintPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protocolFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "minted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "supplyCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

export const factoryAbi = [
  { type: "function", name: "isCPU", stateMutability: "view", inputs: [{ name: "cpu", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "cpuCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cpuAt", stateMutability: "view", inputs: [{ name: "i", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "deployFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "createCPU",
    stateMutability: "payable",
    inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "story", type: "string" }, { name: "transistorSupply", type: "uint256" }, { name: "mintPrice", type: "uint256" }],
    outputs: [{ name: "transistors", type: "address" }, { name: "circuits", type: "address" }],
  },
] as const;
