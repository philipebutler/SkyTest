import { contextBridge, ipcRenderer } from "electron";
import type { IpcChannel } from "../shared/types";

/** Channels that the renderer is allowed to listen on (pushed from main). */
const ALLOWED_LISTEN_CHANNELS = ["chat:stream", "chat:executionError"] as const;
type ListenChannel = (typeof ALLOWED_LISTEN_CHANNELS)[number];

contextBridge.exposeInMainWorld("skytest", {
  invoke: (channel: IpcChannel, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),

  /**
   * Register a listener for a main-process push event (e.g. chat:stream).
   * Returns an unsubscribe function.
   */
  on: (
    channel: ListenChannel,
    listener: (...args: unknown[]) => void
  ): (() => void) => {
    if (!(ALLOWED_LISTEN_CHANNELS as readonly string[]).includes(channel)) {
      throw new Error(`[preload] Blocked attempt to listen on channel: ${channel}`);
    }
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.off(channel, wrapped);
  },
});
