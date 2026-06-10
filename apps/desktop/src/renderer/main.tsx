import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { setupI18n } from "./i18n";
import { useAppStore } from "./store";
import "./styles/global.css";

// Seed i18next with the persisted locale before the first render.
setupI18n(useAppStore.getState().locale);

// Surface async crashes in the terminal (forwarded by the Electron main process).
window.addEventListener("unhandledrejection", (event) => {
  console.error("[renderer] 未处理的 Promise 异常:", event.reason);
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
