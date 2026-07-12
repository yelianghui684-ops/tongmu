/**
 * 「同幕」双端共享协议：所有 WebSocket 消息类型与调优常量。
 * 控制面（房间/聊天/播放同步/WebRTC 信令）全部经服务器 WS 转发；
 * 视频数据面走浏览器间 WebRTC DataChannel，不在此协议内。
 */

export const PROTOCOL_VERSION = 1;

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
export const MAX_ROOM_MEMBERS = 4;
export const MAX_CHAT_LENGTH = 500;
export const MAX_NICKNAME_LENGTH = 20;

/** 房主播放心跳间隔 */
export const HEARTBEAT_INTERVAL_MS = 2000;
/** NTP 式时钟对齐间隔 */
export const CLOCK_SYNC_INTERVAL_MS = 10_000;
/** 偏差低于此值用 playbackRate 微调，高于则直接 seek（秒） */
export const DRIFT_SEEK_THRESHOLD_S = 0.3;
/** 偏差低于此值视为已对齐，恢复 1x（秒） */
export const DRIFT_OK_S = 0.08;
/** 追赶/等待时的播放速率 */
export const CATCHUP_RATE = 1.05;
export const SLOWDOWN_RATE = 0.95;

/** P2P 传输分块大小（字节） */
export const CHUNK_SIZE = 64 * 1024;
/** DataChannel 背压水位：缓冲低于此值继续发 */
export const BUFFERED_AMOUNT_LOW = 1 * 1024 * 1024;
/** DataChannel 背压上限：缓冲高于此值暂停发 */
export const BUFFERED_AMOUNT_HIGH = 8 * 1024 * 1024;

/** 断线后会话保留时长，期间可凭 sessionToken 恢复身份 */
export const RECONNECT_GRACE_MS = 30_000;
/** 全员离线的房间保留时长 */
export const EMPTY_ROOM_TTL_MS = 5 * 60_000;

// ---------------------------------------------------------------------------
// 共享数据结构
// ---------------------------------------------------------------------------

/** 快速文件指纹：大小 + 头/中/尾各 1MB 的 SHA-256 */
export interface FileFingerprint {
  name: string;
  size: number;
  mimeType: string;
  /** hex 编码的 SHA-256(头1MB + 中1MB + 尾1MB) */
  hash: string;
}

export type FileState = 'none' | 'transferring' | 'ready';

export interface MemberInfo {
  id: string;
  nickname: string;
  isHost: boolean;
  connected: boolean;
  fileState: FileState;
  /** 仅 transferring 时有意义，0..1 */
  transferProgress: number;
}

/** 房主权威播放状态，atServerTime 为服务器时钟（ms epoch） */
export interface PlaybackState {
  position: number;
  isPlaying: boolean;
  atServerTime: number;
}

export type PlaybackCmd =
  | { cmd: 'play' }
  | { cmd: 'pause' }
  | { cmd: 'seek'; position: number };

// ---------------------------------------------------------------------------
// 客户端 → 服务器
// ---------------------------------------------------------------------------

export type C2S =
  | { t: 'create_room'; nickname: string }
  | { t: 'join_room'; roomCode: string; nickname: string }
  /** 断线重连：凭 token 恢复原成员身份 */
  | { t: 'resume'; roomCode: string; sessionToken: string }
  | { t: 'leave' }
  | { t: 'chat'; text: string }
  /** 房主宣布/取消放映文件 */
  | { t: 'set_file'; fingerprint: FileFingerprint | null }
  /** 成员上报自己的文件状态（选好同一文件 / 传输中 / 就绪） */
  | { t: 'file_state'; state: FileState; progress?: number }
  /** 任何成员发起播放操作；服务器转发给房主定夺 */
  | { t: 'playback_cmd'; action: PlaybackCmd }
  /** 仅房主：周期播放心跳（服务器盖时间戳后广播） */
  | { t: 'playback_heartbeat'; position: number; isPlaying: boolean }
  /** 缓冲状态上报（用于全体等待握手） */
  | { t: 'buffering'; isBuffering: boolean }
  /** WebRTC 信令转发（SDP/ICE） */
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'ping'; sentAt: number };

// ---------------------------------------------------------------------------
// 服务器 → 客户端
// ---------------------------------------------------------------------------

export interface ChatEntry {
  from: { id: string; nickname: string };
  text: string;
  at: number;
}

export type S2C =
  /** 入房成功（创建/加入/恢复共用） */
  | {
      t: 'joined';
      roomCode: string;
      selfId: string;
      sessionToken: string;
      resumed: boolean;
    }
  /** 房间快照：成员或文件变化时全量广播 */
  | {
      t: 'room_state';
      members: MemberInfo[];
      hostId: string;
      fileFingerprint: FileFingerprint | null;
    }
  | ({ t: 'chat' } & ChatEntry)
  /** 权威播放状态（房主心跳或指令生效后） */
  | { t: 'playback'; state: PlaybackState }
  /** 仅发给房主：某成员请求的播放操作 */
  | { t: 'playback_request'; from: string; action: PlaybackCmd }
  /** 某成员缓冲状态变化 */
  | { t: 'buffering'; memberId: string; isBuffering: boolean }
  | { t: 'signal'; from: string; data: unknown }
  | { t: 'pong'; sentAt: number; serverTime: number }
  | {
      t: 'error';
      code:
        | 'room_not_found'
        | 'room_full'
        | 'bad_request'
        | 'not_in_room'
        | 'session_expired';
      message: string;
    };

/** 运行时解析入站消息；格式非法返回 null */
export function parseC2S(raw: string): C2S | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const t = (msg as { t?: unknown }).t;
  if (typeof t !== 'string') return null;
  return msg as C2S;
}
