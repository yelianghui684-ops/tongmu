import { useEffect, useRef, useState } from 'react';
import type { FileFingerprint } from '@tongmu/shared';
import { computeFingerprint, formatSize, sameFingerprint } from '../file/fingerprint';
import { subtitleFileToVttUrl } from '../file/subtitles';
import { usePlaybackSync } from '../sync/usePlaybackSync';
import { opfsSupported } from '../transfer/opfs';
import { ReceiveSession } from '../transfer/receiver';
import type { SignalPayload } from '../transfer/rtc';
import { SenderHub } from '../transfer/sender';
import type { RoomChannel } from '../useRoom';
import { wsClient } from '../ws';

interface LoadedFile {
  file: File;
  fingerprint: FileFingerprint;
  url: string;
}

type TransferState =
  | { status: 'idle' }
  | { status: 'transferring'; received: number; total: number }
  | { status: 'error'; message: string };

/** 放映舞台：选片/校验/播放器 + 同步引擎 */
export default function VideoStage({ room }: { room: RoomChannel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [pickError, setPickError] = useState('');
  const [hashing, setHashing] = useState(false);
  const [transfer, setTransfer] = useState<TransferState>({ status: 'idle' });
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);
  const [decodeError, setDecodeError] = useState(false);
  const receiveRef = useRef<ReceiveSession | null>(null);
  const sync = usePlaybackSync(room, videoRef, loaded !== null);

  // 注意：依赖必须用稳定标识（isHost/onMessage），不能用整个 room 对象——
  // useRoom 每次渲染返回新对象，会让传输枢纽被反复销毁重建，掐断 P2P 连接
  const { isHost, onMessage } = room;

  // 房主：文件就绪后挂起发送枢纽，应答观众的 P2P 请求
  useEffect(() => {
    if (!isHost || !loaded) return;
    const hub = new SenderHub(loaded.file, loaded.fingerprint);
    const off = onMessage((msg) => {
      if (msg.t === 'signal') {
        hub.handleSignal(msg.from, msg.data as SignalPayload).catch((err: unknown) => {
          console.debug('[transfer:send] handleSignal failed:', err);
        });
      }
    });
    return () => {
      off();
      hub.close();
    };
  }, [isHost, loaded, onMessage]);

  // 观众：把房主的信令喂给接收会话
  useEffect(() => {
    if (isHost) return;
    const off = onMessage((msg) => {
      if (msg.t === 'signal') receiveRef.current?.handleSignal(msg.data as SignalPayload);
    });
    return off;
  }, [isHost, onMessage]);

  useEffect(() => {
    return () => receiveRef.current?.cancel();
  }, []);

  function startTransfer() {
    const fp = room.fileFingerprint;
    if (!fp) return;
    receiveRef.current?.cancel();
    setTransfer({ status: 'transferring', received: 0, total: fp.size });
    setPickError('');
    let lastReport = 0;
    const session = new ReceiveSession(room.hostId, fp, {
      onProgress: (received, total) => {
        setTransfer({ status: 'transferring', received, total });
        const nowTs = Date.now();
        if (nowTs - lastReport > 500) {
          lastReport = nowTs;
          wsClient.send({ t: 'file_state', state: 'transferring', progress: received / total });
        }
      },
      onDone: (file) => {
        receiveRef.current = null;
        setTransfer({ status: 'idle' });
        setLoaded({ file, fingerprint: fp, url: URL.createObjectURL(file) });
        wsClient.send({ t: 'file_state', state: 'ready' });
      },
      onError: (message) => {
        setTransfer({ status: 'error', message });
        wsClient.send({ t: 'file_state', state: 'none' });
      },
    });
    receiveRef.current = session;
    void session.start();
  }

  // 房主换片 / 取消选片时，观众的旧文件作废
  useEffect(() => {
    if (!room.isHost && loaded && room.fileFingerprint && !sameFingerprint(loaded.fingerprint, room.fileFingerprint)) {
      URL.revokeObjectURL(loaded.url);
      setLoaded(null);
    }
    if (!room.isHost && loaded && !room.fileFingerprint) {
      URL.revokeObjectURL(loaded.url);
      setLoaded(null);
    }
  }, [room.fileFingerprint, room.isHost, loaded]);

  useEffect(() => {
    return () => {
      if (loaded) URL.revokeObjectURL(loaded.url);
    };
  }, [loaded]);

  async function pickFile(file: File) {
    setPickError('');
    setHashing(true);
    try {
      const fingerprint = await computeFingerprint(file);
      if (!room.isHost) {
        if (!room.fileFingerprint) return;
        if (!sameFingerprint(fingerprint, room.fileFingerprint)) {
          setPickError('这不是同一个文件（内容或大小不一致），请确认选择了和房主完全相同的视频。');
          return;
        }
      }
      const probe = document.createElement('video');
      if (file.type && probe.canPlayType(file.type) === '') {
        setPickError(`浏览器可能无法播放此格式（${file.type}），建议使用 MP4 (H.264/AAC)。仍会尝试加载。`);
      }
      const url = URL.createObjectURL(file);
      setLoaded({ file, fingerprint, url });
      if (room.isHost) {
        wsClient.send({ t: 'set_file', fingerprint });
      } else {
        wsClient.send({ t: 'file_state', state: 'ready' });
      }
    } finally {
      setHashing(false);
    }
  }

  async function pickSubtitle(file: File) {
    const url = await subtitleFileToVttUrl(file);
    setSubtitleUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
    // 新 track 挂载后确保显示
    requestAnimationFrame(() => {
      const track = videoRef.current?.textTracks[0];
      if (track) track.mode = 'showing';
    });
  }

  if (!loaded) {
    return (
      <div className="stage-placeholder">
        <p>🎬</p>
        {hashing ? (
          <p className="muted">正在校验文件…</p>
        ) : room.isHost ? (
          <>
            <FilePicker label="选择放映文件" onPick={pickFile} />
            <p className="muted hint">支持浏览器可播的格式，推荐 MP4 (H.264/AAC)</p>
          </>
        ) : room.fileFingerprint ? (
          transfer.status === 'transferring' ? (
            <TransferProgress received={transfer.received} total={transfer.total} />
          ) : (
            <>
              <p>
                房主已选片：<strong>{room.fileFingerprint.name}</strong>
                <span className="muted">（{formatSize(room.fileFingerprint.size)}）</span>
              </p>
              <div className="pick-actions">
                <FilePicker label="我有这个文件，选择它" onPick={pickFile} />
                {opfsSupported() && (
                  <button className="primary" onClick={startTransfer}>
                    没有文件，让房主传给我
                  </button>
                )}
              </div>
              {transfer.status === 'error' && (
                <p className="error">
                  {transfer.message}{' '}
                  <button className="ghost" onClick={startTransfer}>
                    重试
                  </button>
                </p>
              )}
            </>
          )
        ) : (
          <p className="muted">等待房主选片…</p>
        )}
        {pickError && <p className="error">{pickError}</p>}
      </div>
    );
  }

  return (
    <div className="player">
      <video
        ref={videoRef}
        src={loaded.url}
        playsInline
        onError={() => {
          if (!videoRef.current?.error) return;
          setDecodeError(true);
          // 播不了就不算就绪，避免其他成员看到假的"已就绪"
          wsClient.send({ t: 'file_state', state: 'none' });
        }}
      >
        {subtitleUrl && <track default kind="subtitles" label="字幕" src={subtitleUrl} />}
      </video>
      {decodeError && (
        <div className="decode-error">
          <p>😵 浏览器无法解码这个文件</p>
          <p className="muted">
            常见于 MKV 封装或 HEVC/H.265 编码。请用其他工具转成 MP4 (H.264/AAC) 后重新选择。
          </p>
          <button
            className="primary"
            onClick={() => {
              setDecodeError(false);
              URL.revokeObjectURL(loaded.url);
              setLoaded(null);
            }}
          >
            重新选片
          </button>
        </div>
      )}
      {sync.needGesture && (
        <button className="gesture-overlay" onClick={sync.confirmGesture}>
          ▶ 点击继续同步播放
        </button>
      )}
      {sync.someoneBuffering && <div className="buffer-note">有成员缓冲中，全场等待…</div>}
      <ControlBar
        videoRef={videoRef}
        sync={sync}
        isHost={room.isHost}
        fileName={loaded.file.name}
        onPickSubtitle={pickSubtitle}
        hasSubtitle={subtitleUrl !== null}
      />
      {pickError && <p className="error">{pickError}</p>}
    </div>
  );
}

function TransferProgress({ received, total }: { received: number; total: number }) {
  const pct = total > 0 ? (received / total) * 100 : 0;
  return (
    <div className="transfer-progress">
      <p>正在从房主处接收文件…</p>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="muted">
        {formatSize(received)} / {formatSize(total)}（{pct.toFixed(1)}%）
      </p>
      <p className="muted hint">文件点对点直传，不经过服务器；刷新页面后可断点续传</p>
    </div>
  );
}

function FilePicker({ label, onPick }: { label: string; onPick: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="primary" onClick={() => inputRef.current?.click()}>
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mkv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
    </>
  );
}

function ControlBar({
  videoRef,
  sync,
  isHost,
  fileName,
  onPickSubtitle,
  hasSubtitle,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  sync: ReturnType<typeof usePlaybackSync>;
  isHost: boolean;
  fileName: string;
  onPickSubtitle: (f: File) => void;
  hasSubtitle: boolean;
}) {
  const subInputRef = useRef<HTMLInputElement>(null);
  const [, forceTick] = useState(0);

  // 播放器状态没有 React 化，用轻量 tick 驱动时间条刷新
  useEffect(() => {
    const timer = setInterval(() => forceTick((n) => n + 1), 500);
    const video = videoRef.current;
    const bump = () => forceTick((n) => n + 1);
    video?.addEventListener('play', bump);
    video?.addEventListener('pause', bump);
    video?.addEventListener('loadedmetadata', bump);
    return () => {
      clearInterval(timer);
      video?.removeEventListener('play', bump);
      video?.removeEventListener('pause', bump);
      video?.removeEventListener('loadedmetadata', bump);
    };
  }, [videoRef]);

  const video = videoRef.current;
  const position = video?.currentTime ?? 0;
  const duration = video?.duration || 0;

  return (
    <div className="control-bar">
      <button
        className="play-btn"
        onClick={() => sync.command(sync.intentPlaying ? { cmd: 'pause' } : { cmd: 'play' })}
        title={isHost ? '' : '将向房主发出请求'}
      >
        {sync.intentPlaying ? '⏸' : '▶'}
      </button>
      <span className="time">{fmtTime(position)}</span>
      <input
        className="seek"
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(position, duration || 0)}
        onChange={(e) => sync.command({ cmd: 'seek', position: Number(e.target.value) })}
      />
      <span className="time">{fmtTime(duration)}</span>
      <VolumeControl videoRef={videoRef} />
      <button
        className="ghost"
        title="加载外挂字幕（.srt/.vtt，各自加载各自的）"
        onClick={() => subInputRef.current?.click()}
      >
        {hasSubtitle ? '字幕 ✓' : '字幕'}
      </button>
      <input
        ref={subInputRef}
        type="file"
        accept=".srt,.vtt"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickSubtitle(f);
          e.target.value = '';
        }}
      />
      <span className="file-name" title={fileName}>
        {fileName}
      </span>
      {sync.drift !== null && (
        <span
          className={`badge ${Math.abs(sync.drift) < 0.3 ? 'ok' : 'warn'}`}
          title="与房主进度的偏差"
        >
          {sync.drift >= 0 ? '+' : ''}
          {(sync.drift * 1000).toFixed(0)}ms
        </span>
      )}
      {isHost && <span className="badge">权威端</span>}
    </div>
  );
}

function VolumeControl({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const video = videoRef.current;
  useEffect(() => {
    if (video) {
      video.volume = volume;
      video.muted = muted;
    }
  }, [video, volume, muted]);
  return (
    <span className="volume">
      <button className="ghost" onClick={() => setMuted((m) => !m)}>
        {muted || volume === 0 ? '🔇' : '🔊'}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => {
          setMuted(false);
          setVolume(Number(e.target.value));
        }}
      />
    </span>
  );
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '--:--';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
