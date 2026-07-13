import { createHmac } from 'node:crypto';

export interface IceConfig {
  iceServers: { urls: string[]; username?: string; credential?: string }[];
}

/**
 * ICE 配置来源（按优先级）：
 * 1. ICE_SERVERS_JSON —— 第三方 TURN 的静态凭据（如 metered.ca），整段 RTCIceServer[] JSON；
 *    适用于跑不了 coturn 的托管平台（Render 等无 UDP 环境）。
 * 2. TURN_HOST + TURN_SECRET —— 自建 coturn，生成 REST API 风格短期凭据：
 *    username = 过期时间戳:标识，credential = base64(HMAC-SHA1(secret, username))。
 * 3. 都未配置（本地/局域网开发）→ 空列表，WebRTC 走 host candidate 直连。
 */
export function buildIceConfig(env: NodeJS.ProcessEnv, now: () => number = Date.now): IceConfig {
  const staticJson = env.ICE_SERVERS_JSON;
  if (staticJson && staticJson.trim() && staticJson.trim() !== '[]') {
    try {
      const parsed = JSON.parse(staticJson) as IceConfig['iceServers'];
      if (Array.isArray(parsed)) return { iceServers: parsed };
    } catch {
      // JSON 非法则继续走 coturn/空配置，不让放映厅因配置错误瘫痪
    }
  }

  const host = env.TURN_HOST; // 例如 turn.example.com
  const secret = env.TURN_SECRET;
  if (!host || !secret) return { iceServers: [] };

  const ttl = Number(env.TURN_TTL ?? 6 * 3600);
  const username = `${Math.floor(now() / 1000) + ttl}:tongmu`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return {
    iceServers: [
      {
        urls: [`stun:${host}:3478`, `turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`],
        username,
        credential,
      },
    ],
  };
}
