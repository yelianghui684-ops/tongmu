# 部署指南

## 免费方案：Oracle Always Free + DuckDNS（¥0/月）

1. **注册** [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)：需邮箱、手机、信用卡（仅验证不扣费）。**home region 注册后不可改**，推荐 Seoul / Tokyo / Singapore。
2. **建实例**：Compute → Create Instance → 镜像选 Ubuntu 24.04，shape 选 `VM.Standard.E2.1.Micro`（AMD 1C1G，Always Free 容量最充足），粘贴你的 SSH 公钥，记下公网 IP。
3. **安全组**：实例的 VCN → Security List → Ingress Rules，放行 80/TCP、443/TCP、3478/TCP、3478/UDP、49160-49200/UDP（source 均为 0.0.0.0/0）。
4. **免费域名**：[duckdns.org](https://www.duckdns.org) 登录 → 建子域名 → IP 填实例公网 IP。
5. **部署**：
   ```bash
   ssh ubuntu@<公网IP>
   curl -fsSL https://raw.githubusercontent.com/<你的用户名>/tongmu/main/deploy/vps-bootstrap.sh | bash
   # 重新登录一次让 docker 组生效，然后：
   git clone https://github.com/<你的用户名>/tongmu.git && cd tongmu/deploy
   cp .env.example .env && nano .env   # DOMAIN/TURN_HOST=xxx.duckdns.org，TURN_SECRET=openssl rand -hex 32
   docker compose up -d --build
   ```

> ⚠️ Oracle 的 Ubuntu 镜像自带 iptables 规则（只开 22），**云控制台安全组和机器本机防火墙要同时放行**——`vps-bootstrap.sh` 已处理本机部分。1GB 内存构建镜像需要 swap，脚本也已处理。

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
