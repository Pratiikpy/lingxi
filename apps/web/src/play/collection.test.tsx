// @vitest-environment happy-dom
/**
 * D5: "Collection" opens the collection itself: the album, the badges and every home piece, with counts that add up to
 * the first screen's number. (The pixel drawings need a canvas, which this test page has not got; they are stood in.)
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BADGES, VISITORS } from "@lingxi/game";
import { DECOR } from "@lingxi/world";
import { leave, visit } from "../game/testGame";

vi.mock("./Album", async (orig) => ({ ...(await orig<typeof import("./Album")>()), AlbumPanel: () => createElement("section", { className: "album-stand-in" }, "album") }));
vi.mock("./DecorBar", async (orig) => ({ ...(await orig<typeof import("./DecorBar")>()), DecorIcon: () => null }));

afterEach(() => leave());

describe("the collection sheet (D5)", () => {
  it("shows the album, the badges and every home piece, and its sum matches the first screen", async () => {
    await visit({ at: Date.UTC(2026, 10, 23, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { useGame } = await import("../game/store");
    const { useWorld } = await import("../game/world");
    const { useAlbum } = await import("./Album");
    const { CollectionPanel } = await import("./Collection");
    useGame.getState().hatch("gentle", "Kiri");
    const w = useWorld.getState().world;
    useWorld.setState({ world: { ...w, decor: { owned: ["fern", "bench"], placed: [] } } });
    useAlbum.setState({ album: { pip: { count: 3, first: 0 } } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(CollectionPanel)));
    const text = host.textContent!;
    expect(text).toContain(`3 of ${VISITORS.length + BADGES.length + DECOR.length} collected: 1 visitors, 0 badges, 2 home pieces.`);
    expect(host.querySelector(".album-stand-in")).not.toBeNull();
    expect(text).toContain("Care badges");
    expect(host.querySelectorAll(".collection-pieces li")).toHaveLength(DECOR.length);
    expect(host.querySelectorAll(".collection-pieces li.owned")).toHaveLength(2);
    expect(text).toContain("Builder's commission · from child");
    act(() => root.unmount());
    host.remove();
  });
});
