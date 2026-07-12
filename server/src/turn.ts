import { createHmac } from 'node:crypto';

export interface IceConfig {
  iceServers: { urls: string[]; username?: string; credential?: string }[];
}

/**
 * 生成 coturn REST API 风格的短期凭据：
 * username = 过期时间戳:标识，credential = base64(HMAC-SHA1(secret, username))。
 * 未配置 TURN（本地/局域网开发）时返回空列表，WebRTC 走 host candidate 直连。
 */
export function buildIceConfig(env: NodeJS.ProcessEnv, now: () => number = Date.now): IceConfig {
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
