/**
 * The handheld's C core (wasm/lingxi-core.wasm), driven from JavaScript: the same functions the firmware calls.
 * The tests hold it to the game's TypeScript; the browser handheld runs pets on it.
 */

export const LX_ERRORS = [
  "ok",
  "truncated",
  "badOpcode",
  "badSignal",
  "badShape",
  "noTarget",
  "badArity",
  "tooDeep",
  "noRoom",
  "badMagic",
  "badVersion",
  "badHash",
  "badCheck",
  "badValue",
] as const;
export type CoreError = (typeof LX_ERRORS)[number];

export const NOTES = ["ate", "overfed", "woke", "played", "tooTired", "tooSick", "cleaned", "sleeping", "awake", "petted", "healed", "notSick", "listened", "hibernationEnded"] as const;

interface Exports {
  memory: WebAssembly.Memory;
  lx_in(): number;
  lx_out(): number;
  lx_keccak(len: number): void;
  lx_chain(word: number): void;
  lx_trip_open(len: number): number;
  lx_trip_live(): number;
  lx_trip_away(n: number): number;
  lx_trip_care(kind: number, arg: number): number;
  lx_trip_digest(): void;
  lx_trip_close(): number;
  lx_circ_load(len: number): number;
  lx_circ_shape(which: number): number;
  lx_circ_beat(): void;
}

const hex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;

export class HandheldCore {
  private constructor(private readonly x: Exports) {}

  static async load(bytes: BufferSource): Promise<HandheldCore> {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new HandheldCore(instance.exports as unknown as Exports);
  }

  private mem(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer);
  }
  private put(b: Uint8Array): void {
    this.mem().set(b, this.x.lx_in());
  }
  private out(n: number): Uint8Array {
    const at = this.x.lx_out();
    return this.mem().slice(at, at + n);
  }

  keccak(b: Uint8Array): string {
    this.put(b);
    this.x.lx_keccak(b.length);
    return hex(this.out(32));
  }

  /** chain one word onto `h`, as PetRegistry.chainLog */
  chain(h: Uint8Array, word: number): string {
    this.mem().set(h, this.x.lx_out());
    this.x.lx_chain(word);
    return hex(this.out(32));
  }

  open(packet: Uint8Array): CoreError {
    this.put(packet);
    return LX_ERRORS[this.x.lx_trip_open(packet.length)] ?? "badValue";
  }
  live(): void {
    if (this.x.lx_trip_live() !== 0) throw new Error("trip not open or log full");
  }
  away(n: number): void {
    if (this.x.lx_trip_away(n) !== 0) throw new Error("trip not open or log full");
  }
  /** a note, or "noSnack" when that snack has run out */
  care(kind: number, arg: number): (typeof NOTES)[number] | "noSnack" {
    const r = this.x.lx_trip_care(kind, arg);
    if (r === -3) return "noSnack";
    if (r < 0) throw new Error("trip not open or log full");
    return NOTES[r]!;
  }
  digest(): string {
    this.x.lx_trip_digest();
    return hex(this.out(32));
  }
  close(): Uint8Array {
    const n = this.x.lx_trip_close();
    if (!n) throw new Error("log too long to send");
    return this.out(n);
  }

  /** a bare circuit: nIn u16, nOut u16, len u32, bytes, nParts u8, parts */
  loadCircuit(blob: Uint8Array): CoreError {
    this.put(blob);
    return LX_ERRORS[this.x.lx_circ_load(blob.length)] ?? "badValue";
  }
  shape(): { nIn: number; nOut: number; nState: number; nGates: number } {
    return { nIn: this.x.lx_circ_shape(0), nOut: this.x.lx_circ_shape(1), nState: this.x.lx_circ_shape(2), nGates: this.x.lx_circ_shape(3) };
  }
  beat(state: Uint8Array, inputs: Uint8Array): { state: Uint8Array; outputs: Uint8Array } {
    const at = this.x.lx_out();
    const m = this.mem();
    m.set(state, at);
    m.set(inputs, at + state.length);
    this.x.lx_circ_beat();
    const nOut = this.x.lx_circ_shape(1);
    return { state: this.out(state.length), outputs: this.mem().slice(at + state.length, at + state.length + nOut) };
  }
}

/** A bare circuit's blob for `loadCircuit`. */
export function circuitBlob(bytes: Uint8Array, nIn: number, nOut: number, parts: ReadonlyArray<{ processor: string; id: bigint; nIn: number; nOut: number; bytes: Uint8Array }> = []): Uint8Array {
  const out: number[] = [nIn & 0xff, nIn >> 8, nOut & 0xff, nOut >> 8];
  for (let i = 0; i < 4; i++) out.push((bytes.length >> (8 * i)) & 0xff);
  out.push(...bytes, parts.length);
  for (const q of parts) {
    const cpu = q.processor.startsWith("0x") ? q.processor.slice(2) : q.processor;
    for (let i = 0; i < 20; i++) out.push(parseInt(cpu.slice(2 * i, 2 * i + 2), 16));
    for (let i = 0n; i < 8n; i++) out.push(Number((q.id >> (8n * i)) & 0xffn));
    out.push(q.nIn & 0xff, q.nIn >> 8, q.nOut & 0xff, q.nOut >> 8);
    for (let i = 0; i < 4; i++) out.push((q.bytes.length >> (8 * i)) & 0xff);
    out.push(...q.bytes);
  }
  return Uint8Array.from(out);
}
