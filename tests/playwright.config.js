import { defineConfig } from '@playwright/test'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
export default defineConfig({
  testDir: '.', testMatch: ['game.spec.js'], timeout: 45_000, workers: 1,
  outputDir: `${root}/test-results`,
  use: { baseURL: 'http://127.0.0.1:4193', headless: true,
    viewport: { width: 560, height: 920 }, hasTouch: true,
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: `${process.execPath} tools/server.mjs`, cwd: root,
    url: 'http://127.0.0.1:4193/tests/host.html', reuseExistingServer: false },
})
