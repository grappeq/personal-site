import { defineConfig, devices } from '@playwright/test';

const PORT = 5174;

export default defineConfig({
    testDir: './e2e',
    use: {
        baseURL: `http://localhost:${PORT}`,
        ...devices['Pixel 7'],
    },
    webServer: {
        command: `npx vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
    },
});
