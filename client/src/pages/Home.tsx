import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { saveSession, wsClient } from '../ws';

export default function Home() {
  const navigate = useNavigate();
  const [nickname, setNickname] = useState(() => localStorage.getItem('tongmu:nickname') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pendingNickname = useRef('');

  useEffect(() => {
    const off = wsClient.on((msg) => {
      if (msg.t === 'joined') {
        saveSession({
          roomCode: msg.roomCode,
          sessionToken: msg.sessionToken,
          selfId: msg.selfId,
          nickname: pendingNickname.current,
        });
        navigate(`/room/${msg.roomCode}`);
      } else if (msg.t === 'error') {
        setBusy(false);
        setError(msg.message);
      }
    });
    return off;
  }, [navigate]);

  function remember(): string | null {
    const name = nickname.trim();
    if (!name) {
      setError('先取个昵称吧');
      return null;
    }
    localStorage.setItem('tongmu:nickname', name);
    pendingNickname.current = name;
    setError('');
    setBusy(true);
    return name;
  }

  function createRoom() {
    const name = remember();
    if (!name) return;
    // 先订阅再 connect：connect() 对已打开的连接会同步补发 ws_open
    const off = wsClient.on((msg) => {
      if (msg.t === 'ws_open') {
        wsClient.send({ t: 'create_room', nickname: name });
        off();
      }
    });
    wsClient.connect();
  }

  function joinRoom() {
    const name = remember();
    if (!name) return;
    const code = joinCode.trim().toUpperCase();
    if (code.length === 0) {
      setError('请输入房间码');
      setBusy(false);
      return;
    }
    navigate(`/room/${code}`);
  }

  return (
    <div className="home">
      <div className="home-card">
        <h1 className="logo">同幕</h1>
        <p className="tagline">一键同步放映厅 — 和朋友同时看同一部本地电影，文件点对点直传，不经过服务器。</p>

        <label className="field">
          <span>昵称</span>
          <input
            value={nickname}
            maxLength={20}
            placeholder="怎么称呼你？"
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>

        <button className="primary" disabled={busy} onClick={createRoom}>
          {busy ? '创建中…' : '创建放映厅'}
        </button>

        <div className="divider">或者加入朋友的房间</div>

        <div className="join-row">
          <input
            value={joinCode}
            maxLength={6}
            placeholder="房间码"
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
          />
          <button onClick={joinRoom}>加入</button>
        </div>

        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
