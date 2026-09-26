import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import AppRoot from "./AppRoot.tsx";
import { initPlatformBodyClasses } from "./lib/platform.ts";
import "./index.css";

initPlatformBodyClasses();

const Root = import.meta.env.VITE_PUBLIC_VIEW === "1" ? App : AppRoot;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Offline app shell could not be enabled.", error);
    });
  });
}
