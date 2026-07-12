/**
 * NTP 式服务器时钟对齐：
 * 每次 ping/pong 得到一个样本，offset = serverTime - (sentAt + rtt/2)。
 * RTT 越小的样本越可信，取滑动窗口内 RTT 最小样本的 offset。
 */

export interface ClockSample {
  rtt: number;
  offset: number;
}

export const CLOCK_WINDOW = 8;

export function makeSample(sentAt: number, serverTime: number, receivedAt: number): ClockSample {
  const rtt = receivedAt - sentAt;
  return { rtt, offset: serverTime - (sentAt + rtt / 2) };
}

export function pushSample(samples: ClockSample[], sample: ClockSample): ClockSample[] {
  return [...samples.slice(-(CLOCK_WINDOW - 1)), sample];
}

/** 无样本时返回 0（按本地时钟即服务器时钟处理） */
export function bestOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0;
  let best = samples[0]!;
  for (const s of samples) {
    if (s.rtt < best.rtt) best = s;
  }
  return best.offset;
}
