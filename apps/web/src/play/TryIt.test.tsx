// @vitest-environment happy-dom
/**
 * B4: right after a lesson is taught, Try it says what will bring it about. An event lesson sends the player to watch
 * the friend, toy or noise the room stages; a care lesson asks for the care; a moment lesson shows what the pet would
 * do then, beside what it would have done without the lesson, with nothing changed.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PET_SCHOOL } from "@lingxi/game";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

const lessonOf = (id: string) => PET_SCHOOL.find((l) => l.id === id)!.rule;

async function open(id: string) {
  await visit({ at: Date.UTC(2026, 10, 21, 9) });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { useGame } = await import("../game/store");
  const { useTrial } = await import("../game/tryIt");
  const { TryIt } = await import("./TryIt");
  useGame.getState().hatch("gentle", "Kiri");
  const lesson = lessonOf(id);
  expect(useGame.getState().learn(lesson).ok).toBe(true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let done = 0;
  await act(async () => root.render(createElement(TryIt, { pet: useGame.getState().pet!, lesson, onDone: () => done++ })));
  const close = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, useTrial, useGame, close, done: () => done };
}

describe("Try it follows what brings the lesson about (B4)", () => {
  it("an event lesson says a friend is coming and sends the player back to the room to watch", async () => {
    const { host, useTrial, useGame, close, done } = await open("share");
    expect(host.textContent).toContain("A friend comes by");
    expect(useGame.getState().lightBulb).not.toBeNull();
    const before = useTrial.getState().watching;
    await act(async () => (host.querySelector('button[data-hint="try"]') as HTMLButtonElement).click());
    expect(useTrial.getState().watching).toBe(before + 1);
    expect(useTrial.getState().trial, "no dry run is staged: the room does it for real").toBeNull();
    expect(done()).toBe(1);
    close();
  });

  it("a care lesson asks for the care it answers", async () => {
    const { host, close } = await open("thanks");
    expect(host.textContent).toContain("Feed it");
    close();
  });

  it("a moment lesson shows what the pet would do then, without changing it", async () => {
    const { host, useTrial, useGame, close } = await open("nap");
    expect(host.textContent).toMatch(/will do this/);
    const pet = useGame.getState().pet!;
    await act(async () => (host.querySelector('button[data-hint="try"]') as HTMLButtonElement).click());
    const trial = useTrial.getState().trial;
    expect(trial?.fired).toBe(true);
    const { useVoice } = await import("../game/voice");
    expect(useVoice.getState().line).toMatch(/When that moment comes I'll/);
    expect(useGame.getState().pet, "the preview logs nothing").toBe(pet);
    close();
  });
});
