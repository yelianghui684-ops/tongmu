import { describe, expect, it } from 'vitest';
import { CATCHUP_RATE, SLOWDOWN_RATE } from '@tongmu/shared';
import { decideDrift, expectedPosition } from './drift';

describe('expectedPosition', () => {
  const base = { position: 100, isPlaying: true, intentPlaying: true, atServerTime: 50_000 };

  it('播放中按经过的服务器时间外推', () => {
    expect(expectedPosition(base, 52_000)).toBeCloseTo(102);
  });

  it('暂停时不外推', () => {
    expect(expectedPosition({ ...base, isPlaying: false }, 60_000)).toBe(100);
  });

  it('时钟回拨（负 elapsed）不倒退', () => {
    expect(expectedPosition(base, 49_000)).toBe(100);
  });
});

describe('decideDrift', () => {
  it('对齐时不动作', () => {
    expect(decideDrift(100.02, 100, true, 1)).toEqual({ kind: 'none' });
  });

  it('对齐后把非 1x 的速率复位', () => {
    expect(decideDrift(100.02, 100, true, CATCHUP_RATE)).toEqual({ kind: 'rate', rate: 1 });
  });

  it('落后一点用加速追赶', () => {
    expect(decideDrift(99.8, 100, true, 1)).toEqual({ kind: 'rate', rate: CATCHUP_RATE });
  });

  it('超前一点用减速等待', () => {
    expect(decideDrift(100.2, 100, true, 1)).toEqual({ kind: 'rate', rate: SLOWDOWN_RATE });
  });

  it('速率已正确时不重复设置', () => {
    expect(decideDrift(99.8, 100, true, CATCHUP_RATE)).toEqual({ kind: 'none' });
  });

  it('大偏差直接 seek', () => {
    expect(decideDrift(95, 100, true, 1)).toEqual({ kind: 'seek', position: 100 });
    expect(decideDrift(105, 100, true, 1)).toEqual({ kind: 'seek', position: 100 });
  });

  it('暂停状态位置不齐就 seek', () => {
    expect(decideDrift(100.5, 100, false, 1)).toEqual({ kind: 'seek', position: 100 });
    expect(decideDrift(100.01, 100, false, 1)).toEqual({ kind: 'none' });
  });
});
