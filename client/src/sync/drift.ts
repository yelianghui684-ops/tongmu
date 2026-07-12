import {
  CATCHUP_RATE,
  DRIFT_OK_S,
  DRIFT_SEEK_THRESHOLD_S,
  SLOWDOWN_RATE,
  type PlaybackState,
} from '@tongmu/shared';

/**
 * 观众端偏差决策（纯函数，便于单测）：
 * - 暂停状态：位置不对齐就直接 seek
 * - 播放状态：小偏差用 playbackRate 追赶/等待，大偏差 seek，已对齐恢复 1x
 */

export type DriftAction =
  | { kind: 'none' }
  | { kind: 'rate'; rate: number }
  | { kind: 'seek'; position: number };

/** 根据权威状态外推"此刻应当播放到的位置"（秒） */
export function expectedPosition(state: PlaybackState, nowServerTime: number): number {
  if (!state.isPlaying) return state.position;
  return state.position + Math.max(0, nowServerTime - state.atServerTime) / 1000;
}

export function decideDrift(
  currentPosition: number,
  expected: number,
  isPlaying: boolean,
  currentRate: number,
): DriftAction {
  const drift = currentPosition - expected; // 正值超前，负值落后

  if (!isPlaying) {
    return Math.abs(drift) > 0.05 ? { kind: 'seek', position: expected } : { kind: 'none' };
  }
  if (Math.abs(drift) >= DRIFT_SEEK_THRESHOLD_S) {
    return { kind: 'seek', position: expected };
  }
  if (Math.abs(drift) <= DRIFT_OK_S) {
    return currentRate === 1 ? { kind: 'none' } : { kind: 'rate', rate: 1 };
  }
  const target = drift > 0 ? SLOWDOWN_RATE : CATCHUP_RATE;
  return currentRate === target ? { kind: 'none' } : { kind: 'rate', rate: target };
}
