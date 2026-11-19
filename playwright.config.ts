import { defineConfig, devices } from '@playwright/test'
const url = 'http://127.0.0.1:' + (process.env.STUDIO_DEMO_PORT || '4173')

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: url, trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.STUDIO_CHROMIUM_PATH },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'iphone', use: { ...devices['iPhone 15'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'node scripts/preview.mjs', url,
    reuseExistingServer: false, timeout: 30000,
  },
})
