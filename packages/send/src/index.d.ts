/** Types for the TapeSend (TAP-10) module: keys, sealed payloads and message content. */

export class TapeSendError extends Error {
  code: string;
}
export function bytesToHex(bytes: Uint8Array): string;
export function hexToBytes(hex: string, expectedLength?: number): Uint8Array;
export function checksumAddress(address: string): string;

export const CHAIN_ID: number;
export const KEY_DOMAIN: string;
export const KEY_ISSUED_AT: string;
export interface KeyParams {
  tokenId: bigint | number | string;
  cpuIndex: bigint | number | string;
  container: string;
  holder: string;
  hub: string;
  chainId?: number;
  keyIndex?: number;
}
export function keyDerivationText(p: KeyParams): string;
export function personalMessageHash(text: string): Uint8Array;
export function recoverAddress(messageHash: Uint8Array, signature: string): string;
export function normalizedRS(signature: string): Uint8Array;
export function isDeterministic(signatureA: string, signatureB: string): boolean;
export function deriveKeyPair(p: KeyParams & { signature: string }): { secretKey: Uint8Array; publicKey: Uint8Array };
export function fingerprint(publicKey: Uint8Array): Uint8Array;

export const MAGIC: Uint8Array;
export const FORMAT_VERSION: number;
export const KIND_PUBLIC: number;
export const KIND_SEALED: number;
export const MAX_PAYLOAD: number;
export const MAX_SLOTS: number;
export interface SealParams {
  content: Uint8Array;
  recipients: Uint8Array[];
  to: string;
  from: string;
  hub: string;
  ref?: string | Uint8Array;
  chainId?: number;
  random?: (n: number) => Uint8Array;
}
export function encodePublic(content: Uint8Array): Uint8Array;
export function seal(p: SealParams): Uint8Array;
export function parsePayload(payload: Uint8Array): { kind: "public"; content: Uint8Array } | { kind: "sealed" };
export function openPayload(p: { payload: Uint8Array; secretKey: Uint8Array; to: string; from: string; hub: string; ref?: string | Uint8Array; chainId?: number }): { kind: "public" | "sealed"; content: Uint8Array };
export function assertValidPublicKey(publicKey: Uint8Array): void;

export const SUBJECT_MAX: number;
export const ATTACHMENTS_MAX: number;
export const IMAGE_MAX_BYTES: number;
export const IMAGE_MIME: readonly string[];
export function checkAttachment(a: unknown): unknown;
export function encodeContent(m: { subject?: string; body: string; ts?: number; attachments?: object[] }): Uint8Array;
export function decodeContent(bytes: Uint8Array): { kind: "message"; subject: string; body: string; ts: number | null; attachments: object[]; badAttachments: number } | { kind: "unsupported"; value: object };
export function displayText(s: string): string;
export function messageId(chainId: number, hub: string, to: string, inboxIndex: number | bigint): string;
