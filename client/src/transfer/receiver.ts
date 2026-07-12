import type { FileFingerprint } from '@tongmu/shared';
import { computeFingerprint, sameFingerprint } from '../file/fingerprint';
import { wsClient } from '../ws';
import { OpfsWriter, readOpfsFile } from './opfs';
import { fetchIceServers, IceQueue, parseChunk, type ControlMessage, type SignalPayload } from './rtc';

export interface ReceiveCallbacks {
  onProgress: (received: number, total: number) => void;
  onDone: (file: File) => void;
  onError: (message: string) => void;
}

/**
 * 观众端 P2P 接收会话：向房主要文件，分块经 DataChannel 收取，
 * Worker 写入 OPFS；断点续传基于 OPFS 已有字节数（分块严格顺序到达）。
 */
export class ReceiveSession {
  private pc: RTCPeerConnection | null = null;
  private ice: IceQueue | null = null;
  private writer = new OpfsWriter();
  private received = 0;
  private finished = false;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(
    private hostId: string,
    private fingerprint: FileFingerprint,
    private cb: ReceiveCallbacks,
  ) {}

  async start(): Promise<void> {
    try {
      const existing = await this.writer.open(this.fingerprint.hash);
      this.received = Math.min(existing, this.fingerprint.size);
      this.cb.onProgress(this.received, this.fingerprint.size);

      if (this.received >= this.fingerprint.size) {
        await this.finish(); // 上次已传完，直接用缓存
        return;
      }

      console.debug('[transfer:recv] start, resume from', this.received);
      const pc = new RTCPeerConnection({ iceServers: await fetchIceServers() });
      this.pc = pc;
      this.ice = new IceQueue(pc);

      const dc = pc.createDataChannel('file');
      dc.binaryType = 'arraybuffer';
      dc.onopen = () => {
        console.debug('[transfer:recv] channel open, requesting from', this.received);
        const req: ControlMessage = { type: 'request', from: this.received, hash: this.fingerprint.hash };
        dc.send(JSON.stringify(req));
      };
      dc.onmessage = (ev) => this.onChannelMessage(ev.data as string | ArrayBuffer);
      dc.onclose = () => {
        if (!this.finished) this.cb.onError('连接中断，可重试续传');
      };
      pc.onicecandidate = (e) => {
        if (e.candidate) this.signal({ kind: 'ice', candidate: e.candidate.toJSON() });
      };
      pc.oniceconnectionstatechange = () =>
        console.debug('[transfer:recv] ice state:', pc.iceConnectionState);
      pc.onconnectionstatechange = () => {
        console.debug('[transfer:recv] connection state:', pc.connectionState);
        if ((pc.connectionState === 'failed' || pc.connectionState === 'disconnected') && !this.finished) {
          this.cb.onError('P2P 连接失败，可重试（多次失败说明网络无法穿透，需要 TURN 中继）');
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal({ kind: 'offer', sdp: offer });
    } catch (err) {
      this.cb.onError(`传输启动失败：${String(err)}`);
    }
  }

  /** 房主发来的信令（answer/ice），由页面路由进来 */
  handleSignal(data: SignalPayload): void {
    console.debug('[transfer:recv] signal', data.kind);
    if (data.kind === 'answer') void this.ice?.setRemote(data.sdp);
    else if (data.kind === 'ice') this.ice?.add(data.candidate);
  }

  cancel(): void {
    this.finished = true;
    this.pc?.close();
    void this.writeChain.then(() => {
      void this.writer.close(this.fingerprint.hash).finally(() => this.writer.dispose());
    });
  }

  private onChannelMessage(data: string | ArrayBuffer): void {
    if (typeof data === 'string') {
      const msg = JSON.parse(data) as ControlMessage;
      if (msg.type === 'done') {
        this.writeChain = this.writeChain.then(() => this.finish());
      } else if (msg.type === 'error') {
        this.cb.onError(msg.message);
      }
      return;
    }
    const { offset, payload } = parseChunk(data);
    if (offset !== this.received) {
      // 顺序错乱（理论上 ordered channel 不会发生），丢弃并报错防止写坏文件
      this.cb.onError(`数据块乱序（期望 ${this.received}，收到 ${offset}）`);
      this.pc?.close();
      return;
    }
    this.received = offset + payload.byteLength;
    this.writeChain = this.writeChain.then(() =>
      this.writer.write(this.fingerprint.hash, offset, payload),
    );
    this.cb.onProgress(this.received, this.fingerprint.size);
  }

  private async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    try {
      await this.writer.close(this.fingerprint.hash);
      const file = await readOpfsFile(this.fingerprint.hash, this.fingerprint.name, this.fingerprint.mimeType);
      if (!file || file.size !== this.fingerprint.size) {
        throw new Error(`文件不完整（${file?.size ?? 0}/${this.fingerprint.size}）`);
      }
      const fp = await computeFingerprint(file);
      if (!sameFingerprint(fp, this.fingerprint)) {
        await this.writer.remove(this.fingerprint.hash);
        throw new Error('校验失败：收到的内容与房主的文件指纹不一致');
      }
      this.pc?.close();
      this.cb.onDone(file);
    } catch (err) {
      this.finished = false;
      this.cb.onError(String(err instanceof Error ? err.message : err));
    } finally {
      this.writer.dispose();
    }
  }

  private signal(data: SignalPayload): void {
    wsClient.send({ t: 'signal', to: this.hostId, data });
  }
}
