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
    useWorld.setState({ world: { ...w, quests: { ...(w.quests ?? { active: {} }), active: {}, today: { day: "2026-11-23", offered: ids, done: [ids[0]!] } }, decor: { owned: ["fern", "lantern"], placed: [] } } as never });
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
    await act(async () => (errands as HTMLButtonElement).click());
    expect(opened).toBe("today");
    await act(async () => (collect as HTMLButtonElement).click());
    expect(opened).toBe("collection");
    act(() => root.unmount());
    host.remove();
  });
});
