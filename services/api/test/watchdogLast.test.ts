/**
 * R17: the watchdog remembers its last action across its own restarts. It kept the action in memory only, and is
 * itself restarted with each release of its code and each reboot, so the health report then said "no action yet" and
 * the one line telling that the server had been restarted, and when, was gone.
 */
import { describe, expect, it } from "vitest";
import { lastFrom } from "../../../deploy/watchdog-rules.mjs";

describe("the watchdog's last action, read back from its status (R17)", () => {
  it("is what the status it last wrote says", () => {
    const status = JSON.stringify({
      at: "2026-11-26T16:30:34.719Z",
      local: true,
      public: true,
      last: { action: "restart-server", at: "2026-11-26T03:10:00.000Z", result: "restarted lingxi-server" },
    });
    expect(lastFrom(status)).toEqual({
      action: "restart-server",
      at: "2026-11-26T03:10:00.000Z",
      result: "restarted lingxi-server",
    });
  });

  it("is empty for a status with no action, a status that is not ours, and no status at all", () => {
    const none = { action: null, at: null, result: null };
    expect(lastFrom(JSON.stringify({ last: { action: null, at: null, result: null } }))).toEqual(none);
    expect(lastFrom(JSON.stringify({ last: { action: "format-disk", at: "x", result: "y" } }))).toEqual(none);
    expect(lastFrom("not json")).toEqual(none);
    expect(lastFrom("")).toEqual(none);
  });
});
