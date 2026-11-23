/**
 * The parts of viem that build clients and keys, loaded the first time the game reads X Layer or signs (P3): they are
 * about half of viem (every client action, the curve maths behind keys and signatures), and a first screen needs none of
 * them. Everything here is reached through `viem()` in chainClient.ts, never imported directly.
 */
export { createPublicClient, createWalletClient, custom, fallback, http } from "viem";
export { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
