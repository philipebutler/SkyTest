import { contextBridge, ipcRenderer } from "electron";
import type { IpcChannel } from "../shared/types";

contextBridge.exposeInMainWorld("skytest", {
  invoke: (channel: IpcChannel, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),
});
