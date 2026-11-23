import "../boot/staleBuild";
import { StrictMode, startTransition } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import { VerifyApp } from "./VerifyApp";

// P3: the first render is a transition, so React renders it in short slices and the page answers while it does
const root = createRoot(document.getElementById("root")!);
startTransition(() =>
  root.render(
    <StrictMode>
      <VerifyApp />
    </StrictMode>,
  ),
);
