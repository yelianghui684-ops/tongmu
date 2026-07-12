/** WebRTC 工具：ICE 配置获取 + DataChannel 二进制分块帧 */

/** 帧格式：[8 字节小端 offset][payload]，offset 用于定位写入与续传校验 */
export const FRAME_HEADER_BYTES = 8;

export async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const resp = await fetch('/api/ice');
    const json = (await resp.json()) as { iceServers?: RTCIceServer[] };
    return json.iceServers ?? [];
  } catch {
    return [];
  }
}

export function frameChunk(offset: number, payload: ArrayBuffer): ArrayBuffer {
  const buf = new ArrayBuffer(FRAME_HEADER_BYTES + payload.byteLength);
  new DataView(buf).setBigUint64(0, BigInt(offset), true);
  new Uint8Array(buf, FRAME_HEADER_BYTES).set(new Uint8Array(payload));
  return buf;
}

export function parseChunk(buf: ArrayBuffer): { offset: number; payload: ArrayBuffer } {
  const offset = Number(new DataView(buf).getBigUint64(0, true));
  return { offset, payload: buf.slice(FRAME_HEADER_BYTES) };
}

// ---------------------------------------------------------------------------
// 信令负载（经服务器 signal 消息转发）
// ---------------------------------------------------------------------------

export type SignalPayload =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

/** DataChannel 上的 JSON 控制消息 */
export type ControlMessage =
  | { type: 'request'; from: number; hash: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * trickle ICE 候选可能先于远端描述就绪到达，先入队、
 * setRemoteDescription 之后统一 flush。
 */
export class IceQueue {
  private pending: RTCIceCandidateInit[] = [];
  private ready = false;

  constructor(private pc: RTCPeerConnection) {}

  async setRemote(sdp: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(sdp);
    this.ready = true;
    for (const c of this.pending) {
      await this.pc.addIceCandidate(c).catch(() => {});
    }
    this.pending = [];
  }

  add(candidate: RTCIceCandidateInit): void {
    if (this.ready) void this.pc.addIceCandidate(candidate).catch(() => {});
    else this.pending.push(candidate);
  }
}
