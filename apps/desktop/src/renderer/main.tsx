import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { setupI18n } from "./i18n";
import { useAppStore } from "./store";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "./styles/global.css";

// 首次渲染前用持久化语言初始化 i18next。
setupI18n(useAppStore.getState().locale);

// 把异步崩溃打到终端，Electron main 会转发日志。
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
