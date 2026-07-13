import type { C2S, S2C } from '@tongmu/shared';

export type WsEvent = S2C | { t: 'ws_open' } | { t: 'ws_close' };
type Handler = (msg: WsEvent) => void;

/**
 * 全局唯一的 WebSocket 客户端：自动重连（指数退避），
 * 订阅者收到所有服务器消息以及 ws_open / ws_close 连接事件。
 * 重连后的 resume 由业务层（useRoom）负责。
 */
class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  /** 断线期间的待发消息，重连后按序补发（防止用户操作静默丢失） */
  private sendQueue: C2S[] = [];

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** 幂等：已连接则直接触发 ws_open 方便新订阅者初始化 */
  connect(): void {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      if (this.isOpen) this.emit({ t: 'ws_open' });
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      // 先 emit ws_open（业务层借此发 resume 恢复会话），再补发排队消息，保证顺序正确
      this.emit({ t: 'ws_open' });
      const queued = this.sendQueue;
      this.sendQueue = [];
      for (const msg of queued) this.send(msg);
    };
    ws.onmessage = (ev) => {
      try {
        this.emit(JSON.parse(ev.data as string) as S2C);
      } catch {
        // 忽略非法消息
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.emit({ t: 'ws_close' });
      if (this.wanted) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  disconnect(): void {
    this.wanted = false;
    this.sendQueue = [];
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  send(msg: C2S): void {
    if (this.isOpen) {
      this.ws!.send(JSON.stringify(msg));
      return;
    }
    // ping/心跳是周期消息，过期无意义，不入队；其余排队等重连补发
    if (msg.t === 'ping' || msg.t === 'playback_heartbeat') return;
    if (this.wanted && this.sendQueue.length < 50) this.sendQueue.push(msg);
  }

  on(fn: Handler): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  private emit(msg: WsEvent): void {
    for (const fn of [...this.handlers]) fn(msg);
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.retry, 10_000);
    this.retry += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

export const wsClient = new WsClient();

// ---------------------------------------------------------------------------
// 房间会话的本地持久化（sessionStorage，标签页维度）
// ---------------------------------------------------------------------------

export interface StoredSession {
  roomCode: string;
  sessionToken: string;
  selfId: string;
  nickname: string;
}

const SESSION_KEY = (code: string) => `tongmu:session:${code.toUpperCase()}`;

export function saveSession(s: StoredSession): void {
  sessionStorage.setItem(SESSION_KEY(s.roomCode), JSON.stringify(s));
}

export function loadSession(roomCode: string): StoredSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY(roomCode));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession(roomCode: string): void {
  sessionStorage.removeItem(SESSION_KEY(roomCode));
}
