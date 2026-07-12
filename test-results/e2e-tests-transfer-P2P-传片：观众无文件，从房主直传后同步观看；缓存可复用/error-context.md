# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/tests/transfer.spec.ts >> P2P 传片：观众无文件，从房主直传后同步观看；缓存可复用
- Location: e2e/tests/transfer.spec.ts:13:1

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  1  | import path from 'node:path';
  2  | import { expect, test, type Page } from '@playwright/test';
  3  | 
  4  | const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/test-video.webm');
  5  | 
  6  | async function sample(page: Page) {
  7  |   return page.evaluate(() => {
  8  |     const v = document.querySelector('video')!;
  9  |     return { t: v.currentTime, paused: v.paused, now: Date.now() };
  10 |   });
  11 | }
  12 | 
  13 | test('P2P 传片：观众无文件，从房主直传后同步观看；缓存可复用', async ({ browser }) => {
  14 |   const host = await (await browser.newContext()).newPage();
  15 |   const guestCtx = await browser.newContext();
  16 |   const guest = await guestCtx.newPage();
  17 | 
> 18 |   await host.goto('/');
     |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  19 |   await host.fill('input[placeholder="怎么称呼你？"]', '阿明');
  20 |   await host.click('text=创建放映厅');
  21 |   await host.waitForURL(/\/room\//);
  22 |   const roomUrl = host.url();
  23 | 
  24 |   await guest.goto(roomUrl);
  25 |   await guest.fill('input[placeholder="怎么称呼你？"]', '小雨');
  26 |   await guest.click('text=进入放映厅');
  27 | 
  28 |   await host.setInputFiles('input[type=file]', FIXTURE);
  29 |   await expect(host.locator('video')).toBeVisible();
  30 | 
  31 |   // --- 观众发起 P2P 传输 ---
  32 |   await guest.click('text=没有文件，让房主传给我');
  33 |   await expect(guest.locator('.transfer-progress')).toBeVisible();
  34 |   // 6MB 走本机回环应在数秒内完成
  35 |   await expect(guest.locator('video')).toBeVisible({ timeout: 30_000 });
  36 | 
  37 |   // 房主端应看到观众"已就绪"
  38 |   await expect(host.locator('.badge.ok')).toHaveCount(2);
  39 | 
  40 |   // --- 传完后能正常同步播放 ---
  41 |   await host.evaluate(() => (document.querySelector('video')!.muted = true));
  42 |   await guest.evaluate(() => (document.querySelector('video')!.muted = true));
  43 |   await host.click('.play-btn');
  44 |   await expect.poll(async () => (await sample(guest)).paused, { timeout: 10_000 }).toBe(false);
  45 |   await host.waitForTimeout(4000);
  46 |   const h = await sample(host);
  47 |   const g = await sample(guest);
  48 |   const drift = g.t - (h.t + (g.now - h.now) / 1000);
  49 |   expect(Math.abs(drift)).toBeLessThan(0.3);
  50 | 
  51 |   // --- 刷新观众页：OPFS 缓存完整，再次"传输"应瞬时完成（不走网络） ---
  52 |   await guest.reload();
  53 |   await expect(guest.locator('text=没有文件，让房主传给我')).toBeVisible();
  54 |   await guest.click('text=没有文件，让房主传给我');
  55 |   await expect(guest.locator('video')).toBeVisible({ timeout: 5_000 });
  56 | });
  57 | 
```