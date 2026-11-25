import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { spawn, ChildProcess } from "child_process";
import { app } from "electron";

const CLOUDFLARED_URL =
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";

export interface TunnelHandle {
  publicUrl: string | null;
  status: "starting" | "ready" | "error" | "disabled";
  error?: string;
  stop: () => void;
  onChange: (cb: (h: TunnelHandle) => void) => () => void;
}

function downloadFile(url: string, dest: string, onProgress?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Transfer-App" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, dest, onProgress).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let received = 0;
      const ws = fs.createWriteStream(dest);
      res.on("data", (chunk) => {
        received += chunk.length;
        if (total && onProgress) onProgress(received / total);
      });
      res.pipe(ws);
      ws.on("finish", () => ws.close(() => resolve()));
      ws.on("error", reject);
    });
    req.on("error", reject);
  });
}

async function ensureCloudflared(onProgress?: (pct: number) => void): Promise<string> {
  const dir = path.join(app.getPath("userData"), "bin");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, "cloudflared.exe");
  if (fs.existsSync(bin) && fs.statSync(bin).size > 1_000_000) return bin;
  const tmp = bin + ".tmp";
  await downloadFile(CLOUDFLARED_URL, tmp, onProgress);
  fs.renameSync(tmp, bin);
  return bin;
}

export async function startTunnel(
  localPort: number,
  onChange: (h: TunnelHandle) => void
): Promise<TunnelHandle> {
  const subscribers = new Set<(h: TunnelHandle) => void>([onChange]);
  let child: ChildProcess | null = null;

  const state: TunnelHandle = {
    publicUrl: null,
    status: "starting",
    stop: () => {
      if (child && !child.killed) { try { child.kill(); } catch {} }
    },
    onChange: (cb) => { subscribers.add(cb); return () => subscribers.delete(cb); },
  };

  const emit = () => subscribers.forEach((cb) => cb(state));

  try {
    const bin = await ensureCloudflared();
    child = spawn(bin, ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--no-autoupdate"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const handleData = (buf: Buffer) => {
      const text = buf.toString();
      const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (m && state.status !== "ready") {
        state.publicUrl = m[0];
        state.status = "ready";
        emit();
      }
    };
    child.stdout?.on("data", handleData);
    child.stderr?.on("data", handleData);

    child.on("exit", (code) => {
      if (state.status !== "ready") {
        state.status = "error";
        state.error = `cloudflared saiu (codigo ${code})`;
        emit();
      }
    });

    setTimeout(() => {
      if (state.status === "starting") {
        state.status = "error";
        state.error = "Timeout aguardando túnel";
        emit();
      }
    }, 20_000);

    return state;
  } catch (e: any) {
    state.status = "error";
    state.error = e?.message || String(e);
    emit();
    return state;
  }
}
