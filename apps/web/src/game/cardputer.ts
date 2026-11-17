/**
 * A Cardputer over USB (plan 4.14): the game talks to the handheld's firmware through Web Serial with the link in
 * @lingxi/handheld (core/link.h has the protocol). Chrome and Edge on a computer have Web Serial; phones and
 * Safari do not, and there the browser handheld is the way to take a pet along.
 */

import { HandheldLink, LinkError, readReturn } from "@lingxi/handheld";
import { BEAT_MS } from "@lingxi/game";
import { type Deliver, type HomeResult, bringPetHome, isOwed, settleOwed } from "./handheld";

/* the slice of Web Serial used here; the DOM library this project builds with does not declare it */
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  getPorts(): Promise<SerialPortLike[]>;
  requestPort(o?: { filters?: Array<{ usbVendorId: number }> }): Promise<SerialPortLike>;
}
const serial = (): SerialLike | null => (typeof navigator !== "undefined" && "serial" in navigator ? (navigator as unknown as { serial: SerialLike }).serial : null);

export const cardputerAvailable = (): boolean => !!serial();

/* the ESP32-S3's own USB (Espressif) */
const ESPRESSIF = 0x303a;

export class CardputerProblem extends Error {}

const WORDS: Record<string, [string, string]> = {
  selfTest: ["Its self-test failed, so it takes no pets. Flash the Lingxi firmware again.", "它的自检没通过，不接收宠物。请重新刷入灵犀固件。"],
  carrying: ["It is carrying another pet. Bring that one home from the game it left.", "它正带着另一只宠物。请在那只宠物出门的游戏里把它带回家。"],
  tooBig: ["This pet's mind is too big for the Cardputer.", "这只宠物的心智太大，Cardputer 装不下。"],
  damaged: ["The packet was damaged on the way. Try again.", "数据在路上坏了。请再试一次。"],
  noLink: ["No Lingxi handheld answered on that port.", "那个端口上没有灵犀掌机回应。"],
  cancelled: ["No Cardputer was chosen.", "没有选择 Cardputer。"],
};
export const cardputerWords = (key: string, lang: "en" | "zh"): string => (WORDS[key] ?? [key, key])[lang === "zh" ? 1 : 0];

/** Open the Cardputer (one already allowed, or ask for it), run `use` over the link, and always close the port. */
async function withCardputer<T>(use: (link: HandheldLink) => Promise<T>): Promise<T> {
  const s = serial();
  if (!s) throw new CardputerProblem("noLink");
  let port: SerialPortLike;
  try {
    port = (await s.getPorts())[0] ?? (await s.requestPort({ filters: [{ usbVendorId: ESPRESSIF }] }));
  } catch {
    throw new CardputerProblem("cancelled");
  }
  await port.open({ baudRate: 115200 });
  const reader = port.readable!.getReader();
  const writer = port.writable!.getWriter();
  try {
    const link = new HandheldLink({
      write: (b) => writer.write(b),
      read: async () => {
        const r = await reader.read();
        return r.done ? null : r.value;
      },
    });
    return await use(link);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    writer.releaseLock();
    await port.close().catch(() => {});
  }
}

const nowBeat = () => Math.floor(Date.now() / BEAT_MS);

/** clear a pet this game called back while the Cardputer was away; refuse if it carries anyone else's */
async function makeRoom(link: HandheldLink): Promise<void> {
  const back = readReturn(await link.get());
  if (back.ok && isOwed(back.trip.startDigest)) {
    await link.drop();
    settleOwed(back.trip.startDigest);
    return;
  }
  throw new CardputerProblem("carrying");
}

/** hands the trip packet to a Cardputer: the `deliver` step of takeAlong */
export const toCardputer: Deliver = (packet) =>
  withCardputer(async (link) => {
    const hello = await link.hello().catch(() => {
      throw new CardputerProblem("noLink");
    });
    if (!hello.selfTest) throw new CardputerProblem("selfTest");
    if (hello.aboard) await makeRoom(link);
    await link.setTime(nowBeat());
    try {
      await link.put(packet);
    } catch (e) {
      if (e instanceof LinkError) throw new CardputerProblem(e.word === "tooBig" ? "tooBig" : e.word === "damaged" ? "damaged" : e.word);
      throw e;
    }
  });

/** brings the pet home from a Cardputer: the game replays the trip, then the handheld lets the pet go */
export const fromCardputer = (): Promise<HomeResult> =>
  withCardputer(async (link) => {
    const hello = await link.hello().catch(() => {
      throw new CardputerProblem("noLink");
    });
    if (!hello.aboard) return { ok: false, reason: "noTrip" } as HomeResult;
    // the pet lives up to this minute on the handheld before it leaves it
    await link.setTime(nowBeat());
    const packet = await link.get();
    return bringPetHome(packet, () => link.done());
  });
