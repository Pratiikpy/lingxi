// @vitest-environment happy-dom
/**
 * G10: the first screen shows today's errands (how many done, the next one) and one collection count, each opening
 * where it lives.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BADGES, VISITORS } from "@lingxi/game";
import { DECOR, QUESTLINE } from "@lingxi/world";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

describe("today's errands and the collection on the first screen (G10)", () => {
  it("says how many of today's are done and names the next; counts the collection; each tap opens its sheet", async () => {
    await visit({ at: Date.UTC(2026, 10, 23, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { useGame } = await import("../game/store");
    const { useWorld } = await import("../game/world");
    const { useAlbum } = await import("./Album");
    const { Actions } = await import("./parts");
    useGame.getState().hatch("gentle", "Kiri");
    const ids = ["d-breakfast", "d-hello", "d-rooms"].filter((id) => QUESTLINE.some((q) => q.id === id));
    expect(ids.length).toBe(3);
    const w = useWorld.getState().world;
    useWorld.setState({ world: { ...w, quests: { active: {}, done: {}, ...(w.quests ?? {}), today: { day: "2026-11-23", offered: ids, done: [ids[0]!] } }, decor: { owned: ["fern", "lantern"], placed: [] } } as never });
    useAlbum.setState({ album: { pip: { count: 1, first: 0 }, moss: { count: 2, first: 0 } } });
    let opened = "";
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const noop = () => {};
    await act(async () => root.render(createElement(Actions, { pet: useGame.getState().pet!, onFeed: noop, onPlay: noop, onClean: noop, onSleep: noop, onMedicine: noop, onToday: () => (opened = "today"), onCollection: () => (opened = "collection") })));
    const errands = host.querySelector(".tcard-errands")!;
    expect(errands.textContent).toContain("Today 1/3");
    expect(errands.textContent).toContain(QUESTLINE.find((q) => q.id === ids[1])!.title.en);
    const collect = host.querySelector(".tcard-collect")!;
    expect(collect.textContent).toContain(`${2 + 0 + 2}/${VISITORS.length + BADGES.length + DECOR.length}`);
    expect(collect.getAttribute("aria-label")).toContain("visitors 2/");
    // D2: today's village happening, in words, under the card
    const { happeningAt } = await import("@lingxi/world");
    const h = happeningAt(useWorld.getState().world, Date.UTC(2026, 10, 23, 9));
    // D9: on the pet's first day the map is closed, so the happening (somewhere the map reaches) is not told yet
    expect(host.querySelector(".village-line")).toBeNull();
    const { useReveal } = await import("../game/reveal");
    await act(async () => useReveal.getState().openAll());
    const village = host.querySelector(".village-line")!.textContent!;
    expect(village).toContain("Today in the village");
    expect(village).toMatch(h.kind === "market" ? /Market day/ : h.kind === "lucky" ? /Lucky day/ : /little gift/);
    await act(async () => (errands as HTMLButtonElement).click());
    expect(opened).toBe("today");
    await act(async () => (collect as HTMLButtonElement).click());
    expect(opened).toBe("collection");
    act(() => root.unmount());
    host.remove();
  });

  it("names an errand ready to hand in first, and says it is ready (D4)", async () => {
    await visit({ at: Date.UTC(2026, 10, 23, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { useGame } = await import("../game/store");
    const { useWorld } = await import("../game/world");
    const { Actions } = await import("./parts");
    useGame.getState().hatch("gentle", "Kiri");
    const pats = QUESTLINE.find((q) => q.id === "d-pats")!;
    const ids = ["d-breakfast", "d-hello", "d-pats"];
    const w = useWorld.getState().world;
    // three pats given since the day began: its count is reached and it waits to be handed in
    useWorld.setState({ world: { ...w, quests: { done: {}, ...(w.quests ?? {}), active: { "d-pats": { at: 0, snap: { "CARE:pet": 0 } } }, today: { day: "2026-11-23", offered: ids, done: [] } }, tally: { ...(w.tally ?? {}), "CARE:pet": 3 } } as never });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const noop = () => {};
    await act(async () => root.render(createElement(Actions, { pet: useGame.getState().pet!, onFeed: noop, onPlay: noop, onClean: noop, onSleep: noop, onMedicine: noop, onToday: noop, onCollection: noop })));
    const errands = host.querySelector(".tcard-errands")!;
    expect(errands.textContent).toContain(`Ready: ${pats.title.en}`);
    expect(errands.textContent).toContain("Today 0/3");
    act(() => root.unmount());
    host.remove();
  });
});
