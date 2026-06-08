import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setupI18n } from "./i18n";
import { useAppStore } from "./store";
import "./styles/global.css";

// Seed i18next with the persisted locale before the first render.
setupI18n(useAppStore.getState().locale);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
