import { BUFFERED_AMOUNT_HIGH, BUFFERED_AMOUNT_LOW, CHUNK_SIZE, type FileFingerprint } from '@tongmu/shared';
import { wsClient } from '../ws';
import { fetchIceServers, frameChunk, IceQueue, type ControlMessage, type SignalPayload } from './rtc';

interface PeerState {
  pc: RTCPeerConnection;
  ice: IceQueue;
}

/**
 * 房主端 P2P 发送枢纽：应答每个观众的 offer，按请求起点流式发送文件分块，
 * 用 bufferedAmount 高低水位做背压。一个观众一条连接。
 */
export class SenderHub {
  private peers = new Map<string, PeerState>();
  private iceServersPromise = fetchIceServers();
  private closed = false;

  constructor(
    private file: File,
    private fingerprint: FileFingerprint,
  ) {}

  async handleSignal(from: string, data: SignalPayload): Promise<void> {
    if (this.closed) return;
    console.debug('[transfer:send] signal', data.kind, 'from', from);
    if (data.kind === 'offer') {
      this.peers.get(from)?.pc.close();
      const pc = new RTCPeerConnection({ iceServers: await this.iceServersPromise });
      const peer: PeerState = { pc, ice: new IceQueue(pc) };
      this.peers.set(from, peer);

      pc.onicecandidate = (e) => {
        if (e.candidate) this.signal(from, { kind: 'ice', candidate: e.candidate.toJSON() });
      };
      pc.ondatachannel = (e) => {
        console.debug('[transfer:send] datachannel from', from);
        this.serve(e.channel);
      };
      pc.onconnectionstatechange = () => console.debug('[transfer:send] connection state:', pc.connectionState);

      console.debug('[transfer:send] pc created, setting remote offer');
      await peer.ice.setRemote(data.sdp);
      console.debug('[transfer:send] remote set, creating answer');
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.debug('[transfer:send] answer sent');
      this.signal(from, { kind: 'answer', sdp: answer });
    } else if (data.kind === 'ice') {
      this.peers.get(from)?.ice.add(data.candidate);
    }
  }

  close(): void {
    this.closed = true;
    for (const { pc } of this.peers.values()) pc.close();
    this.peers.clear();
  }

  private serve(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW;
    dc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      const req = JSON.parse(ev.data) as ControlMessage;
      if (req.type !== 'request') return;
      if (req.hash !== this.fingerprint.hash) {
        dc.send(JSON.stringify({ type: 'error', message: '房主已更换文件，请刷新后重试' } satisfies ControlMessage));
        return;
      }
      console.debug('[transfer:send] streaming from byte', req.from);
      void this.stream(dc, req.from);
    };
  }

  private async stream(dc: RTCDataChannel, start: number): Promise<void> {
    let offset = Math.max(0, Math.min(start, this.file.size));
    try {
      while (offset < this.file.size && dc.readyState === 'open' && !this.closed) {
        if (dc.bufferedAmount > BUFFERED_AMOUNT_HIGH) {
          await waitForDrain(dc);
          continue;
        }
        const end = Math.min(offset + CHUNK_SIZE, this.file.size);
        const payload = await this.file.slice(offset, end).arrayBuffer();
        dc.send(frameChunk(offset, payload));
        offset = end;
      }
      if (dc.readyState === 'open' && offset >= this.file.size) {
        dc.send(JSON.stringify({ type: 'done' } satisfies ControlMessage));
      }
    } catch {
      // 通道中途关闭等；观众端会走重试/续传
    }
  }

  private signal(to: string, data: SignalPayload): void {
    wsClient.send({ t: 'signal', to, data });
  }
}

function waitForDrain(dc: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      dc.removeEventListener('bufferedamountlow', done);
      clearTimeout(timer);
      resolve();
    };
    // 事件兜底：部分实现不触发 bufferedamountlow 时靠轮询
    const timer = setTimeout(done, 200);
    dc.addEventListener('bufferedamountlow', done);
  });
}
