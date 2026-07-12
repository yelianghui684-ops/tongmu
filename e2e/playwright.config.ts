import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: {
      args: [
        // 同步断言需要程序化 play() 不被自动播放策略拦截
        '--autoplay-policy=no-user-gesture-required',
        // headless 无 mDNS 解析，需要真实 host candidate 才能建立回环 P2P
        '--disable-features=WebRtcHideLocalIpsWithMdns',
      ],
    },
  },
  webServer: [
    {
      command: 'npm run dev --workspace=server',
      port: 3000,
      reuseExistingServer: true,
      cwd: import.meta.dirname + '/..',
    },
    {
      command: 'npm run dev --workspace=client',
      port: 5173,
      reuseExistingServer: true,
      cwd: import.meta.dirname + '/..',
    },
  ],
});
