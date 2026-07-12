import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  CLOCK_SYNC_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  type PlaybackCmd,
  type PlaybackState,
} from '@tongmu/shared';
import type { RoomChannel } from '../useRoom';
import { wsClient } from '../ws';
import { bestOffset, makeSample, pushSample, type ClockSample } from './clock';
import { decideDrift, expectedPosition } from './drift';

/** 观众端本地对齐检查频率 */
const DRIFT_CHECK_INTERVAL_MS = 500;

export interface PlaybackSync {
  /** 自动播放被浏览器拦截，需要用户点一下 */
  needGesture: boolean;
  confirmGesture: () => void;
  /** 有成员在缓冲，全员等待中 */
  someoneBuffering: boolean;
  /** 观众端与权威进度的偏差（秒，正值超前），房主为 null */
  drift: number | null;
  /**
   * 房间的播放意图（缓冲等待时播放器可能临时暂停，但意图不变）。
   * 播放/暂停按钮必须依据它切换，否则会在握手暂停的瞬间发反指令。
   */
  intentPlaying: boolean;
  /** 统一控制入口：房主直接操作播放器，观众发请求给房主 */
  command: (action: PlaybackCmd) => void;
}

/**
 * 播放同步引擎。
 * 房主：本地播放器是权威 → 事件驱动 + 周期心跳广播；执行观众的播放请求；
 *       任何成员缓冲时暂停全场，缓冲完毕自动恢复。
 * 观众：跟随权威状态 → 小偏差 playbackRate 微调，大偏差 seek。
 */
export function usePlaybackSync(
  room: RoomChannel,
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
): PlaybackSync {
  const { isHost, selfId } = room;
  const [needGesture, setNeedGesture] = useState(false);
  const [someoneBuffering, setSomeoneBuffering] = useState(false);
  const [drift, setDrift] = useState<number | null>(null);
  const [intentPlaying, setIntentPlaying] = useState(false);

  const samplesRef = useRef<ClockSample[]>([]);
  const latestRef = useRef<PlaybackState | null>(null);
  const bufferingRef = useRef(new Set<string>());
  /**
   * 房主的播放意图（房间"应该"在播还是停），由显式 play/pause 指令驱动。
   * 播放器实际状态通过幂等 reconcile 向"意图 + 无人缓冲"收敛，
   * 避免缓冲事件交错时的竞态。
   */
  const wantPlayingRef = useRef(false);

  const serverNow = useCallback(() => Date.now() + bestOffset(samplesRef.current), []);
  const reconcileRef = useRef<() => void>(() => {});

  const tryPlay = useCallback(
    (video: HTMLVideoElement) => {
      video.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') setNeedGesture(true);
      });
    },
    [],
  );

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;

    // ---- 时钟对齐：启动时快速打 3 发，之后周期采样 ----
    const ping = () => wsClient.send({ t: 'ping', sentAt: Date.now() });
    ping();
    const burst1 = setTimeout(ping, 500);
    const burst2 = setTimeout(ping, 1500);
    const clockTimer = setInterval(ping, CLOCK_SYNC_INTERVAL_MS);

    // ---- 房主：心跳 ----
    const heartbeat = () => {
      if (!isHost) return;
      wsClient.send({
        t: 'playback_heartbeat',
        position: video.currentTime,
        isPlaying: !video.paused && !video.ended,
        intentPlaying: wantPlayingRef.current,
      });
    };
    const heartbeatTimer = isHost ? setInterval(heartbeat, HEARTBEAT_INTERVAL_MS) : null;

    // ---- 观众：对齐检查 ----
    const applySync = () => {
      if (isHost) return;
      const latest = latestRef.current;
      if (!latest || video.seeking) return;
      const expected = expectedPosition(latest, serverNow());
      setDrift(video.currentTime - expected);

      if (latest.isPlaying && video.paused) tryPlay(video);
      else if (!latest.isPlaying && !video.paused) video.pause();

      const action = decideDrift(video.currentTime, expected, latest.isPlaying, video.playbackRate);
      if (action.kind === 'seek') {
        video.currentTime = action.position;
        video.playbackRate = 1;
      } else if (action.kind === 'rate') {
        video.playbackRate = action.rate;
      }
    };
    const driftTimer = !isHost ? setInterval(applySync, DRIFT_CHECK_INTERVAL_MS) : null;

    // ---- 缓冲握手（房主幂等对账）----
    const reconcile = () => {
      if (!isHost) return;
      const shouldPlay = wantPlayingRef.current && bufferingRef.current.size === 0 && !video.ended;
      if (shouldPlay && video.paused) tryPlay(video);
      else if (!shouldPlay && !video.paused) video.pause();
    };
    const updateBuffering = (memberId: string, isBuffering: boolean) => {
      const set = bufferingRef.current;
      if (isBuffering) set.add(memberId);
      else set.delete(memberId);
      setSomeoneBuffering(set.size > 0);
      reconcile();
    };
    const reconcileTimer = isHost ? setInterval(reconcile, 500) : null;
    reconcileRef.current = reconcile;

    // ---- 服务器消息 ----
    const offMsg = room.onMessage((msg) => {
      switch (msg.t) {
        case 'pong':
          samplesRef.current = pushSample(
            samplesRef.current,
            makeSample(msg.sentAt, msg.serverTime, Date.now()),
          );
          break;
        case 'playback':
          if (!isHost) {
            latestRef.current = msg.state;
            setIntentPlaying(msg.state.intentPlaying);
            applySync();
          }
          break;
        case 'playback_request': {
          if (!isHost) break;
          const a = msg.action;
          if (a.cmd === 'play') wantPlayingRef.current = true;
          else if (a.cmd === 'pause') wantPlayingRef.current = false;
          else if (a.cmd === 'seek') video.currentTime = a.position;
          setIntentPlaying(wantPlayingRef.current);
          reconcile();
          break;
        }
        case 'buffering':
          updateBuffering(msg.memberId, msg.isBuffering);
          break;
      }
    });

    // ---- 播放器事件 ----
    const onPlay = () => heartbeat();
    const onPause = () => heartbeat();
    const onSeeked = () => heartbeat();
    const onEnded = () => {
      wantPlayingRef.current = false;
      setIntentPlaying(false);
      heartbeat();
    };
    const onWaiting = () => {
      wsClient.send({ t: 'buffering', isBuffering: true });
      updateBuffering(selfId, true);
    };
    const onReadyToPlay = () => {
      wsClient.send({ t: 'buffering', isBuffering: false });
      updateBuffering(selfId, false);
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onReadyToPlay);
    video.addEventListener('canplay', onReadyToPlay);

    heartbeat();

    return () => {
      clearTimeout(burst1);
      clearTimeout(burst2);
      clearInterval(clockTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (driftTimer) clearInterval(driftTimer);
      if (reconcileTimer) clearInterval(reconcileTimer);
      offMsg();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onReadyToPlay);
      video.removeEventListener('canplay', onReadyToPlay);
      reconcileRef.current = () => {};
      bufferingRef.current = new Set();
      wantPlayingRef.current = false;
      latestRef.current = null;
    };
  }, [active, isHost, selfId, room, videoRef, serverNow, tryPlay]);

  const command = useCallback(
    (action: PlaybackCmd) => {
      const video = videoRef.current;
      if (isHost && video) {
        if (action.cmd === 'play') wantPlayingRef.current = true;
        else if (action.cmd === 'pause') wantPlayingRef.current = false;
        else if (action.cmd === 'seek') video.currentTime = action.position;
        setIntentPlaying(wantPlayingRef.current);
        reconcileRef.current();
      } else {
        wsClient.send({ t: 'playback_cmd', action });
      }
    },
    [isHost, videoRef],
  );

  const confirmGesture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video
      .play()
      .then(() => setNeedGesture(false))
      .catch(() => setNeedGesture(true));
  }, [videoRef]);

  return { needGesture, confirmGesture, someoneBuffering, drift, intentPlaying, command };
}
