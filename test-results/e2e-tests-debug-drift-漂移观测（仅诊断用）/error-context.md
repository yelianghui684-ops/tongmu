# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e/tests/debug-drift.spec.ts >> 漂移观测（仅诊断用）
- Location: e2e/tests/debug-drift.spec.ts:13:1

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
  9  |     return { t: v.currentTime, paused: v.paused, rate: v.playbackRate, now: Date.now() };
  10 |   });
  11 | }
  12 | 
  13 | test('漂移观测（仅诊断用）', async ({ browser }) => {
  14 |   const host = await (await browser.newContext()).newPage();
  15 |   const guest = await (await browser.newContext()).newPage();
  16 | 
> 17 |   await host.goto('/');
     |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  18 |   await host.fill('input[placeholder="怎么称呼你？"]', 'A');
  19 |   await host.click('text=创建放映厅');
  20 |   await host.waitForURL(/\/room\//);
  21 |   await guest.goto(host.url());
  22 |   await guest.fill('input[placeholder="怎么称呼你？"]', 'B');
  23 |   await guest.click('text=进入放映厅');
  24 |   await host.setInputFiles('input[type=file]', FIXTURE);
  25 |   await expect(guest.locator('.stage')).toContainText('test-video.webm');
  26 |   await guest.setInputFiles('input[type=file]', FIXTURE);
  27 |   await expect(guest.locator('video')).toBeVisible();
  28 | 
  29 |   await host.click('.play-btn');
  30 |   await expect.poll(async () => (await sample(guest)).paused, { timeout: 10_000 }).toBe(false);
  31 | 
  32 |   for (let i = 0; i < 15; i++) {
  33 |     await host.waitForTimeout(1000);
  34 |     const h = await sample(host);
  35 |     const g = await sample(guest);
  36 |     const drift = g.t - (h.t + (g.now - h.now) / 1000);
  37 |     const badge = await guest.locator('.control-bar .badge').first().textContent().catch(() => '?');
  38 |     console.log(
  39 |       `[${i}] drift=${(drift * 1000).toFixed(0)}ms hostT=${h.t.toFixed(2)} guestT=${g.t.toFixed(2)} guestRate=${g.rate} badge=${badge} hostPaused=${h.paused} guestPaused=${g.paused}`,
  40 |     );
  41 |   }
  42 | });
  43 | 
```