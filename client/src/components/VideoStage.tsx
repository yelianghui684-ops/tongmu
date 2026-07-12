import { useEffect, useRef, useState } from 'react';
import type { FileFingerprint } from '@tongmu/shared';
import { computeFingerprint, formatSize, sameFingerprint } from '../file/fingerprint';
import { usePlaybackSync } from '../sync/usePlaybackSync';
import type { RoomChannel } from '../useRoom';
import { wsClient } from '../ws';

interface LoadedFile {
  file: File;
  fingerprint: FileFingerprint;
  url: string;
}

/** 放映舞台：选片/校验/播放器 + 同步引擎 */
export default function VideoStage({ room }: { room: RoomChannel }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [pickError, setPickError] = useState('');
  const [hashing, setHashing] = useState(false);
  const sync = usePlaybackSync(room, videoRef, loaded !== null);

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
          <>
            <p>
              房主已选片：<strong>{room.fileFingerprint.name}</strong>
              <span className="muted">（{formatSize(room.fileFingerprint.size)}）</span>
            </p>
            <FilePicker label="我有这个文件，选择它" onPick={pickFile} />
            <p className="muted hint">没有这个文件？P2P 直传功能即将上线（里程碑 3）</p>
          </>
        ) : (
          <p className="muted">等待房主选片…</p>
        )}
        {pickError && <p className="error">{pickError}</p>}
      </div>
    );
  }

  return (
    <div className="player">
      <video ref={videoRef} src={loaded.url} playsInline />
      {sync.needGesture && (
        <button className="gesture-overlay" onClick={sync.confirmGesture}>
          ▶ 点击继续同步播放
        </button>
      )}
      {sync.someoneBuffering && <div className="buffer-note">有成员缓冲中，全场等待…</div>}
      <ControlBar videoRef={videoRef} sync={sync} isHost={room.isHost} fileName={loaded.file.name} />
      {pickError && <p className="error">{pickError}</p>}
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
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  sync: ReturnType<typeof usePlaybackSync>;
  isHost: boolean;
  fileName: string;
}) {
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
