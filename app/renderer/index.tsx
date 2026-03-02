import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Global error handler — renders errors visibly in the window so they're not
// silently swallowed (helps diagnose blank-screen issues).
window.addEventListener("error", (event) => {
  showFatalError(`Uncaught: ${event.message}\n\n${event.filename}:${event.lineno}`);
});
window.addEventListener("unhandledrejection", (event) => {
  showFatalError(`Unhandled promise rejection: ${event.reason}`);
});

function showFatalError(msg: string): void {
  const el = document.getElementById("root");
  if (el) {
    el.innerHTML = `<pre style="color:#ff6b6b;background:#1e1e1e;padding:2rem;font-size:14px;white-space:pre-wrap;font-family:monospace">${msg}</pre>`;
  }
}

try {
  const container = document.getElementById("root");
  if (!container) throw new Error("Root element not found");

  // Show loading indicator while React mounts
  container.innerHTML = '<div style="color:#888;padding:2rem">Loading SkyTest…</div>';

  const root = createRoot(container);
  root.render(<App />);
} catch (err) {
  showFatalError(`Failed to mount React:\n${err instanceof Error ? err.stack || err.message : String(err)}`);
}
