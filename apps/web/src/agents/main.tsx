import "../boot/staleBuild";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import "../verify/verify.css";
import { AgentsApp } from "./AgentsApp";
import { startErrorReports } from "../boot/errorReport";

// P8: this page's own uncaught errors go to the server (none with no server, as the on-chain copy is built)
startErrorReports();

// P3: the first render is a transition, so React renders it in short slices and the page answers while it does
const root = createRoot(document.getElementById("root")!);
startTransition(() =>
  root.render(
    <StrictMode>
      <AgentsApp />
    </StrictMode>,
  ),
);
