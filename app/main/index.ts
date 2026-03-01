import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import { registerIpcHandlers } from "./ipc/handlers";
import { StorageService } from "./storage/StorageService";

const isDev = process.env.NODE_ENV === "development";

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
