/**
 * The game's side of the handheld's USB link (core/link.h has the protocol). It speaks over anything that can write
 * bytes and read them back: Web Serial in the browser, or the WebAssembly link in the tests.
 */

export interface LinkIo {
  write(bytes: Uint8Array): Promise<void>;
  /** the next bytes from the handheld, or null when the line has closed */
  read(): Promise<Uint8Array | null>;
}

export interface HandheldHello {
  version: number;
  selfTest: boolean;
  aboard: boolean;
}

export class LinkError extends Error {
  constructor(
    readonly code: number,
    readonly word: string,
  ) {
    super(`handheld refused: ${word} (${code})`);
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();
/** a packet goes out in runs this long, well inside what a USB serial line buffers */
const CHUNK = 4096;
/** the longest answer a handheld can give: a packet back from the largest log the firmware keeps, as hex, with room */
export const MAX_LINE = 256 * 1024;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export class HandheldLink {
  private pending = "";

  constructor(
    private readonly io: LinkIo,
    private readonly timeoutMs = 8000,
  ) {}

  private async send(text: string): Promise<void> {
    const bytes = enc.encode(text);
    for (let i = 0; i < bytes.length; i += CHUNK) await this.io.write(bytes.subarray(i, i + CHUNK));
  }

  /** the next line the handheld sends, without its newline */
  private async line(): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const at = this.pending.indexOf("\n");
      if (at >= 0) {
        const l = this.pending.slice(0, at).replace(/\r$/, "");
        this.pending = this.pending.slice(at + 1);
        // the firmware may print its own log lines; only the link's answers count
        if (l.startsWith("LX")) return l;
        continue;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("the handheld did not answer");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        this.io.read(),
        new Promise<"late">((r) => {
          timer = setTimeout(() => r("late"), left);
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk === "late") throw new Error("the handheld did not answer");
      if (chunk === null) throw new Error("the handheld's line closed");
      this.pending += dec.decode(chunk, { stream: true });
      // a device that never ends its line is not allowed to fill the page's memory
      if (this.pending.length > MAX_LINE) throw new Error("the handheld sent an answer too long to be a trip");
    }
  }

  private async ask(command: string): Promise<string> {
    await this.send(`${command}\n`);
    const l = await this.line();
    const e = /^LXERR (\d+) (\w+)$/.exec(l);
    if (e) throw new LinkError(Number(e[1]), e[2]!);
    return l;
  }

  async hello(): Promise<HandheldHello> {
    const l = await this.ask("LX?");
    const m = /^LX! (\d+) ([01]) ([01])$/.exec(l);
    if (!m) throw new Error(`not a Lingxi handheld: ${l.slice(0, 40)}`);
    return { version: Number(m[1]), selfTest: m[2] === "1", aboard: m[3] === "1" };
  }

  async put(packet: Uint8Array): Promise<void> {
    const l = await this.ask(`LXPUT ${hex(packet)}`);
    if (l !== "LXOK put") throw new Error(`unexpected answer: ${l.slice(0, 40)}`);
  }

  /** the wall clock in beats (minutes since 1970): the handheld has none of its own, so the game tells it */
  async setTime(beat: number): Promise<void> {
    const l = await this.ask(`LXTIME ${Math.floor(beat)}`);
    if (l !== "LXOK time") throw new Error(`unexpected answer: ${l.slice(0, 40)}`);
  }

  /** the packet back; the pet stays aboard until done() */
  async get(): Promise<Uint8Array> {
    const l = await this.ask("LXGET");
    const m = /^LXBACK ([0-9a-f]+)$/.exec(l);
    if (!m || m[1]!.length % 2) throw new Error("the handheld's packet was cut short");
    return Uint8Array.from(m[1]!.match(/../g)!, (h) => parseInt(h, 16));
  }

  async done(): Promise<void> {
    const l = await this.ask("LXDONE");
    if (l !== "LXOK done") throw new Error(`unexpected answer: ${l.slice(0, 40)}`);
  }

  async drop(): Promise<void> {
    const l = await this.ask("LXDROP");
    if (l !== "LXOK drop") throw new Error(`unexpected answer: ${l.slice(0, 40)}`);
  }
}
