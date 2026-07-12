import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: {
      // 同步断言需要程序化 play() 不被自动播放策略拦截
      args: ['--autoplay-policy=no-user-gesture-required'],
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
