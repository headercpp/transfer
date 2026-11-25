import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { startServer, ServerHandle } from "./server";
import { startTunnel, TunnelHandle } from "./tunnel";

function ensureFirewallRule(port: number) {
  const name = `Transfer App ${port}`;
  const check = `netsh advfirewall firewall show rule name="${name}"`;
  exec(check, (err, stdout) => {
    if (!err && stdout && stdout.includes(String(port))) return;
    const add = `netsh advfirewall firewall add rule name="${name}" dir=in action=allow protocol=TCP localport=${port}`;
    exec(add, () => {});
  });
}

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;
let server: ServerHandle | null = null;
let tunnel: TunnelHandle | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 920,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    transparent: false,
    backgroundColor: "#0f0f10",
    hasShadow: true,
    roundedCorners: false,
    show: false,
    paintWhenInitiallyHidden: true,
    title: "Transfer",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
}

function broadcast(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

app.whenReady().then(async () => {
  const downloadsDir = path.join(app.getPath("downloads"), "Transfer");
  if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

  const mobileRoot = isDev
    ? path.join(__dirname, "..", "mobile")
    : path.join(process.resourcesPath, "mobile");

  server = await startServer({
    mobileRoot,
    saveDir: downloadsDir,
    onEvent: (evt) => broadcast("transfer:event", evt),
  });

  ensureFirewallRule(server.port);

  createWindow();

  tunnel = await startTunnel(server.port, (h) => {
    broadcast("tunnel:status", { status: h.status, publicUrl: h.publicUrl, error: h.error });
  });

  ipcMain.handle("server:info", () => ({
    url: server!.url,
    ip: server!.ip,
    port: server!.port,
    saveDir: downloadsDir,
    tunnel: tunnel ? { status: tunnel.status, publicUrl: tunnel.publicUrl, error: tunnel.error } : null,
  }));

  ipcMain.handle("app:open-folder", async (_e, p: string) => { shell.openPath(p); });

  ipcMain.handle("app:pick-and-send", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ["openFile", "multiSelections"] });
    if (result.canceled || !result.filePaths.length) return [];
    return result.filePaths.map((p) => server!.enqueueOutgoing(p));
  });

  ipcMain.handle("app:send-paths", async (_e, paths: string[]) => {
    const added: string[] = [];
    for (const p of paths) if (fs.existsSync(p)) added.push(server!.enqueueOutgoing(p));
    return added;
  });

  ipcMain.handle("app:save-text", async (_e, text: string, defaultName: string) => {
    const r = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: (defaultName || "texto").replace(/[/\\?%*:|"<>]/g, "_").slice(0, 60) + ".txt",
      filters: [{ name: "Texto", extensions: ["txt"] }],
    });
    if (r.canceled || !r.filePath) return null;
    await fs.promises.writeFile(r.filePath, text, "utf8");
    return r.filePath;
  });

  ipcMain.handle("app:save-file-copy", async (_e, sourcePath: string, name: string) => {
    if (!sourcePath || !fs.existsSync(sourcePath)) return null;
    const r = await dialog.showSaveDialog(mainWindow!, { defaultPath: name });
    if (r.canceled || !r.filePath) return null;
    await fs.promises.copyFile(sourcePath, r.filePath);
    return r.filePath;
  });

  ipcMain.handle("app:send-text", async (_e, text: string) => {
    if (typeof text === "string" && text.trim()) return server!.enqueueText(text);
    return null;
  });

  ipcMain.handle("app:get-devices", () => server!.getDevices());

  setInterval(() => broadcast("transfer:devices", server!.getDevices()), 3000);

  ipcMain.handle("win:minimize", () => mainWindow?.minimize());
  ipcMain.handle("win:maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  });
  ipcMain.handle("win:close", () => mainWindow?.close());
});

app.on("window-all-closed", () => {
  if (tunnel) tunnel.stop();
  if (server) server.close();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
