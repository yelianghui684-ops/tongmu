import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildIceConfig } from '../src/turn.js';

describe('buildIceConfig', () => {
  it('未配置 TURN 时返回空列表（本地直连）', () => {
    expect(buildIceConfig({} as NodeJS.ProcessEnv)).toEqual({ iceServers: [] });
  });

  it('ICE_SERVERS_JSON 静态凭据优先（Render 等无 UDP 平台用第三方 TURN）', () => {
    const servers = [{ urls: ['turn:a.metered.ca:80'], username: 'u', credential: 'c' }];
    const env = {
      ICE_SERVERS_JSON: JSON.stringify(servers),
      TURN_HOST: 'ignored.example.com',
      TURN_SECRET: 'ignored',
    } as NodeJS.ProcessEnv;
    expect(buildIceConfig(env)).toEqual({ iceServers: servers });
  });

  it('ICE_SERVERS_JSON 非法或为空时回落到 coturn/空配置', () => {
    expect(buildIceConfig({ ICE_SERVERS_JSON: 'not-json' } as NodeJS.ProcessEnv)).toEqual({ iceServers: [] });
    expect(buildIceConfig({ ICE_SERVERS_JSON: '[]' } as NodeJS.ProcessEnv)).toEqual({ iceServers: [] });
    const fallback = buildIceConfig({
      ICE_SERVERS_JSON: '{bad',
      TURN_HOST: 't.example.com',
      TURN_SECRET: 's',
    } as NodeJS.ProcessEnv);
    expect(fallback.iceServers[0]!.urls).toContain('stun:t.example.com:3478');
  });

  it('生成 coturn REST 风格短期凭据', () => {
    const env = { TURN_HOST: 'turn.example.com', TURN_SECRET: 's3cret', TURN_TTL: '600' } as NodeJS.ProcessEnv;
    const cfg = buildIceConfig(env, () => 1_000_000_000_000); // 1e12 ms → 1e9 s
    const server = cfg.iceServers[0]!;
    expect(server.urls).toContain('stun:turn.example.com:3478');
    expect(server.urls).toContain('turn:turn.example.com:3478?transport=udp');
    expect(server.username).toBe(`${1_000_000_000 + 600}:tongmu`);
    expect(server.credential).toBe(createHmac('sha1', 's3cret').update(server.username!).digest('base64'));
  });
});
