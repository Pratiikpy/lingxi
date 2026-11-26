import "../boot/staleBuild";
import { StrictMode, startTransition } from "react";
import { followGoLink } from "../game/links";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import { LandingApp } from "./LandingApp";
import { startErrorReports } from "../boot/errorReport";

// P8: this page's own uncaught errors go to the server (none with no server, as the on-chain copy is built)
startErrorReports();

// a shared link to a game page that had to start here (see links.ts) goes on at once
if (!followGoLink()) {
  // P3: the first render is a transition, so React renders it in short slices and the page answers while it does; the
  // prerendered landing stays on screen until it is ready
  const root = createRoot(document.getElementById("root")!);
  startTransition(() =>
    root.render(
      <StrictMode>
        <LandingApp />
      </StrictMode>,
    ),
  );
}
