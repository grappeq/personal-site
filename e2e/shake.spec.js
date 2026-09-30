import { test, expect } from '@playwright/test';

const photo = (page) => page.locator('.photo-wrapper');

async function photoOffset(page) {
    const transform = await photo(page).evaluate((el) => el.style.transform);
    const match = transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/);
    return { x: Number(match[1]), y: Number(match[2]) };
}

// Fire a burst of devicemotion events, as a phone does at ~60Hz while being shaken.
async function shake(page, { x = 0, y = 0, count = 10 } = {}) {
    await page.evaluate(
        async ({ x, y, count }) => {
            for (let i = 0; i < count; i++) {
                window.dispatchEvent(
                    new DeviceMotionEvent('devicemotion', {
                        acceleration: { x, y, z: 0 },
                        accelerationIncludingGravity: { x, y: y - 9.8, z: 0 },
                        interval: 16,
                    }),
                );
                await new Promise((r) => setTimeout(r, 16));
            }
        },
        { x, y, count },
    );
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(photo(page)).toBeVisible();
});

test('photo stays put without motion', async ({ page }) => {
    expect(await photoOffset(page)).toEqual({ x: 0, y: 0 });
});

test('shaking the phone sideways bounces the photo the opposite way', async ({ page }) => {
    // Phone accelerates right -> photo lags behind, i.e. moves left on screen
    await shake(page, { x: 20 });
    await expect.poll(async () => (await photoOffset(page)).x).toBeLessThan(-5);
});

test('shaking the phone down throws the photo up', async ({ page }) => {
    // Device y points up, so negative y = phone jerked down -> photo flies up
    await shake(page, { y: -25 });
    await expect.poll(async () => (await photoOffset(page)).y).toBeLessThan(-5);
});

test('photo settles back at the floor after shaking stops', async ({ page }) => {
    await shake(page, { x: 20 });
    const floorY = await page.evaluate(() => {
        const el = document.querySelector('.photo-wrapper');
        const rect = el.getBoundingClientRect();
        const y = Number(el.style.transform.match(/, (-?[\d.]+)px/)[1]);
        return window.innerHeight - (rect.top - y) - rect.height;
    });
    await expect
        .poll(async () => (await photoOffset(page)).y, { timeout: 10_000 })
        .toBeCloseTo(floorY, 0);
});

test('tiny motions (hand tremor) are ignored', async ({ page }) => {
    await shake(page, { x: 1, y: 1, count: 30 });
    expect(await photoOffset(page)).toEqual({ x: 0, y: 0 });
});

test('walking-level motion does not knock a resting photo off its place', async ({ page }) => {
    await shake(page, { x: 5, y: -5, count: 30 });
    expect(await photoOffset(page)).toEqual({ x: 0, y: 0 });
});

for (const { angle, expectSign } of [
    { angle: 90, expectSign: 1 },
    { angle: 270, expectSign: -1 },
]) {
    test(`landscape (${angle}°) maps device axes to screen axes`, async ({ page }) => {
        await page.addInitScript((angle) => {
            Object.defineProperty(ScreenOrientation.prototype, 'angle', { get: () => angle });
        }, angle);
        await page.reload();
        // Device y (toward the phone's top) points screen-left at 90° and screen-right at 270°.
        // Accelerating toward the top, the photo lags the opposite way.
        await shake(page, { y: 20 });
        await expect
            .poll(async () => (await photoOffset(page)).x * expectSign)
            .toBeGreaterThan(5);
    });
}

test('photo stays on screen when the viewport shrinks mid-shake', async ({ page }) => {
    await shake(page, { y: -25, count: 5 });
    await page.setViewportSize({ width: 412, height: 500 });
    await shake(page, { x: 20, count: 20 });
    // Wait until the photo comes to rest, then check it landed on the new floor, not below it
    let previous = null;
    await expect
        .poll(
            async () => {
                const current = JSON.stringify(await photoOffset(page));
                const resting = current === previous;
                previous = current;
                return resting;
            },
            { timeout: 15_000, intervals: [250] },
        )
        .toBe(true);
    const rect = await photo(page).evaluate((el) => el.getBoundingClientRect().toJSON());
    expect(rect.left).toBeGreaterThanOrEqual(-1);
    expect(rect.bottom).toBeLessThanOrEqual(501);
    expect(rect.bottom).toBeGreaterThan(495);
});

test('motion is ignored with prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await shake(page, { x: 20 });
    await page.waitForTimeout(300);
    expect(await photoOffset(page)).toEqual({ x: 0, y: 0 });
});

test('tapping the photo requests motion permission (iOS)', async ({ page }) => {
    await page.addInitScript(() => {
        window.__motionPermissionRequests = 0;
        DeviceMotionEvent.requestPermission = () => {
            window.__motionPermissionRequests++;
            return Promise.resolve('granted');
        };
    });
    await page.reload();
    await photo(page).tap();
    expect(await page.evaluate(() => window.__motionPermissionRequests)).toBe(1);
});
