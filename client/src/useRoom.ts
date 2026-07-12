import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatEntry, FileFingerprint, MemberInfo, S2C } from '@tongmu/shared';
import { clearSession, loadSession, saveSession, wsClient } from './ws';

export type RoomStatus =
  | 'connecting' // WS 未就绪或正在恢复会话
  | 'need_join' // 需要输入昵称加入
  | 'joined'
  | 'not_found'
  | 'full';

export interface RoomChannel {
  status: RoomStatus;
  selfId: string;
  isHost: boolean;
  members: MemberInfo[];
  hostId: string;
  fileFingerprint: FileFingerprint | null;
  chat: ChatEntry[];
  join: (nickname: string) => void;
  sendChat: (text: string) => void;
  leave: () => void;
  /** 订阅原始服务器消息（播放同步、信令等业务用） */
  onMessage: (fn: (msg: S2C) => void) => () => void;
}

/** 房间控制通道：负责加入/恢复会话、房间快照与聊天，播放同步等在其上叠加 */
export function useRoom(roomCode: string): RoomChannel {
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [selfId, setSelfId] = useState('');
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [hostId, setHostId] = useState('');
  const [fileFingerprint, setFileFingerprint] = useState<FileFingerprint | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const nicknameRef = useRef('');
  const rawHandlers = useRef(new Set<(msg: S2C) => void>());

  useEffect(() => {
    setStatus('connecting');
    const off = wsClient.on((msg) => {
      switch (msg.t) {
        case 'ws_open': {
          const stored = loadSession(roomCode);
          if (stored) {
            nicknameRef.current = stored.nickname;
            wsClient.send({ t: 'resume', roomCode, sessionToken: stored.sessionToken });
          } else {
            setStatus('need_join');
          }
          return;
        }
        case 'ws_close':
          setStatus('connecting');
          return;
        case 'joined':
          if (msg.roomCode !== roomCode.toUpperCase()) return;
          saveSession({
            roomCode: msg.roomCode,
            sessionToken: msg.sessionToken,
            selfId: msg.selfId,
            nickname: nicknameRef.current,
          });
          setSelfId(msg.selfId);
          setStatus('joined');
          break;
        case 'room_state':
          setMembers(msg.members);
          setHostId(msg.hostId);
          setFileFingerprint(msg.fileFingerprint);
          break;
        case 'chat':
          setChat((prev) => [...prev.slice(-199), { from: msg.from, text: msg.text, at: msg.at }]);
          break;
        case 'error':
          if (msg.code === 'room_not_found') setStatus('not_found');
          else if (msg.code === 'room_full') setStatus('full');
          else if (msg.code === 'session_expired') {
            clearSession(roomCode);
            setStatus('need_join');
          }
          break;
      }
      for (const fn of [...rawHandlers.current]) fn(msg as S2C);
    });
    wsClient.connect();
    return off;
  }, [roomCode]);

  const join = useCallback(
    (nickname: string) => {
      nicknameRef.current = nickname;
      setStatus('connecting');
      wsClient.send({ t: 'join_room', roomCode, nickname });
    },
    [roomCode],
  );

  const sendChat = useCallback((text: string) => {
    if (text.trim()) wsClient.send({ t: 'chat', text });
  }, []);

  const leave = useCallback(() => {
    wsClient.send({ t: 'leave' });
    clearSession(roomCode);
    wsClient.disconnect();
  }, [roomCode]);

  const onMessage = useCallback((fn: (msg: S2C) => void) => {
    rawHandlers.current.add(fn);
    return () => rawHandlers.current.delete(fn);
  }, []);

  return {
    status,
    selfId,
    isHost: selfId !== '' && selfId === hostId,
    members,
    hostId,
    fileFingerprint,
    chat,
    join,
    sendChat,
    leave,
    onMessage,
  };
}
