import { describe, expect, it } from 'vitest';
import { bestOffset, CLOCK_WINDOW, makeSample, pushSample } from './clock';

describe('时钟对齐', () => {
  it('offset = serverTime - (sentAt + rtt/2)', () => {
    // 本地 1000 发出，服务器时刻 6010，本地 1020 收到 → rtt 20，中点 1010，offset 5000
    expect(makeSample(1000, 6010, 1020)).toEqual({ rtt: 20, offset: 5000 });
  });

  it('取 RTT 最小样本的 offset', () => {
    const samples = [
      { rtt: 40, offset: 5030 },
      { rtt: 8, offset: 5002 },
      { rtt: 100, offset: 5090 },
    ];
    expect(bestOffset(samples)).toBe(5002);
  });

  it('无样本返回 0', () => {
    expect(bestOffset([])).toBe(0);
  });

  it('滑动窗口保留最近 N 个', () => {
    let samples: ReturnType<typeof makeSample>[] = [];
    for (let i = 0; i < CLOCK_WINDOW + 5; i++) {
      samples = pushSample(samples, { rtt: i, offset: i });
    }
    expect(samples).toHaveLength(CLOCK_WINDOW);
    expect(samples[0]!.rtt).toBe(5); // 最早的 5 个被挤出
  });
});
