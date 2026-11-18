import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import { claimHandheld, handheldHere, onHandheldLost } from "../game/handheldLock";

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
onHandheldLost(() => void elsewhere());
void claimHandheld().then(async (mine) => {
  if (!mine) return elsewhere();
  const { HandheldApp } = await import("./HandheldApp");
  root.render(
    <StrictMode>
      <HandheldApp />
    </StrictMode>,
  );
});
