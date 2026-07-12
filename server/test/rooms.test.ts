import { describe, expect, it } from 'vitest';
import type { S2C } from '@tongmu/shared';
import { EMPTY_ROOM_TTL_MS, RECONNECT_GRACE_MS } from '@tongmu/shared';
import { RoomManager, type Session } from '../src/rooms.js';

class FakeConn {
  messages: S2C[] = [];
  send(msg: S2C): void {
    this.messages.push(msg);
  }
  last<T extends S2C['t']>(t: T): Extract<S2C, { t: T }> | undefined {
    return this.messages.filter((m): m is Extract<S2C, { t: T }> => m.t === t).at(-1);
  }
}

function setup(now = { t: 1000 }) {
  const rm = new RoomManager(() => now.t);
  const join = (roomCode: string, nickname: string) => {
    const conn = new FakeConn();
    const session = rm.handleMessage(conn, null, { t: 'join_room', roomCode, nickname });
    return { conn, session };
  };
  const create = (nickname: string) => {
    const conn = new FakeConn();
    const session = rm.handleMessage(conn, null, { t: 'create_room', nickname });
    const joined = conn.last('joined')!;
    return { conn, session, roomCode: joined.roomCode, selfId: joined.selfId, token: joined.sessionToken };
  };
  return { rm, join, create, now };
}

describe('房间生命周期', () => {
  it('创建者是房主，房间码 6 位', () => {
    const { create } = setup();
    const host = create('阿明');
    expect(host.roomCode).toMatch(/^[A-Z2-9]{6}$/);
    const state = host.conn.last('room_state')!;
    expect(state.hostId).toBe(host.selfId);
    expect(state.members).toHaveLength(1);
    expect(state.members[0]!.isHost).toBe(true);
  });

  it('加入后双方都收到新快照；房间不存在报错', () => {
    const { create, join } = setup();
    const host = create('阿明');
    const guest = join(host.roomCode, '小雨');
    expect(guest.conn.last('room_state')!.members).toHaveLength(2);
    expect(host.conn.last('room_state')!.members).toHaveLength(2);

    const missing = join('ZZZZZZ', '路人');
    expect(missing.session).toBeNull();
    expect(missing.conn.last('error')!.code).toBe('room_not_found');
  });

  it('超员拒绝加入', () => {
    const { create, join } = setup();
    const host = create('房主');
    for (let i = 0; i < 3; i++) expect(join(host.roomCode, `观众${i}`).session).not.toBeNull();
    const fifth = join(host.roomCode, '第五人');
    expect(fifth.session).toBeNull();
    expect(fifth.conn.last('error')!.code).toBe('room_full');
  });

  it('房主离开后按加入顺序提升在线成员', () => {
    const { rm, create, join } = setup();
    const host = create('房主');
    const g1 = join(host.roomCode, '一号');
    join(host.roomCode, '二号');
    rm.handleMessage(host.conn, host.session, { t: 'leave' });
    const state = g1.conn.last('room_state')!;
    expect(state.members).toHaveLength(2);
    expect(state.members.find((m) => m.isHost)!.nickname).toBe('一号');
  });

  it('断线后凭 token 恢复身份；宽限期过后被清出', () => {
    const { rm, create, join, now } = setup();
    const host = create('房主');
    const guest = join(host.roomCode, '小雨');
    const guestJoined = guest.conn.last('joined')!;

    rm.handleDisconnect(guest.session);
    expect(host.conn.last('room_state')!.members.find((m) => m.id === guestJoined.selfId)!.connected).toBe(false);

    // 宽限期内恢复
    const conn2 = new FakeConn();
    const resumed = rm.handleMessage(conn2, null, {
      t: 'resume',
      roomCode: host.roomCode,
      sessionToken: guestJoined.sessionToken,
    });
    expect(resumed).not.toBeNull();
    expect(conn2.last('joined')!.resumed).toBe(true);
    expect(conn2.last('joined')!.selfId).toBe(guestJoined.selfId);

    // 再断线并超过宽限期 → 清出
    rm.handleDisconnect(resumed as Session);
    now.t += RECONNECT_GRACE_MS + 1000;
    rm.sweep();
    expect(host.conn.last('room_state')!.members).toHaveLength(1);
  });

  it('全员离线的房间过 TTL 被回收', () => {
    const { rm, create, now } = setup();
    const host = create('房主');
    rm.handleDisconnect(host.session);
    expect(rm.roomCount).toBe(1);
    now.t += EMPTY_ROOM_TTL_MS + 60_000;
    rm.sweep();
    expect(rm.roomCount).toBe(0);
  });
});

describe('消息路由', () => {
  it('聊天广播给全员（含发送者），超长截断', () => {
    const { rm, create, join } = setup();
    const host = create('房主');
    const guest = join(host.roomCode, '小雨');
    rm.handleMessage(guest.conn, guest.session, { t: 'chat', text: 'x'.repeat(600) });
    expect(host.conn.last('chat')!.text).toHaveLength(500);
    expect(guest.conn.last('chat')!.text).toHaveLength(500);
  });

  it('播放指令只转发给房主；心跳盖服务器时间戳广播给其他人', () => {
    const { rm, create, join } = setup();
    const host = create('房主');
    const guest = join(host.roomCode, '小雨');

    rm.handleMessage(guest.conn, guest.session, { t: 'playback_cmd', action: { cmd: 'seek', position: 30 } });
    const req = host.conn.last('playback_request')!;
    expect(req.action).toEqual({ cmd: 'seek', position: 30 });

    rm.handleMessage(host.conn, host.session, {
      t: 'playback_heartbeat',
      position: 12,
      isPlaying: true,
      intentPlaying: true,
    });
    const pb = guest.conn.last('playback')!;
    expect(pb.state.position).toBe(12);
    expect(pb.state.atServerTime).toBe(1000);
    expect(host.conn.last('playback')).toBeUndefined(); // 不回发给房主

    // 非房主的心跳被忽略
    rm.handleMessage(guest.conn, guest.session, {
      t: 'playback_heartbeat',
      position: 99,
      isPlaying: true,
      intentPlaying: true,
    });
    expect(host.conn.last('playback')).toBeUndefined();
  });

  it('信令点对点转发', () => {
    const { rm, create, join } = setup();
    const host = create('房主');
    const guest = join(host.roomCode, '小雨');
    const guestId = guest.conn.last('joined')!.selfId;
    rm.handleMessage(host.conn, host.session, { t: 'signal', to: guestId, data: { kind: 'answer' } });
    const sig = guest.conn.last('signal')!;
    expect(sig.from).toBe(host.selfId);
    expect(sig.data).toEqual({ kind: 'answer' });
  });

  it('换片重置所有成员文件状态；非房主不能选片', () => {
    const { rm, create, join } = setup();
    const host = create('房主');
    const guest = join(host.roomCode, '小雨');
    const fp = { name: 'a.mp4', size: 10, mimeType: 'video/mp4', hash: 'abc' };

    rm.handleMessage(host.conn, host.session, { t: 'set_file', fingerprint: fp });
    rm.handleMessage(guest.conn, guest.session, { t: 'file_state', state: 'ready' });
    let state = guest.conn.last('room_state')!;
    expect(state.members.every((m) => m.fileState === 'ready')).toBe(true);

    const fp2 = { ...fp, hash: 'def' };
    rm.handleMessage(host.conn, host.session, { t: 'set_file', fingerprint: fp2 });
    state = guest.conn.last('room_state')!;
    expect(state.members.find((m) => !m.isHost)!.fileState).toBe('none');
    expect(state.fileFingerprint!.hash).toBe('def');

    rm.handleMessage(guest.conn, guest.session, { t: 'set_file', fingerprint: fp });
    expect(guest.conn.last('error')!.code).toBe('bad_request');
  });

  it('未入房发业务消息报错', () => {
    const { rm } = setup();
    const conn = new FakeConn();
    rm.handleMessage(conn, null, { t: 'chat', text: 'hi' });
    expect(conn.last('error')!.code).toBe('not_in_room');
  });

  it('ping 返回服务器时钟', () => {
    const { rm } = setup();
    const conn = new FakeConn();
    rm.handleMessage(conn, null, { t: 'ping', sentAt: 42 });
    expect(conn.last('pong')).toEqual({ t: 'pong', sentAt: 42, serverTime: 1000 });
  });
});
