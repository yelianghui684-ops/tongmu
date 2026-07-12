import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/test-video.webm');

async function sample(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector('video')!;
    return { t: v.currentTime, paused: v.paused, now: Date.now() };
  });
}

test('P2P 传片：观众无文件，从房主直传后同步观看；缓存可复用', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();

  await host.goto('/');
  await host.fill('input[placeholder="怎么称呼你？"]', '阿明');
  await host.click('text=创建放映厅');
  await host.waitForURL(/\/room\//);
  const roomUrl = host.url();

  await guest.goto(roomUrl);
  await guest.fill('input[placeholder="怎么称呼你？"]', '小雨');
  await guest.click('text=进入放映厅');

  await host.setInputFiles('input[type=file]', FIXTURE);
  await expect(host.locator('video')).toBeVisible();

  // --- 观众发起 P2P 传输 ---
  await guest.click('text=没有文件，让房主传给我');
  await expect(guest.locator('.transfer-progress')).toBeVisible();
  // 6MB 走本机回环应在数秒内完成
  await expect(guest.locator('video')).toBeVisible({ timeout: 30_000 });

  // 房主端应看到观众"已就绪"
  await expect(host.locator('.badge.ok')).toHaveCount(2);

  // --- 传完后能正常同步播放 ---
  await host.evaluate(() => (document.querySelector('video')!.muted = true));
  await guest.evaluate(() => (document.querySelector('video')!.muted = true));
  await host.click('.play-btn');
  await expect.poll(async () => (await sample(guest)).paused, { timeout: 10_000 }).toBe(false);
  await host.waitForTimeout(4000);
  const h = await sample(host);
  const g = await sample(guest);
  const drift = g.t - (h.t + (g.now - h.now) / 1000);
  expect(Math.abs(drift)).toBeLessThan(0.3);

  // --- 刷新观众页：OPFS 缓存完整，再次"传输"应瞬时完成（不走网络） ---
  await guest.reload();
  await expect(guest.locator('text=没有文件，让房主传给我')).toBeVisible();
  await guest.click('text=没有文件，让房主传给我');
  await expect(guest.locator('video')).toBeVisible({ timeout: 5_000 });
});
