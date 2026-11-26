import "../boot/staleBuild";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import "../verify/verify.css";
import "./info.css";
import { InfoApp } from "./InfoApp";
import { startErrorReports } from "../boot/errorReport";

// P8: this page's own uncaught errors go to the server (none with no server, as the on-chain copy is built)
startErrorReports();

// P6: privacy.html and terms.html are one small app; the page says which it is
const kind = document.body.dataset.page === "terms" ? "terms" : "privacy";
const root = createRoot(document.getElementById("root")!);
startTransition(() =>
  root.render(
    <StrictMode>
      <InfoApp kind={kind} />
    </StrictMode>,
  ),
);
