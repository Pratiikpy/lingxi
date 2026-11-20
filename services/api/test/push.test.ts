import { describe, expect, it } from "vitest";
import { MAX_DEVICES_PER_ADDRESS, createPusher, isPushEndpoint, outOfQuietHours, reminderText, type Plan } from "../src/push";

const H = 3_600_000;
const NOON_UTC = Date.UTC(2026, 10, 16, 12);
const sub = (endpoint = "https://fcm.googleapis.com/fcm/send/abc") => ({ endpoint, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } });
const plan = (over: Partial<Plan> = {}): Plan => ({ subscription: sub(), lang: "en", name: "Mochi", tz: 0, reminders: [{ kind: "hungry", at: NOON_UTC + H }], ...over });

function fake() {
  const sent: Array<{ endpoint: string; payload: { title: string; kind: string } }> = [];
  const gone = new Set<string>();
  const pusher = createPusher({
    publicKey: "pk",
    privateKey: "sk",
    subject: "https://lingxi.test",
    send: async (s, payload) => {
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
      return { gone: gone.has(s.endpoint) };
    },
  });
  return { pusher, sent, gone };
}

describe("reminders by web push", () => {
  it("only accepts real push services as endpoints (no calls to other addresses)", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/x")).toBe(false);
    expect(isPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
    const { pusher } = fake();
    expect(pusher.plan(plan({ subscription: sub("https://127.0.0.1/x") }), NOON_UTC)).toEqual({ ok: false, reason: "badEndpoint" });
  });

  it("keeps the player's nights quiet: 22:00-8:00 local moves to 8:00", () => {
    expect(outOfQuietHours(NOON_UTC, 0)).toBe(NOON_UTC);
    expect(new Date(outOfQuietHours(Date.UTC(2026, 10, 16, 23), 0)).toISOString()).toBe("2026-11-17T08:00:00.000Z");
    expect(new Date(outOfQuietHours(Date.UTC(2026, 10, 16, 3), 0)).toISOString()).toBe("2026-11-16T08:00:00.000Z");
    // Shanghai (UTC+8): 15:00 UTC is 23:00 there, so it waits for 8:00 Shanghai = 00:00 UTC
    expect(new Date(outOfQuietHours(Date.UTC(2026, 10, 16, 15), 480)).toISOString()).toBe("2026-11-17T00:00:00.000Z");
  });

  it("sends a due reminder once, in the player's language, and nothing early", async () => {
    const { pusher, sent } = fake();
    pusher.plan(plan({ lang: "zh", reminders: [{ kind: "hungry", at: NOON_UTC + H }] }), NOON_UTC);
    expect(await pusher.tick(NOON_UTC + H - 1)).toBe(0);
    expect(await pusher.tick(NOON_UTC + H)).toBe(1);
    expect(sent[0]!.payload.title).toBe(reminderText("hungry", "zh", "Mochi").title);
    expect(await pusher.tick(NOON_UTC + 2 * H)).toBe(0);
  });

  it("never sends more than one every three hours, and the most pressing need wins", async () => {
    const { pusher, sent } = fake();
    pusher.plan(plan({ reminders: [{ kind: "bored", at: NOON_UTC + H }, { kind: "sick", at: NOON_UTC + H }, { kind: "dirty", at: NOON_UTC + 2 * H }] }), NOON_UTC);
    await pusher.tick(NOON_UTC + H);
    await pusher.tick(NOON_UTC + 2 * H);
    expect(sent.map((s) => s.payload.kind)).toEqual(["sick"]);
  });

  it("a new plan replaces the old one; stop removes the player; a gone subscription is dropped", async () => {
    const { pusher, sent, gone } = fake();
    pusher.plan(plan(), NOON_UTC);
    pusher.plan(plan({ reminders: [{ kind: "dirty", at: NOON_UTC + 5 * H }] }), NOON_UTC);
    expect(await pusher.tick(NOON_UTC + H)).toBe(0);
    expect(pusher.stop(sub().endpoint)).toBe(true);
    expect(pusher.size()).toBe(0);
    pusher.plan(plan(), NOON_UTC);
    gone.add(sub().endpoint);
    await pusher.tick(NOON_UTC + H);
    expect(pusher.size()).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("lets go of a subscription with nothing left to send, and still keeps the three-hour gap (A83)", async () => {
    const { pusher, sent } = fake();
    pusher.plan(plan(), NOON_UTC);
    await pusher.tick(NOON_UTC + H);
    expect(sent).toHaveLength(1);
    expect(pusher.size(), "nothing left to send: it holds no place").toBe(0);
    // the next visit plans again an hour later: the gap since the last reminder still holds
    pusher.plan(plan({ reminders: [{ kind: "bored", at: NOON_UTC + 2 * H }] }), NOON_UTC + 1.5 * H);
    await pusher.tick(NOON_UTC + 2 * H);
    expect(sent, "no second reminder within three hours").toHaveLength(1);
    // a plan with nothing to send holds nothing
    pusher.plan(plan({ reminders: [] }), NOON_UTC + 3 * H);
    expect(pusher.size()).toBe(0);
  });

  it("one address holds a few devices' subscriptions, and a /48 four addresses' worth (A83)", () => {
    const { pusher } = fake();
    const device = (i: number) => plan({ subscription: sub(`https://fcm.googleapis.com/fcm/send/d${i}`) });
    for (let i = 0; i < MAX_DEVICES_PER_ADDRESS; i++) expect(pusher.plan(device(i), NOON_UTC, "203.0.113.9").ok).toBe(true);
    expect(pusher.plan(device(99), NOON_UTC, "203.0.113.9")).toEqual({ ok: false, reason: "tooMany" });
    expect(pusher.plan(device(0), NOON_UTC, "203.0.113.9").ok, "a device already there may always plan again").toBe(true);
    expect(pusher.plan(device(100), NOON_UTC, "198.51.100.1").ok, "another address is not affected").toBe(true);
    let fromNetwork = 0;
    for (let i = 0; i < 200; i++) if (pusher.plan(device(1_000 + i), NOON_UTC, `2001:db8:7:${i.toString(16)}::/64`).ok) fromNetwork++;
    expect(fromNetwork).toBe(MAX_DEVICES_PER_ADDRESS * 4);
  });

  it("ignores reminders in the past or more than two days out", async () => {
    const { pusher } = fake();
    pusher.plan(plan({ reminders: [{ kind: "hungry", at: NOON_UTC - 5 * H }, { kind: "bored", at: NOON_UTC + 60 * H }] }), NOON_UTC);
    expect(await pusher.tick(NOON_UTC + 70 * H)).toBe(0);
  });
});
