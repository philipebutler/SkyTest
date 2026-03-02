import { app, BrowserWindow, ipcMain, session } from "electron";
import * as path from "path";
import { registerIpcHandlers } from "./ipc/handlers";
import { StorageService } from "./storage/StorageService";

// Runtime check — works regardless of which webpack mode built this bundle.
const isDev = !app.isPackaged;

function setupCSP(): void {
  const devCSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' ws://localhost:3000",
  ].join("; ");

  const prodCSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [isDev ? devCSP : prodCSP],
      },
    });
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "SkyTest – Playwright Chat Runner",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:3000");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  // Issue #2: Initialise file system layout before registering IPC handlers.
  StorageService.init();
  registerIpcHandlers(ipcMain);
  setupCSP();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
