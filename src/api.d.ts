export interface TunnelStatus {
  status: "starting" | "ready" | "error" | "disabled";
  publicUrl: string | null;
  error?: string;
}

export interface ServerInfo {
  url: string;
  ip: string;
  port: number;
  saveDir: string;
  tunnel: TunnelStatus | null;
}

export interface TransferEvent {
  type: "queued" | "sent" | "received" | "text-queued" | "text-sent" | "text-received";
  id?: string;
  name?: string;
  size?: number;
  path?: string;
  text?: string;
}

export interface Device {
  ip: string;
  ua: string;
  lastSeen: number;
}

declare global {
  interface Window {
    api: {
      getServerInfo: () => Promise<ServerInfo>;
      openFolder: (p: string) => Promise<void>;
      pickAndSend: () => Promise<string[]>;
      sendPaths: (paths: string[]) => Promise<string[]>;
      sendText: (text: string) => Promise<string | null>;
      saveText: (text: string, name: string) => Promise<string | null>;
      saveFileCopy: (sourcePath: string, name: string) => Promise<string | null>;
      getDevices: () => Promise<Device[]>;
      onEvent: (cb: (evt: TransferEvent) => void) => () => void;
      onDevices: (cb: (devs: Device[]) => void) => () => void;
      onTunnel: (cb: (s: TunnelStatus) => void) => () => void;
      win: {
        minimize: () => Promise<void>;
        maximize: () => Promise<void>;
        close: () => Promise<void>;
      };
    };
  }
}
