import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import { HandheldApp } from "./HandheldApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HandheldApp />
  </StrictMode>,
);
