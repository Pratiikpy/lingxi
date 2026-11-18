import "../boot/staleBuild";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import "../verify/verify.css";
import { AgentsApp } from "./AgentsApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AgentsApp />
  </StrictMode>,
);
