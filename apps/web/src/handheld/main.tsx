import "../boot/staleBuild";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import { claimHandheld, handheldHere, onHandheldLost } from "../game/handheldLock";
import { LoadFailed } from "../play/LoadFailed";

const root = createRoot(document.getElementById("root")!);

/** Shown in place of the handheld when another tab runs it. */
async function elsewhere(): Promise<void> {
  const { ElsewhereScreen } = await import("../play/SaveScreens");
  root.render(
    <StrictMode>
      <ElsewhereScreen handheld onHere={handheldHere} />
    </StrictMode>,
  );
}

// one handheld tab at a time (P1): its memory in storage is written by this tab only while it holds the handheld
/** A part of the handheld that could not be loaded (staleBuild.ts has already reloaded once for a new build). */
const failedToLoad = () =>
  root.render(
    <StrictMode>
      <LoadFailed />
    </StrictMode>,
  );

onHandheldLost(() => void elsewhere().catch(failedToLoad));
void claimHandheld()
  .then(async (mine) => {
    if (!mine) return elsewhere();
    const { HandheldApp } = await import("./HandheldApp");
    // P3: the first render is a transition, so React renders it in short slices and the page answers while it does
    startTransition(() =>
      root.render(
        <StrictMode>
          <HandheldApp />
        </StrictMode>,
      ),
    );
  })
  .catch(failedToLoad);
