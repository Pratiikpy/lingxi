/**
 * The pet's voice (T6): one short line in the pet's own words for what its circuit
 * has just decided. The brain decides; the model only puts that decision into
 * words, so it is told the decision and the feelings behind it and is never asked
 * what the pet should do. Lines are cached by situation, so the same moment costs
 * one call however many players reach it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { type ParsedVoiceBody, VoiceBody } from "@lingxi/api-schema";
import { BudgetSpent } from "./tokenBudget";

export const VOICE_MODEL = "claude-haiku-5-5";

/** The request the game sends (its schema is shared with the game, @lingxi/api-schema), as parsed here. */
export const VoiceRequest = VoiceBody;
export type VoiceRequest = ParsedVoiceBody;

export type VoiceResult = { ok: true; line: string; cached: boolean } | { ok: false; reason: "busy" | "error" };

const level = (v: number) => (v < 200 ? "very low" : v < 450 ? "low" : v < 750 ? "fine" : "full");
const PERSONALITY = { gentle: "soft and affectionate", bold: "brave and a bit cheeky", curious: "wide-eyed and full of questions" } as const;
const MAX_CHARS = { en: 70, zh: 30 } as const;

/** A situation's cache key: what makes two moments sound the same. */
export function voiceKey(r: VoiceRequest): string {
  const m = r.meters;
  return [r.lang, r.moment, r.line, r.stage, r.decision, [...r.because].sort().join("+"), level(m.food), level(m.joy), level(m.energy), level(m.clean), r.sick, r.asleep, r.name].join("|");
}

export function voicePrompt(r: VoiceRequest, avoid: string[] = []): { system: string; user: string } {
  const lang = r.lang === "zh" ? "simplified Chinese, at most 20 characters" : "English, at most 12 words";
  const system = [
    `You give a voice to ${r.name}, a small pixel pet in the game Lingxi. ${r.name} is a ${r.stage} with a ${PERSONALITY[r.line]} nature.`,
    `Its mind is a circuit that has ALREADY decided what it does. Your only job is to say that decision out loud, as ${r.name}, in one short line.`,
    `Rules: speak as "I" (never say your own name or "Mochi is"); one sentence; no emoji, no quotation marks, no stage directions; never suggest doing something other than the decision; never mention circuits, rules or games; only mention feelings that are true from the list given (do not call yourself tired or hungry unless the list says so); "rest" with nothing special happening is calm contentment, not sleepiness; match its age (babies use very simple words); vary the wording and avoid the pattern "so I will"; if it is asleep, it is mumbling a few drowsy words in its sleep.`,
    `Write in ${lang}.`,
  ].join("\n");
  const user = [
    r.moment === "petted" ? "Your owner has just petted you." : "",
    `Decision: ${r.decision}.`,
    r.because.length ? `Because: ${r.because.join(", ")}.` : "",
    `Feelings: hunger satisfied ${level(r.meters.food)}, happiness ${level(r.meters.joy)}, energy ${level(r.meters.energy)}, cleanliness ${level(r.meters.clean)}${r.sick ? ", feeling ill" : ""}${r.asleep ? ", asleep (talking in its sleep)" : ""}.`,
    avoid.length ? `Say it differently from: ${avoid.join(" / ")}` : "",
    'Reply as JSON: {"line": "..."}',
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

/** Accept a model line only if it is short, single-line and free of markup. */
export function cleanLine(raw: unknown, lang: VoiceRequest["lang"]): string | null {
  const line = typeof raw === "object" && raw && "line" in raw ? (raw as { line: unknown }).line : null;
  if (typeof line !== "string") return null;
  const s = line.replace(/[\r\n]+/g, " ").replace(/^["'“”「」『』\s]+|["'“”「」『』\s]+$/g, "").trim();
  if (!s || s.length > MAX_CHARS[lang] || /[<>{}]|https?:/i.test(s)) return null;
  return s;
}

const VOICE_SCHEMA = { type: "object", properties: { line: { type: "string" } }, required: ["line"], additionalProperties: false } as const;

/** Up to this many different lines are kept for one situation, then they take turns. */
const VARIANTS = 3;

export function createVoice(client: Anthropic, capacity = 2000) {
  const cache = new Map<string, { lines: string[]; next: number }>();
  return async (r: VoiceRequest): Promise<VoiceResult> => {
    const key = voiceKey(r);
    const hit = cache.get(key);
    if (hit && hit.lines.length >= VARIANTS) {
      const line = hit.lines[hit.next % hit.lines.length]!;
      hit.next++;
      cache.delete(key);
      cache.set(key, hit);
      return { ok: true, line, cached: true };
    }
    const { system, user } = voicePrompt(r, hit?.lines ?? []);
    const line = (await ask(system, user, r.lang)) ?? (await ask(system, user, r.lang));
    if (line === "busy") return { ok: false, reason: "busy" };
    if (!line) return { ok: false, reason: "error" };
    const entry = hit ?? { lines: [], next: 0 };
    if (!entry.lines.includes(line)) entry.lines.push(line);
    cache.delete(key);
    cache.set(key, entry);
    if (cache.size > capacity) cache.delete(cache.keys().next().value!);
    return { ok: true, line, cached: false };
  };

  /** One call; a usable line, "busy" when rate-limited, or null (asked again once). */
  async function ask(system: string, user: string, lang: VoiceRequest["lang"]): Promise<string | null> {
    let msg: Anthropic.Message;
    try {
      msg = await client.messages.create({
        model: VOICE_MODEL,
        max_tokens: 200,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema: VOICE_SCHEMA } },
      });
    } catch (e) {
      return e instanceof Anthropic.RateLimitError || e instanceof BudgetSpent ? "busy" : null;
    }
    if (msg.stop_reason === "refusal") return null;
    const text = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
    try {
      return cleanLine(JSON.parse(text), lang);
    } catch {
      return null;
    }
  }
}
