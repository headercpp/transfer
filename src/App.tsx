import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import QRCode from "qrcode";
import type { ServerInfo, TransferEvent, Device, TunnelStatus } from "./api";

type HistoryItem = {
  id: string;
  kind: "file" | "text";
  direction: "sent" | "received";
  name: string;
  size?: number;
  text?: string;
  at: number;
  path?: string;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function deviceName(ua: string): string {
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua)) {
    const m = ua.match(/;\s*([^;)]+?Build)/i);
    if (m) return m[1].replace(/\s*Build.*/, "").trim();
    return "Android";
  }
  if (/mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  return "Dispositivo";
}

export default function App() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [qr, setQr] = useState<string>("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [queued, setQueued] = useState<{ id: string; name: string; size: number }[]>([]);
  const [queuedText, setQueuedText] = useState<{ id: string; text: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [textInput, setTextInput] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [mode, setMode] = useState<"local" | "internet">("internet");

  useEffect(() => { document.documentElement.dataset.theme = "dark"; }, []);

  useEffect(() => {
    window.api.getServerInfo().then((i) => {
      setInfo(i);
      if (i.tunnel) setTunnel(i.tunnel);
    });
    window.api.getDevices().then(setDevices);
    const offD = window.api.onDevices(setDevices);
    const offT = window.api.onTunnel(setTunnel);
    return () => { offD(); offT(); };
  }, []);

  const activeUrl = useMemo(() => {
    if (mode === "internet" && tunnel?.status === "ready" && tunnel.publicUrl) return tunnel.publicUrl;
    return info?.url || "";
  }, [mode, tunnel, info]);

  useEffect(() => {
    if (!activeUrl) return;
    QRCode.toDataURL(activeUrl, {
      width: 280,
      margin: 1,
      color: { dark: "#f2f2f2", light: "#00000000" },
    }).then(setQr);
  }, [activeUrl]);

  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    const playReceiveSound = () => {
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const ctx = audioCtx;
        const now = ctx.currentTime;
        const playNote = (freq: number, start: number, dur: number, peak: number) => {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + start);
          g.gain.setValueAtTime(0, now + start);
          g.gain.linearRampToValueAtTime(peak, now + start + 0.25);
          g.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
          osc.connect(g); g.connect(ctx.destination);
          osc.start(now + start); osc.stop(now + start + dur + 0.05);
        };
        playNote(523.25, 0, 1.3, 0.012);
        playNote(659.25, 0.35, 1.2, 0.010);
      } catch {}
    };

    const off = window.api.onEvent((evt: TransferEvent) => {
      if (evt.type === "received" || evt.type === "text-received") playReceiveSound();
      if (evt.type === "queued") {
        setQueued((q) => [...q, { id: evt.id!, name: evt.name!, size: evt.size! }]);
      } else if (evt.type === "sent") {
        setQueued((q) => q.filter((x) => x.id !== evt.id));
        setHistory((h) => [{
          id: evt.id!, kind: "file", direction: "sent",
          name: evt.name!, size: evt.size!, at: Date.now(),
        }, ...h]);
      } else if (evt.type === "received") {
        setHistory((h) => [{
          id: Math.random().toString(36).slice(2),
          kind: "file", direction: "received",
          name: evt.name!, size: evt.size!, path: evt.path, at: Date.now(),
        }, ...h]);
      } else if (evt.type === "text-queued") {
        setQueuedText((q) => [...q, { id: evt.id!, text: evt.text! }]);
      } else if (evt.type === "text-sent") {
        setQueuedText((q) => q.filter((x) => x.id !== evt.id));
        setHistory((h) => [{
          id: evt.id!, kind: "text", direction: "sent",
          name: evt.text!.slice(0, 80), text: evt.text, at: Date.now(),
        }, ...h]);
      } else if (evt.type === "text-received") {
        setHistory((h) => [{
          id: Math.random().toString(36).slice(2),
          kind: "text", direction: "received",
          name: evt.text!.slice(0, 80), text: evt.text, at: Date.now(),
        }, ...h]);
      }
    });
    return () => off();
  }, []);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const paths: string[] = [];
    for (const f of Array.from(e.dataTransfer.files)) {
      // @ts-ignore electron adds path
      if (f.path) paths.push(f.path);
    }
    if (paths.length) await window.api.sendPaths(paths);
  };

  const sendText = async () => {
    if (!textInput.trim()) return;
    await window.api.sendText(textInput);
    setTextInput("");
  };

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };

  const stats = useMemo(() => {
    const sentFiles = history.filter((h) => h.kind === "file" && h.direction === "sent");
    const recvFiles = history.filter((h) => h.kind === "file" && h.direction === "received");
    const sentBytes = sentFiles.reduce((a, b) => a + (b.size || 0), 0);
    const recvBytes = recvFiles.reduce((a, b) => a + (b.size || 0), 0);
    const texts = history.filter((h) => h.kind === "text").length;
    return { sentCount: sentFiles.length, recvCount: recvFiles.length, sentBytes, recvBytes, texts };
  }, [history]);

  const pending = queued.length + queuedText.length;

  return (
    <div className="app">
      <header className="titlebar">
        <div className="app-name">Transfer</div>

        <div className="spacer" />

        {info && (
          <div className="ip-pill" data-tip={mode === "internet" ? "Túnel seguro pela internet" : "Servidor ativo na rede local"}>
            <span className="ip-cc">{mode === "internet" ? "NET" : "LAN"}</span>
            {mode === "local" && <span className="ip-loc">{info.ip}:{info.port}</span>}
            <span className="ip-weather">
              <span className="pulse" />
              {mode === "internet" && tunnel?.status === "starting"
                ? "conectando"
                : mode === "internet" && tunnel?.status === "error"
                ? "falhou"
                : devices.length > 0
                ? `${devices.length} conectado${devices.length > 1 ? "s" : ""}`
                : "online"}
            </span>
          </div>
        )}

        <div className="win-ctrls">
          <button className="wc min" onClick={() => window.api.win.minimize()} data-tip="Minimizar" aria-label="Minimizar">
            <svg viewBox="0 0 12 12"><path d="M2 6 L10 6" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <button className="wc max" onClick={() => window.api.win.maximize()} data-tip="Maximizar" aria-label="Maximizar">
            <svg viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.1" /></svg>
          </button>
          <button className="wc close" onClick={() => window.api.win.close()} data-tip="Fechar" aria-label="Fechar">
            <svg viewBox="0 0 12 12"><path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
          </button>
        </div>
      </header>

      <div className="stats-row">
        <div className="stat">
          <div className="stat-label">Enviados</div>
          <div className="stat-value">{stats.sentCount}<span className="stat-sub">{formatSize(stats.sentBytes)}</span></div>
        </div>
        <div className="stat">
          <div className="stat-label">Recebidos</div>
          <div className="stat-value">{stats.recvCount}<span className="stat-sub">{formatSize(stats.recvBytes)}</span></div>
        </div>
        <div className="stat">
          <div className="stat-label">Textos</div>
          <div className="stat-value">{stats.texts}<span className="stat-sub">mensagens</span></div>
        </div>
        <div className="stat">
          <div className="stat-label">Na fila</div>
          <div className="stat-value">{pending}<span className="stat-sub">aguardando</span></div>
        </div>
      </div>

      <main className="body">
        <section className="card qr-card">
          <div className="card-head">
            <h2>Conectar</h2>
            <p className="muted">Escaneie o QR com a câmera do celular.</p>
          </div>

          <div className="mode-switch">
            <button
              className={`mode-btn ${mode === "internet" ? "on" : ""}`}
              onClick={() => setMode("internet")}
              data-tip="Funciona em qualquer rede"
            >
              Internet
            </button>
            <button
              className={`mode-btn ${mode === "local" ? "on" : ""}`}
              onClick={() => setMode("local")}
              data-tip="Mesma rede Wi-Fi (mais rápido)"
            >
              Rede local
            </button>
          </div>

          <div className="qr-wrap">
            {qr ? (
              <img src={qr} alt="QR code" />
            ) : (
              <div className="qr-loading">
                {mode === "internet" ? "Conectando ao túnel..." : "Preparando..."}
              </div>
            )}
          </div>

          {mode === "internet" && tunnel?.status === "starting" && (
            <div className="tunnel-hint">Baixando túnel seguro na primeira vez...</div>
          )}
          {mode === "internet" && tunnel?.status === "error" && (
            <div className="tunnel-hint err">Túnel falhou. Use "Rede local" ou reinicie o app.</div>
          )}

          <div className="devices">
            <div className="devices-head">
              <span>Dispositivos</span>
              <span className="devices-count">{devices.length}</span>
            </div>
            {devices.length === 0 ? (
              <div className="devices-empty">Nenhum celular conectado ainda.</div>
            ) : (
              <ul>
                {devices.map((d) => (
                  <li key={d.ip}>
                    <span className="dev-dot" />
                    <span className="dev-name">{deviceName(d.ua)}</span>
                    <span className="dev-ip">{d.ip}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="middle-col">
          <section
            className={`card drop-card ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <div className="card-head">
              <h2>Arquivos pro celular</h2>
              <p className="muted">Arraste aqui ou escolha abaixo.</p>
            </div>

            <button className="cta" onClick={() => window.api.pickAndSend()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Escolher arquivos
            </button>

            {queued.length > 0 && (
              <div className="pending">
                <div className="pending-head">
                  <span className="pending-count">{queued.length}</span> aguardando o celular baixar
                </div>
                <ul>
                  <AnimatePresence initial={false}>
                    {queued.map((q) => (
                      <motion.li key={q.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 8 }}>
                        <span className="name">{q.name}</span>
                        <span className="size">{formatSize(q.size)}</span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            )}
          </section>

          <section className="card text-card">
            <div className="card-head">
              <h2>Texto ou link</h2>
              <p className="muted">Mande senha, código SMS, URL — qualquer coisa.</p>
            </div>
            <textarea
              className="text-input"
              placeholder="Cole ou digite aqui..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendText();
              }}
            />
            <div className="text-actions">
              <span className="text-hint">Ctrl+Enter pra enviar</span>
              <button className="cta small" onClick={sendText} disabled={!textInput.trim()}>
                Enviar
              </button>
            </div>

            {queuedText.length > 0 && (
              <div className="pending">
                <div className="pending-head">
                  <span className="pending-count">{queuedText.length}</span> texto{queuedText.length > 1 ? "s" : ""} na fila
                </div>
                <ul>
                  {queuedText.map((t) => (
                    <li key={t.id}>
                      <span className="name text-preview">{t.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        <section className="card history-card">
          <div className="card-head row">
            <div>
              <h2>Histórico</h2>
              <p className="muted">
                Salvo em <span className="path-inline">{info?.saveDir.split(/[/\\]/).slice(-2).join("\\")}</span>
              </p>
            </div>
            {info && (
              <button className="link" onClick={() => window.api.openFolder(info.saveDir)}>
                Abrir pasta
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </div>
              <p>Nada ainda.</p>
              <span className="muted">As transferências aparecem aqui.</span>
            </div>
          ) : (
            <ul className="history">
              <AnimatePresence initial={false}>
                {history.map((h) => (
                  <motion.li key={h.id}
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className={`row ${h.direction} ${h.kind}`}>
                    <div className="row-icon">
                      {h.kind === "text" ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                      ) : h.direction === "sent" ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="19" x2="12" y2="5"/>
                          <polyline points="5 12 12 5 19 12"/>
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19"/>
                          <polyline points="19 12 12 19 5 12"/>
                        </svg>
                      )}
                    </div>
                    <div className="row-body">
                      <div className="row-name">{h.name}</div>
                      <div className="row-meta">
                        {h.kind === "text" ? "texto" : (h.direction === "sent" ? "enviado" : "recebido")}
                        {h.size !== undefined && ` · ${formatSize(h.size)}`}
                        {" · "}{formatTime(h.at)}
                      </div>
                    </div>
                    <div className="row-actions">
                      {h.kind === "text" && (
                        <>
                          <button className="row-action" onClick={() => copy(h.text!, h.id)} data-tip={copied === h.id ? "Copiado" : "Copiar"}>
                            {copied === h.id ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                              </svg>
                            )}
                          </button>
                          <button className="row-action" onClick={() => {
                            const d = new Date(h.at);
                            const pad = (n: number) => String(n).padStart(2, "0");
                            const name = `transfer-${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
                            window.api.saveText(h.text!, name);
                          }} data-tip="Salvar como .txt">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                              <polyline points="17 21 17 13 7 13 7 21"/>
                              <polyline points="7 3 7 8 15 8"/>
                            </svg>
                          </button>
                        </>
                      )}
                      {h.kind === "file" && h.direction === "received" && h.path && (
                        <button className="row-action" onClick={() => window.api.saveFileCopy(h.path!, h.name)} data-tip="Salvar em outra pasta">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                            <polyline points="17 21 17 13 7 13 7 21"/>
                            <polyline points="7 3 7 8 15 8"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
