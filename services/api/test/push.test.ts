import { describe, expect, it } from "vitest";
import { createPusher, isPushEndpoint, outOfQuietHours, reminderText, type Plan } from "../src/push";

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

  it("ignores reminders in the past or more than two days out", async () => {
    const { pusher } = fake();
    pusher.plan(plan({ reminders: [{ kind: "hungry", at: NOON_UTC - 5 * H }, { kind: "bored", at: NOON_UTC + 60 * H }] }), NOON_UTC);
    expect(await pusher.tick(NOON_UTC + 70 * H)).toBe(0);
  });
});
