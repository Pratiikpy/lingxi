/**
 * R61: the service worker's list of what the game keeps (offlineList.ts). The review found about 30 scripts of the game
 * loaded before the worker took control and missing from its list, so an offline reload after a first visit showed
 * "Something went wrong" or a stuck splash: the list held only what the game's first screens import directly, not the
 * screens it loads later (a sheet, a mini-game, the room's renderer).
 */
import { describe, expect, it } from "vitest";
import { HOME, HOME_ROOM } from "@lingxi/world";
import sheet from "../../../../packages/world/src/data/world.json";
import { type BuiltChunk, HOME_INDEX, homeRoomArt, offlineFiles } from "./offlineList";

const chunk = (fileName: string, part: Partial<BuiltChunk> = {}): BuiltChunk => ({
  fileName,
  isEntry: false,
  facadeModuleId: null,
  imports: [],
  dynamicImports: [],
  importedCss: [],
  importedAssets: [],
  ...part,
});

/** A small game: its page's entry, the hatch screen and the game behind it, and a handheld page beside it. */
const BUILT: BuiltChunk[] = [
  chunk("assets/play-1.js", {
    isEntry: true,
    facadeModuleId: "C:\\repo\\apps\\web\\play.html",
    imports: ["assets/boot-1.js"],
    dynamicImports: ["assets/FirstVisit-1.js", "assets/PlayApp-1.js"],
    importedCss: ["assets/play-1.css"],
  }),
  chunk("assets/boot-1.js", {
    importedAssets: [
      "assets/pixelify-sans-latin-wght-normal-1.woff2",
      "assets/pixelify-sans-latin-ext-wght-normal-1.woff2",
      "assets/pixelify-sans-cyrillic-wght-normal-1.woff2",
      "assets/baloo-2-latin-wght-normal-1.woff2",
      "assets/baloo-2-devanagari-wght-normal-1.woff2",
      "assets/baloo-2-vietnamese-wght-normal-1.woff2",
      "assets/lingxi-pixel-cjk-1.woff2",
    ],
  }),
  chunk("assets/FirstVisit-1.js", {
    imports: ["assets/boot-1.js"],
  }),
  chunk("assets/PlayApp-1.js", {
    dynamicImports: ["assets/Arena-1.js", "assets/RoomScene-1.js"],
  }),
  // reached only through a lazy screen, and that screen's own lazy part
  chunk("assets/Arena-1.js", { importedCss: ["assets/Arena-1.css"], dynamicImports: ["assets/FightView-1.js"] }),
  chunk("assets/FightView-1.js", { imports: ["assets/parts-1.js"] }),
  chunk("assets/parts-1.js"),
  chunk("assets/RoomScene-1.js", { dynamicImports: ["assets/WebGLRenderer-1.js"] }),
  chunk("assets/WebGLRenderer-1.js"),
  // another page's code: not the game's
  chunk("assets/handheld-1.js", {
    isEntry: true,
    facadeModuleId: "/repo/apps/web/handheld.html",
    dynamicImports: ["assets/HandheldApp-1.js"],
  }),
  chunk("assets/HandheldApp-1.js", { importedAssets: ["assets/lingxi-handheld-1.wasm"] }),
];

describe("what the game keeps to open offline (R61)", () => {
  const files = offlineFiles(BUILT, "play.html", ["manifest.webmanifest", "favicon.png"]);

  it("every script the game can load, the lazy ones and theirs too, and their styles", () => {
    for (const f of [
      "assets/play-1.js",
      "assets/boot-1.js",
      "assets/FirstVisit-1.js",
      "assets/PlayApp-1.js",
      "assets/Arena-1.js",
      "assets/FightView-1.js",
      "assets/parts-1.js",
      "assets/RoomScene-1.js",
      "assets/WebGLRenderer-1.js",
      "assets/play-1.css",
      "assets/Arena-1.css",
    ])
      expect(files, f).toContain(f);
  });

  it("the page and its extras first, each file once", () => {
    expect(files.slice(0, 3)).toEqual(["play.html", "manifest.webmanifest", "favicon.png"]);
    expect(new Set(files).size).toBe(files.length);
  });

  it("the faces of the game's two languages, not the subsets for scripts it never writes", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "assets/pixelify-sans-latin-wght-normal-1.woff2",
        "assets/pixelify-sans-latin-ext-wght-normal-1.woff2",
        "assets/baloo-2-latin-wght-normal-1.woff2",
        "assets/lingxi-pixel-cjk-1.woff2",
      ]),
    );
    expect(files.filter((f) => /cyrillic|devanagari|vietnamese/.test(f))).toEqual([]);
  });

  it("nothing of another page (the handheld's code and its 0.5 MB machine)", () => {
    expect(files.filter((f) => /handheld/i.test(f))).toEqual([]);
  });

  it("no game entry in the bundle: an error, not an empty list that quietly keeps nothing", () => {
    expect(() => offlineFiles(BUILT.slice(1), "play.html", [])).toThrow(/play\.html/);
  });
});

describe("the home room's pictures, kept for every hour (R61)", () => {
  it("the build's home is the world's home, and its three times of day are kept", () => {
    expect(HOME_INDEX).toBe(HOME);
    expect(homeRoomArt(sheet.rooms).sort()).toEqual([...new Set(Object.values(HOME_ROOM.bgs))].sort());
    expect(homeRoomArt(sheet.rooms)).toHaveLength(3);
  });

  it("a sheet without the home room is an error", () => {
    expect(() => homeRoomArt(sheet.rooms.filter((r) => r.index !== HOME_INDEX))).toThrow(/home room/);
  });
});
