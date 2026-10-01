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
        const el = document.querySelector('.photo-wrapper');
        const start = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        const extremes = { minX: start.m41, maxX: start.m41, minY: start.m42, maxY: start.m42 };
        window.__extremes = extremes;
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

// Rest = unchanged across 3 samples ~750ms; a single equal pair can be a frame stall under load
async function waitForRest(page) {
    let previous = null;
    let unchanged = 0;
    await expect
        .poll(
            async () => {
                const current = JSON.stringify(await photoOffset(page));
                unchanged = current === previous ? unchanged + 1 : 0;
                previous = current;
                return unchanged >= 3;
            },
            { timeout: 15_000, intervals: [250] },
        )
        .toBe(true);
}

// Shaking only unlocks after a throw: drag the photo a bit, let go, and wait for it to land.
async function throwPhoto(page) {
    const box = await photo(page).boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 40, { steps: 5 });
    await page.mouse.up();
    await waitForRest(page);
    return photoOffset(page);
}

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

test('shaking does nothing until the photo has been thrown', async ({ page }) => {
    await shake(page, { x: 20, y: -25, count: 20 });
    await page.waitForTimeout(300);
    expect(await photoOffset(page)).toEqual({ x: 0, y: 0 });
});

test('tapping the photo does not unlock shaking', async ({ page }) => {
    await photo(page).tap();
    await shake(page, { x: 20, y: -25, count: 20 });
    await page.waitForTimeout(300);
    expect(await photoOffset(page)).toEqual({ x: 0, y: 0 });
});

test('shaking the phone sideways bounces the photo the opposite way', async ({ page }) => {
    const rest = await throwPhoto(page);
    // Phone accelerates right -> photo lags behind, i.e. moves left on screen
    await trackExtremes(page);
    await shake(page, { x: 20 });
    await expect.poll(async () => (await extremes(page)).minX).toBeLessThan(rest.x - 5);
});

test('shaking the phone down throws the photo up', async ({ page }) => {
    const rest = await throwPhoto(page);
    // Device y points up, so negative y = phone jerked down -> photo flies up
    await trackExtremes(page);
    await shake(page, { y: -25 });
    await expect.poll(async () => (await extremes(page)).minY).toBeLessThan(rest.y - 5);
});

test('a light shake is enough', async ({ page }) => {
    const rest = await throwPhoto(page);
    await trackExtremes(page);
    await shake(page, { y: -6, count: 15 });
    await expect.poll(async () => (await extremes(page)).minY).toBeLessThan(rest.y - 5);
});

test('photo settles back at the floor after shaking stops', async ({ page }) => {
    const rest = await throwPhoto(page);
    await shake(page, { x: 20 });
    await waitForRest(page);
    expect((await photoOffset(page)).y).toBeCloseTo(rest.y, 0);
});

test('tremor and holding the phone do not move a resting photo', async ({ page }) => {
    const rest = await throwPhoto(page);
    await shake(page, { x: 1, y: 1, count: 30 });
    await shake(page, { x: 3, y: -3, count: 30 });
    expect(await photoOffset(page)).toEqual(rest);
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
        const rest = await throwPhoto(page);
        await trackExtremes(page);
        // Device y (toward the phone's top) points screen-left at 90° and screen-right at 270°.
        // Accelerating toward the top, the photo lags the opposite way.
        await shake(page, { y: 20 });
        await expect
            .poll(async () => {
                const { minX, maxX } = await extremes(page);
                return expectSign > 0 ? maxX - rest.x : rest.x - minX;
            })
            .toBeGreaterThan(5);
    });
}

test('photo stays on screen when the viewport shrinks mid-shake', async ({ page }) => {
    await throwPhoto(page);
    await shake(page, { y: -25, count: 5 });
    await page.setViewportSize({ width: 412, height: 500 });
    await shake(page, { x: 20, count: 20 });
    // Check it landed on the new floor, not below it
    await waitForRest(page);
    const rect = await photo(page).evaluate((el) => el.getBoundingClientRect().toJSON());
    expect(rect.left).toBeGreaterThanOrEqual(-1);
    expect(rect.bottom).toBeLessThanOrEqual(501);
    expect(rect.bottom).toBeGreaterThan(495);
});

test('a resting photo is pulled back on screen after a rotate/resize', async ({ page }) => {
    await throwPhoto(page);
    expect(await photo(page).evaluate((el) => el.getBoundingClientRect().bottom)).toBeGreaterThan(830);
    await page.setViewportSize({ width: 839, height: 412 });
    await expect
        .poll(async () => photo(page).evaluate((el) => el.getBoundingClientRect().bottom), { timeout: 10_000 })
        .toBeLessThanOrEqual(413);
});

test('a resting photo drops to the new floor when the viewport grows', async ({ page }) => {
    await page.setViewportSize({ width: 839, height: 412 });
    await throwPhoto(page);
    await page.setViewportSize({ width: 412, height: 839 });
    await expect
        .poll(async () => photo(page).evaluate((el) => el.getBoundingClientRect().bottom), { timeout: 10_000 })
        .toBeGreaterThan(834);
});

test('resizing mid-drag does not start physics under the finger', async ({ page }) => {
    const box = await photo(page).boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy + 600, { steps: 10 }); // drag far below the future floor
    await page.setViewportSize({ width: 839, height: 412 });
    await page.waitForTimeout(500);
    const offset = await photoOffset(page);
    expect(offset.y).toBeCloseTo(600, 0); // still exactly where the finger put it
    await page.mouse.up();
});

test('motion is ignored with prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const rest = await throwPhoto(page);
    await shake(page, { x: 20 });
    await page.waitForTimeout(300);
    expect(await photoOffset(page)).toEqual(rest);
});

test('motion permission (iOS) is requested on the first throw, not on a tap', async ({ page }) => {
    await page.addInitScript(() => {
        window.__motionPermissionRequests = 0;
        DeviceMotionEvent.requestPermission = () => {
            window.__motionPermissionRequests++;
            return Promise.resolve('granted');
        };
    });
    await page.reload();
    await photo(page).tap();
    expect(await page.evaluate(() => window.__motionPermissionRequests)).toBe(0);
    await throwPhoto(page);
    expect(await page.evaluate(() => window.__motionPermissionRequests)).toBe(1);
});
