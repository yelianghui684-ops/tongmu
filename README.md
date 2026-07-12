# 同幕 TongMu · 一键同步放映厅

和朋友同时看同一部本地电影：开一个房间链接，**视频文件点对点直传（不经过服务器）**，播放进度毫秒级同步，内置文字聊天。

现有方案要么是老旧桌面软件（Syncplay），要么只支持流媒体（Watch2Gether）。「浏览器 + 本地文件 + P2P 传片」这个组合，就是同幕要填的空白。

## 功能

- 🎬 **一键放映厅**：建房 → 发链接 → 朋友进房，无需注册
- 📦 **P2P 传片**：一方有片即可，另一方浏览器内直接从对方拉取（WebRTC DataChannel），支持断点续传，文件写入 OPFS 不占内存
- ⏱ **毫秒级同步**：房主权威 + NTP 式时钟对齐 + playbackRate 微调，实测偏差 ~50ms；任何人可播放/暂停/拖动
- 🤝 **缓冲握手**：有人卡了全场自动等待，缓冲完自动恢复
- 💬 文字聊天、成员列表、传输进度
- 📝 外挂字幕（.srt/.vtt，自动探测 GBK/UTF-8 编码）
- 🔁 断线 30 秒内自动恢复身份

## 架构

```
浏览器 A (房主，有片)  ←— WebRTC DataChannel（文件分块，P2P 直连）—→  浏览器 B (观众)
        ↕ WSS                                                        ↕ WSS
        服务器：Node 信令/房间/聊天 + coturn（打洞失败时的 TURN 中继兜底）
```

- **控制面走服务器 WebSocket**（房间、聊天、播放同步、WebRTC 信令），数据量极小
- **数据面走 WebRTC**，视频流量不过服务器；观众把分块经 Worker（`FileSystemSyncAccessHandle`）流式写入 OPFS
- 无数据库：房间在内存里，空房 5 分钟回收

## 本地开发

```bash
npm install
npm run dev        # server :3000 + client :5173
```

打开 http://localhost:5173，用两个浏览器窗口即可完整体验（第二个窗口用无痕模式，避免共享 sessionStorage）。

## 测试

```bash
npm test           # Vitest 单元测试（同步算法/房间状态机/字幕转换）
npm run e2e        # Playwright 端到端（双浏览器上下文：全流程 + P2P 传输）
```

## 部署

见 [deploy/README.md](deploy/README.md)：Docker Compose 一键起 Node 服务 + coturn，Caddy 自动 HTTPS。

## 仓库结构

```
client/   Vite + React 前端（同步引擎 sync/、P2P 传输 transfer/、文件处理 file/）
server/   Fastify + ws 信令与房间服务
shared/   双端共享的消息协议与常量
deploy/   Dockerfile / docker-compose / Caddyfile
e2e/      Playwright 端到端测试
```

## License

[MIT](LICENSE)
