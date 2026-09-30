import { test, expect } from '@playwright/test';

const photo = (page) => page.locator('.photo-wrapper');

// Parse via DOMMatrix: tiny offsets can be serialized in exponent form (e.g. 1e-7px)
async function photoOffset(page) {
    return photo(page).evaluate((el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return { x: m.m41, y: m.m42 };
    });
}

// Record the photo's extreme offsets every frame, so fast bounces aren't missed between polls.
async function trackExtremes(page) {
    await page.evaluate(() => {
        const extremes = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        window.__extremes = extremes;
        const el = document.querySelector('.photo-wrapper');
        const sample = () => {
            const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            const x = m.m41;
            const y = m.m42;
            extremes.minX = Math.min(extremes.minX, x);
            extremes.maxX = Math.max(extremes.maxX, x);
            extremes.minY = Math.min(extremes.minY, y);
            extremes.maxY = Math.max(extremes.maxY, y);
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
}

const extremes = (page) => page.evaluate(() => window.__extremes);

// Fire a burst of devicemotion events, as a phone does at ~60Hz while being shaken.
async function shake(page, { x = 0, y = 0, count = 10 } = {}) {
    await page.evaluate(
        async ({ x, y, count }) => {
            // Give React a couple of frames to attach its listeners after (re)load
            for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
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
    await trackExtremes(page);
    await shake(page, { x: 20 });
    await expect.poll(async () => (await extremes(page)).minX).toBeLessThan(-5);
});

test('shaking the phone down throws the photo up', async ({ page }) => {
    // Device y points up, so negative y = phone jerked down -> photo flies up
    await trackExtremes(page);
    await shake(page, { y: -25 });
    await expect.poll(async () => (await extremes(page)).minY).toBeLessThan(-5);
});

test('photo settles back at the floor after shaking stops', async ({ page }) => {
    await shake(page, { x: 20 });
    const floorY = await page.evaluate(() => {
        const el = document.querySelector('.photo-wrapper');
        const rect = el.getBoundingClientRect();
        const y = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
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
        await trackExtremes(page);
        // Device y (toward the phone's top) points screen-left at 90° and screen-right at 270°.
        // Accelerating toward the top, the photo lags the opposite way.
        await shake(page, { y: 20 });
        await expect
            .poll(async () => {
                const { minX, maxX } = await extremes(page);
                return expectSign > 0 ? maxX : -minX;
            })
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

test('a resting photo is pulled back on screen after a rotate/resize', async ({ page }) => {
    await shake(page, { x: 20 });
    // Let it settle on the (tall) portrait floor
    await expect
        .poll(async () => (await photo(page).evaluate((el) => el.getBoundingClientRect().bottom)), {
            timeout: 10_000,
        })
        .toBeGreaterThan(830);
    await page.waitForTimeout(3000);
    await page.setViewportSize({ width: 839, height: 412 });
    await expect
        .poll(async () => photo(page).evaluate((el) => el.getBoundingClientRect().bottom), { timeout: 10_000 })
        .toBeLessThanOrEqual(413);
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
