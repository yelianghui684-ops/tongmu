import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { MemberInfo } from '@tongmu/shared';
import { useRoom } from '../useRoom';

export default function Room() {
  const { code = '' } = useParams();
  const roomCode = code.toUpperCase();
  const room = useRoom(roomCode);
  const navigate = useNavigate();

  if (room.status === 'not_found') {
    return (
      <Centered>
        <p>房间 {roomCode} 不存在或已过期。</p>
        <button className="primary" onClick={() => navigate('/')}>
          回首页
        </button>
      </Centered>
    );
  }
  if (room.status === 'full') {
    return (
      <Centered>
        <p>这个房间已经满员了。</p>
        <button className="primary" onClick={() => navigate('/')}>
          回首页
        </button>
      </Centered>
    );
  }
  if (room.status === 'need_join') {
    return <JoinForm roomCode={roomCode} onJoin={room.join} />;
  }
  if (room.status === 'connecting' && !room.selfId) {
    return (
      <Centered>
        <p className="muted">正在连接…</p>
      </Centered>
    );
  }

  return (
    <div className="room">
      <header className="room-header">
        <span className="logo small">同幕</span>
        <span className="room-code" title="房间码">
          {roomCode}
        </span>
        <CopyLinkButton />
        {room.status === 'connecting' && <span className="badge warn">重连中…</span>}
        <span className="spacer" />
        <button
          className="ghost"
          onClick={() => {
            room.leave();
            navigate('/');
          }}
        >
          离开房间
        </button>
      </header>

      <main className="room-main">
        <section className="stage">
          <div className="stage-placeholder">
            <p>🎬</p>
            <p className="muted">
              {room.isHost ? '下一步：选择要放映的本地视频（里程碑 2）' : '等待房主选片…'}
            </p>
          </div>
        </section>

        <aside className="sidebar">
          <MemberList members={room.members} selfId={room.selfId} />
          <ChatPanel chat={room.chat} onSend={room.sendChat} selfId={room.selfId} />
        </aside>
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="home">
      <div className="home-card">{children}</div>
    </div>
  );
}

function JoinForm({ roomCode, onJoin }: { roomCode: string; onJoin: (nickname: string) => void }) {
  const [nickname, setNickname] = useState(() => localStorage.getItem('tongmu:nickname') ?? '');
  const [error, setError] = useState('');

  function submit() {
    const name = nickname.trim();
    if (!name) {
      setError('先取个昵称吧');
      return;
    }
    localStorage.setItem('tongmu:nickname', name);
    onJoin(name);
  }

  return (
    <Centered>
      <h1 className="logo">同幕</h1>
      <p className="tagline">
        你被邀请加入放映厅 <strong className="room-code">{roomCode}</strong>
      </p>
      <label className="field">
        <span>昵称</span>
        <input
          value={nickname}
          maxLength={20}
          autoFocus
          placeholder="怎么称呼你？"
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
      <button className="primary" onClick={submit}>
        进入放映厅
      </button>
      {error && <p className="error">{error}</p>}
    </Centered>
  );
}

function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '已复制 ✓' : '复制邀请链接'}
    </button>
  );
}

function MemberList({ members, selfId }: { members: MemberInfo[]; selfId: string }) {
  return (
    <div className="panel members">
      <h3>成员（{members.length}）</h3>
      <ul>
        {members.map((m) => (
          <li key={m.id} className={m.connected ? '' : 'offline'}>
            <span className="dot" data-state={m.connected ? 'on' : 'off'} />
            <span className="name">
              {m.nickname}
              {m.id === selfId && '（我）'}
            </span>
            {m.isHost && <span className="badge">房主</span>}
            {m.fileState === 'ready' && <span className="badge ok">已就绪</span>}
            {m.fileState === 'transferring' && (
              <span className="badge">{Math.round(m.transferProgress * 100)}%</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChatPanel({
  chat,
  onSend,
  selfId,
}: {
  chat: { from: { id: string; nickname: string }; text: string; at: number }[];
  onSend: (text: string) => void;
  selfId: string;
}) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat]);

  function send() {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  }

  return (
    <div className="panel chat">
      <h3>聊天</h3>
      <div className="chat-list" ref={listRef}>
        {chat.length === 0 && <p className="muted">还没有消息，打个招呼吧</p>}
        {chat.map((c, i) => (
          <div key={i} className={`chat-msg${c.from.id === selfId ? ' mine' : ''}`}>
            <span className="chat-from">{c.from.nickname}</span>
            <span className="chat-text">{c.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          value={draft}
          maxLength={500}
          placeholder="说点什么…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
        />
        <button onClick={send}>发送</button>
      </div>
    </div>
  );
}
