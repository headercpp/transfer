import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

export interface ServerHandle {
  url: string;
  ip: string;
  port: number;
  close: () => void;
  enqueueOutgoing: (filePath: string) => string;
  enqueueText: (text: string) => string;
  getDevices: () => DeviceInfo[];
}

interface OutgoingFile {
  id: string;
  path: string;
  name: string;
  size: number;
  mime: string;
  claimed: boolean;
}

interface TextItem {
  id: string;
  text: string;
  at: number;
  claimed: boolean;
}

interface DeviceInfo {
  ip: string;
  ua: string;
  lastSeen: number;
}

interface StartOpts {
  mobileRoot: string;
  saveDir: string;
  onEvent: (evt: any) => void;
}

function getLocalIp(): string {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name] || []) {
      if (n.family === "IPv4" && !n.internal) return n.address;
    }
  }
  return "127.0.0.1";
}

function mimeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
    ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8",
    ".zip": "application/zip", ".ico": "image/x-icon",
  };
  return map[ext] || "application/octet-stream";
}

function serveStatic(root: string, req: http.IncomingMessage, res: http.ServerResponse) {
  let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(root, urlPath);
  if (!filePath.startsWith(root)) { res.writeHead(403); res.end("Forbidden"); return; }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    res.writeHead(200, {
      "Content-Type": mimeFor(filePath),
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function sanitizeName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 200) || "arquivo";
}

function uniquePath(dir: string, name: string): string {
  const safe = sanitizeName(name);
  let p = path.join(dir, safe);
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  let i = 1;
  while (fs.existsSync(p)) {
    p = path.join(dir, `${base} (${i})${ext}`);
    i++;
  }
  return p;
}

function parseMultipart(req: http.IncomingMessage, onFile: (name: string, stream: NodeJS.ReadableStream) => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ct = req.headers["content-type"] || "";
    const m = /boundary=(?:"?)([^";]+)/.exec(ct);
    if (!m) { reject(new Error("no boundary")); return; }
    const boundary = Buffer.from(`--${m[1]}`);
    const chunks: Buffer[] = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", async () => {
      const buf = Buffer.concat(chunks);
      try {
        let idx = 0;
        while (true) {
          const start = buf.indexOf(boundary, idx);
          if (start < 0) break;
          const after = start + boundary.length;
          if (buf[after] === 0x2d && buf[after + 1] === 0x2d) break;
          const headerEnd = buf.indexOf("\r\n\r\n", after);
          if (headerEnd < 0) break;
          const header = buf.slice(after, headerEnd).toString("utf8");
          const nameMatch = /filename="([^"]+)"/.exec(header);
          const partStart = headerEnd + 4;
          const partEnd = buf.indexOf(boundary, partStart) - 2;
          if (partEnd < partStart) break;
          const partBody = buf.slice(partStart, partEnd);
          if (nameMatch) {
            const { Readable } = await import("stream");
            await onFile(nameMatch[1], Readable.from(partBody));
          }
          idx = partEnd;
        }
        resolve();
      } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startServer(opts: StartOpts): Promise<ServerHandle> {
  const outgoing = new Map<string, OutgoingFile>();
  const outgoingText = new Map<string, TextItem>();
  const devices = new Map<string, DeviceInfo>();
  const ip = getLocalIp();

  const touchDevice = (req: http.IncomingMessage) => {
    const raw = req.socket.remoteAddress || "";
    const addr = raw.replace(/^::ffff:/, "");
    if (!addr || addr === ip || addr.startsWith("127.") || addr === "::1") return;
    const ua = (req.headers["user-agent"] || "").toString().slice(0, 200);
    devices.set(addr, { ip: addr, ua, lastSeen: Date.now() });
  };

  const server = http.createServer(async (req, res) => {
    const url = req.url || "/";
    const method = req.method || "GET";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    touchDevice(req);

    if (url === "/api/list") {
      const list = [...outgoing.values()].filter((f) => !f.claimed)
        .map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime }));
      const texts = [...outgoingText.values()].filter((t) => !t.claimed)
        .map((t) => ({ id: t.id, text: t.text, at: t.at }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ files: list, texts }));
      return;
    }

    if (url.startsWith("/api/download/") && method === "GET") {
      const id = url.split("/").pop()!;
      const f = outgoing.get(id);
      if (!f || !fs.existsSync(f.path)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        "Content-Type": f.mime,
        "Content-Length": f.size,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(f.name)}"`,
      });
      const stream = fs.createReadStream(f.path);
      stream.pipe(res);
      stream.on("end", () => {
        f.claimed = true;
        opts.onEvent({ type: "sent", id: f.id, name: f.name, size: f.size });
        setTimeout(() => outgoing.delete(f.id), 60_000);
      });
      return;
    }

    if (url.startsWith("/api/text/claim/") && method === "POST") {
      const id = url.split("/").pop()!;
      const t = outgoingText.get(id);
      if (t) {
        t.claimed = true;
        opts.onEvent({ type: "text-sent", id: t.id, text: t.text });
        setTimeout(() => outgoingText.delete(t.id), 60_000);
      }
      res.writeHead(200); res.end();
      return;
    }

    if (url === "/api/upload" && method === "POST") {
      try {
        await parseMultipart(req, async (name, stream) => {
          const outPath = uniquePath(opts.saveDir, name);
          await new Promise<void>((resolve, reject) => {
            const ws = fs.createWriteStream(outPath);
            stream.pipe(ws);
            ws.on("finish", () => resolve());
            ws.on("error", reject);
          });
          const st = fs.statSync(outPath);
          opts.onEvent({ type: "received", name: path.basename(outPath), size: st.size, path: outPath });
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) {
        res.writeHead(500); res.end(e?.message || "erro");
      }
      return;
    }

    if (url === "/api/text" && method === "POST") {
      try {
        const body = await readBody(req);
        let text = "";
        try { text = JSON.parse(body).text || ""; } catch { text = body; }
        if (text) opts.onEvent({ type: "text-received", text });
        res.writeHead(200); res.end();
      } catch (e: any) {
        res.writeHead(500); res.end(e?.message || "erro");
      }
      return;
    }

    serveStatic(opts.mobileRoot, req, res);
  });

  const tryListen = (p: number) => new Promise<boolean>((resolve) => {
    const onErr = () => { server.off("error", onErr); resolve(false); };
    server.once("error", onErr);
    server.listen(p, "0.0.0.0", () => { server.off("error", onErr); resolve(true); });
  });

  const candidates = [7373, 7374, 7375, 7676, 8181, 8282, 8383, 9090, 9191];
  let port = 0;
  for (const p of candidates) {
    if (await tryListen(p)) { port = p; break; }
  }
  if (port === 0) {
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", () => resolve()));
    const addr = server.address();
    if (addr && typeof addr === "object") port = addr.port;
  }

  setInterval(() => {
    const now = Date.now();
    for (const [k, d] of devices) if (now - d.lastSeen > 30_000) devices.delete(k);
  }, 10_000);

  return {
    url: `http://${ip}:${port}`,
    ip,
    port,
    close: () => server.close(),
    enqueueOutgoing: (filePath: string) => {
      const name = path.basename(filePath);
      const stat = fs.statSync(filePath);
      const id = crypto.randomBytes(8).toString("hex");
      outgoing.set(id, { id, path: filePath, name, size: stat.size, mime: mimeFor(name), claimed: false });
      opts.onEvent({ type: "queued", id, name, size: stat.size });
      return id;
    },
    enqueueText: (text: string) => {
      const id = crypto.randomBytes(8).toString("hex");
      outgoingText.set(id, { id, text, at: Date.now(), claimed: false });
      opts.onEvent({ type: "text-queued", id, text });
      return id;
    },
    getDevices: () => [...devices.values()],
  };
}
