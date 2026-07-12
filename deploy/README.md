# 部署指南

## 前提

1. **一台 VPS**：1C1G 即可（信令流量极小；TURN 兜底中继才吃带宽）。国内用户建议选香港/新加坡节点，免备案且延迟可接受。
2. **一个域名**：添加 A 记录指向服务器 IP（HTTPS 是 WebRTC/OPFS 的硬性要求）。
3. 服务器装好 Docker 与 Docker Compose 插件。

## 防火墙放行

| 端口 | 协议 | 用途 |
|---|---|---|
| 80 / 443 | TCP | 网页 + WSS（Caddy 自动签发证书需要 80） |
| 3478 | TCP + UDP | STUN/TURN |
| 49160–49200 | UDP | TURN 中继端口段 |

## 步骤

```bash
git clone <本仓库> tongmu && cd tongmu/deploy
cp .env.example .env
# 编辑 .env：填 DOMAIN、TURN_HOST，TURN_SECRET 用 openssl rand -hex 32 生成
docker compose up -d --build
```

## 验证

1. `curl https://你的域名/healthz` → `{"ok":true}`
2. `curl https://你的域名/api/ice` → 应包含 turn: 地址与临时凭据
3. 两台不同网络的设备（如一台家里 Wi-Fi、一台手机热点）打开网站，走完「建房 → P2P 传片 → 同步观看」全流程
4. TURN 连通性可用 https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ 测试（url 填 `turn:你的域名:3478`，凭据从 /api/ice 响应里取）

## 成本提示

P2P 打洞成功时服务器只承担信令（几乎零流量）。双方 NAT 都很严时会退到 TURN 中继，一部电影就是几个 GB 流量——compose 里已用 `--user-quota/--total-quota` 限速兜底，可按需调整。

## 更新

```bash
git pull && docker compose up -d --build
```
