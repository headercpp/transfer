import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  getServerInfo: () => ipcRenderer.invoke("server:info"),
  openFolder: (p: string) => ipcRenderer.invoke("app:open-folder", p),
  pickAndSend: () => ipcRenderer.invoke("app:pick-and-send"),
  sendPaths: (paths: string[]) => ipcRenderer.invoke("app:send-paths", paths),
  sendText: (text: string) => ipcRenderer.invoke("app:send-text", text),
  saveText: (text: string, name: string) => ipcRenderer.invoke("app:save-text", text, name),
  saveFileCopy: (sourcePath: string, name: string) => ipcRenderer.invoke("app:save-file-copy", sourcePath, name),
  getDevices: () => ipcRenderer.invoke("app:get-devices"),
  onEvent: (cb: (evt: any) => void) => {
    const listener = (_e: unknown, evt: any) => cb(evt);
    ipcRenderer.on("transfer:event", listener);
    return () => ipcRenderer.removeListener("transfer:event", listener);
  },
  onDevices: (cb: (devs: any[]) => void) => {
    const listener = (_e: unknown, devs: any[]) => cb(devs);
    ipcRenderer.on("transfer:devices", listener);
    return () => ipcRenderer.removeListener("transfer:devices", listener);
  },
  onTunnel: (cb: (s: any) => void) => {
    const listener = (_e: unknown, s: any) => cb(s);
    ipcRenderer.on("tunnel:status", listener);
    return () => ipcRenderer.removeListener("tunnel:status", listener);
  },
  win: {
    minimize: () => ipcRenderer.invoke("win:minimize"),
    maximize: () => ipcRenderer.invoke("win:maximize"),
    close: () => ipcRenderer.invoke("win:close"),
  },
});
