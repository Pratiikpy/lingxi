import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/pixelify-sans";
import "@fontsource-variable/baloo-2";
import "../styles/tokens.css";
import { startTelegram } from "../game/telegram";
import { receivePets } from "../game/move";

startTelegram();
// pets arriving from Telegram or another browser land before the game reads its save
void receivePets().then(async () => {
  const { PlayApp } = await import("./PlayApp");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PlayApp />
    </StrictMode>,
  );
});
