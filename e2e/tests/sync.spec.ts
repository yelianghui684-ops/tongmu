import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/test-video.webm');

async function sample(page: Page): Promise<{ t: number; paused: boolean; now: number }> {
  return page.evaluate(() => {
    const v = document.querySelector('video')!;
    return { t: v.currentTime, paused: v.paused, now: Date.now() };
  });
}

/** b 相对 a 的进度偏差（秒），已按采样时间差校正（同机时钟） */
function driftBetween(a: { t: number; now: number }, b: { t: number; now: number }, aPlaying: boolean): number {
  const elapsed = aPlaying ? (b.now - a.now) / 1000 : 0;
  return b.t - (a.t + elapsed);
}

test('两人同步观影全流程：建房/加入/聊天/选片/播放同步/seek/暂停', async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();

  // --- 建房 ---
  await host.goto('/');
  await host.fill('input[placeholder="怎么称呼你？"]', '阿明');
  await host.click('text=创建放映厅');
  await host.waitForURL(/\/room\/[A-Z2-9]{6}/);
  const roomUrl = host.url();

  // --- 加入 ---
  await guest.goto(roomUrl);
  await guest.fill('input[placeholder="怎么称呼你？"]', '小雨');
  await guest.click('text=进入放映厅');
  await expect(guest.locator('.members li')).toHaveCount(2);
  await expect(host.locator('.members li')).toHaveCount(2);

  // --- 聊天 ---
  await guest.fill('input[placeholder="说点什么…"]', '房主你好');
  await guest.press('input[placeholder="说点什么…"]', 'Enter');
  await expect(host.locator('.chat-text')).toContainText('房主你好');

  // --- 选片 ---
  await host.setInputFiles('input[type=file]', FIXTURE);
  await expect(host.locator('video')).toBeVisible();
  await expect(guest.locator('.stage')).toContainText('test-video.webm');
  await guest.setInputFiles('input[type=file]', FIXTURE);
  await expect(guest.locator('video')).toBeVisible();
  await expect(host.locator('.badge.ok')).toHaveCount(2); // 双方就绪徽章

  // headless 无音频设备，未静音的视频没有播放时钟；静音后走视频时钟（不影响同步逻辑本身）
  await host.evaluate(() => (document.querySelector('video')!.muted = true));
  await guest.evaluate(() => (document.querySelector('video')!.muted = true));

  // --- 房主开播，观众自动跟随 ---
  await host.click('.play-btn');
  await expect.poll(async () => (await sample(host)).paused).toBe(false);
  await expect.poll(async () => (await sample(guest)).paused, { timeout: 10_000 }).toBe(false);

  // --- 播放 5 秒后的偏差 < 0.3s ---
  await host.waitForTimeout(5000);
  const h1 = await sample(host);
  const g1 = await sample(guest);
  expect(Math.abs(driftBetween(h1, g1, true))).toBeLessThan(0.3);

  // --- 观众发起 seek，经房主中转后全场跳转 ---
  // （fill() 会把 range 值清成 0，须用原生 setter + input 事件驱动 React 受控滑块）
  await guest.locator('.seek').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, '30');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(async () => (await sample(host)).t, { timeout: 5000 })
    .toBeGreaterThan(29.5);
  await expect
    .poll(async () => Math.abs(driftBetween(await sample(host), await sample(guest), true)), {
      timeout: 10_000,
    })
    .toBeLessThan(0.3);

  // --- 观众发起暂停，两端都停 ---
  await guest.click('.play-btn');
  await expect.poll(async () => (await sample(host)).paused).toBe(true);
  await expect.poll(async () => (await sample(guest)).paused).toBe(true);
  const h2 = await sample(host);
  const g2 = await sample(guest);
  expect(Math.abs(driftBetween(h2, g2, false))).toBeLessThan(0.3);

  // --- 观众发起继续播放 ---
  await guest.click('.play-btn');
  await expect.poll(async () => (await sample(host)).paused).toBe(false);
  await expect.poll(async () => (await sample(guest)).paused, { timeout: 10_000 }).toBe(false);

  // --- 长播 15 秒偏差保持 < 0.3s ---
  await host.waitForTimeout(15_000);
  const h3 = await sample(host);
  const g3 = await sample(guest);
  expect(Math.abs(driftBetween(h3, g3, true))).toBeLessThan(0.3);
});
