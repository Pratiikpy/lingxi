import { describe, expect, it } from "vitest";
import { cleanLine, createVoice, voiceKey, voicePrompt, VoiceRequest } from "../src/voice";

const req = (over: Partial<VoiceRequest> = {}): VoiceRequest =>
  VoiceRequest.parse({ name: "Mochi", lang: "en", stage: "baby", line: "gentle", decision: "ask for food", because: ["very hungry"], meters: { food: 100, joy: 500, energy: 800, clean: 800 }, sick: false, asleep: false, ...over });

function fakeClient(lines: string[]) {
  const calls: Array<{ system: string; user: string; model: string }> = [];
  let i = 0;
  const client = {
    messages: {
      create: async (body: { system: string; messages: Array<{ content: string }>; model: string }) => {
        calls.push({ system: body.system, user: body.messages[0]!.content, model: body.model });
        return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ line: lines[i++ % lines.length] }) }] };
      },
    },
  };
  return { client: client as never, calls };
}

describe("the pet's voice", () => {
  it("tells the model the decision and true feelings, and forbids deciding anything else", () => {
    const { system, user } = voicePrompt(req());
    expect(user).toContain("Decision: ask for food.");
    expect(user).toContain("hunger satisfied very low");
    expect(system).toMatch(/ALREADY decided/);
    expect(system).toMatch(/never suggest doing something other than the decision/);
    expect(voicePrompt(req({ moment: "petted" })).user).toContain("just petted you");
  });

  it("accepts only short, single-line, markup-free lines", () => {
    expect(cleanLine({ line: '  "Food, please?"  ' }, "en")).toBe("Food, please?");
    expect(cleanLine({ line: "x".repeat(80) }, "en")).toBeNull();
    expect(cleanLine({ line: "肚子饿了，想吃东西" }, "zh")).toBe("肚子饿了，想吃东西");
    expect(cleanLine({ line: "看看 https://evil.example" }, "zh")).toBeNull();
    expect(cleanLine({ line: "<b>hi</b>" }, "en")).toBeNull();
    expect(cleanLine({ nope: 1 }, "en")).toBeNull();
  });

  it("keys situations by what matters (levels, not exact numbers) and by moment", () => {
    expect(voiceKey(req({ meters: { food: 100, joy: 500, energy: 800, clean: 800 } }))).toBe(voiceKey(req({ meters: { food: 150, joy: 600, energy: 900, clean: 760 } })));
    expect(voiceKey(req())).not.toBe(voiceKey(req({ moment: "petted" })));
    expect(voiceKey(req())).not.toBe(voiceKey(req({ lang: "zh" })));
  });

  it("keeps up to three different lines per situation, then takes turns without new calls", async () => {
    const { client, calls } = fakeClient(["Food, please?", "My tummy is rumbling.", "Snack time?"]);
    const voice = createVoice(client);
    const got: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await voice(req());
      if (r.ok) got.push(r.line);
    }
    expect(calls).toHaveLength(3);
    expect(new Set(got).size).toBe(3);
    expect(calls[1]!.user).toContain("Say it differently from: Food, please?");
    expect(calls[0]!.model).toBe("claude-haiku-5-5");
  });

  it("refuses a line the model makes too long", async () => {
    const { client } = fakeClient(["word ".repeat(30)]);
    expect(await createVoice(client)(req())).toEqual({ ok: false, reason: "error" });
  });
});

describe("voice route failures stay quiet in the browser", () => {
  it("answers 200 with ok:false when busy or when the model fails", async () => {
    const { Hono } = await import("hono");
    const { withVoice } = await import("../src/server");
    const { RateLimiter } = await import("../src/limit");
    const app = withVoice(new Hono(), (async () => ({ ok: false, reason: "error" })) as never, new RateLimiter(1, 600_000));
    const body = JSON.stringify(req());
    const first = await app.request("/api/voice", { method: "POST", body, headers: { "content-type": "application/json" } });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: false, reason: "error" });
    const second = await app.request("/api/voice", { method: "POST", body, headers: { "content-type": "application/json" } });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: false, reason: "busy" });
  });
});
