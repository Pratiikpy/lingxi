/**
 * The parts of `@taperelay/client` (0.1.0-test.132, MIT, plain JavaScript) that pet letters use (H13), typed from its
 * own source: client/src/selfmsg.mjs, client.mjs, core.mjs, encrypted.mjs, inbox.mjs.
 */
declare module "@taperelay/client" {
  export type Http = (url: string, init?: RequestInit) => Promise<Response>;
  export interface SelfAuth {
    account: string;
    sign(digest: Uint8Array): Promise<string>;
    delegationHeader: null;
  }
  export interface KeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }
  export interface Opened {
    ok: true;
    id: string;
    from: string;
    to: string;
    createdAt: number;
    message: Uint8Array;
    text: string | null;
  }
  export type OpenResult = Opened | { ok: false; reason: string };
  export interface InboxItem {
    id: string;
    read?: boolean;
    [k: string]: unknown;
  }
  export interface Client {
    inbox(server: string, auth: SelfAuth, o?: { cursor?: string; limit?: number }): Promise<{ items?: InboxItem[]; next?: string }>;
    markRead(server: string, auth: SelfAuth, ids: string[]): Promise<void>;
    outboxStatus(server: string, id: string): Promise<{ status: string }>;
  }

  export function newSelfIdentity(o: { host: string; privateKey?: Uint8Array }): { privateKey: Uint8Array; account: string };
  export function selfAuth(privateKey: Uint8Array, host: string): SelfAuth;
  export function nodeOf(account: string): string;
  export function generateKeyPair(): KeyPair;
  export function publicKeyOf(secretKey: Uint8Array): Uint8Array;
  export function hex(b: Uint8Array): string;
  export function fromHex(h: string): Uint8Array;
  export function isSelfAccount(s: unknown): boolean;
  export function publishSelfKey(http: Http, auth: SelfAuth, publicKey: Uint8Array, o: { now: number }): Promise<{ createdAt: number }>;
  export function fetchSelfKey(http: Http, account: string): Promise<{ key: Uint8Array }>;
  export function makeSelfNotice(o: { from: string; to: string; message: string; recipientKey: Uint8Array; ownKey: KeyPair; createdAt: number }): unknown;
  export function signSelfNotice(auth: SelfAuth, notice: unknown): Promise<{ id: string; body: string }>;
  export function submitSelfNotice(http: Http, auth: SelfAuth, signed: { id: string; body: string }, o: { now: number }): Promise<{ id: string; server: string }>;
  export function openSelfNotice(item: unknown, keyPair: KeyPair, o?: { me?: string | null }): OpenResult;
  export function updateSenders(http: Http, auth: SelfAuth, o: { allow?: string[]; deny?: string[]; block?: string[]; unblock?: string[]; now: number }): Promise<unknown>;
  export function listSenders(http: Http, auth: SelfAuth, o: { state?: "allowed" | "pending" | "denied" | "blocked"; after?: string; limit?: number; now: number }): Promise<{ items?: Array<{ sender: string }> }>;
  export function subscribeNotices(
    http: Http,
    auth: SelfAuth,
    o: { onNotice: (m: Opened & { seq: number | null }) => void; onError?: (e: Error & { item?: InboxItem; status?: number }) => void; now: () => number; keyPair?: KeyPair | null; retryMs?: number },
  ): () => void;
  export function createClient(o?: { fetch?: Http; timeoutMs?: number }): Client;
  export function deliveryStatus(client: Client, server: string, id: string): Promise<{ status: string }>;
}
