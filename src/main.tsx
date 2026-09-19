/**
 * Entry point. Styles first, then the app; the boot sequence itself lives in
 * src/app/boot.ts and runs inside <App/> so its failures can be drawn.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/app.css";
import { App } from "@/app/App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("index.html is missing the #root element.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
