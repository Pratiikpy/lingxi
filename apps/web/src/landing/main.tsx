import { StrictMode } from "react";
import { followGoLink } from "../game/links";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import { LandingApp } from "./LandingApp";

// a shared link to a game page that had to start here (see links.ts) goes on at once
if (!followGoLink()) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <LandingApp />
    </StrictMode>,
  );
}
