// @vitest-environment happy-dom
/**
 * R8: what the game says aloud. NVDA read nothing after a feed, a bath or a pat: the care note and the pet's words
 * arrive as new elements already holding their text, and a screen reader reads a live region only when its text
 * changes while it is on the page. One region is always there, and each note and each line is put into it.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { leave, visit } from "../game/testGame";

afterEach(() => leave());

describe("what the game says aloud (R8)", () => {
  it("one region, on the page before anything is said, takes each care note and each of the pet's lines", async () => {
    await visit({ at: Date.UTC(2026, 10, 26, 9) });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { useGame } = await import("../game/store");
    const { useVoice } = await import("../game/voice");
    const { Announcer } = await import("./Announcer");
    useGame.getState().hatch("gentle", "Kiko");
    useGame.setState({ toast: null });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const show = (voice: boolean) => act(async () => root.render(createElement(Announcer, { name: "Kiko", voice })));
    await show(true);
    const region = host.querySelector('[role="status"]')!;
    expect(region, "the region is there before anything is said").not.toBeNull();
    expect(region.textContent).toBe("");

    await act(async () => useGame.setState({ toast: { id: 9001, note: "ate" } }));
    expect(region.textContent).toBe("Kiko ate it all up.");
    const first = region.firstElementChild;
    // the same note again is a new node, so it is read again
    await act(async () => useGame.setState({ toast: { id: 9002, note: "ate" } }));
    expect(region.textContent).toBe("Kiko ate it all up.");
    expect(region.firstElementChild, "a second feed is said again").not.toBe(first);
    // the note going from the screen does not empty the region mid-sentence, and says nothing new
    const kept = region.firstElementChild;
    await act(async () => useGame.setState({ toast: null }));
    expect(region.firstElementChild).toBe(kept);

    // the pet's own words, with who is speaking
    await act(async () => useVoice.setState({ line: "Hello, little one", id: 77 }));
    expect(region.textContent).toBe("Kiko says: Hello, little one");
    // while a sheet is open over the room the pet's passing words wait, as they do on screen
    await show(false);
    await act(async () => useVoice.setState({ line: "Later words", id: 78 }));
    expect(region.textContent).toBe("Kiko says: Hello, little one");
    await act(async () => useGame.setState({ toast: { id: 9003, note: "cleaned" } }));
    expect(region.textContent).toBe("All clean. Kiko sneezed once.");

    act(() => root.unmount());
    host.remove();
  });
});
