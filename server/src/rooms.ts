import { customAlphabet, nanoid } from 'nanoid';
import {
  type C2S,
  type S2C,
  type FileFingerprint,
  type FileState,
  type MemberInfo,
  EMPTY_ROOM_TTL_MS,
  MAX_CHAT_LENGTH,
  MAX_NICKNAME_LENGTH,
  MAX_ROOM_MEMBERS,
  RECONNECT_GRACE_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from '@tongmu/shared';

const genRoomCode = customAlphabet(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);

/** 连接抽象：生产环境是 ws，测试里是收集消息的假对象 */
export interface Conn {
  send(msg: S2C): void;
}

interface Member {
  id: string;
  nickname: string;
  sessionToken: string;
  conn: Conn | null;
  fileState: FileState;
  transferProgress: number;
  joinedAt: number;
  disconnectedAt: number | null;
}

interface Room {
  code: string;
  hostId: string;
  members: Map<string, Member>;
  fileFingerprint: FileFingerprint | null;
  /** 全员离线的起始时刻，用于 TTL 回收 */
  emptySince: number | null;
}

/** 每个 WS 连接持有一个 Session；入房后指向所在房间与成员身份 */
export interface Session {
  room: Room;
  member: Member;
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private now: () => number = Date.now) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  /** 处理一条入站消息。返回新的 session（入房消息会建立会话）。 */
  handleMessage(conn: Conn, session: Session | null, msg: C2S): Session | null {
    if (msg.t === 'ping') {
      conn.send({ t: 'pong', sentAt: msg.sentAt, serverTime: this.now() });
      return session;
    }
    if (msg.t === 'create_room') return this.createRoom(conn, msg.nickname);
    if (msg.t === 'join_room') return this.joinRoom(conn, msg.roomCode, msg.nickname);
    if (msg.t === 'resume') return this.resume(conn, msg.roomCode, msg.sessionToken);

    if (!session) {
      conn.send({ t: 'error', code: 'not_in_room', message: '请先加入房间' });
      return null;
    }
    const { room, member } = session;

    switch (msg.t) {
      case 'leave':
        this.removeMember(room, member.id);
        return null;

      case 'chat': {
        const text = msg.text.trim().slice(0, MAX_CHAT_LENGTH);
        if (text) {
          this.broadcast(room, {
            t: 'chat',
            from: { id: member.id, nickname: member.nickname },
            text,
            at: this.now(),
          });
        }
        return session;
      }

      case 'set_file': {
        if (member.id !== room.hostId) {
          conn.send({ t: 'error', code: 'bad_request', message: '只有房主能选择放映文件' });
          return session;
        }
        room.fileFingerprint = msg.fingerprint;
        for (const m of room.members.values()) {
          m.fileState = 'none';
          m.transferProgress = 0;
        }
        member.fileState = msg.fingerprint ? 'ready' : 'none';
        this.broadcastRoomState(room);
        return session;
      }

      case 'file_state': {
        member.fileState = msg.state;
        member.transferProgress =
          msg.state === 'transferring' ? clamp01(msg.progress ?? 0) : msg.state === 'ready' ? 1 : 0;
        this.broadcastRoomState(room);
        return session;
      }

      case 'playback_cmd': {
        const host = room.members.get(room.hostId);
        host?.conn?.send({ t: 'playback_request', from: member.id, action: msg.action });
        return session;
      }

      case 'playback_heartbeat': {
        if (member.id !== room.hostId) return session;
        this.broadcast(
          room,
          {
            t: 'playback',
            state: {
              position: msg.position,
              isPlaying: msg.isPlaying,
              intentPlaying: msg.intentPlaying,
              atServerTime: this.now(),
            },
          },
          member.id,
        );
        return session;
      }

      case 'buffering': {
        this.broadcast(room, { t: 'buffering', memberId: member.id, isBuffering: msg.isBuffering }, member.id);
        return session;
      }

      case 'signal': {
        const target = room.members.get(msg.to);
        target?.conn?.send({ t: 'signal', from: member.id, data: msg.data });
        return session;
      }

      default:
        conn.send({ t: 'error', code: 'bad_request', message: '未知消息类型' });
        return session;
    }
  }

  /** WS 断开：保留成员身份等待重连 */
  handleDisconnect(session: Session | null): void {
    if (!session) return;
    const { room, member } = session;
    member.conn = null;
    member.disconnectedAt = this.now();
    if ([...room.members.values()].every((m) => m.conn === null)) {
      room.emptySince = this.now();
    }
    this.broadcastRoomState(room);
  }

  /** 周期清扫：过期离线成员移除、空房回收。由外部定时器驱动。 */
  sweep(): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      let changed = false;
      for (const m of room.members.values()) {
        if (m.conn === null && m.disconnectedAt !== null && now - m.disconnectedAt > RECONNECT_GRACE_MS) {
          this.removeMember(room, m.id, /* silent */ true);
          changed = true;
        }
      }
      if (this.rooms.has(room.code) && changed) this.broadcastRoomState(room);
      if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        this.rooms.delete(room.code);
      }
    }
  }

  // -------------------------------------------------------------------------

  private createRoom(conn: Conn, nickname: string): Session {
    let code = genRoomCode();
    while (this.rooms.has(code)) code = genRoomCode();
    const room: Room = {
      code,
      hostId: '',
      members: new Map(),
      fileFingerprint: null,
      emptySince: null,
    };
    this.rooms.set(code, room);
    const member = this.addMember(room, conn, nickname);
    room.hostId = member.id;
    conn.send({ t: 'joined', roomCode: code, selfId: member.id, sessionToken: member.sessionToken, resumed: false });
    this.broadcastRoomState(room);
    return { room, member };
  }

  private joinRoom(conn: Conn, roomCode: string, nickname: string): Session | null {
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    if (!room) {
      conn.send({ t: 'error', code: 'room_not_found', message: '房间不存在或已过期' });
      return null;
    }
    if (room.members.size >= MAX_ROOM_MEMBERS) {
      conn.send({ t: 'error', code: 'room_full', message: `房间已满（上限 ${MAX_ROOM_MEMBERS} 人）` });
      return null;
    }
    const member = this.addMember(room, conn, nickname);
    conn.send({
      t: 'joined',
      roomCode: room.code,
      selfId: member.id,
      sessionToken: member.sessionToken,
      resumed: false,
    });
    this.broadcastRoomState(room);
    return { room, member };
  }

  private resume(conn: Conn, roomCode: string, sessionToken: string): Session | null {
    const room = this.rooms.get(roomCode.trim().toUpperCase());
    const member = room && [...room.members.values()].find((m) => m.sessionToken === sessionToken);
    if (!room || !member) {
      conn.send({ t: 'error', code: 'session_expired', message: '会话已过期，请重新加入' });
      return null;
    }
    member.conn = conn;
    member.disconnectedAt = null;
    room.emptySince = null;
    conn.send({ t: 'joined', roomCode: room.code, selfId: member.id, sessionToken, resumed: true });
    this.broadcastRoomState(room);
    return { room, member };
  }

  private addMember(room: Room, conn: Conn, nickname: string): Member {
    const member: Member = {
      id: nanoid(10),
      nickname: nickname.trim().slice(0, MAX_NICKNAME_LENGTH) || '匿名',
      sessionToken: nanoid(24),
      conn,
      fileState: 'none',
      transferProgress: 0,
      joinedAt: this.now(),
      disconnectedAt: null,
    };
    room.members.set(member.id, member);
    room.emptySince = null;
    return member;
  }

  private removeMember(room: Room, memberId: string, silent = false): void {
    room.members.delete(memberId);
    if (room.members.size === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === memberId) {
      // 房主离开：按加入顺序提升最早的在线成员，无在线成员则提升最早成员
      const candidates = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
      const next = candidates.find((m) => m.conn !== null) ?? candidates[0];
      if (next) room.hostId = next.id;
    }
    if (!silent) this.broadcastRoomState(room);
  }

  private broadcastRoomState(room: Room): void {
    const members: MemberInfo[] = [...room.members.values()].map((m) => ({
      id: m.id,
      nickname: m.nickname,
      isHost: m.id === room.hostId,
      connected: m.conn !== null,
      fileState: m.fileState,
      transferProgress: m.transferProgress,
    }));
    this.broadcast(room, {
      t: 'room_state',
      members,
      hostId: room.hostId,
      fileFingerprint: room.fileFingerprint,
    });
  }

  private broadcast(room: Room, msg: S2C, exceptId?: string): void {
    for (const m of room.members.values()) {
      if (m.id !== exceptId) m.conn?.send(msg);
    }
  }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
