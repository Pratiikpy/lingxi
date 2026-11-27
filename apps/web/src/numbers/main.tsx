import "../boot/staleBuild";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import "../verify/verify.css";
import { startErrorReports } from "../boot/errorReport";

// P8: this page's own uncaught errors go to the server (none with no server, as the on-chain copy is built)
startErrorReports();

const root = createRoot(document.getElementById("root")!);

// R43: the page's own code (its reads of the server and the words of its figures) is a module of its own, run in a task
// after React's, so a slow phone runs the two as two shorter tasks rather than one long one (both are preloaded with
// the page, vite.config.ts PRELOADED). P3: the first render is a transition, so React renders it in short slices and
// the page answers while it does
void new Promise((next) => setTimeout(next, 0))
  .then(() => import("./NumbersApp"))
  .then(({ NumbersApp }) =>
    startTransition(() =>
      root.render(
        <StrictMode>
          <NumbersApp />
        </StrictMode>,
      ),
    ),
  );
