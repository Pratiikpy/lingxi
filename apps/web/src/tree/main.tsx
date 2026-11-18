import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import "../verify/verify.css";
import { TreeApp } from "./TreeApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TreeApp />
  </StrictMode>,
);
